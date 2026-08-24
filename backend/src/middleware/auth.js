'use strict';

const { verifyToken } = require('../utils/crypto');
const db = require('../database');
const authService = require('../services/authService');
const logger = require('../utils/logger');

function extractToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') return parts[1];
  return null;
}

function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  try {
    const decoded = verifyToken(token);
    const user = db.findOne('users', u => u.id === decoded.userId);
    const access = authService.getAccessStatus(user);
    if (!access.valid) return res.status(401).json({ error: access.reason || '用户不存在或已被禁用' });
    req.user = user;
    next();
  } catch (err) {
    logger.warn('JWT 验证失败', { error: err.message });
    return res.status(401).json({ error: '认证令牌无效或已过期' });
  }
}

function adminRequired(req, res, next) {
  if (!authService.isPlatformAdmin(req.user)) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

function unitAdminRequired(req, res, next) {
  if (!authService.isUnitAdmin(req.user)) return res.status(403).json({ error: '需要单位管理员权限' });
  next();
}

function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = verifyToken(token);
      const user = db.findOne('users', u => u.id === decoded.userId);
      if (authService.getAccessStatus(user).valid) req.user = user;
    } catch {
      // 忽略无效 token，继续作为匿名请求
    }
  }
  next();
}

module.exports = { authRequired, adminRequired, unitAdminRequired, optionalAuth };
