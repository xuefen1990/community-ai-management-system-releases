'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { JsonDatabaseStore } = require('../../src/main/database-store');

async function makeStore(t) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-db-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  return new JsonDatabaseStore({
    userDataPath,
    now: () => new Date('2026-08-13T05:06:07.890Z'),
  });
}

test('first read creates an empty isolated database on disk', async (t) => {
  const store = await makeStore(t);
  const database = await store.read();

  assert.equal(database.settings.appSubtitle, '社区AI管理系统');
  assert.deepEqual(database.personnel, []);
  assert.equal(JSON.parse(await fs.readFile(store.databasePath, 'utf8')).version, 1);
});

test('writes are persisted and returned as defensive copies', async (t) => {
  const store = await makeStore(t);
  const database = await store.read();
  database.personnel.push({ id: 'p-1', name: '测试居民' });
  await store.write(database);

  const persisted = await store.read();
  assert.equal(persisted.personnel[0].name, '测试居民');
  persisted.personnel[0].name = '已修改副本';
  assert.equal((await store.read()).personnel[0].name, '测试居民');
});

test('backup can restore the previous database state', async (t) => {
  const store = await makeStore(t);
  const initial = await store.read();
  initial.settings.villageName = '幸福社区';
  await store.write(initial);
  const backup = await store.createBackup();

  initial.settings.villageName = '临时名称';
  await store.write(initial);
  const result = await store.restoreBackup(backup.path);

  assert.equal(result.data.settings.villageName, '幸福社区');
  assert.equal((await store.read()).settings.villageName, '幸福社区');
  assert.ok((await store.listBackups()).length >= 1);
});

test('restore rejects paths outside the product backup directory', async (t) => {
  const store = await makeStore(t);
  await store.initialize();
  await assert.rejects(() => store.restoreBackup(path.join(os.tmpdir(), 'foreign.json')), /备份目录/u);
});

test('corrupt data is quarantined and replaced with an empty database', async (t) => {
  const store = await makeStore(t);
  await store.initialize();
  await fs.writeFile(store.databasePath, '{broken json', 'utf8');

  const recovered = await store.read();
  assert.deepEqual(recovered.personnel, []);
  const names = await fs.readdir(store.dataDirectory);
  assert.ok(names.some((name) => name.startsWith('community-data.corrupt-')));
});
