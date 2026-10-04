'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyDatabase } = require('../../src/main/empty-database');
const { settingsView } = require('../../src/main/foundation-data-model');

test('new workspaces leave community name blank while preserving saved names', () => {
  const database = createEmptyDatabase();
  assert.equal(database.settings.villageName, '');
  assert.equal(settingsView(database).find(item => item.key === 'village_name').value, '');
  database.settings.villageName = '幸福社区';
  assert.equal(settingsView(database).find(item => item.key === 'village_name').value, '幸福社区');
});
