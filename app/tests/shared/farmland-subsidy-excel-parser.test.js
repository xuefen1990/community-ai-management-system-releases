'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseFarmlandSubsidyWorkbook } = require('../../src/shared/farmland-subsidy-excel-parser');

test('uses the payment list as the master data and tags village cadres from attachment 1-4', () => {
  const result = parseFarmlandSubsidyWorkbook({
    '附件1-4': [['村干部清册'], ['序号', '户主姓名', '补贴金额（元）'], [1, '李四', 120]],
    '地力补贴兑付清册': [['2026年兑付清册'], ['序号', '户主姓名', '身份证号', '开户行', '一卡通号', '村', '村民组', '应享受补贴面积（亩）', '补贴标准（元/亩）', '补贴金额（元）', '备注'], [1, '张三', '320000199001010011', '农商行', '62220001', '陆庄', '东一组', 2, 120, 240, ''], [2, '李四', '320000199001010022', '农商行', '62220002', '陆庄', '东一组', 1, 120, 120, '']],
  });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].category, 'household');
  assert.equal(result.records[1].category, 'village_cadre');
});

test('recognizes phone aliases and enriches the payment list from a uniquely matched attachment', () => {
  const result = parseFarmlandSubsidyWorkbook({
    '附件1-1': [['分户清册'], ['序号', '户主姓名', '村民组', '联系电话\n手机号', '补贴金额（元）'], [1, '张三', '东一组', '138 0000 0000', 240]],
    '地力补贴兑付清册': [['兑付清册'], ['序号', '户主姓名', '身份证号', '开户行', '一卡通号', '村', '村民组', '应享受补贴面积（亩）', '补贴标准（元/亩）', '补贴金额（元）'], [1, '张三', '320000199001010011', '农商行', '62220001', '陆庄', '东一组', 2, 120, 240]],
  });
  assert.equal(result.records[0].phone, '13800000000');
  assert.deepEqual(result.warnings, []);
});
