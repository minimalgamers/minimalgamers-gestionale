import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCipheriv,pbkdf2Sync,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const app=read('assets/js/app.js');
const section=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)));
const NOW=Date.parse('2026-10-25T20:00:00Z');
function fresh(time=NOW){return {regole_acquisto:'buyerdesk-netto-stock-v1',generato:new Date(time).toISOString(),listini:new Date(time).toISOString(),ordini:{},offerte_ordinabili:[]};}
function env(orders=[]){
 const storage=new Map(), captures=[];
 const build={configKey:'PC GAMING TEST',components:[{type:'CPU',value:'CPU-CODE',supplier:'TIER ONE'},{type:'CASE',value:'CASE BLACK',supplier:'AMAZON'}]};
 const s={window:{},console:{log(){},warn(){},error(){}},TextEncoder,TextDecoder,crypto:webcrypto,
   atob:x=>Buffer.from(x,'base64').toString('binary'),localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
   sessionStorage:{getItem:()=>JSON.stringify(orders)},processedOrdersCache:{},
   identifyPCConfig:n=>/PC GAMING/.test(n)?build:null,getMonitorDisplayValue:i=>i.sku||i.name,
   saveProcessedOrderToDB:async(id,data)=>{captures.push({id,...data});return true;},incrementMonthlyCounter:async()=>{},saveOperatorAssignmentToDB:async()=>{},
   getProcessedOrderIdsFromDB:async()=>[],isOrderProcessed:()=>false,applicaPezziMigliori:async()=>[],
   getPreferredCustomerPhone:()=>null,normalizePhoneForStorage:()=>null,showNotification(){},setTimeout,clearTimeout};
 s.globalThis=s;vm.createContext(s);
 vm.runInContext(read('assets/js/multi-order-handler.js'),s);
 vm.runInContext(read('assets/js/accoppiamento-auto.js'),s);
 return {s,A:s.window.AccoppiamentoAuto,storage,captures,build};
}
const pc={id:1,name:'PC GAMING TEST',quantity:1,custom_properties:{}};
const keyboard={id:2,name:'Havit KB902L tastiera',sku:'GAMHAVKLA0002',quantity:1};
const mouse={id:3,name:'Logitech G305 mouse',sku:'LOG-G305',quantity:1};

test('single real processing preserves two different peripherals, name, SKU and supplier',async()=>{
 const order={id:77,name:'#77',line_items:[pc,keyboard,mouse]}, {s,captures}=env([order]);
 vm.runInContext(section('async function _processOrderImpl(','// Pezzi migliori all\'elaborazione'),s);
 await s._processOrderImpl(77,true);
 const components=captures[0].components;
 assert.deepEqual(Array.from(components.filter(c=>['TASTIERA','MOUSE'].includes(c.type)),c=>[c.type,c.ean,c.name,c.quantity]),
  [['TASTIERA','GAMHAVKLA0002',keyboard.name,1],['MOUSE','LOG-G305',mouse.name,1]]);
 assert.equal(components.find(c=>c.type==='CPU').supplier,'TIER ONE');
 assert.ok(!components.some(c=>c.type==='KIT GAMING'));
});
test('processing PC2 alone and whole order yields the exact same bill of materials',async()=>{
 const order={id:77,line_items:[{...pc,quantity:2},{id:4,name:'MONITOR UNO',sku:'MON-1',quantity:1},{id:5,name:'MONITOR DUE',sku:'MON-2',quantity:1},keyboard,mouse]};
 const {s,captures}=env([order]);
 await s.processSingleSplitPC('77.2',order,1,{countA:0,countB:0},true);
 const single=captures.splice(0)[0].components;
 await s.processMultiPCOrder(77,order,{countA:0,countB:0},true);
 assert.equal(JSON.stringify(single),JSON.stringify(captures[1].components));
 assert.equal(single.find(c=>c.type==='MONITOR').ean,'MON-2');
 assert.equal(single.find(c=>c.type==='CPU').supplier,'TIER ONE');
 assert.equal(captures[0].components.find(c=>c.type==='MOUSE').ean,'LOG-G305');
});
test('excess units and included bundle accessories are retained; refunded units excluded',()=>{
 const order={line_items:[{...pc,quantity:2},{id:4,name:'Monitor UNO',sku:'M1',quantity:3},{...mouse,current_quantity:0}]};
 const {s}=env();const assignments=s.shopifyAccessoryAssignments(order);
 assert.equal(assignments[0][0].quantity,2);assert.equal(assignments[1][0].quantity,1);
 assert.ok(!assignments.flat().some(c=>c.type==='MOUSE'));
 const base=[{type:'MONITOR',value:'MONITOR INCLUSO'}];s.appendShopifyAccessories(base,order,0);
 assert.equal(base.length,2);assert.equal(base[0].value,'MONITOR INCLUSO');
});
test('saved peripheral repair is a pure preview and paid history is protected',()=>{
 const order={id:77,line_items:[pc,keyboard,mouse]}, {s}=env([order]);
 const old=[{type:'CPU',ean:'CPU-CODE',quantity:1},{type:'KIT GAMING',ean:keyboard.sku,quantity:2,price:null}];
 const before=JSON.stringify(old),plan=s.shopifyAccessoryRepairPlan(order,0,old);
 assert.equal(JSON.stringify(old),before);assert.equal(plan.changed,true);
 assert.deepEqual(Array.from(plan.components,c=>c.type),['TASTIERA','MOUSE']);
 assert.equal(s.shopifyAccessoryRepairPlan(order,0,[...old,{type:'SSD',price:50}]),null);
 assert.match(s.shopifyAccessorySummary(77,old),/Havit KB902L.*Logitech G305/);
});
test('case and AIO respect colour; RAM, GPU and air cooler do not restrict purchase colour',()=>{
 const {A}=env();const a={descrizione:'WHITE',quantita:1};
 assert.equal(A.rispettaScheda('MINIMAL','RAM','BLACK',a,1),true);
 assert.equal(A.rispettaScheda('MINIMAL','GPU','BLACK',a,1),true);
 assert.equal(A.rispettaScheda('MINIMAL','COOLER','AK400 BLACK',a,1),true);
 assert.equal(A.rispettaScheda('MINIMAL','CASE','BLACK',a,1),false);
 assert.equal(A.rispettaScheda('MINIMAL','COOLER','LIQUIDO 240MM BLACK',a,1),false);
 assert.equal(A.rispettaScheda('MSI','GPU','MSI RTX 5070',{...a,descrizione:'PNY RTX 5070 WHITE'},1),false);
});
test('refresh does not claim success on failed dispatch, old catalog, stale data or timeout',async()=>{
 const {A}=env();let ticks=NOW;
 await assert.rejects(()=>A.attendiListini({stato:'errore'},fresh(),{leggi:async()=>fresh(),now:()=>ticks}),/non riuscito/);
 await assert.rejects(()=>A.attendiListini({stato:'in_corso'},fresh(),{leggi:async()=>fresh(),now:()=>ticks,pausa:async ms=>{ticks+=ms},timeout:40000}),/non sono ancora arrivati/);
 await assert.rejects(()=>A.attendiListini({stato:'recente'},fresh(),{leggi:async()=>fresh(NOW-3600000),now:()=>NOW}),/non sono aggiornati/);
 assert.throws(()=>A.verificaListini({...fresh(),regole_acquisto:'old'},300000,NOW),/motore aggiornato/);
});
test('refresh accepts a new matching publication and recent valid one',async()=>{
 const {A}=env();const latest=fresh(NOW+20000);let ticks=NOW;
 assert.equal((await A.attendiListini({stato:'avviato'},fresh(),{leggi:async()=>latest,now:()=>ticks,pausa:async ms=>{ticks+=ms}})).generato,latest.generato);
 assert.equal((await A.attendiListini({stato:'recente'},fresh(),{leggi:async()=>fresh(),now:()=>NOW})).generato,fresh().generato);
});
test('stock and exact customer requirement are checked again across the entire purchase plan',()=>{
 const {A}=env();const a={codice:'GPU-A',fornitore:'ACTION',costo:100,costo_unitario:100,quantita:1,stock:1,ordinabile:true};
 const part={tipo:'GPU',auto:a,alternative:[a]},d=fresh();d.offerte_ordinabili=[a];
 d.ordini={77:{pc:[{quantita:1,pezzi:[part]}]},88:{pc:[{quantita:1,pezzi:[{tipo:'GPU',auto:null}]}]}};
 const choice={orderId:'77',tipo:'GPU',quantita:1,a};
 assert.equal(A.validaScelte(d,[choice]),true);
 assert.throws(()=>A.validaScelte(d,[choice,{...choice,orderId:'88'}]),/non corrisponde/);
 d.ordini[88].pc[0].pezzi=[part];
 assert.throws(()=>A.validaScelte(d,[choice]),/Quantità insufficiente/);
 delete d.ordini[88];
 assert.throws(()=>A.validaScelte(d,[{...choice,a:{...a,costo:99}}]),/prezzo cambiato/);
 assert.equal(A.offertaOrdinabile({...a,disponibilita:'in arrivo il 30/10'}),false);
 assert.equal(A.offertaOrdinabile({...a,da_confermare:true}),false);
 assert.match(A.comeSiPaga('ACTION','GPU',100),/costo netto d’acquisto 100,00.*listino fornitore 110,91.*intermediario \+10%/);
 assert.match(A.comeSiPaga('ACTION','CPU',100),/CPU diretta, costo netto uguale al listino/);
});
test('saving all rows preserves quantities and paid prices without reading abbreviated names',async()=>{
 const {s}=env();let sent;
 s.processedOrdersCache.TEST={components:[{type:'SSD ADDON',ean:'SSD-2',name:'SSD esatto',supplier:'AMAZON',quantity:2,price:30}]};
 const span={dataset:{ean:'SSD-2'},textContent:'SSD generico'},badge={dataset:{supplier:'AMAZON'}};
 s.document={querySelectorAll:()=>[{dataset:{componentType:'SSD ADDON'},querySelector:q=>q.includes('name-display')?span:badge}]};
 s.PROCESSED_ORDERS_API_URL='test';s.fetch=async(url,opts)=>{sent=JSON.parse(opts.body);return {json:async()=>({success:true})}};
 vm.runInContext(section('async function saveAllCurrentComponentsToDB(','async function loadOrderStatusesFromDB('),s);
 assert.equal(await s.saveAllCurrentComponentsToDB('TEST',null,null,null,null,false),true);
 assert.equal(sent.components[0].quantity,2);assert.equal(sent.components[0].price,30);assert.equal(sent.components[0].name,'SSD esatto');
});

function encrypted(data){
 const salt=Buffer.alloc(16,1),iv=Buffer.alloc(12,2),aad='test';const key=pbkdf2Sync('test',salt,1000,32,'sha256');
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
 const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final(),cipher.getAuthTag()]);
 return {salt:salt.toString('base64'),iv:iv.toString('base64'),aad,iter:1000,dati:body.toString('base64')};
}
test('historical repair cannot save without preview confirmation and backup precedes any DB mutation',async()=>{
 const order={id:77,name:'#77',line_items:[pc,keyboard,mouse]};
 const {s,A,storage}=env([order]);const d=fresh(Date.now());
 s.processedOrdersCache[77]={components:[{type:'CPU',ean:'CPU-CODE',quantity:1},{type:'KIT GAMING',ean:keyboard.sku,quantity:2,price:null}]};
 d.ordini[77]={pc:[{quantita:1,pezzi:[{tipo:'TASTIERA',origine:'articolo Shopify',cliente:keyboard.name,manuale:{codice:keyboard.sku,quantita:1}},
   {tipo:'MOUSE',origine:'articolo Shopify',cliente:mouse.name,manuale:{codice:mouse.sku,quantita:1}}]}]};
 storage.set('shopify_session',JSON.stringify({apiKey:'test'}));
 s.fetch=async()=>({ok:true,json:async()=>encrypted(d)});
 const plan=A.proposteAccessori(['77'],d)[0].riparazioneAccessori;
 const x={orderId:'77',riparazioneAccessori:plan};let writes=0;
 s.window.SupabaseDB={reconcileOrderAccessories:async()=>{assert.ok(storage.get('accoppiamento_backup_accessori'));writes++;}};
 await assert.rejects(()=>A.salvaProposte([x]),/Conferma prima/);assert.equal(writes,0);
 d.ordini[77].pc[0].pezzi[1].cliente='Mouse modificato dopo il confronto';
 await assert.rejects(()=>A.salvaProposte([x],{confermaAccessori:true}),/Shopify sono cambiati/);assert.equal(writes,0);
 d.ordini[77].pc[0].pezzi[1].cliente=mouse.name;
 assert.equal(await A.salvaProposte([x],{confermaAccessori:true}),1);assert.equal(writes,1);
});

test('confirmed repair touches only accessory rows, rejects paid or concurrently edited records',async()=>{
 const dbSource=read('assets/js/supabase-config.js');
 const code=dbSource.slice(dbSource.indexOf('async function dbReconcileOrderAccessories('),dbSource.indexOf('// PUT: aggiorna SOLO'));
 const plan={previous:[{type:'KIT GAMING',ean:'K',quantity:2}],components:[{type:'TASTIERA',ean:'K',name:'Havit',quantity:1},{type:'MOUSE',ean:'M',name:'Logitech',quantity:1}]};
 function mock(rows){
  const writes=[];
  class Query {
   constructor(table){this.table=table;this.filters=[];this.op='read';}
   select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}is(k,v){return this.eq(k,v);}or(){return this;}
   single(){return this.then(r=>({...r,data:r.data[0]}));}
   update(data){this.op='update';this.data=data;return this;}insert(data){this.op='insert';this.data=data;return this;}delete(){this.op='delete';return this;}
   then(resolve,reject){
    try {
     if(this.table==='processed_orders')return Promise.resolve({data:[{id:1,shopify_order_id:'77',stato:'elaborati'}],error:null}).then(resolve,reject);
     let found=rows.filter(r=>this.filters.every(f=>f(r)));
     if(this.op==='update'){writes.push({op:this.op,ids:found.map(r=>r.id)});found.forEach(r=>Object.assign(r,this.data));}
     if(this.op==='insert'){const row={...this.data,id:100+rows.length};rows.push(row);found=[row];writes.push({op:this.op,ids:[row.id]});}
     if(this.op==='delete'){writes.push({op:this.op,ids:found.map(r=>r.id)});for(const row of found)rows.splice(rows.indexOf(row),1);}
     return Promise.resolve({data:found,error:null}).then(resolve,reject);
    }catch(e){return Promise.reject(e).then(resolve,reject);}
   }
  }
  const context={supabase:{from:table=>new Query(table)}};vm.createContext(context);vm.runInContext(code,context);
  return {context,writes};
 }
 const rows=[{id:1,order_id:1,component_type:'CPU',ean:'CPU',quantity:1,price:null},{id:2,order_id:1,component_type:'KIT GAMING',ean:'K',quantity:2,price:null}];
 const {context,writes}=mock(rows);await context.dbReconcileOrderAccessories('77',plan);
 assert.equal(rows[0].ean,'CPU');assert.ok(!writes.some(w=>w.ids.includes(1)));
 assert.deepEqual(rows.slice(1).map(r=>[r.component_type,r.ean,r.quantity]),[['TASTIERA','K',1],['MOUSE','M',1]]);
 const paid=mock([{...rows[0],price:50}]);await assert.rejects(()=>paid.context.dbReconcileOrderAccessories('77',plan),/confermato/);assert.equal(paid.writes.length,0);
 const changed=mock([{id:2,order_id:1,component_type:'KIT GAMING',ean:'OTHER',quantity:2,price:null}]);
 await assert.rejects(()=>changed.context.dbReconcileOrderAccessories('77',plan),/sono cambiati/);assert.equal(changed.writes.length,0);
});
