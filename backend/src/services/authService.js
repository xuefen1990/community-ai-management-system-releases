'use strict';

const db = require('../database');
const { hashPassword, verifyPassword, signToken } = require('../utils/crypto');
const logger = require('../utils/logger');

const TRIAL_DAYS = 30;
const PLAN_TYPES = new Set(['trial', 'expires', 'monthly', 'yearly', 'permanent']);

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s-]/g, '');
}

function assertPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!/^\+?\d{6,20}$/.test(normalized)) {
    const err = new Error('请输入有效的手机号');
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

function assertPassword(password, label = '密码') {
  if (typeof password !== 'string' || password.length < 6) {
    const err = new Error(`${label}长度不能少于6位`);
    err.statusCode = 400;
    throw err;
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    villageName: user.village_name,
    planType: user.plan_type,
    planExpiresAt: user.plan_expires_at,
    trialStartedAt: user.trial_started_at,
    machineId: user.machine_id,
    isActive: !!user.is_active,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

function register({ phone, password, name, villageName, machineId }) {
  const normalizedPhone = assertPhone(phone);
  assertPassword(password);

  const existing = db.findOne('users', u => u.phone === normalizedPhone);
  if (existing) {
    const err = new Error('该手机号已注册');
    err.statusCode = 409;
    throw err;
  }

  const now = db.now();
  const id = db.genId();
  const hash = hashPassword(password);
  const trialExpires = addDays(now, TRIAL_DAYS);

  const record = {
    id, phone: normalizedPhone, password_hash: hash,
    name: name || '', role: 'user',
    village_name: villageName || '',
    plan_type: 'trial', plan_expires_at: trialExpires,
    trial_started_at: now, machine_id: machineId || '',
    is_active: 1, last_login_at: null,
    created_at: now, updated_at: now,
  };

  db.insert('users', record);
  logger.info('用户注册', { userId: id, phone: normalizedPhone });

  const token = signToken({ userId: id, role: 'user' });
  return { token, user: getUserById(id) };
}

function login({ phone, password, machineId }) {
  const normalizedPhone = normalizePhone(phone);
  const user = db.findOne('users', u => u.phone === normalizedPhone);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const err = new Error('手机号或密码错误');
    err.statusCode = 401;
    throw err;
  }
  if (!user.is_active) {
    const err = new Error('账号已被禁用，请联系管理员');
    err.statusCode = 403;
    throw err;
  }

  const now = db.now();
  const patch = { last_login_at: now, updated_at: now };

  if (machineId && !user.machine_id) {
    patch.machine_id = machineId;
  }

  db.updateById('users', user.id, patch);
  logger.info('用户登录', { userId: user.id, phone: normalizedPhone });

  const token = signToken({ userId: user.id, role: user.role });
  return { token, user: getUserById(user.id) };
}

function getUserById(id) {
  return sanitizeUser(db.findById('users', id));
}

function getUserByPhone(phone) {
  return sanitizeUser(db.findOne('users', u => u.phone === phone));
}

function listUsers({ keyword = '', isActive, page = 1, pageSize = 20 } = {}) {
  const normalizedKeyword = String(keyword).trim().toLowerCase();
  const requestedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const requestedSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  let users = db.findAll('users');
  if (normalizedKeyword) {
    users = users.filter(user => [user.phone, user.name, user.village_name]
      .some(value => String(value || '').toLowerCase().includes(normalizedKeyword)));
  }
  if (isActive !== undefined && isActive !== '') {
    const active = String(isActive) === 'true' || String(isActive) === '1';
    users = users.filter(user => Boolean(user.is_active) === active);
  }
  users = users
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map(sanitizeUser);
  const total = users.length;
  const start = (requestedPage - 1) * requestedSize;
  return {
    users: users.slice(start, start + requestedSize),
    pagination: { page: requestedPage, pageSize: requestedSize, total, totalPages: Math.max(1, Math.ceil(total / requestedSize)) },
  };
}

function updateProfile(userId, { name, villageName, phone }) {
  const current = db.findById('users', userId);
  if (!current) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }

  if (phone && phone !== current.phone) {
    const normalizedPhone = assertPhone(phone);
    const existing = db.findOne('users', u => u.phone === normalizedPhone && u.id !== userId);
    if (existing) {
      const err = new Error('该手机号已被其他用户使用');
      err.statusCode = 409;
      throw err;
    }
  }

  const patch = { updated_at: db.now() };
  if (name !== undefined) patch.name = name;
  if (villageName !== undefined) patch.village_name = villageName;
  if (phone) patch.phone = normalizePhone(phone);

  db.updateById('users', userId, patch);
  return getUserById(userId);
}

function changePassword(userId, { oldPassword, newPassword }) {
  assertPassword(newPassword, '新密码');

  const user = db.findById('users', userId);
  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!verifyPassword(oldPassword, user.password_hash)) {
    const err = new Error('原密码错误');
    err.statusCode = 401;
    throw err;
  }

  const hash = hashPassword(newPassword);
  db.updateById('users', userId, { password_hash: hash, updated_at: db.now() });

  logger.info('用户修改密码', { userId });
  return { success: true };
}

function resetPassword(userId, newPassword) {
  assertPassword(newPassword, '新密码');
  const user = db.findById('users', userId);
  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }
  db.updateById('users', userId, { password_hash: hashPassword(newPassword), updated_at: db.now() });
  logger.info('管理员重置用户密码', { targetUserId: userId });
  return getUserById(userId);
}

function updateEntitlement(userId, { planType, planExpiresAt, isActive }) {
  const user = db.findById('users', userId);
  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }

  if (planType && !PLAN_TYPES.has(planType)) {
    const err = new Error('授权类型无效');
    err.statusCode = 400;
    throw err;
  }
  if (planType === 'permanent' && planExpiresAt) {
    const err = new Error('永久授权不能设置到期日期');
    err.statusCode = 400;
    throw err;
  }
  if (planType === 'expires' && !planExpiresAt) {
    const err = new Error('限期授权必须设置到期日期');
    err.statusCode = 400;
    throw err;
  }
  if ((planType === 'trial' || planType === 'expires') && planExpiresAt) {
    const expiresAt = new Date(planExpiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      const err = new Error('授权到期日期无效');
      err.statusCode = 400;
      throw err;
    }
  }
  const patch = { updated_at: db.now() };
  if (planType) patch.plan_type = planType;
  if (planType === 'permanent') patch.plan_expires_at = null;
  else if (planType === 'trial' && !planExpiresAt) patch.plan_expires_at = addDays(db.now(), TRIAL_DAYS);
  else if (planExpiresAt !== undefined) patch.plan_expires_at = planExpiresAt || null;
  if (isActive !== undefined) patch.is_active = isActive ? 1 : 0;

  db.updateById('users', userId, patch);
  logger.info('管理员更新用户授权', { targetUserId: userId, planType, isActive });
  return getUserById(userId);
}

function bindMachine(userId, machineId) {
  db.updateById('users', userId, { machine_id: machineId, updated_at: db.now() });
  return getUserById(userId);
}

function checkEntitlement(user) {
  if (!user) return { valid: false, reason: '未登录' };

  const now = new Date();
  if (!user.isActive) return { valid: false, reason: '账号已被禁用' };

  if (user.planType === 'permanent') return { valid: true, plan: 'permanent' };

  if (!user.planExpiresAt) return { valid: false, reason: '授权已过期' };

  const expires = new Date(user.planExpiresAt);
  if (now > expires) return { valid: false, reason: '授权已于 ' + expires.toLocaleDateString() + ' 过期' };

  return { valid: true, plan: user.planType, expiresAt: user.planExpiresAt };
}

function writeAuditLog(userId, action, target, detail, ipAddress) {
  db.insert('audit_logs', {
    id: db.genId(),
    user_id: userId || '',
    action, target: target || '', detail: detail || '',
    ip_address: ipAddress || '',
    created_at: db.now(),
  });
}

module.exports = {
  register,
  login,
  getUserById,
  getUserByPhone,
  listUsers,
  updateProfile,
  changePassword,
  resetPassword,
  updateEntitlement,
  bindMachine,
  checkEntitlement,
  writeAuditLog,
  sanitizeUser,
};
