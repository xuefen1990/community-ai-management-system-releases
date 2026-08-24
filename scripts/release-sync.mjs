#!/usr/bin/env node

import { openAsBlob } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appRoot = path.join(projectRoot, 'app');
const manifest = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const version = manifest.version;
const tag = `v${version}`;
const releaseDirectory = path.join(appRoot, 'release');
const dmgPath = path.join(releaseDirectory, `社区AI管理系统-${version}-arm64.dmg`);
const zipPath = path.join(releaseDirectory, `community-ai-management-system-${version}-arm64.zip`);
const latestPath = path.join(releaseDirectory, 'latest-mac.yml');
const githubInstallerName = `AI.-${version}-arm64.dmg`;
const notesPath = path.join(projectRoot, 'docs', 'releases', `${version}.md`);
const backendUrl = process.env.COMMUNITY_AI_BACKEND_URL;
const adminPhone = process.env.COMMUNITY_AI_BACKEND_ADMIN_PHONE;
const adminPassword = process.env.COMMUNITY_AI_BACKEND_ADMIN_PASSWORD;
const skipBuild = process.argv.includes('--skip-build');
const skipGithub = process.argv.includes('--skip-github');

function run(command, args, { capture = false, cwd = projectRoot } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : '';
    throw new Error(`${command} 执行失败${detail ? `：${detail}` : ''}`);
  }
  return capture ? result.stdout.trim() : '';
}

async function requireFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label}不存在：${filePath}`);
  }
}

function requireEnvironment() {
  const missing = [
    ['COMMUNITY_AI_BACKEND_URL', backendUrl],
    ['COMMUNITY_AI_BACKEND_ADMIN_PHONE', adminPhone],
    ['COMMUNITY_AI_BACKEND_ADMIN_PASSWORD', adminPassword],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`缺少发布配置：${missing.join('、')}`);
}

async function publishToBackend({ releaseNotes, githubReleaseUrl }) {
  const loginResponse = await fetch(new URL('/api/auth/login', backendUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: adminPhone, password: adminPassword }),
  });
  if (!loginResponse.ok) throw new Error(`后端管理员登录失败（${loginResponse.status}）`);
  const login = await loginResponse.json();
  if (!login.token) throw new Error('后端管理员登录未返回访问令牌');

  const form = new FormData();
  form.set('version', version);
  form.set('platform', 'darwin-arm64');
  form.set('channel', 'stable');
  form.set('releaseNotes', releaseNotes);
  form.set('githubReleaseUrl', githubReleaseUrl);
  form.set('packageType', 'zip');
  form.set('file', await openAsBlob(zipPath, { type: 'application/zip' }), path.basename(zipPath));

  const publishResponse = await fetch(new URL('/api/update/publish', backendUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.token}` },
    body: form,
  });
  if (publishResponse.status !== 201) {
    const message = await publishResponse.text();
    throw new Error(`后端安装包上传失败（${publishResponse.status}）：${message.slice(0, 200)}`);
  }

  const verifyResponse = await fetch(new URL('/api/update/check?version=0.0.0&platform=darwin-arm64&channel=stable', backendUrl));
  if (!verifyResponse.ok) throw new Error(`后端版本校验失败（${verifyResponse.status}）`);
  const verified = await verifyResponse.json();
  if (verified.latestVersion !== version || verified.githubReleaseUrl !== githubReleaseUrl) {
    throw new Error('后端版本校验结果与 GitHub 发布不一致');
  }
  return verified;
}

requireEnvironment();
await requireFile(notesPath, '发行说明');
if (!skipBuild) run('npm', ['run', 'build:arm64'], { cwd: appRoot });
await Promise.all([
  requireFile(dmgPath, 'DMG 安装包'),
  requireFile(zipPath, '应用内更新包'),
  requireFile(latestPath, '更新清单'),
]);

const notes = await readFile(notesPath, 'utf8');
const releaseTarget = run('git', ['rev-parse', 'HEAD'], { capture: true });
const assets = [`${dmgPath}#${githubInstallerName}`, zipPath, latestPath];
if (!skipGithub) {
  const releaseExists = spawnSync('gh', ['release', 'view', tag, '--repo', 'xuefen1990/community-ai-management-system-releases'], {
    cwd: projectRoot,
    stdio: 'ignore',
  }).status === 0;
  if (releaseExists) {
    run('gh', ['release', 'upload', tag, ...assets, '--clobber', '--repo', 'xuefen1990/community-ai-management-system-releases']);
    run('gh', ['release', 'edit', tag, '--title', `社区AI管理系统 v${version}`, '--notes-file', notesPath, '--latest', '--repo', 'xuefen1990/community-ai-management-system-releases']);
  } else {
    run('gh', ['release', 'create', tag, ...assets, '--target', releaseTarget, '--title', `社区AI管理系统 v${version}`, '--notes-file', notesPath, '--latest', '--repo', 'xuefen1990/community-ai-management-system-releases']);
  }
}

const githubReleaseUrl = run('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url', '--repo', 'xuefen1990/community-ai-management-system-releases'], { capture: true });
const backendRelease = await publishToBackend({ releaseNotes: notes.trim(), githubReleaseUrl });
const zipStats = await stat(zipPath);
console.log(JSON.stringify({ version, githubReleaseUrl, backendVersion: backendRelease.latestVersion, updateZipBytes: zipStats.size }, null, 2));
