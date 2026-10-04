'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { UpdateService, normalizeReleaseNotes } = require('../../src/main/update-service');

function makeUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '1.1.5' });
  updater.quitAndInstall = (...args) => { updater.installed = true; updater.installArgs = args; };
  return updater;
}

test('development builds never contact the update provider', async () => {
  const updater = makeUpdater();
  let checks = 0;
  updater.checkForUpdates = async () => { checks += 1; };
  const service = new UpdateService({ updater, isPackaged: () => false });

  assert.deepEqual(await service.check(), { ok: false, disabled: true, error: '开发环境不检查更新' });
  assert.equal(checks, 0);
});

test('an app launched from an installer disk never checks for updates', async () => {
  const updater = makeUpdater();
  let checks = 0;
  updater.checkForUpdates = async () => { checks += 1; };
  const statuses = [];
  const service = new UpdateService({
    updater,
    isPackaged: () => true,
    platform: 'darwin',
    isInApplicationsFolder: () => false,
    sendStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(await service.check(), {
    ok: false,
    installRequired: true,
    error: '请先将社区AI管理系统拖入“应用程序”后再打开',
  });
  assert.equal(checks, 0);
  assert.deepEqual(statuses, [{
    type: 'installation-required',
    message: '请先将社区AI管理系统拖入“应用程序”后再打开。',
  }]);
});

test('Windows installer can check updates without the macOS Applications folder', async () => {
  const updater = makeUpdater();
  let checks = 0;
  updater.checkForUpdates = async () => { checks += 1; };
  updater.setFeedURL = value => { updater.feed = value; };
  const service = new UpdateService({
    updater, isPackaged: () => true, platform: 'win32', isInApplicationsFolder: () => false,
    backendUpdateClient: {
      check: async () => ({ hasUpdate: true, latestVersion: '1.0.4' }),
      getElectronFeedUrl: async () => 'https://updates.example.test/api/update/electron/',
    },
  });
  assert.deepEqual(await service.check(), { ok: true, hasUpdate: true });
  assert.equal(checks, 1);
  assert.equal(updater.feed.url, 'https://updates.example.test/api/update/electron/');
  assert.deepEqual(await service.download(), { ok: true, installing: true });
  assert.deepEqual(updater.installArgs, [true, true]);
});

test('an empty Windows update feed reports current version without requesting a missing manifest', async () => {
  const updater = makeUpdater();
  updater.checkForUpdates = async () => { throw new Error('should not request a missing manifest'); };
  const service = new UpdateService({ updater, isPackaged: () => true, platform: 'win32',
    backendUpdateClient: { check: async () => ({ hasUpdate: false, hasNewerVersion: false }) } });
  assert.deepEqual(await service.check(), { ok: true, hasUpdate: false });
});

test('update service emits release details and downloads only after a request', async () => {
  const updater = makeUpdater();
  const statuses = [];
  const service = new UpdateService({ updater, isPackaged: () => true, sendStatus: (status) => statuses.push(status) });
  service.start();
  updater.emit('update-available', { version: '0.2.0', releaseNotes: [{ note: '修复登录问题' }] });
  updater.emit('download-progress', { percent: 50, transferred: 5, total: 10, bytesPerSecond: 2 });
  updater.emit('update-downloaded', { version: '0.2.0' });

  assert.deepEqual(statuses.slice(0, 3), [
    { type: 'available', version: '0.2.0', releaseNotes: '修复登录问题', releaseDate: null },
    { type: 'download-progress', percent: 50, transferred: 5, total: 10, bytesPerSecond: 2 },
    { type: 'downloaded', version: '0.2.0' },
  ]);
  assert.deepEqual(await service.download(), { ok: true, installing: true });
  assert.equal(updater.installed, true);
  assert.deepEqual(updater.installArgs, []);
});

test('one click downloads, then installs only after updater confirms completion', async () => {
  const updater = makeUpdater();
  const actions = [];
  updater.downloadUpdate = async () => {
    actions.push('download');
    updater.emit('update-downloaded', { version: '1.1.6' });
  };
  updater.quitAndInstall = (...args) => { actions.push('install'); updater.installArgs = args; };
  const service = new UpdateService({ updater, isPackaged: () => true, platform: 'win32' });
  assert.deepEqual(await service.download(), { ok: true, installing: true });
  assert.deepEqual(actions, ['download', 'install']);
  assert.deepEqual(updater.installArgs, [true, true]);
});

test('failed or unconfirmed downloads do not start the installer', async () => {
  const updater = makeUpdater();
  updater.downloadUpdate = async () => {};
  const service = new UpdateService({ updater, isPackaged: () => true, platform: 'win32' });
  assert.deepEqual(await service.download(), { ok: false, error: '更新包下载完成状态未确认' });
  assert.equal(updater.installed, undefined);
});

test('Windows applies downloaded updates silently and relaunches the app', () => {
  const updater = makeUpdater();
  const service = new UpdateService({ updater, isPackaged: () => true, platform: 'win32' });
  service.start();
  updater.emit('update-downloaded', { version: '1.1.5' });
  assert.deepEqual(service.install(), { ok: true });
  assert.deepEqual(updater.installArgs, [true, true]);
});

test('release notes are normalized without rendering remote HTML', () => {
  assert.equal(normalizeReleaseNotes(['第一项', { note: '第二项' }]), '第一项\n\n第二项');
  assert.equal(normalizeReleaseNotes(null), '');
});

test('uses the backend update feed when its published record is available', async () => {
  const updater = makeUpdater();
  const statuses = [];
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '0.3.1', releaseNotes: 'GitHub notes' });
  updater.setFeedURL = (value) => { updater.feedUrl = value; };
  const service = new UpdateService({
    updater,
    isPackaged: () => true,
    currentVersion: () => '0.3.0',
    backendUpdateClient: {
      check: async () => ({ hasUpdate: true, latestVersion: '0.3.1', releaseNotes: '同步发行说明' }),
      getElectronFeedUrl: async () => 'http://backend.test/api/update/electron/',
    },
    sendStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(await service.check(), { ok: true, hasUpdate: true });
  assert.deepEqual(statuses.at(-1), { type: 'available', version: '0.3.1', releaseNotes: '同步发行说明', releaseDate: null });
  assert.deepEqual(updater.feedUrl, { provider: 'generic', url: 'http://backend.test/api/update/electron/' });
});

test('reports the update server outage without using an unrelated feed', async () => {
  const updater = makeUpdater();
  const statuses = [];
  updater.checkForUpdates = async () => { throw new Error('should not check an unconfigured feed'); };
  const service = new UpdateService({
    updater,
    isPackaged: () => true,
    backendUpdateClient: { check: async () => { throw new Error('本机账号服务未发布更新'); } },
    sendStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(await service.check(), { ok: false, backendUnavailable: true, error: '更新服务器暂时不可用' });
  assert.deepEqual(statuses.at(-1), { type: 'backend-unavailable' });
});

test('does not download a GitHub release older than the backend record', async () => {
  const updater = makeUpdater();
  const statuses = [];
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '0.3.0' });
  updater.setFeedURL = () => {};
  const service = new UpdateService({
    updater,
    isPackaged: () => true,
    currentVersion: () => '0.2.9',
    backendUpdateClient: { check: async () => ({ hasUpdate: true, latestVersion: '0.3.1' }), getElectronFeedUrl: async () => 'http://backend.test/api/update/electron/' },
    sendStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(await service.check(), { ok: true, hasUpdate: true });
  assert.deepEqual(statuses.at(-1), { type: 'release-mismatch', backendVersion: '0.3.1', downloadVersion: '0.3.0' });
});
