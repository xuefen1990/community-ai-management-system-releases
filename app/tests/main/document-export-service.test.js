'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDocxBuffer,
  DocumentExportService,
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
