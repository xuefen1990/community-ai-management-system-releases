'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { INVOKE_CHANNELS } = require('../shared/ipc-contract');
const { JsonDatabaseStore } = require('./database-store');

function registerCompatibilityHandlers({ app, ipcMain, shell, databaseStore, authService, machineId }) {
  const store = databaseStore || new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
  const handlerNames = new Set();

  function handle(channel, callback) {
    ipcMain.handle(channel, callback);
    handlerNames.add(channel);
  }

  handle(INVOKE_CHANNELS.readDb, async () => store.read());
  handle(INVOKE_CHANNELS.writeDb, async (_event, value) => {
    try {
      return await store.write(value);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle(INVOKE_CHANNELS.createDbBackup, async () => store.createBackup());
  handle(INVOKE_CHANNELS.listDbBackups, async () => store.listBackups());
  handle(INVOKE_CHANNELS.restoreDbBackup, async (_event, value) => store.restoreBackup(value));
  handle(INVOKE_CHANNELS.getDbDir, async () => store.dataDirectory);
  handle(INVOKE_CHANNELS.getMachineId, async () => machineId);
  handle(INVOKE_CHANNELS.isDev, async () => !app.isPackaged);
  handle(INVOKE_CHANNELS.getVersion, async () => app.getVersion());
  handle(INVOKE_CHANNELS.getFilesMetadata, async () => []);
  handle(INVOKE_CHANNELS.selectFilesAndFolders, async () => []);
  handle(INVOKE_CHANNELS.selectExcelFile, async () => null);
  handle(INVOKE_CHANNELS.readExcelColumns, async () => ({ columns: [], rows: [] }));
  handle(INVOKE_CHANNELS.getLanShareInfo, async () => ({ enabled: false, url: null }));
  handle(INVOKE_CHANNELS.getMobileUploadInfo, async () => ({ enabled: false, url: null }));
  handle(INVOKE_CHANNELS.scanLocalModels, async () => []);
  handle(INVOKE_CHANNELS.getInternalAiServerStatus, async () => ({ running: false }));
  if (authService) {
    handle(INVOKE_CHANNELS.registerLocalAccount, async (_event, value) => authService.register(value));
    handle(INVOKE_CHANNELS.loginLocalAccount, async (_event, value) => authService.login(value));
    handle(INVOKE_CHANNELS.logoutLocalAccount, async () => authService.logout());
    handle(INVOKE_CHANNELS.getLocalAuthStatus, async () => authService.getStatus());
    handle(INVOKE_CHANNELS.activateOfflineLicense, async (_event, code) => authService.activate(code));
  }

  const successChannels = [
    INVOKE_CHANNELS.writePersonnelImport,
    INVOKE_CHANNELS.restorePersonnelImportVersion,
    INVOKE_CHANNELS.writeLandImport,
    INVOKE_CHANNELS.restoreLandImportVersion,
    INVOKE_CHANNELS.archiveFile,
    INVOKE_CHANNELS.deleteFile,
    INVOKE_CHANNELS.restoreFromTrash,
    INVOKE_CHANNELS.deletePermanently,
    INVOKE_CHANNELS.emptyTrash,
    INVOKE_CHANNELS.selectAndMigrateDataDir,
    INVOKE_CHANNELS.updateLanShareConfig,
    INVOKE_CHANNELS.setLanShareAuthState,
    INVOKE_CHANNELS.writeOperationLog,
    INVOKE_CHANNELS.sendVoiceParseResult,
    INVOKE_CHANNELS.toggleInternalAiServer,
    INVOKE_CHANNELS.appendAiLog,
    INVOKE_CHANNELS.exportAiLog,
  ];
  for (const channel of new Set(successChannels)) {
    if (!handlerNames.has(channel)) handle(channel, async () => ({ ok: true }));
  }

  handle(INVOKE_CHANNELS.openPath, async (_event, requestedPath) => {
    if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
      return { ok: false, error: '路径无效' };
    }
    const error = await shell.openPath(requestedPath);
    return error ? { ok: false, error } : { ok: true };
  });
  handle(INVOKE_CHANNELS.openModelsDir, async () => {
    const modelsDirectory = path.join(app.getPath('userData'), 'models');
    fs.mkdirSync(modelsDirectory, { recursive: true });
    const error = await shell.openPath(modelsDirectory);
    return error ? { ok: false, error } : { ok: true };
  });

  return handlerNames;
}

module.exports = { registerCompatibilityHandlers };
