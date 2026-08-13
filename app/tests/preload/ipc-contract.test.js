'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { INVOKE_CHANNELS, SEND_CHANNELS, EVENT_CHANNELS } = require('../../src/shared/ipc-contract');

test('compatibility contract retains all original preload API entries', () => {
  assert.equal(Object.keys(INVOKE_CHANNELS).length, 37);
  assert.equal(Object.keys(SEND_CHANNELS).length, 1);
  assert.equal(Object.keys(EVENT_CHANNELS).length, 3);
  assert.equal(INVOKE_CHANNELS.readDb, 'read-db');
  assert.equal(INVOKE_CHANNELS.writeDb, 'write-db');
  assert.equal(INVOKE_CHANNELS.scanLocalModels, 'scan-local-models');
  assert.equal(EVENT_CHANNELS.onMobileVoiceConfirmSave, 'mobile-voice-confirm-save');
});

test('IPC mappings are immutable', () => {
  assert.equal(Object.isFrozen(INVOKE_CHANNELS), true);
  assert.equal(Object.isFrozen(SEND_CHANNELS), true);
  assert.equal(Object.isFrozen(EVENT_CHANNELS), true);
});

