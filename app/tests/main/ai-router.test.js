'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AiRouter } = require('../../src/main/ai-router');

test('auto mode prefers a running local model', async () => {
  const router = new AiRouter({
    settingsStore: { readRaw: async () => ({ mode: 'auto' }) },
    localRuntime: { getStatus: () => ({ running: true }), chat: async () => ({ content: 'local' }) },
    onlineClient: { chat: async () => ({ content: 'online' }) },
  });
  assert.equal((await router.chat({ messages: [{ role: 'user', content: 'hi' }] })).content, 'local');
});

test('auto mode falls back to configured online AI when local is stopped', async () => {
  const router = new AiRouter({
    settingsStore: {
      readRaw: async () => ({ mode: 'auto' }),
      getOnlineCredentials: async () => ({ baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'm' }),
    },
    localRuntime: { getStatus: () => ({ running: false }) },
    onlineClient: { chat: async () => ({ content: 'online' }) },
  });
  const result = await router.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.content, 'online');
  assert.equal(result.provider, 'online');
});

test('explains how to re-enter an API key for this session when secure storage is unavailable', async () => {
  const router = new AiRouter({
    settingsStore: {
      readRaw: async () => ({ mode: 'online' }),
      getOnlineCredentials: async () => ({ apiKey: '', credentialStatus: 'secure-storage-unavailable' }),
    },
    localRuntime: { getStatus: () => ({ running: false }) },
    onlineClient: { chat: async () => ({ content: 'unexpected' }) },
  });

  await assert.rejects(() => router.chat({ messages: [{ role: 'user', content: 'hi' }] }), /只在本次打开软件期间有效/u);
});
