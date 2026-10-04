'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { FoundationDocumentService } = require('../../src/main/foundation-document-service');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { AiDocumentCategoryService, recommendDocumentCategory, normalizeCategoryName } = require('../../src/main/ai-document-category-service');

async function fixture(t, databasePatch = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-document-category-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const now = () => new Date('2026-09-21T08:00:00.000Z');
  const store = new JsonDatabaseStore({ userDataPath: root, now });
  await store.update(database => Object.assign(database, structuredClone(databasePatch)));
  const authorize = async () => {};
  const documentService = new FoundationDocumentService({ store, authorize, now, shell: { openPath: async () => '' } });
  const businessService = new FoundationBusinessService({ store, authorize, now, uuid: () => `dictionary-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  const service = new AiDocumentCategoryService({ databaseStore: store, documentService, businessService, now });
  const source = path.join(root, '合同.txt');
  await fs.writeFile(source, '鱼塘承包合同，甲方陆庄社区，乙方张三。');
  const archived = await documentService.request({ action: 'archive', sourceFilePath: source, name: '鱼塘承包合同.txt', category: '待归档' });
  const entry = {
    id: 'ai-file-1', documentId: archived.document.id, fileName: '鱼塘承包合同.txt', status: 'parsed',
    detectedModule: 'contract', confidence: 0.9, documentClassification: { id: 'contract', module: 'contract', name: '合同或协议', confidence: 0.9, matchedKeywords: ['合同', '甲方', '乙方'] },
    archiveState: 'pending', createdAt: now().toISOString(), lastUsedAt: now().toISOString(),
  };
  await store.update(database => { entry.suggestedCategory = service.recommend(database, entry); database.aiFileIndexEntries.push(entry); });
  return { root, store, service, entry };
}

test('档案类别名称忽略标点、空格及材料档案后缀', () => {
  assert.equal(normalizeCategoryName(' 合同-档案 '), normalizeCategoryName('合同材料'));
  assert.equal(normalizeCategoryName('证明文件'), normalizeCategoryName('证明档案'));
});

test('分类建议复用别名并给出中文判断依据', () => {
  const database = { foundationDictionaries: [{ id: 'category-1', category: 'document_category', label: '综合合同档案', aliases: ['合同档案', '合同材料'] }], documents: [] };
  const recommendation = recommendDocumentCategory(database, {
    fileName: '鱼塘协议.docx', detectedModule: 'contract', confidence: 0.9,
    documentClassification: { id: 'contract', module: 'contract', name: '合同或协议', confidence: 0.9, matchedKeywords: ['协议', '甲方'] },
  });
  assert.equal(recommendation.status, 'matched');
  assert.equal(recommendation.name, '综合合同档案');
  assert.match(recommendation.evidence.join('；'), /合同或协议/u);
  assert.match(recommendation.evidence.join('；'), /协议/u);
});

test('旧识别结果可由营业执照文件名纠正分类', () => {
  const recommendation = recommendDocumentCategory({ foundationDictionaries: [], documents: [] }, {
    fileName: '陆庄物业营业执照.jpg', confidence: 0.72,
    documentClassification: { id: 'official-document', module: 'document-drafting', confidence: 0.72 },
  });
  assert.equal(recommendation.status, 'missing');
  assert.equal(recommendation.name, '营业执照');
  assert.equal(recommendation.autoCreate, true);
  assert.equal(recommendation.confidence >= 0.92, true);
});

test('缺少分类时创建一次并归档，再次匹配不会重复创建', async t => {
  const f = await fixture(t);
  const first = await f.service.apply({ fileId: f.entry.id, action: 'create-and-archive' });
  assert.equal(first.ok, true);
  assert.equal(first.file.archiveState, 'archived');
  assert.equal(first.file.finalCategory, '合同档案');
  let database = await f.store.read();
  assert.equal(database.foundationDictionaries.filter(item => item.category === 'document_category').length, 1);
  assert.equal(database.documents[0].category, '合同档案');
  assert.equal(database.aiAssistantOperations.at(-1).type, 'document_category_create_and_archive');

  const secondRecommendation = f.service.recommend(database, { detectedModule: 'contract', confidence: 0.9,
    documentClassification: { id: 'contract', module: 'contract', confidence: 0.9 } });
  assert.equal(secondRecommendation.status, 'matched');
  assert.equal(secondRecommendation.name, '合同档案');
  database = await f.store.read();
  assert.equal(database.foundationDictionaries.length, 1);
});

test('已有分类可自动归档，旧类别记录仍按已有档案读取', async t => {
  const f = await fixture(t, { foundationDictionaries: [{ id: 'category-contract', category: 'document_category', label: '合同档案', aliases: ['协议材料'] }] });
  const result = await f.service.autoArchive(f.entry.id);
  assert.equal(result.archiveState, 'archived');
  assert.equal(result.finalCategory, '合同档案');
  const database = await f.store.read();
  assert.equal(database.foundationDictionaries.length, 1);
  assert.equal(database.documents[0].file_category, '合同档案');
});

test('高置信度营业执照可自动创建分类，普通缺失分类仍等待人工确认', async t => {
  const f = await fixture(t);
  await f.store.update(database => {
    const entry = database.aiFileIndexEntries.find(item => item.id === f.entry.id);
    entry.fileName = '陆庄物业营业执照.jpg';
    entry.detectedModule = 'document';
    entry.confidence = 0.95;
    entry.documentClassification = { id: 'business-license', module: 'document', name: '营业执照或法人资格证书', confidence: 0.95, matchedKeywords: ['营业执照', '统一社会信用代码'] };
    entry.suggestedCategory = f.service.recommend(database, entry);
    return entry;
  });
  const archived = await f.service.autoArchive(f.entry.id);
  assert.equal(archived.archiveState, 'archived');
  assert.equal(archived.finalCategory, '营业执照');

  const recommendation = f.service.recommend({ foundationDictionaries: [], documents: [] }, {
    detectedModule: 'contract', confidence: 0.95,
    documentClassification: { id: 'contract', module: 'contract', confidence: 0.95 },
  });
  assert.equal(recommendation.status, 'missing');
  assert.equal(recommendation.autoCreate, false);
});

test('撤销归档会恢复待归档，未被使用的新分类一并移除', async t => {
  const f = await fixture(t);
  await f.service.apply({ fileId: f.entry.id, action: 'create-and-archive' });
  const undone = await f.service.undo({ fileId: f.entry.id });
  assert.equal(undone.file.archiveState, 'pending');
  assert.equal(undone.file.finalCategory, '');
  const database = await f.store.read();
  assert.equal(database.documents[0].category, '待归档');
  assert.equal(database.foundationDictionaries.length, 0);
  assert.equal(database.aiAssistantOperations.find(item => item.type === 'document_category_create_and_archive').status, 'undone');
  assert.equal(database.aiAssistantOperations.at(-1).type, 'undo');
});

test('无法判断的图片只保留在待归档区', () => {
  const recommendation = recommendDocumentCategory({ foundationDictionaries: [], documents: [] }, {
    format: 'image', detectedModule: 'document', confidence: 0, documentClassification: { id: 'unknown-document', confidence: 0.35 },
  });
  assert.equal(recommendation.status, 'uncertain');
  assert.equal(recommendation.name, '');
});
