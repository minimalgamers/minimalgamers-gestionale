import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const s={window:{}};vm.createContext(s);vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),s);
const A=s.window.AccoppiamentoAuto;
const budget={costo:73.77,fonte:'budget',riferimento_costo:true,corrente:false};

test('known cooler and PSU costs stay fixed despite supplier increases; manual and paid prices win',()=>{
 A.stato.dati={costi_hardware_fissi:{'PSU|DEMO|ABACO':{unitario:62},'COOLER|DEMO|':{unitario:49.18}}};
 for(const tipo of ['PSU','COOLER']){
  const row={tipo,ean:'DEMO',fornitore:'ABACO',quantita:2,offerta:{costo_unitario:999}};
  const fixed=A.costoRigaVerificato(row);assert.equal(fixed.costo,tipo==='PSU'?124:98.36);assert.equal(fixed.fonte,'fisso_utente');
  assert.equal(A.costoRigaVerificato({...row,pagato:90}).costo,90);
  assert.equal(A.costoRigaVerificato({...row,inserito:80}).costo,80);
 }
 assert.equal(A.costoRigaVerificato({tipo:'GPU',ean:'DEMO',fornitore:'ABACO',offerta:{costo_unitario:999}}).costo,999);
 assert.equal(A.costoRigaVerificato({tipo:'PSU',ean:'UNKNOWN',fornitore:'ABACO'}).costo,null);
 A.stato.dati=null;
});
test('a known budget fills only the unpriced row and respects quantity',()=>{
 const c=A.costoRigaVerificato({ean:'MG-BUNDLE-REX',fornitore:'AMAZON',quantita:2,sch:budget});
 assert.equal(c.costo,147.54);assert.equal(c.fonte,'budget');assert.equal(c.riferimento.corrente,false);
});
test('actual paid, manually saved and current own quotes precede all fallbacks',()=>{
 for(const [field,value,expected] of [['pagato',60,'acquistato'],['inserito',70,'inserito'],['offerta',{costo_unitario:80},'listino']]){
 const c=A.costoRigaVerificato({ean:'DEMO',fornitore:'AMAZON',sch:budget,[field]:value});
 assert.equal(c.fonte,expected);assert.equal(c.costo,typeof value==='number'?value:80);
 }
});
test('another supplier is retained as explicit estimate metadata',()=>{
 const c=A.costoRigaVerificato({ean:'OLD',fornitore:'ACTION',sch:{stima:{costo:107.35,fonte:'riferimento_altro',fornitore_riferimento:'ABACO'}}});
 assert.equal(c.costo,107.35);assert.equal(c.fonte,'riferimento_altro');assert.equal(c.riferimento.fornitore_riferimento,'ABACO');
});
test('missing and invalid references never turn into zero cost',()=>{
 for(const ref of [null,{costo:null,fonte:'budget'},{costo:-1,fonte:'budget'},{costo:3,fonte:'unknown'}])
  assert.equal(A.costoRigaVerificato({ean:'DEMO',sch:ref&&{...ref,riferimento_costo:true}}).costo,null);
});
test('purchase confirmation cannot silently freeze alternate or undated prices as actually paid',()=>{
 for(const fonte of ['riferimento_altro','riferimento_excel'])assert.equal(A.prezzoConferma({fonte,costo:100}),'');
 assert.equal(A.prezzoConferma({fonte:'listino',costo:100}),'100');
 assert.equal(A.prezzoConferma({fonte:'budget',costo:73.77}),'73,77');
});
