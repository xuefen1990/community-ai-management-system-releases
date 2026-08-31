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

test('registers the work attachment channel', () => {
  const { handlers } = makeHandlers();
  assert.equal(handlers.has(INVOKE_CHANNELS.importWorkAttachments), true);
});

test('registers the dedicated AI assistant conversation channel', async () => {
  const aiAssistantService = {
    converse: async (value) => ({ content: `已核对：${value.messages[0].content}` }),
    listOperations: async () => [{ id: 'operation-1' }],
    undoOperation: async () => ({ ok: true }),
  };
  const { callbacks, handlers } = makeHandlers({ aiAssistantService });
  assert.equal(handlers.has(INVOKE_CHANNELS.converseWithAiAssistant), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.listAiAssistantOperations), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.undoAiAssistantOperation), true);
  const result = await callbacks.get(INVOKE_CHANNELS.converseWithAiAssistant)({}, { messages: [{ role: 'user', content: '张三这年度发了多少钱' }] });
  assert.match(result.content, /张三/u);
});

test('contract fee file channels delegate to the dedicated service', async () => {
  const calls = [];
  const contractFeeFileService = {
    selectAndReadExcel: async () => { calls.push('read'); return { ok: true, data: { rows: [] } }; },
    importAttachments: async () => { calls.push('attachments'); return { ok: true, data: [] }; },
    exportGroupedFiles: async (value) => { calls.push(value); return { ok: true, files: [] }; },
    selectAndReadFarmlandSubsidyExcel: async () => { calls.push('subsidy-read'); return { ok: true, data: { records: [] } }; },
    exportFarmlandSubsidyWorkbook: async (value) => { calls.push(value); return { ok: true, file: {} }; },
  };
  const { callbacks } = makeHandlers({ contractFeeFileService });
  assert.equal((await callbacks.get(INVOKE_CHANNELS.selectAndReadContractFeeExcel)({})).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.importContractFeeAttachments)({})).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.exportContractFeeGroupFiles)({}, { groups: [] })).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.selectAndReadFarmlandSubsidyExcel)({})).ok, true);
  assert.equal((await callbacks.get(INVOKE_CHANNELS.exportFarmlandSubsidyWorkbook)({}, { ledger: {} })).ok, true);
  assert.deepEqual(calls, ['read', 'attachments', { groups: [] }, 'subsidy-read', { ledger: {} }]);
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
