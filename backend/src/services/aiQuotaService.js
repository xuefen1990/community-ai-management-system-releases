'use strict';

const db = require('../database');
const config = require('../config');

const EVENT_LABELS = Object.freeze({
  initial: '初始额度',
  purchase: '购买额度',
  adjustment: '管理员调整',
  reservation: '请求预留',
  consumption: 'AI 消耗',
  release: '请求退回',
});

function failure(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function asInteger(value, label = 'Token 数量') {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw failure(400, `${label}必须是整数`);
  return number;
}

function positiveInteger(value, label = 'Token 数量') {
  const number = asInteger(value, label);
  if (number <= 0) throw failure(400, `${label}必须大于 0`);
  return number;
}

function defaultQuotaTokens() {
  const configured = db.findOne('ai_quota_settings', row => row.key === 'defaultQuotaTokens');
  if (configured && Number.isSafeInteger(Number(configured.value)) && Number(configured.value) > 0) return Number(configured.value);
  const value = Number(config.ai.defaultQuotaTokens);
  return Number.isSafeInteger(value) && value > 0 ? value : 1000000;
}

function getDefaultQuotaTokens() { return defaultQuotaTokens(); }

function setDefaultQuotaTokens(value, { userId = '' } = {}) {
  const tokens = positiveInteger(value, '默认 Token 额度');
  const existing = db.findOne('ai_quota_settings', row => row.key === 'defaultQuotaTokens');
  const record = existing
    ? db.updateById('ai_quota_settings', existing.id, { value: tokens, updated_by: userId || '', updated_at: db.now() })
    : db.insert('ai_quota_settings', { id: db.genId(), key: 'defaultQuotaTokens', value: tokens, updated_by: userId || '', created_at: db.now(), updated_at: db.now() });
  return Number(record.value);
}

function ownerId(value) {
  const organization = db.findById('organizations', value);
  return organization?.unit_admin_user_id || String(value || '');
}

function quotaRecord(value) {
  const id = ownerId(value);
  return db.findOne('ai_quotas', row => row.main_account_id === id
    || (row.organization_id && db.findById('organizations', row.organization_id)?.unit_admin_user_id === id));
}

function summaryFrom(row) {
  const grantedTokens = Number(row?.granted_tokens || 0);
  const usedTokens = Number(row?.used_tokens || 0);
  const reservedTokens = Number(row?.reserved_tokens || 0);
  return {
    organizationId: row?.organization_id || null,
    mainAccountId: row?.main_account_id || (row?.organization_id && ownerId(row.organization_id)) || null,
    totalTokens: grantedTokens,
    usedTokens,
    reservedTokens,
    remainingTokens: Math.max(0, grantedTokens - usedTokens - reservedTokens),
    permanent: true,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

function appendLedger({ organizationId, event, tokens = 0, deltaTokens = 0, balanceAfter, userId = '', requestId = '', reason = '', metadata = {} }) {
  const mainAccountId = ownerId(organizationId);
  const organization = db.findById('organizations', organizationId);
  return db.insert('ai_quota_ledger', {
    id: db.genId(),
    organization_id: organization?.id || '', main_account_id: mainAccountId,
    event,
    event_label: EVENT_LABELS[event] || event,
    tokens: Number(tokens) || 0,
    delta_tokens: Number(deltaTokens) || 0,
    balance_after: Number(balanceAfter) || 0,
    user_id: userId || '',
    request_id: requestId || '',
    reason: String(reason || ''),
    metadata: JSON.stringify(metadata || {}),
    created_at: db.now(),
  });
}

function ensureOrganizationQuota(organizationId, { userId = '', reason = '单位启用时分配默认额度' } = {}) {
  if (!organizationId) return null;
  const mainAccountId = ownerId(organizationId);
  const mainAccount = db.findById('users', mainAccountId);
  if (!mainAccount || !['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(mainAccount.role)) throw failure(404, '主账号不存在');
  const existing = quotaRecord(organizationId);
  if (existing) return summaryFrom(existing);

  const now = db.now();
  const grantedTokens = defaultQuotaTokens();
  const row = {
    id: db.genId(),
    organization_id: mainAccount.organization_id || '', main_account_id: mainAccountId,
    granted_tokens: grantedTokens,
    used_tokens: 0,
    reserved_tokens: 0,
    created_at: now,
    updated_at: now,
  };
  db.insert('ai_quotas', row);
  appendLedger({ organizationId: mainAccountId, event: 'initial', tokens: grantedTokens, deltaTokens: grantedTokens, balanceAfter: grantedTokens, userId, reason });
  return summaryFrom(row);
}

function ensureAllOrganizationQuotas() {
  for (const user of db.findAll('users', item => ['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(item.role) && item.is_active && !item.deleted_at)) {
    ensureOrganizationQuota(user.id);
  }
}

function getQuotaSummary(organizationId) {
  const existing = quotaRecord(organizationId);
  if (existing) return summaryFrom(existing);
  const mainAccountId = ownerId(organizationId);
  const mainAccount = db.findById('users', mainAccountId);
  // 额度只在注册/启用时初始化。管理员查看已停用或已删除账号时，
  // 不能因为查询动作重新赠送一份默认额度。
  if (!mainAccount || !mainAccount.is_active || mainAccount.account_status !== 'active' || mainAccount.deleted_at) {
    return summaryFrom({ main_account_id: mainAccountId || null, organization_id: mainAccount?.organization_id || null, granted_tokens: 0, used_tokens: 0, reserved_tokens: 0 });
  }
  return ensureOrganizationQuota(organizationId);
}

function grantInitialQuota(organizationId, options = {}) {
  return ensureOrganizationQuota(organizationId, options);
}

function adjustQuota(organizationId, amount, { event = 'purchase', reason = '', userId = '', metadata = {} } = {}) {
  const deltaTokens = asInteger(amount);
  if (!['purchase', 'adjustment'].includes(event)) throw failure(400, '额度流水类型无效');
  const row = quotaRecord(organizationId) || (ensureOrganizationQuota(organizationId), quotaRecord(organizationId));
  const nextGranted = Number(row.granted_tokens || 0) + deltaTokens;
  const minimumGranted = Number(row.used_tokens || 0) + Number(row.reserved_tokens || 0);
  if (deltaTokens === 0 || nextGranted < minimumGranted) throw failure(400, '调整后的总额度不能低于已使用或预留额度');
  const updated = db.updateById('ai_quotas', row.id, { granted_tokens: nextGranted, updated_at: db.now() });
  const balance = Math.max(0, nextGranted - Number(updated.used_tokens || 0) - Number(updated.reserved_tokens || 0));
  appendLedger({ organizationId, event, tokens: Math.abs(deltaTokens), deltaTokens, balanceAfter: balance, userId, reason, metadata });
  return summaryFrom(updated);
}

function reserve(organizationId, tokens, { userId = '', requestId = '', reason = 'AI 请求预留', metadata = {} } = {}) {
  const amount = positiveInteger(tokens);
  const row = quotaRecord(organizationId) || (ensureOrganizationQuota(organizationId, { userId }), quotaRecord(organizationId));
  const available = Number(row.granted_tokens || 0) - Number(row.used_tokens || 0) - Number(row.reserved_tokens || 0);
  if (available < amount) {
    const error = failure(402, `主账号 AI Token 额度不足，当前可用 ${Math.max(0, available)} Token，请联系平台管理员购买额度`, 'AI_QUOTA_EXHAUSTED');
    error.details = { requiredTokens: amount, remainingTokens: Math.max(0, available), permanent: true };
    throw error;
  }
  const updated = db.updateById('ai_quotas', row.id, { reserved_tokens: Number(row.reserved_tokens || 0) + amount, updated_at: db.now() });
  appendLedger({ organizationId, event: 'reservation', tokens: amount, balanceAfter: available - amount, userId, requestId, reason, metadata });
  return { reservationId: requestId || db.genId(), tokens: amount, quota: summaryFrom(updated) };
}

function settle(organizationId, reservedTokens, actualTokens, { userId = '', requestId = '', reason = 'AI 请求完成', metadata = {} } = {}) {
  const reserved = positiveInteger(reservedTokens, '预留 Token 数量');
  const actual = Math.max(0, asInteger(actualTokens, '实际 Token 数量'));
  const row = quotaRecord(organizationId);
  if (!row) return null;
  const currentReserved = Number(row.reserved_tokens || 0);
  const consumed = Number(row.used_tokens || 0);
  const nextReserved = Math.max(0, currentReserved - reserved);
  const nextUsed = consumed + actual;
  if (nextUsed + nextReserved > Number(row.granted_tokens || 0)) {
    throw failure(409, 'AI 实际用量超过剩余额度，请联系平台管理员处理', 'AI_QUOTA_SETTLE_OVERFLOW');
  }
  const updated = db.updateById('ai_quotas', row.id, { reserved_tokens: nextReserved, used_tokens: nextUsed, updated_at: db.now() });
  appendLedger({ organizationId, event: 'consumption', tokens: actual, deltaTokens: -actual, balanceAfter: Number(updated.granted_tokens || 0) - nextUsed - nextReserved, userId, requestId, reason, metadata });
  return summaryFrom(updated);
}

function release(organizationId, reservedTokens, { userId = '', requestId = '', reason = 'AI 请求失败，退回预留额度' } = {}) {
  const reserved = positiveInteger(reservedTokens, '预留 Token 数量');
  const row = quotaRecord(organizationId);
  if (!row) return null;
  const nextReserved = Math.max(0, Number(row.reserved_tokens || 0) - reserved);
  const updated = db.updateById('ai_quotas', row.id, { reserved_tokens: nextReserved, updated_at: db.now() });
  appendLedger({ organizationId, event: 'release', tokens: reserved, balanceAfter: Number(updated.granted_tokens || 0) - Number(updated.used_tokens || 0) - nextReserved, userId, requestId, reason });
  return summaryFrom(updated);
}

function mapLedger(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata || '{}'); } catch { /* ignore malformed legacy metadata */ }
  return {
    id: row.id,
    organizationId: row.organization_id,
    mainAccountId: row.main_account_id || (row.organization_id && ownerId(row.organization_id)) || null,
    event: row.event,
    eventLabel: row.event_label || EVENT_LABELS[row.event] || row.event,
    tokens: Number(row.tokens || 0),
    deltaTokens: Number(row.delta_tokens || 0),
    balanceAfter: Number(row.balance_after || 0),
    userId: row.user_id || null,
    requestId: row.request_id || null,
    reason: row.reason || '',
    metadata,
    createdAt: row.created_at,
  };
}

function listQuotaLedger(organizationId, { page = 1, pageSize = 20 } = {}) {
  const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const target = ownerId(organizationId);
  const rows = db.findAll('ai_quota_ledger', row => row.main_account_id === target || (row.organization_id && ownerId(row.organization_id) === target)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return {
    ledger: rows.slice((currentPage - 1) * size, currentPage * size).map(mapLedger),
    pagination: { page: currentPage, pageSize: size, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / size)) },
  };
}

module.exports = {
  defaultQuotaTokens,
  getDefaultQuotaTokens,
  setDefaultQuotaTokens,
  ensureOrganizationQuota,
  ensureAllOrganizationQuotas,
  getQuotaSummary,
  listQuotaLedger,
  grantInitialQuota,
  adjustQuota,
  reserve,
  settle,
  release,
};
