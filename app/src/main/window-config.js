'use strict';

const path = require('node:path');

function createWindowOptions(appRoot, platform = process.platform) {
  return {
    width: 1600,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: "村居AI管理系统",
    ...(platform === 'win32' ? { icon: path.join(appRoot, 'src', 'main', 'assets', 'app-icon.ico') } : {}),
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#eef7f3',
    webPreferences: {
      preload: path.join(appRoot, 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}

module.exports = { createWindowOptions };
