'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

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

test('registers local account entitlement management channels', () => {
  const authService = {
    register: async () => ({}), login: async () => ({}), logout: async () => ({}), getStatus: async () => ({}), getLoginPrefill: async () => ({}), clearLoginPrefill: async () => ({}), activate: async () => ({}),
    listAccountEntitlements: async () => [], setAccountEntitlement: async () => [],
  };
  const { handlers } = makeHandlers({ authService });
  assert.equal(handlers.has(INVOKE_CHANNELS.listLocalAccountEntitlements), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.setLocalAccountEntitlement), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.getLoginPrefill), true);
  assert.equal(handlers.has(INVOKE_CHANNELS.clearLoginPrefill), true);
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
