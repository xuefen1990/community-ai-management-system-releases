'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { isDeepStrictEqual } = require('node:util');
const { createEmptyDatabase } = require('./empty-database');
const { startLanDiscoveryResponder } = require('./lan-discovery');
const { LanAiState, normalizeImportedState } = require('./lan-ai-state');
const { assertLocalDataPath } = require('./local-file-boundary');
const { hashFile } = require('./foundation-backup-service');

const PORT = 3000;
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MODULES = {
  settings: 'settings', personnel: 'personnel', specialPersonnelProfiles: 'personnel', households: 'personnel',
  partyMembers: 'party', partyActivists: 'party', partyBranches: 'party', partyDues: 'party', partyMeetings: 'party', visitRecords: 'visit',
  dutyRecords: 'work', dutyCadres: 'work', dutyPublicPosts: 'work', dutyFlexible: 'work', workItems: 'work', workEvidence: 'work', workProgressRecords: 'work',
  workResourceEntries: 'work', workAcceptances: 'work', lands: 'land', landParcel: 'land',
  financeCategories: 'finance', financeOpeningBalance: 'finance', finances: 'finance', financeRecords: 'finance', financeImportBatches: 'finance', resourceContracts: 'finance', contractFeeLedgers: 'finance',
  contractFeeBatches: 'finance', contractFeeReceipts: 'finance', contractFeeAdvances: 'finance',
  contractFeeDistributionPlans: 'finance', contractFeeDistributionBatches: 'finance',
  disbursementCategories: 'funds', disbursementBatches: 'funds', disbursementProfiles: 'funds',
  farmlandSubsidyLedgers: 'funds', certificates: 'certificate', documents: 'archive',
  documentDrafts: 'document', documentVersions: 'document', documentReferences: 'document',
  documentDraftMessages: 'document', documentTemplates: 'document', writingProfiles: 'document',
  aiAssistantOperations: 'settings', aiAssistantTasks: 'settings', aiFileIndexEntries: 'archive',
  aiStorageMaintenance: 'settings', aiAnomalyFindings: 'settings', aiAnomalyScan: 'settings', operationLogs: 'settings',
};
const ADMIN_ROLES = new Set(['unit_admin', 'main_account', 'admin', 'platform_admin']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function privateIpv4(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function localAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(item => item?.family === 'IPv4' && !item.internal && privateIpv4(item.address))
    .map(item => item.address))];
}

function referencedFiles(value, key = '', found = new Set()) {
  if (Array.isArray(value)) for (const item of value) referencedFiles(item, key, found);
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) referencedFiles(item, name, found);
  else if (typeof value === 'string' && !value.includes('\0')
    && ((/^(?:path|filePath|file_path|fileObjectRelativePath|originalPath|sourcePath|attachmentPath|archivePath|wordPath|cachePath|tempPath)$/iu.test(key)
      && path.isAbsolute(value))
      || (/^(?:fileObjectRelativePath|file_path)$/iu.test(key) && value.trim() && !path.isAbsolute(value)))) found.add(value);
  return found;
}

function replaceFileReferences(value, replacements, key = '') {
  if (Array.isArray(value)) return value.map(item => replaceFileReferences(item, replacements, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([name, item]) => [name, replaceFileReferences(item, replacements, name)]));
  return typeof value === 'string' && replacements.has(value) ? replacements.get(value) : value;
}

function actionsFor(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [before === undefined ? 'create' : 'update'];
  const id = item => item && typeof item === 'object' && item.id != null ? String(item.id) : null;
  const identified = rows => rows.length === 0 || rows.every(item => id(item));
  if (!identified(before) || !identified(after)) {
    if (!before.length && after.length) return ['create'];
    if (before.length && !after.length) return ['delete'];
    return ['update', ...(after.length > before.length ? ['create'] : []), ...(after.length < before.length ? ['delete'] : [])];
  }
  if (new Set(before.map(id)).size !== before.length || new Set(after.map(id)).size !== after.length) throw new Error('记录标识重复');
  const oldRows = new Map(before.map(item => [id(item), item]));
  const newRows = new Map(after.map(item => [id(item), item]));
  const actions = new Set();
  for (const [key, item] of newRows) {
    if (!oldRows.has(key)) actions.add('create');
    else if (!isDeepStrictEqual(oldRows.get(key), item)) actions.add('update');
  }
  for (const key of oldRows.keys()) if (!newRows.has(key)) actions.add('delete');
  return [...actions];
}

class LanWorkspaceService {
  constructor({ userDataPath, fetchImpl = globalThis.fetch, port = PORT, host = '0.0.0.0', discovery = true }) {
    this.userDataPath = userDataPath;
    this.filesDirectory = path.join(userDataPath, 'data', 'foundation-archives');
    this.directory = path.join(userDataPath, 'lan-workspace');
    this.aiState = new LanAiState({ directory: this.directory });
    this.configPath = path.join(this.directory, 'config.json');
    this.grantsPath = path.join(this.directory, 'offline-grants.json');
    this.dataPath = path.join(this.directory, 'workspace.json');
    this.migrationManifestPath = path.join(this.directory, 'migration-manifest.json');
    this.fetchImpl = fetchImpl; this.port = port; this.publicHost = host; this.host = host; this.discovery = discovery;
    this.events = new EventEmitter(); this.events.setMaxListeners(200);
    this.server = null; this.startPromise = null; this.preparePromise = null; this.queue = Promise.resolve(); this.config = null;
    this.grantWriteQueue = Promise.resolve();
    this.discoveryResponder = null;
  }

  async readConfig() {
    try { return JSON.parse(await fs.readFile(this.configPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async writeJson(file, value) {
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, file);
  }

  async readWorkspace() {
    const value = JSON.parse(await fs.readFile(this.dataPath, 'utf8'));
    if (!Number.isInteger(value.version) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('主电脑共享数据格式无效');
    return value;
  }

  async prepareLocal({ ownerId, cloudBaseUrl }) {
    if (this.preparePromise) return this.preparePromise;
    this.preparePromise = (async () => {
      if (!ownerId || !cloudBaseUrl) throw new Error('请先登录主账号');
      if (await fs.access(path.join(this.directory, 'relocated-to.json')).then(() => true, () => false)) throw new Error('此工作区已搬迁，请从新位置打开');
      const current = await this.readConfig();
      if (current && String(current.ownerId) !== String(ownerId))
        throw new Error('本电脑已有其他主账号的本地数据，不能用当前账号打开');
      if (!current) {
        if (await fs.access(this.dataPath).then(() => true, () => false))
          throw new Error('发现未绑定主账号的本地数据，请先核对，避免覆盖');
        await this.writeJson(this.dataPath, { version: 1, data: createEmptyDatabase(), createdAt: new Date().toISOString() });
        await this.writeJson(this.configPath, { ownerId, cloudBaseUrl, shareEnabled: false, createdAt: new Date().toISOString() });
      }
      this.config = current || await this.readConfig();
      this.host = this.config.shareEnabled === false ? '127.0.0.1' : this.publicHost;
      await this.start();
      return { baseUrl: `http://127.0.0.1:${this.server.address().port}`, ownerId };
    })().finally(() => { this.preparePromise = null; });
    return this.preparePromise;
  }

  async enableSharing() {
    if (!this.config) throw new Error('请先登录主账号并打开本机数据');
    if (this.config.shareEnabled !== false && this.server?.listening) return this.info();
    const localConfig = this.config;
    await this.stop();
    this.host = this.publicHost;
    this.config = { ...localConfig, shareEnabled: true };
    try {
      await this.start();
      await this.writeJson(this.configPath, this.config);
      return this.info();
    } catch (error) {
      this.config = localConfig;
      this.host = '127.0.0.1';
      await this.start().catch(() => {});
      throw error;
    }
  }

  async disableSharing() {
    if (!this.config) throw new Error('请先登录主账号并打开本机数据');
    if (this.config.shareEnabled === false) return this.info();
    const previous = this.config;
    await this.stop();
    this.config = { ...previous, shareEnabled: false };
    this.host = '127.0.0.1';
    try {
      await this.start();
      await this.writeJson(this.configPath, this.config);
      return this.info();
    } catch (error) {
      await this.stop().catch(() => {});
      this.config = previous;
      this.host = this.publicHost;
      await this.start().catch(() => {});
      throw error;
    }
  }

  async initialize({ ownerId, cloudBaseUrl, data, aiState = { conversations: [], memories: [], tasks: [] }, sourceVersion }) {
    if (!ownerId || !/^https:\/\//u.test(cloudBaseUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(cloudBaseUrl)) throw new Error('共享前请使用可信账号服务器的主账号登录');
    const current = await this.readConfig();
    if (current && String(current.ownerId) !== String(ownerId)) throw new Error('此电脑已绑定其他主账号，不能覆盖原数据');
    const existingWorkspace = current ? await this.readWorkspace() : null;
    const hasRecords = existingWorkspace && Object.values(existingWorkspace.data || {}).some(value => Array.isArray(value) && value.length);
    const existingAi = current ? await this.aiState.read() : { conversations: [], memories: [], tasks: [] };
    if (hasRecords || ['conversations', 'memories', 'tasks'].some(key => existingAi[key]?.length))
      throw new Error('本机已有业务数据，不能用旧云端数据覆盖；请先核对两份数据');
    if (!current || existingWorkspace) {
      const references = [...referencedFiles(data)];
      for (const file of references) {
        const source = path.isAbsolute(file) ? file : path.resolve(this.userDataPath, 'data', file);
        let stat;
        try { stat = await fs.lstat(source); }
        catch (error) { if (error.code === 'ENOENT') throw new Error('迁移所需的业务附件未在这台主电脑上找到，请先把原电脑文件带到主电脑，云端原件尚未清除'); throw error; }
        if (!stat.isFile()) throw new Error('迁移附件不是普通文件，云端原件尚未清除');
        if (!path.isAbsolute(file)) await assertLocalDataPath(path.join(this.userDataPath, 'data'), source);
      }
      const existing = await fs.access(this.dataPath).then(() => true, () => false);
      if (existing && !current) throw new Error('检测到尚未绑定的共享数据，请先检查原文件');
      const backupDirectory = path.join(this.directory, `migration-files-${Date.now()}`);
      const activeDirectory = path.join(this.userDataPath, 'data', 'migrated-files');
      await fs.mkdir(backupDirectory, { recursive: true });
      await fs.mkdir(activeDirectory, { recursive: true });
      const files = [];
      const replacements = new Map();
      for (const originalPath of references) {
        const source = path.isAbsolute(originalPath) ? originalPath : path.resolve(this.userDataPath, 'data', originalPath);
        const filename = `${randomUUID()}${path.extname(originalPath).slice(0, 16)}`;
        const activePath = path.join(activeDirectory, filename);
        const backupPath = path.join(backupDirectory, filename);
        const before = await hashFile(source);
        await fs.copyFile(source, activePath);
        await fs.copyFile(source, backupPath);
        if (await hashFile(source) !== before || await hashFile(activePath) !== before || await hashFile(backupPath) !== before)
          throw new Error('迁移附件校验失败，云端原件尚未清除');
        files.push({ originalPath, activePath, backupPath, sha256: before });
        replacements.set(originalPath, activePath);
      }
      await this.writeJson(path.join(this.directory, `migration-backup-${Date.now()}.json`), {
        sourceVersion, data: structuredClone(data), aiState: structuredClone(aiState), createdAt: new Date().toISOString(),
      });
      await this.writeJson(this.migrationManifestPath, { sourceVersion, files });
      await this.writeJson(this.dataPath, { version: 1, data: { ...createEmptyDatabase(), ...replaceFileReferences(data, replacements) },
        sourceVersion, importedAt: new Date().toISOString() });
      await this.aiState.importLegacy(aiState);
      await this.writeJson(this.configPath, { ownerId, cloudBaseUrl, shareEnabled: current?.shareEnabled ?? true, createdAt: current?.createdAt || new Date().toISOString() });
    }
    this.config = current || await this.readConfig();
    this.host = this.config.shareEnabled === false ? '127.0.0.1' : this.publicHost;
    await this.start();
    return this.info();
  }

  async verifyMigration({ data, aiState, version }) {
    const local = await this.readWorkspace();
    if (Number(local.sourceVersion) !== Number(version)) throw new Error('云端数据版本已变化，请重新迁移');
    const manifest = JSON.parse(await fs.readFile(this.migrationManifestPath, 'utf8'));
    if (Number(manifest.sourceVersion) !== Number(version)) throw new Error('附件迁移版本不一致，云端原件尚未清除');
    const expectedReferences = referencedFiles(data);
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (files.length !== expectedReferences.size || files.some(item => !expectedReferences.has(item.originalPath)))
      throw new Error('附件迁移清单不完整，云端原件尚未清除');
    const replacements = new Map();
    for (const item of files) {
      await assertLocalDataPath(path.join(this.userDataPath, 'data'), item.activePath);
      if (await hashFile(item.activePath) !== item.sha256 || await hashFile(item.backupPath) !== item.sha256)
        throw new Error('附件迁移校验失败，云端原件尚未清除');
      replacements.set(item.originalPath, item.activePath);
    }
    const remapped = replaceFileReferences(data, replacements);
    for (const [key, value] of Object.entries(data || {})) {
      if (!isDeepStrictEqual(local.data[key], remapped[key])) throw new Error(`主电脑数据核对失败：${key}`);
    }
    const imported = await this.aiState.read();
    const expected = normalizeImportedState(aiState);
    for (const key of ['conversations', 'memories', 'tasks'])
      if (!isDeepStrictEqual(expected[key], imported[key])) throw new Error(`主电脑 AI 历史核对失败：${key}`);
    return { ok: true };
  }

  async startIfConfigured() {
    if (await fs.access(path.join(this.directory, 'relocated-to.json')).then(() => true, () => false)) throw new Error('此工作区已搬迁，请从新位置打开');
    this.config = await this.readConfig();
    if (this.config) { this.host = this.config.shareEnabled === false ? '127.0.0.1' : this.publicHost; await this.start(); }
    return this.info();
  }

  async start() {
    if (this.server?.listening) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => { void this.handle(req, res); });
      server.requestTimeout = 120000;
      server.once('error', error => {
        if (error?.code === 'EADDRINUSE') reject(new Error(`主电脑的 ${this.port} 端口已被占用，请关闭占用程序后重试`));
        else reject(error);
      });
      server.listen(this.config?.shareEnabled === false ? 0 : this.port, this.host, () => { this.server = server; resolve(); });
    }).finally(() => { this.startPromise = null; });
    await this.startPromise;
    if (this.discovery && this.host === '0.0.0.0' && !this.discoveryResponder) {
      try { this.discoveryResponder = await startLanDiscoveryResponder({ httpPort: this.server.address().port }); }
      catch (error) { console.warn('[LAN discovery]', error.message); }
    }
  }

  info() {
    const ips = localAddresses();
    const port = this.server?.address()?.port || this.port;
    const enabled = Boolean(this.server?.listening && this.config?.shareEnabled !== false);
    return { enabled, localReady: Boolean(this.server?.listening), discoveryEnabled: Boolean(this.discoveryResponder), role: this.config ? enabled ? 'host' : 'local' : 'none', ips,
      url: enabled && ips.length ? `http://${ips[0]}:${port}` : null, port,
      ownerId: this.config?.ownerId || null };
  }

  async authorize(req) {
    const match = /^Bearer (\S+)$/u.exec(req.headers.authorization || '');
    if (!match) throw Object.assign(new Error('请先登录子账号'), { status: 401 });
    const key = createHash('sha256').update(match[1]).digest('hex');
    const saved = await this.readGrants();
    let grant = saved[key];
    if (!grant) {
      let response, entitlementResponse;
      try {
        [response, entitlementResponse] = await Promise.all(['/api/auth/profile', '/api/auth/entitlement'].map(route => this.fetchImpl(`${this.config.cloudBaseUrl}${route}`, {
          headers: { Authorization: `Bearer ${match[1]}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
        })));
      } catch { throw Object.assign(new Error('此账号首次连接主电脑需要服务器在线核验'), { status: 503 }); }
      if (!response.ok || !entitlementResponse.ok) throw Object.assign(new Error('账号验证失败，请重新联网登录'), { status: 401 });
      const [{ user }, entitlement] = await Promise.all([response.json(), entitlementResponse.json()]);
      grant = { user, entitlement, savedAt: new Date().toISOString() };
      await this.saveGrant(key, grant);
    }
    const { user, entitlement } = grant;
    if (!entitlement?.valid || entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() <= Date.now()) {
      throw Object.assign(new Error('账号授权已到期，请联网续权'), { status: 403 });
    }
    if (!user || user.mainAccountId !== this.config.ownerId || user.mustChangePassword || !user.isActive) {
      throw Object.assign(new Error('此账号没有访问主电脑共享数据的权限'), { status: 403 });
    }
    return user;
  }

  async readGrants() {
    return fs.readFile(this.grantsPath, 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return {};
      throw error;
    });
  }

  async cacheGrant(token, user, entitlement) {
    if (!token || !user || String(user.mainAccountId || user.id) !== String(this.config?.ownerId)) return;
    await this.saveGrant(createHash('sha256').update(token).digest('hex'), { user, entitlement: {
      valid: ['trial', 'licensed'].includes(entitlement?.type), expiresAt: entitlement?.expiresAt || null,
    }, savedAt: new Date().toISOString() });
  }

  async saveGrant(key, grant) {
    const write = this.grantWriteQueue.catch(() => {}).then(async () => {
      const saved = await this.readGrants();
      saved[key] = grant;
      await this.writeJson(this.grantsPath, saved);
    });
    this.grantWriteQueue = write;
    return write;
  }

  can(user, key, action) {
    if (ADMIN_ROLES.has(user.role)) return true;
    if (key === 'financeOpeningBalance' && action !== 'view') return false;
    if (key === 'financeCategories' && action !== 'view') return action === 'create' && (this.can(user, 'finances', 'update') || this.can(user, 'finances', 'create'));
    const moduleId = MODULES[key];
    const actions = user.permissions?.[moduleId] || [];
    return Boolean(moduleId && actions.includes('view') && actions.includes(action));
  }

  send(res, status, data) {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        this.send(res, 200, { status: 'ok', service: 'community-ai-backend', mode: 'lan-workspace' }); return;
      }
      if (!['/api/unit/workspace/data', '/api/unit/workspace/business', '/api/unit/workspace/events', '/api/lan/status', '/api/unit/workspace/files'].includes(url.pathname)
        && !url.pathname.startsWith('/api/unit/workspace/files/')
        && !url.pathname.startsWith('/api/unit/workspace/ai/')) {
        this.send(res, 404, { error: '接口不存在' }); return;
      }
      const user = await this.authorize(req);
      if (url.pathname === '/api/unit/workspace/files' && req.method === 'POST') {
        if (!this.can(user, 'documents', 'create')) throw Object.assign(new Error('没有归档文件的权限'), { status: 403 });
        const rawName = req.headers['x-file-name'];
        let name;
        try { name = path.basename(decodeURIComponent(String(rawName || ''))); }
        catch { throw Object.assign(new Error('文件名称不正确'), { status: 400 }); }
        if (!name || name === '.' || name === '..' || /[\\/\0\r\n]/u.test(name)) throw Object.assign(new Error('文件名称不正确'), { status: 400 });
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) throw Object.assign(new Error('文件不能超过 50 MB'), { status: 413 }); chunks.push(chunk); }
        if (!size) throw Object.assign(new Error('不能上传空文件'), { status: 400 });
        await fs.mkdir(this.filesDirectory, { recursive: true });
        const id = randomUUID();
        const target = path.join(this.filesDirectory, `${id}${path.extname(name).slice(0, 16)}`);
        const content = Buffer.concat(chunks);
        await fs.writeFile(target, content, { flag: 'wx', mode: 0o600 });
        this.send(res, 200, { id, path: target, name, sizeBytes: size,
          sha256: createHash('sha256').update(content).digest('hex') }); return;
      }
      if (url.pathname.startsWith('/api/unit/workspace/files/') && req.method === 'GET') {
        if (!this.can(user, 'documents', 'view')) throw Object.assign(new Error('没有查看档案的权限'), { status: 403 });
        const id = decodeURIComponent(url.pathname.slice('/api/unit/workspace/files/'.length));
        const snapshot = await this.readWorkspace();
        const record = (snapshot.data.documents || []).find(item => String(item.id) === id);
        if (!record) throw Object.assign(new Error('档案不存在'), { status: 404 });
        const reference = record.fileObjectRelativePath || record.file_path || record.path;
        const file = await assertLocalDataPath(path.join(this.userDataPath, 'data'), reference);
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_BODY_BYTES) throw Object.assign(new Error('档案文件不可读取'), { status: 400 });
        const type = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
        res.end(await fs.readFile(file)); return;
      }
      if (url.pathname.startsWith('/api/unit/workspace/ai/')) {
        let body = {};
        if (['POST', 'PUT'].includes(req.method)) {
          let length = 0; const chunks = [];
          for await (const chunk of req) { length += chunk.length; if (length > 1024 * 1024) throw Object.assign(new Error('AI 状态超出大小限制'), { status: 413 }); chunks.push(chunk); }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw Object.assign(new Error('AI 状态格式不正确'), { status: 400 }); }
        }
        this.send(res, 200, await this.aiState.handle(user, req.method, url.pathname, url.searchParams, body)); return;
      }
      if (url.pathname === '/api/lan/status' && req.method === 'GET') {
        this.send(res, 200, { ownerId: this.config.ownerId, mode: 'lan-workspace' }); return;
      }
      if (url.pathname === '/api/unit/workspace/events' && req.method === 'GET') {
        if (!ADMIN_ROLES.has(user.role) && !Object.values(user.permissions || {}).some(actions => actions.includes('view'))) throw Object.assign(new Error('没有查看共享数据的权限'), { status: 403 });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        const listener = change => res.write(`event: changed\ndata: ${JSON.stringify(change)}\n\n`);
        this.events.on('change', listener);
        req.on('close', () => this.events.off('change', listener));
        return;
      }

      if (url.pathname === '/api/unit/workspace/business' && req.method === 'POST') {
        let bytes = 0; const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('业务请求超出大小限制'), { status: 413 }); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!/^\/api\/v3\/(party|duty)\//.test(new URL(input?.path || '/', 'http://localhost').pathname)) throw Object.assign(new Error('不支持此共享业务接口'), { status: 400 });
        const { FoundationBusinessService } = require('./foundation-business-service');
        const { FoundationAuthService } = require('./foundation-auth-service');
        const auth = new FoundationAuthService({ authService: { getStatus: async () => ({ authenticated: true, account: user, entitlement: { type: 'licensed' } }) } });
        const store = {
          read: async () => structuredClone((await this.readWorkspace()).data),
          createBackup: async () => {
            const backup = path.join(this.directory, 'backups', `party-duty-${Date.now()}-${randomUUID()}.json`);
            await fs.mkdir(path.dirname(backup), { recursive: true });
            await this.writeJson(backup, (await this.readWorkspace()).data);
            return { ok: true };
          },
          update: mutator => {
            const operation = this.queue.catch(() => {}).then(async () => {
              const current = await this.readWorkspace(), draft = structuredClone(current.data);
              const result = await mutator(draft);
              const next = { ...current, data: draft, version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: user.id };
              await this.writeJson(this.dataPath, next);
              this.events.emit('change', { mainAccountId: this.config.ownerId, version: next.version, updatedAt: next.updatedAt });
              return { result, data: structuredClone(draft) };
            });
            this.queue = operation;
            return operation;
          },
        };
        const business = new FoundationBusinessService({ store, authorize: scope => auth.authorize(scope) });
        this.send(res, 200, await business.request(input)); return;
      }
      if (url.pathname === '/api/unit/workspace/data' && req.method === 'GET') {
        const snapshot = await this.readWorkspace();
        const data = {};
        for (const [key, value] of Object.entries(snapshot.data)) if (this.can(user, key, 'view')) data[key] = value;
        this.send(res, 200, { data, version: snapshot.version, updatedAt: snapshot.updatedAt || snapshot.importedAt }); return;
      }
      if (url.pathname === '/api/unit/workspace/data' && req.method === 'PUT') {
        let length = 0; const chunks = [];
        for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY_BYTES) throw Object.assign(new Error('共享数据超出大小限制'), { status: 413 }); chunks.push(chunk); }
        const patch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!patch.data || typeof patch.data !== 'object' || Array.isArray(patch.data)) throw Object.assign(new Error('共享数据格式不正确'), { status: 400 });
        const operation = this.queue.catch(() => {}).then(async () => {
          const current = await this.readWorkspace();
          if (Number(patch.version) !== current.version) throw Object.assign(new Error('主电脑数据已被其他成员修改，请刷新后重试'), { status: 409 });
          const data = structuredClone(current.data);
          for (const [key, value] of Object.entries(patch.data)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Object.assign(new Error('字段名不正确'), { status: 400 });
            if (isDeepStrictEqual(data[key], value)) continue;
            if (key === 'foundationDeletedRecords' && !ADMIN_ROLES.has(user.role)) {
              if (!Array.isArray(value) || !value.length || value.some(entry => entry?.domain !== '/finance-records'
                || !entry.record?.id || ![...(current.data.finances || []), ...(current.data.financeRecords || [])].some(record => String(record.id) === String(entry.record.id))
                || !this.can(user, 'finances', 'delete'))) {
                throw Object.assign(new Error('当前账号无权保存财务删除记录'), { status: 403 });
              }
              data.foundationDeletedRecords = [...(data.foundationDeletedRecords || []), ...structuredClone(value)];
              continue;
            }
            if (!ADMIN_ROLES.has(user.role)) {
              const moduleId = MODULES[key];
              const required = actionsFor(data[key], value);
              if (!moduleId || !this.can(user, key, 'view') || required.some(action => !this.can(user, key, action))) {
                throw Object.assign(new Error(`当前账号无权修改 ${key}`), { status: 403 });
              }
            }
            data[key] = structuredClone(value);
          }
          const previousFinance = new Map([...(current.data.finances || []), ...(current.data.financeRecords || [])].map(row => [String(row.id), row]));
          const categoryChanges = (data.financeRecords?.length ? data.financeRecords : data.finances || []).filter(row => ['ai', 'rules'].includes(row.categorySource) && previousFinance.has(String(row.id)) && previousFinance.get(String(row.id)).category !== row.category);
          if (categoryChanges.length && !ADMIN_ROLES.has(user.role)) (data.operationLogs ||= []).push({ id: randomUUID(), action: '智能整理收支科目', residentIds: categoryChanges.map(row => row.id), createdAt: new Date().toISOString(), source: 'foundation', accountId: user.id });
          const orderChanges = (data.financeRecords?.length ? data.financeRecords : data.finances || []).filter(row => previousFinance.has(String(row.id)) && (previousFinance.get(String(row.id)).transactionOrder !== row.transactionOrder || previousFinance.get(String(row.id)).orderConfirmed !== row.orderConfirmed));
          if (orderChanges.length && !ADMIN_ROLES.has(user.role)) (data.operationLogs ||= []).push({ id: randomUUID(), action: '审核财务同日交易顺序', residentIds: orderChanges.map(row => row.id), createdAt: new Date().toISOString(), source: 'foundation', accountId: user.id });
          const next = { ...current, version: current.version + 1, data, updatedAt: new Date().toISOString(), updatedBy: user.id };
          await this.writeJson(this.dataPath, next);
          const result = { mainAccountId: this.config.ownerId, version: next.version, updatedAt: next.updatedAt };
          this.events.emit('change', result);
          return result;
        });
        this.queue = operation;
        this.send(res, 200, await operation); return;
      }
      this.send(res, 405, { error: '请求方式不正确' });
    } catch (error) {
      this.send(res, error.status || 500, { error: error.status ? error.message : '主电脑共享服务暂时不可用' });
    }
  }

  async stop() {
    if (this.discoveryResponder) { const responder = this.discoveryResponder; this.discoveryResponder = null; await responder.close(); }
    if (!this.server) return;
    const server = this.server; this.server = null;
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { LanWorkspaceService, privateIpv4, localAddresses, actionsFor };
