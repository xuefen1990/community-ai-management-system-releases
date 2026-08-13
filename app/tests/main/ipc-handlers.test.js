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
  for (const key of ['listDocumentTemplates', 'createDraftDocument', 'listDraftBusinessSources', 'generateDraftDocument', 'getWritingProfile', 'exportDraftDocument']) {
    assert.equal(handlers.has(INVOKE_CHANNELS[key]), true);
  }
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
