'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { prepareBackendData } = require('../../src/main/backend-data-migrator');

test('copies a complete legacy backend database only when the managed database is absent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-backend-migrate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyPath = path.join(directory, 'legacy.db');
  const userDataPath = path.join(directory, 'user-data');
  const legacy = { _meta: { version: 1 }, users: [{ id: 'admin-1', phone: '18888190901', role: 'admin' }], organizations: [{ id: 'org-1' }] };
  await fs.writeFile(legacyPath, JSON.stringify(legacy));

  const prepared = await prepareBackendData({ userDataPath, legacyBackendPaths: [legacyPath] });
  assert.equal(prepared.migrationSource, 'legacy-backend');
  assert.deepEqual(JSON.parse(await fs.readFile(prepared.dbPath, 'utf8')), legacy);
  assert.equal((await fs.stat(prepared.secretPath)).mode & 0o777, 0o600);

  await fs.writeFile(legacyPath, JSON.stringify({ users: [{ phone: 'changed' }] }));
  const repeated = await prepareBackendData({ userDataPath, legacyBackendPaths: [legacyPath] });
  assert.equal(repeated.migrationSource, 'existing');
  assert.equal(JSON.parse(await fs.readFile(repeated.dbPath, 'utf8')).users[0].phone, '18888190901');
});

test('imports every old local account with its password and entitlement, without exposing plaintext passwords', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-local-owner-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const userDataPath = path.join(directory, 'user-data');
  const legacyAuthPath = path.join(directory, 'local-auth.json');
  const password = { algorithm: 'scrypt', salt: 'legacy-salt', hash: crypto.scryptSync('secret88', 'legacy-salt', 64).toString('base64url') };
  await fs.writeFile(legacyAuthPath, JSON.stringify({ version: 2, accounts: [
    { id: 'member-1', phone: '18888190902', password, createdAt: '2026-08-20T00:00:00.000Z' },
    { id: 'owner-1', phone: '18888190901', password, role: 'owner', createdAt: '2026-08-13T00:00:00.000Z', entitlement: { plan: 'permanent' } },
  ] }));

  const prepared = await prepareBackendData({ userDataPath, legacyAuthPath, legacyBackendPaths: [] });
  const migrated = JSON.parse(await fs.readFile(prepared.dbPath, 'utf8'));
  assert.equal(prepared.migrationSource, 'legacy-local-owner');
  assert.equal(migrated.users.length, 2);
  const owner = migrated.users.find(user => user.phone === '18888190901');
  const member = migrated.users.find(user => user.phone === '18888190902');
  assert.deepEqual(owner.password_hash, password);
  assert.equal(owner.role, 'admin');
  assert.equal(owner.plan_type, 'permanent');
  assert.equal(owner.is_active, 1);
  assert.equal(member.role, 'admin');
  assert.equal(member.plan_type, 'trial');
  assert.match(member.plan_expires_at, /^2026-09-19T/u);
  assert.equal(Object.hasOwn(owner, 'password'), false);
});

test('adds local accounts that were missed by an earlier backend migration without duplicating existing users', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-local-account-merge-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const userDataPath = path.join(directory, 'user-data');
  const dbPath = path.join(userDataPath, 'backend', 'backend.db');
  const legacyAuthPath = path.join(directory, 'local-auth.json');
  const password = { algorithm: 'scrypt', salt: 'legacy-salt', hash: crypto.scryptSync('secret88', 'legacy-salt', 64).toString('base64url') };
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify({ _meta: { version: 1 }, users: [{ id: 'owner-1', phone: '18888190901', password_hash: password, role: 'admin' }] }));
  await fs.writeFile(legacyAuthPath, JSON.stringify({ version: 2, accounts: [
    { id: 'owner-1', phone: '18888190901', password, role: 'owner', entitlement: { plan: 'permanent' } },
    { id: 'member-1', phone: '17505270901', password, entitlement: { plan: 'trial', startedAt: '2026-08-21T00:00:00.000Z' } },
  ] }));

  const prepared = await prepareBackendData({ userDataPath, legacyAuthPath });
  const merged = JSON.parse(await fs.readFile(prepared.dbPath, 'utf8'));
  assert.equal(prepared.migrationSource, 'legacy-local-accounts');
  assert.equal(merged.users.length, 2);
  assert.deepEqual(merged.users.find(user => user.phone === '17505270901').password_hash, password);

  await prepareBackendData({ userDataPath, legacyAuthPath });
  const repeated = JSON.parse(await fs.readFile(prepared.dbPath, 'utf8'));
  assert.equal(repeated.users.length, 2);
});

test('rejects a corrupt legacy backend instead of replacing it with an empty database', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-corrupt-backend-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyPath = path.join(directory, 'legacy.db');
  const userDataPath = path.join(directory, 'user-data');
  await fs.writeFile(legacyPath, '{invalid');

  await assert.rejects(
    () => prepareBackendData({ userDataPath, legacyBackendPaths: [legacyPath] }),
    /历史账号数据库损坏/u,
  );
  await assert.rejects(() => fs.access(path.join(userDataPath, 'backend', 'backend.db')));
  assert.equal(await fs.readFile(legacyPath, 'utf8'), '{invalid');
});

test('rejects a corrupt managed database instead of allowing the backend to replace it', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-corrupt-managed-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const userDataPath = path.join(directory, 'user-data');
  const dbPath = path.join(userDataPath, 'backend', 'backend.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, '{broken');

  await assert.rejects(() => prepareBackendData({ userDataPath }), /本机账号数据库损坏/u);
  assert.equal(await fs.readFile(dbPath, 'utf8'), '{broken');
});
