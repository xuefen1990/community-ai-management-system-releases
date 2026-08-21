'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class RememberedLoginStore {
  constructor({ userDataPath, safeStorage }) {
    this.directory = path.join(userDataPath, 'license');
    this.filePath = path.join(this.directory, 'remembered-login.json');
    this.safeStorage = safeStorage;
  }

  async save({ phone, password }) {
    if (!this.safeStorage?.isEncryptionAvailable()) {
      return { saved: false, warning: 'macOS 安全存储不可用，已跳过保存密码' };
    }
    const payload = {
      phone: String(phone || ''),
      encryptedPassword: this.safeStorage.encryptString(String(password || '')).toString('base64'),
    };
    await fs.mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
    return { saved: true, warning: '' };
  }

  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!value?.phone || !value.encryptedPassword) return { phone: '', password: '', warning: '' };
      if (!this.safeStorage?.isEncryptionAvailable()) {
        return { phone: value.phone, password: '', warning: 'macOS 安全存储不可用，请手动输入密码' };
      }
      return {
        phone: value.phone,
        password: this.safeStorage.decryptString(Buffer.from(value.encryptedPassword, 'base64')),
        warning: '',
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { phone: '', password: '', warning: '' };
      return { phone: '', password: '', warning: '无法读取已保存密码，请手动输入密码' };
    }
  }

  async clear() {
    await fs.rm(this.filePath, { force: true });
  }
}

module.exports = { RememberedLoginStore };
