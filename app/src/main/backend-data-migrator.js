'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const BACKEND_COLLECTIONS = [
  'users',
  'organizations',
  'unit_admin_applications',
  'member_applications',
  'unit_invites',
  'unit_workspaces',
  'licenses',
  'versions',
  'ai_providers',
  'ai_usage',
  'audit_logs',
];

async function exists(filePath, fsImpl) {
  try {
    await fsImpl.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function parseJson(raw, errorMessage) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(errorMessage);
  }
}

function validateBackend(value, errorMessage = '历史账号数据库损坏，已保留原文件，请检查后重试') {
  if (!value || typeof value !== 'object' || !Array.isArray(value.users)) {
    throw new Error(errorMessage);
  }
  return value;
}

function backendFromLocalOwner(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.accounts)) {
    throw new Error('旧本机账号文件损坏，已保留原文件，请检查后重试');
  }
  const owner = state.accounts.find(account => account?.role === 'owner') || null;
  if (!owner?.phone || !owner.password) return null;
  const now = new Date().toISOString();
  const createdAt = owner.createdAt || now;
  const data = Object.fromEntries(BACKEND_COLLECTIONS.map(name => [name, []]));
  data._meta = { version: 1, createdAt: now, migratedFrom: 'local-auth' };
  data.users.push({
    id: owner.id || crypto.randomUUID(),
    phone: String(owner.phone),
    password_hash: structuredClone(owner.password),
    name: '系统管理员',
    role: 'admin',
    account_status: 'active',
    organization_id: null,
    permissions: {},
    village_name: '',
    plan_type: owner.entitlement?.plan === 'permanent' ? 'permanent' : (owner.entitlement?.plan || 'permanent'),
    plan_expires_at: owner.entitlement?.expiresAt || null,
    trial_started_at: owner.trialStartedAt || null,
    machine_id: '',
    is_active: 1,
    last_login_at: null,
    created_at: createdAt,
    updated_at: now,
  });
  return data;
}

async function atomicWrite(filePath, content, fsImpl, mode = 0o600) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fsImpl.writeFile(temporaryPath, content, { encoding: 'utf8', mode });
    await fsImpl.rename(temporaryPath, filePath);
  } catch (error) {
    await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readFirstLegacyBackend(paths, fsImpl) {
  for (const candidate of paths || []) {
    if (!candidate || !(await exists(candidate, fsImpl))) continue;
    const raw = await fsImpl.readFile(candidate, 'utf8');
    return { value: validateBackend(parseJson(raw, '历史账号数据库损坏，已保留原文件，请检查后重试')), raw };
  }
  return null;
}

async function prepareBackendData({
  userDataPath,
  legacyBackendPaths = [],
  legacyAuthPath = path.join(userDataPath, 'license', 'local-auth.json'),
  fsImpl = fs,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!userDataPath) throw new Error('缺少应用数据目录，无法启动本机账号服务');
  const backendDirectory = path.join(userDataPath, 'backend');
  const dbPath = path.join(backendDirectory, 'backend.db');
  const updatesDir = path.join(backendDirectory, 'updates');
  const secretPath = path.join(backendDirectory, 'service-secret');
  const markerPath = path.join(backendDirectory, 'migration.json');
  await fsImpl.mkdir(updatesDir, { recursive: true });

  let migrationSource = 'existing';
  if (await exists(dbPath, fsImpl)) {
    const managedDatabaseError = '本机账号数据库损坏，已保留原文件，请检查后重试';
    validateBackend(parseJson(await fsImpl.readFile(dbPath, 'utf8'), managedDatabaseError), managedDatabaseError);
  } else {
    const legacyBackend = await readFirstLegacyBackend(legacyBackendPaths, fsImpl);
    if (legacyBackend) {
      await atomicWrite(dbPath, legacyBackend.raw, fsImpl);
      migrationSource = 'legacy-backend';
    } else if (legacyAuthPath && await exists(legacyAuthPath, fsImpl)) {
      const raw = await fsImpl.readFile(legacyAuthPath, 'utf8');
      const migrated = backendFromLocalOwner(parseJson(raw, '旧本机账号文件损坏，已保留原文件，请检查后重试'));
      if (migrated) {
        await atomicWrite(dbPath, `${JSON.stringify(migrated, null, 2)}\n`, fsImpl);
        migrationSource = 'legacy-local-owner';
      } else {
        migrationSource = 'new';
      }
    } else {
      migrationSource = 'new';
    }
    await atomicWrite(markerPath, `${JSON.stringify({ source: migrationSource, completedAt: new Date().toISOString() }, null, 2)}\n`, fsImpl);
  }

  let secret;
  if (await exists(secretPath, fsImpl)) {
    secret = (await fsImpl.readFile(secretPath, 'utf8')).trim();
  } else {
    secret = randomBytes(48).toString('base64url');
    await atomicWrite(secretPath, `${secret}\n`, fsImpl);
  }
  await fsImpl.chmod(secretPath, 0o600);
  return { backendDirectory, dbPath, updatesDir, secretPath, secret, markerPath, migrationSource };
}

module.exports = { BACKEND_COLLECTIONS, backendFromLocalOwner, prepareBackendData };
