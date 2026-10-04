'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { domainRows, mutateDomain } = require('../../src/main/foundation-domains');
const { revision } = require('../../src/main/foundation-data-model');
const options = { now: () => new Date('2026-09-08T01:00:00Z'), uuid: () => 'synthetic-new-record' };

test('both historical finance collection names are visible without double-counting mirrored IDs', () => {
  const db = { finances: [{ id: 'same', type: 'income', amount: 120.25 }], financeRecords: [{ id: 'same', type: 'income', amount: 110 }, { id: 'legacy', type: 'expense', amount: 20 }] };
  const rows = domainRows(db, '/finance-records');
  assert.equal(rows.length, 2); assert.equal(rows[0].amountCents, 12025); assert.equal(rows[1].amountCents, 2000);
});

test('finance create and edit keep currency, voucher, date and extension aliases usable by the existing AI service', () => {
  const db = {};
  const created = mutateDomain(db, 'POST', '/finance-records', { recordType: 'income', recordDate: '2026-09-08', amountCents: 12345, summary: '测试收入', voucherNo: 'V-TEST' }, options);
  assert.equal(db.finances[0].amount, 123.45); assert.equal(db.finances[0].voucherNumber, 'V-TEST'); assert.equal(db.finances[0].date, '2026-09-08');
  db.finances[0].attachments = [{ id: 'kept' }];
  const updated = mutateDomain(db, 'PATCH', `/finance-records/${created.item.id}`, { baseVersion: revision(db.finances[0]), changes: { amountCents: 9999, summary: '测试更正' } }, options);
  assert.equal(updated.item.amountCents, 9999); assert.equal(db.finances[0].amount, 99.99);
  assert.deepEqual(db.finances[0].attachments, [{ id: 'kept' }]); assert.deepEqual(db.financeRecords[0], db.finances[0]);
});

test('AI-created land maps to the reference page and an area/holder edit remains visible to contract extensions', () => {
  const db = { personnel: [{ id: 'p1', name: '测试居民', id_card: 'TEST-CARD' }], landParcel: [{ id: 'land1', parcel_name: '测试地块', code: 'TEST-PARCEL', areaMu: 1.25, contractorIds: ['p1'], extraContractField: { retained: true } }] };
  const row = domainRows(db, '/land-parcels')[0];
  assert.equal(row.areaSquareMeterX100, 125); assert.equal(row.holders[0].personId, 'p1'); assert.equal(row.parcelNo, 'TEST-PARCEL');
  mutateDomain(db, 'PATCH', '/land-parcels/land1', { baseVersion: row.version, changes: { areaSquareMeterX100: 250 }, holders: [{ personId: 'p1', holderNameSnapshot: '测试居民', holderIdCardSnapshot: 'TEST-CARD' }] }, options);
  assert.equal(db.landParcel[0].area, 2.5); assert.deepEqual(db.landParcel[0].contractorIds, ['p1']);
  assert.deepEqual(db.landParcel[0].extraContractField, { retained: true });
});

test('invalid amounts and stale edits leave original domain records unchanged', () => {
  const db = { finances: [{ id: 'f1', type: 'income', amount: 1, summary: '测试' }] }; const original = structuredClone(db);
  assert.throws(() => mutateDomain(db, 'PATCH', '/finance-records/f1', { baseVersion: revision(db.finances[0]), changes: { amountCents: -1 } }, options), { code: 'INVALID_INPUT' });
  assert.deepEqual(db, original);
  assert.throws(() => mutateDomain(db, 'DELETE', '/finance-records/f1', { baseVersion: 1 }, options), { code: 'VERSION_CONFLICT' });
  assert.deepEqual(db, original);
});

test('deleting through either reference collection keeps a recovery record and removes mirrored finance copies', () => {
  const record = { id: 'f1', type: 'income', amount: 1, summary: '测试', attachments: [{ path: 'synthetic-only' }] };
  const db = { finances: [record], financeRecords: [structuredClone(record)] };
  mutateDomain(db, 'DELETE', '/finance-records/f1', { baseVersion: revision(record) }, options);
  assert.equal(db.finances.length, 0); assert.equal(db.financeRecords.length, 0);
  assert.deepEqual(db.foundationDeletedRecords[0].record, record);
});

test('built-in certificate templates can be edited, hidden, and restored without discarding a recovery record', () => {
  const db = {}, initial = domainRows(db, '/certificate-templates');
  assert.equal(initial.length, 6);
  const template = initial[0];
  mutateDomain(db, 'PATCH', `/certificate-templates/${template.id}`, { baseVersion: template.version, changes: { content: '合成自定义正文', name: '合成自定义名称' } }, options);
  const edited = domainRows(db, '/certificate-templates').find(item => item.id === template.id);
  assert.equal(edited.content, '合成自定义正文');
  assert.throws(() => mutateDomain(db, 'PATCH', `/certificate-templates/${template.id}`, { baseVersion: template.version, changes: { content: '过期内容' } }, options), { code: 'VERSION_CONFLICT' });
  mutateDomain(db, 'DELETE', `/certificate-templates/${template.id}`, { baseVersion: edited.version }, options);
  assert.equal(domainRows(db, '/certificate-templates').length, 5);
  assert.equal(db.foundationDeletedRecords[0].record.content, '合成自定义正文');
  mutateDomain(db, 'POST', '/certificate-templates/restore-defaults', {}, options);
  assert.deepEqual(domainRows(db, '/certificate-templates'), initial);
});

test('certificate history changes are mirrored for existing AI queries and stale deletions are rejected', () => {
  const db = {};
  const result = mutateDomain(db, 'POST', '/certificate-records', { recordNo: 'SYNTHETIC-CERT', personName: '合成申请人', status: '有效' }, options);
  assert.equal(db.certificates[0].certificateNo, 'SYNTHETIC-CERT');
  const changed = mutateDomain(db, 'PATCH', `/certificate-records/${result.record.id}`, { baseVersion: result.record.version, changes: { status: '已作废' } }, options);
  assert.equal(db.certificates[0].status, '已作废');
  assert.throws(() => mutateDomain(db, 'DELETE', `/certificate-records/${result.record.id}`, { baseVersion: result.record.version }, options), { code: 'VERSION_CONFLICT' });
  mutateDomain(db, 'DELETE', `/certificate-records/${result.record.id}`, { baseVersion: changed.record.version }, options);
  assert.equal(db.certificates.length, 0); assert.equal(db.certificateRecords.length, 0);
});
