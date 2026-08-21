require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  admin: {
    phone: process.env.ADMIN_PHONE || '13800000000',
    password: process.env.ADMIN_PASSWORD || 'admin123456',
  },

  dbPath: process.env.DB_PATH || './data/backend.db',

  updateFilesDir: process.env.UPDATE_FILES_DIR || './data/updates',

  ai: {
    defaultBaseUrl: process.env.AI_DEFAULT_BASE_URL || 'https://api.deepseek.com/v1',
    defaultApiKey: process.env.AI_DEFAULT_API_KEY || '',
    defaultModel: process.env.AI_DEFAULT_MODEL || 'deepseek-chat',
  },

  corsOrigins: process.env.CORS_ORIGINS || '*',
};

module.exports = config;
