'use strict';

const crypto = require('node:crypto');
const db = require('../database');
const { hashPassword, verifyPassword, signToken, randomCode } = require('../utils/crypto');
const logger = require('../utils/logger');
const PLAN_TYPES = new Set(['trial', 'expires', 'permanent']);

function failure(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
function normalizePhone(phone) { return String(phone || '').replace(/[\s-]/g, ''); }
function assertPhone(phone) { const value = normalizePhone(phone); if (!/^\+?\d{6,20}$/.test(value)) throw failure(400, '请输入有效的手机号'); return value; }
function assertPassword(password, label = '密码') { if (typeof password !== 'string' || password.length < 6) throw failure(400, `${label}长度不能少于6位`); }
function text(value, label, maximum = 100) { const result = String(value || '').trim(); if (!result || result.length > maximum) throw failure(400, `${label}不能为空且不能超过 ${maximum} 个字符`); return result; }
function iso(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function hashInvite(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
function isPlatformAdmin(user) { return user?.role === 'admin' || user?.role === 'platform_admin'; }
function isUnitAdmin(user) { return user?.role === 'unit_admin'; }
function organizationOf(user) { return user?.organization_id ? db.findById('organizations', user.organization_id) : null; }
function unitAdminOf(organization) { return organization?.unit_admin_user_id ? db.findById('users', organization.unit_admin_user_id) : null; }

function checkUnitAdminPlan(user) {
  if (user.plan_type === 'permanent') return { valid: true, plan: 'permanent', expiresAt: null };
  const expiresAt = iso(user.plan_expires_at);
  if (!expiresAt || new Date(expiresAt) <= new Date()) return { valid: false, reason: '单位管理员有效期已到，请联系平台管理员续期' };
  return { valid: true, plan: user.plan_type === 'trial' ? 'trial' : 'expires', expiresAt };
}

function getAccessStatus(user) {
  if (!user) return { valid: false, reason: '未登录' };
  if (!user.is_active || user.account_status === 'disabled') return { valid: false, reason: '账号已被停用，请联系管理员' };
  if (user.account_status && user.account_status !== 'active') {
    const messages = { pending_platform_review: '单位管理员申请尚未通过平台审核', pending_unit_review: '加入单位申请尚未通过单位管理员审核', rejected: '申请未获审核通过，请联系管理员' };
    return { valid: false, reason: messages[user.account_status] || '账号当前不可用' };
  }
  if (isPlatformAdmin(user)) return { valid: true, plan: 'permanent', scope: 'platform' };
  const organization = organizationOf(user);
  if (!organization || organization.status !== 'active') return { valid: false, reason: '所属单位当前未启用，请联系平台管理员' };
  const unitAdmin = unitAdminOf(organization);
  if (!unitAdmin || !unitAdmin.is_active || unitAdmin.account_status !== 'active') return { valid: false, reason: '单位管理员账号不可用，请联系平台管理员' };
  const entitlement = checkUnitAdminPlan(unitAdmin);
  return entitlement.valid ? { ...entitlement, scope: isUnitAdmin(user) ? 'unit_admin' : 'member' } : entitlement;
}

function sanitizeOrganization(record) {
  if (!record) return null;
  return { id: record.id, name: record.name, region: record.region, status: record.status, unitAdminUserId: record.unit_admin_user_id, createdAt: record.created_at };
}
function sanitizeUser(record) {
  if (!record) return null;
  const organization = organizationOf(record);
  return {
    id: record.id, phone: record.phone, name: record.name, role: record.role,
    accountStatus: record.account_status || (record.is_active ? 'active' : 'disabled'),
    organizationId: record.organization_id || null, organization: sanitizeOrganization(organization),
    villageName: organization?.name || record.village_name || '', permissions: record.permissions || {},
    planType: record.plan_type || null, planExpiresAt: record.plan_expires_at || null,
    machineId: record.machine_id, isActive: !!record.is_active, lastLoginAt: record.last_login_at, createdAt: record.created_at,
  };
}
function getUserById(id) { return sanitizeUser(db.findById('users', id)); }
function getUserByPhone(phone) { return sanitizeUser(db.findOne('users', user => user.phone === normalizePhone(phone))); }
function assertUniquePhone(phone) { if (db.findOne('users', user => user.phone === phone)) throw failure(409, '该手机号已注册或已有待审核申请'); }
function writeAuditLog(userId, action, target, detail = '', ipAddress = '') { db.insert('audit_logs', { id: db.genId(), user_id: userId || '', action, target: target || '', detail: detail || '', ip_address: ipAddress || '', created_at: db.now() }); }
function newUser({ phone, password, name, role, accountStatus, organizationId = null, machineId = '' }) {
  const now = db.now();
  return { id: db.genId(), phone, password_hash: hashPassword(password), name, role, account_status: accountStatus, organization_id: organizationId, permissions: {}, village_name: '', plan_type: null, plan_expires_at: null, trial_started_at: null, machine_id: machineId || '', is_active: accountStatus === 'active' ? 1 : 0, last_login_at: null, created_at: now, updated_at: now };
}
function planPatch({ planType = 'trial', planExpiresAt }) {
  if (!PLAN_TYPES.has(planType)) throw failure(400, '有效期类型无效');
  if (planType === 'permanent') return { plan_type: 'permanent', plan_expires_at: null };
  const expiresAt = iso(planExpiresAt || (planType === 'trial' ? new Date(Date.now() + 30 * 86400000).toISOString() : null));
  if (!expiresAt || new Date(expiresAt) <= new Date()) throw failure(400, '请设置未来的有效期结束时间');
  return { plan_type: planType, plan_expires_at: expiresAt };
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
  db.insert('organizations', organization); db.updateById('users', user.id, { organization_id: organization.id, account_status: 'active', is_active: 1, ...planPatch({ planType, planExpiresAt }), updated_at: now });
  db.updateById('unit_admin_applications', application.id, { status: 'approved', organization_id: organization.id, reviewed_by: actor.id, reviewed_at: now, review_note: String(reviewNote), updated_at: now });
  writeAuditLog(actor.id, 'approve_unit_admin_application', application.id, JSON.stringify({ organizationId: organization.id }));
  return { application: sanitizeUnitAdminApplication(db.findById('unit_admin_applications', application.id)), organization: sanitizeOrganization(organization), user: getUserById(user.id) };
}

function sanitizeInvite(invite) { return { id: invite.id, organizationId: invite.organization_id, maxUses: invite.max_uses, usedCount: invite.used_count, expiresAt: invite.expires_at, isActive: !!invite.is_active, createdAt: invite.created_at }; }
function createInvite(actor, { expiresAt, maxUses = 20 } = {}) {
  const organization = organizationOf(actor); if (!isUnitAdmin(actor) || !organization) throw failure(403, '只有单位管理员可以生成邀请码');
  const expiry = iso(expiresAt || new Date(Date.now() + 7 * 86400000).toISOString()); const uses = Number.parseInt(maxUses, 10);
  if (!expiry || new Date(expiry) <= new Date()) throw failure(400, '邀请码到期时间无效');
  if (!Number.isInteger(uses) || uses < 1 || uses > 1000) throw failure(400, '邀请码使用人数应为 1-1000');
  const code = randomCode('CJ-').slice(0, 18).toUpperCase(); const invite = { id: db.genId(), organization_id: organization.id, code_hash: hashInvite(code), max_uses: uses, used_count: 0, expires_at: expiry, is_active: 1, created_by: actor.id, created_at: db.now(), updated_at: db.now() };
  db.insert('unit_invites', invite); writeAuditLog(actor.id, 'create_unit_invite', invite.id, JSON.stringify({ expiresAt: expiry, maxUses: uses })); return { invite: sanitizeInvite(invite), code };
}
function listInvites(actor) { if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以查看邀请码'); return db.findAll('unit_invites', item => item.organization_id === actor.organization_id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeInvite); }
function deactivateInvite(actor, inviteId) { const invite = db.findById('unit_invites', inviteId); if (!isUnitAdmin(actor) || !invite || invite.organization_id !== actor.organization_id) throw failure(404, '未找到邀请码'); db.updateById('unit_invites', invite.id, { is_active: 0, updated_at: db.now() }); writeAuditLog(actor.id, 'deactivate_unit_invite', invite.id); return sanitizeInvite(db.findById('unit_invites', invite.id)); }

function submitMemberApplication({ inviteCode, phone, password, name, machineId }) {
  const invite = db.findOne('unit_invites', item => item.code_hash === hashInvite(String(inviteCode || '').trim().toUpperCase()));
  if (!invite || !invite.is_active || new Date(invite.expires_at) <= new Date() || invite.used_count >= invite.max_uses) throw failure(400, '邀请码无效、已过期或使用人数已满');
  const organization = db.findById('organizations', invite.organization_id); if (!organization || organization.status !== 'active') throw failure(400, '所属单位当前不可加入');
  const normalizedPhone = assertPhone(phone); assertPassword(password); assertUniquePhone(normalizedPhone);
  const user = newUser({ phone: normalizedPhone, password, name: text(name, '姓名', 50), role: 'member', accountStatus: 'pending_unit_review', organizationId: organization.id, machineId });
  const application = { id: db.genId(), user_id: user.id, organization_id: organization.id, invite_id: invite.id, status: 'pending', reviewed_by: '', reviewed_at: null, review_note: '', created_at: db.now(), updated_at: db.now() };
  db.insert('users', user); db.insert('member_applications', application); db.updateById('unit_invites', invite.id, { used_count: invite.used_count + 1, updated_at: db.now() }); writeAuditLog(user.id, 'submit_member_application', application.id, JSON.stringify({ organizationId: organization.id })); return { application: sanitizeMemberApplication(application) };
}
function sanitizeMemberApplication(application) { const user = db.findById('users', application.user_id); return { id: application.id, status: application.status, reviewNote: application.review_note || '', organizationId: application.organization_id, applicant: user && { id: user.id, name: user.name, phone: user.phone }, createdAt: application.created_at, reviewedAt: application.reviewed_at }; }
function listMemberApplications(actor, { status } = {}) { if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以查看成员申请'); return db.findAll('member_applications', item => item.organization_id === actor.organization_id && (!status || item.status === status)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeMemberApplication); }
function permissions(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([name, actions]) => /^[a-z][\w-]{0,63}$/i.test(name) && Array.isArray(actions)).map(([name, actions]) => [name, [...new Set(actions.filter(action => ['view', 'create', 'update', 'delete', 'export', 'approve'].includes(action)))]])); }
function reviewMemberApplication(actor, applicationId, { approve, reviewNote = '', permissions: requestedPermissions = {} } = {}) {
  if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以审核成员申请'); const application = db.findById('member_applications', applicationId);
  if (!application || application.organization_id !== actor.organization_id) throw failure(404, '未找到成员申请'); if (application.status !== 'pending') throw failure(409, '该申请已经处理，不能重复审核');
  const user = db.findById('users', application.user_id); const now = db.now(); const granted = approve ? permissions(requestedPermissions) : {};
  db.updateById('member_applications', application.id, { status: approve ? 'approved' : 'rejected', reviewed_by: actor.id, reviewed_at: now, review_note: String(reviewNote), updated_at: now }); db.updateById('users', user.id, { account_status: approve ? 'active' : 'rejected', is_active: approve ? 1 : 0, permissions: granted, updated_at: now }); writeAuditLog(actor.id, approve ? 'approve_member_application' : 'reject_member_application', application.id, JSON.stringify({ memberId: user.id, permissions: granted })); return { application: sanitizeMemberApplication(db.findById('member_applications', application.id)), user: getUserById(user.id) };
}
function listUnitMembers(actor) { if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以查看成员账号'); return db.findAll('users', user => user.organization_id === actor.organization_id && user.role === 'member').map(sanitizeUser); }
function updateMemberPermissions(actor, memberId, requestedPermissions) { if (!isUnitAdmin(actor)) throw failure(403, '只有单位管理员可以分配成员权限'); const member = db.findById('users', memberId); if (!member || member.organization_id !== actor.organization_id || member.role !== 'member') throw failure(404, '未找到本单位成员'); const granted = permissions(requestedPermissions); db.updateById('users', member.id, { permissions: granted, updated_at: db.now() }); writeAuditLog(actor.id, 'update_member_permissions', member.id, JSON.stringify(granted)); return getUserById(member.id); }

function login({ phone, password, machineId }) {
  const user = db.findOne('users', item => item.phone === normalizePhone(phone)); if (!user || !verifyPassword(password, user.password_hash)) throw failure(401, '手机号或密码错误');
  const access = getAccessStatus(user); if (!access.valid) throw failure(403, access.reason);
  const now = db.now(); db.updateById('users', user.id, { last_login_at: now, ...(machineId && !user.machine_id ? { machine_id: machineId } : {}), updated_at: now }); logger.info('用户登录', { userId: user.id }); return { token: signToken({ userId: user.id, role: user.role, organizationId: user.organization_id || null }), user: getUserById(user.id) };
}
function listUsers({ keyword = '', isActive, page = 1, pageSize = 20 } = {}) { const word = String(keyword).trim().toLowerCase(); const current = Math.max(1, Number.parseInt(page, 10) || 1); const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20)); let users = db.findAll('users'); if (word) users = users.filter(user => [user.phone, user.name, user.village_name].some(value => String(value || '').toLowerCase().includes(word))); if (isActive !== undefined && isActive !== '') users = users.filter(user => Boolean(user.is_active) === ['true', '1'].includes(String(isActive))); users = users.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(sanitizeUser); return { users: users.slice((current - 1) * size, current * size), pagination: { page: current, pageSize: size, total: users.length, totalPages: Math.max(1, Math.ceil(users.length / size)) } }; }
function updateProfile(userId, { name, phone }) { const user = db.findById('users', userId); if (!user) throw failure(404, '用户不存在'); const patch = { updated_at: db.now() }; if (name !== undefined) patch.name = text(name, '姓名', 50); if (phone && phone !== user.phone) { const normalized = assertPhone(phone); if (db.findOne('users', item => item.phone === normalized && item.id !== userId)) throw failure(409, '该手机号已被其他用户使用'); patch.phone = normalized; } db.updateById('users', userId, patch); return getUserById(userId); }
function changePassword(userId, { oldPassword, newPassword }) { assertPassword(newPassword, '新密码'); const user = db.findById('users', userId); if (!user) throw failure(404, '用户不存在'); if (!verifyPassword(oldPassword, user.password_hash)) throw failure(401, '原密码错误'); db.updateById('users', userId, { password_hash: hashPassword(newPassword), updated_at: db.now() }); return { success: true }; }
function resetPassword(userId, newPassword) { assertPassword(newPassword, '新密码'); if (!db.findById('users', userId)) throw failure(404, '用户不存在'); db.updateById('users', userId, { password_hash: hashPassword(newPassword), updated_at: db.now() }); return getUserById(userId); }
function updateEntitlement(userId, { planType, planExpiresAt, isActive }) { const user = db.findById('users', userId); if (!user) throw failure(404, '用户不存在'); const patch = { updated_at: db.now() }; if (planType) Object.assign(patch, planPatch({ planType, planExpiresAt })); if (isActive !== undefined) Object.assign(patch, { is_active: isActive ? 1 : 0, account_status: isActive ? 'active' : 'disabled' }); db.updateById('users', userId, patch); return getUserById(userId); }
function bindMachine(userId, machineId) { db.updateById('users', userId, { machine_id: machineId, updated_at: db.now() }); return getUserById(userId); }
function checkEntitlement(user) { const current = user?.id ? db.findById('users', user.id) || user : user; const status = getAccessStatus(current); return status.valid ? { valid: true, plan: status.plan, expiresAt: status.expiresAt || null } : status; }

module.exports = { bindMachine, changePassword, checkEntitlement, createInvite, deactivateInvite, getAccessStatus, getUserById, getUserByPhone, isPlatformAdmin, isUnitAdmin, listInvites, listMemberApplications, listUnitAdminApplications, listUnitMembers, listUsers, login, normalizePhone, resetPassword, reviewMemberApplication, reviewUnitAdminApplication, sanitizeUser, submitMemberApplication, submitUnitAdminApplication, updateEntitlement, updateMemberPermissions, updateProfile, writeAuditLog };
