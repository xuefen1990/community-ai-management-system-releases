'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { FoundationMobileUpload } = require('../../src/main/foundation-mobile-upload');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foundation-mobile-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const uploads = [];
  const service = new FoundationMobileUpload({ store: { dataDirectory: root }, auth: { authorize: async () => {}, status: async () => ({ account: { id: 'synthetic' } }) } });
  service.identity = await service.account(); service.token = 'synthetic-only-token'; service.expiresAt = Date.now() + 60000; service.onUpload = item => uploads.push(item);
  return { root, service, uploads };
}
async function request(service, query, body = 'synthetic file') {
  const req = Readable.from([Buffer.from(body)]); req.method = 'POST'; req.url = '/upload?' + new URLSearchParams(query); req.headers = { 'content-length': Buffer.byteLength(body) };
  const result = { statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value); } }; await service.handle(req, result); return result;
}
test('mobile upload saves the exact file and emits only the authorized desktop inbox item', async t => {
  const f = await fixture(t), response = await request(f.service, { token: f.service.token, name: '合成照片.png', ownerType: '人员', ownerKey: 'synthetic-person' });
  assert.equal(response.statusCode, 200); assert.equal(f.uploads.length, 1);
  assert.equal(await fs.readFile(f.uploads[0].tempPath, 'utf8'), 'synthetic file'); assert.equal(f.uploads[0].ownerKey, 'synthetic-person');
  assert.equal(response.body.tempPath, undefined);
});
test('wrong, expired, switched-account and disallowed-file upload requests cannot write inbox files', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.service, { token: 'wrong', name: 'x.png' })).statusCode, 400);
  assert.equal((await request(f.service, { token: f.service.token, name: 'run.app' })).statusCode, 400);
  f.service.expiresAt = 0;
  assert.equal((await request(f.service, { token: f.service.token, name: 'x.png' })).statusCode, 400);
  f.service.expiresAt = Date.now() + 60000; f.service.identity = 'other-account';
  assert.equal((await request(f.service, { token: f.service.token, name: 'x.png' })).statusCode, 400);
  assert.deepEqual(await fs.readdir(f.root), []); assert.equal(f.uploads.length, 0);
});
test('short hand-entry address opens the tokenized upload page and expires with the session', async t => {
  const f = await fixture(t);
  f.service.shortCode = '12345678';
  const get = async pathname => {
    const req = { method: 'GET', url: pathname, socket: { remoteAddress: '192.168.1.8' } };
    const headers = {};
    const response = { statusCode: 200, setHeader(key, value) { headers[key] = value; }, end(value) { this.body = value; } };
    await f.service.handle(req, response);
    return { status: response.statusCode, headers };
  };
  const opened = await get('/s/12345678');
  assert.equal(opened.status, 302);
  assert.equal(opened.headers.Location, '/mobile_upload.html?token=synthetic-only-token');
  assert.equal((await get('/s/00000000')).status, 400);
  f.service.expiresAt = 0;
  assert.equal((await get('/s/12345678')).status, 400);
});
