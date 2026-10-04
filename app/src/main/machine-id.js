'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

function collectHardwareHints(networkInterfaces = os.networkInterfaces()) {
  const macAddresses = Object.values(networkInterfaces)
    .flat()
    .filter(Boolean)
    .map((entry) => entry.mac)
    .filter((mac) => mac && mac !== '00:00:00:00:00:00')
    .sort();
  return macAddresses.length > 0 ? macAddresses : [os.hostname()];
}

function createMachineId(networkInterfaces) {
  const fingerprint = [process.platform, process.arch, ...collectHardwareHints(networkInterfaces)].join('|');
  const digest = crypto.createHash('sha256').update(fingerprint).digest('hex').toUpperCase();
  return `CAI-${digest.slice(0, 8)}-${digest.slice(8, 16)}-${digest.slice(16, 24)}-${digest.slice(24, 32)}`;
}

module.exports = { collectHardwareHints, createMachineId };
