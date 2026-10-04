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

function localAccountPlan(account, now) {
  const entitlement = account?.entitlement || {};
  if (entitlement.plan === 'permanent') return { plan_type: 'permanent', plan_expires_at: null };
  if (entitlement.plan === 'expires' && !Number.isNaN(new Date(entitlement.expiresAt).getTime())) {
    return { plan_type: 'expires', plan_expires_at: new Date(entitlement.expiresAt).toISOString() };
  }
  const startedAt = entitlement.startedAt || account?.trialStartedAt || account?.createdAt || now;
  const started = new Date(startedAt);
  const expiresAt = Number.isNaN(started.getTime())
    ? new Date(now).getTime() + 30 * 24 * 60 * 60 * 1000
    : started.getTime() + 30 * 24 * 60 * 60 * 1000;
  return { plan_type: 'trial', plan_expires_at: new Date(expiresAt).toISOString() };
}

function backendUsersFromLocalAccounts(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.accounts)) {
    throw new Error('旧本机账号文件损坏，已保留原文件，请检查后重试');
  }
  const now = new Date().toISOString();
  return state.accounts
    .filter(account => account?.phone && account?.password)
    .map((account) => {
      const createdAt = account.createdAt || now;
      return {
        id: account.id || crypto.randomUUID(),
        phone: String(account.phone),
        password_hash: structuredClone(account.password),
        name: account.name || '本机账号',
        // 旧版本机账号并没有区分线上角色；迁移后均保留本机完整使用权限。
        role: 'admin',
        account_status: 'active',
        organization_id: null,
        permissions: {},
        village_name: '',
        ...localAccountPlan(account, now),
        trial_started_at: account.trialStartedAt || createdAt,
        machine_id: '',
        is_active: 1,
        last_login_at: null,
        created_at: createdAt,
        updated_at: now,
      };
    });
}

function backendFromLocalOwner(state) {
  const users = backendUsersFromLocalAccounts(state);
  if (!users.length) return null;
  const now = new Date().toISOString();
  const data = Object.fromEntries(BACKEND_COLLECTIONS.map(name => [name, []]));
  data._meta = { version: 1, createdAt: now, migratedFrom: 'local-auth' };
  data.users.push(...users);
  return data;
}

function mergeLegacyLocalAccounts(database, state) {
  const existingPhones = new Set(database.users.map(user => String(user?.phone || '')));
  const additions = backendUsersFromLocalAccounts(state)
    .filter(user => !existingPhones.has(user.phone));
  if (!additions.length) return false;
  database.users.push(...additions);
  return true;
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
  let database;
  if (await exists(dbPath, fsImpl)) {
    const managedDatabaseError = '本机账号数据库损坏，已保留原文件，请检查后重试';
    database = validateBackend(parseJson(await fsImpl.readFile(dbPath, 'utf8'), managedDatabaseError), managedDatabaseError);
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

  if (legacyAuthPath && await exists(legacyAuthPath, fsImpl)) {
    const legacyState = parseJson(
      await fsImpl.readFile(legacyAuthPath, 'utf8'),
      '旧本机账号文件损坏，已保留原文件，请检查后重试',
    );
    if (!database) database = validateBackend(parseJson(await fsImpl.readFile(dbPath, 'utf8')));
    if (mergeLegacyLocalAccounts(database, legacyState)) {
      await atomicWrite(dbPath, `${JSON.stringify(database, null, 2)}\n`, fsImpl);
      migrationSource = migrationSource === 'existing' ? 'legacy-local-accounts' : migrationSource;
    }
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

module.exports = {
  BACKEND_COLLECTIONS,
  backendFromLocalOwner,
  backendUsersFromLocalAccounts,
  mergeLegacyLocalAccounts,
  prepareBackendData,
};
