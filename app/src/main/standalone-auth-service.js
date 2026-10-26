'use strict';

const { RemoteAuthService } = require('./remote-auth-service');

class StandaloneAuthService extends RemoteAuthService {
  constructor({ runtime, ensureReady, hostClient, ...options }) {
    super(options);
    this.mode = 'standalone'; this.runtime = runtime; this.ensureReady = ensureReady;
    this.hostClient = hostClient;
  }
  async getServerConfig() {
    const connection = await this.hostClient?.workspace();
    this.baseUrl = connection?.baseUrl || this.defaultBaseUrl;
    return { baseUrl: this.baseUrl, configured: true, mode: 'standalone', host: Boolean(connection), manualUpdates: true };
  }
  async setServerConfig({ pairingCode, useThisComputer } = {}) {
    if (!this.hostClient) throw new Error('主电脑连接尚未就绪');
    const result = useThisComputer ? await this.hostClient.clear() : await this.hostClient.configure(pairingCode);
    this.session = null;
    return { ...await this.getServerConfig(), warning: result?.warning || '' };
  }
  async getWorkspaceBaseUrl() { return (await this.hostClient?.workspace())?.baseUrl || super.getWorkspaceBaseUrl(); }
  async getWorkspaceConnection() { return await this.hostClient?.workspace() || super.getWorkspaceConnection(); }
  async login(value) {
    const config = await this.getServerConfig();
    if (!config.host) { await this.runtime.prepare(value); await this.ensureReady(config); }
    const result = await super.login(value);
    if (!config.host && result.account?.role !== 'member') await this.localWorkspaceService?.useLocalAuthority(result.account.mainAccountId || result.account.id, this.defaultBaseUrl);
    return { ...result, mode: this.mode };
  }
  async register(value) {
    if (value.password !== (value.confirmPassword ?? value.password)) throw new Error('两次输入的密码不一致');
    if ((await this.getServerConfig()).host) throw new Error('成员账号需由主电脑的主账号创建');
    await this.runtime.prepare({ ...value, register: true });
    return this.login(value);
  }
  async loginOffline() { throw new Error('本机账号服务或主电脑暂不可达，请检查后重试；未使用旧缓存授权登录'); }
  async beginSession(result, credentials) {
    // Workspaces use the verified original ID, never a new UUID for legacy data.
    if (await this.hostClient?.config()) {
      if (result.user.role !== 'member') throw new Error('主账号请在原主电脑打开资料；其他电脑请使用成员账号');
      if (!result.user.mustChangePassword) await this.hostClient.pairSession(result);
    } else if (result.user.role !== 'member') await this.localWorkspaceService?.useLocalAuthority(result.user.mainAccountId || result.user.id, this.defaultBaseUrl);
    return super.beginSession(result, credentials);
  }
  async getLoginPrefill() {
    const saved = await super.getLoginPrefill();
    if (saved.phone || await this.runtime.readDatabase()) return saved;
    const state = await this.runtime.legacyState();
    // Do not decrypt the old password or mutate the old credential store.
    return { ...saved, phone: state.lastLoginPhone || state.remoteAccount?.phone || '', password: '', remembered: false, rememberPreference: false };
  }
  async getStatus(options) { return { ...await super.getStatus(options), mode: 'standalone' }; }
  async request(route, options) {
    if (route === '/ai/quota') { await this.assertSignedIn(); return { quota: null, billingUnit: 'provider', mode: 'standalone', message: '自用模型服务按其实际用量计费，本机不扣平台积分' }; }
    if (route.startsWith('/ai/usage/detail')) { await this.assertSignedIn(); return { usage: [], pagination: { page: 1, totalPages: 1, total: 0 }, mode: 'standalone' }; }
    if (route.startsWith('/ai/quota/ledger')) { await this.assertSignedIn(); return { ledger: [], mode: 'standalone' }; }
    if (route.startsWith('/ai/')) throw new Error('本机独立版使用自己的模型服务，请到系统设置配置');
    if (route.startsWith('/auth/') && await this.hostClient?.config()) return this.hostClient.request(route, { ...options, token: options?.token === undefined ? this.session?.token : options.token });
    return super.request(route, options);
  }
  async assertSignedIn() { if (!this.session?.token) throw new Error('请先登录本机账号'); }
}

function manualUpdateService() {
  const status = () => ({ ok: true, disabled: true, mode: 'manual', message: '本机独立版采用下载安装包更新，当前不连接云端更新服务' });
  return { check: async () => status(), download: async () => status(), install: async () => status() };
}

module.exports = { StandaloneAuthService, manualUpdateService };
