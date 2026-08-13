'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('renderer loads the dual AI settings adapter', async () => {
  const html = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/ai-settings-ui\.js"><\/script>/u);
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'ai-settings-ui.js'), 'utf8');
  assert.match(source, /自动：本地优先/u);
  assert.match(source, /importLocalModel/u);
  assert.match(source, /chatWithAi/u);
  assert.doesNotMatch(source, /ipcRenderer|require\(/u);
});
