import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = f => readFileSync(new URL('../'+f,import.meta.url),'utf8');
const moduleSource=read('assets/js/montaggio-export.js'), autoSource=read('assets/js/accoppiamento-auto.js');
const exportSource=read('assets/js/excel-export.js');
function env(){const s={window:{},console:{log(){},warn(){}},localStorage:{getItem(){return null;}}};vm.createContext(s);
    vm.runInContext(moduleSource,s);vm.runInContext(autoSource,s);return {s,M:s.window.MontaggioExport,A:s.window.AccoppiamentoAuto};}
const ev=(x={})=>({ordine_upgrade:'#4838',categoria:'DISSIPATORE',chiave:'COOLER',valore:'DISSIPATORE A LIQUIDO 360MM',linea_id:'LINEA',unita:0,...x});
test('categorie hardware, accessori e fallback EXTRA senza inventare modelli',()=>{
    const {M}=env();
    for(const [s,t] of Object.entries({PROCESSORE:'CPU',ALIMENTATORE:'PSU','SCHEDA VIDEO':'GPU',DISSIPATORE:'COOLER',
        'VENTOLE RGB':'VENTOLE',WIFI:'CONNETTIVITÀ',SSD_EXTRA:'ARCHIVIAZIONE AGGIUNTIVA',SOFTWARE:'SOFTWARE',
        'ESPERIENZA ASSEMBLAGGIO IN LIVE':'EXTRA','FPS BOOSTER':'EXTRA',PERSONALIZZAZIONE:'EXTRA'}))assert.equal(M.categoria(s),t);
});
test('colore case reale, scelta della singola scheda, codici noti, ignoto/ambiguo mai indovinato',()=>{
    const {M}=env();
    assert.equal(M.coloreCase([{type:'CASE',name:'CASE ATX WHITE'}],null,{customProperties:{CASE:'BLACK'}}),'WHITE');
    assert.equal(M.coloreCase([{type:'CASE',ean:'MPG VELOX 300R AFPZW'}],{items:[{name:'MSI LEVIATHAN',customProperties:{CASE:'VELOX 300R WHITE'}}]}),'WHITE');
    assert.equal(M.coloreCase([{type:'CASE',ean:'GELI-975'}]),'BLACK');
    assert.equal(M.coloreCase([{type:'GPU',name:'RTX WHITE'}]),'');
    assert.equal(M.colore('bianco o nero'),'');
    assert.match(M.descrizioneCase('CODICE-SCONOSCIUTO',''),/COLORE: DA VERIFICARE/);
    assert.equal(M.descrizioneCase(M.descrizioneCase('CASE BLACK','BLACK'),'BLACK'),'CASE BLACK - COLORE: NERO (BLACK)');
});
test('BUILD FULL VENTOLE significa 5 RGB dello stesso colore del case, non una generica opzione',()=>{
    const {M}=env();
    for(const c of ['WHITE','BLACK','']){
        const r=M.distinta([],[{tipo:'VENTOLE',nome:'BUILD FULL VENTOLE'}],[],[],c);
        assert.equal(r.length,1);assert.equal(r[0].tipo,'VENTOLE');assert.match(r[0].nome,/5X VENTOLE RGB/);
        assert.ok(r[0].nome.includes(M.nomeColore(c)));assert.match(r[0].nome,/stesso colore del case/);
    }
    assert.equal(M.descrizioneVentole('VENTOLA SINGOLA','WHITE'),'VENTOLA SINGOLA');
});
test('tutti i pagati della singola unità: anche categoria sconosciuta, live e FPS; niente eventi altrui',()=>{
    const {A}=env();
    const p={unita:1,pc_totale:2,linea_id:'LINEA',upgrade_pagati:[ev({unita:1}),ev(),ev({unita:1,linea_id:'ALTRA'}),
        ev({unita:null}),ev({unita:1,ordine_upgrade:''}),ev({unita:1,categoria:'NUOVO SERVIZIO',valore:'SERVIZIO SPECIALE'})]};
    const out=A.upgradePagatiDellUnita(p);assert.equal(out.length,2);assert.equal(out[1].valore,'SERVIZIO SPECIALE');
});
test('360 sostituisce soltanto COOLER, vecchia distinta/prezzi intatti e tutti gli extra restano',()=>{
    const {M,A}=env();
    const rows=[{tipo:'CPU',nome:'CPU acquistata'}, {tipo:'COOLER',nome:'AG300',ean:'DPAG300',price:15.9}];
    const p={unita:0,linea_id:'LINEA',upgrade_pagati:[ev(),ev({categoria:'SOFTWARE',valore:'UFFICIO E STUDIO'}),
        ev({categoria:'SOFTWARE',valore:'GAMING PRONTO'}),ev({categoria:'FPS BOOSTER',chiave:'FPS BOOSTER',valore:'FPS BOOSTER'}),
        ev({categoria:'LIVE',chiave:'LIVE',valore:'ESPERIENZA ASSEMBLAGGIO IN LIVE'})],pezzi:[]};
    const before=JSON.stringify({rows,p});
    const r=M.distinta(rows,[{tipo:'VENTOLE',nome:'BUILD FULL VENTOLE'}],A.upgradePagatiDellUnita(p),A.pianoMontaggioUpgrade(p,rows,{}),'WHITE');
    assert.equal(r.find(x=>x.tipo==='CPU').nome,'CPU acquistata');
    assert.equal(r.filter(x=>x.tipo==='COOLER').length,1);assert.match(r.find(x=>x.tipo==='COOLER').nome,/360MM/);
    assert.equal(r.filter(x=>x.tipo==='SOFTWARE').length,2);assert.equal(r.filter(x=>x.tipo==='EXTRA').length,2);
    assert.equal(JSON.stringify({rows,p}),before);
});
test('ventole e servizi non si duplicano fra DOM, motore e upgrade; scelte software diverse non si perdono',()=>{
    const {M}=env();const r=M.distinta([{tipo:'VENTOLE',nome:'BUILD FULL VENTOLE'}],
        [{tipo:'VENTOLE',nome:'BUILD FULL VENTOLE'}],[ev({categoria:'VENTOLE RGB',valore:'BUILD FULL VENTOLE'})],[],'BLACK');
    assert.equal(r.length,1);assert.match(r[0].nome,/NERO/);
});
test('PDF senza firme/data e storico sostituzione: modello/codici e fonte salvata intatti',()=>{
    const {M}=env();
    const modello='DeepCool AG300 AIR | ABACO DPAG300 | MPN R-AG300-BKNNMN-G';
    const originale=modello+' | Antonio 04/10 (al posto del Wraith)';
    const rows=[{tipo:'COOLER',nome:originale},{tipo:'GPU',nome:'GPU BLACK | Mario Rossi 05/10/2026'},
        {tipo:'CPU',nome:'AMD Ryzen 5 (Socket AM5) | MPN 04/10'},
        {tipo:'SOFTWARE',nome:'Appuntamento 04/10'}];
    const before=JSON.stringify(rows),r=M.distinta(rows,[],[],[],'');
    assert.equal(r[0].nome,modello);assert.equal(r[0].scelta,originale);
    assert.equal(r[1].nome,'GPU BLACK');assert.equal(r[2].nome,rows[2].nome);
    assert.equal(r[3].nome,rows[3].nome);assert.equal(JSON.stringify(rows),before);
    const paid=M.distinta([],[],[ev({valore:originale})],[{tipo:'COOLER',descrizione:originale}],'');
    assert.equal(paid[0].nome,modello);assert.equal(M.descrizioneHardware(modello),modello);
});
function collector(options={}){
    const {s,M,A}=env();
    const order={id:'4824',name:'#4824',items:[{name:'PC GAMING SPARTAN',customProperties:{CASE:'CASE ATX WHITE'}}]};
    const comps=[{type:'CPU',ean:'CPU-COD',name:'Intel Core Ultra 5',price:120},
        {type:'COOLER',ean:'AG300',name:'AG300',price:15.9}, {type:'CASE',ean:'CASE-COD',name:'CASE ATX WHITE',price:35}];
    const auto={unita:0,linea_id:'LINEA',upgrade_pagati:[ev(),ev({categoria:'LIVE',chiave:'LIVE',valore:'ESPERIENZA IN LIVE'})],
        pezzi:[{tipo:'VENTOLE',cliente:'BUILD FULL VENTOLE'}, {tipo:'NUOVO SERVIZIO',cliente:'Servizio già scelto'}]};
    const before=JSON.stringify(comps), calls=[];
    A.carica=async()=>{if(options.offline)throw Error('offline');return {ordini:{4824:{pc:[auto]}}};};
    A.upgradeDaAllineare=()=>!!options.pending;
    Object.assign(s,{processedOrdersMap:new Map([['#4824',order]]),processedOrdersCache:{4824:{components:comps,configName:'PC GAMING SPARTAN',foglioDiLavoro:3}},
        CSS:{escape:x=>x},getActiveWorksheetTab:()=>3,getOperatorAssignment:()=> 'A',extractSupplierFromText:()=>'',
        showNotification:()=>{},loadCustomItemsFromDB:async()=>[{name:'PERSONALIZZAZIONE',value:'Scritta scelta'}],
        getComponentDataFromDB:async code=>{calls.push(code);return {nome:comps.find(c=>c.ean===code)?.name||code};},
        document:{querySelector:()=>null,querySelectorAll:()=>[]}});
    vm.runInContext(exportSource.slice(0,exportSource.indexOf('async function exportProcessedOrdersToPDF')),s);
    return {s,comps,before,calls};
}
test('collector reale: ventole fuori DOM, pagato sconosciuto e voci custom inclusi; distinta salvata invariata',async()=>{
    const {s,comps,before,calls}=collector();const result=await s.collectOrdersForExport();
    assert.equal(result.worksheetNumber,3);assert.equal(result.orders.length,1);
    const records=result.orders[0].records;
    assert.match(records.find(x=>x.tipo==='VENTOLE').nome,/5X VENTOLE RGB - BIANCO/);
    assert.match(records.find(x=>x.tipo==='CASE').nome,/COLORE: BIANCO/);
    assert.equal(records.filter(x=>x.tipo==='EXTRA').length,3);
    assert.equal(records.find(x=>x.tipo==='COOLER').nome,'DISSIPATORE A LIQUIDO 360MM');
    assert.equal(JSON.stringify(comps),before);assert.ok(calls.length>0);
});
test('collector rispetta scrivania e filtro operatore, non lancia stampe incomplete durante sync o offline senza dati',async()=>{
    const {s}=collector();s.getActiveWorksheetTab=()=>4;assert.equal((await s.collectOrdersForExport()).orders.length,0);
    const operator=collector();operator.s.document.querySelector=()=>({dataset:{operator:'B'}});
    assert.equal((await operator.s.collectOrdersForExport()).orders.length,0);
    await assert.rejects(collector({pending:true}).s.collectOrdersForExport(),/in aggiornamento/);
    await assert.rejects(collector({offline:true}).s.collectOrdersForExport(),/distinta incompleta/);
});
test('PDF ha tre colonne, categorie esplicite e dimensionamento del testo; file helper locale prima degli utilizzatori',()=>{
    assert.match(exportSource,/content: 'CATEGORIA'/);assert.match(exportSource,/content: 'COMPONENTE \/ EXTRA'/);
    assert.match(exportSource,/doc\.splitTextToSize\(r\.nome/);
    assert.match(exportSource,/splitTextToSize\(r\.nome, colConfigW - 2\)\.join\('\\n'\)/);
    const html=read('index.html');assert.ok(html.indexOf('montaggio-export.js?v=2')<html.indexOf('excel-export.js?v=39'));
    assert.doesNotMatch(moduleSource,/\bfetch\s*\(|localStorage\.setItem|price\s*=/);
});
