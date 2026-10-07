'use strict';

const { AiToolRegistry } = require('./registry');

function readTool(definition) {
  return {
    riskLevel: 'R0',
    confirmationCount: 0,
    stages: ['post-plan'],
    ...definition,
  };
}

function createReadOnlyToolRegistry() {
  return new AiToolRegistry([
    readTool({
      id: 'resident.overview', name: '查询居民基本情况', category: '居民档案', stages: ['pre-plan', 'post-plan'],
      description: '从一户一档读取指定居民的基本资料。', permission: { module: 'personnel', action: 'view' }, sourceCollections: ['personnel'],
      handle: ({ service, database, message }) => service.answerResidentOverview(database, message),
    }),
    readTool({
      id: 'funds.pending-summary', name: '查询待发资金', category: '资金发放',
      description: "按年度、人员、居民组或类别统计尚未发放的资金。", permission: { module: 'finance', action: 'view' },
      sourceCollections: ['disbursementBatches', 'contractFeeBatches'],
      handle: ({ service, database, message }) => service.answerPendingFundingQuestion(database, message),
    }),
    readTool({
      id: 'funds.paid-summary', name: '查询已发资金', category: '资金发放',
      description: "按年度、人员、居民组或类别统计已发放资金。", permission: { module: 'finance', action: 'view' },
      sourceCollections: ['disbursementBatches', 'contractFeeBatches'],
      handle: ({ service, database, message }) => service.answerDirectQuestion(database, message),
    }),
    readTool({
      id: 'duty.schedule-query', name: '查询值班安排', category: '村务值班',
      description: '查询指定日期的值班人员。', permission: { module: 'work', action: 'view' }, sourceCollections: ['dutyRecords'],
      handle: ({ service, database, message }) => service.answerDutyQuestion(database, message),
    }),
    readTool({
      id: 'contract.expiry-query', name: '查询合同到期', category: '土地与合同',
      description: '按年份或时间范围查询合同到期情况。', permission: { module: 'finance', action: 'view' }, sourceCollections: ['resourceContracts'],
      handle: ({ service, database, message }) => service.answerContractExpiryQuestion(database, message),
    }),
    readTool({
      id: 'contract.receipt-query', name: '查询合同到账', category: '土地与合同',
      description: '核对指定合同或承包人的缴费到账记录。', permission: { module: 'finance', action: 'view' },
      sourceCollections: ['resourceContracts', 'contractFeeReceipts'],
      handle: ({ service, database, message }) => service.answerContractReceiptQuestion(database, message),
    }),
    readTool({
      id: 'party.member-query', name: '查询党员信息', category: '党员管理',
      description: '查询党员阶段、类型和党内职务。', permission: { module: 'party', action: 'view' }, sourceCollections: ['partyMembers'],
      handle: ({ service, database, message }) => service.answerPartyMemberQuestion(database, message),
    }),
    readTool({
      id: 'resident.identity-query', name: '查询居民身份证号', category: '居民档案',
      description: '从一户一档读取唯一居民的身份证号。', permission: { module: 'personnel', action: 'view' }, sourceCollections: ['personnel'],
      handle: ({ service, database, message }) => service.answerIdentityCardQuestion(database, message),
    }),
    readTool({
      id: 'resident.relationship-query', name: '查询家庭关系', category: '居民档案',
      description: '根据一户一档中已登记的户号和与户主关系核对两位居民关系。', permission: { module: 'personnel', action: 'view' },
      sourceCollections: ['personnel', 'households'],
      handle: async ({ service, database, message, messages, conversation, plan }) => {
        const localAnswer = service.answerResidentRelationshipQuestion(database, message);
        if (!localAnswer) return null;
        return service.explainVerifiedFacts({ messages: conversation || messages, request: message, database, plan, localAnswer });
      },
    }),
    readTool({
      id: 'land.total-area-query', name: '查询土地总面积', category: '土地与合同',
      description: '统计土地确权台账的地块数量和面积。', permission: { module: 'land', action: 'view' }, sourceCollections: ['landParcel', 'lands'],
      handle: ({ service, database, message }) => service.answerLandAreaQuestion(database, message),
    }),
    readTool({
      id: 'land.resident-parcels-query', name: '查询居民承包地', category: '土地与合同',
      description: '按居民稳定标识查询关联地块和面积。', permission: { module: 'land', action: 'view' }, sourceCollections: ['personnel', 'landParcel', 'lands'],
      handle: ({ service, database, message }) => service.answerLandContractorQuestion(database, message),
    }),
    readTool({
      id: 'work.status-query', name: '查询工作事项状态', category: '工作事项',
      description: '查询指定状态且未进入可恢复区的工作事项。', permission: { module: 'work', action: 'view' }, sourceCollections: ['workItems'],
      handle: ({ service, database, message }) => service.answerWorkStatusQuestion(database, message),
    }),
    readTool({
      id: 'document.final-query', name: '查询已定稿公文', category: '公文拟写',
      description: '查询已定稿且未归档的公文。', permission: { module: 'document', action: 'view' }, sourceCollections: ['documentDrafts'],
      handle: ({ service, database, message }) => service.answerFinalDocumentQuestion(database, message),
    }),
    readTool({
      id: 'certificate.history-query', name: '查询证明开具记录', category: '证明管理',
      description: '查询全部或指定居民的证明开具历史。', permission: { module: 'certificate', action: 'view' }, sourceCollections: ['certificates'],
      handle: ({ service, database, message }) => service.answerCertificateQuestion(database, message),
    }),
    readTool({
      id: 'finance.summary-query', name: '查询财务汇总', category: '财务收支',
      description: '按年度统计财务收入、支出、结余或分类。', permission: { module: 'finance', action: 'view' }, sourceCollections: ['finances'],
      handle: ({ service, database, message }) => service.answerFinanceSummaryQuestion(database, message),
    }),
    readTool({
      id: 'system.module-count', name: '查询模块记录数量', category: '系统查询',
      description: '统计当前账号可读取的业务记录数量。', permission: { module: 'workspace', action: 'view' },
      sourceCollections: ['personnel', 'partyMembers', 'visitRecords', 'dutyRecords', 'finances', 'landParcel', 'resourceContracts', 'certificates', 'documents', 'workItems'],
      handle: ({ service, database, message }) => service.answerModuleCount(database, message),
    }),
    readTool({
      id: 'system.navigate', name: '打开业务页面', category: '页面导航',
      description: '根据用户明确要求打开现有业务页面。', permission: { module: 'workspace', action: 'view' }, sourceCollections: [],
      handle: ({ navigationTarget, message }) => {
        const navigation = navigationTarget(message);
        if (!navigation) return null;
        return { content: `已为您打开${navigation.label}。`, provider: 'system', handled: true, action: { type: 'navigate', ...navigation } };
      },
    }),
  ]);
}

module.exports = { createReadOnlyToolRegistry };
