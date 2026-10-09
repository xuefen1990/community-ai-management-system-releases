'use strict';

const { normalizePhone, validateCredentials } = require('./local-auth-service');
const { privateIpv4 } = require('./lan-workspace-service');
const { seal, open, currentEntitlement } = require('./offline-session-cache');

function normalizeBaseUrl(value) {
  const input = String(value || '').trim();
  const parts = input.split('.').map(Number);
  const isPrivateIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(input)
    && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168));
  const url = new URL(isPrivateIpv4 ? `http://${input}:3000` : input);
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

function workspaceOwnerId(user) {
  return user?.mainAccountId || user?.organization?.unitAdminUserId || '';
}

function rememberedWorkspace(state, user) {
  if (!user?.id || user.role !== 'member') return null;
  const ownerId = String(workspaceOwnerId(user));
  const saved = state.lanWorkspaceConnections?.[String(user.id)];
  if (saved && String(saved.ownerId) === ownerId) return saved;
  // The old single connection can only be attributed to the account that
  // was last signed in on this computer. Never lend it to another member.
  if (String(state.remoteAccount?.id || '') === String(user.id)
    && state.lanWorkspaceUrl && String(state.lanWorkspaceOwnerId) === ownerId) {
    return { baseUrl: state.lanWorkspaceUrl, ownerId, confirmedAt: state.lanWorkspaceConfirmedAt || new Date().toISOString() };
  }
  return null;
}

class RemoteAuthService {
  constructor({ store, machineId, baseUrl, legacyBaseUrls = [], rememberedLoginStore = null, fetchImpl = globalThis.fetch, requestTimeoutMs = 12000, aiRequestTimeoutMs = 180000 }) {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');
    this.store = store;
    this.machineId = machineId;
    this.defaultBaseUrl = normalizeBaseUrl(baseUrl);
    this.legacyBaseUrls = new Set(legacyBaseUrls.map(normalizeBaseUrl));
    this.baseUrl = this.defaultBaseUrl;
    this.rememberedLoginStore = rememberedLoginStore;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.aiRequestTimeoutMs = aiRequestTimeoutMs;
    this.session = null;
    this.entitlementCache = null;
    this.entitlementRequest = null;
    this.localWorkspaceService = null;
  }

  async fetchWithTimeout(url, options, timeoutMessage, timeoutMs = this.requestTimeoutMs) {
    const controller = new AbortController();
    let timer = null;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          // Electron's net.fetch can reject immediately on abort. Settle the
          // timeout first so that it is not reported as a connection failure.
          reject(new Error(timeoutMessage));
          controller.abort();
        }, timeoutMs);
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
    const shouldMigrate = savedBaseUrl && this.legacyBaseUrls.has(savedBaseUrl);
    this.baseUrl = shouldMigrate ? this.defaultBaseUrl : (savedBaseUrl || this.defaultBaseUrl);
    if (shouldMigrate) {
      state.remoteServerUrl = this.defaultBaseUrl;
      await this.store.write(state);
    }
    return { baseUrl: this.baseUrl, configured: Boolean(savedBaseUrl) };
  }

  async setServerConfig({ baseUrl }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const state = await this.store.read();
    state.remoteServerUrl = normalizedBaseUrl;
    state.lanWorkspaceUrl = '';
    state.lanWorkspaceOwnerId = '';
    state.lanWorkspaceConfirmedAt = null;
    state.lanWorkspaceConnections = {};
    state.remoteAccount = null;
    state.lastLoginPhone = '';
    state.rememberedAccountId = null;
    state.lastKnownEntitlement = null;
    state.offlineSessions = {};
    await this.store.write(state);
    this.baseUrl = normalizedBaseUrl;
    this.session = null;
    this.loginMemoryWarning = '';
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

  async getWorkspaceBaseUrl() {
    if (['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(this.session?.user?.role)) {
      const ownerId = this.session.user.mainAccountId || this.session.user.id;
      const { baseUrl } = await this.getServerConfig();
      if (!this.localWorkspaceService) throw new Error('本机业务数据服务尚未就绪');
      return (await this.localWorkspaceService.prepareLocal({ ownerId, cloudBaseUrl: baseUrl })).baseUrl;
    }
    const connection = await this.getWorkspaceConnection();
    if (!connection.baseUrl) throw new Error('尚未确认主电脑，请在连接页面扫描或输入 IP');
    return connection.baseUrl;
  }

  async getWorkspaceConnection() {
    const state = await this.store.read();
    return rememberedWorkspace(state, this.session?.user) || { baseUrl: '', ownerId: '', confirmedAt: null };
  }

  async checkLanWorkspace({ ip }) {
    if (!this.session?.token) throw new Error('请先登录原有账号');
    if (!privateIpv4(ip)) throw new Error('请输入主电脑的局域网 IP，例如 192.168.2.106');
    const baseUrl = `http://${ip}:3000`;
    let response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/api/lan/status`, {
        headers: { Authorization: `Bearer ${this.session.token}`, Accept: 'application/json' },
      }, '连接主电脑超时，请确认主电脑开机且处于同一局域网');
    } catch (error) {
      if (/超时/u.test(error.message || '')) throw error;
      throw new Error('无法连接主电脑，请核对 IP、网络和共享状态');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '主电脑拒绝连接');
    const ownerId = this.session.user.mainAccountId || this.session.user.organization?.unitAdminUserId
      || (['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(this.session.user.role) ? this.session.user.id : '');
    if (!ownerId || String(payload.ownerId) !== String(ownerId)) throw new Error('此主电脑不属于当前主账号');
    return { baseUrl, ownerId };
  }

  async connectLanWorkspace({ ip }) {
    const result = await this.checkLanWorkspace({ ip });
    const state = await this.store.read();
    const accountId = String(this.session?.user?.id || '');
    if (!accountId || this.session?.user?.role !== 'member') throw new Error('只有子账号需要连接主电脑');
    state.lanWorkspaceConnections ||= {};
    state.lanWorkspaceConnections[accountId] = { baseUrl: result.baseUrl, ownerId: result.ownerId, confirmedAt: new Date().toISOString() };
    state.lanWorkspaceUrl = result.baseUrl;
    state.lanWorkspaceOwnerId = result.ownerId;
    state.lanWorkspaceConfirmedAt = state.lanWorkspaceConnections[accountId].confirmedAt;
    await this.store.write(state);
    return result;
  }

  async request(path, { method = 'GET', body, token = this.session?.token, useWorkspace = true } = {}) {
    const { baseUrl } = await this.getServerConfig();
    const workspaceBaseUrl = useWorkspace && path.startsWith('/unit/workspace/') ? await this.getWorkspaceBaseUrl() : '';
    const requestBaseUrl = workspaceBaseUrl || baseUrl;
    // Model generation is slower than account/health requests. The server's
    // provider timeout is 120 seconds; allow time for its response to arrive.
    const isAiGeneration = path === '/ai/chat';
    const timeoutMessage = isAiGeneration
      ? 'AI 响应超时，服务器可能仍在处理；请先检查调用记录后再重试'
      : workspaceBaseUrl ? '连接主电脑超时，请确认主电脑开机且处于同一局域网' : '账号服务器响应超时，请检查地址、网络和服务状态后重试';
    let response;
    try {
      response = await this.fetchWithTimeout(`${requestBaseUrl}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, timeoutMessage, isAiGeneration ? this.aiRequestTimeoutMs : this.requestTimeoutMs);
    } catch (error) {
      if (/超时/u.test(error?.message || '')) throw error;
      throw new Error(workspaceBaseUrl ? '无法连接主电脑，请在连接页面重新扫描或核对 IP' : '无法连接账号服务，请检查网络或后端地址');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || '账号服务请求失败');
      error.statusCode = response.status;
      if (payload.code) error.code = payload.code;
      if (payload.details) error.details = payload.details;
      throw error;
    }
    return payload;
  }

  async requestWorkspaceFile(path, { method = 'GET', body, headers = {} } = {}) {
    if (!this.session?.token) throw new Error("请先登录村居账号");
    const baseUrl = await this.getWorkspaceBaseUrl();
    let response;
    try {
      response = await this.fetchImpl(`${baseUrl}/api/unit/workspace/${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.session.token}`, ...headers },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(120000),
      });
    } catch { throw new Error('无法连接主电脑，文件未传输；请检查局域网连接后重试'); }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || '主电脑文件传输失败');
    }
    return response;
  }

  async register({ phone, password, confirmPassword, remember = false }) {
    const normalizedPhone = validateCredentials(phone, password);
    if (password !== confirmPassword) throw new Error('两次输入的密码不一致');
    const result = await this.request('/auth/register', { method: 'POST', body: { phone: normalizedPhone, password, confirmPassword, machineId: this.machineId }, token: null });
    await this.beginSession(result, { password, remember });
    return this.getStatus();
  }

  async submitUnitAdminApplication({ phone, password, name, organizationName, region }) {
    const normalizedPhone = validateCredentials(phone, password);
    return this.request('/auth/unit-admin-applications', { method: 'POST', body: { phone: normalizedPhone, password, name, organizationName, region, machineId: this.machineId }, token: null });
  }

  async listMemberApplications() { return this.request('/auth/unit/member-applications'); }
  async reviewMemberApplication({ applicationId, approve, reviewNote, permissions }) { return this.request(`/auth/unit/member-applications/${applicationId}/review`, { method: 'POST', body: { approve, reviewNote, permissions } }); }
  async listUnitMembers() { return this.request('/auth/unit/members'); }
  async getUnitPermissionCatalog() { return this.request('/auth/unit/permissions/catalog'); }
  async createUnitMember({ phone, name, preset, permissions, aiAccessEnabled }) { return this.request('/auth/unit/members', { method: 'POST', body: { phone, name, preset, permissions, aiAccessEnabled } }); }
  async resetUnitMemberPassword({ memberId }) { return this.request(`/auth/unit/members/${memberId}/reset-password`, { method: 'POST' }); }
  async updateMemberPermissions({ memberId, permissions, aiAccessEnabled }) { return this.request(`/auth/unit/members/${memberId}/permissions`, { method: 'PUT', body: { permissions, aiAccessEnabled } }); }
  async updateMemberStatus({ memberId, isActive }) { return this.request(`/auth/unit/members/${memberId}/status`, { method: 'PUT', body: { isActive } }); }

  async subscribeWorkspaceChanges(onChanged) {
    if (!this.session?.token) return () => {};
    const workspaceBaseUrl = await this.getWorkspaceBaseUrl();
    const controller = new AbortController();
    const response = await this.fetchImpl(`${workspaceBaseUrl}/api/unit/workspace/events`, { headers: { Authorization: `Bearer ${this.session.token}`, Accept: 'text/event-stream' }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('无法连接共享数据实时服务');
    (async () => {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); if (message.startsWith('event: changed')) { const data = message.split('\n').find(line => line.startsWith('data: ')); if (data) onChanged(JSON.parse(data.slice(6))); } } } } catch (error) { if (!controller.signal.aborted) onChanged({ error: error.message }); }
    })();
    return () => controller.abort();
  }

  async login({ phone, password, remember = false }) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || typeof password !== 'string') throw new Error('请输入手机号和密码');
    let result;
    try { result = await this.request('/auth/login', { method: 'POST', body: { phone: normalizedPhone, password, machineId: this.machineId }, token: null }); }
    catch (error) {
      if (error.code || error.statusCode && error.statusCode < 500) throw error;
      const status = await this.loginOffline({ phone: normalizedPhone, password, networkError: error });
      this.rememberRequested = Boolean(remember);
      const state = await this.store.read();
      state.rememberLoginByServer ||= {};
      state.rememberLoginByServer[this.baseUrl] = Boolean(remember);
      await this.store.write(state);
      const saved = await this.updateRememberedLogin({ phone: normalizedPhone, password, remember });
      this.loginMemoryWarning = saved?.warning || '';
      return status;
    }
    this.rememberRequested = Boolean(remember);
    await this.beginSession(result, { password, remember: remember && !result.user.mustChangePassword });
    const status = await this.getStatus({ forceRefresh: true });
    if (['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(result.user.role) && this.localWorkspaceService) {
      const { baseUrl } = await this.getServerConfig();
      await this.localWorkspaceService.prepareLocal({ ownerId: result.user.mainAccountId || result.user.id, cloudBaseUrl: baseUrl });
      await this.localWorkspaceService.cacheAccountGrant(result.token, result.user, status.entitlement);
    }
    if (!result.user.mustChangePassword && ['trial', 'licensed'].includes(status.entitlement.type)) {
      const state = await this.store.read();
      state.offlineSessions ||= {};
      state.offlineSessions[normalizedPhone] = seal({ token: result.token, user: result.user, entitlement: status.entitlement }, password);
      await this.store.write(state);
    }
    return status;
  }

  async loginOffline({ phone, password, networkError }) {
    const state = await this.store.read();
    const sealed = state.offlineSessions?.[phone];
    if (!sealed) throw networkError || new Error('服务器不可用，且本机没有该账号的离线登录记录');
    const saved = open(sealed, password);
    const previousConnection = rememberedWorkspace(state, saved.user);
    if (previousConnection) {
      state.lanWorkspaceConnections ||= {};
      state.lanWorkspaceConnections[String(saved.user.id)] = previousConnection;
    }
    const entitlement = currentEntitlement(saved.entitlement);
    if (!['trial', 'licensed'].includes(entitlement.type)) throw new Error('本机记录的账号授权已到期，请联网续权');
    if (saved.user?.mustChangePassword || !saved.user?.id || !saved.token) throw new Error('离线登录记录不完整，请联网登录');
    this.session = { token: saved.token, user: saved.user, entitlement, offline: true };
    this.entitlementCache = null;
    state.lastLoginPhone = phone;
    await this.store.write(state);
    return this.getStatus();
  }

  async changePassword({ oldPassword, newPassword }) {
    if (!this.session?.user?.phone) throw new Error('请先登录');
    const phone = this.session.user.phone;
    const state = await this.store.read();
    const remember = this.rememberRequested ?? state.rememberLoginByServer?.[this.baseUrl] ?? false;
    await this.request('/auth/password', { method: 'PUT', body: { oldPassword, newPassword } });
    this.session = null;
    return this.login({ phone, password: newPassword, remember: Boolean(remember) });
  }

  async beginSession(result, { password, remember }) {
    this.session = { token: result.token, user: result.user };
    const state = await this.store.read();
    const previousConnection = rememberedWorkspace(state, result.user);
    if (previousConnection) {
      state.lanWorkspaceConnections ||= {};
      state.lanWorkspaceConnections[String(result.user.id)] = previousConnection;
    } else if (String(state.remoteAccount?.id || '') !== String(result.user.id)) {
      state.lanWorkspaceUrl = '';
      state.lanWorkspaceOwnerId = '';
      state.lanWorkspaceConfirmedAt = null;
    }
    state.remoteAccount = result.user;
    state.lastLoginPhone = result.user.phone;
    state.rememberedAccountId = remember ? result.user.id : null;
    state.lastKnownEntitlement = null;
    state.rememberLoginByServer ||= {};
    state.rememberLoginByServer[this.baseUrl] = this.session.user.mustChangePassword ? this.rememberRequested === true : Boolean(remember);
    await this.store.write(state);
    const saved = await this.updateRememberedLogin({ phone: result.user.phone, password, remember });
    this.loginMemoryWarning = saved?.warning || '';
  }

  async updateRememberedLogin({ phone, password, remember }) {
    try {
      if (remember) return await this.rememberedLoginStore?.save({ phone, password, serverUrl: this.baseUrl });
      return await this.rememberedLoginStore?.clear({ serverUrl: this.baseUrl });
    } catch {
      return { saved: false, warning: '无法保存登录密码，请下次手动输入' };
    }
  }

  async entitlement({ forceRefresh = false } = {}) {
    const session = this.session;
    if (!session) return { type: 'none' };
    if (!forceRefresh && session.entitlement) return currentEntitlement(session.entitlement);
    const cached = this.entitlementCache;
    if (!forceRefresh && cached?.session === session && cached.until > Date.now()) {
      const payload = { ...cached.payload };
      if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= Date.now()) payload.valid = false;
      return toEntitlement(payload);
    }
    if (this.entitlementRequest?.session === session) return this.entitlementRequest.promise;
    const promise = this.loadEntitlement(session);
    this.entitlementRequest = { session, promise };
    try { return await promise; }
    finally { if (this.entitlementRequest?.promise === promise) this.entitlementRequest = null; }
  }

  async loadEntitlement(session) {
    const payload = await this.request('/auth/entitlement', { token: session.token });
    if (this.session !== session) return { type: 'none' };
    const entitlement = toEntitlement(payload);
    session.entitlement = entitlement;
    const state = await this.store.read();
    if (this.session !== session) return { type: 'none' };
    state.lastKnownEntitlement = {
      accountId: session.user.id,
      phone: session.user.phone,
      plan: entitlement.plan || null,
      expiresAt: entitlement.expiresAt || null,
      observedAt: new Date().toISOString(),
    };
    await this.store.write(state);
    if (this.session === session) this.entitlementCache = { session, payload: structuredClone(payload), until: Date.now() + 5000 };
    return entitlement;
  }

  async getStatus(options) {
    const session = this.session;
    const entitlement = await this.entitlement(options);
    if (session !== this.session) return this.getStatus(options);
    return {
      ok: true,
      authenticated: Boolean(this.session),
      account: this.session ? {
        id: this.session.user.id,
        phone: this.session.user.phone,
        name: this.session.user.name,
        role: this.session.user.role,
        mainAccountId: this.session.user.mainAccountId
          || (['admin', 'platform_admin', 'main_account', 'unit_admin'].includes(this.session.user.role) ? this.session.user.id : null)
          || this.session.user.organization?.unitAdminUserId || null,
        organizationId: this.session.user.organizationId || this.session.user.organization?.id || null,
        organization: this.session.user.organization || null,
        permissions: this.session.user.permissions || {},
        aiAccessEnabled: this.session.user.aiAccessEnabled !== false,
        mustChangePassword: Boolean(this.session.user.mustChangePassword),
        createdAt: this.session.user.createdAt,
        isOwner: false,
      } : null,
      machineId: this.machineId,
      entitlement,
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
    await this.getServerConfig();
    const saved = await this.rememberedLoginStore?.load({ serverUrl: this.baseUrl, allowLegacy: this.baseUrl === this.defaultBaseUrl }) || { phone: '', password: '', warning: '' };
    const phone = state.lastLoginPhone || saved.phone || '';
    return { phone, password: saved.phone === phone ? saved.password : '', remembered: Boolean(saved.phone === phone && saved.password), warning: saved.warning || this.loginMemoryWarning || '', rememberPreference: state.rememberLoginByServer?.[this.baseUrl] ?? true };
  }

  async clearLoginPrefill() {
    await this.getServerConfig();
    const state = await this.store.read();
    state.rememberedAccountId = null;
    state.lastLoginPhone = '';
    state.remoteAccount = null;
    state.lastKnownEntitlement = null;
    state.offlineSessions = {};
    await this.store.write(state);
    state.rememberLoginByServer ||= {};
    state.rememberLoginByServer[this.baseUrl] = false;
    await this.store.write(state);
    await this.rememberedLoginStore?.clear({ serverUrl: this.baseUrl });
    this.loginMemoryWarning = '';
    return { ok: true };
  }

  async activate(code) {
    const result = await this.request('/auth/activate-license', { method: 'POST', body: { code, machineId: this.machineId } });
    this.entitlementCache = null;
    return { ok: true, authenticated: true, account: this.session?.user || null, machineId: this.machineId, entitlement: toEntitlement({ valid: true, plan: result.planType, expiresAt: result.expiresAt }) };
  }

  async listAccountEntitlements() { throw new Error('账号授权请在管理员后台管理'); }
  async setAccountEntitlement() { throw new Error('账号授权请在管理员后台管理'); }
}

module.exports = { RemoteAuthService, normalizeBaseUrl, toEntitlement };
