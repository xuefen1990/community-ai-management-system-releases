'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { StandaloneAccountRuntime, atomicJson } = require('../../src/main/standalone-account-runtime');
const { passwordMatches } = require('../../src/main/local-auth-service');
const { seal } = require('../../src/main/offline-session-cache');

async function fixture(t, changes = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'standalone-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const user = { id: 'original-owner', mainAccountId: 'original-owner', phone: '18800000000', role: 'main_account', isActive: true, ...changes };
  const state = { accounts: [], lastLoginPhone: user.phone, remoteAccount: user, offlineSessions: { [user.phone]: seal({ user, token: 'cloud-token', entitlement: { type: 'licensed' } }, 'original-password') } };
  await atomicJson(path.join(root, 'license', 'local-auth.json'), state);
  await atomicJson(path.join(root, 'lan-workspace', 'config.json'), { ownerId: 'original-owner', cloudBaseUrl: 'https://old.invalid', shareEnabled: false });
  await atomicJson(path.join(root, 'lan-workspace', 'workspace.json'), { version: 8, data: { personnel: [{ id: 'p1', name: '测试居民' }], settings: { villageName: '测试社区' } } });
  await fs.mkdir(path.join(root, 'data')); await fs.writeFile(path.join(root, 'data', 'original-photo.bin'), 'photo-bytes');
  return { root, state, runtime: new StandaloneAccountRuntime({ userDataPath: root }), credentials: { phone: user.phone, password: 'original-password' } };
}

test('迁移验证原密码、保留原账号 ID 与工作区，备份可校验且不会覆盖旧认证', async t => {
  const { root, runtime, credentials } = await fixture(t);
  const before = await fs.readFile(path.join(root, 'license/local-auth.json'));
  const workspace = await fs.readFile(path.join(root, 'lan-workspace/workspace.json'));
  const result = await runtime.prepare(credentials), db = await runtime.readDatabase();
  assert.equal(result.initialized, true); assert.equal(db.users.length, 1); assert.equal(db.users[0].id, 'original-owner');
  assert.equal(db.users[0].role, 'main_account'); assert.equal(db.users[0].plan_type, 'permanent');
  assert.equal(await passwordMatches(credentials.password, db.users[0].password_hash), true);
  assert.deepEqual(await fs.readFile(path.join(root, 'license/local-auth.json')), before);
  assert.deepEqual(await fs.readFile(path.join(root, 'lan-workspace/workspace.json')), workspace);
  const hashes = JSON.parse(await fs.readFile(path.join(result.backup, 'sha256.json')));
  assert.ok(hashes['2-lan-workspace/workspace.json']); assert.ok(hashes['3-data/original-photo.bin']);
  assert.equal(JSON.stringify(db).includes(credentials.password), false);
  const again = await runtime.prepare(credentials); assert.equal(again.initialized, false);
});
test('错误密码不能触发账号库创建或工作区改写', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.prepare({ ...f.credentials, password: 'incorrect' }), /密码不正确/);
  assert.equal(await f.runtime.readDatabase(), null);
});
test('成员或主账号归属冲突不能迁为本机主账号', async t => {
  for (const changes of [{ role: 'member' }, { mainAccountId: 'someone-else' }]) {
    const f = await fixture(t, changes);
    await assert.rejects(f.runtime.prepare(f.credentials), /子账号|归属不一致/);
    assert.equal(await f.runtime.readDatabase(), null);
  }
});
test('有历史资料时禁止注册新账号打开空工作区', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.prepare({ ...f.credentials, register: true }), /历史资料/);
});
test('新电脑可以创建隔离的永久本机账号，重复注册被拒绝', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'standalone-new-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = new StandaloneAccountRuntime({ userDataPath: root });
  await runtime.prepare({ phone: '18800000000', password: 'new-password', register: true });
  assert.equal((await runtime.readDatabase()).users[0].plan_type, 'permanent');
  const data = await runtime.prepareData(); assert.ok(data.dbPath.startsWith(path.join(root, 'standalone')));
  await assert.rejects(runtime.prepare({ phone: '18800000000', password: 'new-password', register: true }), /已有主账号/);
});
test('损坏的独立账号库不会被重建，未归属业务数据不能被接管', async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.root, 'lan-workspace'), { recursive: true });
  await atomicJson(path.join(f.root, 'data', 'community-data.json'), { personnel: [{ id: 'old' }] });
  await assert.rejects(f.runtime.prepare(f.credentials), /未绑定主账号/);
  await fs.mkdir(path.dirname(f.runtime.dbPath), { recursive: true }); await fs.writeFile(f.runtime.dbPath, 'broken');
  await assert.rejects(f.runtime.prepare(f.credentials), /损坏/);
  assert.equal(await fs.readFile(f.runtime.dbPath, 'utf8'), 'broken');
});
