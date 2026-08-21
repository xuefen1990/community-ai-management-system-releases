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
  assert.match(source, /getLoginPrefill/u);
  assert.match(source, /clearLoginPrefill/u);
  assert.match(source, /记住登录/u);
  assert.match(source, /免费体验已结束/u);
  assert.match(source, /clearLegacyTrialExperience/u);
  assert.match(source, /startLegacyTrialGuard/u);
  assert.match(source, /update-ui\.js/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});

test('startup remains on the login screen with compact manual login actions', async () => {
  const [source, style] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
  ]);
  assert.match(source, /function showLoginScreen\(\)/u);
  assert.match(source, /function configureLoginActions\(\)/u);
  assert.match(source, /登录进入工作台/u);
  assert.match(source, /切换账号/u);
  assert.match(source, /forceLoginPanel\(\)/u);
  assert.doesNotMatch(source, /window\.showPanel/u);
  assert.doesNotMatch(source, /if \(currentStatus\.authenticated\) await enterDashboard\(currentStatus\)/u);
  assert.match(style, /\.login-action-row\s*\{/u);
  assert.match(style, /grid-template-columns:\s*minmax\(108px, 0\.8fr\) minmax\(0, 1\.35fr\)/u);
});

test('post-login uses the v0.1.3 compatibility dashboard flow', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8');
  assert.match(source, /getElementById\('loginView'\)\?\.classList\.add\('hidden'\)/u);
  assert.match(source, /getElementById\('dashboardView'\)\?\.classList\.remove\('hidden'\)/u);
  assert.match(source, /await window\.loadDatabase\(\)/u);
  assert.match(source, /window\.renderOverview\(\)/u);
  assert.match(source, /clearLegacyTrialExperience\(\);/u);
  assert.match(source, /activeApplicationView = 'dashboard'/u);
  assert.match(source, /trialTitle\.parentElement\?\.parentElement\?\.parentElement/u);
  assert.doesNotMatch(source, /function setAppViewVisibility\(id, visible\)/u);
});

test('dashboard shell keeps the v0.1.3 sidebar dimensions', async () => {
  const style = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8');
  assert.match(style, /\.app-sidebar\s*\{[^}]*width:\s*250px/su);
  assert.match(style, /\.sidebar-footer\s*\{[^}]*background-color:\s*var\(--bg-sidebar-footer\)/su);
});
