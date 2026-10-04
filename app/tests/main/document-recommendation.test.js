'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { recommendDocuments } = require('../../src/main/document-recommendation');

const database = {
  documentDrafts: [
    { id: 'd1', title: '人居环境整治工作总结', templateId: 'report-work-summary', documentKind: 'report', status: 'final', visibility: 'shared', ownerUserId: 'u1', fieldSnapshot: { keyPoints: '垃圾清运 服务采购' }, updatedAt: '2026-08-12T00:00:00.000Z', currentVersionId: 'v1' },
    { id: 'd2', title: '办公用品采购合同', templateId: 'contract-procurement', documentKind: 'contract', status: 'final', visibility: 'shared', ownerUserId: 'u2', fieldSnapshot: { subject: '打印纸采购' }, updatedAt: '2025-01-01T00:00:00.000Z', currentVersionId: 'v2' },
    { id: 'd3', title: '环境服务内部记录', templateId: 'contract-service', documentKind: 'contract', status: 'final', visibility: 'private', ownerUserId: 'u2', fieldSnapshot: { subject: '垃圾清运' }, updatedAt: '2026-08-13T00:00:00.000Z', currentVersionId: 'v3' },
  ],
  documentVersions: [
    { id: 'v1', documentId: 'd1', contentText: '开展人居环境整治和垃圾清运，群众满意度提升。' },
    { id: 'v2', documentId: 'd2', contentText: '采购打印纸和文件夹。' },
    { id: 'v3', documentId: 'd3', contentText: '内部垃圾清运服务条款。' },
  ],
  documentReferences: [{ id: 'r1', sourceRecordId: 'd1' }],
};

test('recommendation ranks related documents and explains the match', () => {
  const results = recommendDocuments({
    database,
    accountId: 'u1',
    query: { title: '环境整治服务合同', keyPoints: '垃圾清运' },
    now: new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal(results[0].documentId, 'd1');
  assert.ok(results[0].reasons.includes('主题相似'));
  assert.ok(results[0].reasons.includes('近期定稿'));
});

test('private documents belonging to another admin never appear', () => {
  const results = recommendDocuments({
    database,
    accountId: 'u1',
    query: { title: '垃圾清运环境服务' },
    now: new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal(results.some((result) => result.documentId === 'd3'), false);
});

test('recommendation ordering is deterministic when scores tie', () => {
  const tied = {
    documentDrafts: [
      { id: 'b', title: '同类事项', status: 'final', visibility: 'shared', ownerUserId: 'u1', fieldSnapshot: {}, updatedAt: '2026-01-01T00:00:00.000Z', currentVersionId: 'vb' },
      { id: 'a', title: '同类事项', status: 'final', visibility: 'shared', ownerUserId: 'u1', fieldSnapshot: {}, updatedAt: '2026-01-01T00:00:00.000Z', currentVersionId: 'va' },
    ],
    documentVersions: [{ id: 'va', contentText: '' }, { id: 'vb', contentText: '' }],
    documentReferences: [],
  };
  const results = recommendDocuments({ database: tied, accountId: 'u1', query: { title: '同类事项' }, now: new Date('2026-08-13T00:00:00.000Z') });
  assert.deepEqual(results.map((item) => item.documentId), ['a', 'b']);
});
