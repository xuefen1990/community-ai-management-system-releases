'use strict';

function normalizeReleaseNotes(releaseNotes) {
  if (typeof releaseNotes === 'string') return releaseNotes.trim();
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((item) => (typeof item === 'string' ? item : item?.note || ''))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  return '';
}

function compareVersions(a, b) {
  const left = String(a || '0.0.0').split('.').map(Number);
  const right = String(b || '0.0.0').split('.').map(Number);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

class UpdateService {
  constructor({ updater, isPackaged, platform = process.platform, isInApplicationsFolder = () => true, sendStatus = () => {}, logger = console, backendUpdateClient = null, currentVersion = () => updater.currentVersion?.version || '0.0.0' }) {
    this.updater = updater;
    this.isPackaged = isPackaged;
    this.platform = platform;
    this.isInApplicationsFolder = isInApplicationsFolder;
    this.sendStatus = sendStatus;
    this.logger = logger;
    this.backendUpdateClient = backendUpdateClient;
    this.currentVersion = currentVersion;
    this.started = false;
    this.downloaded = false;
    this.backendRelease = null;
  }

  emit(type, details = {}) {
    this.sendStatus({ type, ...details });
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (!this.isPackaged()) {
      this.emit('disabled', { reason: 'development' });
      return;
    }
    if (this.platform === 'darwin' && !this.isInApplicationsFolder()) {
      this.emit('installation-required', { message: '请先将社区AI管理系统拖入“应用程序”后再打开。' });
      return;
    }

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.logger = this.logger;
    this.updater.on('checking-for-update', () => this.emit('checking'));
    this.updater.on('update-available', (info) => {
      if (this.backendRelease && compareVersions(info.version, this.backendRelease.latestVersion) < 0) {
        this.emit('release-mismatch', { backendVersion: this.backendRelease.latestVersion, downloadVersion: info.version });
        return;
      }
      this.emit('available', {
        version: info.version,
        releaseNotes: this.backendRelease?.releaseNotes || normalizeReleaseNotes(info.releaseNotes),
        releaseDate: info.releaseDate || this.backendRelease?.publishedAt || null,
      });
    });
    this.updater.on('update-not-available', (info) => {
      if (this.backendRelease?.hasUpdate) {
        this.emit('release-mismatch', { backendVersion: this.backendRelease.latestVersion, downloadVersion: info?.version || null });
        return;
      }
      this.emit('not-available', { version: info?.version || null });
    });
    this.updater.on('download-progress', (progress) => this.emit('download-progress', {
      percent: Number(progress.percent || 0),
      bytesPerSecond: Number(progress.bytesPerSecond || 0),
      transferred: Number(progress.transferred || 0),
      total: Number(progress.total || 0),
    }));
    this.updater.on('update-downloaded', (info) => {
      this.downloaded = true;
      this.emit('downloaded', { version: info.version });
    });
    this.updater.on('error', (error) => {
      this.logger.warn?.('应用更新失败', error);
      this.emit('error', { message: error?.message || '更新服务暂时不可用' });
    });
  }

  async check() {
    this.start();
    if (!this.isPackaged()) return { ok: false, disabled: true, error: '开发环境不检查更新' };
    if (this.platform === 'darwin' && !this.isInApplicationsFolder()) {
      return { ok: false, installRequired: true, error: '请先将社区AI管理系统拖入“应用程序”后再打开' };
    }
    if (this.backendUpdateClient) {
      try {
        this.backendRelease = await this.backendUpdateClient.check({ currentVersion: this.currentVersion() });
      } catch (error) {
        this.backendRelease = null;
        this.logger.warn?.('更新服务器检查失败', error);
        this.emit('backend-unavailable');
        return { ok: false, backendUnavailable: true, error: '更新服务器暂时不可用' };
      }
      if (this.backendRelease && !this.backendRelease.hasUpdate) {
        if (this.backendRelease.hasNewerVersion) {
          this.emit('release-mismatch', { backendVersion: this.backendRelease.latestVersion, downloadVersion: null });
          return { ok: true, hasUpdate: false, pendingPackage: true };
        }
        this.emit('not-available', { version: this.currentVersion() });
        return { ok: true, hasUpdate: false };
      }
      if (this.backendRelease?.hasUpdate) {
        try {
          const feedUrl = await this.backendUpdateClient.getElectronFeedUrl();
          this.updater.setFeedURL({ provider: 'generic', url: feedUrl });
        } catch (error) {
          this.logger.warn?.('后端更新源不可用', error);
          this.emit('backend-unavailable');
          return { ok: false, backendUnavailable: true, error: '更新服务器暂时不可用' };
        }
      }
    }

    try {
      await this.updater.checkForUpdates();
      return { ok: true, hasUpdate: Boolean(this.backendRelease?.hasUpdate) };
    } catch (error) {
      this.emit('error', { message: error?.message || '检查更新失败' });
      return { ok: false, error: error?.message || '检查更新失败' };
    }
  }

  async download() {
    this.start();
    if (!this.isPackaged()) return { ok: false, disabled: true, error: '开发环境不能下载更新' };
    if (this.platform === 'darwin' && !this.isInApplicationsFolder()) {
      return { ok: false, installRequired: true, error: '请先将社区AI管理系统拖入“应用程序”后再打开' };
    }
    this.downloaded = false;
    try {
      await this.updater.downloadUpdate();
      if (!this.downloaded) throw new Error('更新包下载完成状态未确认');
      this.emit('installing', { version: this.backendRelease?.latestVersion || null });
      const result = this.install();
      if (!result.ok) throw new Error(result.error || '安装更新失败');
      return { ok: true, installing: true };
    } catch (error) {
      this.emit('error', { message: error?.message || '更新失败' });
      return { ok: false, error: error?.message || '更新失败' };
    }
  }

  install() {
    if (!this.downloaded) return { ok: false, error: '更新尚未下载完成' };
    if (this.platform === 'win32') this.updater.quitAndInstall(true, true);
    else this.updater.quitAndInstall();
    return { ok: true };
  }
}

module.exports = { UpdateService, normalizeReleaseNotes, compareVersions };
