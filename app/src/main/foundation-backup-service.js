'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { fail } = require('./foundation-data-model');
const { validateDatabase } = require('./database-store');
async function hashFile(file) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
function transformPaths(value, replace) {
  if (typeof value === 'string') return replace(value);
  if (Array.isArray(value)) return value.map(item => transformPaths(item, replace));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transformPaths(item, replace)]));
  return value;
}
class FoundationBackupService {
  constructor({ store, authorize, now = () => new Date(), uuid = randomUUID }) {
    this.store = store; this.authorize = authorize; this.now = now; this.uuid = uuid;
  }
  get directory() { return path.join(this.store.dataDirectory, 'foundation-backups'); }
  async create({ source = 'manual', importJobId = null, importDomain = null } = {}) {
    await this.authorize({ method: 'POST', path: source === 'import' && ['personnel', 'land', 'finance'].includes(importDomain) ? '/import-backup' : '/backup', domain: importDomain });
    await this.store.requireHostFileOperation?.();
    const database = await this.store.read();
    validateDatabase(database);
    const name = `backup-${this.now().toISOString().replace(/[:.]/g, '-')}-${this.uuid()}`;
    const directory = path.join(this.directory, name);
    await fs.mkdir(path.join(directory, 'files'), { recursive: true });
    const references = new Set();
    transformPaths(database, value => { if (path.isAbsolute(value) && !value.includes('\0')) references.add(value); return value; });
    const files = [], missingFiles = [];
    try {
      for (const originalPath of references) {
        let stats;
        try { stats = await fs.lstat(originalPath); } catch (error) { if (error.code === 'ENOENT') { missingFiles.push(originalPath); continue; } throw error; }
        if (!stats.isFile()) continue;
        const relativePath = `files/${files.length}${path.extname(originalPath)}`;
        const copy = path.join(directory, relativePath);
        const before = await hashFile(originalPath);
        await fs.copyFile(originalPath, copy);
        const sha256 = await hashFile(copy);
        if (before !== sha256 || await hashFile(originalPath) !== sha256) fail('FILE_CHANGED', '备份时附件发生变化，请重试');
        files.push({ originalPath, relativePath, sizeBytes: stats.size, sha256 });
      }
      const databasePath = path.join(directory, 'database.json');
      await fs.writeFile(databasePath, JSON.stringify(database), { mode: 0o600 });
      const manifest = { format: 'community-foundation-backup', version: 1, createdAt: this.now().toISOString(), source,
        importJobId, importDomain, databaseSha256: await hashFile(databasePath), files, missingFiles };
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      return { success: true, relativePath: name, path: directory, createdAt: manifest.createdAt, filesCount: files.length,
        missingFiles, warning: missingFiles.length ? `${missingFiles.length} 个历史文件路径已不存在；其余附件和数据库已备份` : '' };
    } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
  }
  async list() {
    await this.authorize({ method: 'GET', path: '/backup' });
    await this.store.requireHostFileOperation?.();
    await fs.mkdir(this.directory, { recursive: true });
    const backups = [];
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(this.directory, entry.name, 'manifest.json'), 'utf8'));
        if (manifest.format !== 'community-foundation-backup') continue;
        const stats = await fs.stat(path.join(this.directory, entry.name, 'database.json'));
        backups.push({ relativePath: entry.name, fileName: entry.name, createdAt: manifest.createdAt, source: manifest.source,
          manifest, sizeBytes: stats.size + manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0) });
      } catch { /* An incomplete backup is not offered for restoration. */ }
    }
    return { backups: backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }
  async restore(reference) {
    await this.authorize({ method: 'PATCH', path: '/backup' });
    await this.store.requireHostFileOperation?.();
    const name = typeof reference === 'string' ? reference : reference?.relativePath;
    if (!name || path.basename(name) !== name || !name.startsWith('backup-')) fail('INVALID_BACKUP', '备份路径不正确');
    const directory = path.join(this.directory, name);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.format !== 'community-foundation-backup' || manifest.version !== 1) fail('INVALID_BACKUP', '备份格式不正确');
    if (await hashFile(path.join(directory, 'database.json')) !== manifest.databaseSha256) fail('CORRUPT_BACKUP', '数据库备份校验失败，未恢复');
    const database = JSON.parse(await fs.readFile(path.join(directory, 'database.json'), 'utf8')); validateDatabase(database);
    const restoredDirectory = path.join(this.store.dataDirectory, 'foundation-restored-files', this.uuid());
    const remap = new Map();
    for (const file of manifest.files) {
      if (!/^files\/[0-9]+(?:\.[^/\\]+)?$/.test(file.relativePath)) fail('INVALID_BACKUP', '附件备份路径不正确');
      if (await hashFile(path.join(directory, file.relativePath)) !== file.sha256) fail('CORRUPT_BACKUP', '附件备份校验失败，未恢复');
    }
    const recovery = await this.create({ source: 'before-restore' });
    try {
      await fs.mkdir(restoredDirectory, { recursive: true });
      for (const file of manifest.files) {
        const destination = path.join(restoredDirectory, path.basename(file.relativePath));
        await fs.copyFile(path.join(directory, file.relativePath), destination);
        remap.set(file.originalPath, destination);
      }
      const restored = transformPaths(database, value => remap.get(value) || value);
      await this.store.update(draft => { for (const key of Object.keys(draft)) delete draft[key]; Object.assign(draft, restored); return true; });
      return { success: true, recoveryBackup: recovery.relativePath, restoredFiles: remap.size, warning: manifest.missingFiles?.length ? '该备份包含原先已缺失的文件路径，缺失文件无法恢复' : '' };
    } catch (error) { await fs.rm(restoredDirectory, { recursive: true, force: true }); throw error; }
  }
  async restoreImport(importJobId) {
    const { backups } = await this.list();
    const backup = backups.find(item => String(item.manifest.importJobId) === String(importJobId));
    if (!backup) fail('SNAPSHOT_NOT_FOUND', '该导入记录没有可恢复快照');
    return this.restore(backup.relativePath);
  }
}
module.exports = { FoundationBackupService, hashFile, transformPaths };
