import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function applicationDataRoot(platform = process.platform) {
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}
export function relocatePaths(value, from, to) {
  if (typeof value === 'string') {
    if (value === from || value.startsWith(from + path.sep)) return to + value.slice(from.length);
    const oldUrl = pathToFileURL(from).href;
    if (value === oldUrl || value.startsWith(oldUrl + '/')) return pathToFileURL(to).href + value.slice(oldUrl.length);
    return value;
  }
  if (Array.isArray(value)) return value.map(item => relocatePaths(item, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relocatePaths(item, from, to)]));
  return value;
}
async function exists(file) { try { await fs.access(file); return true; } catch(error) { if(error.code === 'ENOENT')return false;throw error; } }
async function rewriteJsonFiles(directory, source, destination) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await rewriteJsonFiles(file, source, destination);
    else if (entry.isFile() && /\.(json|db)$/.test(entry.name)) {
      let data;try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { continue; }
      await fs.writeFile(file, JSON.stringify(relocatePaths(data, source, destination), null, 2) + '\n', { mode: 0o600 });
    }
  }
}
export async function prepareProfile({ project, profile, fresh = false, source = path.join(applicationDataRoot(), '社区AI管理系统') }) {
  const resolved = path.resolve(profile), production = path.resolve(source);
  if (resolved === production || resolved.startsWith(production + path.sep)) throw new Error('开发数据目录不能位于正式数据目录中');
  // Refuse a symlink back to production, including a symlink in a parent folder.
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const realParent = await fs.realpath(path.dirname(resolved));
  if (realParent === production || realParent.startsWith(production + path.sep)) throw new Error('开发目录指向正式数据，已停止');
  if (await exists(resolved)) {
    if ((await fs.lstat(resolved)).isSymbolicLink()) throw new Error('开发数据目录不能是符号链接');
    if (!await exists(path.join(resolved, 'development-profile.json'))) throw new Error('开发目录已有数据但缺少初始化标记，请指定一个新的开发目录');
    return { initialized: false, profile: resolved };
  }
  const staging = `${resolved}.initializing-${process.pid}`;
  await fs.mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    if (!fresh) {
      for (const folder of ['data', 'contract-fee', 'work-attachments', 'license', 'settings']) {
        const from = path.join(production, folder);
        if (await exists(from)) await fs.cp(from, path.join(staging, folder), {
          recursive: true, dereference: true,
          filter: file => !['backups', 'foundation-backups'].includes(path.basename(file)),
        });
      }
      await fs.mkdir(path.join(staging, 'backend'), { recursive: true });
      // Keep the normal account/workspace API, against a one-time local snapshot.
      const candidates = [path.join(project, 'backend/data/backend.db'), path.join(production, 'backend/backend.db')];
      for (const file of candidates) if (await exists(file)) {
        const db = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!Array.isArray(db.users)) throw new Error('账号数据快照格式不正确');
        await fs.writeFile(path.join(staging, 'backend/backend.db'), JSON.stringify(db), { mode: 0o600 });
        break;
      }
      await rewriteJsonFiles(staging, production, resolved);
    }
    await fs.mkdir(path.join(staging, 'backend'), { recursive: true });
    await fs.writeFile(path.join(staging, 'backend/service-secret'), crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
    await fs.writeFile(path.join(staging, 'development-profile.json'), JSON.stringify({ createdAt: new Date().toISOString(), source: fresh ? 'empty' : production, note: '开发副本；不会自动覆盖或写回正式数据。' }, null, 2), { mode: 0o600 });
    await fs.rename(staging, resolved);
  } catch (error) { await fs.rm(staging, { recursive: true, force: true });throw error; }
  return { initialized: true, profile: resolved };
}
