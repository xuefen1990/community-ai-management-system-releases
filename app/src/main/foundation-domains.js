'use strict';
const { revision, checkVersion, fail } = require('./foundation-data-model');
const certificateDefaults = require('./foundation-certificate-templates.json');
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);

const DOMAINS = Object.freeze({
  '/party/branches': { collections: ['partyBranches'], response: 'branch', required: ['name'], fields: { name: ['name'] } },
  '/party/members': { collections: ['partyMembers'], response: 'member', required: ['name'], fields: {
    name: ['nameSnapshot'], externalIdCard: ['id_card'], memberType: ['member_type'], joinDate: ['join_date'],
    applyDate: ['apply_date'], activistDate: ['activist_date'], targetDate: ['target_date'], position: ['duty'], villageGroup: ['village_group'],
  } },
  '/party/meetings': { collections: ['partyMeetings'], response: 'meeting', required: ['title', 'meetingDate'], fields: {
    meetingType: ['type'], meetingDate: ['date'], expectedCount: ['expected_count'],
  } },
  '/duty/people': { collections: ['dutyCadres', 'dutyPublicPosts'], response: 'person', required: ['name'], fields: {
    responsibility: ['duties'], duties: ['responsibility'], personType: ['person_type'],
  } },
  '/certificate-templates': { collections: ['certificateTemplates'], response: 'template', required: ['name'], fields: {
    wordPath: ['filePath'], fields: ['variables'], sealEnabled: ['redSeal'],
  } },
  '/certificate-records': { collections: ['certificateRecords', 'certificates'], response: 'record', fields: {
    recordNo: ['certificateNo'], personName: ['residentName'], idCard: ['id_card'], issuedAt: ['issued_at'],
  } },
  '/import-jobs': { collections: ['personnelImportRecords', 'landImportRecords'], response: 'job', fields: {
    totalRows: ['total'], insertedRows: ['added'], updatedRows: ['updated'], createdAt: ['importedAt'],
  } },
  '/finance-records': { collections: ['finances', 'financeRecords'], response: 'record', fields: {
    recordType: ['type'], recordDate: ['date'], voucherNo: ['voucherNumber', 'voucher_no'],
    summary: ['summary'], category: ['category'], handler: ['handler'], counterparty: ['counterparty'],
    attachmentNote: ['attachmentNote'], remarks: ['remarks'],
  } },
  '/land-parcels': { collections: ['landParcel', 'lands'], response: 'parcel', fields: {
    parcelNo: ['parcel_code', 'code'], name: ['parcel_name', 'name'], parcelType: ['parcel_type', 'land_type', 'type'],
    contractStart: ['contract_start'], contractEnd: ['contract_end'], remarks: ['remarks'],
    east: ['border_east'], south: ['border_south'], west: ['border_west'], north: ['border_north'],
  } },
  '/service-records': { collections: ['visitRecords'], response: 'record', fields: {
    recordKind: ['type', 'record_kind'], recordDate: ['date'], visitDate: ['date', 'visit_date'],
    visitorName: ['visitorName', 'visitor_name'], visitorPhone: ['phone'], visitorIdCard: ['id_card'],
    personId: ['personId', 'person_id'], cadreName: ['responsiblePerson', 'cadre_name'], matterType: ['category'],
    content: ['content'], status: ['status'], result: ['result'], remarks: ['remarks'],
  } },
});

function rawRows(database, path) {
  const domain = DOMAINS[path];
  if (!domain) return null;
  const records = new Map();
  for (const collection of domain.collections) for (const record of list(database[collection])) {
    // The established AI/extension collection is first. Mirrored legacy rows
    // with the same ID must not double the finance totals.
    const key = record.id == null ? record : text(record.id);
    if (!records.has(key)) records.set(key, record);
  }
  if (path === '/certificate-templates') for (const template of certificateDefaults) {
    if (!records.has(text(template.id)) && !list(database.foundationHiddenCertificateTemplates).includes(template.id)) records.set(text(template.id), template);
  }
  return [...records.values()];
}
function pick(record, names, fallback = '') {
  for (const name of names) if (record[name] != null) return record[name];
  return fallback;
}
function toView(database, path, record) {
  const domain = DOMAINS[path];
  const view = { ...structuredClone(record), version: revision(record),
    createdAt: record.createdAt || record.created_at || null, updatedAt: record.updatedAt || record.updated_at || null };
  for (const [key, aliases] of Object.entries(domain.fields)) view[key] = pick(record, [key, ...aliases]);
  if (path === '/duty/people') view.personType ||= list(database.dutyPublicPosts).includes(record) ? 'public' : 'cadre';
  if (path === '/import-jobs') {
    view.domain ||= list(database.landImportRecords).includes(record) ? 'land' : 'personnel';
    view.createdAt = record.createdAt || record.importedAt || null;
    view.report = { ...record.report, fileName: record.report?.fileName || record.fileName || '' };
  }
  if (path === '/party/meetings') {
    view.attendees = [...list(record.attendees).map(item => ({ ...item, nameSnapshot: item.nameSnapshot || item.name,
      attendanceStatus: item.attendanceStatus || '出席' })), ...list(record.absentees).filter(item => !list(record.attendees).some(attendee => attendee.nameSnapshot === item.name)).map(item => ({ ...item,
      nameSnapshot: item.nameSnapshot || item.name, attendanceStatus: '请假', absenceReason: item.reason || '' }))];
  }
  if (path === '/finance-records') view.amountCents = record.amountCents ?? Math.round(Number(record.amount || 0) * 100);
  if (path === '/service-records') view.recordKind ||= 'visit';
  if (path === '/land-parcels') {
    view.areaSquareMeterX100 = record.areaSquareMeterX100 ?? Math.round(Number(record.area ?? record.areaMu ?? 0) * 100);
    view.customFields = structuredClone(record.customFields || record.custom_fields || {});
    if (list(record.holders).length) view.holders = record.holders.map(holder => ({ ...holder,
      personId: holder.personId || holder.person_id || null,
      holderNameSnapshot: holder.holderNameSnapshot || holder.name || '',
      holderIdCardSnapshot: holder.holderIdCardSnapshot || holder.id_card || holder.idCard || '' }));
    else {
      const ids = new Set(list(record.contractorIds).map(text));
      const cards = new Set(list(record.contractor_id_cards).map(value => text(value).toUpperCase()));
      if (record.contractor_id_card) cards.add(text(record.contractor_id_card).toUpperCase());
      view.holders = list(database.personnel).filter(person => ids.has(text(person.id)) || cards.has(text(person.idCard || person.id_card).toUpperCase()))
        .map(person => ({ personId: person.id, holderNameSnapshot: person.name, holderIdCardSnapshot: person.idCard || person.id_card || '' }));
      if (!view.holders.length && (record.contractorName || record.contractor_name)) view.holders = [{ personId: null,
        holderNameSnapshot: record.contractorName || record.contractor_name, holderIdCardSnapshot: record.contractor_id_card || '' }];
    }
  }
  return view;
}
function domainRows(database, path) { return rawRows(database, path)?.map(record => toView(database, path, record)); }

function applyFields(path, record, changes) {
  const domain = DOMAINS[path];
  for (const [key, value] of Object.entries(changes)) {
    if (['id', 'version', 'baseVersion', 'baseValues', 'operationUuid', 'createdAt', 'created_at', '__proto__', 'constructor', 'prototype'].includes(key)) continue;
    record[key] = structuredClone(value);
    for (const alias of domain.fields[key] || []) record[alias] = structuredClone(value);
  }
  if (path === '/finance-records' && Object.hasOwn(changes, 'amountCents')) record.amount = Number(changes.amountCents) / 100;
  if (path === '/land-parcels') {
    if (Object.hasOwn(changes, 'areaSquareMeterX100')) record.area = record.areaMu = Number(changes.areaSquareMeterX100) / 100;
    if (Object.hasOwn(changes, 'holders')) {
      if (!Array.isArray(changes.holders)) fail('INVALID_INPUT', '承包人资料格式不正确');
      record.contractorIds = record.holders.map(holder => holder.personId).filter(Boolean);
      record.contractor_id_cards = record.holders.map(holder => holder.holderIdCardSnapshot).filter(Boolean);
      record.contractor_name = record.contractorName = record.holders.map(holder => holder.holderNameSnapshot).filter(Boolean).join('、');
    }
  }
}
function validate(path, record) {
  for (const key of DOMAINS[path].required || []) if (!text(record[key]).trim()) fail('INVALID_INPUT', '请填写完整的必填资料');
  if (path === '/import-jobs' && !['personnel', 'land'].includes(record.domain)) fail('INVALID_INPUT', '导入业务类型不正确');
  if (path === '/finance-records') {
    if (!['income', 'expense'].includes(record.recordType || record.type)) fail('INVALID_INPUT', '请选择收入或支出');
    if (!text(record.summary).trim()) fail('INVALID_INPUT', '收支摘要不能为空');
    if (!Number.isSafeInteger(record.amountCents) || record.amountCents < 0) fail('INVALID_INPUT', '金额必须为有效的非负数');
  }
  if (path === '/land-parcels' && (!Number.isSafeInteger(record.areaSquareMeterX100) || record.areaSquareMeterX100 < 0)) fail('INVALID_INPUT', '土地面积格式不正确');
  if (path === '/service-records' && !text(record.content).trim()) fail('INVALID_INPUT', '民情记录内容不能为空');
}

function mutateDomain(database, method, path, body, { now, uuid }) {
  if (path === '/certificate-templates/restore-defaults' && method === 'POST') {
    (database.foundationDeletedRecords ||= []).push({ id: uuid(), domain: '/certificate-templates', records: structuredClone(list(database.certificateTemplates)), deletedAt: now().toISOString() });
    database.certificateTemplates = []; database.foundationHiddenCertificateTemplates = [];
    return { items: domainRows(database, '/certificate-templates') };
  }
  const domainPath = Object.keys(DOMAINS).find(base => path === base || path.startsWith(`${base}/`));
  if (!domainPath) return null;
  const definition = DOMAINS[domainPath];
  const id = path === domainPath ? '' : decodeURIComponent(path.slice(domainPath.length + 1));
  if (id.includes('/')) return null;
  if ((method === 'POST' && id) || (method !== 'POST' && !id)) fail('METHOD_NOT_ALLOWED', '业务操作路径不正确');
  const original = id ? rawRows(database, domainPath).find(row => text(row.id) === id) : null;
  if (id && !original) fail('NOT_FOUND', '原业务记录不存在');
  if (original) checkVersion(original, body.baseVersion);
  if (method === 'DELETE') {
    (database.foundationDeletedRecords ||= []).push({ id: uuid(), domain: domainPath, record: structuredClone(original), deletedAt: now().toISOString() });
    for (const key of definition.collections) if (Array.isArray(database[key])) database[key] = database[key].filter(record => text(record.id) !== id);
    if (domainPath === '/certificate-templates' && certificateDefaults.some(item => item.id === id)) (database.foundationHiddenCertificateTemplates ||= []).push(id);
    return { deleted: true, id: original.id };
  }
  if (domainPath === '/import-jobs' && method === 'POST' && body.id && rawRows(database, domainPath).some(record => text(record.id) === text(body.id))) fail('DUPLICATE_RECORD', '导入批次编号已存在');
  const next = original ? structuredClone(original) : { id: domainPath === '/import-jobs' && body.id ? text(body.id) : (domainPath === '/party/members' ? 'party-member-' : '') + uuid(), createdAt: now().toISOString() };
  // Normalize values needed by validation without throwing away legacy fields.
  const view = original && toView(database, domainPath, original);
  if (view) for (const key of [...Object.keys(definition.fields), 'amountCents', 'areaSquareMeterX100']) if (Object.hasOwn(view, key)) next[key] = view[key];
  const changes = method === 'PATCH' ? { ...(body.changes || {}), ...(body.holders !== undefined ? { holders: body.holders } : {}) } : body;
  if (domainPath === '/finance-records') {
    if (Object.hasOwn(changes, 'transactionOrder') && !Number.isSafeInteger(changes.transactionOrder)) fail('INVALID_INPUT', '交易顺序必须为整数');
    if (original && ['sourceBalanceCents', 'sourceBalanceText', 'sourceOrder'].some(key => Object.hasOwn(changes, key))) fail('INVALID_INPUT', '原表余额及来源顺序不能覆盖，请修改实际收支数据');
    if (original && changes.recordDate && changes.recordDate !== view.recordDate) next.orderConfirmed = false;
    if (!original) next.transactionOrder = rawRows(database, domainPath).reduce((max, row) => Math.max(max, Number.isSafeInteger(row.transactionOrder) ? row.transactionOrder : 0), 0) + 1;
  }
  applyFields(domainPath, next, changes); validate(domainPath, next);
  next.updatedAt = now().toISOString(); next.updated_at = next.updatedAt;
  // Both established names may be read by pre-existing extensions. Mirror only
  // this changed row, retaining unrelated records and unknown extension fields.
  const targetCollections = domainPath === '/import-jobs' ? [next.domain === 'land' ? 'landImportRecords' : 'personnelImportRecords']
    : domainPath === '/duty/people' ? [next.personType === 'cadre' ? 'dutyCadres' : 'dutyPublicPosts'] : definition.collections;
  if (domainPath === '/duty/people') for (const key of definition.collections) {
    if (!targetCollections.includes(key) && Array.isArray(database[key])) database[key] = database[key].filter(record => text(record.id) !== text(next.id));
  }
  for (const key of targetCollections) {
    const rows = database[key] ||= []; const index = rows.findIndex(record => text(record.id) === text(next.id));
    if (index >= 0) rows[index] = structuredClone(next); else rows.push(structuredClone(next));
  }
  const result = toView(database, domainPath, next);
  return { item: result, [definition.response]: result };
}
module.exports = { DOMAINS, domainRows, mutateDomain };
