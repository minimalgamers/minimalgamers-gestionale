import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const app=read('assets/js/app.js');
const split=app.slice(app.indexOf('function splitRAMandSSD('),app.indexOf('async function searchCaseEANByName('));
const technical={
 _scelte_acquisto_gestionale:{GPU:{ean:'B570',esplicita:true}},
 _esclusioni_acquisto_gestionale:{SSD:{escluso:true}},
 _modifica_distinta_gestionale:{kind:'legacy_component',token:'pending'},
 _sostituzioni_componenti:{CASE:'NEW'},
 _costi_netti_gestionale:{CPU:{unitario:100}},
 _acquisto_confermato_gestionale:{righe:[]},_iva_vendita_gestionale:{aliquota:4}
};
function env(observeAccounts=false){
 const s={window:{},console,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}},processedOrdersCache:{},
  resolveVariantTypeFromKeyAndValue:(k)=>({componentType:['CASE','CPU'].includes(k)?k:null,baseComponentType:k,gpoSearchType:k})};
 s.globalThis=s;vm.createContext(s);vm.runInContext(split,s);
 let source=read('assets/js/accoppiamento-auto.js').replace('    const contesti = {};','    const contesti = globalThis.contesti = {};');
 if(observeAccounts)source=source.replace('await mostraUtile(orderId, conti, dati);','await globalThis.accountRendered(orderId, conti, dati);');
 vm.runInContext(source,s);
 return {s,A:s.window.AccoppiamentoAuto};
}

test('technical metadata and unknown structured values cannot enter customer component choices',()=>{
 const {s,A}=env();const variants={CASE:'MINIMAL CASE BLACK',...technical,RAM:{internal:'structured'},CPU:['internal'],OTHER:true};
 assert.doesNotThrow(()=>A.scelteCliente('CPU',variants));
 assert.deepEqual(Array.from(A.scelteCliente('CASE',variants),x=>[x.variabile,x.valore]),[['CASE','MINIMAL CASE BLACK']]);
 assert.equal(A.scelteCliente('RAM',variants).length,0);
 assert.deepEqual(Array.from(A.scelteCliente('CPU',{CPU:9800}),x=>[x.variabile,x.valore]),[['CPU',9800]]);
 for(const value of [null,undefined,{},[],true,16]){
  const result=s.splitRAMandSSD(value);assert.equal(result.ram,null);assert.equal(result.ssd,null);
 }
 assert.match(s.splitRAMandSSD('32GB DDR5 + 1TB NVMe').ram,/32GB DDR5/);
});

test('both order property renderers hide management objects while retaining actual customer options',()=>{
 const filters=[...app.matchAll(/Object\.entries\(item\.customProperties\)\s*\.filter\(([^\n]+)\)/g)];
 assert.equal(filters.length,2);
 for(const [,filter] of filters){
  const s={props:{CASE:'WHITE',RAM:'32GB DDR5',NOTE:'Consegna pomeriggio',QUANTITA:2,...technical,UNRECOGNIZED:{private:true}}};
  vm.createContext(s);const entries=vm.runInContext(`Object.entries(props).filter(${filter})`,s);
  assert.deepEqual(Array.from(entries,([k,v])=>[k,v]),[['CASE','WHITE'],['RAM','32GB DDR5'],['NOTE','Consegna pomeriggio'],['QUANTITA',2]]);
 }
});

test('both units of a multi-PC order reach account rendering with purchase metadata on PC2',async()=>{
 const {s,A}=env(true),id='8393519497559';
 const quote={codice:'CPU',fornitore:'ACTION',descrizione:'AMD Ryzen 5 9600X',costo:100,costo_unitario:100,quantita:1,stock:10,ordinabile:true};
 const piece={tipo:'CPU',manuale:{codice:'CPU',fornitore:'ACTION',quantita:1},auto:quote,costo:100};
 const d={generato:new Date().toISOString(),listini:new Date().toISOString(),voci:[piece],distinte:{TEST:{CPU:0}},per_valore:{},
  per_codice:{},offerte_ordinabili:[quote],ordini:{[id]:{pc:[{quantita:2,pezzi:[piece]}]}}};
 A.stato.dati=d;A.stato.promessa=Promise.resolve(d);A.stato.caricatoIl=Date.now();
 const rows={};s.captured=[];
 for(const unit of [1,2]){
  const orderId=`${id}.${unit}`,variants=unit===2?{...technical}:{};
  s.contesti[orderId]={configKey:'TEST',variants,allItems:[]};
  s.processedOrdersCache[orderId]={components:[{type:'CPU',ean:'CPU',supplier:'ACTION',quantity:1,price:null}]};
  const name={dataset:{ean:'CPU'},textContent:'AMD Ryzen 5 9600X'},badge={dataset:{supplier:'ACTION'}};
  rows[orderId]=[{dataset:{orderId,componentType:'CPU',quantity:'1'},classList:{toggle(){}},
   querySelector:q=>q==='.component-name-display'?name:q==='.supplier-badge-clickable'?badge:null}];
 }
 s.document={getElementById:id=>id==='accoppiamento-auto-style'?{}:null,
  querySelectorAll:q=>rows[/data-order-id="([^"]+)"/.exec(q)?.[1]]||[]};
 // Observe the account renderer boundary; calculation, variant parsing and saved row identities remain real.
 s.accountRendered=async (orderId,conti)=>s.captured.push({orderId,conti});
 for(const unit of [1,2])await A.aggiornaOrdine(`${id}.${unit}`);
 assert.deepEqual(Array.from(s.captured,c=>c.orderId),[`${id}.1`,`${id}.2`]);
 for(const c of s.captured){assert.equal(c.conti.righe.length,1);assert.equal(c.conti.man,100);}
 assert.equal(s.processedOrdersCache[`${id}.2`].components[0].ean,'CPU');
});
