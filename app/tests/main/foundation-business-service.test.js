'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPersonnelView, upsertPeople, revision } = require('../../src/main/foundation-data-model');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { RemoteDatabaseStore } = require('../../src/main/remote-database-store');

function fixture() {
  return { settings: { villageName: '测试社区' }, personnel: [
    { id: 'resident-original', name: '测试居民甲', id_card: 'TEST-001', household_id: '0012', village_group: '测试一组',
      birth_date: '1980-01-01', relation_to_head: '户主', bankAccounts: [{ id: 'bank-original', number: 'TEST-BANK' }],
      tags: ['党员'], party_info: { branch: '测试支部' }, customFields: { unknownField: { retained: true } },
      farmlandSubsidyHistory: [{ id: 'paid-1', amountCents: 12345 }], disbursementHistory: [{ batchId: 'batch-original' }] },
    { id: 'resident-child', name: '测试居民乙', idCard: 'TEST-002', household_id: '0012', village_group: '测试一组', relation_to_head: '子' },
  ], disbursementBatches: [{ id: 'batch-original', personId: 'resident-original' }], workItems: [{ residentId: 'resident-original' }] };
}
function service(database = fixture(), authorize = async () => {}) {
  let stored = structuredClone(database);
  let reads = 0;
  const store = { async read() { reads++; await new Promise(resolve => setImmediate(resolve)); return structuredClone(stored); },
    async update(mutator) { const draft = structuredClone(stored); const result = await mutator(draft); stored = draft; return { result, data: draft }; } };
  return { api: new FoundationBusinessService({ store, authorize }), data: () => structuredClone(stored), reads: () => reads };
}
const request = (api, path, method = 'GET', body) => api.request({ path: `/api/v3${path}`, method, body });

test('new resident views preserve identities, leading-zero households, grouping and specialty data without changing storage', () => {
  const db = fixture(); const before = structuredClone(db);
  const view = buildPersonnelView(db);
  assert.deepEqual(db, before);
  assert.equal(view.people[0].id, 'resident-original');
  assert.equal(view.households[0].householdNo, '0012');
  assert.equal(view.people[0].householdId, view.people[1].householdId);
  assert.equal(view.households[0].headPersonId, 'resident-original');
  assert.equal(view.people[0].villageGroupId, view.villageGroups[0].id);
  assert.equal(view.people[0].birthDate, '1980-01-01');
  assert.equal(view.people[0].customFields.party_info.branch, '测试支部');
  assert.deepEqual(view.people[0].customFields.unknownField, { retained: true });
});

test('legacy residents without internal IDs open and save the correct record', async () => {
  const db = fixture();
  delete db.personnel[0].id; delete db.personnel[1].id;
  const before = structuredClone(db);
  const view = buildPersonnelView(db);
  assert.deepEqual(db, before);
  assert.ok(view.people[0].id); assert.ok(view.people[1].id);
  assert.notEqual(view.people[0].id, view.people[1].id);
  const { api, data } = service(db);
  const second = (await request(api, '/people')).data.items[1];
  const snapshot = await request(api, `/people/editor?id=${encodeURIComponent(second.id)}`);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.person.name, '测试居民乙');
  assert.equal(snapshot.data.version, second.version);
  const saved = await request(api, '/people/editor', 'PATCH', {
    id: second.id, baseVersion: snapshot.data.version,
    fields: { name: '测试居民乙已修改', idCard: 'TEST-002', phone: '123456' },
    customFields: snapshot.data.customFields, customFieldsVersion: snapshot.data.customFieldsVersion,
  });
  assert.equal(saved.ok, true);
  assert.equal(data().personnel[1].name, '测试居民乙已修改');
  assert.equal(data().personnel[1].id, second.id);
  assert.equal(data().personnel[0].name, '测试居民甲');
});

test('editing through the real v2.6.4 payload retains accounts, payment history, original IDs and all cross-module records', async () => {
  const { api, data } = service(); const before = data();
  const view = (await request(api, '/people')).data.items[0];
  const saved = await request(api, '/people/batch-upsert', 'POST', { items: [{
    baseVersion: view.version, baseValues: { idCard: view.idCard }, householdNo: '0012', villageGroupName: '测试二组',
    fields: { name: '测试更名', idCard: 'TEST-003', birthDate: '1981-01-01', customFields: view.customFields }, tags: view.tags,
  }] });
  assert.equal(saved.ok, true); assert.equal(saved.data.updatedRows, 1); assert.equal(saved.data.insertedRows, 0);
  const after = data(); const p = after.personnel[0];
  assert.equal(p.id, 'resident-original'); assert.equal(p.idCard, 'TEST-003'); assert.equal(p.id_card, 'TEST-003');
  assert.equal(p.birth_date, '1981-01-01'); assert.equal(p.household_id, '0012');
  for (const key of ['bankAccounts', 'farmlandSubsidyHistory', 'disbursementHistory']) assert.deepEqual(p[key], before.personnel[0][key]);
  assert.deepEqual(after.disbursementBatches, before.disbursementBatches); assert.deepEqual(after.workItems, before.workItems);
  assert.equal(after.operationLogs.length, 1);
});

test('stale forms cannot overwrite a later account edit, even when legacy code did not increment a version', () => {
  const db = fixture(); const version = revision(db.personnel[0]);
  db.personnel[0].bankAccounts.push({ id: 'new-card' });
  const result = upsertPeople(db, [{ baseVersion: version, fields: { idCard: 'TEST-001', name: '不应保存' } }]);
  assert.equal(result.failed[0].code, 'VERSION_CONFLICT');
  assert.equal(db.personnel[0].name, '测试居民甲'); assert.equal(db.personnel[0].bankAccounts.length, 2);
});

test('duplicate identity and missing edited identity fail rather than merging unrelated residents or recreating a deleted record', () => {
  const db = fixture();
  let result = upsertPeople(db, [{ baseValues: { idCard: 'TEST-001' }, baseVersion: revision(db.personnel[0]), fields: { name: '测试', idCard: 'TEST-002' } }]);
  assert.equal(result.failed[0].code, 'DUPLICATE_ID_CARD');
  result = upsertPeople(db, [{ baseValues: { idCard: 'MISSING' }, baseVersion: 1, fields: { name: '测试', idCard: 'TEST-003' } }]);
  assert.equal(result.failed[0].code, 'NOT_FOUND'); assert.equal(db.personnel.length, 2);
});

test('concurrent initial API reads share one conversion and return defensive copies', async () => {
  const { api, reads } = service();
  const results = await Promise.all(['/people', '/households', '/village-groups', '/special-categories', '/system-settings'].map(path => request(api, path)));
  assert.equal(reads(), 1); assert(results.every(r => r.ok));
  results[0].data.items[0].name = '外部修改';
  assert.equal((await request(api, '/people')).data.items[0].name, '测试居民甲');
});

test('authorization denial prevents reads and mutations; unsupported actions do not report success', async () => {
  const denied = service(fixture(), async () => { throw Object.assign(new Error('请登录'), { code: 'PRODUCT_AUTH_REQUIRED' }); });
  assert.equal((await request(denied.api, '/people')).error.code, 'PRODUCT_AUTH_REQUIRED'); assert.equal(denied.reads(), 0);
  const normal = service(); const before = normal.data();
  assert.equal((await request(normal.api, '/unknown', 'POST', { anything: true })).error.code, 'NOT_IMPLEMENTED');
  assert.deepEqual(normal.data(), before);
});

test('AI certificate drafts can be saved through the business gateway with PUT', async () => {
  const { api, data } = service();
  const saved = await request(api, '/certificate-ai-draft', 'PUT', {
    messages: [{ role: 'user', content: '请开具关系证明' }],
    title: '亲属关系证明',
    content: '草稿正文',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.draft.content, '草稿正文');
  assert.equal(data().certificateAiDraft.title, '亲属关系证明');
  const restored = await request(api, '/certificate-ai-draft');
  assert.equal(restored.data.draft.messages[0].content, '请开具关系证明');

  // PUT remains restricted to the one resource that implements it.
  const unsupported = await request(api, '/people/editor', 'PUT', {});
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'METHOD_NOT_ALLOWED');
});

test('deleting a resident preserves a full recovery record and leaves original payment references unchanged', async () => {
  const { api, data } = service(); const before = data();
  const result = await request(api, '/people/resident-original', 'DELETE', { baseVersion: revision(before.personnel[0]) });
  assert.equal(result.ok, true); assert.equal(data().personnel.length, 1);
  assert.deepEqual(data().foundationDeletedResidents[0].person, before.personnel[0]);
  assert.deepEqual(data().disbursementBatches, before.disbursementBatches);
});

test('10,000 residents expose a full count while a requested page contains only 15 rows', async () => {
  const db = fixture(); db.personnel = Array.from({ length: 10000 }, (_, i) => ({ id: `synthetic-${i}`, name: `测试居民${i}`, idCard: `TEST-${i}`, household_id: String(Math.floor(i / 4)).padStart(6, '0'), village_group: `测试${i % 8}组` }));
  const { api } = service(db); const result = await request(api, '/people?limit=15&offset=15');
  assert.equal(result.data.total, 10000); assert.equal(result.data.items.length, 15); assert.equal(result.data.items[0].id, 'synthetic-15');
});

test('transactional edits from different modules serialize read-modify-write and recover after a failure', async () => {
  let saved = { personnel: [], workItems: [] };
  const store = new RemoteDatabaseStore({
    authService: { getStatus: async () => ({ authenticated: false, account: null }) },
    localStore: { read: async () => structuredClone(saved), write: async value => { saved = structuredClone(value); return { ok: true }; } },
  });
  await Promise.all([
    store.update(async draft => { await new Promise(resolve => setTimeout(resolve, 15)); draft.personnel.push({ id: 'p' }); }),
    store.update(draft => { draft.workItems.push({ id: 'w' }); }),
  ]);
  assert.equal(saved.personnel.length, 1); assert.equal(saved.workItems.length, 1);
  await assert.rejects(store.update(() => { throw new Error('拒绝保存'); }));
  await store.update(draft => { draft.workItems.push({ id: 'w2' }); });
  assert.equal(saved.workItems.length, 2);
});
test('unchanged sequential loads reuse derived views while external extension edits invalidate the cache', async () => {
  let database = { personnel: [{ id: 'synthetic', name: 'before', bankAccounts: [] }] };
  const service = new FoundationBusinessService({ authorize: async () => {}, store: { read: async () => structuredClone(database), update: async () => {} } });
  const first = await service.load(); await new Promise(resolve => setImmediate(resolve));
  const again = await service.load(); assert.strictEqual(first.views, again.views);
  database.personnel[0].name = 'after'; database.personnel[0].bankAccounts.push({ id: 'new-account' });
  await new Promise(resolve => setImmediate(resolve));
  const changed = await service.load(); assert.notStrictEqual(changed.views, first.views);
  assert.equal(changed.personnel.people[0].name, 'after');
  assert.notEqual(changed.personnel.people[0].version, first.personnel.people[0].version);
});
