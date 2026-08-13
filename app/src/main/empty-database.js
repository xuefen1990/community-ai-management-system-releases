'use strict';

function createEmptyDatabase() {
  return {
    version: 2,
    settings: {
      villageName: '社区名称',
      appSubtitle: '社区AI管理系统',
    },
    personnel: [],
    households: [],
    partyMembers: [],
    partyActivists: [],
    visitRecords: [],
    dutyRecords: [],
    finances: [],
    lands: [],
    landParcel: [],
    certificates: [],
    documents: [],
    documentDrafts: [],
    documentVersions: [],
    documentReferences: [],
    documentTemplates: [],
    writingProfiles: [],
    operationLogs: [],
  };
}

module.exports = { createEmptyDatabase };
