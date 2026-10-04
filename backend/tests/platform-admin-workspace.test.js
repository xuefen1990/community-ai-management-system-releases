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

test('平台管理员可以管理自己的完整工作区和子账号，不能读取其他主账号工作区', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'platform-admin-workspace-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: path.join(directory, 'backend.db'), UPDATE_FILES_DIR: path.join(directory, 'updates'), JWT_SECRET: 'platform-admin-workspace-test-secret', ADMIN_PHONE: '18888190901', ADMIN_PASSWORD: 'test-admin-password' },
    stdio: 'ignore',
  });
  t.after(async () => {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  let healthy = false;
  for (let i = 0; i < 60; i += 1) {
    try { healthy = (await request(base, '/health')).status === 200; if (healthy) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(healthy, true);

  const initialAdmin = await request(base, '/auth/login', { method: 'POST', body: { phone: '18888190901', password: 'test-admin-password' } });
  assert.equal(initialAdmin.data.user.mustChangePassword, true);
  assert.equal((await request(base, '/auth/password', { method: 'PUT', token: initialAdmin.data.token, body: { oldPassword: 'test-admin-password', newPassword: 'test-admin-working-pass' } })).status, 200);
  const admin = await request(base, '/auth/login', { method: 'POST', body: { phone: '18888190901', password: 'test-admin-working-pass' } });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.role, 'admin');
  assert.equal(admin.data.user.mainAccountId, admin.data.user.id);
  assert.equal((await request(base, '/auth/users', { token: admin.data.token })).status, 200);

  const workspace = await request(base, '/unit/workspace/data', { token: admin.data.token });
  assert.equal(workspace.status, 200);
  assert.deepEqual(workspace.data.data, {});
  const written = await request(base, '/unit/workspace/data', { method: 'PUT', token: admin.data.token, body: {
    version: workspace.data.version,
    data: { personnel: [{ id: 'resident-1', name: '测试居民' }], finances: [{ id: 'entry-1', amount: 75 }] },
  } });
  assert.equal(written.status, 200);
  assert.equal(written.data.mainAccountId, admin.data.user.id);
  const reread = await request(base, '/unit/workspace/data', { token: admin.data.token });
  assert.deepEqual(reread.data.data.personnel, [{ id: 'resident-1', name: '测试居民' }]);
  assert.deepEqual(reread.data.data.finances, [{ id: 'entry-1', amount: 75 }]);

  const member = await request(base, '/auth/unit/members', { method: 'POST', token: admin.data.token, body: {
    phone: '13700000031', name: '测试子账号', preset: 'readonly',
  } });
  assert.equal(member.status, 201);
  assert.equal(member.data.user.mainAccountId, admin.data.user.id);
  const quota = await request(base, '/ai/quota', { token: admin.data.token });
  assert.equal(quota.status, 200);
  assert.equal(quota.data.quota.mainAccountId, admin.data.user.id);

  const other = await request(base, '/auth/register', { method: 'POST', body: { phone: '13900000031', password: 'other-owner-password', confirmPassword: 'other-owner-password' } });
  assert.equal(other.status, 201);
  const otherWorkspace = await request(base, '/unit/workspace/data', { token: other.data.token });
  assert.equal(otherWorkspace.status, 200);
  assert.deepEqual(otherWorkspace.data.data, {});
  const afterOther = await request(base, '/unit/workspace/data', { token: admin.data.token });
  assert.deepEqual(afterOther.data.data.personnel, [{ id: 'resident-1', name: '测试居民' }]);
});
