'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { generateKeyPairSync, randomBytes, randomUUID, sign, X509Certificate, createHash } = require('node:crypto');

// DER only encodes the certificate; key generation and signing use Node/OpenSSL.
function der(tag, ...parts) {
  const content = Buffer.concat(parts);
  const length = content.length < 128 ? Buffer.from([content.length]) : (() => {
    const bytes = []; let value = content.length;
    while (value) { bytes.unshift(value & 255); value >>>= 8; }
    return Buffer.from([128 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), length, content]);
}
const seq = (...parts) => der(0x30, ...parts);
function oid(value) {
  const numbers = value.split('.').map(Number), bytes = [40 * numbers[0] + numbers[1]];
  for (let number of numbers.slice(2)) {
    const encoded = [number & 127];
    while ((number = Math.floor(number / 128))) encoded.unshift(128 | (number & 127));
    bytes.push(...encoded);
  }
  return der(6, Buffer.from(bytes));
}
function utc(date) { return der(0x17, Buffer.from(date.toISOString().replace(/\D/g, '').slice(2, 14) + 'Z')); }
function certificate(privateKey, publicKey, workspaceId) {
  const algorithm = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(`VillageWorkspace-${workspaceId}`)))));
  const serial = randomBytes(16); serial[0] &= 127; serial[0] ||= 1;
  const start = new Date(Date.now() - 86400000), end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 10);
  const tbs = seq(der(0xa0, der(2, Buffer.from([2]))), der(2, serial), algorithm, name,
    seq(utc(start), utc(end)), name, publicKey.export({ type: 'spki', format: 'der' }));
  const value = seq(tbs, algorithm, der(3, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])));
  return `-----BEGIN CERTIFICATE-----\n${value.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}
async function loadMobileIdentity(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'tls-identity.json');
  let identity;
  try { identity = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const workspaceId = randomUUID();
    identity = { workspaceId, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), certificate: certificate(privateKey, publicKey, workspaceId) };
    await fs.writeFile(file, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  }
  const cert = new X509Certificate(identity.certificate);
  const { createPrivateKey } = require('node:crypto');
  if (!identity.workspaceId || !Number.isFinite(Date.parse(cert.validTo)) || !cert.checkPrivateKey(createPrivateKey(identity.privateKey)) || !cert.verify(cert.publicKey)) throw new Error('手机同步的电脑身份校验失败');
  return { ...identity, fingerprint: createHash('sha256').update(cert.raw).digest('hex') };
}
module.exports = { loadMobileIdentity };
