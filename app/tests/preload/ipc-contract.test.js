'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { INVOKE_CHANNELS, SEND_CHANNELS, EVENT_CHANNELS } = require('../../src/shared/ipc-contract');

test('compatibility contract retains all original preload API entries', () => {
  assert.equal(Object.keys(INVOKE_CHANNELS).length, 66);
  assert.equal(Object.keys(SEND_CHANNELS).length, 1);
  assert.equal(Object.keys(EVENT_CHANNELS).length, 3);
  assert.equal(INVOKE_CHANNELS.readDb, 'read-db');
  assert.equal(INVOKE_CHANNELS.writeDb, 'write-db');
  assert.equal(INVOKE_CHANNELS.scanLocalModels, 'scan-local-models');
  assert.equal(INVOKE_CHANNELS.registerLocalAccount, 'register-local-account');
  assert.equal(INVOKE_CHANNELS.activateOfflineLicense, 'activate-offline-license');
  assert.equal(INVOKE_CHANNELS.importLocalModel, 'import-local-model');
  assert.equal(INVOKE_CHANNELS.testOnlineAi, 'test-online-ai');
  assert.equal(INVOKE_CHANNELS.chatWithAi, 'chat-with-ai');
  assert.equal(INVOKE_CHANNELS.createDraftDocument, 'create-draft-document');
  assert.equal(INVOKE_CHANNELS.generateDraftDocument, 'generate-draft-document');
  assert.equal(INVOKE_CHANNELS.reopenDraftDocument, 'reopen-draft-document');
  assert.equal(INVOKE_CHANNELS.listDraftBusinessSources, 'list-draft-business-sources');
  assert.equal(INVOKE_CHANNELS.getWritingProfile, 'get-writing-profile');
  assert.equal(INVOKE_CHANNELS.exportDraftDocument, 'export-draft-document');
  assert.equal(EVENT_CHANNELS.onMobileVoiceConfirmSave, 'mobile-voice-confirm-save');
});

test('IPC mappings are immutable', () => {
  assert.equal(Object.isFrozen(INVOKE_CHANNELS), true);
  assert.equal(Object.isFrozen(SEND_CHANNELS), true);
  assert.equal(Object.isFrozen(EVENT_CHANNELS), true);
});
