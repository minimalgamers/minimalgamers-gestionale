import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const sandbox={window:{},console,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),sandbox);
const A=sandbox.window.AccoppiamentoAuto;
const J=x=>JSON.parse(JSON.stringify(x));
const old={tipo:'GPU',ean:'OLD',fornitore:'ACTION',nome:'Scheda video originale',quantita:2,costo:200,fonte:'listino'};
const offer={codice:'NEW',fornitore:'ABACO',descrizione:'Scheda video alternativa',quantita:1,
  costo:80,costo_unitario:80,stock:10,ordinabile:true,disponibilita:'10 pz'};
function dati(){return {offerte_ordinabili:[{...offer}],per_codice:{'ACTION|OLD':{
  codice:'OLD',fornitore:'ACTION',descrizione:'Scheda video originale',costo:100,fonte:'listino',disponibilita:'non disponibile'}},
  ordini:{'100':{nome:'#5000',pc:[{quantita:1,linea:'MINIMAL',pezzi:[{tipo:'GPU',manuale:{codice:'OLD',fornitore:'ACTION'},auto:{...offer}}]}]}}};}
const scheda=r=>({id:'100',nome:'#5000',righe:[r],salvati:[{type:r.tipo,ean:r.ean,supplier:r.fornitore,quantity:r.quantita}]});

test('prezzo noto e alternativa disponibile non rendono disponibile il prodotto originale',()=>{
  const d=dati(),pc=A.pcAutomatico(d,'100');
  const s=A.disponibilitaRiga(d,pc,old);
  assert.equal(s.stato,'non_ordinabile');
  assert.match(s.testo,/Non ordinabile/);
  assert.equal(old.costo,200);
});
test('riga assente dal catalogo rimane riconoscibile anche con costo sconosciuto',()=>{
  const d=dati();d.per_codice={};
  const r={...old,costo:null};
  assert.equal(A.disponibilitaRiga(d,A.pcAutomatico(d,'100'),r).stato,'assente');
  const result=J(A.daOrdinare(d,[scheda(r)],{}));
  assert.equal(result.pezzi,2);assert.equal(result.senzaCosto,1);
  assert.equal(result.fornitori[0].nome,'ACTION');assert.equal(result.righe[0].codice,'OLD');
  assert.equal(result.righe[0].nonDisponibile,true);
});
test('finché non si conferma un cambio, totale e fornitore restano quelli della scheda',()=>{
  const d=dati(),prima=JSON.stringify(d);
  for(let i=0;i<2;i++){
    const r=J(A.daOrdinare(d,[scheda(old)],{}));
    assert.equal(r.cambi,0);assert.equal(r.totale,200);assert.equal(r.pezzi,2);
    assert.deepEqual(r.fornitori.map(f=>f.nome),['ACTION']);
    assert.equal(r.righe[0].codice,'OLD');assert.equal(r.righe[0].quantita,2);
    assert.match(A.htmlRigaDaOrdinare(r.righe[0],'#f00',false),/acc-rf-indisponibile/);
    assert.match(A.htmlRigaDaOrdinare(r.righe[0],'#f00',false),/Cambia dal Buyer Desk/);
    assert.match(A.testoOrdineFornitore(r.fornitori[0]),/x2 \| OLD/);
  }
  assert.equal(JSON.stringify(d),prima);
});
test('dopo una sostituzione confermata, il riepilogo conta solo il pezzo nuovo',()=>{
  const r=J(A.daOrdinare(dati(),[scheda({...old,ean:'NEW',fornitore:'ABACO',nome:'Nuova',costo:160})],{}));
  assert.deepEqual(r.fornitori.map(f=>f.nome),['ABACO']);
  assert.equal(r.totale,160);assert.equal(r.righe[0].codice,'NEW');
  assert.equal(r.righe[0].quantita,2);assert.equal(r.righe[0].verificaDisponibilita,undefined);
});
test('altro fornitore con lo stesso codice non fa apparire disponibile il fornitore originale',()=>{
  const d=dati();d.offerte_ordinabili=[{...offer,codice:'OLD'}];
  assert.equal(A.disponibilitaRiga(d,null,old).stato,'non_ordinabile');
});
test('stock riservato, quantità insufficienti e allocazione ad altri ordini restano da verificare',()=>{
  const d=dati();d.offerte_ordinabili=[{...offer,codice:'OLD',fornitore:'ACTION',stock:1}];
  assert.equal(A.disponibilitaRiga(d,null,old).stato,'quantita');
  d.offerte_ordinabili=[{...offer,codice:'OLD',fornitore:'ACTION',da_confermare:true}];
  assert.equal(A.disponibilitaRiga(d,null,old).stato,'non_ordinabile');
  const pc=A.pcAutomatico(d,'100');pc.pezzi[0].quantita_non_coperta=1;
  assert.equal(A.disponibilitaRiga(d,pc,old).stato,'quantita');
});
test('offline, acquisti confermati, magazzino e grafica integrata non creano falsi allarmi',()=>{
  assert.equal(A.disponibilitaRiga(null,null,old),null);
  assert.equal(A.disponibilitaRiga({},null,old),null);
  assert.equal(A.disponibilitaRiga(dati(),null,old,true),null);
  assert.equal(A.disponibilitaRiga(dati(),null,{...old,fonte:'acquistato'}),null);
  assert.equal(A.disponibilitaRiga(dati(),null,{...old,fonte:'magazzino'}),null);
  assert.equal(A.disponibilitaRiga(dati(),null,{...old,ean:'INTEGRATA'}),null);
  const r=J(A.daOrdinare(dati(),[{...scheda(old),confermato:true}],{}));
  assert.equal(r.pezzi,0);assert.equal(r.totale,0);
});
test('un listino escluso produce un avviso di verifica, senza dichiarare stock zero',()=>{
  const d=dati();d.per_codice={};d.fornitori_esclusi=['ACTION: stale'];
  assert.equal(A.disponibilitaRiga(d,null,old).stato,'da_verificare');
  assert.match(A.disponibilitaRiga(d,null,old).testo,/non aggiornato/);
});

test('costo pagato senza prelievo: giacenza da verificare e prodotto ancora da acquistare',()=>{
  const d={offerte_ordinabili:[],magazzino:[{id:'psu',codice:'MAG-PSU',costo:28.69}],
    ordini:{'100':{nome:'#5000',pc:[{pezzi:[{tipo:'PSU',manuale:{codice:'PF600',fornitore:'ABACO'},giacenza:'psu'}]}]}}};
  A.annota(d);A.inv.righe={};
  const pc=A.pcAutomatico(d,'100'),p=pc.pezzi[0];
  const costo=A.costoRigaVerificato({ean:'PF600',fornitore:'ABACO',mag:28.69,magPreso:A.pezzoPreso(p)});
  assert.equal(costo.costo,28.69);assert.equal(costo.fonte,'riferimento_magazzino');
  const r={tipo:'PSU',ean:'PF600',fornitore:'ABACO',quantita:1,...costo};
  assert.match(A.disponibilitaRiga(d,pc,r).testo,/quantità in magazzino non registrata/);
  const prima=J(A.daOrdinare(d,[scheda(r)],{}));
  assert.equal(prima.pezzi,1);assert.equal(prima.totale,28.69);assert.equal(prima.fornitori[0].nome,'ABACO');
  A.inv.righe['MAG-PSU']={quantity:5};
  assert.match(A.disponibilitaRiga(d,pc,r).testo,/non ancora prelevato/i);
  A.inv.righe[p.mag.uso]={quantity:1};
  const preso=A.costoRigaVerificato({ean:'PF600',fornitore:'ABACO',mag:28.69,magPreso:A.pezzoPreso(p)});
  assert.equal(preso.fonte,'magazzino');
  const dopo=J(A.daOrdinare(d,[scheda({...r,...preso})],{}));
  assert.equal(dopo.pezzi,0);assert.equal(dopo.totale,0);assert.equal(dopo.fornitori[0].nome,'MAGAZZINO');
  A.inv.righe=null;
});

test('senza prelievo il costo attuale prevale sul riferimento storico; un prelievo resta al pagato',()=>{
  const args={ean:'PF600',fornitore:'ABACO',mag:28.69,offerta:{costo_unitario:31},quantita:2};
  assert.equal(A.costoRigaVerificato({...args,magPreso:false}).costo,62);
  assert.equal(A.costoRigaVerificato({...args,magPreso:false}).fonte,'listino');
  assert.equal(A.costoRigaVerificato({...args,magPreso:true}).costo,28.69);
});

test('letture contemporanee della giacenza condividono una richiesta senza scritture',async()=>{
  let richieste=0;const metodi=[];
  sandbox.fetch=async(_url,opts)=>{richieste++;metodi.push(opts?.method||'GET');return {ok:true,json:async()=>({success:true,inventory:[{ean:'MAG-PSU',quantity:3}]})};};
  await Promise.all([A.leggiInventario(),A.leggiInventario()]);
  assert.equal(richieste,1);assert.deepEqual(metodi,['GET']);assert.equal(A.inv.righe['MAG-PSU'].quantity,3);
  assert.equal(A.inv.promessa,null);A.inv.righe=null;
});

class El{
  constructor(){this.children=[];this.dataset={};this.attrs={};this.className='';this.textContent='';
    this.classList={toggle:(name,on)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));on?s.add(name):s.delete(name);this.className=[...s].join(' ');}};}
  appendChild(c){c.parent=this;this.children.push(c);return c;}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(k,v){this.attrs[k]=v;}
  querySelector(s){return this.children.find(c=>s==='button'?c.type==='button':c.className.split(' ').includes(s.slice(1)))||this.children.map(c=>c.querySelector(s)).find(Boolean)||null;}
}
sandbox.document={createElement(){return new El();}};
test('riga rossa e pulsante agiscono sulla riga giusta senza modificare codice o quantità',()=>{
  const row=new El();row.dataset={componentType:'GPU',quantity:'2'};
  const name=new El();name.className='component-name-display';name.dataset.ean='OLD';name.textContent='Scheda video originale';row.appendChild(name);
  const r={...old};let calls=[];
  const alert=A.disponibilitaRiga(dati(),null,r);
  const cambia=(id,v)=>calls.push({id,v});
  A.segnaDisponibilitaRiga(row,'100',r,alert,cambia);
  A.segnaDisponibilitaRiga(row,'100',r,alert,cambia);
  assert.match(row.className,/acc-riga-indisponibile/);assert.equal(row.children.length,2);
  assert.equal(name.dataset.ean,'OLD');assert.equal(name.textContent,'Scheda video originale');assert.equal(row.dataset.quantity,'2');
  const button=row.querySelector('.acc-disponibilita-riga').querySelector('button');
  assert.equal(button.textContent,'Sostituisci');
  let stopped=0;button.onclick({preventDefault(){stopped++;},stopPropagation(){stopped++;}});
  assert.equal(stopped,2);assert.equal(calls.length,1);assert.equal(calls[0].id,'100');assert.equal(calls[0].v.ean,'OLD');
  A.segnaDisponibilitaRiga(row,'100',r,null,cambia);
  assert.doesNotMatch(row.className,/acc-riga-indisponibile/);assert.equal(row.children.length,1);
});
