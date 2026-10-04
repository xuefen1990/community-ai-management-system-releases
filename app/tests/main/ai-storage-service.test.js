'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { JsonDatabaseStore } = require('../../src/main/database-store');
const { AiStorageService } = require('../../src/main/ai-storage-service');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const now = () => new Date('2026-09-21T08:00:00.000Z');
  const store = new JsonDatabaseStore({ userDataPath: root, now });
  await store.initialize();
  const cacheDirectory = path.join(store.dataDirectory, 'ai-file-index');
  const archiveDirectory = path.join(store.dataDirectory, 'foundation-archives');
  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.mkdir(archiveDirectory, { recursive: true });
  const archivePath = path.join(archiveDirectory, 'document-1.txt');
  const cachePath = path.join(cacheDirectory, 'file-1.json');
  await fs.writeFile(archivePath, '正式档案正文');
  await fs.writeFile(cachePath, JSON.stringify({ text: '旧索引' }));
  await store.update(database => {
    database.documents.push({ id: 'document-1', name: '正式材料.txt', file_path: archivePath });
    database.aiFileIndexEntries.push({ id: 'file-1', documentId: 'document-1', fileName: '正式材料.txt', extension: '.txt',
      status: 'parsed', archivePath, cachePath, createdAt: now().toISOString() });
  });
  const aiFileTaskService = {
    cacheDirectory,
    parseFile: async filePath => ({ format: 'text', parser: 'plain-text', status: 'parsed', detectedModule: 'document',
      confidence: 0.9, summary: '重建完成', chunks: [{ index: 1, text: await fs.readFile(filePath, 'utf8') }],
      documentFields: [], warnings: [], cache: { text: await fs.readFile(filePath, 'utf8') } }),
  };
  return { root, store, archivePath, cachePath, cacheDirectory, now,
    service: new AiStorageService({ databaseStore: store, aiFileTaskService, now, tempRetentionDays: 7 }) };
}

test('存储统计区分正式数据、正式档案、AI 索引和备份', async t => {
  const f = await fixture(t);
  const overview = await f.service.getOverview();
  assert.equal(overview.categories.formalAttachments.count, 1);
  assert.equal(overview.categories.aiIndex.count, 1);
  assert.equal(overview.categories.aiIndex.fileCount, 1);
  assert.equal(overview.anomalyCount, 0);
  assert.ok(overview.categories.formalData.count >= 1);
});

test('清理临时缓存不会删除正式档案或 AI 索引', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.service.tempDirectory, { recursive: true });
  const stale = path.join(f.service.tempDirectory, 'stale.tmp');
  const current = path.join(f.service.tempDirectory, 'current.tmp');
  await fs.writeFile(stale, Buffer.alloc(256));
  await fs.writeFile(current, Buffer.alloc(128));
  await fs.utimes(stale, new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-01T00:00:00.000Z'));
  const result = await f.service.cleanTemporaryCache();
  assert.equal(result.removedCount, 1);
  await assert.rejects(fs.access(stale));
  await fs.access(current);
  await fs.access(f.archivePath);
  await fs.access(f.cachePath);
});

test('重建索引从正式档案生成新缓存并保留正式文件', async t => {
  const f = await fixture(t);
  const orphan = path.join(f.cacheDirectory, 'orphan.json');
  await fs.writeFile(orphan, '{}');
  const result = await f.service.rebuildIndex();
  assert.equal(result.rebuiltCount, 1);
  assert.equal(result.failedCount, 0);
  assert.match(await fs.readFile(f.cachePath, 'utf8'), /正式档案正文/u);
  await fs.access(f.archivePath);
  await assert.rejects(fs.access(orphan));
  const database = await f.store.read();
  assert.equal(database.aiFileIndexEntries[0].summary, '重建完成');
  assert.equal(database.aiStorageMaintenance.lastRebuildResult.rebuiltCount, 1);
});

test('正式原文件缺失时保留索引记录并报告异常', async t => {
  const f = await fixture(t);
  await fs.unlink(f.archivePath);
  const result = await f.service.rebuildIndex();
  assert.equal(result.rebuiltCount, 0);
  assert.equal(result.failedCount, 1);
  const database = await f.store.read();
  assert.equal(database.aiFileIndexEntries.length, 1);
  const overview = await f.service.getOverview();
  assert.ok(overview.anomalies.some(item => item.type === 'archive'));
});
