import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const START=Date.parse('2026-11-06T14:00:00Z');
const quote=()=>({codice:'SSD',fornitore:'ACTION',descrizione:'SSD 1TB NVMe',quantita:1,stock:10,costo:100,costo_unitario:100,
 ordinabile:true,stock_valid_until:new Date(START+1000).toISOString(),price_valid_until:new Date(START+2000).toISOString(),source_at:'2026-11-06T13:21:00Z'});
function env(){
 let now=START;class Clock extends Date{static now(){return now;}}
 const s={window:{},console,Date:Clock,localStorage:{getItem:()=>null,setItem(){}},processedOrdersCache:{}};
 vm.createContext(s);vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),s);
 return {s,A:s.window.AccoppiamentoAuto,advance:ms=>{now+=ms;}};
}

test('the same open-page offer stops being orderable at stock or price expiry without changing its known cost',()=>{
 const {A,advance}=env(),a=quote(),before=JSON.stringify(a);
 assert.equal(A.offertaOrdinabile(a),true);advance(1000);
 assert.equal(A.offertaOrdinabile(a),false);assert.match(A.motivoScadenzaOfferta(a),/Disponibilità/);
 const priceOnly={...a,stock_valid_until:new Date(START+10000).toISOString()};
 assert.equal(A.offertaOrdinabile(priceOnly),true);advance(1000);
 assert.equal(A.offertaOrdinabile(priceOnly),false);assert.match(A.motivoScadenzaOfferta(priceOnly),/Quotazione/);
 assert.equal(JSON.stringify(a),before);assert.equal(A.costoRigaVerificato({tipo:'SSD',ean:'SSD',offerta:a}).costo,100);
 assert.equal(A.costoRigaVerificato({tipo:'SSD',ean:'SSD',offerta:a,pagato:80}).costo,80);
 assert.equal(A.offertaOrdinabile({...quote(),stock_valid_until:'invalid'}),false);
 assert.equal(A.offertaOrdinabile({...quote(),stock_valid_until:null,price_valid_until:undefined}),true);
});

test('copy and email recheck every grouped offer TTL after the purchase summary has already been rendered',()=>{
 const {A,advance}=env(),a=quote(),part={tipo:'SSD',manuale:{codice:'SSD',fornitore:'ACTION',quantita:1},auto:a};
 const data={ordini:{77:{nome:'#77',pc:[{quantita:1,pezzi:[part]}]}},offerte_ordinabili:[a]};
 const row={tipo:'SSD',ean:'SSD',fornitore:'ACTION',nome:a.descrizione,quantita:1,costo:100,fonte:'listino'};
 const result=A.daOrdinare(data,[{id:'77',nome:'#77',righe:[row],salvati:[{type:'SSD',ean:'SSD',supplier:'ACTION',quantity:1,price:null}]}],{});
 const supplier=result.fornitori[0],contacts={invii:[{id:'action',fornitori:['ACTION'],a:['buyer@example.test']}]};
 assert.equal(A.rigaOrdinabile(supplier.righe[0]),true);assert.match(A.testoOrdineFornitore(supplier),/SSD/);
 assert.equal(A.ordiniEmail(result,contacts).invii.length,1);advance(1000);
 assert.equal(A.rigaOrdinabile(supplier.righe[0]),false);assert.equal(A.testoOrdineFornitore(supplier),'');
 assert.equal(A.testoCategoria(result.categorie[0]),'');assert.equal(A.ordiniEmail(result,contacts).invii.length,0);
 const warning=A.disponibilitaRiga(data,A.pcAutomatico(data,'77'),row);
 assert.equal(warning.stato,'non_ordinabile');assert.match(warning.testo,/Disponibilità/);
 assert.equal(A.disponibilitaRiga(data,A.pcAutomatico(data,'77'),row,true),null);
 assert.equal(supplier.righe[0].costo,100);
});

test('an expired quote cannot change an assembly row or create a future replacement rule',async()=>{
 const {s,A,advance}=env(),a={...quote(),codice:'NEW'},p={id:'77',tipo:'SSD',ean:'OLD',fornitore:'ACTION',quantita:1,componentId:10};
 s.processedOrdersCache[77]={components:[{id:10,type:'SSD',ean:'OLD',supplier:'ACTION',quantity:1,price:null}]};
 let writes=0;s.window.SupabaseDB={replacePurchaseComponent:async()=>{writes++;return {component:{id:10,type:'SSD',ean:'NEW',supplier:'ACTION',quantity:1,price:null}};},
  saveProductReplacement:async()=>{writes++;return {};}};
 await A.sostituisciAcquisto(p,a);assert.equal(writes,1);advance(1000);
 await assert.rejects(()=>A.sostituisciAcquisto(p,a),/scaduta/);
 await assert.rejects(()=>A.salvaSostituzioneDefinitiva('77',p,a),/scaduta/);
 assert.equal(writes,1);assert.equal(s.processedOrdersCache[77].components[0].ean,'NEW');
});
