'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { createEmptyDatabase } = require('./empty-database');

function clone(value) {
  return structuredClone(value);
}

function validateDatabase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('数据库内容必须是对象');
  }
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

class JsonDatabaseStore {
  constructor({ userDataPath, now = () => new Date() }) {
    if (!userDataPath) throw new TypeError('userDataPath is required');
    this.dataDirectory = path.join(userDataPath, 'data');
    this.backupsDirectory = path.join(this.dataDirectory, 'backups');
    this.databasePath = path.join(this.dataDirectory, 'community-data.json');
    this.now = now;
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.backupsDirectory, { recursive: true });
    try {
      await fs.access(this.databasePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.write(createEmptyDatabase());
    }
    return this.databasePath;
  }

  async read() {
    await this.initialize();
    try {
      const contents = await fs.readFile(this.databasePath, 'utf8');
      const database = JSON.parse(contents);
      validateDatabase(database);
      return clone(database);
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
      const quarantinePath = path.join(
        this.dataDirectory,
        `community-data.corrupt-${timestampForFile(this.now())}.json`,
      );
      await fs.rename(this.databasePath, quarantinePath);
      const database = createEmptyDatabase();
      await this.write(database);
      return clone(database);
    }
  }

  async write(value) {
    validateDatabase(value);
    const snapshot = clone(value);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.backupsDirectory, { recursive: true });
      const temporaryPath = `${this.databasePath}.tmp-${process.pid}`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporaryPath, this.databasePath);
    });
    await this.writeQueue;
    return { ok: true };
  }

  async createBackup() {
    const database = await this.read();
    const createdAt = this.now();
    const name = `backup-${timestampForFile(createdAt)}.json`;
    const backupPath = path.join(this.backupsDirectory, name);
    await fs.writeFile(backupPath, `${JSON.stringify(database, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return { ok: true, name, path: backupPath, createdAt: createdAt.toISOString() };
  }

  async listBackups() {
    await this.initialize();
    const entries = await fs.readdir(this.backupsDirectory, { withFileTypes: true });
    const backups = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const backupPath = path.join(this.backupsDirectory, entry.name);
        const stats = await fs.stat(backupPath);
        return {
          name: entry.name,
          path: backupPath,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
        };
      }));
    return backups.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  async restoreBackup(reference) {
    const requestedPath = typeof reference === 'string'
      ? reference
      : reference?.path || reference?.filePath || (reference?.name && path.join(this.backupsDirectory, reference.name));
    if (!requestedPath) throw new TypeError('未指定备份文件');

    const resolvedPath = path.resolve(requestedPath);
    const relativePath = path.relative(this.backupsDirectory, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('备份文件必须位于本系统的备份目录中');
    }

    const database = JSON.parse(await fs.readFile(resolvedPath, 'utf8'));
    validateDatabase(database);
    await this.createBackup();
    await this.write(database);
    return { ok: true, data: clone(database) };
  }
}

module.exports = { JsonDatabaseStore, timestampForFile, validateDatabase };
