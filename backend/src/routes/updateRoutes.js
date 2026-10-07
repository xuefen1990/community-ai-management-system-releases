'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const updateService = require('../services/updateService');
const { authRequired, adminRequired } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

// ===== 检查更新（无需认证，客户端启动时调用）=====
router.get('/check', (req, res, next) => {
  try {
    const currentVersion = req.query.version || req.query.currentVersion || '0.0.0';
    const platform = req.query.platform || 'darwin-arm64';
    const channel = req.query.channel || 'stable';
    const result = updateService.checkUpdate({ currentVersion, platform, channel });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/electron/latest-mac.yml', (req, res, next) => {
  try {
    const manifest = updateService.getElectronManifest('darwin-arm64', req.query.channel);
    if (!manifest) throw new ApiError(404, '暂无可用于应用内更新的版本');
    res.type('text/yaml').send(manifest);
  } catch (err) { next(err); }
});

router.get('/electron/latest.yml', (req, res, next) => {
  try {
    const manifest = updateService.getElectronManifest('win32-x64', req.query.channel);
    if (!manifest) throw new ApiError(404, '暂无可用于应用内更新的版本');
    res.type('text/yaml').send(manifest);
  } catch (err) { next(err); }
});

// ===== 下载更新文件 =====
function parseRanges(header, size) {
  if (!header) return null;
  if (!header.startsWith('bytes=')) return [];
  const parts = header.slice(6).split(',');
  if (parts.length > 1024) return [];
  const ranges = [];
  for (const part of parts) {
    const match = part.trim().match(/^(\d*)-(\d*)$/u);
    if (!match || (!match[1] && !match[2])) return [];
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return [];
    ranges.push({ start, end });
  }
  return ranges;
}

async function writeRange(response, filePath, start, end) {
  for await (const chunk of fs.createReadStream(filePath, { start, end })) {
    if (response.destroyed) return;
    if (!response.write(chunk)) {
      await new Promise((resolve, reject) => {
        const drained = () => { response.off('close', closed); resolve(); };
        const closed = () => { response.off('drain', drained); reject(new Error('下载连接已关闭')); };
        response.once('drain', drained);
        response.once('close', closed);
      });
    }
  }
}

router.get('/download/:id/:fileName?', (req, res, next) => {
  try {
    const isBlockMap = /\.(?:exe|zip)\.blockmap$/u.test(req.params.fileName || '');
    const fileInfo = isBlockMap
      ? updateService.getBlockMapPath(req.params.id, req.params.fileName)
      : updateService.getFilePath(req.params.id);
    if (!fileInfo) {
      throw new ApiError(404, '更新文件不存在或已下架');
    }
    if (!isBlockMap && !req.headers.range) updateService.incrementDownloadCount(req.params.id);
    const ranges = parseRanges(req.headers.range, fileInfo.fileSize);
    if (ranges?.length === 0) {
      res.setHeader('Content-Range', `bytes */${fileInfo.fileSize}`);
      return res.status(416).end();
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.fileName)}"`);
    if (!ranges) {
      res.setHeader('Content-Length', fileInfo.fileSize);
      const stream = fs.createReadStream(fileInfo.fullPath);
      stream.on('error', error => res.destroy(error));
      return stream.pipe(res);
    }
    if (ranges.length === 1) {
      const { start, end } = ranges[0];
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileInfo.fileSize}`);
      res.setHeader('Content-Length', end - start + 1);
      const stream = fs.createReadStream(fileInfo.fullPath, { start, end });
      stream.on('error', error => res.destroy(error));
      return stream.pipe(res);
    }
    const boundary = `community-update-${crypto.randomBytes(12).toString('hex')}`;
    res.status(206);
    res.setHeader('Content-Type', `multipart/byteranges; boundary=${boundary}`);
    (async () => {
      for (const { start, end } of ranges) {
        res.write(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${start}-${end}/${fileInfo.fileSize}\r\n\r\n`);
        await writeRange(res, fileInfo.fullPath, start, end);
        res.write('\r\n');
      }
      res.end(`--${boundary}--\r\n`);
    })().catch(error => res.destroy(error));
  } catch (err) { next(err); }
});

// ===== 版本列表（管理员）=====
router.get('/versions', authRequired, adminRequired, (req, res) => {
  const { platform, channel } = req.query;
  res.json({ versions: updateService.listVersions({ platform, channel }) });
});

// ===== 获取最新版本信息 =====
router.get('/latest', (req, res, next) => {
  try {
    const platform = req.query.platform || 'darwin-arm64';
    const channel = req.query.channel || 'stable';
    const version = updateService.getLatestVersion(platform, channel);
    res.json({ version });
  } catch (err) { next(err); }
});

// ===== 发布新版本（管理员）=====
const upload = require('multer')({
  storage: require('multer').diskStorage({
    destination: (req, file, cb) => {
      const config = require('../config');
      const dir = path.join(path.resolve(config.updateFilesDir), '.uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const suffix = path.extname(file.originalname);
      cb(null, `${require('crypto').randomUUID()}${suffix}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.post('/publish', authRequired, adminRequired, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'blockmap', maxCount: 1 }]), async (req, res, next) => {
  try {
    const packageFile = req.files?.file?.[0];
    const blockMapFile = req.files?.blockmap?.[0];
    if (!packageFile) throw new ApiError(400, '请上传更新文件');
    const { version, platform, channel, releaseNotes, githubReleaseUrl, packageType } = req.body;
    const version_record = updateService.publishVersion({
      version,
      platform: platform || 'darwin-arm64',
      channel: channel || 'stable',
      releaseNotes,
      githubReleaseUrl,
      packageType,
      fileName: packageFile.originalname,
      filePath: packageFile.path,
      blockMapPath: blockMapFile?.path,
    });
    res.status(201).json({ version: version_record });
  } catch (err) {
    for (const file of [...(req.files?.file || []), ...(req.files?.blockmap || [])]) {
      if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
    next(err);
  }
});

// ===== 停用版本（管理员）=====
router.delete('/versions/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const result = updateService.deactivateVersion(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
