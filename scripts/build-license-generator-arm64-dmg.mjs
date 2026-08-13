#!/usr/bin/env node

import crypto from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const generatorRoot = path.join(projectRoot, 'license-generator');
const templateApp = '/Applications/村务通管理系统.app';
const runtimeRoot = path.join(generatorRoot, '.runtime');
const runtimeApp = path.join(runtimeRoot, '社区AI授权工具.app');
const resourcesDirectory = path.join(runtimeApp, 'Contents', 'Resources');
const runtimeSource = path.join(resourcesDirectory, 'app');
const releaseDirectory = path.join(generatorRoot, 'release');
const stagingDirectory = path.join(releaseDirectory, 'dmg-root');
const outputPath = path.join(releaseDirectory, '社区AI授权工具-0.1.0-arm64.dmg');

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

await makeTreeWritable(runtimeRoot);
await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await cp(templateApp, runtimeApp, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });

await rm(path.join(resourcesDirectory, 'app.asar'), { force: true });
await mkdir(runtimeSource, { recursive: true });
await cp(path.join(generatorRoot, 'package.json'), path.join(runtimeSource, 'package.json'));
await cp(path.join(generatorRoot, 'src'), path.join(runtimeSource, 'src'), { recursive: true });
await cp(path.join(generatorRoot, 'private', 'license-private-key.pem'), path.join(resourcesDirectory, 'license-private-key.pem'));
await cp(path.join(projectRoot, 'app', 'build', 'icon.icns'), path.join(resourcesDirectory, 'icon.icns'));

const originalExecutable = path.join(runtimeApp, 'Contents', 'MacOS', '村务通管理系统');
const runtimeExecutable = path.join(runtimeApp, 'Contents', 'MacOS', '社区AI授权工具');
await rename(originalExecutable, runtimeExecutable);
const infoPlistPath = path.join(runtimeApp, 'Contents', 'Info.plist');
let infoPlist = await readFile(infoPlistPath, 'utf8');
infoPlist = infoPlist
  .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleDisplayName</key>\n\t<string>社区AI授权工具</string>')
  .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleExecutable</key>\n\t<string>社区AI授权工具</string>')
  .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleIdentifier</key>\n\t<string>com.community.ai.license-generator</string>')
  .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleName</key>\n\t<string>社区AI授权工具</string>')
  .replace(/<key>NSHumanReadableCopyright<\/key>\s*<string>[^<]*<\/string>/u, '<key>NSHumanReadableCopyright</key>\n\t<string>Copyright © 2026 社区AI授权工具</string>');
await writeFile(infoPlistPath, infoPlist, 'utf8');

run('codesign', ['--force', '--deep', '--sign', '-', runtimeApp]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', runtimeApp]);

await makeTreeWritable(stagingDirectory);
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });
await cp(runtimeApp, path.join(stagingDirectory, '社区AI授权工具.app'), {
  recursive: true,
  preserveTimestamps: true,
  verbatimSymlinks: true,
});
await symlink('/Applications', path.join(stagingDirectory, 'Applications'));
await rm(outputPath, { force: true });
run('hdiutil', ['create', '-volname', '社区AI授权工具', '-srcfolder', stagingDirectory, '-ov', '-format', 'UDZO', outputPath]);
await makeTreeWritable(stagingDirectory);
await rm(stagingDirectory, { recursive: true, force: true });

const digest = crypto.createHash('sha256').update(await readFile(outputPath)).digest('hex');
console.log(JSON.stringify({ outputPath, sha256: digest }, null, 2));
