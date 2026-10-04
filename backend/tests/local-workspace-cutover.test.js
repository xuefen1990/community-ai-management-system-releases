'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-workspace-cutover-'));
process.env.DB_PATH = path.join(directory, 'db.json');
process.env.ADMIN_PASSWORD = 'test-only-strong-password-2026';
const db = require('../src/database');
const workspace = require('../src/services/unitWorkspaceService');
const preferences = require('../src/services/userPreferenceService');

test.after(() => db.flushNow());
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));

test('migration verifies the current cloud snapshot before removing business and AI records', () => {
  const user = { id: 'owner-1', role: 'main_account', mainAccountId: 'owner-1' };
  db.insert('users', { id: user.id, role: user.role, main_account_id: user.id });
  db.insert('unit_workspaces', { id: 'workspace-1', main_account_id: user.id, version: 7,
    data: { personnel: [{ id: 'person-1', name: '测试甲' }] } });
  db.insert('ai_assistant_conversations', { id: 'conversation-1', main_account_id: user.id,
    user_id: user.id, messages: [{ role: 'user', content: '测试内容' }] });
  const source = workspace.migrationSnapshot(user);
  assert.equal(source.data.personnel[0].name, '测试甲');
  assert.equal(source.aiState.conversations.length, 1);
  assert.throws(() => workspace.completeMigration(user, { ...source, aiDigest: 'changed' }), /发生变化/);
  assert.equal(db.count('unit_workspaces'), 1);
  assert.equal(db.count('ai_assistant_conversations'), 1);
  assert.deepEqual(workspace.completeMigration(user, source), { completed: true, alreadyCompleted: false });
  assert.equal(db.count('unit_workspaces'), 0);
  assert.equal(db.count('ai_assistant_conversations'), 0);
  assert.equal(db.count('workspace_cutovers'), 1);
  assert.throws(() => workspace.read(user), error => error.statusCode === 410);
  assert.throws(() => workspace.write(user, { data: {}, version: 7 }), error => error.statusCode === 410);
});

test('cloud preferences accept menu metadata and discard unrelated business fields', () => {
  const user = { id: 'owner-1' };
  const saved = preferences.save(user, { menu: { overview: { order: 2, customAlias: '首页', visible: true } },
    personnel: [{ name: '不得写入云端' }] });
  assert.deepEqual(saved.menu.overview, { order: 2, customAlias: '首页', visible: true });
  assert.equal(JSON.stringify(db.findAll('user_preferences')).includes('不得写入云端'), false);
});
