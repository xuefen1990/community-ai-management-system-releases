'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { issueLicense } = require('../src/main/license-issuer');
const { verifyOfflineLicense } = require('../../app/src/main/license-codec');

const machineId = 'CAI-12345678-12345678-12345678-12345678';

test('generator issues monthly yearly and permanent codes accepted by the app', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const now = new Date('2026-08-13T00:00:00.000Z');
  for (const plan of ['monthly', 'yearly', 'permanent']) {
    const issued = issueLicense({ machineId, plan, customer: '幸福社区' }, privateKey, now);
    const verified = verifyOfflineLicense(issued.code, { publicKey, machineId, now });
    assert.equal(verified.valid, true);
    assert.equal(verified.license.plan, plan);
  }
});

test('generator rejects malformed device codes', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => issueLicense({ machineId: 'wrong', plan: 'monthly' }, privateKey), /设备码格式无效/u);
});
