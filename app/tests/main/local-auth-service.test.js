'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AuthStore } = require('../../src/main/auth-store');
const { LocalAuthService, TRIAL_DURATION_MS } = require('../../src/main/local-auth-service');

async function makeService(t, now = new Date('2026-08-13T00:00:00.000Z')) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-auth-'));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const clock = { now };
  const service = new LocalAuthService({
    store: new AuthStore({ userDataPath }),
    machineId: 'machine-test-001',
    now: () => clock.now,
  });
  return { clock, service };
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
