'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { revision, checkVersion, fail } = require('./foundation-data-model');
const { hashFile } = require('./foundation-backup-service');
const { assertLocalDataPath } = require('./local-file-boundary');
const list = value => Array.isArray(value) ? value : [];
async function fileMetadata(filePath) {
  const stats = await fs.lstat(filePath);
  if (stats.isSymbolicLink()) fail('INVALID_FILE', '请选择原文件，不支持将符号链接作为档案导入');
  const result = { path: filePath, name: path.basename(filePath), size: stats.size, isDirectory: stats.isDirectory(), modifiedAt: stats.mtime.toISOString() };
  if (stats.isDirectory()) {
    result.children = [];
    for (const entry of await fs.readdir(filePath, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile())) result.children.push(await fileMetadata(path.join(filePath, entry.name)));
    }
  }
  return result;
}
function documentRows(database) {
  return list(database.documents).map(record => ({ ...structuredClone(record), version: revision(record),
    name: record.name || record.file_name || '', category: record.category || record.file_category || '其他证明文件',
    storageArea: record.storageArea || record.storage_area || (record.is_trash || record.deleted_at || record.file_category === 'TRASH' ? 'trash' : 'archives'),
    fileObjectRelativePath: record.fileObjectRelativePath || record.file_path || record.path || '',
    createdAt: record.createdAt || record.created_at || record.upload_time || null,
    deletedAt: record.deletedAt || record.deleted_at || record.delete_time || null,
  }));
}
class FoundationDocumentService {
  constructor({ store, authorize, shell, uuid = randomUUID, now = () => new Date() }) {
    this.store = store; this.authorize = authorize; this.shell = shell; this.uuid = uuid; this.now = now;
  }
  get directory() { return path.join(this.store.dataDirectory, 'foundation-archives'); }
  async resolveFile(document) {
    const reference = document.fileObjectRelativePath || document.file_path || document.path;
    if (!reference || typeof reference !== 'string') fail('FILE_NOT_FOUND', '该档案没有有效的本机文件路径');
    const resolved = await assertLocalDataPath(this.store.dataDirectory, path.isAbsolute(reference) ? reference : path.resolve(this.store.dataDirectory, reference));
    const stats = await fs.stat(resolved);
    if (!stats.isFile()) fail('INVALID_FILE', '档案路径不是文件');
    return resolved;
  }
  async request(input = {}) {
    try {
      const method = ['open', 'getArchiveDirectory'].includes(input.action) ? 'GET'
        : ['deletePermanently', 'emptyTrash', 'moveToTrash'].includes(input.action) ? 'DELETE' : input.action === 'archive' ? 'POST' : 'PATCH';
      await this.authorize({ method, path: '/documents' });
      if (input.action === 'getArchiveDirectory') {
        await this.store.requireHostFileOperation?.();
        await fs.mkdir(this.directory, { recursive: true });
        const error = await this.shell.openPath(this.directory); if (error) throw new Error(error);
        return { success: true, directory: this.directory, path: this.directory, opened: true };
      }
      if (input.action === 'archive') return await this.archive(input);
      if (input.action === 'open') {
        await this.store.requireHostFileOperation?.();
        const document = documentRows(await this.store.read()).find(record => String(record.id) === String(input.documentId));
        if (!document) fail('NOT_FOUND', '档案不存在');
        const error = await this.shell.openPath(await this.resolveFile(document));
        if (error) throw new Error(error);
        return { success: true, opened: true };
      }
      const result = await this.store.update(async database => {
        await this.authorize({ method, path: '/documents' });
        const rows = database.documents ||= [];
        const targets = input.action === 'emptyTrash' ? documentRows(database).filter(row => row.storageArea === 'trash')
          : documentRows(database).filter(row => String(row.id) === String(input.documentId));
        if (!targets.length && input.action !== 'emptyTrash') fail('NOT_FOUND', '档案不存在');
        if (!['rename', 'updateCategory', 'moveToTrash', 'restore', 'deletePermanently', 'emptyTrash'].includes(input.action)) fail('INVALID_ACTION', '档案操作方式不正确');
        if (input.action === 'rename' && (!String(input.newName || '').trim() || /[/\\\0]/.test(input.newName))) fail('INVALID_INPUT', '档案名称不能为空或包含路径分隔符');
        if (input.action === 'updateCategory' && (!String(input.category || '').trim() || String(input.category).trim() === 'TRASH')) fail('INVALID_INPUT', '请选择有效的档案分类');
        for (const item of targets) {
          const record = rows.find(row => String(row.id) === String(item.id));
          if (input.baseVersion !== undefined) checkVersion(record, input.baseVersion);
          if (['deletePermanently', 'emptyTrash'].includes(input.action)) {
            if (item.storageArea !== 'trash') fail('NOT_IN_TRASH', '请先将档案移入废纸篓');
            // Keep the file with a recovery record. Removing a cabinet entry
            // must never unlink an original or a file referenced by a payment.
            (database.foundationDeletedRecords ||= []).push({ id: this.uuid(), domain: '/documents', record: structuredClone(record), deletedAt: this.now().toISOString() });
            rows.splice(rows.indexOf(record), 1);
          } else if (input.action === 'rename') record.name = record.file_name = String(input.newName).trim();
          else if (input.action === 'updateCategory') {
            record.category = record.file_category = String(input.category).trim();
            record.updatedAt = record.updated_at = this.now().toISOString();
          }
          else {
            const trash = input.action === 'moveToTrash';
            record.storageArea = record.storage_area = trash ? 'trash' : 'archives'; record.is_trash = trash;
            if (trash) record.deletedAt = record.deleted_at = this.now().toISOString();
            else { delete record.deletedAt; delete record.deleted_at; delete record.delete_time; if (record.file_category === 'TRASH') record.file_category = record.category || '其他证明文件'; }
          }
        }
        const updated = targets.length === 1 ? documentRows(database).find(row => String(row.id) === String(targets[0].id)) : null;
        return { success: true, affected: targets.length, ...(updated ? { document: updated } : {}) };
      });
      return result.result;
    } catch (error) { return { success: false, code: error.code || 'DOCUMENT_FILE_OPERATION_FAILED', error: error.message }; }
  }
  async archive(input) {
    const source = input.sourceFilePath;
    if (typeof source !== 'string' || !path.isAbsolute(source)) fail('INVALID_FILE', '请选择本机文件或文件夹');
    const stats = await fs.lstat(source);
    if (stats.isSymbolicLink()) fail('INVALID_FILE', '请直接选择原文件，不能归档替身或符号链接');
    if (stats.isDirectory()) {
      const files = [];
      const walk = async directory => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(full); else if (entry.isFile()) files.push(full);
        }
      };
      await walk(source);
      const archivedFiles = [];
      for (const [index, file] of files.entries()) {
        try {
          const result = await this.archive({ ...input, sourceFilePath: file, name: input.preserveOriginalName ? path.basename(file) : `${input.namePrefix || path.basename(source)}-${index + 1}${path.extname(file)}` });
          archivedFiles.push({ sourcePath: file, document: result.document });
        } catch (error) { return { success: true, isFolder: true, archivedFiles, failedFile: { name: path.basename(file), error: error.message }, remainingFiles: files.slice(index) }; }
      }
      return { success: true, isFolder: true, archivedFiles };
    }
    if (!stats.isFile()) fail('INVALID_FILE', '请选择普通文件');
    const name = String(input.name || path.basename(source)).trim();
    if (!name || /[/\\\0]/.test(name)) fail('INVALID_INPUT', '档案名称不正确');
    const remoteChild = await this.store.isRemoteChild?.() || false;
    let uploaded = null;
    let target;
    let id;
    let sourceHash;
    if (remoteChild) {
      uploaded = await this.store.uploadArchivedFile(source);
      id = uploaded.id; target = uploaded.path; sourceHash = uploaded.sha256;
    } else {
      await fs.mkdir(this.directory, { recursive: true });
      id = this.uuid(); target = path.join(this.directory, `${id}${path.extname(source)}`);
      sourceHash = await hashFile(source);
      await fs.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL);
    }
    const record = { id, name, file_name: name, category: input.category || '其他证明文件', file_category: input.category || '其他证明文件',
      file_path: target, fileObjectRelativePath: target, storageArea: 'archives', storage_area: 'archives',
      links: structuredClone(list(input.links)), sizeBytes: stats.size, sourcePath: remoteChild ? '' : source, createdAt: this.now().toISOString() };
    try {
      if ((!remoteChild && await hashFile(target) !== sourceHash) || await hashFile(source) !== sourceHash) fail('FILE_CHANGED', '归档时原文件发生变化，请重试');
      await this.store.update(async database => { await this.authorize({ method: 'POST', path: '/documents' }); (database.documents ||= []).push(record); return record.id; });
    }
    catch (error) { if (!remoteChild) await fs.unlink(target).catch(() => {}); throw error; }
    return { success: true, document: { ...record, version: revision(record) }, sourcePath: remoteChild ? '' : source };
  }
}
module.exports = { FoundationDocumentService, documentRows, fileMetadata };
