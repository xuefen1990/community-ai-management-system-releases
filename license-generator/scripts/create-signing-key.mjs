#!/usr/bin/env node

import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const privateDirectory = path.join(projectRoot, 'license-generator', 'private');
const privateKeyPath = path.join(privateDirectory, 'license-private-key.pem');
const publicKeyPath = path.join(projectRoot, 'app', 'src', 'main', 'license-public-key.pem');

try {
  await access(privateKeyPath);
  console.error('Signing key already exists; refusing to overwrite it.');
  process.exitCode = 1;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  await mkdir(privateDirectory, { recursive: true });
  await writeFile(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
  await writeFile(publicKeyPath, publicKey, { encoding: 'utf8', mode: 0o644 });
  console.log(`Private signing key created at ${privateKeyPath}`);
  console.log(`Public verification key created at ${publicKeyPath}`);
}
