'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RemoteAuthService } = require('../../src/main/remote-auth-service');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('单位管理员申请只提交后端，不创建本地会话', async () => {
  let state = { version: 2, accounts: [], lastLoginPhone: '', rememberedAccountId: null };
  const requests = [];
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-test-001',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    rememberedLoginStore: { save: async () => ({ saved: true }), clear: async () => ({}) },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/api/auth/unit-admin-applications')) return response(201, { application: { id: 'application-1', status: 'pending' } });
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const result = await service.submitUnitAdminApplication({ phone: '139 0013 9000', password: 'secret88', name: '李主任', organizationName: '示范社区', region: '示范街道' });
  assert.equal(result.application.status, 'pending');
  assert.equal(requests[0].url, 'https://backend.example.com/api/auth/unit-admin-applications');
  assert.deepEqual(JSON.parse(requests[0].options.body), { phone: '13900139000', password: 'secret88', name: '李主任', organizationName: '示范社区', region: '示范街道', machineId: 'mac-test-001' });
  assert.equal(state.remoteAccount, undefined);
  assert.equal(Object.hasOwn(state, 'token'), false);
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
  assert.equal(cleared, 1);
  assert.deepEqual(await service.checkServerConnection(), { ok: true, baseUrl: 'http://192.168.1.9:3000', service: 'community-ai-backend', version: '1.0.0' });
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
