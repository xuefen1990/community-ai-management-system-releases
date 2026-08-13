'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AiSettingsStore } = require('../../src/main/ai-settings-store');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/u, ''),
  };
}

test('online API key is encrypted at rest and omitted from public settings', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: fakeSafeStorage() });
  const publicSettings = await store.save({
    mode: 'auto',
    localModelPath: '/models/qwen.gguf',
    online: { baseUrl: 'https://example.test/v1/', model: 'example-model', apiKey: 'secret-key' },
  });

  assert.equal(publicSettings.online.hasApiKey, true);
  assert.equal(publicSettings.online.apiKey, undefined);
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /secret-key/u);
  assert.equal((await store.getOnlineCredentials()).apiKey, 'secret-key');
});

test('remote online AI endpoints must use HTTPS', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: fakeSafeStorage() });
  await assert.rejects(() => store.save({
    mode: 'online',
    online: { baseUrl: 'http://remote.example/v1', model: 'm', apiKey: 'key' },
  }), /必须使用 HTTPS/u);
});
