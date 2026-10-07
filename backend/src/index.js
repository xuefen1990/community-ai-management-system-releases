'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');

function assertStartupConfig() {
  if (!config.jwt.secret || (!config.isDev && !process.env.JWT_SECRET?.trim())) {
    throw new Error('生产环境必须设置 JWT_SECRET；请在后端服务环境变量中配置随机密钥');
  }
  if (!config.admin.password?.trim()) {
    throw new Error('必须设置 ADMIN_PASSWORD；请在后端服务环境变量中配置管理员初始密码');
  }
  if (['admin123456', '123456', 'password'].includes(config.admin.password.toLowerCase())) {
    throw new Error('ADMIN_PASSWORD 过于简单；请使用非默认的强密码');
  }
  if (!config.isDev && (!config.corsOrigins || config.corsOrigins.split(',').some(origin => origin.trim() === '*'))) {
    throw new Error('生产环境必须设置 CORS_ORIGINS，且不能使用通配符 *');
  }
  if (config.isDev && !process.env.JWT_SECRET?.trim()) console.warn('警告：开发环境未设置 JWT_SECRET，已生成仅本次进程有效的随机密钥；切勿用于生产或持久加密数据');
  if (config.isDev && config.corsOrigins === '*') console.warn('警告：开发环境 CORS 允许所有来源；生产环境必须配置明确的来源');
}

assertStartupConfig();

require('./database');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const updateRoutes = require('./routes/updateRoutes');
const aiRoutes = require('./routes/aiRoutes');
const adminAiRoutes = require('./routes/adminAiRoutes');
const adminRoutes = require('./routes/adminRoutes');
const unitWorkspaceRoutes = require('./routes/unitWorkspaceRoutes');
const aiQuotaService = require('./services/aiQuotaService');
const { migrateLegacyAccounts } = require('./services/mainAccountScope');

const { standard } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

const migration = migrateLegacyAccounts();
if (migration.failures.length) logger.error('旧账号主账号归属迁移存在异常', { organizationIds: migration.failures });
// 为历史主账号补建额度；已有余额不会被覆盖。
aiQuotaService.ensureAllOrganizationQuotas();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // HTTPS 入口尚未启用；正式接入 TLS 后再启用该浏览器策略。
      upgradeInsecureRequests: null,
    },
  },
}));
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
app.use('/api/admin/ai', adminAiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/unit/workspace', unitWorkspaceRoutes);
app.get('/', (_req, res) => res.redirect(302, '/admin/'));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  logger.info(`后端服务已启动`, {
    port: config.port,
    host: config.host,
    env: config.nodeEnv,
    pid: process.pid,
  });
  console.log('');
  console.log('========================================');
  console.log('  村居AI管理系统 - 后端服务');
  console.log('========================================');
  console.log(`  端口:    ${config.port}`);
  console.log(`  地址:    ${config.host}`);
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
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', { reason: reason && reason.message ? reason.message : String(reason) });
});

module.exports = app;
