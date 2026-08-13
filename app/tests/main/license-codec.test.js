'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { PRODUCT_ID, createOfflineLicense, verifyOfflineLicense } = require('../../src/main/license-codec');

function fixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const now = new Date('2026-08-13T00:00:00.000Z');
  const payload = {
    product: PRODUCT_ID,
    licenseId: 'license-001',
    machineId: 'machine-001',
    plan: 'yearly',
    issuedAt: now.toISOString(),
    expiresAt: '2027-08-13T00:00:00.000Z',
    customer: '测试社区',
  };
  return { privateKey, publicKey, now, payload };
}

test('valid signed license is accepted for its bound machine', () => {
  const { privateKey, publicKey, now, payload } = fixture();
  const code = createOfflineLicense(payload, privateKey);
  const result = verifyOfflineLicense(code, { publicKey, machineId: 'machine-001', now });

  assert.equal(result.valid, true);
  assert.equal(result.license.plan, 'yearly');
  assert.equal(result.license.customer, '测试社区');
});

test('license is rejected on a different machine', () => {
  const { privateKey, publicKey, now, payload } = fixture();
  const code = createOfflineLicense(payload, privateKey);
  const result = verifyOfflineLicense(code, { publicKey, machineId: 'machine-999', now });

  assert.equal(result.valid, false);
  assert.match(result.error, /设备码不匹配/u);
});

test('tampering with signed payload invalidates the license', () => {
  const { privateKey, publicKey, now, payload } = fixture();
  const code = createOfflineLicense(payload, privateKey);
  const [prefix, encodedPayload, signature] = code.split('.');
  const tampered = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  tampered.plan = 'permanent';
  const tamperedCode = `${prefix}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`;

  assert.equal(verifyOfflineLicense(tamperedCode, {
    publicKey,
    machineId: 'machine-001',
    now,
  }).valid, false);
});

test('expired dated license is rejected while permanent license has no expiry', () => {
  const { privateKey, publicKey, now, payload } = fixture();
  const expired = createOfflineLicense({ ...payload, expiresAt: '2026-08-12T00:00:00.000Z' }, privateKey);
  assert.match(verifyOfflineLicense(expired, {
    publicKey,
    machineId: 'machine-001',
    now,
  }).error, /已过期/u);

  const permanent = createOfflineLicense({ ...payload, plan: 'permanent', expiresAt: null }, privateKey);
  assert.equal(verifyOfflineLicense(permanent, {
    publicKey,
    machineId: 'machine-001',
    now,
  }).valid, true);
});
