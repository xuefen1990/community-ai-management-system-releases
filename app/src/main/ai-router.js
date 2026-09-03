'use strict';

class AiRouter {
  constructor({ settingsStore, localRuntime, onlineClient }) {
    this.settingsStore = settingsStore;
    this.localRuntime = localRuntime;
    this.onlineClient = onlineClient;
  }

  async chat({ messages }) {
    const settings = await this.settingsStore.readRaw();
    if (settings.mode === 'local') return this.localRuntime.chat(messages);
    if (settings.mode === 'online') return this.onlineChat(messages);
    if (this.localRuntime.getStatus().running) {
      try {
        return await this.localRuntime.chat(messages);
      } catch (error) {
        if (!(await this.settingsStore.getOnlineCredentials()).apiKey) throw error;
      }
    }
    return this.onlineChat(messages);
  }

  async onlineChat(messages) {
    const credentials = await this.settingsStore.getOnlineCredentials();
    if (!credentials.apiKey && credentials.credentialStatus === 'secure-storage-unavailable') {
      throw new Error('macOS 安全存储不可用。请在“系统设置 → AI 配置”重新输入 API 密钥；密钥只在本次打开软件期间有效，关闭软件后会自动清除。');
    }
    const response = await this.onlineClient.chat({
      ...credentials,
      messages,
    });
    return { ...response, provider: 'online' };
  }
}

module.exports = { AiRouter };
