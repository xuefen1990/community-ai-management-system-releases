'use strict';

const { EventEmitter } = require('node:events');
const db = require('../database');

const events = new EventEmitter();
events.setMaxListeners(200);

function error(statusCode, message) { const value = new Error(message); value.statusCode = statusCode; return value; }
function organizationId(user) { if (!user?.organization_id) throw error(403, '当前账号未归属有效单位'); return user.organization_id; }
function isUnitAdmin(user) { return user?.role === 'unit_admin'; }
function may(user, action) { return isUnitAdmin(user) || Boolean(user?.permissions?.workspace?.includes(action)); }
function assertAccess(user, action) { if (!may(user, action)) throw error(403, action === 'view' ? '当前账号没有查看共享数据的权限' : '当前账号没有修改共享数据的权限'); }
function workspaceFor(user) { const orgId = organizationId(user); let workspace = db.findOne('unit_workspaces', item => item.organization_id === orgId); if (!workspace) { workspace = { id: db.genId(), organization_id: orgId, version: 1, data: {}, updated_by: '', updated_at: db.now() }; db.insert('unit_workspaces', workspace); } return workspace; }
function read(user) { assertAccess(user, 'view'); const workspace = workspaceFor(user); return { data: structuredClone(workspace.data), version: workspace.version, updatedAt: workspace.updated_at }; }
function write(user, { data, version }) { assertAccess(user, 'update'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw error(400, '共享数据格式无效'); const workspace = workspaceFor(user); if (Number(version) !== Number(workspace.version)) throw error(409, '该单位数据已被其他成员更新，请刷新后再提交'); const next = { data: structuredClone(data), version: workspace.version + 1, updated_by: user.id, updated_at: db.now() }; db.updateById('unit_workspaces', workspace.id, next); const result = { organizationId: workspace.organization_id, version: next.version, updatedAt: next.updated_at }; events.emit(`workspace:${workspace.organization_id}`, result); return result; }
function subscribe(user, listener) { assertAccess(user, 'view'); const channel = `workspace:${organizationId(user)}`; events.on(channel, listener); return () => events.off(channel, listener); }

module.exports = { read, write, subscribe };
