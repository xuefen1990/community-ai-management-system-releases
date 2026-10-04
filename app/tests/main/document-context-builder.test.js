'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDocumentContext } = require('../../src/main/document-context-builder');

function makeDatabase() {
  return {
    documentDrafts: [
      { id: 'd-shared', title: '共享报告', visibility: 'shared', ownerUserId: 'u2', currentVersionId: 'v-shared' },
      { id: 'd-private', title: '私有合同', visibility: 'private', ownerUserId: 'u2', currentVersionId: 'v-private' },
    ],
    documentVersions: [
      { id: 'v-shared', documentId: 'd-shared', contentText: '共享来源内容：环境整治完成。' },
      { id: 'v-private', documentId: 'd-private', contentText: '绝不能泄露的私有内容。' },
    ],
    personnel: [{ id: 'p1', name: '张三', phone: '13800000000' }, { id: 'p2', name: '李四' }],
    finances: [{ id: 'f1', amount: 1000, summary: '清运费用' }],
    secretCollection: [{ id: 's1', value: '秘密' }],
  };
}

test('context includes only explicitly selected readable sources', () => {
  const result = buildDocumentContext({
    database: makeDatabase(),
    accountId: 'u1',
    template: { id: 'report-work', name: '工作报告', sections: ['基本情况'] },
    fields: { title: '环境整治报告' },
    selectedReferences: [
      { type: 'document', documentId: 'd-shared', versionId: 'v-shared', selectedBy: 'user' },
      { type: 'business', collection: 'personnel', recordIds: ['p1'], selectedBy: 'user' },
    ],
    profile: { tone: '正式务实' },
  });

  assert.match(result.prompt, /共享来源内容/u);
  assert.match(result.prompt, /张三/u);
  assert.doesNotMatch(result.prompt, /李四|清运费用|私有内容/u);
  assert.equal(result.references.length, 2);
});

test('context rejects private references and unapproved collections', () => {
  assert.throws(() => buildDocumentContext({
    database: makeDatabase(), accountId: 'u1', template: { id: 'x', name: 'x', sections: [] }, fields: {},
    selectedReferences: [{ type: 'document', documentId: 'd-private', versionId: 'v-private' }],
  }), /无权引用/u);

  assert.throws(() => buildDocumentContext({
    database: makeDatabase(), accountId: 'u1', template: { id: 'x', name: 'x', sections: [] }, fields: {},
    selectedReferences: [{ type: 'business', collection: 'secretCollection', recordIds: ['s1'] }],
  }), /不允许引用/u);
});

test('context budget keeps form fields and marks truncated selected sources', () => {
  const database = makeDatabase();
  database.documentVersions[0].contentText = `必须保留的来源 ${'内容'.repeat(300)}`;
  const result = buildDocumentContext({
    database,
    accountId: 'u1',
    template: { id: 'x', name: '工作报告', sections: [] },
    fields: { title: '不可丢失的标题' },
    selectedReferences: [{ type: 'document', documentId: 'd-shared', versionId: 'v-shared', selectedBy: 'recommended' }],
    maxChars: 240,
  });
  assert.match(result.prompt, /不可丢失的标题/u);
  assert.ok(result.omitted.length > 0);
});
