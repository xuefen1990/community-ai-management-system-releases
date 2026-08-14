'use strict';

const { getTemplate, listTemplates, validateFields } = require('./document-template-catalog');

const CONTRACT_REQUIRED = Object.freeze([
  ['partyA', '甲方信息'],
  ['partyB', '乙方信息'],
  ['subject', '标的或服务内容'],
  ['amount', '金额或计价方式'],
  ['term', '履行期限'],
  ['payment', '付款方式'],
  ['breach', '违约责任'],
  ['dispute', '争议解决'],
]);

function cleanText(value) {
  return String(value ?? '').replaceAll(/\r\n?/gu, '\n').trim();
}

function detectDocumentKind(text, preferredKind = 'auto') {
  if (preferredKind === 'report' || preferredKind === 'contract') return preferredKind;
  const normalized = cleanText(text);
  if (/(合同|协议|甲方|乙方|出租|承租|采购方|供应方)/u.test(normalized)) return 'contract';
  return 'report';
}

function defaultTemplateFor(kind, text = '') {
  const normalized = cleanText(text);
  if (kind === 'contract') {
    if (/(租赁|出租|承租)/u.test(normalized)) return 'contract-lease';
    if (/(采购|购买|供货)/u.test(normalized)) return 'contract-procurement';
    if (/(劳务|用工)/u.test(normalized)) return 'contract-labor';
    if (/(合作|协议)/u.test(normalized)) return 'contract-cooperation';
    return 'contract-service';
  }
  if (/(请示|申请|拨付|审批)/u.test(normalized)) return 'report-request';
  if (/(总结|年度工作)/u.test(normalized)) return 'report-work-summary';
  if (/(调研|调查研究)/u.test(normalized)) return 'report-research';
  if (/(情况|通报)/u.test(normalized)) return 'report-situation';
  return 'report-work';
}

function buildConversationMessages({
  preferredKind = 'auto',
  conversation = [],
  currentFields = {},
  currentContent = '',
  referencePrompt = '无',
}) {
  const templates = listTemplates().filter((item) => !item.isCustom).map((item) => ({
    id: item.id,
    documentKind: item.documentKind,
    name: item.name,
    fields: item.fields.map((field) => ({ key: field.key, label: field.label, required: Boolean(field.required) })),
  }));
  const schema = {
    documentKind: 'report 或 contract',
    templateId: '上方模板中的一个 id',
    status: 'needs_input 或 ready',
    assistantMessage: '给用户的简短回复；缺信息时最多追问三个相关问题',
    fields: '所选模板的完整字段对象，只能填写用户明确提供或确认的事实',
    documentText: 'status=ready 时返回完整公文纯文本；needs_input 时必须为空字符串',
  };
  return [
    {
      role: 'system',
      content: [
        '你是社区公文拟写助手，需要根据连续对话追问或生成报告、请示、合同。',
        '只输出一个可解析的严格 JSON 对象，不要 Markdown 代码块，不要分析过程，不要输出 JSON 之外的文字。',
        '不得杜撰姓名、主体、金额、日期、政策编号或其他事实。信息不足时 status 必须是 needs_input。',
        '合同生成前必须确认甲乙双方、标的或服务、金额或计价、期限、付款、违约责任和争议解决。',
        `输出结构：${JSON.stringify(schema)}`,
        `可选模板：${JSON.stringify(templates)}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `用户类型偏好：${preferredKind}`,
        `当前已确认字段：${JSON.stringify(currentFields || {})}`,
        `当前公文正文：${cleanText(currentContent) || '无'}`,
        `已确认参考资料：${cleanText(referencePrompt) || '无'}`,
        `对话记录：${JSON.stringify(conversation.map((item) => ({ role: item.role, content: cleanText(item.content) })))}`,
        '请根据最新一条用户消息继续处理。修改现有正文时返回修改后的完整正文，不要只返回修改片段。',
      ].join('\n\n'),
    },
  ];
}

function extractJson(value) {
  const normalized = cleanText(value).replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 无法理解本次公文需求，请换一种说法后重试');
  try {
    return JSON.parse(normalized.slice(start, end + 1));
  } catch {
    throw new Error('AI 无法理解本次公文需求，请换一种说法后重试');
  }
}

function missingContractFields(fields) {
  return CONTRACT_REQUIRED.filter(([key]) => !cleanText(fields[key])).map(([, label]) => label);
}

function parseConversationResponse(content, {
  fallbackKind = 'report',
  fallbackTemplateId = defaultTemplateFor(fallbackKind),
  currentFields = {},
} = {}) {
  const parsed = extractJson(content);
  const documentKind = ['report', 'contract'].includes(parsed.documentKind) ? parsed.documentKind : fallbackKind;
  let templateId = cleanText(parsed.templateId) || fallbackTemplateId;
  let template;
  try {
    template = getTemplate(templateId);
    if (template.documentKind !== documentKind || template.isCustom) throw new Error('mismatch');
  } catch {
    templateId = defaultTemplateFor(documentKind);
    template = getTemplate(templateId);
  }
  const allowedKeys = new Set(template.fields.map((field) => field.key));
  const merged = { ...(currentFields || {}), ...(parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields) ? parsed.fields : {}) };
  const fields = Object.fromEntries(Object.entries(merged).filter(([key]) => allowedKeys.has(key)).map(([key, value]) => [key, cleanText(value)]));
  const validation = validateFields(templateId, fields);
  const missing = documentKind === 'contract'
    ? [...new Set([...validation.missing.map((key) => template.fields.find((field) => field.key === key)?.label || key), ...missingContractFields(fields)])]
    : validation.missing.map((key) => template.fields.find((field) => field.key === key)?.label || key);
  let status = parsed.status === 'ready' ? 'ready' : 'needs_input';
  if (missing.length) status = 'needs_input';
  let assistantMessage = cleanText(parsed.assistantMessage);
  if (status === 'needs_input' && missing.length) assistantMessage = `还需要补充：${missing.slice(0, 3).join('、')}。请直接在下方告诉我。`;
  if (!assistantMessage) assistantMessage = status === 'ready' ? '公文已生成，请在右侧核验和修改。' : '请继续补充公文所需信息。';
  const documentText = status === 'ready' ? cleanText(parsed.documentText) : '';
  if (status === 'ready' && !documentText) throw new Error('AI 未返回完整公文正文，请重试');
  return { documentKind, templateId, status, assistantMessage, fields, documentText, missing };
}

module.exports = {
  CONTRACT_REQUIRED,
  buildConversationMessages,
  defaultTemplateFor,
  detectDocumentKind,
  parseConversationResponse,
};
