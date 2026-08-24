'use strict';

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

class BackendUpdateClient {
  constructor({ getServerConfig, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    this.getServerConfig = getServerConfig;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async check({ currentVersion, platform = 'darwin-arm64', channel = 'stable' }) {
    if (typeof this.fetchImpl !== 'function') throw new Error('当前运行环境不支持更新检查');
    const config = await this.getServerConfig();
    const url = new URL('/api/update/check', config.baseUrl);
    url.searchParams.set('version', currentVersion);
    url.searchParams.set('platform', platform);
    url.searchParams.set('channel', channel);

    const timeout = createTimeoutSignal(this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: timeout.signal });
      if (!response.ok) throw new Error(`更新服务器响应异常（${response.status}）`);
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('更新服务器连接超时');
      throw error;
    } finally {
      timeout.clear();
    }
  }

  async getElectronFeedUrl() {
    const config = await this.getServerConfig();
    return new URL('/api/update/electron/', config.baseUrl).toString();
  }
}

module.exports = { BackendUpdateClient };
