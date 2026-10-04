'use strict';

const { revision } = require('./foundation-data-model');

const text = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : [];
const copy = value => structuredClone(value);
const newId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const PENDING_CATEGORY = '待归档';
const LEGACY_AI_CATEGORY = 'AI 任务原文件';

const CATEGORY_DEFINITIONS = Object.freeze([
  { id: 'business-license', name: '营业执照', aliases: ['法人资格证书', '法人证书', '工商登记证书', '登记证书'], modules: [], classifications: ['business-license'], keywords: ['营业执照', '统一社会信用代码', '法人资格证书', '法定代表人'], autoCreate: true },
  { id: 'contract', name: '合同档案', aliases: ['合同', '协议', '合同材料', '协议材料', '承包合同', '租赁合同'], modules: ['contract'], classifications: ['contract', 'agreement'], keywords: ['合同', '协议', '甲方', '乙方', '签订日期'] },
  { id: 'certificate', name: '证明材料', aliases: ['证明', '证明文件', '证明档案', '证明模板'], modules: ['certificate'], classifications: ['certificate-template', 'issued-certificate', 'certificate', 'relationship-certificate', 'residence-certificate', 'death-certificate', 'housing-certificate', 'land-certificate', 'hardship-certificate'], keywords: ['证明', '兹证明', '特此证明'] },
  { id: 'official-document', name: '公文材料', aliases: ['公文', '公文档案', '通知报告', '工作公文'], modules: ['document-drafting'], classifications: ['official-document'], keywords: ['通知', '请示', '报告', '会议纪要', '工作方案'] },
  { id: 'resident', name: '居民档案材料', aliases: ['居民资料', '人员档案', '村民资料', '户籍材料'], modules: ['personnel'], classifications: ['resident-material'], keywords: ['身份证号', '户号', '户主', '居民'] },
  { id: 'land', name: '土地档案', aliases: ['土地材料', '地块档案', '确权材料', '承包地材料'], modules: ['land'], classifications: ['land-material'], keywords: ['地块', '确权', '土地承包', '亩数'] },
  { id: 'disbursement', name: '资金发放资料', aliases: ['发放资料', '补贴资料', '资金发放档案', '承包费台账'], modules: ['contract-fee', 'disbursement', 'farmland-subsidy'], classifications: ['disbursement-material'], keywords: ['发放金额', '补贴', '银行卡号', '承包费'] },
  { id: 'finance', name: '财务资料', aliases: ['财务档案', '财务票据', '收支材料', '票据资料'], modules: ['finance'], classifications: ['finance-material'], keywords: ['收据', '发票', '凭证', '财务'] },
  { id: 'party', name: '党员资料', aliases: ['党建资料', '党务材料', '党员档案'], modules: ['party'], classifications: ['party-material'], keywords: ['党员', '党支部', '党费'] },
  { id: 'visit', name: '民情记录材料', aliases: ['民情资料', '走访材料', '来访材料'], modules: ['visit'], classifications: ['visit-material'], keywords: ['民情', '走访', '来访', '12345'] },
  { id: 'work', name: '值班与工作材料', aliases: ['值班材料', '工作事项材料', '工作资料'], modules: ['duty', 'work'], classifications: ['duty-material', 'work-material'], keywords: ['值班', '工作事项', '办理情况'] },
]);

function normalizeCategoryName(value) {
  return text(value).toLocaleLowerCase('zh-CN')
    .replace(/[\s·•，,。；;：:（）()【】\[\]《》<>“”"'‘’、/_-]+/gu, '')
    .replace(/(?:电子)?档案(?:材料|文件)?$/u, '')
    .replace(/(?:相关)?(?:材料|文件|资料)$/u, '');
}

function categoryLabel(item = {}) {
  return text(item.label || item.name || item.value);
}

function dictionaryCategories(database = {}) {
  return list(database.foundationDictionaries)
    .filter(item => text(item.category) === 'document_category')
    .map(item => ({ id: text(item.id), name: categoryLabel(item), aliases: list(item.aliases).map(text).filter(Boolean), source: 'dictionary', version: revision(item) }))
    .filter(item => item.name);
}

function availableCategories(database = {}) {
  const values = dictionaryCategories(database);
  for (const document of list(database.documents)) {
    const name = text(document.category || document.file_category);
    if (!name || [PENDING_CATEGORY, LEGACY_AI_CATEGORY, 'TRASH'].includes(name)) continue;
    if (!values.some(item => normalizeCategoryName(item.name) === normalizeCategoryName(name))) values.push({ id: '', name, aliases: [], source: 'document', version: null });
  }
  return values;
}

function matchExistingCategory(categories, definition) {
  const expected = new Set([definition.name, ...definition.aliases].map(normalizeCategoryName).filter(Boolean));
  const exact = categories.find(category => [category.name, ...category.aliases].some(name => expected.has(normalizeCategoryName(name))));
  if (exact) return exact;
  const target = normalizeCategoryName(definition.name);
  return categories.find(category => {
    const current = normalizeCategoryName(category.name);
    return current.length >= 2 && target.length >= 2 && (current.includes(target) || target.includes(current));
  }) || null;
}

function definitionForFile(file = {}) {
  const fileName = text(file.fileName);
  if (/(?:营业执照|法人资格证书|法人证书|工商登记证书)/u.test(fileName)) {
    return CATEGORY_DEFINITIONS.find(item => item.id === 'business-license') || null;
  }
  const classificationId = text(file.documentClassification?.id || file.classification?.id);
  const moduleId = text(file.detectedModule || file.documentClassification?.module || file.classification?.module);
  return CATEGORY_DEFINITIONS.find(item => item.classifications.includes(classificationId))
    || CATEGORY_DEFINITIONS.find(item => item.modules.includes(moduleId))
    || null;
}

function evidenceForFile(file = {}, definition = null) {
  const evidence = [];
  const classification = file.documentClassification || file.classification || {};
  if (classification.name) evidence.push(`材料类型：${classification.name}`);
  if (list(classification.matchedKeywords).length) evidence.push(`命中内容：${classification.matchedKeywords.join('、')}`);
  if (file.detectedModule && file.detectedModule !== 'document' && file.detectedModule !== 'unknown') evidence.push(`业务用途：${text(file.detectedModule)}`);
  if (definition && !evidence.length) evidence.push(`文件结构符合“${definition.name}”`);
  return evidence;
}

function recommendDocumentCategory(database, file = {}) {
  const categories = availableCategories(database);
  const definition = definitionForFile(file);
  const fileNameConfidence = /(?:营业执照|法人资格证书|法人证书|工商登记证书)/u.test(text(file.fileName)) ? 0.92 : 0;
  const sourceConfidence = Math.max(fileNameConfidence, Number(file.documentClassification?.confidence ?? file.classification?.confidence ?? file.confidence) || 0);
  if (!definition || sourceConfidence < 0.55) {
    return {
      status: 'uncertain', name: '', confidence: sourceConfidence, evidence: evidenceForFile(file),
      candidates: categories.map(item => ({ id: item.id, name: item.name })).slice(0, 30),
      message: '暂时无法可靠判断归档类别，请选择分类或暂不归档。',
    };
  }
  const existing = matchExistingCategory(categories, definition);
  const confidence = Math.max(sourceConfidence, definition.modules.includes(text(file.detectedModule)) ? 0.82 : sourceConfidence);
  return {
    status: existing ? 'matched' : 'missing', name: existing?.name || definition.name,
    categoryId: existing?.id || '', confidence, evidence: evidenceForFile(file, definition),
    aliases: definition.aliases, autoCreate: definition.autoCreate === true,
    candidates: categories.map(item => ({ id: item.id, name: item.name })).slice(0, 30),
    message: existing ? `已匹配现有分类“${existing.name}”。` : `系统中还没有“${definition.name}”分类。`,
  };
}

class AiDocumentCategoryService {
  constructor({ databaseStore, documentService, businessService = null, now = () => new Date() } = {}) {
    if (!databaseStore?.read || !databaseStore?.update) throw new TypeError('databaseStore is required');
    if (!documentService?.request) throw new TypeError('documentService is required');
    this.databaseStore = databaseStore;
    this.documentService = documentService;
    this.businessService = businessService;
    this.now = now;
  }

  recommend(database, file) { return recommendDocumentCategory(database, file); }

  async updateDocument(documentId, category, database) {
    const record = list(database.documents).find(item => text(item.id) === text(documentId));
    if (!record) throw new Error('原始档案记录不存在，请重新上传文件');
    const result = await this.documentService.request({ action: 'updateCategory', documentId, category, baseVersion: revision(record) });
    if (!result?.success) throw new Error(result?.error || '更新电子档案分类失败');
    return result.document;
  }

  async autoArchive(fileId) {
    const database = await this.databaseStore.read();
    const entry = list(database.aiFileIndexEntries).find(item => text(item.id) === text(fileId) && item.status !== 'deleted');
    if (!entry) throw new Error('没有找到文件识别记录');
    const recommendation = entry.suggestedCategory || this.recommend(database, entry);
    const confidence = Number(recommendation.confidence) || 0;
    if (recommendation.status === 'matched' && confidence >= 0.72) {
      return this.archiveExisting({ entry, database, categoryName: recommendation.name, action: 'auto-match', recommendation });
    }
    if (recommendation.status === 'missing' && recommendation.autoCreate === true && confidence >= 0.86 && recommendation.name) {
      const result = await this.apply({ fileId, action: 'create-and-archive', categoryName: recommendation.name });
      return copy(result.file);
    }
    return copy(entry);
  }

  async apply({ fileId = '', action = '', categoryName = '' } = {}) {
    const database = await this.databaseStore.read();
    const entry = list(database.aiFileIndexEntries).find(item => text(item.id) === text(fileId) && item.status !== 'deleted');
    if (!entry) throw new Error('没有找到文件识别记录，请重新上传');
    const recommendation = entry.suggestedCategory || this.recommend(database, entry);
    if (action === 'defer') {
      const result = await this.databaseStore.update(draft => {
        const stored = list(draft.aiFileIndexEntries).find(item => text(item.id) === text(fileId));
        stored.archiveState = 'deferred';
        stored.categoryDecision = { action: 'defer', decidedAt: this.now().toISOString() };
        stored.lastUsedAt = this.now().toISOString();
        return stored;
      });
      return { ok: true, file: copy(result.result), message: '文件已保留在待归档区，可稍后继续处理。' };
    }
    if (action === 'create-and-archive') {
      const requestedName = text(categoryName || recommendation.name);
      if (!requestedName) throw new Error('请先填写或选择档案分类');
      const existing = availableCategories(database).find(item => normalizeCategoryName(item.name) === normalizeCategoryName(requestedName));
      if (existing) return { ok: true, file: await this.archiveExisting({ entry, database, categoryName: existing.name, action: 'use-existing', recommendation }), message: `已复用“${existing.name}”并完成归档。` };
      if (!this.businessService?.request) throw new Error('当前环境尚未启用档案分类创建服务');
      const definition = CATEGORY_DEFINITIONS.find(item => normalizeCategoryName(item.name) === normalizeCategoryName(requestedName));
      const created = await this.businessService.request({ method: 'POST', path: '/api/v3/dictionaries', domain: 'document', body: {
        category: 'document_category', code: `document-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: requestedName, name: requestedName, value: requestedName, aliases: definition?.aliases || recommendation.aliases || [], isSystem: false,
      } });
      if (!created?.ok) throw new Error(created?.error?.message || '创建档案分类失败');
      const dictionary = created.data?.item || created.data?.dictionary || created.item || created.dictionary;
      try {
        const file = await this.archiveExisting({ entry, database: await this.databaseStore.read(), categoryName: requestedName,
          action: 'create-and-archive', recommendation, createdDictionary: dictionary });
        return { ok: true, file, message: `已创建“${requestedName}”分类并完成归档。` };
      } catch (error) {
        if (dictionary?.id && dictionary?.version) {
          await this.businessService.request({ method: 'DELETE', path: `/api/v3/dictionaries/${encodeURIComponent(dictionary.id)}`, domain: 'document', body: { baseVersion: dictionary.version } }).catch(() => null);
        }
        throw error;
      }
    }
    if (action === 'archive-existing') {
      const requestedName = text(categoryName);
      const existing = availableCategories(database).find(item => normalizeCategoryName(item.name) === normalizeCategoryName(requestedName));
      if (!existing) throw new Error('所选档案分类已经不存在，请重新选择');
      const file = await this.archiveExisting({ entry, database, categoryName: existing.name, action: 'use-existing', recommendation });
      return { ok: true, file, message: `已归档到“${existing.name}”。` };
    }
    throw new Error('请选择创建分类、使用现有分类或暂不归档');
  }

  async archiveExisting({ entry, database, categoryName, action, recommendation, createdDictionary = null }) {
    let document = list(database.documents).find(item => text(item.id) === text(entry.documentId));
    const previousCategory = text(document?.category || document?.file_category) || PENDING_CATEGORY;
    const storageArea = text(document?.storageArea || document?.storage_area)
      || (document?.is_trash || document?.deleted_at || document?.deletedAt ? 'trash' : 'archives');
    if (storageArea === 'trash') {
      const restored = await this.documentService.request({ action: 'restore', documentId: entry.documentId, baseVersion: revision(document) });
      if (!restored?.success) throw new Error(restored?.error || '从废纸篓恢复档案失败');
      database = await this.databaseStore.read();
      document = list(database.documents).find(item => text(item.id) === text(entry.documentId));
    }
    await this.updateDocument(entry.documentId, categoryName, database);
    const decidedAt = this.now().toISOString();
    const operationId = newId('ai-operation');
    const result = await this.databaseStore.update(draft => {
      const stored = list(draft.aiFileIndexEntries).find(item => text(item.id) === text(entry.id));
      if (!stored) throw new Error('文件索引已经不存在，请重新上传');
      stored.archiveState = 'archived';
      stored.finalCategory = categoryName;
      stored.suggestedCategory = copy(recommendation);
      stored.categoryDecision = {
        action, categoryName, previousCategory, createdDictionaryId: text(createdDictionary?.id), decidedAt, operationId,
      };
      stored.lastUsedAt = decidedAt;
      (draft.aiAssistantOperations ||= []).push({
        id: operationId, source: 'ai_assistant', type: createdDictionary ? 'document_category_create_and_archive' : 'document_category_assign',
        module: '电子档案柜', object: { id: text(entry.documentId), name: text(entry.fileName) }, riskLevel: 'low', status: 'completed',
        before: { category: previousCategory }, after: { category: categoryName }, recoverable: true,
        sourceFileId: text(entry.id),
        toolId: createdDictionary ? 'document.category-create-and-archive' : 'document.category-assign',
        confirmationHistory: [], verification: { passed: true, message: `已复核电子档案分类为“${categoryName}”` }, createdAt: decidedAt,
      });
      return stored;
    });
    return copy(result.result);
  }

  async undo({ fileId = '' } = {}) {
    const database = await this.databaseStore.read();
    const entry = list(database.aiFileIndexEntries).find(item => text(item.id) === text(fileId) && item.status !== 'deleted');
    if (!entry?.categoryDecision || entry.categoryDecision.undoneAt) throw new Error('本次归档没有可撤销的分类操作');
    const decision = entry.categoryDecision;
    const currentDocument = list(database.documents).find(item => text(item.id) === text(entry.documentId));
    const currentCategory = text(currentDocument?.category || currentDocument?.file_category);
    if (currentCategory !== text(entry.finalCategory)) throw new Error('档案分类已经由其他操作修改，请刷新后重新核对');
    const previousCategory = text(decision.previousCategory) || PENDING_CATEGORY;
    await this.updateDocument(entry.documentId, previousCategory, database);
    let categoryRetained = false;
    if (decision.createdDictionaryId && this.businessService?.request) {
      const refreshed = await this.databaseStore.read();
      const inUse = list(refreshed.documents).some(item => text(item.id) !== text(entry.documentId)
        && normalizeCategoryName(item.category || item.file_category) === normalizeCategoryName(entry.finalCategory));
      const dictionary = list(refreshed.foundationDictionaries).find(item => text(item.id) === text(decision.createdDictionaryId));
      if (!inUse && dictionary) {
        const removed = await this.businessService.request({ method: 'DELETE', path: `/api/v3/dictionaries/${encodeURIComponent(dictionary.id)}`, domain: 'document', body: { baseVersion: revision(dictionary) } });
        categoryRetained = removed?.ok !== true;
      } else categoryRetained = Boolean(dictionary);
    }
    const undoneAt = this.now().toISOString();
    const result = await this.databaseStore.update(draft => {
      const stored = list(draft.aiFileIndexEntries).find(item => text(item.id) === text(fileId));
      stored.archiveState = 'pending';
      stored.finalCategory = '';
      stored.categoryDecision = { ...stored.categoryDecision, undoneAt, categoryRetained };
      stored.lastUsedAt = undoneAt;
      const original = list(draft.aiAssistantOperations).find(item => text(item.id) === text(decision.operationId));
      if (original) original.status = 'undone';
      (draft.aiAssistantOperations ||= []).push({
        id: newId('ai-operation'), source: 'ai_assistant', type: 'undo', module: '电子档案柜',
        object: { id: text(entry.documentId), name: text(entry.fileName) }, riskLevel: 'low', status: 'completed',
        before: { category: entry.finalCategory }, after: { category: previousCategory }, recoverable: false,
        toolId: 'document.category-undo', confirmationHistory: [], createdAt: undoneAt,
      });
      return stored;
    });
    return { ok: true, file: copy(result.result), message: categoryRetained
      ? `已撤销归档，文件回到“${previousCategory}”；该分类仍被其他档案使用，因此予以保留。`
      : `已撤销归档，文件回到“${previousCategory}”。` };
  }
}

module.exports = {
  AiDocumentCategoryService, CATEGORY_DEFINITIONS, PENDING_CATEGORY, LEGACY_AI_CATEGORY,
  normalizeCategoryName, dictionaryCategories, availableCategories, recommendDocumentCategory,
};
