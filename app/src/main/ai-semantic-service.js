'use strict';

const { createHash } = require('node:crypto');
const { personRecordId } = require('./foundation-data-model');

function value(input) { return String(input ?? '').trim(); }
function rows(input) { return Array.isArray(input) ? input : []; }
function first(record, keys) {
  for (const key of keys) if (record?.[key] !== undefined && record?.[key] !== null && value(record[key])) return value(record[key]);
  return '';
}
function compatibilityId(kind, record, index) {
  const existing = value(record?.id || record?.recordId || record?.batchId);
  if (existing) return existing;
  const digest = createHash('sha256').update(JSON.stringify(record || {})).digest('hex').slice(0, 16);
  return `semantic:${kind}:${index}:${digest}`;
}
function publicResident(person) {
  return {
    ref: person.ref,
    id: person.id,
    name: person.name,
    groupName: person.groupName,
    householdId: person.householdId,
    identityCard: person.identityCard,
  };
}

class AiSemanticService {
  buildView(database = {}) {
    const residents = rows(database.personnel).map((record, index) => {
      const id = personRecordId(record, index);
      return {
        ref: `resident:${id}`,
        id,
        name: first(record, ['name', 'person_name', 'resident_name']),
        groupName: first(record, ['village_group', 'villageGroup', 'group_name', 'groupName']),
        householdId: first(record, ['household_id', 'householdId', 'household_no', 'householdNo']),
        identityCard: first(record, ['id_card', 'idCard', 'identity_card', 'identityCard']).toUpperCase(),
        source: record,
      };
    });
    const byId = new Map(residents.map(item => [item.id, item]));
    const byCard = new Map();
    const byName = new Map();
    for (const resident of residents) {
      if (resident.identityCard) {
        const list = byCard.get(resident.identityCard) || [];
        list.push(resident); byCard.set(resident.identityCard, list);
      }
      if (resident.name) {
        const list = byName.get(resident.name) || [];
        list.push(resident); byName.set(resident.name, list);
      }
    }
    return { database, residents, byId, byCard, byName };
  }

  resolveResident(viewOrDatabase, criteria = {}) {
    const view = viewOrDatabase?.residents ? viewOrDatabase : this.buildView(viewOrDatabase);
    const personId = value(criteria.personId);
    const identityCard = value(criteria.identityCard).toUpperCase();
    const groupName = value(criteria.groupName);
    const query = value(criteria.query);
    if (personId && view.byId.has(personId)) return { status: 'resolved', resident: publicResident(view.byId.get(personId)), matchedBy: 'personId' };
    if (identityCard) {
      const matches = view.byCard.get(identityCard) || [];
      if (matches.length === 1) return { status: 'resolved', resident: publicResident(matches[0]), matchedBy: 'identityCard' };
      if (matches.length > 1) return { status: 'ambiguous', reason: '同一身份证号关联了多条居民档案', candidates: matches.map(publicResident) };
    }
    const names = [...view.byName.keys()].filter(name => query.includes(name) || name === value(criteria.name)).sort((a, b) => b.length - a.length);
    if (!names.length) return { status: 'missing', reason: '没有识别出居民姓名或稳定标识' };
    let matches = view.byName.get(names[0]) || [];
    if (groupName || query) {
      const grouped = matches.filter(item => item.groupName && (item.groupName === groupName || query.includes(item.groupName)));
      if (grouped.length) matches = grouped;
    }
    if (matches.length === 1) return { status: 'resolved', resident: publicResident(matches[0]), matchedBy: matches[0].identityCard ? 'name-and-stable-archive' : 'unique-name' };
    return {
      status: 'ambiguous',
      reason: '存在同名居民，禁止仅凭姓名自动合并',
      candidates: matches.map(publicResident),
    };
  }

  relatedRecords(viewOrDatabase, residentReference) {
    const view = viewOrDatabase?.residents ? viewOrDatabase : this.buildView(viewOrDatabase);
    const resolved = this.resolveResident(view, residentReference || {});
    if (resolved.status !== 'resolved') return { ...resolved, records: [] };
    const resident = resolved.resident;
    const linkState = (record) => {
      const linkedId = first(record, ['personId', 'person_id', 'residentId', 'resident_id']);
      const linkedCard = first(record, ['idCard', 'id_card', 'identityCard', 'identity_card']).toUpperCase();
      const linkedValues = [
        ...rows(record?.contractorIds), ...rows(record?.residentIds), ...rows(record?.personIds),
      ].map(value).filter(Boolean);
      if (linkedId && linkedId === resident.id) return 'matched';
      if (linkedCard && resident.identityCard && linkedCard === resident.identityCard) return 'matched';
      if (linkedValues.includes(resident.id) || (resident.identityCard && linkedValues.includes(resident.identityCard))) return 'matched';
      const recordName = first(record, ['name', 'personName', 'residentName', 'recipientName', 'contractorName']);
      const recordGroup = first(record, ['groupName', 'group_name', 'villageGroup', 'village_group']);
      if (recordName && recordGroup && recordName === resident.name && recordGroup === resident.groupName) return 'matched';
      if (recordName && recordName === resident.name) return 'needs-review';
      return 'unmatched';
    };
    const records = [];
    const pendingRecords = [];
    const add = (kind, collection, record, index, parent = null) => records.push({
      ref: `${kind}:${compatibilityId(kind, record, index)}`, kind, collection,
      sourceId: compatibilityId(kind, record, index), parentId: value(parent?.id), record,
    });
    const inspect = (kind, collection, record, index, parent = null) => {
      const state = linkState(record);
      if (state === 'matched') add(kind, collection, record, index, parent);
      else if (state === 'needs-review') pendingRecords.push({
        ref: `${kind}:${compatibilityId(kind, record, index)}`, kind, collection,
        sourceId: compatibilityId(kind, record, index), reason: "记录只有姓名，缺少居民编号、身份证号或居民组，需人工确认",
      });
    };
    for (const [index, record] of rows(view.database.landParcel || view.database.lands).entries()) inspect('land', 'landParcel', record, index);
    for (const collection of ['disbursementBatches', 'contractFeeBatches']) {
      for (const [batchIndex, batch] of rows(view.database[collection]).entries()) {
        rows(batch.items).forEach((record, itemIndex) => inspect('payment', collection, record, `${batchIndex}-${itemIndex}`, batch));
      }
    }
    rows(view.database.certificates).forEach((record, index) => inspect('certificate', 'certificates', record, index));
    rows(view.database.resourceContracts).forEach((record, index) => inspect('contract', 'resourceContracts', record, index));
    return { status: 'resolved', resident, records, pendingRecords };
  }
}

module.exports = { AiSemanticService, compatibilityId };
