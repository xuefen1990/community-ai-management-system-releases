'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { hashPassword, passwordMatches, normalizePhone, validateCredentials } = require('./local-auth-service');
const { open } = require('./offline-session-cache');
const { prepareBackendData, BACKEND_COLLECTIONS } = require('./backend-data-migrator');

async function json(file, missing = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return missing; throw new Error('本机迁移资料损坏，原文件已保留，请先核对'); }
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${randomUUID()}`;
  try { await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
async function digestTree(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('备份目录含有链接，请先核对实际数据位置');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) result[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  }
  await visit(root); return result;
}

class StandaloneAccountRuntime {
  constructor({ userDataPath }) {
    this.userDataPath = userDataPath;
    this.directory = path.join(userDataPath, 'standalone');
    this.dbPath = path.join(this.directory, 'backend', 'backend.db');
    this.legacyAuthPath = path.join(userDataPath, 'license', 'local-auth.json');
    this.queue = Promise.resolve();
  }
  async readDatabase() {
    const value = await json(this.dbPath);
    if (value && (!Array.isArray(value.users) || value._meta?.runtime !== 'standalone')) throw new Error('本机独立账号库身份不匹配，已停止');
    return value;
  }
  async legacyState() { return await json(this.legacyAuthPath, { accounts: [] }); }
  async workspaceRoots() {
    const roots = new Map(), locations = await json(path.join(this.userDataPath, 'workspace-locations.json'), {});
    const candidates = [this.userDataPath, ...Object.values(locations)];
    const entries = await fs.readdir(path.join(this.userDataPath, 'account-workspaces'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) candidates.push(path.join(this.userDataPath, 'account-workspaces', entry.name));
    for (const root of new Set(candidates)) {
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('工作区位置配置不正确');
      const config = await json(path.join(root, 'lan-workspace', 'config.json'));
      if (!config) {
        if (await fs.access(path.join(root, 'lan-workspace', 'workspace.json')).then(() => true, () => false) || await fs.access(path.join(root, 'data', 'community-data.json')).then(() => true, () => false)) throw new Error('发现未绑定主账号的数据，请先核对');
        continue;
      }
      if (!config.ownerId) throw new Error('原工作区缺少主账号归属，已停止');
      const ownerId = String(config.ownerId);
      if (locations[ownerId] && path.resolve(locations[ownerId]) !== path.resolve(root)) continue;
      if (roots.has(ownerId) && roots.get(ownerId) !== root) throw new Error('同一主账号有多个数据位置，请先核对');
      roots.set(ownerId, root);
    }
    return roots;
  }
  async identity({ phone, password, register }) {
    const state = await this.legacyState(), roots = await this.workspaceRoots();
    if (register) {
      if (roots.size || state.remoteAccount || state.accounts?.length) throw new Error('本机已有账号或历史资料，请用原账号迁移登录，不能创建空工作区替代');
      return { user: { id: randomUUID(), phone, role: 'main_account', name: '本机主账号' }, root: null, source: 'new' };
    }
    let user;
    if (state.offlineSessions?.[phone]) {
      const saved = open(state.offlineSessions[phone], password);
      user = saved.user;
      if (!user?.id || user.phone !== phone || user.mustChangePassword || user.isActive === false) throw new Error('旧账号记录不完整或已停用，请先核对');
    } else {
      const account = state.accounts?.find(item => item.phone === phone);
      if (!account || account.role !== 'owner' || !(await passwordMatches(password, account.password))) throw new Error('未找到可验证的原主账号，请核对原密码或恢复旧账号备份');
      user = { ...account, role: 'main_account', mainAccountId: account.id };
    }
    if (!['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(user.role)) throw new Error('子账号不能迁移为本机主账号，请连接所属主电脑');
    if (String(user.mainAccountId || user.id) !== String(user.id)) throw new Error('原账号和主账号归属不一致，已停止');
    const root = roots.get(String(user.id));
    if (!root) throw new Error('没有找到该主账号的原工作区，已停止，避免打开空资料');
    if (user.organizationId && (!user.organization || user.organization.id !== user.organizationId || user.organization.unitAdminUserId !== user.id)) throw new Error('原单位归属资料不完整，请先恢复账号备份');
    return { user, root, source: 'verified-legacy' };
  }
  async backup(root) {
    const folder = path.join(this.directory, 'migration-backups', `${Date.now()}-${randomUUID()}`);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    try {
      const sources = [this.legacyAuthPath, path.join(this.userDataPath, 'workspace-locations.json'), ...(root ? ['lan-workspace', 'data', 'contract-fee', 'work-attachments', 'settings'].map(name => path.join(root, name)) : [])];
      for (const [index, source] of sources.entries()) {
        const stat = await fs.lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!stat) continue;
        if (stat.isSymbolicLink()) throw new Error('迁移源是链接，请先核对');
        const target = path.join(folder, `${index}-${path.basename(source)}`);
        if (stat.isDirectory()) {
          const before = await digestTree(source);
          await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
          const after = await digestTree(source), copied = await digestTree(target);
          const stable = Object.keys(before).length === Object.keys(after).length && Object.keys(before).every(key => before[key] === after[key] && copied[key] === before[key]);
          if (!stable) throw new Error('备份过程中资料有变化，请关闭其他写入后重试');
        } else {
          const bytes = await fs.readFile(source); await fs.writeFile(target, bytes, { mode: 0o600 });
          if (!(await fs.readFile(source)).equals(bytes)) throw new Error('备份过程中账号资料有变化，请重试');
        }
      }
      await atomicJson(path.join(folder, 'sha256.json'), await digestTree(folder));
      return folder;
    } catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error; }
  }
  prepare(credentials) {
    const task = this.queue.catch(() => {}).then(() => this.prepareOnce(credentials));
    this.queue = task; return task;
  }
  async prepareOnce({ phone, password, register = false }) {
    phone = normalizePhone(phone); validateCredentials(phone, password);
    const existing = await this.readDatabase();
    if (existing) {
      if (register) throw new Error('本机已有主账号，请登录；成员账号由主账号在设置中创建');
      return { initialized: false };
    }
    const { user, root, source } = await this.identity({ phone, password, register });
    const backup = await this.backup(root), now = new Date().toISOString();
    const data = Object.fromEntries(BACKEND_COLLECTIONS.map(name => [name, []]));
    data._meta = { version: 1, createdAt: now, runtime: 'standalone', source, backup, ownerId: user.id };
    data.users = [{ id: user.id, phone, password_hash: await hashPassword(password), name: user.name || '本机主账号',
      role: user.role === 'unit_admin' ? 'unit_admin' : 'main_account', main_account_id: user.id,
      organization_id: user.organizationId || null, account_status: 'active', permissions: user.permissions || {},
      ai_access_enabled: user.aiAccessEnabled === false ? 0 : 1, village_name: user.villageName || '',
      plan_type: 'permanent', plan_expires_at: null, is_active: 1, must_change_password: 0, session_version: 0,
      created_at: user.createdAt || now, updated_at: now }];
    if (user.organization) data.organizations.push({ id: user.organization.id, name: user.organization.name, region: user.organization.region || '', status: 'active', unit_admin_user_id: user.id, created_at: user.organization.createdAt || now });
    // Missing cloud preferences must not override this computer's saved menu.
    data.user_preferences = user.menu ? [{ id: randomUUID(), user_id: user.id, menu: user.menu, updated_at: now }] : [];
    await atomicJson(this.dbPath, data);
    return { initialized: true, backup, ownerId: user.id };
  }
  async prepareData() {
    if (!(await this.readDatabase())) throw new Error('请先使用原密码迁移登录，或在新电脑创建本机账号');
    return prepareBackendData({ userDataPath: this.directory, legacyAuthPath: null, legacyBackendPaths: [] });
  }
}

module.exports = { StandaloneAccountRuntime, atomicJson, digestTree };
