'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { findPersonRecord, personRecordId, PERSON_FIELDS, fail } = require('./foundation-data-model');
const identity = require('../shared/chinese-identity-card');
const { duplicateCandidates } = require('../shared/resident-import-review');
const text = value => String(value ?? '').trim();
const clone = value => structuredClone(value);
const blank = value => value == null || typeof value === 'string' && !value.trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const list = value => Array.isArray(value) ? value : [];
const cardOf = person => identity.normalize(person.idCard || person.id_card);
const aliases = { ...PERSON_FIELDS, householdNo:['household_id','householdNo'], villageGroupName:['village_group','villageGroupName'], customFields:['customFields','custom_fields'] };
const metadata = new Set(['id','created_at','createdAt','updated_at','updatedAt','version','idCard','name']);

function canonical(person) {
  const result = clone(person);
  for (const [key, keys] of Object.entries(aliases)) {
    const chosen = keys.find(alias => !blank(person[alias]));
    keys.forEach(alias => delete result[alias]);
    if (chosen) result[key] = clone(person[chosen]);
  }
  return result;
}
function mergeValue(current, incoming, differences, field) {
  if (blank(incoming)) return clone(current);
  if (blank(current)) return clone(incoming);
  if (Array.isArray(current) && Array.isArray(incoming)) {
    const result = clone(current);
    for (const item of incoming) {
      if (result.some(row => isDeepStrictEqual(row,item))) continue;
      const key = item && typeof item === 'object' && (item.id || item.key || item.label);
      const index = key ? result.findIndex(row => row && (row.id || row.key || row.label) === key) : -1;
      if (index < 0) result.push(clone(item));
      else result[index] = mergeValue(result[index],item,differences,`${field}.${key}`);
    }
    return result;
  }
  if (current && incoming && typeof current === 'object' && typeof incoming === 'object' && !Array.isArray(current) && !Array.isArray(incoming)) {
    const result = clone(current);
    for (const [key,value] of Object.entries(incoming)) if (!['__proto__','constructor','prototype'].includes(key)) result[key] = mergeValue(result[key],value,differences,`${field}.${key}`);
    return result;
  }
  if (!isDeepStrictEqual(current,incoming)) differences.push({field,current:clone(current),incoming:clone(incoming)});
  return clone(current);
}
function selection(input) {
  const primaryId = text(input.primaryId), sourceIds = list(input.sourceIds).map(text).sort();
  if (!primaryId || !sourceIds.length || sourceIds.length > 49 || sourceIds.includes(primaryId) || new Set(sourceIds).size !== sourceIds.length || sourceIds.some(id => !id)) fail('INVALID_INPUT','请选择主档及 1 至 49 份重复档案');
  return {primaryId,sourceIds,idCard:identity.normalize(input.idCard),name:text(input.name)};
}

function plan(db,input) {
  const selected = selection(input), ids = [selected.primaryId,...selected.sourceIds];
  const found = ids.map(id => { const match = findPersonRecord(db,id); if (!match) fail('VERSION_CONFLICT','待合并档案已变化，请重新查验'); return match; });
  const records = found.map(row => row.record);
  const candidates = duplicateCandidates(records.map((row,index) => ({...row,id:ids[index]})));
  if (!candidates.some(group => group.people.length === records.length)) fail('INVALID_INPUT','这些档案不满足重复核对条件，请先核实姓名、出生日期及身份证');
  const validation = identity.validate(selected.idCard);
  if (!validation.valid) fail('INVALID_ID_CARD',`保留的身份证号${validation.reason}；请先修改档案核实正确号码`);
  if (!records.some(row => cardOf(row) === selected.idCard) || !records.some(row => text(row.name) === selected.name) || !selected.name) fail('INVALID_INPUT','请选择已核实档案中的姓名和正确身份证号');
  if (list(db.personnel).some((row,index) => !ids.includes(personRecordId(row,index)) && cardOf(row) === selected.idCard)) fail('DUPLICATE_ID_CARD','还有其他档案使用此身份证，请重新检查并一并核对');
  const normalized = records.map(canonical);
  const households = new Set(normalized.map(row => text(row.householdNo)).filter(Boolean));
  if (households.size > 1) fail('HOUSEHOLD_CONFLICT','两份档案的户号不同，请先通过“修改档案”核实家庭归属，再合并');
  let combined = normalized[0]; const differences = [];
  for (const source of normalized.slice(1)) for (const [key,value] of Object.entries(source)) {
    if (!metadata.has(key) && !['__proto__','constructor','prototype'].includes(key)) combined[key] = mergeValue(combined[key],value,differences,key);
  }
  combined.idCard = selected.idCard; combined.name = selected.name;
  // Any conflicting date/gender remains visible for the human to verify. An ID
  // correction itself follows the existing editor contract and derives these.
  if (cardOf(records[0]) !== selected.idCard) {
    for (const key of ['birthDate','gender']) {
      if (!blank(combined[key]) && combined[key] !== validation[key]) differences.push({field:key,current:combined[key],incoming:validation[key],action:'随核实的身份证更正'});
      combined[key] = validation[key];
    }
  }
  const merged = {...clone(records[0]),...combined,id:selected.primaryId};
  for (const [key,keys] of Object.entries(aliases)) if (Object.hasOwn(combined,key)) for (const alias of keys) merged[alias] = clone(combined[key]);
  // Mirror specialty containers consistently for legacy editors and filters.
  for (const key of ['party_info','veteran_info','low_income_info','disability_info','labor_info','student_info','poverty_info','yulu_info','monitor_info','special_custom_info']) {
    const customKey = key === 'special_custom_info' ? 'specialCustomInfo' : key;
    if (Object.hasOwn(merged,key) || Object.hasOwn(merged.customFields || {},customKey)) {
      const value = mergeValue(merged[key],merged.customFields?.[customKey],differences,key);
      merged[key] = value; (merged.customFields ||= {})[customKey] = clone(value);
      merged.custom_fields = clone(merged.customFields);
    }
  }
  return {selected,found,merged,differences,token:hash({database:db,selected})};
}

function previewResidentMerge(db,input) {
  const prepared = plan(db,input);
  return {token:prepared.token,primaryId:prepared.selected.primaryId,sourceIds:prepared.selected.sourceIds,
    name:prepared.merged.name,idCard:prepared.selected.idCard,differences:prepared.differences,
    result:canonical(prepared.merged),sourceCount:prepared.found.length};
}

// Only explicit relationship keys in business collections are redirected.
// Historical names, card snapshots, amounts and audit/import logs stay intact.
const referenceKeys = new Set(['personId','person_id','residentId','resident_id','personnelId','personnel_id','headPersonId','contractorId']);
const referenceLists = new Set(['personIds','residentIds','contractorIds']);
const referenceCollections = ['households','specialPersonnelProfiles','partyMembers','partyActivists','visitRecords','dutyRecords','dutyPlans','dutyCadres','dutyPublicPosts',
  'landParcel','lands','resourceContracts','contractFeeLedgers','contractFeeBatches','contractFeeReceipts','contractFeeAdvances','contractFeeDistributionPlans','contractFeeDistributionBatches',
  'disbursementBatches','disbursementProfiles','farmlandSubsidyLedgers','certificates','certificateRecords','documents','workItems','workEvidence','workProgressRecords','workResourceEntries','workAcceptances'];
function redirect(value, sources, target) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(row => redirect(row,sources,target)); return; }
  for (const [key,child] of Object.entries(value)) {
    if (referenceKeys.has(key) && sources.has(text(child))) value[key] = target;
    else if (referenceLists.has(key) && Array.isArray(child)) value[key] = [...new Set(child.map(id => sources.has(text(id)) ? target : id))];
    else if (!/snapshot|history|log/i.test(key)) redirect(child,sources,target);
  }
}
function mergeResidents(db,input,{now = () => new Date(),uuid = randomUUID} = {}) {
  const selected = selection(input), operationUuid = text(input.operationUuid);
  if (input.confirmation !== '确认合并' || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationUuid)) fail('INVALID_INPUT','请核对差异并确认合并');
  const fingerprint = hash(selected), existing = list(db.foundationResidentMerges).find(row => row.operationUuid === operationUuid);
  if (existing) {
    if (existing.fingerprint !== fingerprint) fail('INVALID_INPUT','合并请求已变化，请重新预览');
    return {...existing.result,replayed:true};
  }
  const prepared = plan(db,input);
  if (!input.token || input.token !== prepared.token) fail('VERSION_CONFLICT','预览后工作区已发生修改，请重新查看差异再合并');
  const at = now().toISOString(), sources = new Set(selected.sourceIds), originals = prepared.found.map(row => ({id:row.id,person:clone(row.record)}));
  // Legacy IDs contain the array index: pin them before removing rows so every
  // other resident retains their identity and existing links.
  db.personnel.forEach((row,index) => { if (!text(row.id)) row.id = personRecordId(row,index); });
  prepared.merged.updated_at = at;
  prepared.merged.residentOperationLog = [{id:uuid(),occurredAt:at,action:'合并重复居民档案',sourceType:'人工核对',sourceIds:selected.sourceIds},...list(prepared.merged.residentOperationLog)];
  db.personnel = db.personnel.filter(row => !sources.has(text(row.id))).map(row => text(row.id) === selected.primaryId ? prepared.merged : row);
  for (const key of referenceCollections) redirect(db[key],sources,selected.primaryId);
  const result = {merged:true,primaryId:selected.primaryId,removedCount:sources.size,remainingCount:db.personnel.length};
  (db.foundationResidentMerges ||= []).push({id:uuid(),operationUuid,fingerprint,createdAt:at,selection:selected,originals,differences:prepared.differences,result});
  (db.operationLogs ||= []).push({id:uuid(),action:'合并重复居民档案',createdAt:at,source:'foundation',residentIds:[selected.primaryId,...selected.sourceIds]});
  return result;
}
module.exports = {previewResidentMerge,mergeResidents};
