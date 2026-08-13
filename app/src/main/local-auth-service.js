'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function normalizePhone(value) {
  return String(value || '').replaceAll(/\s|-/gu, '');
}

function validateCredentials(phone, password) {
  const normalizedPhone = normalizePhone(phone);
  if (!/^\+?\d{6,20}$/u.test(normalizedPhone)) throw new Error('请输入有效的管理员手机号');
  if (typeof password !== 'string' || password.length < 6) throw new Error('密码至少需要 6 位');
  return normalizedPhone;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const derivedKey = await scrypt(password, salt, 64);
  return { algorithm: 'scrypt', salt, hash: derivedKey.toString('base64url') };
}

async function passwordMatches(password, passwordRecord) {
  if (!passwordRecord || passwordRecord.algorithm !== 'scrypt') return false;
  const candidate = await hashPassword(password, passwordRecord.salt);
  const actual = Buffer.from(passwordRecord.hash, 'base64url');
  const expected = Buffer.from(candidate.hash, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

class LocalAuthService {
  constructor({ store, machineId, now = () => new Date(), verifyActivation = null }) {
    this.store = store;
    this.machineId = machineId;
    this.now = now;
    this.verifyActivation = verifyActivation;
    this.sessionAccountId = null;
  }

  async register({ phone, password }) {
    const normalizedPhone = validateCredentials(phone, password);
    const state = await this.store.read();
    if (state.accounts.some((account) => account.phone === normalizedPhone)) {
      throw new Error('该手机号已在本机注册');
    }

    const createdAt = this.now().toISOString();
    const account = {
      id: crypto.randomUUID(),
      phone: normalizedPhone,
      password: await hashPassword(password),
      createdAt,
      trialStartedAt: createdAt,
    };
    state.accounts.push(account);
    state.lastSeenAt = createdAt;
    await this.store.write(state);
    this.sessionAccountId = account.id;
    return this.getStatus();
  }

  async login({ phone, password }) {
    const normalizedPhone = normalizePhone(phone);
    const state = await this.store.read();
    const account = state.accounts.find((candidate) => candidate.phone === normalizedPhone);
    if (!account || !(await passwordMatches(password, account.password))) {
      throw new Error('手机号或密码不正确');
    }
    this.sessionAccountId = account.id;
    await this.recordClock(state);
    return this.getStatus();
  }

  logout() {
    this.sessionAccountId = null;
    return { ok: true };
  }

  async recordClock(state) {
    const currentTime = this.now();
    if (state.lastSeenAt) {
      const lastSeen = new Date(state.lastSeenAt);
      if (currentTime.getTime() + CLOCK_SKEW_TOLERANCE_MS < lastSeen.getTime()) {
        throw new Error('检测到系统时间回退，请校准日期和时间后重试');
      }
    }
    state.lastSeenAt = currentTime.toISOString();
    await this.store.write(state);
  }

  async getStatus() {
    const state = await this.store.read();
    const account = state.accounts.find((candidate) => candidate.id === this.sessionAccountId) || null;
    const entitlement = await this.getEntitlement(state, account);
    return {
      ok: true,
      authenticated: Boolean(account),
      account: account ? { id: account.id, phone: account.phone, createdAt: account.createdAt } : null,
      machineId: this.machineId,
      entitlement,
    };
  }

  async getEntitlement(state, account) {
    if (state.activation && this.verifyActivation) {
      const verified = await this.verifyActivation(state.activation.code, this.machineId, this.now());
      if (verified.valid) return { type: 'licensed', ...verified.license };
    }
    if (!account) return { type: 'none' };

    const now = this.now();
    const trialStartedAt = new Date(account.trialStartedAt);
    const expiresAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_MS);
    const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
    return {
      type: remainingMs > 0 ? 'trial' : 'expired',
      startedAt: trialStartedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      remainingMs,
      remainingDays: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
    };
  }

  async activate(code) {
    if (!this.verifyActivation) throw new Error('离线授权验证器尚未配置');
    const verified = await this.verifyActivation(code, this.machineId, this.now());
    if (!verified.valid) throw new Error(verified.error || '授权码无效');
    const state = await this.store.read();
    state.activation = { code, activatedAt: this.now().toISOString() };
    await this.store.write(state);
    return this.getStatus();
  }
}

module.exports = {
  CLOCK_SKEW_TOLERANCE_MS,
  LocalAuthService,
  TRIAL_DURATION_MS,
  hashPassword,
  normalizePhone,
  passwordMatches,
  validateCredentials,
};
