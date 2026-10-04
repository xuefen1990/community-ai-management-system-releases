'use strict';

const dgram = require('node:dgram');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

const DISCOVERY_PORT = 33001;
const PROTOCOL = 'community-ai-lan-workspace-v1';

function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const addresses = new Set();
  for (const entry of Object.values(interfaces).flat()) {
    if (entry?.family !== 'IPv4' || entry.internal || !entry.netmask) continue;
    const ip = entry.address.split('.').map(Number);
    const mask = entry.netmask.split('.').map(Number);
    if (ip.length !== 4 || mask.length !== 4 || [...ip, ...mask].some(value => !Number.isInteger(value) || value < 0 || value > 255)) continue;
    addresses.add(ip.map((value, index) => (value | (~mask[index] & 255))).join('.'));
  }
  return [...addresses];
}

function parsePacket(buffer) {
  try {
    const value = JSON.parse(Buffer.from(buffer).toString('utf8'));
    return value?.protocol === PROTOCOL && typeof value.nonce === 'string' && /^[a-f0-9]{24}$/u.test(value.nonce)
      ? value : null;
  } catch { return null; }
}

async function startLanDiscoveryResponder({ httpPort, port = DISCOVERY_PORT, name = os.hostname(), socketFactory = dgram.createSocket } = {}) {
  const socket = socketFactory('udp4');
  socket.on('message', (message, remote) => {
    const packet = parsePacket(message);
    if (packet?.type !== 'discover') return;
    const response = Buffer.from(JSON.stringify({ protocol: PROTOCOL, type: 'host', nonce: packet.nonce,
      port: httpPort, name: String(name || '主电脑').slice(0, 80) }));
    socket.send(response, remote.port, remote.address);
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, '0.0.0.0', () => { socket.off('error', reject); resolve(); });
    });
  } catch (error) { socket.close(); throw error; }
  return { port: socket.address().port, close: () => new Promise(resolve => socket.close(resolve)) };
}

async function scanLanHosts({ port = DISCOVERY_PORT, timeoutMs = 1600, targets = broadcastAddresses(), socketFactory = dgram.createSocket } = {}) {
  if (!targets.length) return [];
  const socket = socketFactory('udp4');
  const nonce = randomBytes(12).toString('hex');
  const hosts = new Map();
  socket.on('message', (message, remote) => {
    const packet = parsePacket(message);
    if (packet?.type !== 'host' || packet.nonce !== nonce || !Number.isInteger(packet.port) || packet.port < 1 || packet.port > 65535) return;
    hosts.set(remote.address, { ip: remote.address, port: packet.port, name: String(packet.name || '主电脑').slice(0, 80) });
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '0.0.0.0', () => { socket.off('error', reject); resolve(); });
    });
    socket.setBroadcast(true);
    const request = Buffer.from(JSON.stringify({ protocol: PROTOCOL, type: 'discover', nonce }));
    await Promise.allSettled(targets.map(target => new Promise((resolve, reject) => socket.send(request, port, target, error => error ? reject(error) : resolve()))));
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
    return [...hosts.values()];
  } finally { socket.close(); }
}

module.exports = { DISCOVERY_PORT, PROTOCOL, broadcastAddresses, parsePacket, startLanDiscoveryResponder, scanLanHosts };
