'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(role = 'main_account', permissions = {}) {
  let mount, unmount, route, amountCents = 123456, requests = 0;
  const events = new Map(), original = { name: 'OriginalOverview' };
  const router = { getRoutes: () => [{ name: 'overview', path: '/overview', meta: { requiresAuth: true }, components: { default: original } }], addRoute: value => { route = value; }, push() {} };
  const context = { h: (tag, props, children) => ({ tag, props, children }), createVNode: component => ({ component }),
    ref: value => ({ value }), onMounted: callback => { mount = callback; }, onBeforeUnmount: callback => { unmount = callback; },
    Date, setInterval: () => 1, clearInterval() {}, window: { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name), api: {
      getLocalAuthStatus: async () => ({ authenticated: true, account: { role, permissions } }),
      businessRequest: async input => { requests++; assert.equal(input.path, '/api/v3/finance-account-balance'); return { ok: true, data: { status: 'ready', amountCents, asOfDate: '2026-10-04' } }; },
    } } };
  const source = fs.readFileSync(require.resolve('../../src/renderer/foundation/finance-balance-card.mjs'), 'utf8').replace(/^import[^\n]+\n/, '').replace('export function installOverviewBalance', 'function installOverviewBalance');
  vm.runInNewContext(source + '\ninstallOverviewBalance({router});', vm.createContext({ ...context, router }));
  const render = context.window.communityOverviewBalanceCard.setup();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { render, original, events, requests: () => requests, update: value => { amountCents = value; }, mount: async () => { mount(); await flush(); }, unmount: () => unmount(), flush };
}

test('overview registers an in-place card using cumulative balance and refreshes current data', async () => {
  const ui = fixture(); await ui.mount();
  assert.match(JSON.stringify(ui.render()), /1,234.56/);
  assert.match(ui.render().props.class, /wb-stat-card/);
  ui.update(-98765); await ui.events.get('focus')();
  assert.match(JSON.stringify(ui.render()), /-987.65/);
  ui.unmount(); assert.equal(ui.events.size, 0);
});

test('overview only requests financial data for authorized accounts', async () => {
  const denied = fixture('member', { workspace: ['view'] }); await denied.mount();
  assert.equal(denied.requests(), 0); assert.equal(denied.render(), null);
  const allowed = fixture('member', { finance: ['view'] }); await allowed.mount();
  assert.equal(allowed.requests(), 1); assert.match(JSON.stringify(allowed.render()), /账户余额/);
});
