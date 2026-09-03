'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_AI_SETTINGS = Object.freeze({
  mode: 'local',
  localModelPath: '',
  online: {
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    encryptedApiKey: '',
  },
});

class AiSettingsStore {
  constructor({ userDataPath, safeStorage }) {
    this.directory = path.join(userDataPath, 'settings');
    this.filePath = path.join(this.directory, 'ai.json');
    this.safeStorage = safeStorage;
    // Used only while this process is open when macOS Keychain is unavailable.
    // It is deliberately never written to the settings file.
    this.sessionApiKey = '';
  }

  async readRaw() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      return {
        ...structuredClone(DEFAULT_AI_SETTINGS),
        ...saved,
        online: { ...DEFAULT_AI_SETTINGS.online, ...saved.online },
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return structuredClone(DEFAULT_AI_SETTINGS);
    }
  }

  async getPublicSettings() {
    const settings = await this.readRaw();
    const safeStorageAvailable = Boolean(this.safeStorage?.isEncryptionAvailable());
    const keyStorage = this.sessionApiKey ? 'session'
      : settings.online.encryptedApiKey ? (safeStorageAvailable ? 'secure' : 'unavailable')
        : 'none';
    return {
      mode: settings.mode,
      localModelPath: settings.localModelPath,
      online: {
        baseUrl: settings.online.baseUrl,
        model: settings.online.model,
        hasApiKey: keyStorage === 'secure' || keyStorage === 'session',
        keyStorage,
      },
    };
  }

  async save(input) {
    if (!['local', 'online', 'auto'].includes(input?.mode)) throw new Error('AI 模式无效');
    const current = await this.readRaw();
    const baseUrl = String(input.online?.baseUrl || current.online.baseUrl).replace(/\/+$/u, '');
    if (baseUrl && !/^https?:\/\//u.test(baseUrl)) throw new Error('在线 AI 接口地址必须以 http:// 或 https:// 开头');
    if (baseUrl) {
      const parsedUrl = new URL(baseUrl);
      const localHttp = parsedUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
      if (parsedUrl.protocol !== 'https:' && !localHttp) {
        throw new Error('远程在线 AI 接口必须使用 HTTPS；HTTP 仅允许本机地址');
      }
    }
    const requestedApiKey = String(input.online?.apiKey || '').trim();
    let encryptedApiKey = current.online.encryptedApiKey;
    if (requestedApiKey) {
      if (this.safeStorage?.isEncryptionAvailable()) encryptedApiKey = this.encryptApiKey(requestedApiKey);
      else this.sessionApiKey = requestedApiKey;
    }
    const settings = {
      mode: input.mode,
      localModelPath: String(input.localModelPath || ''),
      online: {
        baseUrl,
        model: String(input.online?.model || ''),
        encryptedApiKey,
      },
    };
    await fs.mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
    return this.getPublicSettings();
  }

  encryptApiKey(apiKey) {
    if (!this.safeStorage?.isEncryptionAvailable()) {
      throw new Error('macOS 安全存储当前不可用，无法保存 API 密钥');
    }
    return this.safeStorage.encryptString(String(apiKey)).toString('base64');
  }

  async getOnlineCredentials() {
    const settings = await this.readRaw();
    if (this.sessionApiKey) return { ...settings.online, apiKey: this.sessionApiKey, credentialStatus: 'session' };
    if (!settings.online.encryptedApiKey) return { ...settings.online, apiKey: '' };
    if (!this.safeStorage?.isEncryptionAvailable()) {
      return { ...settings.online, apiKey: '', credentialStatus: 'secure-storage-unavailable' };
    }
    return {
      baseUrl: settings.online.baseUrl,
      model: settings.online.model,
      apiKey: this.safeStorage.decryptString(Buffer.from(settings.online.encryptedApiKey, 'base64')),
    };
  }
}

module.exports = { AiSettingsStore, DEFAULT_AI_SETTINGS };
