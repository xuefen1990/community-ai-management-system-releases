'use strict';

const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createEmptyDatabase } = require('./empty-database');

function clone(value) { return structuredClone(value); }
function fileReferences(value, key = '', found = new Set()) {
  if (Array.isArray(value)) value.forEach(item => fileReferences(item, key, found));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => fileReferences(item, name, found));
  else if (typeof value === 'string' && /^(?:path|filePath|file_path|fileObjectRelativePath|originalPath|sourcePath|attachmentPath|archivePath|wordPath|cachePath|tempPath)$/iu.test(key)
    && path.isAbsolute(value)) found.add(value);
  return found;
}
function normalize(value) {
  const empty = createEmptyDatabase();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const result = { ...empty, ...value, version: empty.version, settings: { ...empty.settings, ...(value.settings || {}) } };
  for (const key of Object.keys(empty)) if (Array.isArray(empty[key]) && !Array.isArray(result[key])) result[key] = [];
  return result;
}

class RemoteDatabaseStore {
  constructor({ authService, localStore, localWorkspaceService = null, onChanged = () => {} }) {
    this.authService = authService;
    this.localStore = localStore;
    this.localWorkspaceService = localWorkspaceService;
    this.version = null;
    this.writeQueue = Promise.resolve();
    this.onChanged = onChanged;
    this.stopSubscription = null;
    this.snapshot = null;
    this.snapshotWorkspaceKey = '';
    this.readPromise = null;
    this.lastVerifiedAt = 0;
    this.uploadedPaths = new Set();
  }

  get dataDirectory() {
    const user = this.authService.session?.user;
    if (user && ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(user.role))
      return this.localWorkspaceService?.dataDirectoryFor?.(user.mainAccountId || user.id) || this.localStore.dataDirectory;
    return this.localStore.dataDirectory;
  }

  async resetForAccountChange() {
    if (this.stopSubscription) {
      await this.stopSubscription();
      this.stopSubscription = null;
    }
    this.snapshotWorkspaceKey = '';
    this.clearSnapshot();
    this.uploadedPaths.clear();
    this.localWorkspaceService?.deactivate?.();
  }

  async getWorkspaceStatus() {
    const status = await this.authService.getStatus();
    const account = status?.account || {};
    const mainAccountId = String(account.mainAccountId || '').trim();
    const accountId = String(account.id || account.phone || '').trim();
    if (status?.authenticated && !mainAccountId) throw new Error('当前账号缺少主账号归属，无法打开共享数据');
    const hasSharedWorkspace = Boolean(status?.authenticated && mainAccountId);
    const isLocalHost = ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(account.role);
    const workspaceBaseUrl = hasSharedWorkspace
      ? await this.authService.getWorkspaceBaseUrl() : '';
    if (hasSharedWorkspace && !workspaceBaseUrl) throw new Error('已登录，但尚未连接局域网主电脑');
    return {
      authenticated: Boolean(status?.authenticated),
      hasSharedWorkspace,
      isLocalHost,
      workspaceBaseUrl,
      workspaceKey: hasSharedWorkspace ? `${isLocalHost ? 'host' : 'remote'}:${accountId}:${mainAccountId}:${workspaceBaseUrl}` : 'local',
    };
  }

  async isRemoteChild() {
    const workspace = await this.getWorkspaceStatus();
    if (workspace.isLocalHost) return false;
    if (!workspace.hasSharedWorkspace) return false;
    const service = this.localWorkspaceService;
    const local = service?.info();
    return !(local?.enabled && service.config && String(service.config.ownerId) === String((await this.authService.getWorkspaceConnection()).ownerId)
      && local.ips.includes(new URL(workspace.workspaceBaseUrl).hostname));
  }

  async requireHostFileOperation() {
    if (await this.isRemoteChild()) throw new Error('此操作需要在主电脑完成；子电脑的文件不能存为本机业务副本');
  }

  async uploadArchivedFile(source) {
    const stats = await fs.stat(source);
    if (!stats.isFile() || stats.size > 50 * 1024 * 1024) throw new Error('请选择不超过 50 MB 的普通文件');
    const bytes = await fs.readFile(source);
    const response = await this.authService.requestWorkspaceFile('files', {
      method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(path.basename(source)) },
    });
    const result = await response.json();
    if (result.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('主电脑文件校验失败，请重试');
    this.uploadedPaths.add(result.path);
    return result;
  }

  async fetchArchivedFile(id) {
    return this.authService.requestWorkspaceFile(`files/${encodeURIComponent(id)}`);
  }

  clearSnapshot() {
    this.version = null;
    this.snapshot = null;
    this.readPromise = null;
    this.lastVerifiedAt = 0;
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
    if (this.snapshot) {
      if (workspace.hasSharedWorkspace && !workspace.isLocalHost && Date.now() - this.lastVerifiedAt > 5000 && typeof this.authService.checkLanWorkspace === 'function') {
        try {
          await this.authService.checkLanWorkspace({ ip: new URL(workspace.workspaceBaseUrl).hostname });
          this.lastVerifiedAt = Date.now();
        } catch (error) { this.clearSnapshot(); throw error; }
      }
      return clone(this.snapshot);
    }
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
        this.lastVerifiedAt = Date.now();
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
    const snapshot = clone(normalize(value));
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => this.writeSnapshot(snapshot));
    return this.writeQueue;
  }

  // Called inside writeQueue only. Keep read-modify-write operations in that
  // same queue so edits from separate pages cannot read the same old snapshot.
  async writeSnapshot(snapshot) {
      const workspace = await this.getWorkspaceStatus();
      await this.activateWorkspace(workspace);
      if (!workspace.hasSharedWorkspace) {
        const result = await this.localStore.write(snapshot);
        this.cacheSnapshot(snapshot);
        return result;
      }
      if (this.version === null) await this.read();
      try {
        const previous = this.snapshot || await this.read();
        const changed = {};
        for (const [key, value] of Object.entries(snapshot)) {
          if (key !== 'version' && !isDeepStrictEqual(previous[key], value)) changed[key] = value;
        }
        if (await this.isRemoteChild()) {
          const previousFiles = fileReferences(previous);
          for (const file of fileReferences(changed)) {
            if (!previousFiles.has(file) && !this.uploadedPaths.has(file))
              throw new Error('附件必须保存到主电脑后才能写入业务记录，请在主电脑完成此文件操作');
          }
        }
        const response = await this.authService.request('/unit/workspace/data', { method: 'PUT', body: { data: changed, version: this.version } });
        this.version = response.version;
        this.cacheSnapshot(snapshot);
        this.lastVerifiedAt = Date.now();
        return { ok: true, version: response.version };
      } catch (error) {
        this.clearSnapshot();
        throw error;
      }
  }

  async update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('mutator must be a function');
    const operation = this.writeQueue.catch(() => {}).then(async () => {
      const draft = clone(await this.read());
      const result = await mutator(draft);
      await this.writeSnapshot(normalize(draft));
      return { data: clone(draft), result: clone(result) };
    });
    this.writeQueue = operation;
    return operation;
  }

  async importLocalDataToUnit() {
    const status = await this.authService.getStatus();
    if (!['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(status.account?.role)) throw new Error('只有主账号可以导入本机数据');
    if (this.dataDirectory !== this.localStore.dataDirectory)
      throw new Error('其他主账号的旧版本机数据不能导入当前账号');
    const remote = await this.read();
    const hasRemoteRecords = Object.entries(remote).some(([key, value]) => key !== 'settings' && Array.isArray(value) && value.length > 0);
    if (hasRemoteRecords) throw new Error('单位共享工作区已有数据。为避免重复或覆盖，本机数据不能自动导入。');
    const local = await this.localStore.read();
    await this.write(local);
    const recordCount = Object.values(local).filter(Array.isArray).reduce((total, rows) => total + rows.length, 0);
    return { ok: true, recordCount };
  }

  async createBackup() {
    await this.requireHostFileOperation();
    const workspace = await this.getWorkspaceStatus();
    if (!workspace.isLocalHost) return this.localStore.createBackup();
    const createdAt = new Date();
    const name = `backup-${createdAt.toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`;
    const backupPath = path.join(this.dataDirectory, 'backups', name);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, `${JSON.stringify(await this.read(), null, 2)}\n`, { mode: 0o600 });
    return { ok: true, name, path: backupPath, createdAt: createdAt.toISOString() };
  }
  async listBackups() {
    await this.requireHostFileOperation();
    const directory = path.join(this.dataDirectory, 'backups');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const backups = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(async entry => {
      const file = path.join(directory, entry.name);
      const stat = await fs.stat(file);
      return { name: entry.name, path: file, size: stat.size, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString() };
    }));
    return backups.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }
  async restoreBackup(value, options) {
    await this.requireHostFileOperation();
    const workspace = await this.getWorkspaceStatus();
    if (!workspace.isLocalHost) {
      const restored = await this.localStore.restoreBackup(value, options);
      await this.write(restored.data);
      return restored;
    }
    const backupsDirectory = path.join(this.dataDirectory, 'backups');
    const requestedPath = typeof value === 'string' ? value : value?.path || value?.filePath
      || (value?.name && path.join(backupsDirectory, value.name));
    if (!requestedPath) throw new TypeError('未指定备份文件');
    const resolved = path.resolve(requestedPath);
    const relative = path.relative(backupsDirectory, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('备份文件必须位于本系统的备份目录中');
    const data = normalize(JSON.parse(await fs.readFile(resolved, 'utf8')));
    if (options?.transform) await options.transform(data);
    await this.createBackup();
    await this.write(data);
    return { ok: true, data };
  }
}

module.exports = { RemoteDatabaseStore, normalize };
