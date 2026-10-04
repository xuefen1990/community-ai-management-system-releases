'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getTemplate,
  listTemplates,
  validateFields,
  validateCustomTemplate,
} = require('../../src/main/document-template-catalog');

test('catalog exposes five built-in templates and a custom entry for each document kind', () => {
  const reports = listTemplates('report');
  const contracts = listTemplates('contract');

  assert.equal(reports.length, 6);
  assert.equal(contracts.length, 6);
  assert.ok(reports.some((template) => template.id === 'report-custom'));
  assert.ok(contracts.some((template) => template.id === 'contract-custom'));
  assert.ok(reports.every((template) => template.documentKind === 'report'));
  assert.ok(contracts.every((template) => template.documentKind === 'contract'));
});

test('built-in templates have stable fields, required keys, and sections', () => {
  const template = getTemplate('contract-procurement');

  assert.equal(template.name, '采购合同');
  assert.ok(template.fields.some((field) => field.key === 'partyA'));
  assert.ok(template.requiredFields.includes('partyA'));
  assert.ok(template.sections.includes('违约责任'));
  assert.equal(Object.isFrozen(template), true);
});

test('field validation rejects unknown templates and reports missing required values', () => {
  assert.throws(() => getTemplate('missing-template'), /未知公文模板/u);
  const result = validateFields('report-work-summary', { title: '年度总结' });
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('period'));
  assert.ok(result.missing.includes('keyPoints'));
});

test('field validation preserves template-specific extra values', () => {
  const result = validateFields('report-work-summary', {
    title: '年度总结',
    period: '2026 年度',
    keyPoints: '完成环境整治',
    customMetric: '满意率 98%',
  });

  assert.equal(result.valid, true);
  assert.equal(result.fields.customMetric, '满意率 98%');
});

test('custom template definitions require a kind, name, fields, and sections', () => {
  assert.throws(() => validateCustomTemplate({ name: '空模板' }), /文档类型/u);
  const value = validateCustomTemplate({
    documentKind: 'report',
    name: '专项简报',
    fields: [{ key: 'title', label: '标题', required: true }],
    sections: ['基本情况'],
  });
  assert.equal(value.id, null);
  assert.deepEqual(value.requiredFields, ['title']);
});
