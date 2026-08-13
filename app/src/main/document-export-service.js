'use strict';

const fs = require('node:fs/promises');

const { sanitizeDocumentHtml, textToHtml } = require('./document-drafting-service');

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

function paragraphXml(text, { title = false } = {}) {
  const lines = String(text || '').split('\n');
  const runs = lines.map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`).join('');
  const properties = title ? '<w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr>' : '<w:pPr><w:spacing w:line="420" w:lineRule="auto" w:after="160"/><w:ind w:firstLine="480"/></w:pPr>';
  return `<w:p>${properties}<w:r><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="32"/></w:rPr>${runs}</w:r></w:p>`;
}

function createDocxBuffer({ title, contentText }) {
  const body = String(contentText || '').split(/\n{2,}/u).map((paragraph) => paragraphXml(paragraph)).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphXml(title, { title: true })}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="44"/><w:rFonts w:eastAsia="黑体"/></w:rPr></w:style></w:styles>';
  return createStoredZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
  ]);
}

function printableHtml({ title, contentHtml, contentText }) {
  const body = sanitizeDocumentHtml(contentHtml || textToHtml(contentText));
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:25mm 22mm}body{font-family:"Songti SC","STSong",serif;color:#111;font-size:16px;line-height:1.8}h1{text-align:center;font-family:"Heiti SC","STHeiti",sans-serif;font-size:26px;margin:0 0 28px}p{margin:0 0 12px;text-indent:2em}ul,ol{margin:0 0 12px 2em}</style></head><body><h1>${xmlEscape(title)}</h1>${body}</body></html>`;
}

class DocumentExportService {
  constructor({ documentDraftingService, dialog, BrowserWindow = null }) {
    this.documentDraftingService = documentDraftingService;
    this.dialog = dialog;
    this.BrowserWindow = BrowserWindow;
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
      await fs.writeFile(selection.filePath, createDocxBuffer({ title: document.title, contentText: version.contentText }));
    } else {
      const window = await this.createPrintWindow({ title: document.title, version });
      try {
        const buffer = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        await fs.writeFile(selection.filePath, buffer);
      } finally {
        window.destroy();
      }
    }
    return { ok: true, path: selection.filePath, format, versionNumber: version.versionNumber };
  }

  async createPrintWindow({ title, version }) {
    if (!this.BrowserWindow) throw new Error('打印服务不可用');
    const window = new this.BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const html = printableHtml({ title, contentHtml: version.contentHtml, contentText: version.contentText });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return window;
  }

  async print(value) {
    const { document, version } = await this.selectedVersion(value);
    const window = await this.createPrintWindow({ title: document.title, version });
    try {
      await new Promise((resolve, reject) => window.webContents.print({ printBackground: true }, (success, reason) => success ? resolve() : reject(new Error(reason || '打印失败'))));
      return { ok: true };
    } finally {
      window.destroy();
    }
  }
}

module.exports = { createDocxBuffer, DocumentExportService, printableHtml, safeFilename };
