'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseFinanceGrid}=require('../../src/main/finance-excel-parser');
const {review,categories}=require('../../src/shared/finance-import-review');
const header=['序号','日期','收、支内容摘要','收入','支出','余额'];
function grid(){return [['2024年 10-11月'],[],header,['','','上月余额','','',277234.92],[1,8,'付：危房改造费用','',28000,249234.92],[2,9,'收：养老保险',5932.08,'',255167],[3,19,'收：2024年度公共维护经费',80000,'',335167],[4,30,'收：自来水管网施工附着物补偿款',1131514,'',1466681],[5,11,'收：土地流转金',116250,'',1582931],[6,12,'收：道路劝导员报酬',11200,'',1594131]];}
test('combined October-November days are assigned across the unique rollover with all transactions and balances retained',()=>{
 const sheet=parseFinanceGrid(grid(),{sheetName:'10-11月',fileName:'财务2024.xlsx'});
 assert.deepEqual(sheet.rows.map(r=>r.recordDate),['2024-10-08','2024-10-09','2024-10-19','2024-10-30','2024-11-11','2024-11-12']);
 assert.equal(sheet.rows.length,6);assert.equal(sheet.rows[2].amountCents,8000000);assert.equal(sheet.rows[3].amountCents,113151400);
 assert.equal(review(sheet.rows,[],new Set([sheet.sheetName]),categories,[sheet]).totals.balancePending,0);
});
test('range in title and descending physical order resolve; uncertain and cross-year days stay pending',()=>{
 const title=grid();const sheet=parseFinanceGrid(title,{sheetName:'合并明细',fileName:'财务2024.xlsx'});assert.equal(sheet.rows[2].recordDate,'2024-10-19');
 const reversed=[title[0],[],header,...title.slice(4).reverse()];const descending=parseFinanceGrid(reversed,{sheetName:'10—11月',fileName:'财务2024.xlsx'});assert.equal(descending.rows[0].recordDate,'2024-11-12');assert.equal(descending.rows.at(-1).recordDate,'2024-10-08');
 const ambiguous=parseFinanceGrid([header,[1,19,'收：经费',80,'',80]],{sheetName:'10-11月',fileName:'财务2024.xlsx'});assert.equal(ambiguous.rows[0].recordDate,'');assert.match(ambiguous.rows[0].dateRecognitionReason,/无法唯一确定/);
 assert.equal(review(ambiguous.rows,[],new Set(['10-11月']),categories,[ambiguous]).totals.unresolved,1);
 const crossYear=parseFinanceGrid([header,[1,30,'收：经费',80,'',80],[2,2,'收：经费',80,'',160]],{sheetName:'12-1月',fileName:'财务2024.xlsx'});assert.ok(crossYear.rows.every(r=>!r.recordDate));
});
test('full dates preserve their months and one-month layouts retain existing behavior',()=>{
 const single=parseFinanceGrid([header,[1,19,'收：经费',80,'',80]],{sheetName:'10月',fileName:'财务2024.xlsx'});assert.equal(single.rows[0].recordDate,'2024-10-19');
 const full=parseFinanceGrid([header,[1,'2024-10-19','收：经费',80,'',80],[2,'2024-11-11','收：经费',80,'',160]],{sheetName:'10-11月',fileName:'财务2024.xlsx'});assert.deepEqual(full.rows.map(r=>r.recordDate),['2024-10-19','2024-11-11']);
});
