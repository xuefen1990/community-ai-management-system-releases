'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FoundationWorkspaceService } = require('../../src/main/foundation-workspace-service');
function fixture() {
  let db = { personnel: [{ id: 'one', name: '原姓名', bankAccounts: [] }], workItems: [] };
  let account = 'unit-admin'; const authorizations = [];
  const service = new FoundationWorkspaceService({ store: { read: async () => structuredClone(db), update: async change => {
    const draft = structuredClone(db), result = await change(draft); db = draft; return { data: structuredClone(db), result };
  } }, auth: { status: async () => ({ authenticated: true, account: { id: account }, entitlement: { type: 'licensed' } }), authorize: async request => authorizations.push(request) } });
  return { service, authorizations, get db() { return db; }, mutate(fn) { fn(db); }, switchAccount() { account = 'another-unit'; } };
}
test('parked account and work editors preserve concurrent resident changes and new records', async () => {
  const f = fixture(), first = await f.service.read(), second = await f.service.read();
  const edit = structuredClone(first.database); edit.personnel[0].bankAccounts.push({ id: 'bank', cardNumber: 'SYNTHETIC' });
  f.mutate(db => { db.personnel[0].name = '新版修改姓名'; db.personnel.push({ id: 'new', name: '另一居民' }); });
  await f.service.write({ before: first.database, after: edit, token: first.token });
  const work = structuredClone(second.database); work.workItems.push({ id: 'work', name: '合成工作' });
  await f.service.write({ before: second.database, after: work, token: second.token });
  assert.equal(f.db.personnel[0].name, '新版修改姓名'); assert.equal(f.db.personnel[0].bankAccounts.length, 1);
  assert.equal(f.db.personnel.length, 2); assert.equal(f.db.workItems.length, 1);
  assert(f.authorizations.some(item => item.method === 'POST' && item.path === '/duty/plans'));
});
test('conflicting edits reject atomically and retain the other page’s value', async () => {
  const f = fixture(), snapshot = await f.service.read(), edit = structuredClone(snapshot.database);
  edit.personnel[0].name = '旧表单的姓名'; edit.workItems.push({ id: 'must-not-save' });
  f.mutate(db => { db.personnel[0].name = '另一页面保存的姓名'; });
  await assert.rejects(f.service.write({ before: snapshot.database, after: edit, token: snapshot.token }), /已被其他页面修改/);
  assert.equal(f.db.personnel[0].name, '另一页面保存的姓名'); assert.equal(f.db.workItems.length, 0);
});
test('an old editor cannot save after account switch or forge its baseline', async () => {
  const f = fixture(), snapshot = await f.service.read(), edit = structuredClone(snapshot.database);
  edit.workItems.push({ id: 'work' }); f.switchAccount();
  await assert.rejects(f.service.write({ before: snapshot.database, after: edit, token: snapshot.token }), /账号已切换/);
  assert.equal(f.db.workItems.length, 0);
  const fresh = await f.service.read(); fresh.database.personnel[0].name = '伪造读入值';
  await assert.rejects(f.service.write({ before: fresh.database, after: edit, token: fresh.token }), /页面数据已失效/);
});
