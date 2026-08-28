'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { LocalBackendManager, isLoopbackUrl } = require('../../src/main/local-backend-manager');

function response(ok = true) {
  return { ok, json: async () => ok ? { status: 'ok', service: 'community-ai-backend' } : {} };
}

test('recognizes loopback addresses without treating LAN servers as local', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:3000'), true);
  assert.equal(isLoopbackUrl('http://localhost:3000'), true);
  assert.equal(isLoopbackUrl('http://[::1]:3000'), true);
  assert.equal(isLoopbackUrl('http://192.168.1.10:3000'), false);
});

test('reuses a compatible running service and never owns or stops it', async () => {
  let spawned = false;
  const manager = new LocalBackendManager({
    fetchImpl: async () => response(),
    spawnImpl: () => { spawned = true; },
    prepareData: async () => { throw new Error('migration should not run'); },
  });

  const status = await manager.ensureReady({ baseUrl: 'http://127.0.0.1:3000', configured: false });
  assert.equal(status.state, 'ready');
  assert.equal(status.managed, false);
  assert.equal(spawned, false);
  await manager.stop();
});

test('starts the bundled backend, waits for health, and stops only its child', async () => {
  let fetchCount = 0;
  const child = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => { child.killed = signal; queueMicrotask(() => child.emit('exit', 0, signal)); return true; };
  let spawnCall = null;
  const manager = new LocalBackendManager({
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount < 3) throw new Error('offline');
      return response();
    },
    spawnImpl: (...args) => { spawnCall = args; return child; },
    prepareData: async () => ({ dbPath: '/private/data/backend.db', updatesDir: '/private/data/updates', secret: 'stable-secret' }),
    backendEntry: '/Applications/Test.app/Contents/Resources/backend/src/index.js',
    processExecPath: '/Applications/Test.app/Contents/MacOS/Test',
    wait: async () => {},
    timeoutMs: 1000,
    pollIntervalMs: 1,
  });

  const status = await manager.ensureReady({ baseUrl: 'http://127.0.0.1:3000', configured: false });
  assert.equal(status.state, 'ready');
  assert.equal(status.managed, true);
  assert.equal(spawnCall[0], '/Applications/Test.app/Contents/MacOS/Test');
  assert.deepEqual(spawnCall[1], ['/Applications/Test.app/Contents/Resources/backend/src/index.js']);
  assert.equal(spawnCall[2].env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(spawnCall[2].env.HOST, '127.0.0.1');
  assert.equal(spawnCall[2].env.PORT, '3000');
  assert.equal(spawnCall[2].env.DB_PATH, '/private/data/backend.db');

  await manager.stop();
  assert.equal(child.killed, 'SIGTERM');
});

test('does not start the managed backend for an explicit LAN server', async () => {
  let spawned = false;
  const manager = new LocalBackendManager({
    fetchImpl: async () => response(),
    spawnImpl: () => { spawned = true; },
    prepareData: async () => ({}),
  });
  const status = await manager.ensureReady({ baseUrl: 'http://192.168.1.9:3000', configured: true });
  assert.equal(status.state, 'external');
  assert.equal(spawned, false);
});
