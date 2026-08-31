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
  assert.match(source, /拖入“应用程序”/u);
  assert.match(source, /function formatReleaseNotes\(value\)/u);
  assert.match(source, /replace\(\/<li\\b\[\^>\]\*>\/giu, '• '\)/u);
  assert.match(source, /replace\(\/<\[\^>\]\+>\/gu, ''\)/u);
  assert.match(source, /textContent = formatReleaseNotes\(status\.releaseNotes\)/u);
  assert.doesNotMatch(source, /require\(|ipcRenderer|node:/u);
});

test('manual update check shows a loading state and always restores the button', async () => {
  const [source, style] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
  ]);

  assert.match(source, /function setManualCheckButtonState\(/u);
  assert.match(source, /button\.classList\.toggle\('is-checking', checking\)/u);
  assert.match(source, /button\.setAttribute\('aria-busy', String\(checking\)\)/u);
  assert.match(source, /try\s*\{[\s\S]*api\.checkForAppUpdate\(\)[\s\S]*\}\s*finally\s*\{[\s\S]*setManualCheckButtonState\(button, false\)/u);
  assert.match(style, /\.sidebar-update-btn:hover\s*\{[\s\S]*transform:\s*translateY\(-2px\)/u);
  assert.match(style, /\.sidebar-update-btn\.is-checking\s+\.sidebar-update-btn__icon\s*\{[\s\S]*animation:/u);
  assert.match(style, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
});

test('light theme keeps modal primary actions readable and hides legacy onboarding controls', async () => {
  const [source, style] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
  ]);
  assert.match(source, /function removeOnboardingControls\(\)/u);
  assert.match(source, /querySelectorAll\('\.btn-guide, \.sidebar-tour-btn'\)/u);
  assert.match(style, /Modal windows sit outside \.app-main/u);
  assert.match(style, /\.modal-overlay \.modal-card \.btn\.btn-primary/u);
  assert.match(style, /#appUpdateModal #appUpdateNotes/u);
  assert.match(style, /\.btn\.btn-guide,\s*\.sidebar-tour-btn\s*\{[\s\S]*?display:\s*none\s*!important/u);
});

test('light theme gives every custom dialog button a visible green surface', async () => {
  const style = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8');
  assert.match(style, /cf-modal dialogs/u);
  assert.match(style, /\.cf-modal button:not\(\.cf-close\)/u);
  assert.match(style, /\.modal-overlay \.modal-card button:not\(\.close-modal-btn\):not\(\.btn-close\)/u);
  assert.match(style, /background:\s*linear-gradient\(135deg, #c6ead3 0%, #a9d9ba 100%\)\s*!important/u);
  assert.match(style, /\.cf-modal button:not\(\.cf-close\):disabled/u);
  assert.match(style, /opacity:\s*1\s*!important/u);
});
