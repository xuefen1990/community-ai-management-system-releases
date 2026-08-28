'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${url}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('测试后端未启动');
}

test('a migrated scrypt account keeps its password and upgrades to bcrypt after login', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-legacy-password-'));
  const dbPath = path.join(directory, 'backend.db');
  const port = await freePort();
  const salt = 'legacy-salt';
  const legacyHash = { algorithm: 'scrypt', salt, hash: crypto.scryptSync('secret88', salt, 64).toString('base64url') };
  await fs.writeFile(dbPath, JSON.stringify({ users: [{
    id: 'legacy-admin', phone: '18888190901', password_hash: legacyHash, name: '系统管理员', role: 'admin',
    account_status: 'active', organization_id: null, permissions: {}, plan_type: 'permanent', plan_expires_at: null,
    machine_id: '', is_active: 1, created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z',
  }] }));
  const child = spawn(process.execPath, ['src/index.js'], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: dbPath,
    UPDATE_FILES_DIR: path.join(directory, 'updates'), JWT_SECRET: 'test-secret', ADMIN_PHONE: '18888190901', ADMIN_PASSWORD: 'unused-password',
  }, stdio: 'ignore' });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url);

  const wrong = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '18888190901', password: 'wrong-password' }) });
  assert.equal(wrong.status, 401);
  assert.deepEqual(JSON.parse(await fs.readFile(dbPath, 'utf8')).users[0].password_hash, legacyHash);

  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '18888190901', password: 'secret88' }) });
  assert.equal(login.status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.match(JSON.parse(await fs.readFile(dbPath, 'utf8')).users[0].password_hash, /^\$2[aby]\$/u);
});

test('an imported trial administrator keeps the original trial end date', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-legacy-trial-'));
  const dbPath = path.join(directory, 'backend.db');
  const port = await freePort();
  const passwordHash = { algorithm: 'scrypt', salt: 'legacy-salt', hash: crypto.scryptSync('secret88', 'legacy-salt', 64).toString('base64url') };
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await fs.writeFile(dbPath, JSON.stringify({ users: [{
    id: 'legacy-trial', phone: '17505270901', password_hash: passwordHash, name: '本机账号', role: 'admin',
    account_status: 'active', organization_id: null, permissions: {}, plan_type: 'trial', plan_expires_at: expiresAt,
    machine_id: '', is_active: 1, created_at: '2026-08-21T00:00:00.000Z', updated_at: '2026-08-21T00:00:00.000Z',
  }] }));
  const child = spawn(process.execPath, ['src/index.js'], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: dbPath,
    UPDATE_FILES_DIR: path.join(directory, 'updates'), JWT_SECRET: 'test-secret', ADMIN_PHONE: '18888190901', ADMIN_PASSWORD: 'unused-password',
  }, stdio: 'ignore' });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url);

  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '17505270901', password: 'secret88' }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const entitlement = await fetch(`${url}/api/auth/entitlement`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(entitlement.status, 200);
  const body = await entitlement.json();
  assert.equal(body.valid, true);
  assert.equal(body.plan, 'trial');
  assert.equal(body.expiresAt, expiresAt);
});
