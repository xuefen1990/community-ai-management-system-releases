'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('renderer loads local authentication after the compatibility renderer', async () => {
  const html = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const rendererIndex = html.indexOf('<script src="renderer.js"></script>');
  const localAuthIndex = html.indexOf('<script src="js/local-auth-ui.js"></script>');
  assert.ok(rendererIndex >= 0);
  assert.ok(localAuthIndex > rendererIndex);
});

test('local authentication UI uses only the preload bridge', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /window\.api/u);
  assert.match(source, /loginLocalAccount/u);
  assert.match(source, /activateOfflineLicense/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});
