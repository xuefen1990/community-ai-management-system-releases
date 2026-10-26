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

function unavailableSafeStorage() {
  return { isEncryptionAvailable: () => false };
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
  assert.equal(publicSettings.tokenReminderMode, 'high_cost_only');
  assert.equal(publicSettings.online.apiKey, undefined);
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /secret-key/u);
  assert.equal((await store.getOnlineCredentials()).apiKey, 'secret-key');
});

test('Token 提醒偏好可保存，非法值回到推荐模式', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: fakeSafeStorage() });
  assert.equal((await store.save({ mode: 'online', tokenReminderMode: 'insufficient_only', online: {} })).tokenReminderMode, 'insufficient_only');
  assert.equal((await store.save({ mode: 'online', tokenReminderMode: 'invalid', online: {} })).tokenReminderMode, 'insufficient_only');
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

test('keeps a re-entered online API key only in memory when macOS secure storage is unavailable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: unavailableSafeStorage() });

  const settings = await store.save({
    mode: 'online', localModelPath: '',
    online: { baseUrl: 'https://example.test/v1', model: 'example-model', apiKey: 'session-only-key' },
  });

  assert.equal(settings.online.keyStorage, 'session');
  assert.equal(settings.online.hasApiKey, true);
  assert.equal((await store.getOnlineCredentials()).apiKey, 'session-only-key');
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /session-only-key/u);
});

test('reports an unreadable saved key without throwing when macOS secure storage is unavailable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: unavailableSafeStorage() });
  await fs.mkdir(path.dirname(store.filePath), { recursive: true });
  await fs.writeFile(store.filePath, JSON.stringify({ online: { encryptedApiKey: 'unreadable-key' } }));

  assert.equal((await store.getPublicSettings()).online.keyStorage, 'unavailable');
  assert.deepEqual(await store.getOnlineCredentials(), {
    baseUrl: 'https://api.openai.com/v1', model: '', encryptedApiKey: 'unreadable-key', apiKey: '', credentialStatus: 'secure-storage-unavailable',
  });
});

test('saving after secure storage recovers replaces the session key and survives restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: unavailableSafeStorage() });
  await store.save({ mode: 'online', online: { apiKey: 'session-before-recovery' } });
  store.safeStorage = fakeSafeStorage();
  const saved = await store.save({ mode: 'online', online: { apiKey: 'new-secure-key' } });
  assert.equal(saved.online.keyStorage, 'secure');
  assert.equal((await store.getOnlineCredentials()).apiKey, 'new-secure-key');
  const restarted = new AiSettingsStore({ userDataPath: root, safeStorage: fakeSafeStorage() });
  assert.equal((await restarted.getOnlineCredentials()).apiKey, 'new-secure-key');
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /session-before-recovery|new-secure-key/);
});

test('failed persistence keeps the previously working session credential', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore({ userDataPath: root, safeStorage: unavailableSafeStorage() });
  await store.save({ mode: 'online', online: { apiKey: 'working-session-key' } });
  const before = await fs.readFile(store.filePath, 'utf8');
  await fs.mkdir(`${store.filePath}.tmp-${process.pid}`);
  await assert.rejects(store.save({ mode: 'online', online: { apiKey: 'unsaved-session-key' } }));
  assert.equal((await store.getOnlineCredentials()).apiKey, 'working-session-key');
  assert.equal(await fs.readFile(store.filePath, 'utf8'), before);
});
