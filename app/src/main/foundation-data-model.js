'use strict';

// v2.6.4 is a view of our database, not a second database. Never rebuild a
// resident from its visible form: bank accounts and extension history live on
// the same original record and must survive every basic-information edit.
const { createHash, randomUUID } = require('node:crypto');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const list = (value) => Array.isArray(value) ? value : [];
const string = (value) => value == null ? '' : String(value);
const copy = (value) => structuredClone(value);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function revision(value) {
  return Number.parseInt(createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12), 16) || 1;
}
function derivedId(kind, value) { return `foundation:${kind}:${encodeURIComponent(string(value))}`; }
const PERSON_FIELDS = Object.freeze({
  idCard: ['idCard', 'id_card'], name: ['name'], gender: ['gender'],
  birthDate: ['birth_date', 'birthDate'], phone: ['phone'], address: ['address'],
  relationToHead: ['relation_to_head', 'relationToHead'], educationLevel: ['education_level', 'educationLevel'],
  ethnicity: ['ethnicity'], registryType: ['registry_type', 'registryType'],
  registryStatus: ['registry_status', 'registryStatus'], countInPopulation: ['include_in_pop', 'countInPopulation'],
  stationedUnit: ['send_unit', 'stationedUnit'], stationedPosition: ['work_team_duty', 'stationedPosition'],
  cancelReason: ['cancellation_reason', 'cancelReason'], cancelDate: ['cancellation_date', 'cancelDate'],
});
const SPECIAL_FIELDS = ['party_info', 'veteran_info', 'low_income_info', 'disability_info', 'labor_info',
  'student_info', 'poverty_info', 'yulu_info', 'monitor_info', 'special_custom_info'];
function field(record, names, fallback = '') {
  for (const name of names) if (record[name] != null) return record[name];
  return fallback;
}
function personFields(record) {
  const result = {};
  for (const [key, aliases] of Object.entries(PERSON_FIELDS)) result[key] = field(record, aliases);
  result.registryType ||= '本村常住户籍';
  result.registryStatus ||= result.registryType === '已注销' ? '已注销' : '正常';
  result.countInPopulation = field(record, PERSON_FIELDS.countInPopulation, true) !== false
    && field(record, PERSON_FIELDS.countInPopulation, true) !== 0;
  result.tags = copy(list(record.tags));
  result.customFields = copy(record.customFields || record.custom_fields || {});
  for (const key of SPECIAL_FIELDS) if (own(record, key)) {
    result.customFields[key === 'special_custom_info' ? 'specialCustomInfo' : key] = copy(record[key]);
  }
  return result;
}
function personRecordId(record, index = -1) {
  const existing = string(record?.id).trim();
  if (existing) return existing;
  const card = string(field(record || {}, PERSON_FIELDS.idCard)).trim().toUpperCase();
  const name = string(record?.name).trim();
  const birthDate = string(field(record || {}, PERSON_FIELDS.birthDate)).trim();
  return derivedId('person', `${index}:${card}:${name}:${birthDate}`);
}
function findPersonRecord(database, id) {
  const requested = string(id);
  const people = list(database.personnel);
  const index = people.findIndex((record, recordIndex) => personRecordId(record, recordIndex) === requested);
  return index < 0 ? null : { record: people[index], index, id: personRecordId(people[index], index) };
}

function buildPersonnelView(database) {
  const groups = new Map();
  for (const [index, entry] of list(database.village_groups).entries()) {
    const record = typeof entry === 'string' ? { name: entry } : entry;
    const name = string(record.name || record.group_name).trim();
    if (name) groups.set(name, { ...copy(record), id: string(record.id || derivedId('group', name)), name,
      sortOrder: record.sortOrder ?? index, version: revision(record) });
  }
  const households = new Map();
  for (const entry of list(database.households)) {
    const no = string(entry.householdNo ?? entry.household_no ?? entry.household_id ?? entry.id);
    if (no) households.set(no, { ...copy(entry), id: string(entry.id || derivedId('household', no)),
      householdNo: no, version: revision(entry) });
  }
  const people = list(database.personnel).map((record, index) => {
    const name = string(record.village_group ?? record.villageGroupName).trim();
    if (name && !groups.has(name)) groups.set(name, { id: derivedId('group', name), name, sortOrder: groups.size, version: 1 });
    const no = string(record.household_id ?? record.householdNo);
    if (no && !households.has(no)) households.set(no, { id: derivedId('household', no), householdNo: no, version: 1 });
    const group = groups.get(name);
    const household = households.get(no);
    const person = { ...personFields(record), id: personRecordId(record, index), version: revision(record),
      villageGroupId: group?.id || record.villageGroupId || null,
      householdId: household?.id || record.householdId || null,
      createdAt: record.created_at || record.createdAt || null, updatedAt: record.updated_at || record.updatedAt || null };
    if (household) {
      household.villageGroupId ||= person.villageGroupId;
      if (['户主', '本人'].includes(person.relationToHead) && !household.headPersonId) household.headPersonId = person.id;
    }
    return person;
  });
  return { people, villageGroups: [...groups.values()], households: [...households.values()],
    revision: revision(database.personnel || []) };
}

function settingsView(database) {
  const settings = { ...database.settings, ...(database.foundationSettings || {}) };
  settings.village_name = database.settings?.villageName ?? settings.village_name ?? '';
  settings.app_subtitle = '社区AI管理系统';
  return Object.entries(settings).map(([key, value]) => ({ key, value: copy(value) }));
}

function checkVersion(record, baseVersion) {
  if (baseVersion == null || Number(baseVersion) !== revision(record)) {
    fail('VERSION_CONFLICT', '资料已发生变化，请刷新后重新编辑，避免覆盖其他修改');
  }
}
function applyPersonFields(record, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('INVALID_INPUT', '人员字段格式不正确');
  for (const [key, aliases] of Object.entries(PERSON_FIELDS)) if (own(changes, key)) {
    // Write all known aliases together so old extension modules see the edit.
    for (const alias of aliases) record[alias] = copy(changes[key]);
  }
  if (own(changes, 'customFields')) {
    const custom = changes.customFields;
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) fail('INVALID_INPUT', '专项资料格式不正确');
    record.customFields = { ...(record.customFields || record.custom_fields || {}), ...copy(custom) };
    for (const key of SPECIAL_FIELDS) {
      const newKey = key === 'special_custom_info' ? 'specialCustomInfo' : key;
      if (own(custom, newKey)) record[key] = copy(custom[newKey]);
      else { delete record[key]; delete record.customFields[key]; delete record.customFields[newKey]; }
    }
  }
}

function upsertPeople(database, items, { now = () => new Date(), uuid = randomUUID, checkWrite = () => {} } = {}) {
  if (!Array.isArray(items) || items.length > 1000) fail('INVALID_INPUT', '每次最多处理 1000 条人员记录');
  const people = database.personnel ||= [];
  const byId = new Map(people.map((record, index) => [personRecordId(record, index), record]));
  const recordIndexes = new Map(people.map((record, index) => [record, index]));
  const byCard = new Map();
  for (const record of people) {
    const card = string(field(record, PERSON_FIELDS.idCard)).trim().toUpperCase();
    if (card) {
      if (!byCard.has(card)) byCard.set(card, []);
      byCard.get(card).push(record);
    }
  }
  const result = { upserted: [], failed: [], insertedRows: 0, updatedRows: 0, totalRows: items.length };
  for (const [index, input] of items.entries()) {
    try {
      const changes = input?.fields;
      if (!changes || !string(changes.name).trim()) fail('INVALID_INPUT', '居民姓名不能为空');
      const lookupCard = string(input.baseValues?.idCard ?? changes.idCard).trim().toUpperCase();
      const matches = lookupCard ? byCard.get(lookupCard) || [] : [];
      if (!input.id && matches.length > 1) fail('AMBIGUOUS_PERSON', '存在相同身份证的多条档案，请先处理重复资料');
      const original = input.id ? byId.get(string(input.id)) : matches[0];
      checkWrite(Boolean(original));
      if ((input.id || input.baseVersion != null) && !original) fail('NOT_FOUND', '原居民档案不存在，请刷新后重试');
      if (original && input.baseVersion != null) checkVersion(original, input.baseVersion);
      const newCard = string(changes.idCard).trim().toUpperCase();
      if (newCard && (byCard.get(newCard) || []).some(record => record !== original)) fail('DUPLICATE_ID_CARD', '身份证已存在于其他档案');
      const next = original ? copy(original) : { id: uuid(), created_at: now().toISOString() };
      if (original && !string(next.id).trim()) next.id = string(input.id || personRecordId(original, recordIndexes.get(original)));
      applyPersonFields(next, changes);
      if (own(input, 'tags')) next.tags = copy(list(input.tags));
      if (own(input, 'householdNo')) next.household_id = string(input.householdNo);
      if (own(input, 'villageGroupName')) next.village_group = string(input.villageGroupName).trim();
      next.updated_at = now().toISOString();
      const oldCard = original && string(field(original, PERSON_FIELDS.idCard)).trim().toUpperCase();
      if (original) { Object.assign(original, next); for (const key of SPECIAL_FIELDS) if (!own(next, key)) delete original[key]; result.updatedRows++; }
      else { people.push(next); byId.set(string(next.id), next); result.insertedRows++; }
      const saved = original || next;
      if (oldCard) byCard.set(oldCard, (byCard.get(oldCard) || []).filter(record => record !== saved));
      if (newCard) byCard.set(newCard, [...(byCard.get(newCard) || []), saved]);
      result.upserted.push({ index, id: saved.id, personId: saved.id, version: revision(saved), inserted: !original });
    } catch (error) { result.failed.push({ index, code: error.code || 'INVALID_INPUT', error: error.message }); }
  }
  return result;
}

module.exports = { buildPersonnelView, settingsView, upsertPeople, applyPersonFields, checkVersion,
  revision, derivedId, personRecordId, findPersonRecord, fail, PERSON_FIELDS };
