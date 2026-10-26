const test = require('node:test');
const assert = require('node:assert/strict');
const {mutatePersonnelAction} = require('../../src/main/foundation-personnel-actions');
const {revision} = require('../../src/main/foundation-data-model');
const model = import('../../src/renderer/foundation/special-category-model.mjs');
test('renaming, deleting and restoring a builtin preserves canonical identity and all resident data', async()=>{
  const {categoryCatalog,categoryChanges,categoryWrite,deletedStatKeys}=await model;
  const db={personnel:[{id:'synthetic',tags:['雨露计划','脱贫户'],yulu_info:{school:'合成学校'},poverty_info:{year:'2020'},special_custom_info:{standard_yulu:{f_existing:'保留'}}}],specialCategories:[]};
  const before=structuredClone(db.personnel);let clock=Date.parse('2026-10-09T00:00:00Z');
  const options={uuid:()=> 'synthetic-config',now:()=>new Date(clock+=1000)};
  const catalog=()=>categoryCatalog(db.specialCategories.map(r=>({...r,version:revision(r)})));
  const get=()=>catalog().find(c=>c.code==='standard_yulu');
  const write=changes=>{const request=categoryWrite(get(),changes);return mutatePersonnelAction(db,request.method,request.path.replace('/api/v3',''),request.body,options);};
  write(categoryChanges(get(),{displayName:'助学补贴',fieldSchema:[{key:'f_existing',label:'申请说明',type:'text'}]},catalog()));
  assert.equal(db.specialCategories[0].name,'雨露计划');assert.equal(get().displayName,'助学补贴');
  const stale=categoryWrite(get(),{displayName:'旧页面的名称'});
  write({deletedAt:'2026-10-09T00:01:00Z'});assert.deepEqual(deletedStatKeys(catalog()),['yulu']);
  assert.throws(()=>mutatePersonnelAction(db,stale.method,stale.path.replace('/api/v3',''),stale.body,options),e=>e.code==='VERSION_CONFLICT');
  const reloaded=JSON.parse(JSON.stringify(db));assert.equal(categoryCatalog(reloaded.specialCategories).find(c=>c.code==='standard_yulu').deleted,true);
  write({deletedAt:null});assert.equal(get().deleted,false);assert.equal(get().displayName,'助学补贴');assert.equal(get().fieldSchema[0].key,'f_existing');
  assert.deepEqual(db.personnel,before);
});
test('empty and conflicting labels or invalid extension fields cannot be saved',async()=>{
 const {categoryCatalog,categoryChanges}=await model;const all=categoryCatalog([{id:'custom',name:'本村关注对象',isSystem:0}]);const c=all.find(c=>c.code==='standard_yulu');
 for(const name of ['', '党员','脱贫农户','本村关注对象'])assert.throws(()=>categoryChanges(c,{displayName:name,fieldSchema:[]},all));
 assert.throws(()=>categoryChanges(c,{displayName:'助学补贴',fieldSchema:[{key:'f1',label:'就读学校',type:'text'}]},all));
 assert.throws(()=>categoryChanges(c,{displayName:'助学补贴',fieldSchema:[{key:'f1',label:'阶段',type:'select',options:'小学，小学'}]},all));
 const fields=[{key:'f1',label:'阶段',type:'select',options:'小学，中学'},{key:'f2',label:'月份',type:'month'}];
 const changes=categoryChanges(c,{displayName:'助学补贴',fieldSchema:fields},all);assert.deepEqual(changes.fieldSchema[0].options,['小学','中学']);assert.equal(changes.fieldSchema[1].key,'f2');
});
test('existing aliases still map to builtin categories, custom labels remain distinct',async()=>{
 const {categoryCatalog,labelCategory}=await model;const all=categoryCatalog([{id:'sc_standard_poverty',code:'standard_poverty',name:'脱贫户',displayName:'巩固脱贫户',fieldSchema:[]},{id:'custom',name:'特色台账',displayName:'自定义展示',isSystem:0}]);
 assert.equal(labelCategory('脱贫农户',all).displayName,'巩固脱贫户');assert.equal(all.filter(c=>c.code==='standard_poverty').length,1);assert.equal(labelCategory('特色台账',all).isSystem,false);
});
test('saving other resident fields retains deleted category data and removed extension values',async()=>{
 const {categoryCatalog,preserveCategoryHistory}=await model;
 const catalog=categoryCatalog([{id:'sc_standard_yulu',code:'standard_yulu',name:'雨露计划',deletedAt:'deleted'}, {id:'custom',code:'custom',name:'历史台账',deletedAt:'deleted'}, {id:'sc_standard_poverty',code:'standard_poverty',name:'脱贫户',fieldSchema:[{key:'editable',label:'现在字段',type:'text'}]}]);
 const person={tags:['雨露计划','历史台账','脱贫户'],customFields:{yulu_info:{school:'历史学校',subsidy:500},specialCustomInfo:{standard_yulu:{name:'雨露计划',fields:[{key:'hidden',label:'旧字段',value:'历史值'}]},custom:{name:'历史台账',fields:[{key:'old',value:'自定义历史值'}]},standard_poverty:{name:'脱贫户',fields:[{key:'removed',value:'移除字段仍保留'},{key:'editable',value:'修改前'}]}}}};
 const original=JSON.stringify(person);const payload={tags:['脱贫户'],fields:{phone:'新的电话',customFields:{specialCustomInfo:{sc_standard_poverty:{name:'脱贫户',fields:[{key:'editable',value:'修改后'}]}}}}};
 const saved=preserveCategoryHistory(person,payload,catalog);assert.equal(saved.fields.phone,'新的电话');assert.deepEqual(saved.tags.sort(),person.tags.slice().sort());assert.deepEqual(saved.fields.customFields.yulu_info,person.customFields.yulu_info);
 assert.deepEqual(saved.fields.customFields.specialCustomInfo.custom,person.customFields.specialCustomInfo.custom);
 assert.deepEqual(saved.fields.customFields.specialCustomInfo.sc_standard_poverty.fields,[{key:'editable',value:'修改后'},{key:'removed',value:'移除字段仍保留'}]);
 assert.equal(JSON.stringify(person),original);
});

test('basic field metadata supports names, stable option values, deletion and restore without changing types',async()=>{
 const {categoryCatalog,categoryChanges}=await model;const all=categoryCatalog(),c=all.find(c=>c.key==='poverty');
 const changes=categoryChanges(c,{displayName:c.displayName,fieldSchema:[],basicFieldOverrides:{
  year:{label:'脱贫年份',deleted:true},is_monitor:{label:'监测状态',options:[{value:'否',label:'未纳入'},{value:'是',label:'已纳入',deleted:true},{value:'new',label:'待核实'}]}
 }},all);
 const restored=categoryCatalog([{id:c.id,code:c.code,name:c.name,...changes}]).find(c=>c.key==='poverty');
 assert.equal(restored.basicSchema.find(f=>f.key==='year').type,'number');assert.equal(restored.basicSchema.find(f=>f.key==='year').deleted,true);
 assert.equal(restored.basicSchema.find(f=>f.key==='is_monitor').options[0].value,'否');
 assert.throws(()=>categoryChanges(c,{displayName:c.displayName,basicFieldOverrides:{year:{type:'text'}}},all),/原数据类型/);
 assert.throws(()=>categoryChanges(c,{displayName:c.displayName,basicFieldOverrides:{new_key:{label:'错误'}}},all),/标识/);
 assert.throws(()=>categoryChanges(c,{displayName:c.displayName,basicFieldOverrides:{year:{label:'主要帮扶措施'}}},all),/重复/);
 assert.throws(()=>categoryChanges(c,{displayName:c.displayName,basicFieldOverrides:{is_monitor:{options:[]}}},all),/至少/);
 const reset=categoryChanges(restored,{displayName:c.displayName,basicFieldOverrides:{year:{label:'脱贫年份',deleted:false}}},all);
 assert.equal(categoryCatalog([{id:c.id,code:c.code,name:c.name,...reset}]).find(c=>c.key==='poverty').basicSchema.find(f=>f.key==='year').deleted,false);
 assert.deepEqual(categoryChanges(c,{displayName:c.displayName},all).basicFieldOverrides,{});
});
test('saving a resident preserves removed basic values while allowing visible fields and configured selects to change',async()=>{
 const {categoryCatalog,preserveCategoryHistory}=await model;
 const all=categoryCatalog([{id:'sc_standard_yulu',code:'standard_yulu',name:'雨露计划',basicFieldOverrides:{school:{label:'就读院校',deleted:true}}},{id:'sc_standard_poverty',code:'standard_poverty',name:'脱贫户',basicFieldOverrides:{is_monitor:{options:[{value:'否',label:'未纳入'},{value:'是',label:'已纳入'}]}}}]);
 const person={tags:['雨露计划','脱贫户'],customFields:{yulu_info:{school:'旧学校',major:'旧专业'},poverty_info:{is_monitor:'否'}}};
 const payload={tags:person.tags,fields:{phone:'新电话',customFields:{yulu_info:{school:'',major:'新专业'},poverty_info:{is_monitor:'否'}}}};
 const saved=preserveCategoryHistory(person,payload,all,{povertyInfo:{is_monitor:'是'}});
 assert.equal(saved.fields.customFields.yulu_info.school,'旧学校');assert.equal(saved.fields.customFields.yulu_info.major,'新专业');assert.equal(saved.fields.customFields.poverty_info.is_monitor,'是');
 assert.equal(person.customFields.yulu_info.major,'旧专业');
});

test('all builtin field descriptors retain their original storage keys and control types',async()=>{
 const {categoryCatalog}=await model;const all=categoryCatalog();assert.equal(all.reduce((n,c)=>n+c.basicSchema.length,0),40);
 for(const c of all){assert.equal(new Set(c.basicSchema.map(f=>f.key)).size,c.basicSchema.length);for(const f of c.basicSchema){assert.ok(f.controlId.startsWith('p_'));assert.ok(['text','number','select','date','month'].includes(f.type));assert.ok(f.storageGroup.endsWith('_info'));}}
 assert.equal(all.find(c=>c.key==='student').basicSchema.find(f=>f.key==='graduation').type,'month');
});
