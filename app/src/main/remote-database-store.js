'use strict';

const { createEmptyDatabase } = require('./empty-database');

function clone(value) { return structuredClone(value); }
function normalize(value) {
  const empty = createEmptyDatabase();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const result = { ...empty, ...value, settings: { ...empty.settings, ...(value.settings || {}) } };
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
  }

  async isAuthenticated() { return Boolean((await this.authService.getStatus()).authenticated); }

  async read() {
    if (!(await this.isAuthenticated())) return this.localStore.read();
    await this.ensureSubscription();
    const response = await this.authService.request('/unit/workspace/data');
    this.version = response.version;
    return clone(normalize(response.data));
  }

  async ensureSubscription() {
    if (this.stopSubscription) return;
    this.stopSubscription = await this.authService.subscribeWorkspaceChanges((payload) => { this.version = null; this.onChanged(payload); });
  }

  async write(value) {
    const snapshot = normalize(value);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      if (!(await this.isAuthenticated())) return this.localStore.write(snapshot);
      if (this.version === null) await this.read();
      const response = await this.authService.request('/unit/workspace/data', { method: 'PUT', body: { data: snapshot, version: this.version } });
      this.version = response.version;
      return { ok: true, version: response.version };
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

  async createBackup() { return this.localStore.createBackup(); }
  async listBackups() { return this.localStore.listBackups(); }
  async restoreBackup(value) { const restored = await this.localStore.restoreBackup(value); await this.write(restored.data); return restored; }
}

module.exports = { RemoteDatabaseStore, normalize };
