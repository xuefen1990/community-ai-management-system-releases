'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RemoteAuthService, normalizeBaseUrl } = require('../../src/main/remote-auth-service');

test('局域网主机只输入 IP 时自动补齐固定服务端口', () => {
  assert.equal(normalizeBaseUrl(' 192.168.2.106 '), 'http://192.168.2.106:3000');
  assert.equal(normalizeBaseUrl('10.0.0.8'), 'http://10.0.0.8:3000');
  assert.equal(normalizeBaseUrl('https://xuefeng0901.cn/'), 'https://xuefeng0901.cn');
  assert.throws(() => normalizeBaseUrl('8.8.8.8'));
});

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('登录状态保留主账号 ID 供共享工作区使用', async () => {
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-unit-status',
    store: { read: async () => ({}), write: async () => {} },
    fetchImpl: async () => response(200, { valid: true, plan: 'permanent' }),
  });
  service.session = { token: 'test-token', user: { id: 'member-1', role: 'member', mainAccountId: 'owner-1' } };
  const status = await service.getStatus();
  assert.equal(status.account.mainAccountId, 'owner-1');
});

test('主账号使用本机工作区，子账号仍须连接指定电脑', async () => {
  const state = { lanWorkspaceUrl: '', lanWorkspaceOwnerId: '' };
  const service = new RemoteAuthService({ baseUrl: 'https://backend.example.com', machineId: 'local-owner',
    store: { read: async () => state, write: async () => {} }, fetchImpl: async () => response(200, {}) });
  let prepared = null;
  service.localWorkspaceService = { prepareLocal: async input => { prepared = input; return { baseUrl: 'http://127.0.0.1:3000' }; } };
  service.session = { token: 'owner-token', user: { id: 'owner-1', role: 'main_account', mainAccountId: 'owner-1' } };
  assert.equal(await service.getWorkspaceBaseUrl(), 'http://127.0.0.1:3000');
  assert.deepEqual(prepared, { ownerId: 'owner-1', cloudBaseUrl: 'https://backend.example.com' });
  service.session = { token: 'member-token', user: { id: 'member-1', role: 'member', mainAccountId: 'owner-1' } };
  await assert.rejects(service.getWorkspaceBaseUrl(), /尚未确认主电脑/u);
  service.session = { token: 'admin-token', user: { id: 'admin-1', role: 'admin' } };
  assert.equal(await service.getWorkspaceBaseUrl(), 'http://127.0.0.1:3000');
  assert.equal(prepared.ownerId, 'admin-1');
});

test('主机确认按子账号隔离，重新登录自动使用本人已确认地址', async () => {
  let state = { accounts: [], lanWorkspaceConnections: {} };
  const service = new RemoteAuthService({ baseUrl: 'https://backend.example.com', machineId: 'member-device',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    fetchImpl: async () => response(200, {}) });
  service.checkLanWorkspace = async ({ ip }) => ({ baseUrl: `http://${ip}:3000`, ownerId: 'owner-1' });
  service.session = { token: 'a', user: { id: 'member-a', role: 'member', mainAccountId: 'owner-1' } };
  assert.equal((await service.getWorkspaceConnection()).baseUrl, '');
  await service.connectLanWorkspace({ ip: '192.168.2.10' });
  assert.equal(await service.getWorkspaceBaseUrl(), 'http://192.168.2.10:3000');
  service.session = { token: 'b', user: { id: 'member-b', role: 'member', mainAccountId: 'owner-1' } };
  assert.equal((await service.getWorkspaceConnection()).baseUrl, '');
  await service.connectLanWorkspace({ ip: '192.168.2.11' });
  service.session = { token: 'a2', user: { id: 'member-a', role: 'member', mainAccountId: 'owner-1' } };
  assert.equal(await service.getWorkspaceBaseUrl(), 'http://192.168.2.10:3000');
  assert.deepEqual(Object.keys(state.lanWorkspaceConnections).sort(), ['member-a', 'member-b']);
});

test('旧版连接只迁移给原先登录的子账号', async () => {
  let state = { accounts: [], remoteAccount: { id: 'member-a' }, lanWorkspaceUrl: 'http://192.168.2.10:3000', lanWorkspaceOwnerId: 'owner-1' };
  const service = new RemoteAuthService({ baseUrl: 'https://backend.example.com', machineId: 'legacy-device',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    fetchImpl: async () => response(200, {}) });
  await service.beginSession({ token: 'a', user: { id: 'member-a', phone: '13900139001', role: 'member', mainAccountId: 'owner-1' } }, { password: 'secret88', remember: false });
  assert.equal((await service.getWorkspaceConnection()).baseUrl, 'http://192.168.2.10:3000');
  await service.beginSession({ token: 'b', user: { id: 'member-b', phone: '13900139002', role: 'member', mainAccountId: 'owner-1' } }, { password: 'secret88', remember: false });
  assert.equal((await service.getWorkspaceConnection()).baseUrl, '');
  assert.equal(state.lanWorkspaceConnections['member-a'].baseUrl, 'http://192.168.2.10:3000');
});

test('旧会话中的平台管理员以本人作为主账号', async () => {
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-admin-status',
    store: { read: async () => ({}), write: async () => {} },
    fetchImpl: async () => response(200, { valid: true, plan: 'permanent' }),
  });
  service.session = { token: 'test-token', user: { id: 'admin-1', role: 'admin' } };
  const status = await service.getStatus();
  assert.equal(status.account.mainAccountId, 'admin-1');
});

test('手机号注册使用主账号接口并直接创建试用会话', async () => {
  let state = { version: 2, accounts: [], lastLoginPhone: '', rememberedAccountId: null };
  const requests = [];
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-test-001',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    rememberedLoginStore: { save: async () => ({ saved: true }), clear: async () => ({}) },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/api/auth/register')) return response(201, { token: 'registered-token', user: { id: 'owner-1', phone: '13900139000', role: 'main_account', mainAccountId: 'owner-1' } });
      if (url.endsWith('/api/auth/entitlement')) return response(200, { valid: true, plan: 'trial', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const result = await service.register({ phone: '139 0013 9000', password: 'secret88', confirmPassword: 'secret88' });
  assert.equal(result.account.role, 'main_account');
  assert.equal(result.account.mainAccountId, 'owner-1');
  assert.equal(result.entitlement.type, 'trial');
  assert.equal(requests[0].url, 'https://backend.example.com/api/auth/register');
  assert.deepEqual(JSON.parse(requests[0].options.body), { phone: '13900139000', password: 'secret88', confirmPassword: 'secret88', machineId: 'mac-test-001' });
  assert.equal(state.remoteAccount.id, 'owner-1');
});

test('账号服务器地址可保存、切换并执行健康检查', async () => {
  let state = { version: 2, accounts: [], remoteAccount: { id: 'old-user' }, lastLoginPhone: '13900139000', rememberedAccountId: 'old-user', remoteServerUrl: '' };
  let cleared = 0;
  const service = new RemoteAuthService({
    baseUrl: 'http://127.0.0.1:3000',
    machineId: 'mac-test-002',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    rememberedLoginStore: { clear: async () => { cleared += 1; } },
    fetchImpl: async url => {
      assert.equal(url, 'http://192.168.1.9:3000/api/health');
      return response(200, { status: 'ok', service: 'community-ai-backend', version: '1.0.0' });
    },
  });

  const saved = await service.setServerConfig({ baseUrl: 'http://192.168.1.9:3000/' });
  assert.deepEqual(saved, { baseUrl: 'http://192.168.1.9:3000', configured: true });
  assert.equal(state.remoteServerUrl, 'http://192.168.1.9:3000');
  assert.equal(state.remoteAccount, null);
  assert.equal(state.lastLoginPhone, '');
  assert.equal(cleared, 0); // Switching servers preserves their isolated encrypted credentials.
  assert.deepEqual(await service.checkServerConnection(), { ok: true, baseUrl: 'http://192.168.1.9:3000', service: 'community-ai-backend', version: '1.0.0' });
});

test('启动时会把历史本机后端地址迁移到正式域名', async () => {
  let state = { version: 2, accounts: [], remoteServerUrl: 'http://127.0.0.1:3000' };
  const service = new RemoteAuthService({
    baseUrl: 'https://xuefeng0901.cn',
    legacyBaseUrls: ['http://127.0.0.1:3000', 'http://121.43.135.1:3000'],
    machineId: 'mac-test-migration',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    fetchImpl: async () => { throw new Error('地址迁移不应访问网络'); },
  });

  const config = await service.getServerConfig();
  assert.deepEqual(config, { baseUrl: 'https://xuefeng0901.cn', configured: true });
  assert.equal(state.remoteServerUrl, 'https://xuefeng0901.cn');
});

test('远程登录在账号服务器无响应时会超时返回', async () => {
  const service = new RemoteAuthService({
    baseUrl: 'http://127.0.0.1:3000',
    machineId: 'mac-test-timeout',
    requestTimeoutMs: 20,
    store: { read: async () => ({ version: 2, accounts: [], remoteServerUrl: '' }), write: async () => {} },
    fetchImpl: async () => new Promise(() => {}),
  });

  await assert.rejects(
    () => service.login({ phone: '13900139000', password: 'secret88' }),
    /账号服务器响应超时/u,
  );
});

test('已在线登录的账号可在服务器断开后用密码离线重开，错误密码不得进入', async () => {
  let state = { version: 2, accounts: [], remoteServerUrl: '' };
  let online = true;
  const store = { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } };
  const fetchImpl = async url => {
    if (!online) throw new Error('network unavailable');
    if (url.endsWith('/api/auth/login')) return response(200, { token: 'saved-token', user: {
      id: 'member-1', phone: '13900139000', role: 'member', mainAccountId: 'owner-1', permissions: { personnel: ['view', 'update'] },
    } });
    if (url.endsWith('/api/auth/entitlement')) return response(200, { valid: true, plan: 'permanent' });
    throw new Error(`unexpected request: ${url}`);
  };
  const service = new RemoteAuthService({ baseUrl: 'https://backend.example.com', machineId: 'offline-test', store, fetchImpl });
  await service.login({ phone: '13900139000', password: 'secret88' });
  online = false;
  const reopened = new RemoteAuthService({ baseUrl: 'https://backend.example.com', machineId: 'offline-test', store, fetchImpl });
  await assert.rejects(reopened.login({ phone: '13900139000', password: 'wrong88' }), /离线密码不正确/u);
  const status = await reopened.login({ phone: '13900139000', password: 'secret88' });
  assert.equal(status.account.permissions.personnel.includes('update'), true);
  assert.equal(status.entitlement.type, 'licensed');
  assert.equal(reopened.session.offline, true);
});

test('启动时使用上次成功登录账号保存的体验版有效期', async () => {
  const expiresAt = new Date(Date.now() + 6 * 86400000).toISOString();
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-test-startup-trial',
    store: {
      read: async () => ({
        version: 2,
        accounts: [],
        remoteAccount: { id: 'user-1', phone: '13900139000' },
        lastLoginPhone: '13900139000',
        lastKnownEntitlement: { accountId: 'user-1', phone: '13900139000', plan: 'trial', expiresAt },
      }),
      write: async () => {},
    },
    fetchImpl: async () => { throw new Error('启动检查不应访问网络'); },
  });

  const startup = await service.getStartupEntitlement();
  assert.equal(startup.hasPreviousAccount, true);
  assert.equal(startup.account.phone, '13900139000');
  assert.equal(startup.entitlement.type, 'trial');
  assert.equal(startup.entitlement.plan, 'trial');
  assert.equal(startup.entitlement.expiresAt, expiresAt);
});

test('启动时会把已过期的上次账号有效期识别为到期', async () => {
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-test-startup-expired',
    store: {
      read: async () => ({
        version: 2,
        accounts: [],
        remoteAccount: { id: 'user-2', phone: '13800138000' },
        lastLoginPhone: '13800138000',
        lastKnownEntitlement: { accountId: 'user-2', phone: '13800138000', plan: 'annual', expiresAt: '2020-01-01T00:00:00.000Z' },
      }),
      write: async () => {},
    },
    fetchImpl: async () => { throw new Error('启动检查不应访问网络'); },
  });

  const startup = await service.getStartupEntitlement();
  assert.equal(startup.entitlement.type, 'expired');
  assert.equal(startup.entitlement.plan, 'annual');
});

test('启动时忽略缺少授权类型的旧有效期记录', async () => {
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-test-startup-legacy',
    store: {
      read: async () => ({
        version: 2,
        accounts: [],
        remoteAccount: { id: 'user-3', phone: '13700137000' },
        lastLoginPhone: '13700137000',
        lastKnownEntitlement: { accountId: 'user-3', phone: '13700137000', expiresAt: new Date(Date.now() + 20 * 86400000).toISOString() },
      }),
      write: async () => {},
    },
    fetchImpl: async () => { throw new Error('启动检查不应访问网络'); },
  });

  const startup = await service.getStartupEntitlement();
  assert.equal(startup.entitlement.type, 'none');
});

test('页面集中读取合并授权请求，短缓存不跨账号且手动刷新立即请求服务器', async () => {
  let requests = 0, writes = 0, state = {};
  const service = new RemoteAuthService({ baseUrl: 'https://synthetic.invalid', machineId: 'synthetic',
    store: { read: async () => structuredClone(state), write: async value => { state = value; writes++; } },
    fetchImpl: async () => { requests++; await new Promise(resolve => setImmediate(resolve)); return response(200, { valid: true, plan: 'permanent' }); },
  });
  service.session = { token: 'synthetic-token', user: { id: 'a', phone: 'synthetic-a' } };
  const results = await Promise.all(Array.from({ length: 25 }, () => service.getStatus()));
  assert(results.every(status => status.authenticated && status.entitlement.type === 'licensed'));
  assert.equal(requests, 1); assert.equal(writes, 1);
  await service.getStatus(); assert.equal(requests, 1);
  await service.getStatus({ forceRefresh: true }); assert.equal(requests, 2);
  await service.logout(); assert.equal((await service.getStatus()).authenticated, false);
  service.session = { token: 'synthetic-other', user: { id: 'b', phone: 'synthetic-b' } };
  assert.equal((await service.getStatus()).account.id, 'b'); assert.equal(requests, 3);
});

test('授权请求中途退出不会回写旧账号状态或返回已登录', async () => {
  let resolveRequest, requests = 0;
  const service = new RemoteAuthService({ baseUrl: 'https://synthetic.invalid', machineId: 'synthetic',
    store: { read: async () => ({}), write: async () => { throw new Error('退出后不得写入旧授权'); } },
    fetchImpl: async () => { requests++; return new Promise(resolve => { resolveRequest = resolve; }); },
  });
  service.session = { token: 'synthetic', user: { id: 'a' } };
  const pending = service.getStatus();
  while (!requests) await new Promise(resolve => setImmediate(resolve));
  await service.logout(); resolveRequest(response(200, { valid: true, plan: 'permanent' }));
  assert.equal((await pending).authenticated, false);
});

test('initial password change defers encrypted save and preserves opt-out; logout preserves saved credentials',async()=>{
 for(const remember of [true,false]){
  let state={},mustChangePassword=true;const saves=[],clears=[];
  const service=new RemoteAuthService({baseUrl:'https://accounts.test',machineId:'synthetic',store:{read:async()=>structuredClone(state),write:async s=>state=structuredClone(s)},rememberedLoginStore:{save:async value=>{saves.push(value);return {saved:true};},clear:async value=>clears.push(value)}});
  service.request=async path=>path==='/auth/login'?{token:'synthetic',user:{id:'member',role:'member',phone:'13800138000',mustChangePassword}}:{};
  service.getStatus=async()=>({authenticated:true,entitlement:{type:'none'}});
  await service.login({phone:'13800138000',password:'initial-password',remember});
  assert.equal(saves.length,0);
  mustChangePassword=false;await service.changePassword({oldPassword:'initial-password',newPassword:'new-password'});
  assert.equal(saves.length,remember?1:0);
  if(remember)assert.deepEqual(saves[0],{phone:'13800138000',password:'new-password',serverUrl:'https://accounts.test'});
  const before=clears.length;await service.logout();assert.equal(clears.length,before);
  assert.equal(state.rememberLoginByServer['https://accounts.test'],remember);
 }
});
