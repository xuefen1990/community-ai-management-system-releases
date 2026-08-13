'use strict';

const COMMON_REPORT_FIELDS = [
  { key: 'title', label: '报告标题', type: 'text', required: true },
  { key: 'period', label: '报告期间', type: 'text', required: true },
  { key: 'recipient', label: '报送对象', type: 'text' },
  { key: 'background', label: '背景与依据', type: 'textarea' },
  { key: 'keyPoints', label: '重点内容与要求', type: 'textarea', required: true },
  { key: 'achievements', label: '主要成效', type: 'textarea' },
  { key: 'problems', label: '存在问题', type: 'textarea' },
  { key: 'nextSteps', label: '下一步计划', type: 'textarea' },
  { key: 'length', label: '篇幅', type: 'select', options: ['约 800 字', '约 1500 字', '约 2000 字', '详细'] },
  { key: 'tone', label: '语气', type: 'select', options: ['正式务实', '简洁明确', '严谨规范'] },
];

const COMMON_CONTRACT_FIELDS = [
  { key: 'title', label: '合同名称', type: 'text', required: true },
  { key: 'partyA', label: '甲方信息', type: 'textarea', required: true },
  { key: 'partyB', label: '乙方信息', type: 'textarea', required: true },
  { key: 'subject', label: '标的或服务内容', type: 'textarea', required: true },
  { key: 'amount', label: '数量与金额', type: 'text', required: true },
  { key: 'term', label: '履行期限', type: 'text', required: true },
  { key: 'location', label: '履行地点', type: 'text' },
  { key: 'payment', label: '付款方式', type: 'textarea', required: true },
  { key: 'acceptance', label: '验收标准', type: 'textarea' },
  { key: 'rights', label: '双方权利义务', type: 'textarea' },
  { key: 'breach', label: '违约责任', type: 'textarea' },
  { key: 'dispute', label: '争议解决', type: 'textarea' },
  { key: 'signingDate', label: '签署日期', type: 'date' },
  { key: 'extraRequirements', label: '补充要求', type: 'textarea' },
];

function template(id, documentKind, name, fields, sections, isCustom = false) {
  const copiedFields = fields.map((field) => Object.freeze({ ...field }));
  return Object.freeze({
    id,
    documentKind,
    name,
    fields: Object.freeze(copiedFields),
    requiredFields: Object.freeze(copiedFields.filter((field) => field.required).map((field) => field.key)),
    sections: Object.freeze([...sections]),
    isCustom,
  });
}

const REPORT_SECTIONS = ['标题', '基本情况', '主要工作与成效', '存在问题', '下一步计划', '落款'];
const CONTRACT_SECTIONS = ['合同主体', '合同标的', '价款与支付', '履行与验收', '权利义务', '违约责任', '争议解决', '签署'];

const TEMPLATES = Object.freeze([
  template('report-work', 'report', '工作报告', COMMON_REPORT_FIELDS, REPORT_SECTIONS),
  template('report-work-summary', 'report', '工作总结', COMMON_REPORT_FIELDS, REPORT_SECTIONS),
  template('report-situation', 'report', '情况报告', COMMON_REPORT_FIELDS, ['标题', '事项概况', '具体情况', '处置结果', '下一步安排', '落款']),
  template('report-research', 'report', '调研报告', COMMON_REPORT_FIELDS, ['标题', '调研背景', '现状分析', '主要问题', '对策建议', '落款']),
  template('report-request', 'report', '请示', COMMON_REPORT_FIELDS, ['标题', '主送机关', '请示缘由', '请示事项', '结语', '落款']),
  template('report-custom', 'report', '自定义报告', COMMON_REPORT_FIELDS, REPORT_SECTIONS, true),
  template('contract-procurement', 'contract', '采购合同', COMMON_CONTRACT_FIELDS, CONTRACT_SECTIONS),
  template('contract-service', 'contract', '服务合同', COMMON_CONTRACT_FIELDS, CONTRACT_SECTIONS),
  template('contract-lease', 'contract', '租赁合同', COMMON_CONTRACT_FIELDS, CONTRACT_SECTIONS),
  template('contract-labor', 'contract', '劳务合同', COMMON_CONTRACT_FIELDS, CONTRACT_SECTIONS),
  template('contract-cooperation', 'contract', '合作协议', COMMON_CONTRACT_FIELDS, CONTRACT_SECTIONS),
  template('contract-custom', 'contract', '自定义合同', COMMON_CONTRACT_FIELDS, CONTRACT_SECTIONS, true),
]);

function listTemplates(documentKind = null) {
  if (documentKind && !['report', 'contract'].includes(documentKind)) throw new Error('文档类型无效');
  return TEMPLATES.filter((item) => !documentKind || item.documentKind === documentKind);
}

function getTemplate(templateId) {
  const found = TEMPLATES.find((item) => item.id === templateId);
  if (!found) throw new Error(`未知公文模板：${templateId}`);
  return found;
}

function normalizeFieldValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function validateFields(templateId, fields = {}) {
  const selected = getTemplate(templateId);
  const normalized = Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, normalizeFieldValue(value)]));
  const missing = selected.requiredFields.filter((key) => normalized[key] === undefined || normalized[key] === null || normalized[key] === '');
  return { valid: missing.length === 0, missing, fields: normalized, template: selected };
}

function validateCustomTemplate(value = {}) {
  if (!['report', 'contract'].includes(value.documentKind)) throw new Error('自定义模板需要有效的文档类型');
  if (!String(value.name || '').trim()) throw new Error('自定义模板需要名称');
  if (!Array.isArray(value.fields) || value.fields.length === 0) throw new Error('自定义模板需要字段');
  if (!Array.isArray(value.sections) || value.sections.length === 0) throw new Error('自定义模板需要章节');
  const fields = value.fields.map((field) => {
    if (!String(field.key || '').trim() || !String(field.label || '').trim()) throw new Error('模板字段需要 key 和 label');
    return { ...field, key: field.key.trim(), label: field.label.trim() };
  });
  return {
    id: value.id || null,
    documentKind: value.documentKind,
    name: value.name.trim(),
    fields,
    requiredFields: fields.filter((field) => field.required).map((field) => field.key),
    sections: value.sections.map((section) => String(section).trim()).filter(Boolean),
  };
}

module.exports = { getTemplate, listTemplates, validateCustomTemplate, validateFields };
