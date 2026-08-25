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
  constructor({ store, machineId, baseUrl, rememberedLoginStore = null, fetchImpl = globalThis.fetch, requestTimeoutMs = 12000 }) {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');
    this.store = store;
    this.machineId = machineId;
    this.defaultBaseUrl = normalizeBaseUrl(baseUrl);
    this.baseUrl = this.defaultBaseUrl;
    this.rememberedLoginStore = rememberedLoginStore;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.session = null;
  }

  async fetchWithTimeout(url, options, timeoutMessage) {
    const controller = new AbortController();
    let timer = null;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(timeoutMessage));
        }, this.requestTimeoutMs);
      });
      return await Promise.race([
        this.fetchImpl(url, { ...options, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getServerConfig() {
    const state = await this.store.read();
    const savedBaseUrl = typeof state.remoteServerUrl === 'string' && state.remoteServerUrl.trim()
      ? normalizeBaseUrl(state.remoteServerUrl)
      : null;
    this.baseUrl = savedBaseUrl || this.defaultBaseUrl;
    return { baseUrl: this.baseUrl, configured: Boolean(savedBaseUrl) };
  }

  async setServerConfig({ baseUrl }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const state = await this.store.read();
    state.remoteServerUrl = normalizedBaseUrl;
    state.remoteAccount = null;
    state.lastLoginPhone = '';
    state.rememberedAccountId = null;
    state.lastKnownEntitlement = null;
    await this.store.write(state);
    this.baseUrl = normalizedBaseUrl;
    this.session = null;
    await this.rememberedLoginStore?.clear();
    return { baseUrl: normalizedBaseUrl, configured: true };
  }

  async checkServerConnection({ baseUrl } = {}) {
    const targetBaseUrl = normalizeBaseUrl(baseUrl || (await this.getServerConfig()).baseUrl);
    let response;
    try {
      response = await this.fetchWithTimeout(`${targetBaseUrl}/api/health`, { headers: { Accept: 'application/json' } }, '账号服务器连接超时，请检查地址、网络和服务状态');
    } catch (error) {
      if (/超时/u.test(error?.message || '')) throw error;
      throw new Error('无法连接账号服务器，请确认地址、网络和服务状态');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== 'ok') throw new Error(payload.error || '账号服务器健康检查失败');
    return { ok: true, baseUrl: targetBaseUrl, service: payload.service || 'community-ai-backend', version: payload.version || '' };
  }

  async request(path, { method = 'GET', body, token = this.session?.token } = {}) {
    const { baseUrl } = await this.getServerConfig();
    let response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, '账号服务器响应超时，请检查地址、网络和服务状态后重试');
    } catch (error) {
      if (/超时/u.test(error?.message || '')) throw error;
      throw new Error('无法连接账号服务，请检查网络或后端地址');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '账号服务请求失败');
    return payload;
  }

  async register() { throw new Error('请使用单位管理员申请或加入单位入口注册'); }

  async submitUnitAdminApplication({ phone, password, name, organizationName, region }) {
    const normalizedPhone = validateCredentials(phone, password);
    return this.request('/auth/unit-admin-applications', { method: 'POST', body: { phone: normalizedPhone, password, name, organizationName, region, machineId: this.machineId }, token: null });
  }

  async submitMemberApplication({ inviteCode, phone, password, name }) {
    const normalizedPhone = validateCredentials(phone, password);
    return this.request('/auth/member-applications', { method: 'POST', body: { inviteCode, phone: normalizedPhone, password, name, machineId: this.machineId }, token: null });
  }

  async listMemberApplications() { return this.request('/auth/unit/member-applications'); }
  async reviewMemberApplication({ applicationId, approve, reviewNote, permissions }) { return this.request(`/auth/unit/member-applications/${applicationId}/review`, { method: 'POST', body: { approve, reviewNote, permissions } }); }
  async listUnitMembers() { return this.request('/auth/unit/members'); }
  async updateMemberPermissions({ memberId, permissions }) { return this.request(`/auth/unit/members/${memberId}/permissions`, { method: 'PUT', body: { permissions } }); }
  async listInvites() { return this.request('/auth/unit/invites'); }
  async createInvite({ expiresAt, maxUses }) { return this.request('/auth/unit/invites', { method: 'POST', body: { expiresAt, maxUses } }); }
  async deactivateInvite({ inviteId }) { return this.request(`/auth/unit/invites/${inviteId}`, { method: 'DELETE' }); }

  async subscribeWorkspaceChanges(onChanged) {
    if (!this.session?.token) return () => {};
    const { baseUrl } = await this.getServerConfig();
    const controller = new AbortController();
    const response = await this.fetchImpl(`${baseUrl}/api/unit/workspace/events`, { headers: { Authorization: `Bearer ${this.session.token}`, Accept: 'text/event-stream' }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('无法连接共享数据实时服务');
    (async () => {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); if (message.startsWith('event: changed')) { const data = message.split('\n').find(line => line.startsWith('data: ')); if (data) onChanged(JSON.parse(data.slice(6))); } } } } catch (error) { if (!controller.signal.aborted) onChanged({ error: error.message }); }
    })();
    return () => controller.abort();
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
    state.lastKnownEntitlement = null;
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
    const entitlement = toEntitlement(await this.request('/auth/entitlement'));
    const state = await this.store.read();
    state.lastKnownEntitlement = {
      accountId: this.session.user.id,
      phone: this.session.user.phone,
      plan: entitlement.plan || null,
      expiresAt: entitlement.expiresAt || null,
      observedAt: new Date().toISOString(),
    };
    await this.store.write(state);
    return entitlement;
  }

  async getStatus() {
    return {
      ok: true,
      authenticated: Boolean(this.session),
      account: this.session ? {
        id: this.session.user.id,
        phone: this.session.user.phone,
        name: this.session.user.name,
        role: this.session.user.role,
        organization: this.session.user.organization || null,
        permissions: this.session.user.permissions || {},
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
    const snapshot = state.lastKnownEntitlement;
    const isMatchingAccount = account && snapshot
      && snapshot.accountId === account.id
      && snapshot.phone === account.phone;
    const hasUsableSnapshot = isMatchingAccount
      && typeof snapshot.plan === 'string'
      && snapshot.plan.length > 0;
    const entitlement = hasUsableSnapshot
      ? toEntitlement({
        valid: snapshot.plan === 'permanent' || (snapshot.expiresAt && new Date(snapshot.expiresAt).getTime() > Date.now()),
        plan: snapshot.plan,
        expiresAt: snapshot.expiresAt,
      })
      : { type: 'none' };
    return { hasPreviousAccount: Boolean(account), account: account ? { phone: account.phone } : null, entitlement };
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
    state.remoteAccount = null;
    state.lastKnownEntitlement = null;
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
