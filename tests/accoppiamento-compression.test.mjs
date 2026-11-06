import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const sandbox={window:{},console,TextEncoder,TextDecoder,Blob,DecompressionStream,
  crypto:webcrypto,atob:s=>Buffer.from(s,'base64').toString('binary'),
  localStorage:{getItem(){return null;},setItem(){}}};
sandbox.globalThis=sandbox;vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),sandbox);
const decode=sandbox.window.AccoppiamentoAuto.decifra;
const legacy=JSON.parse(readFileSync(new URL('./fixture-accoppiamento.json',import.meta.url),'utf8'));
assert.equal((await decode(legacy,'prova-gestionale')).voci.length,3);
const data={offers:Array.from({length:10000},(_,i)=>({sku:String(i),stock:i%17,net:441.1,mpn:'VCG5060T8DFXPB1'}))};
const enc=new TextEncoder(),salt=new Uint8Array(16).fill(1),iv=new Uint8Array(12).fill(2),pwd='offline-test';
const base=await webcrypto.subtle.importKey('raw',enc.encode(pwd),'PBKDF2',false,['deriveKey']);
const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:1000},base,{name:'AES-GCM',length:256},false,['encrypt']);
const aad='accoppiamento-v2-gzip';
const bytes=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,gzipSync(JSON.stringify(data)));
const b64=x=>Buffer.from(x).toString('base64');
const packet={v:2,iter:1000,aad,salt:b64(salt),iv:b64(iv),dati:b64(bytes)};
assert.equal(JSON.stringify(await decode(packet,pwd)),JSON.stringify(data));
await assert.rejects(()=>decode(packet,'wrong'));
await assert.rejects(()=>decode({...packet,v:1},pwd));
await assert.rejects(()=>decode({...packet,aad:'accoppiamento-v1'},pwd),/formato/);
console.log('Legacy and compressed encrypted accounts preserve all price/stock identities.');
