'use strict';
const { dutySchedule } = require('../shared/duty-schedule');
const { createReadOnlyToolRegistry } = require('./ai-tools/read-tools');
const { publicToolMetadata } = require('./ai-tools/tool-definition');
const { createWriteToolRegistry, writeToolForAction } = require('./ai-tools/write-tools');
const { AiSemanticService } = require('./ai-semantic-service');
const { AiTaskPlanner } = require('./ai-task-planner');
const { AiTaskService } = require('./ai-task-service');
const { availableCategories, normalizeCategoryName } = require('./ai-document-category-service');

function text(value) {
  return String(value ?? '').trim();
}

function cleanRequestedDocumentCategory(value) {
  return text(value)
    .replace(/^[“”"'《》【】\s]+|[“”"'《》【】\s]+$/gu, '')
    .replace(/^(?:电子)?档案(?:分类|类别)[：:]?/u, '')
    .replace(/(?:分类|类别)(?:里|里面|下)?$/u, '')
    .replace(/(?:里|里面|下)$/u, '')
    .trim();
}

function requestedDocumentCategory(message) {
  const value = text(message);
  const quoted = value.match(/(?:新建|建立|创建|增加|添加|归档到|存档到|放到|移到)[^“”《》]{0,10}[“”《》]([^“”《》]{2,30})[“”《》]/u)?.[1];
  if (quoted) return cleanRequestedDocumentCategory(quoted);
  const patterns = [
    /(?:新建|建立|创建|增加|添加)(?:一个)?(?:电子)?档案(?:分类|类别)[：:]?\s*([^\n，,。；;]{2,30}?)(?=[，,。；;]?\s*(?:并|然后|再|把|将|用于|并归档|$))/u,
    /(?:新建|建立|创建|增加|添加)(?:一个)?\s*([^\n，,。；;]{2,30}?)(?=(?:分类|类别)?[，,。；;]?\s*(?:并|然后|再|把|将|里|里面|下|归档|存档|$))/u,
    /(?:归档到|存档到|放到|移到)(?:电子)?档(?:案柜)?(?:的)?(?:分类|类别)?[：:]?\s*([^\n，,。；;]{2,30}?)(?=(?:分类|类别)?[，,。；;]?\s*(?:里|里面|下|$))/u,
  ];
  for (const pattern of patterns) {
    const result = cleanRequestedDocumentCategory(value.match(pattern)?.[1]);
    if (result) return result;
  }
  return '';
}

function isDocumentCategoryArchiveRequest(message) {
  const value = text(message);
  const archiveIntent = /(?:归档|存档)|(?:录入|导入|放到|移到).{0,16}(?:电子)?档案|档案管理|电子档案柜/u.test(value);
  const categoryIntent = /(?:新建|建立|创建|增加|添加)|(?:归档到|存档到|放到|移到)/u.test(value);
  return archiveIntent && categoryIntent && Boolean(requestedDocumentCategory(value));
}

function yearFrom(value) {
  const matched = text(value).match(/(?:19|20)\d{2}/u);
  return matched ? Number(matched[0]) : null;
}

function cents(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function financeAmountCents(record) {
  if (record?.amountCents !== undefined && record?.amountCents !== null && record?.amountCents !== '') return cents(record.amountCents);
  const amount = Number(String(record?.amount ?? 0).replace(/[￥¥元,，\s]/gu, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function financeRecordDate(record) {
  return text(record?.date || record?.recordDate || record?.transactionDate || record?.createdAt);
}

function financeVoucherNumber(record) {
  return text(record?.voucherNumber || record?.voucher_number || record?.voucher);
}

function formatMoney(value) {
  return `¥${(cents(value) / 100).toFixed(2)}`;
}

function yuanToCents(value) {
  const normalized = text(value).replace(/[￥¥元,，\s]/gu, '');
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function personId(person) {
  return text(person?.id || person?.personId || person?.id_card || person?.idCard);
}

function personName(person) {
  return text(person?.name || person?.person_name || person?.resident_name);
}

function personGroup(person) {
  return text(person?.village_group || person?.villageGroup || person?.group || person?.group_name);
}

function personIdentityCard(person) {
  return text(person?.id_card || person?.idCard || person?.identity_card || person?.identityCard);
}

function personHouseholdId(person) {
  return text(person?.household_id || person?.householdId || person?.household_no || person?.householdNo || person?.household_number || person?.householdNumber);
}

function personRelationToHead(person) {
  return text(person?.relation_to_head || person?.relationToHead || person?.household_relation || person?.householdRelation || person?.relationship_to_head || person?.relationshipToHead || person?.relation);
}

function relationDescription(relation) {
  const value = text(relation);
  if (/^(?:子|女|儿子|女儿|子女)$/u.test(value)) return '子女';
  if (/^(?:配偶|妻子|丈夫|夫|妻)$/u.test(value)) return '配偶';
  return value;
}

function onlineAnalysisRequested(message) {
  return /(?:在线|联网).{0,8}(?:AI|人工智能).{0,12}(?:分析|判断|研判)|(?:用|请用|交给).{0,8}(?:在线|联网).{0,8}(?:AI|人工智能)|(?:在线|联网)(?:分析|研判)/u.test(text(message));
}

function sensitiveContentLabels(message) {
  const value = text(message);
  const labels = [];
  if (/\b\d{17}[\dXx]\b/u.test(value) || /(身份证|证件号|身份号码)/u.test(value)) labels.push('身份证信息');
  if (/\b1\d{10}\b/u.test(value) || /手机号/u.test(value)) labels.push('手机号码');
  if (/\b\d{12,19}\b/u.test(value) || /(银行卡|卡号|银行账户)/u.test(value)) labels.push('银行卡或账户信息');
  if (/(?:姓名|住址|地址)[：:]/u.test(value)) labels.push('个人身份或住址信息');
  return labels;
}

function redactOnlineAnalysisText(message) {
  return text(message)
    .replace(/\b\d{17}[\dXx]\b/gu, '[身份证号已脱敏]')
    .replace(/\b1\d{10}\b/gu, '[手机号已脱敏]')
    .replace(/\b\d{12,19}\b/gu, '[银行卡号已脱敏]')
    .replace(/(姓名[：:]\s*)[\u4e00-\u9fff]{2,6}/gu, '$1[姓名已脱敏]')
    .replace(/((?:住址|地址)[：:]\s*)[^；;，,。\n]+/gu, '$1[住址已脱敏]');
}

function certificateCode(certificate) {
  return text(certificate?.recordCode || certificate?.code || certificate?.certificateCode);
}

function databaseFingerprint(database) {
  const snapshot = structuredClone(database || {});
  delete snapshot.aiAssistantOperations;
  delete snapshot.aiAssistantTasks;
  return JSON.stringify(snapshot);
}

function paymentYear(item, batch) {
  return yearFrom(item?.paidAt)
    || yearFrom(batch?.completedAt)
    || yearFrom(batch?.batchDate)
    || yearFrom(batch?.period)
    || yearFrom(batch?.createdAt);
}

function plannedPaymentYear(item, batch) {
  return yearFrom(batch?.batchDate)
    || yearFrom(batch?.period)
    || yearFrom(batch?.completedAt)
    || yearFrom(item?.createdAt)
    || yearFrom(batch?.createdAt);
}

function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createWorkNumber(workItems, date = new Date()) {
  const prefix = `GZ-${localDate(date).replaceAll('-', '')}-`;
  const largestSequence = (Array.isArray(workItems) ? workItems : [])
    .map((item) => text(item?.number))
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter(Number.isInteger)
    .reduce((largest, sequence) => Math.max(largest, sequence), 0);
  return `${prefix}${String(largestSequence + 1).padStart(3, '0')}`;
}

function lastUserMessage(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === 'user' && text(message.content));
}

function recentConversation(messages, limit = 60) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ['user', 'assistant', 'system'].includes(text(message?.role)) && text(message?.content))
    .slice(-limit)
    .map((message) => ({ role: text(message.role), content: text(message.content) }));
}

function parseOnlinePlan(content) {
  const raw = text(content).replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const plan = JSON.parse(raw.slice(start, end + 1));
    const canonicalMessage = text(plan?.canonicalMessage);
    if (!canonicalMessage || canonicalMessage.length > 2000) return null;
    return {
      canonicalMessage,
      intent: text(plan.intent) || 'query',
      needsFacts: plan.needsFacts === true,
      // The model is never allowed to request the complete resident database.
      // Local code selects a small, relevant fact bundle instead.
      dataScope: 'related_records',
    };
  } catch {
    return null;
  }
}

function parseCertificateDraftResponse(content, templates = []) {
  const raw = text(content).replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 返回内容无法识别，请保留当前草稿后重试');
  let value;
  try { value = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new Error('AI 返回内容格式不完整，请保留当前草稿后重试'); }
  const templateIds = new Set((Array.isArray(templates) ? templates : []).map(item => text(item?.id)).filter(Boolean));
  const recommendedTemplateId = templateIds.has(text(value?.recommendedTemplateId)) ? text(value.recommendedTemplateId) : '';
  const residentNames = [...new Set((Array.isArray(value?.residentNames) ? value.residentNames : []).map(name => text(name)).filter(Boolean))].slice(0, 6);
  const manualValues = value?.manualValues && typeof value.manualValues === 'object' && !Array.isArray(value.manualValues)
    ? Object.fromEntries(Object.entries(value.manualValues).map(([key, item]) => [text(key), text(item)]).filter(([key]) => key)) : {};
  return {
    reply: text(value?.reply) || (value?.needsMoreInfo ? '还需要补充一些信息。' : '草稿已生成，请核对居民和正文。'),
    needsMoreInfo: value?.needsMoreInfo === true,
    questions: (Array.isArray(value?.questions) ? value.questions : []).map(item => text(item)).filter(Boolean).slice(0, 5),
    residentNames,
    recommendedTemplateId,
    draftMode: recommendedTemplateId && value?.draftMode !== 'temporary' ? 'template' : 'temporary',
    title: text(value?.title).slice(0, 100),
    content: String(value?.content || '').trim().slice(0, 12000),
    manualValues,
    changeSummary: text(value?.changeSummary).slice(0, 500),
  };
}

function isResidentOverviewRequest(message) {
  return /(基本情况|基本信息|个人情况|居民情况|档案情况|个人资料)/u.test(text(message));
}

function safeOnlineError(error) {
  const message = text(error?.message || error)
    .replace(/Bearer\s+[^\s"']+/giu, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]{12,}/gu, '***')
    .slice(0, 240);
  return message || '在线服务暂时没有响应';
}

function sanitizeFactValue(value, depth = 0) {
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeFactValue(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 500) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:identity|id_?card|身份证|bank|card_?number|银行卡|phone|mobile|电话|token|secret|password)/iu.test(key)) continue;
    result[key] = sanitizeFactValue(item, depth + 1);
  }
  return result;
}

function relationChildGender(relation) {
  const value = text(relation);
  if (/(?:子|儿子)$/u.test(value)) return 'male';
  if (/(?:女|女儿)$/u.test(value)) return 'female';
  return '';
}

function isAnnualAmountQuestion(message) {
  const value = text(message);
  return /(发了|发放|实发|已发|累计).{0,18}(多少钱|多少|金额|总额|合计)|(多少钱|多少|金额|总额|合计).{0,18}(发了|发放|实发|已发|累计)/u.test(value);
}

function isPaymentQuestion(message) {
  const value = text(message);
  return isAnnualAmountQuestion(value)
    || /(哪个|哪一个).{0,12}(组|村民组).{0,12}(发放|实发|已发).{0,12}(最多|最高)/u.test(value)
    || /(发放|实发|已发).{0,12}(最多|最高).{0,12}(组|村民组)/u.test(value);
}

function isAllYearsPaymentRequest(message) {
  const value = text(message);
  return /(历年|全部年份|所有年份|各年度|各年份|有记录以来|从建档以来|至今)/u.test(value)
    || /(累计|总计|总共|一共|共计).{0,18}(发了|发放|实发|已发|金额|多少)/u.test(value)
    || /(发了|发放|实发|已发).{0,18}(累计|总计|总共|一共|共计)/u.test(value);
}

function paymentPeriodLabel(year, allYears = false) {
  return allYears ? '历年' : `${year} 年`;
}

function isSystemDataRequest(message) {
  const value = text(message);
  return /(村民|居民|人员|档案|发放|资金|承包费|补贴|合同|地块|值班|党员|台账|系统).{0,24}(多少|查询|查|统计|修改|新增|删除|导出|跳转|打开|看看|信息|记录)/u.test(value)
    || /(查询|查|统计|修改|新增|删除|导出|跳转|打开).{0,24}(村民|居民|人员|档案|发放|资金|承包费|补贴|合同|地块|值班|党员|台账|系统)/u.test(value);
}

function isCountQuestion(message) {
  return /(多少|几(个|人|条|份|块)|数量|人数|总数)/u.test(text(message));
}

function navigationTarget(message) {
  const value = text(message);
  if (!/(打开|进入|跳转|去|查看).{0,14}|.{0,14}(打开|进入|跳转|去|查看)/u.test(value)) return null;
  const targets = [
    { pattern: /(资金发放|发放中心|承包费)/u, target: 'tab-contract-fees', label: '资金发放中心' },
    { pattern: /(居民一户一档|村民档案|居民档案|人员档案)/u, target: 'tab-personnel', label: '居民一户一档' },
    { pattern: /党员/u, target: 'tab-party', label: '党员管理' },
    { pattern: /(民情|走访)/u, target: 'tab-visit-records', label: '民情记录' },
    { pattern: /值班/u, target: 'tab-duty', label: '村里值班' },
    { pattern: /(财务|收支)/u, target: 'tab-finance', label: '财务收支' },
    { pattern: /(土地|地块|确权)/u, target: 'tab-land', label: '土地承包确权' },
    { pattern: /工作管理/u, target: 'tab-work-management', label: '工作管理' },
    { pattern: /(公文拟写|公文)/u, target: 'tab-document-drafting', label: '公文拟写' },
    { pattern: /证明/u, target: 'tab-certificate', label: '证明开具' },
    { pattern: /(电子档案|档案柜)/u, target: 'tab-documents', label: '电子档案柜' },
    { pattern: /(系统设置|设置)/u, target: 'tab-settings', label: '系统设置' },
    { pattern: /统计/u, target: 'tab-statistics', label: '数据统计' },
  ];
  const matched = targets.find((item) => item.pattern.test(value));
  return matched ? { target: matched.target, label: matched.label } : null;
}

class AiAssistantService {
  constructor({ databaseStore, aiRouter, authService = null, now = () => new Date(), aiToolRegistry = null, writeToolRegistry = null, semanticService = null, taskPlanner = null, taskService = null, aiFileTaskService = null } = {}) {
    if (!databaseStore?.read) throw new TypeError('databaseStore is required');
    this.databaseStore = databaseStore;
    this.aiRouter = aiRouter;
    this.authService = authService;
    this.now = now;
    this.aiToolRegistry = aiToolRegistry || createReadOnlyToolRegistry();
    this.writeToolRegistry = writeToolRegistry || createWriteToolRegistry();
    this.semanticService = semanticService || new AiSemanticService();
    this.taskPlanner = taskPlanner || new AiTaskPlanner({ registry: this.aiToolRegistry });
    this.taskService = taskService || new AiTaskService({ databaseStore, authService, now });
    this.aiFileTaskService = aiFileTaskService;
    this.pendingAction = null;
    this.pendingOnlineAnalysis = null;
    this.pendingMemory = null;
  }

  listReadOnlyTools(options = {}) {
    return this.aiToolRegistry.list(options);
  }

  listWriteTools(options = {}) {
    return this.writeToolRegistry.list(options);
  }

  async attachedFiles(conversationId, attachmentIds = []) {
    if (!this.aiFileTaskService || !Array.isArray(attachmentIds) || !attachmentIds.length) return [];
    const allowed = new Set(attachmentIds.map(text).filter(Boolean));
    return (await this.aiFileTaskService.list({ conversationId, limit: 100 })).filter(file => allowed.has(text(file.id)));
  }

  fileRecognitionAnswer(files) {
    if (!files.length) return null;
    const lines = files.map((file, index) => {
      const status = file.status === 'reviewed' ? '已经人工核对' : file.status === 'needs-review' ? '需要人工核对' : '已完成初步识别';
      const fields = Array.isArray(file.fields) && file.fields.length ? `；字段：${file.fields.slice(0, 12).join('、')}` : '';
      const recognizedFields = Array.isArray(file.documentFields) && file.documentFields.length ? file.documentFields : file.ocrFields;
      const ocrFields = Array.isArray(recognizedFields) && recognizedFields.length
        ? `；识别信息：${recognizedFields.slice(0, 8).map(field => `${field.label}=${field.value}${field.requiresReview ? '（待核对）' : ''}`).join('、')}` : '';
      const classification = file.documentClassification?.name ? `；材料用途：${file.documentClassification.name}` : '';
      const excerpt = Array.isArray(file.chunks) && file.chunks[0]?.text
        ? `\n   文字摘录：${text(file.chunks[0].text).slice(0, 500)}` : '';
      const warnings = Array.isArray(file.warnings) && file.warnings.length ? `；提示：${file.warnings.join('；')}` : '';
      return `${index + 1}. ${file.fileName}：${file.summary}（${status}）${classification}${fields}${ocrFields}${warnings}${excerpt}`;
    });
    return {
      content: `已保存并检查您附加的文件：\n${lines.join('\n')}\n\n目前只完成识别和导入前检查，尚未把任何内容写入业务台账。下一步会先让您核对字段、重复记录和金额差异，确认后才执行导入。`,
      provider: 'system', handled: true,
      data: { fileEntries: files },
    };
  }

  async documentCategoryArchiveProposal(database, message, conversationId = '') {
    if (!isDocumentCategoryArchiveRequest(message)) return null;
    if (!this.aiFileTaskService?.list || !this.aiFileTaskService?.applyCategoryDecision) {
      return {
        content: '当前环境尚未启用档案分类执行服务。本次没有新建分类，文件仍保留在“待归档”中。',
        provider: 'system', handled: true, needsConfirmation: false,
      };
    }
    const categoryName = requestedDocumentCategory(message);
    const files = await this.aiFileTaskService.list({ conversationId, limit: 100 });
    const pendingFiles = files.filter(file => file.status !== 'deleted' && text(file.archiveState || 'pending') !== 'archived');
    if (!pendingFiles.length) {
      const alreadyArchived = files.find(file => normalizeCategoryName(file.finalCategory) === normalizeCategoryName(categoryName));
      if (alreadyArchived) {
        return {
          content: `文件“${text(alreadyArchived.fileName)}”已经归档到“${text(alreadyArchived.finalCategory) || categoryName}”，无需重复操作。`,
          provider: 'system', handled: true,
          data: { fileEntry: alreadyArchived, documentCategoryChanged: false },
        };
      }
      return {
        content: `当前对话中没有找到待归档文件，因此没有新建“${categoryName}”分类。请先上传文件，再说明要归入的分类。`,
        provider: 'system', handled: true, needsConfirmation: false,
      };
    }
    const normalizedMessage = text(message).replace(/\.[^.]+$/u, '');
    const explicitlyNamed = pendingFiles.filter(file => {
      const fileName = text(file.fileName);
      const baseName = fileName.replace(/\.[^.]+$/u, '');
      return (fileName && normalizedMessage.includes(fileName)) || (baseName.length >= 2 && normalizedMessage.includes(baseName));
    });
    let selectedFile = explicitlyNamed.length === 1 ? explicitlyNamed[0] : null;
    if (!selectedFile && pendingFiles.length === 1) selectedFile = pendingFiles[0];
    if (!selectedFile && /(?:刚才|刚刚|这个|该)(?:上传的)?(?:文件|材料|图片|表格|证书)?/u.test(text(message))) selectedFile = pendingFiles[0];
    if (!selectedFile) {
      return {
        content: `当前对话有 ${pendingFiles.length} 个待归档文件，我无法确定要处理哪一个。请说明文件名，例如“把${text(pendingFiles[0]?.fileName)}归档到${categoryName}”。\n待归档文件：${pendingFiles.slice(0, 8).map(file => text(file.fileName)).join('、')}`,
        provider: 'system', handled: true, needsConfirmation: false,
      };
    }
    const categories = availableCategories(database);
    const existing = categories.find(item => normalizeCategoryName(item.name) === normalizeCategoryName(categoryName));
    const finalCategory = text(existing?.name) || categoryName;
    if (normalizeCategoryName(selectedFile.finalCategory) === normalizeCategoryName(finalCategory)
      && text(selectedFile.archiveState) === 'archived') {
      return {
        content: `文件“${text(selectedFile.fileName)}”已经归档到“${finalCategory}”，无需重复操作。`,
        provider: 'system', handled: true,
        data: { fileEntry: selectedFile, documentCategoryChanged: false },
      };
    }
    const type = existing ? 'document_category_assign' : 'document_category_create_and_archive';
    const summary = existing
      ? `将文件“${text(selectedFile.fileName)}”归档到现有分类“${finalCategory}”`
      : `新建档案分类“${finalCategory}”，并将文件“${text(selectedFile.fileName)}”归档到该分类`;
    const action = this.queueControlledAction({
      type,
      module: '电子档案柜',
      object: { id: text(selectedFile.documentId || selectedFile.id), name: text(selectedFile.fileName) },
      fileId: text(selectedFile.id),
      documentId: text(selectedFile.documentId),
      categoryName: finalCategory,
      summary,
      before: { archiveState: text(selectedFile.archiveState || 'pending'), category: text(selectedFile.finalCategory || '待归档') },
      after: { archiveState: 'archived', category: finalCategory },
      proposedAt: this.now().toISOString(),
    });
    return {
      content: this.actionPreview(action),
      provider: 'system', handled: true, needsConfirmation: true,
      action: { type: 'confirm', riskLevel: action.riskLevel, confirmationsRequired: 1, before: action.before, after: action.after },
      data: { fileEntry: selectedFile, requestedCategory: finalCategory, categoryExists: Boolean(existing) },
    };
  }

  async runReadOnlyTool({ database, message, messages = [], conversation = [], plan = null, stage = 'post-plan' } = {}) {
    return this.aiToolRegistry.executeFirst({
      service: this,
      database,
      message: text(message),
      messages,
      conversation,
      plan,
      navigationTarget,
    }, { stage });
  }

  async getConversation(value = {}) {
    if (typeof this.authService?.request !== 'function') return { conversation: null };
    const id = text(value.conversationId);
    const response = await this.authService.request(`/unit/workspace/ai/conversation${id ? `?conversationId=${encodeURIComponent(id)}` : ''}`);
    const conversationId = text(response?.conversation?.id || id);
    const task = conversationId ? await this.taskService.latestActive(conversationId).catch(() => null) : null;
    return { ...response, task };
  }

  async saveConversation(value = {}) {
    if (typeof this.authService?.request !== 'function') return { conversation: null };
    return this.authService.request('/unit/workspace/ai/conversation', { method: 'PUT', body: value });
  }

  async draftCertificateWithAi({ messages, templates } = {}) {
    if (typeof this.aiRouter?.onlineChat !== 'function') throw new Error('在线 AI 尚未配置或当前不可用，请先在系统设置中完成测试');
    const conversation = recentConversation(messages, 30);
    if (!lastUserMessage(conversation)) throw new Error('请先说明需要开具的证明和基本情况');
    const safeTemplates = (Array.isArray(templates) ? templates : []).slice(0, 80).map(item => ({
      id: text(item?.id), name: text(item?.name), category: text(item?.category), title: text(item?.title),
      content: String(item?.content || '').slice(0, 4000),
      fields: (Array.isArray(item?.fields) ? item.fields : []).slice(0, 30).map(field => ({ label: text(field?.label), source: text(field?.source) })),
    }));
    try {
      const response = await this.aiRouter.onlineChat([
        {
          role: 'system',
          content: `你是村居证明起草助手。根据连续对话判断证明用途、居民姓名和需要补充的信息，并优先匹配给定模板。不得声称已经查询居民档案或已经正式开具证明。信息不足时必须追问，不能猜测。正文中的居民姓名、身份证号、地址等个人资料必须使用模板现有的中文占位符，不得编造号码。仅输出一个 JSON，不要输出 Markdown 或解释，结构为：{"reply":"给工作人员的中文说明或追问","needsMoreInfo":true或false,"questions":["需补充的问题"],"residentNames":["对话中明确出现的姓名"],"recommendedTemplateId":"只能填写给定模板ID，没有则为空","draftMode":"template或temporary","title":"证明标题","content":"证明正文草稿","manualValues":{"字段中文名称":"从对话中明确得到的值"},"changeSummary":"本轮修改说明"}。若工作人员要求局部修改，应保留未要求改动的正文；若要求重新生成，可以重写整篇。可用模板：${JSON.stringify(safeTemplates)}`,
        },
        ...conversation,
      ], { maxTokens: 2400, temperature: 0.15, taskTier: 'deep', taskKind: 'certificate-draft' });
      return { ...parseCertificateDraftResponse(response?.content, safeTemplates), provider: 'online', model: response?.model || '', usage: response?.usage || null,
        routing: response?.routing || null };
    } catch (error) {
      if (/返回内容/u.test(text(error?.message))) throw error;
      throw new Error(`AI 证明起草暂时不可用：${safeOnlineError(error)}。当前对话和草稿会保留。`);
    }
  }

  async listMemories() {
    if (typeof this.authService?.request !== 'function') return { memories: [] };
    return this.authService.request('/unit/workspace/ai/memories');
  }

  async deleteMemory(value = {}) {
    if (typeof this.authService?.request !== 'function') throw new Error('当前账号服务不支持长期记忆');
    return this.authService.request(`/unit/workspace/ai/memories/${encodeURIComponent(text(value.memoryId))}`, { method: 'DELETE' });
  }

  async createMemory({ scope = 'personal', content } = {}) {
    if (typeof this.authService?.request !== 'function') throw new Error('当前账号服务不支持长期记忆');
    return this.authService.request('/unit/workspace/ai/memories', { method: 'POST', body: { scope, content } });
  }

  async memoryContextMessage() {
    try {
      const response = await this.listMemories();
      const memories = Array.isArray(response?.memories) ? response.memories.slice(0, 30) : [];
      if (!memories.length) return null;
      const lines = memories.map(item => `- ${item.scope === 'organization' ? '单位规则' : '个人习惯'}：${text(item.content)}`);
      return {
        role: 'system',
        content: `以下是操作员明确保存的长期记忆。用于理解称呼、偏好和业务习惯；不得把它当成居民或资金台账的实时事实：\n${lines.join('\n')}`.slice(0, 5000),
      };
    } catch {
      return null;
    }
  }

  semanticContext(database, message) {
    const view = this.semanticService.buildView(database);
    const resolution = this.semanticService.resolveResident(view, { query: message });
    if (resolution.status !== 'resolved') return resolution.status === 'ambiguous' ? resolution : null;
    const related = this.semanticService.relatedRecords(view, { personId: resolution.resident.id });
    const counts = {};
    for (const record of related.records || []) counts[record.collection] = (counts[record.collection] || 0) + 1;
    return {
      status: 'resolved',
      resident: resolution.resident,
      relatedRecordCounts: counts,
      pendingLinkCount: related.pendingRecords?.length || 0,
      pendingLinkReasons: [...new Set((related.pendingRecords || []).map(item => item.reason).filter(Boolean))],
    };
  }

  clarificationFrom(result) {
    if (!result?.needsConfirmation || result?.action?.type === 'confirm') return null;
    const content = text(result.content);
    if (!/(请|需要|确认|补充|哪一)/u.test(content)) return null;
    return { question: content.slice(0, 500), field: /哪一年|年度/u.test(content) ? 'year' : /村民组|哪一位|同名/u.test(content) ? 'resident' : 'details' };
  }

  taskProgressText(task) {
    const steps = Array.isArray(task?.steps) ? task.steps : [];
    const completed = steps.filter(step => ['completed', 'skipped', 'undone'].includes(step.status)).length;
    const waiting = steps.find(step => ['waiting-input', 'waiting-confirmation'].includes(step.status));
    return `任务进度：已完成 ${completed}/${steps.length} 步${waiting ? `，下一步“${waiting.title}”等待补充` : ''}`;
  }

  async executeTask(task, { database, messages, conversation, plan }) {
    task.status = 'running';
    task.clarification = null;
    task = await this.taskService.save(task);
    const answers = (task.steps || []).filter(step => step.status === 'completed' && step.resultSummary).map(step => ({
      title: step.title,
      result: { content: step.resultSummary, provider: 'system', handled: true },
    }));
    for (let stepIndex = 0; stepIndex < task.steps.length; stepIndex += 1) {
      let step = task.steps[stepIndex];
      if (step.status === 'completed' || step.status === 'skipped') continue;
      step.status = 'running';
      task = await this.taskService.save(task);
      step = task.steps[stepIndex];
      try {
        const result = await this.aiToolRegistry.execute(step.toolId, {
          service: this,
          database,
          message: task.clarifiedRequest,
          messages,
          conversation,
          plan,
          navigationTarget,
        });
        if (!result) {
          step.status = 'skipped';
          step.resultSummary = '当前条件未匹配到可核对结果';
          continue;
        }
        if (result.routing) {
          const routing = result.routing;
          step.modelTier = routing.taskTier || '';
          step.modelName = routing.model || result.model || '';
          step.estimatedTokens = Math.max(0, Number(routing.estimatedTokens) || 0);
          step.actualTokens = Math.max(0, Number(routing.actualTokens || result.usage?.total_tokens) || 0);
          step.aiRequestId = text(routing.requestId);
          task.modelTier = step.modelTier || task.modelTier;
          task.modelName = step.modelName || task.modelName;
          task.estimatedTokens = Math.max(0, Number(task.estimatedTokens) || 0) + step.estimatedTokens;
          task.actualTokens = Math.max(0, Number(task.actualTokens) || 0) + step.actualTokens;
          task.aiRequestId = step.aiRequestId || task.aiRequestId;
          task.tokenStatus = 'settled';
          task.quotaSnapshot = routing.remainingTokens === null || routing.remainingTokens === undefined
            ? task.quotaSnapshot
            : { remainingTokens: Number(routing.remainingTokens), observedAt: this.now().toISOString() };
        }
        const clarification = this.clarificationFrom(result);
        if (clarification) {
          step.status = 'waiting-input';
          step.resultSummary = clarification.question;
          task.status = 'waiting-input';
          task.clarification = clarification;
          task.summary = clarification.question;
          task = await this.taskService.save(task);
          const completedSections = answers.map(item => `【${item.title}】\n${item.result.content}`);
          return { ...result, task, content: `${completedSections.length ? `${completedSections.join('\n\n')}\n\n` : ''}${result.content}\n\n${this.taskProgressText(task)}` };
        }
        step.status = 'completed';
        step.resultSummary = text(result.content).slice(0, 1000);
        answers.push({ title: step.title, result });
      } catch (error) {
        if (error?.code === 'AI_QUOTA_EXHAUSTED') {
          step.status = 'waiting-input';
          step.error = text(error?.message).slice(0, 500);
          task.status = 'waiting-input';
          task.tokenStatus = 'quota-exhausted';
          task.estimatedTokens = Math.max(0, Number(error?.details?.requiredTokens) || 0);
          task.quotaSnapshot = { remainingTokens: Math.max(0, Number(error?.details?.remainingTokens) || 0), observedAt: this.now().toISOString() };
          task.clarification = { question: '本单位 AI 额度已用完。购买额度后回复“继续任务”，系统会从当前步骤继续。', field: 'ai-quota' };
          task.summary = task.clarification.question;
          task = await this.taskService.save(task);
          return { content: `${task.summary}\n\n${this.taskProgressText(task)}`, provider: 'system', handled: true, needsConfirmation: true, task };
        }
        step.status = 'failed';
        step.error = text(error?.message).slice(0, 500);
        task.status = 'failed';
        task.summary = `${step.title}失败：${step.error}`;
        task = await this.taskService.save(task);
        return { content: `${task.summary}\n\n${this.taskProgressText(task)}`, provider: 'system', handled: true, task };
      }
      task = await this.taskService.save(task);
    }
    task.status = 'completed';
    task.summary = answers.map(item => `${item.title}：${text(item.result.content)}`).join('\n').slice(0, 2000);
    task = await this.taskService.save(task);
    const sections = answers.map(item => `【${item.title}】\n${item.result.content}`);
    if (task.requestedExport) sections.push('查询和核对步骤已经完成；当前批次暂不自动生成导出文件，文件导出将在后续文件任务接入后执行。');
    const lastEvidence = [...answers].reverse().find(item => item.result?.data?.queryEvidence)?.result?.data?.queryEvidence;
    return {
      content: `${sections.join('\n\n')}\n\n${this.taskProgressText(task)}`,
      provider: answers.some(item => item.result.provider === 'online') ? 'online' : 'system',
      handled: true,
      data: lastEvidence ? { queryEvidence: lastEvidence } : undefined,
      task,
    };
  }

  async handleMemoryCommand(message) {
    const requested = text(message);
    if (this.pendingMemory) {
      if (/(取消|算了|不保存)/u.test(requested)) {
        this.pendingMemory = null;
        return { content: '已取消，不会保存这条单位规则。', provider: 'system', handled: true };
      }
      if (!/(确认|保存)/u.test(requested)) {
        return { content: `准备保存为全单位共享规则：“${this.pendingMemory.content}”。请回复“确认保存”，或回复“取消”。`, provider: 'system', handled: true, needsConfirmation: true };
      }
      const pending = this.pendingMemory;
      this.pendingMemory = null;
      await this.createMemory(pending);
      return { content: `已保存单位规则：“${pending.content}”。本单位成员以后使用 AI 时都会参考它。`, provider: 'system', handled: true };
    }
    const unitMatch = requested.match(/^(?:请)?(?:记住|保存)?\s*单位规则[：:]\s*(.+)$/u);
    if (unitMatch?.[1]) {
      this.pendingMemory = { scope: 'organization', content: text(unitMatch[1]) };
      return { content: `准备保存为全单位共享规则：“${this.pendingMemory.content}”。请回复“确认保存”，或回复“取消”。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    const personalMatch = requested.match(/^(?:请)?记住[：:]?\s*(.+)$/u)
      || requested.match(/^(我(?:通常|习惯|希望|喜欢).+)$/u)
      || requested.match(/^((?:以后|今后)请?.+)$/u);
    if (personalMatch?.[1]) {
      const content = text(personalMatch[1]);
      await this.createMemory({ scope: 'personal', content });
      return { content: `好的，已记住您的个人习惯：“${content}”。您可以随时打开“记忆”查看或删除。`, provider: 'system', handled: true };
    }
    if (/(你记得什么|查看.{0,4}记忆|有哪些.{0,4}记忆)/u.test(requested)) {
      const response = await this.listMemories();
      const memories = Array.isArray(response?.memories) ? response.memories : [];
      if (!memories.length) return { content: '目前还没有长期记忆。虚构示例：“记住：以后称呼我为陈主任”。', provider: 'system', handled: true };
      return { content: `目前共有 ${memories.length} 条长期记忆：\n${memories.map((item, index) => `${index + 1}.【${item.scope === 'organization' ? '单位规则' : '个人'}】${item.content}`).join('\n')}`, provider: 'system', handled: true };
    }
    return null;
  }

  async understandConversation(messages) {
    if (typeof this.aiRouter?.onlineChat !== 'function') return null;
    try {
      const response = await this.aiRouter.onlineChat([
        {
          role: 'system',
          content: '你是社区AI管理系统的对话理解器。根据完整对话把最后一个用户问题改写成脱离上下文也能执行的明确指令。仅输出 JSON：{"canonicalMessage":"明确指令","intent":"query|navigate|create|update|delete|chat","needsFacts":true或false,"dataScope":"related_records"}。不要声称已经查询系统，不要执行操作；姓名、年度、指代不明确时在 canonicalMessage 中明确写出需要追问的内容，不要编造。系统只会在本机精确检索与当前事项有关的少量记录。',
        },
        ...recentConversation(messages),
      ], { maxTokens: 300, temperature: 0, taskTier: 'basic', taskKind: 'conversation-understanding' });
      return parseOnlinePlan(response?.content);
    } catch {
      return null;
    }
  }

  relevantFacts(database, plan, request) {
    const requested = text(request);
    const personnel = Array.isArray(database?.personnel) ? database.personnel : [];
    const named = personnel.filter((person) => personName(person) && requested.includes(personName(person)));
    const householdIds = new Set(named.map(personHouseholdId).filter(Boolean));
    const relatedPeople = householdIds.size
      ? personnel.filter((person) => householdIds.has(personHouseholdId(person)))
      : named;
    const identifiers = new Set(relatedPeople.flatMap((person) => [personId(person), personIdentityCard(person)]).filter(Boolean));
    const recordIncludesPerson = (record) => {
      const raw = JSON.stringify(record || {});
      return [...identifiers].some((identifier) => raw.includes(identifier))
        || relatedPeople.some((person) => raw.includes(personName(person)));
    };
    const facts = {
      personnel: relatedPeople.slice(0, 20),
      landParcel: (database?.landParcel || database?.lands || []).filter(recordIncludesPerson).slice(0, 20),
      disbursementBatches: (database?.disbursementBatches || []).filter(recordIncludesPerson).slice(0, 20),
      contractFeeBatches: (database?.contractFeeBatches || []).filter(recordIncludesPerson).slice(0, 20),
      financeRecords: (database?.financeRecords || database?.finances || []).filter(recordIncludesPerson).slice(0, 20),
    };
    return sanitizeFactValue(facts);
  }

  async explainVerifiedFacts({ messages, request, database, plan, localAnswer }) {
    if (!plan?.needsFacts || typeof this.aiRouter?.onlineChat !== 'function') return localAnswer;
    const facts = this.relevantFacts(database, plan, request);
    try {
      const response = await this.aiRouter.onlineChat([
        {
          role: 'system',
          content: '你是社区AI管理系统的事实说明助手。只能根据“已核对本机资料”回答，不得补充、猜测或修改任何资料。若资料不足，明确说明无法确认。用简洁中文解释结论和依据。',
        },
        ...recentConversation(messages),
        { role: 'user', content: `已核对本机资料：\n${JSON.stringify(facts)}` },
      ], { maxTokens: 800, temperature: 0.2, taskTier: 'basic', taskKind: 'verified-fact-explanation' });
      const content = text(response?.content);
      return content ? { ...localAnswer, content, provider: 'online', data: { ...(localAnswer.data || {}), facts } } : localAnswer;
    } catch {
      return localAnswer;
    }
  }

  async answerAutomaticOnlineAnalysis({ messages, request, database, plan }) {
    if (typeof this.aiRouter?.onlineChat !== 'function') {
      return { content: '在线 AI 当前未配置或不可用，本次已按本机能力继续处理；如问题仍无法判断，请补充对象、范围或年度。', provider: 'system', handled: true, needsConfirmation: true };
    }
    try {
      const response = await this.aiRouter.onlineChat([
        {
          role: 'system',
          content: '你是社区AI管理系统的在线分析助手。用户已授权系统自动提交与当前事项有关的本机资料。只能依据随后提供的“已核对本机资料”分析，不得编造、不得声称执行过系统操作，也不得指示绕过本机确认规则。资料不足时直接说明需要补充什么。',
        },
        ...recentConversation(messages),
        { role: 'user', content: `当前明确请求：${request}\n已核对本机资料：\n${JSON.stringify(this.relevantFacts(database, plan || { dataScope: 'related_records' }, request))}` },
      ], { maxTokens: 800, temperature: 0.2, taskTier: /(综合|跨模块|对比|核对)/u.test(request) ? 'deep' : 'basic', taskKind: 'fact-analysis' });
      return { ...response, provider: 'online', handled: true };
    } catch (error) {
      const reason = safeOnlineError(error);
      console.error('[AI assistant] online fact explanation failed:', reason);
      return { content: `在线 AI 没有完成本次整理：${reason}。本机资料没有被修改。请补充姓名、村民组、年度或具体事项后重试。`, provider: 'system', handled: true, needsConfirmation: true };
    }
  }

  prepareOnlineAnalysis(message) {
    const requested = text(message);
    const sensitiveLabels = sensitiveContentLabels(requested);
    const sendOriginal = /(原始|不脱敏|完整).{0,8}(?:内容|数据|信息)?/u.test(requested);
    const payload = sendOriginal ? requested : redactOnlineAnalysisText(requested);
    this.pendingOnlineAnalysis = { payload, sensitiveLabels, sendOriginal };
    const protection = sensitiveLabels.length
      ? (sendOriginal ? `已识别到：${sensitiveLabels.join('、')}；将按您的要求发送原始内容。` : `已识别到：${sensitiveLabels.join('、')}；将发送脱敏摘要。`)
      : '本次只会发送您刚才这一条内容。';
    return {
      content: `在线分析发送前确认：${protection}不会自动导出居民档案、资金台账或此前聊天记录。\n\n发送内容预览：\n${payload}\n\n回复“确认发送”后才会交给在线 AI；回复“取消”则不会发送。`,
      provider: 'system', handled: true, needsConfirmation: true,
      action: { type: 'online-analysis-confirmation', mode: sendOriginal ? 'original' : 'redacted', sensitiveLabels },
    };
  }

  async confirmOnlineAnalysis(message) {
    const requested = text(message);
    const pending = this.pendingOnlineAnalysis;
    if (!pending) return null;
    if (/(取消|算了|不发送|不用了)/u.test(requested)) {
      this.pendingOnlineAnalysis = null;
      return { content: '已取消，本次不会向在线 AI 发送任何内容。', provider: 'system', handled: true };
    }
    if (!/(确认发送|确认|发送)/u.test(requested)) {
      return { content: '请回复“确认发送”以继续，或回复“取消”。在您确认前，内容不会发送给在线 AI。', provider: 'system', handled: true, needsConfirmation: true };
    }
    this.pendingOnlineAnalysis = null;
    if (typeof this.aiRouter?.onlineChat !== 'function') {
      return { content: '在线 AI 尚未配置或当前不可用，因此本次内容没有发送。请先在系统设置中配置在线 AI。', provider: 'system', handled: true };
    }
    return this.aiRouter.onlineChat([
      { role: 'system', content: '你是社区AI管理系统的在线分析助手。仅根据本次经管理员确认发送的文本进行分析；不得声称查询过系统数据库，不得索取或推测未提供的个人信息。' },
      { role: 'user', content: pending.payload },
    ], { taskKind: 'confirmed-online-analysis' });
  }

  async memberDisableProposal(message) {
    const requested = text(message);
    if (/(?:删除|移除|注销)(?:账号|成员)/u.test(requested)) {
      return { content: '为保证账号权限可恢复，AI 助理不执行硬删除账号。请改用“停用成员：手机号=13800000000”；停用后可在 AI 助理记录中手动恢复。', provider: 'system', handled: true, needsConfirmation: true };
    }
    const phone = requested.match(/(?:停用|禁用)(?:单位)?成员[：:]?\s*(?:手机号)?\s*[=：:]?\s*(1\d{10})/u)?.[1] || '';
    if (!phone) return null;
    if (typeof this.authService?.listUnitMembers !== 'function' || typeof this.authService?.updateMemberStatus !== 'function') {
      return { content: '当前账号服务不支持成员停用。请在单位成员管理中处理，AI 助理不会绕过既有权限。', provider: 'system', handled: true, needsConfirmation: true };
    }
    try {
      const members = await this.authService.listUnitMembers();
      const member = (Array.isArray(members) ? members : []).find((item) => text(item?.phone) === phone);
      if (!member) return { content: `未找到手机号为“${phone}”的单位成员。请核对后重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
      if (member.isActive !== true) return { content: `成员“${text(member.name) || phone}”当前已经处于停用状态，无需重复操作。`, provider: 'system', handled: true };
      const action = this.queueControlledAction({
        type: 'unit_member_disable', riskLevel: 'high', module: '账号权限', object: { id: text(member.id), name: text(member.name) || phone, phone },
        summary: `将停用单位成员“${text(member.name) || phone}”（${phone}）的登录权限。该账号和历史数据不会删除，可在 AI 助理记录中手动恢复`,
        before: { isActive: true, phone, observedAt: this.now().toISOString() }, after: { isActive: false }, proposedAt: this.now().toISOString(),
      });
      return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
    } catch (error) {
      return { content: `暂时无法核对单位成员：${text(error.message) || '账号服务不可用'}。为避免误操作，本次不会停用任何账号。`, provider: 'system', handled: true, needsConfirmation: true };
    }
  }

  queueControlledAction(draft) {
    const tool = writeToolForAction(this.writeToolRegistry, draft.type);
    if (!tool) throw new Error(`写操作“${text(draft.type)}”尚未登记到统一工具中心`);
    const riskLevel = tool.riskLevel === 'R2' ? 'high' : 'normal';
    this.pendingAction = {
      id: draft.id || `ai-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...draft,
      riskLevel,
      riskCode: tool.riskLevel,
      toolId: tool.id,
      toolName: tool.name,
      permission: tool.permission ? { ...tool.permission } : null,
      confirmationsRequired: tool.confirmationCount,
      confirmationStep: 0,
      confirmationHistory: [],
      proposedAt: draft.proposedAt || this.now().toISOString(),
    };
    return this.pendingAction;
  }

  async authorizeControlledAction(action) {
    const tool = writeToolForAction(this.writeToolRegistry, action?.type);
    if (!tool) return { allowed: false, reason: '该写操作尚未登记，系统已阻止执行', checkedAt: this.now().toISOString() };
    const base = { toolId: tool.id, permission: tool.permission ? { ...tool.permission } : null, checkedAt: this.now().toISOString() };
    if (typeof this.authService?.getStatus !== 'function') return { ...base, allowed: true, source: 'local-compatible' };
    let status;
    try { status = await this.authService.getStatus(); }
    catch { return { ...base, allowed: false, reason: '暂时无法核对当前账号权限' }; }
    const account = status?.account;
    if (!status?.authenticated || !account) return { ...base, allowed: false, reason: '请先登录后再执行系统修改' };
    if (account.isOwner === true || account.role !== 'member') return { ...base, allowed: true, source: 'administrator-role' };
    const required = tool.permission;
    const permissions = account.permissions && typeof account.permissions === 'object' ? account.permissions : {};
    const allowed = [...(permissions[required?.module] || []), ...(permissions.workspace || [])];
    if (required && allowed.includes(required.action)) return { ...base, allowed: true, source: 'member-permission' };
    return { ...base, allowed: false, reason: `当前账号没有“${tool.name}”所需权限` };
  }

  actionTaskDraft(action, originalRequest = '') {
    return {
      id: action.taskId || `ai-write-task-${action.id}`,
      conversationId: text(action.conversationId),
      title: action.toolName || 'AI 修改任务',
      originalRequest: text(originalRequest || action.originalRequest),
      status: 'waiting-confirmation',
      steps: [{
        id: action.stepId || 'step-confirm-and-execute',
        title: action.toolName || '核对并执行修改',
        toolId: action.toolId || '',
        status: 'waiting-confirmation',
        resultSummary: action.confirmationsRequired === 2 ? '等待两次确认' : '等待确认',
      }],
      summary: action.summary || this.actionPreview(action),
      pendingAction: structuredClone(action),
      permissionDecision: structuredClone(action.permissionDecision || null),
      operationId: '',
      verification: null,
    };
  }

  async saveActionTask(action, updates = {}) {
    if (!text(action?.conversationId) || !text(action?.taskId)) return null;
    const existing = await this.taskService.list({ conversationId: action.conversationId, limit: 30 })
      .then(tasks => tasks.find(task => task.id === action.taskId)).catch(() => null);
    const base = existing || this.actionTaskDraft(action, action.originalRequest);
    const next = { ...base, ...structuredClone(updates) };
    if (!Object.prototype.hasOwnProperty.call(updates, 'pendingAction')) next.pendingAction = structuredClone(action);
    return this.taskService.save(next);
  }

  async finalizeControlledProposal(proposal, { conversationId = '', originalRequest = '' } = {}) {
    const action = this.pendingAction;
    if (!proposal || !action) return proposal;
    const decision = await this.authorizeControlledAction(action);
    action.permissionDecision = decision;
    if (!decision.allowed) {
      this.pendingAction = null;
      return {
        content: `未建立修改任务：${decision.reason || '当前账号无权执行该操作'}。系统数据没有变化。`,
        provider: 'system', handled: true, needsConfirmation: false,
        aiTool: publicToolMetadata(writeToolForAction(this.writeToolRegistry, action.type)),
      };
    }
    action.conversationId = text(conversationId);
    action.originalRequest = text(originalRequest);
    action.taskId = action.conversationId ? `ai-write-task-${action.id}` : '';
    action.stepId = 'step-confirm-and-execute';
    let task = null;
    if (action.conversationId) {
      try { task = await this.taskService.save(this.actionTaskDraft(action, originalRequest)); }
      catch (error) {
        this.pendingAction = null;
        return { content: `暂时无法保存待确认任务：${text(error.message) || '任务服务不可用'}。为避免重启后丢失确认状态，本次不会执行修改。`, provider: 'system', handled: true };
      }
    }
    return {
      ...proposal,
      task,
      aiTool: publicToolMetadata(writeToolForAction(this.writeToolRegistry, action.type)),
      action: { ...(proposal.action || {}), toolId: action.toolId, riskCode: action.riskCode, permissionDecision: decision },
    };
  }

  actionPreview(action) {
    if (action.summary) {
      const confirmation = action.confirmationsRequired === 2
        ? '这是高风险操作。请先回复“继续执行”，我会再次展示最终确认；第二次回复“确认执行”后才会执行。'
        : '回复“确认”后执行；回复“取消”则不修改。';
      return `请确认操作：${action.summary}。${confirmation}`;
    }
    const target = `${action.personName || action.object?.name || '未指定对象'}${action.groupName ? `（${action.groupName}）` : ''}`;
    const fieldLabel = action.fieldLabel || '字段';
    const valueKey = action.valueKey || 'phone';
    const change = action.before?.[valueKey] !== undefined && action.after?.[valueKey] !== undefined
      ? `${fieldLabel}将从“${action.before[valueKey] || '未填写'}”改为“${action.after[valueKey] || '未填写'}”`
      : '将按已展示的范围执行该操作';
    const confirmation = action.confirmationsRequired === 2
      ? '这是高风险操作。请先回复“继续执行”，我会再次展示最终确认；第二次回复“确认执行”后才会执行。'
      : '回复“确认”后执行；回复“取消”则不修改。';
    return `请确认操作：${target}${change}。${confirmation}`;
  }

  currentYear() {
    return this.now().getFullYear();
  }

  resolveDutyDate(message) {
    const requested = text(message);
    const explicitDate = requested.match(/(?:19|20)\d{2}-\d{1,2}-\d{1,2}/u)?.[0];
    if (explicitDate) return localDate(`${explicitDate}T00:00:00`);
    if (/(今天|今日)/u.test(requested)) return localDate(this.now());
    if (/(明天|明日)/u.test(requested)) return localDate(new Date(this.now().getTime() + 24 * 60 * 60 * 1000));
    return '';
  }

  resolveYear(message) {
    return yearFrom(message)
      || (/(今年|本年|本年度|这年度|这一年)/u.test(text(message)) ? this.currentYear() : null);
  }

  resolveRecipient(database, message) {
    const requested = text(message);
    const people = (database.personnel || [])
      .map((person) => ({ id: personId(person), name: personName(person), groupName: personGroup(person) }))
      .filter((person) => person.name && requested.includes(person.name));
    const longestNameLength = Math.max(0, ...people.map((person) => person.name.length));
    const sameNamePeople = people.filter((person) => person.name.length === longestNameLength);
    const groupSpecified = sameNamePeople.filter((person) => person.groupName && requested.includes(person.groupName));
    const matchedPeople = groupSpecified.length ? groupSpecified : sameNamePeople;
    if (matchedPeople.length === 1) return { kind: 'resident', recipient: matchedPeople[0] };
    if (matchedPeople.length > 1) return { kind: 'ambiguous', candidates: matchedPeople };

    const known = this.collectRecipients(database)
      .filter((recipient) => requested.includes(recipient.name));
    const longestKnownName = Math.max(0, ...known.map((recipient) => recipient.name.length));
    const matchedKnown = known.filter((recipient) => recipient.name.length === longestKnownName);
    if (matchedKnown.length === 1) return { kind: 'temporary', recipient: matchedKnown[0] };
    if (matchedKnown.length > 1) return { kind: 'ambiguous', candidates: matchedKnown };
    return { kind: 'missing' };
  }

  collectRecipients(database) {
    const recipients = [];
    const add = (item) => {
      const name = text(item?.name);
      if (!name) return;
      recipients.push({ id: text(item?.personId), name, groupName: text(item?.groupName) });
    };
    for (const batch of database.disbursementBatches || []) for (const item of batch.items || []) add(item);
    for (const batch of database.contractFeeBatches || []) for (const item of batch.items || []) add(item);
    const distinct = new Map();
    for (const recipient of recipients) {
      const key = `${recipient.id}|${recipient.name}|${recipient.groupName}`;
      distinct.set(key, recipient);
    }
    return [...distinct.values()];
  }

  collectAnnualPayments(database, recipient, year) {
    return this.collectPaidPayments(database, { recipient, year });
  }

  groupForPayment(database, item) {
    const directGroup = text(item?.groupName || item?.group_name || item?.villageGroup || item?.village_group);
    if (directGroup) return directGroup;
    const related = (database.personnel || []).find((person) => personId(person) && personId(person) === text(item?.personId));
    return personGroup(related);
  }

  collectPaidPayments(database, { recipient = null, year = null, groupName = '', categoryName = '' } = {}) {
    const records = [];
    const sameRecipient = (item) => !recipient || (recipient.id
      ? text(item?.personId) === recipient.id
      : text(item?.name) === recipient.name && this.groupForPayment(database, item) === recipient.groupName);
    const append = ({ batch, item, source, amountCents }) => {
      const recordYear = paymentYear(item, batch);
      const recordGroup = this.groupForPayment(database, item);
      const recordCategory = text(batch.categoryName || batch.contractName || source);
      if (item?.paymentStatus !== 'paid' || !sameRecipient(item)) return;
      if (year && recordYear !== year) return;
      if (groupName && recordGroup !== groupName) return;
      if (categoryName && recordCategory !== categoryName) return;
      records.push({
        source,
        categoryName: recordCategory,
        amountCents: cents(amountCents),
        date: text(item.paidAt || batch.completedAt || batch.batchDate || batch.period),
        batchId: text(batch.id),
        groupName: recordGroup,
        recipientName: text(item.name),
        personId: text(item.personId),
      });
    };
    for (const batch of database.disbursementBatches || []) {
      for (const item of batch.items || []) append({ batch, item, source: '通用发放批次', amountCents: item.amountCents });
    }
    for (const batch of database.contractFeeBatches || []) {
      for (const item of batch.items || []) append({ batch, item, source: '合同发放批次', amountCents: item.finalAmountCents ?? item.amountCents });
    }
    return records;
  }

  collectUnpaidPayments(database, { recipient = null, year = null, groupName = '', categoryName = '' } = {}) {
    const records = [];
    const pendingStatuses = new Set(['pending', 'failed', 'unpaid']);
    const sameRecipient = (item) => !recipient || (recipient.id
      ? text(item?.personId) === recipient.id
      : text(item?.name) === recipient.name && this.groupForPayment(database, item) === recipient.groupName);
    const append = ({ batch, item, source, amountCents }) => {
      const recordYear = plannedPaymentYear(item, batch);
      const recordGroup = this.groupForPayment(database, item);
      const recordCategory = text(batch.categoryName || batch.contractName || source);
      if (!pendingStatuses.has(text(item?.paymentStatus)) || !sameRecipient(item)) return;
      if (year && recordYear !== year) return;
      if (groupName && recordGroup !== groupName) return;
      if (categoryName && recordCategory !== categoryName) return;
      records.push({
        source,
        categoryName: recordCategory,
        amountCents: cents(amountCents),
        status: text(item.paymentStatus),
        date: text(batch.batchDate || batch.period || batch.createdAt),
        batchId: text(batch.id),
        groupName: recordGroup,
        recipientName: text(item.name),
        personId: text(item.personId),
      });
    };
    for (const batch of database.disbursementBatches || []) {
      for (const item of batch.items || []) append({ batch, item, source: '通用发放批次', amountCents: item.amountCents });
    }
    for (const batch of database.contractFeeBatches || []) {
      for (const item of batch.items || []) append({ batch, item, source: '合同发放批次', amountCents: item.finalAmountCents ?? item.amountCents });
    }
    return records;
  }

  knownGroups(database) {
    const groups = new Set((database.personnel || []).map(personGroup).filter(Boolean));
    for (const record of this.collectPaidPayments(database)) if (record.groupName) groups.add(record.groupName);
    return [...groups].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }

  specifiedGroup(database, message) {
    const matches = this.knownGroups(database).filter((groupName) => text(message).includes(groupName));
    return matches.length === 1 ? matches[0] : null;
  }

  specifiedCategory(database, message) {
    const categories = new Set();
    for (const batch of database.disbursementBatches || []) if (text(batch.categoryName)) categories.add(text(batch.categoryName));
    for (const batch of database.contractFeeBatches || []) if (text(batch.contractName)) categories.add(text(batch.contractName));
    for (const category of database.disbursementCategories || []) if (text(category.name)) categories.add(text(category.name));
    const matches = [...categories].filter((name) => text(message).includes(name));
    return matches.length === 1 ? matches[0] : null;
  }

  formatAggregateAnswer({ year, allYears = false, records, subject, scope }) {
    const period = paymentPeriodLabel(year, allYears);
    const total = records.reduce((sum, record) => sum + record.amountCents, 0);
    if (!records.length) return `${period}未查到${subject}已登记发放的资金记录。统计范围：${scope}，只统计状态为“已发放”的记录。`;
    const recipients = new Set(records.map((record) => record.personId || `${record.recipientName}|${record.groupName}`).filter(Boolean));
    return `${period}${subject}已登记发放共计 ${formatMoney(total)}，共 ${records.length} 笔，涉及 ${recipients.size} 人。统计范围：${scope}，只统计状态为“已发放”的记录。`;
  }

  formatHighestGroupAnswer(year, records, { allYears = false } = {}) {
    const period = paymentPeriodLabel(year, allYears);
    const totals = new Map();
    for (const record of records) {
      if (!record.groupName) continue;
      totals.set(record.groupName, (totals.get(record.groupName) || 0) + record.amountCents);
    }
    if (!totals.size) return `${period}已发放记录中没有可识别的村民组，暂时无法比较哪个组发放最多。`;
    const sorted = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'));
    const [groupName, amount] = sorted[0];
    return `${period}已登记发放金额最高的是${groupName}，共 ${formatMoney(amount)}。统计范围：通用发放批次和合同发放批次中状态为“已发放”的记录。`;
  }

  formatPendingFundingAnswer({ year, allYears = false, records, subject, scope }) {
    const period = paymentPeriodLabel(year, allYears);
    const total = records.reduce((sum, record) => sum + record.amountCents, 0);
    const labels = { pending: '待发放', failed: '发放失败', unpaid: '本次未发放' };
    const byStatus = new Map();
    for (const record of records) byStatus.set(record.status, (byStatus.get(record.status) || 0) + 1);
    const statusText = [...byStatus.entries()].map(([status, count]) => `${labels[status] || status}${count}笔`).join('、');
    const fixedScope = '仅统计状态为“待发放”“发放失败”“本次未发放”的明细，不包含未知状态或已发放记录';
    if (!records.length) return `${period}未查到${subject}尚未登记为“已发放”的资金明细。统计范围：${scope}，${fixedScope}。`;
    return `${period}${subject}尚未登记为“已发放”的资金共 ${formatMoney(total)}，共 ${records.length} 笔（${statusText}）。统计范围：${scope}，${fixedScope}。`;
  }

  answerModuleCount(database, message) {
    if (!isCountQuestion(message)) return null;
    const value = text(message);
    const counters = [
      { pattern: /(村民|居民|人员)/u, label: '村民档案', items: database.personnel },
      { pattern: /党员/u, label: '党员档案', items: database.partyMembers },
      { pattern: /(民情|走访)/u, label: '民情记录', items: database.visitRecords },
      { pattern: /值班/u, label: '值班排班日期', items: Object.keys(dutySchedule(database)) },
      { pattern: /(财务|收支)/u, label: '财务收支记录', items: database.finances },
      { pattern: /(土地|地块|确权)/u, label: '土地确权记录', items: database.landParcel?.length ? database.landParcel : database.lands },
      { pattern: /合同/u, label: '资源合同', items: database.resourceContracts },
      { pattern: /(工作事项|工作任务|工作管理)/u, label: '工作事项', items: database.workItems },
      { pattern: /(电子档案|档案柜)/u, label: '电子档案', items: database.documents },
      { pattern: /证明/u, label: '证明记录', items: database.certificates },
    ];
    const matched = counters.find((counter) => counter.pattern.test(value));
    if (!matched) return null;
    const count = Array.isArray(matched.items) ? matched.items.length : 0;
    return {
      content: `当前系统共有 ${count} 条${matched.label}。统计口径：${matched.label}台账中的全部记录，未按年份或状态筛选。`,
      provider: 'system', handled: true, data: { module: matched.label, count },
    };
  }

  subsidyLedgerNotice(database, recipient, year) {
    const found = (database.farmlandSubsidyLedgers || []).some((ledger) => (!year || yearFrom(ledger.year) === year) && (ledger.records || []).some((record) => (
      recipient.id ? text(record.personId) === recipient.id : text(record.name) === recipient.name && text(record.groupName) === recipient.groupName
    )));
    return found ? '地力补贴台账目前没有“已发放”状态，因此未计入本次实发合计。' : '';
  }

  formatAnnualAnswer({ recipient, records, year, allYears = false, subsidyNotice }) {
    const period = paymentPeriodLabel(year, allYears);
    const total = records.reduce((sum, record) => sum + record.amountCents, 0);
    if (!records.length) {
      return `${period}未查到“${recipient.name}”已登记发放的资金记录。${subsidyNotice || '只统计状态为“已发放”的记录。'}`;
    }
    const categories = new Map();
    for (const record of records) categories.set(record.categoryName, (categories.get(record.categoryName) || 0) + 1);
    const sourceText = [...categories.entries()].map(([name, count]) => `${name}${count}笔`).join('、');
    return `${period}“${recipient.name}”已登记发放共计 ${formatMoney(total)}，共 ${records.length} 笔（${sourceText}）。统计范围：通用发放批次和合同发放批次，按实际登记的发放日期计入。${subsidyNotice}`;
  }

  paymentStatusLabel(status) {
    return ({ paid: '已发放', pending: '待发放', unpaid: '本次未发放', failed: '发放失败' })[text(status)] || '待核对';
  }

  paymentEvidenceRecord(record) {
    return {
      source: record.source,
      batchId: record.batchId,
      categoryName: record.categoryName,
      amountCents: record.amountCents,
      status: text(record.status || 'paid'),
      statusLabel: this.paymentStatusLabel(record.status || 'paid'),
      date: record.date,
      groupName: record.groupName,
      recipientName: record.recipientName,
      sourceAction: {
        type: 'navigate',
        target: 'tab-contract-fees',
        label: '资金发放中心',
        evidenceSource: { source: record.source, batchId: record.batchId },
      },
    };
  }

  buildPaymentEvidence({ year, allYears = false, subject, scope, paidRecords = [], pendingRecords = [] }) {
    const byCategory = new Map();
    for (const record of paidRecords) {
      const current = byCategory.get(record.categoryName) || { name: record.categoryName, amountCents: 0, count: 0 };
      current.amountCents += record.amountCents;
      current.count += 1;
      byCategory.set(record.categoryName, current);
    }
    const pendingByStatus = new Map();
    for (const record of pendingRecords) {
      const current = pendingByStatus.get(record.status) || { status: record.status, amountCents: 0, count: 0 };
      current.amountCents += record.amountCents;
      current.count += 1;
      pendingByStatus.set(record.status, current);
    }
    const pendingTotalCents = pendingRecords.reduce((total, record) => total + record.amountCents, 0);
    const paidTotalCents = paidRecords.reduce((total, record) => total + record.amountCents, 0);
    const alerts = [...pendingByStatus.values()].map((item) => ({
      type: item.status,
      label: this.paymentStatusLabel(item.status),
      count: item.count,
      amountCents: item.amountCents,
    }));
    return {
      kind: 'payment-evidence',
      title: `${paymentPeriodLabel(year, allYears)}${subject}资金发放核对`,
      year,
      period: allYears ? 'all' : 'year',
      subject,
      scope,
      paidTotalCents,
      paidCount: paidRecords.length,
      categorySummary: [...byCategory.values()].sort((left, right) => right.amountCents - left.amountCents || left.name.localeCompare(right.name, 'zh-CN')),
      alerts,
      pendingTotalCents,
      empty: paidRecords.length === 0,
      emptyMessage: pendingRecords.length
        ? `未查到已发放记录；另有 ${pendingRecords.length} 笔尚未计入实发合计，请查看待处理明细。`
        : '未查到符合统计范围的发放记录。',
      records: [...paidRecords, ...pendingRecords].map((record) => this.paymentEvidenceRecord(record)),
    };
  }

  buildRecordEvidence({ title, scope, metricLabel, metricValue, summary = [], records = [], emptyMessage = '' }) {
    return {
      kind: 'record-evidence',
      title,
      scope,
      metricLabel,
      metricValue,
      summary,
      records,
      empty: records.length === 0,
      emptyMessage: emptyMessage || '未查到符合统计范围的记录。',
    };
  }

  navigationEvidenceRecord({ title, meta = '', value = '', target, label, source = '', filters = null, recordSource = null }) {
    return {
      title,
      meta,
      value,
      sourceAction: { type: 'navigate', target, label, source, filters, recordSource },
    };
  }

  phoneUpdateProposal(database, message) {
    const requested = text(message);
    // “停用成员：手机号=…”属于账号权限操作，不能误判为居民电话修改。
    if (/(?:停用|禁用)(?:单位)?成员/u.test(requested)) return null;
    const requestedPhone = requested.match(/(?:电话|手机(?:号)?).{0,12}?(?:改成|修改为|换成|更新为)\s*(1\d{10})/u)?.[1]
      || requested.match(/(?:电话|手机(?:号)?)\s*[=:：]\s*(1\d{10})/u)?.[1];
    if (!requestedPhone) return null;
    const resolved = this.resolveRecipient(database, message);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要修改哪一位：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') return { content: '我没有识别出要修改电话的居民。请补充姓名；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    const person = (database.personnel || []).find((item) => personId(item) === resolved.recipient.id);
    const field = Object.prototype.hasOwnProperty.call(person || {}, 'phone') ? 'phone'
      : Object.prototype.hasOwnProperty.call(person || {}, 'mobile_phone') ? 'mobile_phone'
        : Object.prototype.hasOwnProperty.call(person || {}, 'mobilePhone') ? 'mobilePhone' : 'phone';
    const previousPhone = text(person?.[field]);
    if (previousPhone === requestedPhone) return { content: `${resolved.recipient.name}的手机号已经是 ${requestedPhone}，无需修改。`, provider: 'system', handled: true };
    const action = this.queueControlledAction({
      type: 'resident_phone_update',
      riskLevel: 'normal',
      personId: resolved.recipient.id,
      personName: resolved.recipient.name,
      groupName: resolved.recipient.groupName,
      field,
      fieldLabel: '手机号',
      valueKey: 'phone',
      before: { phone: previousPhone },
      after: { phone: requestedPhone },
      proposedAt: this.now().toISOString(),
    });
    return {
      content: this.actionPreview(action),
      provider: 'system', handled: true, needsConfirmation: true,
      action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after },
    };
  }

  addressUpdateProposal(database, message) {
    const requestedAddress = text(message).match(/(?:地址|住址|现住址).{0,12}?(?:改成|修改为|换成|更新为)\s*(.+)$/u)?.[1]?.replace(/[。！!]+$/u, '').trim();
    if (!requestedAddress) return null;
    const resolved = this.resolveRecipient(database, message);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要修改哪一位：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') return { content: '我没有识别出要修改住址的居民。请补充姓名；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    const person = (database.personnel || []).find((item) => personId(item) === resolved.recipient.id);
    const field = ['address', 'residence_address', 'residenceAddress', 'current_address'].find((key) => Object.prototype.hasOwnProperty.call(person || {}, key)) || 'address';
    const previousAddress = text(person?.[field]);
    if (previousAddress === requestedAddress) return { content: `${resolved.recipient.name}的住址已经是“${requestedAddress}”，无需修改。`, provider: 'system', handled: true };
    const action = this.queueControlledAction({
      type: 'resident_address_update', riskLevel: 'normal', personId: resolved.recipient.id, personName: resolved.recipient.name, groupName: resolved.recipient.groupName,
      field, fieldLabel: '住址', valueKey: 'address', before: { address: previousAddress }, after: { address: requestedAddress }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  groupUpdateProposal(database, message) {
    const requested = text(message);
    const targetGroup = requested.match(/(?:村民小组|村民组|小组|组别).{0,12}?(?:改成|修改为|换成|更新为|调整为|设为)\s*([^，。；;\s]{1,30})/u)?.[1]
      || requested.match(/(?:转到|调到|调整到)\s*([^，。；;\s]{1,30}组)/u)?.[1];
    if (!targetGroup) return null;
    const people = (database.personnel || []).map((person) => ({
      person, id: personId(person), name: personName(person), groupName: personGroup(person),
    })).filter((item) => item.name && requested.includes(item.name));
    const longestName = Math.max(0, ...people.map((item) => item.name.length));
    let candidates = people.filter((item) => item.name.length === longestName);
    const sourceGroup = requested.match(/从\s*([^，。；;\s转调]{1,30}组)\s*(?:转到|调到|调整到)/u)?.[1]
      || requested.match(/原(?:来)?(?:村民小组|村民组|小组|组别)?[：:\s]*([^，。；;\s]{1,30}组)/u)?.[1];
    if (sourceGroup) candidates = candidates.filter((item) => item.groupName === sourceGroup);
    if (!candidates.length) return { content: sourceGroup ? `未找到“${sourceGroup}”中的目标居民。请核对姓名和原村民组后重新说明。` : '我没有识别出要调整村民组的居民。请补充姓名。', provider: 'system', handled: true, needsConfirmation: true };
    if (candidates.length > 1) {
      const choices = candidates.map((item) => `${item.name}${item.groupName ? `（${item.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请补充原村民组后再调整。示例：“把某位居民从一组转到二组”，请将姓名替换为档案中的真实姓名。候选：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    const person = candidates[0];
    const field = ['village_group', 'villageGroup', 'group', 'group_name'].find((key) => Object.prototype.hasOwnProperty.call(person.person, key)) || 'village_group';
    const previousGroup = text(person.person[field]);
    if (previousGroup === targetGroup) return { content: `${person.name}当前已经在“${targetGroup}”，无需调整。`, provider: 'system', handled: true };
    const action = this.queueControlledAction({
      type: 'resident_group_update', riskLevel: 'normal', module: '居民一户一档', personId: person.id, personName: person.name, groupName: previousGroup,
      field, fieldLabel: '村民组', valueKey: 'group', before: { group: previousGroup }, after: { group: targetGroup }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  landParcelCreateProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:新建|新增|登记)(?:一块)?(?:地块|土地|确权记录)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const name = fields.地块名称 || fields.名称 || '';
    const code = fields.地块编号 || fields.编号 || '';
    const landType = fields.地块类型 || fields.类型 || '';
    const areaInput = fields.面积 || fields.面积亩 || fields.亩数 || '';
    const contractorName = fields.承包人 || fields.使用人 || '';
    const groupName = fields.村民组 || fields.村民小组 || fields.组别 || '';
    const area = Number(areaInput.replace(/[亩,，\s]/gu, ''));
    const missing = [];
    if (!name) missing.push('地块名称');
    if (!landType) missing.push('地块类型');
    if (!areaInput) missing.push('面积');
    if (!contractorName) missing.push('承包人/使用人');
    if (areaInput && (!Number.isFinite(area) || area <= 0)) missing.push('规范面积（正数，单位亩）');
    if (missing.length) return { content: `登记地块还缺少：${[...new Set(missing)].join('、')}。虚构示例：“新增地块：名称=示例地块；编号=DK-001；类型=水田；面积=12.5；承包人=示例居民甲；村民组=一组”。请改用真实资料补充，我不会自行补填。`, provider: 'system', handled: true, needsConfirmation: true };
    if (code && (database.landParcel || []).some((item) => text(item.parcel_code || item.parcelCode || item.code) === code)) return { content: `地块编号“${code}”已存在。请核对后重新提交，避免重复建档。`, provider: 'system', handled: true, needsConfirmation: true };
    const people = (database.personnel || []).map((person) => ({ id: personId(person), name: personName(person), groupName: personGroup(person) }))
      .filter((person) => person.name === contractorName);
    const matchingPeople = groupName ? people.filter((person) => person.groupName === groupName) : people;
    if (people.length && !matchingPeople.length) return { content: `未找到“${groupName}”中的承包人“${contractorName}”。请核对村民组；如该使用人不在居民档案中，请明确填写“承包人=集体”等名称。`, provider: 'system', handled: true, needsConfirmation: true };
    if (matchingPeople.length > 1) return { content: `系统中有多位承包人“${contractorName}”，请补充村民组后重新说明，我不会按同名人员自行关联。`, provider: 'system', handled: true, needsConfirmation: true };
    const contractor = matchingPeople[0] || null;
    const createdAt = this.now().toISOString();
    const record = {
      id: `ai-land-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      parcel_name: name, parcel_code: code, name, code, type: landType, land_type: landType,
      area, areaMu: area, contractor_name: contractorName, contractorName, contractorIds: contractor?.id ? [contractor.id] : [],
      village_group: groupName || contractor?.groupName || '', createdAt, updatedAt: createdAt, createdBy: 'AI 助理',
    };
    const action = this.queueControlledAction({
      type: 'land_parcel_create', riskLevel: 'normal', module: '土地承包确权', object: { id: record.id, name: record.parcel_name, code: record.parcel_code },
      summary: `将登记地块“${name}”${code ? `（${code}）` : ''}；类型：${landType}；面积：${area.toFixed(2)} 亩；承包人/使用人：${contractorName}`,
      before: {}, after: { record }, proposedAt: createdAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  visitCreateProposal(message) {
    const content = text(message).match(/(?:新增|登记|记录).{0,8}(?:民情|来访|走访).{0,4}[：:]\s*(.+)$/u)?.[1]?.replace(/[。！!]+$/u, '').trim();
    if (!content) return null;
    const visitorName = content.match(/^(.{1,12}?)(?:反映|来访|诉求)[：:，,\s]/u)?.[1] || '';
    const createdAt = this.now().toISOString();
    const record = {
      id: `ai-visit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: createdAt.slice(0, 10), type: 'visit', visitorName, category: '其他', content, responsiblePerson: '', status: '待处理', result: '', createdAt, updatedAt: createdAt,
    };
    const action = this.queueControlledAction({
      type: 'visit_record_create', riskLevel: 'normal', module: '民情记录', object: { id: record.id, name: visitorName || '未填写来访人' },
      summary: `将新增一条民情记录：${content}`, before: {}, after: { record }, proposedAt: createdAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  dutyScheduleProposal(database, message) {
    const requested = text(message);
    if (!/(安排|新增|添加|排班).{0,20}值班|值班.{0,20}(安排|新增|添加|排班)/u.test(requested)) return null;
    const date = this.resolveDutyDate(requested);
    if (!date) return { content: '请明确值班日期。虚构示例：“安排示例居民甲在 2026-09-02 值班”，请替换为真实人员和日期。日期不明确时，我不会自行猜测。', provider: 'system', handled: true, needsConfirmation: true };
    const resolved = this.resolveRecipient(database, requested);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要安排哪一位值班：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') return { content: '我没有识别出要安排值班的人员。请补充系统中已登记的姓名；如有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    const schedule = database.dutyFlexible?.schedule;
    const beforeNames = Array.isArray(schedule?.[date]) ? [...schedule[date]] : [];
    if ((dutySchedule(database)[date] || []).includes(resolved.recipient.name)) return { content: `${resolved.recipient.name}已经在 ${date} 的值班安排中，无需重复添加。`, provider: 'system', handled: true };
    const afterNames = [...beforeNames, resolved.recipient.name];
    const action = this.queueControlledAction({
      type: 'duty_schedule_add', riskLevel: 'normal', module: '村里值班', object: { id: `${date}:${resolved.recipient.id}`, name: resolved.recipient.name, groupName: resolved.recipient.groupName },
      summary: `将安排${resolved.recipient.name}${resolved.recipient.groupName ? `（${resolved.recipient.groupName}）` : ''}在 ${date} 值班`,
      before: { date, names: beforeNames }, after: { date, names: afterNames }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  workCreateProposal(message) {
    const requested = text(message);
    const body = requested.match(/(?:新建|新增|创建)(?:一项)?(?:工作事项|工作任务|工作)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (!matched) continue;
      fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const value = {
      name: fields.工作名称 || fields.名称 || '',
      type: fields.工作类型 || fields.类型 || '',
      location: fields.工作地点 || fields.地点 || '',
      responsiblePerson: fields.责任人 || '',
      startDate: fields.开始日期 || '',
      plannedEndDate: fields.计划完成日期 || fields.计划结束日期 || '',
      participants: fields.参与人员 || '',
      description: fields.工作说明 || fields.说明 || '',
    };
    const required = [['name', '工作名称'], ['type', '工作类型'], ['location', '工作地点'], ['responsiblePerson', '责任人'], ['startDate', '开始日期']]
      .filter(([key]) => !value[key]).map(([, label]) => label);
    const types = ['环境卫生', '农田水利', '道路交通', '巡查检查', '物业服务', '矛盾纠纷', '其他'];
    if (value.type && !types.includes(value.type)) return { content: `工作类型“${value.type}”不在当前可选范围内。请从以下类型中选择：${types.join('、')}。`, provider: 'system', handled: true, needsConfirmation: true };
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value.startDate) || (value.plannedEndDate && !/^\d{4}-\d{2}-\d{2}$/u.test(value.plannedEndDate))) required.push('规范日期（YYYY-MM-DD）');
    if (value.plannedEndDate && value.startDate && value.plannedEndDate < value.startDate) return { content: '计划完成日期不能早于开始日期。请核对日期后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
    if (required.length) return { content: `新建工作还缺少：${[...new Set(required)].join('、')}。请按“新建工作：名称=…；类型=…；地点=…；责任人=…；开始日期=YYYY-MM-DD”补充，我不会自行补填。`, provider: 'system', handled: true, needsConfirmation: true };
    const createdAt = this.now().toISOString();
    const record = { id: `ai-work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...value, status: '未开始', createdAt, updatedAt: createdAt, createdBy: 'AI 助理' };
    const action = this.queueControlledAction({
      type: 'work_item_create', riskLevel: 'normal', module: '工作管理', object: { id: record.id, name: record.name },
      summary: `将新建工作“${record.name}”，类型：${record.type}；地点：${record.location}；责任人：${record.responsiblePerson}；开始日期：${record.startDate}`,
      before: {}, after: { record }, proposedAt: createdAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  workStatusUpdateProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:更新|修改|调整)工作状态[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const name = fields.名称 || fields.工作名称 || '';
    const number = fields.编号 || fields.工作编号 || '';
    const targetStatus = fields.状态 || fields.工作状态 || '';
    if ((!name && !number) || !targetStatus) return { content: '更新工作状态需要工作名称或唯一编号，以及状态。请按“更新工作状态：编号=GZ-001；状态=进行中”补充，我不会按相似名称或未知状态修改。', provider: 'system', handled: true, needsConfirmation: true };
    if (!['未开始', '进行中', '已完成', '已归档'].includes(targetStatus)) return { content: '工作状态只能是“未开始、进行中、已完成、已归档”。请核对后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
    const works = (database.workItems || []).filter((item) => !item.deletedAt && (!name || text(item.name) === name) && (!number || text(item.number) === number));
    const reference = number ? `编号为“${number}”` : `名称为“${name}”`;
    if (!works.length) return { content: `未找到${reference}且未删除的工作事项。请核对后重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
    if (works.length > 1) return { content: `找到 ${works.length} 项匹配工作。请补充唯一工作编号后再操作，避免误改。`, provider: 'system', handled: true, needsConfirmation: true };
    const work = works[0];
    const previousStatus = text(work.status) || '未开始';
    if (previousStatus === targetStatus) return { content: `工作“${name}”当前已经是“${targetStatus}”，无需修改。`, provider: 'system', handled: true };
    if (!['未开始', '进行中'].includes(previousStatus) || !['未开始', '进行中'].includes(targetStatus)) {
      return { content: `工作“${name}”当前为“${previousStatus}”。“已完成”需要先登记验收结论，“已归档”只能在完成后办理；请在工作管理页面补齐验收资料后再操作，AI 不会绕过该规则。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    const updatedAt = this.now().toISOString();
    const action = this.queueControlledAction({
      type: 'work_item_status_update', riskLevel: 'normal', module: '工作管理', object: { id: text(work.id), name: text(work.name), number: text(work.number) },
      field: 'status', fieldLabel: '工作状态', valueKey: 'status',
      summary: `将工作“${text(work.name)}”${text(work.number) ? `（${text(work.number)}）` : ''}的状态从“${previousStatus}”调整为“${targetStatus}”`,
      before: { status: previousStatus, updatedAt: text(work.updatedAt) }, after: { status: targetStatus, updatedAt }, proposedAt: updatedAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  certificateRecordDeleteProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:删除|移除)(?:证明(?:记录)?)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const code = fields.编号 || fields.记录编号 || fields.证明编号 || '';
    if (!code) return { content: '删除证明记录必须提供唯一证明编号，例如“删除证明记录：编号=CERT-001”。为防止误删，我不会按姓名或证明类型删除。', provider: 'system', handled: true, needsConfirmation: true };
    const matches = (database.certificates || []).filter((item) => certificateCode(item) === code);
    if (!matches.length) return { content: `未找到编号为“${code}”的证明记录。请核对编号后重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
    if (matches.length > 1) return { content: `编号“${code}”对应多条证明记录，台账数据异常。请先进入证明开具页面人工核对，AI 不会删除。`, provider: 'system', handled: true, needsConfirmation: true };
    const record = matches[0];
    const action = this.queueControlledAction({
      type: 'certificate_record_delete', riskLevel: 'high', module: '证明开具',
      object: { id: text(record.id) || code, name: code, personName: text(record.personName || record.name), templateName: text(record.templateName || record.templateTitle) },
      summary: `将删除证明记录“${code}”${text(record.personName || record.name) ? `，开具对象：${text(record.personName || record.name)}` : ''}。删除后可在“AI 助理记录”中手动恢复`,
      before: { record: structuredClone(record) }, after: { record: structuredClone(record) }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  draftArchiveProposal(database, message) {
    const requested = text(message);
    if (!/归档/u.test(requested) || !/(公文|草稿|文稿|文档)/u.test(requested)) return null;
    const documents = (database.documentDrafts || []).filter((item) => text(item.title) && requested.includes(text(item.title)));
    const longestTitle = Math.max(0, ...documents.map((item) => text(item.title).length));
    const candidates = documents.filter((item) => text(item.title).length === longestTitle);
    if (!candidates.length) return { content: '请说明要归档的公文标题，例如“归档公文《环境整治工作报告》”。标题不明确时，我不会自行归档。', provider: 'system', handled: true, needsConfirmation: true };
    if (candidates.length > 1) return { content: `找到多份同名公文，请补充能区分的标题或先进入公文拟写页面核对：${candidates.map((item) => `“${text(item.title)}”`).join('、')}。`, provider: 'system', handled: true, needsConfirmation: true };
    const document = candidates[0];
    if (document.archivedAt) return { content: `“${text(document.title)}”已经归档，无需重复操作。`, provider: 'system', handled: true };
    const archivedAt = this.now().toISOString();
    const action = this.queueControlledAction({
      type: 'document_draft_archive', riskLevel: 'normal', module: '公文拟写', object: { id: text(document.id), name: text(document.title) },
      summary: `将归档公文“${text(document.title)}”`,
      before: { archivedAt: text(document.archivedAt), updatedAt: text(document.updatedAt), currentVersionId: text(document.currentVersionId) },
      after: { archivedAt, updatedAt: archivedAt, currentVersionId: text(document.currentVersionId) }, proposedAt: archivedAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  partyStageUpdateProposal(database, message) {
    const requested = text(message);
    const stages = ['正式党员', '预备党员', '入党积极分子', '积极分子', '发展对象'];
    const targetStage = stages.find((stage) => new RegExp(`(?:改为|调整为|更新为|设为|转为|转成)\\s*${stage}`, 'u').test(requested));
    if (!targetStage) return null;
    const members = (database.partyMembers || []).map((item) => ({
      item,
      id: text(item.id || item.personId || item.person_id || item.idCard || item.id_card),
      name: text(item.name || item.member_name || item.person_name),
      groupName: text(item.village_group || item.villageGroup || item.group || item.group_name),
    })).filter((item) => item.name && requested.includes(item.name));
    const longestName = Math.max(0, ...members.map((item) => item.name.length));
    const candidates = members.filter((item) => item.name.length === longestName);
    const groupMatches = candidates.filter((item) => item.groupName && requested.includes(item.groupName));
    const matched = groupMatches.length ? groupMatches : candidates;
    if (!matched.length) return { content: '我没有识别出要调整党员阶段的姓名。请补充姓名；如有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    if (matched.length > 1) return { content: `系统中有多位同名党员，请确认要调整哪一位：${matched.map((item) => `${item.name}${item.groupName ? `（${item.groupName}）` : ''}`).join('、')}。`, provider: 'system', handled: true, needsConfirmation: true };
    const member = matched[0];
    const field = ['stage', 'party_stage', 'partyStage', 'developmentStage', 'development_stage'].find((key) => Object.prototype.hasOwnProperty.call(member.item, key)) || 'stage';
    const previousStage = text(member.item[field]);
    if (previousStage === targetStage) return { content: `${member.name}的党员阶段已经是“${targetStage}”，无需调整。`, provider: 'system', handled: true };
    const action = this.queueControlledAction({
      type: 'party_member_stage_update', riskLevel: 'normal', module: '党员管理', object: { id: member.id, name: member.name, groupName: member.groupName },
      field, fieldLabel: '党员阶段', valueKey: 'stage', before: { stage: previousStage }, after: { stage: targetStage }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  contractCreateProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:新建|新增|创建)(?:一份)?合同[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const value = {
      name: fields.合同名称 || fields.名称 || '', contractNumber: fields.合同编号 || fields.编号 || '',
      contractorName: fields.承包人 || fields.缴费方 || '', resourceType: fields.资源类型 || '',
      amount: fields.合同金额 || fields.金额 || '', startDate: fields.合同开始日期 || fields.开始日期 || '',
      endDate: fields.合同结束日期 || fields.结束日期 || '', notes: fields.备注 || fields.说明 || '',
    };
    const required = [['name', '合同名称'], ['contractorName', '承包人/缴费方'], ['resourceType', '资源类型'], ['amount', '合同金额'], ['startDate', '开始日期'], ['endDate', '结束日期']]
      .filter(([key]) => !value[key]).map(([, label]) => label);
    const amountCents = yuanToCents(value.amount);
    if (value.amount && amountCents === null) required.push('规范合同金额（元，最多两位小数）');
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value.startDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(value.endDate)) required.push('规范日期（YYYY-MM-DD）');
    if (value.startDate && value.endDate && value.endDate < value.startDate) return { content: '合同结束日期不能早于开始日期。请核对后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
    if (required.length) return { content: `新建合同还缺少：${[...new Set(required)].join('、')}。请按“新建合同：名称=…；承包人=…；资源类型=土地；金额=…；开始日期=YYYY-MM-DD；结束日期=YYYY-MM-DD”补充，我不会自行补填。`, provider: 'system', handled: true, needsConfirmation: true };
    if (value.contractNumber && (database.resourceContracts || []).some((item) => text(item.contractNumber) === value.contractNumber)) return { content: `合同编号“${value.contractNumber}”已存在。请核对编号后重新提交，避免重复建档。`, provider: 'system', handled: true, needsConfirmation: true };
    const createdAt = this.now().toISOString();
    const record = {
      id: `ai-contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: value.name, contractNumber: value.contractNumber, contractorName: value.contractorName, resourceType: value.resourceType,
      amountCents, startDate: value.startDate, endDate: value.endDate, landParcelIds: [], notes: value.notes, attachments: [], status: 'active', createdAt, updatedAt: createdAt,
    };
    const action = this.queueControlledAction({
      type: 'resource_contract_create', riskLevel: 'normal', module: '资金发放中心', object: { id: record.id, name: record.name },
      summary: `将新建合同“${record.name}”，承包人/缴费方：${record.contractorName}；合同金额：${formatMoney(record.amountCents)}；期限：${record.startDate} 至 ${record.endDate}`,
      before: {}, after: { record }, proposedAt: createdAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  contractReceiptCreateProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:登记|记录|新增)(?:承包人)?(?:缴费)?到账[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const contractReference = fields.合同 || fields.合同名称 || fields.合同编号 || '';
    const receivedDate = fields.到账日期 || fields.日期 || fields.实际到账日期 || '';
    const requestedAmount = fields.到账金额 || fields.金额 || '';
    if (!contractReference || !receivedDate) return { content: '登记到账还缺少合同和到账日期。请按“登记到账：合同=…；日期=YYYY-MM-DD”补充，我不会自行匹配合同或日期。', provider: 'system', handled: true, needsConfirmation: true };
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(receivedDate)) return { content: '到账日期必须为 YYYY-MM-DD 格式。请核对后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
    const candidates = (database.resourceContracts || []).filter((item) => [text(item.name), text(item.contractNumber)].includes(contractReference));
    if (!candidates.length) return { content: `未找到名称或编号为“${contractReference}”的合同。请核对后重新说明，我不会按相似名称自行匹配。`, provider: 'system', handled: true, needsConfirmation: true };
    if (candidates.length > 1) return { content: `有多份合同匹配“${contractReference}”，请使用唯一合同编号重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
    const contract = candidates[0];
    if ((database.contractFeeReceipts || []).some((item) => text(item.contractId) === text(contract.id))) return { content: `合同“${text(contract.name)}”已经登记过到账，不会重复创建。`, provider: 'system', handled: true };
    const amountCents = requestedAmount ? yuanToCents(requestedAmount) : cents(contract.amountCents);
    if (requestedAmount && amountCents === null) return { content: '到账金额格式不正确。请使用元并保留最多两位小数，或省略金额以使用合同应缴金额。', provider: 'system', handled: true, needsConfirmation: true };
    if (amountCents !== cents(contract.amountCents)) return { content: `该合同应缴金额为 ${formatMoney(contract.amountCents)}。系统不允许登记多缴或少缴，请核对后重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
    const createdAt = this.now().toISOString();
    const receipt = { id: `ai-contract-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, contractId: text(contract.id), amountCents, status: 'paid', receivedDate, createdAt };
    const action = this.queueControlledAction({
      type: 'contract_receipt_create', riskLevel: 'normal', module: '资金发放中心', object: { id: receipt.id, name: text(contract.name), contractId: text(contract.id) },
      summary: `将登记合同“${text(contract.name)}”承包人到账 ${formatMoney(amountCents)}，到账日期：${receivedDate}`,
      before: {}, after: { receipt }, proposedAt: createdAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  financeRecordCreateProposal(message) {
    const requested = text(message);
    const body = requested.match(/(?:新建|新增|登记)(?:财务)?(?:收支|收入|支出)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const requestedType = fields.类型 || fields.收支类型 || '';
    const type = /^(收入|income)$/iu.test(requestedType) ? 'income' : /^(支出|expense)$/iu.test(requestedType) ? 'expense' : '';
    const category = fields.分类 || fields.类别 || '';
    const summary = fields.摘要 || fields.事由 || fields.说明 || '';
    const amount = fields.金额 || fields.收支金额 || '';
    const date = fields.日期 || fields.发生日期 || fields.入账日期 || '';
    const handler = fields.经办人 || fields.经手人 || '';
    const voucherNumber = fields.凭证号 || fields.凭证编号 || '';
    const missing = [];
    if (!type) missing.push('类型（收入或支出）');
    if (!category) missing.push('分类');
    if (!summary) missing.push('摘要/事由');
    if (!amount) missing.push('金额');
    if (!date) missing.push('日期');
    const amountCents = yuanToCents(amount);
    if (amount && amountCents === null) missing.push('规范金额（元，最多两位小数）');
    if (date && !/^\d{4}-\d{2}-\d{2}$/u.test(date)) missing.push('规范日期（YYYY-MM-DD）');
    if (missing.length) return { content: `登记财务收支还缺少：${[...new Set(missing)].join('、')}。虚构示例：“新增财务收支：类型=收入；分类=集体经营收入；摘要=示例场地租金；金额=1200.50；日期=2026-09-01；经办人=示例居民甲；凭证号=P-001”。请改用真实资料补充，我不会自行补填。`, provider: 'system', handled: true, needsConfirmation: true };
    const createdAt = this.now().toISOString();
    const record = {
      id: `ai-finance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date, type, category, summary, amount: amountCents / 100, amountCents, handler, voucherNumber,
      attachments: [], createdAt, updatedAt: createdAt, createdBy: 'AI 助理',
    };
    const typeLabel = type === 'income' ? '收入' : '支出';
    const action = this.queueControlledAction({
      type: 'finance_record_create', riskLevel: 'normal', module: '财务收支', object: { id: record.id, name: summary, type },
      summary: `将登记一笔财务${typeLabel}：${summary}；分类：${category}；金额：${formatMoney(amountCents)}；日期：${date}`,
      before: {}, after: { record }, proposedAt: createdAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  financeRecordUpdateProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:修改|更新|调整)(?:财务)?(?:收支|记录)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const voucherNumber = fields.原凭证号 || fields.凭证号 || fields.凭证编号 || '';
    if (!voucherNumber) return { content: '修改财务收支必须提供当前唯一凭证号，例如“修改财务收支：凭证号=P-001；金额=1200.50”。为防止误改，我不会只按摘要、日期或金额定位。', provider: 'system', handled: true, needsConfirmation: true };
    const candidates = (database.finances || []).filter((item) => financeVoucherNumber(item) === voucherNumber);
    if (!candidates.length) return { content: `未找到凭证号为“${voucherNumber}”的财务记录。请核对凭证号后重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
    if (candidates.length > 1) return { content: `凭证号“${voucherNumber}”匹配多笔财务记录，台账数据异常。请先进入财务收支页面人工核对，AI 不会修改。`, provider: 'system', handled: true, needsConfirmation: true };
    const beforeRecord = structuredClone(candidates[0]);
    const afterRecord = structuredClone(beforeRecord);
    const changes = [];
    const setValue = (label, key, value) => {
      if (!value || text(afterRecord[key]) === value) return;
      afterRecord[key] = value;
      changes.push(`${label}：“${text(beforeRecord[key]) || '未填写'}”→“${value}”`);
    };
    if (fields.分类 || fields.类别) setValue('分类', 'category', fields.分类 || fields.类别);
    if (fields.摘要 || fields.事由 || fields.说明) setValue('摘要', 'summary', fields.摘要 || fields.事由 || fields.说明);
    if (fields.经办人 || fields.经手人) setValue('经办人', 'handler', fields.经办人 || fields.经手人);
    if (fields.日期 || fields.发生日期 || fields.入账日期) {
      const date = fields.日期 || fields.发生日期 || fields.入账日期;
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return { content: '财务日期必须为 YYYY-MM-DD 格式。请核对后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
      setValue('日期', 'date', date);
    }
    if (fields.新凭证号 || fields.新凭证编号) {
      const nextVoucher = fields.新凭证号 || fields.新凭证编号;
      if ((database.finances || []).some((item) => item !== candidates[0] && financeVoucherNumber(item) === nextVoucher)) return { content: `新凭证号“${nextVoucher}”已被其他财务记录使用。请换用未使用的凭证号。`, provider: 'system', handled: true, needsConfirmation: true };
      setValue('凭证号', 'voucherNumber', nextVoucher);
    }
    if (fields.金额 || fields.收支金额) {
      const amountCents = yuanToCents(fields.金额 || fields.收支金额);
      if (amountCents === null) return { content: '财务金额格式不正确。请使用元并保留最多两位小数。', provider: 'system', handled: true, needsConfirmation: true };
      if (financeAmountCents(beforeRecord) !== amountCents) {
        afterRecord.amountCents = amountCents;
        afterRecord.amount = amountCents / 100;
        changes.push(`金额：${formatMoney(financeAmountCents(beforeRecord))}→${formatMoney(amountCents)}`);
      }
    }
    if (!changes.length) return { content: `凭证号“${voucherNumber}”没有可执行的变更。可修改分类、摘要、金额、日期、经办人或新凭证号。`, provider: 'system', handled: true };
    const updatedAt = this.now().toISOString();
    afterRecord.updatedAt = updatedAt;
    const action = this.queueControlledAction({
      type: 'finance_record_update', riskLevel: 'normal', module: '财务收支', object: { id: text(beforeRecord.id) || voucherNumber, name: text(afterRecord.summary) || voucherNumber, voucherNumber },
      summary: `将修改财务记录“${voucherNumber}”：${changes.join('；')}`,
      before: { record: beforeRecord }, after: { record: afterRecord }, proposedAt: updatedAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  financeRecordsClearProposal(database, message) {
    const requested = text(message);
    if (!/(?:清空|清除)(?:全部)?(?:财务(?:收支)?台账|财务记录|收支台账)/u.test(requested)) return null;
    const beforeRecords = structuredClone(database.finances || []);
    if (!beforeRecords.length) return { content: '财务收支台账当前没有记录，无需清空。', provider: 'system', handled: true };
    const action = this.queueControlledAction({
      type: 'finance_records_clear', riskLevel: 'high', module: '财务收支', object: { id: 'finances', name: '财务收支台账', count: beforeRecords.length },
      summary: `将清空财务收支台账中的 ${beforeRecords.length} 笔记录。完整快照会保存在 AI 助理记录中，可手动撤销；确认期间如台账发生变化，系统将拒绝执行`,
      before: { records: beforeRecords }, after: { records: [] }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  villageNameUpdateProposal(database, message) {
    const requestedName = text(message).match(/(?:社区名称|村名|村庄名称).{0,12}?(?:改成|修改为|设置为|换成)\s*(.+)$/u)?.[1]?.replace(/[。！!]+$/u, '').trim();
    if (!requestedName) return null;
    if (requestedName.length > 60) return { content: '社区名称不能超过 60 个字符。请精简后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
    const previousName = text(database.settings?.villageName);
    if (previousName === requestedName) return { content: `社区名称已经是“${requestedName}”，无需修改。`, provider: 'system', handled: true };
    const action = this.queueControlledAction({
      type: 'settings_village_name_update', riskLevel: 'normal', module: '系统设置', object: { id: 'settings:villageName', name: '社区名称' },
      field: 'villageName', fieldLabel: '社区名称', valueKey: 'villageName', before: { villageName: previousName }, after: { villageName: requestedName }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'normal', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  workDeleteProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/(?:删除|移除)(?:工作事项|工作任务|工作)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const fields = {};
    for (const item of body.split(/[；;\n]/u)) {
      const matched = item.trim().match(/^([^=：:]+)[=：:]\s*(.+)$/u);
      if (matched) fields[text(matched[1]).replaceAll(' ', '')] = text(matched[2]);
    }
    const name = fields.名称 || fields.工作名称 || (!Object.keys(fields).length ? body.replace(/[。！!]+$/u, '').trim() : '');
    const number = fields.编号 || fields.工作编号 || '';
    if (!name && !number) return { content: '删除工作需要工作名称或唯一编号。推荐按“删除工作：编号=GZ-001”说明，避免误删。', provider: 'system', handled: true, needsConfirmation: true };
    const works = (database.workItems || []).filter((item) => !item.deletedAt && (!name || text(item.name) === name) && (!number || text(item.number) === number));
    const reference = number ? `编号为“${number}”` : `名称为“${name}”`;
    if (!works.length) return { content: `未找到${reference}且未删除的工作事项。请核对后重新说明，我不会按相似名称删除。`, provider: 'system', handled: true, needsConfirmation: true };
    if (works.length > 1) return { content: `找到 ${works.length} 项匹配工作。请补充唯一工作编号后再操作，避免误删。`, provider: 'system', handled: true, needsConfirmation: true };
    const beforeRecord = structuredClone(works[0]);
    const deletedAt = this.now().toISOString();
    const afterRecord = { ...structuredClone(beforeRecord), deletedAt, updatedAt: deletedAt };
    const action = this.queueControlledAction({
      type: 'work_item_soft_delete', riskLevel: 'high', module: '工作管理', object: { id: text(beforeRecord.id), name: text(beforeRecord.name), number: text(beforeRecord.number) },
      summary: `将删除工作“${text(beforeRecord.name)}”${text(beforeRecord.number) ? `（${text(beforeRecord.number)}）` : ''}，该工作会进入可恢复区`,
      before: { record: beforeRecord }, after: { record: afterRecord }, proposedAt: deletedAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  workBatchDeleteProposal(database, message) {
    const requested = text(message);
    const body = requested.match(/批量(?:删除|移除)(?:工作事项|工作任务|工作)[：:]\s*(.+)$/u)?.[1];
    if (!body) return null;
    const numberText = body.match(/(?:编号|工作编号)[=：:]\s*(.+)$/u)?.[1] || '';
    if (!numberText) return { content: '批量删除工作必须列出工作编号，例如“批量删除工作：编号=GZ-001、GZ-002”。我不会按名称批量删除。', provider: 'system', handled: true, needsConfirmation: true };
    const numbers = numberText.split(/[、,，\s]+/u).map(text).filter(Boolean);
    if (numbers.length < 2) return { content: '批量删除至少需要两个不同的工作编号；如只删除一项，请使用“删除工作：编号=GZ-001”。', provider: 'system', handled: true, needsConfirmation: true };
    if (new Set(numbers).size !== numbers.length) return { content: '批量删除的工作编号中有重复项。请去掉重复编号后重新说明。', provider: 'system', handled: true, needsConfirmation: true };
    const active = (database.workItems || []).filter((item) => !item.deletedAt);
    const byNumber = new Map(active.map((item) => [text(item.number), item]));
    const missing = numbers.filter((number) => !byNumber.has(number));
    if (missing.length) return { content: `未找到或已删除以下工作编号：${missing.join('、')}。为避免只删一部分，本批操作不会执行；请核对后重新说明。`, provider: 'system', handled: true, needsConfirmation: true };
    const deletedAt = this.now().toISOString();
    const beforeRecords = numbers.map((number) => structuredClone(byNumber.get(number)));
    const afterRecords = beforeRecords.map((record) => ({ ...structuredClone(record), deletedAt, updatedAt: deletedAt }));
    const action = this.queueControlledAction({
      type: 'work_items_soft_delete_batch', riskLevel: 'high', module: '工作管理', object: { id: numbers.join(','), name: `${numbers.length} 项工作`, numbers },
      summary: `将批量删除 ${numbers.length} 项工作（${numbers.join('、')}），全部移入可恢复区`,
      before: { records: beforeRecords }, after: { records: afterRecords }, proposedAt: deletedAt,
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  answerDutyQuestion(database, message) {
    const requested = text(message);
    if (!/值班/u.test(requested) || !/(谁|哪些|人员|名单|轮到|值班表|安排|多少|几(?:个|人))/u.test(requested)) return null;
    if (/(安排|新增|添加|排班).{0,20}值班|值班.{0,20}(安排|新增|添加|排班)/u.test(requested)) return null;
    const date = this.resolveDutyDate(requested);
    if (!date) return { content: '请明确要查询哪一天的值班安排，例如“今天谁值班？”或“2026-09-02 谁值班？”。日期不明确时，我不会自行猜测。', provider: 'system', handled: true, needsConfirmation: true };
    const names = dutySchedule(database)[date];
    const dutyNames = Array.isArray(names) ? names : [];
    const evidence = this.buildRecordEvidence({
      title: `${date} 值班安排核对`, scope: '村里值班页面中该日期的当日排班台账',
      metricLabel: '已安排值班人员', metricValue: `${dutyNames.length} 人`,
      summary: [{ name: '排班日期', value: date }],
      records: dutyNames.map((name) => this.navigationEvidenceRecord({
        title: name, meta: date, value: '已安排值班', target: 'tab-duty', label: '村里值班', source: '当日排班台账', recordSource: { kind: 'duty', date },
      })),
      emptyMessage: `${date} 暂未安排值班人员。`,
    });
    if (!dutyNames.length) return { content: `${date} 暂未安排值班人员。查询范围：村里值班页面的当日排班台账。`, provider: 'system', handled: true, data: { date, names: [], queryEvidence: evidence } };
    if (/(多少|几(?:个|人))/u.test(requested)) return { content: `${date} 共安排 ${dutyNames.length} 名值班人员：${dutyNames.join('、')}。查询范围：村里值班页面的当日排班台账。`, provider: 'system', handled: true, data: { date, names: [...dutyNames], queryEvidence: evidence } };
    return { content: `${date} 的值班人员是：${dutyNames.join('、')}。查询范围：村里值班页面的当日排班台账。`, provider: 'system', handled: true, data: { date, names: [...dutyNames], queryEvidence: evidence } };
  }

  answerContractExpiryQuestion(database, message) {
    const requested = text(message);
    if (!/(合同.{0,12}到期|到期.{0,12}合同)/u.test(requested)) return null;
    const today = localDate(this.now());
    const explicitYear = requested.match(/(?:19|20)\d{2}\s*(?=年)/u)?.[0].trim();
    const futureDays = Number(requested.match(/(?:未来|近|接下来)\s*(\d{1,3})\s*天/u)?.[1] || 0);
    const expiredOnly = /已到期/u.test(requested);
    let scope = '';
    let matched;
    if (explicitYear || /(今年|本年|本年度)/u.test(requested)) {
      const year = explicitYear || String(this.currentYear());
      scope = `${year} 年合同期满`;
      matched = (database.resourceContracts || []).filter((item) => text(item.endDate).startsWith(`${year}-`));
    } else if (futureDays > 0) {
      const end = localDate(new Date(this.now().getTime() + futureDays * 24 * 60 * 60 * 1000));
      scope = `从 ${today} 起未来 ${futureDays} 天内期满`;
      matched = (database.resourceContracts || []).filter((item) => text(item.endDate) >= today && text(item.endDate) <= end);
    } else if (expiredOnly) {
      scope = `截至 ${today} 已期满`;
      matched = (database.resourceContracts || []).filter((item) => text(item.endDate) && text(item.endDate) < today);
    } else {
      return { content: '请说明合同到期的时间范围，例如“2026 年有哪些到期合同？”、“未来 90 天有哪些到期合同？”或“已到期合同有哪些？”。范围不明确时，我不会自行猜测。', provider: 'system', handled: true, needsConfirmation: true };
    }
    const contracts = matched.sort((left, right) => text(left.endDate).localeCompare(text(right.endDate)) || text(left.name).localeCompare(text(right.name), 'zh-CN'));
    const evidenceRecords = contracts.map((item) => this.navigationEvidenceRecord({
      title: text(item.name) || '未命名合同',
      meta: [text(item.contractNumber), `结束日期 ${text(item.endDate) || '未填写'}`].filter(Boolean).join(' · '),
      value: text(item.endDate) || '未填写', target: 'tab-contract-fees', label: '资金发放中心', source: '合同发放台账', recordSource: { kind: 'contract', id: item.id },
    }));
    const evidence = this.buildRecordEvidence({
      title: `${scope}合同核对`, scope: '资源合同台账中的合同结束日期', metricLabel: '符合条件的合同', metricValue: `${contracts.length} 份`, records: evidenceRecords,
      emptyMessage: `未查到${scope}的资源合同。`,
    });
    if (!contracts.length) return { content: `未查到${scope}的资源合同。查询范围：资源合同台账中的合同结束日期。`, provider: 'system', handled: true, data: { contracts: [], queryEvidence: evidence } };
    const list = contracts.map((item) => `“${text(item.name) || '未命名合同'}”${text(item.contractNumber) ? `（${text(item.contractNumber)}）` : ''}，结束日期 ${text(item.endDate)}`).join('；');
    return { content: `查到 ${contracts.length} 份${scope}的资源合同：${list}。查询范围：资源合同台账中的合同结束日期。`, provider: 'system', handled: true, data: { contracts, queryEvidence: evidence } };
  }

  answerContractReceiptQuestion(database, message) {
    const requested = text(message);
    if (/(?:登记|记录|新增)(?:承包人)?(?:缴费)?到账[：:]/u.test(requested)) return null;
    if (!/(合同|承包人)/u.test(requested) || !/(到账|缴费|收款|已缴|未缴)/u.test(requested)) return null;
    const contracts = (database.resourceContracts || []).filter((item) => {
      const name = text(item.name);
      const contractor = text(item.contractorName);
      return (name && requested.includes(name)) || (contractor && requested.includes(contractor));
    });
    const longestMatch = Math.max(0, ...contracts.map((item) => Math.max(text(item.name).length, text(item.contractorName).length)));
    const candidates = contracts.filter((item) => Math.max(text(item.name).length, text(item.contractorName).length) === longestMatch);
    if (!candidates.length) return { content: '请补充要查询的真实合同名称或承包人名称。虚构示例：“示例鱼塘承包合同是否到账？”。对象不明确时，我不会自行匹配。', provider: 'system', handled: true, needsConfirmation: true };
    if (candidates.length > 1) return { content: `查到多份可能的合同，请补充合同名称：${candidates.map((item) => `“${text(item.name) || '未命名合同'}”`).join('、')}。`, provider: 'system', handled: true, needsConfirmation: true };
    const contract = candidates[0];
    const receipt = (database.contractFeeReceipts || []).find((item) => text(item.contractId) === text(contract.id));
    const contractName = `“${text(contract.name) || '未命名合同'}”`;
    const evidence = this.buildRecordEvidence({
      title: `${contractName}到账核对`, scope: '资金发放中心的承包人缴费到账台账', metricLabel: '已登记到账', metricValue: receipt ? formatMoney(receipt.amountCents) : '暂无记录',
      summary: [{ name: '合同应缴金额', value: formatMoney(contract.amountCents) }],
      records: receipt ? [this.navigationEvidenceRecord({ title: text(contract.name) || '未命名合同', meta: `到账日期 ${text(receipt.receivedDate) || '未填写'}`, value: formatMoney(receipt.amountCents), target: 'tab-contract-fees', label: '资金发放中心', source: '承包人缴费到账台账', recordSource: { kind: 'contract', id: contract.id } })] : [],
      emptyMessage: '尚未登记承包人缴费到账记录；这不等同于认定对方未缴。',
    });
    if (!receipt) return { content: `${contractName}尚未登记承包人缴费到账记录。查询范围：资金发放中心的承包人缴费到账台账；这不等同于认定对方未缴。`, provider: 'system', handled: true, data: { contract, receipt: null, queryEvidence: evidence } };
    return {
      content: `${contractName}已登记到账 ${formatMoney(receipt.amountCents)}，到账日期 ${text(receipt.receivedDate) || '未填写'}。合同应缴金额为 ${formatMoney(contract.amountCents)}。查询范围：资金发放中心的承包人缴费到账台账。`,
      provider: 'system', handled: true, data: { contract, receipt, queryEvidence: evidence },
    };
  }

  answerPartyMemberQuestion(database, message) {
    const requested = text(message);
    if (!/党员/u.test(requested) || !/(是不是|是否是|党员吗|党员阶段|党员类型|党内职务|担任什么)/u.test(requested)) return null;
    const members = (database.partyMembers || []).map((item) => ({
      id: text(item?.id || item?.personId || item?.person_id || item?.id_card),
      name: text(item?.name || item?.member_name || item?.displayName),
      groupName: text(item?.village_group || item?.villageGroup || item?.group || item?.group_name),
      stage: text(item?.stage || item?.party_stage),
      duty: text(item?.duty || item?.party_duty),
    })).filter((item) => item.name && requested.includes(item.name));
    const longest = Math.max(0, ...members.map((item) => item.name.length));
    const candidates = members.filter((item) => item.name.length === longest);
    const groupMatches = candidates.filter((item) => item.groupName && requested.includes(item.groupName));
    const matched = groupMatches.length ? groupMatches : candidates;
    if (!matched.length) return { content: '我没有识别出要查询的党员姓名。请补充姓名；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    if (matched.length > 1) return { content: `系统中有多位同名党员，请确认要查询哪一位：${matched.map((item) => `${item.name}${item.groupName ? `（${item.groupName}）` : ''}`).join('、')}。`, provider: 'system', handled: true, needsConfirmation: true };
    const member = matched[0];
    const details = [member.stage && `党员阶段：${member.stage}`, member.duty && `党内职务：${member.duty}`].filter(Boolean);
    const evidence = this.buildRecordEvidence({
      title: `“${member.name}”党员档案核对`, scope: '党员管理台账中与该姓名和村民小组匹配的党员记录',
      metricLabel: '党员档案状态', metricValue: member.stage || '阶段未登记',
      summary: [{ name: '党内职务', value: member.duty || '未登记' }, { name: '村民小组', value: member.groupName || '未登记' }],
      records: [this.navigationEvidenceRecord({
        title: member.name, meta: member.groupName || '村民小组未登记', value: member.stage || '党员阶段未登记',
        target: 'tab-party', label: '党员管理', source: '党员管理台账', filters: { query: member.name },
      })],
      emptyMessage: `党员管理台账中未查到“${member.name}”的记录。`,
    });
    return { content: `“${member.name}”已登记在党员档案中。${details.length ? details.join('；') : '党员阶段和党内职务暂未填写。'} 查询范围：党员管理台账。`, provider: 'system', handled: true, data: { member, queryEvidence: evidence } };
  }

  answerResidentOverview(database, message) {
    const requested = text(message);
    if (!isResidentOverviewRequest(requested)) return null;
    const resolved = this.resolveRecipient(database, requested);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map(candidate => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名居民，请补充村民小组后再查询：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') {
      return { content: '请告诉我要查询哪位居民；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    }
    const person = (database.personnel || []).find(item => personId(item) === resolved.recipient.id)
      || (database.personnel || []).find(item => personName(item) === resolved.recipient.name && personGroup(item) === resolved.recipient.groupName);
    const fields = [
      ['姓名', personName(person)],
      ['村民小组', personGroup(person)],
      ['户号', personHouseholdId(person)],
      ['与户主关系', personRelationToHead(person)],
      ['性别', text(person?.gender || person?.sex)],
      ['出生日期', text(person?.birth_date || person?.birthDate || person?.birthday)],
      ['户籍状态', text(person?.household_status || person?.householdStatus || person?.status)],
    ].filter(([, value]) => value);
    const label = `${resolved.recipient.name}${resolved.recipient.groupName ? `（${resolved.recipient.groupName}）` : ''}`;
    const evidence = this.buildRecordEvidence({
      title: `${label}居民基本情况`,
      scope: '本机居民一户一档中的当前登记资料',
      metricLabel: '档案状态',
      metricValue: '已找到 1 条',
      summary: fields.slice(1).map(([name, value]) => ({ name, value })),
      records: [this.navigationEvidenceRecord({
        title: resolved.recipient.name,
        meta: [personGroup(person), personHouseholdId(person) && `户号：${personHouseholdId(person)}`].filter(Boolean).join(' · '),
        value: personRelationToHead(person) ? `与户主关系：${personRelationToHead(person)}` : '与户主关系未登记',
        target: 'tab-personnel', label: '居民一户一档', source: '居民档案', filters: { query: resolved.recipient.name },
      })],
    });
    return {
      content: `已在本机居民档案中找到“${label}”：${fields.map(([name, value]) => `${name}：${value}`).join('；')}。`,
      provider: 'system', handled: true, data: { resident: sanitizeFactValue(person), queryEvidence: evidence },
    };
  }

  answerIdentityCardQuestion(database, message) {
    const requested = text(message);
    if (!/(身份证(?:号码|号)?|证件号码|身份号码|居民身份证)/u.test(requested)) return null;
    const resolved = this.resolveRecipient(database, requested);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名居民，请补充村民小组后再查询身份证号码：${choices}。我不会自行猜测。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') {
      return { content: '请提供要查询的居民姓名；如有同名人员，请同时说明村民小组。我会仅在本机村民档案中核对，不会交给在线 AI。', provider: 'system', handled: true, needsConfirmation: true };
    }
    const person = (database.personnel || []).find((item) => personId(item) === resolved.recipient.id)
      || (database.personnel || []).find((item) => personName(item) === resolved.recipient.name && personGroup(item) === resolved.recipient.groupName);
    const identityCard = personIdentityCard(person);
    const personLabel = `“${resolved.recipient.name}”${resolved.recipient.groupName ? `（${resolved.recipient.groupName}）` : ''}`;
    const evidence = this.buildRecordEvidence({
      title: `${personLabel}居民档案核对`, scope: '本机居民一户一档中与该居民精确匹配的档案记录',
      metricLabel: '身份证号码', metricValue: identityCard || '未登记',
      summary: [{ name: '村民小组', value: resolved.recipient.groupName || '未登记' }],
      records: [this.navigationEvidenceRecord({
        title: resolved.recipient.name, meta: resolved.recipient.groupName || '村民小组未登记', value: identityCard || '身份证号码未登记',
        target: 'tab-personnel', label: '居民一户一档', source: '居民档案', filters: { query: resolved.recipient.name },
      })],
      emptyMessage: `${personLabel}的村民档案尚未登记身份证号码。`,
    });
    if (!identityCard) return { content: `${personLabel}的村民档案尚未登记身份证号码。查询范围：本机居民一户一档。`, provider: 'system', handled: true, data: { person: resolved.recipient, identityCard: '', queryEvidence: evidence } };
    return { content: `${personLabel}的身份证号码是：${identityCard}。查询范围：本机居民一户一档，未发送给在线 AI。`, provider: 'system', handled: true, data: { person: resolved.recipient, identityCard, queryEvidence: evidence } };
  }

  answerResidentRelationshipQuestion(database, message) {
    const requested = text(message);
    if (!/(?:什么|有何|是否|是不是|能否确认).{0,8}(?:关系|关联)|(?:关系|关联|同户|同一户|亲属|家庭成员|户主关系)/u.test(requested)) return null;
    const residents = (database.personnel || []).map((person) => ({
      person, id: personId(person), name: personName(person), groupName: personGroup(person),
      householdId: personHouseholdId(person), relationToHead: personRelationToHead(person),
    })).filter((item) => item.name);
    const names = [...new Set(residents.filter((item) => requested.includes(item.name)).map((item) => item.name))]
      .sort((left, right) => right.length - left.length);
    if (!names.length) return { content: '请同时说明要核对的居民姓名。虚构示例：“示例居民甲和示例居民乙是什么关系？”，实际查询时请换成档案中的真实姓名。我会只按本机村民档案中的户号和户主关系核对，不会猜测。', provider: 'system', handled: true, needsConfirmation: true };

    const resolveNamedResident = (name) => {
      const candidates = residents.filter((item) => item.name === name);
      const grouped = candidates.filter((item) => item.groupName && requested.includes(item.groupName));
      const matched = grouped.length === 1 ? grouped : candidates;
      return matched.length === 1 ? { kind: 'resident', resident: matched[0] } : { kind: 'ambiguous', candidates: matched };
    };

    if (names.length === 1) {
      const result = resolveNamedResident(names[0]);
      if (result.kind === 'ambiguous') return { content: `系统中有多位“${names[0]}”，请补充村民组后再查询户主关系：${result.candidates.map((item) => `${item.name}${item.groupName ? `（${item.groupName}）` : ''}`).join('、')}。`, provider: 'system', handled: true, needsConfirmation: true };
      const resident = result.resident;
      if (!/(户主关系|与户主|家庭成员|同户)/u.test(requested)) return { content: `请再说明另一位居民的真实姓名，例如“${resident.name}和另一位居民是什么关系？”。我会根据本机户号和与户主关系核对，不会推测。`, provider: 'system', handled: true, needsConfirmation: true };
      if (!resident.relationToHead) return { content: `“${resident.name}”的村民档案尚未登记“与户主关系”，暂时无法核实家庭关系。查询范围：本机居民一户一档。`, provider: 'system', handled: true, data: { resident } };
      return { content: `“${resident.name}”${resident.groupName ? `（${resident.groupName}）` : ''}在居民档案中的与户主关系为“${resident.relationToHead}”。查询范围：本机居民一户一档。`, provider: 'system', handled: true, data: { resident } };
    }

    const [firstName, secondName] = names.slice(0, 2);
    const first = resolveNamedResident(firstName);
    const second = resolveNamedResident(secondName);
    const ambiguous = [first, second].find((item) => item.kind === 'ambiguous');
    if (ambiguous) {
      const candidateNames = ambiguous.candidates.map((item) => `${item.name}${item.groupName ? `（${item.groupName}）` : ''}`).join('、');
      return { content: `关系查询中存在同名居民，请补充村民组后再核对：${candidateNames}。我不会自行选择同名人员。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    const left = first.resident;
    const right = second.resident;
    const labels = `“${left.name}”${left.groupName ? `（${left.groupName}）` : ''}、“${right.name}”${right.groupName ? `（${right.groupName}）` : ''}`;
    const relationshipEvidence = (conclusion, summary = []) => this.buildRecordEvidence({
      title: '居民家庭关系核对',
      scope: '本机居民一户一档中两位居民的户号与户主关系字段',
      metricLabel: '档案关系结论',
      metricValue: conclusion,
      summary,
      records: [left, right].map((resident) => this.navigationEvidenceRecord({
        title: resident.name,
        meta: [resident.groupName, resident.householdId ? `户号：${resident.householdId}` : '户号未登记'].filter(Boolean).join(' · '),
        value: resident.relationToHead ? `与户主关系：${resident.relationToHead}` : '与户主关系未登记',
        target: 'tab-personnel', label: '居民一户一档', source: '居民档案', filters: { query: resident.name },
      })),
    });
    if (!left.householdId || !right.householdId) {
      const evidence = relationshipEvidence('无法确认', [{ name: '户号核对', value: '至少一人未登记' }]);
      return { content: `${labels}的居民档案至少有一人未登记户号，无法依据台账确认两人的家庭关系。我不会按姓名、年龄或常识猜测。查询范围：本机居民一户一档。`, provider: 'system', handled: true, data: { left, right, queryEvidence: evidence } };
    }
    if (left.householdId !== right.householdId) {
      const evidence = relationshipEvidence('无法确认', [{ name: '户号核对', value: '不同户号' }]);
      return { content: `${labels}登记在不同户号下，当前居民档案不能确认二人存在直接家庭关系。我不会推测。查询范围：本机居民一户一档。`, provider: 'system', handled: true, data: { left, right, queryEvidence: evidence } };
    }
    const shared = `两人登记为同一户（户号：${left.householdId}）`;
    const sameHouseholdSummary = [{ name: '户号核对', value: '同一户' }];
    const leftHead = /^(?:户主|户主本人)$/u.test(left.relationToHead);
    const rightHead = /^(?:户主|户主本人)$/u.test(right.relationToHead);
    if (leftHead && right.relationToHead) {
      const relationship = relationDescription(right.relationToHead);
      const evidence = relationshipEvidence(`${right.name}是${left.name}的${relationship}`, sameHouseholdSummary);
      return { content: `${shared}。档案标注：${left.name}为户主；${right.name}与户主关系为“${right.relationToHead}”。因此可直接确认：${right.name}是${left.name}的${relationship}。查询范围：本机居民一户一档，未发送给在线 AI。`, provider: 'system', handled: true, data: { left, right, relationship, queryEvidence: evidence } };
    }
    if (rightHead && left.relationToHead) {
      const relationship = relationDescription(left.relationToHead);
      const evidence = relationshipEvidence(`${left.name}是${right.name}的${relationship}`, sameHouseholdSummary);
      return { content: `${shared}。档案标注：${right.name}为户主；${left.name}与户主关系为“${left.relationToHead}”。因此可直接确认：${left.name}是${right.name}的${relationship}。查询范围：本机居民一户一档，未发送给在线 AI。`, provider: 'system', handled: true, data: { left, right, relationship, queryEvidence: evidence } };
    }
    const leftGender = relationChildGender(left.relationToHead);
    const rightGender = relationChildGender(right.relationToHead);
    if (leftGender && rightGender) {
      const relationship = leftGender === 'male' && rightGender === 'male' ? '兄弟'
        : leftGender === 'female' && rightGender === 'female' ? '姐妹' : '兄妹或姐弟';
      const evidence = relationshipEvidence(relationship, sameHouseholdSummary);
      return {
        content: `${shared}。档案标注：${left.name}与户主关系为“${left.relationToHead}”，${right.name}与户主关系为“${right.relationToHead}”。二人均为同一户主的子女，因此可确认二人是${relationship}关系。查询依据：本机居民一户一档。`,
        provider: 'system', handled: true, data: { left, right, relationship, queryEvidence: evidence },
      };
    }
    const leftDetail = left.relationToHead ? `${left.name}与户主关系为“${left.relationToHead}”` : `${left.name}未填写与户主关系`;
    const rightDetail = right.relationToHead ? `${right.name}与户主关系为“${right.relationToHead}”` : `${right.name}未填写与户主关系`;
    const evidence = relationshipEvidence('无法确认', sameHouseholdSummary);
    return { content: `${shared}；${leftDetail}，${rightDetail}。档案没有登记二人之间的直接关系，无法仅依据这些字段确认亲属称谓，我不会猜测。查询范围：本机居民一户一档。`, provider: 'system', handled: true, data: { left, right, queryEvidence: evidence } };
  }

  answerLandAreaQuestion(database, message) {
    const requested = text(message);
    if (/^(?:新建|新增|登记)(?:一块)?(?:地块|土地|确权记录)[：:]/u.test(requested)) return null;
    if (!/(土地|地块|确权)/u.test(requested) || !/(总面积|面积.{0,8}(多少|几)|多少.{0,8}面积|几亩)/u.test(requested)) return null;
    const parcels = database.landParcel?.length ? database.landParcel : (database.lands || []);
    const totalArea = parcels.reduce((sum, parcel) => {
      const value = Number(String(parcel?.area ?? parcel?.areaMu ?? parcel?.acreage ?? 0).replace(/[亩,，\s]/gu, ''));
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const areaOf = (parcel) => {
      const value = Number(String(parcel?.area ?? parcel?.areaMu ?? parcel?.acreage ?? 0).replace(/[亩,，\s]/gu, ''));
      return Number.isFinite(value) ? value : 0;
    };
    const evidence = this.buildRecordEvidence({
      title: '土地确权面积核对', scope: '土地承包确权台账中的全部地块记录', metricLabel: '确权面积合计', metricValue: `${totalArea.toFixed(2)} 亩`,
      summary: [{ name: '已登记地块', value: `${parcels.length} 块` }],
      records: parcels.map((parcel) => this.navigationEvidenceRecord({
        title: text(parcel.parcel_name || parcel.land_name || parcel.name || parcel.parcel_code || parcel.code || parcel.id) || '未命名地块',
        meta: text(parcel.parcel_code || parcel.code), value: `${areaOf(parcel).toFixed(2)} 亩`, target: 'tab-land', label: '土地承包确权', source: '土地确权台账', filters: { query: text(parcel.parcel_name || parcel.land_name || parcel.name || parcel.parcel_code || parcel.code || parcel.id) },
      })),
      emptyMessage: '土地确权台账中暂未登记地块，因此无法统计总面积。',
    });
    if (!parcels.length) return { content: '土地确权台账中暂未登记地块，因此无法统计总面积。', provider: 'system', handled: true, data: { count: 0, totalArea: 0, queryEvidence: evidence } };
    return { content: `当前土地确权台账共登记 ${parcels.length} 块地块，面积合计 ${totalArea.toFixed(2)} 亩。统计范围：土地承包确权台账中的全部地块记录。`, provider: 'system', handled: true, data: { count: parcels.length, totalArea, queryEvidence: evidence } };
  }

  answerLandContractorQuestion(database, message) {
    const requested = text(message);
    if (/^(?:新建|新增|登记)(?:一块)?(?:地块|土地|确权记录)[：:]/u.test(requested)) return null;
    if (!/(承包|地块|土地|田地)/u.test(requested) || !/(哪些|哪几|多少|几块|几亩|面积)/u.test(requested)) return null;
    const resolved = this.resolveRecipient(database, requested);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要查询哪一位承包人：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind !== 'resident') return null;
    const person = (database.personnel || []).find((item) => personId(item) === resolved.recipient.id);
    const identifiers = new Set([text(person?.id_card), text(person?.idCard), text(person?.identityCard), text(person?.id)].filter(Boolean));
    if (!identifiers.size) return { content: `“${resolved.recipient.name}”的村民档案未登记可用于土地关联的身份证号，暂时无法核对其承包地块。`, provider: 'system', handled: true, needsConfirmation: true };
    const parcels = database.landParcel?.length ? database.landParcel : (database.lands || []);
    const matches = parcels.filter((parcel) => {
      const contractorIds = Array.isArray(parcel?.contractorIds) ? parcel.contractorIds : (parcel?.contractorId ? [parcel.contractorId] : []);
      return contractorIds.some((id) => identifiers.has(text(id)));
    });
    const areaOf = (parcel) => {
      const value = Number(String(parcel?.area ?? parcel?.areaMu ?? parcel?.acreage ?? 0).replace(/[亩,，\s]/gu, ''));
      return Number.isFinite(value) ? value : 0;
    };
    const evidence = this.buildRecordEvidence({
      title: `“${resolved.recipient.name}”承包地核对`, scope: '土地承包确权台账中承包人关联的地块；未关联地块不计入', metricLabel: '关联面积合计', metricValue: `${matches.reduce((sum, parcel) => sum + areaOf(parcel), 0).toFixed(2)} 亩`,
      summary: [{ name: '关联地块', value: `${matches.length} 块` }],
      records: matches.map((parcel) => this.navigationEvidenceRecord({
        title: text(parcel.parcel_name || parcel.land_name || parcel.name || parcel.parcel_code || parcel.code || parcel.id) || '未命名地块',
        meta: text(parcel.parcel_code || parcel.code), value: `${areaOf(parcel).toFixed(2)} 亩`, target: 'tab-land', label: '土地承包确权', source: '土地确权台账', filters: { query: text(parcel.parcel_name || parcel.land_name || parcel.name || parcel.parcel_code || parcel.code || parcel.id) },
      })),
      emptyMessage: `土地确权台账中未查到关联“${resolved.recipient.name}”的地块。`,
    });
    if (!matches.length) return { content: `土地确权台账中未查到关联“${resolved.recipient.name}”的地块。查询依据：台账承包人关联的身份证标识；未关联地块不会被计入。`, provider: 'system', handled: true, data: { person: resolved.recipient, parcels: [], queryEvidence: evidence } };
    const totalArea = matches.reduce((sum, parcel) => sum + areaOf(parcel), 0);
    const list = matches.slice(0, 10).map((parcel) => `“${text(parcel.parcel_name || parcel.land_name || parcel.name || parcel.parcel_code || parcel.code || parcel.id) || '未命名地块'}”${areaOf(parcel) ? `（${areaOf(parcel).toFixed(2)} 亩）` : ''}`).join('、');
    const more = matches.length > 10 ? `；其余 ${matches.length - 10} 块请进入土地承包确权查看。` : '。';
    return { content: `“${resolved.recipient.name}”关联 ${matches.length} 块承包地，面积合计 ${totalArea.toFixed(2)} 亩：${list}${more} 查询范围：土地承包确权台账中承包人关联的地块。`, provider: 'system', handled: true, data: { person: resolved.recipient, parcels: matches, totalArea, queryEvidence: evidence } };
  }

  answerWorkStatusQuestion(database, message) {
    const requested = text(message);
    if (!/(工作事项|工作任务|工作管理|工作)/u.test(requested)) return null;
    const status = ['未开始', '进行中', '已完成', '已归档'].find((item) => requested.includes(item));
    if (!status || !/(哪些|哪几|多少|几项|有|查看|列出)/u.test(requested)) return null;
    const works = (database.workItems || []).filter((item) => !item.deletedAt && text(item.status) === status)
      .sort((left, right) => text(left.updatedAt).localeCompare(text(right.updatedAt)));
    const evidence = this.buildRecordEvidence({
      title: `“${status}”工作事项核对`, scope: '工作管理台账中状态为该值、且未进入可恢复区的工作事项',
      metricLabel: '符合条件的工作', metricValue: `${works.length} 项`,
      summary: [{ name: '已排除', value: '回收状态工作' }],
      records: works.map((item) => this.navigationEvidenceRecord({
        title: text(item.name) || '未命名工作',
        meta: [text(item.number), text(item.responsiblePerson) && `责任人：${text(item.responsiblePerson)}`].filter(Boolean).join(' · '),
        value: text(item.status) || '未填写状态', target: 'tab-work-management', label: '工作管理', source: '工作管理台账',
        recordSource: { kind: 'work', id: text(item.id) },
      })),
      emptyMessage: `当前没有状态为“${status}”的工作事项。`,
    });
    if (!works.length) return { content: `当前没有状态为“${status}”的工作事项。查询范围：工作管理台账，已排除回收状态的工作。`, provider: 'system', handled: true, data: { status, works: [], queryEvidence: evidence } };
    const list = works.slice(0, 10).map((item) => `“${text(item.name) || '未命名工作'}”${text(item.number) ? `（${text(item.number)}）` : ''}${text(item.responsiblePerson) ? `，责任人：${text(item.responsiblePerson)}` : ''}`).join('；');
    const more = works.length > 10 ? `；其余 ${works.length - 10} 项请进入工作管理查看。` : '。';
    return { content: `当前共有 ${works.length} 项“${status}”工作：${list}${more} 查询范围：工作管理台账，已排除回收状态的工作。`, provider: 'system', handled: true, data: { status, works, queryEvidence: evidence } };
  }

  answerFinalDocumentQuestion(database, message) {
    const requested = text(message);
    if (!/(公文|草稿|文档)/u.test(requested) || !/(定稿|已定稿|final)/iu.test(requested)) return null;
    const documents = (database.documentDrafts || []).filter((item) => text(item.status) === 'final' && !item.archivedAt)
      .sort((left, right) => text(right.updatedAt).localeCompare(text(left.updatedAt)));
    const evidence = this.buildRecordEvidence({
      title: '已定稿公文核对', scope: '公文拟写台账中状态为“定稿”、且未归档的公文记录',
      metricLabel: '符合条件的公文', metricValue: `${documents.length} 份`,
      summary: [{ name: '已排除', value: '归档记录' }],
      records: documents.map((item) => this.navigationEvidenceRecord({
        title: text(item.title) || '未命名公文', meta: [text(item.documentKind), text(item.updatedAt) && `更新于 ${text(item.updatedAt).slice(0, 10)}`].filter(Boolean).join(' · '),
        value: '已定稿', target: 'tab-document-drafting', label: '公文拟写', source: '公文拟写台账', recordSource: { kind: 'document', id: text(item.id) },
      })),
      emptyMessage: '当前没有未归档的已定稿公文。',
    });
    if (!documents.length) return { content: '当前没有未归档的已定稿公文。查询范围：公文拟写台账，已排除归档记录。', provider: 'system', handled: true, data: { documents: [], queryEvidence: evidence } };
    const list = documents.slice(0, 10).map((item) => `“${text(item.title) || '未命名公文'}”${text(item.documentKind) ? `（${text(item.documentKind)}）` : ''}`).join('；');
    const more = documents.length > 10 ? `；其余 ${documents.length - 10} 份请进入公文拟写查看。` : '。';
    return { content: `当前有 ${documents.length} 份未归档的已定稿公文：${list}${more} 查询范围：公文拟写台账，已排除归档记录。`, provider: 'system', handled: true, data: { documents, queryEvidence: evidence } };
  }

  answerCertificateQuestion(database, message) {
    const requested = text(message);
    if (!/证明/u.test(requested) || /^(?:删除|移除|新增|开具)(?:证明(?:记录)?)[：:]/u.test(requested) || /(打开|进入|跳转|去).{0,14}证明/u.test(requested)) return null;
    if (!/(最近|哪些|哪几|多少|几条|列表|清单|记录|历史)/u.test(requested)) return null;
    const records = [...(database.certificates || [])].sort((left, right) => text(right.issuedAt || right.createdAt || right.date).localeCompare(text(left.issuedAt || left.createdAt || left.date)));
    const personNameQuery = (database.personnel || []).map(personName).filter((name) => name && requested.includes(name)).sort((left, right) => right.length - left.length)[0];
    const matched = personNameQuery ? records.filter((item) => text(item.personName || item.name) === personNameQuery) : records;
    const evidence = this.buildRecordEvidence({
      title: personNameQuery ? `“${personNameQuery}”证明开具记录核对` : '证明开具记录核对',
      scope: personNameQuery ? '证明开具历史台账中姓名精确匹配的记录' : '证明开具历史台账中的全部记录',
      metricLabel: '符合条件的记录', metricValue: `${matched.length} 条`,
      summary: personNameQuery ? [{ name: '查询对象', value: personNameQuery }] : [],
      records: matched.map((item) => {
        const code = certificateCode(item) || '未编号';
        const recipient = text(item.personName || item.name);
        const type = text(item.templateName || item.templateTitle || item.type) || '未填写类型';
        return this.navigationEvidenceRecord({
          title: code, meta: [recipient, type, text(item.issuedAt || item.createdAt || item.date).slice(0, 10)].filter(Boolean).join(' · '),
          value: '已开具', target: 'tab-certificate', label: '证明开具', source: '证明开具历史台账', recordSource: { kind: 'certificate', query: code === '未编号' ? recipient : code },
        });
      }),
      emptyMessage: personNameQuery ? `证明开具历史中未查到“${personNameQuery}”的记录。` : '当前没有已登记的证明开具记录。',
    });
    if (!records.length) return { content: '当前没有已登记的证明开具记录。查询范围：证明开具历史台账。', provider: 'system', handled: true, data: { records: [], queryEvidence: evidence } };
    if (!matched.length) return { content: `证明开具历史中未查到“${personNameQuery}”的记录。查询范围：证明开具历史台账。`, provider: 'system', handled: true, data: { records: [], queryEvidence: evidence } };
    const list = matched.slice(0, 10).map((item) => {
      const code = certificateCode(item) || '未编号';
      const type = text(item.templateName || item.templateTitle || item.type) || '未填写类型';
      const recipient = text(item.personName || item.name);
      const issuedAt = text(item.issuedAt || item.createdAt || item.date);
      return `“${code}”${recipient ? `，${recipient}` : ''}，${type}${issuedAt ? `，${issuedAt.slice(0, 10)}` : ''}`;
    }).join('；');
    const subject = personNameQuery ? `“${personNameQuery}”` : '当前';
    const more = matched.length > 10 ? `；其余 ${matched.length - 10} 条请进入证明开具查看。` : '。';
    return { content: `${subject}共有 ${matched.length} 条证明开具记录：${list}${more} 查询范围：证明开具历史台账。`, provider: 'system', handled: true, data: { records: matched, personName: personNameQuery || '', queryEvidence: evidence } };
  }

  answerFinanceSummaryQuestion(database, message) {
    const requested = text(message);
    if (/^(?:新建|新增|登记|修改|更新|调整)(?:财务)?(?:收支|收入|支出|记录)[：:]/u.test(requested)) return null;
    const wantsCategoryBreakdown = /(?:分类|类别).{0,8}(?:明细|汇总|分别|多少)|(?:按|按照).{0,8}(?:分类|类别)/u.test(requested);
    if (!/(财务|收支|收入|支出)/u.test(requested) || (!/(多少|金额|合计|总额|结余)/u.test(requested) && !wantsCategoryBreakdown)) return null;
    const year = this.resolveYear(requested);
    if (!year) return { content: '请告诉我需要查询哪一年，例如“2026 年财务收入、支出和结余分别是多少？”。年度不明确时，我不会自行猜测。', provider: 'system', handled: true, needsConfirmation: true };
    const wantsIncome = /收入/u.test(requested);
    const wantsExpense = /支出/u.test(requested);
    const wantsBalance = /结余|收支/u.test(requested);
    const records = (database.finances || []).filter((record) => yearFrom(financeRecordDate(record)) === year);
    const income = records.filter((record) => text(record.type) === 'income').reduce((sum, record) => sum + financeAmountCents(record), 0);
    const expense = records.filter((record) => text(record.type) === 'expense').reduce((sum, record) => sum + financeAmountCents(record), 0);
    const incomeCount = records.filter((record) => text(record.type) === 'income').length;
    const expenseCount = records.filter((record) => text(record.type) === 'expense').length;
    const scope = '财务收支台账中日期属于该自然年度、类型明确为“收入”或“支出”的记录';
    const financeEvidenceRecords = (items) => items.map((record) => {
      const financeQuery = text(record.summary || record.title || record.category || record.categoryName) || '未填写摘要';
      return this.navigationEvidenceRecord({
        title: financeQuery,
        meta: [text(record.type) === 'income' ? '收入' : text(record.type) === 'expense' ? '支出' : '未标注类型', text(record.category || record.categoryName), text(financeRecordDate(record))].filter(Boolean).join(' · '),
        value: formatMoney(financeAmountCents(record)), target: 'tab-finance', label: '财务收支', source: '财务收支台账', filters: { query: financeQuery },
      });
    });
    if (wantsCategoryBreakdown) {
      const filtered = records.filter((record) => {
        const type = text(record.type);
        return (type === 'income' || type === 'expense')
          && (!(wantsIncome && !wantsExpense) || type === 'income')
          && (!(wantsExpense && !wantsIncome) || type === 'expense');
      });
      const categories = new Map();
      for (const record of filtered) {
        const typeLabel = text(record.type) === 'income' ? '收入' : '支出';
        const category = text(record.category || record.categoryName) || '未分类';
        const key = wantsIncome !== wantsExpense ? category : `${typeLabel} · ${category}`;
        const current = categories.get(key) || { key, amountCents: 0, count: 0 };
        current.amountCents += financeAmountCents(record); current.count += 1; categories.set(key, current);
      }
      const rows = [...categories.values()].sort((left, right) => right.amountCents - left.amountCents || left.key.localeCompare(right.key, 'zh-CN'));
      const subject = wantsIncome && !wantsExpense ? '收入' : wantsExpense && !wantsIncome ? '支出' : '收支';
      const evidence = this.buildRecordEvidence({
        title: `${year} 年财务${subject}分类核对`, scope, metricLabel: '符合条件的记录', metricValue: `${filtered.length} 笔`,
        summary: rows.map((row) => ({ name: `${row.key} · ${row.count} 笔`, value: formatMoney(row.amountCents) })), records: financeEvidenceRecords(filtered),
        emptyMessage: `${year} 年没有符合条件的财务分类记录。`,
      });
      if (!filtered.length) return { content: `${year} 年没有符合条件的财务分类记录。统计范围：${scope}。`, provider: 'system', handled: true, data: { year, rows: [], queryEvidence: evidence } };
      return { content: `${year} 年财务${subject}分类汇总：${rows.map((row) => `${row.key} ${formatMoney(row.amountCents)}（${row.count} 笔）`).join('；')}。统计范围：${scope}。`, provider: 'system', handled: true, data: { year, rows, queryEvidence: evidence } };
    }
    const selectedType = wantsIncome && !wantsExpense && !wantsBalance ? 'income' : wantsExpense && !wantsIncome && !wantsBalance ? 'expense' : '';
    const visibleRecords = selectedType ? records.filter((record) => text(record.type) === selectedType) : records.filter((record) => ['income', 'expense'].includes(text(record.type)));
    const metricLabel = selectedType === 'income' ? '已登记收入' : selectedType === 'expense' ? '已登记支出' : '已登记结余';
    const metricValue = selectedType === 'income' ? formatMoney(income) : selectedType === 'expense' ? formatMoney(expense) : formatMoney(income - expense);
    const evidence = this.buildRecordEvidence({
      title: `${year} 年财务收支核对`, scope, metricLabel, metricValue,
      summary: selectedType ? [{ name: '符合条件的记录', value: `${visibleRecords.length} 笔` }] : [{ name: `收入 · ${incomeCount} 笔`, value: formatMoney(income) }, { name: `支出 · ${expenseCount} 笔`, value: formatMoney(expense) }],
      records: financeEvidenceRecords(visibleRecords), emptyMessage: `${year} 年没有符合条件的财务收支记录。`,
    });
    if (wantsIncome && !wantsExpense && !wantsBalance) return { content: `${year} 年已登记财务收入共 ${formatMoney(income)}，${incomeCount} 笔。统计范围：${scope}。`, provider: 'system', handled: true, data: { year, type: 'income', records: incomeCount, amountCents: income, queryEvidence: evidence } };
    if (wantsExpense && !wantsIncome && !wantsBalance) return { content: `${year} 年已登记财务支出共 ${formatMoney(expense)}，${expenseCount} 笔。统计范围：${scope}。`, provider: 'system', handled: true, data: { year, type: 'expense', records: expenseCount, amountCents: expense, queryEvidence: evidence } };
    return { content: `${year} 年已登记财务收入 ${formatMoney(income)}（${incomeCount} 笔），支出 ${formatMoney(expense)}（${expenseCount} 笔），结余 ${formatMoney(income - expense)}。统计范围：${scope}。`, provider: 'system', handled: true, data: { year, income, expense, balance: income - expense, incomeCount, expenseCount, queryEvidence: evidence } };
  }

  async recordOperation(draft, database) {
    const account = await this.authService?.getStatus?.().then(status => status?.account).catch(() => null);
    if (!Array.isArray(database.aiAssistantOperations)) database.aiAssistantOperations = [];
    database.aiAssistantOperations.push({
      id: draft.id || `ai-operation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'ai_assistant',
      ...draft,
      operator: draft.operator || (account ? { name: account.name || '', phone: account.phone || '' } : null),
      createdAt: draft.createdAt || this.now().toISOString(),
    });
  }

  async recordActionConfirmation(action, label) {
    const account = await this.authService?.getStatus?.().then(status => status?.account).catch(() => null);
    action.confirmationHistory ||= [];
    action.confirmationHistory.push({
      step: action.confirmationStep,
      label,
      confirmedAt: this.now().toISOString(),
      operator: account ? { id: text(account.id), name: text(account.name), phone: text(account.phone) } : null,
    });
    return this.saveActionTask(action, {
      status: 'waiting-confirmation',
      pendingAction: structuredClone(action),
      permissionDecision: structuredClone(action.permissionDecision || null),
      confirmationHistory: structuredClone(action.confirmationHistory),
      steps: [{
        id: action.stepId || 'step-confirm-and-execute', title: action.toolName || '核对并执行修改', toolId: action.toolId || '',
        status: 'waiting-confirmation',
        resultSummary: action.confirmationsRequired === 2 && action.confirmationStep === 1 ? '第一次确认已记录，等待最终确认' : '确认已记录，准备执行',
      }],
    });
  }

  async finishActionTask(action, { status, summary, verification = null, operationId = '' } = {}) {
    const stepStatus = status === 'completed' ? 'completed' : status === 'cancelled' ? 'skipped' : 'failed';
    return this.saveActionTask(action, {
      status,
      pendingAction: null,
      confirmationHistory: structuredClone(action.confirmationHistory || []),
      operationId: text(operationId || action.id),
      verification: verification ? structuredClone(verification) : null,
      summary: text(summary),
      steps: [{
        id: action.stepId || 'step-confirm-and-execute', title: action.toolName || '核对并执行修改', toolId: action.toolId || '',
        status: stepStatus, resultSummary: text(summary), error: status === 'failed' ? text(summary) : '',
      }],
    }).catch(() => null);
  }

  async updateOperationVerification(action, verification) {
    try {
      await this.databaseStore.update((database) => {
        const operation = (database.aiAssistantOperations || []).find(item => text(item.id) === text(action.id));
        if (!operation) return null;
        operation.toolId = action.toolId || '';
        operation.taskId = action.taskId || '';
        operation.stepId = action.stepId || '';
        operation.conversationId = action.conversationId || '';
        operation.permissionDecision = structuredClone(action.permissionDecision || null);
        operation.confirmationHistory = structuredClone(action.confirmationHistory || []);
        operation.verification = structuredClone(verification || null);
        return operation;
      });
    } catch { /* The user-facing result still reports if verification metadata could not be saved. */ }
  }

  verifyDatabaseAction(action, database) {
    const passed = (message) => ({ status: 'passed', passed: true, message, checkedAt: this.now().toISOString() });
    const failed = (message) => ({ status: 'failed', passed: false, message, checkedAt: this.now().toISOString() });
    const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    if (['document_category_assign', 'document_category_create_and_archive'].includes(action.type)) {
      const file = (database.aiFileIndexEntries || []).find(item => text(item.id) === text(action.fileId));
      const documentId = text(action.documentId || file?.documentId || action.object?.id);
      const document = (database.documents || []).find(item => text(item.id) === documentId);
      const expected = normalizeCategoryName(action.categoryName);
      const documentMatches = document && normalizeCategoryName(document.category || document.file_category) === expected;
      const fileMatches = file && text(file.archiveState) === 'archived' && normalizeCategoryName(file.finalCategory) === expected;
      const categoryExists = availableCategories(database).some(item => normalizeCategoryName(item.name) === expected);
      return documentMatches && fileMatches && categoryExists
        ? passed(`已重新读取电子档案柜，分类“${text(action.categoryName)}”和文件归档状态一致`)
        : failed('重新读取电子档案柜后，分类、档案记录或文件状态至少有一项不一致');
    }
    if (['resident_phone_update', 'resident_address_update', 'resident_group_update'].includes(action.type)) {
      const person = (database.personnel || []).find(item => personId(item) === text(action.personId));
      return person && text(person[action.field]) === text(action.after?.[action.valueKey || 'phone'])
        ? passed(`已重新读取居民档案，${action.fieldLabel || '目标字段'}与确认内容一致`)
        : failed(`重新读取居民档案后，${action.fieldLabel || '目标字段'}与确认内容不一致`);
    }
    const createdChecks = {
      land_parcel_create: ['landParcel', 'record'], visit_record_create: ['visitRecords', 'record'],
      work_item_create: ['workItems', 'record'], resource_contract_create: ['resourceContracts', 'record'],
      contract_receipt_create: ['contractFeeReceipts', 'receipt'], finance_record_create: ['finances', 'record'],
    };
    if (createdChecks[action.type]) {
      const [collection, key] = createdChecks[action.type];
      const expected = action.after?.[key];
      const current = (database[collection] || []).find(item => text(item.id) === text(expected?.id));
      return current && equal(current, expected) ? passed('已重新读取台账，新记录与确认内容一致') : failed('重新读取台账后，未找到完全一致的新记录');
    }
    if (action.type === 'duty_schedule_add') {
      const current = database.dutyFlexible?.schedule?.[action.after?.date] || [];
      return equal(current, action.after?.names || []) ? passed('已重新读取值班表，安排结果一致') : failed('重新读取值班表后，安排结果不一致');
    }
    if (action.type === 'work_item_status_update') {
      const current = (database.workItems || []).find(item => text(item.id) === text(action.object?.id));
      return current && text(current.status) === text(action.after?.status) && text(current.updatedAt) === text(action.after?.updatedAt)
        ? passed('已重新读取工作事项，状态修改一致') : failed('重新读取工作事项后，状态与确认内容不一致');
    }
    if (action.type === 'certificate_record_delete') {
      const exists = (database.certificates || []).some(item => certificateCode(item) === certificateCode(action.before?.record));
      return exists ? failed('重新读取证明台账后，该记录仍然存在') : passed('已重新读取证明台账，目标记录已移除');
    }
    if (action.type === 'document_draft_archive') {
      const current = (database.documentDrafts || []).find(item => text(item.id) === text(action.object?.id));
      return current && text(current.archivedAt) === text(action.after?.archivedAt) && text(current.updatedAt) === text(action.after?.updatedAt)
        ? passed('已重新读取公文草稿，归档状态一致') : failed('重新读取公文草稿后，归档状态不一致');
    }
    if (action.type === 'party_member_stage_update') {
      const current = (database.partyMembers || []).find(item => text(item.id || item.personId || item.person_id || item.idCard || item.id_card) === text(action.object?.id));
      return current && text(current[action.field]) === text(action.after?.stage) ? passed('已重新读取党员档案，阶段修改一致') : failed('重新读取党员档案后，阶段不一致');
    }
    if (action.type === 'finance_record_update') {
      const expected = action.after?.record;
      const current = (database.finances || []).find(item => financeVoucherNumber(item) === financeVoucherNumber(expected));
      return current && equal(current, expected) ? passed('已重新读取财务台账，修改内容一致') : failed('重新读取财务台账后，修改内容不一致');
    }
    if (action.type === 'finance_records_clear') return (database.finances || []).length === 0 ? passed('已重新读取财务台账，当前记录为 0 笔') : failed('重新读取财务台账后，仍存在记录');
    if (action.type === 'settings_village_name_update') return text(database.settings?.villageName) === text(action.after?.villageName) ? passed('已重新读取系统设置，社区名称一致') : failed('重新读取系统设置后，社区名称不一致');
    if (action.type === 'work_item_soft_delete') {
      const expected = action.after?.record;
      const current = (database.workItems || []).find(item => text(item.id) === text(expected?.id));
      return current && equal(current, expected) ? passed('已重新读取工作事项，已进入可恢复区') : failed('重新读取工作事项后，删除状态不一致');
    }
    if (action.type === 'work_items_soft_delete_batch') {
      const currentById = new Map((database.workItems || []).map(item => [text(item.id), item]));
      const matches = (action.after?.records || []).every(item => equal(currentById.get(text(item.id)), item));
      return matches ? passed('已重新读取全部工作事项，批量删除结果一致') : failed('重新读取工作事项后，至少一项结果不一致');
    }
    return failed('该操作暂时没有可用的自动复核规则');
  }

  async verifyCompletedAction(action) {
    try {
      if (action.type === 'unit_member_disable') {
        const members = await this.authService.listUnitMembers();
        const current = (Array.isArray(members) ? members : []).find(item => text(item.id) === text(action.object?.id));
        return current?.isActive === false
          ? { status: 'passed', passed: true, message: '已重新读取成员状态，账号已停用', checkedAt: this.now().toISOString() }
          : { status: 'failed', passed: false, message: '重新读取成员状态后，停用结果不一致', checkedAt: this.now().toISOString() };
      }
      const database = await this.databaseStore.read();
      if (action.type === 'database_backup_restore') {
        return databaseFingerprint(database) === text(action.after?.restoredFingerprint)
          ? { status: 'passed', passed: true, message: '已重新读取恢复后的数据，内容与目标备份一致', checkedAt: this.now().toISOString() }
          : { status: 'failed', passed: false, message: '重新读取恢复后的数据后，内容与目标备份不一致', checkedAt: this.now().toISOString() };
      }
      return this.verifyDatabaseAction(action, database);
    } catch (error) {
      return { status: 'failed', passed: false, message: `自动复核未完成：${text(error.message) || '无法重新读取数据'}`, checkedAt: this.now().toISOString() };
    }
  }

  async markOperationTaskUndone(operation, message) {
    if (!text(operation?.taskId) || !text(operation?.conversationId)) return null;
    const tasks = await this.taskService.list({ conversationId: operation.conversationId, limit: 100 }).catch(() => []);
    const task = tasks.find(item => item.id === operation.taskId);
    if (!task) return null;
    return this.taskService.save({
      ...task,
      status: 'undone',
      pendingAction: null,
      summary: text(message) || '原操作已安全撤销',
      steps: (task.steps || []).map(step => ({ ...step, status: 'undone', resultSummary: '原操作已安全撤销', error: '' })),
    }).catch(() => null);
  }

  async backupRestoreProposal(database, message) {
    const requested = text(message);
    if (!/(?:恢复|还原)(?:数据库)?备份/u.test(requested)) return null;
    const backupName = requested.match(/(?:恢复|还原)(?:数据库)?备份[：:]\s*(?:名称|文件名)?\s*=?\s*(.+)$/u)?.[1]?.replace(/[“”]/gu, '').trim() || '';
    if (!backupName) return {
      content: '恢复备份必须提供系统备份目录中的准确文件名，例如“恢复备份：名称=backup-20260901-080000.json”。这是覆盖当前数据的高风险操作，我不会猜测要恢复哪一份备份。',
      provider: 'system', handled: true, needsConfirmation: true,
    };
    if (typeof this.databaseStore.listBackups !== 'function') return {
      content: '当前数据服务不支持列出本机备份，无法安全恢复。请在系统设置中检查备份服务后再试。',
      provider: 'system', handled: true, needsConfirmation: true,
    };
    const backups = await this.databaseStore.listBackups();
    const backup = (backups || []).find((item) => text(item.name) === backupName);
    if (!backup) {
      const candidates = (backups || []).slice(0, 5).map((item) => text(item.name)).filter(Boolean);
      return {
        content: candidates.length
          ? `未找到备份“${backupName}”。请从已有备份中准确选择：${candidates.join('、')}。`
          : '当前系统备份目录中没有可恢复的备份文件。',
        provider: 'system', handled: true, needsConfirmation: true,
      };
    }
    const action = this.queueControlledAction({
      type: 'database_backup_restore', riskLevel: 'high', module: '系统备份', object: { id: text(backup.name), name: text(backup.name) },
      summary: `将用备份“${text(backup.name)}”覆盖恢复当前系统数据。执行前会自动再保存当前状态，恢复后可在 AI 助理记录中手动撤销`,
      before: { currentFingerprint: databaseFingerprint(database), safeguardBackupName: '' },
      after: { backupName: text(backup.name), backupModifiedAt: text(backup.modifiedAt) }, proposedAt: this.now().toISOString(),
    });
    return { content: this.actionPreview(action), provider: 'system', handled: true, needsConfirmation: true, action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: action.confirmationsRequired, before: action.before, after: action.after } };
  }

  async executeBackupRestoreAction(action) {
    try {
      if (typeof this.databaseStore.createBackup !== 'function' || typeof this.databaseStore.restoreBackup !== 'function') throw new Error('当前数据服务不支持安全恢复备份');
      const current = await this.databaseStore.read();
      if (databaseFingerprint(current) !== text(action.before?.currentFingerprint)) throw new Error('当前系统数据在确认期间已发生变化，请重新选择备份并确认');
      const safeguard = await this.databaseStore.createBackup();
      if (!text(safeguard?.name)) throw new Error('未能创建恢复前的安全备份，本次恢复不会执行');
      action.before = { ...action.before, safeguardBackupName: text(safeguard.name) };
      const completedAt = this.now().toISOString();
      let restoredFingerprint = '';
      await this.databaseStore.restoreBackup({ name: action.after?.backupName }, {
        transform: async (restoredDatabase) => {
          restoredFingerprint = databaseFingerprint(restoredDatabase);
          action.after = { ...action.after, restoredFingerprint };
          await this.recordOperation({
            id: action.id, type: action.type, module: action.module, object: action.object, riskLevel: 'high', status: 'completed',
            before: action.before, after: action.after, recoverable: true, completedAt,
          }, restoredDatabase);
        },
      });
      const verification = await this.verifyCompletedAction(action);
      await this.updateOperationVerification(action, verification);
      const task = await this.finishActionTask(action, {
        status: verification.passed ? 'completed' : 'failed', operationId: action.id, verification,
        summary: verification.passed ? `已恢复备份并完成自动复核：${verification.message}` : `备份已恢复，但${verification.message}`,
      });
      this.pendingAction = null;
      return {
        content: verification.passed
          ? `已恢复备份“${text(action.after?.backupName)}”，并已自动保存恢复前状态“${text(safeguard.name)}”。自动复核已通过。需要恢复到本次操作之前时，请到“AI 助理记录”中手动撤销。`
          : `备份恢复操作已经执行，但${verification.message}。请先人工核对，不要继续依赖该结果。`,
        provider: 'system', handled: true, task, verification,
      };
    } catch (error) {
      this.pendingAction = null;
      try {
        await this.databaseStore.update(async (database) => this.recordOperation({
          id: action.id, type: action.type, module: action.module || '系统备份', object: action.object || { name: text(action.after?.backupName) || '未指定备份' },
          riskLevel: 'high', status: 'failed', before: action.before, after: action.after, recoverable: false,
          toolId: action.toolId || '', taskId: action.taskId || '', stepId: action.stepId || '', conversationId: action.conversationId || '',
          permissionDecision: action.permissionDecision || null, confirmationHistory: action.confirmationHistory || [],
          error: text(error.message), completedAt: this.now().toISOString(),
        }, database));
      } catch { /* The restore action remains failed even if the log cannot be written. */ }
      const task = await this.finishActionTask(action, { status: 'failed', operationId: action.id, summary: text(error.message) || '系统暂时无法安全恢复备份' });
      return { content: `未执行本次恢复：${text(error.message) || '系统暂时无法安全恢复备份'}。当前数据没有按本次指令被覆盖。`, provider: 'system', handled: true, task };
    }
  }

  async executeMemberDisableAction(action) {
    try {
      if (typeof this.authService?.listUnitMembers !== 'function' || typeof this.authService?.updateMemberStatus !== 'function') throw new Error('当前账号服务不支持安全停用成员');
      const members = await this.authService.listUnitMembers();
      const member = (Array.isArray(members) ? members : []).find((item) => text(item?.id) === text(action.object?.id) && text(item?.phone) === text(action.object?.phone));
      if (!member) throw new Error('该成员已不存在或当前账号无权查看，请重新核对后再确认');
      if (member.isActive !== action.before?.isActive) throw new Error('该成员状态已在确认期间发生变化，请重新查询后再确认');
      await this.authService.updateMemberStatus({ memberId: action.object.id, isActive: false });
      try {
        await this.databaseStore.update(async (database) => this.recordOperation({
          id: action.id, type: action.type, module: action.module, object: action.object, riskLevel: 'high', status: 'completed',
          before: action.before, after: action.after, recoverable: true, completedAt: this.now().toISOString(),
        }, database));
      } catch (auditError) {
        try { await this.authService.updateMemberStatus({ memberId: action.object.id, isActive: true }); } catch { /* The original authority service remains authoritative if rollback also fails. */ }
        throw new Error(`停用后的审计记录无法保存，已请求恢复账号：${text(auditError.message) || '审计存储失败'}`);
      }
      const verification = await this.verifyCompletedAction(action);
      await this.updateOperationVerification(action, verification);
      const task = await this.finishActionTask(action, {
        status: verification.passed ? 'completed' : 'failed', operationId: action.id, verification,
        summary: verification.passed ? `成员已停用并完成自动复核：${verification.message}` : `成员停用已请求执行，但${verification.message}`,
      });
      this.pendingAction = null;
      return {
        content: verification.passed
          ? `已停用成员“${text(action.object?.name) || text(action.object?.phone)}”的登录权限，账号和历史数据均未删除。自动复核已通过，并已写入 AI 助理记录。需要恢复时，请到“AI 助理记录”中手动撤销。`
          : `成员停用操作已经执行，但${verification.message}。请进入成员管理人工核对。`,
        provider: 'system', handled: true, task, verification,
      };
    } catch (error) {
      this.pendingAction = null;
      try {
        await this.databaseStore.update(async (database) => this.recordOperation({
          id: action.id, type: action.type, module: action.module || '账号权限', object: action.object || { name: '未指定成员' }, riskLevel: 'high', status: 'failed',
          before: action.before, after: action.after, recoverable: false, error: text(error.message), completedAt: this.now().toISOString(),
          toolId: action.toolId || '', taskId: action.taskId || '', stepId: action.stepId || '', conversationId: action.conversationId || '',
          permissionDecision: action.permissionDecision || null, confirmationHistory: action.confirmationHistory || [],
        }, database));
      } catch { /* Do not claim the external account action succeeded when auditing is unavailable. */ }
      const task = await this.finishActionTask(action, { status: 'failed', operationId: action.id, summary: text(error.message) || '账号服务暂时无法安全处理' });
      return { content: `未停用该成员：${text(error.message) || '账号服务暂时无法安全处理'}。系统不会把本次操作标记为已完成。`, provider: 'system', handled: true, task };
    }
  }

  async executeDocumentCategoryAction(action) {
    try {
      if (!this.aiFileTaskService?.applyCategoryDecision) throw new Error('档案分类执行服务未启用');
      const decision = await this.aiFileTaskService.applyCategoryDecision({
        fileId: action.fileId,
        action: action.type === 'document_category_create_and_archive' ? 'create-and-archive' : 'archive-existing',
        categoryName: action.categoryName,
      });
      const database = await this.databaseStore.read();
      const verification = this.verifyDatabaseAction(action, database);
      const operationId = text(decision?.file?.categoryDecision?.operationId);
      if (operationId) {
        await this.databaseStore.update((draft) => {
          const operation = (draft.aiAssistantOperations || []).find(item => text(item.id) === operationId);
          if (!operation) return null;
          operation.taskId = action.taskId || '';
          operation.stepId = action.stepId || '';
          operation.conversationId = action.conversationId || '';
          operation.permissionDecision = structuredClone(action.permissionDecision || null);
          operation.confirmationHistory = structuredClone(action.confirmationHistory || []);
          operation.verification = structuredClone(verification);
          return operation;
        });
      }
      const task = await this.finishActionTask(action, {
        status: verification.passed ? 'completed' : 'failed',
        operationId: operationId || action.id,
        verification,
        summary: verification.passed
          ? `${text(decision.message) || '档案归档完成'}；${verification.message}`
          : `归档服务已返回，但${verification.message}`,
      });
      this.pendingAction = null;
      return {
        content: verification.passed
          ? `${text(decision.message) || '档案归档完成'}系统已重新读取电子档案柜，确认分类和文件都已保存。`
          : `归档服务返回后未通过自动复核：${verification.message}。系统不会把本次操作标记为已完成，请刷新电子档案柜后核对。`,
        provider: 'system', handled: true, task, verification,
        data: { fileEntry: decision?.file || null, documentCategoryChanged: verification.passed, categoryName: action.categoryName },
        action: verification.passed ? { type: 'navigate', target: 'tab-documents', label: '电子档案柜' } : undefined,
      };
    } catch (error) {
      this.pendingAction = null;
      const reason = text(error.message) || '档案分类服务暂时无法安全处理';
      try {
        await this.databaseStore.update(async (database) => this.recordOperation({
          id: action.id,
          type: action.type,
          module: action.module || '电子档案柜',
          object: action.object,
          riskLevel: action.riskLevel,
          status: 'failed',
          before: action.before,
          after: action.after,
          recoverable: false,
          sourceFileId: action.fileId,
          toolId: action.toolId || '', taskId: action.taskId || '', stepId: action.stepId || '', conversationId: action.conversationId || '',
          permissionDecision: action.permissionDecision || null, confirmationHistory: action.confirmationHistory || [],
          error: reason,
          completedAt: this.now().toISOString(),
        }, database));
      } catch { /* 审计保存失败时仍不能误报归档成功。 */ }
      const task = await this.finishActionTask(action, { status: 'failed', operationId: action.id, summary: reason });
      return {
        content: `未完成本次归档：${reason}。系统没有把该文件标记为已归档，原文件仍保留，不会丢失。`,
        provider: 'system', handled: true, task,
        data: { documentCategoryChanged: false, categoryName: action.categoryName },
      };
    }
  }

  async executePendingAction() {
    const action = this.pendingAction;
    if (!action) return null;
    const permissionDecision = await this.authorizeControlledAction(action);
    action.permissionDecision = permissionDecision;
    if (!permissionDecision.allowed) {
      this.pendingAction = null;
      const task = await this.finishActionTask(action, { status: 'failed', summary: permissionDecision.reason || '执行前权限复核未通过', operationId: '' });
      return { content: `未执行本次操作：${permissionDecision.reason || '执行前权限复核未通过'}。系统数据没有变化。`, provider: 'system', handled: true, task };
    }
    if (action.type === 'database_backup_restore') return this.executeBackupRestoreAction(action);
    if (action.type === 'unit_member_disable') return this.executeMemberDisableAction(action);
    if (['document_category_assign', 'document_category_create_and_archive'].includes(action.type)) return this.executeDocumentCategoryAction(action);
    if (!['resident_phone_update', 'resident_address_update', 'resident_group_update', 'land_parcel_create', 'visit_record_create', 'duty_schedule_add', 'work_item_create', 'work_item_status_update', 'certificate_record_delete', 'document_draft_archive', 'party_member_stage_update', 'resource_contract_create', 'contract_receipt_create', 'finance_record_create', 'finance_record_update', 'finance_records_clear', 'settings_village_name_update', 'work_item_soft_delete', 'work_items_soft_delete_batch'].includes(action.type)) throw new Error('暂不支持该 AI 操作类型');
    try {
      const outcome = await this.databaseStore.update(async (database) => {
        let result;
        let operation;
        if (['resident_phone_update', 'resident_address_update', 'resident_group_update'].includes(action.type)) {
          const person = (database.personnel || []).find((item) => personId(item) === action.personId);
          if (!person) throw new Error('该居民档案已不存在，请重新确认后再操作');
          const valueKey = action.valueKey || 'phone';
          const currentValue = text(person[action.field]);
          if (currentValue !== action.before[valueKey]) throw new Error(`居民${action.fieldLabel || '档案字段'}已被其他操作修改，请重新查询后再确认`);
          person[action.field] = action.after[valueKey];
          person.updated_at = this.now().toISOString();
          result = { description: `修改${action.personName}的${action.fieldLabel || '档案字段'}` };
          operation = { module: '居民一户一档', object: { id: action.personId, name: action.personName, groupName: action.groupName }, field: action.field, fieldLabel: action.fieldLabel, valueKey: action.valueKey };
        } else if (action.type === 'land_parcel_create') {
          if (!Array.isArray(database.landParcel)) database.landParcel = [];
          const record = structuredClone(action.after.record);
          if (database.landParcel.some((item) => text(item.id) === text(record.id))) throw new Error('该地块已存在，请重新确认后再操作');
          if (record.parcel_code && database.landParcel.some((item) => text(item.parcel_code || item.parcelCode || item.code) === text(record.parcel_code))) throw new Error('地块编号已被其他记录使用，请重新核对后再确认');
          database.landParcel.unshift(record);
          result = { description: `登记地块“${record.parcel_name}”` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'visit_record_create') {
          if (!Array.isArray(database.visitRecords)) database.visitRecords = [];
          const record = structuredClone(action.after.record);
          if (database.visitRecords.some((item) => text(item.id) === text(record.id))) throw new Error('该民情记录已存在，请重新确认后再操作');
          database.visitRecords.push(record);
          result = { description: '新增民情记录' };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'duty_schedule_add') {
          if (!database.dutyFlexible || typeof database.dutyFlexible !== 'object') database.dutyFlexible = {};
          if (!database.dutyFlexible.schedule || typeof database.dutyFlexible.schedule !== 'object') database.dutyFlexible.schedule = {};
          const date = action.after.date;
          const currentNames = Array.isArray(database.dutyFlexible.schedule[date]) ? database.dutyFlexible.schedule[date] : [];
          if (JSON.stringify(currentNames) !== JSON.stringify(action.before.names)) throw new Error('该日期的值班安排已被其他操作修改，请重新查询后再确认');
          if ((dutySchedule(database)[date] || []).includes(action.object?.name)) throw new Error('该人员已被其他操作安排值班，请重新查询后再确认');
          database.dutyFlexible.schedule[date] = [...action.after.names];
          result = { description: `安排${action.object?.name || '该人员'}值班` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'work_item_status_update') {
          const work = (database.workItems || []).find((item) => text(item.id) === text(action.object?.id));
          if (!work || work.deletedAt) throw new Error('该工作事项已不存在或已移入可恢复区，请重新查询后再确认');
          if (text(work.status) !== text(action.before?.status) || text(work.updatedAt) !== text(action.before?.updatedAt)) {
            throw new Error('该工作事项已被其他操作修改，请重新查询后再确认');
          }
          work.status = action.after.status;
          work.updatedAt = action.after.updatedAt;
          result = { description: `调整工作“${text(action.object?.name) || '未命名'}”的状态` };
          operation = { module: action.module, object: action.object, field: action.field, fieldLabel: action.fieldLabel, valueKey: action.valueKey };
        } else if (action.type === 'certificate_record_delete') {
          const beforeRecord = action.before?.record;
          const index = (database.certificates || []).findIndex((item) => certificateCode(item) === certificateCode(beforeRecord));
          if (index < 0) throw new Error('该证明记录已不存在，请重新查询后再确认');
          if (JSON.stringify(database.certificates[index]) !== JSON.stringify(beforeRecord)) throw new Error('该证明记录已被其他操作修改，请重新查询后再确认');
          database.certificates.splice(index, 1);
          result = { description: `删除证明记录“${certificateCode(beforeRecord) || '未编号'}”` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'document_draft_archive') {
          const document = (database.documentDrafts || []).find((item) => text(item.id) === text(action.object?.id));
          if (!document) throw new Error('该公文已不存在，请重新查询后再确认');
          const before = action.before || {};
          if (text(document.archivedAt) !== text(before.archivedAt) || text(document.updatedAt) !== text(before.updatedAt) || text(document.currentVersionId) !== text(before.currentVersionId)) {
            throw new Error('该公文已被其他操作修改，请重新查询后再确认');
          }
          document.archivedAt = action.after.archivedAt;
          document.updatedAt = action.after.updatedAt;
          result = { description: `归档公文“${text(document.title) || '未命名'}”` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'party_member_stage_update') {
          const member = (database.partyMembers || []).find((item) => text(item.id || item.personId || item.person_id || item.idCard || item.id_card) === text(action.object?.id));
          if (!member) throw new Error('该党员档案已不存在，请重新查询后再确认');
          if (text(member[action.field]) !== text(action.before?.stage)) throw new Error('该党员阶段已被其他操作修改，请重新查询后再确认');
          member[action.field] = action.after.stage;
          member.updated_at = this.now().toISOString();
          result = { description: `调整${action.object?.name || '该党员'}的党员阶段` };
          operation = { module: action.module, object: action.object, field: action.field, fieldLabel: action.fieldLabel, valueKey: action.valueKey };
        } else if (action.type === 'resource_contract_create') {
          if (!Array.isArray(database.resourceContracts)) database.resourceContracts = [];
          const record = structuredClone(action.after.record);
          if (database.resourceContracts.some((item) => text(item.id) === text(record.id))) throw new Error('该合同已存在，请重新确认后再操作');
          if (record.contractNumber && database.resourceContracts.some((item) => text(item.contractNumber) === text(record.contractNumber))) throw new Error('合同编号已被其他操作使用，请重新核对后再确认');
          database.resourceContracts.unshift(record);
          result = { description: `新建合同“${record.name}”` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'contract_receipt_create') {
          if (!Array.isArray(database.contractFeeReceipts)) database.contractFeeReceipts = [];
          const receipt = structuredClone(action.after.receipt);
          if (database.contractFeeReceipts.some((item) => text(item.id) === text(receipt.id) || text(item.contractId) === text(receipt.contractId))) throw new Error('该合同已登记到账记录，请重新查询后再确认');
          const contract = (database.resourceContracts || []).find((item) => text(item.id) === text(receipt.contractId));
          if (!contract) throw new Error('对应合同已不存在，请重新查询后再确认');
          if (cents(contract.amountCents) !== cents(receipt.amountCents)) throw new Error('合同应缴金额已变化，请重新核对后再确认');
          database.contractFeeReceipts.push(receipt);
          result = { description: `登记合同“${action.object?.name || '未命名'}”的承包人到账` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'finance_record_create') {
          if (!Array.isArray(database.finances)) database.finances = [];
          const record = structuredClone(action.after.record);
          if (database.finances.some((item) => text(item.id) === text(record.id))) throw new Error('该财务记录已存在，请重新确认后再操作');
          database.finances.unshift(record);
          result = { description: `登记财务${record.type === 'income' ? '收入' : '支出'}“${record.summary}”` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'finance_record_update') {
          const beforeRecord = action.before?.record;
          const index = (database.finances || []).findIndex((item) => financeVoucherNumber(item) === financeVoucherNumber(beforeRecord));
          if (index < 0) throw new Error('该财务记录已不存在，请重新查询后再确认');
          if (JSON.stringify(database.finances[index]) !== JSON.stringify(beforeRecord)) throw new Error('该财务记录已被其他操作修改，请重新查询后再确认');
          const afterRecord = structuredClone(action.after.record);
          if (financeVoucherNumber(afterRecord) !== financeVoucherNumber(beforeRecord)
            && (database.finances || []).some((item, itemIndex) => itemIndex !== index && financeVoucherNumber(item) === financeVoucherNumber(afterRecord))) {
            throw new Error('新的凭证号已被其他财务记录使用，请重新确认后再操作');
          }
          database.finances[index] = afterRecord;
          result = { description: `修改财务记录“${financeVoucherNumber(beforeRecord)}”` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'finance_records_clear') {
          const beforeRecords = action.before?.records || [];
          if (!beforeRecords.length) throw new Error('财务收支台账快照为空，请重新查询后再确认');
          if (JSON.stringify(database.finances || []) !== JSON.stringify(beforeRecords)) throw new Error('财务收支台账已被其他操作修改。为避免误清空，本次操作不会执行');
          database.finances = [];
          result = { description: `清空财务收支台账中的 ${beforeRecords.length} 笔记录` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'settings_village_name_update') {
          if (!database.settings || typeof database.settings !== 'object') database.settings = {};
          if (text(database.settings.villageName) !== text(action.before?.villageName)) throw new Error('社区名称已被其他操作修改，请重新查询后再确认');
          database.settings.villageName = action.after.villageName;
          result = { description: '修改社区名称' };
          operation = { module: action.module, object: action.object, field: action.field, fieldLabel: action.fieldLabel, valueKey: action.valueKey };
        } else if (action.type === 'work_item_soft_delete') {
          const beforeRecord = action.before?.record;
          const index = (database.workItems || []).findIndex((item) => text(item.id) === text(beforeRecord?.id));
          if (index < 0) throw new Error('该工作事项已不存在，请重新查询后再确认');
          if (JSON.stringify(database.workItems[index]) !== JSON.stringify(beforeRecord)) throw new Error('该工作事项已被其他操作修改，请重新查询后再确认');
          database.workItems[index] = structuredClone(action.after.record);
          result = { description: `删除工作“${text(action.object?.name) || '未命名'}”并移入可恢复区` };
          operation = { module: action.module, object: action.object };
        } else if (action.type === 'work_items_soft_delete_batch') {
          const beforeRecords = action.before?.records || [];
          const afterRecords = action.after?.records || [];
          if (!beforeRecords.length || beforeRecords.length !== afterRecords.length) throw new Error('批量删除数据不完整，请重新确认后再操作');
          const indexes = beforeRecords.map((record) => (database.workItems || []).findIndex((item) => text(item.id) === text(record.id)));
          if (indexes.some((index) => index < 0)) throw new Error('其中至少一项工作已不存在，请重新查询后再确认');
          if (indexes.some((index, position) => JSON.stringify(database.workItems[index]) !== JSON.stringify(beforeRecords[position]))) {
            throw new Error('其中至少一项工作已被其他操作修改。为避免只删一部分，本批操作不会执行');
          }
          indexes.forEach((index, position) => { database.workItems[index] = structuredClone(afterRecords[position]); });
          result = { description: `批量删除 ${beforeRecords.length} 项工作并移入可恢复区` };
          operation = { module: action.module, object: action.object };
        } else {
          if (!Array.isArray(database.workItems)) database.workItems = [];
          const record = structuredClone(action.after.record);
          if (database.workItems.some((item) => text(item.id) === text(record.id))) throw new Error('该工作事项已存在，请重新确认后再操作');
          record.number = createWorkNumber(database.workItems, this.now());
          database.workItems.unshift(record);
          action.after = { record: structuredClone(record) };
          result = { description: `新建工作“${record.name}”` };
          operation = { module: action.module, object: action.object };
        }
        await this.recordOperation({
          id: action.id,
          type: action.type,
          ...operation,
          riskLevel: action.riskLevel,
          status: 'completed',
          before: action.before,
          after: action.after,
          recoverable: true,
          completedAt: this.now().toISOString(),
        }, database);
        return result;
      });
      const verification = await this.verifyCompletedAction(action);
      await this.updateOperationVerification(action, verification);
      const task = await this.finishActionTask(action, {
        status: verification.passed ? 'completed' : 'failed', operationId: action.id, verification,
        summary: verification.passed ? `${outcome.result.description}；${verification.message}` : `${outcome.result.description}，但${verification.message}`,
      });
      this.pendingAction = null;
      return {
        content: verification.passed
          ? `已${outcome.result.description}，自动复核已通过，并已写入 AI 助理记录。需要恢复时，请到“AI 助理记录”中手动撤销。`
          : `已执行“${outcome.result.description}”，但${verification.message}。请先人工核对，不要继续依赖该结果。`,
        provider: 'system', handled: true, task, verification,
      };
    } catch (error) {
      this.pendingAction = null;
      try {
        await this.databaseStore.update(async (database) => this.recordOperation({
          id: action.id,
          type: action.type,
          module: action.module || '居民一户一档',
          object: action.object || { id: action.personId, name: action.personName, groupName: action.groupName },
          riskLevel: action.riskLevel,
          status: 'failed',
          field: action.field,
          fieldLabel: action.fieldLabel,
          valueKey: action.valueKey,
          before: action.before,
          after: action.after,
          recoverable: false,
          toolId: action.toolId || '', taskId: action.taskId || '', stepId: action.stepId || '', conversationId: action.conversationId || '',
          permissionDecision: action.permissionDecision || null, confirmationHistory: action.confirmationHistory || [],
          error: text(error.message),
          completedAt: this.now().toISOString(),
        }, database));
      } catch { /* A storage outage may also prevent auditing; do not pretend the action succeeded. */ }
      const task = await this.finishActionTask(action, { status: 'failed', operationId: action.id, summary: text(error.message) || '系统暂时无法保存本次操作' });
      return { content: `未执行本次操作：${text(error.message) || '系统暂时无法保存本次操作'}。系统数据没有按本次指令继续修改。`, provider: 'system', handled: true, task };
    }
  }

  async confirmPendingAction(message) {
    const action = this.pendingAction;
    if (!action) return null;
    const value = text(message);
    if (/^(取消|不执行|算了|不要)$/u.test(value)) return this.cancelPendingAction();
    if (action.confirmationsRequired === 2) {
      if (action.confirmationStep === 0 && /^(继续执行|继续|确认|同意|好的|可以)$/u.test(value)) {
        action.confirmationStep = 1;
        const task = await this.recordActionConfirmation(action, '第一次确认');
        return {
          content: `已记录第一次确认。请再次核对：${this.actionPreview({ ...action, confirmationsRequired: 1 })} 这次请回复“确认执行”才会真正执行。`,
          provider: 'system', handled: true, needsConfirmation: true,
          task,
          action: { type: 'confirm', riskLevel: 'high', confirmationsRequired: 2, confirmationStep: 1, before: action.before, after: action.after },
        };
      }
      if (action.confirmationStep === 1 && /^(确认执行|确认)$/u.test(value)) {
        action.confirmationStep = 2;
        await this.recordActionConfirmation(action, '最终确认');
        return this.executePendingAction();
      }
      return { content: '这是高风险操作。请回复“继续执行”进行第一次确认，或回复“取消”放弃本次操作。', provider: 'system', handled: true, needsConfirmation: true };
    }
    if (/^(确认|同意|执行|好的|可以)$/u.test(value)) {
      action.confirmationStep = 1;
      await this.recordActionConfirmation(action, '执行确认');
      return this.executePendingAction();
    }
    return { content: '请回复“确认”执行，或回复“取消”放弃本次操作。', provider: 'system', handled: true, needsConfirmation: true };
  }

  async cancelPendingAction() {
    if (!this.pendingAction) return null;
    const action = this.pendingAction;
    if (action.riskLevel === 'high') {
      await this.databaseStore.update(async (database) => this.recordOperation({
        id: action.id, type: action.type, module: action.module || 'AI 助理', object: action.object || { name: action.personName || '未指定对象' }, riskLevel: 'high', status: 'cancelled', before: action.before, after: action.after, recoverable: false,
        toolId: action.toolId || '', taskId: action.taskId || '', stepId: action.stepId || '', permissionDecision: action.permissionDecision || null,
        confirmationHistory: action.confirmationHistory || [],
      }, database));
    }
    const task = await this.finishActionTask(action, { status: 'cancelled', summary: '用户取消，未修改系统数据', operationId: action.riskLevel === 'high' ? action.id : '' });
    this.pendingAction = null;
    return { content: '已取消，本次操作没有修改系统数据。', provider: 'system', handled: true, task };
  }

  async listOperations({ limit = 100 } = {}) {
    const database = await this.databaseStore.read();
    return [...(database.aiAssistantOperations || [])]
      .sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  async undoBackupRestoreOperation(operationId) {
    const current = await this.databaseStore.read();
    const operation = (current.aiAssistantOperations || []).find((item) => item.id === operationId);
    if (!operation) throw new Error('未找到该 AI 操作记录');
    if (!operation.recoverable || operation.status !== 'completed') throw new Error('该记录当前不能撤销');
    const restoredFingerprint = text(operation.after?.restoredFingerprint);
    const safeguardBackupName = text(operation.before?.safeguardBackupName);
    if (!restoredFingerprint || !safeguardBackupName) throw new Error('该备份恢复记录缺少安全恢复信息，不能自动撤销');
    if (databaseFingerprint(current) !== restoredFingerprint) throw new Error('恢复备份后系统数据已被其他操作修改，不能自动撤销，请人工核对');
    if (typeof this.databaseStore.restoreBackup !== 'function') throw new Error('当前数据服务不支持安全撤销备份恢复');
    const original = structuredClone(operation);
    const undoneAt = this.now().toISOString();
    await this.databaseStore.restoreBackup({ name: safeguardBackupName }, {
      transform: async (database) => {
        await this.recordOperation({
          ...original, status: 'undone', undoneAt, undoable: false, recoverable: false,
        }, database);
        await this.recordOperation({
          type: 'undo', module: original.module, object: original.object, riskLevel: 'high', status: 'completed',
          before: original.after, after: original.before, recoverable: false, completedAt: undoneAt, undoneOperationId: original.id,
        }, database);
      },
    });
    return { ok: true, message: `已撤销备份恢复“${text(operation.object?.name) || '未指定备份'}”，系统已恢复到本次操作之前的状态。` };
  }

  async undoMemberDisableOperation(operationId) {
    if (typeof this.authService?.listUnitMembers !== 'function' || typeof this.authService?.updateMemberStatus !== 'function') throw new Error('当前账号服务不支持恢复成员');
    const current = await this.databaseStore.read();
    const operation = (current.aiAssistantOperations || []).find((item) => item.id === operationId);
    if (!operation) throw new Error('未找到该 AI 操作记录');
    if (!operation.recoverable || operation.status !== 'completed') throw new Error('该记录当前不能撤销');
    const members = await this.authService.listUnitMembers();
    const member = (Array.isArray(members) ? members : []).find((item) => text(item?.id) === text(operation.object?.id) && text(item?.phone) === text(operation.object?.phone));
    if (!member) throw new Error('该成员已不存在或当前账号无权查看，不能自动恢复');
    if (member.isActive !== operation.after?.isActive) throw new Error('该成员状态后来已被其他管理员修改，不能自动恢复，请人工核对');
    await this.authService.updateMemberStatus({ memberId: operation.object.id, isActive: true });
    try {
      await this.databaseStore.update(async (database) => {
        const original = (database.aiAssistantOperations || []).find((item) => item.id === operationId);
        if (!original || !original.recoverable || original.status !== 'completed') throw new Error('该操作记录已发生变化，不能自动恢复');
        original.status = 'undone'; original.undoneAt = this.now().toISOString(); original.undoable = false;
        await this.recordOperation({
          type: 'undo', module: original.module, object: original.object, riskLevel: 'high', status: 'completed', before: original.after,
          after: original.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: original.id,
        }, database);
      });
    } catch (error) {
      try { await this.authService.updateMemberStatus({ memberId: operation.object.id, isActive: false }); } catch { /* Keep the authority service authoritative if compensating rollback fails. */ }
      throw new Error(`恢复后的审计记录无法保存，已请求重新停用该成员：${text(error.message) || '审计存储失败'}`);
    }
    return { ok: true, message: `已恢复成员“${text(operation.object?.name) || text(operation.object?.phone)}”的登录权限。` };
  }

  async undoOperation({ operationId } = {}) {
    const id = text(operationId);
    if (!id) throw new Error('请选择需要撤销的操作记录');
    const current = await this.databaseStore.read();
    const restoreOperation = (current.aiAssistantOperations || []).find((item) => item.id === id);
    if (restoreOperation?.type === 'database_backup_restore') {
      const result = await this.undoBackupRestoreOperation(id);
      result.task = await this.markOperationTaskUndone(restoreOperation, result.message);
      return result;
    }
    if (restoreOperation?.type === 'unit_member_disable') {
      const result = await this.undoMemberDisableOperation(id);
      result.task = await this.markOperationTaskUndone(restoreOperation, result.message);
      return result;
    }
    if (['document_category_assign', 'document_category_create_and_archive'].includes(restoreOperation?.type)) {
      if (!this.aiFileTaskService?.undoCategoryDecision) throw new Error('当前文件任务服务不支持撤销档案分类');
      const result = await this.aiFileTaskService.undoCategoryDecision({ fileId: restoreOperation.sourceFileId });
      result.task = await this.markOperationTaskUndone(restoreOperation, result.message);
      return result;
    }
    if (restoreOperation?.type === 'certificate_template_draft_create') {
      if (!this.aiFileTaskService?.undoCertificateTemplateDecision) throw new Error('当前文件任务服务不支持撤销模板草稿');
      const result = await this.aiFileTaskService.undoCertificateTemplateDecision({ operationId: id });
      result.task = await this.markOperationTaskUndone(restoreOperation, result.message);
      return result;
    }
    const outcome = await this.databaseStore.update(async (database) => {
      const operation = (database.aiAssistantOperations || []).find((item) => item.id === id);
      if (!operation) throw new Error('未找到该 AI 操作记录');
      if (!operation.recoverable || operation.status !== 'completed') throw new Error('该记录当前不能撤销');
      if (operation.type === 'land_parcel_create') {
        const created = operation.after?.record;
        const index = (database.landParcel || []).findIndex((item) => text(item.id) === text(created?.id));
        if (index < 0) throw new Error('对应地块已不存在，不能自动撤销');
        if (JSON.stringify(database.landParcel[index]) !== JSON.stringify(created)) throw new Error('该地块后来已被修改，不能自动撤销，请人工核对');
        database.landParcel.splice(index, 1);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `地块“${text(operation.object?.name) || '未命名'}”` };
      }
      if (operation.type === 'visit_record_create') {
        const created = operation.after?.record;
        const index = (database.visitRecords || []).findIndex((item) => text(item.id) === text(created?.id));
        if (index < 0) throw new Error('对应民情记录已不存在，不能自动撤销');
        if (JSON.stringify(database.visitRecords[index]) !== JSON.stringify(created)) throw new Error('该民情记录后来已被修改，不能自动撤销，请人工核对');
        database.visitRecords.splice(index, 1);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: text(operation.object?.name) || '该民情记录' };
      }
      if (operation.type === 'duty_schedule_add') {
        const date = text(operation.after?.date);
        const schedule = database.dutyFlexible?.schedule;
        if (!date || !schedule || typeof schedule !== 'object') throw new Error('对应值班安排已不存在，不能自动撤销');
        const currentNames = Array.isArray(schedule[date]) ? schedule[date] : [];
        if (JSON.stringify(currentNames) !== JSON.stringify(operation.after?.names || [])) throw new Error('该日期的值班安排后来已被修改，不能自动撤销，请人工核对');
        if ((operation.before?.names || []).length) schedule[date] = [...operation.before.names];
        else delete schedule[date];
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `${date} 的${text(operation.object?.name) || '值班人员'}安排` };
      }
      if (operation.type === 'work_item_create') {
        const created = operation.after?.record;
        const index = (database.workItems || []).findIndex((item) => text(item.id) === text(created?.id));
        if (index < 0) throw new Error('对应工作事项已不存在，不能自动撤销');
        if (JSON.stringify(database.workItems[index]) !== JSON.stringify(created)) throw new Error('该工作事项后来已被修改，不能自动撤销，请人工核对');
        database.workItems.splice(index, 1);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `工作“${text(operation.object?.name) || '未命名'}”` };
      }
      if (operation.type === 'work_item_status_update') {
        const work = (database.workItems || []).find((item) => text(item.id) === text(operation.object?.id));
        if (!work || work.deletedAt) throw new Error('对应工作事项已不存在或已移入可恢复区，不能自动撤销');
        if (text(work.status) !== text(operation.after?.status) || text(work.updatedAt) !== text(operation.after?.updatedAt)) {
          throw new Error('该工作事项后来已被修改，不能自动撤销，请人工核对');
        }
        work.status = text(operation.before?.status);
        work.updatedAt = text(operation.before?.updatedAt);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `工作“${text(operation.object?.name) || '未命名'}”的状态` };
      }
      if (operation.type === 'certificate_record_delete') {
        const deleted = operation.after?.record;
        if (!Array.isArray(database.certificates)) throw new Error('证明记录台账已不存在，不能自动撤销');
        if (database.certificates.some((item) => certificateCode(item) === certificateCode(deleted))) throw new Error('该证明记录已被重新登记或修改，不能自动撤销，请人工核对');
        database.certificates.push(structuredClone(deleted));
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'high', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `证明记录“${certificateCode(deleted) || '未编号'}”` };
      }
      if (operation.type === 'document_draft_archive') {
        const document = (database.documentDrafts || []).find((item) => text(item.id) === text(operation.object?.id));
        if (!document) throw new Error('对应公文已不存在，不能自动撤销');
        if (text(document.archivedAt) !== text(operation.after?.archivedAt) || text(document.updatedAt) !== text(operation.after?.updatedAt) || text(document.currentVersionId) !== text(operation.after?.currentVersionId)) {
          throw new Error('该公文后来已被修改，不能自动撤销，请人工核对');
        }
        document.archivedAt = operation.before?.archivedAt || null;
        document.updatedAt = operation.before?.updatedAt || this.now().toISOString();
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `公文“${text(operation.object?.name) || '未命名'}”归档` };
      }
      if (operation.type === 'party_member_stage_update') {
        const member = (database.partyMembers || []).find((item) => text(item.id || item.personId || item.person_id || item.idCard || item.id_card) === text(operation.object?.id));
        if (!member) throw new Error('对应党员档案已不存在，不能自动撤销');
        if (text(member[operation.field]) !== text(operation.after?.stage)) throw new Error('该党员阶段后来已被修改，不能自动撤销，请人工核对');
        member[operation.field] = text(operation.before?.stage);
        member.updated_at = this.now().toISOString();
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `${text(operation.object?.name) || '该党员'}的党员阶段` };
      }
      if (operation.type === 'resource_contract_create') {
        const created = operation.after?.record;
        const index = (database.resourceContracts || []).findIndex((item) => text(item.id) === text(created?.id));
        if (index < 0) throw new Error('对应合同已不存在，不能自动撤销');
        if (JSON.stringify(database.resourceContracts[index]) !== JSON.stringify(created)) throw new Error('该合同后来已被修改，不能自动撤销，请人工核对');
        database.resourceContracts.splice(index, 1);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `合同“${text(operation.object?.name) || '未命名'}”` };
      }
      if (operation.type === 'contract_receipt_create') {
        const created = operation.after?.receipt;
        const index = (database.contractFeeReceipts || []).findIndex((item) => text(item.id) === text(created?.id));
        if (index < 0) throw new Error('对应到账记录已不存在，不能自动撤销');
        if (JSON.stringify(database.contractFeeReceipts[index]) !== JSON.stringify(created)) throw new Error('该到账记录后来已被修改，不能自动撤销，请人工核对');
        database.contractFeeReceipts.splice(index, 1);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `合同“${text(operation.object?.name) || '未命名'}”的到账记录` };
      }
      if (operation.type === 'finance_record_create') {
        const created = operation.after?.record;
        const index = (database.finances || []).findIndex((item) => text(item.id) === text(created?.id));
        if (index < 0) throw new Error('对应财务记录已不存在，不能自动撤销');
        if (JSON.stringify(database.finances[index]) !== JSON.stringify(created)) throw new Error('该财务记录后来已被修改，不能自动撤销，请人工核对');
        database.finances.splice(index, 1);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `财务${created?.type === 'income' ? '收入' : '支出'}“${text(created?.summary) || '未命名'}”` };
      }
      if (operation.type === 'finance_record_update') {
        const beforeRecord = operation.before?.record;
        const afterRecord = operation.after?.record;
        const index = (database.finances || []).findIndex((item) => financeVoucherNumber(item) === financeVoucherNumber(afterRecord));
        if (index < 0) throw new Error('对应财务记录已不存在，不能自动撤销');
        if (JSON.stringify(database.finances[index]) !== JSON.stringify(afterRecord)) throw new Error('该财务记录后来已被修改，不能自动撤销，请人工核对');
        if (financeVoucherNumber(beforeRecord) !== financeVoucherNumber(afterRecord)
          && (database.finances || []).some((item, itemIndex) => itemIndex !== index && financeVoucherNumber(item) === financeVoucherNumber(beforeRecord))) {
          throw new Error('原凭证号已被其他财务记录使用，不能自动撤销，请人工核对');
        }
        database.finances[index] = structuredClone(beforeRecord);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `财务记录“${financeVoucherNumber(beforeRecord) || '未编号'}”` };
      }
      if (operation.type === 'finance_records_clear') {
        const beforeRecords = operation.before?.records || [];
        if (!beforeRecords.length) throw new Error('财务收支台账快照为空，不能自动撤销');
        if ((database.finances || []).length) throw new Error('清空后财务收支台账已新增或恢复记录，不能自动撤销，请人工核对');
        database.finances = structuredClone(beforeRecords);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'high', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `财务收支台账 ${beforeRecords.length} 笔记录` };
      }
      if (operation.type === 'settings_village_name_update') {
        if (!database.settings || typeof database.settings !== 'object') throw new Error('系统设置不存在，不能自动撤销');
        if (text(database.settings.villageName) !== text(operation.after?.villageName)) throw new Error('社区名称后来已被修改，不能自动撤销，请人工核对');
        database.settings.villageName = text(operation.before?.villageName);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: '社区名称' };
      }
      if (operation.type === 'work_item_soft_delete') {
        const beforeRecord = operation.before?.record;
        const index = (database.workItems || []).findIndex((item) => text(item.id) === text(beforeRecord?.id));
        if (index < 0) throw new Error('对应工作事项已不存在，不能自动撤销');
        if (JSON.stringify(database.workItems[index]) !== JSON.stringify(operation.after?.record)) throw new Error('该工作事项后来已被修改，不能自动撤销，请人工核对');
        database.workItems[index] = structuredClone(beforeRecord);
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `工作“${text(operation.object?.name) || '未命名'}”` };
      }
      if (operation.type === 'work_items_soft_delete_batch') {
        const beforeRecords = operation.before?.records || [];
        const afterRecords = operation.after?.records || [];
        if (!beforeRecords.length || beforeRecords.length !== afterRecords.length) throw new Error('批量删除记录不完整，不能自动撤销');
        const indexes = afterRecords.map((record) => (database.workItems || []).findIndex((item) => text(item.id) === text(record.id)));
        if (indexes.some((index) => index < 0)) throw new Error('其中至少一项工作已不存在，不能自动撤销');
        if (indexes.some((index, position) => JSON.stringify(database.workItems[index]) !== JSON.stringify(afterRecords[position]))) {
          throw new Error('其中至少一项工作后来已被修改，不能自动撤销，请人工核对');
        }
        indexes.forEach((index, position) => { database.workItems[index] = structuredClone(beforeRecords[position]); });
        operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
        await this.recordOperation({
          type: 'undo', module: operation.module, object: operation.object, riskLevel: 'high', status: 'completed',
          before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
        }, database);
        return { name: `${beforeRecords.length} 项工作` };
      }
      if (!['resident_phone_update', 'resident_address_update', 'resident_group_update'].includes(operation.type)) throw new Error('该操作类型暂不支持撤销');
      const person = (database.personnel || []).find((item) => personId(item) === text(operation.object?.id));
      if (!person) throw new Error('对应居民档案已不存在，不能自动撤销');
      const valueKey = operation.valueKey || 'phone';
      const field = operation.field || (valueKey === 'phone' ? (Object.prototype.hasOwnProperty.call(person, 'phone') ? 'phone'
        : Object.prototype.hasOwnProperty.call(person, 'mobile_phone') ? 'mobile_phone'
          : Object.prototype.hasOwnProperty.call(person, 'mobilePhone') ? 'mobilePhone' : 'phone') : valueKey);
      if (text(person[field]) !== text(operation.after?.[valueKey])) throw new Error(`该${operation.fieldLabel || '档案字段'}后来又被修改，不能自动撤销，请人工核对`);
      person[field] = text(operation.before?.[valueKey]);
      person.updated_at = this.now().toISOString();
      operation.status = 'undone'; operation.undoneAt = this.now().toISOString(); operation.undoable = false;
      await this.recordOperation({
        type: 'undo', module: operation.module, object: operation.object, riskLevel: 'normal', status: 'completed',
        before: operation.after, after: operation.before, recoverable: false, completedAt: this.now().toISOString(), undoneOperationId: operation.id,
      }, database);
      return { name: text(operation.object?.name) };
    });
    const message = `已撤销${outcome.result.name || '该操作'}。`;
    const task = await this.markOperationTaskUndone(restoreOperation, message);
    return { ok: true, message, task };
  }

  async answerDirectQuestion(database, message) {
    if (!isPaymentQuestion(message)) return null;
    const year = this.resolveYear(message);
    const allYears = !year && isAllYearsPaymentRequest(message);
    if (!year && !allYears) return { content: '请告诉我需要查询哪一年；如果要查询全部年份，可以说“历年某位居民共计发了多少钱？”，并填入档案中的真实姓名。查询范围不明确时，我不会自行猜测。', provider: 'system', handled: true, needsConfirmation: true };
    const paidRecords = this.collectPaidPayments(database, { year });
    if (/(哪个|哪一个).{0,12}(组|村民组).{0,12}(发放|实发|已发).{0,12}(最多|最高)|(发放|实发|已发).{0,12}(最多|最高).{0,12}(组|村民组)/u.test(text(message))) {
      const pendingRecords = this.collectUnpaidPayments(database, { year });
      return {
        content: this.formatHighestGroupAnswer(year, paidRecords, { allYears }), provider: 'system', handled: true,
        data: {
          year, allYears,
          records: paidRecords,
          queryEvidence: this.buildPaymentEvidence({ year, allYears, subject: '各村民组', scope: '通用发放批次和合同发放批次；实发合计仅统计已发放记录', paidRecords, pendingRecords }),
        },
      };
    }
    const groupName = this.specifiedGroup(database, message);
    const categoryName = this.specifiedCategory(database, message);
    const resolved = this.resolveRecipient(database, message);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要查询哪一位：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    if (resolved.kind === 'missing' && groupName) {
      const records = this.collectPaidPayments(database, { year, groupName, categoryName });
      const pendingRecords = this.collectUnpaidPayments(database, { year, groupName, categoryName });
      const qualifier = categoryName ? `${groupName}${categoryName}` : groupName;
      return {
        content: this.formatAggregateAnswer({ year, allYears, records, subject: `“${qualifier}”`, scope: '通用发放批次和合同发放批次' }), provider: 'system', handled: true,
        data: {
          year, allYears, groupName, categoryName, records,
          queryEvidence: this.buildPaymentEvidence({ year, allYears, subject: `“${qualifier}”`, scope: '通用发放批次和合同发放批次；实发合计仅统计已发放记录', paidRecords: records, pendingRecords }),
        },
      };
    }
    if (resolved.kind === 'missing' && categoryName) {
      const records = this.collectPaidPayments(database, { year, categoryName });
      const pendingRecords = this.collectUnpaidPayments(database, { year, categoryName });
      return {
        content: this.formatAggregateAnswer({ year, allYears, records, subject: `“${categoryName}”`, scope: '通用发放批次和合同发放批次' }), provider: 'system', handled: true,
        data: {
          year, allYears, categoryName, records,
          queryEvidence: this.buildPaymentEvidence({ year, allYears, subject: `“${categoryName}”`, scope: '通用发放批次和合同发放批次；实发合计仅统计已发放记录', paidRecords: records, pendingRecords }),
        },
      };
    }
    if (resolved.kind === 'missing') return { content: '我没有识别出要查询的人员、村民组或资金类别。请补充其中一个对象；如果有同名人员，请同时说明村民小组。', provider: 'system', handled: true, needsConfirmation: true };
    const records = this.collectPaidPayments(database, { recipient: resolved.recipient, year, categoryName });
    const pendingRecords = this.collectUnpaidPayments(database, { recipient: resolved.recipient, year, categoryName });
    return {
      content: this.formatAnnualAnswer({
        recipient: resolved.recipient,
        records,
        year,
        allYears,
        subsidyNotice: this.subsidyLedgerNotice(database, resolved.recipient, year),
      }),
      provider: 'system',
      handled: true,
      data: {
        year, allYears, recipient: resolved.recipient, records,
        queryEvidence: this.buildPaymentEvidence({
          year,
          allYears,
          subject: `“${resolved.recipient.name}”`,
          scope: '通用发放批次和合同发放批次，按实际登记的发放日期计入；实发合计仅统计已发放记录',
          paidRecords: records,
          pendingRecords,
        }),
      },
    };
  }

  answerPendingFundingQuestion(database, message) {
    const requested = text(message);
    if (!/(待发(?:放)?|尚未发放|未发放|未登记发放)/u.test(requested)) return null;
    if (!/(资金|发放|承包费|工资|补贴|款)/u.test(requested) || !/(多少|几笔|金额|合计|总额)/u.test(requested)) return null;
    const year = this.resolveYear(requested);
    const allYears = !year && isAllYearsPaymentRequest(requested);
    if (!year && !allYears) return { content: '请告诉我需要查询哪一年；如果要查询全部年份，可以说“历年还有多少待发资金？”。查询范围不明确时，我不会自行猜测。', provider: 'system', handled: true, needsConfirmation: true };
    const groupName = this.specifiedGroup(database, requested);
    const categoryName = this.specifiedCategory(database, requested);
    const resolved = this.resolveRecipient(database, requested);
    if (resolved.kind === 'ambiguous') {
      const choices = resolved.candidates.map((candidate) => `${candidate.name}${candidate.groupName ? `（${candidate.groupName}）` : ''}`).join('、');
      return { content: `系统中有多位同名人员，请确认要查询哪一位：${choices}。`, provider: 'system', handled: true, needsConfirmation: true };
    }
    const recipient = resolved.kind === 'resident' || resolved.kind === 'temporary' ? resolved.recipient : null;
    const records = this.collectUnpaidPayments(database, { recipient, year, groupName, categoryName });
    const subject = recipient ? `“${recipient.name}”`
      : groupName && categoryName ? `“${groupName}${categoryName}”`
        : groupName ? `“${groupName}”`
          : categoryName ? `“${categoryName}”` : '全部';
    return {
      content: this.formatPendingFundingAnswer({ year, allYears, records, subject, scope: '资金发放中心的通用发放批次和合同发放批次' }),
      provider: 'system', handled: true,
      data: {
        year, allYears, recipient, groupName, categoryName, records,
        queryEvidence: this.buildPaymentEvidence({
          year,
          allYears,
          subject,
          scope: '资金发放中心的通用发放批次和合同发放批次；本卡仅显示尚未登记为已发放的记录',
          pendingRecords: records,
        }),
      },
    };
  }

  async converse({ messages, conversationId = '', conversationSummary = '', attachmentIds = [] } = {}) {
    let userMessage = lastUserMessage(messages);
    if (!userMessage) throw new Error('请先输入需要办理或查询的事项');
    const attachedFiles = await this.attachedFiles(conversationId, attachmentIds).catch(() => []);
    if (attachedFiles.length) {
      const fileAnswer = this.fileRecognitionAnswer(attachedFiles);
      const latestFileTask = await this.taskService.list({ conversationId, limit: 20 })
        .then(tasks => tasks.find(task => task.taskKind === 'file-recognition' && (task.artifactIds || []).some(id => attachmentIds.includes(id))))
        .catch(() => null);
      if (latestFileTask) fileAnswer.task = latestFileTask;
      return fileAnswer;
    }
    const memoryResult = await this.handleMemoryCommand(userMessage.content);
    if (memoryResult) return memoryResult;
    if (this.pendingOnlineAnalysis) return this.confirmOnlineAnalysis(userMessage.content);
    if (this.pendingAction && text(this.pendingAction.conversationId) && text(conversationId)
      && text(this.pendingAction.conversationId) !== text(conversationId)) this.pendingAction = null;
    let activeTask = text(conversationId) ? await this.taskService.latestActive(conversationId).catch(() => null) : null;
    if (!this.pendingAction && activeTask?.status === 'waiting-confirmation' && activeTask.pendingAction) {
      this.pendingAction = structuredClone(activeTask.pendingAction);
    }
    if (this.pendingAction) return this.confirmPendingAction(userMessage.content);
    if (activeTask?.status === 'waiting-confirmation') {
      return {
        content: '找到了一个等待确认的任务，但其中缺少可安全恢复的操作内容。为避免误操作，本次不会执行；请取消该任务后重新说明要办理的事项。',
        provider: 'system', handled: true, needsConfirmation: true, task: activeTask,
      };
    }
    if (!activeTask && isDocumentCategoryArchiveRequest(userMessage.content)) {
      try {
        const localDatabase = await this.databaseStore.read();
        const proposal = await this.documentCategoryArchiveProposal(localDatabase, userMessage.content, conversationId);
        if (proposal) return this.finalizeControlledProposal(proposal, { conversationId, originalRequest: userMessage.content });
      } catch (error) {
        return {
          content: `暂时无法准备档案归档操作：${text(error.message) || '本机档案服务不可用'}。本次没有新建分类，文件仍保留在待归档区。`,
          provider: 'system', handled: true, needsConfirmation: false,
        };
      }
    }
    const preliminaryTaskPlan = activeTask ? null : this.taskPlanner.plan(userMessage.content);

    // Explicit resident profile requests can be answered accurately from the
    // local archive without spending tokens or asking the online planner to
    // choose a database scope.
    if (!activeTask && !preliminaryTaskPlan && isResidentOverviewRequest(userMessage.content)) {
      try {
        const localDatabase = await this.databaseStore.read();
        const overview = await this.runReadOnlyTool({ database: localDatabase, message: userMessage.content, messages, stage: 'pre-plan' });
        if (overview) return overview;
      } catch {
        return { content: '暂时无法读取本机居民档案，请稍后重试。系统没有修改任何资料。', provider: 'system', handled: true, needsConfirmation: true };
      }
    }
    const memoryContext = await this.memoryContextMessage();
    const summaryContext = text(conversationSummary) ? { role: 'system', content: `此前对话摘要（仅用于承接上下文）：\n${text(conversationSummary).slice(0, 2400)}` } : null;
    const conversation = recentConversation([...(memoryContext ? [memoryContext] : []), ...(summaryContext ? [summaryContext] : []), ...(messages || [])]);
    if (activeTask && /^(取消任务|放弃任务|不要继续)$/u.test(text(userMessage.content))) {
      activeTask.status = 'cancelled'; activeTask.summary = '用户取消了任务';
      activeTask = await this.taskService.save(activeTask);
      return { content: '已取消当前任务，系统数据没有发生变化。', provider: 'system', handled: true, task: activeTask };
    }
    if (activeTask?.status === 'waiting-input') {
      activeTask.clarifiedRequest = `${activeTask.originalRequest}\n补充信息：${text(userMessage.content)}`;
      activeTask.status = 'pending'; activeTask.clarification = null;
      for (const step of activeTask.steps || []) if (step.status === 'waiting-input') step.status = 'pending';
      userMessage = { ...userMessage, content: activeTask.clarifiedRequest };
    }
    const onlinePlan = await this.understandConversation(conversation);
    if (!activeTask && onlinePlan?.canonicalMessage) userMessage = { ...userMessage, content: onlinePlan.canonicalMessage };
    let database;
    try {
      database = await this.databaseStore.read();
    } catch {
      return {
        content: '暂时无法读取本机台账。为保护现有资料，本次不会查询、修改或执行任何操作；请稍后重试，若持续出现请先检查本机数据服务。',
        provider: 'system',
        handled: true,
        needsConfirmation: true,
      };
    }
    if (onlineAnalysisRequested(userMessage.content)) {
      return this.answerAutomaticOnlineAnalysis({ messages: conversation, request: userMessage.content, database, plan: onlinePlan });
    }
    const semanticContext = this.semanticContext(database, userMessage.content);
    if (!activeTask) {
      const proposedTask = preliminaryTaskPlan || this.taskPlanner.plan(userMessage.content);
      if (proposedTask) activeTask = await this.taskService.save({ ...proposedTask, conversationId: text(conversationId) });
    }
    if (activeTask) {
      const taskResult = await this.executeTask(activeTask, { database, messages, conversation, plan: onlinePlan });
      if (semanticContext) taskResult.data = { ...(taskResult.data || {}), semanticContext };
      return taskResult;
    }
    const readOnlyResult = await this.runReadOnlyTool({
      database,
      message: userMessage.content,
      messages,
      conversation,
      plan: onlinePlan,
      stage: 'post-plan',
    });
    if (readOnlyResult) {
      if (semanticContext) readOnlyResult.data = { ...(readOnlyResult.data || {}), semanticContext };
      return readOnlyResult;
    }
    const proposalFactories = [
      () => this.phoneUpdateProposal(database, userMessage.content),
      () => this.addressUpdateProposal(database, userMessage.content),
      () => this.groupUpdateProposal(database, userMessage.content),
      () => this.landParcelCreateProposal(database, userMessage.content),
      () => this.visitCreateProposal(userMessage.content),
      () => this.dutyScheduleProposal(database, userMessage.content),
      () => this.workCreateProposal(userMessage.content),
      () => this.workStatusUpdateProposal(database, userMessage.content),
      () => this.certificateRecordDeleteProposal(database, userMessage.content),
      () => this.draftArchiveProposal(database, userMessage.content),
      () => this.partyStageUpdateProposal(database, userMessage.content),
      () => this.contractCreateProposal(database, userMessage.content),
      () => this.contractReceiptCreateProposal(database, userMessage.content),
      () => this.financeRecordCreateProposal(userMessage.content),
      () => this.financeRecordUpdateProposal(database, userMessage.content),
      () => this.financeRecordsClearProposal(database, userMessage.content),
      () => this.villageNameUpdateProposal(database, userMessage.content),
      () => this.memberDisableProposal(userMessage.content),
      () => this.backupRestoreProposal(database, userMessage.content),
      () => this.workBatchDeleteProposal(database, userMessage.content),
      () => this.workDeleteProposal(database, userMessage.content),
    ];
    for (const createProposal of proposalFactories) {
      const proposal = await createProposal();
      if (proposal) return this.finalizeControlledProposal(proposal, { conversationId, originalRequest: userMessage.content });
    }
    if (onlinePlan?.needsFacts && onlinePlan.intent === 'query') {
      return this.answerAutomaticOnlineAnalysis({ messages: conversation, request: userMessage.content, database, plan: onlinePlan });
    }
    if (isSystemDataRequest(userMessage.content)) {
      return {
        content: '为避免误查或误操作，我还需要您说明具体对象和要办理的事项。虚构示例：“查询一组示例居民甲 2026 年的发放明细”；实际查询时请换成档案中的真实姓名。也可以说“打开资金发放中心”。信息不明确时，我不会自行猜测。',
        provider: 'system',
        handled: true,
        needsConfirmation: true,
      };
    }
    const sensitiveLabels = sensitiveContentLabels(userMessage.content);
    if (sensitiveLabels.length) {
      return {
        content: `检测到本条内容包含${sensitiveLabels.join('、')}。为避免自动外发，请明确说明“请用在线 AI 分析……”，我会先展示发送预览，得到您的单次确认后才会发送。`,
        provider: 'system', handled: true, needsConfirmation: true,
      };
    }
    if (!this.aiRouter?.chat) return { content: 'AI 对话服务暂不可用，请稍后重试。', provider: 'system', handled: true };
    return this.aiRouter.chat({
      messages: [
        { role: 'system', content: '你是社区AI管理系统的 AI 助理。不得编造、猜测或声称已查询系统数据；对任何不清楚的系统操作或数据请求，必须先请操作员补充对象、范围或年度。' },
        ...conversation,
      ],
      task: { taskKind: 'assistant-conversation' },
    });
  }
}

module.exports = { AiAssistantService, formatMoney, isAnnualAmountQuestion, isSystemDataRequest, paymentYear, parseCertificateDraftResponse };
