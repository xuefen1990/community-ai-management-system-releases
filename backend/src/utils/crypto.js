'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

// ===== 密码哈希 =====

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  if (hash && typeof hash === 'object' && hash.algorithm === 'scrypt' && hash.salt && hash.hash) {
    try {
      const actual = Buffer.from(hash.hash, 'base64url');
      const expected = crypto.scryptSync(password, hash.salt, actual.length);
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  if (typeof hash !== 'string') return false;
  return bcrypt.compareSync(password, hash);
}

function needsPasswordUpgrade(hash) {
  return Boolean(hash && typeof hash === 'object' && hash.algorithm === 'scrypt');
}

// ===== JWT =====

function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

// ===== AES-256-GCM 对称加密（用于 API Key 等敏感数据）=====

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext, secret) {
  const key = getKey(secret || config.jwt.secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext, secret) {
  const key = getKey(secret || config.jwt.secret);
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const data = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ===== 通用工具 =====

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = require('fs').readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

function sha512FileBase64(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(require('fs').readFileSync(filePath));
  return hash.digest('base64');
}

function randomCode(prefix = '') {
  return prefix + crypto.randomBytes(16).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsPasswordUpgrade,
  signToken,
  verifyToken,
  encrypt,
  decrypt,
  sha256File,
  sha512FileBase64,
  randomCode,
};
