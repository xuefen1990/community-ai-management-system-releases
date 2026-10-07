'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('工作区包含符号链接，需先核对后再搬迁');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push({ relative: path.relative(root, file), sha256: await digest(file), size: (await fs.stat(file)).size });
      else throw new Error('工作区包含不支持的文件类型');
    }
  }
  for (const name of ['data', 'lan-workspace']) {
    if (await fs.stat(path.join(root, name)).then(stat => stat.isDirectory(), () => false)) await walk(path.join(root, name));
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function remap(value, source, destination, external = new Map()) {
  if (typeof value === 'string') return external.get(value) || (value === source ? destination : value.startsWith(`${source}${path.sep}`) ? `${destination}${value.slice(source.length)}` : value);
  if (Array.isArray(value)) return value.map(item => remap(item, source, destination, external));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, source, destination, external)]));
  return value;
}

function externalReferences(value, source, key = '', result = new Set()) {
  if (Array.isArray(value)) value.forEach(item => externalReferences(item, source, key, result));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => externalReferences(item, source, name, result));
  else if (typeof value === 'string' && /^(?:path|filePath|file_path|fileObjectRelativePath|originalPath|sourcePath|attachmentPath|archivePath|wordPath|cachePath|tempPath)$/iu.test(key)
    && path.isAbsolute(value) && !value.startsWith(`${source}${path.sep}`) && !value.startsWith('/api/')) result.add(value);
  return result;
}

async function relocateWorkspace({ source, destination }) {
  const from = path.resolve(source), to = path.resolve(destination);
  if (from === to || to.startsWith(`${from}${path.sep}`) || from.startsWith(`${to}${path.sep}`)) throw new Error('新位置不能与当前工作区重叠');
  if (await fs.stat(to).then(() => true, () => false)) throw new Error('目标工作区已存在，请选择其他文件夹');
  const originals = await inventory(from);
  if (!originals.some(item => item.relative === path.join('lan-workspace', 'workspace.json'))) throw new Error('找不到当前业务工作区，搬迁已取消');
  try {
    await fs.mkdir(to, { recursive: false, mode: 0o700 });
    for (const name of ['data', 'lan-workspace']) {
      const src = path.join(from, name);
      if (await fs.stat(src).then(stat => stat.isDirectory(), () => false)) await fs.cp(src, path.join(to, name), { recursive: true, errorOnExist: true, force: false });
    }
    const copies = await inventory(to);
    if (originals.length !== copies.length || originals.some((item, index) => item.relative !== copies[index].relative || item.sha256 !== copies[index].sha256 || item.size !== copies[index].size)) {
      throw new Error('工作区复制校验失败，仍使用原位置');
    }
    const workspace = JSON.parse(await fs.readFile(path.join(to, 'lan-workspace', 'workspace.json'), 'utf8'));
    const external = new Map();
    const missingExternal = [];
    for (const reference of externalReferences(workspace.data, from)) {
      const stats = await fs.stat(reference).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stats?.isFile()) { missingExternal.push(reference); continue; }
      const name = `${createHash('sha256').update(reference).digest('hex')}${path.extname(reference)}`;
      const target = path.join(to, 'data', 'relocated-files', name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(reference, target);
      if (await digest(reference) !== await digest(target)) throw new Error('工作区外部附件复制校验失败');
      external.set(reference, target);
    }
    for (const item of copies) {
      if (!item.relative.endsWith('.json') || item.relative.includes(`${path.sep}foundation-backups${path.sep}`)
        || item.relative.includes(`${path.sep}backups${path.sep}`) || item.relative.includes('migration-backup-')) continue;
      const file = path.join(to, item.relative);
      const text = await fs.readFile(file, 'utf8');
      if (!text.includes(from) && ![...external.keys()].some(reference => text.includes(reference))) continue;
      const updated = remap(JSON.parse(text), from, to, external);
      await fs.writeFile(file, JSON.stringify(updated), { mode: 0o600 });
    }
    return { files: copies.length + external.size, bytes: copies.reduce((sum, item) => sum + item.size, 0),
      missingExternal, destination: to };
  } catch (error) {
    await fs.rm(to, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { relocateWorkspace, inventory, remap };
