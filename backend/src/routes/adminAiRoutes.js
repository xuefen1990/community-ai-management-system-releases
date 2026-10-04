'use strict';

const express = require('express');
const router = express.Router();
const { authRequired, adminRequired } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const aiQuotaService = require('../services/aiQuotaService');
const aiService = require('../services/aiService');
const authService = require('../services/authService');
const db = require('../database');

router.use(authRequired, adminRequired);

router.get('/default-quota', (_req, res) => {
  res.json({ defaultQuotaTokens: aiQuotaService.getDefaultQuotaTokens(), permanent: true });
});

router.put('/default-quota', (req, res, next) => {
  try {
    const defaultQuotaTokens = aiQuotaService.setDefaultQuotaTokens(req.body?.defaultQuotaTokens, { userId: req.user.id });
    authService.writeAuditLog(req.user.id, 'update_ai_default_quota', 'ai_quota_settings', JSON.stringify({ defaultQuotaTokens }), req.ip);
    res.json({ defaultQuotaTokens, permanent: true });
  } catch (error) { next(error); }
});

router.get('/quotas', (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || '').trim().toLowerCase();
    const accounts = db.findAll('users', item => ['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(item.role) && !item.deleted_at)
      .filter(item => !keyword || `${item.phone} ${item.name}`.toLowerCase().includes(keyword));
    const quotas = accounts.map(account => ({
      account: { id: account.id, phone: account.phone, name: account.name, planType: account.plan_type, planExpiresAt: account.plan_expires_at, isActive: Boolean(account.is_active) },
      memberCount: db.count('users', row => row.main_account_id === account.id && row.role === 'member' && !row.deleted_at),
      quota: aiQuotaService.getQuotaSummary(account.id),
    }));
    res.json({ quotas });
  } catch (error) { next(error); }
});

function mainAccountId(req) {
  const value = String(req.params.organizationId || '').trim();
  if (!value) throw new ApiError(400, '主账号编号不能为空');
  const legacy = db.findById('organizations', value);
  const id = legacy?.unit_admin_user_id || value;
  const account = db.findById('users', id);
  if (!account || !['main_account', 'unit_admin', 'admin', 'platform_admin'].includes(account.role)) throw new ApiError(404, '主账号不存在');
  return id;
}

router.get('/quotas/:organizationId/ledger', (req, res, next) => {
  try { res.json(aiQuotaService.listQuotaLedger(mainAccountId(req), { page: req.query.page, pageSize: req.query.pageSize })); } catch (error) { next(error); }
});

router.put('/quotas/:organizationId', (req, res, next) => {
  try {
    const id = mainAccountId(req);
    const amount = req.body?.amount ?? req.body?.deltaTokens;
    const event = req.body?.event || 'adjustment';
    const quota = aiQuotaService.adjustQuota(id, amount, { event, reason: req.body?.reason || '', userId: req.user.id });
    authService.writeAuditLog(req.user.id, 'adjust_ai_quota', id, JSON.stringify({ amount, event, reason: req.body?.reason || '' }), req.ip);
    res.json({ quota });
  } catch (error) { next(error); }
});

router.post('/quotas/:organizationId/grants', (req, res, next) => {
  try {
    const id = mainAccountId(req);
    const amount = req.body?.tokens ?? req.body?.amount;
    const quota = aiQuotaService.adjustQuota(id, Math.abs(Number(amount)), { event: 'purchase', reason: req.body?.reason || '平台管理员增加额度', userId: req.user.id, metadata: { source: 'admin_grant' } });
    authService.writeAuditLog(req.user.id, 'grant_ai_quota', id, JSON.stringify({ amount, reason: req.body?.reason || '' }), req.ip);
    res.status(201).json({ quota });
  } catch (error) { next(error); }
});

router.get('/usage', (req, res, next) => {
  try {
    const result = aiService.listUsageDetails({ page: req.query.page, pageSize: req.query.pageSize, days: req.query.days, userId: req.query.userId, mainAccountId: req.query.mainAccountId, organizationId: req.query.organizationId, status: req.query.status });
    res.json(result);
  } catch (error) { next(error); }
});

module.exports = router;
