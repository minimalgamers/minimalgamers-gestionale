import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function env(){
 const s={window:{},console,setTimeout,clearTimeout,processedOrdersCache:{},localStorage:{getItem:()=>null},identifyPCConfig:n=>/PC GAMING/.test(n)?{}:null};
 vm.createContext(s);for(const f of ['multi-order-handler','upgrade-paid-sync','accoppiamento-auto'])vm.runInContext(fs.readFileSync(new URL('../assets/js/'+f+'.js',import.meta.url),'utf8'),s);
 return {s,A:s.window.AccoppiamentoAuto};
}
const line=(price='1000',quantity=1)=>({id:500,name:'PC GAMING DEMO',price,quantity,current_quantity:quantity,properties:[],tax_lines:[{rate:.22}],discount_allocations:[{amount:(Number(price)*quantity*.18).toFixed(2),discount_application_index:0}]});
const order=()=>({id:100,name:'#DEMO',current_total_price:'820',total_price:'820',line_items:[line()]});
test('the confirmed whole-order 18% convention uses VAT 4%, preserving actual discounted receipts',()=>{
 const {A}=env(),o=order(),before=JSON.stringify(o),v=A.prezzoVendita('100',[o],{});
 assert.equal(v.totale,820);assert.equal(v.sconti,180);assert.equal(v.iva_vendita.aliquota,.04);
 assert.equal(v.imponibile,820/1.04);assert.equal(JSON.stringify(o),before);
 assert.equal(A.utile(v.totale,600,v).srl,106.09);
});
test('partial, compounded, other-percent and unrelated discounts do not trigger the convention',()=>{
 const {A}=env();
 for(const mutate of [o=>o.line_items.push({...line('50'),discount_allocations:[]}),o=>o.line_items[0].discount_allocations.push({amount:'2',discount_application_index:1}),o=>o.line_items[0].discount_allocations[0].amount='170',o=>o.line_items.push({...line('50'),discount_allocations:[{amount:'9',discount_application_index:1}]}),o=>delete o.line_items[0].discount_allocations[0].discount_application_index]){
  const o=order();mutate(o);assert.equal(A.ivaVendita('100',o).aliquota,.22);
 }
});
test('quantity, cents and removed lines preserve the whole-order recognition',()=>{
 const {A}=env(),o=order();o.line_items=[line('123.45',3),{...line('50'),current_quantity:0,discount_allocations:[]}];
 assert.equal(A.ivaVendita('100',o).aliquota,.04);
 o.line_items[0].discount_allocations[0].amount='66.60';assert.equal(A.ivaVendita('100',o).aliquota,.22);
});
test('an explicit numeric correction wins; normal Shopify VAT and old default remain supported',()=>{
 const {A,s}=env();s.processedOrdersCache['100']={customProperties:{_iva_vendita_gestionale:{aliquota:.1}}};
 assert.equal(A.ivaVendita('100',order()).aliquota,.1);
 const o=order();o.line_items[0].discount_allocations=[];o.line_items[0].tax_lines=[{rate:.04}];assert.equal(A.ivaVendita('101',o).aliquota,.04);
 delete o.line_items[0].tax_lines;assert.equal(A.ivaVendita('101',o).aliquota,.22);
 o.line_items=[line(),{...line('20'),tax_lines:[{rate:.1}]}];o.line_items.forEach(l=>l.discount_allocations=[]);
 assert.equal(A.ivaVendita('101',o).da_verificare,true);
});
test('a separately paid upgrade keeps VAT 22% even when the original PC uses 4%',()=>{
 const {A}=env(),o=order(),u={id:200,name:'#DEMO-UP',financial_status:'paid',total_price:'122',current_total_price:'122',line_items:[{id:600,name:'AGGIORNAMENTO ORDINE',price:'122',quantity:1,tax_lines:[{rate:.22}],properties:Object.entries({_upgrade_ordine_id:'100',_upgrade_linea_id:'500',_upgrade_unita:0,_upgrade_chiave:'CONNETTIVITA',_upgrade_valore:'WIFI',_upgrade_categoria:'CONNETTIVITA'}).map(([name,value])=>({name,value:String(value)}))}]};
 const v=A.prezzoVendita('100',[o,u],{});assert.equal(v.totale,942);assert.equal(v.imponibile,820/1.04+100);
});
