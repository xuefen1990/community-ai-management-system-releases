'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { buildPersonnelView } = require('../../src/main/foundation-data-model');

function setup(extraPeople = []) {
  let stored = {
    settings: { villageName: '测试社区' },
    personnel: [
      {
        id: 'head-one', name: '张三', id_card: 'HEAD-ONE', household_id: '0012', village_group: '东一组',
        relation_to_head: '户主', address: '向阳路12号', registry_type: '本村常住户籍', registry_status: '正常',
      },
      ...extraPeople,
    ],
  };
  const store = {
    async read() { return structuredClone(stored); },
    async update(mutator) {
      const draft = structuredClone(stored);
      const result = await mutator(draft);
      stored = draft;
      return { result, data: structuredClone(stored) };
    },
  };
  const api = new FoundationBusinessService({
    store, authorize: async () => ({ personWriteActions: ['create', 'update'] }),
    now: () => new Date('2026-09-14T08:00:00.000Z'), uuid: (() => { let index = 0; return () => `generated-${++index}`; })(),
  });
  return { api, data: () => structuredClone(stored) };
}

const request = (api, method, path, body) => api.request({ method, path: `/api/v3${path}`, body });

test('creates a household member once and inherits the authoritative household information', async () => {
  const { api, data } = setup();
  const householdId = buildPersonnelView(data()).households[0].id;
  const context = (await request(api, 'GET', `/households/${encodeURIComponent(householdId)}/member-registration`)).data;
  assert.equal(context.householdNo, '0012');
  assert.equal(context.head.name, '张三');
  assert.equal(context.villageGroupName, '东一组');
  assert.equal(context.address, '向阳路12号');

  const saved = await request(api, 'POST', `/households/${encodeURIComponent(householdId)}/members`, {
    mode: 'create', contextVersion: context.version,
    fields: { idCard: '11010519491231002X', name: '张小花', relationToHead: '孙女', phone: '13800000000' },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.person.name, '张小花');
  assert.equal(saved.data.person.birthDate, '1949-12-31');
  assert.equal(saved.data.person.gender, '女');
  assert.equal(saved.data.household.memberCount, 2);

  const person = data().personnel.find(item => item.name === '张小花');
  assert.equal(person.household_id, '0012');
  assert.equal(person.village_group, '东一组');
  assert.equal(person.address, '向阳路12号');
  assert.equal(person.relation_to_head, '孙女');
  assert.equal(person.include_in_pop, true);
  assert.equal(person.residentOperationLog[0].action, '新增家庭成员');
  assert.equal(data().operationLogs.at(-1).action, '新增家庭成员');
});

test('rejects invalid, duplicate, second-head and stale household registrations without partial data', async () => {
  const { api, data } = setup([{ id: 'existing', name: '李四', id_card: '11010519491231002X', household_id: '0099', village_group: '西二组' }]);
  const householdId = buildPersonnelView(data()).households.find(item => item.householdNo === '0012').id;
  const context = (await request(api, 'GET', `/households/${encodeURIComponent(householdId)}/member-registration`)).data;
  const initial = data();
  for (const fields of [
    { idCard: '110105194912310021', name: '无效号码', relationToHead: '子' },
    { idCard: '11010519491231002X', name: '重复身份证', relationToHead: '女' },
    { idCard: '11010519491231002X', name: '第二户主', relationToHead: '户主' },
  ]) {
    const result = await request(api, 'POST', `/households/${encodeURIComponent(householdId)}/members`, { mode: 'create', contextVersion: context.version, fields });
    assert.equal(result.ok, false);
  }
  assert.deepEqual(data(), initial);

  const changed = await request(api, 'POST', '/people/batch-upsert', {
    items: [{ id: 'head-one', baseVersion: buildPersonnelView(data()).people.find(item => item.id === 'head-one').version,
      fields: { name: '张三已修改', idCard: 'HEAD-ONE' } }],
  });
  assert.equal(changed.ok, true);
  const stale = await request(api, 'POST', `/households/${encodeURIComponent(householdId)}/members`, {
    mode: 'create', contextVersion: context.version,
    fields: { idCard: '11010519491231002X', name: '过期表单', relationToHead: '女' },
  });
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
});

test('moves one exact existing resident only after confirmation and retains unrelated resident data', async () => {
  const other = {
    id: 'existing', name: '李四', id_card: '11010519491231002X', household_id: '0099', village_group: '西二组',
    relation_to_head: '子', bankAccounts: [{ id: 'card-one', cardNumber: '62220001' }], disbursementHistory: [{ id: 'paid-one' }],
  };
  const { api, data } = setup([other]);
  const view = buildPersonnelView(data());
  const householdId = view.households.find(item => item.householdNo === '0012').id;
  let context = (await request(api, 'GET', `/households/${encodeURIComponent(householdId)}/member-registration`)).data;
  const person = view.people.find(item => item.id === 'existing');

  const denied = await request(api, 'POST', `/households/${encodeURIComponent(householdId)}/members`, {
    mode: 'move-existing', contextVersion: context.version, existingPersonId: person.id,
    existingPersonVersion: person.version, relationToHead: '孙女', confirmedMove: false,
  });
  assert.equal(denied.error.code, 'MOVE_CONFIRMATION_REQUIRED');
  assert.deepEqual(data().personnel.find(item => item.id === 'existing'), other);

  context = (await request(api, 'GET', `/households/${encodeURIComponent(householdId)}/member-registration`)).data;
  const moved = await request(api, 'POST', `/households/${encodeURIComponent(householdId)}/members`, {
    mode: 'move-existing', contextVersion: context.version, existingPersonId: person.id,
    existingPersonVersion: person.version, relationToHead: '孙女', confirmedMove: true,
  });
  assert.equal(moved.ok, true);
  const after = data().personnel.find(item => item.id === 'existing');
  assert.equal(after.household_id, '0012');
  assert.equal(after.village_group, '东一组');
  assert.equal(after.address, '向阳路12号');
  assert.equal(after.relation_to_head, '孙女');
  assert.deepEqual(after.bankAccounts, other.bankAccounts);
  assert.deepEqual(after.disbursementHistory, other.disbursementHistory);
  assert.equal(after.residentOperationLog[0].action, '调整家庭成员');
});
