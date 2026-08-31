'use strict';

function createEmptyDatabase() {
  return {
    version: 4,
    settings: {
      villageName: '社区名称',
      appSubtitle: '社区AI管理系统',
    },
    personnel: [],
    specialPersonnelProfiles: [],
    households: [],
    partyMembers: [],
    partyActivists: [],
    visitRecords: [],
    dutyRecords: [],
    finances: [],
    lands: [],
    landParcel: [],
    resourceContracts: [],
    contractFeeLedgers: [],
    contractFeeBatches: [],
    contractFeeReceipts: [],
    contractFeeAdvances: [],
    disbursementCategories: [],
    disbursementBatches: [],
    disbursementProfiles: [],
    farmlandSubsidyLedgers: [],
    certificates: [],
    documents: [],
    documentDrafts: [],
    documentVersions: [],
    documentReferences: [],
    documentDraftMessages: [],
    documentTemplates: [],
    writingProfiles: [],
    operationLogs: [],
    workItems: [],
    workEvidence: [],
    workProgressRecords: [],
    workResourceEntries: [],
    workAcceptances: [],
  };
}

module.exports = { createEmptyDatabase };
