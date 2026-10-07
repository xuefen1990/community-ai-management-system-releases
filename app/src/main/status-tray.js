'use strict';

const path = require('node:path');

function statusLabel(status = {}) {
  switch (status.state) {
    case 'ready': return '🟢 本机账号服务：运行中';
    case 'external': return '🔵 账号服务：使用外部地址';
    case 'starting': return '🟡 本机账号服务：启动中';
    case 'failed': return '🔴 本机账号服务：启动失败';
    case 'stopped': return '⚪ 本机账号服务：已停止';
    default: return '⚪ 本机账号服务：尚未启动';
  }
}

function createStatusTray({ app, Tray, Menu, nativeImage, clipboard, getBackendStatus, showMainWindow, appName = app.getName(), platform = process.platform }) {
  const iconPath = platform === 'win32'
    ? path.join(__dirname, 'assets', 'app-icon.ico')
    : path.join(__dirname, 'assets', 'status-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) throw new Error('菜单栏图标未找到');
  const tray = new Tray(icon);
  tray.setToolTip(appName);
  let lastMenuState = '';

  const refresh = () => {
    const status = getBackendStatus?.() || {};
    const address = typeof status.baseUrl === 'string' ? status.baseUrl.trim() : '';
    const menuState = JSON.stringify([status.state, address, app.getVersion()]);
    if (menuState === lastMenuState) return;
    lastMenuState = menuState;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `${appName}  v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: '打开主界面', click: showMainWindow },
      { type: 'separator' },
      { label: statusLabel(status), enabled: false },
      { label: address ? `复制服务地址（${address}）` : '复制服务地址', enabled: Boolean(address),
        click: () => clipboard.writeText(address) },
      { type: 'separator' },
      { label: `彻底退出${appName}`, click: () => app.quit() },
    ]));
  };
  refresh();
  tray.on('double-click', showMainWindow);
  const timer = setInterval(refresh, 3000);
  timer.unref?.();
  return { tray, refresh, destroy() { clearInterval(timer); tray.destroy(); } };
}

module.exports = { createStatusTray, statusLabel };
