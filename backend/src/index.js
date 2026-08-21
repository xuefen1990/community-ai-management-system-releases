'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');

require('./database');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const updateRoutes = require('./routes/updateRoutes');
const aiRoutes = require('./routes/aiRoutes');

const { standard } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
  origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};
app.use(cors(corsOptions));

app.use(standard);

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/update', updateRoutes);
app.use('/api/ai', aiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info(`后端服务已启动`, {
    port: config.port,
    env: config.nodeEnv,
    pid: process.pid,
  });
  console.log('');
  console.log('========================================');
  console.log('  村居AI管理系统 - 后端服务');
  console.log('========================================');
  console.log(`  端口:    ${config.port}`);
  console.log(`  环境:    ${config.nodeEnv}`);
  console.log(`  健康检查: http://localhost:${config.port}/api/health`);
  console.log(`  API 基础: http://localhost:${config.port}/api`);
  console.log('========================================');
  console.log('');
});

function gracefulShutdown(signal) {
  logger.info(`收到 ${signal} 信号，正在关闭服务器...`);
  server.close(() => {
    const db = require('./database');
    db.flushNow();
    logger.info('服务器已关闭');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('强制关闭超时，进程退出');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('未捕获异常', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', { reason: reason && reason.message ? reason.message : String(reason) });
});

module.exports = app;
