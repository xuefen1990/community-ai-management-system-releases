'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { BackendUpdateClient } = require('../../src/main/backend-update-client');

test('backend update client passes version, platform and channel to the configured server', async () => {
  let requested;
  const client = new BackendUpdateClient({
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
