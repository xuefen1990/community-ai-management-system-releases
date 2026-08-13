'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseTool', Object.freeze({
  issueLicense: (input) => ipcRenderer.invoke('issue-license', input),
}));
