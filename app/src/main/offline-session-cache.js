'use strict';

const { randomBytes, scryptSync, createCipheriv, createDecipheriv } = require('node:crypto');

function seal(value, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(sealed, password) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, Buffer.from(sealed.salt, 'base64'), 32), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('本机离线密码不正确，请重试或联网登录'); }
}

function currentEntitlement(value) {
  if (!value || !['trial', 'licensed'].includes(value.type)) return { type: 'none' };
  if (!value.expiresAt) return { ...value };
  const remainingMs = Math.max(0, new Date(value.expiresAt).getTime() - Date.now());
  return { ...value, type: remainingMs ? value.type : 'expired', remainingMs, remainingDays: Math.ceil(remainingMs / 86400000) };
}

module.exports = { seal, open, currentEntitlement };
