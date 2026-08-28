'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalize } = require('../../src/main/remote-database-store');

test('normalizes legacy remote workspaces with contract fee collections', () => {
  const database = normalize({ version: 3, personnel: [{ id: 'p-1' }], landParcel: [{ id: 'land-1' }] });

  assert.equal(database.version, 4);
  assert.deepEqual(database.personnel, [{ id: 'p-1' }]);
  assert.deepEqual(database.landParcel, [{ id: 'land-1' }]);
  assert.deepEqual(database.resourceContracts, []);
  assert.deepEqual(database.contractFeeLedgers, []);
  assert.deepEqual(database.contractFeeBatches, []);
  assert.deepEqual(database.contractFeeReceipts, []);
  assert.deepEqual(database.contractFeeAdvances, []);
});

test('keeps existing contract fee collections from a remote workspace', () => {
  const database = normalize({
    resourceContracts: [{ id: 'c-1' }],
    contractFeeLedgers: [{ id: 'l-1' }],
    contractFeeBatches: [{ id: 'b-1' }],
    contractFeeReceipts: [{ id: 'r-1' }],
    contractFeeAdvances: [{ id: 'a-1' }],
  });

  assert.deepEqual(database.resourceContracts, [{ id: 'c-1' }]);
  assert.deepEqual(database.contractFeeLedgers, [{ id: 'l-1' }]);
  assert.deepEqual(database.contractFeeBatches, [{ id: 'b-1' }]);
  assert.deepEqual(database.contractFeeReceipts, [{ id: 'r-1' }]);
  assert.deepEqual(database.contractFeeAdvances, [{ id: 'a-1' }]);
});
