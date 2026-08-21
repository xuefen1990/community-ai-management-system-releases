'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  documentTextFromHtml,
  normalizeDocumentLayout,
  sanitizeDocumentHtml,
  textToHtml,
} = require('./document-drafting-service');

function safeFilename(value) {
  const cleaned = String(value || '').replaceAll(/[\\/:*?"<>|.]+/gu, '-').replaceAll(/\s+/gu, ' ').replaceAll(/^-+|-+$/gu, '').trim();
  return cleaned || '未命名公文';
}

function xmlEscape(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date('2026-01-01T00:00:00.000Z')) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  return { dosDate, dosTime };
}

function createStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((total, item) => total + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const FONT_NAMES = Object.freeze({ fangsong: '仿宋', songti: '宋体', heiti: '黑体', kaiti: '楷体' });

function decodeHtml(value) {
  return String(value || '').replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

function attributeValue(source, name) {
  const match = String(source || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu'));
  return match?.[2] || '';
}

function comparableText(value) {
  return String(value || '').replaceAll(/[\s：:，,。！？!?、（）()《》]/gu, '');
}

function inlineRuns(innerHtml) {
  const runs = [];
  const stack = [{ bold: false, italic: false, underline: false, font: null, size: null }];
  for (const token of String(innerHtml || '').match(/<[^>]+>|[^<]+/gu) || []) {
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      if (/^<br\b/iu.test(token)) {
        runs.push({ ...stack.at(-1), text: '\n' });
        continue;
      }
      const next = { ...stack.at(-1) };
      if (/^<(b|strong)\b/iu.test(token)) next.bold = true;
      if (/^<(i|em)\b/iu.test(token)) next.italic = true;
      if (/^<u\b/iu.test(token)) next.underline = true;
      if (/^<span\b/iu.test(token)) {
        next.font = attributeValue(token, 'data-doc-font') || next.font;
        const size = Number(attributeValue(token, 'data-doc-size'));
        if (Number.isFinite(size)) next.size = size;
      }
      stack.push(next);
      continue;
    }
    const text = decodeHtml(token);
    if (text) runs.push({ ...stack.at(-1), text });
  }
  return runs;
}

function documentBlocks({ title, contentHtml, contentText }) {
  const html = sanitizeDocumentHtml(contentHtml || textToHtml(contentText));
  const blocks = [];
  const matcher = /<(h[1-4]|p|li|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/giu;
  let match;
  while ((match = matcher.exec(html))) {
    const role = attributeValue(match[2], 'data-doc-role');
    const align = attributeValue(match[2], 'data-doc-align');
    const runs = inlineRuns(match[3]);
    blocks.push({ tag: match[1].toLowerCase(), role, align, runs, text: runs.map((run) => run.text).join('') });
  }
  if (!blocks.length) {
    for (const paragraph of String(contentText || '').split(/\n{2,}/u).filter(Boolean)) blocks.push({ tag: 'p', role: '', align: '', runs: [{ text: paragraph }], text: paragraph });
  }
  const first = blocks[0];
  if (!first || (first.role !== 'title' && comparableText(first.text) !== comparableText(title))) {
    blocks.unshift({ tag: 'h1', role: 'title', align: 'center', runs: [{ text: title }], text: title });
  } else first.role = 'title';
  return blocks;
}

function runXml(run, block, layout) {
  const isTitle = block.role === 'title';
  const fontKey = run.font || (isTitle ? layout.titleFont : layout.bodyFont);
  const size = run.size || (isTitle ? layout.titleSize : layout.bodySize);
  const properties = [
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${xmlEscape(FONT_NAMES[fontKey] || FONT_NAMES.fangsong)}"/>`,
    `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`,
    (run.bold || (isTitle && layout.titleBold)) ? '<w:b/><w:bCs/>' : '',
    run.italic ? '<w:i/><w:iCs/>' : '',
    run.underline ? '<w:u w:val="single"/>' : '',
  ].join('');
  const text = String(run.text || '').split('\n').map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`).join('');
  return `<w:r><w:rPr>${properties}</w:rPr>${text}</w:r>`;
}

function paragraphXml(block, layout) {
  const role = block.role || 'body';
  const line = Math.round(layout.lineSpacing * 20);
  const alignment = block.align || (role === 'title' ? 'center' : ['signature', 'date'].includes(role) ? 'right' : 'left');
  const shouldIndent = ['body', 'closing'].includes(role) && block.tag !== 'li';
  const spacing = role === 'title'
    ? `<w:spacing w:line="${line}" w:lineRule="exact" w:after="${line}"/>`
    : `<w:spacing w:line="${line}" w:lineRule="exact" w:before="${role === 'signature' ? line * 2 : 0}" w:after="0"/>`;
  const indent = shouldIndent ? `<w:ind w:firstLine="${Math.round(layout.bodySize * layout.firstLineChars * 20)}"/>` : '';
  return `<w:p><w:pPr>${spacing}${indent}<w:jc w:val="${alignment}"/></w:pPr>${block.runs.map((run) => runXml(run, block, layout)).join('')}</w:p>`;
}

function createDocxBuffer({ title, contentHtml = '', contentText = '', layout = null }) {
  const normalizedLayout = normalizeDocumentLayout(layout);
  const body = documentBlocks({ title, contentHtml, contentText }).map((block) => paragraphXml(block, normalizedLayout)).join('');
  const twips = (millimeters) => Math.round(millimeters * 56.692913);
  const margins = normalizedLayout.margins;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}"/></w:sectPr></w:body></w:document>`;
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  return createStoredZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
  ]);
}

function fontCss(fontKey) {
  const families = {
    fangsong: '"FangSong_GB2312","FangSong","STFangsong","仿宋","Songti SC",serif',
    songti: '"Songti SC","STSong","宋体",serif',
    heiti: '"Heiti SC","STHeiti","黑体",sans-serif',
    kaiti: '"Kaiti SC","STKaiti","楷体",serif',
  };
  return families[fontKey] || families.fangsong;
}

function printableHtml({ title, contentHtml, contentText, layout }) {
  const normalizedLayout = normalizeDocumentLayout(layout);
  let body = sanitizeDocumentHtml(contentHtml || textToHtml(contentText));
  const plain = documentTextFromHtml(body).split('\n')[0] || '';
  if (!/<h1\b[^>]*data-doc-role="title"/iu.test(body) && comparableText(plain) !== comparableText(title)) body = `<h1 data-doc-role="title">${xmlEscape(title)}</h1>${body}`;
  const margins = normalizedLayout.margins;
  const fontRules = Object.keys(FONT_NAMES).map((key) => `[data-doc-font="${key}"]{font-family:${fontCss(key)}}`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm}body{margin:0;color:#111;font-family:${fontCss(normalizedLayout.bodyFont)};font-size:${normalizedLayout.bodySize}pt;line-height:${normalizedLayout.lineSpacing}pt}h1[data-doc-role="title"]{margin:0 0 ${normalizedLayout.lineSpacing}pt;text-align:center;font-family:${fontCss(normalizedLayout.titleFont)};font-size:${normalizedLayout.titleSize}pt;line-height:${normalizedLayout.lineSpacing}pt;font-weight:${normalizedLayout.titleBold ? 700 : 400}}p{margin:0;text-indent:${normalizedLayout.firstLineChars}em}p[data-doc-role="addressee"],p[data-doc-role="signature"],p[data-doc-role="date"]{text-indent:0}p[data-doc-role="signature"]{margin-top:${normalizedLayout.lineSpacing * 2}pt;text-align:right}p[data-doc-role="date"]{text-align:right}[data-doc-align="left"]{text-align:left}[data-doc-align="center"]{text-align:center}[data-doc-align="right"]{text-align:right}[data-doc-align="justify"]{text-align:justify}${fontRules}[data-doc-size]{line-height:inherit}${[9,10.5,12,14,15,16,18,22,24,26,28,36,42].map((size) => `[data-doc-size="${size}"]{font-size:${size}pt}`).join('')}ul,ol{margin:0;padding-left:2em}</style></head><body>${body}</body></html>`;
}

class DocumentExportService {
  constructor({ documentDraftingService, dialog, BrowserWindow = null, temporaryDirectory = os.tmpdir(), createId = crypto.randomUUID }) {
    this.documentDraftingService = documentDraftingService;
    this.dialog = dialog;
    this.BrowserWindow = BrowserWindow;
    this.temporaryDirectory = temporaryDirectory;
    this.createId = createId;
    this.previewWindows = new Set();
  }

  async selectedVersion({ documentId, versionId }) {
    const result = await this.documentDraftingService.getDocument(documentId);
    const selectedId = versionId || result.document.currentVersionId;
    const version = result.versions.find((item) => item.id === selectedId);
    if (!version) throw new Error('导出版本不存在');
    return { document: result.document, version };
  }

  async export(value) {
    const { document, version } = await this.selectedVersion(value);
    const format = value.format === 'pdf' ? 'pdf' : 'docx';
    const defaultPath = `${safeFilename(document.title)}-v${version.versionNumber}.${format}`;
    const selection = await this.dialog.showSaveDialog({
      title: format === 'pdf' ? '导出 PDF' : '导出 Word',
      defaultPath,
      filters: [{ name: format === 'pdf' ? 'PDF 文档' : 'Word 文档', extensions: [format] }],
    });
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };
    if (format === 'docx') {
      await fs.writeFile(selection.filePath, createDocxBuffer({ title: document.title, contentHtml: version.contentHtml, contentText: version.contentText, layout: version.layoutSnapshot || document.layout }));
    } else {
      const buffer = await this.createPdfBuffer({ document, version });
      await fs.writeFile(selection.filePath, buffer);
    }
    return { ok: true, path: selection.filePath, format, versionNumber: version.versionNumber };
  }

  async createPrintWindow({ document, version }) {
    if (!this.BrowserWindow) throw new Error('打印服务不可用');
    const window = new this.BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const html = printableHtml({ title: document.title, contentHtml: version.contentHtml, contentText: version.contentText, layout: version.layoutSnapshot || document.layout });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return window;
  }

  async createPdfBuffer({ document, version }) {
    const window = await this.createPrintWindow({ document, version });
    try {
      return await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
    } finally {
      window.destroy();
    }
  }

  async print(value) {
    const { document, version } = await this.selectedVersion(value);
    if (!this.BrowserWindow) throw new Error('打印服务不可用');
    const buffer = await this.createPdfBuffer({ document, version });
    await fs.mkdir(this.temporaryDirectory, { recursive: true });
    const previewPath = path.join(this.temporaryDirectory, `community-ai-print-preview-${process.pid}-${this.createId()}.pdf`);
    await fs.writeFile(previewPath, buffer, { mode: 0o600 });
    const previewWindow = new this.BrowserWindow({
      width: 1100,
      height: 820,
      minWidth: 720,
      minHeight: 560,
      show: false,
      title: `打印预览 - ${document.title}`,
      autoHideMenuBar: true,
      backgroundColor: '#e5e7eb',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true },
    });
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await fs.rm(previewPath, { force: true }).catch(() => {});
    };
    this.previewWindows.add(previewWindow);
    previewWindow.once('closed', () => {
      this.previewWindows.delete(previewWindow);
      void cleanup();
    });
    try {
      await previewWindow.loadURL(pathToFileURL(previewPath).href);
      previewWindow.show();
      return { ok: true, preview: true };
    } catch (error) {
      previewWindow.destroy();
      await cleanup();
      throw error;
    }
  }
}

module.exports = { createDocxBuffer, DocumentExportService, printableHtml, safeFilename };
