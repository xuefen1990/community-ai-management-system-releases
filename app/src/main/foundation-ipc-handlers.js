'use strict';
const { FOUNDATION_CHANNELS, INVOKE_CHANNELS } = require('../shared/ipc-contract');
const { FoundationAuthService } = require('./foundation-auth-service');
const { FoundationBusinessService } = require('./foundation-business-service');
const { FoundationDocumentService } = require('./foundation-document-service');
const { FoundationBackupService } = require('./foundation-backup-service');
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertLocalDataPath } = require('./local-file-boundary');
const { FinanceWorkbookService } = require('./finance-workbook-service');
const { domainRows } = require('./foundation-domains');

function registerFoundationHandlers({ handle, store, authService, localBackendManager, shell, app, dialog, aiRouter }) {
  const auth = new FoundationAuthService({ authService,
    ensureReady: async () => localBackendManager?.ensureReady(await authService.getServerConfig()) });
  let business;
  const { FoundationWorkspaceService } = require('./foundation-workspace-service');
  const workspace = new FoundationWorkspaceService({ store, auth });
  const { FoundationMobileUpload } = require('./foundation-mobile-upload');
  const uploads = new FoundationMobileUpload({ store, auth });
  app?.on?.('before-quit', () => uploads.close());
  handle(INVOKE_CHANNELS.getMobileUploadInfo, async event => {
    try { return await uploads.info(item => { if (event.sender.isDestroyed()) throw new Error('电脑页面已关闭，请重新上传'); event.sender.send('mobile-file-uploaded', item); }); }
    catch (error) { return { running: false, error: error.message }; }
  });
  handle(FOUNDATION_CHANNELS.readFoundationWorkspace, () => workspace.read());
  handle(FOUNDATION_CHANNELS.writeFoundationWorkspace, (_event, value) => workspace.write(value));
  handle(FOUNDATION_CHANNELS.readFoundationExcelColumns, async (_event, value) => {
    await auth.authorize({ method: 'GET', path: '/import-preview' });
    return require('./foundation-excel-reader').readFoundationExcel(value);
  });
  let documents;
  let backups;
  const backup = () => backups ||= new FoundationBackupService({ store, authorize: request => auth.authorize(request) });
  handle(FOUNDATION_CHANNELS.createV3DbBackup, () => backup().create());
  handle(FOUNDATION_CHANNELS.createV3Backup, () => backup().create());
  handle(FOUNDATION_CHANNELS.listV3AutoBackups, () => backup().list());
  handle(FOUNDATION_CHANNELS.restoreV3DbBackup, async (_event, value) => { workspace.invalidate(); const result = await backup().restore(value); workspace.invalidate(); return result; });
  handle(FOUNDATION_CHANNELS.createV3ImportSnapshot, async (_event, value) => {
    if (value?.domain === 'finance' && await store.isRemoteChild?.()) {
      await auth.authorize({ method: 'POST', path: '/import-backup', domain: 'finance' });
      return { success: true, warning: '主机将在导入时以事务方式保存记录' };
    }
    const result = await backup().create({ source: 'import', importJobId: typeof value === 'string' ? value : value?.id, importDomain: value?.domain });
    // A member may trigger an internal pre-import backup without gaining access
    // to other modules' backup contents, paths, listing or full restoration.
    return { success: result.success, filesCount: result.filesCount, warning: result.warning };
  });
  handle(FOUNDATION_CHANNELS.restoreV3ImportSnapshot, async (_event, id) => { workspace.invalidate(); const result = await backup().restoreImport(id); workspace.invalidate(); return result; });
  handle(FOUNDATION_CHANNELS.documentFileOperation, (_event, value) => {
    documents ||= new FoundationDocumentService({ store, shell, authorize: request => auth.authorize(request) });
    return documents.request(value);
  });
  handle(FOUNDATION_CHANNELS.openLocalFile, async (_event, value) => {
    await auth.authorize({ method: 'GET', path: '/documents' });
    await store.requireHostFileOperation?.();
    const filePath = await assertLocalDataPath(store.dataDirectory, value);
    const error = await shell.openPath(filePath); if (error) throw new Error(error);
    return { success: true };
  });
  handle(FOUNDATION_CHANNELS.readLocalFilePreview, async (_event, value) => {
    await auth.authorize({ method: 'GET', path: '/documents' });
    if (await store.isRemoteChild?.()) {
      const document = (await store.read()).documents?.find(item => [item.file_path, item.fileObjectRelativePath, item.path].includes(value));
      if (!document) throw new Error('主电脑未找到对应档案');
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
      const type = types[path.extname(value).toLowerCase()];
      if (!type) throw new Error('此文件类型请在主电脑打开');
      const response = await store.fetchArchivedFile(document.id);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 32 * 1024 * 1024) throw new Error('预览文件超过 32 MB，请在主电脑打开');
      return { success: true, dataUrl: `data:${type};base64,${bytes.toString('base64')}` };
    }
    const filePath = await assertLocalDataPath(store.dataDirectory, value);
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
    const type = types[path.extname(filePath).toLowerCase()];
    if (!type) throw new Error('此文件类型请使用本机应用打开');
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('预览文件超过 32 MB，请使用本机应用打开');
    return { success: true, dataUrl: `data:${type};base64,${(await fs.readFile(filePath)).toString('base64')}` };
  });
  const response = callback => async (_event, value) => {
    try { return { ok: true, data: await callback(value) }; }
    catch (error) { return { ok: false, error: { code: error.code || 'AUTH_ERROR', message: error.message } }; }
  };
  handle(FOUNDATION_CHANNELS.bootstrapProductAuth, response(() => auth.bootstrap()));
  handle(FOUNDATION_CHANNELS.refreshProductAuth, response(() => auth.refresh()));
  handle(FOUNDATION_CHANNELS.loginProductAuth, response(async value => {
    const result = await auth.login(value);
    await store.resetForAccountChange?.();
    const account = (await authService.getStatus()).account;
    if (app?.isPackaged && process.platform === 'darwin' && ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(account?.role)) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    }
    return result;
  }));
  handle(FOUNDATION_CHANNELS.logoutProductAuth, response(async () => { uploads.close(); workspace.invalidate(); await store.resetForAccountChange?.(); return auth.logout(); }));
  handle(FOUNDATION_CHANNELS.continueProductTrial, response(() => auth.continueTrial()));
  handle(FOUNDATION_CHANNELS.registerProductAuth, response(value => auth.register(value)));
  handle(FOUNDATION_CHANNELS.businessRequest, async (_event, value) => {
    if (/^\/api\/v3\/(party|duty)\//.test(value?.path || '') && await store.isRemoteChild?.()) {
      try { await auth.authorize({ method: String(value.method || 'GET').toUpperCase(), path: new URL(value.path, 'http://localhost').pathname.slice('/api/v3'.length) });
        return await store.requestPartyDutyBusiness(value);
      } catch (error) { return { ok: false, error: { code: error.code || 'BUSINESS_ERROR', message: error.message } }; }
    }
    if (!business) business = new FoundationBusinessService({ store, authorize: request => auth.authorize(request) });
    if (String(value?.method).toUpperCase() === 'POST' && /^\/api\/v3\/finance-imports(?:[/?]|$)/u.test(value.path)) {
      try { await auth.authorize({method:'POST',path:'/finance-imports'});
        const database = await store.read();
        const completed=(database.financeImportBatches || []).find(batch=>batch.id===value.body?.batchId);
        if(completed) return business.request(value);
        value={...value,body:require('./finance-import-integrity').prepareFinanceImport(financeWorkbook,value.body,domainRows(database,'/finance-records'),require('./finance-category-service').catalogOf(database))};
      } catch(error) { return {ok:false,error:{code:error.code || 'INVALID_IMPORT_PREVIEW',message:error.message}}; }
    }
    return business.request(value);
  });
  const financeWorkbook = dialog && new FinanceWorkbookService({ dialog });
  handle(FOUNDATION_CHANNELS.selectFinanceWorkbook, async () => {
    await auth.authorize({ method: 'POST', path: '/finance-imports' });
    return financeWorkbook.select(require('./finance-category-service').catalogOf(await store.read()));
  });
  handle(FOUNDATION_CHANNELS.remapFinanceSheet, async (_event, value) => {
    await auth.authorize({ method: 'POST', path: '/finance-imports' });
    return financeWorkbook.remap(value);
  });
  handle(FOUNDATION_CHANNELS.exportFinanceRecords, async (_event, value) => {
    await auth.authorize({ method: 'GET', path: '/finance-records' });
    const status = await auth.status();
    if (status.account?.role === 'member' && !status.account.permissions?.finance?.includes('export')) throw new Error('当前账号没有导出财务数据的权限');
    const database = await store.read();
    const all = require('./finance-transaction-balances').transactionBalances(domainRows(database, '/finance-records'), database.financeOpeningBalance).items;
    const ids = new Set(Array.isArray(value?.ids) ? value.ids.map(String) : []);
    return financeWorkbook.export(Array.isArray(value?.ids) ? all.filter(row => ids.has(String(row.id))) : all);
  });
  handle(FOUNDATION_CHANNELS.classifyFinanceRows, async (_event, value) => {
    await auth.authorize({ method: 'POST', path: '/finance-imports' });
    if (!aiRouter) throw new Error('AI 服务暂不可用');
    const rows = Array.isArray(value?.rows) ? value.rows.slice(0, 30) : [];
    if (!rows.length) return [];
    const { catalogOf, canonicalCategory, validCategory } = require('./finance-category-service');
    const categoryCatalog = catalogOf(await store.read());
    const samples = rows.map((row, index) => ({ index, summary: String(row.summary || '').slice(0, 160), sourceCategory: String(row.sourceCategory || '').slice(0, 80),
      sourceType: String(row.recordType || '').slice(0, 20) }));
    const response = await aiRouter.chat({ messages: [
      { role: 'system', content: `只返回 JSON 数组，每项 {index,recordType,category}。类型只能是 income/expense；收入科目：${categoryCatalog.income.join('、')}；支出科目：${categoryCatalog.expense.join('、')}。无法判断时不返回该项。依据明确用途建立简短具体科目，优先复用已有科目并合并同义名称，来源已有类型时保持原类型。` },
      { role: 'user', content: JSON.stringify(samples) },
    ], task: { taskKind: 'finance-import-classification', taskTier: 'basic', maxTokens: 1800 } });
    const match = String(response.content || '').match(/\[[\s\S]*\]/u);
    if (!match) throw new Error('AI 未返回可用的分类建议，请手动核对');
    let parsed;
    try { parsed = JSON.parse(match[0]); } catch { throw new Error('AI 分类建议格式不正确，请手动核对'); }
    return (Array.isArray(parsed) ? parsed : []).filter(item => Number.isInteger(item.index) && item.index >= 0 && item.index < rows.length
      && ['income', 'expense'].includes(item.recordType) && validCategory(item.category) && (!rows[item.index].recordType || rows[item.index].recordType === item.recordType)).map(item => ({ index: item.index, recordType: item.recordType, category: canonicalCategory(item.category, categoryCatalog, item.recordType) }));
  });
  handle(FOUNDATION_CHANNELS.classifyFinanceWorkbook, async (_event, value) => {
    await auth.authorize({ method: 'POST', path: '/finance-imports' });
    return require('./finance-ai-recognition').classifyFinanceWorkbook({ workbookService: financeWorkbook, aiRouter,
      categoryCatalog: require('./finance-category-service').catalogOf(await store.read()), previewId: value?.previewId, sheetNames: value?.sheetNames, force: value?.force === true });
  });
  handle(FOUNDATION_CHANNELS.recognizeFinanceWorkbook, async (_event, value) => {
    await auth.authorize({ method: 'POST', path: '/finance-imports' });
    if (!aiRouter) throw new Error('AI 服务暂不可用');
    return require('./finance-ai-recognition').recognizeFinanceWorkbook({ workbookService: financeWorkbook, aiRouter,
      categoryCatalog: require('./finance-category-service').catalogOf(await store.read()), previewId: value?.previewId, sheetNames: value?.sheetNames });
  });
  handle(FOUNDATION_CHANNELS.previewFinanceCategories, async (_event, value) => {
    await auth.authorize({ method: 'PATCH', path: '/finance-records' });
    return require('./finance-category-service').previewCategories(await store.read(), { startDate: value?.startDate, endDate: value?.endDate }, aiRouter);
  });
  handle(FOUNDATION_CHANNELS.generateFinanceNarrative, async (_event, value) => {
    await auth.authorize({ method: 'GET', path: '/finance-analysis' });
    if (!aiRouter) throw new Error('AI 服务暂不可用');
    const database = await store.read();
    return require('./finance-narrative-service').generateFinanceNarrative({ database,
      records: domainRows(database, '/finance-records'), value: value || {}, aiRouter });
  });
}
module.exports = { registerFoundationHandlers };
