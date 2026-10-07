'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseFinanceGrid,resolvesNonBusinessRow}=require('../../src/main/finance-excel-parser');
const {review,integrityOf,categories}=require('../../src/shared/finance-import-review');
const {prepareFinanceImport,keyOf}=require('../../src/main/finance-import-integrity');
const header=['序号','日期','收、支内容摘要','收入','支出','余额'];
const parse=grid=>parseFinanceGrid(grid,{sheetName:'1月',fileName:'财务2026.xlsx'});

test('January screenshot: last-year balance anchors transactions but is never imported, totals and complete coverage survive save validation',()=>{
 const grid=[['2026年01月'],header,['','','上年余额','','',1018396.54],
 [1,4,'付：环境整治费用','',84000,934396.54],[2,6,'付：亮化灯具款','',2890,931506.54],
 [3,12,'收：土地租金',98480,'',1029986.54],[4,12,'收：土地租金',17770,'',1047756.54],
 [5,16,'付：住院慰问金','',1000,1046756.54],['','','本月合计',116250,87890,'']];
 const sheet=parse(grid),rows=sheet.rows.map(row=>({...row,key:keyOf(row)}));
 assert.equal(rows.length,5);assert.equal(sheet.skipped.find(row=>row.sourceRowNumber===3).reason,'余额结转行');
 assert.equal(sheet.skipped.find(row=>row.sourceRowNumber===3).sourceBalanceCents,101839654);
 assert.equal(review(rows,[],new Set(['1月']),categories,[sheet]).totals.pending,0);
 assert.ok(rows.every(row=>row.sourceBalanceCheck.status==='matched'));
 assert.equal(integrityOf([sheet],rows).blocked,false);
 const hash='f'.repeat(64),preview={fileHash:hash,fileName:'财务2026.xlsx',grids:new Map([['1月',grid]]),sheets:new Map([['1月',sheet]])};
 const saved=prepareFinanceImport({getPreview:()=>preview},{previewId:'p',fileHash:hash,fileName:preview.fileName,sheets:['1月'],reviewRows:rows,rows},[],categories);
 assert.equal(saved.rows.length,5);assert.equal(saved.rows.at(-1).sourceBalanceCents,104675654);
 assert.equal(resolvesNonBusinessRow({sourceRowNumber:3,summary:'上年余额',amountCents:null,recordDate:''},sheet,grid),true);
});

test('carry synonyms keep zero or negative anchors without creating income or expenses',()=>{
 for(const label of ['上年余额','上年度余额','上月余额','上期余额','上年结余','上期结转','期初余额','年初结存','月初结余','余额结转','结转下月',' 上 年 余 额 ']){
  for(const opening of [100,0,-100]){
   const sheet=parse([header,['','',label,'','',opening],[1,5,'付：水费','',10,opening-10]]),rows=sheet.rows.map(row=>({...row,key:keyOf(row)}));
   assert.equal(rows.length,1,label);assert.equal(sheet.skipped.at(-1).reason,'余额结转行',label);
   assert.equal(review(rows,[],new Set(['1月']),categories,[sheet]).totals.pending,0,label);
  }
 }
});

test('an amount is mandatory; missing dates and invalid amounts remain visible, and dated real transactions mentioning totals are retained',()=>{
 const sheet=parse([header,['','','上年余额','','',100],
 [1,5,'收：空发生额','','',100],[2,'','付：领导报酬','',10,90],
 [3,'','付：驻村领导报酬','','错误金额',90],
 [4,5,'合计',10,'',100],[5,'','本月合计',20,10,''],[6,'','以下空白','','','']]);
 assert.deepEqual(sheet.rows.map(row=>row.sourceRowNumber),[4,5,6]);
 assert.equal(sheet.rows[0].transactionEvidence.date,false);assert.equal(sheet.rows[0].transactionEvidence.amount,true);
 assert.ok(sheet.rows[0].issues.length);assert.equal(sheet.rows[1].amountCents,null);
 assert.equal(sheet.rows[2].amountCents,1000);assert.equal(sheet.skipped.find(row=>row.sourceRowNumber===3).reason,'无发生额行');
 assert.equal(sheet.skipped.find(row=>row.sourceRowNumber===7).reason,'合计或汇总行');
 assert.equal(sheet.coverage.length,sheet.rows.length+sheet.skipped.length);
});
