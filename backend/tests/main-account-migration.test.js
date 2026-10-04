'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hashPassword } = require('../src/utils/crypto');

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('旧单位工作区和额度迁移到主账号，重复启动不重赠额度', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'main-account-migration-'));
  const dbPath = path.join(directory, 'backend.db');
  const password = hashPassword('ownerpass1');
  const old = {
    users: [
      { id: 'owner-legacy', phone: '13900001001', password_hash: password, name: '旧主账号', role: 'unit_admin', account_status: 'active', organization_id: 'org-legacy', plan_type: 'permanent', is_active: 1, session_version: 0, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'member-legacy', phone: '13900001002', password_hash: hashPassword('memberpass1'), name: '旧成员', role: 'member', account_status: 'active', organization_id: 'org-legacy', is_active: 1, session_version: 0, created_at: '2026-01-01T00:00:00.000Z' },
    ],
    organizations: [{ id: 'org-legacy', name: '旧社区', status: 'active', unit_admin_user_id: 'owner-legacy' }],
    unit_workspaces: [{ id: 'workspace-legacy', organization_id: 'org-legacy', version: 7, data: { personnel: [{ id: 'person-1', name: '原有村民' }] } }],
    ai_quotas: [{ id: 'quota-legacy', organization_id: 'org-legacy', granted_tokens: 5000, used_tokens: 1500, reserved_tokens: 0 }],
    ai_quota_ledger: [{ id: 'ledger-legacy', organization_id: 'org-legacy', event: 'consumption', tokens: 1500, delta_tokens: -1500, balance_after: 3500, user_id: 'member-legacy', created_at: '2026-01-01T00:00:00.000Z' }],
  };
  await fs.writeFile(dbPath, JSON.stringify(old));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const start = () => spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: dbPath, UPDATE_FILES_DIR: path.join(directory, 'updates'), JWT_SECRET: 'migration-test-secret', ADMIN_PHONE: '13800000000', ADMIN_PASSWORD: 'test-admin-bootstrap-pass' },
    stdio: 'ignore',
  });
  let server = null;
  const stop = async () => { if (server) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); server = null; } };
  t.after(async () => { await stop(); await fs.rm(directory, { recursive: true, force: true }); });
  for (let run = 0; run < 2; run += 1) {
    server = start();
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { healthy = (await fetch(`${base}/api/health`)).ok; if (healthy) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(healthy, true);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '13900001001', password: 'ownerpass1' }) });
    assert.equal(login.status, 200);
    const { token, user } = await login.json();
    assert.equal(user.mainAccountId, 'owner-legacy');
    const headers = { Authorization: `Bearer ${token}` };
    const workspace = await (await fetch(`${base}/api/unit/workspace/data`, { headers })).json();
    assert.equal(workspace.version, 7);
    assert.equal(workspace.data.personnel[0].name, '原有村民');
    const quota = await (await fetch(`${base}/api/ai/quota`, { headers })).json();
    assert.equal(quota.quota.totalTokens, 5000);
    assert.equal(quota.quota.remainingTokens, 3500);
    const ledger = await (await fetch(`${base}/api/ai/quota/ledger`, { headers })).json();
    assert.equal(ledger.pagination.total, 1);
    await stop();
  }
  const migrated = JSON.parse(await fs.readFile(dbPath, 'utf8'));
  assert.equal(migrated.users.find(row => row.id === 'member-legacy').main_account_id, 'owner-legacy');
  assert.equal(migrated.unit_workspaces[0].main_account_id, 'owner-legacy');
  assert.equal(migrated.ai_quotas[0].main_account_id, 'owner-legacy');
  assert.equal(migrated.ai_quota_ledger[0].main_account_id, 'owner-legacy');
});
