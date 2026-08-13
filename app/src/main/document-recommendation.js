'use strict';

function normalizedText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return Object.values(value).map(normalizedText).join(' ');
  return String(value).toLowerCase().replaceAll(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, ' ').trim();
}

function keywords(value) {
  const text = normalizedText(value);
  const values = new Set(text.split(/\s+/u).filter((token) => token.length > 1));
  for (const sequence of text.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let size = 2; size <= Math.min(4, sequence.length); size += 1) {
      for (let index = 0; index <= sequence.length - size; index += 1) values.add(sequence.slice(index, index + size));
    }
  }
  return values;
}

function overlapScore(left, right) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += Math.min(4, token.length);
  return count;
}

function canRead(document, accountId) {
  return document.ownerUserId === accountId || document.visibility !== 'private';
}

function recommendDocuments({ database, accountId, query, now = new Date(), limit = 8 }) {
  const queryTokens = keywords(query);
  const versions = new Map((database.documentVersions || []).map((version) => [version.id, version]));
  const useCounts = new Map();
  for (const reference of database.documentReferences || []) {
    if (reference.sourceType === 'document' || reference.sourceRecordId) {
      useCounts.set(reference.sourceRecordId, (useCounts.get(reference.sourceRecordId) || 0) + 1);
    }
  }

  return (database.documentDrafts || [])
    .filter((document) => document.status === 'final' && !document.archivedAt && canRead(document, accountId))
    .map((document) => {
      const version = versions.get(document.currentVersionId);
      const titleScore = overlapScore(queryTokens, keywords(document.title)) * 3;
      const fieldScore = overlapScore(queryTokens, keywords(document.fieldSnapshot)) * 2;
      const bodyScore = overlapScore(queryTokens, keywords(version?.contentText || ''));
      const updatedAt = new Date(document.updatedAt || 0);
      const ageDays = Number.isFinite(updatedAt.getTime()) ? Math.max(0, (now.getTime() - updatedAt.getTime()) / 86_400_000) : 9999;
      const recentScore = ageDays <= 30 ? 5 : ageDays <= 365 ? 2 : 0;
      const useScore = Math.min(4, useCounts.get(document.id) || 0);
      const score = titleScore + fieldScore + bodyScore + recentScore + useScore;
      const reasons = [];
      if (titleScore + fieldScore + bodyScore > 0) reasons.push('主题相似');
      if (recentScore >= 5) reasons.push('近期定稿');
      if (useScore > 0) reasons.push('曾被引用');
      return { documentId: document.id, versionId: document.currentVersionId, title: document.title, documentKind: document.documentKind, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.documentId.localeCompare(right.documentId))
    .slice(0, limit);
}

module.exports = { canRead, keywords, normalizedText, recommendDocuments };
