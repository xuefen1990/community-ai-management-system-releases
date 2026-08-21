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
  assert.match(source, /listLocalAccountEntitlements/u);
  assert.match(source, /记住登录/u);
  assert.match(source, /免费体验已结束/u);
  assert.match(source, /suppressLegacyTrialExperience/u);
  assert.match(source, /update-ui\.js/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});

test('post-login state prevents hidden layers from intercepting clicks', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /function setAppViewVisibility\(id, visible\)/u);
  assert.match(source, /view\.style\.pointerEvents = visible \? 'auto' : 'none'/u);
  assert.match(source, /setAppViewVisibility\('loginView', false\)/u);
  assert.match(source, /setAppViewVisibility\('dashboardView', true\)/u);
  assert.match(source, /modal\.style\.pointerEvents = 'none'/u);
  assert.match(source, /#globalCustomConfirmModal/u);
  assert.match(source, /function repairInactiveInteractionLayers\(\)/u);
  assert.match(source, /document\.body\.classList\.add\('logged-in'\)/u);
  assert.doesNotMatch(source, /parentElement\?\.parentElement\?\.parentElement/u);
});

test('dashboard shell is explicitly interactive in the macOS window', async () => {
  const style = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8');
  for (const selector of ['.app-wrapper', '.dashboard-view', '.app-sidebar', '.sidebar-menu', '.app-main']) {
    assert.match(style, new RegExp(`${selector.replace('.', '\\.') }\\s*\\{[^}]*-webkit-app-region:\\s*no-drag\\s*!important[^}]*pointer-events:\\s*auto`, 'su'));
  }
});
