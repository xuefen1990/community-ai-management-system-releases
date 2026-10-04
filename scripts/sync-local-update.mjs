#!/usr/bin/env node

import { openAsBlob } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appRoot = path.join(projectRoot, 'app');
const manifest = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const version = process.argv[2] || manifest.version;
const platform = process.argv[3] || 'darwin-arm64';
if (!['darwin-arm64', 'win32-x64'].includes(platform)) throw new Error(`不支持的更新平台：${platform}`);
const packageType = platform === 'win32-x64' ? 'exe' : 'zip';
const packageName = platform === 'win32-x64'
  ? `community-ai-management-system-${version}-win-x64.exe`
  : `community-ai-management-system-${version}-arm64.zip`;
const packagePath = path.join(appRoot, 'release', platform === 'win32-x64' ? 'win-x64' : '', packageName);
const blockMapPath = `${packagePath}.blockmap`;
const notesPath = path.join(projectRoot, 'docs', 'releases', `${version}.md`);
const backendUrl = normalizeBackendUrl(process.env.COMMUNITY_AI_BACKEND_URL || 'https://xuefeng0901.cn');
const keychainService = 'community-ai-management-system-local-update';
const keychainAccount = 'release-publisher';
const keychainCredentials = readKeychainCredentials();
// 兼容独立更新配置与本机后端现有的管理员配置，均不把凭据写入脚本。
const adminPhone = process.env.COMMUNITY_AI_BACKEND_ADMIN_PHONE || process.env.ADMIN_PHONE || keychainCredentials.phone;
const adminPassword = process.env.COMMUNITY_AI_BACKEND_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || keychainCredentials.password;

function readKeychainCredentials() {
  if (process.platform !== 'darwin') return {};
  const result = spawnSync('security', ['find-generic-password', '-s', keychainService, '-a', keychainAccount, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0 || !result.stdout) return {};
  try {
    const value = JSON.parse(result.stdout.trim());
    return { phone: String(value.phone || '').trim(), password: String(value.password || '') };
  } catch {
    return {};
  }
}

function normalizeBackendUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('本机账号服务器地址必须以 http:// 或 https:// 开头');
  return url.toString().replace(/\/$/u, '');
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
    ['管理员手机号', adminPhone],
    ['管理员密码', adminPassword],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`缺少本机同步配置：${missing.join('、')}`);
}

async function getLatestVersion() {
  const url = new URL('/api/update/check', backendUrl);
  url.searchParams.set('version', '0.0.0');
  url.searchParams.set('platform', platform);
  url.searchParams.set('channel', 'stable');
  const response = await fetch(url);
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

async function publish({ releaseNotes, token }) {
  const form = new FormData();
  form.set('version', version);
  form.set('platform', platform);
  form.set('channel', 'stable');
  form.set('releaseNotes', releaseNotes);
  // 更新服务直接托管安装包；不依赖也不触发 GitHub Release。
  form.set('githubReleaseUrl', '');
  form.set('packageType', packageType);
  form.set('file', await openAsBlob(packagePath, { type: platform === 'win32-x64' ? 'application/octet-stream' : 'application/zip' }), packageName);
  if (platform === 'win32-x64') {
    form.set('blockmap', await openAsBlob(blockMapPath, { type: 'application/octet-stream' }), `${packageName}.blockmap`);
  }

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
await requireFile(packagePath, '应用内更新安装包');
if (platform === 'win32-x64') await requireFile(blockMapPath, 'Windows 差分更新块索引');
const existing = await getLatestVersion();
if (existing.latestVersion === version) {
  console.log(JSON.stringify({ version, platform, backendUrl, latestVersion: version, alreadySynced: true }, null, 2));
  process.exit(0);
}

const token = await login();
await publish({ releaseNotes: (await readFile(notesPath, 'utf8')).trim(), token });
const verified = await getLatestVersion();
if (verified.latestVersion !== version) throw new Error(`本机更新记录校验失败：期望 ${version}，实际 ${verified.latestVersion || '无'}`);
console.log(JSON.stringify({ version, platform, backendUrl, latestVersion: verified.latestVersion, alreadySynced: false }, null, 2));
