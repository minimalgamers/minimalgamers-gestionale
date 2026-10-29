import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8');
function env(){
 const windows=[],s={console,window:{open(url,target){const w={url,target};windows.push(w);return w;}},
  processedOrdersCache:{},localStorage:{getItem(){return null;}},setTimeout,clearTimeout};
 vm.createContext(s);vm.runInContext(source,s);return {s,A:s.window.AccoppiamentoAuto,windows};
}
const tipi=['CASE','CPU','MOBO','SSD','RAM','GPU','PSU','COOLER','MONITOR','KIT GAMING'];

test('Valuta offerta searches the exact manufacturer code while retaining the original row for confirmation',()=>{
 const {A,windows}=env();
 A.apriCambioPezzo('100',{tipo:'COOLER',ean:'OLD-SKU',fornitore:'ACTION',nome:'Demo cooler | ACTION OLD-SKU',ricerca:'DEMO-MPN-BLACK'});
 assert.equal(new URL(windows[0].url).searchParams.get('q'),'DEMO-MPN-BLACK');
 assert.equal(A.cambio.riga.origine.ean,'OLD-SKU');
 assert.equal(A.cambio.riga.origine.fornitore,'ACTION');
});
test('ogni pezzo ha due pulsanti distinti, raggruppati e indicizzati sulla riga corretta',()=>{
 const {A}=env();
 const html=A.righePezziConto(tipi.map(tipo=>({tipo,ean:`SKU-${tipo}`,fornitore:'ABACO',descrizione:`Prodotto ${tipo}`,costo:40,fonte:'listino'})),true);
 for(let i=0;i<tipi.length;i++){
  assert.match(html,new RegExp(`aria-label="Azioni ${tipi[i]}"[^>]*><button[^>]*data-cambia="${i}"`));
  assert.match(html,new RegExp(`data-costo-riga="${i}"`));
 }
});
test('CPU, RAM e tutti gli altri tipi aprono una scelta legata alla propria scheda',()=>{
 const {A,windows}=env();
 const scelta={tipo:'mg-buyer-scelta',codice:'NEW',fornitore:'ABACO'};
 for(const tipo of tipi){
  const vecchia=windows.at(-1);
  A.apriCambioPezzo('100',{tipo,ean:`SKU-${tipo}`,nome:`Prodotto ${tipo}`,fornitore:'ABACO'});
  const nuova=windows.at(-1);
  assert.equal(A.cambio.riga.origine.tipo,tipo);assert.equal(A.cambio.riga.origine.id,'100');
  assert.equal(nuova.target,'_blank');assert.ok(nuova.url.startsWith('https://listini.minimalgamers.it/'));
  assert.equal(A.sceltaValida('https://listini.minimalgamers.it',scelta,nuova),true);
  if(vecchia)assert.equal(A.sceltaValida('https://listini.minimalgamers.it',scelta,vecchia),false);
  assert.equal(A.sceltaValida('https://altro.test',scelta,nuova),false);
 }
});
test('più schede del gestionale non ricevono scelte aperte dall’altra scheda',()=>{
 const a=env(),b=env(),r={tipo:'RAM',ean:'RAM',fornitore:'ABACO'};
 a.A.apriCambioPezzo('100',r);b.A.apriCambioPezzo('200',r);
 const msg={tipo:'mg-buyer-scelta',codice:'NEW',fornitore:'ABACO'};
 assert.equal(b.A.sceltaValida('https://listini.minimalgamers.it',msg,a.windows[0]),false);
 assert.equal(a.A.sceltaValida('https://listini.minimalgamers.it',msg,b.windows[0]),false);
});
test('costo confermato con giacenza sconosciuta è informativo e rimane nel totale',()=>{
 const {A}=env(),r={tipo:'PSU',ean:'PF600',fornitore:'ABACO',quantita:1,costo:28.69,fonte:'inserito',
  magazzino:{def:{id:'psu',codice:'MAG-PF',costo:28.69},uso:'MAG-USO-100-1-psu'}};
 const dati={offerte_ordinabili:[]};
 const avviso=A.disponibilitaRiga(dati,null,r);
 const visivo=A.statoAvvisoComponente(r,avviso);
 assert.equal(visivo.livello,'info');assert.match(visivo.testo,/Costo confermato: 28,69/);
 assert.match(visivo.testo,/conto usa già questo costo/);assert.ok(!visivo.testo.includes('Conferma il costo'));
 const result=A.daOrdinare(dati,[{id:'100',nome:'#100',righe:[r]}],{});
 assert.equal(result.totale,28.69);assert.equal(result.pezzi,1);
 const html=A.htmlRigaDaOrdinare(result.righe[0],'#888',false);
 assert.match(html,/acc-rf-informativo/);assert.ok(!html.includes('acc-rf-indisponibile'));
});
test('zero confermato non viene richiesto di nuovo e non inventa una disponibilità',()=>{
 const {A}=env();const r={costo:0,fonte:'inserito'},avviso={stato:'fuori_listino',testo:'Fuori listino'};
 assert.equal(A.statoAvvisoComponente(r,avviso).livello,'info');
 assert.match(A.statoAvvisoComponente(r,avviso).testo,/Costo confermato: 0,00/);
});
test('quantità effettivamente insufficiente resta rossa anche con costo confermato',()=>{
 const {A}=env(),r={tipo:'PSU',ean:'PF600',fornitore:'ABACO',quantita:2,costo:57.38,fonte:'inserito',
  magazzino:{def:{id:'psu',codice:'MAG-PF'},uso:'MAG-USO-100-1-psu'}};
 A.inv.righe={'MAG-PF':{quantity:1}};
 const v=A.disponibilitaRiga({offerte_ordinabili:[]},null,r);
 assert.equal(v.stato,'magazzino_insufficiente');assert.equal(A.statoAvvisoComponente(r,v).livello,'errore');
 assert.equal(A.statoAvvisoComponente(r,{stato:'non_ordinabile',testo:'Non ordinabile'}).livello,'errore');
});
test('un budget non confermato resta da verificare e non diventa un costo approvato',()=>{
 const {A}=env();assert.equal(A.statoAvvisoComponente({costo:49.18,fonte:'fisso'},
  {stato:'fuori_listino',testo:'Fuori listino'}).livello,'avviso');
});
