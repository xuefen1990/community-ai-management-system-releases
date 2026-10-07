'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { calculateAccountBalance } = require('../../src/main/finance-account-balance');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { FoundationAuthService } = require('../../src/main/foundation-auth-service');
const { FoundationBackupService } = require('../../src/main/foundation-backup-service');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const opening = { startDate: '2025-12-31', amountCents: 100000, version: 1 };
const record = (id, date, amountCents, recordType = 'income') => ({ id, recordDate: date, amountCents, recordType, category: recordType === 'income' ? '其他收入' : '其他支出', summary: '测试收支' });
const records = [record('pre', '2025-12-30', 999999), record('start', '2025-12-31', 10000), record('jan', '2026-01-10', 20000),
  record('feb', '2026-02-28', 30000, 'expense'), record('mar', '2026-03-01', 40000), record('future', '2027-01-01', 10000),
  record('bad-date', '2026-02-30', 100), record('bad-amount', '2026-02-02', NaN), record('bad-type', '2026-02-02', 100, 'invalid')];

test('balance accumulates across periods inclusively, excludes bad/future rows and carries forward on empty days', () => {
  const opts = { asOfDate: '2026-02-28', today: '2026-10-04' };
  const result = calculateAccountBalance(records, opening, opts);
  assert.equal(result.amountCents, 100000);
  assert.equal(result.incomeCents, 30000); assert.equal(result.expenseCents, 30000);
  assert.equal(result.excludedCount, 3);
  assert.equal(calculateAccountBalance(records, opening, { ...opts, asOfDate: '2026-03-15' }).amountCents, 140000);
  assert.equal(calculateAccountBalance(records, opening, { today: '2026-10-04' }).amountCents, 140000);
  const future = calculateAccountBalance(records, opening, { ...opts, asOfDate: '2027-12-31' });
  assert.equal(future.asOfDate, '2026-10-04'); assert.equal(future.amountCents, 140000);
  assert.equal(calculateAccountBalance([], opening, opts).amountCents, 100000);
  assert.equal(calculateAccountBalance([record('large', '2026-02-28', 200000, 'expense')], opening, opts).amountCents, -100000);
});

test('unset and before-opening balances are explicit; invalid dates and unsafe amounts fail', () => {
  assert.equal(calculateAccountBalance(records, null, { today: '2026-10-04' }).status, 'unset');
  assert.equal(calculateAccountBalance(records, opening, { asOfDate: '2025-12-01', today: '2026-10-04' }).status, 'before-opening');
  assert.throws(() => calculateAccountBalance([], opening, { asOfDate: '2026-02-30' }), { code: 'INVALID_INPUT' });
  assert.throws(() => calculateAccountBalance([], { ...opening, amountCents: 1.2 }), { code: 'INVALID_INPUT' });
});

function service(database) {
  let stored = structuredClone(database);
  const api = new FoundationBusinessService({ now: () => new Date(2026, 9, 4, 12), authorize: async () => {}, store: {
    read: async () => structuredClone(stored), update: async mutate => { const draft = structuredClone(stored); const result = await mutate(draft); stored = draft; return { result }; },
  } });
  return { api, data: () => stored };
}
const call = (api, url, method = 'GET', body) => api.request({ path: `/api/v3${url}`, method, body });

test('opening balance API saves atomically, checks versions, audits and recomputes after record changes', async () => {
  const f = service({ financeRecords: records.slice(0, 5) });
  assert.equal((await call(f.api, '/finance-account-balance')).data.status, 'unset');
  const saved = await call(f.api, '/finance-opening-balance', 'PATCH', { startDate: opening.startDate, amountCents: 100000, baseVersion: 0 });
  assert.equal(saved.ok, true); assert.equal(saved.data.openingBalance.version, 1);
  assert.equal(f.data().operationLogs[0].action, '设置财务期初余额');
  assert.equal(f.data().operationLogs[0].changes.current.amountCents, 100000);
  assert.equal((await call(f.api, '/finance-account-balance?asOfDate=2026-02-28')).data.amountCents, 100000);
  assert.equal((await call(f.api, '/finance-account-balance')).data.amountCents, 140000);
  assert.equal((await call(f.api, '/finance-opening-balance', 'PATCH', { ...opening, amountCents: 500, baseVersion: 0 })).ok, false);
  assert.equal(f.data().financeOpeningBalance.amountCents, 100000);
  const created = await call(f.api, '/finance-records', 'POST', { recordDate: '2026-10-04', amountCents: 1000, recordType: 'expense', category: '办公支出', summary: '文具' });
  assert.equal(created.ok, true);
  assert.equal((await call(f.api, '/finance-account-balance')).data.amountCents, 139000);
  const item = created.data.item;
  assert.equal((await call(f.api, `/finance-records/${item.id}`, 'PATCH', { baseVersion: item.version, changes: { amountCents: 2000 } })).ok, true);
  assert.equal((await call(f.api, '/finance-account-balance')).data.amountCents, 138000);
  const fresh = (await call(f.api, `/finance-records/${item.id}`)).data.item;
  assert.equal((await call(f.api, `/finance-records/${item.id}`, 'DELETE', { baseVersion: fresh.version })).ok, true);
  assert.equal((await call(f.api, '/finance-account-balance')).data.amountCents, 140000);
});

test('finance viewers can read balances but even finance editors cannot change opening balance', async () => {
  const status = { authenticated: true, entitlement: { type: 'licensed' }, account: { role: 'member', permissions: { finance: ['view', 'update'] } } };
  const auth = new FoundationAuthService({ authService: { getStatus: async () => status } });
  await auth.authorize({ method: 'GET', path: '/finance-account-balance' });
  await auth.authorize({ method: 'GET', path: '/finance-opening-balance' });
  await assert.rejects(auth.authorize({ method: 'PATCH', path: '/finance-opening-balance' }), { code: 'FORBIDDEN' });
  status.account.permissions = { workspace: ['view'] };
  await assert.rejects(auth.authorize({ method: 'GET', path: '/finance-account-balance' }), { code: 'FORBIDDEN' });
});

test('opening settings survive verified workspace backup and restoration', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-balance-backup-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new JsonDatabaseStore({ userDataPath: root });
  await store.write({ financeOpeningBalance: opening, financeRecords: records.slice(0, 5).map((row,index)=>({...row,sourceBalanceCents:1000+index,sourceBalanceText:'10.00',sourceOrder:index+1,transactionOrder:index+1,orderConfirmed:true})) });
  const backup = new FoundationBackupService({ store, authorize: async () => {} });
  const snapshot = await backup.create();
  await store.update(db => { db.financeOpeningBalance.amountCents = 0; return true; });
  await backup.restore(snapshot.relativePath);
  const db = await store.read();
  assert.deepEqual(db.financeOpeningBalance, opening);
  assert.equal(db.financeRecords[0].sourceBalanceCents,1000); assert.equal(db.financeRecords[0].sourceOrder,1); assert.equal(db.financeRecords[0].orderConfirmed,true);
  assert.equal(calculateAccountBalance(db.financeRecords, db.financeOpeningBalance, { today: '2026-10-04' }).amountCents, 140000);
});
