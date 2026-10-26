'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const ALLOWED = new Map([['POST /login', true], ['PUT /password', true], ['GET /profile', true], ['GET /entitlement', true], ['GET /preferences', true], ['PUT /preferences', true]]);

async function forwardStandaloneAuth(mobile, req, route, input) {
  const workspace = mobile.workspace;
  if (workspace.config?.authMode !== 'standalone') fail(404, '此电脑未启用本机账号服务');
  if (!ALLOWED.has(`${req.method} ${route}`)) fail(404, '账号接口不存在');
  const base = new URL(workspace.config.cloudBaseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) fail(503, '本机账号服务配置不正确');
  const pairing = String(input?.pairingToken || req.headers['x-pairing-token'] || '');
  let device = null;
  if (!pairing || (mobile.pairings.get(pairing) || 0) <= Date.now()) {
    device = (await mobile.devices())[String(req.headers['x-device-id'] || '')];
    const digest = createHash('sha256').update(String(req.headers['x-device-key'] || '')).digest('hex');
    if (!device || !/^[a-f0-9]{64}$/.test(device.keyHash || '') || !timingSafeEqual(Buffer.from(digest), Buffer.from(device.keyHash))) fail(403, '请先扫描主电脑的新配对码');
  }
  const authorization = req.headers.authorization;
  async function send(target, method, body) {
    const response = await workspace.fetchImpl(`${base.origin}/api/auth${target}`, {
      method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    const value = await response.json();
    if (!response.ok) fail(response.status, value.error?.message || value.error || value.message || '账号核验失败');
    return value;
  }
  function check(user) {
    if (!user?.isActive || String(user.mainAccountId || user.id) !== String(workspace.config.ownerId) || device && device.userId !== user.id) fail(403, '此账号不属于当前配对电脑');
  }
  if (route === '/login') {
    const result = await send(route, 'POST', { phone: input?.phone, password: input?.password });
    check(result.user); return result;
  }
  const profile = await send('/profile', 'GET'); check(profile.user);
  if (route === '/profile') return profile;
  return send(route, req.method, route === '/password' ? { oldPassword: input?.oldPassword, newPassword: input?.newPassword } : route === '/preferences' && req.method === 'PUT' ? { menu: input?.menu || {} } : undefined);
}

module.exports = { forwardStandaloneAuth };
