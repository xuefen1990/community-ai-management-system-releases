#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(projectRoot, 'app', 'package.json'), 'utf8'));
const version = manifest.version;
const expectedTag = `v${version}`;
const currentTag = process.env.GITHUB_REF_NAME || '';
const releaseNotesPath = path.join(projectRoot, 'docs', 'releases', `${version}.md`);

if (currentTag && currentTag !== expectedTag) {
  throw new Error(`发布标签 ${currentTag} 与 app/package.json 版本 ${version} 不一致，应为 ${expectedTag}`);
}
try {
  await access(releaseNotesPath);
} catch {
  throw new Error(`缺少发行说明：${releaseNotesPath}`);
}

console.log(JSON.stringify({ version, tag: expectedTag, releaseNotesPath }, null, 2));
