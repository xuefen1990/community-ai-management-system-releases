'use strict';

function applicationMenuTemplate(appName, openWebsite) {
  return [
    { label: appName, submenu: [
      { role: 'about', label: `关于${appName}` },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: `隐藏${appName}` },
      { role: 'hideOthers', label: '隐藏其他应用' },
      { role: 'unhide', label: '显示全部' },
      { type: 'separator' },
      { role: 'quit', label: `退出${appName}` },
    ] },
    { label: '文件', submenu: [{ role: 'close', label: '关闭窗口' }] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '显示', submenu: [
      { role: 'reload', label: '重新载入' },
      { role: 'togglefullscreen', label: '切换全屏' },
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      { role: 'front', label: '将窗口移到最前面' },
    ] },
    { label: '帮助', submenu: [{ label: '打开官网', click: openWebsite }] },
  ];
}

function configureApplicationMenu({ app, Menu, shell, platform = process.platform }) {
  if (platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate(
    app.getName(), () => shell.openExternal('https://xuefeng0901.cn'),
  )));
}

module.exports = { applicationMenuTemplate, configureApplicationMenu };
