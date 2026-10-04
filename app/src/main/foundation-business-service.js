'use strict';
const { editorSnapshot, saveEditor } = require('./foundation-resident-editor');
const { householdRegistrationContext, registerHouseholdMember } = require('./foundation-household-member-registration');

const { randomUUID } = require('node:crypto');
const { buildPersonnelView, settingsView, upsertPeople, checkVersion, revision, derivedId, personRecordId, fail } = require('./foundation-data-model');
const { domainRows, mutateDomain } = require('./foundation-domains');
const { analyzeFinanceRecords } = require('./finance-ledger-analysis');
const { calculateAccountBalance, validateOpeningBalance, localToday } = require('./finance-account-balance');
const { catalogOf, registerCategories, applyCategories } = require('./finance-category-service');
const { transactionBalances, saveTransactionOrder } = require('./finance-transaction-balances');
const { importFinanceBatch } = require('./finance-imports');
const { mutatePersonnelAction } = require('./foundation-personnel-actions');
const { householdLinks, mutateHouseholdLink } = require('./foundation-households');
const { dutyPlans, mutateDuty } = require('./foundation-duty');
const { partyDues, mutateParty } = require('./foundation-party');
const { documentRows } = require('./foundation-document-service');
const { templateRows: certificateTemplateRows, recordRows: certificateRecordRows, readCertificateResource, mutateCertificateResource } = require('./foundation-certificate-service');
const list = (value) => Array.isArray(value) ? value : [];
const str = (value) => value == null ? '' : String(value);
const collection = (db, primary, fallback) => list(db[primary]).length ? db[primary] : list(db[fallback || primary]);

function collectionViews(db, personnel) {
  const versioned = (record) => ({ ...structuredClone(record), version: revision(record) });
  return new Map([
    ['/people', personnel.people], ['/households', personnel.households], ['/village-groups', personnel.villageGroups],
    ['/system-settings', settingsView(db)], ['/special-categories', list(db.specialCategories).map(versioned)],
    ['/household-link-groups', householdLinks(db, personnel)],
    ['/dictionaries', list(db.foundationDictionaries).map(versioned)],
    ['/finance-records', domainRows(db, '/finance-records')], ['/land-parcels', domainRows(db, '/land-parcels')], ['/service-records', domainRows(db, '/service-records')],
    ['/documents', documentRows(db)],
    ['/certificate-templates', certificateTemplateRows(db)], ['/certificate-records', certificateRecordRows(db)],
    ...['/duty/people', '/party/branches', '/party/members', '/party/meetings', '/import-jobs'].map(path => [path, domainRows(db, path)]),
    ['/duty/plans', dutyPlans(db)], ['/party/dues', partyDues(db)],
    ['/audit-logs', list(db.residentOperationLog).map(versioned)], ['/operation-logs', list(db.operationLogs).map(versioned)],
  ]);
}

function page(items, params) {
  let filtered = items;
  const keyword = (params.get('keyword') || '').trim().toLocaleLowerCase();
  if (keyword) filtered = filtered.filter(item => ['name', 'idCard', 'externalIdCard', 'phone', 'householdNo', 'summary', 'visitorName', 'content', 'title', 'recordNo', 'personName']
    .some(key => str(item[key]).toLocaleLowerCase().includes(keyword)));
  for (const key of ['category', 'recordKind', 'domain', 'partyMemberId', 'dueYear', 'personType', 'theme', 'storageArea']) {
    if (params.get(key)) filtered = filtered.filter(item => str(item[key]) === params.get(key));
  }
  if (params.get('startDate')) filtered = filtered.filter(item => !item.endDate || item.endDate >= params.get('startDate'));
  if (params.get('endDate')) filtered = filtered.filter(item => !item.startDate || item.startDate <= params.get('endDate'));
  const limit = Math.min(100000, Math.max(1, Number(params.get('limit')) || 100000));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  return { items: structuredClone(filtered.slice(offset, offset + limit)), total: filtered.length, limit, offset };
}

class FoundationBusinessService {
  constructor({ store, authorize, now = () => new Date(), uuid = randomUUID }) {
    if (!store || typeof store.update !== 'function') throw new TypeError('A transactional database store is required');
    if (typeof authorize !== 'function') throw new TypeError('An authorization callback is required');
    this.store = store;
    this.authorize = authorize;
    this.now = now;
    this.uuid = uuid;
    this.readPromise = null;
    this.derivedCache = null;
    this.mutationQueue = Promise.resolve();
  }

  // Every burst still reads the authoritative store. Reuse derived DTOs only
  // when its complete content hash matches, including account/extension edits
  // that do not increment legacy version fields. Nothing is persisted here.
  async load() {
    if (!this.readPromise) {
      const pending = this.store.read().then(database => {
        const fingerprint = revision(database);
        if (this.derivedCache?.fingerprint === fingerprint) return this.derivedCache.value;
        const personnel = buildPersonnelView(database);
        const value = { database, personnel, views: collectionViews(database, personnel) };
        this.derivedCache = { fingerprint, value };
        return value;
      });
      this.readPromise = pending;
      pending.finally(() => { if (this.readPromise === pending) this.readPromise = null; }).catch(() => {});
    }
    return this.readPromise;
  }

  async request(input = {}) {
    try {
      if (typeof input.path !== 'string' || !input.path.startsWith('/api/v3/')) fail('INVALID_PATH', '业务接口路径不正确');
      const url = new URL(input.path, 'http://foundation.local');
      const path = url.pathname.slice('/api/v3'.length).replace(/\/$/, '');
      const method = str(input.method || 'GET').toUpperCase();
      const scope = { method, path, domain: input.domain || input.body?.domain || url.searchParams.get('domain') || '' };
      await this.authorize(scope);
      if (method === 'GET') {
        await this.mutationQueue.catch(() => {});
        return { ok: true, data: await this.read(path, url.searchParams) };
      }
      if (method === 'POST' && path === '/finance-balance-preview') {
        await this.mutationQueue.catch(() => {});
        const { database, views } = await this.load();
        if (!Array.isArray(input.body?.rows) || input.body.rows.length > 20000) fail('INVALID_INPUT', '预览记录数量不正确');
        const rows = input.body.rows.map((row, index) => ({ ...row, id: `preview-${index}`, importBatchId: 'balance-preview', sourceSheetName: row.sheetName, transactionOrder: Number.MAX_SAFE_INTEGER - 20000 + index }));
        const result = transactionBalances([...views.get('/finance-records'), ...rows], database.financeOpeningBalance, { today: localToday(this.now()) });
        return { ok: true, data: { ...result, items: result.items.filter(row => row.importBatchId === 'balance-preview') } };
      }
      // The AI certificate composer saves its local draft with PUT. Keep the
      // mutation surface explicit: PUT is accepted only for that draft
      // resource, while all other business resources retain their existing
      // POST/PATCH/DELETE contract.
      const allowedMutation = ['POST', 'PATCH', 'DELETE'].includes(method)
        || (method === 'PUT' && path === '/certificate-ai-draft');
      if (!allowedMutation) fail('METHOD_NOT_ALLOWED', '不支持此业务操作');
      const operation = this.mutationQueue.catch(() => {}).then(async () => {
        const authorization = await this.authorize(scope);
        const remoteChild = await this.store.isRemoteChild?.();
        const outcome = await this.store.update(database => this.mutate(database, method, path, input.body || {}, { ...authorization, remoteChild }));
        this.readPromise = null;
        this.derivedCache = null;
        return { ok: true, data: outcome.result };
      });
      this.mutationQueue = operation;
      return await operation;
    } catch (error) { return { ok: false, error: { code: error.code || 'BUSINESS_ERROR', message: error.message || '业务操作失败' } }; }
  }

  async read(path, params) {
    const { database, personnel, views } = await this.load();
    if (path === '/finance-categories') return { categories: catalogOf(database) };
    if (path === '/finance-opening-balance') return { openingBalance: structuredClone(database.financeOpeningBalance || null) };
    if (path === '/finance-account-balance') return calculateAccountBalance(views.get('/finance-records'), database.financeOpeningBalance, { asOfDate: params.get('asOfDate'), today: localToday(this.now()) });
    if (path === '/finance-balance-review') return transactionBalances(views.get('/finance-records'), database.financeOpeningBalance, { today: localToday(this.now()) });
    if (path === '/finance-records') return page(transactionBalances(views.get(path), database.financeOpeningBalance, { today: localToday(this.now()) }).items, params);
    if (path === '/finance-analysis') return analyzeFinanceRecords(transactionBalances(views.get('/finance-records'), database.financeOpeningBalance, { today: localToday(this.now()) }).items, { startDate: params.get('startDate'), endDate: params.get('endDate') });
    if (path === '/finance-imports') return page(list(database.financeImportBatches), params);
    const certificate = readCertificateResource(database, path, params);
    if (certificate) return certificate;
    if (path === '/people/editor') return editorSnapshot(database, params.get('id'));
    const householdRegistration = path.match(/^\/households\/([^/]+)\/member-registration$/);
    if (householdRegistration) return householdRegistrationContext(database, decodeURIComponent(householdRegistration[1]));
    if (path === '/people/revision') return { revision: personnel.revision };
    if (path === '/dashboard/overview') {
      const active = personnel.people.filter(person => person.registryStatus !== '已注销');
      return { overview: { totalActivePeople: active.length, totalHouseholds: new Set(active.map(p => p.householdId).filter(Boolean)).size,
        totalLandCount: views.get('/land-parcels').length, totalDocs: views.get('/documents').length,
        monthCertCount: views.get('/certificate-records').filter(record => str(record.createdAt || record.created_at).startsWith(this.now().toISOString().slice(0, 7))).length } };
    }
    if (path === '/dashboard/profile') return { profile: structuredClone(database.settings || {}) };
    if (views.has(path)) return page(views.get(path), params);
    const base = path.slice(0, path.lastIndexOf('/'));
    const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    if (views.has(base)) {
      const item = views.get(base).find(record => str(record.id) === id);
      if (!item) fail('NOT_FOUND', '记录不存在');
      return { item: structuredClone(item) };
    }
    fail('NOT_IMPLEMENTED', `此接口尚未完成适配：${path}`);
  }

  mutate(database, method, path, body, authorization) {
    if (method === 'PATCH' && path === '/finance-transaction-order') {
      const result = saveTransactionOrder(database, body, { now: this.now, uuid: this.uuid, today: localToday(this.now()) });
      if (!authorization?.remoteChild) this.log(database, '审核财务同日交易顺序', result.recordIds);
      return result;
    }
    if (method === 'PATCH' && path === '/finance-reclassifications') {
      const result = applyCategories(database, body, { now: this.now, uuid: this.uuid });
      if (!authorization?.remoteChild) this.log(database, '智能整理收支科目', result.recordIds);
      return result;
    }
    if (method === 'PATCH' && path === '/finance-opening-balance') {
      validateOpeningBalance(body, localToday(this.now()));
      const previous = database.financeOpeningBalance || null;
      if (body.baseVersion !== (previous?.version || 0)) fail('VERSION_CONFLICT', '期初余额已被修改，请重新打开设置');
      database.financeOpeningBalance = { startDate: body.startDate, amountCents: body.amountCents,
        version: (previous?.version || 0) + 1, updatedAt: this.now().toISOString() };
      this.log(database, '设置财务期初余额', []);
      database.operationLogs[database.operationLogs.length - 1].changes = { previous: structuredClone(previous), current: structuredClone(database.financeOpeningBalance) };
      return { openingBalance: structuredClone(database.financeOpeningBalance) };
    }
    if (method === 'POST' && path === '/finance-imports') {
      const result = importFinanceBatch(database, body, { now: this.now, uuid: this.uuid });
      if (!authorization?.remoteChild) this.log(database, '财务 Excel 导入', result.recordIds || []);
      return result;
    }
    if (method === 'PATCH' && path === '/people/editor') return saveEditor(database, body, { authorize: this.authorize, now: this.now, uuid: this.uuid }).then(result => {
      this.log(database, '编辑居民资料与收款账户', [body.id]);
      return result;
    });
    const householdMember = path.match(/^\/households\/([^/]+)\/members$/);
    if (method === 'POST' && householdMember) {
      const result = registerHouseholdMember(database, decodeURIComponent(householdMember[1]), body, {
        now: this.now,
        uuid: this.uuid,
        checkWrite: existing => {
          if (authorization?.personWriteActions && !authorization.personWriteActions.includes(existing ? 'update' : 'create')) {
            fail('FORBIDDEN', '当前账号没有保存此居民档案的权限');
          }
        },
      });
      this.log(database, result.action, [result.person.id]);
      return result;
    }
    const certificateResult = mutateCertificateResource(database, method, path, body, { now: this.now, uuid: this.uuid });
    if (certificateResult) { this.log(database, `${method} ${path}`, [certificateResult.item?.id || certificateResult.id].filter(Boolean)); return certificateResult; }
    for (const mutate of [mutateHouseholdLink, mutateDuty, mutateParty]) {
      const result = mutate(database, method, path, body, { now: this.now, uuid: this.uuid });
      if (result) { this.log(database, `${method} ${path}`, [result.item?.id || result.id].filter(Boolean)); return result; }
    }
    const personnelResult = mutatePersonnelAction(database, method, path, body, { now: this.now, uuid: this.uuid });
    if (personnelResult) { this.log(database, `${method} ${path}`, personnelResult.items?.map(item => item.id) || []); return personnelResult; }
    const domainResult = mutateDomain(database, method, path, body, { now: this.now, uuid: this.uuid });
    if (domainResult) { if (path.startsWith('/finance-records') && domainResult.item) registerCategories(database, [domainResult.item]); if (!(authorization?.remoteChild && path.startsWith('/finance-records'))) this.log(database, `${method} ${path}`, [domainResult.item?.id || domainResult.id]); return domainResult; }
    if (method === 'POST' && path === '/people/batch-upsert') {
      const outcome = upsertPeople(database, body.items, { now: this.now, uuid: this.uuid,
        checkWrite: existing => {
          if (authorization?.personWriteActions && !authorization.personWriteActions.includes(existing ? 'update' : 'create')) fail('FORBIDDEN', '当前账号没有保存此居民档案的权限');
        } });
      if (outcome.upserted.length) this.log(database, '居民档案保存', outcome.upserted.map(item => item.id));
      return outcome;
    }
    if (method === 'DELETE' && /^\/people\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.slice('/people/'.length));
      const index = list(database.personnel).findIndex((record, recordIndex) => personRecordId(record, recordIndex) === id);
      if (index < 0) fail('NOT_FOUND', '居民档案不存在');
      const record = database.personnel[index];
      checkVersion(record, body.baseVersion);
      // Keep the complete resident recoverable, including extension fields.
      (database.foundationDeletedResidents ||= []).push({ id: this.uuid(), person: structuredClone(record), deletedAt: this.now().toISOString() });
      database.personnel.splice(index, 1);
      this.log(database, '居民档案删除', [record.id]);
      return { deleted: true, id: record.id };
    }
    if (method === 'PATCH' && path === '/system-settings') {
      if (!body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)) fail('INVALID_INPUT', '设置格式不正确');
      for (const key of Object.keys(body.changes)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_INPUT', '设置名称不正确');
      }
      database.foundationSettings = { ...(database.foundationSettings || {}), ...structuredClone(body.changes) };
      if (Object.hasOwn(body.changes, 'village_name')) {
        database.settings ||= {};
        database.settings.villageName = str(body.changes.village_name).trim();
      }
      return { items: settingsView(database) };
    }
    if (method === 'POST' && path === '/village-groups') {
      const name = str(body.name).trim();
      if (!name) fail('INVALID_INPUT', '居民组名称不能为空');
      const existing = buildPersonnelView(database).villageGroups.find(group => group.name === name);
      if (existing) return { group: existing, item: existing };
      const record = { id: derivedId('group', name), name, sortOrder: list(database.village_groups).length };
      (database.village_groups ||= []).push(record);
      return { group: { ...record, version: revision(record) }, item: { ...record, version: revision(record) } };
    }
    // Unsupported mutations fail visibly. Never acknowledge a save that has
    // not been mapped to the authoritative database and extension contracts.
    fail('NOT_IMPLEMENTED', `此操作尚未完成适配：${method} ${path}`);
  }

  log(database, action, residentIds) {
    (database.operationLogs ||= []).push({ id: this.uuid(), action, residentIds, createdAt: this.now().toISOString(), source: 'foundation' });
  }
}

module.exports = { FoundationBusinessService, collectionViews, page };
