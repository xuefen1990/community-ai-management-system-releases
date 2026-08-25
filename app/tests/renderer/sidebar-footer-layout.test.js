'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('sidebar footer compacts four actionable controls into a two-by-two layout', async () => {
  const [html, style, localAuthUi, updateUi] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8'),
  ]);

  assert.match(html, /id="syncTokenBtn"[^>]*title="强制联网同步最新授权期限"/u);
  assert.match(html, /id="logoutBtn"[^>]*title="安全退出系统"/u);
  assert.match(localAuthUi, /function configureCompactSidebarFooter\(\)/u);
  assert.match(localAuthUi, /function refreshEntitlementFromServer\(\)/u);
  assert.match(localAuthUi, /api\.getLocalAuthStatus\(\)/u);
  assert.match(localAuthUi, /privacyButton\?\.remove\(\)/u);
  assert.match(localAuthUi, /secondaryActions\.append\(refreshButton, logoutButton\)/u);
  assert.match(localAuthUi, /function openMemberPermissionsPage\(\)/u);
  assert.match(localAuthUi, /button\.addEventListener\('click', openMemberPermissionsPage\)/u);
  assert.match(updateUi, /document\.querySelector\('\.sidebar-secondary-actions'\)/u);
  assert.match(updateUi, /setManualCheckButtonState\(button, false\)/u);
  assert.match(style, /\.sidebar-secondary-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/su);
  assert.match(style, /#manualUpdateCheckBtn\s*\{\s*order:\s*2/u);
  assert.match(style, /#unitManagementEntry\s*\{\s*order:\s*3/u);
  assert.match(style, /#logoutBtn\s*\{\s*order:\s*4/u);
  assert.match(style, /\.sidebar-secondary-actions > button:hover:not\(:disabled\)/u);
});
