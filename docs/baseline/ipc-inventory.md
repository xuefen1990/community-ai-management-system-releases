# 原版预加载 API 与 IPC 清单

- 暴露对象：`window.api`
- API 数量：42

| API | 类型 | IPC 方式 | channel | 参数数量 |
| --- | --- | --- | --- | ---: |
| `readDb` | function | `invoke` | `read-db` | 0 |
| `writeDb` | function | `invoke` | `write-db` | 1 |
| `createDbBackup` | function | `invoke` | `create-db-backup` | 0 |
| `listDbBackups` | function | `invoke` | `list-db-backups` | 0 |
| `restoreDbBackup` | function | `invoke` | `restore-db-backup` | 1 |
| `writePersonnelImport` | function | `invoke` | `write-personnel-import` | 1 |
| `restorePersonnelImportVersion` | function | `invoke` | `restore-personnel-import-version` | 1 |
| `writeLandImport` | function | `invoke` | `write-land-import` | 1 |
| `restoreLandImportVersion` | function | `invoke` | `restore-land-import-version` | 1 |
| `archiveFile` | function | `invoke` | `archive-file` | 1 |
| `deleteFile` | function | `invoke` | `move-to-trash` | 1 |
| `moveToTrash` | function | `invoke` | `move-to-trash` | 1 |
| `restoreFromTrash` | function | `invoke` | `restore-from-trash` | 1 |
| `deletePermanently` | function | `invoke` | `delete-permanently` | 1 |
| `emptyTrash` | function | `invoke` | `empty-trash` | 0 |
| `getFilesMetadata` | function | `invoke` | `get-files-metadata` | 1 |
| `selectFilesAndFolders` | function | `invoke` | `select-files-and-folders` | 0 |
| `openPath` | function | `invoke` | `open-path` | 1 |
| `readExcelColumns` | function | `invoke` | `read-excel-columns` | 1 |
| `selectExcelFile` | function | `invoke` | `select-excel-file` | 0 |
| `getDbDir` | function | `invoke` | `get-db-dir` | 0 |
| `startWindowDrag` | function | `send` | `start-window-drag` | 0 |
| `selectAndMigrateDataDir` | function | `invoke` | `select-and-migrate-data-dir` | 0 |
| `platform` | string | — | darwin | 0 |
| `getMachineId` | function | `invoke` | `get-machine-id` | 0 |
| `isDev` | function | `invoke` | `is-dev` | 0 |
| `getVersion` | function | `invoke` | `get-version` | 0 |
| `getLanShareInfo` | function | `invoke` | `get-lan-share-info` | 0 |
| `updateLanShareConfig` | function | `invoke` | `update-lan-share-config` | 1 |
| `setLanShareAuthState` | function | `invoke` | `set-lan-share-auth-state` | 1 |
| `writeOperationLog` | function | `invoke` | `write-operation-log` | 1 |
| `getMobileUploadInfo` | function | `invoke` | `get-mobile-upload-info` | 0 |
| `onMobileFileUploaded` | function | `removeAllListeners` | `mobile-file-uploaded` | 0 |
| ↳ | function | `on` | `mobile-file-uploaded` | 1 |
| `onMobileVoiceParseRequest` | function | `removeAllListeners` | `mobile-voice-parse-request` | 0 |
| ↳ | function | `on` | `mobile-voice-parse-request` | 1 |
| `onMobileVoiceConfirmSave` | function | `removeAllListeners` | `mobile-voice-confirm-save` | 0 |
| ↳ | function | `on` | `mobile-voice-confirm-save` | 1 |
| `sendVoiceParseResult` | function | `invoke` | `resolve-voice-parse-result` | 1 |
| `scanLocalModels` | function | `invoke` | `scan-local-models` | 0 |
| `toggleInternalAiServer` | function | `invoke` | `toggle-internal-ai-server` | 1 |
| `getInternalAiServerStatus` | function | `invoke` | `get-internal-ai-server-status` | 0 |
| `openModelsDir` | function | `invoke` | `open-models-dir` | 0 |
| `appendAiLog` | function | `invoke` | `append-ai-log` | 1 |
| `exportAiLog` | function | `invoke` | `export-ai-log` | 1 |

该清单通过受限 Electron stub 执行原 `preload.js` 获取，用于新兼容桥接层逐项实现和核对。
