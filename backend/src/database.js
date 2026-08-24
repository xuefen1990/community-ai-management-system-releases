'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');

const dbPath = path.resolve(config.dbPath);
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const DEFAULT_DATA = {
  _meta: { version: 1, createdAt: new Date().toISOString() },
  users: [],
  organizations: [],
  unit_admin_applications: [],
  member_applications: [],
  unit_invites: [],
  licenses: [],
  versions: [],
  ai_providers: [],
  ai_usage: [],
  audit_logs: [],
};

function load() {
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_DATA, ...parsed, _meta: { ...DEFAULT_DATA._meta, ...(parsed._meta || {}) } };
    } catch (e) {
      const backup = dbPath + '.corrupt.' + Date.now();
      fs.copyFileSync(dbPath, backup);
      console.error(`[DB] 数据文件损坏，已备份到 ${backup}，重建新数据库`);
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

let data = load();
let writeTimer = null;

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, dbPath);
  }, 100);
}

function flushNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dbPath);
}

function genId() {
  return require('uuid').v4();
}

function now() {
  return new Date().toISOString();
}

// ===== 通用查询辅助 =====

function findById(collection, id) {
  return data[collection].find(r => r.id === id) || null;
}

function findOne(collection, predicate) {
  return data[collection].find(predicate) || null;
}

function findAll(collection, predicate) {
  if (!predicate) return [...data[collection]];
  return data[collection].filter(predicate);
}

function insert(collection, record) {
  data[collection].push(record);
  persist();
  return record;
}

function updateById(collection, id, patch) {
  const idx = data[collection].findIndex(r => r.id === id);
  if (idx === -1) return null;
  data[collection][idx] = { ...data[collection][idx], ...patch };
  persist();
  return data[collection][idx];
}

function removeById(collection, id) {
  const idx = data[collection].findIndex(r => r.id === id);
  if (idx === -1) return false;
  data[collection].splice(idx, 1);
  persist();
  return true;
}

function count(collection, predicate) {
  if (!predicate) return data[collection].length;
  return data[collection].filter(predicate).length;
}

// ===== 初始化默认数据 =====

function ensureDefaultData() {
  const bcrypt = require('bcryptjs');
  const { encrypt } = require('./utils/crypto');
  const { v4: uuidv4 } = require('uuid');

  // 管理员账号
  const admin = data.users.find(u => u.role === 'admin');
  if (!admin) {
    const nowStr = now();
    const hash = bcrypt.hashSync(config.admin.password, 10);
    data.users.push({
      id: uuidv4(),
      phone: config.admin.phone,
      password_hash: hash,
      name: '系统管理员',
      role: 'admin',
      village_name: '',
      plan_type: 'permanent',
      plan_expires_at: null,
      trial_started_at: null,
      machine_id: '',
      is_active: 1,
      last_login_at: null,
      created_at: nowStr,
      updated_at: nowStr,
    });
    console.log(`[DB] 已创建默认管理员账号: ${config.admin.phone}`);
  }

  // 默认 AI Provider
  const provider = data.ai_providers.find(p => p.is_active === 1);
  if (!provider && config.ai.defaultApiKey) {
    const nowStr = now();
    const encrypted = encrypt(config.ai.defaultApiKey);
    data.ai_providers.push({
      id: uuidv4(),
      name: '默认大模型',
      provider_type: 'deepseek',
      base_url: config.ai.defaultBaseUrl,
      api_key_encrypted: encrypted,
      default_model: config.ai.defaultModel,
      available_models: JSON.stringify([config.ai.defaultModel]),
      is_active: 1,
      created_at: nowStr,
      updated_at: nowStr,
    });
    console.log('[DB] 已创建默认 AI 大模型配置');
  }

  persist();
}

ensureDefaultData();

// 退出时持久化
process.on('SIGTERM', () => { flushNow(); });
process.on('SIGINT', () => { flushNow(); });
process.on('beforeExit', () => { flushNow(); });

module.exports = {
  // 集合操作
  findById: (collection, id) => findById(collection, id),
  findOne: (collection, predicate) => findOne(collection, predicate),
  findAll: (collection, predicate) => findAll(collection, predicate),
  insert: (collection, record) => insert(collection, record),
  updateById: (collection, id, patch) => updateById(collection, id, patch),
  removeById: (collection, id) => removeById(collection, id),
  count: (collection, predicate) => count(collection, predicate),
  // 工具
  genId,
  now,
  persist,
  flushNow,
  // 直接访问原始数据（只读快照）
  raw: () => data,
};
