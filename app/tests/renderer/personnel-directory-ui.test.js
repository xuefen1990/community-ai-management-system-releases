'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..', '..');

test('legacy resident directory keeps the confirmed name and sort options', async () => {
  const [adapter, foundationAdapter, script] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, '..', 'scripts', 'foundation-adaptations.cjs'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-directory-ui.js'), 'utf8'),
  ]);
  assert.match(adapter, /personnel-directory-ui\.js/u);
  assert.match(foundationAdapter, /replaceAll\("年"/u);
  assert.match(foundationAdapter, /function l8e\(e,t,a\)/u);
  assert.match(foundationAdapter, /l8e\("","",k\.birthDate\|\|k\.birth_date\)\.birthDate/u);
  assert.match(foundationAdapter, /l8e\("","",g\.value\.birthDate\|\|g\.value\.birth_date\)\.birthDate/u);
  assert.match(script, /居民一户一档/u);
  assert.match(script, /居民组（默认）/u);
  assert.match(script, /compareGroup/u);
  assert.match(script, /chineseNumber/u);
  assert.match(script, /genderDisplay/u);
  assert.match(script, /relationDisplay/u);
  assert.match(script, /phoneDisplay/u);
  assert.match(script, /birthDateDisplay/u);
  assert.match(script, /identityProfile/u);
  assert.match(script, /personForRow/u);
  assert.match(script, /residentPersonKey/u);
  assert.match(script, /validateIdCard/u);
  assert.match(script, /身份证号校验通过/u);
  assert.match(script, /data-personnel-directory-sort-key/u);
  assert.match(script, /renderSortedPersonnel/u);
  assert.match(script, /renderDirectoryPagination/u);
  assert.match(script, /跳至/u);
  assert.match(script, /首页/u);
  assert.match(script, /末页/u);
  assert.match(script, /readLegacyPageSize/u);
  assert.match(script, /renderHouseholdRelation/u);
  assert.match(script, /查看户号 .* 的成员信息/u);
  assert.match(script, /openHouseholdMembers\?\.\(householdId\)/u);
});

test('resident directory uses natural group order and defaults to group then name', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-directory-ui.js'), 'utf8');
  const document = { readyState: 'loading', addEventListener() {} };
  const window = { document, setTimeout() {}, requestAnimationFrame() {}, dbState: { villageGroups: ['西二组', '东一组'] } };
  vm.runInNewContext(source, { window, document, Intl, Object, String, Array, Number, RegExp, NodeFilter: { SHOW_TEXT: 4 } });
  const ui = window.ResidentDirectoryUi;
  assert.ok(ui.compareGroup('东二组', '东十组') < 0);
  assert.ok(ui.compareGroup('东九组', '西一组') < 0);
  const rows = ui.sortedRows([
    { name: '张三', village_group: '东二组' },
    { name: '李四', village_group: '东一组' },
    { name: '王五', village_group: '东二组' },
  ]);
  assert.equal(rows.map((item) => item.name).join('、'), '李四、王五、张三');
  assert.ok(ui.compareGroup('西二组', '东一组') < 0);
});

test('resident directory localizes common legacy fields and validates Chinese identity cards', async () => {
  const source = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'personnel-directory-ui.js'), 'utf8');
  const document = { readyState: 'loading', addEventListener() {} };
  const window = { document, setTimeout() {}, requestAnimationFrame() {} };
  vm.runInNewContext(source, { window, document, Intl, Object, String, Array, Number, RegExp, Date, NodeFilter: { SHOW_TEXT: 4 } });
  const ui = window.ResidentDirectoryUi;
  assert.equal(ui.genderDisplay('male'), '男');
  assert.equal(ui.genderDisplay('female'), '女');
  assert.equal(ui.relationDisplay('household_head'), '户主');
  assert.equal(ui.relationDisplay('spouse'), '配偶');
  assert.equal(ui.relationDisplay('undefined'), '未填写');
  assert.equal(ui.relationDisplay('>'), '未填写');
  assert.equal(ui.phoneDisplay('und***ined'), '未填写');
  assert.equal(ui.birthDateDisplay('1988年06月12日'), '1988-06-12');
  assert.equal(ui.birthDateDisplay('1988/6/2'), '1988-06-02');
  assert.equal(ui.birthDateDisplay('19880602'), '1988-06-02');
  assert.equal(ui.birthDateDisplay('1988年06月'), '1988-06-00');
  assert.equal(ui.birthDateDisplay(''), '未填写');
  assert.equal(ui.validateIdCard('11010519491231002X').valid, true);
  assert.equal(ui.validateIdCard('110105194912310021').valid, false);
  assert.equal(ui.validateIdCard('11010519490231002X').valid, false);
  const derived = ui.identityProfile({ idCard: '11010519491231002X', gender: 'female', birthday: '2000-01-01' });
  assert.equal(`${derived.gender}|${derived.birthDate}|${derived.verified}`, '女|1949-12-31|true');
  const legacy = ui.identityProfile({ idCard: '错误号码', gender: 'male', birthday: '2000-01-01' });
  assert.equal(`${legacy.gender}|${legacy.birthDate}|${legacy.verified}`, '男|2000-01-01|false');
  const legacyChinese = ui.identityProfile({ idCard: '错误号码', gender: 'male', birth_date: '1988年06月12日' });
  assert.equal(`${legacyChinese.gender}|${legacyChinese.birthDate}|${legacyChinese.verified}`, '男|1988-06-12|false');
  const missing = ui.identityProfile({ idCard: '', gender: '', birthday: '' });
  assert.equal(`${missing.gender}|${missing.birthDate}|${missing.verified}`, '待核对|待核对|false');
});
