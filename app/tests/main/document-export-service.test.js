'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDocxBuffer,
  DocumentExportService,
  printableHtml,
  safeFilename,
} = require('../../src/main/document-export-service');

test('safe filenames remove path characters and preserve a readable title', () => {
  assert.equal(safeFilename('../社区/报告:*?'), '社区-报告');
  assert.equal(safeFilename('   '), '未命名公文');
});

test('Word output is a valid OOXML zip with title and paragraphs', () => {
  const buffer = createDocxBuffer({ title: '环境整治报告', contentText: '第一段\n\n第二段' });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const text = buffer.toString('utf8');
  assert.match(text, /\[Content_Types\]\.xml/u);
  assert.match(text, /word\/document\.xml/u);
  assert.match(text, /环境整治报告/u);
  assert.match(text, /第一段/u);
});

test('Word output follows the request sample layout and does not duplicate an existing title', () => {
  const buffer = createDocxBuffer({
    title: '关于申请费用的请示',
    contentHtml: '<h1 data-doc-role="title">关于申请费用的请示</h1><p data-doc-role="addressee">晓店街道办事处：</p><p data-doc-role="body">正文内容</p><p data-doc-role="signature"><span data-doc-font="kaiti" data-doc-size="14">陆庄社区居民委员会</span></p>',
    layout: { preset: 'request' },
  });
  const text = buffer.toString('utf8');
  assert.equal((text.match(/关于申请费用的请示/gu) || []).length, 1);
  assert.match(text, /w:eastAsia="黑体"/u);
  assert.match(text, /w:eastAsia="仿宋"/u);
  assert.match(text, /w:eastAsia="楷体"/u);
  assert.match(text, /w:sz w:val="28"/u);
  assert.match(text, /w:top="1701"/u);
  assert.match(text, /w:left="1587"/u);
});

test('print layout uses the saved font, line spacing, margins, and semantic alignment', () => {
  const html = printableHtml({
    title: '费用报告',
    contentHtml: '<h1 data-doc-role="title">费用报告</h1><p data-doc-role="body">正文</p><p data-doc-role="signature">陆庄社区居民委员会</p>',
    layout: { preset: 'report', bodyFont: 'kaiti', bodySize: 14, lineSpacing: 32, margins: { top: 20, right: 21, bottom: 22, left: 23 } },
  });
  assert.match(html, /margin:20mm 21mm 22mm 23mm/u);
  assert.match(html, /font-size:14pt/u);
  assert.match(html, /line-height:32pt/u);
  assert.equal((html.match(/费用报告/gu) || []).length, 1);
});

function documentResult() {
  return {
    document: { id: 'd1', title: '测试报告', currentVersionId: 'v1' },
    versions: [{ id: 'v1', versionNumber: 3, contentText: '正文', contentHtml: '<p>正文</p>' }],
  };
}

test('Word export writes the selected authorized version', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'document-export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'output.docx');
  const service = new DocumentExportService({
    documentDraftingService: { getDocument: async () => documentResult() },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath }) },
  });
  const result = await service.export({ documentId: 'd1', versionId: 'v1', format: 'docx' });
  assert.equal(result.ok, true);
  assert.equal((await fs.readFile(filePath)).subarray(0, 2).toString(), 'PK');
});

test('cancelled PDF export does not create a print window', async () => {
  let windows = 0;
  const service = new DocumentExportService({
    documentDraftingService: { getDocument: async () => documentResult() },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    BrowserWindow: class { constructor() { windows += 1; } },
  });
  const result = await service.export({ documentId: 'd1', format: 'pdf' });
  assert.deepEqual(result, { ok: false, canceled: true });
  assert.equal(windows, 0);
});

test('printing first opens a real A4 PDF preview and removes its temporary file when closed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'document-print-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const windows = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.webContents = {
        printToPDF: async (optionsValue) => {
          this.pdfOptions = optionsValue;
          return Buffer.from('%PDF-1.4\npreview');
        },
      };
      windows.push(this);
    }

    once(event, handler) { this.listeners.set(event, handler); }
    async loadURL(url) { this.url = url; }
    show() { this.shown = true; }
    destroy() {
      this.destroyed = true;
      this.listeners.get('closed')?.();
    }
  }

  const service = new DocumentExportService({
    documentDraftingService: { getDocument: async () => documentResult() },
    dialog: {},
    BrowserWindow: FakeBrowserWindow,
    temporaryDirectory: directory,
    createId: () => 'fixed-preview',
  });
  const result = await service.print({ documentId: 'd1', versionId: 'v1' });

  assert.deepEqual(result, { ok: true, preview: true });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].options.show, false);
  assert.equal(windows[0].destroyed, true);
  assert.deepEqual(windows[0].pdfOptions, { printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
  assert.equal(windows[1].shown, true);
  assert.equal(service.previewWindows.size, 1);
  assert.match(windows[1].url, /^file:/u);
  const previewPath = decodeURIComponent(new URL(windows[1].url).pathname);
  assert.equal((await fs.readFile(previewPath)).subarray(0, 4).toString(), '%PDF');

  windows[1].destroy();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(service.previewWindows.size, 0);
  await assert.rejects(fs.access(previewPath));
});
