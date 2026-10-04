'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {parseFinanceGrid,parseAmount}=require('../../src/main/finance-excel-parser');
const {review,integrityOf,duplicateMatch,categories}=require('../../src/shared/finance-import-review');
const {prepareFinanceImport,keyOf}=require('../../src/main/finance-import-integrity');
const {importFinanceBatch}=require('../../src/main/finance-imports');
const {recognizeFinanceWorkbook}=require('../../src/main/finance-ai-recognition');
const {transactionBalances}=require('../../src/main/finance-transaction-balances');
const {FinanceWorkbookService}=require('../../src/main/finance-workbook-service');
const XLSX=require('xlsx'), fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os');
const hash='b'.repeat(64);
function fixture(grid) {
 const sheet=parseFinanceGrid(grid,{sheetName:'1月',fileName:'财务2024.xlsx'});
 const preview={fileName:'财务2024.xlsx',fileHash:hash,grids:new Map([['1月',grid]]),sheets:new Map([['1月',sheet]]),categoryCatalog:categories};
 const workbook={getPreview(id){if(id!=='p')throw Error('预览已失效');return preview;}};
 const rows=sheet.rows.map(row=>({...structuredClone(row),key:keyOf(row),sourceFileHash:hash}));
 const input={previewId:'p',batchId:'batch',fileHash:hash,fileName:preview.fileName,sheets:['1月'],rows:structuredClone(rows),reviewRows:structuredClone(rows)};
 return {sheet,preview,workbook,rows,input,prepare(value=input,existing=[]){return prepareFinanceImport(workbook,value,existing,categories);}};
}
const header=['日期','摘要','收入','支出','余额'];
function fifteen() {let balance=74552625;return [header,...Array.from({length:15},(_,i)=>{const amount=i===3||i===4?120000:10000+i*100;balance-=amount;return ['2024-01-12',i===3||i===4?'付：监督委员会报酬':`付：办公用品${i}`, '', amount/100,balance/100];})];}
function save(input,database={}) {return importFinanceBatch(database,input,{now:()=>new Date('2026-10-04T00:00:00Z'),uuid:(()=>{let i=0;return ()=>`id-${++i}`;})()});}

test('all 15 physical transactions including equal 1200 rewards survive preview and atomic save',()=>{
 const f=fixture(fifteen()), checked=review(f.rows,[],new Set(['1月']));assert.equal(checked.totals.ready,15);assert.equal(checked.totals.pending,0);
 const prepared=f.prepare(),db={};const saved=save(prepared,db);assert.equal(saved.count,15);
 const rewards=db.finances.filter(row=>row.summary==='付：监督委员会报酬');assert.equal(rewards.length,2);assert.notEqual(rewards[0].sourceBalanceCents,rewards[1].sourceBalanceCents);
 const balances=transactionBalances(db.finances,{startDate:'2024-01-01',amountCents:74552625},{today:'2026-10-04'});assert.ok(balances.items.every(row=>row.balanceStatus==='matched'));
 assert.equal(saved.expenseCents,checked.totals.expenseCents);assert.equal(saved.sourceAudit.coverage[0].rows.length,16);
});
test('main process rejects missing source rows, stale preview, duplicate coordinates and unconfirmed changed amounts',()=>{
 const f=fixture(fifteen());
 for(const changed of [{rows:f.input.rows.slice(0,4)},{reviewRows:f.input.reviewRows.slice(0,4)},{previewId:'expired'},{reviewRows:[...f.input.reviewRows.slice(0,-1),f.input.reviewRows[0]]}]) assert.throws(()=>f.prepare({...f.input,...changed}));
 const modified=structuredClone(f.input);modified.reviewRows[0].amountCents++;assert.throws(()=>f.prepare(modified),/人工确认/u);modified.reviewRows[0].manualFields=['amountCents'];assert.equal(f.prepare(modified).rows[0].amountCents,f.rows[0].amountCents+1);
});
test('money states never silently drop malformed, blank or zero transactional rows; extra zero decimals and fullwidth are exact',()=>{
 const f=fixture([header,['2024-01-12','付：报酬','','1,200.000',1],['2024-01-12','付：报酬','','￥１，２００．００００',2],['2024-01-12','付：报酬','','1200.001',3],['2024-01-12','付：报酬','',0,4],['2024-01-12','付：报酬','','',5]]);
 assert.equal(f.rows.length,5);assert.deepEqual(f.rows.map(row=>row.amountCents),[120000,120000,null,0,null]);assert.equal(review(f.rows,[],new Set(['1月'])).totals.pending,3);assert.throws(()=>f.prepare(),/暂停/u);
 assert.equal(parseAmount('（￥１，２００．００）'),-120000);assert.equal(parseAmount('100.0001'),null);
});
test('exact file/sheet/row is already posted; cross-file similarities require explicit grouped decisions',()=>{
 const f=fixture(fifteen()), existing=f.rows.map((row,index)=>({...row,id:`old${index}`,sourceSheetName:row.sheetName}));
 const exact=review(f.rows,existing,new Set(['1月']));assert.equal(exact.totals.existing,15);assert.equal(exact.totals.ready,0);
 const input={...f.input,rows:[]};assert.equal(f.prepare(input,existing).sourceManifest.decisions.length,15);
 existing.forEach(row=>row.sourceFileHash='c'.repeat(64));assert.equal(review(f.rows,existing,new Set(['1月'])).totals.duplicates,15);assert.throws(()=>f.prepare(f.input,existing));
 input.reviewRows=f.rows.map(row=>({...row,duplicateDecision:'independent'}));input.rows=structuredClone(f.rows);assert.equal(f.prepare(input,existing).rows.length,15);
 input.reviewRows=f.rows.map(row=>({...row,duplicateDecision:'existing'}));input.rows=[];assert.equal(f.prepare(input,existing).rows.length,0);
 assert.equal(duplicateMatch(f.rows[0],[{...existing[1],sourceFileHash:hash,sourceRowNumber:999}]).kind,'none');
});
test('explicit totals reconcile full original range; mismatch blocks until explained, balance mismatch does not block',()=>{
 const f=fixture([header,['2024-01-12','收：捐款',100,'',888],['2024-01-12','付：水费','',30,858],['','本月合计',100,20,'']]);
 const totals=integrityOf([f.sheet],f.rows);assert.equal(totals.blocked,true);assert.throws(()=>f.prepare(),/合计/u);
 const explained=f.prepare({...f.input,totalAcknowledgements:{'1%E6%9C%88:4':'原表遗漏水费10元，已核对凭证'}});assert.equal(explained.rows.length,2);assert.equal(explained.sourceManifest.totals[0].reason,'原表遗漏水费10元，已核对凭证');
 const pending=fixture([header,['2024-01-12','付：水费','','不明',100]]);pending.input.reviewRows[0].excludedByUser=true;assert.throws(()=>pending.prepare());pending.input.reviewRows[0].excludeReason='原表说明文字，不是实际交易';pending.input.rows=[];assert.equal(pending.prepare().sourceManifest.decisions[0].status,'non-business');
});
test('repeated and multirow headers across different regions retain month/day and all transactions',()=>{
 const f=fixture([['日期','','摘要','收入','支出','余额'],['月','日','','','',''],[1,12,'付：报酬','',1200,5000],['日期','摘要','收入','支出','余额'],['2024-01-15','收：捐款',100,'',5100],['备注：归档']]);
 assert.equal(f.rows.length,2);assert.deepEqual(f.rows.map(row=>row.recordDate),['2024-01-12','2024-01-15']);assert.equal(integrityOf([f.sheet],f.rows).blocked,false);
});
test('merged dates and hidden rows remain complete when reading a real synthetic xlsx file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-integrity-'));try{
 const file=path.join(dir,'财务2024.xlsx'), book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(fifteen());
 sheet.A6={t:'s',v:''};sheet['!merges']=[{s:{r:4,c:0},e:{r:5,c:0}}];sheet['!rows']=Array.from({length:16},(_,i)=>({hidden:i===5}));XLSX.utils.book_append_sheet(book,sheet,'1月');XLSX.writeFile(book,file);
 const service=new FinanceWorkbookService({dialog:{showOpenDialog:async()=>({filePaths:[file]})}}), result=await service.select(categories);assert.equal(result.sheets[0].rows.length,15);assert.equal(result.sheets[0].rows[4].recordDate,'2024-01-12');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('AI returning only a later four-row region cannot erase the earlier transactions',async()=>{
 const grid=[...fifteen(),header,...fifteen().slice(1,5)], f=fixture(grid);
 const result=await recognizeFinanceWorkbook({workbookService:f.workbook,previewId:'p',sheetNames:['1月'],aiRouter:{chat:async({task,messages})=>({content:task.taskKind==='finance-header-recognition'?JSON.stringify({headerRowNumber:17,mapping:{date:0,summary:1,income:2,expense:3,balance:4}}):JSON.stringify(JSON.parse(messages[1].content).map(row=>({index:row.index,confident:false})))})}});
 assert.equal(result.sheets[0].rows.length,19);assert.ok(result.warnings.some(text=>text.includes('遗漏') || text.includes('改变')));
});
test('a forged partial manifest or unresolved manifest cannot write any transactions',()=>{
 const f=fixture(fifteen()),prepared=f.prepare(),db={};const bad=structuredClone(prepared);bad.rows=bad.rows.slice(0,4);assert.throws(()=>save(bad,db));assert.deepEqual(db,{});
 const unresolved=structuredClone(prepared);unresolved.sourceManifest.decisions[0].status='pending';assert.throws(()=>save(unresolved,db));assert.deepEqual(db,{});
});

test('removing transactions from both submission and decisions still fails original physical coverage',()=>{
 const f=fixture(fifteen()), prepared=f.prepare(), shortened=structuredClone(prepared),db={};
 shortened.rows=shortened.rows.slice(0,4);shortened.sourceManifest.decisions=shortened.sourceManifest.decisions.slice(0,4);shortened.sourceManifest.expectedRowKeys=shortened.sourceManifest.expectedRowKeys.slice(0,4);assert.throws(()=>save(shortened,db),/漏行/u);assert.deepEqual(db,{});
});
test('save rejects decisions referring to deleted already-posted records; retry uses unchanged batch only once',()=>{
 const f=fixture(fifteen()),posted=f.rows.map((row,index)=>({...row,id:`old-${index}`,sourceSheetName:row.sheetName}));
 const prepared=f.prepare({...f.input,rows:[]},posted),db={finances:posted.slice(1)};assert.throws(()=>save(prepared,db),/已变动/u);assert.equal(db.finances.length,14);
 const database={};save(f.prepare(),database);const retried=save(f.prepare(),database);assert.equal(retried.alreadyImported,true);assert.equal(database.finances.length,15);
});
test('import metadata and audit decisions survive workspace backup restoration',async t=>{
 const {JsonDatabaseStore}=require('../../src/main/database-store'),{FoundationBackupService}=require('../../src/main/foundation-backup-service');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-integrity-backup-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const f=fixture(fifteen()),db={};save(f.prepare(),db);const store=new JsonDatabaseStore({userDataPath:dir});await store.write(db);
 const service=new FoundationBackupService({store,authorize:async()=>{}}),backup=await service.create();await store.update(database=>{database.finances=[];database.financeRecords=[];database.financeImportBatches=[];return true;});
 await service.restore(backup.relativePath);const restored=await store.read();assert.equal(restored.finances.length,15);assert.deepEqual(restored.financeImportBatches[0].sourceAudit,db.financeImportBatches[0].sourceAudit);assert.deepEqual(restored.finances[4].sourceRaw,db.finances[4].sourceRaw);
});
test('import requests retain member create permission, and viewers cannot write',async()=>{
 const {FoundationAuthService}=require('../../src/main/foundation-auth-service');
 const auth=new FoundationAuthService({store:{},authService:{getStatus:async()=>({authenticated:true,entitlement:{type:'licensed'},account:{role:'member',permissions:{finance:['view']}}})}});
 await assert.rejects(auth.authorize({method:'POST',path:'/finance-imports'}),{code:'FORBIDDEN'});
 auth.authService.getStatus=async()=>({authenticated:true,entitlement:{type:'licensed'},account:{role:'member',permissions:{finance:['view','create']}}});
 await auth.authorize({method:'POST',path:'/finance-imports'});
});

test('subtotals and repeated page headers do not shorten the monthly totals coverage',()=>{
 const f=fixture([header,['2024-01-12','付：水费','',10,90],['','小计',0,10,''],header,['2024-01-13','付：水费','',20,70],['','小计',0,20,''],['','本月合计',0,30,'']]);
 const integrity=integrityOf([f.sheet],f.rows);assert.equal(f.rows.length,2);assert.equal(integrity.checks.length,3);assert.ok(integrity.checks.every(check=>check.matches));assert.equal(f.prepare().rows.length,2);
});
