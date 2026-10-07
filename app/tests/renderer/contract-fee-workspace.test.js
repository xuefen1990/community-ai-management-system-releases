'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDirectory = path.join(__dirname, '../../src/renderer');

test('foundation loads the contract fee model, stylesheet and workspace module', () => {
  const extensions = fs.readFileSync(path.join(rendererDirectory, 'foundation/extensions.mjs'), 'utf8');
  assert.match(extensions, /contract-fee-workspace\.css/u);
  assert.match(extensions, /contract-fee-model\.js/u);
  assert.match(extensions, /contract-fee-workspace\.js/u);
  const workspace = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  assert.match(workspace, /contract-fee-ledger-ui\.js/u);
  assert.match(workspace, /ContractFeeLedgerUI/u);
});

test('workspace module keeps the unified disbursement screens outside the legacy renderer', () => {
  const script = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  for (const label of ['资金发放中心', '新建发放', '未完成发放', '历史发放', '模板管理', '上传 Excel', '地力补贴台账']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /正在保存/u);
  assert.match(script, /cf-disbursement-error/u);
  for (const label of ['本类别常用人员', '年度地力补贴关联台账', '岗位工资/补贴', '杂工补贴', '导出五张表']) assert.match(script, new RegExp(label, 'u'));
  for (const label of ['管理发放模板', '新建自定义发放模板', '同名居民必须', '手工调整原因', '自动分页', '准备打印', '已打印']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /residentLabel/u);
  assert.match(script, /markTemplateDisbursementPrinted/u);
  assert.match(script, /data-cf-preview-page/u);
  assert.match(script, /data-cf-print-page/u);
  assert.match(script, /data-import-id-card/u);
  assert.match(script, /scrollIntoView/u);
  assert.match(script, /编辑表格/u);
  assert.match(script, /返回编辑表/u);
  assert.match(script, /复制/u);
  assert.match(script, /录入说明/u);
  assert.doesNotMatch(script, /录入字段来源配置/u);
  assert.match(script, /打印字段/u);
  assert.match(script, /打印方向/u);
  assert.match(script, /data-template-resident-field/u);
  assert.match(script, /residentTemplateValue/u);
  assert.match(script, /导出 Excel/u);
  assert.match(script, /exportTemplateDisbursementWorkbook/u);
  assert.match(script, /cf-preview-workspace/u);
  assert.match(script, /打印设置/u);
  assert.match(script, /页面缩略/u);
  for (const label of ['页面边距', '窄（8 毫米）', '自定义', '修改', '删除', '输入姓名后自动关联居民']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /data-cf-preview-setting/u);
  assert.match(script, /data-cf-preview-margin/u);
  assert.match(script, /edit-template-preview-item/u);
  assert.match(script, /delete-template-preview-item/u);
  assert.match(script, /fillTemplateResidentRow/u);
  assert.match(script, /pageSize/u);
  assert.match(script, /landscape/u);
  for (const label of ['按地亩数分配', '按全组人口平均分配']) assert.match(script, new RegExp(label, 'u'));
  for (const label of ['承包费年度发放', '各组固定应发', '收款人台账', '不发给居民 / 集体留存', '同一地块、同一年度', '上传承包费 Excel', '回写本次名单']) assert.match(script, new RegExp(label, 'u'));
  for (const identifier of ['createContractFeeDistributionBatch', 'syncContractFeeDistributionBatchFromPrintBatch', 'contractFeePlanDuplicateRecipients']) assert.match(script, new RegExp(identifier, 'u'));
  for (const identifier of ['contractFeeImportedPrintLayout', 'contractFeeOutputColumns', 'contractFeeOutputValue', 'autoSequence']) assert.match(script, new RegExp(identifier, 'u'));
  for (const label of ['主表与附件', '附件 1-1', '附件 1-4', '附件 2-1', '附件 2-4', '首页', '上一页', '下一页', '末页', '跳至', '每页', '10 条', '20 条', '50 条', '查询定位', '身份证号', '待处理 · 去处理', '处理补贴关联', '确认关联', '暂不关联']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /subsidyDetailsModal/u);
  assert.match(script, /view-subsidy-sheet/u);
  assert.match(script, /subsidyRecordListModal/u);
  assert.match(script, /paginationHtml/u);
  assert.match(script, /paginationPages/u);
  assert.match(script, /subsidy-sheet-page-size/u);
  assert.match(script, /jump-subsidy-sheet-page/u);
  assert.match(script, /subsidy-editor-page-size/u);
  assert.match(script, /subsidyIssueListModal/u);
  assert.match(script, /subsidyResolutionModal/u);
  assert.match(script, /resolve-subsidy-issues/u);
  assert.match(script, /confirm-subsidy-association/u);
  for (const label of ['全选本页', '全选全部待处理项', '批量导入居民档案', '批量导入预览', '确认导入并关联', '只补充居民档案空白信息']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /subsidyResidentImportPlan/u);
  assert.match(script, /importFarmlandSubsidyResidents/u);
  assert.match(script, /已关联，待同步资料/u);
  assert.match(script, /资料核对/u);
  assert.match(script, /确认并同步/u);
  assert.match(script, /resident-subsidy-profile\.js/u);
  assert.match(script, /save-subsidy-record/u);
  assert.match(script, /document\.getElementById\('cf-modal-overlay'\)\?\.remove\(\)/u);
  assert.match(script, /overlay\.addEventListener\('click'/u);
  assert.match(script, /event\.stopPropagation\(\)/u);
  assert.match(script, /selectAndReadContractFeeExcel/u);
  assert.match(script, /exportContractFeeGroupFiles/u);
  assert.match(script, /openEvidenceSource/u);
  assert.match(script, /openRecordSource/u);
  assert.match(script, /openAiBusinessFile/u);
  assert.match(script, /pendingDisbursementImport = payload\.data/u);
  assert.match(script, /renderDisbursementList/u);
  assert.match(script, /renderTemplateLibrary/u);
  const importFunctions = [...script.matchAll(/async function importDisbursementExcel\(\)/gu)];
  assert.equal(importFunctions.length, 1, '首页和旧批次表单必须共用同一个安全的 Excel 导入入口');
  assert.match(script, /paidImportReviewModal/u);
  assert.match(script, /confirmPaidExcelImport/u);
  assert.doesNotMatch(script, /importLegacyDisbursementExcel/u);
  assert.match(script, /delete-template/u);
  assert.match(script, /restore-template/u);
  assert.match(script, /已按 AI 查询来源定位/u);
  assert.match(script, /对应的通用发放批次已不存在/u);
  assert.match(script, /对应的合同发放批次已不存在/u);
});

test('legacy resident profile loads the presentation adapter before its renderer', () => {
  const script = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  const helperIndex = script.indexOf('resident-record-presentation.js');
  const profileIndex = script.indexOf('resident-subsidy-profile.js');
  assert.ok(helperIndex >= 0 && helperIndex < profileIndex, '旧版入口必须先加载居民记录展示适配器');
});

test('funds homepage uses the confirmed reuse-first visual hierarchy', () => {
  const script = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  const style = fs.readFileSync(path.join(rendererDirectory, 'css/contract-fee-workspace.css'), 'utf8');
  for (const marker of ['cf-funds-header', 'cf-funds-stats', 'cf-funds-home-grid', 'cf-reuse-featured', 'cf-quick-panel', 'cf-pending-panel']) {
    assert.match(script, new RegExp(marker, 'u'));
    assert.match(style, new RegExp(`\\.${marker}`, 'u'));
  }
  for (const label of ['沿用上次名单，发本期款', '其他款项办理', '继续办理', '更换历史名单', '原历史记录不会改变']) assert.match(script, new RegExp(label, 'u'));
});

test('funding actions route contract fees into the dedicated project ledger', () => {
  const script = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-workspace.js'), 'utf8');
  const ledger = fs.readFileSync(path.join(rendererDirectory, 'js/contract-fee-ledger-ui.js'), 'utf8');
  assert.match(script, /choose-disbursement-type/u);
  assert.match(script, /choose-disbursement-import-type/u);
  assert.match(script, /openContractFeeEntry\(false\)/u);
  assert.match(script, /openContractFeeEntry\(true\)/u);
  assert.match(script, /item\.key !== 'contract_fee'/u);
  assert.match(script, /element\.dataset\.template === 'contract_fee' && state\.view !== 'management-category' \? openContractFeeEntry\(false\)/u);
  assert.match(ledger, /Object\.freeze\(\{ mount, openWizard \}\)/u);
  assert.match(ledger, /AI 已带入/u);
  assert.match(ledger, /preparedImport/u);
  for (const label of ['选择 Excel 所属业务', '新的承包费流程', '专用 Excel 识别']) assert.match(script, new RegExp(label, 'u'));
});
