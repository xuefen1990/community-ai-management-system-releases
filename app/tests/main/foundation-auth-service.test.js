'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FoundationAuthService, productStatus } = require('../../src/main/foundation-auth-service');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { registerFoundationHandlers } = require('../../src/main/foundation-ipc-handlers');
const { FOUNDATION_CHANNELS, INVOKE_CHANNELS } = require('../../src/shared/ipc-contract');

test('cached entitlement alone never authenticates the new foundation', () => {
  assert.equal(productStatus({ authenticated: false, entitlement: { type: 'licensed' } }).state, 'login-required');
  assert.equal(productStatus({ authenticated: true, entitlement: { type: 'expired' } }).state, 'expired');
  assert.equal(productStatus({ authenticated: true, entitlement: { type: 'trial', remainingMs: 60000 } }).trialRemainingMs, 60000);
  assert.equal(productStatus({ authenticated: true, account: { mustChangePassword: true }, entitlement: { type: 'licensed' } }).state, 'password-change-required');
});

test('foundation login and logout delegate to the community account service', async () => {
  const calls = []; let authenticated = false;
  const status = () => ({ authenticated, account: authenticated ? { phone: '10000000000' } : null, entitlement: { type: authenticated ? 'licensed' : 'none' } });
  const auth = new FoundationAuthService({ ensureReady: async () => calls.push('ready'), authService: {
    getStatus: async () => status(), login: async value => { calls.push(value); authenticated = true; return status(); },
    logout: async () => { authenticated = false; calls.push('logout'); },
  } });
  assert.equal((await auth.bootstrap()).state, 'login-required');
  const credentials = { phone: '10000000000', password: 'synthetic-test-only', remember: false };
  assert.equal((await auth.login(credentials)).state, 'licensed');
  assert.equal((await auth.logout()).state, 'login-required');
  assert.deepEqual(calls, ['ready', credentials, 'logout']);
  await assert.rejects(auth.continueTrial(), { code: 'PRODUCT_AUTH_REQUIRED' });
});

test('concurrent authorization checks coalesce but do not reuse a status after logout', async () => {
  let count = 0; let authenticated = true;
  const auth = new FoundationAuthService({ authService: { getStatus: async () => {
    count++; await new Promise(resolve => setImmediate(resolve)); return { authenticated, entitlement: { type: 'licensed' } };
  } } });
  await Promise.all([auth.bootstrap(), auth.bootstrap(), auth.authorize({ method: 'GET', path: '/people' })]);
  assert.equal(count, 1); authenticated = false;
  await assert.rejects(auth.authorize({ method: 'GET', path: '/people' }), { code: 'PRODUCT_AUTH_REQUIRED' });
});

test('members cannot read unrelated domains or delete records with view-only permission', async () => {
  const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' },
    account: { role: 'member', permissions: { personnel: ['view'] } } }) } });
  await auth.authorize({ method: 'GET', path: '/people' });
  await assert.rejects(auth.authorize({ method: 'DELETE', path: '/people/p1' }), { code: 'FORBIDDEN' });
  await assert.rejects(auth.authorize({ method: 'GET', path: '/finance-records' }), { code: 'FORBIDDEN' });
});

test('workspace permission does not grant access to another business module', async () => {
  const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' },
    account: { role: 'member', permissions: { workspace: ['view', 'update'], personnel: ['view'] } } }) } });
  await auth.authorize({ method: 'GET', path: '/people' });
  await assert.rejects(auth.authorize({ method: 'PATCH', path: '/people/p1' }), { code: 'FORBIDDEN' });
  await assert.rejects(auth.authorize({ method: 'GET', path: '/documents' }), { code: 'FORBIDDEN' });
});

test('foundation IPC adds distinct channels, preserves legacy API names, and returns visible auth failures', async () => {
  const all = [...Object.values(INVOKE_CHANNELS), ...Object.values(FOUNDATION_CHANNELS)];
  for (const channel of Object.values(FOUNDATION_CHANNELS)) assert.equal(all.filter(value => value === channel).length, 1);
  const handlers = new Map();
  registerFoundationHandlers({ handle: (name, callback) => handlers.set(name, callback), store: {}, authService: null });
  assert.equal(handlers.size, Object.keys(FOUNDATION_CHANNELS).length + 1);
  const result = await handlers.get(FOUNDATION_CHANNELS.bootstrapProductAuth)({});
  assert.equal(result.ok, false); assert.equal(result.error.code, 'AUTH_UNAVAILABLE');
});

test('a create-only member cannot use import upsert to overwrite an existing resident', async () => {
  const database = { personnel: [{ id: 'existing', name: '合成居民', idCard: 'TEST-CARD', bankAccounts: [{ id: 'kept' }] }] };
  const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' },
    account: { role: 'member', permissions: { personnel: ['view', 'create'] } } }) } });
  const business = new FoundationBusinessService({ authorize: request => auth.authorize(request), store: {
    read: async () => structuredClone(database), update: async mutator => ({ result: await mutator(database) }),
  } });
  const result = await business.request({ method: 'POST', path: '/api/v3/people/batch-upsert', body: { items: [{ fields: { idCard: 'TEST-CARD', name: '不应覆盖' } }] } });
  assert.equal(result.data.failed[0].code, 'FORBIDDEN'); assert.equal(database.personnel[0].name, '合成居民');
  await assert.rejects(auth.authorize({ method: 'POST', path: '/people/batch-patch' }), { code: 'FORBIDDEN' });
});

test('member imports can request an internal backup without listing or restoring the whole workspace', async () => {
  const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' }, account: { role: 'member', permissions: { personnel: ['view', 'create'] } } }) } });
  await auth.authorize({ method: 'POST', path: '/import-backup', domain: 'personnel' });
  await assert.rejects(auth.authorize({ method: 'POST', path: '/import-backup', domain: 'land' }), { code: 'FORBIDDEN' });
  for (const method of ['GET', 'POST', 'PATCH']) await assert.rejects(auth.authorize({ method, path: '/backup' }), { code: 'FORBIDDEN' });
});

test('档案维护人员可以创建档案分类但不能借此修改其他系统字典', async () => {
  const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' },
    account: { role: 'member', permissions: { document: ['view', 'create'] } } }) } });
  await auth.authorize({ method: 'POST', path: '/dictionaries', domain: 'document' });
  await assert.rejects(auth.authorize({ method: 'POST', path: '/dictionaries', domain: '' }), { code: 'FORBIDDEN' });
  await assert.rejects(auth.authorize({ method: 'DELETE', path: '/dictionaries/category-1', domain: 'document' }), { code: 'FORBIDDEN' });
});
