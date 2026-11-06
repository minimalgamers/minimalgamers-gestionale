import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const pc={id:20917560279383,product_id:10239585059159,name:'PC GAMING INFERNUS',quantity:1};
const keyboard={id:20917560344919,product_id:10265066045783,
 name:'MG M96 PRO SET, TASTIERA WIRELESS RGB 96 TASTI CON DISPLAY DIGITALE + MOUSE GAMING WIRELESS X7, DUAL MODE BLUETOOTH/2.4G - GLIMMER GREY',
 sku:'e12144cf-9628-4a79-a581-372950d76c37',quantity:1,current_quantity:1};
function env(order={id:8468311736663,name:'#4909',line_items:[pc,keyboard]}){
 const s={window:{},console,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>JSON.stringify([order])},
  processedOrdersCache:{},identifyPCConfig:n=>/PC GAMING/.test(n)?{configKey:'PC GAMING INFERNUS',components:[]}:null};
 vm.createContext(s);vm.runInContext(read('assets/js/multi-order-handler.js'),s);vm.runInContext(read('assets/js/accoppiamento-auto.js'),s);
 return {s,A:s.window.AccoppiamentoAuto,order};
}
const verified=(item,type,quantity=1)=>({type,ean:item.sku,name:item.name,quantity,sourceLineId:String(item.id)});

test('a keyboard/mouse set with its own display never becomes a monitor from the backend repair feed',()=>{
 const {s,A,order}=env();assert.equal(s.shopifyAccessoryType(keyboard),'TASTIERA');
 const existing=s.shopifyAccessoryAssignments(order)[0].map(c=>({...c,price:null}));
 const before=JSON.stringify(existing);
 assert.equal(s.shopifyAccessoryRepairPlan(order,0,existing,[verified(keyboard,'MONITOR')]),null);
 const data={ordini:{[order.id]:{pc:[{quantita:1,pezzi:[{tipo:'MONITOR',origine:'articolo Shopify',cliente:keyboard.name,
  source_line_id:String(keyboard.id),manuale:{codice:keyboard.sku,quantita:1}}]}]}}};
 s.processedOrdersCache[String(order.id)]={components:existing};
 assert.equal(A.proposteAccessori([String(order.id)],data).length,0);
 assert.equal(JSON.stringify(existing),before);
});

test('real monitors remain monitors; displays inside peripherals, cooling, cases or furniture are not monitors',()=>{
 const {s}=env();
 for(const name of ['Monitor LG UltraGear 24GQ50F 24 Full HD 180Hz 1ms','Display DELL P2425H 24 IPS','Schermo ASUS TUF 27 165Hz']){
  const item={name};assert.equal(s.isMonitorLineItem(item),true,name);assert.equal(s.shopifyAccessoryType(item),'MONITOR',name);
 }
 for(const name of [keyboard.name,'Wireless keyboard with LCD display','Gaming mouse with OLED display','Headset with digital display',
  'Sedia gaming con display massaggiante','Gaming chair with display','Scrivania gaming con display','Gaming desk with LCD display',
  'Dissipatore a liquido 360mm con display LED','CASE ATX con display LCD','Alimentatore con display','SSD con display'])
  assert.equal(s.isMonitorLineItem({name}),false,name);
 assert.equal(s.shopifyAccessoryType({name:'Wireless keyboard with LCD display'}),'TASTIERA');
 assert.equal(s.shopifyAccessoryType({name:'Gaming mouse with OLED display'}),'MOUSE');
 assert.equal(s.shopifyAccessoryType({name:'Headset with digital display'}),'CUFFIE');
 for(const name of ['OPZIONI INFERNUS - DISSIPATORE A LIQUIDO 360MM CON DISPLAY LED','MINIMAL BOOSTER — Ottimizzazione PC su misura'])
  assert.equal(s.shopifyAccessoryType({name}),null);
});

test('verified accessories must retain the exact assigned line, category and quantity for each PC',()=>{
 const order={id:77,line_items:[{...pc,quantity:2},{...keyboard,quantity:3,current_quantity:3}]};
 const {s}=env(order),existing=s.shopifyAccessoryAssignments(order)[1];
 const extra=verified(keyboard,'TASTIERA',1),before=JSON.stringify(existing);
 const plan=s.shopifyAccessoryRepairPlan(order,1,existing,[extra]);
 assert.equal(plan.components[0].ean,keyboard.sku);assert.equal(plan.components[0].quantity,1);
 for(const invalid of [[{...extra,quantity:2}],[{...extra,sourceLineId:'other-line'}],[{...extra,ean:'different-sku'}],[]])
  assert.equal(s.shopifyAccessoryRepairPlan(order,1,existing,invalid),null);
 assert.equal(s.shopifyAccessoryRepairPlan(order,1,existing.map(c=>({...c,price:80})),[extra]),null);
 assert.equal(JSON.stringify(existing),before);
 // Old publications without line ids remain usable only when exact SKU/name identifies the assigned item.
 const legacy={...extra,ean:existing[0].ean};delete legacy.sourceLineId;
 assert.ok(s.shopifyAccessoryRepairPlan(order,1,existing,[legacy]));
});

test('an unavailable keyboard cost cannot inherit a generic monitor budget',()=>{
 const {A}=env();const wrong={tipo:'MONITOR',manuale:{codice:keyboard.sku,fornitore:'',quantita:1},
  riferimento_costo:{costo:65.57,fonte:'budget'}};
 assert.equal(A.pezzoDellaRiga({pezzi:[wrong]},'TASTIERA',keyboard.sku),null);
 assert.equal(A.costoRigaVerificato({tipo:'TASTIERA',ean:keyboard.sku,quantita:1,pRiga:null}).costo,null);
 assert.equal(A.costoRigaVerificato({tipo:'TASTIERA',ean:keyboard.sku,quantita:1,pagato:50,pRiga:null}).costo,50);
});
