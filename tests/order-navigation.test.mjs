import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../assets/js/order-glass.js',import.meta.url),'utf8');
const context={window:{},Intl};vm.createContext(context);vm.runInContext(code,context);
const G=context.window.MGOrderGlass;
function element(classes=[],style={}){
 return {hidden:false,parentElement:null,classList:{contains:k=>classes.includes(k)},
  ownerDocument:{defaultView:{getComputedStyle:e=>({display:'grid',visibility:'visible',...e.style})}},style};
}
test('inactive pages cannot keep a desk visible even when its computed display was forced to grid',()=>{
 const pane=element(['tab-content']);
 assert.equal(G.deskVisible(pane,'orders'),false);
 assert.equal(G.deskVisible(pane,'processed'),false);
 pane.classList.contains=k=>['tab-content','active'].includes(k);
 for(const tab of ['orders','automatico','settings','inventory','suppliers','message-templates','finalized','hidden'])assert.equal(G.deskVisible(pane,tab),false,tab);
 for(const tab of ['processed','processed-e2','processed-e3','processed-e4'])assert.equal(G.deskVisible(pane,tab),true,tab);
 assert.equal(G.deskVisible(pane,'processed',true),false);
});
test('hidden ancestors and overlays hide the menu without discarding the desk contents',()=>{
 const pane=element(['tab-content','active']),parent=element();pane.parentElement=parent;
 parent.hidden=true;assert.equal(G.deskVisible(pane,'processed'),false);
 parent.hidden=false;parent.style.display='none';assert.equal(G.deskVisible(pane,'processed'),false);
 parent.style={visibility:'hidden'};assert.equal(G.deskVisible(pane,'processed'),false);
 parent.style={};assert.equal(G.deskVisible(pane,'processed'),true);
});
test('search, active detail, accents, empty results and removal of a selected order stay consistent',()=>{
 const items=[{id:'1',text:'#1 Nicolò PC GAMING REX'},{id:'2',text:'#2 Maria PC GAMING STRIKE'}],before=JSON.stringify(items);
 assert.equal(G.navigationSelection(items,'1','MARIA').active,'2');
 assert.equal(G.navigationSelection(items,'1',' nicolo ').active,'1');
 assert.equal(G.navigationSelection(items,'2','REX').active,'1');
 assert.equal(G.navigationSelection(items,'2','missing').active,'');
 assert.equal(G.navigationSelection(items,'2','missing').ids.length,0);
 assert.equal(G.navigationSelection(items,'removed','').active,'1');
 assert.equal(JSON.stringify(items),before);
});

test('reloading Shopify binds tab and operator controls once and performs a single desk render per click',()=>{
 const source=fs.readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function initializeTabs()'),source.indexOf('function initializeBulkReplaceButton()'));
 const classes=values=>{const set=new Set(values);return {contains:k=>set.has(k),add:k=>set.add(k),remove:k=>set.delete(k)};};
 const buttons=['orders','processed','processed-e3','automatico'].map((tab,i)=>({dataset:{tab},classList:classes(i?[]:['active']),listeners:[],addEventListener(t,fn){this.listeners.push(fn);}}));
 const panes=Object.fromEntries(['orders','processed','automatico'].map(k=>[k,{classList:classes(k==='orders'?['active']:[])}]));
 let renders=0,operators=0,exports=0,syncs=0;
 const document={querySelectorAll:s=>s==='.tab-button'?buttons:Object.values(panes),
  querySelector:s=>s==='.tab-button.active'?buttons.find(b=>b.classList.contains('active')):s.startsWith('[data-content=')?panes[s.match(/"([^"]+)"/)[1]]:null,
  getElementById:()=>null};
 const env={document,window:{MGOrderGlass:{sync(){syncs++;assert(panes.processed.classList.contains('active'));}}},
  isProcessedTab:t=>t.startsWith('processed'),getWorksheetFromTab:t=>t==='processed-e3'?3:1,processedOrdersMap:new Map(),
  getFilteredProcessedOrdersMap:(_,worksheet)=>worksheet,renderProcessedOrders:worksheet=>{renders++;assert.equal(worksheet,3);},
  initializeOperatorFilters:()=>operators++,initializeExportExcelButton:()=>exports++,updateSupplierSummaryButtonVisibility:()=>{}};
 vm.createContext(env);vm.runInContext('let tabEventsInitialized=false;'+fn,env);
 env.initializeTabs();env.initializeTabs();env.initializeTabs();
 assert.deepEqual(buttons.map(b=>b.listeners.length),[1,1,1,1]);
 buttons[2].listeners[0]();assert.equal(renders,1);assert.equal(syncs,1);
 assert.equal(operators,1);assert.equal(exports,1);
});
