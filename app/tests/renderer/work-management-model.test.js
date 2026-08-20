'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const model = require('../../src/renderer/js/modules/work-management-model');

test('work number advances within a date and restarts on a different date', () => {
  const items = [{ number: 'GZ-20260820-001' }, { number: 'GZ-20260820-003' }, { number: 'GZ-20260819-099' }];
  assert.equal(model.createWorkNumber(items, new Date('2026-08-20T08:00:00')), 'GZ-20260820-004');
  assert.equal(model.createWorkNumber(items, new Date('2026-08-21T08:00:00')), 'GZ-20260821-001');
});

test('resource entries calculate formula amounts and preserve direct amounts', () => {
  assert.equal(model.calculateResourceAmount({ quantity: 3, duration: 2, unitPrice: 180 }), 1080);
  assert.equal(model.calculateResourceAmount({ quantity: 3, unitPrice: 88.888 }), 266.66);
  assert.equal(model.calculateResourceAmount({ amount: 120.456 }), 120.46);
});

test('resource summary groups entries by category', () => {
  const summary = model.summarizeResources([
    { workId: 'w1', category: '人员', quantity: 2, duration: 1, unitPrice: 100 },
    { workId: 'w1', category: '机械', quantity: 1, duration: 3, unitPrice: 80 },
    { workId: 'w2', category: '人员', quantity: 1, unitPrice: 999 },
  ], 'w1');
  assert.deepEqual(summary, { 人员: 200, 机械: 240, 材料: 0, 车辆: 0, total: 440 });
});

test('completion and archive transitions require complete information and acceptance', () => {
  const work = { status: '进行中', name: '河道清理', type: '环境卫生', location: '幸福河', startDate: '2026-08-20', responsiblePerson: '张三' };
  assert.equal(model.validateTransition(work, '已完成'), '请先填写验收结论');
  assert.equal(model.validateTransition(work, '已完成', { conclusion: '验收合格' }), null);
  assert.equal(model.validateTransition(work, '已归档', { conclusion: '验收合格' }), '只有已完成的工作可以归档');
  assert.equal(model.validateTransition({ ...work, status: '已完成' }, '已归档', { conclusion: '验收合格' }), null);
});
