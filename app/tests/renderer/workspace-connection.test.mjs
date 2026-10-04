import assert from 'node:assert/strict';
import test from 'node:test';
import { LAN_SETUP_ROUTE, autoConnectHost, needsLanSetup, routeAfterLogin } from '../../src/renderer/foundation/workspace-connection.mjs';

const child = { authenticated: true, account: { role: 'member' } };

test('child account enters workbench only when its selected host is reachable', async () => {
  for (const connection of [{ status: 'unconfigured' }, { status: 'offline', baseUrl: 'http://192.168.2.10:3000' }]) {
    const api = { getLocalAuthStatus: async () => child, getLanShareInfo: async () => ({ connection }) };
    assert.equal(await routeAfterLogin(api), LAN_SETUP_ROUTE);
  }
  const api = { getLocalAuthStatus: async () => child, getLanShareInfo: async () => ({ connection: { status: 'online' } }) };
  assert.equal(await routeAfterLogin(api), '/overview');
});

test('host-account login never requires a child-workspace connection', async () => {
  const api = { getLocalAuthStatus: async () => ({ authenticated: true, account: { role: 'main_account' } }),
    getLanShareInfo: async () => { throw new Error('should not query child host'); } };
  assert.equal(await needsLanSetup(api), false);
});

test('connection status failures lead the child to setup instead of business pages', async () => {
  const api = { getLocalAuthStatus: async () => child, getLanShareInfo: async () => { throw new Error('host offline'); } };
  assert.equal(await routeAfterLogin(api), LAN_SETUP_ROUTE);
});

test('first setup requires confirmation; confirmed accounts reconnect to the saved or sole verified host', () => {
  const first = { ip: '192.168.2.10', matched: true };
  const second = { ip: '192.168.2.11', matched: true };
  assert.equal(autoConnectHost([first], ''), null);
  assert.equal(autoConnectHost([first, second], 'http://192.168.2.10:3000'), first);
  assert.equal(autoConnectHost([first], 'http://192.168.2.8:3000'), first);
  assert.equal(autoConnectHost([first, second], 'http://192.168.2.8:3000'), null);
  assert.equal(autoConnectHost([{ ip: '192.168.2.8', matched: false }], 'http://192.168.2.8:3000'), null);
});
