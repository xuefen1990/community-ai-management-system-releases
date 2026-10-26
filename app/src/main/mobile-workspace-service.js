'use strict';

const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { loadMobileIdentity } = require('./mobile-tls-identity');
const { assertLocalDataPath } = require('./local-file-boundary');
const { calculateResourceAmount, summarizeResources, RESOURCE_CATEGORIES } = require('../renderer/js/modules/work-management-model');
const { calculateAccountBalance } = require('./finance-account-balance');
const { cents, dateOf, typeOf } = require('./finance-ledger-analysis');
const { domainRows } = require('./foundation-domains');
const { transactionBalances } = require('./finance-transaction-balances');
const { buildPersonnelView } = require('./foundation-data-model');
const { catalogOf } = require('./finance-category-service');
const mobileContract = require('./mobile-contract.generated.json');
const { MiniProgramChannel } = require('./mini-program-channel');

const PREFIX = '/api/mobile/v1';
const LIMIT = mobileContract.limits.attachmentBytes;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const privatePathKey = /^(?:path|filePath|file_path|fileObjectRelativePath|originalPath|sourcePath|attachmentPath|archivePath|wordPath|cachePath|tempPath|photoPath|avatarPath|photo|avatar|photos|attachments)$/i;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const text = (value, label, maximum = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) fail(400, `${label}不正确`);
  return value.trim();
};
function mainOwner(user, ownerId) { return mobileContract.mainRoles.includes(user?.role) && String(user.id) === String(ownerId); }
function permission(user, module, action, ownerId) {
  if (module === 'finance') return mainOwner(user, ownerId);
  return mainOwner(user, ownerId) || (user.permissions?.[module]?.includes('view') && user.permissions[module].includes(action));
}
async function body(req, max = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) fail(413, '请求超出大小限制'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  try { return JSON.parse((await body(req)).toString('utf8')); }
  catch (error) { if (error.status) throw error; fail(400, '请求格式不正确'); }
}

class MobileWorkspaceService {
  constructor(workspace, { port = 3002, miniProgramPort = port === 0 ? 0 : 3003 } = {}) {
    this.workspace = workspace; this.port = port;
    this.directory = path.join(workspace.directory, 'mobile');
    this.devicesPath = path.join(this.directory, 'devices.json');
    this.pairings = new Map(); this.deviceQueue = Promise.resolve(); this.server = null;
    this.miniProgram = new MiniProgramChannel(this, miniProgramPort);
  }
  async start() {
    if (this.server?.listening || this.workspace.config?.shareEnabled === false) return;
    this.identity = await loadMobileIdentity(this.directory);
    const server = https.createServer({ key: this.identity.privateKey, cert: this.identity.certificate, minVersion: 'TLSv1.2' }, (req, res) => { void this.handle(req, res); });
    server.requestTimeout = 120000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, this.workspace.host, resolve); });
    this.server = server;
    try { await this.miniProgram.start(); } catch (error) { await this.stop(); throw error; }
  }
  info() { return this.server?.listening ? { port: this.server.address().port, workspaceId: this.identity.workspaceId, fingerprint: this.identity.fingerprint } : null; }
  async stop() {
    await this.miniProgram.stop();
    const server = this.server; this.server = null; this.pairings.clear();
    if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  async pairing(address) {
    if (!this.info()) throw new Error('请先启用主电脑局域网共享');
    for (const [token, expiresAt] of this.pairings) if (expiresAt <= Date.now()) this.pairings.delete(token);
    if (this.pairings.size >= 20) this.pairings.delete(this.pairings.keys().next().value);
    const pairingToken = randomBytes(24).toString('hex'), expiresAt = Date.now() + 5 * 60000;
    this.pairings.set(pairingToken, expiresAt);
    const data = { protocol: 'village-mobile-pair-v1', ...this.info(), ownerId: this.workspace.config.ownerId,
      endpoint: `https://${address}:${this.info().port}`, cloudBaseUrl: this.workspace.config.cloudBaseUrl, accountMode: this.workspace.config.authMode || 'cloud', pairingToken, expiresAt,
      miniProgram: { ...this.miniProgram.info(), endpoint: `http://${address}:${this.miniProgram.info().port}` } };
    return { data, payload: JSON.stringify(data), expiresAt };
  }
  async devices() { return fs.readFile(this.devicesPath, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return {}; throw error; }); }
  serialDevice(callback) { const task = this.deviceQueue.catch(() => {}).then(callback); this.deviceQueue = task; return task; }
  capabilities(user) {
    const owner = this.workspace.config.ownerId;
    return { residents: Boolean(permission(user, 'personnel', 'view', owner)), work: Boolean(permission(user, 'work', 'view', owner)),
      workCreate: Boolean(permission(user, 'work', 'create', owner)), finance: mainOwner(user, owner) };
  }
  async account(req, paired = true) {
    const user = await this.workspace.authorize(req, { refreshAfterMs: 5 * 60000, maxOfflineAgeMs: 24 * 3600000 });
    if (paired) {
      const device = (await this.devices())[String(req.headers['x-device-id'] || '')];
      const digest = hash(String(req.headers['x-device-key'] || ''));
      if (!device || device.userId !== user.id || !/^[a-f0-9]{64}$/u.test(device.keyHash || '') || !timingSafeEqual(Buffer.from(digest), Buffer.from(device.keyHash))) fail(403, '手机未配对或已被解除绑定');
    }
    return user;
  }
  async snapshot(user) {
    const source = await this.workspace.readWorkspace(), access = this.capabilities(user), selected = {};
    const collections = [
      ...(access.residents ? ['personnel', 'households', 'specialPersonnelProfiles', 'specialCategories', 'village_groups'] : []),
      ...(access.work ? ['workItems', 'workProgressRecords', 'workResourceEntries', 'workAcceptances', 'workEvidence'] : []),
      ...(access.finance ? ['financeRecords', 'finances', 'financeCategories', 'financeOpeningBalance', 'resourceContracts', 'contractFeeLedgers', 'contractFeeBatches', 'contractFeeReceipts', 'contractFeeAdvances', 'contractFeeDistributionPlans', 'contractFeeDistributionBatches'] : []),
    ];
    for (const name of collections) selected[name] = source.data[name] ?? [];
    if (access.residents) {
      const households = (source.data.households || []).map(row => ({ ...row,
        householdNo: row.householdNo ?? row.household_no ?? row.household_id ?? row.number ?? row.id }));
      const byId = new Map(households.map(row => [String(row.id), row]));
      const view = buildPersonnelView({ ...source.data, households, personnel: (source.data.personnel || []).map(row => ({ ...row,
        villageGroupName: row.village_group ?? row.villageGroupName ?? row.groupName ?? row.group,
        householdNo: row.household_id ?? row.householdNo ?? row.household_no ?? row.householdNumber ?? byId.get(String(row.householdId))?.householdNo })) });
      const profiles = new Map();
      for (const profile of source.data.specialPersonnelProfiles || []) {
        const personId = String(profile.personnelId || profile.personId || profile.personnel_id || '');
        if (!profiles.has(personId)) profiles.set(personId, []);
        profiles.get(personId).push(profile.categoryId || profile.categoryName || profile.category || profile.type || '');
      }
      selected.personnel = view.people.map((person, index) => ({ ...(source.data.personnel || [])[index], ...person,
        villageGroupName: view.villageGroups.find(group => group.id === person.villageGroupId)?.name || (source.data.personnel || [])[index]?.group || '',
        householdNo: view.households.find(household => household.id === person.householdId)?.householdNo || (source.data.personnel || [])[index]?.householdNumber || '',
        mobileTags: [...new Set([...(person.tags || []), ...(profiles.get(String(person.id)) || [])].filter(Boolean))] }));
      selected.households = view.households;
    }
    if (access.finance) selected.financeCategories = Object.entries(catalogOf(source.data)).flatMap(([type, names]) => names.map(name => ({ id: `${type}:${name}`, type, name })));
    // Only resident/display configuration crosses into a member's phone.
    selected.settings = Object.fromEntries(Object.entries({ ...(source.data.settings || {}), ...(source.data.foundationSettings || {}) }).filter(([key]) => /^(?:villageName|village_name|region|personnel|resident|household|special|customFields|fieldConfig|basicSettings)/i.test(key)
      && !/finance|balance|password|token|key|secret/i.test(key)));
    const files = new Map();
    const sanitize = (value, key = '', parent = {}) => {
      if (Array.isArray(value)) return value.map(item => sanitize(item, key));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name, value)]));
      if (typeof value === 'string' && privatePathKey.test(key) && value && !/^https?:\/\//iu.test(value)) {
        const id = hash(`${this.identity.workspaceId}\0${value}`);
        files.set(id, { reference: value, id, name: path.basename(parent.name || parent.fileName || value), mimeType: parent.mimeType || '' });
        return `attachment:${id}`;
      }
      return value;
    };
    const data = sanitize(selected);
    let finance;
    const work = access.work ? { resourceTotals: Object.fromEntries((source.data.workItems || []).map(item => {
      const summary = summarizeResources(source.data.workResourceEntries || [], item.id);
      return [item.id, { total: summary.total, byCategory: Object.fromEntries(RESOURCE_CATEGORIES.map(category => [category, summary[category]])) }];
    })) } : undefined;
    if (access.finance) {
      const records = domainRows(source.data, '/finance-records') || [];
      try { finance = { balance: calculateAccountBalance(records, source.data.financeOpeningBalance || null),
        records: sanitize(transactionBalances(records, source.data.financeOpeningBalance || null).items.map(record => ({ ...record, amountCents: cents(record), recordDate: dateOf(record), recordType: typeOf(record) }))) };
      } catch (error) { finance = { balance: { status: 'needs-review', amountCents: null, reason: error.message }, records: sanitize(records) }; }
    }
    const payload = { schemaVersion: 1, workspaceId: this.identity.workspaceId, ownerId: this.workspace.config.ownerId,
      mobileBusinessVersion: mobileContract.businessVersion, mobileContractRevision: mobileContract.protocolRevision, mobileFeatures: mobileContract.features,
      account: { id: user.id, name: user.name, role: mainOwner(user, this.workspace.config.ownerId) ? 'main_account' : 'member', villageName: user.villageName || '' },
      capabilities: access, offlineUntil: user.mobileOfflineUntil || Date.now() + 24 * 3600000, version: source.version, syncedAt: new Date().toISOString(),
      data, ...(finance ? { finance } : {}), ...(work ? { work } : {}), attachments: [...files.values()].map(({ reference, ...record }) => record) };
    payload.etag = hash(JSON.stringify(canonical({ version: source.version, data, finance: finance || null, work: work || null, attachments: payload.attachments, account: payload.account, capabilities: access })));
    return { files, payload };
  }
  async append(user, input) {
    if (!this.capabilities(user).workCreate) fail(403, '没有新增工作投入的权限');
    const operationId = text(input.operationId, '上报标识', 80), workId = text(input.workId, '工作事项', 120);
    if (!/^[a-zA-Z0-9_-]{16,80}$/u.test(operationId)) fail(400, '上报标识不正确');
    const category = text(input.category, '投入类别'); if (!RESOURCE_CATEGORIES.includes(category)) fail(400, '投入类别不正确');
    const name = text(input.name, '投入名称'), usage = text(input.usage, '实际用途', 1000);
    const date = text(input.date, '投入日期', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail(400, '投入日期不正确');
    const numeric = {};
    for (const key of ['quantity', 'duration', 'unitPrice']) {
      const value = Number(input[key]); if (!Number.isFinite(value) || value <= 0 || value > 1e9) fail(400, '数量、时长和单价必须是有效正数'); numeric[key] = value;
    }
    const amount = calculateResourceAmount(numeric); if (!Number.isSafeInteger(Math.round(amount * 100))) fail(400, '投入金额超出范围');
    const attachments = input.attachments || [];
    if (!Array.isArray(attachments) || attachments.length > mobileContract.limits.attachmentsPerRecord) fail(400, '附件数量不正确');
    const content = { workId, category, name, usage, date, ...numeric, unit: String(input.unit || mobileContract.resourceUnits[category]).slice(0, 30), description: String(input.description || '').slice(0, 2000), attachments };
    const digest = hash(JSON.stringify(canonical(content))), key = hash(`${user.id}\0${operationId}`);
    const task = this.workspace.queue.catch(() => {}).then(async () => {
      const current = await this.workspace.readWorkspace();
      const saved = current.mobileOperations?.[key];
      if (saved) { if (saved.digest !== digest) fail(409, '同一上报标识的内容发生变化，请核对原稿'); return saved.result; }
      const work = (current.data.workItems || []).find(item => String(item.id) === workId);
      if (!work || work.deletedAt || work.deleted_at) fail(404, '原工作事项已删除，请保留原稿并联系主账号');
      if (['已归档', '已完成', 'archived', 'completed'].includes(work.status)) fail(409, '工作事项已完成或归档，无法新增投入');
      const registered = [];
      for (const attachment of attachments) {
        if (!/^[a-f0-9]{64}$/u.test(attachment?.id || '')) fail(400, '附件标识不正确');
        const directory = path.join(this.directory, 'uploads', hash(String(user.id)));
        const file = path.join(directory, attachment.id);
        const bytes = await fs.readFile(file).catch(() => fail(409, '现场照片尚未完整上传，请重试'));
        if (hash(bytes) !== attachment.id) fail(409, '现场照片校验失败，请重试');
        registered.push({ id: attachment.id, filePath: file, sha256: attachment.id, name: text(attachment.name, '照片名称'), mimeType: String(attachment.mimeType || 'image/jpeg'), sizeBytes: bytes.length });
      }
      const id = randomUUID(), now = new Date().toISOString();
      const entry = { id, ...content, operator: user.name || '', amount, attachments: registered, createdAt: now, updatedAt: now, source: input.mobilePlatform === 'wechat' ? 'wechat' : 'android', reportedBy: user.id,
        reportedByName: user.name || '', deviceId: input.deviceId || '', operationId };
      const result = { id, operationId, amount, workId, status: 'saved', savedAt: now, version: current.version + 1 };
      const next = { ...current, data: { ...current.data, workResourceEntries: [...(current.data.workResourceEntries || []), entry] },
        version: current.version + 1, updatedAt: now, updatedBy: user.id,
        mobileOperations: { ...(current.mobileOperations || {}), [key]: { digest, result } } };
      await this.workspace.writeJson(this.workspace.dataPath, next);
      this.workspace.events.emit('change', { mainAccountId: this.workspace.config.ownerId, version: next.version, updatedAt: now });
      return result;
    });
    this.workspace.queue = task; return task;
  }
  async handle(req, res) {
    try {
      const url = new URL(req.url, 'https://localhost'), route = url.pathname.slice(PREFIX.length);
      if (!url.pathname.startsWith(PREFIX + '/')) fail(404, '接口不存在');
      if (route.startsWith('/auth/')) {
        const input = req.method === 'GET' ? {} : await jsonBody(req);
        const result = await require('./standalone-mobile-auth').forwardStandaloneAuth(this, req, route.slice(5), input);
        this.workspace.send(res, 200, result); return;
      }
      if (route === '/status' && req.method === 'GET') { this.workspace.send(res, 200, { protocol: 'village-mobile-v1', ...this.info(), ownerId: this.workspace.config.ownerId }); return; }
      if (route === '/pair' && req.method === 'POST') {
        const input = await jsonBody(req), user = await this.workspace.authorize(req, { refreshAfterMs: 0, maxOfflineAgeMs: 0 });
        const result = await this.serialDevice(async () => {
          if ((this.pairings.get(input.pairingToken) || 0) <= Date.now()) fail(403, '配对码已失效，请在电脑端刷新');
          const deviceId = text(input.deviceId, '手机标识', 100); if (!/^[a-zA-Z0-9_-]{16,100}$/u.test(deviceId)) fail(400, '手机标识不正确');
          const secret = randomBytes(32).toString('hex'), devices = await this.devices();
          if (devices[deviceId] && devices[deviceId].userId !== user.id) fail(403, '这台手机的绑定账号不一致，请使用新的安装身份');
          devices[deviceId] = { userId: user.id, keyHash: hash(secret), pairedAt: new Date().toISOString() };
          await this.workspace.writeJson(this.devicesPath, devices); this.pairings.delete(input.pairingToken);
          return { deviceId, deviceKey: secret, ...(await this.snapshot(user)).payload };
        });
        this.workspace.send(res, 200, result); return;
      }
      const user = await this.account(req);
      if (route === '/snapshot' && req.method === 'GET') {
        const payload = (await this.snapshot(user)).payload;
        if (new URL(req.url, 'https://localhost').searchParams.get('known') === payload.etag) {
          const { data, finance, work, attachments, ...metadata } = payload;
          this.workspace.send(res, 200, { ...metadata, unchanged: true });
        } else this.workspace.send(res, 200, payload);
        return;
      }
      if (route === '/resources' && req.method === 'POST') { const input = await jsonBody(req); input.deviceId = req.headers['x-device-id']; input.mobilePlatform = req.mobilePlatform || 'android'; this.workspace.send(res, 200, await this.append(user, input)); return; }
      if (route.startsWith('/uploads/') && req.method === 'PUT') {
        if (!this.capabilities(user).workCreate) fail(403, '没有上报照片的权限');
        const id = route.slice('/uploads/'.length); if (!/^[a-f0-9]{64}$/u.test(id)) fail(400, '照片标识不正确');
        const bytes = await body(req, LIMIT); if (!bytes.length || hash(bytes) !== id) fail(400, '照片内容校验失败');
        const directory = path.join(this.directory, 'uploads', hash(String(user.id))); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = path.join(directory, `${id}.${randomUUID()}.tmp`); await fs.writeFile(temporary, bytes, { mode: 0o600 }); await fs.rename(temporary, path.join(directory, id));
        this.workspace.send(res, 200, { id, sha256: id, sizeBytes: bytes.length }); return;
      }
      if (route.startsWith('/attachments/') && req.method === 'GET') {
        const id = route.slice('/attachments/'.length), file = (await this.snapshot(user)).files.get(id);
        if (!file) fail(403, '没有查看该附件的权限');
        const absolute = path.isAbsolute(file.reference) ? file.reference : path.join(this.workspace.userDataPath, 'data', file.reference);
        const uploads = path.join(this.directory, 'uploads');
        const base = absolute.startsWith(uploads + path.sep) ? uploads : path.join(this.workspace.userDataPath, 'data');
        const resolved = await assertLocalDataPath(base, absolute);
        const stat = await fs.stat(resolved); if (!stat.isFile() || stat.size > LIMIT) fail(413, '附件过大或尚不可读取');
        const bytes = await fs.readFile(resolved);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'X-Content-Sha256': hash(bytes), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); return;
      }
      fail(404, '接口不存在');
    } catch (error) { this.workspace.send(res, error.status || 500, { error: error.status ? error.message : '手机同步暂不可用，请检查主电脑' }); }
  }
}
module.exports = { MobileWorkspaceService, mainOwner, permission, canonical };
