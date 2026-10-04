'use strict';
const { createHmac, randomBytes } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { fail } = require('./foundation-data-model');
const clone = value => value === undefined ? undefined : structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifiable = array => array.every(item => object(item) && item.id != null) && new Set(array.map(item => String(item.id))).size === array.length;
function collectionPath(key) {
  if (['personnel', 'specialPersonnelProfiles', 'households'].includes(key)) return '/people';
  if (['partyMembers', 'partyActivists'].includes(key)) return '/party/members';
  if (key === 'visitRecords') return '/service-records';
  if (/^(dutyRecords|workItems|workEvidence|workProgressRecords|workResourceEntries|workAcceptances)$/.test(key)) return '/duty/plans';
  if (['lands', 'landParcel'].includes(key)) return '/land-parcels';
  if (/^(finances|resourceContracts|contractFee)/.test(key)) return '/finance-records';
  if (/^(disbursement|farmlandSubsidy)/.test(key)) return '/funds';
  if (key === 'certificates') return '/certificate-records';
  if (key === 'documents' || key === 'aiFileIndexEntries') return '/documents';
  if (/^(document|writingProfiles)/.test(key)) return '/document-drafts';
  return '/system-settings';
}
function writeMethods(before, after) {
  if (Array.isArray(after) && (before === undefined || Array.isArray(before)) && [before || [], after].every(identifiable)) {
    const original = new Map((before || []).map(item => [String(item.id), item]));
    const next = new Map(after.map(item => [String(item.id), item]));
    const methods = new Set();
    for (const [id, item] of next) {
      if (!original.has(id)) methods.add('POST');
      else if (!same(original.get(id), item)) methods.add(!original.get(id).deletedAt && item.deletedAt ? 'DELETE' : 'PATCH');
    }
    for (const id of original.keys()) if (!next.has(id)) methods.add('DELETE');
    return methods;
  }
  return new Set(['PATCH']);
}

function mergeWorkspace(before, after, current, location = '工作区') {
  if (same(before, after)) return clone(current);
  if (same(current, before) || same(current, after)) return clone(after);
  if (object(before) && object(after) && object(current)) {
    const result = clone(current);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_INPUT', '业务字段不正确');
      const value = mergeWorkspace(before[key], after[key], current[key], `${location}.${key}`);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  if (Array.isArray(after) && Array.isArray(current) && (before === undefined || Array.isArray(before)) && [before || [], after, current].every(identifiable)) {
    const original = new Map((before || []).map(item => [String(item.id), item]));
    const desired = new Map(after.map(item => [String(item.id), item]));
    const latest = new Map(current.map(item => [String(item.id), item]));
    const result = new Map(latest);
    for (const id of new Set([...original.keys(), ...desired.keys()])) {
      const value = mergeWorkspace(original.get(id), desired.get(id), latest.get(id), `${location}[${id}]`);
      if (value === undefined) result.delete(id); else result.set(id, value);
    }
    // Respect the editor's displayed order, followed by concurrently added rows.
    return [...new Set([...desired.keys(), ...result.keys()])].filter(id => result.has(id)).map(id => result.get(id));
  }
  fail('VERSION_CONFLICT', `${location} 已被其他页面修改，请重新打开该记录后再保存`);
}
class FoundationWorkspaceService {
  constructor({ store, auth }) { this.store = store; this.auth = auth; this.secret = randomBytes(32); }
  invalidate() { this.secret = randomBytes(32); }
  async identity() {
    const status = await this.auth.status();
    if (!status.authenticated || !['licensed', 'trial'].includes(status.entitlement?.type) || status.account?.mustChangePassword) fail('PRODUCT_AUTH_REQUIRED', status.account?.mustChangePassword ? '首次登录请先修改初始密码' : '请先登录有效的社区账号');
    return JSON.stringify([status.account?.id || status.account?.phone, status.account?.mainAccountId]);
  }
  sign(database, identity) { return createHmac('sha256', this.secret).update(identity).update(JSON.stringify(database)).digest('hex'); }
  async read() {
    const identity = await this.identity(), database = await this.store.read();
    if (identity !== await this.identity()) fail('WORKSPACE_CHANGED', '账号已切换，请重新打开页面');
    return { database, token: this.sign(database, identity) };
  }
  async write({ before, after, token } = {}) {
    const identity = await this.identity();
    if (!object(before) || !object(after) || token !== this.sign(before, identity)) fail('WORKSPACE_CHANGED', '页面数据已失效或账号已切换，请重新打开后保存');
    const outcome = await this.store.update(async current => {
      if (identity !== await this.identity()) fail('WORKSPACE_CHANGED', '账号已切换，请重新打开页面');
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (same(before[key], after[key])) continue;
        const path = collectionPath(key);
        for (const method of writeMethods(before[key], after[key])) await this.auth.authorize({ method, path });
      }
      const merged = mergeWorkspace(before, after, current);
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, merged);
      return { ok: true };
    });
    return { ok: true, database: outcome.data, token: this.sign(outcome.data, identity) };
  }
}
module.exports = { FoundationWorkspaceService, mergeWorkspace, collectionPath };
