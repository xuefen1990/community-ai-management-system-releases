'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RememberedLoginStore } = require('../../src/main/remembered-login-store');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/u, ''),
  };
}

test('remembered login encrypts the password and can clear it', async (t) => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-remembered-login-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const store = new RememberedLoginStore({ userDataPath, safeStorage: fakeSafeStorage() });

  assert.deepEqual(await store.save({ phone: '13800138000', password: 'secret88' }), { saved: true, warning: '' });
  assert.doesNotMatch(await fs.readFile(store.filePath, 'utf8'), /secret88/u);
  assert.deepEqual(await store.load(), { phone: '13800138000', password: 'secret88', warning: '' });
  await store.clear();
  assert.deepEqual(await store.load(), { phone: '', password: '', warning: '' });
});

test('remembered login degrades to a manual password when safe storage is unavailable', async (t) => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-remembered-login-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const store = new RememberedLoginStore({ userDataPath, safeStorage: fakeSafeStorage(false) });

  assert.equal((await store.save({ phone: '13800138000', password: 'secret88' })).saved, false);
  assert.match((await store.save({ phone: '13800138000', password: 'secret88' })).warning, /安全存储/u);
});
