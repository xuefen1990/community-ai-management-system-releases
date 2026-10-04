'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractWritingSignals,
  updateProfileFromFinal,
  WritingProfileService,
} = require('../../src/main/writing-profile-service');

test('signal extraction returns readable style features', () => {
  const signals = extractWritingSignals('尊敬的各位领导：\n一、基本情况\n现将有关情况报告如下。\n二、下一步计划\n特此报告。');
  assert.equal(signals.salutation, '尊敬的各位领导：');
  assert.deepEqual(signals.sectionHeadings, ['一、基本情况', '二、下一步计划']);
  assert.equal(signals.closing, '特此报告。');
  assert.ok(signals.averageParagraphLength > 0);
});

test('only the current admin finalization updates their profile', () => {
  const database = { writingProfiles: [] };
  updateProfileFromFinal(database, { userId: 'u1', documentId: 'd1', contentText: '一、工作情况\n现将有关情况报告如下。\n特此报告。', finalizedAt: '2026-08-10T00:00:00.000Z' });
  updateProfileFromFinal(database, { userId: 'u1', documentId: 'd2', contentText: '一、工作成效\n现将有关情况报告如下。\n特此报告。', finalizedAt: '2026-08-13T00:00:00.000Z' });

  assert.equal(database.writingProfiles.length, 1);
  assert.equal(database.writingProfiles[0].userId, 'u1');
  assert.equal(database.writingProfiles[0].finalizedCount, 2);
  assert.deepEqual(database.writingProfiles[0].sourceDocumentIds, ['d1', 'd2']);
  assert.equal(database.writingProfiles[0].preferredClosing, '特此报告。');
});

test('duplicate finalization does not learn the same document twice', () => {
  const database = { writingProfiles: [] };
  const input = { userId: 'u1', documentId: 'd1', versionId: 'v1', contentText: '特此报告。', finalizedAt: '2026-08-13T00:00:00.000Z' };
  updateProfileFromFinal(database, input);
  updateProfileFromFinal(database, input);
  assert.equal(database.writingProfiles[0].finalizedCount, 1);
});

test('profile service edits and resets only the signed-in admin profile', async () => {
  let database = { writingProfiles: [{ userId: 'u1', finalizedCount: 3, preferredTone: '正式务实' }, { userId: 'u2', finalizedCount: 5 }] };
  const store = {
    read: async () => structuredClone(database),
    update: async (mutator) => {
      const draft = structuredClone(database);
      const result = await mutator(draft);
      database = draft;
      return { data: structuredClone(database), result };
    },
  };
  const service = new WritingProfileService({ databaseStore: store, getCurrentAccount: async () => ({ id: 'u1' }) });
  await service.save({ preferredTone: '简洁明确', preferredSalutation: '各位同事：' });
  assert.equal((await service.get()).preferredTone, '简洁明确');
  await service.reset();
  assert.equal(await service.get(), null);
  assert.equal(database.writingProfiles.some((profile) => profile.userId === 'u2'), true);
});
