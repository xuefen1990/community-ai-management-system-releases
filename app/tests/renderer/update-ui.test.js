'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('update UI uses the preload bridge and waits for user confirmation before download', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8');
  assert.match(source, /onAppUpdateStatus/u);
  assert.match(source, /downloadAppUpdate/u);
  assert.match(source, /installAppUpdate/u);
  assert.match(source, /立即更新/u);
  assert.match(source, /暂不更新/u);
  assert.match(source, /installation-required/u);
  assert.match(source, /release-mismatch/u);
  assert.match(source, /backend-unavailable/u);
  assert.match(source, /当前已是最新版本/u);
  assert.match(source, /完成后将自动安装并打开新版/u);
  assert.doesNotMatch(source, /重启并安装/u);
  assert.match(source, /function formatReleaseNotes\(value\)/u);
  assert.match(source, /replace\(\/<li\\b\[\^>\]\*>\/giu, '• '\)/u);
  assert.match(source, /replace\(\/<\[\^>\]\+>\/gu, ''\)/u);
  assert.match(source, /textContent = formatReleaseNotes\(status\.releaseNotes\)/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});

test('manual update check shows a loading state and always restores the button', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8');

  assert.match(source, /function setManualCheckButtonState\(/u);
  assert.match(source, /button\.classList\.toggle\('is-checking', checking\)/u);
  assert.match(source, /button\.setAttribute\('aria-busy', String\(checking\)\)/u);
  assert.match(source, /try\s*\{[\s\S]*api\.checkForAppUpdate\(\)[\s\S]*\}\s*finally\s*\{[\s\S]*setManualCheckButtonState\(button, false\)/u);
});
