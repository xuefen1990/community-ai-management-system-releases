'use strict';

const crypto = require('node:crypto');

const PRODUCT_ID = 'community-ai-management-system';
const PLAN_DURATION_MS = Object.freeze({
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
});

function issueLicense({ machineId, plan, customer = '', notes = '' }, privateKey, now = new Date()) {
  if (!/^CAI-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/u.test(String(machineId || '').trim())) {
    throw new Error('设备码格式无效');
  }
  if (!['monthly', 'yearly', 'permanent'].includes(plan)) throw new Error('授权类型无效');
  const issuedAt = new Date(now);
  const expiresAt = plan === 'permanent'
    ? null
    : new Date(issuedAt.getTime() + PLAN_DURATION_MS[plan]).toISOString();
  const payload = {
    product: PRODUCT_ID,
    licenseId: crypto.randomUUID(),
    machineId: machineId.trim(),
    plan,
    issuedAt: issuedAt.toISOString(),
    expiresAt,
    customer: String(customer).trim() || null,
    notes: String(notes).trim() || null,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encodedPayload, 'utf8'), privateKey).toString('base64url');
  return { code: `CAI1.${encodedPayload}.${signature}`, payload };
}

module.exports = { PLAN_DURATION_MS, PRODUCT_ID, issueLicense };
