'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FoundationBackupService } = require('../../src/main/foundation-backup-service');
const { JsonDatabaseStore } = require('../../src/main/database-store');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foundation-backup-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new JsonDatabaseStore({ userDataPath: root });
  const file = path.join(root, 'synthetic-attachment.txt'); await fs.writeFile(file, 'original test content');
  await store.write({ personnel: [{ id: 'resident', bankAccounts: [{ id: 'bank' }] }], documents: [{ id: 'document', file_path: file }], workItems: [{ id: 'work', attachments: [{ path: file }] }] });
  const service = new FoundationBackupService({ store, authorize: async () => {} });
  return { root, store, file, service };
}
test('verified backup restores residents and linked attachments while preserving a recovery snapshot and current source files', async t => {
  const f = await fixture(t); const backup = await f.service.create();
  assert.equal(backup.filesCount, 1);
  await f.store.update(db => { db.personnel[0].name = 'changed'; return true; }); await fs.writeFile(f.file, 'later file content');
  const result = await f.service.restore(backup.relativePath); assert.equal(result.success, true);
  const restored = await f.store.read(); assert.equal(restored.personnel[0].name, undefined);
  assert.deepEqual(restored.personnel[0].bankAccounts, [{ id: 'bank' }]);
  assert.equal(await fs.readFile(restored.documents[0].file_path, 'utf8'), 'original test content');
  assert.equal(restored.workItems[0].attachments[0].path, restored.documents[0].file_path);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'later file content');
  const recovery = JSON.parse(await fs.readFile(path.join(f.service.directory, result.recoveryBackup, 'database.json'), 'utf8'));
  assert.equal(recovery.personnel[0].name, 'changed');
});
test('tampered backup and traversal are rejected before changing any current data', async t => {
  const f = await fixture(t); const backup = await f.service.create(); const before = await f.store.read();
  const manifest = JSON.parse(await fs.readFile(path.join(backup.path, 'manifest.json'), 'utf8'));
  await fs.writeFile(path.join(backup.path, manifest.files[0].relativePath), 'tampered');
  await assert.rejects(f.service.restore(backup.relativePath), { code: 'CORRUPT_BACKUP' });
  await assert.rejects(f.service.restore('../backup-external'), { code: 'INVALID_BACKUP' });
  assert.deepEqual(await f.store.read(), before);
});
test('missing historical attachment is explicitly reported instead of claiming a complete attachment backup', async t => {
  const f = await fixture(t); await fs.unlink(f.file);
  const backup = await f.service.create({ source: 'import', importJobId: 'synthetic-job' });
  assert.equal(backup.filesCount, 0); assert.deepEqual(backup.missingFiles, [f.file]); assert(backup.warning);
  assert.equal((await f.service.list()).backups[0].manifest.importJobId, 'synthetic-job');
  await assert.rejects(f.service.restoreImport('unknown-job'), { code: 'SNAPSHOT_NOT_FOUND' });
});
