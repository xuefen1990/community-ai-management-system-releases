'use strict';

const path = require('node:path');
const model = require('../shared/certificate-management-model');
const { templateRows } = require('./foundation-certificate-service');

const text = value => value == null ? '' : String(value).trim();
const copy = value => structuredClone(value);

function titleFrom(content, fileName, hint = '') {
  const lines = String(content || '').split(/\r?\n/u).map(text).filter(Boolean);
  const title = lines.find(line => /证明/u.test(line) && line.length <= 32 && !/兹证明|特此证明/u.test(line));
  return title || text(hint) || text(path.basename(fileName || '', path.extname(fileName || ''))) || '证明';
}

function replaceKnownValues(content, fields = []) {
  let result = String(content || '').replace(/\r\n?/gu, '\n');
  const values = new Map((Array.isArray(fields) ? fields : []).map(field => [text(field.key), text(field.value)]));
  const replacements = [
    ['idCard2', '第二村民身份证号'], ['idCard', '身份证号'],
    ['name2', '第二村民姓名'], ['name', '村民姓名'],
    ['phone2', '第二村民联系电话'], ['phone', '联系电话'],
  ];
  for (const [key, label] of replacements) {
    const value = values.get(key);
    if (value) result = result.split(value).join(`{${label}}`);
  }
  const identityMatches = [...new Set(result.match(/\d{17}[\dXx]/gu) || [])];
  identityMatches.forEach((value, index) => { result = result.split(value).join(`{${index ? '第二村民身份证号' : '身份证号'}}`); });
  result = result
    .replace(/(?:姓名|居民姓名)\s*[：:]\s*(?:_{2,}|[×Xx＊*]{2,})/gu, '姓名：{村民姓名}')
    .replace(/(?:身份证号|公民身份号码)\s*[：:]\s*(?:_{4,}|[×Xx＊*]{4,})/gu, '身份证号：{身份证号}')
    .replace(/(?:双方|两人|二人)(?:之间)?关系\s*[：:]\s*(?:_{2,}|[×Xx＊*]{2,})/gu, '双方关系：{双方关系}');
  return result.trim();
}

function buildTemplateCandidate(entry, content) {
  const classification = entry.documentClassification || entry.contentReview?.classification || {};
  const title = titleFrom(content, entry.fileName, classification.templateHint);
  let body = replaceKnownValues(content, entry.contentReview?.fields || entry.documentFields || entry.ocrFields || []);
  const lines = body.split('\n');
  if (text(lines[0]) === title) body = lines.slice(1).join('\n').trim();
  if (!body) body = `{村民姓名}需要开具${title}。\n\n特此证明。`;
  const variables = model.extractTemplateVariables(body);
  const fields = variables.map((label, index) => model.normalizeCertificateField(model.defaultFieldForVariable(label), index));
  return model.normalizeCertificateTemplate({
    id: '', name: title, category: 'AI 识别模板', title, content: body, fields,
    sourceMaterial: { fileId: entry.id, documentId: entry.documentId, fileName: entry.fileName },
    status: 'draft', builtin: false,
  });
}

class AiCertificateTemplateIntakeService {
  constructor({ databaseStore, businessService, now = () => new Date() } = {}) {
    if (!databaseStore?.read || !databaseStore?.update) throw new TypeError('databaseStore is required');
    if (!businessService?.request) throw new TypeError('businessService is required');
    this.databaseStore = databaseStore;
    this.businessService = businessService;
    this.now = now;
  }

  preview(database, entry, content) {
    if (text(entry.detectedModule) !== 'certificate' && text(entry.documentClassification?.module) !== 'certificate'
      && text(entry.contentReview?.classification?.module) !== 'certificate') throw new Error('这份材料尚未识别为证明或证明模板，请先核对材料内容');
    const candidate = buildTemplateCandidate(entry, content);
    const match = model.compareCertificateTemplates(candidate, templateRows(database));
    const labels = { exact: '与现有模板完全相同', 'same-name': '名称相同但内容有差异', similar: '发现内容相近的模板', none: '没有发现相同模板' };
    return {
      fileId: entry.id, fileName: entry.fileName, candidate,
      match: { level: match.level, similarity: match.similarity, template: match.template ? {
        id: match.template.id, name: match.template.name, title: match.template.title, content: match.template.content,
        fields: match.template.fields, version: match.template.version, currentVersion: match.template.currentVersion,
      } : null, differences: match.differences },
      message: labels[match.level],
      requiresReview: true,
    };
  }

  async apply({ fileId, decision, candidate, templateId = '', confirmed = false } = {}) {
    if (confirmed !== true) throw new Error('请先核对模板名称、正文和字段，再确认处理');
    const database = await this.databaseStore.read();
    const entry = (database.aiFileIndexEntries || []).find(item => item.id === text(fileId) && item.status !== 'deleted');
    if (!entry) throw new Error('没有找到该文件识别记录，请重新上传');
    const proposed = model.normalizeCertificateTemplate(candidate || entry.certificateTemplateIntake?.candidate || {});
    if (!proposed.name || !proposed.title || !proposed.content) throw new Error('模板草稿不完整，请重新识别或补充模板名称、标题和正文');
    const existing = templateRows(database).find(item => item.id === text(templateId));
    let result;
    if (decision === 'reuse') {
      if (!existing) throw new Error('准备复用的模板已不存在，请重新核对');
      result = { action: 'reused', template: existing, message: `已关联现有模板“${existing.name}”，没有新建重复模板。` };
    } else if (decision === 'create-draft') {
      const created = await this.businessService.request({ method: 'POST', path: '/api/v3/certificate-templates', body: {
        name: proposed.name, category: proposed.category || 'AI 识别模板', title: proposed.title, content: proposed.content,
        fields: proposed.fields, subjects: proposed.subjects, status: 'draft', sourceMaterial: proposed.sourceMaterial,
      } });
      if (!created?.ok) throw new Error(created?.error?.message || '证明模板草稿保存失败');
      result = { action: 'draft-created', template: created.data?.template || created.data?.item, message: '模板草稿已建立，请在证明管理中试开并发布。' };
    } else if (decision === 'update-existing') {
      if (!existing) throw new Error('准备更新的模板已不存在，请重新核对');
      const updated = await this.businessService.request({ method: 'POST', path: `/api/v3/certificate-templates/${encodeURIComponent(existing.id)}/publish`, body: {
        baseVersion: existing.version, changes: { title: proposed.title, content: proposed.content, fields: proposed.fields, subjects: proposed.subjects },
      } });
      if (!updated?.ok) throw new Error(updated?.error?.message || '模板新版本发布失败');
      result = { action: 'updated', template: updated.data?.template || updated.data?.item, message: `“${existing.name}”已发布为新版本。` };
    } else if (decision === 'cancel') {
      result = { action: 'cancelled', template: null, message: '已取消模板处理，原文件仍保留在电子档案柜。' };
    } else throw new Error('请选择复用现有模板、建立草稿、更新现有模板或取消');
    const operationId = `ai-certificate-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outcome = await this.databaseStore.update(draft => {
      const stored = (draft.aiFileIndexEntries ||= []).find(item => item.id === entry.id);
      if (!stored) throw new Error('文件识别记录已变化，请重新打开');
      stored.certificateTemplateIntake = { decision, action: result.action, candidate: copy(proposed), templateId: result.template?.id || '',
        templateName: result.template?.name || '', decidedAt: this.now().toISOString(), operationId };
      if (result.template?.id) stored.businessLinks = [...(stored.businessLinks || []).filter(link => link.targetType !== 'certificate_template'),
        { targetType: 'certificate_template', targetId: result.template.id, name: result.template.name }];
      const operationType = decision === 'create-draft' ? 'certificate_template_draft_create'
        : decision === 'update-existing' ? 'certificate_template_update' : 'certificate_template_reuse';
      (draft.aiAssistantOperations ||= []).push({ id: operationId, type: operationType,
        toolId: decision === 'create-draft' ? 'certificate.template-draft-create' : decision === 'update-existing' ? 'certificate.template-update' : 'certificate.template-reuse',
        module: '证明管理', riskLevel: decision === 'update-existing' ? 'medium' : 'low', status: 'completed', createdAt: this.now().toISOString(),
        summary: result.message, object: { id: result.template?.id || entry.id, name: result.template?.name || entry.fileName },
        sourceFileId: entry.id, decision, recoverable: decision === 'create-draft',
        before: decision === 'create-draft' ? { template: null } : null,
        after: result.template ? { template: copy(result.template) } : null,
        verification: { passed: true, message: decision === 'create-draft' ? '已复核模板处于草稿状态，尚未进入正式开具列表' : result.message } });
      return stored;
    });
    return { ok: true, ...result, operationId, file: outcome.result };
  }

  async undoDraft({ operationId = '' } = {}) {
    const database = await this.databaseStore.read();
    const operation = (database.aiAssistantOperations || []).find(item => item.id === text(operationId));
    if (!operation || operation.type !== 'certificate_template_draft_create') throw new Error('没有找到可撤销的模板草稿操作');
    if (!operation.recoverable || operation.status !== 'completed') throw new Error('该模板草稿当前不能撤销');
    const template = templateRows(database).find(item => item.id === text(operation.object?.id));
    if (!template) throw new Error('对应模板草稿已经不存在');
    if (template.status !== 'draft') throw new Error('该模板已经发布或停用，不能按草稿撤销，请在证明管理中处理');
    const used = (database.certificateRecords || database.certificates || []).some(item => text(item.templateId) === text(template.id));
    if (used) throw new Error('该模板已经产生开具记录，不能撤销删除');
    const removed = await this.businessService.request({ method: 'DELETE', path: `/api/v3/certificate-templates/${encodeURIComponent(template.id)}`,
      body: { baseVersion: template.version } });
    if (!removed?.ok) throw new Error(removed?.error?.message || '撤销模板草稿失败');
    const undoneAt = this.now().toISOString();
    await this.databaseStore.update(draft => {
      const original = (draft.aiAssistantOperations || []).find(item => item.id === operation.id);
      if (original) { original.status = 'undone'; original.undoneAt = undoneAt; original.recoverable = false; }
      const file = (draft.aiFileIndexEntries || []).find(item => item.id === operation.sourceFileId);
      if (file?.certificateTemplateIntake?.operationId === operation.id) {
        file.certificateTemplateIntake = { ...file.certificateTemplateIntake, undoneAt };
        file.businessLinks = (file.businessLinks || []).filter(link => !(link.targetType === 'certificate_template' && link.targetId === template.id));
      }
      (draft.aiAssistantOperations ||= []).push({ id: `ai-certificate-template-undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'undo', toolId: 'certificate.template-draft-undo', module: '证明管理', riskLevel: 'low', status: 'completed',
        object: { id: template.id, name: template.name }, before: { template: copy(template) }, after: { template: null },
        recoverable: false, undoneOperationId: operation.id, createdAt: undoneAt });
    });
    return { ok: true, message: `已撤销模板草稿“${template.name}”，原始材料仍保留在电子档案柜。` };
  }
}

module.exports = { AiCertificateTemplateIntakeService, buildTemplateCandidate, replaceKnownValues, titleFrom };
