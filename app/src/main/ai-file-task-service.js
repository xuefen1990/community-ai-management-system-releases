'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const { parseFoundationGrid } = require('./foundation-excel-reader');
const { FIELD_DEFINITIONS: PERSONNEL_FIELDS, normalizeHeader: normalizePersonnelHeader, normalizeIdCard, parsePersonnelExcelGrid } = require('../shared/personnel-excel-parser');
const { parseContractFeeExcelGrid } = require('../shared/contract-fee-excel-parser');
const { parseDisbursementExcelGrid } = require('../shared/disbursement-excel-parser');
const { AiTaskService } = require('./ai-task-service');
const { revision, personRecordId } = require('./foundation-data-model');
const { AiDocumentCategoryService, PENDING_CATEGORY, normalizeCategoryName } = require('./ai-document-category-service');
const { AiCertificateTemplateIntakeService } = require('./ai-certificate-template-intake-service');

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.docx', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.txt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const FILE_SELECTIONS = Object.freeze({
  all: { title: '选择交给 AI 助理处理的文件', name: 'Excel、Word、PDF 和图片', extensions: [...SUPPORTED_EXTENSIONS].map(item => item.slice(1)) },
  file: { title: '上传文件', name: 'Word、PDF、Excel 和文本', extensions: ['xlsx', 'xls', 'csv', 'docx', 'pdf', 'txt'] },
  image: { title: '上传图片', name: '图片', extensions: [...IMAGE_EXTENSIONS].map(item => item.slice(1)) },
  scan: { title: '选择扫描材料', name: '扫描版 PDF 或图片', extensions: ['pdf', ...IMAGE_EXTENSIONS].map(item => item.replace(/^\./u, '')) },
});

function text(value) { return String(value ?? '').trim(); }
function copy(value) { return structuredClone(value); }
function newId(prefix = 'ai-file') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function decodeXml(value) {
  return String(value || '')
    .replace(/<w:tab\s*\/?\s*>/gu, '\t')
    .replace(/<w:br\s*\/?\s*>/gu, '\n')
    .replace(/<\/w:p>/gu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"').replace(/&apos;/gu, "'")
    .replace(/\n{3,}/gu, '\n\n').trim();
}
function docxParagraphs(xml) {
  return [...String(xml || '').matchAll(/<w:p\b[\s\S]*?<\/w:p>/gu)]
    .map(match => decodeXml(match[0]).replace(/\s*\n\s*/gu, ' ').trim())
    .filter(Boolean);
}
function docxTables(xml) {
  return [...String(xml || '').matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gu)].map((table, tableIndex) => ({
    index: tableIndex + 1,
    rows: [...table[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)].map(row =>
      [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)].map(cell => decodeXml(cell[0]).replace(/\s*\n\s*/gu, ' ').trim())),
  })).filter(table => table.rows.some(row => row.some(Boolean)));
}
function docxSectionTexts(zip, pattern) {
  return Object.keys(zip.files).filter(name => pattern.test(name)).sort().map(name => ({
    name: path.basename(name), text: decodeXml(zip.file(name)?.asText() || ''),
  })).filter(item => item.text);
}
function extractDocumentFields(content) {
  const source = text(content);
  const compact = source.replace(/\s+/gu, '');
  const identities = [...new Set(compact.match(/\d{17}[\dXx]/gu) || [])].slice(0, 10).map(value => value.toUpperCase());
  const phones = [...new Set(compact.match(/1[3-9]\d{9}/gu) || [])].slice(0, 10);
  const dates = [...new Set(compact.match(/(?:19|20)\d{2}[年-](?:0?[1-9]|1[0-2])[月-](?:0?[1-9]|[12]\d|3[01])日?/gu) || [])].slice(0, 10);
  const names = [...new Set([...source.matchAll(/(?:姓名|居民|户主|当事人|申请人|收款人)\s*[：:]?\s*([\u3400-\u9fff·]{2,8})/gu)].map(match => match[1]))].slice(0, 10);
  const fields = [];
  names.forEach((value, index) => fields.push({ key: index ? `name${index + 1}` : 'name', label: index ? `姓名${index + 1}` : '姓名', value, confidence: 0.9, requiresReview: false }));
  identities.forEach((value, index) => fields.push({ key: index ? `idCard${index + 1}` : 'idCard', label: index ? `身份证号${index + 1}` : '身份证号', value, confidence: 0.9, requiresReview: true }));
  phones.forEach((value, index) => fields.push({ key: index ? `phone${index + 1}` : 'phone', label: index ? `联系电话${index + 1}` : '联系电话', value, confidence: 0.9, requiresReview: false }));
  dates.forEach((value, index) => fields.push({ key: index ? `date${index + 1}` : 'date', label: index ? `日期${index + 1}` : '日期', value, confidence: 0.86, requiresReview: false }));
  const amount = source.match(/(?:金额|合计|人民币)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/u)?.[1]?.replace(/,/gu, '');
  if (amount) fields.push({ key: 'amount', label: '金额', value: amount, confidence: 0.86, requiresReview: false });
  return fields;
}
const DOCUMENT_CLASSIFIERS = Object.freeze([
  { id: 'business-license', module: 'document', name: '营业执照或法人资格证书', templateHint: '', keywords: ['营业执照', '统一社会信用代码', '法人资格证书', '法定代表人', '登记管理机关'] },
  { id: 'certificate-template', module: 'certificate', name: '证明模板', templateHint: '', keywords: ['证明模板', '模板样式', '填写说明', '动态字段'] },
  { id: 'relationship-certificate', module: 'certificate', name: '亲属关系证明材料', templateHint: '亲属关系证明', keywords: ['亲属关系', '父子关系', '母子关系', '夫妻关系', '兄弟关系', '姐妹关系'] },
  { id: 'residence-certificate', module: 'certificate', name: '户籍或居住证明材料', templateHint: '户籍常住人口证明', keywords: ['户籍证明', '常住人口证明', '居住证明', '户籍所在地'] },
  { id: 'death-certificate', module: 'certificate', name: '居民死亡证明材料', templateHint: '居民死亡证明', keywords: ['死亡证明', '因病死亡', '死亡日期'] },
  { id: 'housing-certificate', module: 'certificate', name: '宅基地或住房证明材料', templateHint: '宅基地建房/住房证明', keywords: ['宅基地', '建房证明', '住房证明', '房屋坐落'] },
  { id: 'land-certificate', module: 'certificate', name: '土地承包地块证明材料', templateHint: '土地承包地块证明', keywords: ['土地承包', '承包地块', '地块证明', '承包面积'] },
  { id: 'hardship-certificate', module: 'certificate', name: '家庭经济困难证明材料', templateHint: '家庭经济困难证明', keywords: ['经济困难', '困难证明', '家庭收入', '低保'] },
  { id: 'contract', module: 'contract', name: '合同或协议', templateHint: '', keywords: ['合同', '协议', '甲方', '乙方', '签订日期', '合同期限'] },
  { id: 'resident-material', module: 'personnel', name: '居民档案材料', templateHint: '', keywords: ['居民信息', '户籍信息', '户主', '户号', '身份证号'] },
  { id: 'land-material', module: 'land', name: '土地或地块材料', templateHint: '', keywords: ['土地确权', '地块编号', '承包面积', '四至', '实际亩数'] },
  { id: 'disbursement-material', module: 'disbursement', name: '资金发放材料', templateHint: '', keywords: ['发放金额', '实发金额', '补贴金额', '银行卡号', '收款人'] },
  { id: 'finance-material', module: 'finance', name: '财务或票据材料', templateHint: '', keywords: ['财务凭证', '收据', '发票', '收支明细', '报销'] },
  { id: 'party-material', module: 'party', name: '党员或党务材料', templateHint: '', keywords: ['党员', '党支部', '党费', '三会一课'] },
  { id: 'visit-material', module: 'visit', name: '民情或走访材料', templateHint: '', keywords: ['民情', '走访', '来访', '12345'] },
  { id: 'duty-material', module: 'duty', name: '值班材料', templateHint: '', keywords: ['值班安排', '值班人员', '值班日期'] },
  { id: 'work-material', module: 'work', name: '工作事项材料', templateHint: '', keywords: ['工作事项', '办理情况', '完成时限', '责任人'] },
  { id: 'certificate', module: 'certificate', name: '其他证明材料', templateHint: '', keywords: ['证明', '兹证明', '特此证明'] },
  { id: 'official-document', module: 'document-drafting', name: '公文或工作材料', templateHint: '', keywords: ['通知', '请示', '报告', '会议纪要', '工作方案'] },
]);
function classifyDocument(content, fileName = '') {
  const normalizedFileName = text(fileName);
  const source = `${normalizedFileName}\n${text(content)}`;
  const ranked = DOCUMENT_CLASSIFIERS.map((rule, index) => ({
    ...rule,
    index,
    matches: rule.keywords.filter(keyword => source.includes(keyword)),
    fileNameMatches: rule.keywords.filter(keyword => normalizedFileName.includes(keyword)),
  }))
    .filter(rule => rule.matches.length).sort((left, right) => {
      const leftSpecific = left.id === 'certificate' ? 0 : 1;
      const rightSpecific = right.id === 'certificate' ? 0 : 1;
      return rightSpecific - leftSpecific || right.matches.length - left.matches.length || left.index - right.index;
    });
  const match = ranked[0];
  if (!match) return { id: 'unknown-document', module: 'document', name: '待人工判断的材料', templateHint: '', confidence: 0.35, matchedKeywords: [] };
  return { id: match.id, module: match.module, name: match.name, templateHint: match.templateHint,
    confidence: Math.min(0.98, Math.max(match.fileNameMatches.length ? 0.92 : 0, 0.72 + (match.matches.length - 1) * 0.08)),
    matchedKeywords: match.matches };
}

function shouldAutoArchive(recommendation = {}) {
  const confidence = Number(recommendation.confidence) || 0;
  return (recommendation.status === 'matched' && confidence >= 0.72)
    || (recommendation.status === 'missing' && recommendation.autoCreate === true && confidence >= 0.86);
}
function chunksFrom(value, size = 1200, limit = 30) {
  const normalized = text(value).replace(/\r\n?/gu, '\n');
  if (!normalized) return [];
  const chunks = [];
  for (let offset = 0; offset < normalized.length && chunks.length < limit; offset += size) {
    chunks.push({ index: chunks.length + 1, text: normalized.slice(offset, offset + size) });
  }
  return chunks;
}
async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = await fs.readFile(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}
function compactRow(row, limit = 20) {
  return Object.fromEntries(Object.entries(row || {}).slice(0, limit).map(([key, value]) => [text(key).slice(0, 80), text(value).slice(0, 300)]));
}
function normalizeOcrComparable(value) { return text(value).replace(/[\s：:（）()，,。.-]/gu, '').toUpperCase(); }
function ocrValueConfidence(value, pages = []) {
  const requested = normalizeOcrComparable(value);
  const matches = pages.flatMap(page => page.blocks || []).filter(block => normalizeOcrComparable(block.text).includes(requested));
  if (matches.length) return Math.max(...matches.map(block => Number(block.confidence) || 0));
  const page = pages.find(item => normalizeOcrComparable(item.text).includes(requested));
  return Number(page?.confidence) || 0;
}
function extractOcrFields(content, pages = []) {
  const source = text(content);
  const compact = source.replace(/\s+/gu, '');
  const definitions = [
    { key: 'name', label: '姓名', match: source.match(/(?:姓名|居民|户主|当事人)\s*[：:]?\s*([\u3400-\u9fff·]{2,8})/u)?.[1] || '' },
    { key: 'idCard', label: '身份证号', match: compact.match(/\d{17}[\dXx]/u)?.[0]?.toUpperCase() || '' },
    { key: 'phone', label: '联系电话', match: compact.match(/1[3-9]\d{9}/u)?.[0] || '' },
    { key: 'date', label: '日期', match: compact.match(/(?:19|20)\d{2}[年-](?:0?[1-9]|1[0-2])[月-](?:0?[1-9]|[12]\d|3[01])日?/u)?.[0] || '' },
    { key: 'amount', label: '金额', match: source.match(/(?:金额|合计|人民币)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/u)?.[1]?.replace(/,/gu, '') || '' },
  ];
  return definitions.filter(item => item.match).map(item => {
    const confidence = ocrValueConfidence(item.match, pages);
    return { key: item.key, label: item.label, value: item.match, confidence,
      requiresReview: confidence < 0.82 || item.key === 'idCard' };
  });
}
function normalizeOcrResult(result = {}) {
  const pages = (Array.isArray(result.pages) ? result.pages : []).map((page, index) => ({
    pageNumber: Number(page.pageNumber) || index + 1,
    text: text(page.text),
    confidence: Math.max(0, Math.min(1, Number(page.confidence) || 0)),
    blocks: (Array.isArray(page.blocks) ? page.blocks : []).map(block => ({
      text: text(block.text), confidence: Math.max(0, Math.min(1, Number(block.confidence) || 0)),
      x: Number(block.x) || 0, y: Number(block.y) || 0, width: Number(block.width) || 0, height: Number(block.height) || 0,
    })).filter(block => block.text),
  }));
  const content = pages.map(page => page.text).filter(Boolean).join('\n\n');
  const confidence = pages.length ? pages.reduce((total, page) => total + page.confidence, 0) / pages.length : 0;
  return { engine: text(result.engine) || 'ocr', pageCount: Number(result.pageCount) || pages.length || null,
    processedPageCount: Number(result.processedPageCount) || pages.length, truncated: result.truncated === true,
    pages, text: content, confidence, fields: extractOcrFields(content, pages) };
}
const PERSONNEL_KEY_MAP = Object.freeze({ birth_date: 'birthDate', household_id: 'householdNo', village_group: 'villageGroupName', relation_to_head: 'relationToHead' });
const PERSONNEL_COMPARE_FIELDS = Object.freeze([
  ['name', '姓名'], ['gender', '性别'], ['birthDate', '出生日期'], ['phone', '联系电话'], ['householdNo', '户号'],
  ['villageGroupName', "居民小组"], ['relationToHead', '与户主关系'], ['address', '住址'],
]);
function personnelFieldsFromRow(row = {}) {
  const result = {};
  for (const definition of PERSONNEL_FIELDS) {
    const column = Object.keys(row).find(key => definition.aliases.some(alias => normalizePersonnelHeader(alias) === normalizePersonnelHeader(key)));
    if (column === undefined) continue;
    const key = PERSONNEL_KEY_MAP[definition.key] || definition.key;
    result[key] = text(row[column]);
  }
  result.idCard = normalizeIdCard(result.idCard);
  return result;
}
function storedPersonnelFields(record = {}) {
  return {
    name: text(record.name), idCard: normalizeIdCard(record.idCard || record.id_card), gender: text(record.gender),
    birthDate: text(record.birthDate || record.birth_date), phone: text(record.phone),
    householdNo: text(record.householdNo || record.household_id), villageGroupName: text(record.villageGroupName || record.village_group),
    relationToHead: text(record.relationToHead || record.relation_to_head), address: text(record.address),
  };
}
function publicEntry(entry) {
  if (!entry) return null;
  const result = copy(entry);
  if (!result.archiveState) result.archiveState = 'archived';
  if (result.documentId && ['image', 'pdf'].includes(result.format)) result.previewUrl = `community-file://document?id=${encodeURIComponent(result.documentId)}`;
  delete result.archivePath;
  delete result.cachePath;
  return result;
}
function detectExcelModule(headers = [], grid = []) {
  const headerText = headers.map(text).join('|');
  const allText = grid.slice(0, 12).flat().map(text).join('|');
  if (/(地力补贴|补贴面积|补贴标准)/u.test(`${headerText}|${allText}`)) return { id: 'farmland-subsidy', name: '地力补贴台账', confidence: 0.94 };
  if (/(地块编号|地块名称|土地类型)/u.test(headerText) && /(面积|亩|承包人)/u.test(headerText)) return { id: 'land', name: '土地台账', confidence: 0.94 };
  if (/(户主|收款人|银行卡|银行账号)/u.test(headerText) && /(人口|人数|亩数|面积|单价|金额)/u.test(headerText)) return { id: 'contract-fee', name: '承包费项目台账', confidence: 0.92 };
  if (/(发放金额|实发金额|应发金额|补贴金额)/u.test(headerText) && /(姓名|收款人)/u.test(headerText)) return { id: 'disbursement', name: '资金发放明细', confidence: 0.9 };
  if (/(身份证号|公民身份号码)/u.test(headerText) && /(姓名|(?:村民|居民)姓名|人员姓名)/u.test(headerText)) return { id: 'personnel', name: '居民档案', confidence: 0.94 };
  return { id: 'unknown', name: '待人工选择', confidence: 0.35 };
}

class AiFileTaskService {
  constructor({ databaseStore, dialog = null, documentService, taskService = null, businessService = null, backupService = null, contractFeeFileService = null, ocrService = null, visionService = null, categoryService = null, certificateTemplateIntakeService = null, now = () => new Date(), cacheDirectory = '' } = {}) {
    if (!databaseStore?.read || !databaseStore?.update) throw new TypeError('databaseStore is required');
    if (!documentService?.request) throw new TypeError('documentService is required');
    this.databaseStore = databaseStore;
    this.dialog = dialog;
    this.documentService = documentService;
    this.taskService = taskService || new AiTaskService({ databaseStore, now });
    this.businessService = businessService;
    this.backupService = backupService;
    this.contractFeeFileService = contractFeeFileService;
    this.ocrService = ocrService;
    this.visionService = visionService;
    this.now = now;
    this.explicitCacheDirectory = cacheDirectory;
    this.categoryService = categoryService || new AiDocumentCategoryService({ databaseStore, documentService, businessService, now });
    this.certificateTemplateIntakeService = certificateTemplateIntakeService || (businessService
      ? new AiCertificateTemplateIntakeService({ databaseStore, businessService, now }) : null);
  }

  get cacheDirectory() { return this.explicitCacheDirectory || path.join(this.databaseStore.dataDirectory, 'ai-file-index'); }

  async selectAndAnalyze({ conversationId = '', selectionKind = 'all' } = {}) {
    if (!this.dialog) throw new Error('当前环境无法选择文件');
    const selection = FILE_SELECTIONS[selectionKind] || FILE_SELECTIONS.all;
    const selected = await this.dialog.showOpenDialog({
      title: selection.title,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: selection.name, extensions: selection.extensions },
      ],
    });
    if (selected.canceled || !selected.filePaths.length) return { ok: true, canceled: true, files: [] };
    return this.analyzeFiles({ filePaths: selected.filePaths, conversationId });
  }

  async analyzeFiles({ filePaths = [], conversationId = '' } = {}) {
    const files = [];
    for (const filePath of filePaths.slice(0, 10)) files.push(await this.analyzeFile({ filePath, conversationId }));
    const task = files.length ? await this.saveRecognitionTask({ files, conversationId }) : null;
    return { ok: true, canceled: false, files: files.map(publicEntry), task };
  }

  async analyzeFile({ filePath, conversationId = '' } = {}) {
    const resolved = path.resolve(text(filePath));
    const extension = path.extname(resolved).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`暂不支持 ${extension || '该'} 文件，请选择 Excel、Word、PDF 或图片`);
    const stats = await fs.lstat(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('请选择原始普通文件');
    if (stats.size > 100 * 1024 * 1024) throw new Error('单个文件不能超过 100 MB');
    const digest = await sha256(resolved);
    const database = await this.databaseStore.read();
    const duplicate = (database.aiFileIndexEntries || []).find(item => item.sha256 === digest && item.status !== 'deleted');
    if (duplicate) {
      let refreshed = null;
      if (this.ocrService && ['.pdf', ...IMAGE_EXTENSIONS].includes(extension) && !text(duplicate.parser).includes('vision')) {
        refreshed = await this.parseFile(duplicate.archivePath, extension, duplicate.fileName);
        if (duplicate.cachePath) await fs.writeFile(duplicate.cachePath, `${JSON.stringify(refreshed.cache || {}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      }
      const outcome = await this.databaseStore.update(draft => {
        const found = (draft.aiFileIndexEntries ||= []).find(item => item.id === duplicate.id);
        found.conversationIds = [...new Set([...(found.conversationIds || []), text(conversationId)].filter(Boolean))];
        found.lastUsedAt = this.now().toISOString();
        if (refreshed) Object.assign(found, {
          status: refreshed.status, parser: refreshed.parser, detectedModule: refreshed.detectedModule,
          confidence: refreshed.confidence, summary: refreshed.summary, fields: refreshed.fields || [],
          pageCount: refreshed.pageCount || null, chunks: refreshed.chunks || [], warnings: refreshed.warnings || [],
          ocrFields: refreshed.ocrFields || [], ocrPageCount: refreshed.ocrPageCount || 0,
          documentFields: refreshed.documentFields || [], documentClassification: refreshed.documentClassification || null,
          structureSummary: refreshed.structureSummary || null,
        });
        return found;
      });
      const refreshedDatabase = await this.databaseStore.read();
      const recommendation = this.categoryService.recommend(refreshedDatabase, outcome.result);
      const recommendationUpdate = await this.databaseStore.update(draft => {
        const found = (draft.aiFileIndexEntries ||= []).find(item => item.id === duplicate.id);
        found.suggestedCategory = recommendation;
        return found;
      });
      if (!['archived', 'deferred'].includes(text(recommendationUpdate.result.archiveState)) && shouldAutoArchive(recommendation)) {
        try { return { ...(await this.categoryService.autoArchive(duplicate.id)), duplicate: true }; }
        catch (error) {
          const failed = await this.databaseStore.update(draft => {
            const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === duplicate.id);
            stored.warnings = [...new Set([...(stored.warnings || []), `自动归档未完成：${error.message}`])];
            return stored;
          });
          return { ...failed.result, duplicate: true };
        }
      }
      return { ...recommendationUpdate.result, duplicate: true };
    }
    const archived = await this.documentService.request({
      action: 'archive', sourceFilePath: resolved, name: path.basename(resolved), category: PENDING_CATEGORY,
      links: [{ targetType: 'ai_conversation', conversationId: text(conversationId) }],
    });
    if (!archived?.success || !archived.document) throw new Error(archived?.error || '原文件保存到电子档案柜失败');
    const parsed = await this.parseFile(archived.document.file_path, extension, path.basename(resolved));
    const id = newId();
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    const cachePath = path.join(this.cacheDirectory, `${id}.json`);
    await fs.writeFile(cachePath, `${JSON.stringify(parsed.cache || {}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const classificationSource = {
      detectedModule: parsed.detectedModule, confidence: parsed.confidence,
      documentClassification: parsed.documentClassification || null,
    };
    const suggestedCategory = this.categoryService.recommend(database, classificationSource);
    const entry = {
      id, documentId: archived.document.id, fileName: path.basename(resolved), extension, format: parsed.format,
      sizeBytes: stats.size, sha256: digest, status: parsed.status, parser: parsed.parser,
      detectedModule: parsed.detectedModule, confidence: parsed.confidence, summary: parsed.summary,
      fields: parsed.fields || [], sheetNames: parsed.sheetNames || [], pageCount: parsed.pageCount || null,
      totalRows: parsed.totalRows || 0, previewRows: parsed.previewRows || [], chunks: parsed.chunks || [],
      ocrFields: parsed.ocrFields || [], ocrPageCount: parsed.ocrPageCount || 0,
      documentFields: parsed.documentFields || [], documentClassification: parsed.documentClassification || null,
      structureSummary: parsed.structureSummary || null,
      archiveState: 'pending', suggestedCategory, finalCategory: '', categoryDecision: null, businessLinks: [],
      warnings: parsed.warnings || [], conversationIds: [text(conversationId)].filter(Boolean),
      archivePath: archived.document.file_path, cachePath, createdAt: this.now().toISOString(), lastUsedAt: this.now().toISOString(),
    };
    await this.databaseStore.update(draft => { (draft.aiFileIndexEntries ||= []).push(entry); return entry; });
    if (shouldAutoArchive(suggestedCategory)) {
      try { return await this.categoryService.autoArchive(entry.id); }
      catch (error) {
        const outcome = await this.databaseStore.update(draft => {
          const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
          stored.warnings = [...new Set([...(stored.warnings || []), `自动归档未完成：${error.message}`])];
          return stored;
        });
        return outcome.result;
      }
    }
    return entry;
  }

  async parseFile(filePath, extension = path.extname(filePath).toLowerCase(), originalFileName = path.basename(filePath)) {
    if (['.xlsx', '.xls', '.csv'].includes(extension)) return this.parseExcel(filePath);
    if (extension === '.docx') return this.parseDocx(filePath, originalFileName);
    if (extension === '.pdf') return this.parsePdf(filePath, originalFileName);
    if (IMAGE_EXTENSIONS.has(extension)) return this.parseImage(filePath, originalFileName);
    const content = await fs.readFile(filePath, 'utf8');
    const chunks = chunksFrom(content);
    const documentClassification = classifyDocument(content, originalFileName);
    const documentFields = extractDocumentFields(content);
    return { format: 'text', parser: 'plain-text', status: 'parsed', detectedModule: documentClassification.module,
      confidence: documentClassification.confidence, documentClassification, documentFields,
      summary: `已读取文本，共 ${content.length} 个字符；识别为${documentClassification.name}`, chunks,
      cache: { text: content, documentClassification, documentFields } };
  }

  async parseExcel(filePath) {
    const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
    if (!workbook.SheetNames.length) throw new Error('表格中没有工作表');
    const sheets = workbook.SheetNames.map(name => ({ name, grid: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false }) }));
    const primary = sheets[0];
    let generic;
    try { generic = parseFoundationGrid(primary.grid); } catch { generic = { headers: [], allRows: [], totalRows: 0, headerRowNumber: 1 }; }
    const specialized = {};
    for (const [name, parser] of [['personnel', parsePersonnelExcelGrid], ['contractFee', parseContractFeeExcelGrid], ['disbursement', parseDisbursementExcelGrid]]) {
      try { specialized[name] = parser(primary.grid); } catch (error) { specialized[name] = { error: error.message }; }
    }
    const rowCandidates = primary.grid.slice(0, 30).map((row, index) => ({
      ...detectExcelModule(Array.isArray(row) ? row : [], primary.grid),
      headers: Array.isArray(row) ? row.map(text) : [],
      rowIndex: index,
    })).filter(item => item.id !== 'unknown').sort((left, right) => right.confidence - left.confidence || left.rowIndex - right.rowIndex);
    let detected = rowCandidates[0] || detectExcelModule(generic.headers, primary.grid);
    if (specialized.personnel && !specialized.personnel.error && Array.isArray(specialized.personnel.rows) && specialized.personnel.rows.length) {
      detected = { id: 'personnel', name: '居民档案', confidence: Math.max(detected.confidence || 0, 0.94), headers: rowCandidates[0]?.headers || generic.headers };
    }
    const contractFields = specialized.contractFee?.fields || specialized.contractFee?.mapping || {};
    const contractHasBasis = ['population', 'acreage', 'unitPrice', 'amount'].some(key => text(contractFields[key]));
    if (specialized.contractFee && !specialized.contractFee.error && specialized.contractFee.requiresMapping !== true && contractHasBasis) {
      detected = { id: 'contract-fee', name: '承包费项目台账', confidence: Math.max(detected.confidence || 0, 0.92), headers: rowCandidates[0]?.headers || generic.headers };
    }
    const fallbackRowCount = sheets.reduce((total, sheet) => total + Math.max(0, sheet.grid.filter(row => row.some(cell => text(cell))).length - 1), 0);
    const specializedRows = detected.id === 'contract-fee' ? specialized.contractFee?.total
      : detected.id === 'personnel' ? specialized.personnel?.total
        : detected.id === 'disbursement' ? specialized.disbursement?.total : null;
    const rowCount = Number.isFinite(Number(specializedRows)) ? Number(specializedRows) : fallbackRowCount;
    const detectedHeaders = detected.headers?.length ? detected.headers : generic.headers;
    const warnings = [];
    if (detected.id === 'unknown') warnings.push('未能可靠判断业务类型，请人工选择要导入的板块');
    if (!detectedHeaders.length) warnings.push('未识别到稳定表头，请人工核对字段对应关系');
    const mappingRequired = detected.id === 'unknown'
      || (detected.id === 'contract-fee' && specialized.contractFee?.requiresMapping === true)
      || (detected.id === 'disbursement' && specialized.disbursement?.requiresMapping === true);
    if (mappingRequired) warnings.push('导入前需要确认字段匹配');
    return {
      format: 'excel', parser: 'xlsx', status: mappingRequired ? 'needs-review' : 'parsed', detectedModule: detected.id,
      confidence: detected.confidence, summary: `识别到 ${sheets.length} 个工作表、约 ${rowCount} 行数据，建议用于${detected.name}`,
      fields: detectedHeaders.slice(0, 80), sheetNames: workbook.SheetNames, totalRows: rowCount,
      previewRows: generic.allRows.slice(0, 8).map(compactRow), chunks: [], warnings,
      cache: { sheets: sheets.map(sheet => ({ name: sheet.name, grid: sheet.grid })), generic, specialized, detected, mappingRequired },
    };
  }

  async parseDocx(filePath, originalFileName = path.basename(filePath)) {
    const zip = new PizZip(await fs.readFile(filePath));
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const content = decodeXml(documentXml);
    const paragraphs = docxParagraphs(documentXml);
    const tables = docxTables(documentXml);
    const headers = docxSectionTexts(zip, /^word\/header\d*\.xml$/u);
    const footers = docxSectionTexts(zip, /^word\/footer\d*\.xml$/u);
    const hasPageNumber = Object.keys(zip.files).filter(name => /^word\/(document|header\d*|footer\d*)\.xml$/u.test(name))
      .some(name => /(?:<w:instrText[^>]*>\s*(?:PAGE|NUMPAGES)\b|<w:fldSimple[^>]+w:instr="[^"]*(?:PAGE|NUMPAGES)\b)/iu.test(zip.file(name)?.asText() || ''));
    const estimatedPageCount = content ? Math.max(1, 1 + (documentXml.match(/<w:(?:br\b[^>]*w:type="page"|lastRenderedPageBreak\b)/gu) || []).length) : null;
    const documentClassification = classifyDocument([headers.map(item => item.text).join('\n'), content, footers.map(item => item.text).join('\n')].filter(Boolean).join('\n'), originalFileName);
    const documentFields = extractDocumentFields(content);
    const chunks = chunksFrom(content);
    const structureSummary = { paragraphCount: paragraphs.length, tableCount: tables.length, headerCount: headers.length,
      footerCount: footers.length, hasPageNumber, estimatedPageCount };
    return {
      format: 'word', parser: 'docx-structured', status: content ? 'parsed' : 'needs-review', detectedModule: documentClassification.module,
      confidence: content ? Math.max(0.88, documentClassification.confidence) : 0.2, documentClassification, documentFields, structureSummary,
      summary: content ? `已读取 Word 正文、${tables.length} 个表格及页眉页脚；识别为${documentClassification.name}` : 'Word 文件未提取到正文，请人工打开核对',
      pageCount: estimatedPageCount, chunks, warnings: content ? ['带入业务页面前仍需人工核对原文件'] : ['未提取到可检索正文'],
      cache: { text: content, paragraphs, tables, headers, footers, hasPageNumber, estimatedPageCount, documentClassification, documentFields },
    };
  }

  async parsePdf(filePath, originalFileName = path.basename(filePath)) {
    if (this.ocrService) {
      try { return this.parseOcrResult(await this.ocrService.recognize(filePath), 'pdf', 0, originalFileName); }
      catch { /* fall through to the portable metadata reader */ }
    }
    const raw = (await fs.readFile(filePath)).toString('latin1');
    const pageCount = (raw.match(/\/Type\s*\/Page\b/gu) || []).length || null;
    const literal = [...raw.matchAll(/\(([^()]*)\)\s*Tj/gu)].map(match => match[1]).join(' ')
      .replace(/\\([()\\])/gu, '$1').replace(/\\n/gu, '\n').trim();
    const chunks = chunksFrom(literal);
    const readable = literal.length >= 20;
    const documentClassification = classifyDocument(literal, originalFileName);
    const documentFields = extractDocumentFields(literal);
    return {
      format: 'pdf', parser: readable ? 'pdf-text' : 'pdf-metadata', status: readable ? 'parsed' : 'needs-review', detectedModule: documentClassification.module,
      confidence: readable ? 0.62 : 0.15, summary: readable ? `已提取 PDF 文本，共 ${literal.length} 个字符` : 'PDF 可能是扫描件或使用了特殊字体，需要人工核对识别结果',
      pageCount, chunks, documentClassification, documentFields,
      warnings: readable ? ['PDF 文本提取结果需要人工核对排版'] : ['当前未提取到可靠文字，已保留原文件等待进一步识别'],
      cache: { text: literal, pageCount, documentClassification, documentFields },
    };
  }

  async parseImage(filePath, originalFileName = path.basename(filePath)) {
    const stats = await fs.stat(filePath);
    if (this.ocrService) {
      try { return this.parseOcrResult(await this.ocrService.recognize(filePath), 'image', stats.size, originalFileName); }
      catch (error) {
        return {
          format: 'image', parser: 'image-metadata', status: 'needs-review', detectedModule: 'document', confidence: 0,
          summary: `图片已安全保存（${Math.ceil(stats.size / 1024)} KB），暂时未能识别文字`,
          warnings: [`离线文字识别未完成：${error.message}`], cache: { sizeBytes: stats.size, ocrError: error.message },
        };
      }
    }
    return {
      format: 'image', parser: 'image-metadata', status: 'needs-review', detectedModule: 'document', confidence: 0,
      summary: `图片已安全保存（${Math.ceil(stats.size / 1024)} KB），等待文字识别或人工说明用途`,
      warnings: ['图片尚未产生可靠文字，不能直接据此写入业务数据'], cache: { sizeBytes: stats.size },
    };
  }

  parseOcrResult(rawResult, format, sizeBytes = 0, originalFileName = '') {
    const ocr = normalizeOcrResult(rawResult);
    const documentClassification = classifyDocument(ocr.text, originalFileName);
    const documentFields = extractDocumentFields(ocr.text).map(field => {
      const confidence = ocrValueConfidence(field.value, ocr.pages);
      return { ...field, confidence, requiresReview: confidence < 0.82 || field.key.startsWith('idCard') };
    });
    const lowConfidenceCount = documentFields.filter(field => field.requiresReview).length;
    const warnings = ['识别内容尚未写入任何业务台账，请人工核对原文件'];
    if (lowConfidenceCount) warnings.push(`有 ${lowConfidenceCount} 个关键信息需要重点核对`);
    if (ocr.truncated) warnings.push(`文件共 ${ocr.pageCount} 页，本次先识别前 ${ocr.processedPageCount} 页`);
    if (!ocr.text) warnings.push('没有识别到可用文字，请打开原文件人工核对');
    return {
      format, parser: ocr.engine, status: 'needs-review', detectedModule: documentClassification.module, confidence: ocr.confidence,
      documentClassification, documentFields,
      summary: ocr.text
        ? `已离线识别 ${ocr.processedPageCount} 页、${ocr.text.length} 个文字，需人工核对后使用`
        : `${format === 'pdf' ? '扫描版 PDF' : '图片'}未识别到可用文字，请人工核对`,
      pageCount: ocr.pageCount, ocrPageCount: ocr.processedPageCount, ocrFields: documentFields,
      chunks: chunksFrom(ocr.text), warnings,
      cache: { text: ocr.text, pageCount: ocr.pageCount, ocrPages: ocr.pages, ocrFields: documentFields,
        documentClassification, documentFields,
        ocrEngine: ocr.engine, ocrTruncated: ocr.truncated, sizeBytes },
    };
  }

  async saveRecognitionTask({ files, conversationId }) {
    const reviewCount = files.filter(file => file.status === 'needs-review').length;
    const pendingArchiveCount = files.filter(file => (file.archiveState || 'archived') !== 'archived').length;
    const task = await this.taskService.save({
      title: files.length === 1 ? `识别文件：${files[0].fileName}` : `识别 ${files.length} 个文件`,
      taskKind: 'file-recognition', conversationId: text(conversationId), originalRequest: '上传文件并识别内容',
      clarifiedRequest: '保存原文件、识别格式和业务用途，核对归档分类，导入前等待人工确认', status: pendingArchiveCount ? 'waiting-input' : 'completed',
      artifactIds: files.map(file => file.id), fileEntries: files.map(publicEntry),
      steps: [
        { id: 'save-original', title: '保存原文件', toolId: 'file.archive', status: 'completed', resultSummary: `${files.length} 个文件已安全保存到待归档区` },
        { id: 'parse-content', title: '识别文件内容', toolId: 'file.parse', status: 'completed', resultSummary: `${files.length - reviewCount} 个已识别，${reviewCount} 个需人工核对` },
        { id: 'identify-business', title: '判断业务用途', toolId: 'file.classify', status: 'completed', resultSummary: files.map(file => file.summary).join('；').slice(0, 900) },
        { id: 'classify-archive', title: '核对档案分类', toolId: 'document.category-assign', status: pendingArchiveCount ? 'waiting-input' : 'completed',
          resultSummary: pendingArchiveCount ? `${pendingArchiveCount} 个文件等待选择或创建档案分类` : '已匹配现有分类并完成归档' },
      ],
      summary: pendingArchiveCount ? `文件已保存并完成初步识别；${pendingArchiveCount} 个等待核对归档分类`
        : reviewCount ? `文件已归档；其中 ${reviewCount} 个需要人工核对后才能导入` : '文件已保存、识别并完成档案分类；尚未写入业务台账',
      verification: { passed: true, message: '原文件哈希、电子档案记录和 AI 文件索引均已建立' },
    });
    await this.databaseStore.update(draft => {
      for (const file of files) {
        const entry = (draft.aiFileIndexEntries ||= []).find(item => item.id === file.id);
        if (entry) entry.taskId = task.id;
      }
      return task.id;
    });
    return task;
  }

  async indexedFile(fileId) {
    const database = await this.databaseStore.read();
    const entry = (database.aiFileIndexEntries || []).find(item => item.id === text(fileId) && item.status !== 'deleted');
    if (!entry) throw new Error('没有找到该文件识别记录，请重新上传');
    return { database, entry };
  }

  async cachedParse(entry) {
    const resolved = path.resolve(text(entry.cachePath));
    const expectedDirectory = path.resolve(this.cacheDirectory);
    if (!resolved.startsWith(`${expectedDirectory}${path.sep}`)) throw new Error('文件识别缓存位置不正确，请重新上传');
    return JSON.parse(await fs.readFile(resolved, 'utf8'));
  }

  async reviewOcr({ fileId } = {}) {
    const { entry } = await this.indexedFile(fileId);
    if (!['image', 'pdf', 'word', 'text'].includes(entry.format)) throw new Error('该文件暂不支持文字内容核对');
    const cached = await this.cachedParse(entry);
    const savedReview = entry.contentReview?.confirmed ? entry.contentReview : entry.ocrReview?.confirmed ? entry.ocrReview : null;
    const source = savedReview || cached;
    const review = {
      file: publicEntry(entry), text: text(source.text), pages: copy(cached.ocrPages || []),
      fields: copy(source.fields || cached.documentFields || cached.ocrFields || entry.documentFields || entry.ocrFields || []),
      confidence: Number(entry.confidence) || 0, structure: copy({ paragraphs: cached.paragraphs || [], tables: cached.tables || [],
        headers: cached.headers || [], footers: cached.footers || [], hasPageNumber: cached.hasPageNumber === true,
        estimatedPageCount: cached.estimatedPageCount || entry.pageCount || null }),
      classification: copy(source.classification || cached.documentClassification || entry.documentClassification || classifyDocument(source.text, entry.fileName)),
      confirmed: savedReview?.confirmed === true,
    };
    review.reviewRevision = crypto.createHash('sha256').update(JSON.stringify({ file: entry.sha256, text: review.text,
      fields: review.fields, confirmed: review.confirmed })).digest('hex');
    return { ok: true, ...review };
  }

  async confirmOcrReview({ fileId, reviewRevision = '', text: correctedText = '', fields = [], confirmed = false } = {}) {
    if (confirmed !== true) throw new Error('请先确认已经对照原文件核对识别内容');
    const preview = await this.reviewOcr({ fileId });
    if (!reviewRevision || preview.reviewRevision !== reviewRevision) throw new Error('识别结果在核对期间发生变化，请重新打开核对');
    const normalizedFields = (Array.isArray(fields) ? fields : []).slice(0, 50).map(field => ({
      key: text(field.key).slice(0, 50), label: text(field.label).slice(0, 50), value: text(field.value).slice(0, 500),
      confidence: Math.max(0, Math.min(1, Number(field.confidence) || 0)), requiresReview: false,
    })).filter(field => field.key && field.label);
    const reviewedText = text(correctedText).slice(0, 100_000);
    const classification = classifyDocument(reviewedText, preview.file.fileName);
    const currentDatabase = await this.databaseStore.read();
    const reviewedCategory = this.categoryService.recommend(currentDatabase, {
      detectedModule: classification.module, confidence: classification.confidence, documentClassification: classification,
    });
    const outcome = await this.databaseStore.update(draft => {
      const entry = (draft.aiFileIndexEntries ||= []).find(item => item.id === text(fileId) && item.status !== 'deleted');
      if (!entry) throw new Error('没有找到该文件识别记录，请重新上传');
      entry.contentReview = { confirmed: true, text: reviewedText, fields: normalizedFields, classification, reviewedAt: this.now().toISOString() };
      if (['image', 'pdf'].includes(entry.format)) entry.ocrReview = copy(entry.contentReview);
      entry.status = 'reviewed';
      entry.detectedModule = classification.module;
      entry.documentClassification = classification;
      if ((entry.archiveState || 'archived') !== 'archived') entry.suggestedCategory = reviewedCategory;
      entry.documentFields = normalizedFields;
      entry.summary = `材料内容已人工核对，共 ${reviewedText.length} 个文字；识别为${classification.name}`;
      entry.chunks = chunksFrom(reviewedText);
      entry.ocrFields = normalizedFields;
      entry.lastUsedAt = this.now().toISOString();
      return entry;
    });
    let savedFile = outcome.result;
    if (savedFile.archiveState === 'pending' && reviewedCategory.status === 'matched' && Number(reviewedCategory.confidence) >= 0.72) {
      savedFile = await this.categoryService.autoArchive(savedFile.id);
    }
    if (savedFile.taskId) {
      const task = (await this.taskService.list({ limit: 100 })).find(item => item.id === savedFile.taskId);
      if (task) {
        const steps = (task.steps || []).filter(step => step.id !== 'review-ocr');
        steps.push({ id: 'review-ocr', title: '人工核对材料内容', toolId: 'file.content-review', status: 'completed',
          resultSummary: `已确认 ${normalizedFields.length} 个关键信息、${reviewedText.length} 个文字` });
        await this.taskService.save({ ...task, steps,
          summary: `原文件已保留，材料内容已经人工核对并识别为${classification.name}；尚未写入业务台账`,
          verification: { passed: true, message: '已保存人工核对结果，可随原文件继续追溯' } });
      }
      await this.syncCategoryTask(savedFile);
    }
    return { ok: true, confirmed: true, file: publicEntry(savedFile), classification,
      message: `材料内容已确认，并识别为${classification.name}。原文件和修正内容均已保留。` };
  }

  async prepareDocumentHandoff({ fileId, targetModule = 'auto' } = {}) {
    const { entry } = await this.indexedFile(fileId);
    const cached = await this.cachedParse(entry);
    const review = entry.contentReview?.confirmed ? entry.contentReview : entry.ocrReview?.confirmed ? entry.ocrReview : null;
    if (!review) throw new Error('请先对照原文件核对材料内容，再带入办理页面');
    const classification = review.classification || entry.documentClassification || classifyDocument(review.text, entry.fileName);
    const moduleId = targetModule === 'auto' ? classification.module : text(targetModule);
    if (!['certificate', 'document-drafting'].includes(moduleId)) throw new Error('这份材料的办理用途还不明确，请核对正文中是否包含证明、通知、请示或报告等用途');
    const navigationTarget = moduleId === 'certificate' ? 'tab-certificate' : 'tab-document-drafting';
    const payload = {
      sourceFileId: entry.id, sourceDocumentId: entry.documentId, fileName: entry.fileName,
      text: text(review.text).slice(0, 100_000), fields: copy(review.fields || entry.documentFields || []),
      classification: copy(classification), structure: copy({ tables: cached.tables || [], headers: cached.headers || [],
        footers: cached.footers || [], hasPageNumber: cached.hasPageNumber === true }),
    };
    await this.databaseStore.update(draft => {
      const file = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (file) { file.lastUsedAt = this.now().toISOString(); file.handoffTarget = moduleId; file.handoffPreparedAt = this.now().toISOString(); }
      return true;
    });
    if (entry.taskId) {
      const task = (await this.taskService.list({ limit: 100 })).find(item => item.id === entry.taskId);
      if (task) {
        const steps = (task.steps || []).filter(step => step.id !== 'prepare-document-handoff');
        steps.push({ id: 'prepare-document-handoff', title: '带入办理页面', toolId: `file.handoff.${moduleId}`, status: 'completed',
          resultSummary: `已将人工核对内容带入${moduleId === 'certificate' ? '证明管理' : '公文拟写'}` });
        await this.taskService.save({ ...task, steps, summary: `材料已核对，并安全带入${moduleId === 'certificate' ? '证明管理' : '公文拟写'}；尚未自动保存业务结果`,
          verification: { passed: true, message: '仅带入已人工确认的文字，办理页面仍需人工确认后保存' } });
      }
    }
    return { ok: true, file: publicEntry(entry), targetModule: moduleId, navigationTarget, payload,
      message: `已准备带入${moduleId === 'certificate' ? '证明管理' : '公文拟写'}，不会自动开具或保存。` };
  }

  async archiveGeneratedArtifact({ sourceFileId, sourceFilePath, name = '', category = 'AI 任务生成结果', links = [] } = {}) {
    const resolved = path.resolve(text(sourceFilePath));
    const stats = await fs.lstat(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('生成文件不存在或不是普通文件');
    const { entry } = await this.indexedFile(sourceFileId);
    const archived = await this.documentService.request({ action: 'archive', sourceFilePath: resolved,
      name: text(name) || path.basename(resolved), category,
      links: [{ targetType: 'ai_source_file', fileId: entry.id, documentId: entry.documentId }, ...copy(links || [])] });
    if (!archived?.success || !archived.document) throw new Error(archived?.error || '生成文件归档失败');
    await this.databaseStore.update(draft => {
      const file = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (file) {
        file.generatedArtifactIds = [...new Set([...(file.generatedArtifactIds || []), archived.document.id])];
        file.lastUsedAt = this.now().toISOString();
      }
      return true;
    });
    if (entry.taskId) {
      const task = (await this.taskService.list({ limit: 100 })).find(item => item.id === entry.taskId);
      if (task) {
        const steps = (task.steps || []).filter(step => step.id !== `archive-output-${archived.document.id}`);
        steps.push({ id: `archive-output-${archived.document.id}`, title: '归档生成结果', toolId: 'file.archive-output', status: 'completed',
          resultSummary: `${text(name) || path.basename(resolved)} 已存入电子档案柜` });
        await this.taskService.save({ ...task, artifactIds: [...new Set([...(task.artifactIds || []), archived.document.id])], steps,
          summary: '原始材料、人工核对内容和生成结果已经关联归档',
          verification: { passed: true, message: '生成文件已回挂原 AI 任务，可从电子档案和任务记录追溯' } });
      }
    }
    return { ok: true, documentId: archived.document.id, name: archived.document.name || text(name) || path.basename(resolved) };
  }

  buildPersonnelImportPreview(database, entry, parsed) {
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const sourceTotal = rows.length;
    const people = Array.isArray(database.personnel) ? database.personnel : [];
    const byCard = new Map();
    for (const [index, person] of people.entries()) {
      const card = normalizeIdCard(person.idCard || person.id_card);
      if (!card) continue;
      if (!byCard.has(card)) byCard.set(card, []);
      byCard.get(card).push({ person, index });
    }
    const actions = rows.slice(0, 1000).map((row, index) => {
      const incoming = personnelFieldsFromRow(row);
      const matches = byCard.get(incoming.idCard) || [];
      if (!incoming.idCard) return { index, action: 'skip', reason: '缺少有效身份证号', incoming };
      if (!incoming.name) return { index, action: 'skip', reason: '缺少居民姓名', incoming };
      if (matches.length > 1) return { index, action: 'conflict', reason: '本地存在多条相同身份证档案', incoming };
      if (!matches.length) return { index, action: 'create', reason: '身份证号在居民档案中不存在', incoming };
      const { person, index: personIndex } = matches[0];
      const existing = storedPersonnelFields(person);
      const conflicts = [];
      const additions = [];
      for (const [key, label] of PERSONNEL_COMPARE_FIELDS) {
        if (!incoming[key]) continue;
        if (existing[key] && existing[key] !== incoming[key]) conflicts.push({ field: key, label, existing: existing[key], incoming: incoming[key] });
        else if (!existing[key]) additions.push({ field: key, label, value: incoming[key] });
      }
      const identity = { id: personRecordId(person, personIndex), version: revision(person) };
      if (conflicts.length) return { index, action: 'conflict', reason: `有 ${conflicts.length} 项资料与现有档案不同`, incoming, existing, conflicts, additions, ...identity };
      if (!additions.length) return { index, action: 'skip', reason: '居民资料已存在且没有可补充字段', incoming, existing, additions, ...identity };
      return { index, action: 'update', reason: `补充 ${additions.map(item => item.label).join('、')}`, incoming, existing, additions, ...identity };
    });
    const counts = Object.fromEntries(['create', 'update', 'conflict', 'skip'].map(action => [action, actions.filter(item => item.action === action).length]));
    const previewRevision = crypto.createHash('sha256').update(JSON.stringify({ file: entry.sha256, people: database.personnel || [] })).digest('hex');
    return { actions, counts, previewRevision, sourceTotal, exceedsLimit: sourceTotal > 1000 };
  }

  async previewImport({ fileId, targetModule = 'auto' } = {}) {
    const { database, entry } = await this.indexedFile(fileId);
    const moduleId = targetModule === 'auto' ? entry.detectedModule : text(targetModule);
    if (moduleId !== 'personnel') {
      const names = { 'contract-fee': '承包费项目台账', disbursement: '资金发放明细', 'farmland-subsidy': '地力补贴台账', land: '土地台账' };
      const cache = await this.cachedParse(entry);
      const specialized = moduleId === 'contract-fee' ? cache.specialized?.contractFee : moduleId === 'disbursement' ? cache.specialized?.disbursement : null;
      const rows = Array.isArray(specialized?.rows) ? specialized.rows.map(row => row.rawData || row).slice(0, 8) : (entry.previewRows || []).slice(0, 8);
      return { ok: true, file: publicEntry(entry), targetModule: moduleId, requiresBusinessContext: true,
        fields: entry.fields || [], total: Number(specialized?.total ?? entry.totalRows) || 0, rows,
        navigationTarget: ['contract-fee', 'disbursement', 'farmland-subsidy'].includes(moduleId) ? 'tab-contract-fees' : moduleId === 'land' ? 'tab-land' : '',
        message: `${names[moduleId] || '该类文件'}需要先选择具体项目、居民组或模板，请到对应业务板块继续核对，系统不会直接写入。` };
    }
    const cache = await this.cachedParse(entry);
    const parsed = cache.specialized?.personnel;
    if (!parsed || parsed.error || !Array.isArray(parsed.rows)) throw new Error(parsed?.error || '该文件没有可用于居民导入的数据');
    if (this.businessService) {
      const permission = await this.businessService.request({ method: 'GET', path: '/api/v3/people?limit=1' });
      if (!permission?.ok) throw new Error(permission?.error?.message || '当前账号没有查看居民资料的权限');
    }
    const preview = this.buildPersonnelImportPreview(database, entry, parsed);
    return { ok: true, file: publicEntry(entry), targetModule: 'personnel', previewRevision: preview.previewRevision,
      counts: preview.counts, total: preview.sourceTotal, canImport: !preview.exceedsLimit && preview.counts.create + preview.counts.update > 0,
      rows: preview.actions.slice(0, 100).map(item => ({ index: item.index + 1, name: item.incoming.name, idCard: item.incoming.idCard,
        groupName: item.incoming.villageGroupName || '', action: item.action, reason: item.reason, conflicts: item.conflicts || [] })),
      truncated: preview.actions.length > 100,
      message: preview.exceedsLimit ? `表格共有 ${preview.sourceTotal} 条有效居民资料，单次最多安全导入 1000 条，请先拆分表格后再确认。`
        : `共核对 ${preview.actions.length} 条：新增 ${preview.counts.create} 条，补充 ${preview.counts.update} 条，冲突 ${preview.counts.conflict} 条，跳过 ${preview.counts.skip} 条。冲突资料不会自动覆盖。`,
    };
  }

  async prepareBusinessImport({ fileId, targetModule = 'auto' } = {}) {
    if (!this.contractFeeFileService) throw new Error('资金文件交接服务尚未启用，请重新启动开发版');
    const { entry } = await this.indexedFile(fileId);
    if (entry.format !== 'excel') throw new Error('只有 Excel 表格可以带入资金发放页面');
    const moduleId = targetModule === 'auto' ? text(entry.detectedModule) : text(targetModule);
    if (!['contract-fee', 'disbursement', 'farmland-subsidy'].includes(moduleId)) throw new Error('该文件暂不能带入资金发放页面');
    if (entry.detectedModule !== moduleId) throw new Error('文件识别类型已经变化，请重新查看导入预览');
    const readers = {
      'contract-fee': 'readExcel',
      disbursement: 'readDisbursementExcel',
      'farmland-subsidy': 'readFarmlandSubsidyExcel',
    };
    const data = await this.contractFeeFileService[readers[moduleId]](entry.archivePath);
    await this.databaseStore.update(draft => {
      const file = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (file) {
        file.lastUsedAt = this.now().toISOString();
        file.handoffTarget = moduleId;
        file.handoffPreparedAt = this.now().toISOString();
      }
      return true;
    });
    return { ok: true, file: publicEntry(entry), targetModule: moduleId, data,
      message: moduleId === 'contract-fee' ? '表格已带入承包费项目建立页面，请填写项目、组别和固定总额后核对。'
        : moduleId === 'disbursement' ? '表格已带入资金发放页面，请选择发放模板后核对。'
          : '表格已带入地力补贴主表，请核对后再保存。' };
  }

  async confirmImport({ fileId, targetModule = 'personnel', previewRevision = '', confirmed = false } = {}) {
    if (confirmed !== true) throw new Error('请先查看导入预览并确认');
    if (targetModule !== 'personnel') throw new Error('该业务类型需要到对应业务板块确认项目、组别或模板后导入');
    if (!this.businessService || !this.backupService) throw new Error('当前环境尚未启用安全导入服务');
    const { database, entry } = await this.indexedFile(fileId);
    const cache = await this.cachedParse(entry);
    const parsed = cache.specialized?.personnel;
    if (!parsed || parsed.error || !Array.isArray(parsed.rows)) throw new Error(parsed?.error || '该文件没有可用于居民导入的数据');
    const preview = this.buildPersonnelImportPreview(database, entry, parsed);
    if (preview.exceedsLimit) throw new Error(`表格共有 ${preview.sourceTotal} 条有效居民资料，单次最多安全导入 1000 条，请先拆分表格`);
    if (!previewRevision || preview.previewRevision !== previewRevision) throw new Error('居民资料在预览后发生变化，请重新核对导入预览');
    const selected = preview.actions.filter(item => ['create', 'update'].includes(item.action));
    if (!selected.length) return { ok: true, imported: false, counts: preview.counts, message: '没有需要新增或补充的居民资料' };
    const importJobId = newId('ai-personnel-import');
    const snapshot = await this.backupService.create({ source: 'import', importJobId, importDomain: 'personnel' });
    const items = selected.map(item => {
      const additions = new Set((item.additions || []).map(value => value.field));
      const source = item.incoming;
      const fields = item.action === 'create'
        ? Object.fromEntries(['name', 'idCard', 'gender', 'birthDate', 'phone', 'relationToHead', 'address'].filter(key => source[key]).map(key => [key, source[key]]))
        : { name: item.existing.name, idCard: item.existing.idCard, ...Object.fromEntries([...additions].filter(key => !['householdNo', 'villageGroupName'].includes(key)).map(key => [key, source[key]])) };
      return { ...(item.id ? { id: item.id, baseVersion: item.version } : {}), fields,
        ...(source.householdNo && (item.action === 'create' || additions.has('householdNo')) ? { householdNo: source.householdNo } : {}),
        ...(source.villageGroupName && (item.action === 'create' || additions.has('villageGroupName')) ? { villageGroupName: source.villageGroupName } : {}) };
    });
    const saved = await this.businessService.request({ method: 'POST', path: '/api/v3/people/batch-upsert', body: { items } });
    if (!saved?.ok) throw new Error(saved?.error?.message || '居民资料导入失败');
    const outcome = saved.data || {};
    const report = { fileEntryId: entry.id, fileName: entry.fileName, totalRows: preview.actions.length,
      insertedRows: Number(outcome.insertedRows) || 0, updatedRows: Number(outcome.updatedRows) || 0,
      conflictRows: preview.counts.conflict, skippedRows: preview.counts.skip, failedRows: Array.isArray(outcome.failed) ? outcome.failed.length : 0,
      backupRelativePath: snapshot.relativePath, completedAt: this.now().toISOString() };
    const recorded = await this.businessService.request({ method: 'POST', path: '/api/v3/import-jobs', body: {
      id: importJobId, domain: 'personnel', totalRows: report.totalRows, insertedRows: report.insertedRows,
      updatedRows: report.updatedRows, report,
    } });
    if (!recorded?.ok) throw new Error(recorded?.error?.message || '导入已完成，但导入记录保存失败，请立即核对居民档案');
    await this.databaseStore.update(draft => {
      const file = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (file) { file.importStatus = report.failedRows ? 'completed-with-errors' : 'completed'; file.importJobId = importJobId; file.importReport = report; file.lastUsedAt = this.now().toISOString(); }
      return report;
    });
    if (entry.taskId) {
      const task = (await this.taskService.list({ limit: 100 })).find(item => item.id === entry.taskId);
      if (task) await this.taskService.save({ ...task, status: 'completed', steps: [...(task.steps || []),
        { id: 'preview-import', title: '核对导入影响', toolId: 'file.import-preview', status: 'completed', resultSummary: `新增 ${preview.counts.create}，补充 ${preview.counts.update}，冲突 ${preview.counts.conflict}，跳过 ${preview.counts.skip}` },
        { id: 'confirm-import', title: '确认并导入居民档案', toolId: 'personnel.batch-upsert', status: report.failedRows ? 'failed' : 'completed', resultSummary: `新增 ${report.insertedRows}，补充 ${report.updatedRows}，失败 ${report.failedRows}` },
      ], summary: `居民表导入完成：新增 ${report.insertedRows} 条，补充 ${report.updatedRows} 条`, verification: {
        passed: report.failedRows === 0 && report.insertedRows + report.updatedRows === selected.length,
        message: `已复核保存结果；冲突 ${report.conflictRows} 条和跳过 ${report.skippedRows} 条均未覆盖原档案`,
      } });
    }
    return { ok: true, imported: true, counts: report, importJobId, backupRelativePath: snapshot.relativePath,
      message: `导入完成：新增 ${report.insertedRows} 人，补充 ${report.updatedRows} 人；冲突 ${report.conflictRows} 条、跳过 ${report.skippedRows} 条未写入。` };
  }

  async applyCategoryDecision(value = {}) {
    const result = await this.categoryService.apply(value);
    await this.syncCategoryTask(result.file);
    return { ...result, file: publicEntry(result.file) };
  }

  async undoCategoryDecision(value = {}) {
    const result = await this.categoryService.undo(value);
    await this.syncCategoryTask(result.file);
    return { ...result, file: publicEntry(result.file) };
  }

  async previewCertificateTemplate({ fileId } = {}) {
    if (!this.certificateTemplateIntakeService) throw new Error('证明模板识别服务尚未启用，请重新启动开发版');
    const { database, entry } = await this.indexedFile(fileId);
    const cached = await this.cachedParse(entry);
    if (['image', 'pdf'].includes(entry.format) && !entry.contentReview?.confirmed && entry.status !== 'reviewed') {
      throw new Error('图片或 PDF 的文字可能有识别误差，请先核对材料内容，再整理为证明模板');
    }
    const content = text(entry.contentReview?.text || entry.ocrReview?.text || cached.text || cached.ocrText);
    if (!content) throw new Error('没有提取到可用于建立模板的文字，请先核对并补录材料内容');
    const preview = this.certificateTemplateIntakeService.preview(database, entry, content);
    await this.databaseStore.update(draft => {
      const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (stored) stored.certificateTemplateIntake = { candidate: copy(preview.candidate), match: copy(preview.match), previewedAt: this.now().toISOString() };
      return true;
    });
    return { ok: true, ...preview };
  }

  async applyCertificateTemplateDecision(value = {}) {
    if (!this.certificateTemplateIntakeService) throw new Error('证明模板识别服务尚未启用，请重新启动开发版');
    const result = await this.certificateTemplateIntakeService.apply(value);
    return { ...result, file: publicEntry(result.file) };
  }

  async undoCertificateTemplateDecision(value = {}) {
    if (!this.certificateTemplateIntakeService) throw new Error('证明模板识别服务尚未启用，请重新启动开发版');
    return this.certificateTemplateIntakeService.undoDraft(value);
  }

  async describeImage({ fileId, confirmed = false, instruction = '' } = {}) {
    if (!this.visionService) throw new Error('图片理解服务尚未启用，请重新启动开发版');
    const { entry } = await this.indexedFile(fileId);
    if (entry.format !== 'image') throw new Error('当前只有图片可以使用视觉理解');
    const result = await this.visionService.describe({ entry, confirmed, instruction });
    await this.databaseStore.update(draft => {
      const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (stored) stored.visionReview = { ...copy(result), reviewedAt: this.now().toISOString() };
      return true;
    });
    return { ok: true, file: publicEntry(entry), ...result };
  }

  async syncCategoryTask(file) {
    const database = await this.databaseStore.read();
    const tasks = await this.taskService.list({ limit: 100 }).catch(() => []);
    const related = tasks.filter(task => {
      const ids = new Set([...(task.artifactIds || []), ...(task.fileEntries || []).map(entry => entry?.id)].map(text));
      return ids.has(text(file?.id)) || (file?.taskId && text(task.id) === text(file.taskId));
    });
    for (const task of related) {
      const ids = new Set([...(task.artifactIds || []), ...(task.fileEntries || []).map(entry => entry?.id)].map(text));
      const entries = (database.aiFileIndexEntries || []).filter(item => ids.has(text(item.id)));
      const pending = entries.filter(item => !['archived', 'deferred'].includes(item.archiveState || 'archived')).length;
      const archived = entries.filter(item => (item.archiveState || 'archived') === 'archived').length;
      const deferred = entries.filter(item => item.archiveState === 'deferred').length;
      const categoryStep = {
        id: 'classify-archive', title: '核对档案分类', toolId: 'document.category-assign',
        status: pending ? 'waiting-input' : deferred && !archived ? 'skipped' : 'completed',
        resultSummary: pending ? `${pending} 个文件等待选择或创建档案分类`
          : `${archived} 个已归档${deferred ? `，${deferred} 个暂不归档` : ''}`,
      };
      const expectedStatus = pending ? 'waiting-input' : 'completed';
      const currentCategoryStep = (task.steps || []).find(step => step.id === 'classify-archive');
      const taskFilesAreCurrent = entries.every(entry => {
        const snapshot = (task.fileEntries || []).find(item => text(item.id) === text(entry.id));
        return snapshot
          && text(snapshot.archiveState || 'archived') === text(entry.archiveState || 'archived')
          && text(snapshot.finalCategory) === text(entry.finalCategory);
      });
      if (text(task.status) === expectedStatus && text(currentCategoryStep?.status) === text(categoryStep.status) && taskFilesAreCurrent) continue;
      await this.taskService.save({
        ...task, status: expectedStatus, fileEntries: entries.map(publicEntry),
        steps: [...(task.steps || []).filter(step => step.id !== 'classify-archive'), categoryStep],
        summary: pending ? `${pending} 个文件等待核对归档分类`
          : `文件分类处理完成：${archived} 个已归档${deferred ? `，${deferred} 个暂不归档` : ''}`,
        verification: { passed: true, message: '原文件、电子档案分类和 AI 文件索引已重新核对' },
      });
    }
  }

  async list({ conversationId = '', limit = 30 } = {}) {
    await this.reconcilePendingCategories({ conversationId, limit });
    const database = await this.databaseStore.read();
    return (database.aiFileIndexEntries || [])
      .filter(item => !conversationId || (item.conversationIds || []).includes(text(conversationId)))
      .sort((left, right) => text(right.lastUsedAt || right.createdAt).localeCompare(text(left.lastUsedAt || left.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 30, 100))).map(publicEntry);
  }

  async reconcilePendingCategories({ conversationId = '', limit = 100 } = {}) {
    let database = await this.databaseStore.read();
    const entries = (database.aiFileIndexEntries || [])
      .filter(item => item.status !== 'deleted'
        && (!conversationId || (item.conversationIds || []).includes(text(conversationId))))
      .sort((left, right) => text(right.lastUsedAt || right.createdAt).localeCompare(text(left.lastUsedAt || left.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 100)));
    const archived = [];
    for (const entry of entries) {
      const recommendation = this.categoryService.recommend(database, entry);
      const isPending = text(entry.archiveState) === 'pending';
      const document = (database.documents || []).find(item => text(item.id) === text(entry.documentId));
      const documentIsTrashed = text(document?.storageArea || document?.storage_area) === 'trash'
        || document?.is_trash === true || Boolean(document?.deleted_at || document?.deletedAt);
      const shouldRepairKnownCategory = text(entry.archiveState) === 'archived'
        && recommendation.autoCreate === true
        && Number(recommendation.confidence) >= 0.86
        && (normalizeCategoryName(entry.finalCategory) !== normalizeCategoryName(recommendation.name) || documentIsTrashed);
      const shouldRefreshKnownCategoryTask = text(entry.archiveState) === 'archived'
        && recommendation.autoCreate === true
        && Number(recommendation.confidence) >= 0.86
        && normalizeCategoryName(entry.finalCategory) === normalizeCategoryName(recommendation.name);
      if (!isPending && !shouldRepairKnownCategory) {
        if (shouldRefreshKnownCategoryTask) await this.syncCategoryTask(entry);
        continue;
      }
      await this.databaseStore.update(draft => {
        const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
        if (stored) stored.suggestedCategory = recommendation;
        return stored;
      });
      if (!shouldAutoArchive(recommendation)) continue;
      try {
        const result = await this.categoryService.autoArchive(entry.id);
        if (result.archiveState === 'archived') {
          archived.push(result.id);
          await this.syncCategoryTask(result);
        }
      } catch (error) {
        await this.databaseStore.update(draft => {
          const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
          if (stored) stored.warnings = [...new Set([...(stored.warnings || []), `自动归档未完成：${error.message}`])];
          return stored;
        });
      }
      database = await this.databaseStore.read();
    }
    return { checked: entries.length, archived };
  }
}

module.exports = { AiFileTaskService, SUPPORTED_EXTENSIONS, detectExcelModule, chunksFrom, decodeXml, publicEntry, personnelFieldsFromRow, storedPersonnelFields };
