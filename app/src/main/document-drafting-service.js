'use strict';

const crypto = require('node:crypto');

const { getTemplate, listTemplates, validateFields } = require('./document-template-catalog');
const { ALLOWED_BUSINESS_COLLECTIONS, buildDocumentContext, stableJson } = require('./document-context-builder');
const { canRead, recommendDocuments } = require('./document-recommendation');
const { updateProfileFromFinal } = require('./writing-profile-service');

function cleanText(value) {
  return String(value || '').replaceAll(/\r\n?/gu, '\n').trim();
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function textToHtml(value) {
  return cleanText(value).split(/\n{2,}/u).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
}

function sanitizeDocumentHtml(value) {
  const allowedTags = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote']);
  return String(value || '')
    .replaceAll(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/giu, '')
    .replaceAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu, (tag, name) => {
      const normalized = name.toLowerCase();
      if (!allowedTags.has(normalized)) return '';
      if (normalized === 'br') return '<br>';
      return tag.startsWith('</') ? `</${normalized}>` : `<${normalized}>`;
    });
}

function documentTextFromHtml(value) {
  return cleanText(String(value || '').replaceAll(/<br\s*\/?\s*>/giu, '\n').replaceAll(/<\/p\s*>/giu, '\n').replaceAll(/<[^>]+>/gu, '').replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
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
    }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async getDocument(documentId) {
    const account = await requireAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    const document = requireDocument(database, documentId);
    if (!canRead(document, account.id)) throw new Error('无权查看该公文');
    return {
      document: structuredClone(document),
      versions: (database.documentVersions || []).filter((version) => version.documentId === documentId).sort((left, right) => right.versionNumber - left.versionNumber),
      references: (database.documentReferences || []).filter((reference) => reference.documentId === documentId),
    };
  }

  async createDraft({ templateId, fields = {}, visibility = 'shared', customTypeName = '', pendingReferences = [] }) {
    const account = await requireAccount(this.getCurrentAccount);
    const validation = validateFields(templateId, fields);
    if (!['shared', 'private'].includes(visibility)) throw new Error('公文可见范围无效');
    if (!validation.valid) throw new Error(`请填写必填字段：${validation.missing.join('、')}`);
    if (validation.template.isCustom && !cleanText(customTypeName)) throw new Error('请输入自定义公文类型');
    const now = this.now().toISOString();
    const documentId = this.createId('document');
    const versionId = this.createId('version');
    const document = {
      id: documentId, documentKind: validation.template.documentKind, templateId,
      customTypeName: cleanText(customTypeName), title: validation.fields.title,
      status: 'draft', visibility, archivedAt: null, ownerUserId: account.id,
      fieldSnapshot: validation.fields, currentVersionId: versionId,
      workingContentHtml: '', workingContentText: '', pendingReferences: structuredClone(pendingReferences),
      createdAt: now, updatedAt: now, finalizedAt: null,
    };
    const version = { id: versionId, documentId, versionNumber: 1, contentHtml: '', contentText: '', changeOrigin: 'human', changeSummary: '创建草稿', referenceIds: [], aiMode: null, modelName: null, createdBy: account.id, createdAt: now };
    await this.databaseStore.update((database) => {
      database.documentDrafts.push(document);
      database.documentVersions.push(version);
    });
    return { document: structuredClone(document), version: structuredClone(version) };
  }

  async saveDraft({ documentId, title, fields, visibility, contentHtml, contentText }) {
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
      document.updatedAt = this.now().toISOString();
      return structuredClone(document);
    });
    return outcome.result;
  }

  async saveVersion({ documentId, contentHtml, contentText, changeOrigin = 'human', changeSummary = '保存版本', aiMode = null, modelName = null, referenceIds = [] }) {
    const account = await requireAccount(this.getCurrentAccount);
    const outcome = await this.databaseStore.update((database) => {
      const document = requireDocument(database, documentId);
      requireOwner(document, account.id);
      if (document.status === 'final') throw new Error('该公文已定稿，请先取消定稿再保存新版本');
      const versions = database.documentVersions.filter((item) => item.documentId === documentId);
      const normalizedHtml = sanitizeDocumentHtml(contentHtml === undefined ? document.workingContentHtml : contentHtml);
      const normalizedText = cleanText(contentText === undefined ? (document.workingContentText || documentTextFromHtml(normalizedHtml)) : contentText);
      const now = this.now().toISOString();
      const version = {
        id: this.createId('version'), documentId, versionNumber: Math.max(0, ...versions.map((item) => item.versionNumber)) + 1,
        contentHtml: normalizedHtml, contentText: normalizedText, changeOrigin, changeSummary: cleanText(changeSummary),
        referenceIds: [...referenceIds], aiMode, modelName, createdBy: account.id, createdAt: now,
      };
      database.documentVersions.push(version);
      document.currentVersionId = version.id;
      document.workingContentHtml = normalizedHtml;
      document.workingContentText = normalizedText;
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
    return this.saveVersion({ documentId, contentHtml: source.contentHtml, contentText: source.contentText, changeOrigin: 'human', changeSummary: `恢复版本 ${source.versionNumber}`, referenceIds: source.referenceIds });
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
    return recommendDocuments({ database, accountId: account.id, query: document ? { title: document.title, ...document.fieldSnapshot } : query, now: this.now() }).filter((item) => item.documentId !== documentId);
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
      const referenceIds = [];
      for (const reference of context.references) {
        const stored = { id: this.createId('reference'), documentId, documentVersionId: versionId, ...reference, promptText: undefined, createdAt: now };
        referenceIds.push(stored.id);
        freshDatabase.documentReferences.push(stored);
      }
      const version = {
        id: versionId, documentId, versionNumber: Math.max(0, ...versions.map((item) => item.versionNumber)) + 1,
        contentHtml: textToHtml(contentText), contentText, changeOrigin: 'ai', changeSummary: 'AI 拟写',
        referenceIds, aiMode: response.provider || null, modelName: response.model || null,
        createdBy: account.id, createdAt: now,
      };
      freshDatabase.documentVersions.push(version);
      freshDocument.currentVersionId = version.id;
      freshDocument.workingContentHtml = version.contentHtml;
      freshDocument.workingContentText = version.contentText;
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

module.exports = { DocumentDraftingService, documentTextFromHtml, sanitizeDocumentHtml, textToHtml };
