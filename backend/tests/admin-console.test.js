'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('测试后端未在规定时间内启动');
}

async function request(url, pathName, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${url}/api${pathName}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('管理员可查看前端注册账号、重置密码并安全管理模型', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-backend-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(directory, 'backend.db'),
      UPDATE_FILES_DIR: path.join(directory, 'updates'),
      JWT_SECRET: 'test-only-jwt-secret',
      ADMIN_PHONE: '13800000000',
      ADMIN_PASSWORD: 'admin123456',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await waitForHealth(url);

  const registered = await request(url, '/auth/register', { method: 'POST', body: { phone: '139 0013 9000', password: 'secret88', machineId: 'mac-test-001' } });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.phone, '13900139000');

  const adminLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13800000000', password: 'admin123456' } });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token;

  const page = await request(url, '/auth/users?keyword=139001&page=1&pageSize=10', { token: adminToken });
  assert.equal(page.status, 200);
  assert.equal(page.body.pagination.total, 1);
  assert.equal(page.body.users[0].id, registered.body.user.id);

  const reset = await request(url, `/auth/users/${registered.body.user.id}/reset-password`, { token: adminToken, method: 'POST', body: { newPassword: 'new-secret88' } });
  assert.equal(reset.status, 200);
  const userLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'new-secret88' } });
  assert.equal(userLogin.status, 200);

  const provider = await request(url, '/ai/providers', { token: adminToken, method: 'POST', body: { name: '测试模型', providerType: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'secret-api-key', defaultModel: 'demo-chat', availableModels: ['demo-chat'] } });
  assert.equal(provider.status, 201);
  assert.equal(Object.hasOwn(provider.body.provider, 'apiKey'), false);
  assert.equal(provider.body.provider.hasApiKey, true);

  const overview = await request(url, '/admin/overview', { token: adminToken });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.metrics.registeredUsers, 1);
  assert.equal(overview.body.metrics.activeProviders, 1);
  const staticPage = await fetch(`${url}/admin/`);
  assert.equal(staticPage.status, 200);
  assert.match(staticPage.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/u);
});
