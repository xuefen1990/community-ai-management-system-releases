'use strict';

const db = require('../database');
const aiService = require('./aiService');

function getOverview() {
  const users = db.findAll('users');
  const usage = aiService.getUsageStats(null, 30);
  const activeProviders = db.count('ai_providers', provider => provider.is_active === 1);
  const recentUsers = users
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 8)
    .map(user => ({
      id: user.id,
      phone: user.phone,
      name: user.name,
      villageName: user.village_name,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
    }));

  return {
    metrics: {
      registeredUsers: users.filter(user => user.role !== 'admin').length,
      activeUsers: users.filter(user => user.role !== 'admin' && user.is_active).length,
      callsLast30Days: usage.total_calls,
      activeProviders,
    },
    recentUsers,
  };
}

module.exports = { getOverview };
