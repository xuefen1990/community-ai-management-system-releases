'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const { createHash, X509Certificate, randomUUID } = require('node:crypto');
const { LanWorkspaceService } = require('../../src/main/lan-workspace-service');
const { loadMobileIdentity } = require('../../src/main/mobile-tls-identity');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = { id: 'owner', mainAccountId: 'owner', role: 'main_account', name: '测试主账号', isActive: true };
const member = { id: 'member', mainAccountId: 'owner', role: 'member', name: '测试工作人员', isActive: true, permissions: { personnel: ['view'], work: ['view', 'create'], finance: ['view', 'create', 'update', 'delete'] } };
const entry = (overrides = {}) => ({ operationId: randomUUID(), workId: 'work-1', category: '人员', name: '杂工', usage: '清理现场', date: '2026-10-11', quantity: 3, duration: 2, unitPrice: 80.15, attachments: [], ...overrides });

async function fixture(t, data = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'village-mobile-test-'));
  const profiles = { owner, member, foreign: { ...owner, id: 'foreign', mainAccountId: 'foreign' } };
  let online = true;
  const fetchImpl = async (url, options) => {
    if (!online) throw new Error('offline');
    const token = options.headers.Authorization.slice(7), profile = profiles[token];
    const status = profile ? 200 : 401;
    return { ok: status === 200, status, json: async () => url.endsWith('/entitlement') ? { valid: true, plan: 'permanent' } : { user: profile } };
  };
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1', discovery: false, fetchImpl });
  await service.initialize({ ownerId: 'owner', cloudBaseUrl: 'https://xuefeng0901.cn', data: {
    personnel: [{ id: 'person-1', name: '测试居民', customFields: { 专项信息: { test: true } } }], households: [],
    workItems: [{ id: 'work-1', name: '测试工程', status: '进行中' }], workResourceEntries: [],
    financeRecords: [{ id: 'f-1', recordType: 'expense', recordDate: '2026-10-11', summary: '财务保密测试', amountCents: 12000 }],
    financeOpeningBalance: { startDate: '2026-10-01', amountCents: 50000 }, financeCategories: [{ id: 'expense:测试', type: 'expense', name: '测试' }],
    settings: { villageName: '合成测试村', financeSecret: 'SHOULD_NEVER_REACH_MEMBER' }, ...data,
  } });
  t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, service, profiles, fetchImpl, setOnline: value => { online = value; } };
}
function request(service, pathname, { token = 'member', pairing, method = 'GET', body, fingerprint = service.mobile.identity.fingerprint, legacy = false } = {}) {
  const data = body == null ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const options = { hostname: '127.0.0.1', port: legacy ? service.info().port : service.mobile.info().port,
    path: legacy ? pathname : '/api/mobile/v1' + pathname, method,
    headers: { Authorization: `Bearer ${token}`, ...(pairing ? { 'X-Device-Id': pairing.deviceId, 'X-Device-Key': pairing.deviceKey } : {}), ...(data ? { 'Content-Length': data.length } : {}) },
    agent: false, ...(legacy ? {} : { ca: service.mobile.identity.certificate, checkServerIdentity: (_host, cert) => sha(cert.raw) === fingerprint ? undefined : new Error('wrong certificate') }) };
  return new Promise((resolve, reject) => {
    const req = (legacy ? http : https).request(options, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, bytes, json: () => JSON.parse(bytes.toString()) }); });
    }); req.on('error', reject); req.end(data);
  });
}
async function pair(service, token = 'member', deviceId = randomUUID()) {
  const code = await service.mobilePairing('127.0.0.1');
  const response = await request(service, '/pair', { token, method: 'POST', body: { pairingToken: code.data.pairingToken, deviceId } });
  assert.equal(response.status, 200, response.bytes.toString()); return response.json();
}

test('电脑证书和工作区身份持久化；另一台电脑与同主账号也有不同身份', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-cert-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await loadMobileIdentity(path.join(root, 'first'));
  assert(new X509Certificate(first.certificate).verify(new X509Certificate(first.certificate).publicKey));
  assert.deepEqual(await loadMobileIdentity(path.join(root, 'first')), first);
  const second = await loadMobileIdentity(path.join(root, 'second'));
  assert.notEqual(first.workspaceId, second.workspaceId); assert.notEqual(first.fingerprint, second.fingerprint);
});

test('配对码一次性、五分钟有效，强制在线验证账号归属，错误证书拒绝连接', async t => {
  const { service, setOnline } = await fixture(t);
  const code = await service.mobilePairing('127.0.0.1'), body = { pairingToken: code.data.pairingToken, deviceId: randomUUID() };
  assert(code.expiresAt > Date.now() && code.expiresAt <= Date.now() + 5 * 60000);
  assert.equal((await request(service, '/pair', { token: 'foreign', method: 'POST', body })).status, 403);
  assert.equal((await request(service, '/pair', { method: 'POST', body })).status, 200);
  assert.equal((await request(service, '/pair', { method: 'POST', body })).status, 403);
  const expired = await service.mobilePairing('127.0.0.1'); service.mobile.pairings.set(expired.data.pairingToken, Date.now() - 1);
  assert.equal((await request(service, '/pair', { method: 'POST', body: { ...body, pairingToken: expired.data.pairingToken } })).status, 403);
  setOnline(false);
  assert.equal((await request(service, '/pair', { method: 'POST', body })).status, 503);
  await assert.rejects(request(service, '/status', { fingerprint: '0'.repeat(64) }), /wrong certificate/);
});

test('子账号含历史财务授权也拿不到余额、明细、科目或附件，旧协议不能绕过', async t => {
  const { service } = await fixture(t);
  const paired = await pair(service);
  const response = (await request(service, '/snapshot', { pairing: paired })).json();
  assert.equal(response.capabilities.finance, false); assert.equal(response.finance, undefined);
  assert.equal(response.data.financeRecords, undefined); assert.equal(response.data.financeOpeningBalance, undefined);
  assert.equal(response.data.financeCategories, undefined); assert(!JSON.stringify(response).includes('财务保密测试'));
  assert(!JSON.stringify(response).includes('SHOULD_NEVER_REACH_MEMBER'));
  const legacy = (await request(service, '/api/unit/workspace/data', { legacy: true })).json();
  assert.equal(legacy.data.financeRecords, undefined);
  assert.equal((await request(service, '/api/unit/workspace/data', { legacy: true, method: 'PUT', body: { version: legacy.version, data: { financeRecords: [] } } })).status, 403);
  const main = await pair(service, 'owner');
  assert.equal(main.capabilities.finance, true); assert.equal(main.finance.balance.amountCents, 38000);
  assert.equal((await request(service, '/snapshot', { token: 'member', pairing: main })).status, 403);
});

test('快照未变化时只刷新授权和同步时间；数据或权限变化必须重新下发', async t => {
  const { service, profiles } = await fixture(t);
  const paired = await pair(service);
  const same = (await request(service, '/snapshot?known=' + paired.etag, { pairing: paired })).json();
  assert.equal(same.unchanged, true); assert.equal(same.data, undefined); assert.equal(same.finance, undefined);
  assert.equal(same.etag, paired.etag); assert(same.offlineUntil > Date.now());
  const current = await service.readWorkspace(); current.version++; current.data.personnel[0].phone = '13900000000'; await service.writeJson(service.dataPath, current);
  const changed = (await request(service, '/snapshot?known=' + paired.etag, { pairing: paired })).json();
  assert.equal(changed.unchanged, undefined); assert.equal(changed.data.personnel[0].phone, '13900000000'); assert.notEqual(changed.etag, paired.etag);
  profiles.member = { ...member, permissions: { work: ['view'] } };
  const grants = await service.readGrants(); for (const grant of Object.values(grants)) grant.savedAt = new Date(Date.now() - 6 * 60000).toISOString(); await service.writeJson(service.grantsPath, grants);
  const revoked = (await request(service, '/snapshot?known=' + changed.etag, { pairing: paired })).json();
  assert.equal(revoked.unchanged, undefined); assert.equal(revoked.capabilities.residents, false); assert.equal(revoked.data.personnel, undefined);
});

test('现场投入按电脑金额公式保存，并发追加与响应丢失重试不重复；重启后结果仍一致', async t => {
  const { service, root, fetchImpl } = await fixture(t);
  const paired = await pair(service), input = entry();
  const results = await Promise.all(Array.from({ length: 5 }, () => request(service, '/resources', { method: 'POST', pairing: paired, body: input })));
  assert(results.every(result => result.status === 200));
  const result = results[0].json(); assert.equal(result.amount, 480.9); assert(results.every(value => value.json().id === result.id));
  const distinct = await Promise.all(Array.from({ length: 5 }, () => request(service, '/resources', { method: 'POST', pairing: paired, body: entry() })));
  assert(distinct.every(value => value.status === 200)); assert.equal((await service.readWorkspace()).data.workResourceEntries.length, 6);
  assert.equal((await request(service, '/resources', { method: 'POST', pairing: paired, body: { ...input, quantity: 4 } })).status, 409);
  const before = service.mobile.info(); await service.stop();
  const restarted = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1', discovery: false, fetchImpl }); t.after(() => restarted.stop());
  await restarted.startIfConfigured(); assert.equal(restarted.mobile.info().workspaceId, before.workspaceId);
  assert.deepEqual((await request(restarted, '/resources', { method: 'POST', pairing: paired, body: input })).json(), result);
  assert.equal((await restarted.readWorkspace()).data.workResourceEntries.length, 6);
});

test('删除、归档、无权限、无效日期或金额均保留原稿且拒绝新增', async t => {
  const { service, profiles } = await fixture(t);
  const paired = await pair(service);
  for (const overrides of [{ quantity: 0 }, { unitPrice: -1 }, { date: '2026-02-30' }, { category: '未知' }, { workId: 'missing' }]) {
    assert([400, 404].includes((await request(service, '/resources', { method: 'POST', pairing: paired, body: entry(overrides) })).status));
  }
  const snapshot = await service.readWorkspace(); snapshot.data.workItems[0].status = '已归档'; await service.writeJson(service.dataPath, snapshot);
  assert.equal((await request(service, '/resources', { method: 'POST', pairing: paired, body: entry() })).status, 409);
  profiles.member = { ...member, permissions: { work: ['view'] } };
  const grants = await service.readGrants(); for (const grant of Object.values(grants)) grant.savedAt = new Date(Date.now() - 6 * 60000).toISOString(); await service.writeJson(service.grantsPath, grants);
  assert.equal((await request(service, '/resources', { method: 'POST', pairing: paired, body: entry() })).status, 403);
  assert.equal((await service.readWorkspace()).data.workResourceEntries.length, 0);
});

test('上传照片完整校验、账号隔离、快照隐藏电脑路径，附件仅授权账号可下载', async t => {
  const { service } = await fixture(t);
  const paired = await pair(service), main = await pair(service, 'owner'); const bytes = Buffer.from('synthetic photo bytes'), id = sha(bytes);
  assert.equal((await request(service, '/uploads/' + id, { method: 'PUT', pairing: paired, body: Buffer.from('broken') })).status, 400);
  assert.equal((await request(service, '/uploads/' + id, { method: 'PUT', pairing: paired, body: bytes })).status, 200);
  assert.equal((await request(service, '/resources', { token: 'owner', method: 'POST', pairing: main, body: entry({ attachments: [{ id, name: '测试现场.jpg' }] }) })).status, 409);
  assert.equal((await request(service, '/resources', { method: 'POST', pairing: paired, body: entry({ attachments: [{ id, name: '测试现场.jpg' }] }) })).status, 200);
  const snapshot = (await request(service, '/snapshot', { pairing: paired })).json();
  assert(!JSON.stringify(snapshot).includes(service.userDataPath)); assert.equal(snapshot.attachments[0].name, '测试现场.jpg');
  const downloaded = await request(service, '/attachments/' + snapshot.attachments[0].id, { pairing: paired }); assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.bytes, bytes); assert.equal(downloaded.headers['x-content-sha256'], id);
  assert.equal((await request(service, '/attachments/' + '0'.repeat(64), { pairing: paired })).status, 403);
  const current = await service.readWorkspace(); current.data.financeRecords[0].attachments = [{ filePath: current.data.workResourceEntries[0].attachments[0].filePath, name: '财务凭证.jpg' }]; current.data.workResourceEntries = []; await service.writeJson(service.dataPath, current);
  const financeSnapshot = (await request(service, '/snapshot', { token: 'owner', pairing: main })).json();
  assert.equal((await request(service, '/attachments/' + financeSnapshot.attachments[0].id, { pairing: paired })).status, 403);
  assert.equal((await request(service, '/attachments/' + financeSnapshot.attachments[0].id, { token: 'owner', pairing: main })).status, 200);
});

test('已配对离线核验最多24小时，云端明确撤销不沿用旧权限', async t => {
  const { service, setOnline, profiles } = await fixture(t); const paired = await pair(service);
  const grants = await service.readGrants(); for (const grant of Object.values(grants)) grant.savedAt = new Date(Date.now() - 6 * 60000).toISOString(); await service.writeJson(service.grantsPath, grants);
  setOnline(false); assert.equal((await request(service, '/snapshot', { pairing: paired })).status, 200);
  for (const grant of Object.values(grants)) grant.savedAt = new Date(Date.now() - 25 * 3600000).toISOString(); await service.writeJson(service.grantsPath, grants);
  assert.equal((await request(service, '/snapshot', { pairing: paired })).status, 503);
  setOnline(true); delete profiles.member;
  assert.equal((await request(service, '/snapshot', { pairing: paired })).status, 401);
});

test('历史居民字段、前导零户号、专项配置和无ID人员可正常查询且不改原库', async t => {
  const person = { name: '历史居民', id_card: '320000198001010000', birth_date: '1980-01-01', village_group: '西一组', household_id: '0000123', relation_to_head: '户主', custom_fields: { test: '原始资料' } };
  const { service } = await fixture(t, { personnel: [person], specialCategories: [{ id: 'custom', name: '自定义专项', fields: [{ key: 'test', label: '测试专项字段' }] }] });
  const paired = await pair(service); const row = paired.data.personnel[0];
  assert.equal(row.idCard, person.id_card); assert.equal(row.birthDate, person.birth_date); assert.equal(row.householdNo, '0000123'); assert.equal(row.villageGroupName, '西一组'); assert.equal(row.relationToHead, '户主');
  assert.equal(paired.data.households[0].householdNo, '0000123'); assert.equal(paired.data.specialCategories[0].name, '自定义专项');
  assert.deepEqual((await service.readWorkspace()).data.personnel, [person]);
});
