'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx');

const { registerCompatibilityHandlers } = require('../../src/main/ipc-handlers');
const { INVOKE_CHANNELS } = require('../../src/shared/ipc-contract');

function makeHandlers(overrides = {}) {
  const callbacks = new Map();
  const handlers = registerCompatibilityHandlers({
    app: { getPath: () => '/tmp/community-ai-test', isPackaged: false, getVersion: () => '0.1.0' },
    ipcMain: { handle: (channel, callback) => callbacks.set(channel, callback) },
    shell: { openPath: async () => '' },
    databaseStore: { read: async () => ({}), write: async () => ({ ok: true }), dataDirectory: '/tmp/data' },
    ...overrides,
  });
  return { callbacks, handlers };
}

test('registers all dedicated document drafting channels', () => {
  const { handlers } = makeHandlers();
  for (const key of ['listDocumentTemplates', 'getDraftLayoutDefaults', 'createDraftDocument', 'listDraftBusinessSources', 'generateDraftDocument', 'converseDraftDocument', 'getWritingProfile', 'exportDraftDocument']) {
    assert.equal(handlers.has(INVOKE_CHANNELS[key]), true);
  }
});

test('direct disbursement printing uses the selected system printer without opening a visible window', async () => {
  const calls = [];
  class PrintWindow {
    constructor(options) { calls.push(['window', options]); this.webContents = { executeJavaScript: async () => {}, print: (options, done) => { calls.push(['print', options]); done(true); } }; }
    async loadURL() {}
    isDestroyed() { return false; }
    destroy() {}
  }
  const { callbacks } = makeHandlers({ BrowserWindow: PrintWindow });
  const event = { sender: { getPrintersAsync: async () => [{ name: 'printer-1', displayName: '办公室打印机', isDefault: true }] } };
  assert.equal((await callbacks.get(INVOKE_CHANNELS.listDisbursementPrinters)(event))[0].displayName, '办公室打印机');
  const result = await callbacks.get(INVOKE_CHANNELS.printDisbursementPages)(event, { printerName: 'printer-1', paper: 'A4', orientation: 'portrait', pageCount: 1, html: '<html><head></head><body><article class="wb-sheet">内容</article></body></html>' });
  assert.equal(result.ok, true);
  assert.equal(calls.find((call) => call[0] === 'window')[1].show, false);
  assert.equal(calls.find((call) => call[0] === 'print')[1].silent, true);
});

test('openPath requires a signed-in user and keeps paths inside application data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-open-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, 'data');
  await fs.mkdir(dataDirectory);
  const archive = path.join(dataDirectory, 'archive.txt');
  const outside = path.join(root, 'outside.txt');
  await fs.writeFile(archive, 'archive');
  await fs.writeFile(outside, 'outside');
  const opened = [];
  const authService = { session: null, request: async () => ({ user: { mustChangePassword: false } }),
    getStatus: async () => ({ authenticated: true, account: { mustChangePassword: false }, entitlement: { type: 'licensed' } }) };
  const { callbacks } = makeHandlers({ databaseStore: { dataDirectory }, authService, shell: { openPath: async file => { opened.push(file); return ''; } } });
  const open = callbacks.get(INVOKE_CHANNELS.openPath);
  assert.match((await open({}, archive)).error, /登录/u);
  authService.session = { user: {} };
  assert.match((await open({}, outside)).error, /应用数据目录/u);
  assert.match((await open({}, '../outside.txt')).error, /绝对路径/u);
  assert.deepEqual(await open({}, archive), { ok: true });
  assert.deepEqual(opened, [archive]);
});

test('registers the work attachment channel', () => {
  const { handlers } = makeHandlers();
  assert.equal(handlers.has(INVOKE_CHANNELS.importWorkAttachments), true);
});

test('registers AI file selection and listing channels', () => {
  const aiFileTaskService = { selectAndAnalyze: async () => ({ files: [] }), list: async () => [], previewImport: async () => ({}), confirmImport: async () => ({}), prepareBusinessImport: async () => ({}) };
  const { handlers } = makeHandlers({ aiFileTaskService });
  assert.equal(handlers.has(INVOKE_CHANNELS.selectAiAssistantFiles), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.listAiAssistantFiles), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.previewAiFileImport), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.confirmAiFileImport), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.prepareAiBusinessFile), true);
});

test('registers AI storage overview, cleanup and rebuild channels', async () => {
  const aiStorageService = {
    getOverview: async () => ({ categories: {} }),
    cleanTemporaryCache: async () => ({ ok: true, removedCount: 2 }),
    rebuildIndex: async () => ({ ok: true, rebuiltCount: 3 }),
  };
  const { callbacks, handlers } = makeHandlers({ aiStorageService });
  for (const key of ['getAiStorageOverview', 'cleanAiTemporaryCache', 'rebuildAiFileIndex']) {
    assert.equal(handlers.has(INVOKE_CHANNELS[key]), true);
  }
  assert.deepEqual(await callbacks.get(INVOKE_CHANNELS.getAiStorageOverview)({}), { categories: {} });
  assert.equal((await callbacks.get(INVOKE_CHANNELS.cleanAiTemporaryCache)({})).removedCount, 2);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.rebuildAiFileIndex)({})).rebuiltCount, 3);
});

test('registers AI anomaly scan, list and status channels', async () => {
  const aiAnomalyService = { scan: async () => ({ ok: true }), list: async () => ({ findings: [] }), update: async value => ({ finding: value }) };
  const { callbacks, handlers } = makeHandlers({ aiAnomalyService });
  for (const key of ['scanAiAnomalies', 'listAiAnomalyFindings', 'updateAiAnomalyFinding']) assert.equal(handlers.has(INVOKE_CHANNELS[key]), true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.scanAiAnomalies)({})).ok, true);
  assert.deepEqual((await callbacks.get(INVOKE_CHANNELS.listAiAnomalyFindings)({}, {})).findings, []);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.updateAiAnomalyFinding)({}, { id: 'a1', status: 'resolved' })).finding.status, 'resolved');
});

test('registers the dedicated AI assistant conversation channel', async () => {
  const aiAssistantService = {
    converse: async (value) => ({ content: `已核对：${value.messages[0].content}` }),
    listOperations: async () => [{ id: 'operation-1' }],
    undoOperation: async () => ({ ok: true }),
    getConversation: async () => ({ conversation: { id: 'conversation-1', messages: [] } }),
    saveConversation: async (value) => ({ conversation: value }),
    listMemories: async () => ({ memories: [{ id: 'memory-1' }] }),
    deleteMemory: async () => ({ success: true }),
    draftCertificateWithAi: async (value) => ({ reply: value.messages[0].content, content: '证明正文' }),
  };
  const { callbacks, handlers } = makeHandlers({ aiAssistantService });
  assert.equal(handlers.has(INVOKE_CHANNELS.converseWithAiAssistant), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.listAiAssistantOperations), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.undoAiAssistantOperation), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.getAiAssistantConversation), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.saveAiAssistantConversation), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.listAiAssistantMemories), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.deleteAiAssistantMemory), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.draftCertificateWithAi), true);
  const result = await callbacks.get(INVOKE_CHANNELS.converseWithAiAssistant)({}, { messages: [{ role: 'user', content: '张三这年度发了多少钱' }] });
  assert.match(result.content, /张三/u);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.getAiAssistantConversation)({}, {})).conversation.id, 'conversation-1');
  assert.equal((await callbacks.get(INVOKE_CHANNELS.listAiAssistantMemories)({})).memories.length, 1);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.draftCertificateWithAi)({}, { messages: [{ role: 'user', content: '起草证明' }] })).content, '证明正文');
});

test('contract fee file channels delegate to the dedicated service', async () => {
  const calls = [];
  const contractFeeFileService = {
    selectAndReadExcel: async () => { calls.push('read'); return { ok: true, data: { rows: [] } }; },
    importAttachments: async () => { calls.push('attachments'); return { ok: true, data: [] }; },
    exportGroupedFiles: async (value) => { calls.push(value); return { ok: true, files: [] }; },
    exportContractFeeProjectWorkbook: async (value) => { calls.push(value); return { ok: true, file: {} }; },
    selectAndReadFarmlandSubsidyExcel: async () => { calls.push('subsidy-read'); return { ok: true, data: { records: [] } }; },
    exportFarmlandSubsidyWorkbook: async (value) => { calls.push(value); return { ok: true, file: {} }; },
  };
  const { callbacks } = makeHandlers({ contractFeeFileService });
  assert.equal((await callbacks.get(INVOKE_CHANNELS.selectAndReadContractFeeExcel)({})).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.importContractFeeAttachments)({})).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.exportContractFeeGroupFiles)({}, { groups: [] })).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.exportContractFeeProjectWorkbook)({}, { batch: { id: 'project-batch' } })).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.selectAndReadFarmlandSubsidyExcel)({})).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.exportFarmlandSubsidyWorkbook)({}, { ledger: {} })).ok, true);
  assert.deepEqual(calls, ['read', 'attachments', { groups: [] }, { batch: { id: 'project-batch' } }, 'subsidy-read', { ledger: {} }]);
});

test('member exports require the matching module export permission', async () => {
  const calls = [];
  const member = { role: 'member', permissions: { finance: ['view'], funds: ['view', 'export'], document: ['view'] } };
  const authService = { session: { user: member }, request: async () => ({ user: member }), getStatus: async () => ({ authenticated: true, account: member, entitlement: { type: 'licensed' } }) };
  const contractFeeFileService = {
    exportGroupedFiles: async () => { calls.push('finance'); return { ok: true }; },
    exportFarmlandSubsidyWorkbook: async () => { calls.push('funds'); return { ok: true }; },
  };
  const documentExportService = { print: async () => { calls.push('document'); return {}; } };
  const { callbacks } = makeHandlers({ authService, contractFeeFileService, documentExportService });
  assert.match((await callbacks.get(INVOKE_CHANNELS.exportContractFeeGroupFiles)({}, {})).error, /没有执行此操作的权限/u);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.exportFarmlandSubsidyWorkbook)({}, {})).ok, true);
  assert.match((await callbacks.get(INVOKE_CHANNELS.printDraftDocument)({}, {})).error, /没有执行此操作的权限/u);
  assert.deepEqual(calls, ['funds']);
});

test('signed-out desktop process cannot export unit records', async () => {
  const authService = { session: null, request: async () => { throw new Error('不应请求资料'); }, getStatus: async () => ({ authenticated: false }) };
  const contractFeeFileService = { exportGroupedFiles: async () => { throw new Error('不应生成文件'); } };
  const { callbacks } = makeHandlers({ authService, contractFeeFileService });
  assert.match((await callbacks.get(INVOKE_CHANNELS.exportContractFeeGroupFiles)({}, {})).error, /请先登录/u);
});

test('Excel selection and preview handlers return a selected local sheet', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['姓名', '身份证号', '手机号'],
    ['张三', '11010519491231002X', '13800000000'],
  ]), '人员');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-excel-'));
  const filePath = path.join(directory, '人员导入.xlsx');
  XLSX.writeFile(workbook, filePath);
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }) };
  const { callbacks } = makeHandlers({ dialog });

  assert.equal(await callbacks.get(INVOKE_CHANNELS.selectExcelFile)({}), filePath);
  const preview = await callbacks.get(INVOKE_CHANNELS.readExcelColumns)({}, filePath);
  assert.deepEqual(preview.columns, ['姓名', '身份证号', '手机号']);
  assert.deepEqual(preview.rows, [{ 姓名: '张三', 身份证号: '11010519491231002X', 手机号: '13800000000' }]);
  assert.equal(preview.total, 1);
  await fs.rm(directory, { recursive: true, force: true });
});

test('Excel preview skips title rows and invalid footer rows', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['青山村人员花名册'],
    ['姓名', '身份证号', '手机号'],
    ['张三', '11010519491231002X', '13800000000'],
    ['合计', '1 人'],
    ['填表人：王主任'],
  ]), '人员');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-excel-'));
  const filePath = path.join(directory, '人员导入.xlsx');
  XLSX.writeFile(workbook, filePath);
  const { callbacks } = makeHandlers();

  const preview = await callbacks.get(INVOKE_CHANNELS.readExcelColumns)({}, filePath);
  assert.equal(preview.headerRowNumber, 2);
  assert.equal(preview.ignoredRows, 2);
  assert.deepEqual(preview.rows, [{ 姓名: '张三', 身份证号: '11010519491231002X', 手机号: '13800000000' }]);
  await fs.rm(directory, { recursive: true, force: true });
});

test('Excel preview accepts a disbursement roster without identity-card numbers', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['第一季度公共服务人员报酬发放表'],
    ['序号', '姓 名', '负责区域', '账 号', '金额'],
    [1, '张三', '东二组庄台', '3213020321010000046471', 2100],
    ['合计', '', '', '', 2100],
  ]), '发放表');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-excel-'));
  const filePath = path.join(directory, '发放名单.xlsx');
  XLSX.writeFile(workbook, filePath);
  try {
    const { callbacks } = makeHandlers();
    const preview = await callbacks.get(INVOKE_CHANNELS.readExcelColumns)({}, filePath);
    assert.equal(preview.error, undefined);
    assert.equal(preview.headerRowNumber, 2);
    assert.equal(preview.total, 1);
    assert.equal(preview.rows[0]['姓 名'], '张三');
    assert.equal(preview.rows[0]['金额'], '2100');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('file selection handlers return an empty result after cancellation', async () => {
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  const { callbacks } = makeHandlers({ dialog });
  assert.equal(await callbacks.get(INVOKE_CHANNELS.selectExcelFile)({}), null);
  assert.deepEqual(await callbacks.get(INVOKE_CHANNELS.selectFilesAndFolders)({}), []);
});

test('registers local account entitlement management channels', () => {
  const authService = {
    register: async () => ({}), login: async () => ({}), logout: async () => ({}), getStatus: async () => ({}), getLoginPrefill: async () => ({}), clearLoginPrefill: async () => ({}), activate: async () => ({}),
    getStartupEntitlement: async () => ({}),
    listAccountEntitlements: async () => [], setAccountEntitlement: async () => [],
    getServerConfig: async () => ({}), setServerConfig: async () => ({}), checkServerConnection: async () => ({}),
  };
  const localBackendManager = { getStatus: () => ({ state: 'ready' }), ensureReady: async () => ({ state: 'ready' }), retry: async () => ({ state: 'ready' }) };
  const { handlers } = makeHandlers({ authService, localBackendManager });
  assert.equal(handlers.has(INVOKE_CHANNELS.listLocalAccountEntitlements), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.setLocalAccountEntitlement), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.getLoginPrefill), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.getStartupEntitlement), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.clearLoginPrefill), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.getRemoteServerConfig), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.setRemoteServerConfig), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.checkRemoteServerConnection), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.getLocalBackendStatus), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.retryLocalBackend), true);
});

test('login waits for the managed account service before requesting authentication', async () => {
  const calls = [];
  const authService = {
    getServerConfig: async () => ({ baseUrl: 'http://127.0.0.1:3000', configured: false }),
    login: async () => { calls.push('login'); return { authenticated: true }; },
  };
  const localBackendManager = { ensureReady: async () => { calls.push('backend'); return { state: 'ready' }; }, getStatus: () => ({ state: 'idle' }), retry: async () => ({ state: 'ready' }) };
  const { callbacks } = makeHandlers({ authService, localBackendManager });
  const result = await callbacks.get(INVOKE_CHANNELS.loginLocalAccount)({}, { phone: '18888190901', password: 'secret88' });
  assert.equal(result.authenticated, true);
  assert.deepEqual(calls, ['backend', 'login']);
});

test('registers application update channels', () => {
  const updateService = { check: async () => ({}), download: async () => ({}), install: async () => ({}) };
  const { handlers } = makeHandlers({ updateService });
  assert.equal(handlers.has(INVOKE_CHANNELS.checkForAppUpdate), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.downloadAppUpdate), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.installAppUpdate), true);
});

test('direct drafting channel delegates to the compatible drafting service entry point', async () => {
  const received = [];
  const documentDraftingService = {
    converse: async (value) => { received.push(value); return { action: 'generated', version: { id: 'v1' } }; },
  };
  const { callbacks } = makeHandlers({ documentDraftingService });
  const result = await callbacks.get(INVOKE_CHANNELS.converseDraftDocument)({}, { message: '帮我写合同' });
  assert.equal(result.ok, true);
  assert.equal(result.data.action, 'generated');
  assert.deepEqual(received, [{ message: '帮我写合同' }]);
});

test('document channels wrap service results and user-safe errors', async () => {
  const received = [];
  const documentDraftingService = {
    createDraft: async (value) => { received.push(value); return { id: 'd1' }; },
  };
  const { callbacks } = makeHandlers({ documentDraftingService });
  const success = await callbacks.get(INVOKE_CHANNELS.createDraftDocument)({}, { title: '测试' });
  assert.deepEqual(success, { ok: true, data: { id: 'd1' } });
  assert.deepEqual(received, [{ title: '测试' }]);

  documentDraftingService.createDraft = async () => { throw new Error('必填字段缺失'); };
  const failure = await callbacks.get(INVOKE_CHANNELS.createDraftDocument)({}, {});
  assert.deepEqual(failure, { ok: false, error: '必填字段缺失' });
  assert.equal(Object.hasOwn(failure, 'stack'), false);
});
