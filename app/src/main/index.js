'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const { registerCompatibilityHandlers } = require('./ipc-handlers');
const { AuthStore } = require('./auth-store');
const { RememberedLoginStore } = require('./remembered-login-store');
const { RemoteAuthService } = require('./remote-auth-service');
const { prepareBackendData } = require('./backend-data-migrator');
const { LocalBackendManager } = require('./local-backend-manager');
const { createMachineId } = require('./machine-id');
const { LocalModelCatalog } = require('./local-model-catalog');
const { AiSettingsStore } = require('./ai-settings-store');
const { OpenAiCompatibleClient } = require('./openai-compatible-client');
const { LocalAiRuntime } = require('./local-ai-runtime');
const { AiRouter } = require('./ai-router');
const { JsonDatabaseStore } = require('./database-store');
const { RemoteDatabaseStore } = require('./remote-database-store');
const { DocumentDraftingService } = require('./document-drafting-service');
const { WritingProfileService } = require('./writing-profile-service');
const { DocumentExportService } = require('./document-export-service');
const { UpdateService } = require('./update-service');
const { BackendUpdateClient } = require('./backend-update-client');
const { createWindowOptions } = require('./window-config');
const { SEND_CHANNELS } = require('../shared/ipc-contract');

app.setName('社区AI管理系统');
app.setPath('userData', path.join(app.getPath('appData'), '社区AI管理系统'));

let mainWindow = null;
let localBackendManager = null;

function createMainWindow() {
  mainWindow = new BrowserWindow(createWindowOptions(path.resolve(__dirname, '..', '..')));
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const machineId = createMachineId();
  const authService = new RemoteAuthService({
    store: new AuthStore({ userDataPath: app.getPath('userData') }),
    rememberedLoginStore: new RememberedLoginStore({ userDataPath: app.getPath('userData'), safeStorage }),
    machineId,
    baseUrl: process.env.COMMUNITY_AI_BACKEND_URL || 'http://127.0.0.1:3000',
  });
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'src', 'index.js')
    : path.join(projectRoot, 'backend', 'src', 'index.js');
  localBackendManager = new LocalBackendManager({
    backendEntry,
    prepareData: () => prepareBackendData({
      userDataPath: app.getPath('userData'),
      legacyBackendPaths: [
        process.env.COMMUNITY_AI_LEGACY_BACKEND_DB,
        path.join(projectRoot, 'backend', 'data', 'backend.db'),
      ].filter(Boolean),
    }),
  });
  authService.getServerConfig()
    .then(config => localBackendManager.ensureReady(config))
    .catch(() => {});
  const modelCatalog = new LocalModelCatalog({ userDataPath: app.getPath('userData') });
  const aiSettingsStore = new AiSettingsStore({ userDataPath: app.getPath('userData'), safeStorage });
  const onlineClient = new OpenAiCompatibleClient();
  const localAiRuntime = new LocalAiRuntime();
  const aiRouter = new AiRouter({ settingsStore: aiSettingsStore, localRuntime: localAiRuntime, onlineClient });
  const localDatabaseStore = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
  const databaseStore = new RemoteDatabaseStore({ authService, localStore: localDatabaseStore, onChanged: (payload) => mainWindow?.webContents.send('unit-workspace-changed', payload) });
  const getCurrentAccount = async () => (await authService.getStatus()).account;
  const documentDraftingService = new DocumentDraftingService({ databaseStore, getCurrentAccount, aiRouter });
  const writingProfileService = new WritingProfileService({ databaseStore, getCurrentAccount });
  const documentExportService = new DocumentExportService({ documentDraftingService, dialog, BrowserWindow });
  const updateService = new UpdateService({
    updater: autoUpdater,
    isPackaged: () => app.isPackaged,
    isInApplicationsFolder: () => typeof app.isInApplicationsFolder === 'function' && app.isInApplicationsFolder(),
    sendStatus: (status) => mainWindow?.webContents.send('app-update-status', status),
    backendUpdateClient: new BackendUpdateClient({
      getServerConfig: () => authService.getServerConfig(),
    }),
    currentVersion: () => app.getVersion(),
  });
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
    databaseStore,
    documentDraftingService,
    writingProfileService,
    documentExportService,
    updateService,
    localBackendManager,
  });
  ipcMain.on(SEND_CHANNELS.startWindowDrag, () => {});
  createMainWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => updateService.check(), 1000);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  localBackendManager?.stop().catch(() => {});
});
