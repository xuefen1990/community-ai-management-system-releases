'use strict';
// The HTTP carrier never accepts plaintext business requests. All actions reuse the mobile service.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { PROTOCOL, hash, pairId, seedOf, open, seal } = require('./mini-program-crypto');
const contract = require('./mobile-contract.generated.json');
const CHUNK = contract.limits.chunkBytes, MAX = contract.limits.attachmentBytes, WINDOW = 120000;
const failure = (status, message) => { throw Object.assign(new Error(message), { status }); };
class MiniProgramChannel {
  constructor(mobile, port) {
    this.mobile = mobile; this.port = port; this.server = null; this.queue = Promise.resolve();
    this.directory = path.join(mobile.directory, 'mini-channel');
  }
  async start() {
    if (this.server?.listening) return;
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const server = http.createServer((req, res) => { void this.handle(req, res); });
    server.requestTimeout = 180000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, this.mobile.workspace.host, resolve); });
    this.server = server;
  }
  info() { return this.server?.listening ? { protocol: PROTOCOL, port: this.server.address().port } : null; }
  async stop() {
    const server = this.server; this.server = null;
    if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  async keyFor(envelope) {
    if (envelope.workspaceId !== this.mobile.identity.workspaceId || !['pair', 'device'].includes(envelope.mode)
      || !/^[a-zA-Z0-9_-]{16,100}$/.test(envelope.keyId || '') || !/^[a-f0-9]{32}$/.test(envelope.requestId || '')
      || !Number.isSafeInteger(envelope.issuedAt) || Math.abs(envelope.issuedAt - Date.now()) > WINDOW) failure(403, '连接凭据或时间不正确');
    if (envelope.mode === 'pair') {
      const token = [...this.mobile.pairings.keys()].find(value => pairId(value) === envelope.keyId && this.mobile.pairings.get(value) > Date.now());
      if (!token) failure(403, '配对码已失效，请在电脑端刷新');
      return seedOf(token);
    }
    const device = (await this.mobile.devices())[envelope.keyId];
    if (!/^[a-f0-9]{64}$/.test(device?.keyHash || '')) failure(403, '手机尚未配对');
    return Buffer.from(device.keyHash, 'hex');
  }
  async claim(envelope, seed) {
    const task = this.queue.catch(() => {}).then(async () => {
      const file = path.join(this.directory, 'replays.json');
      let old;
      try { old = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; old = {}; }
      const entries = Object.fromEntries(Object.entries(old).filter(([, until]) => until > Date.now()));
      const id = hash(Buffer.concat([seed, Buffer.from(envelope.requestId)]));
      if (entries[id]) failure(409, '重复的连接请求已拒绝，请重新同步');
      if (Object.keys(entries).length >= 12000) failure(429, '同步请求较多，请稍后重试');
      entries[id] = envelope.issuedAt + WINDOW + 1000;
      await this.mobile.workspace.writeJson(file, entries);
    });
    this.queue = task; return task;
  }
  request(payload, method, route, bytes) {
    const req = Readable.from(bytes ? [bytes] : []);
    req.method = method; req.url = '/api/mobile/v1' + route; req.mobilePlatform = 'wechat';
    req.headers = { authorization: `Bearer ${String(payload.token || '')}`, 'x-device-id': String(payload.deviceId || ''), 'x-device-key': String(payload.deviceKey || '') };
    return req;
  }
  async invoke(payload, method, route, bytes) {
    let status = 500, headers = {}, chunks = [];
    const res = { writeHead(code, values) { status = code; headers = values || {}; }, end(bytes) { if (bytes) chunks.push(Buffer.from(bytes)); } };
    await this.mobile.handle(this.request(payload, method, route, bytes), res);
    return { status, headers, bytes: Buffer.concat(chunks) };
  }
  async account(payload, envelope) {
    if (envelope.mode !== 'device' || payload.deviceId !== envelope.keyId) failure(403, '绑定手机不一致');
    return this.mobile.account(this.request(payload, 'GET', '/snapshot'));
  }
  async transfer(result, user, envelope) {
    if (result.bytes.length <= CHUNK) return { status: result.status, headers: result.headers, body: result.bytes.toString('base64') };
    if (result.bytes.length > 32 * 1024 * 1024) failure(413, '同步资料过大，请由主账号检查附件与底册');
    const folder = path.join(this.directory, 'transfers'); await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const names = await fs.readdir(folder), now = Date.now();
    for (const name of names) if (/^[a-f0-9]{32}(?:\.json)?$/.test(name)) {
      const file = path.join(folder, name), stat = await fs.stat(file).catch(() => null);
      if (stat && now - stat.mtimeMs > 180000) await fs.unlink(file).catch(() => {});
    }
    if ((await fs.readdir(folder)).length >= 200) failure(429, '同步资料正在传输，请稍后重试');
    const id = randomBytes(16).toString('hex');
    const metadata = { deviceId: envelope.keyId, userId: user.id, access: this.mobile.capabilities(user), until: now + 180000,
      sizeBytes: result.bytes.length, sha256: hash(result.bytes), status: result.status, headers: result.headers };
    await fs.writeFile(path.join(folder, id), result.bytes, { mode: 0o600, flag: 'wx' });
    await this.mobile.workspace.writeJson(path.join(folder, id + '.json'), metadata);
    return { status: result.status, headers: result.headers, transfer: { id, sizeBytes: metadata.sizeBytes, sha256: metadata.sha256 } };
  }
  async action(payload, envelope) {
    if (!payload || typeof payload !== 'object') failure(400, '连接数据不正确');
    if (payload.kind === 'auth') {
      if (!['/login', '/password', '/profile', '/entitlement', '/preferences'].includes(payload.path)) failure(404, '账号接口不存在');
      if (envelope.mode === 'device' && payload.deviceId !== envelope.keyId) failure(403, '绑定手机不一致');
      const token = envelope.mode === 'pair' ? [...this.mobile.pairings.keys()].find(value => pairId(value) === envelope.keyId && this.mobile.pairings.get(value) > Date.now()) : '';
      const req = this.request(payload, payload.method, '/auth' + payload.path);
      if (token) req.headers['x-pairing-token'] = token;
      const data = await require('./standalone-mobile-auth').forwardStandaloneAuth(this.mobile, req, payload.path, payload.body || {});
      return { status: 200, data };
    }
    if (envelope.mode === 'pair') {
      if (payload.kind !== 'request' || payload.path !== '/pair' || payload.method !== 'POST' || pairId(String(payload.body?.pairingToken || '')) !== envelope.keyId) failure(403, '配对请求不正确');
      const result = await this.invoke(payload, 'POST', '/pair', Buffer.from(JSON.stringify(payload.body)));
      if (result.status !== 200) return this.transfer(result, null, envelope);
      const value = JSON.parse(result.bytes.toString());
      // The initial receipt is small; the authorized snapshot is fetched with the new device credential.
      return { status: 200, headers: result.headers, body: Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !['data', 'finance', 'work', 'attachments'].includes(key))))).toString('base64') };
    }
    const user = await this.account(payload, envelope);
    if (payload.kind === 'aiCapabilities') {
      if (this.mobile.workspace.config.authMode !== 'standalone' || user.aiAccessEnabled === false || typeof this.mobile.workspace.directAiCapabilities !== 'function') failure(403, '当前账号未获 AI 使用权限');
      return { status: 200, data: await this.mobile.workspace.directAiCapabilities(user) };
    }
    if (payload.kind === 'ai') {
      if (this.mobile.workspace.config.authMode !== 'standalone' || user.aiAccessEnabled === false || typeof this.mobile.workspace.directAiChat !== 'function') failure(403, '当前账号未获 AI 使用权限');
      if (!Array.isArray(payload.messages) || !payload.messages.length || JSON.stringify(payload.messages).length > 250000) failure(400, 'AI 请求内容不正确');
      this.activeAi ||= new Set(); if (this.activeAi.has(user.id)) failure(429, '已有 AI 请求正在处理，请稍候');
      this.activeAi.add(user.id);
      try { return { status: 200, data: await this.mobile.workspace.directAiChat(user, payload.messages, { maxTokens: Math.min(8192, Math.max(16, Number(payload.maxTokens) || 4096)), taskKind: String(payload.taskKind || ''), forceOnline: payload.mode === 'online' }) }; }
      finally { this.activeAi.delete(user.id); }
    }
    if (payload.kind === 'download') {
      const { id, offset } = payload;
      if (!/^[a-f0-9]{32}$/.test(id || '') || !Number.isSafeInteger(offset) || offset < 0) failure(400, '分片位置不正确');
      const folder = path.join(this.directory, 'transfers');
      const meta = await fs.readFile(path.join(folder, id + '.json'), 'utf8').then(JSON.parse).catch(() => failure(409, '传输已过期，请重新同步'));
      if (meta.until <= Date.now()) failure(409, '传输已过期，请重新同步');
      if (meta.deviceId !== envelope.keyId || meta.userId !== user.id || JSON.stringify(meta.access) !== JSON.stringify(this.mobile.capabilities(user))) failure(403, '资料权限已变化，请重新同步');
      if (offset >= meta.sizeBytes) failure(400, '分片位置超出范围');
      const handle = await fs.open(path.join(folder, id), 'r');
      try {
        const bytes = Buffer.alloc(Math.min(CHUNK, meta.sizeBytes - offset)), read = await handle.read(bytes, 0, bytes.length, offset);
        return { status: 200, data: { offset, nextOffset: offset + read.bytesRead, bytes: bytes.subarray(0, read.bytesRead).toString('base64') } };
      } finally { await handle.close(); }
    }
    if (['uploadStatus', 'uploadChunk'].includes(payload.kind)) {
      if (!this.mobile.capabilities(user).workCreate) failure(403, '没有上报照片权限');
      const { id, totalSize } = payload;
      if (!/^[a-f0-9]{64}$/.test(id || '') || !Number.isSafeInteger(totalSize) || totalSize < 1 || totalSize > MAX) failure(413, '照片大小或标识不正确');
      const folder = path.join(this.directory, 'chunks', hash(String(user.id))); await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      const file = path.join(folder, id + '.part'), final = path.join(this.mobile.directory, 'uploads', hash(String(user.id)), id);
      const existing = await fs.readFile(final).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing && existing.length === totalSize && hash(existing) === id) return { status: 200, data: { nextOffset: totalSize, complete: true } };
      const task = this.queue.catch(() => {}).then(async () => {
        const names = (await fs.readdir(folder)).filter(name => /^[a-f0-9]{64}\.part$/.test(name));
        for (const name of names) {
          const staged = path.join(folder, name), stat = await fs.stat(staged).catch(() => null);
          if (stat && Date.now() - stat.mtimeMs > 24 * 3600000) await fs.unlink(staged).catch(() => {});
        }
        if (!(await fs.stat(file).catch(() => null)) && (await fs.readdir(folder)).length >= 32) failure(429, '暂存照片较多，请先完成已有上报；手机原稿已保留');
        const size = (await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.size || 0;
        if (size > totalSize) failure(409, '照片原稿与已上传分片不一致');
        // A process may stop after the last append, before the final native upload receipt.
        if (size === totalSize) {
          const full = await fs.readFile(file);
          if (hash(full) !== id) failure(409, '照片原稿摘要变化，请保留原稿');
          const result = await this.invoke(payload, 'PUT', '/uploads/' + id, full);
          if (result.status !== 200) return this.transfer(result, user, envelope);
          await fs.unlink(file);
          return { status: 200, data: { nextOffset: totalSize, complete: true } };
        }
        if (payload.kind === 'uploadStatus') return { status: 200, data: { nextOffset: size, complete: false } };
        const bytes = Buffer.from(payload.bytes || '', 'base64'), offset = payload.offset;
        if (!bytes.length || bytes.length > CHUNK || !Number.isSafeInteger(offset) || offset < 0 || offset + bytes.length > totalSize) failure(400, '照片分片不正确');
        if (offset < size) {
          const old = await fs.readFile(file);
          if (offset + bytes.length <= size && old.subarray(offset, offset + bytes.length).equals(bytes)) return { status: 200, data: { nextOffset: size, complete: false } };
          failure(409, '同一照片分片内容变化，请保留原稿');
        }
        if (offset !== size) failure(409, '照片分片顺序不正确，请重新同步');
        await fs.appendFile(file, bytes, { mode: 0o600 });
        const nextOffset = size + bytes.length;
        if (nextOffset === totalSize) {
          const full = await fs.readFile(file);
          if (hash(full) !== id) { await fs.unlink(file); failure(400, '照片完整摘要不正确'); }
          const result = await this.invoke(payload, 'PUT', '/uploads/' + id, full);
          if (result.status !== 200) return this.transfer(result, user, envelope);
          await fs.unlink(file);
        }
        return { status: 200, data: { nextOffset, complete: nextOffset === totalSize } };
      });
      this.queue = task; return task;
    }
    if (payload.kind !== 'request' || !/^(?:GET|POST)$/.test(payload.method || '')
      || !/^\/(?:status|snapshot(?:\?known=[a-f0-9]{64})?|resources|attachments\/[a-f0-9]{64})$/.test(payload.path || '')) failure(404, '小程序接口不存在');
    if (payload.path === '/resources' && payload.method !== 'POST' || payload.path !== '/resources' && payload.method !== 'GET') failure(405, '操作方式不正确');
    return this.transfer(await this.invoke(payload, payload.method, payload.path, payload.body ? Buffer.from(JSON.stringify(payload.body)) : null), user, envelope);
  }
  async handle(req, res) {
    let envelope, seed;
    try {
      const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/.test(address)) failure(403, '只允许局域网连接');
      if (req.method !== 'POST' || req.url !== '/api/mobile-channel/v1/exchange') failure(404, '接口不存在');
      const chunks = []; let size = 0;
      for await (const bytes of req) { size += bytes.length; if (size > 1024 * 1024) failure(413, '连接请求过大'); chunks.push(bytes); }
      envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); seed = await this.keyFor(envelope);
      let payload; try { payload = open(envelope, seed, 'request'); } catch { failure(403, '连接数据认证失败'); }
      await this.claim(envelope, seed);
      let result;
      try { result = await this.action(payload, envelope); }
      catch (error) { result = { status: error.status || 500, error: error.status ? error.message : '同步暂不可用，请重试' }; }
      this.mobile.workspace.send(res, 200, seal(result, envelope, seed, 'response'));
    } catch (error) {
      // No unauthenticated exception reveals credentials, files or business data.
      this.mobile.workspace.send(res, error.status || 400, { error: error.status === 409 ? error.message : '连接校验失败，请检查配对和网络后重试' });
    }
  }
}
module.exports = { MiniProgramChannel, CHUNK };
