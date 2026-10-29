import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const props=p=>Object.entries(p).map(([name,value])=>({name,value:String(value)}));
const original=(q=1)=>({id:100,name:'#DEMO-PC',fulfillment_status:'fulfilled',current_total_price:String(1000*q),total_price:String(1000*q),line_items:[{id:500,name:'PC GAMING DEMO',price:'1000',quantity:q,current_quantity:q,properties:props({_has_gpo:'demo'})}]});
const upgrade=(status='paid',unit=0)=>({id:200,name:'#DEMO-UP',financial_status:status,total_price:'69.90',current_total_price:'69.90',line_items:[{id:600,name:'AGGIORNAMENTO ORDINE',price:'69.90',quantity:1,current_quantity:1,properties:props({_upgrade_ordine_id:'100',_upgrade_linea_id:'500',_upgrade_unita:unit,_upgrade_chiave:'CONNETTIVITA',_upgrade_valore:'WIFI',_upgrade_categoria:'CONNETTIVITA'})}]});
function env(){const s={window:{},console,setTimeout,clearTimeout,localStorage:{getItem:()=>null},identifyPCConfig:n=>/PC GAMING/.test(n)?{}:null};vm.createContext(s);for(const f of ['multi-order-handler','upgrade-paid-sync','accoppiamento-auto'])vm.runInContext(fs.readFileSync(new URL('../assets/js/'+f+'.js',import.meta.url),'utf8'),s);return {A:s.window.AccoppiamentoAuto,U:s.window.UpgradePaidSync};}
const stale={upgrade_pagati:[{id_upgrade:'200',ordine_upgrade:'#DEMO-UP',valore:'WIFI',prezzo:69.9}]};
test('shipping preserves the verified paid upgrade revenue while operational monitoring stays closed',()=>{
 const {A,U}=env(),data=[original(),upgrade()],before=JSON.stringify(data);
 assert.equal(U.riferimenti(data).length,0);assert.equal(U.incassi(data).length,1);
 assert.equal(A.prezzoVendita('100',data,{}).totale,1069.9);
 assert.equal(A.prezzoVendita('100',data,stale).totale,1069.9);assert.equal(JSON.stringify(data),before);
});
test('refunds, pending and cancelled upgrades supersede a stale paid entry from a previous catalog',()=>{
 const {A}=env();for(const status of ['pending','refunded','voided','authorized','partially_paid'])assert.equal(A.prezzoVendita('100',[original(),upgrade(status)],stale).totale,1000);
 const cancelled=upgrade();cancelled.cancelled_at='today';assert.equal(A.prezzoVendita('100',[original(),cancelled],stale).totale,1000);
 const partial=upgrade('partially_refunded');partial.current_total_price='60';assert.equal(A.prezzoVendita('100',[original(),partial],stale).totale,1000);
 partial.line_items[0].current_quantity=0;assert.equal(A.prezzoVendita('100',[original(),partial],stale).totale,1000);
});
test('each identical PC gets only its own upgrade, preserving line identity after reordering',()=>{
 const {A}=env(),o=original(2),u=upgrade('paid',1);o.line_items.unshift({id:501,name:'Other item',price:0,quantity:1,current_quantity:1});
 assert.equal(A.prezzoVendita('100.1',[o,u],{}).totale,1000);
 assert.equal(A.prezzoVendita('100.2',[o,u],{}).totale,1069.9);
 u.line_items[0].properties=u.line_items[0].properties.filter(p=>p.name!=='_upgrade_unita');
 assert.equal(A.prezzoVendita('100.1',[o,u],{}).totale,1000);assert.equal(A.prezzoVendita('100.2',[o,u],{}).totale,1000);
});
test('upgrade discounts and remaining quantities conserve the actual net customer receipt',()=>{
 const {A}=env(),u=upgrade('partially_refunded');u.line_items[0].quantity=2;u.line_items[0].current_quantity=1;u.line_items[0].discount_allocations=[{amount:'10.00'}];u.current_total_price='64.90';
 assert.equal(A.prezzoVendita('100',[original(),u],stale).totale,1064.9);
});
test('legacy references are accepted only for an unambiguous PC; duplicate reads never add revenue twice',()=>{
 const {A}=env(),o=original(),u=upgrade();u.line_items[0].properties=u.line_items[0].properties.filter(p=>p.name!=='_upgrade_linea_id');
 assert.equal(A.prezzoVendita('100',[o,u,u],stale).totale,1069.9);
 o.line_items.push({...o.line_items[0],id:501});o.current_total_price='2000';o.total_price='2000';
 assert.equal(A.prezzoVendita('100.1',[o,u],{}).totale,1000);
});
test('an existing explicit upgrade line and a payment reference are never counted together',()=>{
 const {A}=env(),o=original(),u=upgrade();o.line_items[0].properties.push({name:'_gpo_product_group',value:'pc'});
 o.line_items.push({id:502,name:'OPZIONI AGGIORNAMENTO',price:'69.90',quantity:1,current_quantity:1,properties:props({_gpo_parent_product_group:'pc',_upgrade_pagato:'#DEMO-UP'})});o.current_total_price='1069.90';o.total_price='1069.90';
 assert.equal(A.prezzoVendita('100',[o,u],stale).totale,1069.9);
});
