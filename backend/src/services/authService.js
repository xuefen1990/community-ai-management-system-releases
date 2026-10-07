'use strict';

const crypto = require('node:crypto');
const db = require('../database');
const { hashPassword, verifyPassword, needsPasswordUpgrade, signToken } = require('../utils/crypto');
const logger = require('../utils/logger');
const aiQuotaService = require('./aiQuotaService');
const permissionPolicy = require('./permissionPolicy');
const accountScope = require('./mainAccountScope');
const PLAN_TYPES = new Set(['trial', 'expires', 'permanent']);

function failure(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
function normalizePhone(phone) { return String(phone || '').replace(/[\s-]/g, ''); }
function assertPhone(phone) { const value = normalizePhone(phone); if (!/^\+?\d{6,20}$/.test(value)) throw failure(400, '请输入有效的手机号'); return value; }
function assertPassword(password, label = '密码') { if (typeof password !== 'string' || password.length < 6) throw failure(400, `${label}长度不能少于6位`); }
function text(value, label, maximum = 100) { const result = String(value || '').trim(); if (!result || result.length > maximum) throw failure(400, `${label}不能为空且不能超过 ${maximum} 个字符`); return result; }
function iso(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function isPlatformAdmin(user) { return user?.role === 'admin' || user?.role === 'platform_admin'; }
function isUnitAdmin(user) { return ['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(user?.role); }
function organizationOf(user) { return user?.organization_id ? db.findById('organizations', user.organization_id) : null; }
function unitAdminOf(organization) { return organization?.unit_admin_user_id ? db.findById('users', organization.unit_admin_user_id) : null; }

function checkUnitAdminPlan(user) {
  if (user.plan_type === 'permanent') return { valid: true, plan: 'permanent', expiresAt: null };
  const expiresAt = iso(user.plan_expires_at);
  if (!expiresAt || new Date(expiresAt) <= new Date()) return { valid: false, reason: '主账号使用期限已到，请联系平台管理员续期' };
  return { valid: true, plan: user.plan_type === 'trial' ? 'trial' : 'expires', expiresAt };
}

function checkPlatformPlan(user) {
  // 早期平台管理员没有单独的有效期字段，保持其原有的永久授权行为。
  if (!user.plan_type || user.plan_type === 'permanent') return { valid: true, plan: 'permanent', expiresAt: null };
  const expiresAt = iso(user.plan_expires_at);
  if (!expiresAt || new Date(expiresAt) <= new Date()) return { valid: false, reason: '账号有效期已到，请联系管理员续期' };
  return { valid: true, plan: user.plan_type === 'trial' ? 'trial' : 'expires', expiresAt };
}

function getAccessStatus(user) {
  if (!user) return { valid: false, reason: '未登录' };
  if (!user.is_active || user.account_status === 'disabled') return { valid: false, reason: '账号已被停用，请联系管理员' };
  if (user.account_status && user.account_status !== 'active') {
    const messages = { pending_platform_review: '单位管理员申请尚未通过平台审核', pending_unit_review: '加入单位申请尚未通过单位管理员审核', rejected: '申请未获审核通过，请联系管理员' };
    return { valid: false, reason: messages[user.account_status] || '账号当前不可用' };
  }
  if (isPlatformAdmin(user)) return { ...checkPlatformPlan(user), scope: 'platform' };
  const mainAccount = accountScope.mainAccountOf(user);
  if (!mainAccount || !isUnitAdmin(mainAccount)) return { valid: false, reason: '主账号归属无效，请联系平台管理员' };
  if (!mainAccount.is_active || mainAccount.account_status !== 'active') return { valid: false, reason: '主账号已停用，请联系平台管理员' };
  const organization = organizationOf(user);
  if (user.organization_id && (!organization || organization.status !== 'active' || organization.unit_admin_user_id !== mainAccount.id)) return { valid: false, reason: '原账号归属异常，请联系平台管理员' };
  const entitlement = checkUnitAdminPlan(mainAccount);
  return entitlement.valid ? { ...entitlement, scope: isUnitAdmin(user) ? 'main_account' : 'member' } : entitlement;
}

function sanitizeOrganization(record) {
  if (!record) return null;
  return { id: record.id, name: record.name, region: record.region, status: record.status, unitAdminUserId: record.unit_admin_user_id, createdAt: record.created_at };
}
function sanitizeUser(record) {
  if (!record) return null;
  const organization = organizationOf(record);
  return {
    id: record.id, phone: record.deleted_at ? '已删除' : record.phone, name: record.name, role: record.role,
    accountStatus: record.account_status || (record.is_active ? 'active' : 'disabled'),
    organizationId: record.organization_id || null, organization: sanitizeOrganization(organization),
    mainAccountId: accountScope.mainAccountIdOf(record) || null,
    villageName: organization?.name || record.village_name || '', permissions: record.role === 'member' ? permissionPolicy.normalizePermissions(record.permissions || {}) : (record.permissions || {}),
    aiAccessEnabled: record.ai_access_enabled !== 0, mustChangePassword: Boolean(record.must_change_password),
    loginLockedUntil: record.login_locked_until || null,
    planType: record.plan_type || null, planExpiresAt: record.plan_expires_at || null,
    machineId: record.machine_id, isActive: !!record.is_active, isDeleted: Boolean(record.deleted_at), deletedAt: record.deleted_at || null, lastLoginAt: record.last_login_at, createdAt: record.created_at,
  };
}
function getUserById(id) { return sanitizeUser(db.findById('users', id)); }
function getUserByPhone(phone) { return sanitizeUser(db.findOne('users', user => user.phone === normalizePhone(phone))); }
function assertUniquePhone(phone) { if (db.findOne('users', user => user.phone === phone)) throw failure(409, '该手机号已注册或已有待审核申请'); }
function writeAuditLog(userId, action, target, detail = '', ipAddress = '') { db.insert('audit_logs', { id: db.genId(), user_id: userId || '', action, target: target || '', detail: detail || '', ip_address: ipAddress || '', created_at: db.now() }); }
function newUser({ phone, password, name, role, accountStatus, organizationId = null, mainAccountId = null, machineId = '' }) {
  const now = db.now();
  return { id: db.genId(), phone, password_hash: hashPassword(password), name, role, account_status: accountStatus, organization_id: organizationId, main_account_id: mainAccountId, permissions: {}, ai_access_enabled: 1, must_change_password: 0, village_name: '', plan_type: null, plan_expires_at: null, trial_started_at: null, machine_id: machineId || '', session_version: 0, is_active: accountStatus === 'active' ? 1 : 0, last_login_at: null, created_at: now, updated_at: now };
}
function planPatch({ planType = 'trial', planExpiresAt }) {
  if (!PLAN_TYPES.has(planType)) throw failure(400, '有效期类型无效');
  if (planType === 'permanent') return { plan_type: 'permanent', plan_expires_at: null };
  const expiresAt = iso(planExpiresAt || (planType === 'trial' ? new Date(Date.now() + 30 * 86400000).toISOString() : null));
  if (!expiresAt || new Date(expiresAt) <= new Date()) throw failure(400, '请设置未来的有效期结束时间');
  return { plan_type: planType, plan_expires_at: expiresAt };
}

function registerMainAccount({ phone, password, machineId = '' }) {
  const normalizedPhone = assertPhone(phone);
  assertPassword(password);
  assertUniquePhone(normalizedPhone);
  const user = newUser({ phone: normalizedPhone, password, name: '主账号', role: 'main_account', accountStatus: 'active', machineId });
  user.main_account_id = user.id;
  Object.assign(user, planPatch({ planType: 'trial' }), { trial_started_at: db.now() });
  db.atomic(() => {
    db.insert('users', user);
    db.insert('unit_workspaces', { id: db.genId(), main_account_id: user.id, version: 1, data: {}, updated_by: user.id, updated_at: db.now() });
    aiQuotaService.grantInitialQuota(user.id, { userId: user.id, reason: '主账号注册赠送默认额度' });
    writeAuditLog(user.id, 'register_main_account', user.id);
  });
  return login({ phone: normalizedPhone, password, machineId });
}

function submitUnitAdminApplication({ phone, password, name, organizationName, region, machineId }) {
  const normalizedPhone = assertPhone(phone); assertPassword(password); assertUniquePhone(normalizedPhone);
  const user = newUser({ phone: normalizedPhone, password, name: text(name, '申请人姓名', 50), role: 'unit_admin', accountStatus: 'pending_platform_review', machineId });
  const application = { id: db.genId(), user_id: user.id, organization_name: text(organizationName, '单位名称'), region: text(region, '所在地区'), status: 'pending', reviewed_by: '', reviewed_at: null, review_note: '', created_at: db.now(), updated_at: db.now() };
  db.insert('users', user); db.insert('unit_admin_applications', application);
  writeAuditLog(user.id, 'submit_unit_admin_application', application.id, JSON.stringify({ organizationName: application.organization_name, region: application.region }));
  return { application: sanitizeUnitAdminApplication(application) };
}
function sanitizeUnitAdminApplication(application) {
  const user = db.findById('users', application.user_id);
  return { id: application.id, status: application.status, reviewNote: application.review_note || '', organizationName: application.organization_name, region: application.region, organizationId: application.organization_id || null, applicant: user && { id: user.id, name: user.name, phone: user.phone }, createdAt: application.created_at, reviewedAt: application.reviewed_at };
}
function listUnitAdminApplications({ status } = {}) { return db.findAll('unit_admin_applications', item => !status || item.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeUnitAdminApplication); }
function reviewUnitAdminApplication(actor, applicationId, { approve, reviewNote = '', planType = 'trial', planExpiresAt } = {}) {
  const application = db.findById('unit_admin_applications', applicationId);
  if (!application) throw failure(404, '未找到单位管理员申请');
  if (application.status !== 'pending') throw failure(409, '该申请已经处理，不能重复审核');
  const user = db.findById('users', application.user_id); const now = db.now();
  if (!approve) {
    db.updateById('unit_admin_applications', application.id, { status: 'rejected', reviewed_by: actor.id, reviewed_at: now, review_note: String(reviewNote), updated_at: now });
    db.updateById('users', user.id, { account_status: 'rejected', is_active: 0, updated_at: now });
    writeAuditLog(actor.id, 'reject_unit_admin_application', application.id, String(reviewNote));
    return { application: sanitizeUnitAdminApplication(db.findById('unit_admin_applications', application.id)) };
  }
  if (db.findOne('organizations', item => item.status === 'active' && item.name === application.organization_name && item.region === application.region)) throw failure(409, '该地区的同名单位已有有效单位管理员');
  const organization = { id: db.genId(), name: application.organization_name, region: application.region, status: 'active', unit_admin_user_id: user.id, created_at: now, updated_at: now };
  db.insert('organizations', organization); db.updateById('users', user.id, { organization_id: organization.id, main_account_id: user.id, account_status: 'active', is_active: 1, ...planPatch({ planType, planExpiresAt }), updated_at: now }); aiQuotaService.grantInitialQuota(user.id, { userId: user.id });
  db.updateById('unit_admin_applications', application.id, { status: 'approved', organization_id: organization.id, reviewed_by: actor.id, reviewed_at: now, review_note: String(reviewNote), updated_at: now });
  writeAuditLog(actor.id, 'approve_unit_admin_application', application.id, JSON.stringify({ organizationId: organization.id }));
  return { application: sanitizeUnitAdminApplication(db.findById('unit_admin_applications', application.id)), organization: sanitizeOrganization(organization), user: getUserById(user.id) };
}

function sanitizeInvite(invite) { return { id: invite.id, organizationId: invite.organization_id, maxUses: invite.max_uses, usedCount: invite.used_count, expiresAt: invite.expires_at, isActive: !!invite.is_active, createdAt: invite.created_at }; }
function listInvites(actor) { if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以查看邀请码'); return db.findAll('unit_invites', item => item.organization_id === actor.organization_id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeInvite); }
function sanitizeMemberApplication(application) { const user = db.findById('users', application.user_id); return { id: application.id, status: application.status, reviewNote: application.review_note || '', organizationId: application.organization_id, applicant: user && { id: user.id, name: user.name, phone: user.phone }, createdAt: application.created_at, reviewedAt: application.reviewed_at }; }
function listMemberApplications(actor, { status } = {}) { if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以查看成员申请'); return db.findAll('member_applications', item => item.organization_id === actor.organization_id && (!status || item.status === status)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeMemberApplication); }
function permissions(value) { return permissionPolicy.normalizePermissions(value); }
function requestedMemberPermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, '权限配置格式无效');
  const allowed = new Map(permissionPolicy.CATALOG.map(module => [module.id, new Set(module.actions)]));
  for (const [moduleId, actions] of Object.entries(value)) {
    if (!allowed.has(moduleId) || !Array.isArray(actions) || actions.some(action => !allowed.get(moduleId).has(action))) throw failure(400, '权限配置中包含未知板块或操作');
  }
  return permissions(value);
}
function createMember(actor, { phone, name, preset = 'custom', permissions: requestedPermissions, aiAccessEnabled } = {}) {
  if (!isUnitAdmin(actor) || !getAccessStatus(actor).valid || accountScope.mainAccountIdOf(actor) !== actor.id) throw failure(403, '只有有效的主账号可以开通子账号');
  const normalizedPhone = assertPhone(phone);
  assertUniquePhone(normalizedPhone);
  const template = permissionPolicy.PRESETS[preset];
  if (!template) throw failure(400, '岗位预设无效');
  const initialPassword = crypto.randomBytes(15).toString('base64url');
  const member = newUser({ phone: normalizedPhone, password: initialPassword, name: text(name, '姓名', 50), role: 'member', accountStatus: 'active', organizationId: actor.organization_id || null, mainAccountId: actor.id });
  member.permissions = requestedMemberPermissions(requestedPermissions === undefined ? template.permissions : requestedPermissions);
  member.ai_access_enabled = aiAccessEnabled === undefined ? Number(template.aiAccessEnabled) : Number(aiAccessEnabled === true);
  member.must_change_password = 1;
  member.created_by = actor.id;
  member.position_preset = preset;
  db.insert('users', member);
  writeAuditLog(actor.id, 'create_unit_member', member.id, JSON.stringify({ mainAccountId: actor.id, permissions: member.permissions, aiAccessEnabled: Boolean(member.ai_access_enabled) }));
  return { user: getUserById(member.id), initialPassword };
}
function resetMemberPassword(actor, memberId) {
  if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以重置成员密码');
  const member = db.findById('users', memberId);
  if (!member || member.deleted_at || accountScope.mainAccountIdOf(member) !== actor.id || member.role !== 'member') throw failure(404, '未找到本账号成员');
  const initialPassword = crypto.randomBytes(15).toString('base64url');
  db.updateById('users', member.id, { password_hash: hashPassword(initialPassword), must_change_password: 1, session_version: Number(member.session_version || 0) + 1, updated_at: db.now() });
  writeAuditLog(actor.id, 'reset_unit_member_password', member.id);
  return { user: getUserById(member.id), initialPassword };
}
function reviewMemberApplication(actor, applicationId, { approve, reviewNote = '', permissions: requestedPermissions = {} } = {}) {
  if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以审核成员申请'); const application = db.findById('member_applications', applicationId);
  if (!application || application.organization_id !== actor.organization_id) throw failure(404, '未找到成员申请'); if (application.status !== 'pending') throw failure(409, '该申请已经处理，不能重复审核');
  const user = db.findById('users', application.user_id); const now = db.now(); const granted = approve ? permissions(requestedPermissions) : {};
  db.updateById('member_applications', application.id, { status: approve ? 'approved' : 'rejected', reviewed_by: actor.id, reviewed_at: now, review_note: String(reviewNote), updated_at: now }); db.updateById('users', user.id, { account_status: approve ? 'active' : 'rejected', is_active: approve ? 1 : 0, permissions: granted, updated_at: now }); writeAuditLog(actor.id, approve ? 'approve_member_application' : 'reject_member_application', application.id, JSON.stringify({ memberId: user.id, permissions: granted })); return { application: sanitizeMemberApplication(db.findById('member_applications', application.id)), user: getUserById(user.id) };
}
function listUnitMembers(actor) {
  if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以查看成员账号');
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const usage = new Map();
  for (const row of db.findAll('ai_usage', row => row.main_account_id === actor.id && row.created_at >= since)) {
    usage.set(row.user_id, (usage.get(row.user_id) || 0) + Number(row.charged_tokens ?? row.total_tokens ?? 0));
  }
  return db.findAll('users', user => accountScope.mainAccountIdOf(user) === actor.id && user.role === 'member' && !user.deleted_at)
    .map(user => ({ ...sanitizeUser(user), aiTokens30d: usage.get(user.id) || 0, aiCredits30d:db.findAll('ai_usage',row=>row.user_id===user.id&&row.created_at>=since).reduce((n,row)=>n+Number(row.charged_credits ?? ((row.charged_tokens||0)/2000)),0) }));
}
function updateMemberPermissions(actor, memberId, requestedPermissions, aiAccessEnabled) { if (!isUnitAdmin(actor)) throw failure(403, '只有主账号可以分配成员权限'); const member = db.findById('users', memberId); if (!member || member.deleted_at || accountScope.mainAccountIdOf(member) !== actor.id || member.role !== 'member') throw failure(404, '未找到本账号成员'); const granted = requestedMemberPermissions(requestedPermissions); const patch = { permissions: granted, session_version: Number(member.session_version || 0) + 1, updated_at: db.now() }; if (aiAccessEnabled !== undefined) { if (typeof aiAccessEnabled !== 'boolean') throw failure(400, 'AI 权限参数无效'); patch.ai_access_enabled = Number(aiAccessEnabled); } db.updateById('users', member.id, patch); writeAuditLog(actor.id, 'update_member_permissions', member.id, JSON.stringify({ permissions: granted, aiAccessEnabled: patch.ai_access_enabled ?? (member.ai_access_enabled !== 0) })); return getUserById(member.id); }
function updateMemberStatus(actor, memberId, isActive) {
  if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以调整成员状态');
  if (typeof isActive !== 'boolean') throw failure(400, '成员状态参数无效');
  const member = db.findById('users', memberId);
  if (!member || accountScope.mainAccountIdOf(member) !== actor.id || member.role !== 'member') throw failure(404, '未找到本账号成员');
  db.updateById('users', member.id, { is_active: isActive ? 1 : 0, account_status: isActive ? 'active' : 'disabled', ...(isActive ? {} : { session_version: Number(member.session_version || 0) + 1 }), updated_at: db.now() });
  writeAuditLog(actor.id, isActive ? 'enable_unit_member' : 'disable_unit_member', member.id);
  return getUserById(member.id);
}

function login({ phone, password, machineId }) {
  const user = db.findOne('users', item => item.phone === normalizePhone(phone));
  const lockUntil = user?.login_locked_until ? Date.parse(user.login_locked_until) : 0;
  if (lockUntil > Date.now()) throw failure(401, '手机号或密码错误，请稍后再试');
  if (!user || !verifyPassword(password, user.password_hash)) {
    if (user) {
      const attempts = (lockUntil && lockUntil <= Date.now() ? 0 : Number(user.failed_login_attempts || 0)) + 1;
      db.updateById('users', user.id, {
        failed_login_attempts: attempts,
        login_locked_until: attempts >= 10 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
        updated_at: db.now(),
      });
    }
    throw failure(401, '手机号或密码错误，请稍后再试');
  }
  const access = getAccessStatus(user); if (!access.valid) throw failure(403, access.reason);
  const now = db.now(); db.updateById('users', user.id, { last_login_at: now, failed_login_attempts: 0, login_locked_until: null, ...(machineId && !user.machine_id ? { machine_id: machineId } : {}), ...(needsPasswordUpgrade(user.password_hash) ? { password_hash: hashPassword(password) } : {}), updated_at: now }); logger.info('用户登录', { userId: user.id }); return { token: signToken({ userId: user.id, role: user.role, mainAccountId: accountScope.mainAccountIdOf(user) || null, sessionVersion: Number(user.session_version || 0) }), user: getUserById(user.id) };
}
function unlockLogin(actor, userId) {
  if (!isPlatformAdmin(actor)) throw failure(403, '需要平台管理员权限');
  const user = db.findById('users', userId);
  if (!user || user.deleted_at) throw failure(404, '用户不存在');
  db.updateById('users', user.id, { failed_login_attempts: 0, login_locked_until: null, updated_at: db.now() });
  writeAuditLog(actor.id, 'unlock_login', user.id);
  return getUserById(user.id);
}
function listUsers({ keyword = '', isActive, page = 1, pageSize = 20 } = {}) { const word = String(keyword).trim().toLowerCase(); const current = Math.max(1, Number.parseInt(page, 10) || 1); const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20)); let users = db.findAll('users'); if (word) users = users.filter(user => [user.phone, user.name, user.village_name].some(value => String(value || '').toLowerCase().includes(word))); if (isActive !== undefined && isActive !== '') users = users.filter(user => Boolean(user.is_active) === ['true', '1'].includes(String(isActive))); users = users.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeUser); return { users: users.slice((current - 1) * size, current * size), pagination: { page: current, pageSize: size, total: users.length, totalPages: Math.max(1, Math.ceil(users.length / size)) } }; }
function updateProfile(userId, { name, phone }) { const user = db.findById('users', userId); if (!user || user.deleted_at) throw failure(404, '用户不存在'); const patch = { updated_at: db.now() }; if (name !== undefined) patch.name = text(name, '姓名', 50); if (phone && phone !== user.phone) { const normalized = assertPhone(phone); if (db.findOne('users', item => item.phone === normalized && item.id !== userId)) throw failure(409, '该手机号已被其他用户使用'); patch.phone = normalized; } db.updateById('users', userId, patch); return getUserById(userId); }
function nextSessionVersion(user) { return Number(user.session_version || 0) + 1; }
function changePassword(userId, { oldPassword, newPassword }) { assertPassword(newPassword, '新密码'); const user = db.findById('users', userId); if (!user || user.deleted_at) throw failure(404, '用户不存在'); if (!verifyPassword(oldPassword, user.password_hash)) throw failure(401, '原密码错误'); if (oldPassword === newPassword) throw failure(400, '新密码不能与初始密码相同'); db.updateById('users', userId, { password_hash: hashPassword(newPassword), must_change_password: 0, session_version: nextSessionVersion(user), updated_at: db.now() }); writeAuditLog(userId, 'change_password', userId); return { success: true }; }
function resetPassword(userId, newPassword) { assertPassword(newPassword, '新密码'); const user = db.findById('users', userId); if (!user || user.deleted_at) throw failure(404, '用户不存在'); db.updateById('users', userId, { password_hash: hashPassword(newPassword), session_version: nextSessionVersion(user), updated_at: db.now() }); return getUserById(userId); }
function updateEntitlement(userId, { planType, planExpiresAt, isActive }) { const user = db.findById('users', userId); if (!user || user.deleted_at) throw failure(404, '用户不存在'); if (user.role === 'member' && planType) throw failure(400, '子账号使用期限由主账号统一管理'); const patch = { updated_at: db.now() }; if (planType) Object.assign(patch, planPatch({ planType, planExpiresAt })); if (isActive !== undefined) Object.assign(patch, { is_active: isActive ? 1 : 0, account_status: isActive ? 'active' : 'disabled', ...(isActive ? {} : { session_version: nextSessionVersion(user) }) }); db.updateById('users', userId, patch); return getUserById(userId); }
function deleteUser(actor, userId) {
  const user = db.findById('users', userId);
  if (!user || user.deleted_at) throw failure(404, '用户不存在或已删除');
  if (isPlatformAdmin(user)) throw failure(403, '平台管理员账号不能删除');
  const now = db.now(); const releasedPhone = user.phone;
  db.updateById('users', user.id, { phone: `deleted-${user.id}`, password_hash: '', account_status: 'deleted', is_active: 0, machine_id: '', permissions: {}, session_version: nextSessionVersion(user), deleted_at: now, deleted_by: actor.id, updated_at: now });
  let deactivatedOrganizationId = null;
  if (isUnitAdmin(user)) {
    const organization = organizationOf(user);
    if (organization) {
      deactivatedOrganizationId = organization.id;
      db.updateById('organizations', organization.id, { status: 'disabled', updated_at: now });
      db.findAll('unit_invites', invite => invite.organization_id === organization.id && invite.is_active).forEach(invite => db.updateById('unit_invites', invite.id, { is_active: 0, updated_at: now }));
      db.findAll('users', member => member.organization_id === organization.id && member.id !== user.id && !member.deleted_at).forEach(member => db.updateById('users', member.id, { is_active: 0, account_status: 'disabled', session_version: nextSessionVersion(member), updated_at: now }));
    }
    db.findAll('users', member => accountScope.mainAccountIdOf(member) === user.id && member.id !== user.id && !member.deleted_at).forEach(member => db.updateById('users', member.id, { is_active: 0, account_status: 'disabled', session_version: nextSessionVersion(member), updated_at: now }));
  }
  return { id: user.id, releasedPhone, deactivatedOrganizationId };
}
function bindMachine(userId, machineId) { db.updateById('users', userId, { machine_id: machineId, updated_at: db.now() }); return getUserById(userId); }
function checkEntitlement(user) { const current = user?.id ? db.findById('users', user.id) || user : user; const status = getAccessStatus(current); return status.valid ? { valid: true, plan: status.plan, expiresAt: status.expiresAt || null } : status; }

module.exports = { bindMachine, changePassword, checkEntitlement, createMember, deleteUser, getAccessStatus, getUserById, getUserByPhone, isPlatformAdmin, isUnitAdmin, listInvites, listMemberApplications, listUnitAdminApplications, listUnitMembers, listUsers, login, normalizePhone, registerMainAccount, resetMemberPassword, resetPassword, reviewMemberApplication, reviewUnitAdminApplication, sanitizeUser, submitUnitAdminApplication, unlockLogin, updateEntitlement, updateMemberPermissions, updateMemberStatus, updateProfile, writeAuditLog };
