'use strict';

const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const { authRequired, adminRequired } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const { ApiError } = require('../middleware/errorHandler');
const authService = require('../services/authService');
const logger = require('../utils/logger');

// ===== 对话（非流式）=====
router.post('/chat', authRequired, aiLimiter, async (req, res, next) => {
  try {
    const { messages, model, temperature, maxTokens } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'messages 参数不能为空');
    }

    const user = authService.getUserById(req.user.id);
    const entitlement = authService.checkEntitlement(user);
    if (!entitlement.valid) {
      throw new ApiError(403, '当前授权不可用: ' + entitlement.reason);
    }

    const result = await aiService.chat(req.user.id, {
      messages, model, temperature, maxTokens, stream: false,
    });

    res.json(result.data);
  } catch (err) { next(err); }
});

// ===== 对话（流式 SSE）=====
router.post('/chat/stream', authRequired, aiLimiter, async (req, res, next) => {
  try {
    const { messages, model, temperature, maxTokens } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new ApiError(400, 'messages 参数不能为空');
    }

    const user = authService.getUserById(req.user.id);
    const entitlement = authService.checkEntitlement(user);
    if (!entitlement.valid) {
      throw new ApiError(403, '当前授权不可用: ' + entitlement.reason);
    }

    const result = await aiService.chat(req.user.id, {
      messages, model, temperature, maxTokens, stream: true,
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

    responseStream.on('error', (err) => {
      logger.error('AI 流式响应错误', { error: err.message });
      res.end();
    });

    req.on('close', () => {
      responseStream.destroy();
    });
  } catch (err) { next(err); }
});

// ===== 可用模型列表 =====
router.get('/models', authRequired, (req, res) => {
  res.json(aiService.listModels());
});

// ===== 我的用量统计 =====
router.get('/usage', authRequired, (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  const stats = aiService.getUsageStats(req.user.id, days);
  res.json({ stats, days });
});

// ===== 以下是管理员接口 =====

// ===== Provider 列表 =====
router.get('/providers', authRequired, adminRequired, (req, res) => {
  res.json({ providers: aiService.listProviders() });
});

// ===== 创建 Provider =====
router.post('/providers', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { name, providerType, baseUrl, apiKey, defaultModel, availableModels } = req.body;
    const provider = aiService.createProvider({ name, providerType, baseUrl, apiKey, defaultModel, availableModels });
    authService.writeAuditLog(req.user.id, 'create_ai_provider', provider.id, JSON.stringify({ name: provider.name, providerType: provider.providerType }), req.ip);
    res.status(201).json({ provider });
  } catch (err) { next(err); }
});

// ===== 更新 Provider =====
router.put('/providers/:id', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { name, providerType, baseUrl, apiKey, defaultModel, availableModels, isActive } = req.body;
    const provider = aiService.updateProvider(req.params.id, { name, providerType, baseUrl, apiKey, defaultModel, availableModels, isActive });
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
