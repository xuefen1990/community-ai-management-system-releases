'use strict';

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function updatePlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  throw new Error(`暂不支持此设备的应用内更新：${platform}-${arch}`);
}

class BackendUpdateClient {
  constructor({ getServerConfig, fetchImpl = globalThis.fetch, timeoutMs = 5000, platform = null }) {
    this.getServerConfig = getServerConfig;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.platform = platform;
  }

  async check({ currentVersion, platform = this.platform || updatePlatform(), channel = 'stable' }) {
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

module.exports = { BackendUpdateClient, updatePlatform };
