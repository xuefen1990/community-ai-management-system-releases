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

class UpdateService {
  constructor({ updater, isPackaged, isInApplicationsFolder = () => true, sendStatus = () => {}, logger = console }) {
    this.updater = updater;
    this.isPackaged = isPackaged;
    this.isInApplicationsFolder = isInApplicationsFolder;
    this.sendStatus = sendStatus;
    this.logger = logger;
    this.started = false;
    this.downloaded = false;
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
    if (!this.isInApplicationsFolder()) {
      this.emit('installation-required', { message: '请先将社区AI管理系统拖入“应用程序”后再打开。' });
      return;
    }

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.logger = this.logger;
    this.updater.on('checking-for-update', () => this.emit('checking'));
    this.updater.on('update-available', (info) => this.emit('available', {
      version: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate || null,
    }));
    this.updater.on('update-not-available', (info) => this.emit('not-available', { version: info?.version || null }));
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
    if (!this.isInApplicationsFolder()) {
      return { ok: false, installRequired: true, error: '请先将社区AI管理系统拖入“应用程序”后再打开' };
    }
    try {
      await this.updater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      this.emit('error', { message: error?.message || '检查更新失败' });
      return { ok: false, error: error?.message || '检查更新失败' };
    }
  }

  async download() {
    this.start();
    if (!this.isPackaged()) return { ok: false, disabled: true, error: '开发环境不能下载更新' };
    if (!this.isInApplicationsFolder()) {
      return { ok: false, installRequired: true, error: '请先将社区AI管理系统拖入“应用程序”后再打开' };
    }
    try {
      await this.updater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      this.emit('error', { message: error?.message || '下载更新失败' });
      return { ok: false, error: error?.message || '下载更新失败' };
    }
  }

  install() {
    if (!this.downloaded) return { ok: false, error: '更新尚未下载完成' };
    this.updater.quitAndInstall();
    return { ok: true };
  }
}

module.exports = { UpdateService, normalizeReleaseNotes };
