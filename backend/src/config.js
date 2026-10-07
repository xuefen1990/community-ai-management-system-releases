require('dotenv').config();
const crypto = require('node:crypto');

const isDev = (process.env.NODE_ENV || 'development') !== 'production';
const configuredJwtSecret = process.env.JWT_SECRET?.trim();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev,

  jwt: {
    secret: configuredJwtSecret || (isDev ? crypto.randomBytes(32).toString('hex') : undefined),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  admin: {
    phone: process.env.ADMIN_PHONE || '13800000000',
    password: process.env.ADMIN_PASSWORD,
  },

  dbPath: process.env.DB_PATH || './data/backend.db',

  updateFilesDir: process.env.UPDATE_FILES_DIR || './data/updates',

  ai: {
    defaultBaseUrl: process.env.AI_DEFAULT_BASE_URL || 'https://api.deepseek.com',
    defaultApiKey: process.env.AI_DEFAULT_API_KEY || '',
    defaultModel: process.env.AI_DEFAULT_MODEL || 'deepseek-v4-flash',
    defaultQuotaTokens: parseInt(process.env.AI_DEFAULT_QUOTA_TOKENS || '1000000', 10),
  },

  corsOrigins: process.env.CORS_ORIGINS?.trim() || (isDev ? '*' : ''),
};

module.exports = config;
