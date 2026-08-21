#!/usr/bin/env node

import crypto from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appProject = path.join(projectRoot, 'app');
const templateApp = '/Applications/村务通管理系统.app';
const runtimeApp = path.join(appProject, '.runtime', '社区AI管理系统.app');
const releaseDirectory = path.join(appProject, 'release');
const packageRootDirectory = path.join(appProject, '.pkg-root');
const packagedApplicationPath = path.join(packageRootDirectory, 'Applications', path.basename(runtimeApp));
const componentPropertiesPath = path.join(projectRoot, 'scripts', 'community-ai-component.plist');
const packageManifest = JSON.parse(await readFile(path.join(appProject, 'package.json'), 'utf8'));
const version = packageManifest.version;
const installerArtifactName = `community-ai-management-system-${version}-arm64.pkg`;
const outputPath = path.join(releaseDirectory, installerArtifactName);
const zipOutputPath = path.join(releaseDirectory, `社区AI管理系统-${version}-arm64.zip`);
const updateArtifactName = `community-ai-management-system-${version}-arm64.zip`;
const updateManifestPath = path.join(releaseDirectory, 'latest-mac.yml');
const embeddedUpdaterConfigPath = path.join(runtimeApp, 'Contents', 'Resources', 'app-update.yml');
const embeddedUpdaterConfig = [
  'provider: github',
  'owner: xuefen1990',
  'repo: community-ai-management-system-releases',
  'updaterCacheDirName: community-ai-management-system-updater',
  '',
].join('\n');

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
await requirePath(componentPropertiesPath, '安装包组件规则');

run(process.execPath, [path.join(projectRoot, 'scripts', 'prepare-local-runtime.mjs'), templateApp, appProject]);
await writeFile(embeddedUpdaterConfigPath, embeddedUpdaterConfig, 'utf8');
run('xattr', ['-cr', runtimeApp]);
run('codesign', ['--force', '--deep', '--sign', '-', runtimeApp]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', runtimeApp]);

await rm(outputPath, { force: true });
await rm(zipOutputPath, { force: true });
await rm(packageRootDirectory, { recursive: true, force: true });
await mkdir(path.dirname(packagedApplicationPath), { recursive: true });
// Electron Framework 内包含相对符号链接。必须原样复制；否则 Node 会将其
// 解析成构建目录的绝对路径，安装后的应用将失去有效签名并无法启动。
await cp(runtimeApp, packagedApplicationPath, {
  recursive: true,
  preserveTimestamps: true,
  verbatimSymlinks: true,
});
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', packagedApplicationPath]);
run('pkgbuild', [
  '--root', packageRootDirectory,
  '--install-location', '/',
  '--component-plist', componentPropertiesPath,
  '--identifier', 'com.community.ai.management',
  '--version', version,
  outputPath,
]);
await rm(packageRootDirectory, { recursive: true, force: true });

run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', runtimeApp, zipOutputPath]);

const installerDigest = crypto.createHash('sha256').update(await readFile(outputPath)).digest('hex');
const zipBuffer = await readFile(zipOutputPath);
const zipSha512 = crypto.createHash('sha512').update(zipBuffer).digest('base64');
const updateManifest = [
  `version: ${version}`,
  'files:',
  `  - url: ${updateArtifactName}`,
  `    sha512: ${zipSha512}`,
  `    size: ${zipBuffer.length}`,
  `path: ${updateArtifactName}`,
  `sha512: ${zipSha512}`,
  `releaseDate: ${new Date().toISOString()}`,
  '',
].join('\n');
await mkdir(releaseDirectory, { recursive: true });
await writeFile(updateManifestPath, updateManifest, 'utf8');
console.log(JSON.stringify({ outputPath, sha256: installerDigest, zipOutputPath, updateManifestPath }, null, 2));
