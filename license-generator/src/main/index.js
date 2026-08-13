'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { issueLicense } = require('./license-issuer');

app.setName('社区AI授权工具');
app.setPath('userData', path.join(app.getPath('appData'), '社区AI授权工具'));

function getPrivateKeyPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'license-private-key.pem')
    : path.resolve(__dirname, '..', '..', 'private', 'license-private-key.pem');
}

function createWindow() {
  const window = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: '#f4faf8',
    title: '社区AI授权工具',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('issue-license', async (_event, input) => {
    const privateKey = fs.readFileSync(getPrivateKeyPath(), 'utf8');
    return issueLicense(input, privateKey);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
