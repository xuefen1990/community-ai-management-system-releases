'use strict';

const db = require('../database');
const aiService = require('./aiService');
const accountScope = require('./mainAccountScope');

function getOverview() {
  const users = db.findAll('users');
  const usage = aiService.getUsageStats(null, 30);
  const activeProviders = db.count('ai_providers', provider => provider.is_active === 1);
  const mainUsers = users.filter(user => ['main_account','unit_admin'].includes(user.role) && !user.deleted_at);
  const recentUsers = mainUsers
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 8)
    .map(user => ({
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
      memberCount: users.filter(member=>member.role==='member' && !member.deleted_at && accountScope.mainAccountIdOf(member)===user.id).length,
      villageName: user.village_name,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
    }));

  return {
    metrics: {
      mainAccounts: mainUsers.length,
      subAccounts: users.filter(user=>user.role==='member' && !user.deleted_at).length,
      registeredUsers: users.filter(user => user.role !== 'admin').length,
      activeUsers: users.filter(user => user.role !== 'admin' && user.is_active).length,
      callsLast30Days: usage.total_calls,
      activeProviders,
    },
    recentUsers,
  };
}

module.exports = { getOverview };
