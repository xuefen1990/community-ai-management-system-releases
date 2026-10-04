'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { collectHardwareHints, createMachineId } = require('../../src/main/machine-id');

test('machine id is stable regardless of network interface order', () => {
  const first = {
    en0: [{ mac: 'AA:BB:CC:DD:EE:FF' }],
    en1: [{ mac: '11:22:33:44:55:66' }],
  };
  const second = {
    en1: [{ mac: '11:22:33:44:55:66' }],
    en0: [{ mac: 'AA:BB:CC:DD:EE:FF' }],
  };

  assert.deepEqual(collectHardwareHints(first), collectHardwareHints(second));
  assert.equal(createMachineId(first), createMachineId(second));
  assert.match(createMachineId(first), /^CAI-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/u);
});
