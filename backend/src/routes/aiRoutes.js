'use strict';

const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const { authRequired, adminRequired } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const { ApiError } = require('../middleware/errorHandler');
const authService = require('../services/authService');
const logger = require('../utils/logger');
const aiQuotaService = require('../services/aiQuotaService');
const aiAssistantStateService = require('../services/aiAssistantStateService');
const permissionPolicy = require('../services/permissionPolicy');
const accountScope = require('../services/mainAccountScope');
const unitWorkspace = require('../services/unitWorkspaceService');

function organizationIdOf(req) {
  return accountScope.requireMainAccountId(req.user);
}

router.use(authRequired, (req, res, next) => {
  if (req.method === 'GET' && ['/usage', '/usage/detail', '/quota', '/quota/ledger'].includes(req.path)) return next();
  if (!permissionPolicy.mayUseAi(req.user)) return res.status(403).json({ error: '主账号未授权当前子账号使用 AI', code: 'AI_ACCESS_DISABLED' });
  next();
});

router.use('/assistant', authRequired, (req, _res, next) => {
  try { unitWorkspace.assertNotCutOver(req.user); next(); }
  catch (error) { next(error); }
});

// ===== 对话（非流式）=====
router.post('/chat', authRequired, aiLimiter, async (req, res, next) => {
  try {
    const { messages, model, temperature, maxTokens, requestId, taskTier, taskKind, taskId, billingTaskId, approvedMaxCredits, usageConfirmed } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'messages 参数不能为空');
    }

    const user = authService.getUserById(req.user.id);
    const entitlement = authService.checkEntitlement(user);
    if (!entitlement.valid) {
      throw new ApiError(403, '当前授权不可用: ' + entitlement.reason);
    }

    const result = await aiService.chat(req.user.id, {
      messages, model, temperature, maxTokens, requestId, taskTier, taskKind, taskId, billingTaskId, approvedMaxCredits, usageConfirmed, stream: false,
    });

    res.json(result.data);
  } catch (err) { next(err); }
});

// ===== 对话（流式 SSE）=====
router.post('/chat/stream', authRequired, aiLimiter, async (req, res, next) => {
  try {
    const { messages, model, temperature, maxTokens, requestId, taskTier, taskKind, taskId, billingTaskId, approvedMaxCredits, usageConfirmed } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'messages 参数不能为空');
    }

    const user = authService.getUserById(req.user.id);
    const entitlement = authService.checkEntitlement(user);
    if (!entitlement.valid) {
      throw new ApiError(403, '当前授权不可用: ' + entitlement.reason);
    }

    const result = await aiService.chat(req.user.id, {
      messages, model, temperature, maxTokens, requestId, taskTier, taskKind, taskId, billingTaskId, approvedMaxCredits, usageConfirmed, stream: true,
    });

    if (!result.stream) {
      res.json(result.data);
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { responseStream } = result;

    responseStream.on('data', (chunk) => {
      res.write(chunk);
    });

    responseStream.on('end', () => {
      res.end();
    });

    responseStream.on('error', () => {
      logger.error('AI 流式响应错误', { error: 'provider_stream_failed' });
      res.end();
    });

    res.on('close', () => {
      if (!res.writableEnded) responseStream.destroy();
    });
  } catch (err) { next(err); }
});

router.use('/credit-tasks',(req,_res,next)=>{const entitlement=authService.checkEntitlement(authService.getUserById(req.user.id));if(!entitlement.valid)return next(new ApiError(403,'当前授权不可用'));next();});
router.post('/credit-tasks/estimate',(req,res,next)=>{try{const enabled=require('../services/aiCreditPolicy').enabled();const q=require('../services/aiQuotaService').getQuotaSummary(organizationIdOf(req));res.json({...(enabled?require('../services/aiCreditTasks').estimate(req.body):{}),billingUnit:enabled?'credits':'tokens',remainingCredits:q.remainingCredits});}catch(e){next(e);}});
router.post('/credit-tasks', aiLimiter, (req,res,next)=>{try{res.json(require('../services/aiCreditTasks').start(req.user.id,organizationIdOf(req),req.body));}catch(e){next(e);}});
router.post('/credit-tasks/:id/extend',(req,res,next)=>{try{res.json(require('../services/aiCreditTasks').extend(req.user.id,req.params.id,Number(req.body.approvedMaxCredits),req.body.usageConfirmed));}catch(e){next(e);}});
router.post('/credit-tasks/:id/finish', (req,res,next)=>{try{res.json(require('../services/aiCreditTasks').finish(req.user.id,req.params.id));}catch(e){next(e);}});
router.get('/credit-policy', (req,res)=>res.json({enabled:require('../services/aiCreditPolicy').enabled(),policy:require('../services/aiCreditTasks').rates()}));
router.put('/credit-policy',adminRequired,(req,res,next)=>{try{const saved=require('../services/aiCreditTasks').updateRates(req.body);authService.writeAuditLog(req.user.id,'update_ai_credit_policy','ai_quota_settings',JSON.stringify(saved),req.ip);res.json(saved);}catch(e){next(e);}});
router.post('/providers/batch',adminRequired,(req,res,next)=>{try{const providers=req.body.providers;if(!Array.isArray(providers)||!providers.length||providers.length>30)throw new ApiError(400,'每次请填写 1 至 30 个模型');if(providers.filter(p=>p.defaultText===true).length>1)throw new ApiError(400,'请选择一个默认文字模型');const saved=require('../database').atomic(()=>{if(providers.some(p=>p.defaultText===true))for(const row of require('../database').findAll('ai_providers'))require('../database').updateById('ai_providers',row.id,{default_text:false});return providers.map(p=>p.id?aiService.updateProvider(p.id,p):aiService.createProvider(p));});authService.writeAuditLog(req.user.id,'save_ai_models', 'ai_providers',JSON.stringify({ids:saved.map(p=>p.id)}),req.ip);res.json({providers:saved});}catch(e){next(e);}});
// ===== 可用模型列表 =====
router.get('/models', authRequired, (req, res) => {
  res.json(aiService.listModels());
});

router.post('/estimate', authRequired, (req, res, next) => {
  try {
    const { messages, model, maxTokens, taskTier, taskKind, taskId, attachmentCount } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) throw new ApiError(400, 'messages 参数不能为空');
    res.json(aiService.estimateTask(req.user.id, { messages, model, maxTokens, taskTier, taskKind, taskId, attachmentCount }));
  } catch (error) { next(error); }
});

router.get('/assistant/conversation', authRequired, (req, res, next) => {
  try {
    res.json({ conversation: aiAssistantStateService.getConversation(req.user, req.query.conversationId) });
  } catch (error) { next(error); }
});

router.put('/assistant/conversation', authRequired, (req, res, next) => {
  try {
    res.json({ conversation: aiAssistantStateService.saveConversation(req.user, req.body || {}) });
  } catch (error) { next(error); }
});

router.get('/assistant/memories', authRequired, (req, res, next) => {
  try {
    res.json({ memories: aiAssistantStateService.listMemories(req.user) });
  } catch (error) { next(error); }
});

router.post('/assistant/memories', authRequired, (req, res, next) => {
  try {
    res.status(201).json({ memory: aiAssistantStateService.createMemory(req.user, req.body || {}) });
  } catch (error) { next(error); }
});

router.delete('/assistant/memories/:id', authRequired, (req, res, next) => {
  try {
    res.json(aiAssistantStateService.deleteMemory(req.user, req.params.id));
  } catch (error) { next(error); }
});

router.get('/assistant/tasks', authRequired, (req, res, next) => {
  try {
    res.json({ tasks: aiAssistantStateService.listTasks(req.user, req.query || {}) });
  } catch (error) { next(error); }
});

router.put('/assistant/tasks/:id', authRequired, (req, res, next) => {
  try {
    res.json({ task: aiAssistantStateService.saveTask(req.user, req.params.id, req.body || {}) });
  } catch (error) { next(error); }
});

// ===== 我的用量统计 =====
router.get('/usage', authRequired, (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  const stats = aiService.getUsageStats(req.user.id, days);
  const organizationId = accountScope.mainAccountIdOf(req.user) || null;
  res.json({ stats, days, quota: organizationId ? aiQuotaService.getQuotaSummary(organizationId) : null });
});

// ===== 单位额度与明细 =====
router.get('/quota', authRequired, (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req);
    res.json({ quota: aiQuotaService.getQuotaSummary(organizationId) });
  } catch (error) { next(error); }
});

router.get('/quota/ledger', authRequired, (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req);
    res.json(aiQuotaService.listQuotaLedger(organizationId, { page: req.query.page, pageSize: req.query.pageSize }));
  } catch (error) { next(error); }
});

router.get('/usage/detail', authRequired, (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req);
    const requestedUserId = req.query.userId ? String(req.query.userId) : '';
    const userId = req.user.role === 'member' ? req.user.id : requestedUserId;
    res.json(aiService.listUsageDetails({
      mainAccountId: organizationId,
      userId,
      page: req.query.page,
      pageSize: req.query.pageSize,
      days: req.query.days,
      status: req.query.status,
    }));
  } catch (error) { next(error); }
});

// ===== 以下是管理员接口 =====

// ===== Provider 列表 =====
router.get('/providers', authRequired, adminRequired, (req, res) => {
  res.json({ providers: aiService.listProviders() });
});

// ===== 保存前测试 Provider =====
router.post('/providers/test', authRequired, adminRequired, aiLimiter, async (req, res, next) => {
  const target = req.body?.providerId || 'unsaved';
  try {
    const result = await aiService.testProviderConnection(req.body || {});
    authService.writeAuditLog(req.user.id, 'test_ai_provider', target, JSON.stringify({ success: true, model: result.model, latencyMs: result.latencyMs }), req.ip);
    res.json(result);
  } catch (error) {
    authService.writeAuditLog(req.user.id, 'test_ai_provider', target, JSON.stringify({ success: false }), req.ip);
    next(error);
  }
});

// ===== 创建 Provider =====
router.post('/providers', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { name, providerType, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel } = req.body;
    const provider = aiService.createProvider({ name, providerType, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel });
    authService.writeAuditLog(req.user.id, 'create_ai_provider', provider.id, JSON.stringify({ name: provider.name, providerType: provider.providerType }), req.ip);
    res.status(201).json({ provider });
  } catch (err) { next(err); }
});

// ===== 更新 Provider =====
router.put('/providers/:id', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { name, providerType, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel, isActive } = req.body;
    const provider = aiService.updateProvider(req.params.id, { name, providerType, baseUrl, apiKey, defaultModel, availableModels, supportsVision, visionModel, isActive });
    authService.writeAuditLog(req.user.id, 'update_ai_provider', provider.id, JSON.stringify({ name: provider.name, isActive: provider.isActive }), req.ip);
    res.json({ provider });
  } catch (err) { next(err); }
});

// ===== 删除 Provider =====
router.delete('/providers/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const result = aiService.deleteProvider(req.params.id);
    authService.writeAuditLog(req.user.id, 'delete_ai_provider', req.params.id, '', req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

// ===== 全局用量统计 =====
router.get('/usage/all', authRequired, adminRequired, (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  const stats = aiService.getUsageStats(null, days);
  res.json({ stats, days });
});

module.exports = router;
