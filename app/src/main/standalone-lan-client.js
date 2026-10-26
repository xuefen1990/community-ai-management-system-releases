'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { seal, open, pairId, seedOf } = require('./mini-program-crypto');

function parsePairing(code) {
  let value; try { value = JSON.parse(code); } catch { throw new Error('请粘贴主电脑手机互联页面的完整配对码'); }
  const endpoint = new URL(value.miniProgram?.endpoint || 'https://invalid');
  const octets = endpoint.hostname.split('.').map(Number);
  const privateIp = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  if (value.protocol !== 'village-mobile-pair-v1' || value.accountMode !== 'standalone' || value.miniProgram?.protocol !== 'village-mini-channel-v1'
    || !privateIp || endpoint.protocol !== 'http:' || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
    || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.workspaceId || '') || !value.ownerId || !/^[a-f0-9]{48}$/.test(value.pairingToken || '') || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) throw new Error('配对码无效、已到期或不是本机独立版主电脑');
  return { endpoint: endpoint.origin, workspaceId: value.workspaceId, ownerId: value.ownerId, pairingToken: value.pairingToken, expiresAt: value.expiresAt };
}

class StandaloneLanClient {
  constructor({ userDataPath, safeStorage, fetchImpl = globalThis.fetch }) {
    this.file = path.join(userDataPath, 'standalone', 'host-binding.json'); this.safeStorage = safeStorage; this.fetchImpl = fetchImpl;
    this.binding = undefined;
  }
  async config() {
    if (this.binding !== undefined) return this.binding;
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!this.safeStorage?.isEncryptionAvailable()) throw new Error('系统安全存储不可用，请重新扫描主电脑配对码');
      this.binding = JSON.parse(this.safeStorage.decryptString(Buffer.from(value.encrypted, 'base64')));
      return this.binding;
    } catch (error) { if (error.code === 'ENOENT') return (this.binding = null); throw error; }
  }
  async save() {
    if (!this.safeStorage?.isEncryptionAvailable()) return { warning: '系统安全存储不可用，主电脑配对仅在本次打开软件期间有效' };
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${randomUUID()}`;
    await fs.writeFile(temporary, JSON.stringify({ encrypted: this.safeStorage.encryptString(JSON.stringify(this.binding)).toString('base64') }), { mode: 0o600 });
    await fs.rename(temporary, this.file); return { warning: '' };
  }
  async configure(code) { this.binding = parsePairing(code); return this.save(); }
  async clear() { this.binding = null; await fs.rm(this.file, { force: true }); }
  async exchange(payload, token = '', pairing = false) {
    const binding = await this.config(); if (!binding) throw new Error('请先配置主电脑配对码');
    const isPair = pairing || !binding.deviceKey;
    if (isPair && binding.expiresAt <= Date.now()) throw new Error('配对码已到期，请在主电脑刷新后重新粘贴');
    const seed = seedOf(isPair ? binding.pairingToken : binding.deviceKey);
    const envelope = { workspaceId: binding.workspaceId, mode: isPair ? 'pair' : 'device', keyId: isPair ? pairId(binding.pairingToken) : binding.deviceId, requestId: randomBytes(16).toString('hex'), issuedAt: Date.now() };
    const response = await this.fetchImpl(binding.endpoint + '/api/mobile-channel/v1/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seal({ ...payload, token, deviceId: binding.deviceId, deviceKey: binding.deviceKey }, envelope, seed, 'request')), signal: AbortSignal.timeout(payload.kind === 'ai' ? 180000 : 18000), redirect: 'error' });
    if (!response.ok) throw new Error('无法连接已配对主电脑，请检查配对码、局域网和电脑状态');
    const received = await response.json();
    for (const key of ['workspaceId', 'mode', 'keyId', 'requestId', 'issuedAt']) if (received[key] !== envelope[key]) throw new Error('主电脑响应身份不一致');
    const result = open(received, seed, 'response');
    if (result.status !== 200) throw Object.assign(new Error(result.error || '主电脑账号核验失败'), { statusCode: result.status });
    return result;
  }
  async request(route, { method = 'GET', body, token } = {}) {
    return (await this.exchange({ kind: 'auth', path: route.slice('/auth'.length), method, body }, token)).data;
  }
  async chat(messages, options) { return (await this.exchange({ kind: 'ai', messages, maxTokens: options.maxTokens, taskKind: options.taskKind, mode: options.hostMode }, options.token)).data; }
  async capabilities(token) { return (await this.exchange({ kind: 'aiCapabilities' }, token)).data; }
  async pairSession(result) {
    const binding = await this.config(); if (binding.deviceKey) return;
    binding.deviceId = randomUUID();
    const response = await this.exchange({ kind: 'request', path: '/pair', method: 'POST', body: { pairingToken: binding.pairingToken, deviceId: binding.deviceId } }, result.token, true);
    const receipt = JSON.parse(Buffer.from(response.body, 'base64').toString('utf8'));
    if (receipt.workspaceId !== binding.workspaceId || receipt.account?.id !== result.user.id || !receipt.deviceKey) throw new Error('主电脑配对返回身份不一致');
    binding.deviceKey = receipt.deviceKey; delete binding.pairingToken; delete binding.expiresAt;
    await this.save();
  }
  async workspace() { const value = await this.config(); return value ? { baseUrl: `http://${new URL(value.endpoint).hostname}:3000`, ownerId: value.ownerId, confirmedAt: new Date().toISOString() } : null; }
}
module.exports = { StandaloneLanClient, parsePairing };
