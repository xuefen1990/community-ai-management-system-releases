'use strict';

const path = require('path');
const fs = require('fs');
const db = require('../database');
const { sha256File, sha512FileBase64 } = require('../utils/crypto');
const config = require('../config');
const logger = require('../utils/logger');

const filesDir = path.resolve(config.updateFilesDir);
if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir, { recursive: true });
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function sanitizeVersion(v) {
  if (!v) return null;
  return {
    id: v.id,
    version: v.version,
    platform: v.platform,
    channel: v.channel,
    releaseNotes: v.release_notes,
    fileName: v.file_name,
    fileSize: v.file_size,
    fileHash: v.file_hash,
    fileSha512: v.file_sha512 || null,
    packageType: v.package_type || 'dmg',
    githubReleaseUrl: v.github_release_url || null,
    downloadCount: v.download_count,
    isActive: !!v.is_active,
    createdAt: v.created_at,
  };
}

function checkUpdate({ currentVersion, platform, channel }) {
  platform = platform || 'darwin-arm64';
  channel = channel || 'stable';

  const versions = db.findAll('versions', v =>
    v.platform === platform && v.channel === channel && v.is_active === 1
  ).sort((a, b) => compareVersions(b.version, a.version) || (b.created_at || '').localeCompare(a.created_at || ''));

  if (versions.length === 0) {
    return { hasUpdate: false, latestVersion: null, currentVersion, message: '暂无可用版本' };
  }

  const latest = versions[0];
  const hasUpdate = compareVersions(latest.version, currentVersion) > 0;
  const supportsInAppUpdate = latest.package_type === 'zip' && Boolean(latest.file_sha512);

  return {
    hasUpdate: hasUpdate && supportsInAppUpdate,
    hasNewerVersion: hasUpdate,
    latestVersion: latest.version,
    currentVersion,
    platform,
    channel,
    releaseNotes: latest.release_notes,
    downloadUrl: `/api/update/download/${latest.id}`,
    fileName: latest.file_name,
    fileSize: latest.file_size,
    fileHash: latest.file_hash,
    fileSha512: latest.file_sha512 || null,
    packageType: latest.package_type || 'dmg',
    githubReleaseUrl: latest.github_release_url || null,
    publishedAt: latest.created_at,
  };
}

function publishVersion({ version, platform, channel, releaseNotes, fileName, filePath, githubReleaseUrl, packageType }) {
  if (!version || !platform || !fileName || !filePath) {
    const err = new Error('version, platform, fileName, filePath 为必填');
    err.statusCode = 400;
    throw err;
  }

  channel = channel || 'stable';
  packageType = packageType || path.extname(fileName).slice(1).toLowerCase();
  if (!['zip', 'dmg'].includes(packageType)) {
    const err = new Error('应用更新包仅支持 ZIP 或 DMG 文件');
    err.statusCode = 400;
    throw err;
  }

  const duplicate = db.findOne('versions', v =>
    v.version === version && v.platform === platform && v.channel === channel
  );
  if (duplicate) {
    const err = new Error(`版本 ${version}（${platform}/${channel}）已发布`);
    err.statusCode = 409;
    throw err;
  }

  if (!fs.existsSync(filePath)) {
    const err = new Error('文件不存在: ' + filePath);
    err.statusCode = 400;
    throw err;
  }

  const stat = fs.statSync(filePath);
  const hash = sha256File(filePath);
  const sha512 = packageType === 'zip' ? sha512FileBase64(filePath) : '';
  const now = db.now();
  const id = db.genId();

  const destName = `${id}-${fileName}`;
  const destPath = path.join(filesDir, destName);
  try {
    fs.renameSync(filePath, destPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(filePath, destPath);
    fs.unlinkSync(filePath);
  }

  const record = {
    id, version, platform, channel,
    release_notes: releaseNotes || '',
    file_name: destName, file_size: stat.size,
    file_hash: hash, download_count: 0,
    file_sha512: sha512, package_type: packageType,
    github_release_url: githubReleaseUrl || '',
    is_active: 1, created_at: now,
  };

  db.insert('versions', record);
  logger.info('发布新版本', { id, version, platform, channel });

  return sanitizeVersion(record);
}

function getVersionById(id) {
  return sanitizeVersion(db.findById('versions', id));
}

function getLatestVersion(platform, channel) {
  platform = platform || 'darwin-arm64';
  channel = channel || 'stable';
  const versions = db.findAll('versions', v =>
    v.platform === platform && v.channel === channel && v.is_active === 1
  ).sort((a, b) => compareVersions(b.version, a.version) || (b.created_at || '').localeCompare(a.created_at || ''));
  return sanitizeVersion(versions[0] || null);
}

function getLatestInAppVersion(platform, channel) {
  platform = platform || 'darwin-arm64';
  channel = channel || 'stable';
  const versions = db.findAll('versions', v =>
    v.platform === platform && v.channel === channel && v.is_active === 1 && v.package_type === 'zip' && v.file_sha512
  ).sort((a, b) => compareVersions(b.version, a.version) || (b.created_at || '').localeCompare(a.created_at || ''));
  return versions[0] || null;
}

function getElectronManifest(platform, channel) {
  const version = getLatestInAppVersion(platform, channel);
  if (!version) return null;
  return [
    `version: ${version.version}`,
    'files:',
    `  - url: ../download/${version.id}`,
    `    sha512: ${version.file_sha512}`,
    `    size: ${version.file_size}`,
    `path: ../download/${version.id}`,
    `sha512: ${version.file_sha512}`,
    `releaseDate: ${version.created_at}`,
    '',
  ].join('\n');
}

function listVersions({ platform, channel }) {
  let results = db.findAll('versions');
  if (platform) results = results.filter(v => v.platform === platform);
  if (channel) results = results.filter(v => v.channel === channel);
  return results
    .sort((a, b) => compareVersions(b.version, a.version) || (b.created_at || '').localeCompare(a.created_at || ''))
    .map(sanitizeVersion);
}

function deactivateVersion(id) {
  const v = db.findById('versions', id);
  if (!v) {
    const err = new Error('版本不存在');
    err.statusCode = 404;
    throw err;
  }
  db.updateById('versions', id, { is_active: 0 });
  logger.info('停用版本', { id, version: v.version });
  return { success: true };
}

function incrementDownloadCount(id) {
  const v = db.findById('versions', id);
  if (v) {
    db.updateById('versions', id, { download_count: (v.download_count || 0) + 1 });
  }
}

function getFilePath(id) {
  const v = db.findOne('versions', r => r.id === id && r.is_active === 1);
  if (!v) return null;
  const fullPath = path.join(filesDir, v.file_name);
  if (!fs.existsSync(fullPath)) return null;
  return { fullPath, fileName: v.file_name, fileSize: v.file_size };
}

module.exports = {
  checkUpdate,
  publishVersion,
  getVersionById,
  getLatestVersion,
  getElectronManifest,
  listVersions,
  deactivateVersion,
  incrementDownloadCount,
  getFilePath,
  sanitizeVersion,
};
