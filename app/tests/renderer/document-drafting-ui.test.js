'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('sidebar exposes the document drafting top-level destination', async () => {
  const html = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /data-target="tab-document-drafting"/u);
  assert.match(html, />\s*公文拟写\s*</u);
});

test('readable renderer module builds report, contract, history, and four-step workspace', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'document-drafting-ui.js'), 'utf8');
  assert.match(source, /id="tab-document-drafting"/u);
  assert.match(source, /拟写报告/u);
  assert.match(source, /拟写合同/u);
  assert.match(source, /历史记录/u);
  assert.match(source, /1 选择模板/u);
  assert.match(source, /4 生成与定稿/u);
  assert.match(source, /listDraftBusinessSources/u);
  assert.match(source, /selectedReferences/u);
  assert.match(source, /导出 Word/u);
  assert.doesNotMatch(source, /ipcRenderer|require\(/u);
});

test('document module is loaded through the readable local auth adapter', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /document-drafting-ui\.js/u);
});
