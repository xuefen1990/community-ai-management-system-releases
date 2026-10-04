'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function createEmptyAuthState() {
  return {
    version: 2,
    accounts: [],
    activation: null,
    lastSeenAt: null,
    rememberedAccountId: null,
    lastLoginPhone: '',
    remoteServerUrl: '',
    lastKnownEntitlement: null,
  };
}

class AuthStore {
  constructor({ userDataPath }) {
    this.directory = path.join(userDataPath, 'license');
    this.filePath = path.join(this.directory, 'local-auth.json');
    this.writeQueue = Promise.resolve();
  }

  async read() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!value || typeof value !== 'object' || !Array.isArray(value.accounts)) {
        throw new TypeError('本地账号文件格式无效');
      }
      return structuredClone(value);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const empty = createEmptyAuthState();
      await this.write(empty);
      return structuredClone(empty);
    }
  }

  async write(value) {
    const snapshot = structuredClone(value);
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }
}

module.exports = { AuthStore, createEmptyAuthState };
