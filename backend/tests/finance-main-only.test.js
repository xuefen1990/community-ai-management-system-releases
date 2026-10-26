'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { can, normalizePermissions, catalog } = require('../src/services/permissionPolicy');
test('财务仅实际主账号可用，成员和平台管理员的旧授权不能绕过', () => {
  assert.equal(can({ id: 'owner', role: 'main_account', mainAccountId: 'owner' }, 'finance'), true);
  assert.equal(can({ id: 'owner', role: 'unit_admin', main_account_id: 'owner' }, 'finance'), true);
  for (const role of ['member', 'admin', 'platform_admin']) assert.equal(can({ id: 'member', role, mainAccountId: 'owner', permissions: { finance: ['view', 'update'] } }, 'finance'), false);
  assert.equal(can({ id: 'other', role: 'main_account', mainAccountId: 'owner' }, 'finance'), false);
  assert.equal(normalizePermissions({ personnel: ['view'], finance: ['view', 'update'] }).finance, undefined);
  assert.equal(catalog().modules.some(module => module.id === 'finance'), false);
});
