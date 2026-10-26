'use strict';
const { createHash, hkdfSync, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const PROTOCOL = 'village-mini-channel-v1';
const hash = data => createHash('sha256').update(data).digest('hex');
const pairId = token => hash(`mini-pair-id\0${token}`);
const seedOf = secret => Buffer.from(hash(secret), 'hex');
const aadOf = (envelope, direction) => Buffer.from(JSON.stringify([PROTOCOL, envelope.workspaceId, envelope.mode, envelope.keyId, envelope.requestId, envelope.issuedAt, direction]));
const keyOf = (seed, workspaceId, direction) => Buffer.from(hkdfSync('sha256', seed, Buffer.from(workspaceId), Buffer.from(`${PROTOCOL}/${direction}`), 32));
function seal(value, envelope, seed, direction) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyOf(seed, envelope.workspaceId, direction), nonce);
  cipher.setAAD(aadOf(envelope, direction));
  const bytes = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final(), cipher.getAuthTag()]);
  return { ...envelope, nonce: nonce.toString('base64'), ciphertext: bytes.toString('base64') };
}
function open(envelope, seed, direction) {
  const nonce = Buffer.from(envelope.nonce || '', 'base64'), bytes = Buffer.from(envelope.ciphertext || '', 'base64');
  if (nonce.length !== 12 || bytes.length < 16) throw new Error('连接数据不完整');
  const cipher = createDecipheriv('aes-256-gcm', keyOf(seed, envelope.workspaceId, direction), nonce);
  cipher.setAAD(aadOf(envelope, direction)); cipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8'));
}
module.exports = { PROTOCOL, hash, pairId, seedOf, seal, open };
