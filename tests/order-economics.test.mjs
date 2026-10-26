import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
function env(){
 const data=new Map();
 const s={window:{},console,setTimeout,clearTimeout,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},
  processedOrdersCache:{},identifyPCConfig:n=>/PC GAMING/.test(n)?{configKey:'PC GAMING TEST',components:[]}:null};
 vm.createContext(s);vm.runInContext(read('assets/js/multi-order-handler.js'),s);vm.runInContext(read('assets/js/accoppiamento-auto.js'),s);
 return {s,A:s.window.AccoppiamentoAuto};
}
const pc={id:1,product_id:123,name:'PC GAMING TEST',price:'1513.00',quantity:1};
const key={id:2,name:'Havit tastiera',sku:'KEY',quantity:1,price:'50.00',discount_allocations:[{amount:'5.00'}]};
const mouse={id:3,name:'Logitech mouse',sku:'MOUSE',quantity:1,price:'40.00'};

test('actual Shopify order receipts remain historical when current GPU Watch retail price changes',()=>{
 const {A}=env();const o={id:77,line_items:[pc,key,mouse],total_price:'1622.90',created_at:'2026-10-21'};
 const a=A.prezzoVendita('77',[o],{listino_oggi:1591});
 assert.equal(a.pc,1513);assert.equal(a.accessori,90);assert.equal(a.sconti,5);assert.equal(a.spedizione,24.9);assert.equal(a.totale,1622.9);
 assert.equal(A.prezzoVendita('77',[o],{listino_oggi:9999}).totale,1622.9);
 assert.equal(a.altri.length,0);
});

test('same assignment for multiple PC units and excess standalone accessories; shipping reconciles to cents',()=>{
 const {A}=env();const o={id:77,line_items:[{...pc,price:'1000',quantity:3},{...key,quantity:4,discount_allocations:[]}],total_price:'3200.01'};
 const receipts=[1,2,3].map(i=>A.prezzoVendita(`77.${i}`,[o],{}));
 assert.deepEqual(receipts.map(x=>x.accessori),[100,50,50]);
 assert.deepEqual(receipts.map(x=>x.spedizione),[0.01,0,0]);
 assert.equal(Math.round(receipts.reduce((t,x)=>t+x.totale,0)*100),320001);
});

test('zero current quantities do not return as sold components or accessories',()=>{
 const {A}=env();const o={id:77,line_items:[pc,{...key,current_quantity:0}],total_price:'1563',current_total_price:'1537.90'};
 const v=A.prezzoVendita('77',[o],{});
 assert.equal(v.accessori,0);assert.equal(v.spedizione,24.9);assert.equal(v.totale,1537.9);assert.equal(v.rimborsato,true);
});

test('missing-cost panel identifies exact part and edit command without hiding in warnings',()=>{
 const {A}=env();const html=A.pannelloCostiMancanti([{tipo:'COOLER',ean:'DPAG300',descrizione:'DeepCool AG300',fornitore:'ABACO',quantita:1},
  {tipo:'CASE',descrizione:'<img src=x>',ean:'CG530',quantita:2}]);
 assert.match(html,/DeepCool AG300/);assert.match(html,/ABACO/);assert.match(html,/Inserisci costo/);assert.match(html,/×2/);
 assert.ok(!html.includes('<img src=x>'));
 assert.equal(A.pannelloCostiMancanti([]),'');
});

test('cost entry accepts Italian money and explicit zero, rejects incomplete or invalid numbers',()=>{
 const {A}=env();for(const [input,n] of [['28,69',28.69],['1.234,56',1234.56],['1234.56',1234.56],['0',0]])assert.equal(A.numeroCosto(input),n);
 for(const bad of ['',null,'-1','10abc','Infinity','3,141','1,2,3'])assert.equal(A.numeroCosto(bad),null);
});

test('one product correction applies to all orders, preserves paid prices and quantities, resets for all',async()=>{
 const {s,A}=env();const old={CASE:'WHITE',_costi_netti_gestionale:{}};
 s.processedOrdersCache[77]={customProperties:old,components:[{type:'RAM',ean:'R',quantity:2,price:null}]};
 let saved, sequenza=0;
 s.window.SupabaseDB={saveOrderCost:async(id,v)=>{
  assert.equal(id,77);saved=v;
  const costs={...old._costi_netti_gestionale};costs[v.chiave]={unitario:v.unitario,il:new Date(1000*++sequenza).toISOString(),ambito:v.ambito,alias:v.alias,...(v.unitario===null?{annullato:true}:{})};
  return {...old,_costi_netti_gestionale:costs};
 }};
 const part={tipo:'RAM',ean:'R',fornitore:'ACTION',quantita:2};
 await A.salvaCostoInserito(77,part,20);
 assert.equal(saved.unitario,20);assert.equal(A.costoInseritoOrdine(77,'RAM','R','ACTION',2),40);
 assert.equal(A.costoInseritoOrdine(78,'RAM','R','ACTION',2),40);
 assert.equal(A.costoInseritoOrdine(77,'RAM','R','ABACO',2),null);
 assert.equal(s.processedOrdersCache[77].components[0].price,null);
 assert.equal(s.processedOrdersCache[77].customProperties.CASE,'WHITE');
 await A.salvaCostoInserito(77,part,0);assert.equal(A.costoInseritoOrdine(77,'RAM','R','ACTION',2),0);
 await A.salvaCostoInserito(77,part,null);assert.equal(A.costoInseritoOrdine(77,'RAM','R','ACTION',2),null);
 assert.equal(A.costoInseritoOrdine(78,'RAM','R','ACTION',2),null);
});

test('already entered AK400 cost is recovered for existing, future and multiple-unit orders',()=>{
 const {s,A}=env();s.processedOrdersCache[77]={customProperties:JSON.stringify({_costi_netti_gestionale:{
  'COOLER|6933412729495|ACTION':{unitario:20,il:'2026-10-26T11:40:22.431Z'}}})};
 for(const id of [77,78,'78.2',999])assert.equal(A.costoInseritoOrdine(id,'COOLER','6933412729495','ACTION',2),40);
 assert.equal(A.costoInseritoOrdine(78,'COOLER','6933412729495','OMEGA'),null);
 assert.equal(A.costoInseritoOrdine(78,'COOLER','OTHER','ACTION'),null);
});

test('product aliases share the latest correction; reset cannot resurrect an older cost',()=>{
 const {A}=env();const a='COOLER|EAN|ACTION',b='COOLER|SKU|ACTION';
 const old={unitario:20,il:'2026-10-26T10:00:00Z',alias:[b,'COOLER|SKU|OMEGA']};
 const newer={unitario:22,il:'2026-10-26T11:00:00Z'};
 let i=A.indiceCostiProdotto([{[a]:old},{[b]:newer}]);assert.equal(i[a].unitario,22);assert.equal(i[b].unitario,22);
 assert.equal(i['COOLER|SKU|OMEGA'],undefined);
 i=A.indiceCostiProdotto([{[a]:old},{[b]:{unitario:null,annullato:true,il:'2026-10-26T12:00:00Z'}}]);
 assert.equal(i[a].unitario,null);assert.equal(i[b].annullato,true);
 assert.equal(A.indiceCostiProdotto([{[a]:old},{[a]:{...old,unitario:99}}])[a].conflitto,true);
});

test('personal order expenses and invalid amounts never spread as product costs',()=>{
 const {s,A}=env();s.processedOrdersCache[77]={customProperties:{_costi_netti_gestionale:{
  'PERSONALIZZATO|CUSTOM1|':{unitario:12},'COOLER|R|ACTION':{unitario:-1},'RAM|R|ACTION':{unitario:12,ambito:'ordine'}}}};
 assert.equal(A.costoInseritoOrdine(77,'PERSONALIZZATO','CUSTOM1',''),12);
 assert.equal(A.costoInseritoOrdine(78,'PERSONALIZZATO','CUSTOM1',''),null);
 assert.equal(A.costoInseritoOrdine(78,'RAM','R','ACTION'),null);
 assert.equal(A.costoInseritoOrdine(78,'COOLER','R','ACTION'),null);
});

test('another device receives a product correction without requiring a new supplier publication',async()=>{
 const {s,A}=env();s.window.SupabaseDB={getProductCostCorrections:async()=>[{'COOLER|R|ACTION':{unitario:20,il:'2026-10-26T12:00:00Z'}}]};
 assert.equal(await A.aggiornaCorrezioniProdotto(),true);
 assert.equal(A.costoInseritoOrdine(999,'COOLER','R','ACTION'),20);
 assert.equal(await A.aggiornaCorrezioniProdotto(),false);
});

test('profit uses the same unrounded formula as GPU Watch, including losses and sold prices',()=>{
 const {A}=env();const cases=[[1764.9,1103.59],[1591,1102.68],[1851,1211.28],[500,600],[0,43.79],[1537.9,1234.56]];
 for(const [p,c] of cases){const u=p/1.22-.045*p-c;assert.equal(A.utile(p,c).srl,Math.round((u>0?u*.7:u)*100)/100);}
 const v=A.utile(1764.9,1103.59);assert.equal(v.srl,184.54);
 assert.notEqual(v.srl,A.utile(1591,1103.59).srl);
});

function dbMock({paid=false,race=false,locked=false}={}){
 const order={id:1,shopify_order_id:'77',stato:'elaborati',updated_at:'v1',custom_properties:{CASE:'BLACK'}};
 if(locked)order.custom_properties._acquisto_confermato_gestionale={righe:[{tipo:'CPU',ean:'C',costo:100}]};
 const parts=[{order_id:1,component_type:'CPU',ean:'C',supplier:'ACTION',quantity:1,price:paid?100:null}];
 const writes=[];
 class Q{
  constructor(table){this.table=table;this.filters=[];this.op='read';}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}is(k,v){return this.eq(k,v);}or(){return this;}order(){return this;}
  update(data){this.op='update';this.data=data;return this;}
  single(){return this.then(x=>({...x,data:x.data[0]}));}
  maybeSingle(){return this.single();}
  then(resolve,reject){
   if(race&&this.table==='processed_order_components'&&this.op==='read')order.updated_at='v2';
   const rows=(this.table==='processed_orders'?[order]:parts).filter(r=>this.filters.every(f=>f(r)));
   if(this.op==='update'&&rows.length){writes.push({table:this.table,data:this.data});rows.forEach(r=>Object.assign(r,this.data));}
   return Promise.resolve({data:JSON.parse(JSON.stringify(rows)),error:null}).then(resolve,reject);
  }
 }
 const s={supabase:{from:t=>new Q(t)},sanitizeProcessedOrderFields:f=>({...f})};vm.createContext(s);
 const source=read('assets/js/supabase-config.js');
 const start=source.indexOf('async function dbSaveOrderCost('),end=source.indexOf('// PATCH: aggiorna o inserisce',start);
 vm.runInContext(source.slice(start,end),s);
 vm.runInContext(source.slice(source.indexOf('async function dbGetCustomItemsByOrder('),source.indexOf('async function dbSaveCustomItemsForOrder(')),s);
 return {s,order,parts,writes};
}
const purchase=()=>({righe:[{tipo:'CPU',ean:'C',fornitore:'ACTION',quantita:1,costo:100}],
 spese:{servizi:[{nome:'Montaggio e spedizione',costo:43.79}],opzioni:[{nome:'WiFi',costo:8.61}],personalizzati:0,montaggio:[]}});

test('purchase confirmation stores all costs atomically without overwriting component prices or Shopify choices',async()=>{
 const {s,order,parts,writes}=dbMock();const cp=await s.dbConfirmOrderPurchase('77',purchase());
 assert.equal(cp.CASE,'BLACK');assert.equal(cp._acquisto_confermato_gestionale.righe[0].costo,100);
 assert.equal(cp._acquisto_confermato_gestionale.spese.opzioni[0].costo,8.61);
 assert.equal(parts[0].price,null);assert.equal(writes.length,1);assert.equal(writes[0].table,'processed_orders');
 await assert.rejects(()=>s.dbConfirmOrderPurchase('77',purchase()),/già confermato/);
 await assert.rejects(()=>s.dbSaveOrderCost('77',{tipo:'CPU',ean:'C',chiave:'CPU|C|ACTION',fornitore:'ACTION',unitario:1}),/storici sono protetti/);
 assert.equal(writes.length,1);
});

test('confirmation rejects incomplete costs, paid history, changed parts and concurrent updates',async()=>{
 for(const options of [{paid:true},{race:true},{locked:true}]){
  const {s,writes}=dbMock(options);await assert.rejects(()=>s.dbConfirmOrderPurchase('77',purchase()));assert.equal(writes.length,0);
 }
 const {s,writes}=dbMock();const bad=purchase();bad.righe[0].costo=null;
 await assert.rejects(()=>s.dbConfirmOrderPurchase('77',bad),/Completa tutti/);
 const changed=purchase();changed.righe[0].ean='OTHER';await assert.rejects(()=>s.dbConfirmOrderPurchase('77',changed),/distinta è cambiata/);
 assert.equal(writes.length,0);
});

test('confirmed prices stay fixed after new quotes and edits; saved confirmation is shared on reload',async()=>{
 const {s,A}=env();const cp={_acquisto_confermato_gestionale:purchase()};
 s.processedOrdersCache[77]={customProperties:cp,components:[{type:'CPU',ean:'C',price:null}]};
 assert.equal(A.acquistoConfermato(77),true);assert.equal(A.prezzoAcquisto(77,'CPU','C'),100);
 cp._costi_netti_gestionale={'CPU|C|ACTION':{unitario:1}};
 s.processedOrdersCache[78]={customProperties:{_costi_netti_gestionale:{'CPU|C|ACTION':{unitario:2,il:'2026-10-26T12:00:00Z'}}}};
 assert.equal(A.costoInseritoOrdine(79,'CPU','C','ACTION'),2);
 assert.equal(A.prezzoAcquisto(77,'CPU','C'),100);
 assert.equal(A.costoPezzo({acquistato:true,costo:100,auto:{costo:1},costo_inserito:2}).costo,100);
 const paid=JSON.stringify(cp);s.processedOrdersCache[77].customProperties=paid;
 assert.equal(A.prezzoAcquisto(77,'CPU','C'),100);
});

test('shared corrections reader includes saved corrections from other orders and JSON metadata',async()=>{
 const s={dbFetchAllRows:async(table,columns)=>{
  assert.equal(table,'processed_orders');assert.equal(columns,'custom_properties');
  return [{custom_properties:{_costi_netti_gestionale:{'COOLER|R|ACTION':{unitario:20}}}},
   {custom_properties:JSON.stringify({_costi_netti_gestionale:{'RAM|S|ACTION':{unitario:0}}})},
   {custom_properties:null},{custom_properties:'broken'}];
 }};vm.createContext(s);const src=read('assets/js/supabase-config.js');
 vm.runInContext(src.slice(src.indexOf('async function dbGetProductCostCorrections('),src.indexOf('// Correzione del costo prodotto:')),s);
 const registri=await s.dbGetProductCostCorrections();
 assert.equal(registri.length,2);assert.equal(registri[0]['COOLER|R|ACTION'].unitario,20);assert.equal(registri[1]['RAM|S|ACTION'].unitario,0);
});

test('moving a confirmed order or editing customer properties cannot erase its cost ledger',async()=>{
 const {s,order,parts}=dbMock();await s.dbConfirmOrderPurchase('77',purchase());
 const before=JSON.stringify(order.custom_properties._acquisto_confermato_gestionale);
 await s.dbUpdateProcessedOrder('77',{customProperties:{CASE:'WHITE',_acquisto_confermato_gestionale:null},foglioDiLavoro:2});
 assert.equal(order.foglio_di_lavoro,2);assert.equal(order.custom_properties.CASE,'WHITE');
 assert.equal(JSON.stringify(order.custom_properties._acquisto_confermato_gestionale),before);
 assert.equal(parts[0].price,null);
});

test('custom expense rows retain distinct identifiers, quantities and explicit zero costs',async()=>{
 const {s,parts}=dbMock();parts.push({id:10,order_id:1,component_type:'Ventole',product_name:'Due ventole',is_custom:1,quantity:2,price:12},
 {id:11,order_id:1,component_type:'Servizio',product_name:'Servizio incluso',is_custom:1,quantity:1,price:0});
 const rows=await s.dbGetCustomItemsByOrder('77');
 assert.deepEqual(Array.from(rows,x=>[x.id,x.quantity,x.price]),[[10,2,12],[11,1,0]]);
});

test('a different cooler or monitor cannot supply the missing cost of the saved part',()=>{
 const {A}=env();
 const other={manuale:{codice:'AG300',costo:12},auto:{codice:'AG300',costo:12},fisso:null};
 assert.equal(A.costoRigaVerificato({ean:'AK400-DIGITAL',vStesso:other,pRiga:other}).costo,null);
 const monitor={manuale:{codice:'MON-OTHER',costo:80},auto:null,fisso:{costo:80}};
 assert.equal(A.costoRigaVerificato({ean:'MON-CUSTOMER',pRiga:monitor}).costo,null);
 assert.equal(A.costoRigaVerificato({ean:'AK400-DIGITAL',sch:{costo:19.21,fonte:'altro'}}).costo,null);
 assert.equal(A.costoRigaVerificato({ean:'SAME-SKU',fornitore:'OMEGA',vStesso:{manuale:{codice:'SAME-SKU',fornitore:'ACTION',costo:20}}}).costo,null);
});

test('exact quotes, approved fixed budgets and paid costs keep their precedence and quantities',()=>{
 const {A}=env();
 assert.equal(A.costoRigaVerificato({ean:'AK400',quantita:2,offerta:{costo_unitario:35}}).costo,70);
 assert.equal(A.costoRigaVerificato({ean:'AK400',pagato:100,inserito:2,offerta:{costo_unitario:1}}).costo,100);
 assert.equal(A.costoRigaVerificato({ean:'CASE ATX',pRiga:{manuale:{codice:'CASE ATX'},auto:null,fisso:{costo:49.18}}}).costo,49.18);
 assert.equal(A.costoRigaVerificato({ean:'INTEGRATA',pRiga:{manuale:{codice:'INTEGRATA',costo:0}}}).costo,0);
 assert.equal(A.costoRigaVerificato({ean:'AK400',inserito:0}).costo,0);
});

test('an exact EAN or manufacturer code resolves the real quote without substituting a cooler model',()=>{
 const {A}=env();const offerte_ordinabili=[{fornitore:'ACTION',codice:'CHLDECCPU0059',ean:'6933412729495',mpn:'R-AK400-BKADMN-GJD',costo_unitario:35},
 {fornitore:'OMEGA',codice:'CHLDECCPU0059',costo_unitario:2}, {fornitore:'ACTION',codice:'AG300',costo_unitario:12}];
 const dati={offerte_ordinabili};
 for(const codice of ['CHLDECCPU0059','6933412729495','R-AK400-BKADMN-GJD'])assert.equal(A.offertaDelPezzo(dati,codice,'ACTION').costo_unitario,35);
 assert.equal(A.offertaDelPezzo(dati,'OTHER','ACTION'),null);
 const voce={auto:{...offerte_ordinabili[0],costo:35}};
 assert.equal(A.sceltaUguale(voce,null,'COOLER','CHLDECCPU0059','ACTION'),35);
 assert.equal(A.sceltaUguale(voce,null,'COOLER','CHLDECCPU0059','OMEGA'),null);
});
