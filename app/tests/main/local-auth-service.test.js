'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AuthStore } = require('../../src/main/auth-store');
const { LocalAuthService, TRIAL_DURATION_MS } = require('../../src/main/local-auth-service');
const { RememberedLoginStore } = require('../../src/main/remembered-login-store');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/u, ''),
  };
}

async function makeService(t, now = new Date('2026-08-13T00:00:00.000Z')) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-auth-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const clock = { now };
  const store = new AuthStore({ userDataPath });
  const rememberedLoginStore = new RememberedLoginStore({ userDataPath, safeStorage: fakeSafeStorage() });
  const service = new LocalAuthService({
    store,
    rememberedLoginStore,
    machineId: 'machine-test-001',
    now: () => clock.now,
  });
  return { clock, service, rememberedLoginStore };
}

test('registration creates a local session and starts a 30 day trial', async (t) => {
  const { service } = await makeService(t);
  const status = await service.register({ phone: '138 0013 8000', password: 'secret88' });

  assert.equal(status.authenticated, true);
  assert.equal(status.account.phone, '13800138000');
  assert.equal(status.entitlement.type, 'trial');
  assert.equal(status.entitlement.remainingDays, 30);
});

test('password is hashed and login rejects an incorrect password', async (t) => {
  const { service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88' });
  service.logout();

  await assert.rejects(
    () => service.login({ phone: '13800138000', password: 'wrong-password' }),
    /手机号或密码不正确/u,
  );
  assert.equal((await service.login({ phone: '13800138000', password: 'secret88' })).authenticated, true);
});

test('trial expires exactly after 30 days', async (t) => {
  const { clock, service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88' });
  clock.now = new Date(clock.now.getTime() + TRIAL_DURATION_MS);

  const status = await service.getStatus();
  assert.equal(status.entitlement.type, 'expired');
  assert.equal(status.entitlement.remainingMs, 0);
});

test('duplicate local phone registration is rejected', async (t) => {
  const { service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88' });
  await assert.rejects(
    () => service.register({ phone: '13800138000', password: 'another88' }),
    /已在本机注册/u,
  );
});

test('clock rollback is rejected during login', async (t) => {
  const { clock, service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88' });
  service.logout();
  clock.now = new Date('2026-08-12T20:00:00.000Z');

  await assert.rejects(
    () => service.login({ phone: '13800138000', password: 'secret88' }),
    /系统时间回退/u,
  );
});

test('valid offline activation replaces trial entitlement', async (t) => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-activation-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const service = new LocalAuthService({
    store: new AuthStore({ userDataPath }),
    machineId: 'machine-test-001',
    now: () => new Date('2026-08-13T00:00:00.000Z'),
    verifyActivation: async (code, machineId) => code === 'valid-code' && machineId === 'machine-test-001'
      ? { valid: true, license: { plan: 'permanent', expiresAt: null } }
      : { valid: false, error: '授权码无效' },
  });
  await service.register({ phone: '13800138000', password: 'secret88' });

  const status = await service.activate('valid-code');
  assert.equal(status.entitlement.type, 'licensed');
  assert.equal(status.entitlement.plan, 'permanent');
});

test('single legacy account becomes the permanent local owner without restoring its session', async (t) => {
  const { service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88', remember: false });
  const legacyState = await service.store.read();
  legacyState.version = 1;
  delete legacyState.accounts[0].entitlement;
  legacyState.rememberedAccountId = null;
  await service.store.write(legacyState);
  service.sessionAccountId = null;
  const status = await service.getStatus();
  assert.equal(status.authenticated, false);
  const migrated = await service.store.read();
  assert.equal(migrated.accounts[0].role, 'owner');
  assert.equal(migrated.accounts[0].entitlement.plan, 'permanent');
});

test('remembered account prefills the login form but does not restore a session', async (t) => {
  const { service, rememberedLoginStore } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88', remember: true });
  const restoredService = new LocalAuthService({
    store: service.store,
    rememberedLoginStore,
    machineId: 'machine-test-001',
    now: () => new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal((await restoredService.getStatus()).authenticated, false);
  assert.deepEqual(await restoredService.getLoginPrefill(), {
    phone: '13800138000', password: 'secret88', remembered: true, warning: '',
  });
  await restoredService.clearLoginPrefill();
  assert.deepEqual(await restoredService.getLoginPrefill(), {
    phone: '', password: '', remembered: false, warning: '',
  });
  await restoredService.login({ phone: '13800138000', password: 'secret88', remember: false });
  assert.deepEqual(await restoredService.getLoginPrefill(), {
    phone: '13800138000', password: '', remembered: false, warning: '',
  });
});

test('local owner can grant permanent and custom expiry access to another account', async (t) => {
  const { clock, service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88', remember: false });
  const state = await service.store.read();
  state.version = 1;
  delete state.accounts[0].entitlement;
  await service.store.write(state);
  await service.logout();
  await service.login({ phone: '13800138000', password: 'secret88' });
  await service.register({ phone: '13900139000', password: 'secret88', remember: false });
  const otherAccountId = (await service.getStatus()).account.id;
  await service.login({ phone: '13800138000', password: 'secret88' });

  let accounts = await service.setAccountEntitlement({ accountId: otherAccountId, plan: 'permanent' });
  assert.equal(accounts.find((account) => account.id === otherAccountId).entitlement.plan, 'permanent');
  clock.now = new Date('2026-08-14T00:00:00.000Z');
  accounts = await service.setAccountEntitlement({
    accountId: otherAccountId,
    plan: 'expires',
    expiresAt: '2026-09-01T00:00:00.000Z',
  });
  assert.equal(accounts.find((account) => account.id === otherAccountId).entitlement.expiresAt, '2026-09-01T00:00:00.000Z');
});

test('non-owner cannot change local account entitlement', async (t) => {
  const { service } = await makeService(t);
  await service.register({ phone: '13800138000', password: 'secret88', remember: false });
  const firstAccountId = (await service.getStatus()).account.id;
  await service.register({ phone: '13900139000', password: 'secret88', remember: false });
  await assert.rejects(
    () => service.setAccountEntitlement({ accountId: firstAccountId, plan: 'permanent' }),
    /只有本机主账号/u,
  );
});
