import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Reuse the in-memory PostgREST double. No client, credentials or network.
const source=readFileSync(new URL('../assets/js/supabase-config.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function purchaseProperties('),source.indexOf('async function dbDeleteProcessedOrder('));
const mocks=readFileSync(new URL('./purchase-persistence.test.mjs',import.meta.url),'utf8');
const fixtureCode=mocks.slice(mocks.indexOf('function fixture('),mocks.indexOf('const plan='))
 .replace('single(){return this.then','maybeSingle(){return this.single();}\n  single(){return this.then');
const scope={source,code,vm};vm.createContext(scope);vm.runInContext(fixtureCode,scope);
const plan={expected:{id:10,type:'SSD',ean:'OLD',supplier:'ACTION',quantity:1},replacement:{ean:'NEW',name:'New SSD',supplier:'OMEGA',quantity:1}};

test('legacy save begun before a Buyer Desk replacement cannot overwrite the confirmed new component',async()=>{
 let f,entered=false;
 f=scope.fixture({beforeWrite:async({table,value})=>{if(table==='processed_orders'&&value?.custom_properties?._modifica_distinta_gestionale?.kind&&!entered){entered=true;await f.s.dbReplacePurchaseComponent('77-2',plan);}}});
 f.rows.splice(1);
 await assert.rejects(()=>f.s.dbUpsertSingleComponent('77-2','SSD','LEGACY','Legacy SSD','ACTION'),/scheda è cambiata|componente è cambiato/);
 assert.equal(f.rows[0].ean,'NEW');assert.equal(f.rows[0].supplier,'OMEGA');assert.equal(f.rows[0].price,null);
});
test('old price cannot transfer to a replacement through the category-only fallback',async()=>{
 let f,entered=false;
 f=scope.fixture({beforeWrite:async({table,value})=>{if(table==='processed_orders'&&value?.custom_properties?._modifica_distinta_gestionale?.kind&&!entered){entered=true;await f.s.dbReplacePurchaseComponent('77-2',plan);}}});
 f.rows.splice(1);
 await assert.rejects(()=>f.s.dbSetComponentPrices('77-2',[{type:'SSD',ean:'OLD',price:50}]),/scheda è cambiata|componente o il prezzo è cambiato/);
 assert.equal(f.rows[0].ean,'NEW');assert.equal(f.rows[0].price,null);
 const already=scope.fixture();already.rows[0].ean='NEW';already.rows.splice(1);
 await assert.rejects(()=>already.s.dbSetComponentPrices('77-2',[{type:'SSD',ean:'OLD',price:50}]),/cambiato o ambiguo/);
 assert.equal(already.rows[0].price,null);assert.equal(already.writes.length,0);
});
test('valid exact-row legacy updates retain normal behaviour, including a real zero paid price',async()=>{
 const f=scope.fixture();f.rows.splice(1);
 assert.equal(await f.s.dbUpsertSingleComponent('77-2','SSD','OTHER','Other SSD','ABACO'),'update');
 assert.equal(f.rows[0].ean,'OTHER');
 assert.equal(await f.s.dbSetComponentPrices('77-2',[{type:'SSD',ean:'OTHER',price:0}]),1);
 assert.equal(f.rows[0].price,0);
 await assert.rejects(()=>f.s.dbUpsertSingleComponent('77-2','SSD','BAD','Bad SSD','ACTION'),/protetto/);
 assert.equal(f.rows[0].ean,'OTHER');
});
test('multiple legitimate identical rows receive their own exact prices; completed history stays protected',async()=>{
 const f=scope.fixture();f.rows[1].ean='OLD';
 assert.equal(await f.s.dbSetComponentPrices('77-2',[{type:'SSD',ean:'OLD',price:42}]),2);
 assert.deepEqual(Array.from(f.rows,r=>r.price),[42,42]);
 f.order.stato='finalizzati';
 await assert.rejects(()=>f.s.dbSetComponentPrices('77-2',[{type:'SSD',ean:'OLD',price:1}]),/storico protetto/);
 assert.deepEqual(Array.from(f.rows,r=>r.price),[42,42]);
});
test('a late price response cannot attach the old price to a new component in the browser cache',async()=>{
 const cached={components:[{type:'SSD',ean:'OLD',supplier:'ACTION',price:null}]};
 const s={window:{SupabaseDB:{setComponentPrices:async()=>{cached.components=[{type:'SSD',ean:'NEW',supplier:'OMEGA',price:null}];}}},
  processedOrdersCache:{'77':cached},localStorage:{getItem(){return null;}},console};
 vm.createContext(s);vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),s);
 await s.window.AccoppiamentoAuto.salvaPrezzi('77',[{type:'SSD',ean:'OLD',price:50}]);
 assert.equal(cached.components[0].ean,'NEW');assert.equal(cached.components[0].price,null);
});
