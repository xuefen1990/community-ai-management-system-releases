'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseFinanceGrid}=require('../../src/main/finance-excel-parser');
const {FinanceWorkbookService}=require('../../src/main/finance-workbook-service');
const {recognizeFinanceWorkbook}=require('../../src/main/finance-ai-recognition');
const {review,categories}=require('../../src/shared/finance-import-review');
const {prepareFinanceImport,validateSourceManifest,keyOf}=require('../../src/main/finance-import-integrity');
const header=['序号','日期','收、支内容摘要','收入','支出','余额'];
function december(){return [['2025年 12月'],[],header,['','','上月余额','','',1029799.35],[1,5,'收：物业公司上交管理费',70000,'',1099799.35],[2,12,'收：2025年度医保征缴工作经费',2840,'',1102639.35],[3,16,'收：2025年7–12月农村道路养护工资',4800,'',1107439.35],[4,20,'收：第四季度基本账户利息',56.81,'',1107496.16],[5,20,'收：第四季度村务卡利息',0.28,'',1107496.44]];}
const parse=(grid,options={})=>parseFinanceGrid(grid,{sheetName:'12月',fileName:'财务2025.xlsx',...options});
function serviceFor(grid,options={}){const sheet=parse(grid,options),service=new FinanceWorkbookService({dialog:{}});const preview={fileName:options.fileName||'财务2025.xlsx',fileHash:'a'.repeat(64),grids:new Map([[sheet.sheetName,grid]]),sheets:new Map([[sheet.sheetName,sheet]]),categoryCatalog:categories};service.previews.set('p',preview);return {sheet,service,preview};}
test('December summary service periods never replace worksheet month; all dates, source cells and balances survive saving',()=>{
 const grid=december(),{sheet,service,preview}=serviceFor(grid);assert.equal(sheet.context.month,12);assert.equal(sheet.context.monthRange,undefined);
 assert.deepEqual(sheet.rows.map(r=>r.recordDate),['2025-12-05','2025-12-12','2025-12-16','2025-12-20','2025-12-20']);
 const rows=sheet.rows.map(r=>({...r,key:keyOf(r)}));assert.equal(review(rows,[],new Set(['12月']),categories,[sheet]).totals.pending,0);
 const saved=prepareFinanceImport(service,{previewId:'p',fileHash:preview.fileHash,fileName:preview.fileName,sheets:['12月'],rows,reviewRows:rows},[],categories);
 assert.equal(validateSourceManifest(saved).counts.ready,5);assert.equal(saved.rows[2].sourceRaw[1],'16');assert.equal(saved.rows[2].amountCents,480000);assert.equal(saved.rows[2].dateRecognitionSource,'sheet-period');
});
test('single month labels, text and fullwidth day numbers, 日 suffix and calendar validation',()=>{
 for(const day of [5,'5','５','５日'])assert.equal(parse([header,[1,day,'收：经费',10,'',10]]).rows[0].recordDate,'2025-12-05');
 assert.equal(parse([['2024年 02月'],header,[1,'29日','收：经费',10,'',10]],{sheetName:'二月',fileName:'财务2024.xlsx'}).rows[0].recordDate,'2024-02-29');
 assert.equal(parse([header,[1,29,'收：经费',10,'',10]],{sheetName:'2月'}).rows[0].recordDate,'');
 assert.equal(parse([header,[1,32,'收：经费',10,'',10]]).rows[0].recordDate,'');
 assert.equal(parse([['2025年 12月'],header,[1,5,'收：经费',10,'',10]],{sheetName:'财务明细'}).rows[0].recordDate,'2025-12-05');
});
test('conflicting metadata stays pending until one explicit period confirmation; complete original dates stay unchanged',()=>{
 const grid=[['2025年 11月'],header,[1,5,'收：经费',10,'',10],[2,'2025-11-12','收：经费',10,'',20]];
 const {sheet,service}=serviceFor(grid);assert.match(sheet.context.conflicts.join(''),/月份/);assert.equal(sheet.rows[0].recordDate,'');assert.equal(sheet.rows[1].recordDate,'2025-11-12');
 const result=service.remap({previewId:'p',sheetName:'12月',headerRowNumber:2,mapping:sheet.mapping,dateConfirmation:{headerRowNumber:2,year:2025,month:12,reason:'核对原表确认十二月'}});
 assert.equal(result.rows[0].recordDate,'2025-12-05');assert.equal(result.rows[1].recordDate,'2025-11-12');assert.equal(result.context.confirmation.reason,'核对原表确认十二月');assert.equal(result.rows[0].dateRecognitionSource,'confirmed-period');
 assert.throws(()=>service.remap({previewId:'p',sheetName:'12月',headerRowNumber:2,dateConfirmation:{headerRowNumber:2,year:2025,month:13}}),/有效/);
});
test('missing year/month never borrows a year or period from summaries, notes or full transaction dates',()=>{
 const grid=[header,[1,5,'收：2025年7–12月工资',10,'',10],[2,'2024-12-12','收：经费',10,'',20],['备注：2025年 12月']];
 const sheet=parse(grid,{fileName:'财务.xlsx'});assert.equal(sheet.context.year,null);assert.equal(sheet.rows[0].recordDate,'');assert.equal(sheet.rows[1].recordDate,'2024-12-12');
 const generic=parse([header,[1,5,'收：经费',10,'',10]],{sheetName:'明细',fileName:'财务.xlsx'});assert.equal(generic.context.needsConfirmation,true);
 const confirmed=parse([header,[1,5,'收：经费',10,'',10]],{sheetName:'明细',fileName:'财务.xlsx',dateConfirmations:{1:{year:2025,month:12,reason:'原表'}}});assert.equal(confirmed.rows[0].recordDate,'2025-12-05');
});
test('each repeated header builds a separate context; prior transaction summaries cannot supply next region metadata',()=>{
 const grid=[['2025年 11月'],header,[1,5,'收：2020年7–12月工资',10,'',10],['2025年 12月'],header,[1,16,'收：经费',10,'',20],header,[1,20,'收：经费',10,'',30]];
 const sheet=parse(grid,{sheetName:'明细',fileName:'财务2025.xlsx'});assert.equal(sheet.rows.length,3);assert.deepEqual(sheet.rows.map(r=>r.recordDate),['2025-11-05','2025-12-16','']);assert.equal(sheet.regions.length,3);assert.equal(sheet.regions[2].context.month,null);
});
test('AI header recognition preserves confirmed months and ignores stale replies after user remapping',async()=>{
 const grid=[['2025年 11月'],header,[1,5,'收：物业管理费',10,'',10]];const {sheet,service,preview}=serviceFor(grid);
 service.remap({previewId:'p',sheetName:'12月',headerRowNumber:2,mapping:sheet.mapping,dateConfirmation:{headerRowNumber:2,year:2025,month:12}});
 const router={chat:async()=>({content:JSON.stringify({headerRowNumber:2,mapping:sheet.mapping})})};
 const recognized=await recognizeFinanceWorkbook({workbookService:service,aiRouter:router,previewId:'p',sheetNames:['12月']});assert.equal(recognized.sheets[0].rows[0].recordDate,'2025-12-05');assert.equal(recognized.warnings.length,0);
 let release;const promise=recognizeFinanceWorkbook({workbookService:service,aiRouter:{chat:()=>new Promise(resolve=>{release=resolve;})},previewId:'p',sheetNames:['12月']});
 service.remap({previewId:'p',sheetName:'12月',headerRowNumber:2,mapping:sheet.mapping,dateConfirmation:{headerRowNumber:2,year:2025,month:11}});
 release({content:JSON.stringify({headerRowNumber:2,mapping:sheet.mapping})});await assert.rejects(promise,/过期/);assert.equal(preview.sheets.get('12月').rows[0].recordDate,'2025-11-05');
});
