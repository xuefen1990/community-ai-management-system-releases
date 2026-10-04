'use strict';

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const permissionPolicy = require('../services/permissionPolicy');
const licenseService = require('../services/licenseService');
const { authRequired, adminRequired, unitAdminRequired } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { ApiError } = require('../middleware/errorHandler');
const userPreferences = require('../services/userPreferenceService');

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
}

router.post('/register', authLimiter, (req, res, next) => {
  try {
    const { phone, password, confirmPassword, machineId } = req.body || {};
    if (password !== confirmPassword) throw new ApiError(400, '两次输入的密码不一致');
    const result = authService.registerMainAccount({ phone, password, machineId });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

// ===== 申请成为单位管理员（公开） =====
router.post('/unit-admin-applications', authLimiter, (_req, _res, next) => next(new ApiError(410, '请使用手机号直接注册主账号')));

// ===== 申请加入单位（公开） =====
router.post('/member-applications', authLimiter, (_req, _res, next) => next(new ApiError(410, '请联系单位管理员直接开通成员账号')));

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

router.get('/preferences', authRequired, (req, res) => { res.json(userPreferences.get(req.user)); });
router.put('/preferences', authRequired, (req, res, next) => {
  try { res.json(userPreferences.save(req.user, req.body || {})); }
  catch (error) { next(error); }
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

// ===== 单位管理员接口 =====
router.get('/unit/permissions/catalog', authRequired, unitAdminRequired, (_req, res) => {
  res.json(permissionPolicy.catalog());
});

router.post('/unit/members', authRequired, unitAdminRequired, (req, res, next) => {
  try { res.status(201).json(authService.createMember(req.user, req.body || {})); }
  catch (error) { next(error); }
});

router.post('/unit/members/:memberId/reset-password', authRequired, unitAdminRequired, (req, res, next) => {
  try { res.json(authService.resetMemberPassword(req.user, req.params.memberId)); }
  catch (error) { next(error); }
});

router.get('/unit/member-applications', authRequired, unitAdminRequired, (req, res) => {
  res.json({ applications: authService.listMemberApplications(req.user, { status: req.query.status }) });
});

router.post('/unit/member-applications/:applicationId/review', authRequired, unitAdminRequired, (req, res, next) => {
  try {
    const result = authService.reviewMemberApplication(req.user, req.params.applicationId, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/unit/members', authRequired, unitAdminRequired, (req, res) => {
  res.json({ members: authService.listUnitMembers(req.user) });
});

router.put('/unit/members/:memberId/permissions', authRequired, unitAdminRequired, (req, res, next) => {
  try {
    const user = authService.updateMemberPermissions(req.user, req.params.memberId, req.body.permissions, req.body.aiAccessEnabled);
    res.json({ user });
  } catch (err) { next(err); }
});

router.put('/unit/members/:memberId/status', authRequired, unitAdminRequired, (req, res, next) => {
  try {
    const user = authService.updateMemberStatus(req.user, req.params.memberId, req.body.isActive);
    res.json({ user });
  } catch (err) { next(err); }
});

router.get('/unit/invites', authRequired, unitAdminRequired, (req, res) => {
  res.json({ invites: authService.listInvites(req.user) });
});

router.post('/unit/invites', authRequired, unitAdminRequired, (_req, _res, next) => next(new ApiError(410, '邀请码已停用，请直接新增成员')));

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

router.get('/unit-admin-applications', authRequired, adminRequired, (req, res) => {
  res.json({ applications: authService.listUnitAdminApplications({ status: req.query.status }) });
});

router.post('/unit-admin-applications/:applicationId/review', authRequired, adminRequired, (req, res, next) => {
  try {
    const result = authService.reviewUnitAdminApplication(req.user, req.params.applicationId, req.body);
    authService.writeAuditLog(req.user.id, 'review_unit_admin_application', req.params.applicationId, JSON.stringify(req.body), getClientIp(req));
    res.json(result);
  } catch (err) { next(err); }
});

// ===== 用户列表 =====
router.get('/users', authRequired, adminRequired, (req, res) => {
  const { keyword, isActive, page, pageSize } = req.query;
  res.json(authService.listUsers({ keyword, isActive, page, pageSize }));
});

router.get('/users/:userId', authRequired, adminRequired, (req, res, next) => {
  try {
    const user = authService.getUserById(req.params.userId);
    if (!user) throw new ApiError(404, '用户不存在');
    res.json({ user });
  } catch (err) { next(err); }
});

router.post('/users/:userId/reset-password', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    const user = authService.resetPassword(req.params.userId, newPassword);
    authService.writeAuditLog(req.user.id, 'reset_password', req.params.userId, '', getClientIp(req));
    res.json({ user });
  } catch (err) { next(err); }
});

router.post('/users/:userId/unlock-login', authRequired, adminRequired, (req, res, next) => {
  try { res.json({ user: authService.unlockLogin(req.user, req.params.userId) }); }
  catch (error) { next(error); }
});

router.delete('/users/:userId', authRequired, adminRequired, async (req, res, next) => {
  try {
    const result = authService.deleteUser(req.user, req.params.userId);
    authService.writeAuditLog(req.user.id, 'delete_user', req.params.userId, JSON.stringify({ releasedPhone: result.releasedPhone, deactivatedOrganizationId: result.deactivatedOrganizationId }), getClientIp(req));
    res.json({ result });
  } catch (err) { next(err); }
});

// ===== 更新用户授权（管理员）=====
router.put('/users/:userId/entitlement', authRequired, adminRequired, async (req, res, next) => {
  try {
    const { planType, planExpiresAt, isActive } = req.body;
    if (req.params.userId === req.user.id && isActive === false) {
      throw new ApiError(400, '不能停用当前登录的管理员账号');
    }
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
