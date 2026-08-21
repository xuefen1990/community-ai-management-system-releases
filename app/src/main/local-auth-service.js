'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const AUTH_STATE_VERSION = 2;

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

  async register({ phone, password, remember = true }) {
    const normalizedPhone = validateCredentials(phone, password);
    const state = await this.store.read();
    if (state.accounts.some((account) => account.phone === normalizedPhone)) {
      throw new Error('该手机号已在本机注册');
    }

    if (Number(state.version || 1) < AUTH_STATE_VERSION && state.accounts.length) {
      this.migrateLegacyAccount(state, state.accounts[0]);
    }
    const createdAt = this.now().toISOString();
    state.version = AUTH_STATE_VERSION;
    const account = {
      id: crypto.randomUUID(),
      phone: normalizedPhone,
      password: await hashPassword(password),
      createdAt,
      trialStartedAt: createdAt,
      entitlement: { plan: 'trial', startedAt: createdAt },
    };
    state.accounts.push(account);
    state.lastSeenAt = createdAt;
    state.rememberedAccountId = remember ? account.id : null;
    await this.store.write(state);
    this.sessionAccountId = account.id;
    return this.getStatus();
  }

  async login({ phone, password, remember = true }) {
    const normalizedPhone = normalizePhone(phone);
    const state = await this.store.read();
    const account = state.accounts.find((candidate) => candidate.phone === normalizedPhone);
    if (!account || !(await passwordMatches(password, account.password))) {
      throw new Error('手机号或密码不正确');
    }
    this.migrateLegacyAccount(state, account);
    this.sessionAccountId = account.id;
    state.rememberedAccountId = remember ? account.id : null;
    await this.recordClock(state);
    return this.getStatus();
  }

  async logout() {
    this.sessionAccountId = null;
    const state = await this.store.read();
    if (state.rememberedAccountId) {
      state.rememberedAccountId = null;
      await this.store.write(state);
    }
    return { ok: true };
  }

  migrateLegacyAccount(state, account) {
    if (Number(state.version || 1) >= AUTH_STATE_VERSION) return false;
    const owner = state.accounts.find((candidate) => candidate.role === 'owner');
    if (owner) return false;
    account.role = 'owner';
    account.entitlement = { plan: 'permanent', startedAt: this.now().toISOString() };
    state.version = AUTH_STATE_VERSION;
    return true;
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
    if (!this.sessionAccountId && Number(state.version || 1) < AUTH_STATE_VERSION && state.accounts.length === 1) {
      const legacyAccount = state.accounts[0];
      if (this.migrateLegacyAccount(state, legacyAccount)) {
        this.sessionAccountId = legacyAccount.id;
        state.rememberedAccountId = legacyAccount.id;
        await this.store.write(state);
      }
    }
    if (!this.sessionAccountId && state.rememberedAccountId) {
      this.sessionAccountId = state.rememberedAccountId;
    }
    const account = state.accounts.find((candidate) => candidate.id === this.sessionAccountId) || null;
    if (!account && state.rememberedAccountId) {
      state.rememberedAccountId = null;
      await this.store.write(state);
    }
    const entitlement = await this.getEntitlement(state, account);
    return {
      ok: true,
      authenticated: Boolean(account),
      account: account ? {
        id: account.id,
        phone: account.phone,
        createdAt: account.createdAt,
        isOwner: account.role === 'owner',
      } : null,
      machineId: this.machineId,
      entitlement,
    };
  }

  async getEntitlement(state, account) {
    if (!account) return { type: 'none' };
    const accountEntitlement = this.getAccountEntitlement(account);
    if (accountEntitlement && accountEntitlement.plan !== 'trial') return accountEntitlement;
    if (state.activation && this.verifyActivation) {
      const verified = await this.verifyActivation(state.activation.code, this.machineId, this.now());
      if (verified.valid) return { type: 'licensed', ...verified.license };
    }
    if (accountEntitlement) return accountEntitlement;

    return this.makeTrialEntitlement(account.trialStartedAt);
  }

  makeTrialEntitlement(startedAt) {
    const now = this.now();
    const trialStartedAt = new Date(startedAt);
    const expiresAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_MS);
    const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
    return {
      type: remainingMs > 0 ? 'trial' : 'expired',
      plan: 'trial',
      startedAt: trialStartedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      remainingMs,
      remainingDays: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
    };
  }

  getAccountEntitlement(account) {
    const entitlement = account.entitlement;
    if (!entitlement || typeof entitlement !== 'object') return null;
    if (entitlement.plan === 'permanent') {
      return { type: 'licensed', plan: 'permanent', startedAt: entitlement.startedAt, expiresAt: null };
    }
    if (entitlement.plan === 'expires') {
      const expiresAt = new Date(entitlement.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) return null;
      const remainingMs = Math.max(0, expiresAt.getTime() - this.now().getTime());
      return remainingMs > 0
        ? { type: 'licensed', plan: 'expires', startedAt: entitlement.startedAt, expiresAt: expiresAt.toISOString(), remainingMs }
        : { type: 'expired', plan: 'expires', startedAt: entitlement.startedAt, expiresAt: expiresAt.toISOString(), remainingMs: 0 };
    }
    if (entitlement.plan === 'trial') return this.makeTrialEntitlement(entitlement.startedAt || account.trialStartedAt);
    return null;
  }

  async listAccountEntitlements() {
    const state = await this.store.read();
    const current = state.accounts.find((candidate) => candidate.id === this.sessionAccountId);
    if (current?.role !== 'owner') throw new Error('只有本机主账号可以管理账号授权');
    return state.accounts.map((account) => ({
      id: account.id,
      phone: account.phone,
      createdAt: account.createdAt,
      isOwner: account.role === 'owner',
      entitlement: this.getAccountEntitlement(account) || this.makeTrialEntitlement(account.trialStartedAt),
    }));
  }

  async setAccountEntitlement({ accountId, plan, expiresAt = null }) {
    const state = await this.store.read();
    const current = state.accounts.find((candidate) => candidate.id === this.sessionAccountId);
    if (current?.role !== 'owner') throw new Error('只有本机主账号可以管理账号授权');
    const account = state.accounts.find((candidate) => candidate.id === accountId);
    if (!account) throw new Error('未找到要授权的账号');
    const startedAt = this.now().toISOString();
    if (plan === 'permanent') {
      account.entitlement = { plan, startedAt };
    } else if (plan === 'expires') {
      const parsedExpiresAt = new Date(expiresAt);
      if (Number.isNaN(parsedExpiresAt.getTime()) || parsedExpiresAt.getTime() <= this.now().getTime()) {
        throw new Error('请输入未来的到期日期');
      }
      account.entitlement = { plan, startedAt, expiresAt: parsedExpiresAt.toISOString() };
    } else if (plan === 'trial') {
      account.trialStartedAt = startedAt;
      account.entitlement = { plan, startedAt };
    } else {
      throw new Error('授权类型无效');
    }
    await this.store.write(state);
    return this.listAccountEntitlements();
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
  AUTH_STATE_VERSION,
  LocalAuthService,
  TRIAL_DURATION_MS,
  hashPassword,
  normalizePhone,
  passwordMatches,
  validateCredentials,
};
