'use strict';
const test = require('node:test');
const manifested = require('../helpers/finance-import-manifest.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { catalogOf, previewCategories, canonicalCategory } = require('../../src/main/finance-category-service');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { FoundationAuthService } = require('../../src/main/foundation-auth-service');
const { domainRows } = require('../../src/main/foundation-domains');
const { parseFinanceGrid } = require('../../src/main/finance-excel-parser');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { FoundationBackupService } = require('../../src/main/foundation-backup-service');
const period = { startDate: '2026-01-01', endDate: '2026-10-31' };
const row = (id, summary, category = '其他支出', date = '2026-02-13') => ({ id, summary, category, recordDate: date, recordType: 'expense', amountCents: 10000 });
const database = () => ({ financeRecords: [row('1', '社区用水费'), row('2', '社区用水费'), row('3', '电费'), row('4', '报销'), row('5', '道路修缮', '维修维护'), row('6', '旧水费', '其他支出', '2025-01-01')] });
const model = { chat: async () => ({content:'[{"index":0,"confident":false,"reason":"未注明用途"}]'}) };
function fixture() {
  let db = database();
  const api = new FoundationBusinessService({ authorize: async () => {}, store: { read: async () => structuredClone(db), update: async mutate => { const draft = structuredClone(db); const result = await mutate(draft); db = draft; return { result }; } } });
  return { api, db: () => db };
}
const call = (api, endpoint, method = 'GET', body) => api.request({ path: `/api/v3${endpoint}`, method, body: method==='POST' && endpoint==='/finance-imports' ? manifested(body) : body });
test('AI groups repeated summaries, merges synonymous categories, preserves uncertainty and refines broad existing categories without writes', async () => {
  const db = database(), original = structuredClone(db), preview = await previewCategories(db, period, model);
  assert.deepEqual(db, original); assert.equal(preview.total, 5); assert.equal(preview.rows.length, 4);
  assert.deepEqual(preview.groups.map(g => [g.category, g.count, g.amountCents]), [['水费',2,20000],['电费',1,10000],['维修费',1,10000]]);
  assert.equal(preview.unresolved[0].id, '4'); assert.equal(preview.unresolved[0].reason, '未注明用途');
  assert.equal(canonicalCategory('自来水费', { expense:['用水费'] }, 'expense'), '用水费');
});
test('one confirmation persists categories, retains fields and preserves totals; record conflict aborts entire batch', async () => {
  const f = fixture(), preview = await previewCategories(f.db(), period, model);
  const original = domainRows(f.db(), '/finance-records');
  await call(f.api, '/finance-records/2', 'PATCH', { baseVersion: preview.rows.find(row=>row.id==='2').baseVersion, changes: { summary: '更正后的水费' } });
  const failed = await call(f.api, '/finance-reclassifications', 'PATCH', preview);
  assert.equal(failed.error.code, 'VERSION_CONFLICT'); assert.equal(f.db().financeRecords.find(r => r.id === '1').category, '其他支出');
  assert.equal(f.db().financeCategories, undefined);
  const fresh = await previewCategories(f.db(), period, model);
  const result = await call(f.api, '/finance-reclassifications', 'PATCH', fresh);
  assert.equal(result.ok, true); assert.equal(result.data.count, 4);
  const after = domainRows(f.db(), '/finance-records');
  for (const old of original) { const next = after.find(r => r.id === old.id); assert.equal(next.amountCents, old.amountCents); assert.equal(next.recordDate, old.recordDate); assert.equal(next.recordType, old.recordType); }
  assert.equal(after.find(r => r.id === '5').category, '维修费');
  assert.ok((await call(f.api, '/finance-categories')).data.categories.expense.includes('水费'));
  const report = (await call(f.api, `/finance-analysis?startDate=${period.startDate}&endDate=${period.endDate}`)).data;
  assert.equal(report.categories.find(g => g.category === '水费').count, 2); assert.equal(report.totals.expenseCents, 50000);
  assert.equal(f.db().operationLogs.at(-1).action, '智能整理收支科目');
});
test('AI failure or invalid/ambiguous suggestions never change data', async () => {
  const db = database();
  const failed = await previewCategories(db, period, {chat:async()=>{throw new Error('offline');}});
  assert.equal(failed.rows.length,4);assert.match(failed.warnings[0],/offline/);
  assert.match((await previewCategories(db, period, {chat:async()=>({content:'invalid'})})).warnings[0],/格式/);
  const result = await previewCategories(db, period, {chat:async()=>({content:'[{"index":0,"category":"<bad>","confident":true},{"index":1,"category":"电费","confident":true},{"index":1,"category":"水费","confident":true}]'})});
  assert.equal(result.rows.length, 4); assert.equal(result.unresolved.length, 1); assert.deepEqual(db, database());
});
test('specific catalog categories are reused by parsing and accepted during import', async () => {
  const f = fixture();
  const batch = { batchId:'batch', fileHash:'a'.repeat(64), fileName:'财务.xlsx', sheets:['1月'], rows:[{...row('x','电费','电费','2026-01-10'),sheetName:'1月',sourceRowNumber:2}] };
  assert.equal((await call(f.api, '/finance-imports', 'POST', batch)).ok, true);
  const catalog = catalogOf(f.db()); assert.ok(catalog.expense.includes('电费'));
  const parsed = parseFinanceGrid([['日期','摘要','支出','科目'],['2026-01-10','缴纳电费',100,'电费']], {categoryCatalog:catalog});
  assert.equal(parsed.rows[0].category, '电费'); assert.equal(parsed.rows[0].categorySource, 'rules');
});
test('finance editors may confirm categorization; viewers cannot write', async () => {
  const status = { authenticated:true, entitlement:{type:'licensed'}, account:{role:'member',permissions:{finance:['view','update']}} };
  const auth = new FoundationAuthService({authService:{getStatus:async()=>status}});
  await auth.authorize({method:'PATCH',path:'/finance-reclassifications'}); await auth.authorize({method:'GET',path:'/finance-categories'});
  status.account.permissions.finance=['view']; await assert.rejects(auth.authorize({method:'PATCH',path:'/finance-reclassifications'}), {code:'FORBIDDEN'});
});
test('workspace backup and restoration preserve category catalog', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'finance-categories-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store = new JsonDatabaseStore({userDataPath:root}), original = {financeCategories:[{id:'expense:水费',type:'expense',name:'水费'}],...database()}; await store.write(original);
  const backup = new FoundationBackupService({store,authorize:async()=>{}}), snapshot = await backup.create();
  await store.update(db=>{db.financeCategories=[];return true;}); await backup.restore(snapshot.relativePath);
  assert.deepEqual((await store.read()).financeCategories, original.financeCategories);
});

test('all directions and existing specific/manual categories are reviewed; batch keeps facts and rejects reversed type atomically',async()=>{
 let db={financeRecords:[{...row('income','公共运行经费','其他收入'),recordType:'income',categorySource:'manual'},row('water','水费','办公支出'),row('specific','电费','水费'),row('unchanged','水费','水费'),row('unknown','报销款','其他支出'),row('outside','电费','其他支出','2025-01-01')]};
 const original=structuredClone(db);
 const api=new FoundationBusinessService({authorize:async()=>{},store:{read:async()=>structuredClone(db),update:async mutate=>{const draft=structuredClone(db);const result=await mutate(draft);db=draft;return{result};}}});
 const preview=await previewCategories(db,period,model);
 assert.equal(preview.total,5);assert.equal(preview.rows.length,3);assert.equal(preview.before.income.percent,100);assert.equal(preview.after.income.percent,0);assert.equal(preview.after.expense.otherCount,1);
 const reversed=structuredClone(preview);reversed.rows.at(-1).recordType='income';
 assert.equal((await call(api,'/finance-reclassifications','PATCH',reversed)).error.code,'VERSION_CONFLICT');assert.deepEqual(db,original);
 assert.equal((await call(api,'/finance-reclassifications','PATCH',preview)).data.count,3);
 assert.equal(db.financeRecords[0].category,'公共运行经费收入');assert.equal(db.financeRecords[2].category,'电费');
 for(const [i,old]of original.financeRecords.entries())for(const key of ['recordType','recordDate','summary','amountCents'])assert.equal(db.financeRecords[i][key],old[key]);
});
