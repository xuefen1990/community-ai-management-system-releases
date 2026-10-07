'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renameCodeLiterals } = require('../../../scripts/brand-terminology.cjs');
const model = require('../../src/shared/certificate-management-model');
const { templateRows, recordRows } = require('../../src/main/foundation-certificate-service');
const { parseFoundationGrid } = require('../../src/main/foundation-excel-reader');
const { parsePersonnelExcelGrid, parseDisbursementRosterExcelGrid } = require('../../src/shared/personnel-excel-parser');

test('generation changes display text without changing storage keys, paths or old input aliases', () => {
  const input = 'const config={label:"村民小组",key:"村民小组",aliases:["村民小组"],content:["你是社区助手"].join(""),wordPath:"村民证明.docx"}; const prompt=`社区里的村民`; const pattern=/村民小组|社区名称|村民委员会/u;';
  const output = renameCodeLiterals(input);
  const config = new Function(output + ';return {config,prompt,pattern}')();
  assert.equal(config.config.label, '居民小组');
  assert.equal(config.config.key, '村民小组');
  assert.deepEqual(config.config.aliases, ['居民小组', '村民小组']);
  assert.equal(config.config.content, '你是村居助手');
  assert.equal(config.config.wordPath, '村民证明.docx');
  assert.equal(config.prompt, '村居里的居民');
  for (const value of ['居民小组', '村民小组', '村居名称', '社区名称', '村民委员会']) assert.equal(config.pattern.test(value), true);
  assert.equal(renameCodeLiterals(output), output);
});

test('both old and new Chinese certificate placeholders bind the same archive data', () => {
  const subjects = { person1: { name: '合成人员甲', idCard: 'SYNTHETIC-1', villageGroup: '合成一组' }, person2: { name: '合成人员乙', idCard: 'SYNTHETIC-2' } };
  for (const noun of ['居民', '村民']) {
    const version = { title: '测试证明', content: `{${noun}姓名}、{${noun}小组}与{第二${noun}姓名}（{第二${noun}身份证号}）` };
    const before = structuredClone(version);
    const rendered = model.renderCertificateContent(version, { subjects });
    assert.deepEqual(rendered.missingVariables, []);
    assert.equal(rendered.content, '合成人员甲、合成一组与合成人员乙（SYNTHETIC-2）');
    assert.deepEqual(version, before);
    assert.equal(model.defaultFieldForVariable(`${noun}姓名`).source, 'archive');
  }
});

test('new builtins use residents while saved template overrides and issued records retain their text', () => {
  const database = { certificateTemplates: [{ id: 'tpl_residency', name: '自定义社区证明', title: '自定义社区证明', content: '某村村民委员会证明{村民姓名}', builtin: true }], certificateRecords: [{ id: 'issued', outputSnapshot: { title: '社区证明', content: '原村民资料' } }] };
  const before = structuredClone(database);
  assert.equal(templateRows(database).find(row => row.id === 'tpl_residency').content, database.certificateTemplates[0].content);
  assert.equal(recordRows(database)[0].outputSnapshot.content, '原村民资料');
  assert.deepEqual(database, before);
  for (const row of templateRows({})) assert.doesNotMatch(row.content + row.title, /村民/u);
});

test('new and old personnel and payment roster headers remain importable', () => {
  for (const noun of ['居民', '村民']) {
    const grid = [['标题'], [`${noun}姓名`, '身份证号', `${noun}小组`], ['合成人员', '11010519491231002X', '合成一组']];
    const parsed = parsePersonnelExcelGrid(grid);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0][`${noun}姓名`], '合成人员');
    assert.equal(parsed.rows[0][`${noun}小组`], '合成一组');
    assert.equal(parseFoundationGrid(grid).headerRowNumber, 2);
    const roster = parseDisbursementRosterExcelGrid([[`${noun}姓名`, `${noun}小组`, '金额'], ['合成人员', '合成一组', 100]]);
    assert.equal(roster.rows.length, 1);
  }
});

test('product and issuer keep their existing profile directories and application identity', () => {
  const root = path.resolve(__dirname, '../..');
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
  const issuer = fs.readFileSync(path.join(root, '../license-generator/src/main/index.js'), 'utf8');
  assert.match(main, /setName\(PRODUCT_STORAGE_IDENTITY\)/u);
  const identity = require('../../src/main/product-brand');
  assert.equal(identity.PRODUCT_STORAGE_IDENTITY, '社区AI管理系统');
  assert.equal(identity.PRODUCT_DISPLAY_NAME, '村居AI管理系统');
  assert.match(main, /setAboutPanelOptions\(\{ applicationName: PRODUCT_DISPLAY_NAME \}\)/u);
  assert.match(main, /configureApplicationMenu\(\{[^\n]+appName: PRODUCT_DISPLAY_NAME/u);
  assert.match(main, /createStatusTray\(\{[^\n]+appName: PRODUCT_DISPLAY_NAME/u);
  assert.match(main, /productionData = path.join\(app.getPath\('appData'\), '社区AI管理系统'\)/u);
  assert.match(issuer, /setName\(["']村居AI授权工具["']\)/u);
  assert.match(issuer, /setPath\('userData', path.join\(app.getPath\('appData'\), '社区AI授权工具'\)\)/u);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(pkg.build.appId, 'com.community.ai.management');
  assert.equal(pkg.build.productName, '村居AI管理系统');
});
