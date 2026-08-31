'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createWindowOptions } = require('../../src/main/window-config');

test('window configuration isolates renderer from Node.js', () => {
  const root = path.resolve('/tmp/community-ai-app');
  const options = createWindowOptions(root);
  assert.equal(options.title, '社区AI管理系统');
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.allowRunningInsecureContent, false);
  assert.equal(options.webPreferences.preload, path.join(root, 'src', 'preload', 'index.js'));
});

test('window configuration opens with a comfortable desktop workspace', () => {
  const options = createWindowOptions(path.resolve('/tmp/community-ai-app'));
  assert.equal(options.width, 1600);
  assert.equal(options.height, 900);
  assert.equal(options.minWidth, 1080);
  assert.equal(options.minHeight, 680);
});
