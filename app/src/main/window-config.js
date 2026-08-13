'use strict';

const path = require('node:path');

function createWindowOptions(appRoot) {
  return {
    width: 1292,
    height: 768,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: '社区AI管理系统',
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

