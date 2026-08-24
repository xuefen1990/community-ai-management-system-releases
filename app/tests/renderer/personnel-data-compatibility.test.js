'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'renderer', 'js', 'personnel-data-compatibility.js'), 'utf8');

test('normalizes identity-card aliases for legacy display without losing imported data', () => {
  const context = {
    dbState: { personnel: [
      { id: 'head', idCard: '11010519491231002x', household_id: '00123', relation_to_head: '户主' },
      { id: 'member', id_card: '11010519491231003X', household_id: '00123', relation_to_head: '子' },
      { id: 'other', idCard: '11010519491231004X', household_id: '123', relation_to_head: '户主' },
    ] },
    setTimeout: () => {},
    window: {},
  };
  context.window = context;
  vm.runInNewContext(source, context);
  assert.equal(context.dbState.personnel[0].id_card, '11010519491231002X');
  assert.equal(context.dbState.personnel[1].idCard, '11010519491231003X');
});

test('household entry resolves a person through the exact household and opens its head', () => {
  const opened = [];
  const context = {
    dbState: { personnel: [
      { id: 'head', idCard: '11010519491231002X', household_id: '00123', relation_to_head: '户主' },
      { id: 'member', idCard: '11010519491231003X', household_id: '00123', relation_to_head: '子' },
      { id: 'other', idCard: '11010519491231004X', household_id: '123', relation_to_head: '户主' },
    ] },
    setTimeout: () => {},
    openHouseholdMembers: (...args) => opened.push(args),
    __getExactHouseholdMembers: (householdId) => context.dbState.personnel.filter((person) => person.household_id === householdId),
    window: {},
  };
  context.window = context;
  vm.runInNewContext(source, context);
  context.openHouseholdMembers('11010519491231003X');
  context.openHouseholdMembers('123');
  assert.deepEqual(opened, [
    ['11010519491231002X'],
    ['11010519491231004X'],
  ]);
});
