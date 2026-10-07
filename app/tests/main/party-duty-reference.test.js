'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { FoundationAuthService } = require('../../src/main/foundation-auth-service');
const { revision } = require('../../src/main/foundation-data-model');
const { monthDates } = require('../../src/main/foundation-duty-reference');

function setup(extra = {}, authorize = async () => {}) {
  let database = { personnel: [{ id: 'resident', name: '合成人员', id_card: 'SYNTHETIC', tags: ['党员'],
    party_info: { branch: '合成支部' }, bankAccounts: [{ number: 'PRIVATE-SYNTHETIC' }], customFields: { retained: true } }],
    partyBranches: [{ id: 'branch', name: '合成支部' }], partyMembers: [{ id: 'member', name: '合成人员', id_card: 'SYNTHETIC',
      memberType: '本村党员', stage: '正式党员', branchId: 'branch', duesStandardCents: 1000 }],
    dutyCadres: [{ id: 'staff', name: '合成值班员' }], dutyRecords: [], ...extra };
  const backups = [];
  const store = { read: async () => structuredClone(database), createBackup: async () => { backups.push(structuredClone(database)); },
    update: async callback => { const draft = structuredClone(database), result = await callback(draft); database = draft; return { result }; } };
  let serial = 0;
  const service = new FoundationBusinessService({ store, authorize, uuid: () => `synthetic-${++serial}`, now: () => new Date('2026-10-06T12:00:00Z') });
  const request = (path, method = 'GET', body = {}) => service.request({ path: `/api/v3${path}`, method, body: structuredClone(body) });
  return { request, store, backups, read: () => structuredClone(database) };
}
async function data(request, path) { const result = await request(path); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; }

test('历史党员与积极分子兼容保存；先备份且保留居民账户及未知字段', async () => {
  const f = setup({ partyActivists: [{ id: 'activist', name: '旧积极分子', external_id_card: 'OLD-CARD' }] });
  const before = f.read();
  const rows = (await data(f.request, '/party/members')).items;
  assert.equal(rows.find(row => row.id === 'activist').stage, '积极分子');
  const updated = await f.request('/party/member-save', 'PATCH', { member: rows.find(row => row.id === 'member'), form: { phone: '10000000000', stage: '预备党员' } });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  assert.deepEqual(f.backups[0], before);
  const resident = f.read().personnel[0];
  assert.deepEqual(resident.bankAccounts, before.personnel[0].bankAccounts);
  assert.equal(resident.customFields.retained, true);
  assert.equal(resident.party_info.stage, '预备党员');
  assert.deepEqual(resident.tags, ['预备党员']);
  const activist = rows.find(row => row.id === 'activist');
  const saved = await f.request('/party/member-save', 'PATCH', { member: activist, form: { memberType: '流动党员' } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.data.member.stage, '积极分子');
  assert.equal(f.read().partyActivists.length, 0);
  assert.equal(f.backups.length, 1);
  const stale = await f.request('/party/member-save', 'PATCH', { member: rows[0], form: { phone: 'stale' } });
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
});

test('党费按年度原子替换，保留月份金额，拒绝过期年度与整批非法金额', async () => {
  const f = setup();
  const member = (await data(f.request, '/party/members')).items[0];
  let saved = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: 0, months: [{ month: 1, amountCents: 1234 }, { month: 2, amountCents: 1000 }] }] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const dues = (await data(f.request, '/party/dues')).items;
  assert.equal(dues.reduce((sum, row) => sum + row.amountCents, 0), 2234);
  assert.equal(dues[0].annualVersion, dues[1].annualVersion);
  const before = f.read();
  saved = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: 0, months: [] }] });
  assert.equal(saved.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(f.read(), before);
  saved = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: dues[0].annualVersion, months: [{ month: 1, amountCents: -1 }] }] });
  assert.equal(saved.error.code, 'INVALID_INPUT');
  assert.deepEqual(f.read(), before);
  saved = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: dues[0].annualVersion, months: [{ month: 1, amountCents: 0 }], status: '免缴' }] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.data.items[0].status, '免缴');
});

test('批量党费失败不会留下自动创建的党员档案；合成居民版本必须有效', async () => {
  const f = setup({ partyMembers: [] });
  const person = (await data(f.request, '/party/context/people')).items[0];
  const member = { id: 'party_auto_resident', name: person.name, id_card: person.idCard, residentVersion: person.version, member_type: '本村党员' };
  const before = f.read();
  const failed = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: 0, months: [{ month: 13, amountCents: 1000 }] }] });
  assert.equal(failed.error.code, 'INVALID_INPUT');
  assert.deepEqual(f.read(), before);
  const saved = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: 0, months: [{ month: 1, amountCents: 1000 }] }] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(f.read().partyMembers.length, 1);
});

test('党员专用读取不泄露银行账户，且只读子账号不能修改', async () => {
  const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, entitlement: { type: 'licensed' }, account: { role: 'member', permissions: { party: ['view'] } } }) } });
  const f = setup({}, scope => auth.authorize(scope));
  const people = (await data(f.request, '/party/context/people')).items;
  assert.equal(people[0].bankAccounts, undefined);
  assert.equal(people[0].customFields, undefined);
  assert.equal((await f.request('/people')).error.code, 'FORBIDDEN');
  assert.equal((await f.request('/party/member-save', 'POST', { form: { name: '非法添加' } })).error.code, 'FORBIDDEN');
});

test('首次兼容写入无法备份时不写入业务数据', async () => {
  const f = setup(); f.store.createBackup = async () => { throw new Error('备份磁盘不可用'); };
  const before = f.read();
  const result = await f.request('/duty/tasks', 'POST', { label: '新任务' });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /备份磁盘/);
  assert.deepEqual(f.read(), before);
});

test('排班五种月规则按真实日历，闰年和跨年正常', () => {
  assert.equal(monthDates(2024, 2).length, 29);
  assert.equal(monthDates(2024, 2, 'odd').length, 15);
  assert.equal(monthDates(2024, 2, 'even').length, 14);
  assert.equal(monthDates(2024, 2, 'workday').length + monthDates(2024, 2, 'weekend').length, 29);
  assert.throws(() => monthDates(2024, 13), /月份/);
});

test('整月排班、重复追加、过期版本和非法人员均保持原子性', async () => {
  const f = setup();
  const baseVersion = (await data(f.request, '/duty/plans')).revision;
  const body = { baseVersion, action: 'bulk', year: 2024, month: 2, rule: 'all', tasks: ['防汛', '除雪'], names: ['合成值班员'] };
  let result = await f.request('/duty/schedule', 'PATCH', body);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.added, 58);
  const before = f.read();
  result = await f.request('/duty/schedule', 'PATCH', body);
  assert.equal(result.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(f.read(), before);
  const current = (await data(f.request, '/duty/plans')).revision;
  result = await f.request('/duty/schedule', 'PATCH', { ...body, baseVersion: current });
  assert.equal(result.data.added, 0);
  const stable = f.read();
  result = await f.request('/duty/schedule', 'PATCH', { ...body, baseVersion: current, names: ['合成值班员', '不存在'] });
  assert.equal(result.error.code, 'NOT_FOUND');
  assert.deepEqual(f.read(), stable);
});

test('复制前日与清空月保留其他月份、任务和民情记录', async () => {
  const f = setup({ visitRecords: [{ id: 'visit', content: '保留民情' }] });
  let baseVersion = (await data(f.request, '/duty/plans')).revision;
  let result = await f.request('/duty/schedule', 'PATCH', { baseVersion, action: 'replace-day', date: '2025-12-31', task: '防汛', names: ['合成值班员'] });
  assert.equal(result.ok, true, JSON.stringify(result)); baseVersion = result.data.revision;
  result = await f.request('/duty/schedule', 'PATCH', { baseVersion, action: 'copy', pairs: [{ source: '2025-12-31', target: '2026-01-01' }] });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.added, 1);
  result = await f.request('/duty/schedule', 'PATCH', { baseVersion: result.data.revision, action: 'clear-month', year: 2026, month: 1 });
  assert.equal(result.data.removed, 1);
  const plans = (await data(f.request, '/duty/plans')).items;
  assert.equal(plans.flatMap(row => row.days).find(day => day.dutyDate === '2025-12-31').assignments.length, 1);
  assert.equal(f.read().visitRecords[0].content, '保留民情');
});

test('默认任务可有版本地删除；删除全部不会重新生成，新增不会重名', async () => {
  const f = setup();
  const tasks = (await data(f.request, '/duty/tasks')).items;
  assert.equal(tasks.length, 5);
  for (const task of tasks) {
    const current = (await data(f.request, '/duty/tasks')).items.find(row => row.id === task.id);
    const removed = await f.request(`/duty/tasks/${task.id}`, 'DELETE', { baseVersion: current.version });
    assert.equal(removed.ok, true, JSON.stringify(removed));
  }
  assert.equal((await data(f.request, '/duty/tasks')).items.length, 0);
  assert.equal((await f.request('/duty/tasks', 'POST', { label: '自定义任务' })).ok, true);
  assert.equal((await f.request('/duty/tasks', 'POST', { label: '自定义任务' })).error.code, 'DUPLICATE_RECORD');
});

test('历史身份证党费分别关联党员，免缴全年也能重新登记；过期发展档案不覆盖居民', async () => {
  const f = setup({ partyMembers: [{ id: 'one', name: '一', id_card: 'CARD-1', memberType: '流动党员' }, { id: 'two', name: '二', id_card: 'CARD-2', memberType: '流动党员' }],
    partyDues: [{ id: 'due1', id_card: 'CARD-1', year: 2026, status: '免缴' }, { id: 'due2', id_card: 'CARD-2', year: 2026, paid_months: [1], monthly_amount: 10 }] });
  const dues = (await data(f.request, '/party/dues')).items;
  assert.equal(dues.filter(row => row.partyMemberId === 'one').length, 12);
  assert.equal(dues.filter(row => row.partyMemberId === 'two').length, 1);
  const member = (await data(f.request, '/party/members')).items.find(row => row.id === 'one');
  const result = await f.request('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: dues[0].annualVersion, months: [{ month: 1, amountCents: 500 }] }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = (await data(f.request, '/party/dues')).items;
  assert.equal(after.filter(row => row.partyMemberId === 'one').length, 1);
  assert.equal(after.filter(row => row.partyMemberId === 'two').length, 1);
  const fresh = setup({ partyMembers: [], personnel: [{ id: 'candidate', name: '合成后备', id_card: 'CANDIDATE', tags: [] }] });
  const person = (await data(fresh.request, '/party/context/people')).items[0];
  await fresh.store.update(draft => { draft.personnel[0].tags = ['已故']; return true; });
  const before = fresh.read();
  const failed = await fresh.request('/party/member-save', 'POST', { member: { name: person.name, id_card: person.idCard, residentVersion: person.version }, form: { memberType: '本村党员', stage: '积极分子' } });
  assert.equal(failed.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(fresh.read(), before);
});

test('批量删除只清理流动党员，任一档案版本冲突时整批保留', async () => {
  const f = setup({ partyMembers: [{ id: 'one', name: '一', memberType: '流动党员' }, { id: 'two', name: '二', memberType: '流动党员' }, { id: 'local', name: '历史本村党员', memberType: '本村党员' }] });
  let rows = (await data(f.request, '/party/members')).items;
  const before = f.read();
  const invalid = await f.request('/party/member-remove-batch', 'DELETE', { members: [rows[0], { ...rows[1], version: 0 }] });
  assert.equal(invalid.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(f.read(), before);
  const result = await f.request('/party/member-remove-batch', 'DELETE', { members: rows.filter(row => row.memberType === '流动党员') });
  assert.equal(result.ok, true, JSON.stringify(result));
  rows = (await data(f.request, '/party/members')).items;
  assert.deepEqual(rows.map(row => row.name), ['历史本村党员']);
  assert.equal(f.read().foundationDeletedRecords.length, 2);
});
