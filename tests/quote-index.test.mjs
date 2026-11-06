import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8');
function api(){
  const s={window:{},console,localStorage:{getItem(){return null;},setItem(){throw Error('No writes');}},
    fetch(){throw Error('No network');}};
  vm.createContext(s);vm.runInContext(source,s);return s.window.AccoppiamentoAuto;
}
const offer=(supplier,code,mpn,ean,cost)=>({fornitore:supplier,codice:code,mpn,ean,costo_unitario:cost,costo:cost,
  descrizione:`Product ${mpn}`,stock:20,quantita:1,ordinabile:true,disponibilita:'20 pz'});

test('repeated exact quotes do not rescan the catalog; aliases and MPN share one publication index',()=>{
  const A=api();let identityReads=0;
  const all=Array.from({length:1000},(_,i)=>{
    const raw=offer('ACTION',`SKU-${i}`,`MPN-${i}`,`800000000${i}`,i+1);
    for(const k of ['codice','ean','mpn']){const value=raw[k];Object.defineProperty(raw,k,{enumerable:true,get(){identityReads++;return value;}});}
    return raw;
  });
  const target=all[500],data={offerte_ordinabili:all};
  assert.equal(A.offertaDelPezzo(data,'SKU-500','ACTION'),target);
  const afterBuild=identityReads;
  assert.ok(afterBuild>=3000,'all product identities are indexed once');
  for(let n=0;n<100;n++){
    assert.equal(A.offertaDelPezzo(data,'MPN-500','ACTION'),target);
    assert.equal(A.offertaDelPezzo(data,'800000000500','ACTION'),target);
    assert.equal(A.quotazioniDellaRiga(data,{ean:'UNKNOWN',fornitore:'ACTION',nome:'Reference MPN: MPN-500'}).proprio,target);
  }
  assert.equal(identityReads,afterBuild,'warm queries must not iterate or normalize the entire offer array');
});

test('supplier-specific numeric SKUs never borrow another supplier’s different product',()=>{
  const A=api(),cpu=offer('TIER ONE','1234','CPU-9600X','730143316088',150),ram=offer('EPTIMO','1234','DDR5-16GB','8000000001234',40);
  const data={offerte_ordinabili:[cpu,ram]};
  assert.equal(A.offertaDelPezzo(data,'1234','TIER ONE'),cpu);
  assert.equal(A.offertaDelPezzo(data,'1234','EPTIMO'),ram);
  assert.equal(A.offertaDelPezzo(data,'1234',''),null);
  assert.equal(A.offertaDelPezzo(data,'1234','UNKNOWN'),null);
  assert.equal(A.offertaDelPezzo(data,'CPU-9600X','EPTIMO'),null);
});

test('minimum cost, stable ties, own supplier and exact MPN alternative behavior remain unchanged',()=>{
  const A=api(),dear=offer('ACTION','A1','SAME-MPN','8000000011111',60),cheap=offer('ACTION','A2','SAME-MPN','8000000011111',50);
  const tie={...cheap,codice:'A3'},reserved={...offer('OMEGA','O1','SAME-MPN','8000000011111',30),da_confermare:true};
  const other=offer('ABACO','B1','SAME-MPN','8000000011111',55),different=offer('ABACO','B2','DIFFERENT-MPN','8000000099999',1);
  const all=Object.freeze([dear,cheap,tie,reserved,other,different]),before=JSON.stringify(all),data={offerte_ordinabili:all};
  assert.equal(A.offertaDelPezzo(data,'SAME-MPN','ACTION'),cheap);
  assert.equal(A.offertaDelPezzo(data,'8000000011111','ACTION'),cheap);
  const q=A.quotazioniDellaRiga(data,{ean:'A1',fornitore:'ACTION',nome:'Graphics card | MPN: SAME-MPN'});
  assert.equal(q.proprio,dear,'an exact own SKU is retained even if another own SKU shares the MPN');
  assert.equal(q.alternativa,other,'orderable exact MPN precedes cheaper reserved offers');
  assert.equal(JSON.stringify(all),before,'neither offer order nor content is mutated');
});

test('new datasets, replaced arrays and added offers rebuild the index; price and stock remain live references',()=>{
  const A=api(),old=offer('ACTION','A1','MPN-X','8000000011111',60),data={offerte_ordinabili:[old]};
  assert.equal(A.offertaDelPezzo(data,'MPN-X','ACTION'),old);
  const added=offer('ACTION','A2','MPN-X','8000000011111',50);data.offerte_ordinabili.push(added);
  assert.equal(A.offertaDelPezzo(data,'MPN-X','ACTION'),added);
  old.costo_unitario=40;old.stock=0;
  assert.equal(A.offertaDelPezzo(data,'MPN-X','ACTION'),old);
  assert.equal(A.offertaDelPezzo(data,'MPN-X','ACTION').stock,0,'cached identity must not freeze live stock');
  const replacement=offer('ACTION','A1','MPN-X','8000000011111',100);data.offerte_ordinabili=[replacement];
  assert.equal(A.offertaDelPezzo(data,'MPN-X','ACTION'),replacement);
  const publication={offerte_ordinabili:[added]};
  assert.equal(A.offertaDelPezzo(publication,'MPN-X','ACTION'),added);
  assert.equal(A.offertaDelPezzo(data,'MPN-X','ACTION'),replacement);
});

test('explicit index invalidation supports intentional in-place identity corrections',()=>{
  const A=api(),a=offer('ACTION','OLD','MPN-OLD','8000000011111',40),data={offerte_ordinabili:[a]};
  assert.equal(A.offertaDelPezzo(data,'OLD','ACTION'),a);
  a.codice='NEW';a.mpn='MPN-NEW';A.invalidaIndiceOfferte(data);
  assert.equal(A.offertaDelPezzo(data,'OLD','ACTION'),null);
  assert.equal(A.offertaDelPezzo(data,'MPN-NEW','ACTION'),a);
});
