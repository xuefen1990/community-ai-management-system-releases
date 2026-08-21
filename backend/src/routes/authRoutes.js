'use strict';

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const licenseService = require('../services/licenseService');
const { authRequired, adminRequired } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { ApiError } = require('../middleware/errorHandler');

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
}

// ===== 注册 =====
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { phone, password, name, villageName, machineId } = req.body;
    const result = authService.register({ phone, password, name, villageName, machineId });
    authService.writeAuditLog(result.user.id, 'register', phone, '', getClientIp(req));
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ===== 登录 =====
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { phone, password, machineId } = req.body;
    const result = authService.login({ phone, password, machineId });
    authService.writeAuditLog(result.user.id, 'login', phone, '', getClientIp(req));
    res.json(result);
  } catch (err) { next(err); }
});

// ===== 获取当前用户信息 =====
router.get('/profile', authRequired, (req, res) => {
  res.json({ user: authService.getUserById(req.user.id) });
});

// ===== 更新个人资料 =====
router.put('/profile', authRequired, async (req, res, next) => {
  try {
    const { name, villageName, phone } = req.body;
    const user = authService.updateProfile(req.user.id, { name, villageName, phone });
    res.json({ user });
  } catch (err) { next(err); }
});

// ===== 修改密码 =====
router.put('/password', authRequired, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const result = authService.changePassword(req.user.id, { oldPassword, newPassword });
    res.json(result);
  } catch (err) { next(err); }
});

// ===== 绑定机器 =====
router.post('/bind-machine', authRequired, (req, res) => {
  const { machineId } = req.body;
  const user = authService.bindMachine(req.user.id, machineId);
  res.json({ user });
});

// ===== 检查授权状态 =====
router.get('/entitlement', authRequired, (req, res) => {
  const user = authService.getUserById(req.user.id);
  const result = authService.checkEntitlement(user);
  res.json(result);
});

// ===== 激活许可证 =====
router.post('/activate-license', authRequired, async (req, res, next) => {
  try {
    const { code, machineId } = req.body;
    const result = licenseService.activateLicense({ code, userId: req.user.id, machineId });
    res.json(result);
  } catch (err) { next(err); }
});

// ===== 我的许可证列表 =====
router.get('/my-licenses', authRequired, (req, res) => {
  res.json({ licenses: licenseService.listUserLicenses(req.user.id) });
});

// ===== 以下是管理员接口 =====

// ===== 用户列表 =====
router.get('/users', authRequired, adminRequired, (req, res) => {
  res.json({ users: authService.listUsers() });
});

// ===== 更新用户授权（管理员）=====
router.put('/users/:userId/entitlement', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { planType, planExpiresAt, isActive } = req.body;
    const user = authService.updateEntitlement(req.params.userId, { planType, planExpiresAt, isActive });
    authService.writeAuditLog(req.user.id, 'update_entitlement', req.params.userId, JSON.stringify({ planType, planExpiresAt, isActive }), getClientIp(req));
    res.json({ user });
  } catch (err) { next(err); }
});

// ===== 生成许可证（管理员）=====
router.post('/licenses/generate', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { userId, planType, machineId, expiresAt } = req.body;
    const license = licenseService.generateLicense({ userId, planType, machineId, expiresAt });
    authService.writeAuditLog(req.user.id, 'generate_license', license.id, JSON.stringify({ userId, planType }), getClientIp(req));
    res.status(201).json({ license });
  } catch (err) { next(err); }
});

// ===== 许可证列表（管理员）=====
router.get('/licenses', authRequired, adminRequired, (req, res) => {
  res.json({ licenses: licenseService.listLicenses() });
});

// ===== 审计日志（管理员）=====
router.get('/audit-logs', authRequired, adminRequired, (req, res) => {
  const db = require('../database');
  const logs = db.findAll('audit_logs')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 500);
  res.json({ logs });
});

module.exports = router;
