'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { buildPersonnelView } = require('../../src/main/foundation-data-model');
function fixture(initial) {
  let database = structuredClone(initial), sequence = 0;
  const service = new FoundationBusinessService({ authorize: async () => {}, uuid: () => `test-${++sequence}`,
    store: { read: async () => structuredClone(database), update: async mutate => { const draft = structuredClone(database); const result = await mutate(draft); database = draft; return { result }; } } });
  const request = (method, path, body) => service.request({ method, path: `/api/v3${path}`, body });
  return { get db() { return database; }, request, async rows(path) { const result = await request('GET', path); assert.equal(result.ok, true); return result.data.items; } };
}

test('linked households retain leading-zero identities through resident moves and protect the main household', async () => {
  const f = fixture({ personnel: ['001', '002', '003'].map((household_id, id) => ({ id, name: `测试${id}`, household_id, bankAccounts: [{ id: 'retained' }] })) });
  const households = await f.rows('/households');
  let saved = await f.request('POST', '/household-link-groups', { name: '测试关联', mainHouseholdId: households[0].id, memberHouseholdIds: [households[1].id] });
  assert.equal(saved.ok, true); const group = saved.data.group;
  assert.equal(f.db.households.length, 2);
  await f.request('POST', '/people/batch-patch', { selection: { ids: [0] }, patch: { householdNo: '009' } });
  assert(buildPersonnelView(f.db).households.some(item => item.id === households[0].id));
  assert.deepEqual(f.db.personnel[0].bankAccounts, [{ id: 'retained' }]);
  saved = await f.request('POST', `/household-link-groups/${encodeURIComponent(group.id)}/members`, { householdId: households[2].id });
  assert.equal(saved.data.group.members.length, 3);
  const main = saved.data.group.members.find(item => item.householdId === group.mainHouseholdId);
  const rejected = await f.request('DELETE', `/household-link-groups/${group.id}/members/${main.id}`, { baseVersion: main.version });
  assert.equal(rejected.error.code, 'MAIN_HOUSEHOLD_REQUIRED');
  const member = saved.data.group.members.find(item => item.householdId === households[2].id);
  assert.equal((await f.request('DELETE', `/household-link-groups/${group.id}/members/${member.id}`, { baseVersion: member.version })).ok, true);
  assert.equal((await f.rows('/household-link-groups'))[0].members.length, 2);
});

test('batch edits are atomic for missing identities and retain unedited account data', async () => {
  const f = fixture({ personnel: [{ id: 'one', name: '测试', tags: ['党员'], bankAccounts: [{ id: 'bank' }] }] });
  const original = structuredClone(f.db);
  assert.equal((await f.request('POST', '/people/batch-patch', { selection: { ids: ['one', 'missing'] }, patch: { phone: 'TEST' } })).ok, false);
  assert.deepEqual(f.db, original);
  assert.equal((await f.request('POST', '/people/batch-patch', { selection: { ids: ['one'] }, patch: { phone: 'TEST' }, tagAction: { mode: 'add', tags: ['学生'] } })).ok, true);
  assert.deepEqual(f.db.personnel[0].tags, ['党员', '学生']); assert.deepEqual(f.db.personnel[0].bankAccounts, original.personnel[0].bankAccounts);
});

test('historical annual party dues expand by month and independent month removals do not invalidate each other', async () => {
  const f = fixture({ partyDues: [{ member_id: 'member', year: '2026', monthly_amount: 12.5, paid_months: [1, 2, 3], status: '部分交纳', extra: 'retained' }] });
  const rows = await f.rows('/party/dues?dueYear=2026&partyMemberId=member');
  assert.equal(rows.length, 3); assert.equal(rows[0].amountCents, 1250);
  for (const row of rows) assert.equal((await f.request('DELETE', `/party/dues/${encodeURIComponent(row.id)}`, { baseVersion: row.version })).ok, true);
  assert.equal((await f.rows('/party/dues')).length, 0);
  assert.equal(f.db.partyDues[0].extra, 'retained'); assert.equal(f.db.foundationDeletedRecords.length, 3);
});

test('party member and monthly dues survive a fresh service load with old aliases intact', async () => {
  const f = fixture({});
  const created = await f.request('POST', '/party/members', { name: '测试党员', externalIdCard: 'TEST-CARD', memberType: '流动党员', joinDate: '2020-01-01' });
  const member = created.data.member;
  assert(member.id.startsWith('party-member-')); assert.equal(f.db.partyMembers[0].id_card, 'TEST-CARD');
  await f.request('POST', `/party/members/${member.id}/development`, { stage: '正式党员', contacts: [{ phone: 'TEST-PHONE' }] });
  assert.equal(f.db.partyMembers[0].phone, 'TEST-PHONE');
  const payload = { partyMemberId: member.id, dueYear: 2026, dueMonth: 9, amountCents: 1000, status: '已缴' };
  assert.equal((await f.request('POST', '/party/dues', payload)).ok, true);
  assert.equal((await f.request('POST', '/party/dues', payload)).error.code, 'DUPLICATE_DUE');
  assert.equal((await fixture(f.db).rows('/party/dues'))[0].amountCents, 1000);
});

test('AI legacy schedule appears in the new duty page and edits update the authoritative AI schedule', async () => {
  const f = fixture({ dutyFlexible: { schedule: { '2026-09-08': ['测试甲'] }, preference: 'kept' } });
  const [plan] = await f.rows('/duty/plans?startDate=2026-09-08&endDate=2026-09-08');
  assert.equal(plan.days[0].assignments[0].nameSnapshot, '测试甲');
  assert.equal((await f.request('POST', '/duty/assignments', { planId: plan.id, dutyDate: '2026-09-08', nameSnapshot: '测试乙' })).ok, true);
  assert.deepEqual(f.db.dutyFlexible.schedule['2026-09-08'], ['测试甲', '测试乙']);
  const assignment = plan.days[0].assignments[0];
  assert.equal((await f.request('DELETE', '/duty/assignments', { planId: plan.id, dutyDate: '2026-09-08', assignmentId: assignment.id })).ok, true);
  assert.deepEqual(f.db.dutyFlexible.schedule['2026-09-08'], ['测试乙']); assert.equal(f.db.dutyFlexible.preference, 'kept');
});

test('new duty plans reject invalid dates, keep duplicate assignments idempotent and persist across reads', async () => {
  const f = fixture({});
  assert.equal((await f.request('POST', '/duty/plans', { theme: '测试', startDate: '2026-02-30', endDate: '2026-03-01' })).ok, false);
  assert.deepEqual(f.db, {});
  const created = await f.request('POST', '/duty/plans', { theme: '测试排班', startDate: '2026-09-08', endDate: '2026-09-09' });
  const payload = { planId: created.data.plan.id, dutyDate: '2026-09-08', nameSnapshot: '测试人员' };
  await f.request('POST', '/duty/assignments', payload); await f.request('POST', '/duty/assignments', payload);
  assert.equal((await fixture(f.db).rows('/duty/plans'))[0].days[0].assignments.length, 1);
});

test('import histories and cadres/public workers stay in their correct collections', async () => {
  const f = fixture({});
  for (const domain of ['personnel', 'land']) assert.equal((await f.request('POST', '/import-jobs', { domain, totalRows: 3, insertedRows: 2, updatedRows: 1, report: { fileName: 'synthetic.xlsx' } })).ok, true);
  assert.equal((await f.rows('/import-jobs?domain=personnel')).length, 1); assert.equal(f.db.landImportRecords.length, 1);
  assert.equal(f.db.personnelImportRecords[0].added, 2);
  await f.request('POST', '/duty/people', { personType: 'cadre', name: '测试干部' });
  await f.request('POST', '/duty/people', { personType: 'public', name: '测试公益岗' });
  assert.equal((await f.rows('/duty/people?personType=cadre')).length, 1); assert.equal(f.db.dutyPublicPosts.length, 1);
});
