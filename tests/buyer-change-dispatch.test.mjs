import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const J=x=>JSON.parse(JSON.stringify(x));
const comp=(id,type='GPU',ean='ARC-B580',price=null)=>({id,type,ean,name:ean,supplier:'ACTION',quantity:1,price});
const chosen={tipo:'mg-buyer-scelta',codice:'ARC-B570',fornitore:'ACTION',descrizione:'Intel Arc B570 10GB',prezzo:180};
const tick=()=>new Promise(setImmediate);

// A minimal DOM for the real dialog event handlers; no callbacks are replaced.
function fixture(){
 const overlays=[],listeners={},writes=[],notices=[],storage=new Map(),buyer={name:'buyer'};
 class Node{
  constructor(tag='div',attrs={},root=null){this.tag=tag;this.attrs=attrs;this.root=root||this;this.nodes=[];this.events={};
   this.dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
   this.checked='checked'in attrs;this.value=attrs.value||'';this.className=attrs.class||'';this.classList={toggle(){}};this.isConnected=false;}
  set innerHTML(html){this.html=html;if(this.root!==this)return;this.nodes=[];
   for(const [,tag,raw]of html.matchAll(/<([a-z]+)\b([^>]*)>/gi)){
    const attrs={};for(const [,k,v]of raw.matchAll(/([^\s=]+)(?:="([^"]*)")?/g))attrs[k]=v??'';
    this.nodes.push(new Node(tag,attrs,this));
   }}
  get innerHTML(){return this.html||'';}
  matches(q){const tag=/^([a-z]+)/.exec(q)?.[1];if(tag&&tag!==this.tag)return false;
   const cls=/^\.([\w-]+)/.exec(q)?.[1];if(cls&&!this.className.split(/\s+/).includes(cls))return false;
   for(const [,k,v]of q.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)){if(!(k in this.attrs)||(v!==undefined&&this.attrs[k]!==v))return false;}
   if(q.includes(':checked')&&!this.checked)return false;return true;}
  querySelectorAll(q){return this.root.nodes.filter(n=>n.matches(q));}
  querySelector(q){return this.querySelectorAll(q)[0]||null;}
  closest(q){return this.matches(q)?this:null;}
  addEventListener(type,fn){this.events[type]=fn;}
  setAttribute(k,v){this.attrs[k]=v;}
  remove(){this.isConnected=false;}
 }
 const document={createElement:()=>new Node(),head:{appendChild(){}},getElementById:id=>id==='accoppiamento-auto-style'?{}:null,
  body:{appendChild(n){n.isConnected=true;overlays.push(n);}},querySelector:()=>null,
  querySelectorAll:q=>q==='.acc-finestra'?overlays.filter(o=>o.isConnected):[]};
 const cache={'77.1':{components:[comp(10),comp(11,'RAM','DDR5')]},'77.2':{components:[comp(12)]},
  '88':{components:[comp(13)]},'99':{components:[comp(14,'GPU','ARC-B580',190)]}};
 const s={document,console:{log(){},warn(){},error(){}},showNotification:(t,k)=>notices.push({t,k}),
  processedOrdersCache:cache,sessionStorage:{getItem:()=>JSON.stringify([{id:77},{id:88},{id:99}])},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  window:{open:()=>buyer,addEventListener:(type,fn)=>listeners[type]=fn}};
 vm.createContext(s);vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),s);
 const A=s.window.AccoppiamentoAuto;A.riepilogo.modo='manuale';A.stato.dati={ordini:{}};A.stato.promessa=Promise.resolve(A.stato.dati);A.stato.caricatoIl=Date.now();
 s.window.SupabaseDB={replacePurchaseComponent:async(id,p)=>{
  const c=cache[id].components.find(c=>c.id===p.expected.id);assert.equal(c.ean,p.expected.ean);assert.equal(c.price,null);
  writes.push({id,p:J(p)});return {component:{...c,...p.replacement,type:c.type,price:c.price}};
 },setProcurementExclusion:async(id,p)=>{writes.push({id,exclude:J(p)});return {[A.K_ESCLUSIONI_ACQUISTO]:{[p.key]:{...p,escluso:p.excluded}}};}};
 const press=(ov,q)=>{const node=ov.querySelector(q);assert.ok(node,q);node.events.click?.({target:node});ov.events.click?.({target:node});};
 const message=(data=chosen)=>listeners.message({origin:'https://listini.minimalgamers.it',source:buyer,data});
 return {s,A,cache,writes,notices,overlays,press,message};
}

test('Buyer Desk allocation objects confirm only checked PC rows instead of calling a nonexistent proposal callback',async()=>{
 for(const mode of ['pending','ready','manual']){
  const f=fixture(),{A,cache}=f;
  const a={codice:mode==='pending'?'PROPOSED':'ARC-B580',fornitore:'ACTION',descrizione:'Intel Arc GPU',quantita:1,costo:200,stock:10};
  const data=mode==='manual'?null:{ordini:{77:{pc:[{quantita:2,pezzi:[{tipo:'GPU',auto:a}]}]}}};
  const cards=['77.1','77.2'].map(id=>({id,nome:`#${id}`,foglio:1,salvati:[cache[id].components[0]],
   righe:[{tipo:'GPU',ean:'ARC-B580',fornitore:'ACTION',nome:'Intel Arc B580',quantita:1,costo:200,fonte:'listino'}]}));
  const r=A.daOrdinare(data,cards,{}).righe[0],before=J(cache);A.apriCambio(r);f.message();await tick();
  assert.equal(f.notices.some(n=>/non riuscito/.test(n.t)),false,mode);
  const dialog=f.overlays.at(-1);assert.ok(dialog?.isConnected,`confirmation for ${mode}`);
  dialog.querySelectorAll('input[data-pc]')[1].checked=false;
  f.press(dialog,'[data-si]');await tick();
  assert.deepEqual(f.writes.map(x=>x.id),['77.1']);assert.equal(f.writes[0].p.source,'buyer_desk');
  assert.deepEqual(f.writes[0].p.expected,{id:10,type:'GPU',ean:'ARC-B580',supplier:'ACTION',quantity:1});
  assert.equal(cache['77.1'].components[0].ean,'ARC-B570');assert.equal(cache['77.1'].components[0].name,chosen.descrizione);
  assert.deepEqual(J(cache['77.1'].components[1]),before['77.1'].components[1]);
  for(const id of ['77.2','88','99'])assert.deepEqual(J(cache[id].components),before[id].components);
 }
});

test('the real bulk-offer callback changes its preview selection without persisting assembly rows',async()=>{
 const f=fixture(),{A}=f,proposals=[{orderId:'77.1',ordine:'#77 PC1',tipo:'GPU',quantita:1,
  da:{ean:'ARC-B580',nome:'Intel Arc B580',costo:200},a:{codice:'PROPOSED',fornitore:'ACTION',descrizione:'Default GPU',costo:195}}];
 const done=A.finestraProposte('Refresh','',proposals),dialog=f.overlays.at(-1);
 f.press(dialog,'[data-prop-bd="0"]');assert.equal(A.cambio.riga.proposta,true);
 f.message();await tick();assert.equal(proposals[0].scelta.codice,'ARC-B570');assert.equal(proposals[0].scelta.costo,180);
 assert.equal(A.cambio.riga,null);assert.equal(f.writes.length,0);assert.equal(f.cache['77.1'].components[0].ean,'ARC-B580');
 f.press(dialog,'[data-prop-cambia="selezionati"]');const result=await done;
 assert.equal(result.scelte.length,1);assert.equal(result.scelte[0].scelta.codice,'ARC-B570');
});

test('a direct order-card choice uses its own confirmation and retains paid, frozen and stale identity guards',async()=>{
 const f=fixture(),{A,cache}=f;
 cache['77.1'].components[0].quantity=2;
 A.apriCambioPezzo('77.1',{tipo:'GPU',ean:'ARC-B580',fornitore:'ACTION',nome:'Intel Arc B580'});
 f.message();await tick();f.press(f.overlays.at(-1),'[data-si]');await tick();
 assert.deepEqual(f.writes.map(x=>x.id),['77.1']);assert.equal(cache['77.2'].components[0].ean,'ARC-B580');
 assert.equal(f.writes[0].p.expected.quantity,2);assert.equal(f.writes[0].p.replacement.quantity,2);
 assert.equal(cache['77.1'].components[0].quantity,2);
 const before=J(cache['99'].components);A.apriCambioPezzo('99',{tipo:'GPU',ean:'ARC-B580',fornitore:'ACTION'});
 assert.equal(A.cambio.riga,null);assert.deepEqual(J(cache['99'].components),before);
 const target={id:'77.2',tipo:'GPU',ean:'ARC-B580',fornitore:'ACTION',componentId:12,quantita:1};
 cache['77.2'].customProperties={_acquisto_confermato_gestionale:{righe:[{tipo:'GPU',ean:'ARC-B580',costo:200}]}};
 await assert.rejects(()=>A.sostituisciAcquisto(target,chosen),/storico protetto/);
 cache['77.2'].customProperties={};cache['77.2'].components[0].ean='CHANGED';
 await assert.rejects(()=>A.sostituisciAcquisto(target,chosen),/cambiata/);assert.equal(f.writes.length,1);
});

test('an invalid interactive callback is a clear error, and messages from other windows cannot change its target',async()=>{
 const f=fixture(),{A}=f;
 A.cambio.riga={proposta:true,pezzi:[{id:'77.1',tipo:'GPU'}]};
 await assert.rejects(()=>A.applicaScelta(chosen),/Finestra proposte non più disponibile/);
 assert.equal(f.writes.length,0);
 A.apriCambio({codice:'OLD',proposta:{codice:'PROPOSED'},pezzi:[{id:'77.1',tipo:'GPU'}]});
 assert.equal(A.sceltaValida('https://listini.minimalgamers.it',chosen,{}),false);
 assert.equal(A.sceltaValida('https://other.example',chosen,A.cambio.finestra),false);
 assert.equal(f.writes.length,0);
});

test('cancelling a grouped change writes nothing and procurement trash never changes the assembly',async()=>{
 const f=fixture(),{A,cache}=f,before=J(cache);
 const target=A.identitaAcquisto({id:'77.1',nome:'#77 PC1',foglio:1},{tipo:'GPU',ean:'ARC-B580',fornitore:'ACTION',quantita:1},cache['77.1'].components[0]);
 const group={codice:'PROPOSED',proposta:{codice:'PROPOSED'},pezzi:[target]};
 A.apriCambio(group);f.message();await tick();f.press(f.overlays.at(-1),'[data-no]');await tick();
 assert.equal(f.writes.length,0);assert.deepEqual(J(cache),before);
 await A.modificaEsclusioneAcquisto(group,true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].exclude.excluded,true);
 assert.deepEqual(J(cache['77.1'].components),before['77.1'].components);
});
