'use strict';

const db = require('../database');

function mainAccountIdOf(user) {
  if (!user) return '';
  if (['admin', 'platform_admin'].includes(user.role)) return String(user.id || '');
  if (user.main_account_id) return String(user.main_account_id);
  if (['main_account', 'unit_admin'].includes(user.role)) return String(user.id || '');
  const organization = user.organization_id && db.findById('organizations', user.organization_id);
  return String(organization?.unit_admin_user_id || '');
}

function requireMainAccountId(user) {
  const id = mainAccountIdOf(user);
  if (!id || !db.findById('users', id)) {
    const error = new Error('当前账号没有有效的主账号归属');
    error.statusCode = 403;
    throw error;
  }
  return id;
}

function mainAccountOf(user) {
  const id = mainAccountIdOf(user);
  return id ? db.findById('users', id) : null;
}

function migrateLegacyAccounts() {
  const failures = [];
  for (const organization of db.findAll('organizations')) {
    const mainId = String(organization.unit_admin_user_id || '');
    const main = db.findById('users', mainId);
    const users = db.findAll('users', row => row.organization_id === organization.id);
    if (!main || main.organization_id !== organization.id || users.some(row => row.main_account_id && row.main_account_id !== mainId)) {
      failures.push(organization.id);
      continue;
    }
    const collections = ['unit_workspaces', 'ai_quotas', 'ai_quota_ledger', 'ai_usage', 'ai_assistant_conversations', 'ai_assistant_memories', 'ai_assistant_tasks'];
    if (collections.some(name => db.findAll(name, row => row.organization_id === organization.id).some(row => row.main_account_id && row.main_account_id !== mainId))) {
      failures.push(organization.id);
      continue;
    }
    // 工作区和额度是单位级单例。历史数据若已出现多条，不能静默选一条，
    // 交给管理员处理后再迁移，避免共享数据或 Token 余额被重复计算。
    if (['unit_workspaces', 'ai_quotas'].some(name => db.findAll(name, row => row.organization_id === organization.id).length > 1)) {
      failures.push(organization.id);
      continue;
    }
    db.atomic(() => {
      for (const user of users) if (user.main_account_id !== mainId) db.updateById('users', user.id, { main_account_id: mainId });
      for (const name of collections) {
        for (const row of db.findAll(name, item => item.organization_id === organization.id && item.main_account_id !== mainId)) {
          db.updateById(name, row.id, { main_account_id: mainId });
        }
      }
    });
  }
  return { failures };
}

module.exports = { mainAccountIdOf, requireMainAccountId, mainAccountOf, migrateLegacyAccounts };
