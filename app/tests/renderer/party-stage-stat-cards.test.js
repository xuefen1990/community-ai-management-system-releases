'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const cards = require('../../src/renderer/js/party-stage-stat-cards');

test('stage statistic cards count the requested groups without counting a person twice', () => {
  const stats = cards.getStageCardStats({
    partyMembers: [
      { id: 'member-1', id_card: '11010519491231002X', stage: '正式党员' },
      { id: 'member-2', id_card: '11010519491231003X', stage: '预备党员' },
      { id: 'member-3', id_card: '11010519491231004X' },
    ],
    partyActivists: [
      { id: 'activist-duplicate', id_card: '11010519491231003X', stage: '预备党员' },
      { id: 'activist-1', id_card: '11010519491231005X', stage: '积极分子' },
      { id: 'activist-2', id_card: '11010519491231006X', stage: '发展对象' },
      { id: 'activist-3', id_card: '11010519491231007X', stage: '申请人' },
    ],
  });

  assert.equal(stats.memberAndProbationary, 3);
  assert.equal(stats.developmentAndActivist, 2);
});

test('stage grouping accepts common field and label variants', () => {
  assert.equal(cards.getStageGroup({ developmentStage: '入党积极分子' }, 'development'), true);
  assert.equal(cards.getStageGroup({ stage: '党员' }, 'member'), true);
  assert.equal(cards.getStageGroup({ stage: '申请人' }, 'development'), false);
});
