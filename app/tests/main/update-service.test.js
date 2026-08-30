'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { UpdateService, normalizeReleaseNotes } = require('../../src/main/update-service');

function makeUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => { updater.installed = true; };
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
  assert.deepEqual(await service.download(), { ok: true });
  assert.deepEqual(service.install(), { ok: true });
  assert.equal(updater.installed, true);
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

  assert.deepEqual(await service.check(), { ok: true });
  assert.deepEqual(statuses.at(-1), { type: 'available', version: '0.3.1', releaseNotes: '同步发行说明', releaseDate: null });
  assert.deepEqual(updater.feedUrl, { provider: 'generic', url: 'http://backend.test/api/update/electron/' });
});

test('falls back to the bundled GitHub update feed when the account backend is unavailable', async () => {
  const updater = makeUpdater();
  const statuses = [];
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '0.3.18', releaseNotes: 'GitHub release notes' });
  const service = new UpdateService({
    updater,
    isPackaged: () => true,
    backendUpdateClient: { check: async () => { throw new Error('本机账号服务未发布更新'); } },
    sendStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(await service.check(), { ok: true });
  assert.deepEqual(statuses.at(-1), { type: 'available', version: '0.3.18', releaseNotes: 'GitHub release notes', releaseDate: null });
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

  assert.deepEqual(await service.check(), { ok: true });
  assert.deepEqual(statuses.at(-1), { type: 'release-mismatch', backendVersion: '0.3.1', downloadVersion: '0.3.0' });
});
