import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomBytes,pbkdf2Sync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker,{Portal,safePath,equal} from '../cloud/backend/worker.mjs';
import {checks} from './cloud-checks.mjs';
globalThis.crypto ??= webcrypto;
test('paths, throttling, migration, corruption, conflicts, atomic state, request queue',async()=>{
  await checks({Portal,safePath,equal,assert});
});
test('unauthenticated API cannot access OneDrive and CORS rejects other origins',async()=>{
  const p=new Portal({storage:{}},{SESSION_SECRET:'secret',PORTAL_PASSWORD_HASH:'hash'});
  await assert.rejects(()=>p.handle(new Request('https://worker.test/api/state')),e=>e.status===401);
  const response=await worker.fetch(new Request('https://worker.test/api/state',{headers:{Origin:'https://attacker.test'}}),{PORTAL_ORIGIN:'https://ondrama.github.io'});
  assert.equal(response.status,403);
});
test('server password verification, signed session and tamper rejection',async()=>{
  const salt=randomBytes(16),password='a long private test password';
  const hash=salt.toString('base64')+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64');
  const p=new Portal({storage:{}},{SESSION_SECRET:'test-signing-key',PORTAL_PASSWORD_HASH:hash});
  p.limit=async()=>{};
  const login=password=>p.handle(new Request('https://worker.test/api/login',{method:'POST',body:JSON.stringify({password})}));
  await assert.rejects(()=>login('wrong'),e=>e.status===401);
  const {token}=await (await login(password)).json();
  const request=token=>new Request('https://worker.test/api/state',{headers:{Authorization:'Bearer '+token}});
  assert.ok((await p.session(request(token))).exp>Date.now());
  await assert.rejects(()=>p.session(request(token+'x')),e=>e.status===401);
  p.env.PORTAL_PASSWORD_HASH+='changed';
  await assert.rejects(()=>p.session(request(token)),e=>e.status===401);
});
test('cloud HTML scripts compile and preserves edited serial multi-select',async()=>{
  const html=await readFile(new URL('../cloud.html',import.meta.url),'utf8');
  for(const [,code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(code.trim()) new vm.Script(code);
  new vm.Script(await readFile(new URL('../cloud/adapter.js',import.meta.url),'utf8'));
  assert.ok(!html.includes('showDirectoryPicker'));
  assert.ok(!html.includes('showOpenFilePicker'));
  assert.ok(html.includes("TicketCloud.pickFiles('image/*')"));
  assert.ok(html.includes("serialList = (type==='RS11'||type==='P40') ? [...selectedSerials] : ['']"));
  assert.ok(html.includes('async function saveServisRecordCloud()'));
  assert.ok(html.includes('async function saveServisRecord()'));
  assert.ok(!/turnstile/i.test(html));
  const original=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(original.includes('showDirectoryPicker'));
});
