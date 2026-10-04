'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const profiles = require('../../src/shared/special-personnel-profiles');

test('maps the party member spreadsheet fields and writes a compatible party ledger record', () => {
  const columns = ['姓名', '组别', '公民身份证号码', '民族', '学历', '加入党组织日期', '转为正式党员日期', '联系电话\n手机号', '家庭住址'];
  const selection = Object.fromEntries(profiles.getFieldDefinitions('党员').map((field) => [field.key, profiles.inferredColumn(columns, field.aliases)]));
  assert.equal(selection.idCard, '公民身份证号码');
  assert.equal(selection.party_join_date, '加入党组织日期');
  assert.equal(selection.party_full_member_date, '转为正式党员日期');
  assert.equal(selection.phone, '联系电话\n手机号');
  assert.equal(selection.address, '家庭住址');

  const row = { 姓名: '张三', 组别: '东一', 公民身份证号码: '11010519491231002X', 民族: '汉族', 学历: '大专', 加入党组织日期: '2007/07/01', 转为正式党员日期: '2008/07/01', '联系电话\n手机号': '13800000000', 家庭住址: '幸福路 1 号' };
  const profile = profiles.buildSpecialProfile({ identity: '党员', idCard: row.公民身份证号码, personId: 'person-1', row, selection, columns, now: '2026-08-25T00:00:00.000Z' });
  assert.deepEqual(profile.fields, { party_join_date: '2007/07/01', party_full_member_date: '2008/07/01' });

  const partyMembers = [];
  const result = profiles.upsertPartyMember(partyMembers, { id: 'person-1', name: '张三', idCard: row.公民身份证号码, phone: row['联系电话\n手机号'], village_group: row.组别 }, profile.fields, '2026-08-25T00:00:00.000Z');
  assert.equal(result.status, 'added');
  assert.equal(partyMembers[0].stage, '正式党员');
  assert.equal(partyMembers[0].join_date, '2007/07/01');
  assert.equal(partyMembers[0].formal_member_date, '2008/07/01');
});

test('merges one special profile per identity and identity card while retaining unmatched columns', () => {
  const selection = { name: '姓名', idCard: '身份证号', enlistment_date: '入伍日期' };
  const row = { 姓名: '李四', 身份证号: '11010519491231002X', 入伍日期: '2001/01/01', 原始登记编号: 'TY-001' };
  const list = [];
  const incoming = profiles.buildSpecialProfile({ identity: '退役军人', idCard: row.身份证号, personId: 'person-2', row, selection, columns: Object.keys(row), now: '2026-08-25T00:00:00.000Z' });
  assert.equal(incoming.fields.enlistment_date, '2001/01/01');
  assert.equal(incoming.extraFields.原始登记编号, 'TY-001');
  assert.equal(profiles.upsertSpecialProfile(list, incoming, incoming.updated_at).status, 'added');
  assert.equal(profiles.upsertSpecialProfile(list, { ...incoming, fields: { discharge_date: '2003/01/01' }, extraFields: {} }, '2026-08-26T00:00:00.000Z').status, 'updated');
  assert.equal(list.length, 1);
  assert.equal(list[0].fields.discharge_date, '2003/01/01');
});
