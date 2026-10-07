'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TEMP_RETENTION_DAYS = 7;
const DEFAULT_TEMP_MAX_BYTES = 512 * 1024 * 1024;

function text(value) { return String(value ?? '').trim(); }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function isInside(directory, candidate) {
  const root = path.resolve(directory);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

async function statFile(filePath) {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) return { exists: false, bytes: 0, reason: 'symbolic-link' };
    return { exists: true, bytes: stats.isFile() ? stats.size : 0, modifiedAt: stats.mtime.toISOString(), isFile: stats.isFile() };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, bytes: 0, reason: 'missing' };
    throw error;
  }
}

async function directoryFiles(directory) {
  const files = [];
  const walk = async current => {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        files.push({ path: fullPath, bytes: stats.size, modifiedAt: stats.mtime.toISOString(), modifiedMs: stats.mtimeMs });
      }
    }
  };
  await walk(directory);
  return files;
}

function recordCount(database) {
  return Object.entries(database || {}).reduce((total, [key, value]) => key === 'aiFileIndexEntries' || !Array.isArray(value) ? total : total + value.length, 0);
}

class AiStorageService {
  constructor({ databaseStore, aiFileTaskService, now = () => new Date(), tempRetentionDays = DEFAULT_TEMP_RETENTION_DAYS,
    tempMaxBytes = DEFAULT_TEMP_MAX_BYTES } = {}) {
    if (!databaseStore?.read || !databaseStore?.update || !databaseStore?.dataDirectory) throw new TypeError('databaseStore is required');
    if (!aiFileTaskService?.parseFile || !aiFileTaskService?.cacheDirectory) throw new TypeError('aiFileTaskService is required');
    this.databaseStore = databaseStore;
    this.aiFileTaskService = aiFileTaskService;
    this.now = now;
    this.tempRetentionDays = Math.max(1, number(tempRetentionDays) || DEFAULT_TEMP_RETENTION_DAYS);
    this.tempMaxBytes = Math.max(1024 * 1024, number(tempMaxBytes) || DEFAULT_TEMP_MAX_BYTES);
  }

  get tempDirectory() { return path.join(this.databaseStore.dataDirectory, 'ai-temp'); }
  get cacheDirectory() { return this.aiFileTaskService.cacheDirectory; }
  get archiveDirectory() { return path.join(this.databaseStore.dataDirectory, 'foundation-archives'); }
  get backupDirectories() { return ['backups', 'foundation-backups'].map(name => path.join(this.databaseStore.dataDirectory, name)); }
  get logDirectories() { return [path.join(this.databaseStore.dataDirectory, 'logs'), path.join(path.dirname(this.databaseStore.dataDirectory), 'logs')]; }

  async getOverview() {
    await this.databaseStore.requireHostFileOperation?.();
    const database = await this.databaseStore.read();
    const entries = (database.aiFileIndexEntries || []).filter(entry => entry.status !== 'deleted');
    const [databaseStat, archiveFiles, cacheFiles, tempFiles, backupSets, logSets] = await Promise.all([
      statFile(path.join(this.databaseStore.dataDirectory, 'community-data.json')),
      directoryFiles(this.archiveDirectory),
      directoryFiles(this.cacheDirectory),
      directoryFiles(this.tempDirectory),
      Promise.all(this.backupDirectories.map(directoryFiles)),
      Promise.all(this.logDirectories.map(directoryFiles)),
    ]);
    const anomalies = [];
    const referencedCache = new Set();
    const referencedArchive = new Set();
    for (const entry of entries) {
      const cachePath = text(entry.cachePath);
      const archivePath = text(entry.archivePath);
      if (!cachePath || !isInside(this.cacheDirectory, cachePath)) anomalies.push({ type: 'index', fileId: entry.id, message: `${entry.fileName || '文件'}的索引位置不正确` });
      else {
        referencedCache.add(path.resolve(cachePath));
        if (!(await statFile(cachePath)).exists) anomalies.push({ type: 'index', fileId: entry.id, message: `${entry.fileName || '文件'}缺少可重建的检索索引` });
      }
      if (!archivePath) anomalies.push({ type: 'archive', fileId: entry.id, message: `${entry.fileName || '文件'}没有正式档案位置` });
      else {
        referencedArchive.add(path.resolve(archivePath));
        if (!(await statFile(archivePath)).exists) anomalies.push({ type: 'archive', fileId: entry.id, message: `${entry.fileName || '文件'}的正式原文件不存在` });
      }
    }
    for (const file of cacheFiles) {
      if (!referencedCache.has(path.resolve(file.path))) anomalies.push({ type: 'orphan-cache', message: '发现未关联的旧索引缓存，可在重建索引时清理' });
    }
    const sum = files => files.reduce((total, file) => total + number(file.bytes), 0);
    const backupFiles = backupSets.flat();
    const logFiles = logSets.flat();
    const maintenance = database.aiStorageMaintenance || {};
    return {
      generatedAt: this.now().toISOString(),
      limits: { tempRetentionDays: this.tempRetentionDays, tempMaxBytes: this.tempMaxBytes },
      categories: {
        formalData: { label: '正式业务数据', bytes: databaseStat.bytes, count: recordCount(database), note: databaseStat.exists ? '本机数据库文件' : '当前使用单位共享数据' },
        formalAttachments: { label: '正式档案附件', bytes: sum(archiveFiles), count: archiveFiles.length, note: '清理缓存不会删除' },
        aiIndex: { label: 'AI 检索索引', bytes: sum(cacheFiles), count: entries.length, fileCount: cacheFiles.length, note: '可从正式档案重新生成' },
        temporary: { label: 'AI 临时缓存', bytes: sum(tempFiles), count: tempFiles.length, note: `保留 ${this.tempRetentionDays} 天，最多 512 MB` },
        logs: { label: '运行日志', bytes: sum(logFiles), count: logFiles.length },
        backups: { label: '数据备份', bytes: sum(backupFiles), count: backupFiles.length, note: '沿用现有备份与恢复机制' },
      },
      maintenance: { lastCleanupAt: maintenance.lastCleanupAt || null, lastRebuildAt: maintenance.lastRebuildAt || null,
        lastRebuildResult: maintenance.lastRebuildResult || null },
      anomalies: anomalies.slice(0, 100),
      anomalyCount: anomalies.length,
    };
  }

  async cleanTemporaryCache() {
    await this.databaseStore.requireHostFileOperation?.();
    await fs.mkdir(this.tempDirectory, { recursive: true });
    const files = (await directoryFiles(this.tempDirectory)).sort((left, right) => left.modifiedMs - right.modifiedMs);
    const cutoff = this.now().getTime() - this.tempRetentionDays * 24 * 60 * 60 * 1000;
    let totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    let removedBytes = 0;
    let removedCount = 0;
    for (const file of files) {
      if (file.modifiedMs >= cutoff && totalBytes <= this.tempMaxBytes) continue;
      if (!isInside(this.tempDirectory, file.path)) continue;
      await fs.unlink(file.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      totalBytes -= file.bytes; removedBytes += file.bytes; removedCount += 1;
    }
    const completedAt = this.now().toISOString();
    await this.databaseStore.update(draft => {
      draft.aiStorageMaintenance = { ...(draft.aiStorageMaintenance || {}), lastCleanupAt: completedAt,
        lastCleanupResult: { removedCount, removedBytes } };
      return draft.aiStorageMaintenance;
    });
    return { ok: true, removedCount, removedBytes, remainingBytes: Math.max(0, totalBytes), completedAt };
  }

  async rebuildIndex() {
    await this.databaseStore.requireHostFileOperation?.();
    const database = await this.databaseStore.read();
    const entries = (database.aiFileIndexEntries || []).filter(entry => entry.status !== 'deleted');
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    const activeCachePaths = new Set();
    const updates = new Map();
    const errors = [];
    for (const entry of entries) {
      const archivePath = text(entry.archivePath);
      if (!archivePath || !(await statFile(archivePath)).exists) {
        errors.push({ fileId: entry.id, fileName: entry.fileName, message: '正式原文件不存在，已保留原记录等待人工核对' });
        continue;
      }
      try {
        const parsed = await this.aiFileTaskService.parseFile(archivePath, text(entry.extension) || path.extname(archivePath).toLowerCase(), entry.fileName || path.basename(archivePath));
        const cachePath = path.join(this.cacheDirectory, `${entry.id}.json`);
        const temporaryPath = `${cachePath}.rebuild-${process.pid}`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(parsed.cache || {}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryPath, cachePath);
        activeCachePaths.add(path.resolve(cachePath));
        updates.set(entry.id, { cachePath, status: parsed.status, parser: parsed.parser, format: parsed.format,
          detectedModule: parsed.detectedModule, confidence: parsed.confidence, summary: parsed.summary,
          fields: parsed.fields || [], sheetNames: parsed.sheetNames || [], pageCount: parsed.pageCount || null,
          totalRows: parsed.totalRows || 0, previewRows: parsed.previewRows || [], chunks: parsed.chunks || [],
          ocrFields: parsed.ocrFields || [], ocrPageCount: parsed.ocrPageCount || 0,
          documentFields: parsed.documentFields || [], documentClassification: parsed.documentClassification || null,
          structureSummary: parsed.structureSummary || null, warnings: parsed.warnings || [] });
      } catch (error) {
        errors.push({ fileId: entry.id, fileName: entry.fileName, message: error.message || '索引生成失败' });
      }
    }
    for (const file of await directoryFiles(this.cacheDirectory)) {
      if (!activeCachePaths.has(path.resolve(file.path)) && isInside(this.cacheDirectory, file.path)) await fs.unlink(file.path).catch(() => {});
    }
    const completedAt = this.now().toISOString();
    await this.databaseStore.update(draft => {
      for (const entry of (draft.aiFileIndexEntries ||= [])) if (updates.has(entry.id)) Object.assign(entry, updates.get(entry.id), { indexRebuiltAt: completedAt });
      draft.aiStorageMaintenance = { ...(draft.aiStorageMaintenance || {}), lastRebuildAt: completedAt,
        lastRebuildResult: { rebuiltCount: updates.size, failedCount: errors.length } };
      return draft.aiStorageMaintenance;
    });
    return { ok: errors.length === 0, rebuiltCount: updates.size, failedCount: errors.length, errors, completedAt };
  }
}

module.exports = { AiStorageService, directoryFiles, isInside, statFile };
