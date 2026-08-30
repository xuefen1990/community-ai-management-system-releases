import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../..');

test('tag workflow publishes the tested desktop release with only secret backend credentials', async () => {
  const workflow = await readFile(path.join(projectRoot, '.github/workflows/publish-desktop-update.yml'), 'utf8');
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/);
  assert.match(workflow, /runs-on: macos-14/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /COMMUNITY_AI_CI_BUILD: '1'/);
  assert.match(workflow, /COMMUNITY_AI_BACKEND_URL: \$\{\{ secrets\.COMMUNITY_AI_BACKEND_URL \}\}/);
  assert.match(workflow, /COMMUNITY_AI_BACKEND_ADMIN_PHONE: \$\{\{ secrets\.COMMUNITY_AI_BACKEND_ADMIN_PHONE \}\}/);
  assert.match(workflow, /COMMUNITY_AI_BACKEND_ADMIN_PASSWORD: \$\{\{ secrets\.COMMUNITY_AI_BACKEND_ADMIN_PASSWORD \}\}/);
  assert.match(workflow, /node scripts\/verify-release-inputs\.mjs/);
  assert.match(workflow, /npm test --prefix app/);
  assert.match(workflow, /npm test --prefix backend/);
  assert.match(workflow, /node scripts\/release-sync\.mjs/);
});

test('CI packaging is independent from local templates and still creates compatible update assets', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts/build-ci-arm64-dmg.mjs'), 'utf8');
  assert.doesNotMatch(source, /\/Applications\/村务通管理系统\.app/);
  assert.doesNotMatch(source, /source-original/);
  assert.match(source, /electron-builder', '--mac', 'dir', '--arm64'/);
  assert.match(source, /path\.join\(releaseDirectory, 'mac-arm64'\)/);
  assert.match(source, /community-ai-management-system-\$\{version\}-arm64\.zip/);
  assert.match(source, /app-update\.yml/);
  assert.match(source, /latest-mac\.yml/);
  assert.match(source, /codesign/);
});

test('the Electron Builder configuration writes CI output where the release builder expects it', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'app', 'package.json'), 'utf8'));
  assert.equal(manifest.build.directories.output, 'release');
  assert.equal(manifest.build.directories.buildResources, 'build');
});

test('release validation ties a tag and release notes to the desktop version', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts/verify-release-inputs.mjs'), 'utf8');
  assert.match(source, /GITHUB_REF_NAME/);
  assert.match(source, /`v\$\{version\}`/);
  assert.match(source, /docs', 'releases', `\$\{version\}\.md`/);
});

test('credential verification is non-interactive so a new window never triggers a second login', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts/verify-github-credential.mjs'), 'utf8');
  assert.match(source, /GIT_TERMINAL_PROMPT: '0'/);
  assert.match(source, /git', \['ls-remote', '--exit-code', 'origin', 'HEAD'\]/);
  assert.match(source, /GITHUB_TOKEN/);
});

test('release sync publishes GitHub assets even when backend configuration is absent', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts', 'release-sync.mjs'), 'utf8');
  assert.match(source, /function hasBackendPublishConfig\(\)/u);
  assert.match(source, /if \(hasBackendPublishConfig\(\)\)/u);
  assert.match(source, /backendSynced: Boolean\(backendRelease\)/u);
});

test('local update sync downloads the release zip and publishes it to the configured backend', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts', 'sync-local-update.mjs'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'app', 'package.json'), 'utf8'));
  assert.match(source, /'release', 'download'/u);
  assert.match(source, /\/api\/auth\/login/u);
  assert.match(source, /\/api\/update\/publish/u);
  assert.match(source, /COMMUNITY_AI_BACKEND_URL/u);
  assert.match(source, /COMMUNITY_AI_BACKEND_ADMIN_PASSWORD/u);
  assert.equal(manifest.scripts['release:sync-local'], 'node ../scripts/sync-local-update.mjs');
});
