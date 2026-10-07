'use strict';

const identityCard = require('../shared/chinese-identity-card');
const {
  buildPersonnelView, upsertPeople, applyPersonFields, checkVersion,
  revision, findPersonRecord, fail,
} = require('./foundation-data-model');

const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value).trim();

function registrationVersion(household, members) {
  return revision({
    householdNo: household.householdNo,
    householdVersion: household.version,
    members: members.map(person => ({ id: person.id, version: person.version })),
  });
}

function householdRegistrationContext(database, householdId) {
  const personnel = buildPersonnelView(database);
  const household = personnel.households.find(item => text(item.id) === text(householdId));
  if (!household || !text(household.householdNo)) fail('HOUSEHOLD_NOT_FOUND', '当前家庭不存在，请关闭后重新打开');
  const members = personnel.people.filter(person => text(person.householdId) === text(household.id));
  const head = members.find(person => text(person.id) === text(household.headPersonId))
    || members.find(person => ['户主', '本人'].includes(text(person.relationToHead))) || members[0] || null;
  const villageGroup = personnel.villageGroups.find(item => text(item.id) === text(household.villageGroupId || head?.villageGroupId)) || null;
  const address = text(head?.address) || text(members.find(person => text(person.address))?.address);
  const registryType = text(head?.registryType) || text(members.find(person => text(person.registryType))?.registryType) || '本村常住户籍';
  const registryStatus = text(head?.registryStatus) || '正常';
  return {
    id: household.id,
    householdNo: household.householdNo,
    version: registrationVersion(household, members),
    memberCount: members.length,
    head: head ? { id: head.id, name: head.name, version: head.version } : null,
    members: members.map(person => ({ id: person.id, name: person.name, relationToHead: person.relationToHead, version: person.version })),
    villageGroupId: villageGroup?.id || null,
    villageGroupName: villageGroup?.name || '',
    address,
    registryType,
    registryStatus,
  };
}

function assertContextVersion(current, supplied) {
  if (supplied == null || Number(supplied) !== Number(current.version)) {
    fail('VERSION_CONFLICT', '家庭资料已发生变化，请重新打开新增页面后再保存');
  }
}

function assertRelationship(context, value) {
  const relationship = text(value);
  if (!relationship) fail('INVALID_INPUT', '请选择新成员与户主的关系');
  if (['户主', '本人'].includes(relationship) && context.head) {
    fail('SECOND_HEAD', `当前家庭已有户主“${context.head.name}”，不能再登记第二个户主`);
  }
  return relationship;
}

function residentLog({ uuid, now, action, household, relationship, previousHouseholdNo = '' }) {
  return {
    id: uuid(), action, result: '已完成', source: '家庭台账', createdAt: now().toISOString(), operator: '当前操作员',
    householdNo: household.householdNo, relationship, previousHouseholdNo,
  };
}

function registerNew(database, context, body, tools) {
  const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};
  const name = text(fields.name);
  if (!name) fail('INVALID_INPUT', '请填写新成员姓名');
  const identity = identityCard.validate(fields.idCard);
  if (!identity.valid) fail('INVALID_ID_CARD', `身份证号${identity.reason}`);
  const relationship = assertRelationship(context, fields.relationToHead);
  const duplicate = buildPersonnelView(database).people.find(person => identityCard.normalize(person.idCard) === identity.normalized);
  if (duplicate) {
    const duplicateHousehold = buildPersonnelView(database).households.find(item => item.id === duplicate.householdId);
    const location = duplicateHousehold?.householdNo ? `，当前户号为 ${duplicateHousehold.householdNo}` : '';
    fail('DUPLICATE_ID_CARD', `该身份证号已建立“${duplicate.name}”的居民档案${location}，不能重复建档`);
  }
  const outcome = upsertPeople(database, [{
    householdNo: context.householdNo,
    villageGroupName: context.villageGroupName,
    tags: list(body.tags),
    fields: {
      name,
      idCard: identity.normalized,
      birthDate: identity.birthDate,
      gender: identity.gender,
      relationToHead: relationship,
      phone: text(fields.phone),
      educationLevel: text(fields.educationLevel),
      ethnicity: text(fields.ethnicity),
      address: context.address,
      registryType: text(fields.registryType) || context.registryType,
      registryStatus: text(fields.registryStatus) || context.registryStatus || '正常',
      countInPopulation: fields.countInPopulation !== false,
    },
  }], tools);
  if (outcome.failed.length) fail(outcome.failed[0].code, outcome.failed[0].error);
  const saved = findPersonRecord(database, outcome.upserted[0].id)?.record;
  if (!saved) fail('SAVE_FAILED', '新成员档案未能保存，请重试');
  saved.residentOperationLog = [residentLog({ ...tools, action: '新增家庭成员', household: context, relationship }), ...list(saved.residentOperationLog)];
  return { action: '新增家庭成员', personId: saved.id };
}

function moveExisting(database, context, body, tools) {
  const found = findPersonRecord(database, body.existingPersonId);
  if (!found) fail('NOT_FOUND', '已有居民档案不存在，请重新查找');
  checkVersion(found.record, body.existingPersonVersion);
  tools.checkWrite(true);
  const relationship = assertRelationship(context, body.relationToHead);
  const currentNo = text(found.record.household_id ?? found.record.householdNo);
  if (currentNo === context.householdNo) fail('ALREADY_MEMBER', '该居民已经是当前家庭成员');
  if (currentNo && body.confirmedMove !== true) {
    fail('MOVE_CONFIRMATION_REQUIRED', `该居民目前属于户号 ${currentNo}，确认后才能调整到本户`);
  }
  if (!text(found.record.id)) found.record.id = found.id;
  applyPersonFields(found.record, {
    relationToHead: relationship,
    address: context.address || text(found.record.address),
  });
  found.record.household_id = context.householdNo;
  found.record.householdNo = context.householdNo;
  found.record.village_group = context.villageGroupName;
  found.record.updated_at = tools.now().toISOString();
  found.record.residentOperationLog = [residentLog({
    ...tools, action: '调整家庭成员', household: context, relationship, previousHouseholdNo: currentNo,
  }), ...list(found.record.residentOperationLog)];
  return { action: '调整家庭成员', personId: found.record.id };
}

function registerHouseholdMember(database, householdId, body = {}, tools = {}) {
  const context = householdRegistrationContext(database, householdId);
  assertContextVersion(context, body.contextVersion);
  const runtime = {
    now: tools.now || (() => new Date()),
    uuid: tools.uuid || require('node:crypto').randomUUID,
    checkWrite: tools.checkWrite || (() => {}),
  };
  const result = body.mode === 'move-existing'
    ? moveExisting(database, context, body, runtime)
    : body.mode === 'create'
      ? registerNew(database, context, body, runtime)
      : fail('INVALID_INPUT', '新增家庭成员的操作类型不正确');
  const updatedContext = householdRegistrationContext(database, householdId);
  const person = buildPersonnelView(database).people.find(item => item.id === result.personId);
  return { ...result, person, household: updatedContext };
}

module.exports = { householdRegistrationContext, registerHouseholdMember };
