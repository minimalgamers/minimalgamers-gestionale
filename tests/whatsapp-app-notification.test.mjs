import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const notification=app.slice(app.indexOf('function showNotification'),app.indexOf('// v20: lock in-memory'));
function fixture(){
  const nodes=[],timers=[];
  const node=tag=>({tag,style:{},children:[],appendChild(n){this.children.push(n);},remove(){this.removed=true;}});
  const doc={createElement:node,body:node('body')};
  doc.body.appendChild=n=>nodes.push(n);
  const s={document:doc,setTimeout:(fn,ms)=>{timers.push({fn,ms});},window:{open(){throw Error('No new tabs allowed');}}};
  vm.createContext(s);vm.runInContext(notification,s);
  return {s,nodes,timers};
}

test('WhatsApp retry lives in the existing notification, same-tab link and 44px touch target',()=>{
  const {s,nodes,timers}=fixture();
  const href='whatsapp://send?phone=393331234567&text='+encodeURIComponent('Ciao! 👋\nhttps://example.invalid/?c=PC2');
  s.showNotification('Messaggio pronto','success',{href,label:'Apri WhatsApp'});
  const anchor=nodes[0].children.find(n=>n.tag==='a');
  assert.equal(anchor.href,href);assert.equal(anchor.target,'_self');
  assert.equal(anchor.textContent,'Apri WhatsApp');
  assert.match(anchor.style.cssText,/min-height: 44px/);
  assert.equal(timers.at(-1).ms,30000);
  assert.equal(nodes[0].children.filter(n=>n.tag==='iframe').length,0);
});

test('ordinary notifications preserve their original duration and have no app link',()=>{
  const {s,nodes,timers}=fixture();s.showNotification('Ordini aggiornati','success');
  assert.equal(nodes[0].children.length,0);assert.equal(timers.at(-1).ms,2000);
});

for(const href of ['javascript:alert(1)','https://example.invalid/','whatsapp://other?phone=1&text=hi']){
  test('notification rejects a non-WhatsApp retry URL: '+href,()=>{
    const {s,nodes,timers}=fixture();s.showNotification('Messaggio','info',{href,label:'Apri'});
    assert.equal(nodes[0].children.length,0);assert.equal(timers.at(-1).ms,2000);
  });
}

test('retry label is literal text, never HTML',()=>{
  const {s,nodes}=fixture();s.showNotification('Messaggio','success',{
    href:'whatsapp://send?phone=393331234567&text=test',label:'<img src=x onerror=alert(1)>'});
  const anchor=nodes[0].children.find(n=>n.tag==='a');
  assert.equal(anchor.textContent,'<img src=x onerror=alert(1)>');assert.equal(anchor.innerHTML,undefined);
});
