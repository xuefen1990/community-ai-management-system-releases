'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { StandaloneAccountRuntime, atomicJson } = require('../../src/main/standalone-account-runtime');
const { StandaloneAuthService, manualUpdateService } = require('../../src/main/standalone-auth-service');
const { StandaloneLanClient, parsePairing } = require('../../src/main/standalone-lan-client');
const { LocalBackendManager } = require('../../src/main/local-backend-manager');
const { AuthStore } = require('../../src/main/auth-store');
const { AccountWorkspaceManager } = require('../../src/main/account-workspace-manager');
const { seal: sealAccount } = require('../../src/main/offline-session-cache');
const { seal, open, pairId, seedOf } = require('../../src/main/mini-program-crypto');

async function port() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }

test('旧主账号在完全禁止外网的真实本机服务中迁移、登录、读取原工作区；手机加密登录和配对不依赖云端', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'standalone-integration-'));
  const user = { id: 'original-owner', mainAccountId: 'original-owner', phone: '18800000000', role: 'main_account', isActive: true };
  const oldAuth = { accounts: [], remoteAccount: user, lastLoginPhone: user.phone, offlineSessions: { [user.phone]: sealAccount({ user, token: 'old-cloud-token' }, 'test-password') } };
  await atomicJson(path.join(root, 'license/local-auth.json'), oldAuth);
  await atomicJson(path.join(root, 'lan-workspace/config.json'), { ownerId: user.id, cloudBaseUrl: 'https://unreachable-cloud.invalid', shareEnabled: false });
  const business = { version: 12, data: { personnel: [{ id: 'person-one', name: '测试居民' }], settings: { villageName: '测试社区' } } };
  await atomicJson(path.join(root, 'lan-workspace/workspace.json'), business);
  const original = await fs.readFile(path.join(root, 'lan-workspace/workspace.json'));
  const requested = [];
  const fetchImpl = (url, options) => { requested.push(String(url)); assert.equal(new URL(url).hostname, '127.0.0.1', 'no cloud requests allowed'); return fetch(url, options); };
  const runtime = new StandaloneAccountRuntime({ userDataPath: root });
  const manager = new LocalBackendManager({ backendEntry: path.resolve(__dirname, '../../..', 'backend/src/index.js'), prepareData: () => runtime.prepareData(), isolated: true, fetchImpl });
  const auth = new StandaloneAuthService({ runtime, store: new AuthStore({ userDataPath: runtime.directory }), machineId: 'fixture-device', baseUrl: `http://127.0.0.1:${await port()}`, fetchImpl, ensureReady: config => manager.ensureReady(config) });
  const workspaces = new AccountWorkspaceManager({ userDataPath: root, fetchImpl, port: 0, host: '127.0.0.1', discovery: false }); auth.localWorkspaceService = workspaces;
  t.after(async () => { await workspaces.stop(); await manager.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const status = await auth.login({ phone: user.phone, password: 'test-password' });
  assert.equal(status.account.id, user.id); assert.equal(status.mode, 'standalone'); assert.equal(status.entitlement.plan, 'permanent');
  assert.equal((await auth.request('/unit/workspace/data')).data.personnel[0].id, 'person-one');
  assert.deepEqual(await fs.readFile(path.join(root, 'lan-workspace/workspace.json')), original);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'license/local-auth.json'))), oldAuth);
  assert.equal(workspaces.active.config.authMode, 'standalone');
  const mobile = workspaces.active.mobile, pair = (await mobile.pairing('127.0.0.1')).data;
  assert.equal(pair.accountMode, 'standalone');
  async function exchange(payload, mode = 'pair', device = {}) {
    const seed = seedOf(mode === 'pair' ? pair.pairingToken : device.deviceKey);
    const envelope = { workspaceId: pair.workspaceId, mode, keyId: mode === 'pair' ? pairId(pair.pairingToken) : device.deviceId, requestId: randomBytes(16).toString('hex'), issuedAt: Date.now() };
    const response = await fetch(`http://127.0.0.1:${mobile.miniProgram.info().port}/api/mobile-channel/v1/exchange`, { method: 'POST', body: JSON.stringify(seal({ ...payload, ...device }, envelope, seed, 'request')) });
    assert.equal(response.status, 200); return open(await response.json(), seed, 'response');
  }
  const login = await exchange({ kind: 'auth', path: '/login', method: 'POST', body: { phone: user.phone, password: 'test-password' } });
  assert.equal(login.status, 200); assert.equal(login.data.user.id, user.id);
  const wrong = await exchange({ kind: 'auth', path: '/login', method: 'POST', body: { phone: user.phone, password: 'wrong-password' } }); assert.equal(wrong.status, 401);
  const paired = await exchange({ kind: 'request', path: '/pair', method: 'POST', token: login.data.token, body: { pairingToken: pair.pairingToken, deviceId: 'test-mobile-device' } });
  const receipt = JSON.parse(Buffer.from(paired.body, 'base64').toString()); assert.equal(receipt.account.id, user.id);
  const snapshot = await exchange({ kind: 'request', path: '/snapshot', method: 'GET', token: login.data.token }, 'device', { deviceId: 'test-mobile-device', deviceKey: receipt.deviceKey });
  assert.equal(snapshot.status, 200); assert.equal(JSON.parse(Buffer.from(snapshot.body, 'base64').toString()).data.personnel[0].id, 'person-one');
  assert.equal((await auth.request('/ai/quota')).billingUnit, 'provider');
  const member = await auth.createUnitMember({ phone: '13700000001', name: '测试成员', preset: 'custom', permissions: { personnel: ['view'] }, aiAccessEnabled: false });
  const hostClient = new StandaloneLanClient({ userDataPath: path.join(root, 'child') });
  // Loopback is a test-only carrier; public pairing input still requires a private LAN IP.
  hostClient.binding = { ...(await mobile.pairing('127.0.0.1')).data, endpoint: `http://127.0.0.1:${mobile.miniProgram.info().port}` };
  const child = new StandaloneAuthService({ runtime: new StandaloneAccountRuntime({ userDataPath: path.join(root, 'child') }), hostClient,
    store: new AuthStore({ userDataPath: path.join(root, 'child/standalone') }), machineId: 'child-computer', baseUrl: 'http://127.0.0.1:1', fetchImpl,
    ensureReady: () => { throw new Error('member must never start a second account service'); } });
  const initial = await child.login({ phone: member.user.phone, password: member.initialPassword });
  assert.equal(initial.account.mustChangePassword, true); assert.equal(hostClient.binding.deviceKey, undefined);
  const ready = await child.changePassword({ oldPassword: member.initialPassword, newPassword: 'member-new-password' });
  assert.equal(ready.account.id, member.user.id); assert.equal(ready.account.mustChangePassword, false); assert.ok(hostClient.binding.deviceKey);
  await assert.rejects(child.login({ phone: user.phone, password: 'test-password' }), /主账号请在原主电脑|不属于当前配对/);
  await auth.updateMemberStatus({ memberId: member.user.id, isActive: false });
  await assert.rejects(child.request('/auth/profile'), /停用|无效|失效|账号|过期/);
  await manager.stop();
  await assert.rejects(workspaces.active.authorize({ headers: { authorization: `Bearer ${login.data.token}` } }), /本机账号核验/);
  assert.equal(requested.some(url => url.includes('unreachable-cloud')), false);
});

test('子电脑拒绝公开服务器、缺失到期时间和过期配对码', () => {
  const value = { protocol: 'village-mobile-pair-v1', accountMode: 'standalone', workspaceId: 'a'.repeat(32), ownerId: 'owner', pairingToken: 'b'.repeat(48), expiresAt: Date.now() + 60000, miniProgram: { protocol: 'village-mini-channel-v1', endpoint: 'http://192.168.1.10:3003' } };
  assert.equal(parsePairing(JSON.stringify(value)).ownerId, 'owner');
  for (const invalid of [{ ...value, expiresAt: undefined }, { ...value, expiresAt: 1 }, { ...value, miniProgram: { ...value.miniProgram, endpoint: 'http://public.example:3003' } }]) assert.throws(() => parsePairing(JSON.stringify(invalid)), /配对码/);
});

test('本机模式更新操作不会连接任何服务器', async () => {
  const update = manualUpdateService();
  assert.equal((await update.check()).mode, 'manual'); assert.equal((await update.install()).disabled, true);
});
