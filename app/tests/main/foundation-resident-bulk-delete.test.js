'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {FoundationBusinessService}=require('../../src/main/foundation-business-service');
const {FoundationAuthService}=require('../../src/main/foundation-auth-service');
const {JsonDatabaseStore}=require('../../src/main/database-store');
const {buildPersonnelView,revision}=require('../../src/main/foundation-data-model');
function fixture(count=3){return {personnel:Array.from({length:count},(_,i)=>({...(i%2?{id:`synthetic-${i}`} :{}),name:`合成居民${i}`,id_card:`FAKE-${i}`,bankAccounts:[{number:`FAKE-CARD-${i}`}],customFields:{retained:i}})),
 finances:[{id:'keep-finance'}],landParcel:[{id:'keep-land'}],disbursementBatches:[{id:'keep-payment'}],specialPersonnelProfiles:[{id:'keep-profile'}]};}
const bodyFor=db=>({confirmation:'确认删除',operationUuid:'synthetic-operation-1234',items:buildPersonnelView(db).people.map(p=>({id:p.id,baseVersion:p.version}))});
function setup(initial,authorize=async()=>{}){
 let db=structuredClone(initial),writes=0;
 const store={read:async()=>structuredClone(db),update:async fn=>{const draft=structuredClone(db);const result=await fn(draft);db=draft;writes++;return {data:structuredClone(db),result};}};
 const api=new FoundationBusinessService({store,authorize});
 return {api,db:()=>db,writes:()=>writes};
}
const request=(api,body)=>api.request({method:'DELETE',path:'/api/v3/people',body});
test('5,368 residents, including legacy index IDs, delete atomically in one write and preserve recovery/payment data',async()=>{
 const before=fixture(5368),s=setup(before),started=performance.now();
 const result=await request(s.api,bodyFor(before));
 assert.equal(result.ok,true);assert.deepEqual(result.data,{deletedCount:5368,remainingCount:0});assert.equal(s.writes(),1);
 assert.equal(s.db().personnel.length,0);assert.deepEqual(s.db().foundationDeletedResidents.map(r=>r.person),before.personnel);
 for(const key of ['finances','landParcel','disbursementBatches','specialPersonnelProfiles'])assert.deepEqual(s.db()[key],before[key]);
 assert.equal(s.db().operationLogs.length,1);assert.equal(s.db().operationLogs[0].source,'foundation');assert.equal(s.db().operationLogs[0].residentIds.length,5368);console.log(`bulk delete 5368 synthetic residents: ${(performance.now()-started).toFixed(1)} ms`);
});
test('one stale or missing resident aborts the entire batch, with no partial deletion or recovery entries',async()=>{
 for(const kind of ['stale','missing']){
  const before=fixture(),body=bodyFor(before);if(kind==='stale')body.items[1].baseVersion++;else body.items[1].id='missing';
  const s=setup(before),result=await request(s.api,body);assert.equal(result.ok,false);assert.equal(result.error.code,'VERSION_CONFLICT');assert.equal(s.writes(),0);assert.deepEqual(s.db(),before);
 }
});
test('concurrently added residents are preserved, and replays cannot delete them or duplicate recovery entries',async()=>{
 const before=fixture(),body=bodyFor(before),s=setup({...before,personnel:[...before.personnel,{id:'new-concurrent',name:'合成新增'}]});
 assert.deepEqual((await request(s.api,body)).data,{deletedCount:3,remainingCount:1});
 const replay=await request(s.api,body);assert.equal(replay.data.replayed,true);assert.equal(s.db().personnel[0].id,'new-concurrent');assert.equal(s.db().foundationDeletedResidents.length,3);
 const altered={...body,items:[{id:'new-concurrent',baseVersion:revision(s.db().personnel[0])}]};
 assert.equal((await request(s.api,altered)).error.code,'INVALID_INPUT');assert.equal(s.db().personnel.length,1);
});
test('confirmation, duplicate IDs, missing versions and delete permissions are checked before any data changes',async()=>{
 const before=fixture(),base=bodyFor(before);
 for(const body of [{...base,confirmation:''},{...base,items:[]},{...base,items:[base.items[0],base.items[0]]},{...base,items:[{id:base.items[0].id}]},{...base,operationUuid:''}]){
  const s=setup(before);assert.equal((await request(s.api,body)).error.code,'INVALID_INPUT');assert.equal(s.writes(),0);assert.deepEqual(s.db(),before);
 }
 const auth=new FoundationAuthService({authService:{getStatus:async()=>({authenticated:true,entitlement:{type:'licensed'},account:{role:'member',permissions:{personnel:['view','create','update']}}})}});
 const denied=setup(before,scope=>auth.authorize(scope));assert.equal((await request(denied.api,base)).error.code,'FORBIDDEN');assert.deepEqual(denied.db(),before);
});
test('write failure reports failure and rolls back, and later requests remain usable',async()=>{
 const before=fixture(),db=structuredClone(before);let fail=true;
 const api=new FoundationBusinessService({authorize:async()=>{},store:{read:async()=>structuredClone(db),update:async fn=>{
  const draft=structuredClone(db),result=await fn(draft);if(fail)throw Error('合成磁盘写入失败');Object.assign(db,draft);return {data:draft,result};
 }}});
 const failed=await request(api,bodyFor(before));assert.equal(failed.ok,false);assert.match(failed.error.message,/写入失败/);assert.deepEqual(db,before);
 fail=false;assert.equal((await request(api,bodyFor(before))).ok,true);assert.equal(db.personnel.length,0);
});
test('real JSON store persists the whole batch and recovery history across restart with one disk write',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'community-resident-delete-'));
 try{
  const store=new JsonDatabaseStore({userDataPath:dir}),before=fixture(5368);await store.write(before);
  const original=store.writeSnapshot.bind(store);let writes=0;store.writeSnapshot=async data=>{writes++;return original(data);};
  const api=new FoundationBusinessService({store,authorize:async()=>{}});const result=await request(api,bodyFor(before));assert.equal(result.ok,true);assert.equal(writes,1);
  const restored=await new JsonDatabaseStore({userDataPath:dir}).read();assert.equal(restored.personnel.length,0);assert.deepEqual(restored.foundationDeletedResidents.map(r=>r.person),before.personnel);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
