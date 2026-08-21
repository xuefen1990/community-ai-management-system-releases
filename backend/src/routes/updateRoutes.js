'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
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

// ===== 下载更新文件 =====
router.get('/download/:id', (req, res, next) => {
  try {
    const fileInfo = updateService.getFilePath(req.params.id);
    if (!fileInfo) {
      throw new ApiError(404, '更新文件不存在或已下架');
    }
    updateService.incrementDownloadCount(req.params.id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.fileName)}"`);
    res.setHeader('Content-Length', fileInfo.fileSize);
    const stream = fs.createReadStream(fileInfo.fullPath);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
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
      const dir = path.resolve(config.updateFilesDir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

router.post('/publish', authRequired, adminRequired, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, '请上传更新文件');
    const { version, platform, channel, releaseNotes } = req.body;
    const version_record = updateService.publishVersion({
      version,
      platform: platform || 'darwin-arm64',
      channel: channel || 'stable',
      releaseNotes,
      fileName: req.file.originalname,
      filePath: req.file.path,
    });
    res.status(201).json({ version: version_record });
  } catch (err) { next(err); }
});

// ===== 停用版本（管理员）=====
router.delete('/versions/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const result = updateService.deactivateVersion(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
