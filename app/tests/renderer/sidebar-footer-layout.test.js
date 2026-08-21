'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('sidebar footer keeps four compact actions in one row', async () => {
  const [html, style, updateUi] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'update-ui.js'), 'utf8'),
  ]);

  assert.match(html, /id="syncTokenBtn"[^>]*title="强制联网同步最新授权期限"/u);
  assert.match(html, /id="logoutBtn"[^>]*title="安全退出系统"/u);
  assert.match(html, /数据安全承诺 · 使用须知/u);
  assert.match(updateUi, /button\.textContent = '更新'/u);
  assert.match(style, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/u);
  assert.match(style, /white-space:\s*nowrap/u);
});
