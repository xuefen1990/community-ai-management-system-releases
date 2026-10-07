'use strict';

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const db = require('../database');
const { sha256File, sha512FileBase64 } = require('../utils/crypto');
const config = require('../config');
const logger = require('../utils/logger');

const filesDir = path.resolve(config.updateFilesDir);
const inAppPackageTypes = Object.freeze({ 'darwin-arm64': 'zip', 'win32-x64': 'exe' });
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
  const supportsInAppUpdate = latest.package_type === inAppPackageTypes[platform] && Boolean(latest.file_sha512);

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

function publishVersion({ version, platform, channel, releaseNotes, fileName, filePath, blockMapPath, githubReleaseUrl, packageType }) {
  if (!version || !platform || !fileName || !filePath) {
    const err = new Error('version, platform, fileName, filePath 为必填');
    err.statusCode = 400;
    throw err;
  }

  channel = channel || 'stable';
  packageType = packageType || path.extname(fileName).slice(1).toLowerCase();
  if (!['zip', 'dmg', 'exe'].includes(packageType)) {
    const err = new Error('应用更新包仅支持 ZIP、DMG 或 EXE 文件');
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
  if (blockMapPath) {
    if (!((platform === 'win32-x64' && packageType === 'exe') || (platform === 'darwin-arm64' && packageType === 'zip'))) {
      const err = new Error('块索引仅适用于 Windows EXE 或 Mac ZIP 更新包');
      err.statusCode = 400;
      throw err;
    }
    try {
      const blockMap = JSON.parse(zlib.gunzipSync(fs.readFileSync(blockMapPath)).toString('utf8'));
      if (!Array.isArray(blockMap.files) || !blockMap.files.length) throw new Error('缺少文件块');
    } catch {
      const err = new Error('更新块索引无效');
      err.statusCode = 400;
      throw err;
    }
  }
  const hash = sha256File(filePath);
  const sha512 = ['zip', 'exe'].includes(packageType) ? sha512FileBase64(filePath) : '';
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

  if (blockMapPath) {
    try {
      fs.renameSync(blockMapPath, `${destPath}.blockmap`);
    } catch (error) {
      try {
        if (error.code !== 'EXDEV') throw error;
        fs.copyFileSync(blockMapPath, `${destPath}.blockmap`);
        fs.unlinkSync(blockMapPath);
      } catch (moveError) {
        fs.rmSync(`${destPath}.blockmap`, { force: true });
        fs.rmSync(destPath, { force: true });
        throw moveError;
      }
    }
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
    v.platform === platform && v.channel === channel && v.is_active === 1
      && v.package_type === inAppPackageTypes[platform] && v.file_sha512
  ).sort((a, b) => compareVersions(b.version, a.version) || (b.created_at || '').localeCompare(a.created_at || ''));
  return versions[0] || null;
}

function getElectronManifest(platform, channel) {
  const version = getLatestInAppVersion(platform, channel);
  if (!version) return null;
  // electron-updater uses the final path segment as its cached download name.
  // Keep the real package name in the manifest so it never tries to create a file
  // whose name is only the update record ID.
  const downloadPath = `../download/${encodeURIComponent(version.id)}/${encodeURIComponent(version.file_name)}`;
  const manifest = [
    `version: ${version.version}`,
    'files:',
    `  - url: ${downloadPath}`,
    `    sha512: ${version.file_sha512}`,
    `    size: ${version.file_size}`,
    `path: ${downloadPath}`,
    `sha512: ${version.file_sha512}`,
  ];
  if (platform === 'win32-x64') manifest.push('sha2: ' + version.file_hash);
  return [
    ...manifest,
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

function getBlockMapPath(id, requestedFileName) {
  const source = db.findOne('versions', record => record.id === id && record.is_active === 1);
  if (!source || !['win32-x64', 'darwin-arm64'].includes(source.platform)) return null;
  const pattern = source.platform === 'win32-x64' ? /-(\d+\.\d+\.\d+)-win-x64\.exe\.blockmap$/u : /-(\d+\.\d+\.\d+)-arm64\.zip\.blockmap$/u;
  const match = String(requestedFileName || '').match(pattern);
  if (!match) return null;
  const version = db.findOne('versions', record => record.version === match[1]
    && record.platform === source.platform && record.channel === source.channel
    && record.package_type === (source.platform === 'win32-x64' ? 'exe' : 'zip') && record.is_active === 1);
  if (!version) return null;
  const fullPath = path.join(filesDir, `${version.file_name}.blockmap`);
  if (!fs.existsSync(fullPath)) return null;
  const stat = fs.statSync(fullPath);
  return { fullPath, fileName: `${version.file_name}.blockmap`, fileSize: stat.size };
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
  getBlockMapPath,
  sanitizeVersion,
};
