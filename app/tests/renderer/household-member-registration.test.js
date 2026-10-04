'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const appRoot = path.resolve(__dirname, '..', '..');

test('household ledger exposes one embedded household-member registration flow', async () => {
  const [bootstrap, registration, adapter, style, runtime] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src/renderer/foundation/bootstrap.mjs'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src/renderer/foundation/household-member-registration.mjs'), 'utf8'),
    fs.readFile(path.join(appRoot, '..', 'scripts/foundation-adaptations.cjs'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src/renderer/foundation/foundation.css'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src/renderer/foundation/vendor/assets/foundation-runtime.mjs'), 'utf8'),
  ]);
  assert.match(bootstrap, /installHouseholdMemberRegistration\(loadScript\)/u);
  assert.match(registration, /新增家庭成员/u);
  assert.match(registration, /保存并继续添加/u);
  assert.match(registration, /mode: 'move-existing'/u);
  assert.match(registration, /contextVersion/u);
  assert.match(registration, /系统不会重复建档/u);
  assert.match(registration, /dictionaries\?category=household_relation/u);
  assert.match(adapter, /foundation-household-member-root/u);
  assert.match(adapter, /＋ 添加家庭成员/u);
  assert.match(adapter, /编辑当前成员/u);
  assert.match(adapter, /关联其他户号/u);
  assert.match(style, /\.household-member-registration/u);
  assert.match(style, /prefers-reduced-motion/u);
  assert.match(runtime, /data-testid":"add-household-member"/u);
  assert.match(runtime, /编辑当前成员/u);
});

test('household member age display handles birthdays without changing stored dates', async () => {
  const moduleUrl = `${pathToFileURL(path.join(appRoot, 'src/renderer/foundation/household-member-registration.mjs')).href}?test=${Date.now()}`;
  const { householdMemberRegistration } = await import(moduleUrl);
  assert.equal(householdMemberRegistration.ageAt('2020-09-14', new Date('2026-09-14T12:00:00')), '6');
  assert.equal(householdMemberRegistration.ageAt('2020-09-15', new Date('2026-09-14T12:00:00')), '5');
  assert.equal(householdMemberRegistration.ageAt(''), '');
});

test('household member relationships combine settings dictionary values and existing household values', async () => {
  const moduleUrl = `${pathToFileURL(path.join(appRoot, 'src/renderer/foundation/household-member-registration.mjs')).href}?relations=${Date.now()}`;
  const { householdMemberRegistration } = await import(moduleUrl);
  const values = householdMemberRegistration.relationshipOptions(
    [{ category: 'household_relation', label: '儿媳' }, { category: 'household_relation', name: '养子' }],
    [{ relationToHead: '次子' }, { relationToHead: '户主' }],
  );
  assert.ok(values.includes('儿媳'));
  assert.ok(values.includes('养子'));
  assert.ok(values.includes('次子'));
  assert.ok(values.includes('子'));
  assert.equal(values.includes('户主'), false);
});
