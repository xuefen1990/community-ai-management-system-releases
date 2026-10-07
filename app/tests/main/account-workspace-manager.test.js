'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LanWorkspaceService } = require('../../src/main/lan-workspace-service');
const { AccountWorkspaceManager, accountDirectory } = require('../../src/main/account-workspace-manager');
const { createEmptyDatabase } = require('../../src/main/empty-database');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { RemoteDatabaseStore } = require('../../src/main/remote-database-store');

function profile(url, options) {
  const token = String(options?.headers?.Authorization || '').replace(/^Bearer /u, '');
  const ownerId = token === 'owner-a' ? 'owner-a' : token === 'owner-b' ? 'owner-b' : 'unknown';
  return Promise.resolve({ ok: true, json: async () => url.endsWith('/api/auth/entitlement') ? { valid: true, plan: 'permanent' } : ({ user: {
    id: ownerId, mainAccountId: ownerId, role: 'main_account', isActive: true,
  } }) });
}

async function data(baseUrl, token, method = 'GET', body) {
  const response = await fetch(`${baseUrl}/api/unit/workspace/data`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('同一电脑切换主账号时保留旧库，为新账号创建独立空库', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-workspaces-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = new LanWorkspaceService({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  await legacy.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  await legacy.writeJson(legacy.dataPath, { version: 1, data: { ...createEmptyDatabase(), personnel: [{ id: 'a-person' }] } });
  await legacy.aiState.write({ version: 1, conversations: [{ id: 'a-chat', ownerAccountId: 'owner-a' }], memories: [], tasks: [] });
  await fs.mkdir(path.join(root, 'data', 'foundation-archives'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'foundation-archives', 'a.txt'), 'account A');
  await legacy.stop();

  const manager = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  t.after(() => manager.stop());
  await manager.startIfConfigured();
  let first = await manager.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await data(first.baseUrl, 'owner-a')).body.data.personnel, [{ id: 'a-person' }]);
  assert.equal(manager.dataDirectoryFor('owner-a'), path.join(root, 'data'));

  let second = await manager.prepareLocal({ ownerId: 'owner-b', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await data(second.baseUrl, 'owner-b')).body.data.personnel, []);
  assert.equal(manager.dataDirectoryFor('owner-b'), path.join(accountDirectory(root, 'owner-b'), 'data'));
  assert.equal(manager.services.get('owner-a').info().enabled, false);
  assert.equal(manager.services.get('owner-b').info().enabled, true);
  assert.deepEqual(await manager.active.aiState.read(), { version: 1, conversations: [], memories: [], tasks: [] });
  assert.notEqual(manager.active.filesDirectory, legacy.filesDirectory);
  const write = await data(second.baseUrl, 'owner-b', 'PUT', { version: 1, data: { personnel: [{ id: 'b-person' }] } });
  assert.equal(write.status, 200);
  const uploadedResponse = await fetch(`${second.baseUrl}/api/unit/workspace/files`, {
    method: 'POST', headers: { Authorization: 'Bearer owner-b', 'X-File-Name': encodeURIComponent('b.txt') }, body: Buffer.from('account B'),
  });
  assert.equal(uploadedResponse.status, 200);
  const uploaded = await uploadedResponse.json();
  assert.equal(await fs.readFile(uploaded.path, 'utf8'), 'account B');
  assert.equal(path.relative(manager.dataDirectoryFor('owner-b'), uploaded.path).startsWith('..'), false);

  first = await manager.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await manager.readWorkspace()).data.personnel, [{ id: 'a-person' }]);
  assert.equal((await fs.readFile(path.join(root, 'data', 'foundation-archives', 'a.txt'), 'utf8')), 'account A');
  const crossReference = await data(first.baseUrl, 'owner-a', 'PUT', { version: 1, data: {
    documents: [{ id: 'b-file', file_path: uploaded.path }],
  } });
  assert.equal(crossReference.status, 200);
  const crossRead = await fetch(`${first.baseUrl}/api/unit/workspace/files/b-file`, { headers: { Authorization: 'Bearer owner-a' } });
  assert.notEqual(crossRead.status, 200);
  second = await manager.prepareLocal({ ownerId: 'owner-b', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await manager.readWorkspace()).data.personnel, [{ id: 'b-person' }]);
  await manager.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  assert.equal(manager.info().enabled, true);
  await manager.prepareLocal({ ownerId: 'owner-b', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await manager.readWorkspace()).data.personnel, [{ id: 'b-person' }]);
  assert.equal(manager.info().enabled, true);
  await manager.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  await manager.disableSharing();
  await manager.prepareLocal({ ownerId: 'owner-b', cloudBaseUrl: 'https://account.example.com' });
  assert.equal(manager.info().enabled, true);
  await manager.stop();
  const reopened = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  t.after(() => reopened.stop());
  await reopened.startIfConfigured();
  await reopened.prepareLocal({ ownerId: 'owner-b', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await reopened.readWorkspace()).data.personnel, [{ id: 'b-person' }]);
  await reopened.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  assert.deepEqual((await reopened.readWorkspace()).data.personnel, [{ id: 'a-person' }]);
});

test('未知归属的旧数据不得自动绑定给新登录账号', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unbound-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'lan-workspace'), { recursive: true });
  await fs.writeFile(path.join(root, 'lan-workspace', 'workspace.json'), JSON.stringify({ version: 1, data: createEmptyDatabase() }));
  const manager = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  await assert.rejects(manager.prepareLocal({ ownerId: 'owner-b', cloudBaseUrl: 'https://account.example.com' }), /未绑定主账号/u);
  await assert.rejects(fs.access(accountDirectory(root, 'owner-b')));
});

test('主账号退出登录后运行中的本机共享仍可供子账号连接', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-signed-out-host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  t.after(() => manager.stop());
  await manager.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  const port = manager.info().port;
  manager.deactivate();
  const result = await fetch(`http://127.0.0.1:${port}/api/lan/status`, { headers: { Authorization: 'Bearer owner-a' } });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).ownerId, 'owner-a');
});

test('切换主账号后数据库备份目录也按账号隔离', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-backups-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  t.after(() => manager.stop());
  let ownerId = 'owner-a';
  const authService = {
    session: { user: { id: ownerId, mainAccountId: ownerId, role: 'main_account' } },
    getStatus: async () => ({ authenticated: true, account: { id: ownerId, mainAccountId: ownerId, role: 'main_account' } }),
    getWorkspaceBaseUrl: async () => (await manager.prepareLocal({ ownerId, cloudBaseUrl: 'https://account.example.com' })).baseUrl,
    request: async (requestPath, options = {}) => {
      assert.equal(requestPath, '/unit/workspace/data');
      const baseUrl = (await manager.prepareLocal({ ownerId, cloudBaseUrl: 'https://account.example.com' })).baseUrl;
      const result = await data(baseUrl, ownerId, options.method || 'GET', options.body);
      if (result.status !== 200) throw new Error(result.body.error);
      return result.body;
    },
    subscribeWorkspaceChanges: async () => () => {},
  };
  const store = new RemoteDatabaseStore({ authService, localStore: new JsonDatabaseStore({ userDataPath: root }), localWorkspaceService: manager });
  await store.read();
  await store.update(draft => { draft.personnel.push({ id: 'a-person' }); });
  const aBackup = await store.createBackup();
  assert.equal((await store.listBackups()).length, 1);

  ownerId = 'owner-b';
  authService.session.user = { id: ownerId, mainAccountId: ownerId, role: 'main_account' };
  await store.resetForAccountChange();
  assert.deepEqual((await store.read()).personnel, []);
  assert.deepEqual(await store.listBackups(), []);
  const bBackup = await store.createBackup();
  assert.notEqual(path.dirname(aBackup.path), path.dirname(bBackup.path));
  await assert.rejects(store.restoreBackup(aBackup.path), /备份目录/u);

  ownerId = 'owner-a';
  authService.session.user = { id: ownerId, mainAccountId: ownerId, role: 'main_account' };
  await store.resetForAccountChange();
  assert.deepEqual((await store.read()).personnel, [{ id: 'a-person' }]);
  assert.equal((await store.listBackups()).length, 1);
});

test('搬迁当前主账号完整工作区后保留原件，并在重启后从新位置读取附件与备份', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-relocation-'));
  const targetParent = await fs.mkdtemp(path.join(os.tmpdir(), 'account-relocation-target-'));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(targetParent, { recursive: true, force: true })]));
  const manager = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  t.after(() => manager.stop());
  await manager.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  const source = manager.active.userDataPath;
  const attachment = path.join(source, 'data', 'foundation-archives', 'record.pdf');
  await fs.mkdir(path.dirname(attachment), { recursive: true });
  await fs.writeFile(attachment, 'private attachment');
  const external = path.join(targetParent, 'original-external.pdf');
  await fs.writeFile(external, 'external attachment');
  await manager.active.writeJson(manager.active.dataPath, { version: 1, data: {
    ...createEmptyDatabase(), documents: [{ id: 'record-1', file_path: attachment }, { id: 'record-2', file_path: external }],
  } });
  const backup = path.join(source, 'data', 'foundation-backups', 'backup-1', 'database.json');
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(backup, '{"version":1}');
  const result = await manager.relocateActive(targetParent);
  assert.equal(await fs.readFile(attachment, 'utf8'), 'private attachment');
  assert.equal(await fs.readFile(backup, 'utf8'), '{"version":1}');
  await manager.stop();
  const reopened = new AccountWorkspaceManager({ userDataPath: root, fetchImpl: profile, port: 0, host: '127.0.0.1' });
  t.after(() => reopened.stop());
  await reopened.startIfConfigured();
  await reopened.prepareLocal({ ownerId: 'owner-a', cloudBaseUrl: 'https://account.example.com' });
  const moved = (await reopened.readWorkspace()).data.documents[0].file_path;
  assert.equal(moved, path.join(result.destination, 'data', 'foundation-archives', 'record.pdf'));
  assert.equal(await fs.readFile(moved, 'utf8'), 'private attachment');
  const movedExternal = (await reopened.readWorkspace()).data.documents[1].file_path;
  assert.equal(movedExternal.startsWith(path.join(result.destination, 'data', 'relocated-files')), true);
  assert.equal(await fs.readFile(movedExternal, 'utf8'), 'external attachment');
  assert.equal(await fs.readFile(path.join(result.destination, 'data', 'foundation-backups', 'backup-1', 'database.json'), 'utf8'), '{"version":1}');
  assert.equal(reopened.dataDirectoryFor('owner-a'), path.join(result.destination, 'data'));
});
