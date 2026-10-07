'use strict';

const logger = require('../utils/logger');

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `路由不存在: ${req.method} ${req.path}` });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 500);
  const message = err.code === 'LIMIT_FILE_SIZE' ? '更新包超过 500 MB 上限' : err.statusCode ? err.message : '服务器内部错误';

  if (statusCode >= 500) {
    logger.error('未捕获错误', { error: err.message, stack: err.stack, path: req.path });
  }

  res.status(statusCode).json({ error: message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
