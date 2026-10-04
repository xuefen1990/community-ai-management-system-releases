'use strict';

const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const PizZip = require('pizzip');
const { createDocxBuffer, printableHtml, safeFilename } = require('./document-export-service');
const { recordRows, templateRows } = require('./foundation-certificate-service');
const model = require('../shared/certificate-management-model');

const xmlEscape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const variablePattern = /\{([^{}]+)\}/gu;
const CERTIFICATE_LAYOUT = { titleFont: 'songti', titleSize: 22, titleBold: false,
  bodyFont: 'fangsong', bodySize: 16, lineSpacing: 28, firstLineChars: 2, signatureGapLines: 3,
  margins: { top: 28, right: 24, bottom: 28, left: 24 } };

function valuesByLabel(record) {
  const version = record.templateSnapshot || {};
  return new Map((version.fields || []).map(field => [field.label, model.resolveFieldValue(field, {
    subjects: record.subjectSnapshots || record.subjects || {}, values: record.valueSnapshot || record.values || {}, system: record.system || {},
  })]));
}

function inspectDocxBuffer(buffer) {
  let zip; try { zip = new PizZip(buffer); } catch { throw new Error('Word 模板已损坏或不是有效的 .docx 文件'); }
  const files = Object.keys(zip.files).filter(name => /^word\/(document|header\d*|footer\d*)\.xml$/u.test(name));
  const variables = new Set();
  for (const name of files) for (const match of zip.file(name).asText().matchAll(variablePattern)) variables.add(match[1].trim());
  return { zip, files, variables: [...variables] };
}

function renderDocxBuffer(buffer, record) {
  const inspected = inspectDocxBuffer(buffer); const values = valuesByLabel(record); const missing = [];
  for (const name of inspected.files) {
    const source = inspected.zip.file(name).asText();
    const output = source.replace(variablePattern, (_whole, label) => {
      const value = values.get(String(label).trim());
      if (value == null || value === '') { missing.push(String(label).trim()); return `{${label}}`; }
      return xmlEscape(value);
    });
    inspected.zip.file(name, output);
  }
  if (missing.length) throw new Error(`Word 版式还有未填写字段：${[...new Set(missing)].join('、')}`);
  return inspected.zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function certificateText(record) {
  const title = record.outputSnapshot?.title || record.templateName || '证明';
  const body = record.outputSnapshot?.content || record.content || '';
  const unit = record.system?.organizationName || '';
  const date = record.system?.issuedDate || String(record.issuedAt || '').slice(0, 10);
  const paragraphs = String(body).replaceAll(/\r\n?/gu, '\n').split(/\n+/u).map(value => value.trim()).filter(Boolean);
  const contentHtml = `${paragraphs.map(value => `<p data-doc-role="body" data-doc-align="left">${xmlEscape(value)}</p>`).join('')}<p data-doc-role="signature">${xmlEscape(unit)}</p><p data-doc-role="date">${xmlEscape(model.formatCertificateDate(date))}</p>`;
  return { title, contentHtml, contentText: `${body}\n\n${unit}\n${model.formatCertificateDate(date)}` };
}

class CertificateDocumentService {
  constructor({ store, dialog, BrowserWindow = null, temporaryDirectory = os.tmpdir(), uuid = crypto.randomUUID, artifactRecorder = null }) {
    this.store = store; this.dialog = dialog; this.BrowserWindow = BrowserWindow; this.temporaryDirectory = temporaryDirectory; this.uuid = uuid;
    this.artifactRecorder = artifactRecorder;
    this.previewWindows = new Set();
  }
  get directory() { return path.join(this.store.dataDirectory, 'certificate-templates'); }
  async getRecord(id) {
    const record = recordRows(await this.store.read()).find(item => String(item.id) === String(id));
    if (!record) throw new Error('证明记录不存在'); return record;
  }
  async selectAndArchiveWordTemplate(templateId) {
    const selection = await this.dialog.showOpenDialog({ title: '选择证明 Word 版式', properties: ['openFile'], filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const source = selection.filePaths[0]; const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || path.extname(source).toLowerCase() !== '.docx') throw new Error('请选择普通的 .docx Word 文件');
    const buffer = await fs.readFile(source); const inspection = inspectDocxBuffer(buffer);
    await fs.mkdir(this.directory, { recursive: true }); const target = path.join(this.directory, `${templateId}-${this.uuid()}.docx`);
    await fs.writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    await this.store.update(database => {
      const template = templateRows(database).find(item => item.id === templateId); if (!template) throw new Error('证明模板不存在');
      const rows = database.certificateTemplates ||= []; const index = rows.findIndex(item => item.id === templateId);
      const next = { ...structuredClone(template), wordPath: target, filePath: target, updatedAt: new Date().toISOString() };
      if (index >= 0) rows[index] = next; else rows.push(next); return target;
    });
    return { ok: true, path: target, name: path.basename(source), variables: inspection.variables };
  }
  async inspect(value = {}) {
    const filePath = value.path || value.filePath; if (!filePath) throw new Error('尚未选择 Word 版式');
    const result = inspectDocxBuffer(await fs.readFile(filePath)); return { ok: true, variables: result.variables };
  }
  async outputBuffer(record, format) {
    if (format === 'docx') {
      const wordPath = record.templateSnapshot?.wordPath;
      if (wordPath && nativeFs.existsSync(wordPath)) return renderDocxBuffer(await fs.readFile(wordPath), record);
      return createDocxBuffer({ ...certificateText(record), layout: CERTIFICATE_LAYOUT });
    }
    if (!this.BrowserWindow) throw new Error('PDF 服务当前不可用');
    const doc = certificateText(record); const window = new this.BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try { await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printableHtml({ ...doc, layout: CERTIFICATE_LAYOUT }))}`); return await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }); }
    finally { window.destroy(); }
  }
  async export(value = {}) {
    const record = await this.getRecord(value.recordId); const format = value.format === 'pdf' ? 'pdf' : 'docx';
    const selection = await this.dialog.showSaveDialog({ title: format === 'pdf' ? '导出证明 PDF' : '导出证明 Word',
      defaultPath: `${safeFilename(`${record.personName || ''}-${record.templateName || '证明'}`)}.${format}`, filters: [{ name: format === 'pdf' ? 'PDF 文档' : 'Word 文档', extensions: [format] }] });
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };
    await fs.writeFile(selection.filePath, await this.outputBuffer(record, format), { mode: 0o600 });
    let archived = null; let archiveWarning = '';
    if (record.sourceMaterial?.fileId && typeof this.artifactRecorder === 'function') {
      try {
        archived = await this.artifactRecorder({ sourceFileId: record.sourceMaterial.fileId, sourceFilePath: selection.filePath,
          name: path.basename(selection.filePath), category: 'AI 证明生成结果',
          links: [{ targetType: 'certificate', recordId: record.id, internalRecordNo: record.internalRecordNo || '' }] });
      } catch (error) { archiveWarning = `文件已导出，但未能自动归档：${error.message}`; }
    }
    return { ok: true, path: selection.filePath, format, archived, archiveWarning };
  }
  async print(value = {}) {
    const record = await this.getRecord(value.recordId); const buffer = await this.outputBuffer(record, 'pdf');
    await fs.mkdir(this.temporaryDirectory, { recursive: true }); const previewPath = path.join(this.temporaryDirectory, `community-certificate-${process.pid}-${this.uuid()}.pdf`);
    await fs.writeFile(previewPath, buffer, { mode: 0o600 });
    const window = new this.BrowserWindow({ width: 1100, height: 820, minWidth: 720, minHeight: 560, show: false, title: `打印预览 - ${record.templateName || '证明'}`,
      autoHideMenuBar: true, backgroundColor: '#e5e7eb', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true } });
    this.previewWindows.add(window); window.once('closed', () => { this.previewWindows.delete(window); void fs.rm(previewPath, { force: true }); });
    try { await window.loadURL(pathToFileURL(previewPath).href); window.show(); return { ok: true, preview: true }; }
    catch (error) { window.destroy(); await fs.rm(previewPath, { force: true }); throw error; }
  }
}

module.exports = { CertificateDocumentService, certificateText, inspectDocxBuffer, renderDocxBuffer, valuesByLabel };
