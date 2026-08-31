#!/usr/bin/env node

import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [, , templateAppArgument, projectAppArgument] = process.argv;

function copyApplicationTemplate(sourcePath, destinationPath) {
  const result = spawnSync('cp', ['-R', sourcePath, destinationPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`无法复制应用模板：${result.stderr || result.stdout || 'cp 执行失败'}`);
  }
}

async function requireRuntimeFile(targetPath, label) {
  try {
    const stats = await lstat(targetPath);
    if (!stats.isFile()) throw new Error(`${label}不是文件：${targetPath}`);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label}不存在：${targetPath}`);
    throw error;
  }
}

function verifyBundledBackend(backendRoot) {
  const result = spawnSync(process.execPath, [
    '-e',
    "require('iconv-lite/encodings'); require('body-parser'); require('express');",
  ], {
    cwd: backendRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`内置后端依赖无法加载：${result.stderr || result.stdout || '模块检查失败'}`);
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
  const backendSource = path.resolve(projectApp, '..', 'backend');
  const backendRuntime = path.join(resourcesDirectory, 'backend');
  const infoPlistPath = path.join(runtimeApp, 'Contents', 'Info.plist');
  const packageManifest = JSON.parse(await readFile(path.join(projectApp, 'package.json'), 'utf8'));
  const appVersion = packageManifest.version;
  const originalExecutable = path.join(runtimeApp, 'Contents', 'MacOS', '村务通管理系统');
  const runtimeExecutable = path.join(runtimeApp, 'Contents', 'MacOS', '社区AI管理系统');

  await makeTreeWritable(runtimeRoot);
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeRoot, { recursive: true });
  // Node 的 cp 在此机器上会保留模板的 root 所有权，随后构建无法修改副本。
  // 使用系统 cp 生成当前用户可写的运行副本。
  copyApplicationTemplate(templateApp, runtimeApp);
  await makeTreeWritable(runtimeApp);
  await rename(bundledAsar, preservedAsar);
  await mkdir(runtimeSource, { recursive: true });
  await cp(path.join(projectApp, 'package.json'), path.join(runtimeSource, 'package.json'));
  await cp(path.join(projectApp, 'src'), path.join(runtimeSource, 'src'), { recursive: true });
  await mkdir(backendRuntime, { recursive: true });
  await cp(path.join(backendSource, 'package.json'), path.join(backendRuntime, 'package.json'));
  await cp(path.join(backendSource, 'src'), path.join(backendRuntime, 'src'), { recursive: true });
  await cp(path.join(backendSource, 'node_modules'), path.join(backendRuntime, 'node_modules'), {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  // 登录时 body-parser 会通过 iconv-lite 加载编码表；缺少该目录会导致登录服务直接启动失败。
  await requireRuntimeFile(
    path.join(backendRuntime, 'node_modules', 'iconv-lite', 'encodings', 'index.js'),
    '登录所需的 iconv-lite 编码模块',
  );
  verifyBundledBackend(backendRuntime);
  const baselineNodeModules = path.resolve(projectApp, '..', 'source-original', 'app-asar', 'node_modules');
  await cp(baselineNodeModules, path.join(runtimeSource, 'node_modules'), {
    recursive: true,
    preserveTimestamps: true,
  });
  await makeTreeWritable(path.join(runtimeSource, 'node_modules'));
  const updateRuntimeDependencies = [
    'electron-updater',
    'builder-util-runtime',
    'fs-extra',
    'js-yaml',
    'lazy-val',
    'lodash.escaperegexp',
    'lodash.isequal',
    'semver',
    'tiny-typed-emitter',
    'graceful-fs',
    'jsonfile',
    'universalify',
    'argparse',
    'debug',
    'ms',
    'sax',
  ];
  for (const dependency of updateRuntimeDependencies) {
    await cp(
      path.join(projectApp, 'node_modules', dependency),
      path.join(runtimeSource, 'node_modules', dependency),
      { recursive: true, preserveTimestamps: true, verbatimSymlinks: true },
    );
  }
  await cp(path.join(projectApp, 'build', 'icon.icns'), path.join(resourcesDirectory, 'icon.icns'));
  await rename(originalExecutable, runtimeExecutable);

  const frameworksDirectory = path.join(runtimeApp, 'Contents', 'Frameworks');
  const helperVariants = [
    { suffix: '', identifierSuffix: '' },
    { suffix: ' (GPU)', identifierSuffix: '.GPU' },
    { suffix: ' (Plugin)', identifierSuffix: '.Plugin' },
    { suffix: ' (Renderer)', identifierSuffix: '.Renderer' },
  ];
  for (const { suffix, identifierSuffix } of helperVariants) {
    const originalHelperName = `村务通管理系统 Helper${suffix}`;
    const runtimeHelperName = `社区AI管理系统 Helper${suffix}`;
    const originalHelperApp = path.join(frameworksDirectory, `${originalHelperName}.app`);
    const runtimeHelperApp = path.join(frameworksDirectory, `${runtimeHelperName}.app`);
    await rename(originalHelperApp, runtimeHelperApp);

    const helperMacOsDirectory = path.join(runtimeHelperApp, 'Contents', 'MacOS');
    await rename(
      path.join(helperMacOsDirectory, originalHelperName),
      path.join(helperMacOsDirectory, runtimeHelperName),
    );

    const helperInfoPlistPath = path.join(runtimeHelperApp, 'Contents', 'Info.plist');
    let helperInfoPlist = await readFile(helperInfoPlistPath, 'utf8');
    helperInfoPlist = helperInfoPlist
      .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleDisplayName</key>\n\t<string>${runtimeHelperName}</string>`)
      .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleExecutable</key>\n\t<string>${runtimeHelperName}</string>`)
      .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleIdentifier</key>\n\t<string>com.community.ai.management.helper${identifierSuffix}</string>`)
      .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleName</key>\n\t<string>${runtimeHelperName}</string>`);
    await writeFile(helperInfoPlistPath, helperInfoPlist, 'utf8');
  }

  let infoPlist = await readFile(infoPlistPath, 'utf8');
  infoPlist = infoPlist
    .replace(/\s*<key>ElectronAsarIntegrity<\/key>\s*<dict>\s*<key>Resources\/app\.asar<\/key>\s*<dict>[\s\S]*?<\/dict>\s*<\/dict>/u, '')
    .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleDisplayName</key>\n\t<string>社区AI管理系统</string>')
    .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleExecutable</key>\n\t<string>社区AI管理系统</string>')
    .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleIdentifier</key>\n\t<string>com.community.ai.management</string>')
    .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/u, '<key>CFBundleName</key>\n\t<string>社区AI管理系统</string>')
    .replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleShortVersionString</key>\n\t<string>${appVersion}</string>`)
    .replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/u, `<key>CFBundleVersion</key>\n\t<string>${appVersion}</string>`)
    .replace(/<key>NSHumanReadableCopyright<\/key>\s*<string>[^<]*<\/string>/u, '<key>NSHumanReadableCopyright</key>\n\t<string>Copyright © 2026 社区AI管理系统</string>');
  await writeFile(infoPlistPath, infoPlist, 'utf8');
  await makeTreeWritable(runtimeApp);

  console.log(JSON.stringify({
    runtimeApp,
    executable: runtimeExecutable,
    preservedAsar,
    runtimeSource,
  }, null, 2));
}
