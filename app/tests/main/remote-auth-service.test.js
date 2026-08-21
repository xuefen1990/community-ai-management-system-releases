'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RemoteAuthService } = require('../../src/main/remote-auth-service');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('远程注册写入后端并在本地只保留会话资料', async () => {
  let state = { version: 2, accounts: [], lastLoginPhone: '', rememberedAccountId: null };
  const requests = [];
  const service = new RemoteAuthService({
    baseUrl: 'https://backend.example.com',
    machineId: 'mac-test-001',
    store: { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
    rememberedLoginStore: { save: async () => ({ saved: true }), clear: async () => ({}) },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/api/auth/register')) return response(201, { token: 'jwt-token', user: { id: 'user-1', phone: '13900139000', createdAt: '2026-08-21T00:00:00.000Z' } });
      if (url.endsWith('/api/auth/entitlement')) return response(200, { valid: true, plan: 'trial', expiresAt: '2026-09-20T00:00:00.000Z' });
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const status = await service.register({ phone: '139 0013 9000', password: 'secret88' });
  assert.equal(status.authenticated, true);
  assert.equal(status.account.phone, '13900139000');
  assert.equal(status.entitlement.type, 'trial');
  assert.equal(requests[0].url, 'https://backend.example.com/api/auth/register');
  assert.deepEqual(JSON.parse(requests[0].options.body), { phone: '13900139000', password: 'secret88', machineId: 'mac-test-001' });
  assert.equal(state.remoteAccount.id, 'user-1');
  assert.equal(Object.hasOwn(state, 'token'), false);
});
