'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('sidebar footer compacts four actions into a two-row layout', async () => {
  const [html, style, localAuthUi, updateUi] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8'),
  ]);

  assert.match(html, /id="syncTokenBtn"[^>]*title="强制联网同步最新授权期限"/u);
  assert.match(html, /id="logoutBtn"[^>]*title="安全退出系统"/u);
  assert.match(html, /数据安全承诺 · 使用须知/u);
  assert.match(localAuthUi, /function configureCompactSidebarFooter\(\)/u);
  assert.match(localAuthUi, /function refreshEntitlementFromServer\(\)/u);
  assert.match(localAuthUi, /api\.getLocalAuthStatus\(\)/u);
  assert.match(localAuthUi, /function openPrivacyPolicy\(\)/u);
  assert.match(localAuthUi, /bindButton\('privacyPolicyBtn', openPrivacyPolicy\)/u);
  assert.match(localAuthUi, /privacyButton\.id = 'privacyPolicyBtn'/u);
  assert.match(localAuthUi, /primaryActions\.append\(refreshButton, logoutButton\)/u);
  assert.match(localAuthUi, /secondaryActions\.append\(privacyButton\)/u);
  assert.match(updateUi, /document\.querySelector\('\.sidebar-secondary-actions'\)/u);
  assert.match(updateUi, /button\.textContent = '检查更新'/u);
  assert.match(style, /\.sidebar-primary-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/su);
  assert.match(style, /\.sidebar-secondary-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/su);
  assert.match(style, /\.sidebar-security-btn::after\s*\{\s*content:\s*'安全保护中'/su);
});
