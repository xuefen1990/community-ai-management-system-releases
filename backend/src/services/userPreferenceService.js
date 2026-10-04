'use strict';

const db = require('../database');

function normalizeMenu(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(([key]) => /^[a-z][a-z0-9-]{0,60}$/u.test(key)).slice(0, 60);
  return Object.fromEntries(entries.map(([key, item]) => [key, {
    visible: item?.visible !== false,
    customAlias: String(item?.customAlias || '').trim().slice(0, 32),
    order: Math.max(1, Math.min(100, Number(item?.order) || 1)),
  }]));
}

function get(user) {
  const row = db.findOne('user_preferences', item => item.user_id === user.id);
  return { menu: row?.menu || {}, updatedAt: row?.updated_at || null };
}

function save(user, input = {}) {
  const menu = normalizeMenu(input.menu);
  const row = db.findOne('user_preferences', item => item.user_id === user.id);
  if (row) db.updateById('user_preferences', row.id, { menu, updated_at: db.now() });
  else db.insert('user_preferences', { id: db.genId(), user_id: user.id, menu, updated_at: db.now() });
  return get(user);
}

module.exports = { get, save, normalizeMenu };
