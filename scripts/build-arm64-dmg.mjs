#!/usr/bin/env node

import crypto from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appProject = path.join(projectRoot, 'app');
const templateApp = '/Applications/村务通管理系统.app';
const runtimeApp = path.join(appProject, '.runtime', '社区AI管理系统.app');
const releaseDirectory = path.join(appProject, 'release');
const stagingDirectory = path.join(releaseDirectory, 'dmg-root');
const outputPath = path.join(releaseDirectory, '社区AI管理系统-0.1.0-arm64.dmg');

async function requirePath(targetPath, label) {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label}不存在：${targetPath}`);
    throw error;
  }
}

async function makeTreeWritable(targetPath) {
  let stats;
  try {
    stats = await lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stats.isSymbolicLink()) return;
  if (stats.isDirectory()) {
    await chmod(targetPath, stats.mode | 0o700);
    for (const name of await readdir(targetPath)) await makeTreeWritable(path.join(targetPath, name));
  } else {
    await chmod(targetPath, stats.mode | 0o600);
  }
}

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { cwd: projectRoot, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} 执行失败（退出码 ${result.status}）`);
}

await requirePath(templateApp, '原版 ARM64 应用模板');
await requirePath(path.join(projectRoot, 'source-original', 'app-asar', 'node_modules'), '已提取的运行依赖');

run(process.execPath, [path.join(projectRoot, 'scripts', 'prepare-local-runtime.mjs'), templateApp, appProject]);
run('xattr', ['-cr', runtimeApp]);
run('codesign', ['--force', '--deep', '--sign', '-', runtimeApp]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', runtimeApp]);

await makeTreeWritable(stagingDirectory);
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });
await cp(runtimeApp, path.join(stagingDirectory, '社区AI管理系统.app'), {
  recursive: true,
  preserveTimestamps: true,
  verbatimSymlinks: true,
});
await symlink('/Applications', path.join(stagingDirectory, 'Applications'));
await rm(outputPath, { force: true });
run('hdiutil', [
  'create',
  '-volname', '社区AI管理系统',
  '-srcfolder', stagingDirectory,
  '-ov',
  '-format', 'UDZO',
  outputPath,
]);
await makeTreeWritable(stagingDirectory);
await rm(stagingDirectory, { recursive: true, force: true });

const digest = crypto.createHash('sha256').update(await readFile(outputPath)).digest('hex');
console.log(JSON.stringify({ outputPath, sha256: digest }, null, 2));
