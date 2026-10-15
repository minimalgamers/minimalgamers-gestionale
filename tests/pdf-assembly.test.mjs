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
    assert.ok(r[3].nome.startsWith(rows[3].nome));assert.equal(JSON.stringify(rows),before);
    const paid=M.distinta([],[],[ev({valore:originale})],[{tipo:'COOLER',descrizione:originale}],'');
    assert.equal(paid[0].nome,modello);assert.equal(M.descrizioneHardware(modello),modello);
});
test('quattro software con programmi distinti, RTX condizionato, vecchio Office non convertito',()=>{
    const {M}=env();
    for(const [scelta,programmi] of Object.entries({
        'PACCHETTO UFFICIO E STUDIO':['LibreOffice','PDF24','7-Zip','Chrome','Firefox','VLC','Thunderbird','Dizionario italiano'],
        'GAMING PRONTO':['Steam','Epic Games','EA app','Ubisoft','Battle.net','GOG','Discord','Afterburner','Driver'],
        CREATOR:['DaVinci Resolve','GIMP','Krita','Inkscape','Blender','Audacity','HandBrake'],
        'SOFTWARE - PACCHETTO STREAMING PRONTO':['OBS Studio','Discord','NVIDIA Broadcast (con schede video RTX)','ShareX','Audacity','Shotcut']
    })){
        const r=M.distinta([{tipo:'SOFTWARE',nome:scelta}],[],[],[],'')[0];
        for(const p of programmi)assert.ok(r.nome.includes(p),p);
        assert.ok(r.nome.includes('installazione e configurazione'));assert.ok(!r.avviso);
        assert.equal(M.descrizioneExtra(r).nome,r.nome);
    }
    const office=M.distinta([{tipo:'SOFTWARE',nome:'MICROSOFT OFFICE'}],[],[],[],'')[0];
    assert.match(office.nome,/MICROSOFT OFFICE.*DA VERIFICARE/);assert.doesNotMatch(office.nome,/LibreOffice/);assert.equal(office.avviso,true);
});
test('menu software multiplo: pacchetti separati, alias deduplicati, parte sconosciuta mai cancellata',()=>{
    const {M}=env();
    const r=M.distinta([{tipo:'SOFTWARE',nome:'PACCHETTO UFFICIO E STUDIO, PACCHETTO GAMING PRONTO'}],
        [{tipo:'SOFTWARE',nome:'GAMING PRONTO'}],[ev({categoria:'SOFTWARE',valore:'PACCHETTO CREATOR'})],[],'');
    assert.equal(r.length,3);assert.ok(r.some(x=>x.nome.includes('LibreOffice')));assert.ok(r.some(x=>x.nome.includes('Steam')));assert.ok(r.some(x=>x.nome.includes('Blender')));
    const unknown=M.distinta([{tipo:'SOFTWARE',nome:'PACCHETTO CREATOR, PACCHETTO SCONOSCIUTO'}],[],[],[],'');
    assert.equal(unknown.length,1);assert.match(unknown[0].nome,/PACCHETTO SCONOSCIUTO.*DA VERIFICARE/);
});
test('servizi, kit e archiviazione con istruzioni; nessun kit 4-in-1 inventato per voce generica',()=>{
    const {M}=env();
    const rows=[{tipo:'SERVIZIO',nome:'CONSEGNA SCATOLE ORIGINALI DISPONIBILI'},
        {tipo:'FPS BOOSTER',nome:'FPS BOOSTER'}, {tipo:'LIVE',nome:'ESPERIENZA ASSEMBLAGGIO IN LIVE'},
        {tipo:'SSD_EXTRA',nome:'HDD 2TB AGGIUNTIVO'}, {tipo:'KIT GAMING',nome:'KIT GAMING MINIMAL GAMERS 4IN1 BIANCO | Antonio 04-10'},
        {tipo:'PERSONALIZZAZIONE',nome:'Preparare il kit aggiuntivo richiesto dal cliente'},
        {tipo:'SERVIZIO',nome:'Intervento specifico sulle impostazioni richiesto dal cliente'}];
    const r=M.distinta(rows,[],[],[],'BLACK');
    assert.equal(r[0].tipo,'SCATOLE');assert.match(r[0].nome,/effettivamente disponibili/);
    assert.match(r[1].nome,/temperature e stabilita/);assert.match(r[1].nome,/nessun aumento fisso/);
    assert.match(r[2].nome,/data e ora/);assert.match(r[3].nome,/unita secondaria interna/);
    assert.match(r[4].nome,/mouse, tastiera, cuffie e tappetino/);assert.doesNotMatch(r[4].nome,/Antonio/);
    assert.match(r[4].nome,/BIANCO/);assert.doesNotMatch(r[4].nome,/NERO/);
    assert.equal(r[5].tipo,'EXTRA');assert.equal(r[5].avviso,true);assert.match(r[5].nome,/DA VERIFICARE/);assert.doesNotMatch(r[5].nome,/mouse|tastiera/);
    assert.equal(r[6].tipo,'EXTRA');assert.doesNotMatch(r[6].nome,/SCATOLE/);
});
test('annotazioni interne pulite anche su monitor, kit e archiviazione; dettagli tecnici conservati',()=>{
    const {M}=env();
    for(const tipo of ['MONITOR','KIT GAMING','SSD_EXTRA','CONNETTIVITÀ','SEDIA','SCRIVANIA']){
        const r=M.distinta([{tipo,nome:'Modello ZX-500 nero (USB-C) | SKU ZX-500 | Mario Rossi 15.10.2026'}],[],[],[],'')[0];
        assert.doesNotMatch(r.nome,/Mario Rossi/);assert.match(r.nome,/ZX-500 nero \(USB-C\).*SKU ZX-500/);
    }
    const accessorio=M.distinta([{tipo:'ACCESSORIO',nome:'KIT GAMING MINIMAL GAMERS 4IN1 NERO | Antonio 15/10'}],[],[],[],'WHITE')[0];
    assert.doesNotMatch(accessorio.nome,/Antonio/);assert.match(accessorio.nome,/NERO.*mouse, tastiera, cuffie e tappetino/);
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
test('accessori dal solo SKU: nome esatto della riga corrispondente, sconosciuto resta da verificare',async()=>{
    const {s,comps}=collector();
    comps.push({type:'MONITOR',ean:'MONLG-GAM0046',name:'MONLG-GAM0046 (ACTION)'});
    s.processedOrdersMap.get('#4824').items.push({sku:'MONLG-GAM0046',name:'LG 34G630A-B - Monitor gaming 34 UltraWide QHD'},
        {sku:'ALTRO',name:'Monitor differente da non usare'});
    s.loadCustomItemsFromDB=async()=>[{name:'ACCESSORIO',ean:'IGNOTO123',value:'IGNOTO123'}];
    let r=(await s.collectOrdersForExport()).orders[0].records;
    assert.match(r.find(x=>x.tipo==='MONITOR').nome,/LG 34G630A-B - Monitor gaming/);
    const unknown=r.find(x=>x.nome.includes('IGNOTO123'));assert.match(unknown.nome,/DA VERIFICARE/);assert.equal(unknown.avviso,true);
    s.processedOrdersMap.get('#4824').items=s.processedOrdersMap.get('#4824').items.filter(x=>x.sku!=='MONLG-GAM0046');
    r=(await s.collectOrdersForExport()).orders[0].records;
    assert.match(r.find(x=>x.tipo==='MONITOR').nome,/MONLG-GAM0046.*DA VERIFICARE/);
    assert.doesNotMatch(r.find(x=>x.tipo==='MONITOR').nome,/differente/);
});
test('collector: un software salvato non esclude gli altri pacchetti della stessa categoria',async()=>{
    const {s,comps}=collector();
    comps.push({type:'SOFTWARE',ean:'SOFT-UFFICIO',name:'PACCHETTO UFFICIO E STUDIO'});
    const dati=await s.window.AccoppiamentoAuto.carica();
    dati.ordini['4824'].pc[0].pezzi.push({tipo:'SOFTWARE',cliente:'UFFICIO E STUDIO'},{tipo:'SOFTWARE',cliente:'PACCHETTO CREATOR'},{tipo:'SOFTWARE',cliente:'PACCHETTO GAMING PRONTO'});
    const before=JSON.stringify(comps),r=(await s.collectOrdersForExport()).orders[0].records.filter(x=>x.tipo==='SOFTWARE');
    assert.equal(r.length,3);for(const p of ['LibreOffice','Blender','Steam'])assert.ok(r.some(x=>x.nome.includes(p)));
    assert.equal(JSON.stringify(comps),before);
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
    const html=read('index.html');assert.ok(html.indexOf('montaggio-export.js?v=3')<html.indexOf('excel-export.js?v=40'));
    assert.doesNotMatch(moduleSource,/\bfetch\s*\(|localStorage\.setItem|price\s*=/);
});
