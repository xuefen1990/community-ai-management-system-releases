'use strict';

const { normalizePhone, validateCredentials } = require('./local-auth-service');

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('后端地址必须以 http:// 或 https:// 开头');
  return url.toString().replace(/\/$/u, '');
}

function toEntitlement(payload = {}) {
  if (!payload.valid) return { type: 'expired', plan: payload.plan || 'trial', expiresAt: payload.expiresAt || null, remainingMs: 0, remainingDays: 0 };
  if (payload.plan === 'permanent') return { type: 'licensed', plan: 'permanent', expiresAt: null };
  const expiresAt = payload.expiresAt || null;
  const remainingMs = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0;
  return { type: payload.plan === 'trial' ? 'trial' : 'licensed', plan: payload.plan || 'trial', expiresAt, remainingMs, remainingDays: Math.ceil(remainingMs / 86400000) };
}

class RemoteAuthService {
  constructor({ store, machineId, baseUrl, rememberedLoginStore = null, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');
    this.store = store;
    this.machineId = machineId;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.rememberedLoginStore = rememberedLoginStore;
    this.fetchImpl = fetchImpl;
    this.session = null;
  }

  async request(path, { method = 'GET', body, token = this.session?.token } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error('无法连接账号服务，请检查网络或后端地址');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '账号服务请求失败');
    return payload;
  }

  async register({ phone, password, remember = true }) {
    const normalizedPhone = validateCredentials(phone, password);
    const result = await this.request('/auth/register', { method: 'POST', body: { phone: normalizedPhone, password, machineId: this.machineId }, token: null });
    await this.beginSession(result, { password, remember });
    return this.getStatus();
  }

  async login({ phone, password, remember = true }) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || typeof password !== 'string') throw new Error('请输入手机号和密码');
    const result = await this.request('/auth/login', { method: 'POST', body: { phone: normalizedPhone, password, machineId: this.machineId }, token: null });
    await this.beginSession(result, { password, remember });
    return this.getStatus();
  }

  async beginSession(result, { password, remember }) {
    this.session = { token: result.token, user: result.user };
    const state = await this.store.read();
    state.remoteAccount = result.user;
    state.lastLoginPhone = result.user.phone;
    state.rememberedAccountId = remember ? result.user.id : null;
    await this.store.write(state);
    await this.updateRememberedLogin({ phone: result.user.phone, password, remember });
  }

  async updateRememberedLogin({ phone, password, remember }) {
    try {
      if (remember) return await this.rememberedLoginStore?.save({ phone, password });
      return await this.rememberedLoginStore?.clear();
    } catch {
      return { saved: false, warning: '无法保存登录密码，请下次手动输入' };
    }
  }

  async entitlement() {
    if (!this.session) return { type: 'none' };
    return toEntitlement(await this.request('/auth/entitlement'));
  }

  async getStatus() {
    return {
      ok: true,
      authenticated: Boolean(this.session),
      account: this.session ? {
        id: this.session.user.id,
        phone: this.session.user.phone,
        createdAt: this.session.user.createdAt,
        isOwner: false,
      } : null,
      machineId: this.machineId,
      entitlement: await this.entitlement(),
    };
  }

  async getStartupEntitlement() {
    const state = await this.store.read();
    const account = state.remoteAccount || null;
    return { hasPreviousAccount: Boolean(account), account: account ? { phone: account.phone } : null, entitlement: { type: 'none' } };
  }

  async logout() {
    this.session = null;
    return { ok: true };
  }

  async getLoginPrefill() {
    const state = await this.store.read();
    const saved = await this.rememberedLoginStore?.load() || { phone: '', password: '', warning: '' };
    const phone = state.lastLoginPhone || saved.phone || '';
    return { phone, password: saved.phone === phone ? saved.password : '', remembered: Boolean(saved.phone === phone && saved.password), warning: saved.warning || '' };
  }

  async clearLoginPrefill() {
    const state = await this.store.read();
    state.rememberedAccountId = null;
    state.lastLoginPhone = '';
    await this.store.write(state);
    await this.rememberedLoginStore?.clear();
    return { ok: true };
  }

  async activate(code) {
    const result = await this.request('/auth/activate-license', { method: 'POST', body: { code, machineId: this.machineId } });
    return { ok: true, authenticated: true, account: this.session?.user || null, machineId: this.machineId, entitlement: toEntitlement({ valid: true, plan: result.planType, expiresAt: result.expiresAt }) };
  }

  async listAccountEntitlements() { throw new Error('账号授权请在管理员后台管理'); }
  async setAccountEntitlement() { throw new Error('账号授权请在管理员后台管理'); }
}

module.exports = { RemoteAuthService, normalizeBaseUrl, toEntitlement };
