'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LanWorkspaceService } = require('../../src/main/lan-workspace-service');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { FoundationBackupService } = require('../../src/main/foundation-backup-service');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');

test('共享主机原子处理党员和排班，权限、冲突、备份及日志均在主机校验', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'party-duty-lan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profiles = {
    edit: { id: 'editor', role: 'member', mainAccountId: 'owner', permissions: { party: ['view', 'create', 'update'], work: ['view', 'create', 'update'] }, isActive: true },
    read: { id: 'reader', role: 'member', mainAccountId: 'owner', permissions: { party: ['view'], work: ['view'] }, isActive: true },
    wrong: { id: 'wrong', role: 'member', mainAccountId: 'other', permissions: { party: ['view', 'update'] }, isActive: true },
  };
  const service = new LanWorkspaceService({ userDataPath: root, port: 0, host: '127.0.0.1', fetchImpl: async (url, options) => ({ ok: true, status: 200,
    json: async () => url.endsWith('/api/auth/entitlement') ? { valid: true, plan: 'permanent' } : { user: profiles[options.headers.Authorization.replace('Bearer ', '')] } }) });
  t.after(() => service.stop());
  await service.initialize({ ownerId: 'owner', cloudBaseUrl: 'https://account.example.com', sourceVersion: 1,
    data: { personnel: [{ id: 'person', name: '合成人员', id_card: 'SYNTHETIC', bankAccounts: [{ number: 'PRIVATE' }], customFields: { preserved: true } }],
      partyMembers: [{ id: 'member', name: '合成人员', id_card: 'SYNTHETIC', memberType: '本村党员', stage: '正式党员' }], dutyCadres: [{ id: 'staff', name: '合成值班员' }] } });
  async function request(token, route, method = 'GET', body = {}) {
    const response = await fetch(`http://127.0.0.1:${service.info().port}/api/unit/workspace/business`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/api/v3' + route, method, body }) });
    return { status: response.status, body: await response.json() };
  }
  let result = await request('edit', '/party/context/people');
  assert.equal(result.body.ok, true, JSON.stringify(result));
  assert.equal(result.body.data.items[0].bankAccounts, undefined);
  assert.equal(result.body.data.items[0].customFields, undefined);
  const member = (await request('edit', '/party/members')).body.data.items[0];
  const entry = { member, duesVersion: 0, months: [{ month: 1, amountCents: 1234 }] };
  result = await request('edit', '/party/dues/batch', 'PATCH', { year: 2026, entries: [entry] });
  assert.equal(result.body.ok, true, JSON.stringify(result));
  const snapshot = await service.readWorkspace();
  assert.equal(snapshot.data.partyDues[0].amountCents, 1234);
  assert.equal(snapshot.data.personnel[0].bankAccounts[0].number, 'PRIVATE');
  assert.equal(snapshot.data.personnel[0].customFields.preserved, true);
  assert.ok(snapshot.data.operationLogs.length);
  result = await request('edit', '/party/dues/batch', 'PATCH', { year: 2026, entries: [entry] });
  assert.equal(result.body.error.code, 'VERSION_CONFLICT');
  assert.deepEqual((await service.readWorkspace()).data, snapshot.data);
  result = await request('read', '/party/dues/batch', 'PATCH', { year: 2026, entries: [entry] });
  assert.equal(result.body.error.code, 'FORBIDDEN');
  assert.equal((await request('wrong', '/party/members')).status, 403);
  assert.equal((await request('edit', '/party/../people')).status, 400);
  const plans = (await request('edit', '/duty/plans')).body.data;
  result = await request('edit', '/duty/schedule', 'PATCH', { baseVersion: plans.revision, action: 'bulk', year: 2024, month: 2, rule: 'all', tasks: ['防汛'], names: ['合成值班员'] });
  assert.equal(result.body.ok, true, JSON.stringify(result));
  assert.equal(result.body.data.added, 29);
  assert.equal((await service.readWorkspace()).data.dutyRecords[0].days.length, 29);
  const backups = await fs.readdir(path.join(service.directory, 'backups'));
  assert.equal(backups.length, 1);
  const before = JSON.parse(await fs.readFile(path.join(service.directory, 'backups', backups[0]), 'utf8'));
  assert.equal((before.partyDues || []).length, 0);
  assert.equal(before.personnel[0].bankAccounts[0].number, 'PRIVATE');
});

test('工作区备份恢复保留新党员党费和排班结构以及原始扩展字段', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'party-duty-backup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new JsonDatabaseStore({ userDataPath: root });
  await store.write({ partyMembers: [{ id: 'member', name: '合成党员', stage: '正式党员', memberType: '流动党员', unknown: { keep: true } }], dutyCadres: [{ id: 'staff', name: '合成值班员' }] });
  const business = new FoundationBusinessService({ store, authorize: async () => {} });
  const req = (route, method = 'GET', body = {}) => business.request({ path: '/api/v3' + route, method, body });
  const member = (await req('/party/members')).data.items[0];
  assert.equal((await req('/party/dues/batch', 'PATCH', { year: 2026, entries: [{ member, duesVersion: 0, months: [{ month: 1, amountCents: 1234 }] }] })).ok, true);
  const plans = (await req('/duty/plans')).data;
  assert.equal((await req('/duty/schedule', 'PATCH', { action: 'bulk', baseVersion: plans.revision, year: 2026, month: 10, tasks: ['防汛'], names: ['合成值班员'] })).ok, true);
  const original = await store.read();
  const backup = new FoundationBackupService({ store, authorize: async () => {} });
  const saved = await backup.create();
  await store.update(draft => { draft.partyMembers = []; draft.partyDues = []; draft.dutyRecords = []; return true; });
  await backup.restore(saved.relativePath);
  const restored = await store.read();
  for (const key of ['partyMembers', 'partyDues', 'dutyRecords', 'dutyCadres']) assert.deepEqual(restored[key], original[key]);
});
