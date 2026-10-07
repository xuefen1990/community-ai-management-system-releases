'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('AI 文件查看器支持安全预览、缩放、旋转和关闭', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'foundation', 'ai-file-viewer.mjs'), 'utf8');
  assert.match(source, /file\.previewUrl/u);
  assert.match(source, /data-viewer-minus/u);
  assert.match(source, /data-viewer-plus/u);
  assert.match(source, /data-viewer-rotate/u);
  assert.match(source, /event\.key === 'Escape'/u);
  assert.doesNotMatch(source, /archivePath|file:\/\//u);
});
