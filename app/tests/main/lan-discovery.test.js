'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { broadcastAddresses, scanLanHosts, startLanDiscoveryResponder } = require('../../src/main/lan-discovery');

test('主电脑发现只回传局域网地址与设备名', async t => {
  const responder = await startLanDiscoveryResponder({ port: 0, httpPort: 3000, name: '单位主电脑' });
  t.after(() => responder.close());
  const hosts = await scanLanHosts({ port: responder.port, targets: ['127.0.0.1'], timeoutMs: 100 });
  assert.deepEqual(hosts, [{ ip: '127.0.0.1', port: 3000, name: '单位主电脑' }]);
});

test('扫描广播地址按实际网卡子网计算', () => {
  assert.deepEqual(broadcastAddresses({ en0: [{ family: 'IPv4', internal: false, address: '192.168.2.106', netmask: '255.255.255.0' }] }), ['192.168.2.255']);
});
