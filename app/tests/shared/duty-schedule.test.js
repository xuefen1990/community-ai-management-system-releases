'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dutySchedule } = require('../../src/shared/duty-schedule');
const { AiAssistantService } = require('../../src/main/ai-assistant-service');
test('AI reads daily and themed duty plans without duplicating names or mutating historical schedules', () => {
  const db = { dutyFlexible: { schedule: { '2026-09-08': ['测试甲'] } }, dutyRecords: [
    { id: 'plan', days: [{ dutyDate: '2026-09-08', assignments: [{ nameSnapshot: '测试甲' }, { nameSnapshot: '测试乙' }] }] },
    { id: 'old', schedules: { '2026-09-08': ['测试丙'] } },
    { id: 'deleted', deletedAt: '2026-09-01', days: [{ dutyDate: '2026-09-08', assignments: [{ nameSnapshot: '不应显示' }] }] },
  ] };
  const original = structuredClone(db);
  assert.deepEqual(dutySchedule(db)['2026-09-08'], ['测试甲', '测试乙', '测试丙']);
  const ai = new AiAssistantService({ databaseStore: { read: async () => db } });
  const answer = ai.answerDutyQuestion(db, '2026-09-08 谁值班？');
  assert.deepEqual(answer.data.names, ['测试甲', '测试乙', '测试丙']);
  assert.equal(answer.data.queryEvidence.records[0].sourceAction.recordSource.date, '2026-09-08');
  assert.deepEqual(db, original);
});
