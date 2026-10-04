'use strict';

const { EventEmitter } = require('node:events');
const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const db = require('../database');
const permissionPolicy = require('./permissionPolicy');
const accountScope = require('./mainAccountScope');

const events = new EventEmitter();
events.setMaxListeners(200);

function error(statusCode, message) { const value = new Error(message); value.statusCode = statusCode; return value; }
function mainAccountId(user) { return accountScope.requireMainAccountId(user); }
function isUnitAdmin(user) { return ['unit_admin', 'main_account', 'admin', 'platform_admin'].includes(user?.role); }
function assertNotCutOver(user) { if (db.findOne('workspace_cutovers', row => row.main_account_id === mainAccountId(user))) throw error(410, '本单位业务数据已迁至主电脑，请连接局域网主电脑'); }
function may(user, action) { return isUnitAdmin(user) || Boolean(user?.permissions?.workspace?.includes(action)); }
const MODULES = permissionPolicy.MODULES;
function moduleFor(key) { return MODULES[key] || null; }
function can(user, key, actions) { const moduleId = moduleFor(key); return isUnitAdmin(user) || (moduleId && actions.some(action => permissionPolicy.can(user, moduleId, action))); }
function assertAccess(user, action) { if (!may(user, action) && !Object.keys(user?.permissions || {}).some(moduleId => permissionPolicy.can(user, moduleId, action))) throw error(403, action === 'view' ? '当前账号没有查看共享数据的权限' : '当前账号没有修改共享数据的权限'); }
function workspaceFor(user) { assertNotCutOver(user); const ownerId = mainAccountId(user); let workspace = db.findOne('unit_workspaces', item => item.main_account_id === ownerId || (user.organization_id && item.organization_id === user.organization_id)); if (!workspace) { workspace = { id: db.genId(), main_account_id: ownerId, version: 1, data: {}, updated_by: '', updated_at: db.now() }; db.insert('unit_workspaces', workspace); } return workspace; }
function read(user) { assertAccess(user, 'view'); const workspace = workspaceFor(user); const data = {}; for (const [key, value] of Object.entries(workspace.data)) if (can(user, key, ['view'])) data[key] = structuredClone(value); return { data, version: workspace.version, updatedAt: workspace.updated_at }; }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function aiRowsFor(user) {
  const ownerId = mainAccountId(user);
  const ids = new Set(db.findAll('users', row => accountScope.mainAccountIdOf(row) === ownerId).map(row => row.id));
  const belongs = row => row.main_account_id === ownerId || ids.has(row.user_id);
  return {
    conversations: db.findAll('ai_assistant_conversations', belongs),
    memories: db.findAll('ai_assistant_memories', belongs),
    tasks: db.findAll('ai_assistant_tasks', belongs),
  };
}
function migrationSnapshot(user) {
  if (!isUnitAdmin(user)) throw error(403, '只有主账号可以迁移业务数据');
  const workspace = workspaceFor(user);
  const data = structuredClone(workspace.data);
  const aiState = structuredClone(aiRowsFor(user));
  return { data, aiState, version: workspace.version, dataDigest: digest(data), aiDigest: digest(aiState) };
}
function completeMigration(user, input = {}) {
  if (!isUnitAdmin(user)) throw error(403, '只有主账号可以完成迁移');
  const ownerId = mainAccountId(user);
  if (db.findOne('workspace_cutovers', row => row.main_account_id === ownerId)) return { completed: true, alreadyCompleted: true };
  const workspace = workspaceFor(user);
  if (Number(input.version) !== Number(workspace.version)) throw error(409, '云端业务数据在迁移期间发生变化，请重新核对');
  const aiState = aiRowsFor(user);
  if (input.dataDigest !== digest(workspace.data) || input.aiDigest !== digest(aiState)) throw error(409, '云端业务或 AI 历史在迁移期间发生变化，请重新核对');
  db.atomic(() => {
    db.insert('workspace_cutovers', { id: db.genId(), main_account_id: ownerId, completed_at: db.now(), source_version: workspace.version,
      data_digest: input.dataDigest, ai_digest: input.aiDigest });
    db.removeById('unit_workspaces', workspace.id);
    for (const name of ['ai_assistant_conversations', 'ai_assistant_memories', 'ai_assistant_tasks']) {
      for (const row of aiState[name === 'ai_assistant_conversations' ? 'conversations' : name === 'ai_assistant_memories' ? 'memories' : 'tasks']) db.removeById(name, row.id);
    }
    if (db.findOne('unit_workspaces', row => row.main_account_id === ownerId)
      || Object.values(aiRowsFor(user)).some(rows => rows.length)) throw error(500, '云端业务清理核对失败');
  });
  db.flushNow();
  return { completed: true, alreadyCompleted: false };
}
function changesFor(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [before === undefined ? 'create' : 'update'];
  if (!before.length && after.length) return ['create'];
  if (before.length && !after.length) return ['delete'];
  const identity = item => item && typeof item === 'object' && item.id != null ? String(item.id) : null;
  const hasIds = rows => rows.length > 0 && rows.every(item => identity(item));
  const beforeHasIds = hasIds(before);
  const afterHasIds = hasIds(after);
  if ((beforeHasIds && after.length && !afterHasIds) || (afterHasIds && before.length && !beforeHasIds)) throw error(400, '记录标识无效，请刷新后重试');
  if ([before, after].some(rows => hasIds(rows) && new Set(rows.map(identity)).size !== rows.length)) throw error(400, '记录标识重复，请刷新后重试');
  if ((!before.length || beforeHasIds) && (!after.length || afterHasIds)) {
    const oldRows = new Map(before.map(item => [identity(item), item]));
    const newRows = new Map(after.map(item => [identity(item), item]));
    const actions = new Set();
    for (const [id, item] of newRows) {
      if (!oldRows.has(id)) actions.add('create');
      else if (!isDeepStrictEqual(oldRows.get(id), item)) actions.add('update');
    }
    for (const id of oldRows.keys()) if (!newRows.has(id)) actions.add('delete');
    return [...actions];
  }
  if (after.length > before.length && before.every((item, index) => isDeepStrictEqual(item, after[index]))) return ['create'];
  if (after.length < before.length && after.every((item, index) => isDeepStrictEqual(item, before[index]))) return ['delete'];
  return ['update', ...(after.length < before.length ? ['delete'] : []), ...(after.length > before.length ? ['create'] : [])];
}
function write(user, { data, version }) {
  mainAccountId(user);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw error(400, '共享数据格式无效');
  const workspace = workspaceFor(user);
  if (Number(version) !== Number(workspace.version)) throw error(409, '主账号共享数据已被其他成员更新，请刷新后再提交');
  const merged = structuredClone(workspace.data);
  for (const [key, value] of Object.entries(data)) {
    if (!moduleFor(key) && !isUnitAdmin(user)) throw error(403, `当前账号无权修改 ${key}`);
    if (isDeepStrictEqual(merged[key], value)) continue;
    if (!isUnitAdmin(user)) {
      const required = changesFor(merged[key], value);
      if (!can(user, key, ['view']) || required.some(action => !can(user, key, [action]))) throw error(403, `当前账号无权${required.join('、')} ${key}`);
    }
    merged[key] = structuredClone(value);
  }
  const next = { data: merged, version: workspace.version + 1, updated_by: user.id, updated_at: db.now() };
  db.updateById('unit_workspaces', workspace.id, next);
  const result = { mainAccountId: mainAccountId(user), version: next.version, updatedAt: next.updated_at };
  events.emit(`workspace:${result.mainAccountId}`, result);
  return result;
}
function subscribe(user, listener) { assertNotCutOver(user); assertAccess(user, 'view'); const channel = `workspace:${mainAccountId(user)}`; events.on(channel, listener); return () => events.off(channel, listener); }

module.exports = { read, write, subscribe, moduleFor, migrationSnapshot, completeMigration, assertNotCutOver };
