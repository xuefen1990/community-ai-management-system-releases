'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { INVOKE_CHANNELS } = require('../shared/ipc-contract');
const { JsonDatabaseStore } = require('./database-store');

function registerCompatibilityHandlers({
  app,
  ipcMain,
  shell,
  dialog,
  databaseStore,
  authService,
  machineId,
  modelCatalog,
  aiSettingsStore,
  onlineClient,
  localAiRuntime,
  aiRouter,
  documentDraftingService,
  writingProfileService,
  documentExportService,
  updateService,
}) {
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
  handle(INVOKE_CHANNELS.scanLocalModels, async () => modelCatalog ? modelCatalog.scan() : []);
  handle(INVOKE_CHANNELS.getInternalAiServerStatus, async () => localAiRuntime
    ? localAiRuntime.getStatus()
    : ({ running: false }));
  if (authService) {
    handle(INVOKE_CHANNELS.registerLocalAccount, async (_event, value) => authService.register(value));
    handle(INVOKE_CHANNELS.loginLocalAccount, async (_event, value) => authService.login(value));
    handle(INVOKE_CHANNELS.logoutLocalAccount, async () => authService.logout());
    handle(INVOKE_CHANNELS.getLocalAuthStatus, async () => authService.getStatus());
    handle(INVOKE_CHANNELS.activateOfflineLicense, async (_event, code) => authService.activate(code));
    handle(INVOKE_CHANNELS.listLocalAccountEntitlements, async () => authService.listAccountEntitlements());
    handle(INVOKE_CHANNELS.setLocalAccountEntitlement, async (_event, value) => authService.setAccountEntitlement(value));
  }
  if (updateService) {
    handle(INVOKE_CHANNELS.checkForAppUpdate, async () => updateService.check());
    handle(INVOKE_CHANNELS.downloadAppUpdate, async () => updateService.download());
    handle(INVOKE_CHANNELS.installAppUpdate, async () => updateService.install());
  }
  if (modelCatalog && dialog) {
    handle(INVOKE_CHANNELS.importLocalModel, async () => {
      const result = await dialog.showOpenDialog({
        title: '导入本地 GGUF 模型',
        properties: ['openFile'],
        filters: [{ name: 'GGUF 模型', extensions: ['gguf'] }],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      return modelCatalog.importFile(result.filePaths[0]);
    });
  }
  if (aiSettingsStore && onlineClient) {
    handle(INVOKE_CHANNELS.getAiSettings, async () => aiSettingsStore.getPublicSettings());
    handle(INVOKE_CHANNELS.saveAiSettings, async (_event, value) => aiSettingsStore.save(value));
    handle(INVOKE_CHANNELS.testOnlineAi, async () => onlineClient.chat({
      ...(await aiSettingsStore.getOnlineCredentials()),
      messages: [{ role: 'user', content: '请只回复：连接成功' }],
      temperature: 0,
    }));
  }
  if (localAiRuntime) {
    handle(INVOKE_CHANNELS.toggleInternalAiServer, async (_event, value) => localAiRuntime.toggle(value));
  }
  if (aiRouter) {
    handle(INVOKE_CHANNELS.chatWithAi, async (_event, value) => aiRouter.chat(value));
  }

  function documentResult(callback) {
    return async (...argumentsList) => {
      try {
        return { ok: true, data: await callback(...argumentsList) };
      } catch (error) {
        return { ok: false, error: error?.message || '公文操作失败' };
      }
    };
  }

  const requireDraftingService = () => {
    if (!documentDraftingService) throw new Error('公文拟写服务尚未配置');
    return documentDraftingService;
  };
  const requireProfileService = () => {
    if (!writingProfileService) throw new Error('写作偏好服务尚未配置');
    return writingProfileService;
  };
  const requireExportService = () => {
    if (!documentExportService) throw new Error('公文导出服务尚未配置');
    return documentExportService;
  };

  handle(INVOKE_CHANNELS.listDocumentTemplates, documentResult(async (_event, value = {}) => requireDraftingService().listTemplates(value.documentKind)));
  handle(INVOKE_CHANNELS.getDraftLayoutDefaults, documentResult(async (_event, value = {}) => requireDraftingService().getLayoutDefaults(value)));
  handle(INVOKE_CHANNELS.listDraftDocuments, documentResult(async (_event, value = {}) => requireDraftingService().listDocuments(value)));
  handle(INVOKE_CHANNELS.getDraftDocument, documentResult(async (_event, value) => requireDraftingService().getDocument(value?.documentId)));
  handle(INVOKE_CHANNELS.createDraftDocument, documentResult(async (_event, value) => requireDraftingService().createDraft(value || {})));
  handle(INVOKE_CHANNELS.saveDraftDocument, documentResult(async (_event, value) => requireDraftingService().saveDraft(value || {})));
  handle(INVOKE_CHANNELS.saveDraftVersion, documentResult(async (_event, value) => requireDraftingService().saveVersion(value || {})));
  handle(INVOKE_CHANNELS.restoreDraftVersion, documentResult(async (_event, value) => requireDraftingService().restoreVersion(value || {})));
  handle(INVOKE_CHANNELS.finalizeDraftDocument, documentResult(async (_event, value) => requireDraftingService().finalize(value?.documentId)));
  handle(INVOKE_CHANNELS.reopenDraftDocument, documentResult(async (_event, value) => requireDraftingService().reopen(value?.documentId)));
  handle(INVOKE_CHANNELS.archiveDraftDocument, documentResult(async (_event, value) => requireDraftingService().archive(value?.documentId)));
  handle(INVOKE_CHANNELS.recommendDraftReferences, documentResult(async (_event, value) => requireDraftingService().recommend(value || {})));
  handle(INVOKE_CHANNELS.listDraftBusinessSources, documentResult(async (_event, value) => requireDraftingService().listBusinessSources(value || {})));
  handle(INVOKE_CHANNELS.generateDraftDocument, documentResult(async (_event, value) => requireDraftingService().generate(value || {})));
  handle(INVOKE_CHANNELS.converseDraftDocument, documentResult(async (_event, value) => requireDraftingService().converse(value || {})));
  handle(INVOKE_CHANNELS.createDraftFromHistory, documentResult(async (_event, value) => requireDraftingService().createFromHistory(value || {})));
  handle(INVOKE_CHANNELS.getWritingProfile, documentResult(async () => requireProfileService().get()));
  handle(INVOKE_CHANNELS.saveWritingProfile, documentResult(async (_event, value) => requireProfileService().save(value || {})));
  handle(INVOKE_CHANNELS.resetWritingProfile, documentResult(async () => requireProfileService().reset()));
  handle(INVOKE_CHANNELS.exportDraftDocument, documentResult(async (_event, value) => requireExportService().export(value || {})));
  handle(INVOKE_CHANNELS.printDraftDocument, documentResult(async (_event, value) => requireExportService().print(value || {})));
  handle(INVOKE_CHANNELS.importWorkAttachments, async () => {
    if (!dialog) return { ok: false, error: '当前环境无法选择附件' };
    const selected = await dialog.showOpenDialog({
      title: '选择工作管理附件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '常用文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'mp4', 'mov'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (selected.canceled || !selected.filePaths.length) return { ok: true, data: [] };
    try {
      const attachmentDirectory = path.join(app.getPath('userData'), 'work-attachments');
      await fs.promises.mkdir(attachmentDirectory, { recursive: true });
      const attachments = await Promise.all(selected.filePaths.map(async (sourcePath) => {
        const sourceName = path.basename(sourcePath);
        const extension = path.extname(sourceName).toLowerCase();
        const targetName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;
        const targetPath = path.join(attachmentDirectory, targetName);
        const stats = await fs.promises.stat(sourcePath);
        await fs.promises.copyFile(sourcePath, targetPath);
        return {
          id: targetName,
          name: sourceName,
          path: targetPath,
          size: stats.size,
          extension,
          uploadedAt: new Date().toISOString(),
        };
      }));
      return { ok: true, data: attachments };
    } catch (error) {
      return { ok: false, error: error?.message || '附件保存失败' };
    }
  });

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
    const modelsDirectory = modelCatalog
      ? await modelCatalog.ensureDirectory()
      : path.join(app.getPath('userData'), 'models');
    fs.mkdirSync(modelsDirectory, { recursive: true });
    const error = await shell.openPath(modelsDirectory);
    return error ? { ok: false, error } : { ok: true };
  });

  return handlerNames;
}

module.exports = { registerCompatibilityHandlers };
