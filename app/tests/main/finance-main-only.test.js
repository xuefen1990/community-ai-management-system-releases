'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { FoundationAuthService } = require('../../src/main/foundation-auth-service');
test('桌面财务查询与导入也拒绝含历史财务授权的子账号', async () => {
  const member = { id: 'member', mainAccountId: 'owner', role: 'member', permissions: { finance: ['view', 'create', 'update'] } };
  const service = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, account: member, entitlement: { type: 'licensed' } }) } });
  for (const path of ['/finance-records', '/finance-account-balance', '/finance-opening-balance', '/finance-categories']) await assert.rejects(service.authorize({ method: 'GET', path }), /财务仅限主账号/);
  await assert.rejects(service.authorize({ method: 'POST', path: '/import-backup', domain: 'finance' }), /财务仅限主账号/);
});
