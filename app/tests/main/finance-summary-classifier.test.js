'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {classifySummary,categories}=require('../../src/shared/finance-category-rules');
const {classifySummaries}=require('../../src/main/finance-summary-classifier');
const {classifyFinanceWorkbook}=require('../../src/main/finance-ai-recognition');
test('specific summary rules cover actual income, utilities, wages and works without changing direction',()=>{
 const samples=[['income','收：某场地地块管理费','场地管理费收入'],['income','2026年度农村公共运行经费','公共运行经费收入'],['income','7月份村干工资及社保款','工资及社保经费收入'],['income','土地流转金','土地流转收入'],['expense','付：水费，村务卡','水费'],['expense','付：电费，村务卡','电费'],['expense','办公用桶装水款','饮用水费'],['expense','社区流转土地租金','土地租金支出'],['expense','第二季度组长、临干报酬','人员报酬'],['expense','工资及社保款','工资及社保支出'],['expense','桥下垃圾清理机械费','垃圾清运费'],['expense','排涝沟杂工款','排涝工程支出']];
 for(const [type,summary,expected] of samples) assert.equal(classifySummary(type,summary)?.category,expected,summary);
 assert.equal(classifySummary('expense','报销款'),null);
 assert.equal(classifySummary('expense','水费和办公用品'),null);
 assert.equal(classifySummary('expense','自来水费',{...categories,expense:['用水费']} ).category,'用水费');
});
test('AI deduplicates same direction and summary, caches results, rejects unsupported or reversed proposals',async()=>{
 const rows=[{recordType:'expense',summary:'档案整理服务',category:'办公支出'},{recordType:'expense',summary:'档案整理服务',category:'其他支出'},{recordType:'income',summary:'档案整理服务',category:'其他收入'},{recordType:'expense',summary:'报销款',category:'维修维护'}];
 let calls=0;const cache=new Map();const aiRouter={chat:async({messages})=>{calls++;assert.equal(JSON.parse(messages[1].content).length,3);return {content:JSON.stringify([{index:0,recordType:'expense',category:'档案整理费',confident:true},{index:1,recordType:'expense',category:'服务收入',confident:true},{index:2,category:'杂费',confident:true}])};}};
 const result=await classifySummaries(rows,{aiRouter,cache});
 assert.equal(result.classified[0].result.category,'档案整理费');assert.equal(result.classified[1].result.category,'档案整理费');
 assert.equal(result.classified[2].result.status,'uncertain');assert.equal(result.classified[3].result.status,'uncertain');
 await classifySummaries(rows,{aiRouter,cache});assert.equal(calls,1);
});
test('category-only import preserves raw fields, keeps rules on AI failure, retries pending and reuses across sheets',async()=>{
 const raw={recordDate:'2026-02-02',recordType:'expense',summary:'档案整理服务',amountCents:12345,category:'其他支出',sourceRowNumber:2};
 const sheet=rows=>({sheetName:'2月',mapping:{date:0,summary:1,expense:2},rows});
 const preview={sheets:new Map([['2月',sheet([{...raw},{...raw,summary:'水费',sourceRowNumber:3}])],['3月',{...sheet([{...raw,recordDate:'2026-03-01'}]),sheetName:'3月'}]])};
 const input={workbookService:{getPreview:()=>preview},previewId:'x',sheetNames:['2月'],aiRouter:{chat:async()=>{throw new Error('断连');}}};
 const failed=await classifyFinanceWorkbook(input);assert.equal(failed.pendingCount,1);assert.equal(failed.sheets[0].rows[1].category,'水费');
 let calls=0;input.aiRouter={chat:async({messages})=>{calls++;assert.ok(!messages[0].content.includes('识别财务 Excel'));return {content:'[{"index":0,"recordType":"expense","category":"档案整理费","confident":true,"amountCents":9,"recordDate":"2099-01-01"}]'};}};
 const success=await classifyFinanceWorkbook(input);assert.equal(success.pendingCount,0);
 for(const key of ['recordDate','recordType','summary','amountCents']) assert.equal(success.sheets[0].rows[0][key],raw[key]);
 await classifyFinanceWorkbook(input);await classifyFinanceWorkbook({...input,sheetNames:['3月']});assert.equal(calls,1);
});

test('real-world purposes create concrete categories even outside the original catalog; context is not billed as its underlying asset',()=>{
 const samples=[['income','物业公司上交管理费','物业管理费收入'],['income','土地征收补偿款','土地征收补偿收入'],['income','桥下空间清理，管护劳务费','管护劳务收入'],['income','年度工会成员会费','工会会费收入'],['income','危房整改资金','危房整改经费收入'],['expense','水管网项目评估费用','评估费'],['expense','自来水管网项目2户评估费用','评估费'],['expense','土地租赁纠纷诉讼费','诉讼费'],['expense','公共维护人员报酬','人员报酬'],['expense','体检租车费','租车费'],['expense','零星日用品款','日用品费'],['expense','宣传材料整治费用','宣传材料费'],['expense','年度代账费用','代理记账费'],['expense','危险品处置工作盒饭','工作餐费'],['expense','东八组土地流转金','土地流转支出'],['expense','杂工受伤补偿款','工伤补偿费'],['expense','违建拆除补偿款','拆迁补偿支出'],['expense','环境整治运输车费用','运输费'],['expense','办公桌椅款','办公家具费'],['expense','慰问物品款','慰问费']];
 for(const [type,summary,expected]of samples){const result=classifySummary(type,summary);assert.equal(result?.category,expected,summary);assert.ok(categories[type].includes(result.category));}
 assert.equal(classifySummary('expense','补付款'),null);
 assert.equal(classifySummary('expense','水费及办公设备款'),null);
});
test('AI prompt permits new purposes, omits broad catalog anchors and preserves unsupported data',async()=>{
 const row={recordType:'income',summary:'专项设施管护服务款',category:'其他收入',amountCents:10000};
 const result=await classifySummaries([row],{aiRouter:{chat:async({messages})=>{assert.match(messages[0].content,/绝不是可选项限制/);assert.match(messages[0].content,/没有现成科目时/);assert.deepEqual(JSON.parse(messages[1].content)[0].currentCategories,[]);return {content:'[{"index":0,"recordType":"income","category":"设施管护服务收入","confident":true}]'};}}});
 assert.equal(result.classified[0].result.category,'设施管护服务收入');assert.equal(row.category,'其他收入');assert.equal(row.amountCents,10000);
});

test('corrupted AI category names are rejected instead of entering the workspace catalog',async()=>{
 const result=await classifySummaries([{recordType:'income',summary:'设施服务款',category:'其他收入'}],{aiRouter:{chat:async()=>({content:'[{"index":0,"recordType":"income","category":"拆除\\uFFFD\\uFFFD务收入","confident":true}]'})}});
 assert.equal(result.classified[0].result.status,'uncertain');assert.ok(result.categories.income.every(name=>!name.includes('\uFFFD')));
});

test('invalid model batches split and recover while preserving local rules and transaction fields',async()=>{
 const rows=Array.from({length:13},(_,i)=>({recordType:'income',summary:`专项服务项目${i}款`,amountCents:100+i,recordDate:'2026-01-01',category:'其他收入'}));const calls=[];
 const result=await classifySummaries(rows,{aiRouter:{chat:async({messages})=>{const chunk=JSON.parse(messages[1].content);calls.push(chunk.length);if(chunk.length>3)throw new Error('模型返回内容无效');return {content:JSON.stringify({results:chunk.map(r=>({index:r.index,recordType:r.recordType,category:'专项服务收入',confident:true}))})};}}});
 assert.equal(result.warnings.length,0);assert.ok(result.classified.every(r=>r.result.category==='专项服务收入'));assert.equal(Math.max(...calls),12);assert.deepEqual(rows.map(r=>r.amountCents),Array.from({length:13},(_,i)=>100+i));
});
test('incomplete JSON responses retry smaller batches; one bad item does not stop later classifications',async()=>{
 const rows=Array.from({length:14},(_,i)=>({recordType:'income',summary:`服务项目${i}款`,category:'其他收入'}));
 const result=await classifySummaries(rows,{aiRouter:{chat:async({messages})=>{const chunk=JSON.parse(messages[1].content);if(chunk.some(r=>r.summary==='服务项目0款'))return {content:'[{"index":0'};return {content:JSON.stringify(chunk.map(r=>({index:r.index,recordType:r.recordType,category:'项目服务收入',confident:true})))};}}});
 assert.equal(result.classified.filter(r=>r.result.status==='failed').length,1);assert.equal(result.classified.filter(r=>r.result.category==='项目服务收入').length,13);
});
