'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');

const { registerCompatibilityHandlers } = require('./ipc-handlers');
const { AuthStore } = require('./auth-store');
const { LocalAuthService } = require('./local-auth-service');
const { createMachineId } = require('./machine-id');
const { verifyOfflineLicense } = require('./license-codec');
const { LocalModelCatalog } = require('./local-model-catalog');
const { AiSettingsStore } = require('./ai-settings-store');
const { OpenAiCompatibleClient } = require('./openai-compatible-client');
const { LocalAiRuntime } = require('./local-ai-runtime');
const { AiRouter } = require('./ai-router');
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
  const machineId = createMachineId();
  const publicKey = fs.readFileSync(path.join(__dirname, 'license-public-key.pem'), 'utf8');
  const authService = new LocalAuthService({
    store: new AuthStore({ userDataPath: app.getPath('userData') }),
    machineId,
    verifyActivation: (code, boundMachineId, now) => verifyOfflineLicense(code, {
      publicKey,
      machineId: boundMachineId,
      now,
    }),
  });
  const modelCatalog = new LocalModelCatalog({ userDataPath: app.getPath('userData') });
  const aiSettingsStore = new AiSettingsStore({ userDataPath: app.getPath('userData'), safeStorage });
  const onlineClient = new OpenAiCompatibleClient();
  const localAiRuntime = new LocalAiRuntime();
  const aiRouter = new AiRouter({ settingsStore: aiSettingsStore, localRuntime: localAiRuntime, onlineClient });
  registerCompatibilityHandlers({
    app,
    ipcMain,
    shell,
    dialog,
    authService,
    machineId,
    modelCatalog,
    aiSettingsStore,
    onlineClient,
    localAiRuntime,
    aiRouter,
  });
  ipcMain.on(SEND_CHANNELS.startWindowDrag, () => {});
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
