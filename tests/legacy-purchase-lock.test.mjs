import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Exercise the real public writer/confirmation functions against an in-memory
// PostgREST double. No credentials, browser, network or live data are involved.
const source=readFileSync(new URL('../assets/js/supabase-config.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function purchaseProperties('),source.indexOf('async function dbDeleteProcessedOrder('));
const mocks=readFileSync(new URL('./purchase-persistence.test.mjs',import.meta.url),'utf8');
const fixtureCode=mocks.slice(mocks.indexOf('function fixture('),mocks.indexOf('const plan='));
const scope={source,code,vm};vm.createContext(scope);vm.runInContext(fixtureCode,scope);
const snapshot=()=>({righe:[{tipo:'SSD',ean:'OLD',fornitore:'ACTION',quantita:1,costo:40}],
  spese:{servizi:[],opzioni:[],montaggio:[],personalizzati:0}});
const calls={component:f=>f.s.dbUpsertSingleComponent('77-2','SSD','LEGACY','Legacy SSD','ACTION'),
  prices:f=>f.s.dbSetComponentPrices('77-2',[{type:'SSD',ean:'OLD',price:50}])};

test('both legacy writers hold the parent intent while a concurrent purchase confirmation is rejected',async()=>{
  for(const [kind,call]of Object.entries(calls)){
    let f,entered=false,blocked;
    f=scope.fixture({beforeWrite:async({table})=>{
      if(table!=='processed_order_components'||entered)return;entered=true;
      assert.ok(f.order.custom_properties._modifica_distinta_gestionale,'intent must precede the component request');
      try{await f.s.dbConfirmOrderPurchase('77-2',snapshot());}catch(e){blocked=e.message;}
    }});f.rows.splice(1);
    await call(f);
    assert.match(blocked,/in corso/);assert.equal(f.order.custom_properties._acquisto_confermato_gestionale,undefined);
    assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined,'successful operations release their own intent');
    assert.equal(f.rows[0].ean,kind==='component'?'LEGACY':'OLD');assert.equal(f.rows[0].price,kind==='prices'?50:null);
  }
});

test('a purchase snapshot winning before intent acquisition prevents both stale legacy mutations',async()=>{
  for(const call of Object.values(calls)){
    let f,entered=false;
    f=scope.fixture({beforeWrite:async({table,value})=>{
      if(table!=='processed_orders'||!value.custom_properties?._modifica_distinta_gestionale?.kind||entered)return;
      entered=true;await f.s.dbConfirmOrderPurchase('77-2',snapshot());
    }});f.rows.splice(1);
    await assert.rejects(()=>call(f),/scheda è cambiata|acquisto.*confermato/i);
    assert.equal(f.rows[0].ean,'OLD');assert.equal(f.rows[0].price,null);
    assert.equal(f.order.custom_properties._acquisto_confermato_gestionale.righe[0].costo,40);
    assert.equal(f.writes.filter(w=>w.table==='processed_order_components').length,0);
  }
});

test('same-millisecond timestamps cannot bypass an already-acquired purchase snapshot',async()=>{
  const fixed=Date.parse('2026-11-06T12:00:00.000Z');
  class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
  for(const call of Object.values(calls)){
    let f,entered=false;
    f=scope.fixture({beforeWrite:async({table,value})=>{
      if(table!=='processed_orders'||!value.custom_properties?._modifica_distinta_gestionale?.kind||entered)return;
      entered=true;await f.s.dbConfirmOrderPurchase('77-2',snapshot());
    }});f.rows.splice(1);f.order.updated_at=new FrozenDate().toISOString();f.s.Date=FrozenDate;
    await assert.rejects(()=>call(f),/scheda è cambiata|acquisto.*confermato/i);
    assert.equal(f.rows[0].ean,'OLD');assert.equal(f.rows[0].price,null);
    assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
  }
});

test('frozen and finalized orders reject legacy writers before any parent or component write',async()=>{
  for(const call of Object.values(calls))for(const state of ['frozen','finalized']){
    const f=scope.fixture();f.rows.splice(1);
    if(state==='frozen')f.order.custom_properties._acquisto_confermato_gestionale=snapshot();else f.order.stato='finalizzati';
    await assert.rejects(()=>call(f),/protett/i);assert.equal(f.writes.length,0);
  }
});

test('a partial price batch retains protection and retries only remaining exact rows',async()=>{
  let f,failed=false;
  f=scope.fixture({beforeWrite:async({table,value})=>{
    if(table==='processed_order_components'&&value.price===50&&!failed){failed=true;throw Error('Unknown network outcome');}
  }});
  const prices=[{type:'SSD',ean:'OLD',price:40},{type:'SSD',ean:'SECOND',price:50}];
  await assert.rejects(()=>f.s.dbSetComponentPrices('77-2',prices),/network/);
  assert.deepEqual(Array.from(f.rows,r=>r.price),[40,null]);assert.equal(f.order.custom_properties._modifica_distinta_gestionale.kind,'legacy_prices');
  await assert.rejects(()=>f.s.dbConfirmOrderPurchase('77-2',snapshot()),/in corso/);
  assert.equal(await f.s.dbSetComponentPrices('77-2',prices),2);
  assert.deepEqual(Array.from(f.rows,r=>r.price),[40,50]);assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
  assert.deepEqual(Array.from(f.writes.filter(w=>w.table==='processed_order_components'),w=>Array.from(w.ids)),[[10],[11]],'the completed first row is not rewritten');
});

test('an exact legacy update with a lost completion response recovers without duplicate component writes',async()=>{
  let f,failed=false;
  f=scope.fixture({afterWrite:async({table})=>{if(table==='processed_order_components'&&!failed){failed=true;throw Error('Response lost after commit');}}});f.rows.splice(1);
  await assert.rejects(()=>calls.component(f),/Response lost/);assert.equal(f.rows[0].ean,'LEGACY');
  assert.ok(f.order.custom_properties._modifica_distinta_gestionale);
  assert.equal(await calls.component(f),'update');assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
  assert.equal(f.writes.filter(w=>w.table==='processed_order_components').length,1);
});

test('a new legacy component with a lost insert response recovers one exact inserted row',async()=>{
  let f,failed=false;
  f=scope.fixture({afterWrite:async({table,op})=>{if(table==='processed_order_components'&&op==='insert'&&!failed){failed=true;throw Error('Insert response lost');}}});
  const insert=()=>f.s.dbUpsertSingleComponent('77-2','GPU','ARC','Intel Arc','ACTION');
  await assert.rejects(insert,/response lost/);assert.equal(f.rows.filter(r=>r.component_type==='GPU').length,1);
  assert.equal(await insert(),'insert');assert.equal(f.rows.filter(r=>r.component_type==='GPU').length,1);
  assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
});

test('an uncertain insert is never blindly repeated and can recover after its delayed commit appears',async()=>{
  let f,attempts=0;
  f=scope.fixture({beforeWrite:async({table,op})=>{if(table==='processed_order_components'&&op==='insert'){attempts++;throw Error('Unknown insert outcome');}}});
  const insert=()=>f.s.dbUpsertSingleComponent('77-2','GPU','ARC','Intel Arc','ACTION');
  await assert.rejects(insert,/Unknown insert/);assert.equal(attempts,1);
  await assert.rejects(insert,/Inserimento in verifica/);assert.equal(attempts,1);
  const intent=f.order.custom_properties._modifica_distinta_gestionale;
  f.rows.push({id:99,order_id:1,component_type:'GPU',ean:intent.desired.ean,product_name:intent.desired.name,
    supplier:intent.desired.supplier,quantity:intent.desired.quantity,price:null,is_custom:0});
  assert.equal(await insert(),'insert');assert.equal(attempts,1);assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
});

test('identity changes during a price batch cannot receive an old paid price',async()=>{
  let f,changed=false;
  f=scope.fixture({beforeWrite:async({table,rows})=>{if(table==='processed_order_components'&&!changed){changed=true;rows[0].ean='NEW';}}});f.rows.splice(1);
  await assert.rejects(()=>calls.prices(f),/componente o il prezzo è cambiato/);
  assert.equal(f.rows[0].ean,'NEW');assert.equal(f.rows[0].price,null);
  await assert.rejects(()=>calls.prices(f),/componente.*cambiato/);
  assert.equal(f.rows[0].price,null);
});


test('a finalization with an unchanged parent timestamp defeats legacy and exact intent acquisition',async()=>{
  const operations=[...Object.values(calls),f=>f.s.dbReplacePurchaseComponent('77-2',{
    expected:{id:10,type:'SSD',ean:'OLD',supplier:'ACTION',quantity:1},replacement:{ean:'NEW',name:'New SSD',supplier:'OMEGA',quantity:1}})];
  for(const call of operations){
    let f,entered=false;
    f=scope.fixture({beforeWrite:async({table,value,order})=>{
      if(table==='processed_orders'&&value.custom_properties?._modifica_distinta_gestionale&&!entered){entered=true;order.stato='finalizzati';}
    }});f.rows.splice(1);
    await assert.rejects(()=>call(f),/scheda è cambiata/);
    assert.equal(f.rows[0].ean,'OLD');assert.equal(f.rows[0].price,null);
    assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
    assert.equal(f.writes.filter(w=>w.table==='processed_order_components').length,0);
  }
});

test('exact replacement also rejects a purchase snapshot acquired in the same millisecond',async()=>{
  const fixed=Date.parse('2026-11-06T12:00:00.000Z');
  class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
  let f,entered=false;
  f=scope.fixture({beforeWrite:async({table,value})=>{
    if(table==='processed_orders'&&value.custom_properties?._modifica_distinta_gestionale&&!entered){entered=true;await f.s.dbConfirmOrderPurchase('77-2',snapshot());}
  }});f.rows.splice(1);f.order.updated_at=new FrozenDate().toISOString();f.s.Date=FrozenDate;
  await assert.rejects(()=>f.s.dbReplacePurchaseComponent('77-2',{
    expected:{id:10,type:'SSD',ean:'OLD',supplier:'ACTION',quantity:1},replacement:{ean:'NEW',name:'New SSD',supplier:'OMEGA',quantity:1}}),/scheda è cambiata/);
  assert.equal(f.rows[0].ean,'OLD');assert.equal(f.rows[0].price,null);
  assert.equal(f.order.custom_properties._acquisto_confermato_gestionale.righe[0].costo,40);
});
