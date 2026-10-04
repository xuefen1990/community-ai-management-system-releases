#!/usr/bin/env node

import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(projectRoot, 'app');
const outputDirectory = path.join(appRoot, 'release', 'win-x64');
const configPath = path.join(appRoot, 'electron-builder.win.yml');

for (const [file, label] of [
  [path.join(appRoot, 'build', 'icon.ico'), 'Windows 应用图标'],
  [configPath, 'Windows 打包配置'],
  [path.join(projectRoot, 'backend', 'node_modules', 'express', 'package.json'), '后端生产依赖'],
]) {
  try { await access(file); } catch { throw new Error(`${label}缺失：${file}`); }
}

await mkdir(outputDirectory, { recursive: true });
const builderCli = path.join(appRoot, 'node_modules', 'electron-builder', 'cli.js');
const build = spawnSync(process.execPath, [builderCli, '--win', 'nsis', '--x64', '--publish', 'never', '--config', configPath], {
  cwd: appRoot,
  stdio: 'inherit',
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
if (build.status !== 0) throw new Error(`Windows x64 安装包构建失败（退出码 ${build.status}）`);

const updateConfigPath = path.join(outputDirectory, 'win-unpacked', 'resources', 'app-update.yml');
let updateConfig;
try { updateConfig = await readFile(updateConfigPath, 'utf8'); } catch { throw new Error(`Windows 安装包缺少更新源配置：${updateConfigPath}`); }
if (!updateConfig.includes('https://xuefeng0901.cn/api/update/electron/')) {
  throw new Error(`Windows 更新源未指向生产后端：${updateConfigPath}`);
}

const artifacts = (await readdir(outputDirectory)).filter(name => name.endsWith('.exe'));
if (!artifacts.some(name => name.endsWith('-win-x64.exe'))) {
  throw new Error(`构建结束但未找到 Windows x64 安装程序：${outputDirectory}`);
}
for (const installer of artifacts.filter(name => name.endsWith('-win-x64.exe'))) {
  try { await access(path.join(outputDirectory, `${installer}.blockmap`)); }
  catch { throw new Error(`Windows 差分更新块索引缺失：${installer}.blockmap`); }
}
console.log(JSON.stringify({ outputDirectory, installers: artifacts }, null, 2));
