'use strict';

const { createEmptyDatabase } = require('./empty-database');

function clone(value) { return structuredClone(value); }
function normalize(value) {
  const empty = createEmptyDatabase();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const result = { ...empty, ...value, version: empty.version, settings: { ...empty.settings, ...(value.settings || {}) } };
  for (const key of Object.keys(empty)) if (Array.isArray(empty[key]) && !Array.isArray(result[key])) result[key] = [];
  return result;
}

class RemoteDatabaseStore {
  constructor({ authService, localStore, onChanged = () => {} }) {
    this.authService = authService;
    this.localStore = localStore;
    this.version = null;
    this.writeQueue = Promise.resolve();
    this.dataDirectory = localStore.dataDirectory;
    this.onChanged = onChanged;
    this.stopSubscription = null;
    this.snapshot = null;
    this.snapshotWorkspaceKey = '';
    this.readPromise = null;
  }

  async getWorkspaceStatus() {
    const status = await this.authService.getStatus();
    const account = status?.account || {};
    const organizationId = String(account.organizationId || '').trim();
    const accountId = String(account.id || account.phone || '').trim();
    const hasSharedWorkspace = Boolean(status?.authenticated && organizationId);
    return {
      authenticated: Boolean(status?.authenticated),
      hasSharedWorkspace,
      workspaceKey: hasSharedWorkspace ? `remote:${accountId}:${organizationId}` : 'local',
    };
  }

  clearSnapshot() {
    this.version = null;
    this.snapshot = null;
    this.readPromise = null;
  }

  async activateWorkspace(workspace) {
    if (this.snapshotWorkspaceKey === workspace.workspaceKey) return;
    if (this.stopSubscription) {
      await this.stopSubscription();
      this.stopSubscription = null;
    }
    this.snapshotWorkspaceKey = workspace.workspaceKey;
    this.clearSnapshot();
  }

  cacheSnapshot(value) {
    this.snapshot = clone(normalize(value));
  }

  async read() {
    const workspace = await this.getWorkspaceStatus();
    await this.activateWorkspace(workspace);
    if (this.snapshot) return clone(this.snapshot);
    if (!this.readPromise) {
      this.readPromise = (async () => {
        if (!workspace.hasSharedWorkspace) {
          const local = await this.localStore.read();
          this.cacheSnapshot(local);
          return this.snapshot;
        }
        await this.ensureSubscription();
        const response = await this.authService.request('/unit/workspace/data');
        this.version = response.version;
        this.cacheSnapshot(response.data);
        return this.snapshot;
      })();
    }
    try {
      return clone(await this.readPromise);
    } finally {
      this.readPromise = null;
    }
  }

  async ensureSubscription() {
    if (this.stopSubscription) return;
    this.stopSubscription = await this.authService.subscribeWorkspaceChanges((payload) => { this.clearSnapshot(); this.onChanged(payload); });
  }

  async write(value) {
    const snapshot = normalize(value);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const workspace = await this.getWorkspaceStatus();
      await this.activateWorkspace(workspace);
      if (!workspace.hasSharedWorkspace) {
        const result = await this.localStore.write(snapshot);
        this.cacheSnapshot(snapshot);
        return result;
      }
      if (this.version === null) await this.read();
      try {
        const response = await this.authService.request('/unit/workspace/data', { method: 'PUT', body: { data: snapshot, version: this.version } });
        this.version = response.version;
        this.cacheSnapshot(snapshot);
        return { ok: true, version: response.version };
      } catch (error) {
        this.clearSnapshot();
        throw error;
      }
    });
    return this.writeQueue;
  }

  async update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('mutator must be a function');
    const current = await this.read();
    const draft = clone(current);
    const result = await mutator(draft);
    await this.write(draft);
    return { data: clone(draft), result: clone(result) };
  }

  async importLocalDataToUnit() {
    const status = await this.authService.getStatus();
    if (status.account?.role !== 'unit_admin') throw new Error('只有单位管理员可以导入本机数据');
    const remote = await this.read();
    const hasRemoteRecords = Object.entries(remote).some(([key, value]) => key !== 'settings' && Array.isArray(value) && value.length > 0);
    if (hasRemoteRecords) throw new Error('单位共享工作区已有数据。为避免重复或覆盖，本机数据不能自动导入。');
    const local = await this.localStore.read();
    await this.write(local);
    const recordCount = Object.values(local).filter(Array.isArray).reduce((total, rows) => total + rows.length, 0);
    return { ok: true, recordCount };
  }

  async createBackup() { return this.localStore.createBackup(); }
  async listBackups() { return this.localStore.listBackups(); }
  async restoreBackup(value, options) { const restored = await this.localStore.restoreBackup(value, options); await this.write(restored.data); return restored; }
}

module.exports = { RemoteDatabaseStore, normalize };
