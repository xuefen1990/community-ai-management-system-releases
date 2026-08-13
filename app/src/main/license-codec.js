'use strict';

const crypto = require('node:crypto');

const PRODUCT_ID = 'community-ai-management-system';
const VALID_PLANS = new Set(['monthly', 'yearly', 'permanent']);

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function createOfflineLicense(payload, privateKey) {
  if (!privateKey) throw new TypeError('privateKey is required');
  const encodedPayload = encodePayload(payload);
  const signature = crypto.sign(null, Buffer.from(encodedPayload, 'utf8'), privateKey);
  return `CAI1.${encodedPayload}.${signature.toString('base64url')}`;
}

function verifyOfflineLicense(code, { publicKey, machineId, now = new Date() }) {
  try {
    if (typeof code !== 'string') throw new Error('授权码格式无效');
    const [prefix, encodedPayload, encodedSignature, extra] = code.trim().split('.');
    if (prefix !== 'CAI1' || !encodedPayload || !encodedSignature || extra) {
      throw new Error('授权码格式无效');
    }

    const signature = Buffer.from(encodedSignature, 'base64url');
    const signatureValid = crypto.verify(
      null,
      Buffer.from(encodedPayload, 'utf8'),
      publicKey,
      signature,
    );
    if (!signatureValid) throw new Error('授权码签名无效');

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.product !== PRODUCT_ID) throw new Error('授权码不属于本产品');
    if (payload.machineId !== machineId) throw new Error('授权码与本机设备码不匹配');
    if (!VALID_PLANS.has(payload.plan)) throw new Error('授权类型无效');
    if (!payload.licenseId || !payload.issuedAt) throw new Error('授权信息不完整');

    const issuedAt = new Date(payload.issuedAt);
    if (Number.isNaN(issuedAt.getTime())) throw new Error('授权签发时间无效');
    if (issuedAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      throw new Error('授权签发时间晚于本机时间');
    }

    let expiresAt = null;
    if (payload.plan !== 'permanent') {
      expiresAt = new Date(payload.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) throw new Error('授权到期时间无效');
      if (expiresAt.getTime() <= now.getTime()) throw new Error('授权码已过期');
    }

    return {
      valid: true,
      license: {
        licenseId: payload.licenseId,
        plan: payload.plan,
        machineId: payload.machineId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt?.toISOString() || null,
        customer: payload.customer || null,
      },
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

module.exports = { PRODUCT_ID, VALID_PLANS, createOfflineLicense, encodePayload, verifyOfflineLicense };
