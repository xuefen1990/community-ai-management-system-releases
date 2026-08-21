'use strict';

const crypto = require('node:crypto');

const { getTemplate, listTemplates, validateFields } = require('./document-template-catalog');
const { ALLOWED_BUSINESS_COLLECTIONS, buildDocumentContext, stableJson } = require('./document-context-builder');
const { canRead, recommendDocuments } = require('./document-recommendation');
const { updateProfileFromFinal } = require('./writing-profile-service');
const {
  buildConversationMessages,
  defaultTemplateFor,
  detectDocumentKind,
  parseConversationResponse,
} = require('./document-conversation-interpreter');

function cleanText(value) {
  return String(value || '').replaceAll(/\r\n?/gu, '\n').trim();
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const DOCUMENT_LAYOUT_PRESETS = Object.freeze({
  request: Object.freeze({
    preset: 'request', paper: 'A4', titleFont: 'heiti', titleSize: 22, titleBold: true,
    bodyFont: 'fangsong', bodySize: 16, lineSpacing: 28.95, firstLineChars: 2,
    margins: Object.freeze({ top: 30, right: 26, bottom: 35, left: 28 }),
    addressee: '晓店街道办事处', signatureUnit: '陆庄社区居民委员会',
  }),
  report: Object.freeze({
    preset: 'report', paper: 'A4', titleFont: 'songti', titleSize: 24, titleBold: true,
    bodyFont: 'fangsong', bodySize: 16, lineSpacing: 28.95, firstLineChars: 2,
    margins: Object.freeze({ top: 25.4, right: 31.75, bottom: 25.4, left: 31.75 }),
    addressee: '晓店街道办事处', signatureUnit: '陆庄社区居民委员会',
  }),
});

const DOCUMENT_FONT_KEYS = new Set(['fangsong', 'songti', 'heiti', 'kaiti']);

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function presetForTemplate(templateId = '') {
  return String(templateId).includes('request') ? 'request' : 'report';
}

function normalizeDocumentLayout(value, fallbackPreset = 'report') {
  const requestedPreset = value?.preset;
  const presetName = Object.hasOwn(DOCUMENT_LAYOUT_PRESETS, requestedPreset) ? requestedPreset : fallbackPreset;
  const preset = DOCUMENT_LAYOUT_PRESETS[presetName] || DOCUMENT_LAYOUT_PRESETS.report;
  const margins = value?.margins && typeof value.margins === 'object' ? value.margins : {};
  const font = (candidate, fallback) => DOCUMENT_FONT_KEYS.has(candidate) ? candidate : fallback;
  return {
    preset: presetName,
    paper: 'A4',
    titleFont: font(value?.titleFont, preset.titleFont),
    titleSize: clampNumber(value?.titleSize, preset.titleSize, 9, 42),
    titleBold: value?.titleBold === undefined ? preset.titleBold : Boolean(value.titleBold),
    bodyFont: font(value?.bodyFont, preset.bodyFont),
    bodySize: clampNumber(value?.bodySize, preset.bodySize, 9, 42),
    lineSpacing: clampNumber(value?.lineSpacing, preset.lineSpacing, 12, 72),
    firstLineChars: clampNumber(value?.firstLineChars, preset.firstLineChars, 0, 4),
    margins: {
      top: clampNumber(margins.top, preset.margins.top, 10, 50),
      right: clampNumber(margins.right, preset.margins.right, 10, 50),
      bottom: clampNumber(margins.bottom, preset.margins.bottom, 10, 50),
      left: clampNumber(margins.left, preset.margins.left, 10, 50),
    },
    addressee: cleanText(value?.addressee) || preset.addressee,
    signatureUnit: cleanText(value?.signatureUnit) || preset.signatureUnit,
  };
}

function latestLayoutFor(database, accountId, fallbackPreset) {
  const latest = (database.documentDrafts || [])
    .filter((item) => item.ownerUserId === accountId && item.layout)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
  return normalizeDocumentLayout(latest?.layout, fallbackPreset);
}

function textToHtml(value) {
  return cleanText(value).split(/\n{2,}/u).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
}

function sanitizeDocumentHtml(value) {
  const allowedTags = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'span']);
  const allowedRoles = new Set(['title', 'addressee', 'body', 'closing', 'signature', 'date']);
  const allowedAlignments = new Set(['left', 'center', 'right', 'justify']);
  return String(value || '')
    .replaceAll(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/giu, '')
    .replaceAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu, (tag, name) => {
      const normalized = name.toLowerCase();
      if (!allowedTags.has(normalized)) return '';
      if (normalized === 'br') return '<br>';
      const outputTag = normalized === 'div' ? 'p' : normalized;
      if (tag.startsWith('</')) return `</${outputTag}>`;
      const attributes = [];
      const attributeValue = (attribute) => {
        const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'iu'));
        return match?.[2] || '';
      };
      const role = attributeValue('data-doc-role');
      const alignment = attributeValue('data-doc-align');
      const font = attributeValue('data-doc-font');
      const size = Number(attributeValue('data-doc-size'));
      if (allowedRoles.has(role)) attributes.push(`data-doc-role="${role}"`);
      if (allowedAlignments.has(alignment)) attributes.push(`data-doc-align="${alignment}"`);
      if (DOCUMENT_FONT_KEYS.has(font)) attributes.push(`data-doc-font="${font}"`);
      if (Number.isFinite(size) && size >= 9 && size <= 42) attributes.push(`data-doc-size="${size}"`);
      return `<${outputTag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
    });
}

function documentTextFromHtml(value) {
  return cleanText(String(value || '').replaceAll(/<br\s*\/?\s*>/giu, '\n').replaceAll(/<\/(p|h[1-4]|li|blockquote)\s*>/giu, '\n').replaceAll(/<[^>]+>/gu, '').replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&'));
}

function comparableText(value) {
  return cleanText(value).replaceAll(/[\s：:，,。！？!?、（）()《》]/gu, '');
}

function dateText(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function structuredDocumentHtml({ documentKind, title, documentText, layout, fields = {}, now = new Date() }) {
  const normalizedLayout = normalizeDocumentLayout(layout, presetForTemplate(fields.templateId));
  const paragraphs = cleanText(documentText).split(/\n{2,}/u).map(cleanText).filter(Boolean);
  if (paragraphs.length) {
    const firstLines = paragraphs[0].split('\n').map(cleanText).filter(Boolean);
    if (firstLines.length && comparableText(firstLines[0]) === comparableText(title)) {
      firstLines.shift();
      if (firstLines.length) paragraphs[0] = firstLines.join('\n');
      else paragraphs.shift();
    }
  }
  if (documentKind !== 'report') {
    return `<h1 data-doc-role="title">${escapeHtml(title)}</h1>${paragraphs.map((paragraph) => `<p data-doc-role="body">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('')}`;
  }

  const explicitRecipient = cleanText(fields.recipient);
  if (explicitRecipient && !/(待补充|请补充)/u.test(explicitRecipient)) normalizedLayout.addressee = explicitRecipient.replace(/[：:]$/u, '');
  if (paragraphs[0]) {
    const firstLines = paragraphs[0].split('\n').map(cleanText).filter(Boolean);
    if (firstLines[0] && /^[^\n]{1,40}[：:]$/u.test(firstLines[0])) {
      firstLines.shift();
      if (firstLines.length) paragraphs[0] = firstLines.join('\n');
      else paragraphs.shift();
    }
  }
  while (paragraphs.at(-1)) {
    const tailLines = paragraphs.at(-1).split('\n').map(cleanText).filter(Boolean);
    const originalLength = tailLines.length;
    if (tailLines.at(-1) && /^\d{4}年\d{1,2}月\d{1,2}日$/u.test(tailLines.at(-1))) tailLines.pop();
    if (tailLines.at(-1) && tailLines.at(-1).length <= 40 && /(社区|居民委员会|村民委员会|公司|办事处|人民政府)$/u.test(tailLines.at(-1))) tailLines.pop();
    if (tailLines.length === originalLength) break;
    if (tailLines.length) paragraphs[paragraphs.length - 1] = tailLines.join('\n');
    else paragraphs.pop();
  }

  const body = paragraphs.map((paragraph, index) => {
    const role = index === paragraphs.length - 1 && /^(妥否|恳请|以上|特此)/u.test(paragraph) ? 'closing' : 'body';
    return `<p data-doc-role="${role}">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`;
  }).join('');
  return [
    `<h1 data-doc-role="title">${escapeHtml(title)}</h1>`,
    `<p data-doc-role="addressee">${escapeHtml(normalizedLayout.addressee)}：</p>`,
    body,
    `<p data-doc-role="signature">${escapeHtml(normalizedLayout.signatureUnit)}</p>`,
    `<p data-doc-role="date">${escapeHtml(dateText(now))}</p>`,
  ].join('');
}

async function requireAccount(getCurrentAccount) {
  const account = await getCurrentAccount();
  if (!account?.id) throw new Error('请先登录管理员账号');
  return account;
}

function requireDocument(database, documentId) {
  const document = (database.documentDrafts || []).find((item) => item.id === documentId);
  if (!document) throw new Error('公文不存在');
  return document;
}

function requireOwner(document, accountId) {
  if (document.ownerUserId !== accountId) throw new Error('只有创建人可以修改该公文');
}

function versionFor(database, document) {
  return (database.documentVersions || []).find((version) => version.id === document.currentVersionId) || null;
}

function provisionalFields(templateId, message, now) {
  const template = getTemplate(templateId);
  const normalizedMessage = cleanText(message);
  const date = now instanceof Date ? now : new Date(now);
  const period = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const fields = Object.fromEntries(template.fields.map((field) => [field.key, '']));
  if (template.documentKind === 'report') {
    fields.title = normalizedMessage ? normalizedMessage.slice(0, 46) : '新建报告';
    fields.period = period;
    fields.keyPoints = normalizedMessage || '待补充';
  } else {
    fields.title = normalizedMessage ? normalizedMessage.slice(0, 46) : '新建合同';
    fields.subject = normalizedMessage || '待补充';
  }
  for (const key of template.requiredFields) if (!cleanText(fields[key])) fields[key] = '待补充';
  return fields;
}

class DocumentDraftingService {
  constructor({ databaseStore, getCurrentAccount, aiRouter = null, now = () => new Date(), createId = (prefix) => `${prefix}-${crypto.randomUUID()}` }) {
    this.databaseStore = databaseStore;
    this.getCurrentAccount = getCurrentAccount;
    this.aiRouter = aiRouter;
    this.now = now;
    this.createId = createId;
  }

  listTemplates(documentKind) {
    return listTemplates(documentKind);
  }

  async getLayoutDefaults({ templateId = 'report-work' } = {}) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    return latestLayoutFor(database, account.id, presetForTemplate(templateId));
  }

  async listDocuments(filters = {}) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const query = cleanText(filters.query).toLowerCase();
    return (database.documentDrafts || []).filter((document) => {
      if (!canRead(document, account.id)) return false;
      if (filters.documentKind && document.documentKind !== filters.documentKind) return false;
      if (filters.templateId && document.templateId !== filters.templateId) return false;
      if (filters.status && document.status !== filters.status) return false;
      if (filters.ownerUserId && document.ownerUserId !== filters.ownerUserId) return false;
      if (filters.archived === true && !document.archivedAt) return false;
      if (filters.archived !== true && filters.includeArchived !== true && document.archivedAt) return false;
      if (query) {
        const version = versionFor(database, document);
        if (!`${document.title} ${version?.contentText || ''}`.toLowerCase().includes(query)) return false;
      }
      return true;
    }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((document) => ({ ...structuredClone(document), layout: normalizeDocumentLayout(document.layout, presetForTemplate(document.templateId)) }));
  }

  async getDocument(documentId) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const document = requireDocument(database, documentId);
    if (!canRead(document, account.id)) throw new Error('无权查看该公文');
    const documentLayout = normalizeDocumentLayout(document.layout, presetForTemplate(document.templateId));
    return {
      document: { ...structuredClone(document), layout: documentLayout },
      versions: (database.documentVersions || []).filter((version) => version.documentId === documentId).sort((left, right) => right.versionNumber - left.versionNumber).map((version) => ({
        ...structuredClone(version),
        layoutSnapshot: normalizeDocumentLayout(version.layoutSnapshot || documentLayout, presetForTemplate(document.templateId)),
      })),
      references: (database.documentReferences || []).filter((reference) => reference.documentId === documentId),
      messages: (database.documentDraftMessages || []).filter((message) => message.documentId === documentId),
    };
  }

  async createDraft({ templateId, fields = {}, visibility = 'shared', customTypeName = '', pendingReferences = [], layout = null }) {
    const account = await requireAccount(this.getCurrentAccount);
    const validation = validateFields(templateId, fields);
    if (!['shared', 'private'].includes(visibility)) throw new Error('公文可见范围无效');
    if (!validation.valid) throw new Error(`请填写必填字段：${validation.missing.join('、')}`);
    if (validation.template.isCustom && !cleanText(customTypeName)) throw new Error('请输入自定义公文类型');
    const outcome = await this.databaseStore.update((database) => {
      const now = this.now().toISOString();
      const documentId = this.createId('document');
      const versionId = this.createId('version');
      const documentLayout = layout
        ? normalizeDocumentLayout(layout, presetForTemplate(templateId))
        : latestLayoutFor(database, account.id, presetForTemplate(templateId));
      const document = {
        id: documentId, documentKind: validation.template.documentKind, templateId,
        customTypeName: cleanText(customTypeName), title: validation.fields.title,
        status: 'draft', visibility, archivedAt: null, ownerUserId: account.id,
        fieldSnapshot: validation.fields, currentVersionId: versionId, layout: documentLayout,
        workingContentHtml: '', workingContentText: '', pendingReferences: structuredClone(pendingReferences),
        createdAt: now, updatedAt: now, finalizedAt: null,
      };
      const version = { id: versionId, documentId, versionNumber: 1, contentHtml: '', contentText: '', layoutSnapshot: structuredClone(documentLayout), changeOrigin: 'human', changeSummary: '创建草稿', referenceIds: [], aiMode: null, modelName: null, createdBy: account.id, createdAt: now };
      database.documentDrafts.push(document);
      database.documentVersions.push(version);
      return { document: structuredClone(document), version: structuredClone(version) };
    });
    return outcome.result;
  }

  async saveDraft({ documentId, title, fields, visibility, contentHtml, contentText, layout }) {
    const account = await requireAccount(this.getCurrentAccount);
    const outcome = await this.databaseStore.update((database) => {
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      if (document.status === 'final') throw new Error('该公文已定稿，请先取消定稿再编辑');
      if (fields) {
        const validation = validateFields(document.templateId, fields);
        if (!validation.valid) throw new Error(`请填写必填字段：${validation.missing.join('、')}`);
        document.fieldSnapshot = validation.fields;
        document.title = cleanText(title || validation.fields.title);
      } else if (title !== undefined) document.title = cleanText(title);
      if (visibility !== undefined) {
        if (!['shared', 'private'].includes(visibility)) throw new Error('公文可见范围无效');
        document.visibility = visibility;
      }
      if (contentHtml !== undefined) document.workingContentHtml = sanitizeDocumentHtml(contentHtml);
      if (contentText !== undefined) document.workingContentText = cleanText(contentText);
      else if (contentHtml !== undefined) document.workingContentText = documentTextFromHtml(document.workingContentHtml);
      if (layout !== undefined) document.layout = normalizeDocumentLayout(layout, presetForTemplate(document.templateId));
      else if (!document.layout) document.layout = normalizeDocumentLayout(null, presetForTemplate(document.templateId));
      document.updatedAt = this.now().toISOString();
      return structuredClone(document);
    });
    return outcome.result;
  }

  async saveVersion({ documentId, contentHtml, contentText, layout, changeOrigin = 'human', changeSummary = '保存版本', aiMode = null, modelName = null, referenceIds = [] }) {
    const account = await requireAccount(this.getCurrentAccount);
    const outcome = await this.databaseStore.update((database) => {
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      if (document.status === 'final') throw new Error('该公文已定稿，请先取消定稿再保存新版本');
      const versions = database.documentVersions.filter((item) => item.documentId === documentId);
      const normalizedHtml = sanitizeDocumentHtml(contentHtml === undefined ? document.workingContentHtml : contentHtml);
      const normalizedText = cleanText(contentText === undefined ? (document.workingContentText || documentTextFromHtml(normalizedHtml)) : contentText);
      const normalizedLayout = normalizeDocumentLayout(layout === undefined ? document.layout : layout, presetForTemplate(document.templateId));
      const now = this.now().toISOString();
      const version = {
        id: this.createId('version'), documentId, versionNumber: Math.max(0, ...versions.map((item) => item.versionNumber)) + 1,
        contentHtml: normalizedHtml, contentText: normalizedText, layoutSnapshot: normalizedLayout, changeOrigin, changeSummary: cleanText(changeSummary),
        referenceIds: [...referenceIds], aiMode, modelName, createdBy: account.id, createdAt: now,
      };
      database.documentVersions.push(version);
      document.currentVersionId = version.id;
      document.workingContentHtml = normalizedHtml;
      document.workingContentText = normalizedText;
      document.layout = structuredClone(normalizedLayout);
      document.updatedAt = now;
      return structuredClone(version);
    });
    return outcome.result;
  }

  async restoreVersion({ documentId, versionId }) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const document = requireDocument(database, documentId);
    requireOwner(document, account.id);
    const source = database.documentVersions.find((version) => version.id === versionId && version.documentId === documentId);
    if (!source) throw new Error('要恢复的版本不存在');
    return this.saveVersion({ documentId, contentHtml: source.contentHtml, contentText: source.contentText, layout: source.layoutSnapshot, changeOrigin: 'human', changeSummary: `恢复版本 ${source.versionNumber}`, referenceIds: source.referenceIds });
  }

  async finalize(documentId) {
    const account = await requireAccount(this.getCurrentAccount);
    const outcome = await this.databaseStore.update((database) => {
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      const version = versionFor(database, document);
      if (!cleanText(version?.contentText)) throw new Error('文稿正文为空，不能定稿');
      const finalizedAt = this.now().toISOString();
      document.status = 'final';
      document.finalizedAt = finalizedAt;
      document.updatedAt = finalizedAt;
      updateProfileFromFinal(database, { userId: account.id, documentId, versionId: version.id, contentText: version.contentText, finalizedAt });
      return structuredClone(document);
    });
    return outcome.result;
  }

  async archive(documentId) {
    const account = await requireAccount(this.getCurrentAccount);
    const outcome = await this.databaseStore.update((database) => {
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      document.archivedAt = this.now().toISOString();
      document.updatedAt = document.archivedAt;
      return structuredClone(document);
    });
    return outcome.result;
  }

  async reopen(documentId) {
    const account = await requireAccount(this.getCurrentAccount);
    const outcome = await this.databaseStore.update((database) => {
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      if (document.status !== 'final') return structuredClone(document);
      document.status = 'draft';
      document.finalizedAt = null;
      document.updatedAt = this.now().toISOString();
      return structuredClone(document);
    });
    return outcome.result;
  }

  async recommend({ documentId = null, query = {} }) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const document = documentId ? requireDocument(database, documentId) : null;
    return recommendDocuments({ database, accountId: account.id, query: document ? { title: document.title, ...document.fieldSnapshot, ...query } : query, now: this.now() }).filter((item) => item.documentId !== documentId);
  }

  async listBusinessSources({ collection, query = '' }) {
    await requireAccount(this.getCurrentAccount);
    if (!ALLOWED_BUSINESS_COLLECTIONS.includes(collection)) throw new Error('不允许读取该业务数据');
    const database = await this.databaseStore.read();
    const normalizedQuery = cleanText(query).toLowerCase();
    return (database[collection] || []).filter((record) => !normalizedQuery || stableJson(record).toLowerCase().includes(normalizedQuery)).slice(0, 100).map((record) => ({
      id: record.id,
      title: cleanText(record.title || record.name || record.person_name || record.visitorName || record.summary || record.category || record.id),
      summary: cleanText(stableJson(record)).slice(0, 180),
    }));
  }

  async converse({ documentId = null, message = '', preferredKind = 'auto', confirmedReferences = [], layout = null }) {
    if (!this.aiRouter) throw new Error('AI 拟写服务尚未配置');
    const account = await requireAccount(this.getCurrentAccount);
    const userMessage = cleanText(message);
    if (!userMessage) throw new Error(documentId ? '请先填写补充修改要求' : '请先描述需要拟写的公文');
    if (!['auto', 'report', 'contract'].includes(preferredKind)) throw new Error('公文类型偏好无效');

    if (!documentId) {
      const kind = detectDocumentKind(userMessage, preferredKind);
      const templateId = defaultTemplateFor(kind, userMessage);
      const created = await this.createDraft({
        templateId,
        fields: provisionalFields(templateId, userMessage, this.now()),
        visibility: 'shared',
        layout,
      });
      documentId = created.document.id;
    }

    const prepared = await this.databaseStore.update((database) => {
      if (!Array.isArray(database.documentDraftMessages)) database.documentDraftMessages = [];
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      if (document.status === 'final') throw new Error('该公文已定稿，请先取消定稿再重新生成');
      const now = this.now().toISOString();
      const existingState = document.conversationState && typeof document.conversationState === 'object' ? document.conversationState : {};
      const references = Array.isArray(confirmedReferences) && confirmedReferences.length
        ? structuredClone(confirmedReferences)
        : structuredClone(document.pendingReferences || []);
      document.pendingReferences = references;
      document.layout = normalizeDocumentLayout(layout || document.layout, presetForTemplate(document.templateId));
      document.conversationState = {
        preferredKind,
        status: 'thinking',
        fields: structuredClone(existingState.fields || document.fieldSnapshot || {}),
        lastInstruction: userMessage,
        updatedAt: now,
      };
      document.updatedAt = now;
      return structuredClone(document);
    });
    const document = prepared.result;
    const database = await this.databaseStore.read();
    const selectedReferences = document.pendingReferences || [];

    const profile = (database.writingProfiles || []).find((item) => item.userId === account.id) || null;
    const template = getTemplate(document.templateId);
    const context = buildDocumentContext({
      database,
      accountId: account.id,
      template,
      fields: { request: userMessage },
      selectedReferences,
      profile,
    });
    const currentVersion = versionFor(database, document);
    const aiResponse = await this.aiRouter.chat({ messages: buildConversationMessages({
      preferredKind,
      conversation: [{ role: 'user', content: userMessage }],
      currentFields: document.conversationState?.fields || document.fieldSnapshot || {},
      currentContent: document.workingContentText || currentVersion?.contentText || '',
      referencePrompt: context.prompt,
    }) });
    const plan = parseConversationResponse(aiResponse?.content, {
      fallbackKind: document.documentKind,
      fallbackTemplateId: document.templateId,
      currentFields: document.conversationState?.fields || document.fieldSnapshot || {},
    });

    const outcome = await this.databaseStore.update((freshDatabase) => {
      const freshDocument = requireDocument(freshDatabase, documentId);
      requireOwner(freshDocument, account.id);
      if (freshDocument.status === 'final') throw new Error('该公文已定稿，请先取消定稿再重新生成');
      const now = this.now().toISOString();
      const versions = freshDatabase.documentVersions.filter((item) => item.documentId === documentId);
      const versionId = this.createId('version');
      const documentLayout = normalizeDocumentLayout(freshDocument.layout, presetForTemplate(plan.templateId));
      const explicitRecipient = cleanText(plan.fields.recipient);
      if (explicitRecipient && !/(待补充|请补充)/u.test(explicitRecipient)) documentLayout.addressee = explicitRecipient.replace(/[：:]$/u, '');
      const contentHtml = sanitizeDocumentHtml(structuredDocumentHtml({
        documentKind: plan.documentKind,
        title: plan.fields.title,
        documentText: plan.documentText,
        layout: documentLayout,
        fields: { ...plan.fields, templateId: plan.templateId },
        now,
      }));
      const contentText = documentTextFromHtml(contentHtml);
      const referenceIds = [];
      for (const reference of context.references) {
        const stored = { id: this.createId('reference'), documentId, documentVersionId: versionId, ...reference, promptText: undefined, createdAt: now };
        referenceIds.push(stored.id);
        freshDatabase.documentReferences.push(stored);
      }
      const version = {
        id: versionId, documentId, versionNumber: Math.max(0, ...versions.map((item) => item.versionNumber)) + 1,
        contentHtml, contentText, layoutSnapshot: structuredClone(documentLayout), changeOrigin: 'ai', changeSummary: 'AI 直接拟写',
        referenceIds, aiMode: aiResponse?.provider || null, modelName: aiResponse?.model || null,
        createdBy: account.id, createdAt: now,
      };
      freshDatabase.documentVersions.push(version);
      freshDocument.documentKind = plan.documentKind;
      freshDocument.templateId = plan.templateId;
      freshDocument.title = plan.fields.title;
      freshDocument.fieldSnapshot = structuredClone(plan.fields);
      freshDocument.currentVersionId = version.id;
      freshDocument.layout = structuredClone(documentLayout);
      freshDocument.workingContentHtml = version.contentHtml;
      freshDocument.workingContentText = version.contentText;
      freshDocument.pendingReferences = structuredClone(selectedReferences);
      freshDocument.conversationState = {
        preferredKind,
        status: 'ready',
        fields: structuredClone(plan.fields),
        lastInstruction: userMessage,
        updatedAt: now,
      };
      freshDocument.updatedAt = now;
      return { document: structuredClone(freshDocument), version: structuredClone(version) };
    });
    return {
      action: 'generated',
      document: outcome.result.document,
      version: outcome.result.version,
      assistantMessage: plan.assistantMessage,
      summary: plan.fields,
      references: context.references,
      omitted: context.omitted,
    };
  }

  async generate({ documentId, selectedReferences = [], instructions = '' }) {
    if (!this.aiRouter) throw new Error('AI 拟写服务尚未配置');
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const document = requireDocument(database, documentId);
    requireOwner(document, account.id);
    if (document.status === 'final') throw new Error('该公文已定稿，请先取消定稿再重新生成');
    const validation = validateFields(document.templateId, document.fieldSnapshot);
    if (!validation.valid) throw new Error(`请填写必填字段：${validation.missing.join('、')}`);
    const profile = (database.writingProfiles || []).find((item) => item.userId === account.id) || null;
    const context = buildDocumentContext({ database, accountId: account.id, template: getTemplate(document.templateId), fields: validation.fields, selectedReferences, profile });
    const response = await this.aiRouter.chat({ messages: [
      { role: 'system', content: '你是社区公文拟写助手。输出完整正文，不要输出分析过程。所有事实必须来自用户字段或明确提供的参考资料。' },
      { role: 'user', content: `${context.prompt}${instructions ? `\n\n补充修改要求：${cleanText(instructions)}` : ''}` },
    ] });
    const contentText = cleanText(response?.content);
    if (!contentText) throw new Error('AI 未返回有效正文，请重试或切换模型');
    const outcome = await this.databaseStore.update((freshDatabase) => {
      const freshDocument = requireDocument(freshDatabase, documentId);
      requireOwner(freshDocument, account.id);
      if (freshDocument.status === 'final') throw new Error('该公文已定稿，请先取消定稿再重新生成');
      const now = this.now().toISOString();
      const versions = freshDatabase.documentVersions.filter((item) => item.documentId === documentId);
      const versionId = this.createId('version');
      const documentLayout = normalizeDocumentLayout(freshDocument.layout, presetForTemplate(freshDocument.templateId));
      const contentHtml = sanitizeDocumentHtml(structuredDocumentHtml({
        documentKind: freshDocument.documentKind,
        title: freshDocument.title,
        documentText: contentText,
        layout: documentLayout,
        fields: { ...freshDocument.fieldSnapshot, templateId: freshDocument.templateId },
        now,
      }));
      const formattedText = documentTextFromHtml(contentHtml);
      const referenceIds = [];
      for (const reference of context.references) {
        const stored = { id: this.createId('reference'), documentId, documentVersionId: versionId, ...reference, promptText: undefined, createdAt: now };
        referenceIds.push(stored.id);
        freshDatabase.documentReferences.push(stored);
      }
      const version = {
        id: versionId, documentId, versionNumber: Math.max(0, ...versions.map((item) => item.versionNumber)) + 1,
        contentHtml, contentText: formattedText, layoutSnapshot: structuredClone(documentLayout), changeOrigin: 'ai', changeSummary: 'AI 拟写',
        referenceIds, aiMode: response.provider || null, modelName: response.model || null,
        createdBy: account.id, createdAt: now,
      };
      freshDatabase.documentVersions.push(version);
      freshDocument.currentVersionId = version.id;
      freshDocument.workingContentHtml = version.contentHtml;
      freshDocument.workingContentText = version.contentText;
      freshDocument.layout = structuredClone(documentLayout);
      freshDocument.pendingReferences = structuredClone(selectedReferences);
      freshDocument.updatedAt = now;
      return structuredClone(version);
    });
    return { version: outcome.result, references: context.references, omitted: context.omitted };
  }

  async createFromHistory({ sourceDocumentId, targetTemplateId, visibility = 'shared' }) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const source = requireDocument(database, sourceDocumentId);
    if (!canRead(source, account.id)) throw new Error('无权引用该历史公文');
    const target = getTemplate(targetTemplateId);
    const fields = Object.fromEntries(target.fields.map((field) => [field.key, '']));
    fields.title = `基于《${source.title}》拟写的${target.name}`;
    for (const key of target.requiredFields) if (!fields[key]) fields[key] = key === 'period' ? '请补充' : key === 'keyPoints' ? `参考《${source.title}》拟写` : '请补充';
    return this.createDraft({
      templateId: targetTemplateId, fields, visibility,
      pendingReferences: [{ type: 'document', documentId: source.id, versionId: source.currentVersionId, selectedBy: 'user' }],
    });
  }
}

module.exports = {
  DOCUMENT_LAYOUT_PRESETS,
  DocumentDraftingService,
  documentTextFromHtml,
  normalizeDocumentLayout,
  sanitizeDocumentHtml,
  structuredDocumentHtml,
  textToHtml,
};
