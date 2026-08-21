'use strict';

const db = require('../database');
const { hashPassword, verifyPassword, signToken } = require('../utils/crypto');
const logger = require('../utils/logger');

const TRIAL_DAYS = 30;

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
  if (!phone || !password) {
    const err = new Error('手机号和密码不能为空');
    err.statusCode = 400;
    throw err;
  }
  if (password.length < 6) {
    const err = new Error('密码长度不能少于6位');
    err.statusCode = 400;
    throw err;
  }

  const existing = db.findOne('users', u => u.phone === phone);
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
    id, phone, password_hash: hash,
    name: name || '', role: 'user',
    village_name: villageName || '',
    plan_type: 'trial', plan_expires_at: trialExpires,
    trial_started_at: now, machine_id: machineId || '',
    is_active: 1, last_login_at: null,
    created_at: now, updated_at: now,
  };

  db.insert('users', record);
  logger.info('用户注册', { userId: id, phone });

  const token = signToken({ userId: id, role: 'user' });
  return { token, user: getUserById(id) };
}

function login({ phone, password, machineId }) {
  const user = db.findOne('users', u => u.phone === phone);
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
  logger.info('用户登录', { userId: user.id, phone });

  const token = signToken({ userId: user.id, role: user.role });
  return { token, user: getUserById(user.id) };
}

function getUserById(id) {
  return sanitizeUser(db.findById('users', id));
}

function getUserByPhone(phone) {
  return sanitizeUser(db.findOne('users', u => u.phone === phone));
}

function listUsers() {
  return db.findAll('users')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map(sanitizeUser);
}

function updateProfile(userId, { name, villageName, phone }) {
  const current = db.findById('users', userId);
  if (!current) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }

  if (phone && phone !== current.phone) {
    const existing = db.findOne('users', u => u.phone === phone && u.id !== userId);
    if (existing) {
      const err = new Error('该手机号已被其他用户使用');
      err.statusCode = 409;
      throw err;
    }
  }

  const patch = { updated_at: db.now() };
  if (name !== undefined) patch.name = name;
  if (villageName !== undefined) patch.village_name = villageName;
  if (phone) patch.phone = phone;

  db.updateById('users', userId, patch);
  return getUserById(userId);
}

function changePassword(userId, { oldPassword, newPassword }) {
  if (!newPassword || newPassword.length < 6) {
    const err = new Error('新密码长度不能少于6位');
    err.statusCode = 400;
    throw err;
  }

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

function updateEntitlement(userId, { planType, planExpiresAt, isActive }) {
  const user = db.findById('users', userId);
  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }

  const patch = { updated_at: db.now() };
  if (planType) patch.plan_type = planType;
  if (planExpiresAt !== undefined) patch.plan_expires_at = planExpiresAt;
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
  updateEntitlement,
  bindMachine,
  checkEntitlement,
  writeAuditLog,
  sanitizeUser,
};
