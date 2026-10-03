const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const MAX_FILE = 25 * 1024 * 1024;
const encoder = new TextEncoder();
const scope = 'offline_access Files.ReadWrite.AppFolder';
const json = (value, status = 200) => Response.json(value, {status});
export function safePath(value, directory = false) {
  const pieces = String(value || '').split('/');
  if (pieces.length !== (directory ? 1 : 2) || !pieces[0].startsWith('SERV_'))
    throw new Error('Neplatná cesta přílohy.');
  for (const p of pieces) {
    if (!p || p === '.' || p === '..' || /[\\\/\x00-\x1f:*?"<>|#%]/.test(p) || p.length > 220)
      throw new Error('Neplatný název.');
  }
  return pieces.map(encodeURIComponent).join('/');
}
export function equal(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function encrypt(secret, text, decrypt = false) {
  const key = await crypto.subtle.importKey('raw', unb64(secret), 'AES-GCM', false, ['encrypt','decrypt']);
  if (decrypt) {
    const [iv, data] = text.split('.');
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(data)));
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return b64(iv) + '.' + b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(text)));
}
async function passwordMatches(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash || typeof password !== 'string' || password.length > 256) return false;
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:100000}, key, 256);
  return equal(b64(bits), hash);
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (origin && origin !== env.PORTAL_ORIGIN) return json({error:'Nepovolený původ.'},403);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':env.PORTAL_ORIGIN,
      'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Portal-Version',
      'Access-Control-Max-Age':'600', 'Vary':'Origin'
    }});
    if (url.pathname === '/admin' && request.method === 'GET') return new Response(
      '<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Připojit OneDrive</title><h1>Připojení OneDrivu vlastníka</h1><p>Zadej samostatný instalační klíč. Společné heslo portálu zde neplatí.</p><form method="post" action="/admin/connect"><input type="password" name="key" required autocomplete="off"><button>Připojit OneDrive</button></form>',
      {headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
    const id = env.PORTAL.idFromName('ticket-portal');
    const response = await env.PORTAL.get(id).fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin',env.PORTAL_ORIGIN);
    headers.set('Access-Control-Expose-Headers','X-Portal-Version');
    headers.set('Cache-Control','no-store');
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Vary','Origin');
    return new Response(response.body,{status:response.status,headers});
  }
};
export class Portal {
  constructor(ctx, env) { this.ctx=ctx; this.env=env; this.tail=Promise.resolve(); this.access=null; }
  fetch(request) {
    // Explicit queue spans awaits, including token rotation and OneDrive read/modify/write.
    const next=this.tail.then(()=>this.handle(request));
    this.tail=next.catch(()=>{});
    return next.catch(error=>json({error:error.publicMessage || 'Operace selhala. Data nebyla potvrzena; zkus obnovit portál.'},error.status || 502));
  }
  fail(message,status=400) { const e=new Error(message); e.publicMessage=message; e.status=status; throw e; }
  async limit(key,max,windowMs) {
    const now=Date.now(), storage=this.ctx.storage;
    const old=await storage.get(key);
    const counter=old && old.until>now ? old : {n:0,until:now+windowMs};
    if (++counter.n>max) this.fail('Příliš mnoho pokusů. Zkus to později.',429);
    await storage.put(key,counter);
    await storage.setAlarm(now+windowMs);
  }
  async alarm() {
    for (const [key,value] of await this.ctx.storage.list({prefix:'rate:'}))
      if (value.until<=Date.now()) await this.ctx.storage.delete(key);
    const remaining=await this.ctx.storage.list({prefix:'rate:'});
    if (remaining.size) await this.ctx.storage.setAlarm(Math.min(...[...remaining.values()].map(v=>v.until)));
  }
  async session(request) {
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    const split=token.lastIndexOf('.');
    if (split<0) this.fail('Přihlas se heslem portálu.',401);
    const payload=token.slice(0,split),sig=token.slice(split+1);
    if (!equal(sig,await hmac(this.env.SESSION_SECRET + this.env.PORTAL_PASSWORD_HASH,payload))) this.fail('Neplatné přihlášení.',401);
    let data; try {data=JSON.parse(atob(payload));} catch {this.fail('Neplatné přihlášení.',401);}
    if (data.exp<Date.now()) this.fail('Přihlášení vypršelo. Zadej znovu heslo.',401);
    return data;
  }
  async handle(request) {
    const u=new URL(request.url), path=u.pathname, ip=request.headers.get('CF-Connecting-IP')||'unknown';
    if (path==='/api/login' && request.method==='POST') {
      await this.limit('rate:login:'+ip,5,15*60000);
      await this.limit('rate:login:global',100,15*60000);
      if (Number(request.headers.get('Content-Length'))>2048) this.fail('Požadavek je příliš velký.',413);
      const raw=await request.text(); if(raw.length>2048) this.fail('Požadavek je příliš velký.',413);
      let body; try {body=JSON.parse(raw);}catch{this.fail('Neplatný požadavek.');}
      if (!await passwordMatches(body.password,this.env.PORTAL_PASSWORD_HASH)) this.fail('Nesprávné heslo.',401);
      const payload=btoa(JSON.stringify({exp:Date.now()+8*3600000,nonce:crypto.randomUUID()}));
      return json({token:payload+'.'+await hmac(this.env.SESSION_SECRET + this.env.PORTAL_PASSWORD_HASH,payload)});
    }
    if(path==='/admin/connect' && request.method==='POST') {
      await this.limit('rate:admin:'+ip,5,15*60000);
      const form=await request.formData();
      if (!this.env.ADMIN_SETUP_KEY || !equal(String(form.get('key')||''),this.env.ADMIN_SETUP_KEY)) this.fail('Nesprávný instalační klíč.',401);
      const state=crypto.randomUUID(), verifier=b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+\/=]/g,'');
      const challenge=b64(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      await this.ctx.storage.put('oauth:'+state,{verifier,until:Date.now()+10*60000});
      const url=new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
      url.search=new URLSearchParams({client_id:this.env.MS_CLIENT_ID,response_type:'code',
        redirect_uri:this.env.PUBLIC_URL+'/oauth/callback',scope,state,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
      return Response.redirect(url.toString(),303);
    }
    if(path==='/oauth/callback' && request.method==='GET') {
      const state=u.searchParams.get('state'), pending=await this.ctx.storage.get('oauth:'+state);
      await this.ctx.storage.delete('oauth:'+state);
      if(!pending || pending.until<Date.now()) this.fail('Připojení vypršelo. Spusť připojení znovu.',401);
      if(!u.searchParams.get('code')) this.fail('Připojení bylo zrušeno.');
      const token=await this.exchange({grant_type:'authorization_code',code:u.searchParams.get('code'),
        redirect_uri:this.env.PUBLIC_URL+'/oauth/callback',code_verifier:pending.verifier});
      await this.storeToken(token);
      await this.graph(''); // creates /Apps/TicketPortal
      return new Response('OneDrive je připojen. V OneDrivu otevři Apps / TicketPortal a nahraj do ní obsah původní složky Data. Potom otevři cloud.html portálu.',{headers:{'Content-Type':'text/plain;charset=utf-8'}});
    }
    await this.session(request);
    await this.limit('rate:api:'+ip,1200,3600000);
    if(path==='/api/state' && request.method==='GET') {
      const result=await this.readState();
      return json(result);
    }
    if(path==='/api/state' && request.method==='PUT') {
      const raw=await request.text();
      if(raw.length>4*1024*1024) this.fail('Záznamy jsou příliš velké.',413);
      let value;try{value=JSON.parse(raw);}catch{this.fail('Neplatné záznamy.');}
      if(!Array.isArray(value.servis) || !Array.isArray(value.dily)) this.fail('Neplatný formát záznamů.');
      const current=await this.readState();
      if(!equal(request.headers.get('X-Portal-Version')||'',current.version)) this.fail('Jiný kolega mezitím změnil data. Obnov portál a zopakuj změnu.',409);
      const response=await this.graph(':/portal-state.json:/content',{method:'PUT',
        headers:{'Content-Type':'application/json',...(current.version==='missing'?{}:{'If-Match':current.version})},
        body:JSON.stringify({schema:1,servis:value.servis,dily:value.dily})});
      const item=await response.json();
      return json({version:item.eTag});
    }
    if(path==='/api/directory' && request.method==='POST') {
      const body=await request.json(), name=safePath(body.path,true);
      const existing=await this.graph(':/'+name,{},true);
      if(existing.status===404) {
        await this.graph('/children',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:body.path,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});
      } else if(!(await existing.json()).folder) this.fail('Cesta není složka.');
      return json({ok:true});
    }
    if(path==='/api/file') {
      const file=safePath(u.searchParams.get('path'));
      if(request.method==='GET') {
        const response=await this.graph(':/'+file+':/content',{},true);
        if(response.status===404) return json({error:'Příloha nebyla nalezena.'},404);
        return new Response(response.body,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream'}});
      }
      if(request.method==='PUT') {
        if(Number(request.headers.get('Content-Length'))>MAX_FILE) this.fail('Příloha může mít nejvýše 25 MB.',413);
        const body=await request.arrayBuffer();if(body.byteLength>MAX_FILE) this.fail('Příloha může mít nejvýše 25 MB.',413);
        // New attachments have UUID names; existing files are never overwritten.
        const existing=await this.graph(':/'+file,{},true);
        if(existing.status!==404) this.fail('Příloha již existuje. Zvol jiné jméno.',409);
        await this.graph(':/'+file+':/content',{method:'PUT',body});
        return json({ok:true});
      }
    }
    // Deleting a record leaves its attachments in OneDrive for recovery.
    if(path==='/api/directory' && request.method==='DELETE') {safePath(u.searchParams.get('path'),true);return json({ok:true});}
    this.fail('Neznámá operace.',404);
  }
  async exchange(params) {
    const response=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{
      method:'POST',body:new URLSearchParams({client_id:this.env.MS_CLIENT_ID,client_secret:this.env.MS_CLIENT_SECRET,scope,...params})});
    if(!response.ok) this.fail('OneDrive vyžaduje nové připojení vlastníkem přes /admin.',503);
    return response.json();
  }
  async storeToken(token) {
    if(!token.refresh_token) this.fail('Microsoft neposkytl obnovovací token.',503);
    await this.ctx.storage.put('refresh',await encrypt(this.env.TOKEN_ENCRYPTION_KEY,token.refresh_token));
    this.access={value:token.access_token,until:Date.now()+(token.expires_in-120)*1000};
  }
  async accessToken() {
    if(this.access && this.access.until>Date.now()) return this.access.value;
    const encrypted=await this.ctx.storage.get('refresh');
    if(!encrypted) this.fail('Vlastník musí nejdřív připojit OneDrive přes /admin.',503);
    const refresh=await encrypt(this.env.TOKEN_ENCRYPTION_KEY,encrypted,true);
    await this.storeToken(await this.exchange({grant_type:'refresh_token',refresh_token:refresh}));
    return this.access.value;
  }
  async graph(suffix, options={}, allowMissing=false) {
    const token=await this.accessToken();
    const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+token);
    const response=await fetch(GRAPH+suffix,{...options,headers});
    if(response.status===404 && allowMissing) return response;
    if(!response.ok) {
      if(response.status===401) this.access=null;
      this.fail(response.status===412?'Data byla mezitím změněna. Obnov portál.':'OneDrive operaci odmítl ('+response.status+'). Zkus to později.',response.status===412?409:502);
    }
    return response;
  }
  async readState() {
    const meta=await this.graph(':/portal-state.json',{},true);
    if(meta.status!==404) {
      const item=await meta.json();
      const response=await this.graph(':/portal-state.json:/content');
      const state=await response.json();
      if(state.schema!==1 || !Array.isArray(state.servis) || !Array.isArray(state.dily)) this.fail('Poškozený portal-state.json; soubor nebude přepsán.',422);
      return {...state,version:item.eTag};
    }
    const legacy=async name=>{
      const response=await this.graph(':/'+name+':/content',{},true);
      if(response.status===404) return [];
      let value;try{value=await response.json();}catch{this.fail('Poškozený '+name+'; soubor nebude přepsán.',422);}
      if(!Array.isArray(value)) this.fail('Neplatný '+name,422);
      return value;
    };
    return {schema:1,servis:await legacy('servisni.json'),dily:await legacy('dily.json'),version:'missing'};
  }
}
