'use strict';

const { fail } = require('./foundation-data-model');

function productStatus(status) {
  const entitlement = status?.entitlement || {};
  const authenticated = status?.authenticated === true;
  const type = authenticated ? entitlement.type : 'none';
  const state = ['licensed', 'trial'].includes(type) ? type : authenticated ? 'expired' : 'login-required';
  const phone = String(status?.account?.phone || '');
  return { state: status?.account?.mustChangePassword ? 'password-change-required' : state, phone, phoneMasked: phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone,
    expireDate: entitlement.expiresAt || null, trialRemainingMs: Number(entitlement.remainingMs) || 0,
    offlineGrace: false, canResumeTrial: authenticated && type === 'trial', machineId: status?.machineId || '',
    message: status?.account?.mustChangePassword ? '首次登录请先修改初始密码' : state === 'login-required' ? '请登录社区账号' : state === 'expired' ? '当前账号授权已到期' : '' };
}

function moduleForPath(path) {
  if (/^\/(people|households|village-groups|special-categories|household-link-groups)(\/|$)/.test(path)) return 'personnel';
  if (path.startsWith('/party/')) return 'party';
  if (path.startsWith('/land-parcels')) return 'land';
  if (['/finance-records', '/finance-imports', '/finance-analysis', '/finance-opening-balance', '/finance-account-balance', '/finance-categories', '/finance-reclassifications', '/finance-balance-review', '/finance-balance-preview', '/finance-transaction-order'].some(prefix => path.startsWith(prefix))) return 'finance';
  if (path.startsWith('/service-records')) return 'visit';
  if (path.startsWith('/duty/')) return 'work';
  if (path.startsWith('/certificate-')) return 'certificate';
  if (path.startsWith('/documents')) return 'archive';
  if (path.startsWith('/funds')) return 'funds';
  if (path.startsWith('/document-drafts')) return 'document';
  return 'workspace';
}

class FoundationAuthService {
  constructor({ authService, ensureReady = async () => {} }) {
    this.authService = authService;
    this.ensureReady = ensureReady;
    this.pendingStatus = null;
  }
  async status() {
    if (!this.authService) fail('AUTH_UNAVAILABLE', '社区账号服务暂不可用');
    if (!this.pendingStatus) {
      const pending = this.authService.getStatus();
      this.pendingStatus = pending;
      pending.finally(() => { if (this.pendingStatus === pending) this.pendingStatus = null; }).catch(() => {});
    }
    return this.pendingStatus;
  }
  async bootstrap() { return productStatus(await this.status()); }
  async refresh() {
    this.pendingStatus = null;
    return productStatus(await this.authService.getStatus({ forceRefresh: true }));
  }
  async login(credentials) {
    if (!this.authService) fail('AUTH_UNAVAILABLE', '社区账号服务暂不可用');
    await this.ensureReady();
    this.pendingStatus = null;
    return productStatus(await this.authService.login(credentials));
  }
  async register(credentials) {
    if (!this.authService) fail('AUTH_UNAVAILABLE', '社区账号服务暂不可用');
    await this.ensureReady();
    this.pendingStatus = null;
    return productStatus(await this.authService.register({ ...credentials, confirmPassword: credentials.confirmPassword ?? credentials.password }));
  }
  async logout() {
    if (!this.authService) fail('AUTH_UNAVAILABLE', '社区账号服务暂不可用');
    await this.authService.logout(); this.pendingStatus = null;
    return productStatus(await this.status());
  }
  async continueTrial() {
    const status = await this.status();
    if (!status.authenticated) fail('PRODUCT_AUTH_REQUIRED', '请先登录社区账号后使用试用授权');
    return productStatus(status);
  }
  async authorize({ method, path, domain }) {
    const status = await this.status();
    if (!status.authenticated || !['licensed', 'trial'].includes(status.entitlement?.type) || status.account?.mustChangePassword) {
      fail('PRODUCT_AUTH_REQUIRED', productStatus(status).message || '请先登录有效的社区账号');
    }
    const account = status.account || {};
    if (account.role !== 'member') return;
    if (path === '/finance-opening-balance' && method !== 'GET') fail('FORBIDDEN', '仅主账号可设置期初余额');
    if (path === '/backup') fail('FORBIDDEN', '仅主账号可备份或恢复完整工作区');
    const action = method === 'GET' ? 'view' : method === 'DELETE' ? 'delete' : method === 'PATCH' || method === 'PUT' || path === '/people/batch-patch' ? 'update' : 'create';
    const permissions = account.permissions || {};
    if (path === '/import-backup') {
      if (method === 'POST' && ['personnel', 'land', 'finance'].includes(domain) && (permissions[domain] || []).includes('view') && ['create', 'update'].some(action => permissions[domain].includes(action))) return;
      fail('FORBIDDEN', '当前账号没有该业务的导入权限');
    }
    if (path === '/import-preview' && ['personnel', 'land', 'visit', 'finance'].some(key => (permissions[key] || []).includes('view'))) return;
    const module = path.startsWith('/dictionaries') && domain === 'document' ? 'document'
      : path === '/import-jobs' && ['personnel', 'land'].includes(domain) ? domain : moduleForPath(path);
    // Shared read endpoints include settings needed to draw the shell; they
    // never imply permission to modify unit settings or another business area.
    if (method === 'GET' && ['/system-settings', '/dictionaries'].includes(path)) return;
    const allowed = permissions[module] || [];
    if (path === '/people/batch-upsert' && method === 'POST' && allowed.includes('view') && allowed.some(value => ['create', 'update'].includes(value))) return { personWriteActions: allowed };
    if (allowed.includes('view') && allowed.includes(action)) return;
    fail('FORBIDDEN', '当前账号没有执行此操作的权限');
  }
}

module.exports = { FoundationAuthService, productStatus, moduleForPath };
