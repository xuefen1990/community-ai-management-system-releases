'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { moduleFor } = require('../src/services/unitWorkspaceService');

test('contract fee collections use existing finance permissions', () => {
  for (const key of ['resourceContracts', 'contractFeeLedgers', 'contractFeeBatches', 'contractFeeReceipts', 'contractFeeAdvances']) {
    assert.equal(moduleFor(key), 'finance');
  }
});
