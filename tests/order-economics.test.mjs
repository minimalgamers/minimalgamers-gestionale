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

test('a missing supplier SKU resolves only through a declared exact MPN and the same supplier',()=>{
 const {A}=env(), quote={fornitore:'ACTION',codice:'NEW-SKU',mpn:'DEMO-MPN-BLACK',costo_unitario:80,stock:10,ordinabile:true};
 const r={tipo:'COOLER',ean:'OLD-SKU',fornitore:'ACTION',nome:'Demo cooler | MPN DEMO-MPN-BLACK',quantita:2};
 const q=A.quotazioniDellaRiga({offerte_ordinabili:[quote]},r);
 assert.equal(q.proprio.codice,'NEW-SKU');assert.equal(q.alternativa,null);
 assert.equal(A.costoRigaVerificato({...r,offerta:q.proprio}).costo,160);
 assert.equal(A.disponibilitaRiga({offerte_ordinabili:[quote]},null,r),null);
 for(const nome of ['Demo cooler BLACK','Demo cooler | MPN DEMO-MPN-WHITE','MPN DEMO-MPN-BLACK | MPN OTHER-MPN'])
   assert.equal(A.quotazioniDellaRiga({offerte_ordinabili:[quote]},{...r,nome}).proprio,null);
});

test('another supplier for the exact MPN is shown with its own price without changing the original account',()=>{
 const {A}=env(),quote={fornitore:'ABACO',codice:'NEW-SKU',mpn:'DEMO-MPN-BLACK',costo_unitario:100,stock:10,ordinabile:true,disponibilita:'10 pz'};
 const r={tipo:'COOLER',ean:'OLD-SKU',fornitore:'ACTION',nome:'Demo | MPN DEMO-MPN-BLACK',quantita:2};
 const prima=JSON.stringify(r),q=A.quotazioniDellaRiga({offerte_ordinabili:[quote]},r);
 assert.equal(q.proprio,null);assert.equal(q.alternativa.fornitore,'ABACO');
 assert.equal(A.costoRigaVerificato({...r,offerta:q.proprio}).costo,null);assert.equal(JSON.stringify(r),prima);
 const html=A.pannelloCostiMancanti([{...r,offertaAlternativa:q.alternativa}]);
 assert.match(html,/Prezzo ACTION assente/);assert.match(html,/ABACO/);assert.match(html,/100,00/);
 assert.match(html,/Valuta offerta/);assert.match(html,/fino alla tua conferma/);assert.match(html,/Inserisci costo pagato/);
});

test('same supplier price from the exported sheet remains usable when the product cannot be ordered',()=>{
 const {A}=env(),sch={costo:80,fonte:'listino',fornitore:'ACTION',codice:'NEW-SKU',identita_da:'mpn_esplicito',ordinabile:false,disponibilita:'non disponibile'};
 const r={tipo:'COOLER',ean:'OLD-SKU',fornitore:'ACTION',quantita:2};
 const dati={offerte_ordinabili:[],per_codice:{'ACTION|OLDSKU':sch}};
 assert.equal(A.costoRigaVerificato({...r,sch:A.costoScheda(dati,r.ean,r.fornitore)}).costo,160);
 assert.equal(A.disponibilitaRiga(dati,null,r).stato,'non_ordinabile');
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
test('costo pagato IVA inclusa viene scorporato una volta; zero è valido, vuoto resta mancante',()=>{
 const {A}=env();assert.equal(A.nettoPagato('35,00',true),28.69);assert.equal(A.nettoPagato('28,69',false),28.69);
 assert.equal(A.nettoPagato('0',true),0);assert.equal(A.nettoPagato('',false),null);assert.equal(A.nettoPagato('-1',true),null);
});
test('costo e definizione scorta sono condivisi senza inventare quantità né toccare acquisti',async()=>{
 const {s,order,parts,writes}=dbMock();
 const cp=await s.dbSaveOrderCost('77',{tipo:'CPU',ean:'C',fornitore:'ACTION',chiave:'CPU|C|ACTION',unitario:28.69,
  magazzino:{id:'PROD-C',codice:'MAG-PROD-C',tipo:'CPU',descrizione:'Prodotto'}});
 assert.equal(cp._costi_netti_gestionale['CPU|C|ACTION'].magazzino.codice,'MAG-PROD-C');
 assert.equal(cp.CASE,'BLACK');assert.equal(parts[0].price,null);assert.ok(writes.every(w=>w.table==='processed_orders'));
 assert.equal(cp._costi_netti_gestionale['CPU|C|ACTION'].magazzino.quantity,undefined);
});
test('sostituzione definitiva conserva proprietà e storico, con controllo di identità e concorrenza',async()=>{
 const rule={tipo:'CPU',da:{ean:'C',fornitore:'ACTION'},a:{codice:'NEW',fornitore:'ABACO',descrizione:'CPU nuova'}};
 const {s,parts}=dbMock();const cp=await s.dbSaveProductReplacement('77',rule);
 assert.equal(cp._sostituzioni_componenti['CPU|C|ACTION'].a.codice,'NEW');assert.equal(cp.CASE,'BLACK');assert.equal(parts[0].ean,'C');
 for(const opts of [{paid:true},{locked:true},{race:true}]){
  const e=dbMock(opts);await assert.rejects(e.s.dbSaveProductReplacement('77',rule));assert.equal(e.writes.length,0);
 }
 await assert.rejects(s.dbSaveProductReplacement('77',{...rule,da:{ean:'ALTRO',fornitore:'ACTION'}}));
});
test('regole definitive valgono per gli ordini futuri senza pubblicazione dei listini, senza cambiare quantità o varianti',async()=>{
 const {A,s}=env();const rule={tipo:'CASE',da:{ean:'NOUA BLACK',fornitore:'NOUA'},a:{codice:'CASE-NEW',fornitore:'ABACO',descrizione:'Case nuovo nero'},il:'2026-10-28T10:00:00Z'};
 s.window.SupabaseDB={getProductReplacements:async()=>[{'CASE|NOUABLACK|NOUA':rule}]};
 const rows=[{type:'CASE',ean:'NOUA BLACK',supplier:'NOUA',quantity:2,price:null}];
 await A.pezziMigliori(rows,{configKey:'TEST',variants:{CASE:'MINIMAL BLACK'}},'99');
 assert.equal(rows[0].ean,'CASE-NEW');assert.equal(rows[0].quantity,2);assert.equal(rows[0].price,null);
 const reg=A.sostituzioniProdotto();assert.equal(A.sostituzioneDefinitiva({type:'CASE',ean:'NOUA WHITE',supplier:'NOUA'},reg),null);
 assert.equal(A.sostituzioneDefinitiva({type:'CASE',ean:'NOUA BLACK',supplier:'ALTRO'},reg),null);
});
test('catene di sostituzione risolte una volta, conflitti e cicli non applicati',()=>{
 const {A}=env();const r=(cod,newCod,il='2026-10-28T10:00:00Z')=>({tipo:'CASE',da:{ean:cod,fornitore:'NOUA'},a:{codice:newCod,fornitore:'NOUA',descrizione:newCod},il});
 const regs=A.indiceSostituzioni([{'CASE|A|NOUA':r('A','B'),'CASE|B|NOUA':r('B','C')}]);
 assert.equal(A.sostituzioneDefinitiva({type:'CASE',ean:'A',supplier:'NOUA'},regs).ean,'C');
 regs['CASE|C|NOUA']=r('C','A');assert.equal(A.sostituzioneDefinitiva({type:'CASE',ean:'A',supplier:'NOUA'},regs),null);
 const conflict=A.indiceSostituzioni([{'CASE|A|NOUA':r('A','B')},{'CASE|A|NOUA':r('A','D')}]);
 assert.equal(conflict['CASE|A|NOUA'].conflitto,true);
});
test('scorta di un dissipatore generico: identità per prodotto e prelievo pagato conservato dopo reset costo',()=>{
 const {s,A}=env(),r={tipo:'COOLER',ean:'DISSIPATORE 240MM NERO',fornitore:'',quantita:1};
 const g=A.definizioneScorta('77',r);assert.match(g.codice,/^MAG-/);
 s.processedOrdersCache={77:{customProperties:{_costi_netti_gestionale:{[A.chiaveCostoOrdine(r.tipo,r.ean,r.fornitore)]:{unitario:40,magazzino:g,il:'2026-10-28T11:00:00Z'}}}}};
 let p=A.magazzinoDellaRiga('77',r);assert.equal(p.mag.def.costo,40);assert.equal(A.quantitaMagazzino(g),null);
 A.inv.righe={[p.mag.uso]:{name:JSON.stringify({unitario:40}),quantity:1}};
 s.processedOrdersCache={77:{customProperties:{}}};
 p=A.magazzinoDellaRiga('77',r);assert.ok(A.pezzoPreso(p));assert.equal(A.costoDelPrelievo(p),40);
 assert.equal(A.magazzinoDellaRiga('78',r),null);
 assert.notEqual(g.codice,A.definizioneScorta('78',{...r,ean:'DISSIPATORE 240MM BIANCO'}).codice);
});
test('conto con budget da confermare è previsto e mantiene la formula sul venduto storico',()=>{
 const {A}=env();const html=A.contoOrdine({totale:1619.9,provvisorio:true},[{valore:952.61,sempre:true}],0,110);
 assert.match(html,/UTILE SRL PREVISTO/);assert.match(html,/costi da confermare/);assert.ok(!html.includes('in tasca'));
});
test('prelievi multipli scalano la quantità richiesta una sola volta e conservano il costo pagato',async()=>{
 const {s,A}=env();const r={tipo:'COOLER',ean:'AIO240',fornitore:'ABACO',quantita:2};
 const g=A.definizioneScorta('77',r);
 s.processedOrdersCache={77:{customProperties:{_costi_netti_gestionale:{[A.chiaveCostoOrdine(r.tipo,r.ean,r.fornitore)]:{unitario:40,magazzino:g}}}}};
 const p=A.magazzinoDellaRiga('77',r),db={[g.codice]:{ean:g.codice,name:'AIO nero',quantity:3}},ops=[];
 s.fetch=async(url,opts={})=>{
  const method=opts.method||'GET';ops.push(method);
  if(method==='POST'){const b=JSON.parse(opts.body);db[b.ean]={...db[b.ean],...b};}
  if(method==='DELETE')delete db[new URL(url,'https://test/').searchParams.get('ean')];
  return {ok:true,json:async()=>({success:true,inventory:Object.values(db).map(x=>({...x}))})};
 };
 const d={ordini:{'77':{pc:[{pezzi:[p]}]}}};
 assert.equal(await A.prendiDalMagazzino(d,p.mag.uso,()=>true),true);
 assert.equal(db[g.codice].quantity,1);assert.equal(db[p.mag.uso].quantity,2);assert.equal(A.costoDelPrelievo(p),80);
 p.mag.def.costo=99;assert.equal(A.costoDelPrelievo(p),80);
 const n=ops.filter(x=>x==='POST').length;assert.equal(await A.prendiDalMagazzino(d,p.mag.uso,()=>true),false);
 assert.equal(ops.filter(x=>x==='POST').length,n);
 assert.equal(await A.annullaDalMagazzino(d,p.mag.uso,()=>true),true);assert.equal(db[g.codice].quantity,3);
 assert.equal(db[p.mag.uso],undefined);
});
test('scorta insufficiente per due pezzi non registra prelievi né quantità negative',async()=>{
 const {s,A}=env(),p={mag:{def:{codice:'MAG-C',descrizione:'Cooler',costo:40},uso:'MAG-USO-C',ordine:'#77',quantita:2}};
 let writes=0;s.fetch=async(_url,o={})=>{if(o.method)writes++;return {ok:true,json:async()=>({success:true,inventory:[{ean:'MAG-C',quantity:1}]})};};
 assert.equal(await A.prendiDalMagazzino({ordini:{'77':{pc:[{pezzi:[p]}]}}},p.mag.uso,()=>{throw new Error('non deve chiedere di scalare');}),false);
 assert.equal(writes,0);
});
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

test('known Amazon budget survives a display annotation and an unspecified original channel without crossing identities',()=>{
 const {A}=env();
 const p={tipo:'COOLER',manuale:{codice:'DISSIPATORE A LIQUIDO 360MM NERO',fornitore:'',quantita:1,costo:null},auto:null,
  fisso:{id:'aio_360',fornitore:'AMAZON',costo:47.12}};
 const ean='DISSIPATORE A LIQUIDO 360MM (AMAZON) NERO';
 assert.equal(A.pezzoDellaRiga({pezzi:[p]},'COOLER',ean),p);
 const cost=A.costoRigaVerificato({ean,fornitore:'AMAZON',quantita:2,pRiga:p});
 assert.equal(cost.costo,94.24);assert.equal(cost.fonte,'fisso');
 for(const other of ['DISSIPATORE A LIQUIDO 240MM NERO','DISSIPATORE A LIQUIDO 360MM BIANCO'])
  assert.equal(A.costoRigaVerificato({ean:other,fornitore:'AMAZON',pRiga:p}).costo,null);
 assert.equal(A.costoRigaVerificato({ean,fornitore:'ABACO',pRiga:p}).costo,null);
 assert.equal(A.costoRigaVerificato({ean:'CASE ATX',fornitore:'ALTRO',pRiga:{...p,manuale:{codice:'NOUA VITRA'}}}).costo,null);
});

test('known budgets prefill the per-piece price and remain explicit references, without a repeated confirmation request',()=>{
 const {A}=env();
 assert.equal(A.costoInizialeEditor({costo:81.96,quantita:2,fonte:'fisso'}),40.98);
 assert.equal(A.costoInizialeEditor({costo:0,fonte:'fisso'}),0);
 assert.equal(A.costoInizialeEditor({costo:null}), '');
 assert.equal(A.costoInizialeEditor({costo:99},{unitario:12}),12);
 const html=A.pannelloCostiRiferimento([{tipo:'KIT',costo:40.98,i:3}]);
 assert.match(html,/già inclusi nel conto/);assert.match(html,/40,98/);assert.match(html,/data-costo-riga="3"/);
 assert.ok(!/Conferma il costo|Inserisci costo|Costo e magazzino/.test(html));
 assert.equal(A.pannelloCostiRiferimento([]),'');
});

test('confirmed permanent replacement stores its selected quote across reloads and future quantities, never as a paid price',async()=>{
 const {s,parts,order}=dbMock();
 const rule={tipo:'CPU',da:{ean:'C',fornitore:'ACTION'},a:{codice:'NEW',fornitore:'ABACO',descrizione:'CPU nuova',costo_unitario:35,prezzo_listino:35}};
 const cp=await s.dbSaveProductReplacement('77',rule);
 assert.equal(cp._sostituzioni_componenti['CPU|C|ACTION'].a.costo_unitario,35);
 assert.equal(cp._sostituzioni_componenti['CPU|C|ACTION'].a.prezzo_listino,35);
 assert.ok(cp._sostituzioni_componenti['CPU|C|ACTION'].a.prezzo_il);
 assert.equal(parts[0].price,null);assert.equal(order.custom_properties._acquisto_confermato_gestionale,undefined);
 const fresh=env();fresh.s.processedOrdersCache[77]={customProperties:JSON.parse(JSON.stringify(cp))};
 const q=fresh.A.costoSostituzione('CPU','NEW','ABACO',2);
 assert.equal(q.costo,70);
 assert.equal(fresh.A.costoSostituzione('CPU','NEW','ACTION',2),null);
 assert.equal(fresh.A.costoSostituzione('CPU','OTHER','ABACO',2),null);
 assert.equal(fresh.A.costoRigaVerificato({ean:'NEW',fornitore:'ABACO',riferimentoSostituzione:q}).fonte,'riferimento_sostituzione');
 assert.equal(fresh.A.costoRigaVerificato({ean:'NEW',quantita:2,offerta:{costo_unitario:40},riferimentoSostituzione:q}).costo,80);
 assert.equal(fresh.A.costoRigaVerificato({ean:'NEW',pagato:60,riferimentoSostituzione:q}).costo,60);
 assert.equal(fresh.A.costoRigaVerificato({ean:'NEW',inserito:50,riferimentoSostituzione:q}).costo,50);
});

test('permanent replacement confirmation includes future scope and excludes purchased orders from a mass change',()=>{
 const {A}=env();
 const r={origine:{id:'77',tipo:'CASE',ean:'OLD',fornitore:'ABACO',ordine:'#77'}};
 const sim={uguali:[{id:'78',tipo:'CASE',ean:'OLD',fornitore:'ABACO',bloccato:false},{id:'79',bloccato:true}],equivalenti:[]};
 const html=A.htmlSceltaScheda(r,{codice:'NEW',fornitore:'ABACO',descrizione:'Case nuovo',prezzo:40},sim);
 assert.match(html,/value="solo" checked/);assert.match(html,/value="definitivo"/);assert.match(html,/tutti i futuri/);
 assert.match(html,/prezzo scelto resta come riferimento/);
 const body={querySelector:()=>({value:'definitivo'}),querySelectorAll:()=>[{checked:true,dataset:{i:'0'}},{checked:true,dataset:{i:'1'}}]};
 assert.deepEqual(Array.from(A.pcDaCambiare(body,r,sim),p=>p.id),['77','78']);
});

test('remembered replacement prices retain date and zero; conflicting or invalid quotes cannot create a current price',()=>{
 const {A}=env();
 assert.deepEqual(Object.keys(A.quotazioneScelta({prezzo:null})),[]);
 assert.deepEqual(Object.keys(A.quotazioneScelta({prezzo:''})),[]);
 assert.deepEqual(Object.keys(A.quotazioneScelta({prezzo:-1})),[]);
 assert.equal(A.quotazioneScelta({prezzo:0}).costo_unitario,0);
 const r=n=>({tipo:'CASE',da:{ean:'OLD',fornitore:'ABACO'},a:{codice:'NEW',fornitore:'ABACO',descrizione:'Case nero',costo_unitario:n,prezzo_il:'2026-10-29T10:00:00Z'},il:'2026-10-29T10:00:00Z'});
 const map={'CASE|OLD|ABACO':r(40)};
 const q=A.costoSostituzione('CASE','NEW','ABACO',2,map);
 const costo=A.costoRigaVerificato({ean:'NEW',riferimentoSostituzione:q});
 assert.equal(costo.costo,80);assert.equal(costo.prezzo_il,'2026-10-29T10:00:00Z');
 assert.match(A.righePezziConto([{tipo:'CASE',ean:'NEW',fornitore:'ABACO',...costo}]),/scelto il 29\/10\/2026/);
 assert.equal(A.costoSostituzione('CASE','NEW','ABACO',1,{...map,'CASE|ALT|ABACO':r(41)}),null);
 const conflict=A.indiceSostituzioni([map,{'CASE|OLD|ABACO':r(41)}]);
 assert.equal(conflict['CASE|OLD|ABACO'].conflitto,true);
 assert.equal(A.costoSostituzione('CASE','NEW','ABACO',1,conflict),null);
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
