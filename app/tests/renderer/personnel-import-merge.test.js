'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const merge = require('../../src/renderer/js/personnel-import-merge');

test('automatically identifies a special identity from the file or worksheet name', () => {
  assert.equal(merge.detectSpecialIdentity({ fileName: '2026年党员信息表.xlsx', sheetName: '名单', columns: ['姓名', '身份证号'] }), '党员');
  assert.equal(merge.detectSpecialIdentity({ fileName: '人员名单.xlsx', sheetName: '退役军人信息', columns: ['姓名', '身份证号'] }), '退役军人');
  assert.equal(merge.detectSpecialIdentity({ fileName: '军人信息.xlsx', sheetName: '名单', columns: ['姓名', '身份证号'] }), '军人');
  assert.equal(merge.detectSpecialIdentity({ fileName: '专项人员.xlsx', sheetName: '名单', columns: ['姓名', '身份证号', '党员', '退役军人'] }), '');
});

test('validates and normalizes identity cards before using them as merge evidence', () => {
  assert.equal(merge.normalizeIdCard(' 11010519491231002x '), '11010519491231002X');
  assert.equal(merge.isValidIdCard('11010519491231002X'), true);
  assert.equal(merge.isValidIdCard('110105194912310021'), false);
  assert.equal(merge.isValidIdCard('张三'), false);
});

test('finds only a unique resident by identity card', () => {
  const personnel = [
    { id: 'zhangsan', name: '张三', idCard: '11010519491231002X' },
    { id: 'lisi-a', name: '李四', id_card: '11010519491231003X' },
    { id: 'lisi-b', name: '李四', idCard: '11010519491231003x' },
  ];
  assert.deepEqual(merge.findUniquePersonById(personnel, '11010519491231002x'), { status: 'matched', person: personnel[0] });
  assert.deepEqual(merge.findUniquePersonById(personnel, '11010519491231004X'), { status: 'missing', person: null });
  assert.deepEqual(merge.findUniquePersonById(personnel, '11010519491231003X'), { status: 'duplicate', person: null });
});

test('merges only non-empty fields and unions special identity labels', () => {
  const person = { id: 'zhangsan', name: '张三', idCard: '11010519491231002X', phone: '13800000000', tags: ['低保户'] };
  const result = merge.mergeResidentInformation(person, { name: '张三', idCard: '11010519491231002x', phone: '', address: '幸福路 1 号' }, '党员', '2026-08-24T00:00:00.000Z');

  assert.equal(result.identityAdded, true);
  assert.equal(person.phone, '13800000000');
  assert.equal(person.address, '幸福路 1 号');
  assert.equal(person.idCard, '11010519491231002X');
  assert.equal(person.id_card, '11010519491231002X');
  assert.deepEqual(person.specialIdentities, ['党员']);
  assert.deepEqual(person.tags, ['低保户', '党员']);
  assert.equal(person.is_party_member, true);
  assert.equal(person.updated_at, '2026-08-24T00:00:00.000Z');

  assert.equal(merge.mergeResidentInformation(person, {}, '党员', '2026-08-24T01:00:00.000Z').identityAdded, false);
  assert.deepEqual(person.specialIdentities, ['党员']);
});
