'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { INVOKE_CHANNELS, SEND_CHANNELS, EVENT_CHANNELS } = require('../shared/ipc-contract');

function invoke(methodName, ...argumentsList) {
  return ipcRenderer.invoke(INVOKE_CHANNELS[methodName], ...argumentsList);
}

function subscribe(methodName, callback) {
  if (typeof callback !== 'function') throw new TypeError(`${methodName} requires a callback`);
  const channel = EVENT_CHANNELS[methodName];
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

const api = {
  readDb: () => invoke('readDb'),
  writeDb: (value) => invoke('writeDb', value),
  createDbBackup: () => invoke('createDbBackup'),
  listDbBackups: () => invoke('listDbBackups'),
  restoreDbBackup: (value) => invoke('restoreDbBackup', value),
  writePersonnelImport: (value) => invoke('writePersonnelImport', value),
  restorePersonnelImportVersion: (value) => invoke('restorePersonnelImportVersion', value),
  writeLandImport: (value) => invoke('writeLandImport', value),
  restoreLandImportVersion: (value) => invoke('restoreLandImportVersion', value),
  archiveFile: (value) => invoke('archiveFile', value),
  deleteFile: (sourcePath) => invoke('deleteFile', { sourcePath }),
  moveToTrash: (sourcePath) => invoke('moveToTrash', { sourcePath }),
  restoreFromTrash: (trashPath, originalPath) => invoke('restoreFromTrash', { trashPath, originalPath }),
  deletePermanently: (value) => invoke('deletePermanently', value),
  emptyTrash: () => invoke('emptyTrash'),
  getFilesMetadata: (value) => invoke('getFilesMetadata', value),
  selectFilesAndFolders: () => invoke('selectFilesAndFolders'),
  openPath: (value) => invoke('openPath', value),
  readExcelColumns: (value) => invoke('readExcelColumns', value),
  selectExcelFile: () => invoke('selectExcelFile'),
  getDbDir: () => invoke('getDbDir'),
  startWindowDrag: () => ipcRenderer.send(SEND_CHANNELS.startWindowDrag),
  selectAndMigrateDataDir: () => invoke('selectAndMigrateDataDir'),
  platform: process.platform,
  getMachineId: () => invoke('getMachineId'),
  isDev: () => invoke('isDev'),
  getVersion: () => invoke('getVersion'),
  getLanShareInfo: () => invoke('getLanShareInfo'),
  updateLanShareConfig: (value) => invoke('updateLanShareConfig', value),
  setLanShareAuthState: (value) => invoke('setLanShareAuthState', value),
  writeOperationLog: (value) => invoke('writeOperationLog', value),
  getMobileUploadInfo: () => invoke('getMobileUploadInfo'),
  onMobileFileUploaded: (callback) => subscribe('onMobileFileUploaded', callback),
  onMobileVoiceParseRequest: (callback) => subscribe('onMobileVoiceParseRequest', callback),
  onMobileVoiceConfirmSave: (callback) => subscribe('onMobileVoiceConfirmSave', callback),
  sendVoiceParseResult: (value) => invoke('sendVoiceParseResult', value),
  scanLocalModels: () => invoke('scanLocalModels'),
  toggleInternalAiServer: (value) => invoke('toggleInternalAiServer', value),
  getInternalAiServerStatus: () => invoke('getInternalAiServerStatus'),
  openModelsDir: () => invoke('openModelsDir'),
  appendAiLog: (value) => invoke('appendAiLog', value),
  exportAiLog: (value) => invoke('exportAiLog', value),
  registerLocalAccount: (value) => invoke('registerLocalAccount', value),
  loginLocalAccount: (value) => invoke('loginLocalAccount', value),
  logoutLocalAccount: () => invoke('logoutLocalAccount'),
  getLocalAuthStatus: () => invoke('getLocalAuthStatus'),
  activateOfflineLicense: (code) => invoke('activateOfflineLicense', code),
  importLocalModel: () => invoke('importLocalModel'),
  getAiSettings: () => invoke('getAiSettings'),
  saveAiSettings: (value) => invoke('saveAiSettings', value),
  testOnlineAi: () => invoke('testOnlineAi'),
  chatWithAi: (messages) => invoke('chatWithAi', { messages }),
};

contextBridge.exposeInMainWorld('api', Object.freeze(api));
