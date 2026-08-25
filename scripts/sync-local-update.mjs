#!/usr/bin/env node

import { openAsBlob } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appRoot = path.join(projectRoot, 'app');
const manifest = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const version = process.argv[2] || manifest.version;
const tag = `v${version}`;
const zipName = `community-ai-management-system-${version}-arm64.zip`;
const notesPath = path.join(projectRoot, 'docs', 'releases', `${version}.md`);
const repository = 'xuefen1990/community-ai-management-system-releases';
const backendUrl = normalizeBackendUrl(process.env.COMMUNITY_AI_BACKEND_URL || 'http://127.0.0.1:3000');
const adminPhone = process.env.COMMUNITY_AI_BACKEND_ADMIN_PHONE;
const adminPassword = process.env.COMMUNITY_AI_BACKEND_ADMIN_PASSWORD;

function normalizeBackendUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('本机账号服务器地址必须以 http:// 或 https:// 开头');
  return url.toString().replace(/\/$/u, '');
}

function run(command, args, { capture = false, cwd = projectRoot } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout).trim() : '';
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

function requireAdminCredentials() {
  const missing = [
    ['COMMUNITY_AI_BACKEND_ADMIN_PHONE', adminPhone],
    ['COMMUNITY_AI_BACKEND_ADMIN_PASSWORD', adminPassword],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`缺少本机同步配置：${missing.join('、')}`);
}

async function getLatestVersion() {
  const response = await fetch(new URL('/api/update/check?version=0.0.0&platform=darwin-arm64&channel=stable', backendUrl));
  if (!response.ok) throw new Error(`本机更新服务校验失败（${response.status}）`);
  return response.json();
}

async function login() {
  const response = await fetch(new URL('/api/auth/login', backendUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: adminPhone, password: adminPassword }),
  });
  if (!response.ok) throw new Error(`本机管理员登录失败（${response.status}）`);
  const payload = await response.json();
  if (!payload.token) throw new Error('本机管理员登录未返回访问令牌');
  return payload.token;
}

async function publish({ zipPath, releaseNotes, githubReleaseUrl, token }) {
  const form = new FormData();
  form.set('version', version);
  form.set('platform', 'darwin-arm64');
  form.set('channel', 'stable');
  form.set('releaseNotes', releaseNotes);
  form.set('githubReleaseUrl', githubReleaseUrl);
  form.set('packageType', 'zip');
  form.set('file', await openAsBlob(zipPath, { type: 'application/zip' }), zipName);

  const response = await fetch(new URL('/api/update/publish', backendUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (response.status !== 201) {
    const message = await response.text();
    throw new Error(`本机更新包上传失败（${response.status}）：${message.slice(0, 200)}`);
  }
}

requireAdminCredentials();
await requireFile(notesPath, '发行说明');
const existing = await getLatestVersion();
if (existing.latestVersion === version) {
  console.log(JSON.stringify({ version, backendUrl, latestVersion: version, alreadySynced: true }, null, 2));
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'community-ai-update-'));
try {
  run('gh', ['release', 'download', tag, '--pattern', zipName, '--dir', temporaryDirectory, '--repo', repository]);
  const githubReleaseUrl = run('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url', '--repo', repository], { capture: true });
  const token = await login();
  await publish({
    zipPath: path.join(temporaryDirectory, zipName),
    releaseNotes: (await readFile(notesPath, 'utf8')).trim(),
    githubReleaseUrl,
    token,
  });
  const verified = await getLatestVersion();
  if (verified.latestVersion !== version) throw new Error(`本机更新记录校验失败：期望 ${version}，实际 ${verified.latestVersion || '无'}`);
  console.log(JSON.stringify({ version, backendUrl, latestVersion: verified.latestVersion, githubReleaseUrl, alreadySynced: false }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
