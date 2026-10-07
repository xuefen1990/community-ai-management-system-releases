'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureApplicationMenu } = require('../../src/main/application-menu');

test('Windows removes the default English Electron menu', () => {
  let menu = 'unchanged';
  configureApplicationMenu({ app: { getName: () => '社区AI管理系统' }, appName: '村居AI管理系统',
    Menu: { setApplicationMenu: value => { menu = value; } }, shell: {}, platform: 'win32' });
  assert.equal(menu, null);
});

test('Mac menu labels are Chinese and retain editing shortcuts', () => {
  let menu;
  let opened;
  configureApplicationMenu({ app: { getName: () => '社区AI管理系统' }, appName: '村居AI管理系统',
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { menu = value; } },
    shell: { openExternal: value => { opened = value; } }, platform: 'darwin' });
  assert.deepEqual(menu.map(item => item.label), ['村居AI管理系统', '文件', '编辑', '显示', '窗口', '帮助']);
  assert.deepEqual(menu[2].submenu.filter(item => item.role).map(item => item.role), ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  menu[5].submenu[0].click();
  assert.equal(opened, 'https://xuefeng0901.cn');
});
