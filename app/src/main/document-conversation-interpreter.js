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
const REQUIRED_PLACEHOLDER = '【待补充】';

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
    assistantMessage: '简短说明已经生成或重新生成',
    fields: `所选模板的字段对象，只能填写用户明确提供或确认的事实；合同关键项缺失时填写${REQUIRED_PLACEHOLDER}`,
    documentText: `直接生成的完整公文纯文本；合同关键项缺失时在正文对应位置写${REQUIRED_PLACEHOLDER}`,
  };
  return [
    {
      role: 'system',
      content: [
        '你是社区公文拟写助手。收到用户要求后必须直接生成完整正文，不得向用户追问。',
        '只输出一个可解析的严格 JSON 对象，不要 Markdown 代码块，不要分析过程，不要输出 JSON 之外的文字。',
        `不得杜撰姓名、主体、金额、日期、政策编号或其他事实。普通缺失内容可以省略；合同必需信息缺失时使用${REQUIRED_PLACEHOLDER}。`,
        `合同中的甲乙双方、标的或服务、金额或计价、期限、付款、违约责任和争议解决缺失时，字段和正文都必须明确写${REQUIRED_PLACEHOLDER}，不能因此停止生成。`,
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
        `本次拟写或补充要求：${JSON.stringify(conversation.map((item) => ({ role: item.role, content: cleanText(item.content) })))}`,
        '如果已有正文，请结合当前正文与本次补充要求重新生成全文；不要只返回修改片段。',
      ].join('\n\n'),
    },
  ];
}

function extractJson(value) {
  const normalized = cleanText(value).replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(normalized.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseConversationResponse(content, {
  fallbackKind = 'report',
  fallbackTemplateId = defaultTemplateFor(fallbackKind),
  currentFields = {},
} = {}) {
  const normalizedContent = cleanText(content);
  if (!normalizedContent) throw new Error('AI 未返回完整公文正文，请重试');
  const parsed = extractJson(normalizedContent) || { documentText: normalizedContent };
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
  const missingKeys = documentKind === 'contract'
    ? [...new Set([...validation.missing, ...CONTRACT_REQUIRED.filter(([key]) => !cleanText(fields[key]) || ['待补充', '请补充'].includes(cleanText(fields[key]))).map(([key]) => key)])]
    : validation.missing;
  const missing = missingKeys.map((key) => template.fields.find((field) => field.key === key)?.label || key);
  if (documentKind === 'contract') {
    for (const key of missingKeys) fields[key] = REQUIRED_PLACEHOLDER;
  }
  const status = 'ready';
  let assistantMessage = cleanText(parsed.assistantMessage);
  if (!assistantMessage) assistantMessage = '公文已生成，请在右侧核验和修改。';
  let documentText = cleanText(parsed.documentText);
  if (!documentText) throw new Error('AI 未返回完整公文正文，请重试');
  if (documentKind === 'contract' && missing.length) {
    const missingNotice = missing.map((label) => `${label}：${REQUIRED_PLACEHOLDER}`).join('\n');
    documentText = `${documentText}\n\n待补充事项\n${missingNotice}`;
  }
  return { documentKind, templateId, status, assistantMessage, fields, documentText, missing };
}

module.exports = {
  CONTRACT_REQUIRED,
  REQUIRED_PLACEHOLDER,
  buildConversationMessages,
  defaultTemplateFor,
  detectDocumentKind,
  parseConversationResponse,
};
