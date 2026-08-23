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
  assert.match(source, /拖入“应用程序”/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});
