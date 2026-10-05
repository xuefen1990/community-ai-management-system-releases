'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseFinanceGrid}=require('../../src/main/finance-excel-parser');
const {review,integrityOf,categories}=require('../../src/shared/finance-import-review');
const {prepareFinanceImport,keyOf}=require('../../src/main/finance-import-integrity');
const {importFinanceBatch}=require('../../src/main/finance-imports');
const {transactionBalances}=require('../../src/main/finance-transaction-balances');
const aprilTemplate=require('../helpers/finance-april-template.cjs');
const parse=grid=>parseFinanceGrid(grid,{sheetName:'4月',fileName:'财务2024.xlsx'});

test('April screenshot: only the 15 actual transactions through April 16 count, sequence-only trailing rows and metadata need no manual confirmation',()=>{
 const sheet=parse(aprilTemplate());assert.equal(sheet.rows.length,15);assert.equal(sheet.rows.at(-1).recordDate,'2024-04-16');assert.ok(sheet.rows.every(row=>row.issues.length===0));
 assert.deepEqual(sheet.rows.map(row=>row.sourceRowNumber),Array.from({length:15},(_,index)=>index+5));
 const rows=sheet.rows.map(row=>({...row,key:keyOf(row)})),checked=review(rows,[],new Set(['4月']));
 assert.equal(checked.totals.pending,0);assert.equal(checked.totals.incomeCents,919800);assert.equal(checked.totals.expenseCents,8125000);assert.equal(integrityOf([sheet],rows).blocked,false);
 assert.equal(sheet.skipped.find(row=>row.sourceRowNumber===2).reason,'表头说明行');assert.ok(sheet.skipped.filter(row=>row.sourceRowNumber>=21).every(row=>row.reason==='业务列空白行'));
 assert.equal(sheet.coverage.length,27);
 const hash='d'.repeat(64), preview={fileHash:hash,fileName:'财务2024.xlsx',grids:new Map([['4月',aprilTemplate()]]),sheets:new Map([['4月',sheet]]),categoryCatalog:categories};
 const input=prepareFinanceImport({getPreview:()=>preview},{previewId:'p',batchId:'april',fileHash:hash,fileName:preview.fileName,sheets:['4月'],reviewRows:rows,rows},[],categories),database={};let sequence=0;
 const saved=importFinanceBatch(database,input,{now:()=>new Date('2026-10-04T00:00:00Z'),uuid:()=>`id-${++sequence}`});assert.equal(saved.count,15);
 const balances=transactionBalances(database.finances,{startDate:'2024-04-01',amountCents:62644147},{today:'2026-10-04'});assert.ok(balances.items.every(row=>row.balanceStatus==='matched'));assert.equal(balances.items.at(-1).calculatedBalanceCents,55438947);
 assert.equal(saved.sourceAudit.coverage[0].nonBusiness.filter(row=>row.reason==='业务列空白行').length,7);
});

test('changing sequence values cannot affect dates, transaction count or money; only auxiliary columns do not create business rows',()=>{
 const grid=aprilTemplate();grid.slice(3).forEach((row,index)=>row[0]=90000+index);
 grid.push([99,'','','','',100],[100,'','','',0,100,'备注：模板空白'],[101,'','','-',0,100]);
 const sheet=parse(grid);assert.equal(sheet.rows.length,15);assert.equal(sheet.rows.at(-1).recordDate,'2024-04-16');assert.equal(sheet.skipped.filter(row=>row.reason==='业务列空白行').length,10);
});

test('empty amounts are non-business; actual, zero and invalid amounts with incomplete fields remain pending',()=>{
 const sheet=parse([['序号','日期','收、支内容摘要','收入','支出','余额'],[1,16,'','','',100],[2,'','付：报酬','','',100],[3,'','','','不明',100],[4,'','','',1200,100],[5,16,'付：报酬','',0,100],[6,'','日常杂项','','',100]]);
 assert.equal(sheet.rows.length,3);assert.equal(sheet.skipped.filter(row=>row.reason==='无发生额行').length,3);assert.ok(sheet.rows.every(row=>row.issues.length));assert.equal(review(sheet.rows.map(row=>({...row,key:keyOf(row)})),[],new Set(['4月'])).totals.pending,3);
});

test('manual/AI mapping cannot treat the sequence column as a date, summary or transaction amount',()=>{
 const grid=aprilTemplate();const sheet=parseFinanceGrid(grid,{sheetName:'4月',fileName:'财务2024.xlsx',headerRowIndex:2,mapping:{date:0,summary:0,amount:0,income:0,expense:0}});
 assert.equal(sheet.mapping.date,1);assert.equal(sheet.mapping.summary,2);assert.equal(sheet.mapping.income,3);assert.equal(sheet.mapping.expense,4);assert.equal(sheet.mapping.amount,undefined);assert.equal(sheet.rows.length,15);
});

test('AI and manual remap can resolve unmapped sequence-only rows without losing actual transactions',async()=>{
 const {FinanceWorkbookService}=require('../../src/main/finance-workbook-service'),{recognizeFinanceWorkbook}=require('../../src/main/finance-ai-recognition');
 const grid=[['序号','办理日','用途描述','收入','支出','余额'],[1,16,'付：人员报酬','',1200,100],[2,'','','','',100],[3,'','','','','']];
 const old=parse(grid);assert.equal(old.rows.length,3);
 const preview={fileName:'财务2024.xlsx',grids:new Map([['4月',grid]]),sheets:new Map([['4月',old]]),categoryCatalog:categories};
 const service=new FinanceWorkbookService({dialog:{}});service.previews.set('p',preview);
 const remapped=service.remap({previewId:'p',sheetName:'4月',headerRowNumber:1,mapping:{date:1,summary:2,income:3,expense:4,balance:5}});assert.equal(remapped.rows.length,1);assert.equal(remapped.rows[0].recordDate,'2024-04-16');
 preview.sheets.set('4月',old);
 const recognized=await recognizeFinanceWorkbook({workbookService:service,previewId:'p',sheetNames:['4月'],aiRouter:{chat:async()=>({content:JSON.stringify({headerRowNumber:1,mapping:{date:1,summary:2,income:3,expense:4,balance:5}})})}});
 assert.equal(recognized.sheets[0].rows.length,1);assert.equal(recognized.sheets[0].rows[0].amountCents,120000);assert.equal(recognized.warnings.length,0);
});

test('merged day and summary cells fill actual payments, never extend into sequence-only trailing template rows',async()=>{
 const {FinanceWorkbookService}=require('../../src/main/finance-workbook-service');
 const XLSX=require('xlsx'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-blank-merges-'));try{
 const grid=[['序号','日期','收、支内容摘要','收入','支出','余额'],[1,16,'付：人员报酬','',1200,8800],[2,'','','',1200,7600],[3,'','','','',''],[4,'','','',0,7600]];
 const sheet=XLSX.utils.aoa_to_sheet(grid);sheet['!merges']=[{s:{r:1,c:1},e:{r:4,c:1}},{s:{r:1,c:2},e:{r:4,c:2}}];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'4月');const file=path.join(dir,'财务2024.xlsx');XLSX.writeFile(book,file);
 const service=new FinanceWorkbookService({dialog:{showOpenDialog:async()=>({filePaths:[file]})}}),preview=await service.select(categories);
 assert.equal(preview.sheets[0].rows.length,2);assert.ok(preview.sheets[0].rows.every(row=>row.recordDate==='2024-04-16' && row.summary==='付：人员报酬'));
 assert.equal(preview.sheets[0].skipped.filter(row=>row.reason==='业务列空白行').length,2);assert.equal(service.getPreview(preview.previewId).grids.get('4月')[3][1],'');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('remapping cannot silently discard already valid records by pointing business fields at empty auxiliary cells',()=>{
 const {FinanceWorkbookService}=require('../../src/main/finance-workbook-service');
 const grid=[['序号','日期','收、支内容摘要','收入','支出','余额','空列1','空列2','空列3'],[1,16,'付：水费','',100,900,'','','']],sheet=parse(grid),service=new FinanceWorkbookService({dialog:{}});
 service.previews.set('p',{fileName:'财务2024.xlsx',grids:new Map([['4月',grid]]),sheets:new Map([['4月',sheet]]),categoryCatalog:categories});
 assert.throws(()=>service.remap({previewId:'p',sheetName:'4月',headerRowNumber:1,mapping:{date:6,summary:7,amount:8,income:null,expense:null}}),/遗漏/u);
 assert.equal(service.getPreview('p').sheets.get('4月').rows.length,1);
});
