'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(base, pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}/api${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

test('主账号直接开通成员、首次改密和逐人 AI 权限', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unit-member-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: path.join(directory, 'backend.db'), UPDATE_FILES_DIR: path.join(directory, 'updates'), JWT_SECRET: 'unit-member-test-jwt-secret', ADMIN_PHONE: '13800000000', ADMIN_PASSWORD: 'test-admin-bootstrap-pass' },
    stdio: 'ignore',
  });
  t.after(async () => { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await request(base, '/health')).status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const admin = await request(base, '/auth/register', { method: 'POST', body: { phone: '13900000001', password: 'adminpass1', confirmPassword: 'adminpass1' } });
  assert.equal(admin.status, 201);

  const catalog = await request(base, '/auth/unit/permissions/catalog', { token: admin.data.token });
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.modules.some(item => item.id === 'document'));

  const created = await request(base, '/auth/unit/members', { method: 'POST', token: admin.data.token, body: { phone: '13700000001', name: '经办员', preset: 'custom', permissions: { personnel: ['view'], document: ['view'] }, aiAccessEnabled: true } });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.mustChangePassword, true);
  assert.equal(created.data.user.password_hash, undefined);
  assert.ok(created.data.initialPassword.length >= 16);
  const duplicate = await request(base, '/auth/unit/members', { method: 'POST', token: admin.data.token, body: { phone: '13700000001', name: '重复', preset: 'custom' } });
  assert.equal(duplicate.status, 409);
  const invalidPermission = await request(base, '/auth/unit/members', { method: 'POST', token: admin.data.token, body: { phone: '13700000002', name: '错误权限', preset: 'custom', permissions: { unknown: ['view'] } } });
  assert.equal(invalidPermission.status, 400);
  const memberLogin = await request(base, '/auth/login', { method: 'POST', body: { phone: '13700000001', password: created.data.initialPassword } });
  assert.equal(memberLogin.status, 200);
  const beforeChange = await request(base, '/ai/quota', { token: memberLogin.data.token });
  assert.equal(beforeChange.status, 403);
  const changed = await request(base, '/auth/password', { method: 'PUT', token: memberLogin.data.token, body: { oldPassword: created.data.initialPassword, newPassword: 'memberpass2' } });
  assert.equal(changed.status, 200);
  assert.equal((await request(base, '/auth/profile', { token: memberLogin.data.token })).status, 401);
  const readyLogin = await request(base, '/auth/login', { method: 'POST', body: { phone: '13700000001', password: 'memberpass2' } });
  assert.equal(readyLogin.data.user.mustChangePassword, false);
  assert.equal((await request(base, '/ai/quota', { token: readyLogin.data.token })).status, 200);
  assert.equal((await request(base, '/auth/unit/members', { token: readyLogin.data.token })).status, 403);

  const adminWorkspace = await request(base, '/unit/workspace/data', { token: admin.data.token });
  const seeded = await request(base, '/unit/workspace/data', { method: 'PUT', token: admin.data.token, body: { version: adminWorkspace.data.version, data: { personnel: [{ id: 'person-1', name: '甲' }], finances: [{ id: 'finance-1', amount: 100 }] } } });
  assert.equal(seeded.status, 200);
  const visible = await request(base, '/unit/workspace/data', { token: readyLogin.data.token });
  assert.equal(visible.status, 200);
  assert.deepEqual(visible.data.data.personnel, [{ id: 'person-1', name: '甲' }]);
  assert.equal(visible.data.data.finances, undefined);
  const readonlyWrite = await request(base, '/unit/workspace/data', { method: 'PUT', token: readyLogin.data.token, body: { version: visible.data.version, data: { personnel: [{ id: 'person-1', name: '乙' }] } } });
  assert.equal(readonlyWrite.status, 403);
  const unknownWrite = await request(base, '/unit/workspace/data', { method: 'PUT', token: readyLogin.data.token, body: { version: visible.data.version, data: { unknownCollection: [] } } });
  assert.equal(unknownWrite.status, 403);
  const hiddenWrite = await request(base, '/unit/workspace/data', { method: 'PUT', token: readyLogin.data.token, body: { version: visible.data.version, data: { finances: [] } } });
  assert.equal(hiddenWrite.status, 403);

  const edited = await request(base, `/auth/unit/members/${created.data.user.id}/permissions`, { method: 'PUT', token: admin.data.token, body: { permissions: { personnel: ['view', 'update'] }, aiAccessEnabled: false } });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.user.aiAccessEnabled, false);
  assert.equal((await request(base, '/auth/profile', { token: readyLogin.data.token })).status, 401);
  const deniedLogin = await request(base, '/auth/login', { method: 'POST', body: { phone: '13700000001', password: 'memberpass2' } });
  assert.equal((await request(base, '/ai/quota', { token: deniedLogin.data.token })).status, 200);
  assert.equal((await request(base, '/ai/models', { token: deniedLogin.data.token })).status, 403);
  assert.equal((await request(base, '/auth/unit/permissions/catalog', { token: deniedLogin.data.token })).status, 403);
  const editable = await request(base, '/unit/workspace/data', { token: deniedLogin.data.token });
  const updated = await request(base, '/unit/workspace/data', { method: 'PUT', token: deniedLogin.data.token, body: { version: editable.data.version, data: { personnel: [{ id: 'person-1', name: '乙' }] } } });
  assert.equal(updated.status, 200);
  const unauthorizedDelete = await request(base, '/unit/workspace/data', { method: 'PUT', token: deniedLogin.data.token, body: { version: updated.data.version, data: { personnel: [] } } });
  assert.equal(unauthorizedDelete.status, 403);
  const unauthorizedAdd = await request(base, '/unit/workspace/data', { method: 'PUT', token: deniedLogin.data.token, body: { version: updated.data.version, data: { personnel: [{ id: 'person-1', name: '乙' }, { id: 'person-2', name: '丙' }] } } });
  assert.equal(unauthorizedAdd.status, 403);
  const missingIdentity = await request(base, '/unit/workspace/data', { method: 'PUT', token: deniedLogin.data.token, body: { version: updated.data.version, data: { personnel: [{ name: '冒充更新的新记录' }] } } });
  assert.equal(missingIdentity.status, 400);
  const duplicateIdentity = await request(base, '/unit/workspace/data', { method: 'PUT', token: deniedLogin.data.token, body: { version: updated.data.version, data: { personnel: [{ id: 'person-1', name: '乙' }, { id: 'person-1', name: '重复记录' }] } } });
  assert.equal(duplicateIdentity.status, 400);
  const reset = await request(base, `/auth/unit/members/${created.data.user.id}/reset-password`, { method: 'POST', token: admin.data.token });
  assert.equal(reset.status, 200);
  assert.ok(reset.data.initialPassword);
  assert.equal((await request(base, '/auth/profile', { token: deniedLogin.data.token })).status, 401);
  const resetLogin = await request(base, '/auth/login', { method: 'POST', body: { phone: '13700000001', password: reset.data.initialPassword } });
  assert.equal(resetLogin.data.user.mustChangePassword, true);

  const secondOwner = await request(base, '/auth/register', { method: 'POST', body: { phone: '13900000002', password: 'ownerpass2', confirmPassword: 'ownerpass2' } });
  assert.equal(secondOwner.status, 201);
  const separateWorkspace = await request(base, '/unit/workspace/data', { token: secondOwner.data.token });
  assert.equal(separateWorkspace.status, 200);
  assert.deepEqual(separateWorkspace.data.data, {});
  const separateQuota = await request(base, '/ai/quota', { token: secondOwner.data.token });
  assert.equal(separateQuota.data.quota.mainAccountId, secondOwner.data.user.id);
  assert.equal(separateQuota.data.quota.totalTokens, 1000000);
  const unrelatedMember = await request(base, `/auth/unit/members/${created.data.user.id}/permissions`, { method: 'PUT', token: secondOwner.data.token, body: { permissions: { personnel: ['view'] } } });
  assert.equal(unrelatedMember.status, 404);
  const duplicateRegistration = await request(base, '/auth/register', { method: 'POST', body: { phone: '13900000002', password: 'ownerpass2', confirmPassword: 'ownerpass2' } });
  assert.equal(duplicateRegistration.status, 409);
  assert.equal((await request(base, '/ai/quota', { token: secondOwner.data.token })).data.quota.totalTokens, 1000000);
});
