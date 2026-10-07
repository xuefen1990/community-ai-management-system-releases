'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const XLSX = require('xlsx');

const { INVOKE_CHANNELS } = require('../shared/ipc-contract');
const { normalizePrinters, printDisbursementPages } = require('./disbursement-print-service');
const { parseDisbursementRosterExcelGrid } = require('../shared/personnel-excel-parser');
const { JsonDatabaseStore } = require('./database-store');
const { ContractFeeFileService } = require('./contract-fee-file-service');
const { registerFoundationHandlers } = require('./foundation-ipc-handlers');
const { assertLocalDataPath } = require('./local-file-boundary');
const { scanLanHosts } = require('./lan-discovery');
const { assertInternalStorage } = require('./local-storage-target');

function registerCompatibilityHandlers({
  app,
  BrowserWindow,
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
  aiAssistantService,
  aiFileTaskService,
  aiStorageService,
  aiAnomalyService,
  documentDraftingService,
  writingProfileService,
  documentExportService,
  certificateDocumentService,
  updateService,
  contractFeeFileService,
  localBackendManager,
  lanWorkspaceService,
}) {
  const store = databaseStore || new JsonDatabaseStore({ userDataPath: app.getPath('userData') });
  const handlerNames = new Set();
  const contractFeeFiles = contractFeeFileService || new ContractFeeFileService({ userDataPath: app.getPath('userData'), dialog, store });

  function handle(channel, callback) {
    ipcMain.handle(channel, callback);
    handlerNames.add(channel);
  }

  async function requireAiAccess() {
    if (!authService?.request) return;
    if (!authService.session) throw new Error("请先登录村居账号");
    const { user } = await authService.request('/auth/profile');
    authService.session.user = user;
    if (user.role === 'member' && user.aiAccessEnabled === false) throw new Error('单位管理员未授权当前账号使用 AI');
  }

  async function requireModuleAction(moduleId, action) {
    if (!authService?.request) return;
    if (!authService.session) throw new Error("请先登录村居账号");
    const { account: user, entitlement } = await authService.getStatus();
    if (!['trial', 'licensed'].includes(entitlement?.type)) throw new Error('账号授权已到期');
    if (user.mustChangePassword) throw new Error('首次登录请先修改初始密码');
    if (user.role !== 'member') return;
    const allowed = user.permissions?.[moduleId] || [];
    if (!allowed.includes('view') || !allowed.includes(action)) throw new Error('当前账号没有执行此操作的权限');
  }

  async function requireUnitAdmin() {
    if (!authService?.request) return;
    if (!authService.session) throw new Error("请先登录村居账号");
    const { account: user, entitlement } = await authService.getStatus();
    if (!['trial', 'licensed'].includes(entitlement?.type)) throw new Error('账号授权已到期');
    if (user.role === 'member' || user.mustChangePassword) throw new Error('仅单位管理员可备份或恢复完整工作区');
  }

  async function requireSignedIn() {
    if (!authService?.request) return;
    if (!authService.session) throw new Error("请先登录村居账号");
    const { account: user, entitlement } = await authService.getStatus();
    if (!['trial', 'licensed'].includes(entitlement?.type)) throw new Error('账号授权已到期');
    if (user.mustChangePassword) throw new Error('首次登录请先修改初始密码');
  }

  registerFoundationHandlers({ handle, store, authService, localBackendManager, shell, app, dialog, aiRouter });

  function requestedFilePath(value) {
    if (typeof value === 'string') return value;
    return value?.filePath || value?.path || null;
  }

  function readExcelPreview(value) {
    const filePath = requestedFilePath(value);
    if (!filePath) throw new TypeError('未指定 Excel 文件');
    const extension = path.extname(filePath).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(extension)) throw new Error('请选择 .xlsx、.xls 或 .csv 表格文件');
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error('表格中没有可读取的工作表');
    const table = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: '', raw: false });
    return { ...parseDisbursementRosterExcelGrid(table), fileName: path.basename(filePath) };
  }

  handle(INVOKE_CHANNELS.readDb, async () => store.read());
  handle(INVOKE_CHANNELS.writeDb, async (_event, value) => {
    try {
      return await store.write(value);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle(INVOKE_CHANNELS.createDbBackup, async () => { await requireUnitAdmin(); return store.createBackup(); });
  handle(INVOKE_CHANNELS.listDbBackups, async () => store.listBackups());
  handle(INVOKE_CHANNELS.restoreDbBackup, async (_event, value) => { await requireUnitAdmin(); return store.restoreBackup(value); });
  handle(INVOKE_CHANNELS.getDbDir, async () => store.dataDirectory);
  handle(INVOKE_CHANNELS.selectAndMigrateDataDir, async () => {
    await requireUnitAdmin();
    if (!lanWorkspaceService?.active) throw new Error('请先打开当前主账号的本机工作区');
    const selected = await dialog.showOpenDialog({ title: '选择新的本机数据存储文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const parent = assertInternalStorage(selected.filePaths[0]);
    const confirmed = await dialog.showMessageBox({ type: 'warning', buttons: ['取消', '开始搬迁'], defaultId: 0, cancelId: 0,
      title: '搬迁当前主账号工作区', message: '将业务数据、附件和备份复制到新位置并逐文件核对。成功后应用会自动重启，原目录保留为静态快照。',
      detail: `目标文件夹：${parent}` });
    if (confirmed.response !== 1) return { canceled: true };
    await store.writeQueue;
    const result = await lanWorkspaceService.relocateActive(parent);
    setTimeout(() => { app.relaunch(); app.quit(); }, 400);
    return { ok: true, restarting: true, ...result };
  });
  handle(INVOKE_CHANNELS.getMachineId, async () => machineId);
  handle(INVOKE_CHANNELS.isDev, async () => !app.isPackaged);
  handle(INVOKE_CHANNELS.getVersion, async () => app.getVersion());
  handle(INVOKE_CHANNELS.getFilesMetadata, async (_event, value = []) => {
    const requestedPaths = Array.isArray(value) ? value : (value.paths || value.filePaths || []);
    return Promise.all(requestedPaths.filter((item) => typeof item === 'string').map(async (filePath) => {
      try {
        return await require('./foundation-document-service').fileMetadata(filePath);
      } catch {
        return null;
      }
    })).then((items) => items.filter(Boolean));
  });
  handle(INVOKE_CHANNELS.selectFilesAndFolders, async () => {
    if (!dialog) return [];
    const selected = await dialog.showOpenDialog({
      title: '选择文件或文件夹',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    return selected.canceled ? [] : selected.filePaths;
  });
  handle(INVOKE_CHANNELS.selectExcelFile, async () => {
    if (!dialog) return null;
    const selected = await dialog.showOpenDialog({
      title: '选择 Excel 表格',
      properties: ['openFile'],
      filters: [{ name: 'Excel 表格', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    return selected.canceled || !selected.filePaths[0] ? null : selected.filePaths[0];
  });
  handle(INVOKE_CHANNELS.readExcelColumns, async (_event, value) => {
    try {
      return readExcelPreview(value);
    } catch (error) {
      return { columns: [], rows: [], error: error.message };
    }
  });
  handle(INVOKE_CHANNELS.selectAndReadContractFeeExcel, async () => {
    try { return await contractFeeFiles.selectAndReadExcel(); } catch (error) { return { ok: false, error: error.message }; }
  });
  handle(INVOKE_CHANNELS.selectAndReadDisbursementExcel, async () => {
    try { return await contractFeeFiles.selectAndReadDisbursementExcel(); } catch (error) { return { ok: false, error: error.message }; }
  });
  handle(INVOKE_CHANNELS.exportTemplateDisbursementWorkbook, async (_event, value) => {
    try { await requireModuleAction('funds', 'export'); return await contractFeeFiles.exportTemplateDisbursementWorkbook(value || {}); } catch (error) { return { ok: false, error: error.message, file: null }; }
  });
  handle(INVOKE_CHANNELS.listDisbursementPrinters, async (event) => {
    await requireModuleAction('funds', 'export');
    return normalizePrinters(await event.sender.getPrintersAsync());
  });
  handle(INVOKE_CHANNELS.printDisbursementPages, async (event, value) => {
    await requireModuleAction('funds', 'export');
    if (!BrowserWindow) throw new Error('当前环境无法直接打印');
    return printDisbursementPages({ BrowserWindow, printers: await event.sender.getPrintersAsync(), value });
  });
  handle(INVOKE_CHANNELS.importContractFeeAttachments, async () => {
    try { await store.requireHostFileOperation?.(); return await contractFeeFiles.importAttachments(); } catch (error) { return { ok: false, error: error.message, data: [] }; }
  });
  handle(INVOKE_CHANNELS.exportContractFeeGroupFiles, async (_event, value) => {
    try { await requireModuleAction('finance', 'export'); return await contractFeeFiles.exportGroupedFiles(value || {}); } catch (error) { return { ok: false, error: error.message, files: [] }; }
  });
  handle(INVOKE_CHANNELS.exportContractFeeProjectWorkbook, async (_event, value) => {
    try { await requireModuleAction('finance', 'export'); return await contractFeeFiles.exportContractFeeProjectWorkbook(value || {}); } catch (error) { return { ok: false, error: error.message, file: null }; }
  });
  handle(INVOKE_CHANNELS.selectAndReadFarmlandSubsidyExcel, async () => {
    try { return await contractFeeFiles.selectAndReadFarmlandSubsidyExcel(); } catch (error) { return { ok: false, error: error.message }; }
  });
  handle(INVOKE_CHANNELS.exportFarmlandSubsidyWorkbook, async (_event, value) => {
    try { await requireModuleAction('funds', 'export'); return await contractFeeFiles.exportFarmlandSubsidyWorkbook(value || {}); } catch (error) { return { ok: false, error: error.message, file: null }; }
  });
  handle(INVOKE_CHANNELS.getLanShareInfo, async () => {
    const account = (await authService?.getStatus?.())?.account;
    const isLocalHost = ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(account?.role);
    if (isLocalHost && lanWorkspaceService && authService) {
      const { baseUrl } = await authService.getServerConfig();
      await lanWorkspaceService.prepareLocal({ ownerId: account.mainAccountId || account.id, cloudBaseUrl: baseUrl });
    }
    const connection = isLocalHost ? { baseUrl: '', ownerId: account.mainAccountId || account.id }
      : await authService?.getWorkspaceConnection?.() || { baseUrl: '' };
    let status = connection.baseUrl ? 'offline' : 'unconfigured';
    let reason = '';
    if (connection.baseUrl && !isLocalHost && authService?.session?.token) {
      try {
        await authService.checkLanWorkspace({ ip: new URL(connection.baseUrl).hostname });
        status = 'online';
      } catch (error) { reason = error.message || '无法连接主电脑'; }
    }
    return {
      ...(lanWorkspaceService?.info() || { enabled: false, url: null }),
      connection: { ...connection, status: isLocalHost ? 'local' : status, reason: isLocalHost ? '' : reason },
    };
  });
  handle(INVOKE_CHANNELS.updateLanShareConfig, async (_event, value = {}) => {
    if (!lanWorkspaceService || !authService) throw new Error('当前版本未启用电脑共享');
    if (value.action === 'scan') {
      if (!authService.session?.token) throw new Error('请先登录账号再扫描主电脑');
      const found = (await scanLanHosts()).filter(item => item.port === 3000).slice(0, 16);
      const results = await Promise.all(found.map(async item => {
        try { await authService.checkLanWorkspace({ ip: item.ip }); return { ...item, matched: true }; }
        catch (error) { return { ...item, matched: false, reason: error.message }; }
      }));
      return { hosts: results };
    }
    if (value.action === 'connect') return authService.connectLanWorkspace({ ip: value.ip });
    if (value.action === 'check') return authService.checkLanWorkspace({ ip: value.ip });
    if (!['enable', 'disable', 'migrate'].includes(value.action)) throw new Error('共享操作不正确');
    if (app.isPackaged === false && process.env.COMMUNITY_DEV_MODE !== '1') throw new Error('请通过独立开发环境启用共享');
    const { account: user, entitlement } = await authService.getStatus();
    if (!['trial', 'licensed'].includes(entitlement?.type)) throw new Error('账号授权已到期');
    if (!['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(user?.role) || user.mustChangePassword) throw new Error('只有主账号可以管理本电脑的业务数据');
    const { baseUrl } = await authService.getServerConfig();
    await lanWorkspaceService.prepareLocal({ ownerId: user.mainAccountId || user.id, cloudBaseUrl: baseUrl });
    if (value.action === 'disable') return lanWorkspaceService.disableSharing();
    if (value.action === 'enable') {
      const result = await lanWorkspaceService.enableSharing();
      if (app.isPackaged && process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
      return result;
    }
    const source = await authService.request('/unit/workspace/migration', { useWorkspace: false });
    const result = await lanWorkspaceService.initialize({ ownerId: user.mainAccountId || user.id,
      cloudBaseUrl: baseUrl, data: source.data, aiState: source.aiState, sourceVersion: source.version });
    await lanWorkspaceService.verifyMigration(source);
    const served = await authService.request('/unit/workspace/data');
    const local = await lanWorkspaceService.readWorkspace();
    if (!isDeepStrictEqual(served.data, local.data)) throw new Error('局域网读取核对失败，云端原件尚未清除');
    await authService.request('/unit/workspace/migration/complete', { method: 'POST', useWorkspace: false,
      body: { version: source.version, dataDigest: source.dataDigest, aiDigest: source.aiDigest } });
    return result;
  });
  handle(INVOKE_CHANNELS.scanLocalModels, async () => modelCatalog ? modelCatalog.scan() : []);
  handle(INVOKE_CHANNELS.getInternalAiServerStatus, async () => localAiRuntime
    ? localAiRuntime.getStatus()
    : ({ running: false }));
  if (authService) {
    const ensureAccountService = async () => localBackendManager?.ensureReady(await authService.getServerConfig());
    handle(INVOKE_CHANNELS.registerLocalAccount, async (_event, value) => { await ensureAccountService(); return authService.register(value); });
    handle(INVOKE_CHANNELS.submitUnitAdminApplication, async (_event, value) => { await ensureAccountService(); return authService.submitUnitAdminApplication(value); });
    handle(INVOKE_CHANNELS.listUnitMemberApplications, async () => authService.listMemberApplications());
    handle(INVOKE_CHANNELS.reviewUnitMemberApplication, async (_event, value) => authService.reviewMemberApplication(value));
    handle(INVOKE_CHANNELS.listUnitMembers, async () => authService.listUnitMembers());
    handle(INVOKE_CHANNELS.getUnitPermissionCatalog, async () => authService.getUnitPermissionCatalog());
    handle(INVOKE_CHANNELS.createUnitMember, async (_event, value) => authService.createUnitMember(value));
    handle(INVOKE_CHANNELS.resetUnitMemberPassword, async (_event, value) => authService.resetUnitMemberPassword(value));
    handle(INVOKE_CHANNELS.updateUnitMemberPermissions, async (_event, value) => authService.updateMemberPermissions(value));
    handle(INVOKE_CHANNELS.updateUnitMemberStatus, async (_event, value) => authService.updateMemberStatus(value));
    handle(INVOKE_CHANNELS.importLocalDataToUnit, async () => store.importLocalDataToUnit());
    handle(INVOKE_CHANNELS.loginLocalAccount, async (_event, value) => {
      await ensureAccountService();
      const result = await authService.login(value);
      await store.resetForAccountChange?.();
      if (!result.account?.mustChangePassword) await aiAnomalyService?.scan().catch(() => {});
      return result;
    });
    handle(INVOKE_CHANNELS.changeLocalAccountPassword, async (_event, value) => authService.changePassword(value));
    handle(INVOKE_CHANNELS.logoutLocalAccount, async () => { await store.resetForAccountChange?.(); return authService.logout(); });
    handle(INVOKE_CHANNELS.getLocalAuthStatus, async () => authService.getStatus());
    handle(INVOKE_CHANNELS.getAccountPreferences, async () => authService.request('/auth/preferences'));
    handle(INVOKE_CHANNELS.saveAccountPreferences, async (_event, value) => authService.request('/auth/preferences', { method: 'PUT', body: value || {} }));
    handle(INVOKE_CHANNELS.getStartupEntitlement, async () => authService.getStartupEntitlement());
    handle(INVOKE_CHANNELS.getLoginPrefill, async () => authService.getLoginPrefill());
    handle(INVOKE_CHANNELS.clearLoginPrefill, async () => authService.clearLoginPrefill());
    handle(INVOKE_CHANNELS.activateOfflineLicense, async (_event, code) => authService.activate(code));
    handle(INVOKE_CHANNELS.listLocalAccountEntitlements, async () => authService.listAccountEntitlements());
    handle(INVOKE_CHANNELS.setLocalAccountEntitlement, async (_event, value) => authService.setAccountEntitlement(value));
    handle(INVOKE_CHANNELS.getRemoteServerConfig, async () => authService.getServerConfig());
    handle(INVOKE_CHANNELS.setRemoteServerConfig, async (_event, value) => {
      const config = await authService.setServerConfig(value || {});
      await localBackendManager?.ensureReady(config);
      return config;
    });
    handle(INVOKE_CHANNELS.checkRemoteServerConnection, async (_event, value) => authService.checkServerConnection(value || {}));
    handle(INVOKE_CHANNELS.getLocalBackendStatus, async () => localBackendManager?.getStatus() || ({ state: 'external', managed: false, message: '账号服务由外部配置管理' }));
    handle(INVOKE_CHANNELS.retryLocalBackend, async () => localBackendManager?.retry(await authService.getServerConfig()) || ({ state: 'external', managed: false }));
    handle(INVOKE_CHANNELS.getAiQuota, async () => authService.request('/ai/quota'));
    handle(INVOKE_CHANNELS.getAiUsageDetail, async (_event, value = {}) => {
      const params = new URLSearchParams();
      for (const [key, item] of Object.entries(value || {})) {
        if (item !== undefined && item !== null && String(item) !== '') params.set(key, String(item));
      }
      return authService.request(`/ai/usage/detail${params.toString() ? `?${params.toString()}` : ''}`);
    });
    handle(INVOKE_CHANNELS.getAiQuotaLedger, async (_event, value = {}) => {
      const params = new URLSearchParams();
      for (const [key, item] of Object.entries(value || {})) {
        if (item !== undefined && item !== null && String(item) !== '') params.set(key, String(item));
      }
      return authService.request(`/ai/quota/ledger${params.toString() ? `?${params.toString()}` : ''}`);
    });
    handle(INVOKE_CHANNELS.getAiModels, async () => authService.request('/ai/models'));
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
  if (aiSettingsStore) {
    handle(INVOKE_CHANNELS.getAiSettings, async () => aiSettingsStore.getPublicSettings());
    handle(INVOKE_CHANNELS.saveAiSettings, async (_event, value) => aiSettingsStore.save(value));
  }
  if (localAiRuntime) {
    handle(INVOKE_CHANNELS.toggleInternalAiServer, async (_event, value) => localAiRuntime.toggle(value));
  }
  if (aiRouter) {
    handle(INVOKE_CHANNELS.chatWithAi, async (_event, value) => aiRouter.chat(value));
    handle(INVOKE_CHANNELS.estimateAiUsage, async (_event, value) => aiRouter.estimate(value || {}));
    handle(INVOKE_CHANNELS.testOnlineAi, async () => aiRouter.onlineChat([{ role: 'user', content: '请只回复：连接成功' }]));
  }
  if (aiAssistantService) {
    handle(INVOKE_CHANNELS.converseWithAiAssistant, async (_event, value) => { await requireAiAccess(); return aiRouter?.withBillingTask ? aiRouter.withBillingTask({messages:value?.messages||[],maxTokens:1200,taskTier:require('./ai-model-routing').classifyAiTask({messages:value?.messages||[]}),taskKind:'assistant-operation'},()=>aiAssistantService.converse(value)) : aiAssistantService.converse(value); });
    handle(INVOKE_CHANNELS.listAiAssistantOperations, async (_event, value) => aiAssistantService.listOperations(value));
    handle(INVOKE_CHANNELS.undoAiAssistantOperation, async (_event, value) => aiAssistantService.undoOperation(value));
    handle(INVOKE_CHANNELS.getAiAssistantConversation, async (_event, value) => aiAssistantService.getConversation(value || {}));
    handle(INVOKE_CHANNELS.saveAiAssistantConversation, async (_event, value) => aiAssistantService.saveConversation(value || {}));
    handle(INVOKE_CHANNELS.listAiAssistantMemories, async () => aiAssistantService.listMemories());
    handle(INVOKE_CHANNELS.deleteAiAssistantMemory, async (_event, value) => aiAssistantService.deleteMemory(value || {}));
    handle(INVOKE_CHANNELS.draftCertificateWithAi, async (_event, value) => { await requireAiAccess(); return aiAssistantService.draftCertificateWithAi(value || {}); });
  }
  if (aiFileTaskService) {
  handle(INVOKE_CHANNELS.selectAiAssistantFiles, async (_event, value) => { await requireAiAccess(); await store.requireHostFileOperation?.(); return aiFileTaskService.selectAndAnalyze(value || {}); });
  handle(INVOKE_CHANNELS.listAiAssistantFiles, async (_event, value) => aiFileTaskService.list(value || {}));
  handle(INVOKE_CHANNELS.previewAiFileImport, async (_event, value) => aiFileTaskService.previewImport(value || {}));
  handle(INVOKE_CHANNELS.confirmAiFileImport, async (_event, value) => aiFileTaskService.confirmImport(value || {}));
  handle(INVOKE_CHANNELS.prepareAiBusinessFile, async (_event, value) => aiFileTaskService.prepareBusinessImport(value || {}));
  handle(INVOKE_CHANNELS.reviewAiFileOcr, async (_event, value) => aiFileTaskService.reviewOcr(value || {}));
  handle(INVOKE_CHANNELS.confirmAiFileOcrReview, async (_event, value) => aiFileTaskService.confirmOcrReview(value || {}));
  handle(INVOKE_CHANNELS.prepareAiDocumentHandoff, async (_event, value) => aiFileTaskService.prepareDocumentHandoff(value || {}));
  handle(INVOKE_CHANNELS.applyAiFileCategory, async (_event, value) => aiFileTaskService.applyCategoryDecision(value || {}));
  handle(INVOKE_CHANNELS.undoAiFileCategory, async (_event, value) => aiFileTaskService.undoCategoryDecision(value || {}));
  handle(INVOKE_CHANNELS.previewAiCertificateTemplate, async (_event, value) => aiFileTaskService.previewCertificateTemplate(value || {}));
  handle(INVOKE_CHANNELS.applyAiCertificateTemplate, async (_event, value) => aiFileTaskService.applyCertificateTemplateDecision(value || {}));
  handle(INVOKE_CHANNELS.describeAiImage, async (_event, value) => { await requireAiAccess(); return aiFileTaskService.describeImage(value || {}); });
  }
  if (aiStorageService) {
    handle(INVOKE_CHANNELS.getAiStorageOverview, async () => aiStorageService.getOverview());
    handle(INVOKE_CHANNELS.cleanAiTemporaryCache, async () => aiStorageService.cleanTemporaryCache());
    handle(INVOKE_CHANNELS.rebuildAiFileIndex, async () => aiStorageService.rebuildIndex());
  }
  if (aiAnomalyService) {
    handle(INVOKE_CHANNELS.scanAiAnomalies, async () => aiAnomalyService.scan());
    handle(INVOKE_CHANNELS.listAiAnomalyFindings, async (_event, value) => aiAnomalyService.list(value || {}));
    handle(INVOKE_CHANNELS.updateAiAnomalyFinding, async (_event, value) => aiAnomalyService.update(value || {}));
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
  handle(INVOKE_CHANNELS.exportDraftDocument, documentResult(async (_event, value) => { await requireModuleAction('document', 'export'); return requireExportService().export(value || {}); }));
  handle(INVOKE_CHANNELS.printDraftDocument, documentResult(async (_event, value) => { await requireModuleAction('document', 'export'); return requireExportService().print(value || {}); }));
  const requireCertificateDocuments = () => {
    if (!certificateDocumentService) throw new Error('证明输出服务尚未配置');
    return certificateDocumentService;
  };
  handle(INVOKE_CHANNELS.selectCertificateWordTemplate, documentResult(async (_event, value = {}) => { await store.requireHostFileOperation?.(); return requireCertificateDocuments().selectAndArchiveWordTemplate(value.templateId); }));
  handle(INVOKE_CHANNELS.inspectCertificateWordTemplate, documentResult(async (_event, value = {}) => requireCertificateDocuments().inspect(value)));
  handle(INVOKE_CHANNELS.exportCertificateDocument, documentResult(async (_event, value = {}) => { await requireModuleAction('certificate', 'export'); return requireCertificateDocuments().export(value); }));
  handle(INVOKE_CHANNELS.printCertificateDocument, documentResult(async (_event, value = {}) => { await requireModuleAction('certificate', 'export'); return requireCertificateDocuments().print(value); }));
  handle(INVOKE_CHANNELS.importWorkAttachments, async () => {
    try { await store.requireHostFileOperation?.(); } catch (error) { return { ok: false, error: error.message, data: [] }; }
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
    try {
      await requireSignedIn();
      const filePath = await assertLocalDataPath(store.dataDirectory, requestedPath);
      const error = await shell.openPath(filePath);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
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
