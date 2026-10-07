'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const empty = () => ({ phone: '', password: '', warning: '' });
class RememberedLoginStore {
  constructor({ userDataPath, safeStorage }) {
    this.directory = path.join(userDataPath, 'license');
    this.filePath = path.join(this.directory, 'remembered-login.json');
    this.safeStorage = safeStorage;
    this.pending = Promise.resolve();
  }
  key(serverUrl = '') { return createHash('sha256').update(String(serverUrl).replace(/\/$/u, '')).digest('hex'); }
  async read() { try { return JSON.parse(await fs.readFile(this.filePath, 'utf8')); } catch(error) { if(error.code==='ENOENT')return {}; throw error; } }
  async write(value) {
    await fs.mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }
  serialize(work) { const next=this.pending.then(work); this.pending=next.catch(()=>{}); return next; }
  async save({ phone, password, serverUrl = '' }) {
    if (!this.safeStorage?.isEncryptionAvailable()) return { saved: false, warning: '系统安全存储不可用，已跳过保存密码' };
    const payload={phone:String(phone||''),encryptedPassword:this.safeStorage.encryptString(String(password||'')).toString('base64')};
    await this.serialize(async()=>{const old=await this.read();await this.write({version:2,servers:{...(old.servers||{}),[this.key(serverUrl)]:payload}});});
    return { saved: true, warning: '' };
  }
  async load({ serverUrl = '', allowLegacy = false } = {}) {
    try {
      const saved=await this.read();
      const value=saved.servers?.[this.key(serverUrl)] || ((!serverUrl || allowLegacy) && saved.encryptedPassword ? saved : null);
      if(!value?.phone || !value.encryptedPassword)return empty();
      if(!this.safeStorage?.isEncryptionAvailable())return {phone:value.phone,password:'',warning:'系统安全存储不可用，请手动输入密码'};
      const password=this.safeStorage.decryptString(Buffer.from(value.encryptedPassword,'base64'));
      if(serverUrl && !saved.servers && allowLegacy)await this.save({serverUrl,phone:value.phone,password});
      return {phone:value.phone,password,warning:''};
    } catch(error) { return { ...empty(),warning:'无法读取已保存密码，请手动输入密码' }; }
  }
  async clear({ serverUrl } = {}) {
    await this.serialize(async()=>{
      if(serverUrl===undefined){await fs.rm(this.filePath,{force:true});return;}
      const value=await this.read();delete value.servers?.[this.key(serverUrl)];
      // Clear a legacy credential as well; its original server was never recorded.
      await this.write({version:2,servers:value.servers||{}});
    });
  }
}
module.exports = { RememberedLoginStore };
