import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('assets/js/app.js');
const section = (from, to) => {
    const a=app.indexOf(from),b=app.indexOf(to,a);assert.ok(a>=0&&b>a,`Blocco mancante: ${from}`);return app.slice(a,b);
};
const bundle = {name:'BUNDLE REX - PC GAMING RYZEN 5 9600X + RX 9060 XT + MONITOR 180Hz 1ms + KIT GAMING',sku:'MG-BUNDLE-REX',product_id:10241024655703};
const setup = {name:'SETUP VOLT - PC GAMING RYZEN 5 5500F + INTEL ARC B580 + MONITOR 200Hz 0,5ms + SEDIA GAMING',sku:'MG-SETUP-VOLT',product_id:11192864735575};
const monitor = {name:'LG 34G630A-B - Monitor gaming 34" UltraWide QHD',sku:'MONLG-GAM0046'};
function display(type,ean,text='Caricamento...') {
    const badge={dataset:{supplier:''},style:{}}, row={dataset:{},querySelector:()=>badge};
    return {dataset:{componentType:type,ean,originalValue:ean},textContent:text,title:'',closest:()=>row,row};
}
function env({items=[bundle],displays=[],saved={},view={items},catalog={}}={}) {
    const requests=[];
    const configs={10241024655703:{components:[{type:'MONITOR',value:'MONITOR 180Hz 1ms'}]},11192864735575:{components:[{type:'MONITOR',value:'ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms'}]}};
    const s={window:{},console:{log(){},warn(){}},localStorage:{getItem(){return null;}},
        sessionStorage:{getItem(){return JSON.stringify([{id:10,line_items:items}]);}},
        identifyPCConfig(name,silent,id){return configs[id] || null;},
        processedOrdersCache:{10:saved},getCurrentProcessedOrderById(){return view;},
        document:{querySelectorAll(){return displays;}},updateSupplierSummaryButtonVisibility(){},getSupplierAbbreviation(s){return s;},
        async fetch(url,opts){requests.push({url,opts});const ean=new URL(url,'https://local.invalid').searchParams.get('ean');return {ok:true,json:async()=>catalog[ean]?{success:true,component:{nome:catalog[ean]}}:{success:false}};}};
    vm.createContext(s);
    vm.runInContext(read('assets/js/order-config-matcher.js'),s);
    vm.runInContext(read('assets/js/montaggio-export.js'),s);
    vm.runInContext(read('assets/js/accoppiamento-auto.js'),s);
    s.window.AccoppiamentoAuto.carica=async()=>{throw Error('offline');};
    vm.runInContext(section('(function () {\n    // GPU:', "console.log('✅ normalizeDisplayName v35 registrata');"),s);
    vm.runInContext(section('async function nomeLeggibileDelCodice(', '// ============================================================================\n// REGOLE CASE'),s);
    vm.runInContext(section('async function loadProductNamesForEANs(', 'function createStandardCard('),s);
    return {s,M:s.window.MontaggioExport,A:s.window.AccoppiamentoAuto,requests};
}
test('nuovo bundle: SKU del PC escluso, specifica inclusa dalla distinta',()=>{
    const {s}=env();
    assert.equal(s.getMonitorDisplayValue(bundle),'MONITOR 180Hz 1ms');
    assert.equal(s.getMonitorDisplayValue(setup),'ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms');
    assert.equal(s.getMonitorDisplayValue({...bundle,product_id:'gid://shopify/Product/10241024655703'}),'MONITOR 180Hz 1ms');
    assert.equal(s.getMonitorDisplayValue(monitor),'MONLG-GAM0046');
    assert.equal(s.getMonitorDisplayValue({name:'MSI Optix MAG monitor gaming',sku:'MSI-MON-123'}),'MSI-MON-123');
});
test('monitor incluso: titolo storico prevale su una distinta con Hz o risposta diversi',()=>{
    const {M}=env();
    assert.equal(M.monitorIncluso({...setup,name:setup.name.replace('200Hz','180Hz')},'ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms'),'MONITOR 180Hz 0,5ms');
    assert.equal(M.monitorIncluso({...setup,name:setup.name.replace('0,5ms','1ms')},'ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms'),'MONITOR 200Hz 1ms');
    assert.equal(M.monitorIncluso({name:'BUNDLE SENZA SPECIFICHE'},'MG-BUNDLE-X'),'');
});
test('scheda gia elaborata: corregge SKU bundle e nome PC salvato senza scritture o rete',async()=>{
    for(const item of [bundle,setup]){
        const d=display('MONITOR',item.sku,item.name);
        const saved={components:[{type:'MONITOR',ean:item.sku,name:item.name,price:123}]};
        const before=JSON.stringify(saved),{s,requests}=env({items:[item],displays:[d],saved});
        await s.loadProductNamesForEANs('10');
        assert.match(d.textContent,/^📦 (MONITOR 180Hz 1ms|ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms)$/);
        assert.doesNotMatch(d.textContent,/BUNDLE|SETUP|PC GAMING|RYZEN|MG-/);
        assert.equal(d.dataset.ean,item.sku);assert.equal(JSON.stringify(saved),before);assert.equal(requests.length,0);
    }
});
test('lookup: PC mai usato come nome di altri componenti; monitor standalone conserva il modello',async()=>{
    const {s,A}=env({items:[bundle,monitor]});
    assert.equal(await s.nomeLeggibileDelCodice(10,bundle.sku,'COOLER'),null);
    assert.equal(A.nomeDaCodice(null,bundle.sku,{line_items:[bundle]}),null);
    assert.equal(A.nomeDaCodice(null,bundle.sku,{line_items:[bundle]},'MONITOR').nome,'MONITOR 180Hz 1ms');
    assert.equal((await s.nomeLeggibileDelCodice(10,monitor.sku,'MONITOR')).nome,monitor.name);
});
test('CG530 nero: riconosce MPN e codice esatti, nessun nero dedotto da codici sconosciuti',()=>{
    const {M}=env();
    assert.equal(M.coloreCase([{type:'CASE',name:'DEEPCOOL CG530 4F R-CG530-BKADA4-G-1'}]),'BLACK');
    assert.equal(M.coloreCase([{type:'CASE',ean:'DPCG5304F'}]),'BLACK');
    assert.equal(M.coloreCase([{type:'CASE',ean:'DPCG530WH4F'}]),'WHITE');
    assert.equal(M.coloreCase([{type:'CASE',ean:'ALTRO-BK-123'}]),'');
});
test('colore dalla sola riga PC: OPZIONI DeepCool e monitor MSI non oscurano CASE',()=>{
    const {M}=env();
    const items=[{name:'OPZIONI REX - CASE - DEEPCOOL CG530 BLACK'}, {name:'MSI MONITOR GAMING 24,5"'}, {name:'PC GAMING REX',customProperties:{CASE:'DEEPCOOL CG530 BLACK - 4x RGB'}}];
    assert.equal(M.coloreCase([{type:'CASE',ean:'CODICE'}],{items}),'BLACK');
    assert.equal(M.coloreCase([{type:'CASE',ean:'CODICE'}],{items:[...items,{name:'PC GAMING VOLT',customProperties:{CASE:'WHITE'}}]}),'');
    assert.equal(M.coloreCase([],{items:[]},{custom_properties:{CASE:'WHITE'}}),'WHITE');
    assert.equal(M.coloreCase([],{line_items:[{name:'PC GAMING REX',properties:[{name:'CASE',value:'WHITE'}]}]}),'WHITE');
});
test('rosa e ambigui: colore esplicito del case, mai GPU/MOBO usate per dedurlo',()=>{
    const {M}=env();
    assert.equal(M.coloreCase([{type:'CASE',name:'THERMALTAKE VIEW 380 PINK'}]),'PINK');
    assert.equal(M.nomeColore('PINK'),'ROSA (PINK)');
    assert.equal(M.colore('WHITE o BLACK'),'');assert.equal(M.colore('PINK o WHITE'),'');
    assert.equal(M.coloreCase([{type:'GPU',name:'WHITE'},{type:'MOBO',name:'BLACK'}]),'');
});
test('scheda: pulisce le note del cooler, conserva MPN e regola colore GPU/MOBO',async()=>{
    const ds=[display('CASE','DPCG5304F'),display('COOLER','DPAG300'),display('GPU','GPU1'),display('MOBO','MOBO1')];
    const {s,requests}=env({items:[],displays:ds,catalog:{DPAG300:'DeepCool AG300 AIR | ABACO DPAG300 | MPN R-AG300-BKNNMN-G | Antonio 04/10 (al posto del Wraith)',GPU1:'PNY GeForce RTX 5070 12GB',MOBO1:'ASRock B650M-H'}});
    await s.loadProductNamesForEANs('10');
    assert.match(ds[0].textContent,/COLORE: NERO \(BLACK\)$/);
    assert.equal(ds[1].textContent,'DeepCool AG300 AIR | ABACO DPAG300 | MPN R-AG300-BKNNMN-G');
    assert.equal(ds[2].textContent,'RTX 5070 12GB BLACK');assert.equal(ds[3].textContent,'B650 BLACK');
    assert.ok(requests.every(r=>!r.opts?.method || r.opts.method==='GET'));
});
test('upgrade pagato arrivato durante il lookup: il nome nuovo resta protetto',async()=>{
    const d=display('MONITOR',monitor.sku),{s}=env({items:[monitor],displays:[d]});
    s.window.AccoppiamentoAuto.carica=async()=>{d.row.dataset.accPaid='1';d.textContent='MONITOR PAGATO NUOVO';return null;};
    await s.loadProductNamesForEANs('10');assert.equal(d.textContent,'MONITOR PAGATO NUOVO');
});
test('PDF ed Excel: stesso monitor incluso anche con nome PC persistito, note cooler rimosse',async()=>{
    const cooler='DeepCool AG300 AIR | ABACO DPAG300 | MPN R-AG300-BKNNMN-G | Antonio 04/10 (al posto del Wraith)';
    const comps=[{type:'MONITOR',ean:setup.sku,name:setup.name,price:99},{type:'COOLER',ean:'DPAG300',name:cooler,price:15},{type:'CASE',ean:'DPCG5304F',name:'DEEPCOOL CG530 R-CG530-BKADA4-G-1'}];
    const before=JSON.stringify(comps),{s}=env({items:[setup],saved:{components:comps}});
    const data={ordini:{10:{pc:[{unita:0,pezzi:[]}]}}},written=[];
    s.window.AccoppiamentoAuto.carica=async()=>data;
    Object.assign(s,{processedOrdersMap:new Map([['#TEST',{id:'10',name:'#TEST',items:[setup]}]]),
        CSS:{escape:x=>x},getActiveWorksheetTab:()=>1,getOperatorAssignment:()=> 'A',extractSupplierFromText:()=>'',showNotification(){},
        loadCustomItemsFromDB:async()=>[],getComponentDataFromDB:async code=>({nome:comps.find(c=>c.ean===code)?.name||code}),
        document:{querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null},
        XLSX:{utils:{book_new:()=>({}),aoa_to_sheet:rows=>{written.push(rows);return {};},encode_cell:({r,c})=>r+':'+c,book_append_sheet(){}},writeFile(){}}});
    const ex=read('assets/js/excel-export.js');
    vm.runInContext(ex.slice(0,ex.indexOf('async function exportProcessedOrdersToPDF')),s);
    const records=(await s.collectOrdersForExport()).orders[0].records;
    assert.equal(records.find(x=>x.tipo==='MONITOR').nome,'ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms');
    assert.equal(records.find(x=>x.tipo==='COOLER').nome,'DeepCool AG300 AIR | ABACO DPAG300 | MPN R-AG300-BKNNMN-G');
    assert.match(records.find(x=>x.tipo==='CASE').nome,/COLORE: NERO/);
    vm.runInContext(ex.slice(ex.indexOf('async function exportProcessedOrdersToExcel'),ex.indexOf('const componentDataLookupCache')),s);
    await s.exportProcessedOrdersToExcel();
    assert.equal(written.length,1);const text=JSON.stringify(written[0]);
    assert.match(text,/ACER NITRO KG242YX1BMIIPX 200Hz 0,5ms/);assert.doesNotMatch(text,/Antonio|al posto del Wraith|SETUP VOLT - PC GAMING/);
    assert.equal(JSON.stringify(comps),before);
});
