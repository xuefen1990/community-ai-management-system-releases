'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, clipboard, dialog, ipcMain, safeStorage, shell, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');

const { registerCompatibilityHandlers } = require('./ipc-handlers');
const { AuthStore } = require('./auth-store');
const { RememberedLoginStore } = require('./remembered-login-store');
const { RemoteAuthService } = require('./remote-auth-service');
const { prepareBackendData } = require('./backend-data-migrator');
const { LocalBackendManager } = require('./local-backend-manager');
const { AccountWorkspaceManager } = require('./account-workspace-manager');
const { createMachineId } = require('./machine-id');
const { LocalModelCatalog } = require('./local-model-catalog');
const { AiSettingsStore } = require('./ai-settings-store');
const { OpenAiCompatibleClient } = require('./openai-compatible-client');
const { LocalAiRuntime } = require('./local-ai-runtime');
const { AiRouter } = require('./ai-router');
const { AiAssistantService } = require('./ai-assistant-service');
const { AiFileTaskService } = require('./ai-file-task-service');
const { AiStorageService } = require('./ai-storage-service');
const { AiAnomalyService } = require('./ai-anomaly-service');
const { MacosVisionOcrService } = require('./macos-vision-ocr-service');
const { AiTaskService } = require('./ai-task-service');
const { ContractFeeFileService } = require('./contract-fee-file-service');
const { FoundationDocumentService } = require('./foundation-document-service');
const { FoundationAuthService } = require('./foundation-auth-service');
const { FoundationBusinessService } = require('./foundation-business-service');
const { FoundationBackupService } = require('./foundation-backup-service');
const { JsonDatabaseStore } = require('./database-store');
const { RemoteDatabaseStore } = require('./remote-database-store');
const { DocumentDraftingService } = require('./document-drafting-service');
const { WritingProfileService } = require('./writing-profile-service');
const { DocumentExportService } = require('./document-export-service');
const { CertificateDocumentService } = require('./certificate-document-service');
const { UpdateService } = require('./update-service');
const { BackendUpdateClient } = require('./backend-update-client');
const { createWindowOptions } = require('./window-config');
const { SEND_CHANNELS } = require('../shared/ipc-contract');
const { registerFoundationFileProtocol } = require('./foundation-file-protocol');
const { AiVisionService } = require('./ai-vision-service');
const { getDevelopmentConfig, developmentAuthStore, attachDevelopmentWindow } = require('./development-mode');
const { createStatusTray } = require('./status-tray');
const { configureApplicationMenu } = require('./application-menu');

protocol.registerSchemesAsPrivileged([{ scheme: 'community-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const PRODUCTION_BACKEND_URL = 'https://xuefeng0901.cn';
const LEGACY_PRODUCTION_BACKEND_URLS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://121.43.135.1:3000',
  'http://172.17.107.161:3000',
];

app.setName('社区AI管理系统');
if (process.platform === 'win32') app.setAppUserModelId('com.community.ai.management');
const productionData = path.join(app.getPath('appData'), '社区AI管理系统');
const development = getDevelopmentConfig({ isPackaged: app.isPackaged, productionData });
app.setPath('userData', development?.userData || productionData);

let mainWindow = null;
let localBackendManager = null;
let lanWorkspaceService = null;
let statusTray = null;
let hideOnInitialLoad = false;

function createMainWindow() {
  mainWindow = new BrowserWindow(createWindowOptions(path.resolve(__dirname, '..', '..')));
  const hash = development ? attachDevelopmentWindow(mainWindow, development) : '';
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'foundation', 'index.html'), hash ? { hash: hash.slice(1) } : undefined);
  mainWindow.once('ready-to-show', () => {
    if (!hideOnInitialLoad) mainWindow?.show();
    hideOnInitialLoad = false;
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(() => {
  hideOnInitialLoad = !development && process.platform === 'darwin'
    && Boolean(app.getLoginItemSettings?.().wasOpenedAsHidden);
  configureApplicationMenu({ app, Menu, shell });
  const machineId = createMachineId();
  const authStore = new AuthStore({ userDataPath: app.getPath('userData') });
  const authService = new RemoteAuthService({
    store: development ? developmentAuthStore(authStore, development.remoteServerUrl) : authStore,
    rememberedLoginStore: new RememberedLoginStore({ userDataPath: app.getPath('userData'), safeStorage }),
    machineId,
    baseUrl: development?.remoteServerUrl || process.env.COMMUNITY_AI_BACKEND_URL || PRODUCTION_BACKEND_URL,
    legacyBaseUrls: development ? [] : LEGACY_PRODUCTION_BACKEND_URLS,
    fetchImpl: (...args) => net.fetch(...args),
  });
  lanWorkspaceService = new AccountWorkspaceManager({ userDataPath: app.getPath('userData'), fetchImpl: (...args) => net.fetch(...args),
    port: development ? 3302 : undefined, discovery: !development });
  authService.localWorkspaceService = lanWorkspaceService;
  lanWorkspaceService.startIfConfigured().catch(error => console.error('[LAN sharing]', error.message));
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'src', 'index.js')
    : path.join(projectRoot, 'backend', 'src', 'index.js');
  localBackendManager = new LocalBackendManager({
    backendEntry,
    prepareData: () => prepareBackendData({
      userDataPath: app.getPath('userData'),
      legacyBackendPaths: development ? [] : [
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
  const aiRouter = new AiRouter({ settingsStore: aiSettingsStore, localRuntime: localAiRuntime, onlineClient, authService });
  const aiVisionService = new AiVisionService({ aiRouter });
  const localDatabaseStore = new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
  const databaseStore = new RemoteDatabaseStore({ authService, localStore: localDatabaseStore, localWorkspaceService: lanWorkspaceService,
    onChanged: (payload) => mainWindow?.webContents.send('unit-workspace-changed', payload) });
  registerFoundationFileProtocol({ protocol, net, store: databaseStore, authService });
  const aiTaskService = new AiTaskService({ databaseStore, authService });
  const aiFileAuth = new FoundationAuthService({ authService,
    ensureReady: async () => localBackendManager?.ensureReady(await authService.getServerConfig()) });
  const aiFileDocumentService = new FoundationDocumentService({ store: databaseStore, shell,
    authorize: request => aiFileAuth.authorize(request) });
  const aiFileBusinessService = new FoundationBusinessService({ store: databaseStore, authorize: request => aiFileAuth.authorize(request) });
  const aiFileBackupService = new FoundationBackupService({ store: databaseStore, authorize: request => aiFileAuth.authorize(request) });
  const contractFeeFileService = new ContractFeeFileService({ userDataPath: app.getPath('userData'), dialog, store: databaseStore });
  const ocrService = new MacosVisionOcrService({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
  });
  const aiFileTaskService = new AiFileTaskService({ databaseStore, dialog, documentService: aiFileDocumentService, taskService: aiTaskService,
    businessService: aiFileBusinessService, backupService: aiFileBackupService, contractFeeFileService, ocrService, visionService: aiVisionService });
  const aiStorageService = new AiStorageService({ databaseStore, aiFileTaskService });
  const aiAnomalyService = new AiAnomalyService({ databaseStore });
  const aiAssistantService = new AiAssistantService({ databaseStore, aiRouter, authService, taskService: aiTaskService, aiFileTaskService });
  const getCurrentAccount = async () => (await authService.getStatus()).account;
  const documentDraftingService = new DocumentDraftingService({ databaseStore, getCurrentAccount, aiRouter });
  const writingProfileService = new WritingProfileService({ databaseStore, getCurrentAccount });
  const documentExportService = new DocumentExportService({ documentDraftingService, dialog, BrowserWindow });
  const certificateDocumentService = new CertificateDocumentService({ store: databaseStore, dialog, BrowserWindow,
    artifactRecorder: value => aiFileTaskService.archiveGeneratedArtifact(value) });
  const updateService = new UpdateService({
    updater: autoUpdater,
    isPackaged: () => app.isPackaged,
    platform: process.platform,
    isInApplicationsFolder: () => typeof app.isInApplicationsFolder === 'function' && app.isInApplicationsFolder(),
    sendStatus: (status) => mainWindow?.webContents.send('app-update-status', status),
    backendUpdateClient: new BackendUpdateClient({
      getServerConfig: () => ({ baseUrl: PRODUCTION_BACKEND_URL }),
      fetchImpl: (...args) => net.fetch(...args),
    }),
    currentVersion: () => app.getVersion(),
  });
  registerCompatibilityHandlers({
    app,
    BrowserWindow,
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
    aiAssistantService,
    aiFileTaskService,
    aiStorageService,
    aiAnomalyService,
    contractFeeFileService,
    databaseStore,
    documentDraftingService,
    writingProfileService,
    documentExportService,
    certificateDocumentService,
    updateService,
    localBackendManager,
    lanWorkspaceService,
  });
  ipcMain.on(SEND_CHANNELS.startWindowDrag, () => {});
  createMainWindow();
  statusTray = createStatusTray({ app, Tray, Menu, nativeImage, clipboard,
    getBackendStatus: () => localBackendManager?.getStatus(), showMainWindow });
  aiAnomalyService.scan().catch(error => {
    if (development) console.warn('[AI anomaly scan]', error.message);
  });

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (development || process.platform !== 'darwin') app.quit();
});

if (development) {
  process.on('message', message => { if (message?.type === 'community-dev' && message.action === 'quit') app.quit(); });
  process.on('uncaughtExceptionMonitor', error => console.error('[main uncaught]', error));
}

app.on('before-quit', () => {
  statusTray?.destroy();
  statusTray = null;
  localBackendManager?.stop().catch(() => {});
  lanWorkspaceService?.stop().catch(() => {});
});
