'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { BackendUpdateClient, updatePlatform } = require('../../src/main/backend-update-client');

test('update platform follows the installed operating system', () => {
  assert.equal(updatePlatform('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(updatePlatform('win32', 'x64'), 'win32-x64');
});

test('backend update client passes version, platform and channel to the configured server', async () => {
  let requested;
  const client = new BackendUpdateClient({
    platform: 'darwin-arm64',
    getServerConfig: async () => ({ baseUrl: 'http://updates.example.test:3000' }),
    fetchImpl: async (url) => {
      requested = new URL(url);
      return { ok: true, json: async () => ({ hasUpdate: true, latestVersion: '0.3.1' }) };
    },
  });

  assert.deepEqual(await client.check({ currentVersion: '0.3.0' }), { hasUpdate: true, latestVersion: '0.3.1' });
  assert.equal(requested.pathname, '/api/update/check');
  assert.equal(requested.searchParams.get('version'), '0.3.0');
  assert.equal(requested.searchParams.get('platform'), 'darwin-arm64');
  assert.equal(requested.searchParams.get('channel'), 'stable');
});

test('Windows update check requests the Windows x64 release', async () => {
  let requested;
  const client = new BackendUpdateClient({ platform: 'win32-x64',
    getServerConfig: async () => ({ baseUrl: 'https://updates.example.test' }),
    fetchImpl: async url => { requested = new URL(url); return { ok: true, json: async () => ({ hasUpdate: true }) }; },
  });
  await client.check({ currentVersion: '1.0.2' });
  assert.equal(requested.searchParams.get('platform'), 'win32-x64');
});

test('backend update client provides a generic Electron feed URL on the same backend', async () => {
  const client = new BackendUpdateClient({
    getServerConfig: async () => ({ baseUrl: 'http://updates.example.test:3000' }),
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });

  assert.equal(await client.getElectronFeedUrl(), 'http://updates.example.test:3000/api/update/electron/');
});
