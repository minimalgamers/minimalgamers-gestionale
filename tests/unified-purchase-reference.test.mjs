import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const J=x=>JSON.parse(JSON.stringify(x));
const SKU='PROAMDRYZ0296';
function fixture(){
 const cache={},calls=[],overlays=[];
 const s={window:{},console:{log(){},warn(){},error(){}},processedOrdersCache:cache,
  localStorage:{getItem:()=>null,setItem(){}},showNotification(){}};
 vm.createContext(s);vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),s);
 const A=s.window.AccoppiamentoAuto;A.riepilogo.modo='manuale';const cards=[],data={ordini:{}};
 for(let i=0;i<35;i++){
  const id=String(1000+i),old=i===34?SKU:`OLD-${i}`,c={id:i+1,type:'CPU',ean:old,name:'AMD Ryzen 5 9600X',supplier:'ACTION',quantity:1,price:null};
  cache[id]={components:[c]};cards.push({id,nome:`#${id}`,foglio:1,salvati:[c],righe:[{tipo:'CPU',ean:old,nome:c.name,fornitore:'ACTION',quantita:1,costo:136.96,fonte:'listino'}]});
  data.ordini[id]={nome:`#${id}`,pc:[{quantita:1,pezzi:[{tipo:'CPU',auto:{codice:SKU,fornitore:'ACTION',descrizione:c.name,costo:136.96,
   quantita:1,stock:40,stock_libero_prima:i===34?6:40,disponibilita:'40 pz',prezzo_listino:136.96}}]}]};
 }
 s.window.SupabaseDB={replacePurchaseComponent:async(id,p)=>{calls.push({id,p:J(p)});return {component:{id:p.expected.id,type:p.expected.type,...p.replacement,price:null}};},
  setProcurementExclusion:async(id,p)=>{calls.push({id,exclusion:J(p)});return {[A.K_ESCLUSIONI_ACQUISTO]:{[p.key]:{...p,escluso:true}}};}};
 s.document={getElementById:id=>id==='accoppiamento-auto-style'?{}:null,body:{appendChild:o=>overlays.push(o)},
  createElement:()=>{const controls={};const o={innerHTML:'',remove(){},querySelector:q=>q==='.acc-finestra-corpo'?{}:
   controls[q] ||= {addEventListener:(_t,fn)=>{controls[q].click=fn;}}};return o;}};
 return {A,s,cache,calls,cards,data,overlays,plan:()=>A.daOrdinare(data,cards,{})};
}

test('34 pending plus one ready CPU render as one reference in both views without changing any operational row',()=>{
 const {A,plan}=fixture(),r=plan(),before=J(r),views=A.raggruppaReferenzeAcquisto(r.fornitori[0].righe);
 assert.equal(r.righe.length,2);assert.equal(views.length,1);assert.equal(views[0].quantita,35);assert.equal(views[0].costo,4793.60);
 for(const html of [A.htmlFornitoriDaOrdinare(r),A.htmlCategorieDaOrdinare(r)]){
  assert.equal((html.match(/class="supplier-item(?: |")/g)||[]).length,1);
  assert.match(html,/x35/);assert.match(html,/4793,60/);assert.match(html,/1 pronto per la copia/);assert.match(html,/34 da confermare/);
  assert.match(html,/data-rf-applica="0"/);assert.doesNotMatch(html,/data-rf-applica="1"/);
  assert.match(html,/data-rf-cambia-gruppo="0,1"/);assert.match(html,/Stock libero: 40 pezzi/);assert.doesNotMatch(html,/Stock libero: 46/);
 }
 assert.equal(A.testoOrdineFornitore(r.fornitori[0]),`x1 | ${SKU} - AMD Ryzen 5 9600X`);
 const email=A.ordiniEmail(r,{invii:[{id:'a',fornitori:['ACTION'],a:['buyer@example.test']}]});assert.equal(email.invii[0].pezzi,1);
 assert.deepEqual(J(r),before);assert.equal(r.pronti,1);assert.equal(r.daApplicare,34);
 const target=A.bersaglioReferenzaVista(r,'0,1');assert.equal(target.pezzi.length,35);assert.equal(new Set(target.pezzi.map(p=>p.componentId)).size,35);
});

test('confirming the pending action uses only its 34 original BOM identities; grouped replacement can select an explicit subset',async()=>{
 const {A,plan,overlays,calls,cache}=fixture(),r=plan(),pending=r.righe.find(x=>x.daApplicare);
 const action=A.confermaPropostaAcquisto(pending);overlays[0].querySelector('[data-si]').click();await action;
 assert.equal(calls.length,34);assert.ok(calls.every(c=>c.p.source==='allocation_plan'&&c.id!=='1034'));
 assert.equal(cache['1034'].components[0].ean,SKU);assert.equal(calls[0].p.expected.ean,'OLD-0');
 const other=fixture(),p=other.plan(),g=other.A.bersaglioReferenzaVista(p,'0,1');
 await other.A.salvaCambio({codice:'OTHER-CPU',fornitore:'ABACO',descrizione:'Explicit choice'},[g.pezzi[0],g.pezzi.at(-1)]);
 assert.deepEqual(other.calls.map(c=>c.id),['1000','1034']);assert.equal(other.cache['1001'].components[0].ean,'OLD-1');
});

test('blocked and excluded quantities stay distinct, while grouped trash never edits the assembly BOM',async()=>{
 const f=fixture();for(let i=0;i<34;i++)f.data.ordini[String(1000+i)].pc[0].pezzi[0].auto.disponibilita='5 pz';
 const r=f.plan(),pending=r.righe[0],ready=r.righe[1];assert.equal(pending.poco,5);
 const html=f.A.htmlFornitoriDaOrdinare(r);assert.match(html,/1 pronto per la copia/);assert.match(html,/0 da confermare/);assert.match(html,/34 bloccati/);
 assert.match(html,/Stock verificato 5 \/ richiesti 34/);assert.match(html,/data-rf-applica="0" disabled/);
 assert.match(f.A.testoOrdineFornitore(r.fornitori[0]),/^x1 /);
 const bom=J(f.cache);await f.A.modificaEsclusioneAcquisto(f.A.bersaglioReferenzaVista(r,'0,1'),true);
 assert.equal(f.calls.length,35);for(const id of Object.keys(f.cache))assert.deepEqual(J(f.cache[id].components),bom[id].components);
 const excluded=f.plan();assert.equal(excluded.pezzi,0);assert.equal(excluded.esclusioni.length,35);
 assert.equal(f.A.htmlFornitoriDaOrdinare(excluded).includes('x35'),false);
 assert.equal(ready.quantita,1);
});

test('exact supplier, category and nonempty SKU define a view group; unknown references and mixed action keys are rejected',()=>{
 const {A,plan}=fixture(),r=plan(),base=r.fornitori[0].righe[0];
 const rows=[base,{...base,n:2,fornitore:'ABACO'},{...base,n:3,categoria:'MOBO'},{...base,n:4,codice:'OTHER'},
  {...base,n:5,codice:''},{...base,n:6,codice:''},{...base,n:7,fornitore:'DA SCEGLIERE'},{...base,n:8,fornitore:'DA SCEGLIERE'}];
 assert.equal(A.raggruppaReferenzeAcquisto(rows).length,8);
 r.righe.push(rows[2]);r.fornitori[0].righe.push(rows[2]);assert.equal(A.bersaglioReferenzaVista(r,'0,3'),null);
 assert.equal(A.bersaglioReferenzaVista(r,'0,0'),null);assert.equal(A.bersaglioReferenzaVista(r,'0,999'),null);
});

test('different and missing source costs are shown individually, never as a manufactured average unit price',()=>{
 const {A,plan}=fixture(),r=plan();r.righe[1].costo=139;r.righe[1].costiVista=[{quantita:1,unitario:139}];
 const f=r.fornitori[0];f.righe=f.righe.map(x=>x.n===1?{...x,costo:139,costiVista:[{quantita:1,unitario:139}]}:x);
 const html=A.htmlFornitoriDaOrdinare(r);assert.match(html,/Prezzi netti unitari: <b>136,96 € \/ 139,00 €/);
 assert.match(html,/34 × 136,96 €/);assert.match(html,/1 × 139,00 €/);
 f.righe[1].costo=0;f.righe[1].senzaCosto=true;f.righe[1].costiVista=[{quantita:1,unitario:null}];
 assert.match(A.htmlFornitoriDaOrdinare(r),/Costo non disponibile/);assert.match(A.htmlFornitoriDaOrdinare(r),/1 pezzo senza costo/);
});
