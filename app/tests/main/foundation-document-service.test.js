'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FoundationDocumentService, documentRows } = require('../../src/main/foundation-document-service');
const { JsonDatabaseStore } = require('../../src/main/database-store');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foundation-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new JsonDatabaseStore({ userDataPath: root });
  const opened = [];
  const service = new FoundationDocumentService({ store, authorize: async () => {}, shell: { openPath: async file => { opened.push(file); return ''; } } });
  const source = path.join(root, 'synthetic.txt'); await fs.writeFile(source, 'synthetic test content');
  return { root, source, store, service, opened };
}
test('archive copies the exact file, keeps originals and persists resident and land links', async t => {
  const f = await fixture(t);
  const links = [{ targetType: 'person', personId: 'synthetic-person' }, { targetType: 'land_parcel', landParcelId: 'synthetic-land' }];
  const result = await f.service.request({ action: 'archive', sourceFilePath: f.source, name: '测试档案.txt', links });
  assert.equal(result.success, true);
  assert.equal(await fs.readFile(result.document.file_path, 'utf8'), await fs.readFile(f.source, 'utf8'));
  assert.deepEqual((await f.store.read()).documents[0].links, links);
  assert.equal((await f.service.request({ action: 'open', documentId: result.document.id })).success, true);
  assert.equal(f.opened[0], result.document.file_path);
});
test('trash, restore and cabinet removal preserve source files and a full recovery record', async t => {
  const f = await fixture(t);
  const { document } = await f.service.request({ action: 'archive', sourceFilePath: f.source });
  const action = action => f.service.request({ action, documentId: document.id });
  assert.equal((await action('deletePermanently')).code, 'NOT_IN_TRASH');
  await action('moveToTrash'); assert.equal(documentRows(await f.store.read())[0].storageArea, 'trash');
  await action('restore'); assert.equal(documentRows(await f.store.read())[0].storageArea, 'archives');
  await action('moveToTrash'); await action('deletePermanently');
  const database = await f.store.read(); assert.equal(database.documents.length, 0);
  assert.equal(database.foundationDeletedRecords[0].record.id, document.id);
  assert.equal(await fs.readFile(f.source, 'utf8'), 'synthetic test content');
  assert.equal(await fs.readFile(document.file_path, 'utf8'), 'synthetic test content');
});
test('denied access and missing files never create an archive record or report success', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.request({ action: 'archive', sourceFilePath: `${f.source}.missing` })).success, false);
  assert.equal((await f.store.read()).documents.length, 0);
  f.service.authorize = async () => { throw Object.assign(new Error('denied'), { code: 'FORBIDDEN' }); };
  assert.equal((await f.service.request({ action: 'archive', sourceFilePath: f.source })).code, 'FORBIDDEN');
  assert.equal((await f.store.read()).documents.length, 0);
});
test('a stored document path outside the data directory cannot be opened', async t => {
  const f = await fixture(t);
  await f.store.update(database => {
    database.documents ||= [];
    database.documents.push({ id: 'external-file', name: '外部文件', file_path: f.source });
  });
  const result = await f.service.request({ action: 'open', documentId: 'external-file' });
  assert.equal(result.success, false);
  assert.match(result.error, /应用数据目录/u);
  assert.deepEqual(f.opened, []);
});
test('database write failure cleans only the newly copied file', async t => {
  const f = await fixture(t); await f.store.initialize();
  f.store.update = async () => { throw new Error('synthetic persistence failure'); };
  assert.equal((await f.service.request({ action: 'archive', sourceFilePath: f.source })).success, false);
  assert.deepEqual(await fs.readdir(f.service.directory), []);
  assert.equal(await fs.readFile(f.source, 'utf8'), 'synthetic test content');
});
test('folder archives preserve source folders and skip external symlinks', async t => {
  const f = await fixture(t); const folder = path.join(f.root, 'folder'); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'a.txt'), 'a'); await fs.writeFile(path.join(folder, 'b.txt'), 'b');
  await fs.symlink(f.source, path.join(folder, 'external.txt'));
  const result = await f.service.request({ action: 'archive', sourceFilePath: folder, preserveOriginalName: true });
  assert.equal(result.success, true); assert.equal(result.archivedFiles.length, 2);
  assert.equal((await fs.readdir(folder)).length, 3); assert.equal((await f.store.read()).documents.length, 2);
});
test('document category update checks the current version and preserves the archived file', async t => {
  const f = await fixture(t);
  const { document } = await f.service.request({ action: 'archive', sourceFilePath: f.source, category: '待归档' });
  const changed = await f.service.request({ action: 'updateCategory', documentId: document.id, category: '合同档案', baseVersion: document.version });
  assert.equal(changed.success, true);
  assert.equal(changed.document.category, '合同档案');
  assert.equal((await f.store.read()).documents[0].file_category, '合同档案');
  assert.equal(await fs.readFile(document.file_path, 'utf8'), 'synthetic test content');
  const stale = await f.service.request({ action: 'updateCategory', documentId: document.id, category: '其他材料', baseVersion: document.version });
  assert.equal(stale.success, false);
  assert.equal(stale.code, 'VERSION_CONFLICT');
  assert.equal((await f.store.read()).documents[0].category, '合同档案');
});

test('子电脑归档只把文件送往主电脑，不在子电脑建立业务附件副本', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foundation-child-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.pdf');
  await fs.writeFile(source, 'remote archive');
  const database = { documents: [] };
  const store = { dataDirectory: path.join(root, 'data'), isRemoteChild: async () => true,
    uploadArchivedFile: async file => {
      assert.equal(file, source);
      return { id: 'host-doc-1', path: '/host/data/foundation-archives/host-doc-1.pdf',
        sha256: await require('../../src/main/foundation-backup-service').hashFile(source) };
    },
    update: async mutator => ({ result: await mutator(database) }) };
  const service = new FoundationDocumentService({ store, authorize: async () => {}, shell: { openPath: async () => '' } });
  const result = await service.request({ action: 'archive', sourceFilePath: source });
  assert.equal(result.success, true);
  assert.equal(result.document.file_path, '/host/data/foundation-archives/host-doc-1.pdf');
  assert.equal(database.documents[0].sourcePath, '');
  await assert.rejects(fs.access(service.directory), { code: 'ENOENT' });
});
