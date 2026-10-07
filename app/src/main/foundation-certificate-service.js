'use strict';

const defaults = require('./foundation-certificate-templates.json');
const { buildPersonnelView, revision, checkVersion, fail } = require('./foundation-data-model');
const { domainRows } = require('./foundation-domains');
const model = require('../shared/certificate-management-model');
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value).trim();

function templateRows(database) {
  const hidden = new Set(list(database.foundationHiddenCertificateTemplates));
  const overrides = new Map(list(database.certificateTemplates).map(item => [text(item.id), item]));
  const rows = [];
  for (const item of defaults) if (!hidden.has(item.id)) rows.push(overrides.get(item.id) || item);
  for (const item of overrides.values()) if (!defaults.some(base => base.id === item.id)) rows.push(item);
  return rows.map(item => ({ ...model.normalizeCertificateTemplate(item), version: revision(item) }));
}

function recordRows(database) {
  const records = new Map();
  for (const key of ['certificateRecords', 'certificates']) for (const item of list(database[key])) {
    const id = text(item.id || item.internalRecordNo || item.recordNo || item.certificateNo);
    if (!records.has(id)) records.set(id, item);
  }
  return [...records.values()].map(item => ({ ...structuredClone(item),
    internalRecordNo: item.internalRecordNo || item.recordNo || item.certificateNo || '',
    personName: item.personName || item.residentName || item.subjectSnapshots?.person1?.name || '',
    idCard: item.idCard || item.id_card || item.subjectSnapshots?.person1?.idCard || '',
    issuedAt: item.issuedAt || item.issued_at || item.createdAt || null,
    version: revision(item) }));
}

function residentIndex(database) {
  const personnel = buildPersonnelView(database);
  const peopleByHousehold = new Map();
  for (const person of personnel.people) {
    const key = person.householdId || person.householdNo;
    if (!key) continue;
    if (!peopleByHousehold.has(key)) peopleByHousehold.set(key, []);
    peopleByHousehold.get(key).push(person);
  }
  return { ...personnel, peopleByHousehold };
}

function residentSummary(person, index) {
  const household = index.households.find(item => item.id === person.householdId) || {};
  const members = index.peopleByHousehold.get(person.householdId) || [];
  const head = members.find(item => item.id === household.headPersonId || ['户主', '本人'].includes(item.relationToHead));
  return { id: person.id, name: person.name, idCard: person.idCard, idCardHint: person.idCard ? `${person.idCard.slice(0, 6)}……${person.idCard.slice(-4)}` : '未登记',
    birthDate: person.birthDate, age: person.birthDate ? Math.max(0, new Date().getFullYear() - Number(String(person.birthDate).slice(0, 4))) : '',
    gender: person.gender, villageGroup: index.villageGroups.find(item => item.id === person.villageGroupId)?.name || '',
    householdNo: household.householdNo || '', headName: head?.name || '', relationToHead: person.relationToHead || '', registryStatus: person.registryStatus || '' };
}

function searchResidents(database, params) {
  const keyword = text(params.get('keyword')).toLocaleLowerCase();
  if (!keyword) return { items: [], total: 0 };
  const index = residentIndex(database);
  const items = index.people.filter(person => [person.name, person.idCard, person.householdNo, person.phone]
    .some(value => text(value).toLocaleLowerCase().includes(keyword))).slice(0, 20).map(person => residentSummary(person, index));
  return { items, total: items.length };
}

function residentContext(database, id) {
  const index = residentIndex(database); const person = index.people.find(item => text(item.id) === text(id));
  if (!person) fail('NOT_FOUND', '未找到该居民档案，请刷新后重新搜索');
  const household = index.households.find(item => item.id === person.householdId) || {};
  const members = index.peopleByHousehold.get(person.householdId) || [];
  const head = members.find(item => item.id === household.headPersonId || ['户主', '本人'].includes(item.relationToHead));
  const landRows = domainRows(database, '/land-parcels').filter(parcel => list(parcel.holders).some(holder => text(holder.personId) === text(person.id)));
  const snapshot = model.buildSubjectSnapshot({ ...person,
    villageGroup: index.villageGroups.find(item => item.id === person.villageGroupId)?.name || '' },
  { ...household, headName: head?.name || '', population: members.filter(item => item.registryStatus !== '已注销').length }, landRows);
  return { person: residentSummary(person, index), snapshot, household: { ...structuredClone(household), headName: head?.name || '', population: members.length }, landRows };
}

function pageRecords(rows, params) {
  const keyword = text(params.get('keyword')).toLocaleLowerCase();
  let filtered = rows;
  if (keyword) filtered = filtered.filter(item => [item.internalRecordNo, item.personName, item.idCard, item.templateName]
    .some(value => text(value).toLocaleLowerCase().includes(keyword)));
  if (params.get('status')) filtered = filtered.filter(item => text(item.status) === params.get('status'));
  if (params.get('templateId')) filtered = filtered.filter(item => text(item.templateId) === params.get('templateId'));
  if (params.get('startDate')) filtered = filtered.filter(item => text(item.issuedAt || item.createdAt).slice(0, 10) >= params.get('startDate'));
  if (params.get('endDate')) filtered = filtered.filter(item => text(item.issuedAt || item.createdAt).slice(0, 10) <= params.get('endDate'));
  const limit = Math.min(200, Math.max(1, Number(params.get('limit')) || 50)); const offset = Math.max(0, Number(params.get('offset')) || 0);
  return { items: structuredClone(filtered.slice(offset, offset + limit)), total: filtered.length, limit, offset };
}

function readCertificateResource(database, path, params) {
  if (path === '/certificate-ai-draft') return { draft: database.certificateAiDraft ? structuredClone(database.certificateAiDraft) : null };
  if (path === '/certificate-residents') return searchResidents(database, params);
  const contextMatch = path.match(/^\/certificate-residents\/([^/]+)\/context$/u);
  if (contextMatch) return residentContext(database, decodeURIComponent(contextMatch[1]));
  if (path === '/certificate-templates') return { items: templateRows(database), total: templateRows(database).length };
  const templateMatch = path.match(/^\/certificate-templates\/([^/]+)$/u);
  if (templateMatch) {
    const item = templateRows(database).find(row => row.id === decodeURIComponent(templateMatch[1]));
    if (!item) fail('NOT_FOUND', '证明模板不存在'); return { item };
  }
  if (path === '/certificate-records') return pageRecords(recordRows(database), params);
  const recordMatch = path.match(/^\/certificate-records\/([^/]+)$/u);
  if (recordMatch) {
    const item = recordRows(database).find(row => text(row.id) === decodeURIComponent(recordMatch[1]));
    if (!item) fail('NOT_FOUND', '证明记录不存在'); return { item };
  }
  return null;
}

function storedTemplate(database, id) {
  return list(database.certificateTemplates).find(item => text(item.id) === text(id));
}

function saveTemplate(database, template) {
  const rows = database.certificateTemplates ||= []; const index = rows.findIndex(item => text(item.id) === text(template.id));
  if (index >= 0) rows[index] = structuredClone(template); else rows.push(structuredClone(template));
}

function nextRecordNo(database, year) {
  const sequences = database.foundationCertificateSequences ||= {}; const number = Number(sequences[year] || 0) + 1; sequences[year] = number;
  const code = text(database.foundationSettings?.organization_code || database.settings?.organizationCode).replace(/[^A-Za-z0-9]/gu, '').toUpperCase() || 'CERT';
  return `${code}-${year}-${String(number).padStart(4, '0')}`;
}

function saveRecord(database, record) {
  for (const key of ['certificateRecords', 'certificates']) {
    const rows = database[key] ||= []; const index = rows.findIndex(item => text(item.id) === text(record.id));
    if (index >= 0) rows[index] = structuredClone(record); else rows.push(structuredClone(record));
  }
}

function mutateCertificateResource(database, method, path, body, { now, uuid }) {
  if (path === '/certificate-ai-draft' && method === 'PUT') {
    const draft = { ...structuredClone(body || {}), updatedAt: now().toISOString() };
    database.certificateAiDraft = draft;
    return { draft: structuredClone(draft) };
  }
  if (path === '/certificate-ai-draft' && method === 'DELETE') {
    delete database.certificateAiDraft;
    return { deleted: true };
  }
  if (path === '/certificate-templates' && method === 'POST') {
    const template = model.normalizeCertificateTemplate({ ...structuredClone(body), id: body.id || `certificate-template-${uuid()}`, builtin: false,
      createdAt: now().toISOString(), updatedAt: now().toISOString() });
    if (!template.name) fail('INVALID_INPUT', '请填写模板名称'); saveTemplate(database, template); return { item: { ...template, version: revision(template) }, template };
  }
  if (path === '/certificate-templates/restore-defaults' && method === 'POST') {
    (database.foundationDeletedRecords ||= []).push({ id: uuid(), domain: '/certificate-templates', records: structuredClone(list(database.certificateTemplates)), deletedAt: now().toISOString() });
    database.certificateTemplates = list(database.certificateTemplates).filter(item => !defaults.some(base => base.id === item.id)); database.foundationHiddenCertificateTemplates = [];
    return { items: templateRows(database) };
  }
  const templateAction = path.match(/^\/certificate-templates\/([^/]+)(?:\/(publish|copy|status))?$/u);
  if (templateAction) {
    const id = decodeURIComponent(templateAction[1]); const action = templateAction[2] || '';
    const view = templateRows(database).find(item => item.id === id); if (!view) fail('NOT_FOUND', '证明模板不存在');
    const stored = storedTemplate(database, id); if (body.baseVersion != null) checkVersion(stored || defaults.find(item => item.id === id), body.baseVersion);
    if (method === 'DELETE' && !action) {
      if (recordRows(database).some(item => item.templateId === id)) fail('TEMPLATE_IN_USE', '该模板已有开具记录，请改为停用');
      if (view.builtin) fail('BUILTIN_TEMPLATE', '系统模板不能删除，可以停用或恢复默认');
      (database.foundationDeletedRecords ||= []).push({ id: uuid(), domain: '/certificate-templates', record: structuredClone(stored), deletedAt: now().toISOString() });
      database.certificateTemplates = list(database.certificateTemplates).filter(item => item.id !== id); return { deleted: true, id };
    }
    if (method === 'PATCH' && !action) {
      const changes = body.changes || {}; const versions = structuredClone(view.versions || []); const activeIndex = versions.findIndex(item => item.versionNumber === view.currentVersion);
      if (activeIndex >= 0) {
        versions[activeIndex] = { ...versions[activeIndex], ...structuredClone(changes) };
        if (Object.hasOwn(changes, 'fields') && !Object.hasOwn(changes, 'subjects')) delete versions[activeIndex].subjects;
      }
      const next = model.normalizeCertificateTemplate({ ...view, ...structuredClone(changes), versions, id, updatedAt: now().toISOString() }); saveTemplate(database, next);
      return { item: { ...next, version: revision(next) }, template: next };
    }
    if (method === 'POST' && action === 'publish') {
      const next = model.publishTemplateVersion({ ...view, status: 'active' }, body.changes || {}, { now: now().toISOString(), operatorName: body.operatorName }); saveTemplate(database, next);
      return { item: { ...next, version: revision(next) }, template: next };
    }
    if (method === 'POST' && action === 'copy') {
      const copy = model.normalizeCertificateTemplate({ ...view, id: `certificate-template-${uuid()}`, name: `${view.name}（副本）`, builtin: false, isSystem: false,
        currentVersion: 1, versions: [{ ...view.versions.at(-1), versionNumber: 1, createdAt: now().toISOString() }], createdAt: now().toISOString(), updatedAt: now().toISOString() });
      saveTemplate(database, copy); return { item: { ...copy, version: revision(copy) }, template: copy };
    }
    if (method === 'POST' && action === 'status') {
      const next = model.normalizeCertificateTemplate({ ...view, status: body.status === 'active' ? 'active' : 'inactive', updatedAt: now().toISOString() }); saveTemplate(database, next);
      return { item: { ...next, version: revision(next) }, template: next };
    }
  }
  if (path === '/certificate-records' && method === 'POST') {
    const operationUuid = text(body.operationUuid);
    if (operationUuid) {
      const existing = recordRows(database).find(item => item.operationUuid === operationUuid);
      if (existing) return { item: existing, record: existing, duplicate: true };
    }
    const template = templateRows(database).find(item => item.id === body.templateId); if (!template) fail('NOT_FOUND', '请选择有效的证明模板');
    const draft = { ...model.createCertificateDraft(template, body), ...structuredClone(body), id: body.id || `certificate-record-${uuid()}`, createdAt: now().toISOString(), updatedAt: now().toISOString() };
    let record = draft;
    if (body.status === '有效' || body.issue === true) {
      const year = String(now().getFullYear()); record = model.createIssuedRecord(draft, template.versions.find(item => item.versionNumber === draft.templateVersion) || template.versions.at(-1),
        { id: draft.id, internalRecordNo: nextRecordNo(database, year), issuedAt: now().toISOString(), operatorName: body.operatorName });
      if (text(body.outputOverride?.content)) record.outputSnapshot = {
        title: text(body.outputOverride.title) || record.outputSnapshot.title,
        content: text(body.outputOverride.content),
      };
      if (body.sourceMaterial?.fileId) record.sourceMaterial = structuredClone(body.sourceMaterial);
      record.templateName = template.name; record.operationUuid = operationUuid; record.personName = record.subjectSnapshots?.person1?.name || ''; record.idCard = record.subjectSnapshots?.person1?.idCard || '';
    }
    saveRecord(database, record); return { item: { ...record, version: revision(record) }, record };
  }
  const recordAction = path.match(/^\/certificate-records\/([^/]+)(?:\/(issue|void|copy))?$/u);
  if (recordAction) {
    const id = decodeURIComponent(recordAction[1]); const action = recordAction[2] || '';
    const current = recordRows(database).find(item => text(item.id) === id); if (!current) fail('NOT_FOUND', '证明记录不存在');
    const raw = list(database.certificateRecords).find(item => text(item.id) === id) || current; if (body.baseVersion != null) checkVersion(raw, body.baseVersion);
    if (method === 'DELETE') fail('RECORD_PRESERVED', '证明记录不能删除，如有错误请作废');
    if (method === 'PATCH' && !action) {
      if (current.status !== 'draft') fail('ISSUED_READ_ONLY', '已开具证明不能直接修改，可以复制后重新开具');
      const next = { ...structuredClone(raw), ...(body.changes || {}), updatedAt: now().toISOString() }; saveRecord(database, next); return { item: { ...next, version: revision(next) }, record: next };
    }
    if (method === 'POST' && action === 'copy') return { draft: model.copyIssuedRecordToDraft(current) };
    if (method === 'POST' && action === 'void') {
      const next = model.voidIssuedRecord(raw, body.reason, { now: now().toISOString(), operatorName: body.operatorName }); saveRecord(database, next); return { item: { ...next, version: revision(next) }, record: next };
    }
    if (method === 'POST' && action === 'issue') {
      const operationUuid = text(body.operationUuid);
      const duplicate = operationUuid && recordRows(database).find(item => item.operationUuid === operationUuid && item.status !== 'draft'); if (duplicate) return { item: duplicate, record: duplicate, duplicate: true };
      const template = templateRows(database).find(item => item.id === current.templateId); if (!template) fail('NOT_FOUND', '开具所用模板已不存在');
      const issued = model.createIssuedRecord({ ...current, ...structuredClone(body.changes || {}) }, template.versions.find(item => item.versionNumber === current.templateVersion) || template.versions.at(-1),
        { id, internalRecordNo: nextRecordNo(database, String(now().getFullYear())), issuedAt: now().toISOString(), operatorName: body.operatorName });
      issued.templateName = template.name; issued.operationUuid = operationUuid; issued.personName = issued.subjectSnapshots?.person1?.name || ''; issued.idCard = issued.subjectSnapshots?.person1?.idCard || '';
      saveRecord(database, issued); return { item: { ...issued, version: revision(issued) }, record: issued };
    }
  }
  return null;
}

module.exports = { templateRows, recordRows, searchResidents, residentContext, readCertificateResource, mutateCertificateResource };
