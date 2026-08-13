#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(rootDirectory, relativeDirectory = '') {
  const absoluteDirectory = path.join(rootDirectory, relativeDirectory);
  const names = await readdir(absoluteDirectory);
  names.sort((left, right) => left.localeCompare(right, 'en'));
  const entries = [];

  for (const name of names) {
    const relativePath = relativeDirectory ? path.join(relativeDirectory, name) : name;
    const absolutePath = path.join(rootDirectory, relativePath);
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      entries.push(...await walk(rootDirectory, relativePath));
    } else if (stats.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      const hash = createHash('sha256').update(target).digest('hex');
      entries.push({ type: 'link', size: Buffer.byteLength(target), hash, relativePath, target });
    } else if (stats.isFile()) {
      entries.push({
        type: 'file',
        size: stats.size,
        hash: await sha256File(absolutePath),
        relativePath,
        mode: (stats.mode & 0o777).toString(8).padStart(3, '0'),
      });
    }
  }

  return entries;
}

const [, , rootArgument, outputArgument] = process.argv;

if (!rootArgument || !outputArgument) {
  console.error('Usage: node scripts/generate-file-manifest.mjs <root-directory> <output.tsv>');
  process.exitCode = 2;
} else {
  const rootDirectory = path.resolve(rootArgument);
  const outputPath = path.resolve(outputArgument);
  const entries = await walk(rootDirectory);
  const lines = ['type\tmode\tsize\tsha256\tpath\tlink_target'];

  for (const entry of entries) {
    lines.push([
      entry.type,
      entry.mode ?? '',
      String(entry.size),
      entry.hash,
      entry.relativePath.split(path.sep).join('/'),
      entry.target ?? '',
    ].join('\t'));
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ rootDirectory, outputPath, entries: entries.length }, null, 2));
}
