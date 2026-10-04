'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { fail } = require('./foundation-data-model');
const MAX_BYTES = 50 * 1024 * 1024;
const PAGE = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>社区档案上传</title>
<style>body{font:16px/1.7 -apple-system,sans-serif;margin:0;background:#f3f7f6;color:#20342c}main{max-width:540px;margin:32px auto;padding:24px;background:white;border-radius:16px}h1{font-size:24px}button,label{display:block;margin-top:20px;padding:14px;border-radius:9px;border:0;background:#059669;color:white;text-align:center;font-size:17px}input{display:block;margin-top:12px;width:100%}li{overflow-wrap:anywhere}small{color:#64776d}button:disabled{opacity:.5}</style>
<main><h1>社区档案上传</h1><p id="owner"></p><p>手机与电脑保持在同一网络，选择照片或文件后上传。</p><input id="files" type="file" multiple accept="image/*,.pdf,.docx,.xlsx,.txt,.mp4,.mov"><button id="upload">上传所选文件</button><p id="status" role="status"></p><ul id="results"></ul><small>单个文件不超过 50 MB。链接在 15 分钟后失效，电脑退出账号后立即失效。</small></main>
<script>const params=new URLSearchParams(location.search),files=document.querySelector('#files'),button=document.querySelector('#upload'),status=document.querySelector('#status');document.querySelector('#owner').textContent=params.get('ownerKey')?'关联资料：'+params.get('ownerKey'):'上传后请在电脑上完成档案分类与关联';button.onclick=async()=>{if(!files.files.length){status.textContent='请先选择文件';return}button.disabled=true;let success=0;for(const file of files.files){try{if(file.size>52428800)throw Error('超过 50 MB');status.textContent='正在上传 '+file.name;const query=new URLSearchParams(params);query.set('name',file.name);const response=await fetch('/upload?'+query,{method:'POST',body:file,headers:{'Content-Type':'application/octet-stream'}});const result=await response.json();if(!response.ok)throw Error(result.error||'上传失败');success++;const item=document.createElement('li');item.textContent=file.name+'：已传到电脑';document.querySelector('#results').append(item)}catch(error){const item=document.createElement('li');item.textContent=file.name+'：'+error.message;document.querySelector('#results').append(item)}}status.textContent='完成，成功上传 '+success+' 个文件，请在电脑端核对。';button.disabled=false};</script></html>`;
class FoundationMobileUpload {
  constructor({ store, auth, host = '0.0.0.0', now = () => Date.now() }) {
    this.store = store; this.auth = auth; this.host = host; this.now = now; this.server = null; this.starting = null;
    this.token = ''; this.shortCode = ''; this.identity = ''; this.expiresAt = 0; this.shortAttempts = new Map();
  }
  async account() {
    await this.auth.authorize({ method: 'POST', path: '/documents' });
    const status = await this.auth.status();
    return JSON.stringify([status.account?.id || status.account?.phone, status.account?.organizationId || status.account?.organization?.id]);
  }
  async info(onUpload) {
    await this.store.requireHostFileOperation?.();
    const identity = await this.account();
    if (identity !== this.identity || this.expiresAt <= this.now()) {
      this.token = randomBytes(32).toString('hex');
      this.shortCode = String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, '0');
      this.shortAttempts.clear();
    }
    this.identity = identity; this.expiresAt = this.now() + 15 * 60 * 1000; this.onUpload = onUpload;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => this.close(), 15 * 60 * 1000); this.expiryTimer.unref?.();
    if (!this.server) {
      if (!this.starting) this.starting = (async () => {
        for (const port of [9898, 0]) {
          try {
            await new Promise((resolve, reject) => {
              const server = http.createServer((req, res) => this.handle(req, res));
              server.requestTimeout = 120000;
              server.once('error', reject);
              server.listen(port, this.host, () => { this.server = server; server.unref(); resolve(); });
            });
            return;
          } catch (error) { if (port !== 9898 || error.code !== 'EADDRINUSE') throw error; }
        }
      })().finally(() => { this.starting = null; });
      await this.starting;
    }
    const ips = Object.values(os.networkInterfaces()).flat().filter(address => address?.family === 'IPv4' && !address.internal).map(address => address.address);
    return { running: true, port: this.server.address().port, ips: ips.length ? ips : ['127.0.0.1'], token: this.token, shortCode: this.shortCode, expiresAt: this.expiresAt };
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    let target;
    try {
      const url = new URL(req.url, 'http://mobile.local');
      if (req.method === 'GET' && url.pathname.startsWith('/s/')) {
        const address = req.socket.remoteAddress || 'unknown';
        const attempt = this.shortAttempts.get(address) || { count: 0, until: this.now() + 15 * 60 * 1000 };
        if (attempt.until <= this.now()) { attempt.count = 0; attempt.until = this.now() + 15 * 60 * 1000; }
        attempt.count += 1; this.shortAttempts.set(address, attempt);
        if (attempt.count > 20) fail('TOO_MANY_ATTEMPTS', '尝试次数过多，请使用二维码或稍后重试');
      }
      if (req.method === 'GET' && url.pathname === `/s/${this.shortCode}` && this.shortCode && this.expiresAt > this.now()) {
        res.statusCode = 302;
        res.setHeader('Location', `/mobile_upload.html?token=${encodeURIComponent(this.token)}`);
        res.end(); return;
      }
      if (!this.token || url.searchParams.get('token') !== this.token || this.expiresAt <= this.now()) fail('INVALID_LINK', '上传链接已失效，请在电脑上重新打开手机上传');
      if (await this.account() !== this.identity) fail('ACCOUNT_CHANGED', '电脑账号已切换，请重新获取上传链接');
      if (req.method === 'GET' && url.pathname === '/mobile_upload.html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); return;
      }
      if (req.method !== 'POST' || url.pathname !== '/upload') fail('INVALID_REQUEST', '上传请求不正确');
      const name = path.basename(url.searchParams.get('name') || '').replace(/[\0\r\n]/g, '').slice(0, 200);
      const extension = path.extname(name).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.pdf', '.docx', '.xlsx', '.txt', '.mp4', '.mov'].includes(extension)) fail('INVALID_FILE', '请选择照片、文档或视频文件');
      if (Number(req.headers['content-length']) > MAX_BYTES) fail('FILE_TOO_LARGE', '文件超过 50 MB');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BYTES) fail('FILE_TOO_LARGE', '文件超过 50 MB'); chunks.push(chunk); }
      if (!size) fail('INVALID_FILE', '不能上传空文件');
      if (await this.account() !== this.identity || url.searchParams.get('token') !== this.token) fail('ACCOUNT_CHANGED', '电脑账号已切换，请重新上传');
      const directory = path.join(this.store.dataDirectory, 'mobile-inbox'); await fs.mkdir(directory, { recursive: true });
      const id = randomUUID(); await fs.mkdir(path.join(directory, id)); target = path.join(directory, id, name);
      await fs.writeFile(target, Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
      const item = { id, filename: name, name, tempPath: target, size,
        ownerType: url.searchParams.get('ownerType') || '未关联', ownerKey: url.searchParams.get('ownerKey') || '' };
      await this.onUpload?.(item);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, name }));
    } catch (error) {
      if (target) await fs.unlink(target).catch(() => {});
      if (!res.destroyed) { res.statusCode = error.code === 'FILE_TOO_LARGE' ? 413 : 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error.message || '上传失败' })); }
    }
  }
  close() { clearTimeout(this.expiryTimer); this.token = ''; this.shortCode = ''; this.shortAttempts.clear(); this.server?.close(); this.server?.closeAllConnections?.(); this.server = null; }
}
module.exports = { FoundationMobileUpload };
