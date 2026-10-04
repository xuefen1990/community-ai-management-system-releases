'use strict';
const test = require('node:test');
const manifested = require('../helpers/finance-import-manifest.cjs');
const assert = require('node:assert/strict');
const { transactionBalances } = require('../../src/main/finance-transaction-balances');
const { calculateAccountBalance } = require('../../src/main/finance-account-balance');
const { parseFinanceGrid } = require('../../src/main/finance-excel-parser');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { FoundationAuthService } = require('../../src/main/foundation-auth-service');
const opening = { startDate: '2025-12-01', amountCents: 10000, version: 1 };
const today = '2026-10-04';
const row = (id, date, amountCents, type = 'income', balance = null, order = 1) => ({ id, recordDate: date, amountCents, recordType: type, category: type === 'income' ? '其他收入' : '其他支出', summary: id, sourceBalanceCents: balance, importBatchId: 'b', sourceSheetName: '12月', sourceRowNumber: order });
const calculate = (rows, baseline = opening) => transactionBalances(rows, baseline, { today });
function fixture(database) {
  let stored = structuredClone(database), writes = 0;
  const service = new FoundationBusinessService({ now: () => new Date(2026,9,4,12), authorize: async () => {}, store: { read: async () => structuredClone(stored), update: async fn => { const draft = structuredClone(stored), result = await fn(draft); stored = draft; writes++; return { result }; } } });
  return { service, data: () => stored, writes: () => writes };
}
const call = (f, path, method = 'GET', body) => f.service.request({ path: `/api/v3${path}`, method, body: method==='POST' && path==='/finance-imports' ? manifested(body) : body });

test('balances use full chronological ledger, integer precision and negative amounts across years', () => {
  const rows = [row('feb','2026-02-28',30000,'expense',-7000,4), row('jan','2026-01-02',12000,'income',23000,3), row('pre','2025-11-30',9999), row('dec','2025-12-20',1000,'income',11000,2)];
  const result = calculate(rows); assert.deepEqual(result.items.map(r=>r.calculatedBalanceCents), [-7000,23000,null,11000]);
  assert.equal(result.items[0].balanceStatus,'matched'); assert.equal(result.items[2].balanceStatus,'unavailable');
  assert.equal(result.items[0].calculatedBalanceCents,calculateAccountBalance(rows,opening,{today}).amountCents);
  rows[0].sourceBalanceCents=-7001; assert.equal(calculate(rows).mismatchCount,1); assert.equal(calculate(rows).items[0].balanceDifferenceCents,1);
  rows[3].amountCents=1001; assert.equal(calculate(rows).mismatchCount,3);
});

test('same-day Excel transactions use original row order independently of display order', () => {
  const rows = [row('second','2026-01-01',2000,'expense',11000,3),row('first','2026-01-01',3000,'income',13000,2)];
  assert.deepEqual(calculate(rows).items.map(r=>r.calculatedBalanceCents),[11000,13000]);
  rows[0].sourceOrder=-3; rows[1].sourceOrder=-2;
  assert.deepEqual(calculate(rows).items.map(r=>r.calculatedBalanceCents),[8000,11000]);
});

test('missing baseline gives a candidate only; missing, malformed and future balances are not passed', () => {
  const rows=[row('first','2026-01-01',3000,'income',13000),row('unknown','2026-01-02',100,'expense'),row('bad','2026-01-03',100,'expense')]; rows[2].sourceBalanceText='不明';
  const result=calculate(rows,null); assert.equal(result.openingCandidate.amountCents,10000); assert.equal(result.items[0].calculatedBalanceCents,null); assert.equal(result.items[0].balanceStatus,'unavailable');
  const ready=calculate(rows); assert.equal(ready.items[1].balanceStatus,'no-source'); assert.equal(ready.items[2].balanceStatus,'invalid-source');
  assert.equal(calculate([row('future','2027-01-01',1000,'income',11000)]).items[0].balanceStatus,'unavailable');
  assert.equal(calculate([row('bad-date','2026-02-30',100)]).items[0].calculatedBalanceCents,null);
});

test('mixed sources on one day require manual ordering and do not produce a confident candidate', () => {
  const rows=[row('first','2026-01-01',3000,'income',13000),{...row('second','2026-01-01',2000,'expense',11000,2),importBatchId:'other'}];
  assert.equal(calculate(rows).pendingCount,2); assert.equal(calculate(rows,null).openingCandidate,null);
  for (const [i,r] of rows.entries()) {r.orderConfirmed=true;r.transactionOrder=i+1;}
  assert.equal(calculate(rows).pendingCount,0);
});

test('parser preserves zero/negative balance and excludes opening and totals; detects descending sheets', () => {
  const sheet=parseFinanceGrid([['日期','摘要','收入','支出','账户余额'],['1.1','期初余额','','',100],['1.3','购纸','',200,-100],['1.2','收款',100,'',100],['','合计',100,200,-100]],{sheetName:'1月',fileName:'财务2026.xlsx'});
  assert.equal(sheet.rows.length,2); assert.equal(sheet.rows[0].sourceBalanceCents,-10000); assert.equal(sheet.rows[0].sourceOrder,-3); assert.equal(sheet.skipped.find(row=>row.reason==='余额结转行').sourceBalanceCents,10000);
  assert.equal(parseFinanceGrid([['日期','摘要','支出','结存余额'],['1.1','购纸',10,0]],{sheetName:'1月',year:2026}).rows[0].sourceBalanceCents,0);
});

test('import permits mismatches, persists original values, and preview never writes database', async () => {
  const f=fixture({financeOpeningBalance:opening}); const input={batchId:'batch',fileHash:'a'.repeat(64),fileName:'财务.xlsx',sheets:['1月'],rows:[{...row('source','2026-01-01',3000,'income',12999,2),sheetName:'1月',sourceBalanceText:'129.99',sourceOrder:2}]};
  const preview=await call(f,'/finance-balance-preview','POST',{rows:input.rows}); assert.equal(preview.ok,true); assert.equal(preview.data.items[0].balanceStatus,'mismatch'); assert.equal(f.writes(),0);
  const imported=await call(f,'/finance-imports','POST',input); assert.equal(imported.ok,true); const review=(await call(f,'/finance-balance-review')).data; assert.equal(review.mismatchCount,1);
  assert.equal(f.data().financeRecords[0].sourceBalanceCents,12999); assert.equal(f.data().financeRecords[0].sourceOrder,2);
  const analysis=(await call(f,'/finance-analysis?startDate=2026-01-01&endDate=2026-01-31')).data; assert.equal(analysis.records[0].calculatedBalanceCents,13000);
  const item=review.items[0]; assert.equal((await call(f,`/finance-records/${item.id}`,'PATCH',{baseVersion:item.version,changes:{sourceBalanceCents:13000}})).ok,false);
});

test('order save validates every version before writing, audits and recomputes balances', async () => {
  const rows=[row('a','2026-01-01',3000,'income',13000),{...row('b','2026-01-01',2000,'expense',11000,2),importBatchId:'other'}], f=fixture({financeRecords:rows,financeOpeningBalance:opening});
  const review=(await call(f,'/finance-balance-review')).data;
  const request={recordDate:'2026-01-01',rows:review.items.map(r=>({id:r.id,baseVersion:r.version}))};
  const conflict=structuredClone(request); conflict.rows[1].baseVersion='wrong';
  assert.equal((await call(f,'/finance-transaction-order','PATCH',conflict)).ok,false); assert.equal(f.data().financeRecords[0].orderConfirmed,undefined);
  assert.equal((await call(f,'/finance-transaction-order','PATCH',request)).ok,true); assert.equal((await call(f,'/finance-balance-review')).data.pendingCount,0); assert.equal(f.data().operationLogs[0].action,'审核财务同日交易顺序');
  assert.equal((await call(f,'/finance-transaction-order','PATCH',request)).ok,false);
});

test('member balance review and order permissions reuse finance view/update without granting opening writes',async()=>{
  const status={authenticated:true,entitlement:{type:'licensed'},account:{role:'member',permissions:{finance:['view']}}};
  const auth=new FoundationAuthService({authService:{getStatus:async()=>status}});
  await auth.authorize({method:'GET',path:'/finance-balance-review'});
  await assert.rejects(auth.authorize({method:'PATCH',path:'/finance-transaction-order'}),{code:'FORBIDDEN'});
  status.account.permissions.finance.push('update'); await auth.authorize({method:'PATCH',path:'/finance-transaction-order'});
  await assert.rejects(auth.authorize({method:'PATCH',path:'/finance-opening-balance'}),{code:'FORBIDDEN'});
});


test('earlier ambiguous days do not prevent deriving a later source balance baseline; malformed amount stays excluded',()=>{
  const rows=[{...row('a','2026-01-01',1000),importBatchId:undefined},{...row('b','2026-01-01',500,'expense'),importBatchId:undefined},row('next','2026-01-02',100,'income',10600,3)];
  assert.equal(calculate(rows,null).openingCandidate.amountCents,10000);
  assert.equal(calculate([{...row('bad','2026-01-02',100),amountCents:'100',amount:10}]).items[0].calculatedBalanceCents,null);
});
