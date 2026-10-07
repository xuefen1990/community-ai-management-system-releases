'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseFinanceGrid,resolvesNonBusinessRow}=require('../../src/main/finance-excel-parser');
const {review,categories}=require('../../src/shared/finance-import-review');
const {prepareFinanceImport,validateSourceManifest,keyOf}=require('../../src/main/finance-import-integrity');
const {FinanceWorkbookService}=require('../../src/main/finance-workbook-service');
const header=['序号','日期','收、支内容摘要','收入','支出','余额'];
function fixture(){
 const incomes=[562375,77848,15000,9800,209.44,0.73],expenses=[600,29800,1400,360,3800,14000,1307,1164,1525,6500,283633];
 let balance=1013023.48,index=0;
 const grid=[['2025年 06月'],[],header,['','','上月余额','','',balance]];
 for(const amount of incomes){balance=Math.round((balance+amount)*100)/100;grid.push([++index,21,'收：经费',amount,'',balance]);}
 for(const amount of expenses){balance=Math.round((balance-amount)*100)/100;grid.push([++index,24,'付：费用','',amount,balance]);}
 for(const [amount,summary,day] of [[26280,'工资及社保',24],[40000,'实践站经费',25],[7200,'农村道路保洁工资',29]]){balance=Math.round((balance+amount)*100)/100;grid.push([++index,day,`收：${summary}`,amount,'',balance]);}
 grid.push([21,'','本月合计',738713.2,344089,''],[22,'','以下空白','','',''],[23,'','','','',''],['（村）居经办人：','','负责人：','','监督委员会（签字、盖章）：','']);
 return grid;
}
const parse=grid=>parseFinanceGrid(grid,{sheetName:'6月',fileName:'财务2025.xlsx'});
test('June screenshot keeps all 20 transactions and skips blank notice without blocking import',()=>{
 const grid=fixture(),sheet=parse(grid),rows=sheet.rows.map(r=>({...r,key:keyOf(r)}));
 assert.equal(rows.length,20);assert.equal(rows.at(-1).recordDate,'2025-06-29');assert.equal(rows.at(-1).sourceBalanceCents,140764765);
 const skipped=sheet.skipped.find(r=>r.sourceRowNumber===26);assert.equal(skipped.reason,'空白说明行');assert.equal(skipped.raw[2],'以下空白');
 assert.equal(review(rows,[],new Set(['6月']),categories,[sheet]).totals.pending,0);
 const preview={fileHash:'a'.repeat(64),fileName:'财务2025.xlsx',sheets:new Map([['6月',sheet]]),grids:new Map([['6月',grid]])};
 const result=prepareFinanceImport({getPreview:()=>preview},{previewId:'p',fileHash:preview.fileHash,fileName:preview.fileName,sheets:['6月'],reviewRows:rows,rows,totalAcknowledgements:{[`${encodeURIComponent('6月')}:25`]:'原表合计四舍五入至一位小数，差额三分已核实'}},[],categories);
 assert.equal(result.rows.length,20);assert.equal(validateSourceManifest(result).counts.ready,20);
 assert.equal(rows.filter(r=>r.recordType==='income').reduce((s,r)=>s+r.amountCents,0),73871317);
 assert.equal(rows.filter(r=>r.recordType==='expense').reduce((s,r)=>s+r.amountCents,0),34408900);
});
test('notice variants ignore sequence but never suppress transaction evidence or later data regions',()=>{
 for(const summary of ['以下空白',' 本页以下空白。 ','以下无正文','以下无数据','说明：以下部分未填写']){
  const sheet=parse([header,[22,'',summary,'','','']]);assert.equal(sheet.rows.length,0);assert.equal(sheet.skipped.length,2);
 }
 for(const cells of [[22,'','以下空白',10,'',''],[22,'','以下空白','金额异常','','']])assert.equal(parse([header,cells]).rows.length,1);
 for(const cells of [[22,29,'以下空白','','',''],[22,'','以下空白','','',0],[22,'','以下空白','','',-10]])assert.equal(parse([header,cells]).skipped.at(-1).reason,'无发生额行');
 const sheet=parse([header,[22,'','以下空白','','',''],header,['','','期初余额','','',100],[1,29,'收：真实交易',10,'',110]]);
 assert.equal(sheet.rows.length,1);assert.equal(sheet.rows[0].recordDate,'2025-06-29');
});
test('incomplete real transactions stay pending, while corrected notice coverage permits remapping',()=>{
 const grid=[header,[22,'','以下空白','','',''],[1,'','收：保洁工资',7200,'',7200],[2,29,'收：经费',100,'','']];
 const sheet=parse(grid);assert.equal(sheet.rows.length,2);assert.equal(review(sheet.rows,[],new Set(['6月']),categories,[sheet]).totals.pending,2);
 const old={sourceRowNumber:2,summary:'以下空白',recordDate:'',amountCents:null};assert.equal(resolvesNonBusinessRow(old,sheet,grid),true);
 const service=new FinanceWorkbookService({dialog:{}});service.previews.set('p',{fileName:'财务2025.xlsx',grids:new Map([['6月',grid]]),sheets:new Map([['6月',{...sheet,rows:[old,...sheet.rows]}]])});
 assert.equal(service.remap({previewId:'p',sheetName:'6月',headerRowNumber:1,mapping:sheet.mapping}).rows.length,2);
});
test('merged date propagation cannot turn a blank notice into a false transaction',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),XLSX=require('xlsx');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'finance-blank-notice-'));
 try{
  const file=path.join(dir,'财务2025.xlsx'),book=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([header,['','','期初余额','','',100],[1,29,'收：经费',10,'',110],[2,'','以下空白','','','']]);
  sheet['!merges']=[{s:{r:2,c:1},e:{r:3,c:1}}];XLSX.utils.book_append_sheet(book,sheet,'6月');XLSX.writeFile(book,file);
  const service=new FinanceWorkbookService({dialog:{showOpenDialog:async()=>({filePaths:[file]})}}),preview=await service.select(categories);
  assert.equal(preview.sheets[0].rows.length,1);assert.equal(preview.sheets[0].skipped.find(r=>r.sourceRowNumber===4).reason,'空白说明行');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
