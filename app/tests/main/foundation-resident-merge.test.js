'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {previewResidentMerge,mergeResidents}=require('../../src/main/foundation-resident-merge');
const {buildPersonnelView,upsertPeople}=require('../../src/main/foundation-data-model');
const {FoundationBusinessService}=require('../../src/main/foundation-business-service');
const {FoundationAuthService}=require('../../src/main/foundation-auth-service');
const {auditResidents,planImport}=require('../../src/shared/resident-import-review');
const id='11010519491231002X',bad='110105194912310020';
function fixture(){return {personnel:[
 {name:'合成居民',id_card:id,birth_date:'1949-12-31',phone:'原电话',household_id:'001',village_group:'一组',tags:['党员'],party_info:{branch:'旧支部'},customFields:{kept:0},bankAccounts:[{id:'bank1',number:'测试账户'}],disbursementHistory:[{id:'paid1',amount:10}]},
 {id:'source',name:'合成居民',id_card:bad,birthDate:'1949-12-31',phone:'新电话',address:'补齐地址',householdNo:'001',tags:['集体成员'],customFields:{kept:1,added:false},bankAccounts:[{id:'bank2',number:'另一测试账户'}],disbursementHistory:[{id:'paid2',amount:20}]},
 {name:'合成其他人',id_card:'110105194912310011'}],
 households:[{id:'house',householdNo:'001',headPersonId:'source'}],
 disbursementBatches:[{id:'batch',recipients:[{personId:'source',amount:123,nameSnapshot:'历史姓名',idCardSnapshot:bad}]}],
 landParcel:[{id:'land',contractorIds:['source'],holders:[{personId:'source',holderIdCardSnapshot:bad}]}],
 specialPersonnelProfiles:[{personnelId:'source',categoryName:'集体成员'}],
 workItems:[{residentId:'source',description:'source 原始文字'}]};}
function inputFor(db){const people=buildPersonnelView(db).people;return {primaryId:people[0].id,sourceIds:['source'],idCard:id,name:'合成居民'};}
function apply(db,input=inputFor(db)){const preview=previewResidentMerge(db,input);return mergeResidents(db,{...input,token:preview.token,confirmation:'确认合并',operationUuid:'synthetic-merge-001'});}
test('preview is read-only; merge preserves blanks, false/0, accounts, history and stable unrelated IDs',()=>{
 const db=fixture(),before=structuredClone(db),ids=buildPersonnelView(db).people.map(p=>p.id),input=inputFor(db);
 const preview=previewResidentMerge(db,input);assert.deepEqual(db,before);assert(preview.differences.some(d=>d.field==='phone'));assert.equal(preview.result.address,'补齐地址');
 assert.equal(apply(db).removedCount,1);assert.equal(db.personnel[0].phone,'原电话');assert.equal(db.personnel[0].address,'补齐地址');assert.equal(db.personnel[0].customFields.kept,0);assert.equal(db.personnel[0].customFields.added,false);
 assert.equal(db.personnel[0].bankAccounts.length,2);assert.equal(db.personnel[0].disbursementHistory.length,2);assert.deepEqual(db.personnel[0].tags,['党员','集体成员']);
 assert.equal(db.personnel[1].id,ids[2]);assert.deepEqual(db.foundationResidentMerges[0].originals.map(r=>r.person),before.personnel.slice(0,2));
 assert.equal(db.households[0].headPersonId,ids[0]);assert.equal(db.disbursementBatches[0].recipients[0].personId,ids[0]);assert.equal(db.disbursementBatches[0].recipients[0].amount,123);assert.equal(db.disbursementBatches[0].recipients[0].idCardSnapshot,bad);
 assert.equal(db.landParcel[0].holders[0].personId,ids[0]);assert.equal(db.specialPersonnelProfiles[0].personnelId,ids[0]);assert.equal(db.workItems[0].description,before.workItems[0].description);
});
test('same ID/name, same ID/different name and same name/birth/different ID are candidates, name alone is not',()=>{
 const cases=[{idCard:id,name:'甲',birthDate:'1949-12-31'},{idCard:id,name:'乙',birthDate:'1949-12-31'},{idCard:bad,name:'甲',birthDate:'1949-12-31'},{idCard:'other',name:'甲',birthDate:'1980-01-01'}];
 const groups=auditResidents(cases).mergeGroups;assert.equal(groups.length,2);assert(groups.every(g=>g.people.length===2));
});
test('invalid chosen ID, unrelated people, different households and another ID holder block merge',()=>{
 for(const scenario of ['invalid','unrelated','households','third']){
  const db=fixture(),input=inputFor(db);
  if(scenario==='invalid')input.idCard=bad;
  if(scenario==='unrelated')db.personnel[1].name='另外的人';
  if(scenario==='households')db.personnel[1].householdNo='002';
  if(scenario==='third')db.personnel.push({id:'third',id_card:id,name:'另一档案'});
  const before=structuredClone(db);assert.throws(()=>apply(db,input));assert.deepEqual(db,before);
 }
});
test('missing confirmation and stale preview never mutate; same request replay is idempotent',()=>{
 const db=fixture(),input=inputFor(db),preview=previewResidentMerge(db,input),body={...input,token:preview.token,operationUuid:'synthetic-operation-002',confirmation:'确认合并'};
 assert.throws(()=>mergeResidents(db,{...body,confirmation:''}));db.personnel[1].phone='并发修改';const before=structuredClone(db);
 assert.throws(()=>mergeResidents(db,body),{code:'VERSION_CONFLICT'});assert.deepEqual(db,before);
 body.token=previewResidentMerge(db,input).token;mergeResidents(db,body);const merged=structuredClone(db);assert.equal(mergeResidents(db,body).replayed,true);assert.deepEqual(db,merged);
 assert.throws(()=>mergeResidents(db,{...body,name:'另一个姓名'}),{code:'INVALID_INPUT'});
});
test('invalid rows are rejected individually while valid rows can import, even without review metadata',async()=>{
 const options={rows:[{name:'甲',card:id},{name:'乙',card:bad}],mappings:{name:'name',id_card:'card'}};
 const plan=planImport(options,input=>({validRows:input.rows.map(row=>({fields:{name:row.name,idCard:row.card}})),summary:{failedList:[]}}));assert.equal(plan.validRows.length,1);assert.equal(plan.summary.failedList.length,1);
 const db=fixture();const count=db.personnel.length,result=upsertPeople(db,[{fields:{name:'丙',idCard:'110105194912310011'}},{fields:{name:'乙',idCard:bad}}],{validateIdentity:true});assert.equal(result.updatedRows,1);assert.equal(result.failed[0].code,'INVALID_ID_CARD');assert.equal(result.failed[0].index,1);assert.equal(db.personnel.length,count);
});
test('real store merge backs up first, persists across reopen, and does not modify snapshots',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{JsonDatabaseStore}=require('../../src/main/database-store');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'resident-merge-test-'));
 try{
  const store=new JsonDatabaseStore({userDataPath:root});await store.write(fixture());const before=await store.read(),api=new FoundationBusinessService({store,authorize:async()=>{}}),input=inputFor(before);
  const preview=await api.request({method:'POST',path:'/api/v3/people/merge-preview',body:input});assert.equal(preview.ok,true);
  const result=await api.request({method:'POST',path:'/api/v3/people/merge',body:{...input,token:preview.data.token,confirmation:'确认合并',operationUuid:'store-operation-001'}});assert.equal(result.ok,true,result.error?.message);
  const backups=await fs.readdir(store.backupsDirectory);assert.equal(backups.length,1);assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.backupsDirectory,backups[0]),'utf8')),before);
  const reloaded=await new JsonDatabaseStore({userDataPath:root}).read();assert.equal(reloaded.personnel.length,2);assert.equal(reloaded.foundationResidentMerges.length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('backup failure, remote child and member account block all merge writes',async()=>{
 for(const mode of ['backup','child','permission']){
  let writes=0;const db=fixture(),input=inputFor(db),token=previewResidentMerge(db,input).token;
  const auth=new FoundationAuthService({authService:{getStatus:async()=>({authenticated:true,entitlement:{type:'licensed'},account:{role:'member',permissions:{personnel:['view','create','update','delete']}}})}});
  const api=new FoundationBusinessService({authorize:mode==='permission'?scope=>auth.authorize(scope):async()=>{},store:{read:async()=>structuredClone(db),isRemoteChild:async()=>mode==='child',createBackup:async()=>({ok:false}),update:async()=>{writes++;throw Error('must not write');}}});
  const result=await api.request({method:'POST',path:'/api/v3/people/merge',body:{...input,token,confirmation:'确认合并',operationUuid:'denied-operation'}});assert.equal(result.ok,false);assert.equal(writes,0);
 }
});


test('normalized whitespace/lowercase ID finds an existing resident instead of inserting a duplicate',()=>{
 const db={personnel:[{id:'existing',name:'合成居民',id_card:'110105 19491231002x',address:''}]};
 const result=upsertPeople(db,[{fields:{name:'合成居民',idCard:'11010519491231002x',address:'补齐'}}],{validateIdentity:true});
 assert.equal(result.failed.length,0);assert.equal(result.updatedRows,1);assert.equal(db.personnel.length,1);assert.equal(db.personnel[0].id_card,id);
});
