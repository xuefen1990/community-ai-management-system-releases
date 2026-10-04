'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStatusTray, statusLabel } = require('../../src/main/status-tray');

test('menu bar uses the app brand, real service status and working actions', () => {
  let menu;
  let copied = '';
  let shown = 0;
  let quit = 0;
  let destroyed = 0;
  const events = {};
  let status = { state: 'starting', baseUrl: 'http://127.0.0.1:3301' };
  const app = { getName: () => '社区AI管理系统', getVersion: () => '1.0.1', quit: () => quit++ };
  const Tray = class {
    setToolTip(value) { assert.equal(value, '社区AI管理系统'); }
    setContextMenu(value) { menu = value; }
    on(name, callback) { events[name] = callback; }
    destroy() { destroyed++; }
  };
  const icon = { isEmpty: () => false };
  const tray = createStatusTray({ app, Tray, Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => icon }, clipboard: { writeText: value => { copied = value; } },
    getBackendStatus: () => status, showMainWindow: () => shown++ });
  assert.equal(menu[0].label, '社区AI管理系统  v1.0.1');
  assert.equal(menu[4].label, '🟡 本机账号服务：启动中');
  menu[2].click();
  events['double-click']();
  assert.equal(shown, 2);
  status = { state: 'ready', baseUrl: 'http://127.0.0.1:3301' };
  tray.refresh();
  assert.equal(menu[4].label, '🟢 本机账号服务：运行中');
  menu[5].click();
  assert.equal(copied, 'http://127.0.0.1:3301');
  menu[7].click();
  assert.equal(quit, 1);
  tray.destroy();
  assert.equal(destroyed, 1);
});

test('missing service address cannot be copied and external service is not shown as running', () => {
  assert.equal(statusLabel({ state: 'external' }), '🔵 账号服务：使用外部地址');
  let menu;
  const tray = createStatusTray({ app: { getName: () => '社区AI管理系统', getVersion: () => '1.0.1', quit() {} },
    Tray: class { setToolTip() {} setContextMenu(value) { menu = value; } on() {} destroy() {} },
    Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    clipboard: { writeText() { throw new Error('cannot copy'); } }, getBackendStatus: () => ({ state: 'idle' }), showMainWindow() {} });
  assert.equal(menu[5].enabled, false);
  tray.destroy();
});

test('Windows notification area uses the product icon', () => {
  let iconPath;
  const tray = createStatusTray({ app: { getName: () => '社区AI管理系统', getVersion: () => '1.0.2', quit() {} },
    Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
    Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath: value => { iconPath = value; return { isEmpty: () => false }; } },
    clipboard: { writeText() {} }, getBackendStatus: () => ({}), showMainWindow() {}, platform: 'win32' });
  assert.match(iconPath, /assets[/\\]app-icon\.ico$/u);
  tray.destroy();
});
