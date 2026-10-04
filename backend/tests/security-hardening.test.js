'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.resolve(__dirname, '..');
const secureEnv = {
  ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1',
  JWT_SECRET: 'test-only-random-secret-with-more-than-32-bytes',
  ADMIN_PHONE: '18888190901', ADMIN_PASSWORD: 'test-bootstrap-password',
  CORS_ORIGINS: 'https://admin.example.test',
};

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(base, pathname, { method = 'GET', token, body, origin } = {}) {
  const response = await fetch(`${base}/api${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}

test('production rejects missing secrets, weak bootstrap passwords and open CORS', () => {
  for (const [overrides, message] of [
    [{ JWT_SECRET: '' }, 'JWT_SECRET'],
    [{ ADMIN_PASSWORD: '' }, 'ADMIN_PASSWORD'],
    [{ ADMIN_PASSWORD: 'admin123456' }, 'ADMIN_PASSWORD'],
    [{ CORS_ORIGINS: '*' }, 'CORS_ORIGINS'],
  ]) {
    const result = spawnSync(process.execPath, ['src/index.js'], {
      cwd: backendRoot, env: { ...secureEnv, ...overrides }, encoding: 'utf8', timeout: 2000,
    });
    assert.equal(result.status, 1);
    assert.match(`${result.stderr}${result.stdout}`, new RegExp(message));
  }
});

test('production refuses to start when an existing administrator still has the public default password', () => {
  const directory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'backend-weak-admin-'));
  try {
    const passwordHash = require('bcryptjs').hashSync('admin123456', 10);
    const dbPath = path.join(directory, 'backend.db');
    fsSync.writeFileSync(dbPath, JSON.stringify({ users: [{ id: 'old-admin', role: 'admin', phone: secureEnv.ADMIN_PHONE, password_hash: passwordHash }] }));
    const result = spawnSync(process.execPath, ['src/index.js'], {
      cwd: backendRoot,
      env: { ...secureEnv, DB_PATH: dbPath, UPDATE_FILES_DIR: path.join(directory, 'updates') },
      encoding: 'utf8', timeout: 3000,
    });
    assert.equal(result.status, 1);
    assert.match(`${result.stderr}${result.stdout}`, /现有平台管理员仍使用公开弱密码/u);
  } finally { fsSync.rmSync(directory, { recursive: true, force: true }); }
});

test('login locks after ten failures and a platform admin can unlock it', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-security-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: backendRoot,
    env: { ...secureEnv, PORT: String(port), DB_PATH: path.join(directory, 'backend.db'), UPDATE_FILES_DIR: path.join(directory, 'updates') },
    stdio: 'ignore',
  });
  t.after(async () => {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  let healthy = false;
  for (let i = 0; i < 80; i += 1) {
    try { healthy = (await request(base, '/health')).status === 200; if (healthy) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(healthy, true);
  const corsResponse = await request(base, '/health', { origin: 'https://admin.example.test' });
  assert.equal(corsResponse.headers.get('access-control-allow-origin'), 'https://admin.example.test');
  const otherOrigin = await request(base, '/health', { origin: 'https://other.example.test' });
  assert.equal(otherOrigin.headers.get('access-control-allow-origin'), null);

  const initialAdmin = await request(base, '/auth/login', { method: 'POST', body: { phone: secureEnv.ADMIN_PHONE, password: secureEnv.ADMIN_PASSWORD } });
  assert.equal(initialAdmin.data.user.mustChangePassword, true);
  assert.equal((await request(base, '/auth/password', { method: 'PUT', token: initialAdmin.data.token, body: { oldPassword: secureEnv.ADMIN_PASSWORD, newPassword: 'test-working-password' } })).status, 200);
  const admin = await request(base, '/auth/login', { method: 'POST', body: { phone: secureEnv.ADMIN_PHONE, password: 'test-working-password' } });
  const registered = await request(base, '/auth/register', { method: 'POST', body: { phone: '13900139000', password: 'test-member-password', confirmPassword: 'test-member-password' } });
  assert.equal(registered.status, 201);
  for (let i = 0; i < 10; i += 1) {
    const failed = await request(base, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'wrong-password' } });
    assert.equal(failed.status, 401);
  }
  assert.equal((await request(base, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'test-member-password' } })).status, 401);
  assert.equal((await request(base, `/auth/users/${registered.data.user.id}/unlock-login`, { method: 'POST', token: admin.data.token })).status, 200);
  assert.equal((await request(base, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'test-member-password' } })).status, 200);
});
