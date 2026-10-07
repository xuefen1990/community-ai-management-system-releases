'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseFinanceGrid,resolvesNonBusinessRow}=require('../../src/main/finance-excel-parser');
const {review,sourceBalances,categories}=require('../../src/shared/finance-import-review');
const {prepareFinanceImport,validateSourceManifest,keyOf}=require('../../src/main/finance-import-integrity');
const header=['序号','日期','收、支内容摘要','收入','支出','余额'];
function fixture(tail){const grid=[header,[1,'','期初余额','','',100],...tail],sheet=parseFinanceGrid(grid,{sheetName:'4月',fileName:'财务2024.xlsx'}),rows=sheet.rows.map(r=>({...r,key:keyOf(r)}));return {grid,sheet,rows,check:()=>review(rows,[],new Set(['4月']),categories,[sheet])};}
test('signature names and numbered template rows do not create transactions; paid leaders remain',()=>{
 const f=fixture([[2,16,'付：驻村领导报酬','',10,90],['驻村领导：张三','','','','',''],[3,'','','','',''],['制表人：李四','','','','','']]);
 assert.equal(f.rows.length,1);assert.equal(f.check().totals.ready,1);assert.equal(f.sheet.skipped.filter(r=>r.reason==='签字说明行').length,2);assert.equal(f.sheet.coverage.length,6);
 const previous={sourceRowNumber:4,raw:f.grid[3],recordDate:'',summary:'',amountCents:null};assert.equal(resolvesNonBusinessRow(previous,f.sheet,f.grid),true);
});
test('continuous original balances handle zero, negatives, equal payments and one-cent differences',()=>{
 const f=fixture([[2,16,'付：报酬','',50,50],[3,16,'付：报酬','',50,0],[4,16,'付：报酬','',10,-10],[5,16,'收：经费',10,'',0.01]]);
 const result=f.check();assert.equal(result.totals.ready,3);assert.equal(result.totals.balancePending,1);assert.equal(f.rows[3].sourceBalanceCheck.differenceCents,1);
 assert.equal(f.rows[2].sourceBalanceCheck.expectedCents,-1000);
});
test('missing balance stays pending; confirmation is invalidated by previous transaction changes',()=>{
 const f=fixture([[2,16,'付：水费','',10,''],[3,16,'付：电费','',20,70]]);assert.equal(f.check().totals.balancePending,1);
 f.rows[0].balanceConfirmation={reason:'核对凭证确认真实交易',fingerprint:f.rows[0].sourceBalanceCheck.fingerprint};assert.equal(f.check().totals.pending,0);
 f.rows[0].amountCents=1100;assert.equal(f.check().totals.balancePending,2);assert.equal(f.rows[0].balanceConfirmation,undefined);assert.equal(f.rows[1].sourceBalanceCheck.firstProblemRow,3);
 f.rows[0].amountCents=1000;f.rows[0].sourceBalanceCents=9000;assert.equal(f.check().totals.pending,0);
});
test('headers create separate contexts, and unknown opening requires confirmation only once',()=>{
 const f=fixture([[2,16,'付：水费','',10,90],header,[3,17,'付：电费','',20,70],[4,17,'付：电费','',10,60]]);
 assert.equal(f.check().totals.balancePending,1);assert.equal(f.rows[1].sourceBalanceCheck.status,'unanchored');assert.equal(f.rows[2].sourceBalanceCheck.status,'matched');
 f.rows[1].balanceConfirmation={reason:'原表第一个余额已核实',fingerprint:f.rows[1].sourceBalanceCheck.fingerprint};assert.equal(f.check().totals.pending,0);
});
test('unique arithmetic evidence can correct an ambiguous balance column without changing amounts',()=>{
 const grid=[['日期','摘要','收入','支出','余额','账户余额'],['','期初余额','','',999,100],[16,'付：水费','',10,999,90],[16,'付：电费','',20,999,70]];
 const sheet=parseFinanceGrid(grid,{sheetName:'4月',fileName:'财务2024.xlsx'});assert.equal(sheet.mapping.balance,5);assert.deepEqual(sheet.rows.map(r=>r.sourceBalanceCents),[9000,7000]);assert.deepEqual(sheet.rows.map(r=>r.amountCents),[1000,2000]);
});
test('manual order changes recalculate subsequent balances and preserve physical rows',()=>{
 const f=fixture([[2,16,'付：水费','',10,90],[3,16,'付：电费','',20,70]]);assert.equal(f.check().totals.pending,0);
 f.rows[1].manualFields=['sourceOrder'];f.rows[1].sourceOrder=2;assert.equal(f.check().totals.balancePending,2);assert.equal(f.rows.length,2);
});
test('host rechecks confirmations and rejects altered amounts after a valid preview',()=>{
 const f=fixture([[2,16,'付：水费','',10,'']]),hash='a'.repeat(64);f.check();f.rows[0].balanceConfirmation={reason:'核对原表和凭证，真实交易',fingerprint:f.rows[0].sourceBalanceCheck.fingerprint};
 const preview={fileHash:hash,fileName:'财务2024.xlsx',sheets:new Map([['4月',f.sheet]]),grids:new Map([['4月',f.grid]])},service={getPreview:()=>preview};
 const input={previewId:'p',fileHash:hash,fileName:preview.fileName,sheets:['4月'],reviewRows:f.rows,rows:f.rows};
 const saved=prepareFinanceImport(service,input,[],categories);assert.equal(saved.rows[0].sourceBalanceCheck.accepted,true);assert.equal(validateSourceManifest(saved).decisions[0].balanceConfirmation.reason,f.rows[0].balanceConfirmation.reason);
 const missingAudit=structuredClone(saved);missingAudit.sourceManifest.balanceRows=[];assert.throws(()=>validateSourceManifest(missingAudit),/漏行/u);
 const changed=structuredClone(saved);changed.rows[0].amountCents++;assert.throws(()=>validateSourceManifest(changed),/变化/u);
 const unconfirmed=structuredClone(input);delete unconfirmed.reviewRows[0].balanceConfirmation;assert.throws(()=>prepareFinanceImport(service,unconfirmed,[],categories),/暂停/u);
});
