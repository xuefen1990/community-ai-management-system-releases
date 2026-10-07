'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { LanWorkspaceService } = require('./lan-workspace-service');
const { relocateWorkspace } = require('./workspace-relocation');

function accountDirectory(userDataPath, ownerId) {
  const key = createHash('sha256').update(String(ownerId)).digest('hex');
  return path.join(userDataPath, 'account-workspaces', key);
}

class AccountWorkspaceManager {
  constructor({ userDataPath, fetchImpl, port, host, discovery } = {}) {
    this.userDataPath = userDataPath;
    this.options = { fetchImpl, port, host, discovery };
    this.services = new Map();
    this.legacyOwnerId = null;
    this.activeOwnerId = null;
    this.lastShareError = '';
    this.migrating = false;
    this.initialized = false;
    this.locationsPath = path.join(userDataPath, 'workspace-locations.json');
    try { this.locations = JSON.parse(fsSync.readFileSync(this.locationsPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.locations = {}; }
  }

  makeService(root) {
    return new LanWorkspaceService({ userDataPath: root, ...this.options });
  }

  async loadExisting() {
    if (this.initialized) return;
    const legacy = this.makeService(this.userDataPath);
    const config = await legacy.readConfig();
    if (config) {
      if (!config.ownerId) throw new Error('现有本地数据缺少主账号归属，请先核对');
      this.legacyOwnerId = String(config.ownerId);
      if (!this.locations[this.legacyOwnerId]) this.services.set(this.legacyOwnerId, legacy);
    } else if (await fs.access(legacy.dataPath).then(() => true, () => false)) {
      throw new Error('发现未绑定主账号的本地数据，请先核对，避免覆盖');
    }
    this.initialized = true;
  }

  async startIfConfigured() {
    await this.loadExisting();
    if (this.legacyOwnerId && this.locations[this.legacyOwnerId]) this.services.delete(this.legacyOwnerId);
    else if (this.legacyOwnerId) await this.services.get(this.legacyOwnerId).startIfConfigured();
    const root = path.join(this.userDataPath, 'account-workspaces');
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
      const service = this.makeService(path.join(root, entry.name));
      const config = await service.readConfig();
      if (!config?.ownerId || accountDirectory(this.userDataPath, config.ownerId) !== path.join(root, entry.name)) continue;
      if (this.services.has(String(config.ownerId)) || this.locations[String(config.ownerId)]) continue;
      this.services.set(String(config.ownerId), service);
      if (config.shareEnabled) await service.startIfConfigured();
    }
    for (const [ownerId, directory] of Object.entries(this.locations)) {
      if (this.services.has(ownerId)) continue;
      const service = this.makeService(directory);
      const config = await service.readConfig();
      if (String(config?.ownerId) !== ownerId) throw new Error('自定义工作区位置的账号归属不匹配');
      this.services.set(ownerId, service);
      if (config.shareEnabled) await service.startIfConfigured();
    }
    return this.info();
  }

  async serviceFor(ownerId) {
    await this.loadExisting();
    const key = String(ownerId || '').trim();
    if (!key) throw new Error('请先登录主账号');
    let service = this.services.get(key);
    if (!service) {
      service = this.makeService(this.locations[key] || accountDirectory(this.userDataPath, key));
      const config = await service.readConfig();
      if (config && String(config.ownerId) !== key) throw new Error('本地工作区归属不一致，请先核对');
      this.services.set(key, service);
    }
    return service;
  }

  get active() { return this.activeOwnerId ? this.services.get(this.activeOwnerId) : null; }
  get config() { return this.active?.config || null; }
  get dataDirectory() {
    if (this.migrating) throw new Error('工作区正在搬迁，请稍候');
    return this.active ? path.join(this.active.userDataPath, 'data') : path.join(this.userDataPath, 'data');
  }
  dataDirectoryFor(ownerId) {
    if (this.migrating) throw new Error('工作区正在搬迁，请稍候');
    return path.join(this.locations[String(ownerId)] || (this.legacyOwnerId === String(ownerId) ? this.userDataPath : accountDirectory(this.userDataPath, ownerId)), 'data');
  }
  deactivate() { this.activeOwnerId = null; }

  async prepareLocal({ ownerId, cloudBaseUrl }) {
    if (this.migrating) throw new Error('工作区正在搬迁，请稍候');
    const service = await this.serviceFor(ownerId);
    for (const [otherOwnerId, otherService] of this.services) {
      if (otherOwnerId !== String(ownerId) && otherService.info().enabled) await otherService.disableSharing();
    }
    const local = await service.prepareLocal({ ownerId, cloudBaseUrl });
    this.activeOwnerId = String(ownerId);
    try {
      const shared = await service.enableSharing();
      this.lastShareError = '';
      return { baseUrl: `http://127.0.0.1:${shared.port}`, ownerId };
    } catch (error) {
      this.lastShareError = error.message || '局域网共享启动失败';
      return local;
    }
  }

  async enableSharing() {
    const active = this.active;
    if (!active) throw new Error('请先登录主账号并打开本机数据');
    for (const [ownerId, service] of this.services) {
      if (ownerId !== this.activeOwnerId && service.info().enabled)
        throw new Error('本电脑已有其他主账号开启共享，请先关闭该账号的共享后再启用');
    }
    return active.enableSharing();
  }

  async disableSharing() {
    if (!this.active) throw new Error('请先登录主账号并打开本机数据');
    return this.active.disableSharing();
  }

  async initializeWorkspace(input) {
    const service = await this.serviceFor(input.ownerId);
    const result = await service.initialize(input);
    this.activeOwnerId = String(input.ownerId);
    return result;
  }

  async initialize(input) { return this.initializeWorkspace(input); }
  async cacheAccountGrant(token, user, entitlement) {
    if (!['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(user?.role)) return;
    const ownerId = String(user.mainAccountId || user.id);
    const service = await this.serviceFor(ownerId);
    if (!service.config) throw new Error('本机工作区尚未准备好');
    await service.cacheGrant(token, user, entitlement);
  }
  async relocateActive(parentDirectory) {
    if (this.migrating || !this.active || !this.activeOwnerId) throw new Error('请先登录主账号并打开本机工作区');
    const ownerId = this.activeOwnerId;
    const source = this.active.userDataPath;
    const key = createHash('sha256').update(ownerId).digest('hex').slice(0, 12);
    const destination = path.join(path.resolve(parentDirectory), `community-workspace-${key}-${Date.now()}`);
    this.migrating = true;
    let committed = false;
    try {
      await this.active.queue;
      await this.active.aiState.queue;
      await this.active.grantWriteQueue;
      await this.active.stop();
      const result = await relocateWorkspace({ source, destination });
      const next = { ...this.locations, [ownerId]: destination };
      const temporary = `${this.locationsPath}.tmp-${process.pid}`;
      await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, this.locationsPath);
      this.locations = next;
      committed = true;
      await fs.writeFile(path.join(source, 'lan-workspace', 'relocated-to.json'), `${JSON.stringify({ destination, movedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
        .catch(error => console.warn('[Workspace relocation]', error.message));
      return { ...result, previous: source };
    } catch (error) {
      if (!committed) await this.active.startIfConfigured().catch(() => {});
      throw error;
    } finally { if (!committed) this.migrating = false; }
  }
  async verifyMigration(input) { if (!this.active) throw new Error('请先登录主账号'); return this.active.verifyMigration(input); }
  async readWorkspace() { if (!this.active) throw new Error('请先登录主账号'); return this.active.readWorkspace(); }
  info() { return { ...(this.active?.info() || { enabled: false, localReady: false, role: 'none', ownerId: null, ips: [], url: null }), sharingError: this.lastShareError }; }
  async stop() { await Promise.all([...this.services.values()].map(service => service.stop())); }
}

module.exports = { AccountWorkspaceManager, accountDirectory };
