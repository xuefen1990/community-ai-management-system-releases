'use strict';

const { canRead } = require('./document-recommendation');

const ALLOWED_BUSINESS_COLLECTIONS = Object.freeze([
  'personnel', 'households', 'partyMembers', 'visitRecords', 'dutyRecords',
  'finances', 'landParcel', 'certificates', 'documents',
]);

function stableJson(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(stableJson).join('；');
  return Object.keys(value).sort().map((key) => `${key}：${stableJson(value[key])}`).join('；');
}

function excerpt(text, limit = 1200) {
  const normalized = String(text || '').replaceAll(/\s+/gu, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function buildDocumentReference(database, accountId, reference) {
  const document = (database.documentDrafts || []).find((item) => item.id === reference.documentId);
  if (!document || !canRead(document, accountId)) throw new Error('无权引用该历史公文');
  const versionId = reference.versionId || document.currentVersionId;
  const version = (database.documentVersions || []).find((item) => item.id === versionId && item.documentId === document.id);
  if (!version) throw new Error('历史公文版本不存在');
  const usedExcerpt = excerpt(version.contentText, 1600);
  return {
    sourceType: 'document', sourceCollection: 'documentDrafts', sourceRecordId: document.id,
    sourceVersionId: version.id, sourceTitle: document.title, usedExcerpt,
    selectedBy: reference.selectedBy === 'recommended' ? 'recommended' : 'user',
    promptText: `【历史公文：${document.title}】\n${usedExcerpt}`,
  };
}

function buildBusinessReference(database, reference) {
  if (!ALLOWED_BUSINESS_COLLECTIONS.includes(reference.collection)) throw new Error(`不允许引用业务集合：${reference.collection}`);
  const requestedIds = new Set(Array.isArray(reference.recordIds) ? reference.recordIds : []);
  const records = (database[reference.collection] || []).filter((record) => requestedIds.has(record.id));
  if (records.length !== requestedIds.size) throw new Error('部分业务记录不存在');
  const usedExcerpt = excerpt(records.map(stableJson).join('\n'), 1600);
  return {
    sourceType: 'business', sourceCollection: reference.collection,
    sourceRecordId: [...requestedIds].join(','), sourceVersionId: null,
    sourceTitle: reference.title || `${reference.collection} 已选 ${records.length} 条`, usedExcerpt,
    selectedBy: reference.selectedBy === 'recommended' ? 'recommended' : 'user',
    promptText: `【业务数据：${reference.title || reference.collection}】\n${usedExcerpt}`,
  };
}

function buildDocumentContext({ database, accountId, template, fields, selectedReferences = [], profile = null, maxChars = 12_000 }) {
  const references = selectedReferences.map((reference) => reference.type === 'document'
    ? buildDocumentReference(database, accountId, reference)
    : buildBusinessReference(database, reference));
  const header = [
    `公文模板：${template.name}`,
    `章节顺序：${(template.sections || []).join('、')}`,
    `用户填写字段：${stableJson(fields)}`,
    profile ? `个人写作偏好：${stableJson(profile)}` : '',
    '要求：只依据用户填写字段与下列已选来源拟写；不得杜撰主体、金额、期限或事实；合同必须提示人工核验。',
  ].filter(Boolean).join('\n');

  let remaining = Math.max(0, maxChars - header.length - 40);
  const included = [];
  const omitted = [];
  const ordered = [...references].sort((left, right) => (left.selectedBy === 'user' ? -1 : 1) - (right.selectedBy === 'user' ? -1 : 1));
  for (const reference of ordered) {
    if (reference.promptText.length <= remaining) {
      included.push(reference.promptText);
      remaining -= reference.promptText.length;
    } else {
      omitted.push({ sourceRecordId: reference.sourceRecordId, sourceTitle: reference.sourceTitle, reason: '上下文长度限制' });
    }
  }
  return { prompt: `${header}\n\n已选参考资料：\n${included.join('\n\n') || '无'}`, references, omitted };
}

module.exports = { ALLOWED_BUSINESS_COLLECTIONS, buildDocumentContext, stableJson };
