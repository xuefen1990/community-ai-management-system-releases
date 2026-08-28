'use strict';

const { spawn } = require('node:child_process');

function isLoopbackUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

class LocalBackendManager {
  constructor({
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    prepareData,
    backendEntry,
    processExecPath = process.execPath,
    wait = sleep,
    timeoutMs = 12000,
    pollIntervalMs = 120,
    healthTimeoutMs = 700,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.prepareData = prepareData;
    this.backendEntry = backendEntry;
    this.processExecPath = processExecPath;
    this.wait = wait;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.healthTimeoutMs = healthTimeoutMs;
    this.child = null;
    this.startPromise = null;
    this.status = { state: 'idle', managed: false, baseUrl: '', message: '本机账号服务尚未启动' };
  }

  getStatus() {
    return structuredClone(this.status);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    return this.getStatus();
  }

  async checkHealth(baseUrl) {
    if (typeof this.fetchImpl !== 'function') return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
    try {
      const response = await this.fetchImpl(`${String(baseUrl).replace(/\/$/u, '')}/api/health`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response?.ok) return false;
      const payload = await response.json().catch(() => ({}));
      return payload.status === 'ok' && (!payload.service || payload.service === 'community-ai-backend');
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async ensureReady(config = {}) {
    const baseUrl = config.baseUrl || 'http://127.0.0.1:3000';
    if (!isLoopbackUrl(baseUrl)) {
      return this.setStatus({ state: 'external', managed: false, baseUrl, message: '正在使用已配置的局域网账号服务器' });
    }
    if (await this.checkHealth(baseUrl)) {
      return this.setStatus({ state: 'ready', managed: Boolean(this.child), baseUrl, message: '账号服务已就绪' });
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startManaged(baseUrl).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async startManaged(baseUrl) {
    this.setStatus({ state: 'starting', managed: false, baseUrl, message: '账号服务启动中…' });
    try {
      if (typeof this.prepareData !== 'function') throw new Error('本机账号数据目录尚未配置');
      if (!this.backendEntry) throw new Error('安装包缺少账号服务运行文件');
      const runtime = await this.prepareData();
      const url = new URL(baseUrl);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      const child = this.spawnImpl(this.processExecPath, [this.backendEntry], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          HOST: '127.0.0.1',
          PORT: port,
          DB_PATH: runtime.dbPath,
          UPDATE_FILES_DIR: runtime.updatesDir,
          JWT_SECRET: runtime.secret,
          ADMIN_PASSWORD: runtime.secret,
        },
        stdio: 'ignore',
      });
      this.child = child;
      child.once?.('error', error => {
        if (this.child === child) this.setStatus({ state: 'failed', managed: false, message: `本机账号服务启动失败：${error.message}` });
      });
      child.once?.('exit', (code) => {
        if (this.child !== child) return;
        this.child = null;
        if (this.status.state !== 'stopping') {
          this.setStatus({ state: 'failed', managed: false, message: code === 0 ? '本机账号服务已停止' : '本机账号服务启动失败，3000 端口可能被其他程序占用' });
        }
      });

      const deadline = Date.now() + this.timeoutMs;
      while (Date.now() <= deadline) {
        if (await this.checkHealth(baseUrl)) {
          return this.setStatus({ state: 'ready', managed: true, message: '账号服务已就绪' });
        }
        if (!this.child) throw new Error(this.status.message);
        await this.wait(this.pollIntervalMs);
      }
      throw new Error('本机账号服务启动超时，请重试；如仍失败请检查 3000 端口');
    } catch (error) {
      if (this.child) {
        this.child.kill?.('SIGTERM');
        this.child = null;
      }
      this.setStatus({ state: 'failed', managed: false, message: error.message || '本机账号服务启动失败' });
      throw error;
    }
  }

  async retry(config) {
    if (this.child) await this.stop();
    return this.ensureReady(config);
  }

  async stop() {
    const child = this.child;
    if (!child) return this.setStatus({ state: 'stopped', managed: false, message: '本机账号服务已停止' });
    this.setStatus({ state: 'stopping', managed: true, message: '正在停止本机账号服务…' });
    this.child = null;
    await new Promise(resolve => {
      let finished = false;
      const done = () => { if (!finished) { finished = true; resolve(); } };
      child.once?.('exit', done);
      child.kill?.('SIGTERM');
      setTimeout(done, 1500).unref?.();
    });
    return this.setStatus({ state: 'stopped', managed: false, message: '本机账号服务已停止' });
  }
}

module.exports = { LocalBackendManager, isLoopbackUrl };
