'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {auditResidents,fillEmpty,inspectImport,planImport}=require('../../src/shared/resident-import-review');
const {buildPersonnelView,upsertPeople}=require('../../src/main/foundation-data-model');
const id='11010519491231002X',id2='110105194912310011';
// Exercise the real foundation conversion, including its specialty handling.
const source=fs.readFileSync(require('node:path').join(__dirname,'../../src/renderer/foundation/vendor/assets/foundation-runtime.mjs'),'utf8');
const acorn=require('acorn'),ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
const names=['o8e','x8','r8e','l8e','cw'];
const functions=ast.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name)).map(node=>source.slice(node.start,node.end)).join('\n');
const builder=vm.runInNewContext(`${functions};o8e`,{b8:{党员:'is_party'},e8e:{党员:'party_info'},ZEe:{党员:'standard_party'},console});
const mappings={name:'姓名',id_card:'身份证',phone:'电话',address:'地址',household_id:'户号',village_group:'组别',party_branch:'支部',party_duty:'职务',is_party:'党员'};
function database(){return {personnel:[{id:'old',name:'甲',id_card:id,phone:'原电话',address:'',village_group:'一组',household_id:'001',tags:['党员'],party_info:{branch:'原支部',duty:''},bankAccounts:[{id:'bank',number:'test'}],disbursementHistory:[{id:'paid'}]}]};}
function options(rows,db=database(),mode='batch'){
 const view=buildPersonnelView(db);return {rows,mappings:{...mappings},mode,existingPeople:view.people.map(person=>({...person,householdNo:'001',villageGroupName:'一组'})),villageGroups:view.villageGroups};
}
test('same ID/name fills blanks and preserves existing contact, household, tags, specialty and history',()=>{
 const db=database(),before=structuredClone(db),input=options([{'姓名':'甲','身份证':id.toLowerCase(),'电话':'新电话','地址':'新地址','户号':'002','组别':'二组','支部':'新支部','职务':'委员','党员':'否'}],db);
 const original=structuredClone(input),plan=planImport(input,builder);
 assert.deepEqual(input,original);assert.equal(plan.summary.updatedRows,1);assert.equal(plan.validRows[0].fields.phone,'原电话');assert.equal(plan.validRows[0].fields.address,'新地址');
 assert.equal(plan.validRows[0].householdNo,'001');assert.equal(plan.validRows[0].villageGroupName,'一组');assert.deepEqual(plan.validRows[0].tags,['党员']);
 const result=upsertPeople(db,plan.validRows);assert.equal(result.failed.length,0);assert.equal(db.personnel[0].name,'甲');assert.equal(db.personnel[0].phone,'原电话');
 assert.equal(db.personnel[0].party_info.branch,'原支部');assert.deepEqual(db.personnel[0].bankAccounts,before.personnel[0].bankAccounts);assert.deepEqual(db.personnel[0].disbursementHistory,before.personnel[0].disbursementHistory);
 assert(plan.differences.some(row=>row.field==='phone'));
});
test('specialty blanks are filled while existing specialty fields are preserved',()=>{
 const plan=planImport(options([{'姓名':'甲','身份证':id,'支部':'新支部','职务':'委员'}]),builder);
 assert.equal(plan.validRows[0].fields.customFields.party_info.branch,'原支部');assert.equal(plan.validRows[0].fields.customFields.party_info.duty,'委员');
});
test('different names require an explicit decision; keep old, select incoming, skip all work',()=>{
 const input=options([{'姓名':'乙','身份证':id,'地址':'新地址'}]);
 assert.equal(inspectImport(input).nameConflicts.length,1);assert.throws(()=>planImport(input,builder),/请先选择/);
 assert.equal(planImport(input,builder,{[id]:'甲'}).validRows[0].fields.name,'甲');
 const db=database(),plan=planImport(input,builder,{[id]:'乙'});assert.equal(upsertPeople(db,plan.validRows).failed.length,0);assert.equal(db.personnel[0].name,'乙');
 const skipped=planImport(input,builder,{[id]:'__skip__'});assert.equal(skipped.validRows.length,0);assert.equal(skipped.summary.failedRows,1);
});
test('duplicates within a file merge complementary rows; differing names never choose the first silently',()=>{
 const rows=[{'姓名':'新居民','身份证':id2,'电话':'123'},{'姓名':'新居民','身份证':id2,'地址':'新地址','电话':'456'}];
 const plan=planImport(options(rows),builder);assert.equal(plan.validRows.length,1);assert.equal(plan.summary.insertedRows,1);assert.equal(plan.summary.duplicateRows,1);
 assert.equal(plan.validRows[0].fields.phone,'123');assert.equal(plan.validRows[0].fields.address,'新地址');assert(plan.differences.some(row=>row.field==='电话'));
 rows[1].姓名='另一姓名';assert.throws(()=>planImport(options(rows),builder),/请先选择/);assert.equal(planImport(options(rows),builder,{[id2]:'另一姓名'}).validRows[0].fields.name,'另一姓名');
});
test('existing duplicate ID, invalid checksum, missing ID and bad date are quarantined',()=>{
 const db=database();db.personnel.push({...db.personnel[0],id:'duplicate',name:'乙'});
 const input=options([{'姓名':'甲','身份证':id},{'姓名':'错校验','身份证':'110105194912310020'},{'姓名':'空号'},{'姓名':'错日期','身份证':'11010519490231002X'}],db);
 const plan=planImport(input,builder);assert.equal(plan.validRows.length,0);assert.equal(plan.summary.failedRows,4);assert.equal(plan.summary.failedList.find(row=>row.name==='错校验').raw['姓名'],'错校验');
 const audit=auditResidents([...db.personnel,{name:'空号'},{name:'错号',idCard:'bad'}]);assert.equal(audit.duplicateGroups,1);assert.equal(audit.nameConflictGroups,1);assert.equal(audit.affected,4);
});
test('supplement mode skips unknown ID; unchanged residents do not write; missing name uses existing name',()=>{
 let input=options([{'姓名':'甲','身份证':id},{'姓名':'新居民','身份证':id2}],database(),'supplement');
 let plan=planImport(input,builder);assert.equal(plan.validRows.length,0);assert.equal(plan.summary.unchangedRows,1);assert.equal(plan.summary.failedRows,1);
 input=options([{'身份证':id,'地址':'补充地址'}],database(),'supplement');delete input.mappings.name;plan=planImport(input,builder);assert.equal(plan.validRows[0].fields.name,'甲');
});
test('0/false and custom field arrays survive blank-only deep merge',()=>{
 const differences=[],result=fillEmpty({a:0,b:false,list:[{key:'k',value:'原值'},{key:'blank',value:''}]},{a:1,b:true,list:[{key:'k',value:'新值'},{key:'blank',value:'补齐'},{key:'added',value:'追加'}]},differences);
 assert.equal(result.a,0);assert.equal(result.b,false);assert.equal(result.list[0].value,'原值');assert.equal(result.list[1].value,'补齐');assert.equal(result.list.length,3);assert.equal(differences.length,3);
});
test('preview versions and targets prevent concurrent edits, new residents and changed decisions',()=>{
 const db=database(),plan=planImport(options([{'姓名':'甲','身份证':id,'地址':'补充'}],db),builder);db.personnel[0].phone='同时修改';
 assert.equal(upsertPeople(db,plan.validRows).failed[0].code,'VERSION_CONFLICT');assert.equal(db.personnel[0].address,'');
 const fresh=planImport(options([{'姓名':'新居民','身份证':id2}]),builder);db.personnel.push({id:'concurrent',name:'新居民',id_card:id2,phone:'不能覆盖'});
 assert.equal(upsertPeople(db,fresh.validRows).failed[0].code,'VERSION_CONFLICT');assert.equal(db.personnel.at(-1).phone,'不能覆盖');
 const changed=planImport(options([{'姓名':'乙','身份证':id}]),builder,{[id]:'乙'});changed.validRows[0].fields.name='第三人';assert.equal(upsertPeople(database(),changed.validRows).failed[0].code,'INVALID_INPUT');
});


test('mixed rows import only valid residents; exported error XLSX preserves all fields and can be corrected/reimported',()=>{
 const XLSX=require('xlsx'),{errorTable}=require('../../src/shared/resident-import-errors');
 const db=database(),bad='110105194912310020';
 const rows=[{'姓名':'合成新增','身份证':id2,'电话':'0012345','地址':'正确地址'},
  {'姓名':'张三','身份证':bad,'电话':'0009876','地址':'=HYPERLINK("test")','户号':'00007','组别':'合成三组',__residentSourceRow:8},
  {'姓名':'李四','身份证':'','电话':'00123','地址':'待修正',__residentSourceRow:11}];
 const plan=planImport(options(rows,db),builder);assert.equal(plan.validRows.length,1);assert.equal(plan.summary.failedRows,2);
 const written=upsertPeople(db,plan.validRows);assert.equal(written.insertedRows,1);assert.equal(db.personnel.length,2);assert(!db.personnel.some(p=>p.name==='张三'));
 const {headers,rows:failed}=errorTable(plan.summary.failedList);assert(headers.includes('电话'));assert(!headers.includes('__residentSourceRow'));
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([headers,...failed]);XLSX.utils.book_append_sheet(book,sheet,'待修正错误行');
 const restored=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),resultSheet=restored.Sheets[restored.SheetNames[0]];
 const exported=XLSX.utils.sheet_to_json(resultSheet,{defval:''});assert.equal(exported[0]['电话'],'0009876');assert.equal(exported[0]['户号'],'00007');assert.equal(exported[0]['原表行号'],'8');assert(exported[0]['错误原因'].includes('身份证号'));
 const addressCell=XLSX.utils.encode_cell({r:1,c:headers.indexOf('地址')});assert.equal(resultSheet[addressCell].t,'s');assert.equal(resultSheet[addressCell].f,undefined);
 const makeId=prefix=>{const weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2],checks='10X98765432';return prefix+checks[weights.reduce((sum,w,i)=>sum+w*Number(prefix[i]),0)%11];};
 exported[0]['身份证']=makeId('11010519800101001');exported[1]['身份证']=makeId('11010519810101001');
 const corrected=planImport(options(exported,db),builder);assert.equal(corrected.summary.failedRows,0);assert.equal(corrected.validRows.length,2);
 const imported=upsertPeople(db,corrected.validRows);assert.equal(imported.insertedRows,2);assert.equal(imported.failed.length,0);
 const person=db.personnel.find(p=>p.name==='张三');assert.equal(person.phone,'0009876');assert.equal(person.household_id,'00007');assert.equal(person.address,'=HYPERLINK("test")');
});

test('all invalid input produces an exportable error list without allowing any resident writes',()=>{
 const input=options([{'姓名':'张三','身份证':'bad','电话':'00123'},{'姓名':'李四','身份证':''}]);
 const plan=planImport(input,builder);assert.equal(plan.validRows.length,0);assert.equal(plan.summary.failedRows,2);assert.equal(plan.summary.failedList[0].name,'张三');assert.equal(plan.summary.failedList[1].name,'李四');
});
