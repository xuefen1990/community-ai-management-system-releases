'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const { JsonDatabaseStore } = require('../../src/main/database-store');
const { AiFileTaskService, detectExcelModule, decodeXml, publicEntry } = require('../../src/main/ai-file-task-service');
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const { FoundationBackupService } = require('../../src/main/foundation-backup-service');

async function fixture(t, { ocrService = null, dialog = null, enableCategoryCreation = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-task-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new JsonDatabaseStore({ userDataPath: root, now: () => new Date('2026-09-20T08:00:00.000Z') });
  const archiveDirectory = path.join(root, 'archives');
  await fs.mkdir(archiveDirectory, { recursive: true });
  let archiveCount = 0;
  const documentService = {
    request: async input => {
      if (input.action === 'updateCategory') {
        const outcome = await store.update(database => {
          const document = database.documents.find(item => item.id === input.documentId);
          if (!document) return null;
          document.category = input.category;
          document.file_category = input.category;
          return document;
        });
        return outcome.result ? { success: true, document: outcome.result } : { success: false, error: '档案不存在' };
      }
      if (input.action === 'restore') {
        const outcome = await store.update(database => {
          const document = database.documents.find(item => item.id === input.documentId);
          if (!document) return null;
          document.storageArea = document.storage_area = 'archives';
          document.is_trash = false;
          delete document.deletedAt;
          delete document.deleted_at;
          return document;
        });
        return outcome.result ? { success: true, document: outcome.result } : { success: false, error: '档案不存在' };
      }
      archiveCount += 1;
      const target = path.join(archiveDirectory, `${archiveCount}${path.extname(input.sourceFilePath)}`);
      await fs.copyFile(input.sourceFilePath, target);
      const document = { id: `document-${archiveCount}`, file_path: target };
      await store.update(database => { database.documents.push({ ...document, name: input.name, links: input.links }); });
      return { success: true, document };
    },
  };
  const businessService = enableCategoryCreation
    ? new FoundationBusinessService({ store, authorize: async () => {}, now: () => new Date('2026-09-20T08:00:00.000Z') })
    : null;
  const service = new AiFileTaskService({ databaseStore: store, documentService, ocrService, dialog,
    businessService,
    now: () => new Date('2026-09-20T08:00:00.000Z') });
  return { root, store, service, archiveCount: () => archiveCount };
}

test('AI 助理三个上传入口使用各自清楚的文件筛选器', async t => {
  const selections = [];
  const dialog = { showOpenDialog: async options => {
    selections.push(options);
    return { canceled: true, filePaths: [] };
  } };
  const f = await fixture(t, { dialog });

  await f.service.selectAndAnalyze({ conversationId: 'conversation-upload', selectionKind: 'file' });
  await f.service.selectAndAnalyze({ conversationId: 'conversation-upload', selectionKind: 'image' });
  await f.service.selectAndAnalyze({ conversationId: 'conversation-upload', selectionKind: 'scan' });

  assert.deepEqual(selections.map(item => item.title), ['上传文件', '上传图片', '选择扫描材料']);
  assert.equal(selections[0].filters[0].extensions.includes('xlsx'), true);
  assert.equal(selections[0].filters[0].extensions.includes('jpg'), false);
  assert.equal(selections[1].filters[0].extensions.includes('png'), true);
  assert.equal(selections[1].filters[0].extensions.includes('xlsx'), false);
  assert.equal(selections[2].filters[0].extensions.includes('pdf'), true);
  assert.equal(selections[2].filters[0].extensions.includes('jpeg'), true);
});

test('Excel 文件归档后识别承包费字段，并建立可追溯任务', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, '大枣园明细.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['大枣园土地金明细'],
    ['组别', '户主姓名', '实际亩数', '单价', '银行卡号', '金额'],
    ['东一组', '张三', 2.5, 750, '6222000000000001', 1875],
  ]), '明细');
  XLSX.writeFile(workbook, source);
  const result = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-1' });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].detectedModule, 'contract-fee');
  assert.equal(result.files[0].totalRows, 1);
  assert.equal(result.files[0].archivePath, undefined);
  assert.equal(result.task.taskKind, 'file-recognition');
  assert.equal(result.task.status, 'waiting-input');
  assert.equal(result.task.steps.find(step => step.id === 'classify-archive').status, 'waiting-input');
  assert.deepEqual(result.task.artifactIds, [result.files[0].id]);
  const database = await f.store.read();
  assert.equal(database.documents.length, 1);
  assert.equal(database.aiFileIndexEntries.length, 1);
  assert.equal(database.aiAssistantTasks.length, 1);
  assert.equal(await fs.readFile(source).then(buffer => buffer.length > 0), true);
});

test('同一文件再次上传复用哈希索引，不重复归档', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, '居民.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '身份证号'], ['测试居民', '321302199001011234']]), '居民');
  XLSX.writeFile(workbook, source);
  const first = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-1' });
  const second = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-2' });
  assert.equal(first.files[0].id, second.files[0].id);
  assert.equal(second.files[0].duplicate, true);
  assert.equal(f.archiveCount(), 1);
  const database = await f.store.read();
  assert.deepEqual(database.aiFileIndexEntries[0].conversationIds, ['conversation-1', 'conversation-2']);
});

test('AI 识别的承包费表可从归档副本直接交给原有业务解析器', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, '鱼塘承包费.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['鱼塘承包费明细'],
    ['组别', '户主姓名', '人口', '银行卡号', '金额'],
    ['一组', '张三', 3, '6222000000000001', 300],
  ]), '明细');
  XLSX.writeFile(workbook, source);
  const analyzed = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-handoff' });
  let parsedPath = '';
  f.service.contractFeeFileService = { readExcel: async filePath => {
    parsedPath = filePath;
    return { fileName: path.basename(filePath), rows: [{ name: '张三', population: 3 }] };
  } };
  const prepared = await f.service.prepareBusinessImport({ fileId: analyzed.files[0].id, targetModule: 'contract-fee' });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.targetModule, 'contract-fee');
  assert.equal(prepared.data.rows[0].name, '张三');
  assert.notEqual(parsedPath, source);
  assert.equal(prepared.file.archivePath, undefined);
  const database = await f.store.read();
  assert.equal(database.aiFileIndexEntries[0].handoffTarget, 'contract-fee');
});

test('Word 正文可提取，图片只建立待核对索引', async t => {
  const f = await fixture(t);
  const wordPath = path.join(f.root, '情况说明.docx');
  const zip = new PizZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>居民张三情况说明</w:t></w:r></w:p><w:p><w:r><w:t>内容属实</w:t></w:r></w:p></w:body></w:document>');
  await fs.writeFile(wordPath, zip.generate({ type: 'nodebuffer' }));
  const imagePath = path.join(f.root, '扫描件.png');
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const result = await f.service.analyzeFiles({ filePaths: [wordPath, imagePath], conversationId: 'conversation-1' });
  assert.equal(result.files[0].format, 'word');
  assert.match(result.files[0].chunks[0].text, /居民张三情况说明/u);
  assert.equal(result.files[1].format, 'image');
  assert.equal(result.files[1].status, 'needs-review');
});

test('Word 会保留表格页眉页脚和页码结构，并识别证明用途', async t => {
  const f = await fixture(t);
  const wordPath = path.join(f.root, '亲属关系证明.docx');
  const zip = new PizZip();
  zip.file('word/document.xml', `<w:document><w:body>
    <w:p><w:r><w:t>亲属关系证明</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>姓名</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>张三</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>兹证明居民张三，身份证号：321302199001011234。</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/><w:t>第二页</w:t></w:r></w:p>
  </w:body></w:document>`);
  zip.file('word/header1.xml', '<w:hdr><w:p><w:r><w:t>陆庄社区居民委员会</w:t></w:r></w:p></w:hdr>');
  zip.file('word/footer1.xml', '<w:ftr><w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>');
  await fs.writeFile(wordPath, zip.generate({ type: 'nodebuffer' }));
  const result = await f.service.analyzeFiles({ filePaths: [wordPath], conversationId: 'conversation-word-structure' });
  const file = result.files[0];
  assert.equal(file.parser, 'docx-structured');
  assert.equal(file.detectedModule, 'certificate');
  assert.equal(file.documentClassification.id, 'relationship-certificate');
  assert.equal(file.structureSummary.tableCount, 1);
  assert.equal(file.structureSummary.headerCount, 1);
  assert.equal(file.structureSummary.footerCount, 1);
  assert.equal(file.structureSummary.hasPageNumber, true);
  assert.equal(file.pageCount, 2);
  assert.equal(file.documentFields.find(field => field.key === 'idCard').value, '321302199001011234');
});

test('材料必须人工核对后才能带入证明管理，带入只准备内容不写业务记录', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, '关系证明材料.txt');
  await fs.writeFile(source, '亲属关系证明\n兹证明居民张三，身份证号：321302199001011234，与居民李四系父子关系。');
  const analyzed = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-certificate-material' });
  const file = analyzed.files[0];
  await assert.rejects(() => f.service.prepareDocumentHandoff({ fileId: file.id }), /请先对照原文件核对/u);
  const review = await f.service.reviewOcr({ fileId: file.id });
  assert.equal(review.classification.module, 'certificate');
  await f.service.confirmOcrReview({ fileId: file.id, reviewRevision: review.reviewRevision,
    text: review.text, fields: review.fields, confirmed: true });
  const prepared = await f.service.prepareDocumentHandoff({ fileId: file.id });
  assert.equal(prepared.navigationTarget, 'tab-certificate');
  assert.equal(prepared.payload.classification.templateHint, '亲属关系证明');
  const database = await f.store.read();
  assert.equal(database.certificates.length, 0);
  assert.equal(database.certificateRecords?.length || 0, 0);
  assert.equal(database.aiFileIndexEntries[0].handoffTarget, 'certificate');
});

test('AI 材料生成的文件会回挂原任务并归档到电子档案柜', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, '证明依据.txt');
  await fs.writeFile(source, '兹证明居民张三身份情况属实。');
  const analyzed = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-output-artifact' });
  const generated = path.join(f.root, '张三-证明.docx');
  await fs.writeFile(generated, Buffer.from('generated-certificate'));
  const archived = await f.service.archiveGeneratedArtifact({ sourceFileId: analyzed.files[0].id, sourceFilePath: generated,
    name: '张三-证明.docx', links: [{ targetType: 'certificate', recordId: 'certificate-1' }] });
  assert.equal(archived.ok, true);
  const database = await f.store.read();
  assert.equal(database.documents.length, 2);
  assert.deepEqual(database.aiFileIndexEntries[0].generatedArtifactIds, [archived.documentId]);
  const task = database.aiAssistantTasks[0];
  assert.equal(task.artifactIds.includes(archived.documentId), true);
  assert.equal(task.steps.some(step => step.toolId === 'file.archive-output'), true);
});

test('图片离线识别后标出关键字段，人工核对前不写入业务数据', async t => {
  const ocrService = { recognize: async () => ({
    engine: 'apple-vision', pageCount: 1, processedPageCount: 1, truncated: false,
    pages: [{ pageNumber: 1, confidence: 0.78, text: '姓名：张三\n身份证号：321302199001011234\n联系电话：13800000000', blocks: [
      { text: '姓名：张三', confidence: 0.96 },
      { text: '身份证号：321302199001011234', confidence: 0.73 },
      { text: '联系电话：13800000000', confidence: 0.91 },
    ] }],
  }) };
  const f = await fixture(t, { ocrService });
  const imagePath = path.join(f.root, '证明扫描件.png');
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const analyzed = await f.service.analyzeFiles({ filePaths: [imagePath], conversationId: 'conversation-ocr' });
  assert.equal(analyzed.files[0].parser, 'apple-vision');
  assert.equal(analyzed.files[0].status, 'needs-review');
  assert.equal(analyzed.files[0].ocrFields.find(field => field.key === 'name').value, '张三');
  assert.equal(analyzed.files[0].ocrFields.find(field => field.key === 'idCard').requiresReview, true);
  const review = await f.service.reviewOcr({ fileId: analyzed.files[0].id });
  assert.match(review.text, /321302199001011234/u);
  const confirmed = await f.service.confirmOcrReview({ fileId: analyzed.files[0].id,
    reviewRevision: review.reviewRevision, text: review.text.replace('张三', '张三（已核对）'), fields: review.fields, confirmed: true });
  assert.equal(confirmed.file.status, 'reviewed');
  const database = await f.store.read();
  assert.equal(database.aiFileIndexEntries[0].ocrReview.confirmed, true);
  assert.equal(database.aiFileIndexEntries[0].ocrReview.text.includes('已核对'), true);
  assert.equal(database.personnel.length, 0);
});

test('营业执照图片按文件名和识别文字自动创建分类并归档', async t => {
  const ocrService = { recognize: async () => ({
    engine: 'apple-vision', pageCount: 1, processedPageCount: 1, truncated: false,
    pages: [{ pageNumber: 1, confidence: 0.95, text: '营业执照\n统一社会信用代码：91321300MA12345678\n法定代表人：张三', blocks: [] }],
  }) };
  const f = await fixture(t, { ocrService, enableCategoryCreation: true });
  const imagePath = path.join(f.root, '陆庄物业营业执照.jpg');
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const analyzed = await f.service.analyzeFiles({ filePaths: [imagePath], conversationId: 'conversation-business-license' });

  assert.equal(analyzed.files[0].documentClassification.id, 'business-license');
  assert.equal(analyzed.files[0].archiveState, 'archived');
  assert.equal(analyzed.files[0].finalCategory, '营业执照');
  const database = await f.store.read();
  assert.equal(database.documents[0].category, '营业执照');
  assert.equal(database.foundationDictionaries.some(item => item.category === 'document_category' && item.label === '营业执照'), true);
});

test('读取旧的待归档列表时重新识别营业执照并自动整理', async t => {
  const ocrService = { recognize: async () => ({
    engine: 'apple-vision', pageCount: 1, processedPageCount: 1, truncated: false,
    pages: [{ pageNumber: 1, confidence: 0.7, text: '暂未提取到明确类别', blocks: [] }],
  }) };
  const f = await fixture(t, { ocrService, enableCategoryCreation: true });
  const imagePath = path.join(f.root, '普通扫描件.jpg');
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const analyzed = await f.service.analyzeFiles({ filePaths: [imagePath], conversationId: 'conversation-existing-pending' });
  assert.equal(analyzed.files[0].archiveState, 'pending');
  await f.store.update(database => {
    const entry = database.aiFileIndexEntries.find(item => item.id === analyzed.files[0].id);
    entry.fileName = '陆庄物业营业执照.jpg';
    return entry;
  });

  const listed = await f.service.list({ conversationId: 'conversation-existing-pending' });

  assert.equal(listed[0].archiveState, 'archived');
  assert.equal(listed[0].finalCategory, '营业执照');
  const database = await f.store.read();
  assert.equal(database.documents[0].category, '营业执照');
  assert.equal(database.aiAssistantTasks.find(item => item.id === listed[0].taskId).status, 'completed');
});

test('读取旧的错误归档时把营业执照从公文材料移到正确分类', async t => {
  const f = await fixture(t, { enableCategoryCreation: true });
  const imagePath = path.join(f.root, '普通公文.jpg');
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const analyzed = await f.service.analyzeFiles({ filePaths: [imagePath], conversationId: 'conversation-wrong-archive' });
  await f.store.update(database => {
    const entry = database.aiFileIndexEntries.find(item => item.id === analyzed.files[0].id);
    entry.fileName = '陆庄物业营业执照.jpg';
    entry.archiveState = 'archived';
    entry.finalCategory = '公文材料';
    entry.suggestedCategory = { status: 'missing', name: '公文材料', confidence: 0.82 };
    const document = database.documents.find(item => item.id === entry.documentId);
    document.category = '公文材料';
    document.file_category = '公文材料';
    document.storageArea = document.storage_area = 'trash';
    document.is_trash = true;
    document.deleted_at = '2026-09-20T09:00:00.000Z';
    return entry;
  });
  await f.service.taskService.save({
    id: 'stale-license-task', title: '识别文件：陆庄物业营业执照.jpg', taskKind: 'file-recognition',
    conversationId: 'another-conversation', status: 'waiting-input', artifactIds: [analyzed.files[0].id],
    fileEntries: [{ ...analyzed.files[0], archiveState: 'pending', finalCategory: '' }],
    steps: [{ id: 'classify-archive', status: 'waiting-input' }], summary: '等待核对归档分类',
  });

  const listed = await f.service.list({ limit: 100 });

  assert.equal(listed[0].archiveState, 'archived');
  assert.equal(listed[0].finalCategory, '营业执照');
  const database = await f.store.read();
  assert.equal(database.documents[0].category, '营业执照');
  assert.equal(database.documents[0].storageArea, 'archives');
  assert.equal(database.documents[0].is_trash, false);
  assert.equal(database.foundationDictionaries.some(item => item.category === 'document_category' && item.label === '营业执照'), true);
  assert.equal(database.aiAssistantTasks.find(item => item.id === 'stale-license-task').status, 'completed');
});

test('表头分类和 Word XML 清理使用中文业务语义', () => {
  assert.equal(detectExcelModule(['姓名', '身份证号']).id, 'personnel');
  assert.equal(detectExcelModule(['地块编号', '地块名称', '承包人', '面积']).id, 'land');
  assert.equal(decodeXml('<w:p><w:r><w:t>第一行</w:t></w:r></w:p><w:p><w:t>第二行</w:t></w:p>'), '第一行\n第二行');
});

test('旧文件索引缺少归档状态时仍按已归档读取', () => {
  const legacy = publicEntry({ id: 'legacy-file', fileName: '旧材料.pdf', archivePath: '/private/archive.pdf', cachePath: '/private/cache.json' });
  assert.equal(legacy.archiveState, 'archived');
  assert.equal(legacy.archivePath, undefined);
  assert.equal(legacy.cachePath, undefined);
});

test('图片和 PDF 仅向界面公开受控预览地址', () => {
  const image = publicEntry({ id: 'image-file', documentId: 'document-image', format: 'image', archivePath: '/private/image.png' });
  assert.equal(image.previewUrl, 'community-file://document?id=document-image');
  assert.equal(image.archivePath, undefined);
  const excel = publicEntry({ id: 'excel-file', documentId: 'document-excel', format: 'excel', archivePath: '/private/table.xlsx' });
  assert.equal(excel.previewUrl, undefined);
});

test('居民表先区分新增、补充、冲突和跳过，确认后才调用正式批量保存接口', async t => {
  const f = await fixture(t);
  await f.store.update(database => {
    database.personnel.push(
      { id: 'person-1', name: '张三', idCard: '321302199009011634', phone: '' },
      { id: 'person-2', name: '李四', idCard: '320819197204141615', phone: '13800000000' },
    );
  });
  const businessCalls = [];
  f.service.businessService = { request: async input => {
    businessCalls.push(input);
    if (input.method === 'GET') return { ok: true, data: { items: [] } };
    if (input.path.endsWith('/people/batch-upsert')) return { ok: true, data: { insertedRows: 1, updatedRows: 1, failed: [] } };
    if (input.path.endsWith('/import-jobs')) return { ok: true, data: { job: input.body } };
    return { ok: false, error: { message: '未识别调用' } };
  } };
  let backupCalls = 0;
  f.service.backupService = { create: async () => { backupCalls += 1; return { relativePath: 'backup-before-ai-import' }; } };
  const source = path.join(f.root, '居民导入.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['姓名', '身份证号', '联系电话', '组别'],
    ['张三', '321302199009011634', '13900000000', '一组'],
    ['王五', '321302199106110845', '13700000000', '二组'],
    ['李四（错误姓名）', '320819197204141615', '13800000000', '三组'],
  ]), '居民');
  XLSX.writeFile(workbook, source);
  const analyzed = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-import' });
  const preview = await f.service.previewImport({ fileId: analyzed.files[0].id });
  assert.deepEqual(preview.counts, { create: 1, update: 1, conflict: 1, skip: 0 });
  assert.equal(backupCalls, 0);
  assert.equal(businessCalls.filter(call => call.method === 'POST').length, 0);
  const confirmed = await f.service.confirmImport({ fileId: analyzed.files[0].id, previewRevision: preview.previewRevision,
    targetModule: 'personnel', confirmed: true });
  assert.equal(confirmed.imported, true);
  assert.equal(backupCalls, 1);
  const saveCall = businessCalls.find(call => call.path.endsWith('/people/batch-upsert'));
  assert.equal(saveCall.body.items.length, 2);
  assert.equal(saveCall.body.items[0].fields.phone, '13900000000');
  assert.equal(saveCall.body.items[1].fields.name, '王五');
  const database = await f.store.read();
  assert.equal(database.aiFileIndexEntries[0].importStatus, 'completed');
  assert.equal(database.aiFileIndexEntries[0].importReport.conflictRows, 1);
});

test('居民资料在预览后变化时拒绝继续导入', async t => {
  const f = await fixture(t);
  f.service.businessService = { request: async input => input.method === 'GET' ? { ok: true, data: { items: [] } } : { ok: true, data: {} } };
  f.service.backupService = { create: async () => ({ relativePath: 'unused' }) };
  const source = path.join(f.root, '新居民.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['姓名', '身份证号'], ['新居民', '321302199106110845']]), '居民');
  XLSX.writeFile(workbook, source);
  const analyzed = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-stale' });
  const preview = await f.service.previewImport({ fileId: analyzed.files[0].id });
  await f.store.update(database => { database.personnel.push({ name: '后来新增', idCard: '321302199009011634' }); });
  await assert.rejects(() => f.service.confirmImport({ fileId: analyzed.files[0].id, previewRevision: preview.previewRevision,
    targetModule: 'personnel', confirmed: true }), /发生变化/u);
});

test('居民确认导入会通过正式业务服务保存、登记批次并建立恢复点', async t => {
  const f = await fixture(t);
  const authorize = async request => request.path === '/people/batch-upsert' ? { personWriteActions: ['create', 'update'] } : undefined;
  f.service.businessService = new FoundationBusinessService({ store: f.store, authorize,
    now: () => new Date('2026-09-20T08:00:00.000Z'), uuid: () => `uuid-${Math.random().toString(36).slice(2, 8)}` });
  f.service.backupService = new FoundationBackupService({ store: f.store, authorize,
    now: () => new Date('2026-09-20T08:00:00.000Z'), uuid: () => 'safe-import' });
  const source = path.join(f.root, '正式居民导入.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['姓名', '身份证号', '组别', '电话'],
    ['测试居民', '321302199106110845', '测试组', '13700000000'],
  ]), '居民');
  XLSX.writeFile(workbook, source);
  const analyzed = await f.service.analyzeFiles({ filePaths: [source], conversationId: 'conversation-real-import' });
  const preview = await f.service.previewImport({ fileId: analyzed.files[0].id });
  const imported = await f.service.confirmImport({ fileId: analyzed.files[0].id, targetModule: 'personnel',
    previewRevision: preview.previewRevision, confirmed: true });
  assert.equal(imported.counts.insertedRows, 1);
  const database = await f.store.read();
  assert.equal(database.personnel.length, 1);
  assert.equal(database.personnel[0].name, '测试居民');
  assert.equal(database.personnel[0].village_group, '测试组');
  assert.equal(database.personnelImportRecords.length, 1);
  assert.equal(database.personnelImportRecords[0].report.backupRelativePath, imported.backupRelativePath);
  assert.equal((await fs.stat(path.join(f.store.dataDirectory, 'foundation-backups', imported.backupRelativePath, 'manifest.json'))).isFile(), true);
});
