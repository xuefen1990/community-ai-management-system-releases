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
    const response = await this.onlineClient.chat({
      ...(await this.settingsStore.getOnlineCredentials()),
      messages,
    });
    return { ...response, provider: 'online' };
  }
}

module.exports = { AiRouter };
