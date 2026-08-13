'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const { registerCompatibilityHandlers } = require('./ipc-handlers');
const { createWindowOptions } = require('./window-config');
const { SEND_CHANNELS } = require('../shared/ipc-contract');

app.setName('社区AI管理系统');
app.setPath('userData', path.join(app.getPath('appData'), '社区AI管理系统'));

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow(createWindowOptions(path.resolve(__dirname, '..', '..')));
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registerCompatibilityHandlers({ app, ipcMain, shell });
  ipcMain.on(SEND_CHANNELS.startWindowDrag, () => {});
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

