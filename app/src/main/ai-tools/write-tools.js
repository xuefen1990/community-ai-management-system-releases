'use strict';

const { AiToolRegistry } = require('./registry');

const WRITE_TOOL_DEFINITIONS = Object.freeze([
  ['document_category_assign', 'document.category-assign', '调整档案分类', '电子档案柜', 'R0', 'document', 'update', ['documents', 'foundationDictionaries']],
  ['document_category_create_and_archive', 'document.category-create-and-archive', '创建档案分类并归档', '电子档案柜', 'R0', 'document', 'create', ['documents', 'foundationDictionaries']],
  ['certificate_template_draft_create', 'certificate.template-draft-create', '建立证明模板草稿', '证明管理', 'R0', 'certificate', 'create', ['certificateTemplates']],
  ['certificate_template_update', 'certificate.template-update', '更新证明模板版本', '证明管理', 'R1', 'certificate', 'update', ['certificateTemplates']],
  ['resident_phone_update', 'resident.phone-update', '修改居民联系电话', '村民档案', 'R1', 'personnel', 'update', ['personnel']],
  ['resident_address_update', 'resident.address-update', '修改居民住址', '村民档案', 'R1', 'personnel', 'update', ['personnel']],
  ['resident_group_update', 'resident.group-update', '调整居民村民组', '村民档案', 'R1', 'personnel', 'update', ['personnel', 'villageGroups']],
  ['land_parcel_create', 'land.parcel-create', '新增土地地块', '土地管理', 'R1', 'land', 'create', ['landParcel']],
  ['visit_record_create', 'visit.record-create', '新增民情记录', '民情记录', 'R1', 'visit', 'create', ['visitRecords']],
  ['duty_schedule_add', 'duty.schedule-add', '新增值班安排', '村务值班', 'R1', 'work', 'create', ['dutyFlexible']],
  ['work_item_create', 'work.item-create', '新增工作事项', '工作管理', 'R1', 'work', 'create', ['workItems']],
  ['work_item_status_update', 'work.item-status-update', '调整工作状态', '工作管理', 'R1', 'work', 'update', ['workItems']],
  ['certificate_record_delete', 'certificate.record-delete', '删除证明记录', '证明管理', 'R2', 'certificate', 'delete', ['certificates']],
  ['document_draft_archive', 'document.draft-archive', '归档公文草稿', '公文拟写', 'R1', 'document', 'update', ['documentDrafts']],
  ['party_member_stage_update', 'party.member-stage-update', '调整党员阶段', '党员管理', 'R1', 'party', 'update', ['partyMembers']],
  ['resource_contract_create', 'contract.resource-create', '新增资源合同', '承包合同', 'R1', 'finance', 'create', ['resourceContracts']],
  ['contract_receipt_create', 'contract.receipt-create', '登记承包费到账', '承包合同', 'R1', 'finance', 'create', ['resourceContracts', 'contractFeeReceipts']],
  ['finance_record_create', 'finance.record-create', '新增财务收支', '财务收支', 'R1', 'finance', 'create', ['finances']],
  ['finance_record_update', 'finance.record-update', '修改财务收支', '财务收支', 'R1', 'finance', 'update', ['finances']],
  ['finance_records_clear', 'finance.records-clear', '清空财务台账', '财务收支', 'R2', 'finance', 'delete', ['finances']],
  ['settings_village_name_update', 'settings.village-name-update', '修改社区名称', '系统设置', 'R1', 'workspace', 'update', ['settings']],
  ['work_item_soft_delete', 'work.item-soft-delete', '删除工作事项', '工作管理', 'R2', 'work', 'delete', ['workItems']],
  ['work_items_soft_delete_batch', 'work.items-soft-delete-batch', '批量删除工作事项', '工作管理', 'R2', 'work', 'delete', ['workItems']],
  ['database_backup_restore', 'workspace.backup-restore', '恢复系统备份', '系统备份', 'R2', 'workspace', 'update', []],
  ['unit_member_disable', 'account.member-disable', '停用单位成员', '账号权限', 'R2', 'account', 'update', []],
]);

const WRITE_TOOL_ID_BY_ACTION = Object.freeze(Object.fromEntries(WRITE_TOOL_DEFINITIONS.map(item => [item[0], item[1]])));

function createWriteToolRegistry() {
  return new AiToolRegistry(WRITE_TOOL_DEFINITIONS.map(([
    actionType, id, name, category, riskLevel, permissionModule, permissionAction, sourceCollections,
  ]) => ({
    id,
    name,
    category,
    description: riskLevel === 'R0' ? `${name}；完成后提供结果复核和撤销入口。` : `${name}；执行前展示影响内容并由当前账号确认。`,
    riskLevel,
    confirmationCount: riskLevel === 'R0' ? 0 : riskLevel === 'R2' ? 2 : 1,
    permission: { module: permissionModule, action: permissionAction },
    sourceCollections,
    precheck: '重新读取目标对象、版本和当前账号权限',
    impact: riskLevel === 'R0' ? '只创建可撤销草稿、普通分类或非敏感关联' : riskLevel === 'R2' ? '可能影响多条记录或关键配置' : '修改一项正式业务资料',
    verification: '执行后重新读取目标对象，核对结果与预期是否一致',
    undoPolicy: riskLevel === 'R2' ? '仅在保留完整恢复快照且目标未被再次修改时允许撤销' : '目标未被后续修改时可从 AI 助理记录撤销',
    onlineSummary: '只发送完成任务所需的最少文字摘要，不发送本地文件路径和权限凭据',
    stages: ['post-plan'],
    handle: async () => null,
    actionType,
  })));
}

function writeToolForAction(registry, actionType) {
  const id = WRITE_TOOL_ID_BY_ACTION[String(actionType || '').trim()];
  return id ? registry.get(id) : null;
}

module.exports = { WRITE_TOOL_DEFINITIONS, WRITE_TOOL_ID_BY_ACTION, createWriteToolRegistry, writeToolForAction };
