'use strict';
const { revision, checkVersion, upsertPeople, findPersonRecord, fail } = require('./foundation-data-model');
const { isDeepStrictEqual } = require('node:util');
const identityCard = require('../shared/chinese-identity-card');
const ACCOUNT_KEYS = ['bankAccounts', 'bank_card', 'bank_account', 'bankCard', 'residentOperationLog'];
function editorSnapshot(db, id) {
  const person = findPersonRecord(db, id)?.record;
  if (!person) fail('NOT_FOUND', '居民资料不存在，请刷新后重试');
  return { person: structuredClone(person), version: revision(person), customFields: structuredClone(db.residentCustomFields || []), customFieldsVersion: revision(db.residentCustomFields || []) };
}
async function saveEditor(db, input, { authorize, now, uuid }) {
  const original = editorSnapshot(db, input.id);
  checkVersion(original.person, input.baseVersion);
  const definitions = input.customFields || original.customFields;
  if (!Array.isArray(definitions)) fail('INVALID_INPUT', '扩展字段格式不正确');
  if (!isDeepStrictEqual(definitions, original.customFields)) {
    await authorize({ method: 'PATCH', path: '/system-settings' });
    if (input.customFieldsVersion !== original.customFieldsVersion) fail('VERSION_CONFLICT', '扩展字段已被其他页面修改，请重新打开后保存');
  }
  const fields = structuredClone(input.fields || {});
  const previousIdentity = identityCard.normalize(original.person.idCard || original.person.id_card);
  const requestedIdentity = identityCard.normalize(fields.idCard ?? fields.id_card);
  const identityChanged = previousIdentity !== requestedIdentity;
  let identityProfile = null;
  if (identityChanged) {
    const confirmation = input.identityChangeConfirmation || {};
    if (confirmation.firstConfirmed !== true || confirmation.secondConfirmed !== true) {
      fail('IDENTITY_CONFIRM_REQUIRED', '更正身份证号必须完成两次确认');
    }
    if (identityCard.normalize(confirmation.previousIdCard) !== previousIdentity
      || identityCard.normalize(confirmation.newIdCard) !== requestedIdentity) {
      fail('INVALID_INPUT', '身份证更正确认内容与当前资料不一致，请重新操作');
    }
    identityProfile = identityCard.validate(requestedIdentity);
    if (!identityProfile.valid) fail('INVALID_ID_CARD', `身份证号${identityProfile.reason}`);
    fields.idCard = identityProfile.normalized;
    delete fields.id_card;
    fields.birthDate = identityProfile.birthDate;
    fields.gender = identityProfile.gender;
  }
  fields.customFields = { ...(fields.customFields || {}) };
  for (const def of definitions) if (Object.hasOwn(input.customValues || {}, def.id)) fields.customFields[def.id] = input.customValues[def.id];
  const result = upsertPeople(db, [{ ...input, fields }], { now, uuid });
  if (result.failed.length) fail('INVALID_INPUT', result.failed[0].message || result.failed[0].error || '居民资料保存失败');
  const person = db.personnel.find(p => String(p.id) === String(input.id));
  for (const [key, value] of Object.entries(input.accountChanges || {})) {
    if (!ACCOUNT_KEYS.includes(key)) fail('INVALID_INPUT', '账户资料包含不支持的字段');
    person[key] = structuredClone(value);
  }
  if (Object.hasOwn(input.accountChanges || {}, 'bankAccounts') && !Array.isArray(person.bankAccounts)) fail('INVALID_INPUT', '银行卡列表格式不正确');
  if (!isDeepStrictEqual(definitions, original.customFields)) db.residentCustomFields = structuredClone(definitions);
  const occurredAt = now().toISOString();
  const operationEntries = [];
  if (identityChanged) {
    const identityEntry = {
      id: uuid(), occurredAt, action: '更正身份证号', sourceType: '居民编辑',
      description: `身份证号由 ${previousIdentity || '未登记'} 更正为 ${identityProfile.normalized}；出生日期同步为 ${identityProfile.birthDate}，性别同步为${identityProfile.gender}`,
      previousIdCard: previousIdentity, newIdCard: identityProfile.normalized,
      birthDate: identityProfile.birthDate, gender: identityProfile.gender, confirmedTwice: true,
    };
    operationEntries.push(identityEntry);
    person.identityCardHistory = [structuredClone(identityEntry), ...(person.identityCardHistory || [])];
  }
  operationEntries.push({ id: uuid(), occurredAt, action: '编辑居民资料', description: '统一保存居民基础信息、收款账户及扩展资料', sourceType: '居民编辑' });
  person.residentOperationLog = [...operationEntries, ...(person.residentOperationLog || [])];
  return { saved: true, id: person.id, identityChanged };
}
module.exports = { editorSnapshot, saveEditor };
