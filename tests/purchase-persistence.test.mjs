import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/supabase-config.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function purchaseProperties('),source.indexOf('// PATCH: aggiorna o inserisce'));
function fixture(options={}) {
 const order={id:1,shopify_order_id:'77-2',stato:'elaborati',foglio_di_lavoro:2,updated_at:'v1',custom_properties:{note:'keep',...options.cp}};
 const rows=[{id:10,order_id:1,component_type:'SSD',ean:'OLD',product_name:'Original',supplier:'ACTION',quantity:1,price:null,is_custom:0},
  {id:11,order_id:1,component_type:'SSD',ean:'SECOND',product_name:'Second',supplier:'ACTION',quantity:1,price:null,is_custom:0}];
 const writes=[];let reads=0;
 const field=(row,key)=>{
  if(!key.includes('->'))return row[key];
  const parts=key.split(/->>?/),text=key.includes('->>');let value=row[parts.shift()];
  for(const part of parts)value=value!=null&&typeof value==='object'?value[part]:undefined;
  return text&&value!=null?(typeof value==='object'?JSON.stringify(value):String(value)):value;
 };
 class Q {
  constructor(table){this.table=table;this.filters=[];this.op='read';}
  select(){return this;} eq(k,v){this.filters.push(r=>field(r,k)===v);return this;}
  is(k,v){this.filters.push(r=>v===null?field(r,k)==null:field(r,k)===v);return this;}
  or(){this.filters.push(r=>r.is_custom==null||r.is_custom===0);return this;}
  update(v){this.op='update';this.value=v;return this;}
  insert(v){this.op='insert';this.value=v;return this;}
  maybeSingle(){return this.then(r=>r.data.length>1?{data:null,error:Error('Componente ambiguo')}:{...r,data:r.data[0]||null});}
  single(){return this.then(r=>({...r,data:r.data[0]}));}
  then(resolve,reject){return Promise.resolve().then(async()=>{
   if(this.op==='read'&&this.table==='processed_order_components'&&options.onRead)options.onRead({order,rows});
   if(this.op==='read'&&this.table==='processed_orders'&&++reads===3&&options.onFresh)options.onFresh({order,rows});
   if(['update','insert'].includes(this.op)&&options.beforeWrite)await options.beforeWrite({order,rows,table:this.table,op:this.op,value:this.value});
   let found=(this.table==='processed_orders'?[order]:rows).filter(r=>this.filters.every(f=>f(r)));
   if(this.op==='update'){writes.push({table:this.table,ids:found.map(r=>r.id),value:this.value});found.forEach(r=>Object.assign(r,this.value));}
   if(this.op==='insert'){
    found=(Array.isArray(this.value)?this.value:[this.value]).map(v=>({...v,id:Math.max(0,...rows.map(r=>r.id))+1,price:v.price??null}));
    rows.push(...found);writes.push({table:this.table,ids:found.map(r=>r.id),value:this.value});
   }
   if(['update','insert'].includes(this.op)&&options.afterWrite)await options.afterWrite({order,rows,table:this.table,op:this.op,value:this.value});
   return {data:JSON.parse(JSON.stringify(found)),error:null};
  }).then(resolve,reject);}
 }
 const s={supabase:{from:t=>new Q(t)}};vm.createContext(s);vm.runInContext(code,s);
 vm.runInContext(source.slice(source.indexOf('async function dbConfirmOrderPurchase('),source.indexOf('// PUT: aggiorna SOLO')),s);
 return {s,order,rows,writes};
}
const plan=()=>({expected:{id:10,type:'SSD',ean:'OLD',supplier:'ACTION',quantity:1},replacement:{ean:'NEW',name:'New SSD',supplier:'OMEGA',quantity:1}});
const exclusion=()=>({key:'77-2|SSD|OLD|ACTION|10',tipo:'SSD',ean:'OLD',fornitore:'ACTION',componentId:10,quantita:1,foglio:2,excluded:true});
test('replacement updates only the exact original row, persists assembly name and preserves prices/history',async()=>{
 const {s,rows,writes,order}=fixture();const result=await s.dbReplacePurchaseComponent('77-2',plan());
 assert.equal(result.component.id,10);assert.equal(rows[0].ean,'NEW');assert.equal(rows[0].product_name,'New SSD');
 assert.equal(rows[1].ean,'SECOND');assert.equal(rows[0].price,null);assert.equal(order.custom_properties.note,'keep');
 assert.deepEqual(writes.map(w=>[w.table,w.ids]),[['processed_orders',[1]],['processed_order_components',[10]],['processed_orders',[1]]]);
 assert.equal(order.custom_properties._modifica_distinta_gestionale,undefined);
 assert.equal(Object.values(order.custom_properties._scelte_acquisto_gestionale)[0].ean,'NEW');
 assert.equal(Object.values(result.customProperties._scelte_acquisto_gestionale)[0].esplicita,true);
});
test('applying an allocation proposal does not pin the old automatic suggestion as a manual choice',async()=>{
 const f=fixture();await f.s.dbReplacePurchaseComponent('77-2',{...plan(),source:'allocation_plan'});
 assert.equal(f.order.custom_properties._scelte_acquisto_gestionale,undefined);
 assert.deepEqual(f.writes.map(w=>w.table),['processed_orders','processed_order_components','processed_orders']);
});
test('a supplier allocation cannot apply a component moved or excluded since review',async()=>{
 const voce=exclusion(), scope={...plan(),source:'allocation_plan',foglio:2,chiaveAcquisto:voce.key};
 const moved=fixture();moved.order.foglio_di_lavoro=3;
 await assert.rejects(()=>moved.s.dbReplacePurchaseComponent('77-2',scope),/spostata/);
 const excluded=fixture({cp:{_esclusioni_acquisto_gestionale:{[voce.key]:{...voce,escluso:true}}}});
 await assert.rejects(()=>excluded.s.dbReplacePurchaseComponent('77-2',scope),/escluso dagli acquisti/);
 assert.equal(moved.writes.length+excluded.writes.length,0);
 assert.equal(excluded.rows[0].ean,'OLD');
});
test('whole RAM replacement can change module count; stale old quantity cannot target the row',async()=>{
 const {s,rows}=fixture();const p=plan();p.replacement.quantity=2;
 assert.equal((await s.dbReplacePurchaseComponent('77-2',p)).component.quantity,2);
 assert.equal(rows[0].quantity,2);await assert.rejects(()=>s.dbReplacePurchaseComponent('77-2',p),/cambiato/);
});
test('ambiguous, stale, acquired, finalized and concurrent rows fail without replacing other parts',async()=>{
 const cases=[
  f=>{f.rows.push({...f.rows[0],id:12});const p=plan();delete p.expected.id;return p;},
  f=>{f.rows[0].ean='DIFFERENT';return plan();},
  f=>{f.rows[0].price=0;return plan();},
  f=>{f.order.stato='finalizzati';return plan();},
  f=>{f.order.custom_properties._acquisto_confermato_gestionale={};return plan();}
 ];
 for(const setup of cases){const f=fixture();const p=setup(f);await assert.rejects(()=>f.s.dbReplacePurchaseComponent('77-2',p));assert.equal(f.writes.length,0);}
 const concurrent=fixture({beforeWrite:({rows})=>{rows[0].price=5;}});
 await assert.rejects(()=>concurrent.s.dbReplacePurchaseComponent('77-2',plan()),/durante/);
 assert.equal(concurrent.rows[0].ean,'OLD');assert.equal(concurrent.rows[1].ean,'SECOND');
 const changed=fixture({onFresh:({order})=>{order.updated_at='v2';}});
 await assert.rejects(()=>changed.s.dbReplacePurchaseComponent('77-2',plan()),/scheda è cambiata/);assert.equal(changed.writes.length,0);
});
test('procurement exclusion and undo write only metadata; assembly, paid values and inventory stay untouched',async()=>{
 const f=fixture({cp:{_costi_netti_gestionale:{'SSD|OLD|ACTION':{unitario:50}}}});
 const before=JSON.stringify(f.rows);const value=exclusion();
 const cp=await f.s.dbSetProcurementExclusion('77-2',value);
 assert.equal(cp._esclusioni_acquisto_gestionale[value.key].componentId,10);
 assert.equal(JSON.stringify(f.rows),before);assert.equal(cp._costi_netti_gestionale['SSD|OLD|ACTION'].unitario,50);
 await f.s.dbSetProcurementExclusion('77-2',{...value,excluded:false});
 assert.equal(Object.keys(f.order.custom_properties._esclusioni_acquisto_gestionale).length,0);
 assert.equal(JSON.stringify(f.rows),before);assert.ok(f.writes.every(w=>w.table==='processed_orders'));
});
test('exclusions reject moved, stale or concurrently edited records without overwriting metadata',async()=>{
 const moved=fixture();await assert.rejects(()=>moved.s.dbSetProcurementExclusion('77-2',{...exclusion(),foglio:1}),/spostata/);assert.equal(moved.writes.length,0);
 const stale=fixture();stale.rows[0].ean='NEW';await assert.rejects(()=>stale.s.dbSetProcurementExclusion('77-2',exclusion()),/cambiato/);assert.equal(stale.writes.length,0);
 const race=fixture({beforeWrite:({order})=>{order.updated_at='v2';}});
 await assert.rejects(()=>race.s.dbSetProcurementExclusion('77-2',exclusion()),/scheda è cambiata/);
 assert.equal(race.order.custom_properties._esclusioni_acquisto_gestionale,undefined);
});
test('derived extras can be excluded without inventing a component, purchase price or inventory movement',async()=>{
 const f=fixture();const cp=await f.s.dbSetProcurementExclusion('77-2',{...exclusion(),key:'77-2|EXTRA|FANS',tipo:'VENTOLE',ean:'EXTRA-FANS',componentId:null,personalizzato:true});
 assert.equal(cp._esclusioni_acquisto_gestionale['77-2|EXTRA|FANS'].personalizzato,true);
 assert.equal(f.rows.length,2);assert.ok(f.writes.every(w=>w.table==='processed_orders'));
});

const purchase=()=>({righe:[{tipo:'SSD',ean:'OLD',fornitore:'ACTION',quantita:1,costo:50},{tipo:'SSD',ean:'SECOND',fornitore:'ACTION',quantita:1,costo:60}],
 spese:{servizi:[],opzioni:[],montaggio:[],personalizzati:0}});
test('purchase confirmation between intent acquisition and component write is rejected for both sources',async()=>{
 for(const source of ['buyer_desk','allocation_plan']){
  let blocked=false,f;
  const opts={beforeWrite:async({table})=>{
   if(table==='processed_order_components'){
    await assert.rejects(()=>f.s.dbConfirmOrderPurchase('77-2',purchase()),/Sostituzione in corso/);blocked=true;
   }
  }};
  f=fixture(opts);await f.s.dbReplacePurchaseComponent('77-2',{...plan(),source});
  assert.equal(blocked,true);assert.equal(f.rows[0].ean,'NEW');assert.equal(f.order.custom_properties._acquisto_confermato_gestionale,undefined);
  assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
 }
});
test('an interrupted intent never expires into a different mutation and resumes the exact same request',async()=>{
 const opts={beforeWrite:({table})=>{if(table==='processed_order_components')throw Error('simulated network interruption');}};
 const f=fixture(opts);await assert.rejects(()=>f.s.dbReplacePurchaseComponent('77-2',plan()),/interruption/);
 assert.ok(f.order.custom_properties._modifica_distinta_gestionale);assert.equal(f.rows[0].ean,'OLD');
 const other=plan();other.replacement.ean='OTHER';await assert.rejects(()=>f.s.dbReplacePurchaseComponent('77-2',other),/Altra sostituzione/);
 await assert.rejects(()=>f.s.dbConfirmOrderPurchase('77-2',purchase()),/Sostituzione in corso/);
 opts.beforeWrite=null;const result=await f.s.dbReplacePurchaseComponent('77-2',plan());
 assert.equal(result.component.ean,'NEW');assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
});
test('an applied component with an interrupted final response recovers without duplicate component writes',async()=>{
 const opts={beforeWrite:({table,order})=>{if(table==='processed_orders'&&order.custom_properties._modifica_distinta_gestionale)throw Error('simulated release interruption');}};
 const f=fixture(opts);await assert.rejects(()=>f.s.dbReplacePurchaseComponent('77-2',plan()),/release interruption/);
 assert.equal(f.rows[0].ean,'NEW');assert.ok(f.order.custom_properties._modifica_distinta_gestionale);
 const before=f.writes.filter(w=>w.table==='processed_order_components').length;
 opts.beforeWrite=null;const result=await f.s.dbReplacePurchaseComponent('77-2',plan());
 assert.equal(result.component.ean,'NEW');assert.equal(f.order.custom_properties._modifica_distinta_gestionale,undefined);
 assert.equal(f.writes.filter(w=>w.table==='processed_order_components').length,before);
});
