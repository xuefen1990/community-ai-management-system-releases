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

test('readable renderer module builds a direct drafting workspace with one input and editable preview', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'document-drafting-ui.js'), 'utf8');
  assert.match(source, /id="tab-document-drafting"/u);
  assert.match(source, /AI 公文助手/u);
  assert.match(source, /documentConversationInput/u);
  assert.doesNotMatch(source, /documentConversationMessages/u);
  assert.doesNotMatch(source, /documentUnderstandingSummary/u);
  assert.match(source, /documentKindAuto/u);
  assert.match(source, /补充修改要求/u);
  assert.match(source, /根据补充重新生成/u);
  assert.match(source, /contenteditable="true"/u);
  assert.match(source, /历史记录/u);
  assert.doesNotMatch(source, /1 选择模板/u);
  assert.doesNotMatch(source, /documentDynamicFields/u);
  assert.match(source, /converseDraftDocument/u);
  assert.match(source, /listDraftBusinessSources/u);
  assert.match(source, /selectedReferences/u);
  assert.match(source, /导出 Word/u);
  assert.match(source, /documentInlineFont/u);
  assert.match(source, /documentInlineSize/u);
  assert.match(source, /documentLayoutPreset/u);
  assert.match(source, /documentAddressee/u);
  assert.match(source, /documentSignatureUnit/u);
  assert.match(source, /getDraftLayoutDefaults/u);
  assert.match(source, /layout: currentLayout\(\)/u);
  assert.match(source, /documentEditorViewport/u);
  assert.match(source, /documentEditorStage/u);
  assert.match(source, /documentPreviewZoomMode/u);
  assert.match(source, /updateEditorPreview/u);
  assert.match(source, /clearInlineOverrides/u);
  assert.match(source, />打印预览</u);
  assert.doesNotMatch(source, /ipcRenderer|require\(/u);
});

test('document preview styling keeps the workspace fixed and the A4 canvas independently scrollable', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8');
  assert.match(source, /\.document-conversation-grid\s*\{[^}]*height:\s*calc\(100vh\s*-\s*\d+px\)/su);
  assert.match(source, /\.document-chat-panel\s*\{[^}]*overflow-y:\s*auto/su);
  assert.match(source, /\.document-editor-viewport\s*\{[^}]*overflow:\s*auto/su);
  assert.match(source, /\.document-editor\s*\{[^}]*width:\s*210mm[^}]*min-height:\s*297mm/su);
});

test('document module is loaded through the readable local auth adapter', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /document-drafting-ui\.js/u);
});
