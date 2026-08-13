#!/usr/bin/env node

import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , templateAppArgument, projectAppArgument] = process.argv;

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
    for (const name of await readdir(targetPath)) {
      await makeTreeWritable(path.join(targetPath, name));
    }
  } else {
    await chmod(targetPath, stats.mode | 0o600);
  }
}

if (!templateAppArgument || !projectAppArgument) {
  console.error('Usage: node scripts/prepare-local-runtime.mjs <template.app> <project-app-directory>');
  process.exitCode = 2;
} else {
  const templateApp = path.resolve(templateAppArgument);
  const projectApp = path.resolve(projectAppArgument);
  const runtimeRoot = path.join(projectApp, '.runtime');
  const runtimeApp = path.join(runtimeRoot, '社区AI管理系统.app');
  const resourcesDirectory = path.join(runtimeApp, 'Contents', 'Resources');
  const bundledAsar = path.join(resourcesDirectory, 'app.asar');
  const preservedAsar = path.join(resourcesDirectory, 'app.asar.original');
  const runtimeSource = path.join(resourcesDirectory, 'app');
  const infoPlistPath = path.join(runtimeApp, 'Contents', 'Info.plist');
  const originalExecutable = path.join(runtimeApp, 'Contents', 'MacOS', '村务通管理系统');
  const runtimeExecutable = path.join(runtimeApp, 'Contents', 'MacOS', '社区AI管理系统');

  await makeTreeWritable(runtimeRoot);
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeRoot, { recursive: true });
  await cp(templateApp, runtimeApp, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await rename(bundledAsar, preservedAsar);
  await mkdir(runtimeSource, { recursive: true });
  await cp(path.join(projectApp, 'package.json'), path.join(runtimeSource, 'package.json'));
  await cp(path.join(projectApp, 'src'), path.join(runtimeSource, 'src'), { recursive: true });
  const baselineNodeModules = path.resolve(projectApp, '..', 'source-original', 'app-asar', 'node_modules');
  await cp(baselineNodeModules, path.join(runtimeSource, 'node_modules'), {
    recursive: true,
    preserveTimestamps: true,
  });
  await cp(path.join(projectApp, 'build', 'icon.icns'), path.join(resourcesDirectory, 'icon.icns'));
  await rename(originalExecutable, runtimeExecutable);

  let infoPlist = await readFile(infoPlistPath, 'utf8');
  infoPlist = infoPlist
    .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleDisplayName</key>\n\t<string>社区AI管理系统</string>')
    .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleExecutable</key>\n\t<string>社区AI管理系统</string>')
    .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleIdentifier</key>\n\t<string>com.community.ai.management</string>')
    .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleName</key>\n\t<string>社区AI管理系统</string>')
    .replace(/<key>NSHumanReadableCopyright<\/key>\s*<string>[^<]*<\/string>/u, '<key>NSHumanReadableCopyright</key>\n\t<string>Copyright © 2026 社区AI管理系统</string>');
  await writeFile(infoPlistPath, infoPlist, 'utf8');

  console.log(JSON.stringify({
    runtimeApp,
    executable: runtimeExecutable,
    preservedAsar,
    runtimeSource,
  }, null, 2));
}
