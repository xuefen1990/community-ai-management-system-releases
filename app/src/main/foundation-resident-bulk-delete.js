'use strict';
const {checkVersion,personRecordId,revision,fail}=require('./foundation-data-model');

// Resolve every ID against the same snapshot, including index-derived legacy
// IDs. Validate everything before changing anything; the store commits once.
function deleteResidents(database,body,{now,uuid}) {
 const items=body.items;
 if(body.confirmation!=='确认删除' || !Array.isArray(items) || !items.length || items.length>100000)fail('INVALID_INPUT','请确认要删除的居民档案后重试');
 if(typeof body.operationUuid!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.operationUuid))fail('INVALID_INPUT','删除操作标识不正确');
 const targets=new Map();
 for(const item of items){
  if(!item || typeof item.id!=='string' || !item.id || targets.has(item.id) || item.baseVersion==null)fail('INVALID_INPUT','删除名单或版本不正确，请刷新后重试');
  targets.set(item.id,item.baseVersion);
 }
 const fingerprint=revision([...targets].sort(([a],[b])=>a.localeCompare(b)));
 const completed=(database.operationLogs || []).find(row=>row.residentDeleteOperation===body.operationUuid);
 if(completed){
  if(completed.requestFingerprint!==fingerprint)fail('INVALID_INPUT','删除操作标识已被使用，请刷新后重试');
  return {...completed.result,replayed:true};
 }
 const retained=[],removed=[];
 for(const [index,person]of(database.personnel || []).entries()){
  const id=personRecordId(person,index);
  if(!targets.has(id)){retained.push(person);continue;}
  checkVersion(person,targets.get(id));removed.push({id,person});
 }
 if(removed.length!==targets.size)fail('VERSION_CONFLICT','部分居民档案已被删除或变更，本次未执行，请刷新后重新确认');
 const deletedAt=now().toISOString();
 database.foundationDeletedResidents ||= [];
 for(const {person}of removed)database.foundationDeletedResidents.push({id:uuid(),person:structuredClone(person),deletedAt});
 database.personnel=retained;
 const result={deletedCount:removed.length,remainingCount:retained.length};
 (database.operationLogs ||= []).push({id:uuid(),action:'居民档案批量删除',residentIds:removed.map(row=>row.id),createdAt:deletedAt,source:'foundation',
  residentDeleteOperation:body.operationUuid,requestFingerprint:fingerprint,result});
 return result;
}
module.exports={deleteResidents};
