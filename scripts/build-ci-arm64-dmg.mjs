#!/usr/bin/env node

import crypto from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appProject = path.join(projectRoot, 'app');
const releaseDirectory = path.join(appProject, 'release');
const stagingDirectory = path.join(appProject, '.ci-dmg-root');
const packageManifest = JSON.parse(await readFile(path.join(appProject, 'package.json'), 'utf8'));
const version = packageManifest.version;
const applicationIdentifier = 'com.community.ai.management';
const signingRequirement = `designated => identifier "${applicationIdentifier}"`;
const verificationRequirement = `identifier "${applicationIdentifier}"`;
const dmgPath = path.join(releaseDirectory, `社区AI管理系统-${version}-arm64.dmg`);
const zipPath = path.join(releaseDirectory, `community-ai-management-system-${version}-arm64.zip`);
const latestPath = path.join(releaseDirectory, 'latest-mac.yml');
const updateConfig = [
  'provider: github',
  'owner: xuefen1990',
  'repo: community-ai-management-system-releases',
  'updaterCacheDirName: community-ai-management-system-updater',
  '',
].join('\n');

function run(command, argumentsList, { cwd = projectRoot, env } = {}) {
  const result = spawnSync(command, argumentsList, { cwd, env, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} 执行失败（退出码 ${result.status}）`);
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

async function findBuiltApplication() {
  const outputDirectory = path.join(releaseDirectory, 'mac-arm64');
  const names = await readdir(outputDirectory);
  const applicationName = names.find((name) => name.endsWith('.app'));
  if (!applicationName) throw new Error(`CI 打包未生成 macOS 应用：${outputDirectory}`);
  return path.join(outputDirectory, applicationName);
}

await mkdir(releaseDirectory, { recursive: true });
await Promise.all([
  rm(dmgPath, { force: true }),
  rm(zipPath, { force: true }),
  rm(latestPath, { force: true }),
  rm(stagingDirectory, { recursive: true, force: true }),
]);

// The existing local builder starts with an installed original application.
// CI instead builds the committed Electron source in a clean runner.
run('npx', ['--no-install', 'electron-builder', '--mac', 'dir', '--arm64', '--publish', 'never'], {
  cwd: appProject,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});

const runtimeApp = await findBuiltApplication();
await writeFile(path.join(runtimeApp, 'Contents', 'Resources', 'app-update.yml'), updateConfig, 'utf8');
run('xattr', ['-cr', runtimeApp]);
run('codesign', ['--force', '--deep', '--sign', '-', runtimeApp]);
run('codesign', ['--force', '--sign', '-', `-r=${signingRequirement}`, runtimeApp]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', runtimeApp]);
run('codesign', ['--verify', `-R=${verificationRequirement}`, runtimeApp]);

await mkdir(stagingDirectory, { recursive: true });
const stagedApplicationPath = path.join(stagingDirectory, path.basename(runtimeApp));
await cp(runtimeApp, stagedApplicationPath, {
  recursive: true,
  preserveTimestamps: true,
  verbatimSymlinks: true,
});
await symlink('/Applications', path.join(stagingDirectory, 'Applications'));
try {
  run('hdiutil', ['create', '-volname', '社区AI管理系统', '-srcfolder', stagingDirectory, '-ov', '-format', 'UDZO', dmgPath]);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', runtimeApp, zipPath]);

const installerDigest = crypto.createHash('sha256').update(await readFile(dmgPath)).digest('hex');
const zipBuffer = await readFile(zipPath);
const zipSha512 = crypto.createHash('sha512').update(zipBuffer).digest('base64');
await writeFile(latestPath, [
  `version: ${version}`,
  'files:',
  `  - url: ${path.basename(zipPath)}`,
  `    sha512: ${zipSha512}`,
  `    size: ${zipBuffer.length}`,
  `path: ${path.basename(zipPath)}`,
  `sha512: ${zipSha512}`,
  `releaseDate: ${new Date().toISOString()}`,
  '',
].join('\n'), 'utf8');

console.log(JSON.stringify({ dmgPath, zipPath, latestPath, sha256: installerDigest }, null, 2));
