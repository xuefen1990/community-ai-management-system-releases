'use strict';

const db = require('../database');
const { randomCode } = require('../utils/crypto');
const logger = require('../utils/logger');

function generateLicense({ userId, planType, machineId, expiresAt }) {
  const validPlans = ['monthly', 'yearly', 'permanent'];
  if (!validPlans.includes(planType)) {
    const err = new Error('无效的授权类型');
    err.statusCode = 400;
    throw err;
  }

  const now = db.now();
  let computedExpiry = expiresAt;

  if (planType === 'monthly' && !computedExpiry) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    computedExpiry = d.toISOString();
  } else if (planType === 'yearly' && !computedExpiry) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    computedExpiry = d.toISOString();
  } else if (planType === 'permanent') {
    computedExpiry = null;
  }

  const code = randomCode('CAI1-');
  const id = db.genId();

  const record = {
    id, code,
    user_id: userId || null,
    plan_type: planType,
    machine_id: machineId || null,
    issued_at: now,
    expires_at: computedExpiry,
    is_activated: 0,
    activated_at: null,
  };

  db.insert('licenses', record);
  logger.info('生成许可证', { licenseId: id, planType, userId });

  return { ...record, is_activated: false };
}

function activateLicense({ code, userId, machineId }) {
  const license = db.findOne('licenses', l => l.code === code);
  if (!license) {
    const err = new Error('许可证码无效');
    err.statusCode = 404;
    throw err;
  }
  if (license.is_activated) {
    const err = new Error('该许可证已被激活');
    err.statusCode = 409;
    throw err;
  }
  if (license.machine_id && machineId && license.machine_id !== machineId) {
    const err = new Error('许可证与当前设备不匹配');
    err.statusCode = 403;
    throw err;
  }
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    const err = new Error('许可证已过期');
    err.statusCode = 403;
    throw err;
  }

  const now = db.now();
  db.updateById('licenses', license.id, {
    is_activated: 1,
    activated_at: now,
    user_id: userId,
  });

  const authService = require('./authService');
  if (userId) {
    let planExpires = license.expires_at;
    if (license.plan_type === 'permanent') planExpires = null;
    authService.updateEntitlement(userId, {
      planType: license.plan_type,
      planExpiresAt: planExpires,
    });
  }

  logger.info('激活许可证', { licenseId: license.id, userId });

  return {
    id: license.id,
    code: license.code,
    planType: license.plan_type,
    expiresAt: license.expires_at,
    isActivated: true,
    activatedAt: now,
  };
}

function listLicenses() {
  return db.findAll('licenses')
    .sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''))
    .map(l => ({
      id: l.id, code: l.code, userId: l.user_id,
      planType: l.plan_type, machineId: l.machine_id,
      issuedAt: l.issued_at, expiresAt: l.expires_at,
      isActivated: !!l.is_activated, activatedAt: l.activated_at,
    }));
}

function listUserLicenses(userId) {
  return db.findAll('licenses', l => l.user_id === userId)
    .sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''))
    .map(l => ({
      id: l.id, code: l.code, planType: l.plan_type,
      machineId: l.machine_id, issuedAt: l.issued_at,
      expiresAt: l.expires_at, isActivated: !!l.is_activated,
      activatedAt: l.activated_at,
    }));
}

module.exports = {
  generateLicense,
  activateLicense,
  listLicenses,
  listUserLicenses,
};
