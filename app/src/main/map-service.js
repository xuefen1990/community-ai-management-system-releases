'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
class MapService {
  constructor({userDataPath,safeStorage,fetchImpl=globalThis.fetch}){this.file=path.join(userDataPath,'settings','map-service.json');this.safeStorage=safeStorage;this.fetch=fetchImpl;this.sessionKey='';this.tiles=new Map();this.inflight=new Map();this.keyGeneration=0;this.queue=Promise.resolve();}
  async config(){let data={};try{data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('地图服务配置读取失败');}
    let apiKey=this.sessionKey,keyStorage=apiKey?'session':'none';
    if(!apiKey&&data.encryptedApiKey){if(!this.safeStorage?.isEncryptionAvailable())return{apiKey:'',hasApiKey:false,keyStorage:'unavailable'};try{apiKey=this.safeStorage.decryptString(Buffer.from(data.encryptedApiKey,'base64'));keyStorage='secure';}catch{throw Error('地图服务密钥读取失败，请重新配置');}}
    return{apiKey,hasApiKey:!!apiKey,keyStorage};
  }
  async save(input={}){const run=this.queue.catch(()=>{}).then(async()=>{const key=String(input.apiKey||'').trim();if(!input.clear&&!key)return this.config();if(key&&!/^[a-zA-Z0-9]{16,128}$/.test(key))throw Error('请输入有效的天地图服务密钥');
    let encryptedApiKey='',sessionKey='';if(!input.clear&&key){if(this.safeStorage?.isEncryptionAvailable())encryptedApiKey=this.safeStorage.encryptString(key).toString('base64');else sessionKey=key;}
    await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify({encryptedApiKey})+'\n',{mode:0o600});await fs.rename(tmp,this.file);this.sessionKey=sessionKey;this.keyGeneration++;this.tiles.clear();this.inflight.clear();return this.config();});this.queue=run;return run;}
  async tile(input={}) {
    const {x,y,z,type}=input;
    if(!['img_w','cia_w'].includes(type)||![x,y,z].every(Number.isInteger)||z<3||z>18||x<0||y<0||x>=2**z||y>=2**z)throw Error('地图瓦片参数无效');
    const generation=this.keyGeneration,key=`${generation}/${type}/${z}/${x}/${y}`;
    if(this.tiles.has(key)){const bytes=this.tiles.get(key);this.tiles.delete(key);this.tiles.set(key,bytes);return bytes;}
    if(this.inflight.has(key))return this.inflight.get(key);
    const work=(async()=>{const {apiKey}=await this.config();if(!apiKey)throw Error('请先配置天地图服务密钥');
      const url=new URL('https://t0.tianditu.gov.cn/DataServer');for(const [name,value]of Object.entries({T:type,x,y,l:z,tk:apiKey}))url.searchParams.set(name,String(value));
      let bytes;try{const response=await this.fetch(url.toString(),{signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok)throw Error();bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>4*1024*1024)throw Error();}catch{throw Error('地图底图暂不可用，请检查网络、地图密钥或服务额度');}
      if(generation!==this.keyGeneration)throw Error('地图服务配置已变更，请刷新地图');
      this.tiles.set(key,bytes);while(this.tiles.size>64)this.tiles.delete(this.tiles.keys().next().value);return bytes;
    })();this.inflight.set(key,work);try{return await work;}finally{this.inflight.delete(key);}
  }
  async search(value){const keyword=String(value||'').trim();if(keyword.length<2||keyword.length>100)throw Error('请输入 2 至 100 字的村庄或乡镇名称');const {apiKey}=await this.config();if(!apiKey)throw Error('请先配置天地图服务密钥');
    const url=new URL('https://api.tianditu.gov.cn/geocoder');url.searchParams.set('ds',JSON.stringify({keyWord:keyword}));url.searchParams.set('tk',apiKey);
    let response,data;try{response=await this.fetch(url.toString(),{signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok)throw Error();data=await response.json();}catch{throw Error('地图搜索服务暂不可用，请稍后重试或手动标记');}
    const loc=data?.location,lat=Number(loc?.lat),lng=Number(loc?.lon);
    if(String(data?.status)!=='0'||!loc||loc.lat==null||loc.lon==null||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return[];
    return[{name:String(loc.keyWord||keyword),center:[lat,lng]}];
  }
}
module.exports={MapService};
