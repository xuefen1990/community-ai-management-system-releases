'use strict';

const assert = require('node:assert/strict');
const { access, readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('user-facing HTML uses the new product name', async () => {
  const files = ['index.html', 'mobile_upload.html'];
  for (const file of files) {
    const contents = await readFile(path.join(appRoot, 'src', 'renderer', file), 'utf8');
    assert.doesNotMatch(contents, /村务通管理系统|村务通/u);
    assert.match(contents, /社区AI管理系统/u);
  }
});

test('original AI assistant feature name remains available', async () => {
  const contents = await readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(contents, /AI 牛小二/u);
});

test('brand deliverables exist', async () => {
  await access(path.join(appRoot, 'assets', 'brand', 'icon-1024.png'));
  await access(path.join(appRoot, 'assets', 'brand', 'logo-transparent.png'));
  await access(path.join(appRoot, 'build', 'icon.icns'));
  await access(path.join(appRoot, 'src', 'renderer', 'logo.png'));
});

