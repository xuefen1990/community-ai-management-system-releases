'use strict';

const ACTIONS = ['view', 'create', 'update', 'delete', 'export', 'approve'];
const CATALOG = [
  { id: 'workspace', label: '单位工作台', actions: ['view', 'update'] },
  { id: 'statistics', label: '数据统计', actions: ['view', 'export'] },
  { id: 'personnel', label: '居民一户一档', actions: ACTIONS },
  { id: 'party', label: '党员管理', actions: ACTIONS },
  { id: 'visit', label: '民情记录', actions: ACTIONS },
  { id: 'work', label: '村务值班与工作事项', actions: ACTIONS },
  { id: 'finance', label: '财务收支与承包费', actions: ACTIONS },
  { id: 'land', label: '土地承包确权', actions: ACTIONS },
  { id: 'certificate', label: '证明管理', actions: ACTIONS },
  { id: 'archive', label: '电子档案柜', actions: ACTIONS },
  { id: 'funds', label: '资金发放中心', actions: ACTIONS },
  { id: 'document', label: '公文拟写', actions: ACTIONS },
  { id: 'settings', label: '系统设置', actions: ['view', 'update'] },
];

const MODULES = {
  settings: 'settings', personnel: 'personnel', specialPersonnelProfiles: 'personnel', households: 'personnel', partyMembers: 'party', partyActivists: 'party',
  visitRecords: 'visit', dutyRecords: 'work', workItems: 'work', workEvidence: 'work',
  workProgressRecords: 'work', workResourceEntries: 'work', workAcceptances: 'work',
  lands: 'land', landParcel: 'land', finances: 'finance', resourceContracts: 'finance',
  contractFeeLedgers: 'finance', contractFeeBatches: 'finance', contractFeeReceipts: 'finance',
  contractFeeAdvances: 'finance', contractFeeDistributionPlans: 'finance', contractFeeDistributionBatches: 'finance',
  disbursementCategories: 'funds', disbursementBatches: 'funds', disbursementProfiles: 'funds', farmlandSubsidyLedgers: 'funds',
  certificates: 'certificate', documents: 'archive', documentDrafts: 'document',
  documentVersions: 'document', documentReferences: 'document', documentDraftMessages: 'document',
  documentTemplates: 'document', writingProfiles: 'document',
  aiAssistantOperations: 'settings', aiAssistantTasks: 'settings', aiFileIndexEntries: 'archive',
  aiStorageMaintenance: 'settings', aiAnomalyFindings: 'settings', aiAnomalyScan: 'settings', operationLogs: 'settings',
};

const PRESETS = {
  readonly: { label: '只读人员', permissions: Object.fromEntries(CATALOG.filter(item => !['settings'].includes(item.id)).map(item => [item.id, ['view']])), aiAccessEnabled: false },
  clerk: { label: '业务经办', permissions: { workspace: ['view'], personnel: ['view', 'create', 'update'], visit: ['view', 'create', 'update'], work: ['view', 'create', 'update'], certificate: ['view', 'create', 'update'], archive: ['view', 'create'], document: ['view', 'create', 'update'] }, aiAccessEnabled: true },
  custom: { label: '自定义', permissions: {}, aiAccessEnabled: false },
};

function normalizePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const { id, actions: allowed } of CATALOG) {
    const requested = value[id];
    if (!Array.isArray(requested)) continue;
    const actions = [...new Set(requested.filter(action => allowed.includes(action)))];
    if (actions.length && !actions.includes('view')) actions.unshift('view');
    if (actions.length) result[id] = actions;
  }
  if (Object.keys(result).some(id => id !== 'workspace') && !result.workspace) result.workspace = ['view'];
  return result;
}

function can(user, moduleId, action = 'view') {
  if (user?.role === 'main_account' || user?.role === 'unit_admin' || user?.role === 'admin' || user?.role === 'platform_admin') return true;
  const actions = user?.permissions?.[moduleId] || [];
  return actions.includes('view') && actions.includes(action);
}

function mayUseAi(user) {
  return user?.role !== 'member' || user.ai_access_enabled !== 0;
}

function catalog() {
  return { modules: CATALOG, presets: PRESETS };
}

module.exports = { MODULES, CATALOG, PRESETS, normalizePermissions, can, mayUseAi, catalog };
