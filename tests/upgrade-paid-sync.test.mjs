import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../assets/js/upgrade-paid-sync.js', import.meta.url), 'utf8');
const box = { window: {} }; vm.createContext(box); vm.runInContext(src, box);
const U = box.window.UpgradePaidSync;
const properties = p => Object.entries(p).map(([name,value]) => ({name,value:String(value)}));
const original = (q=1) => ({id:80,name:'#4800',line_items:[{id:222,name:'PC GAMING PROVA',quantity:q,current_quantity:q,properties:properties({_has_gpo:'old'})}]});
const upgrade = (state='paid',unit=0) => ({id:90,name:'#4900',financial_status:state,current_total_price:'69.90',line_items:[{
    id:333,name:'AGGIORNAMENTO ORDINE',price:'69.90',quantity:1,current_quantity:1,
    properties:properties({_upgrade_ordine_id:80,_upgrade_linea_id:'gid://shopify/LineItem/222',_upgrade_unita:unit,
        _upgrade_chiave:'CONNETTIVITA',_upgrade_categoria:'CONNETTIVITÀ',_upgrade_valore:'WI-FI + BLUETOOTH'})}]});
const A = {pcAutomatico:(d,k) => d.pcs?.[k] || null,upgradeInAttesa() {}};
const snapshot = {generato:'now',pcs:{80:{linea_id:'222',unita:0,upgrade_pagati:[{id_upgrade:'90',ordine_upgrade:'#4900',valore:'WI-FI + BLUETOOTH'}]}}};
test('pagato: ordine originale, riga stabile e una sola unità, senza duplicati',()=>{
    const rows=[original(),upgrade(),upgrade()], prima=JSON.stringify(rows);
    const e=U.riferimenti(rows); assert.equal(e.length,1); assert.equal(e[0].scheda,'80');
    assert.equal(e[0].linea_id,'222'); assert.equal(JSON.stringify(rows),prima);
    assert.equal(U.inAttesa(e,snapshot,A).length,0);
    assert.equal(U.inAttesa(e,{pcs:{}},A).length,1);
});
test('PC2 identico: mai PC1, riga riordinata e dati vecchi non certificano il pagamento',()=>{
    const e=U.riferimenti([original(2),upgrade('paid',1)]); assert.equal(e[0].scheda,'80.2');
    assert.equal(U.inAttesa(e,{pcs:{'80.2':{linea_id:'222',unita:0,upgrade_pagati:snapshot.pcs[80].upgrade_pagati}}},A).length,1);
    assert.equal(U.inAttesa(e,{pcs:{'80.2':{linea_id:'222',unita:1,upgrade_pagati:snapshot.pcs[80].upgrade_pagati}}},A).length,0);
    const o=original();o.line_items.unshift({id:123,name:'CASE',quantity:1,current_quantity:1});
    assert.equal(U.riferimenti([o,upgrade()])[0].linea_id,'222');
});
test('pagamento pendente, annullamenti, rimborsi e riferimento incerto non si applicano',()=>{
    for(const s of ['pending','authorized','partially_paid','refunded','voided']) assert.equal(U.riferimenti([original(),upgrade(s)]).length,0);
    const cancelled=upgrade();cancelled.cancelled_at='today';assert.equal(U.riferimenti([original(),cancelled]).length,0);
    const refund=upgrade('partially_refunded');refund.current_total_price='60.00';assert.equal(U.riferimenti([original(),refund]).length,0);
    refund.current_total_price='69.90';assert.equal(U.riferimenti([original(),refund]).length,1);
    refund.line_items[0].current_quantity=0;assert.equal(U.riferimenti([original(),refund]).length,0);
    const noUnit=upgrade();noUnit.line_items[0].properties=noUnit.line_items[0].properties.filter(p=>p.name!=='_upgrade_unita');
    assert.equal(U.riferimenti([original(2),noUnit]).length,0);
    const shipped=original();shipped.fulfillment_status='fulfilled';assert.equal(U.riferimenti([shipped,upgrade()]).length,0);
});
test('monitor: nuovo pagamento accelera, poi la stessa pagina si aggiorna senza secondo acquisto',async()=>{
    let t=0, calls=0, paints=0, d={generato:'old',pcs:{}}, pending;
    const m=U.monitor({A:{...A,upgradeInAttesa:e=>pending=e},now:()=>t,
        leggiOrdini:async()=>[original(),upgrade()],caricaDati:async()=>d,
        ridisegna:async()=>{paints++},richiediAggiornamento:async()=>{calls++}});
    await m.tick();assert.equal(calls,1);assert.equal(pending.length,1);
    await m.tick();assert.equal(calls,1);assert.equal(paints,1);
    t=300001;await m.tick();assert.equal(calls,2);
    d=snapshot;await m.tick();assert.equal(pending.length,0);assert.equal(paints,2);assert.equal(calls,2);
});
test('offline e chiamate sovrapposte: nessuna falsa conferma, si ritenta senza doppia richiesta',async()=>{
    let finish,reads=0,errors=0, paints=0;
    const m=U.monitor({A,leggiOrdini:()=>{reads++;return new Promise(r=>finish=r)},
        caricaDati:async()=>{throw new Error('offline')},ridisegna:async()=>paints++,errore:()=>errors++});
    const x=m.tick(),y=m.tick();finish([original(),upgrade()]);await Promise.all([x,y]);
    assert.equal(reads,1);assert.equal(errors,1);assert.equal(paints,0);
});
test('nessun polling senza sessione o in una scheda nascosta; nessuna scrittura ordini/database',async()=>{
    let reads=0;const m=U.monitor({attivo:()=>false,leggiOrdini:async()=>reads++});await m.tick();assert.equal(reads,0);
    assert.doesNotMatch(src,/localStorage|\.open\(|POST|PUT|PATCH|DELETE|saveProcessed|upsert/);
});

test('rimborso dopo un pagamento: segnala cambio e richiede una nuova fotografia, poi toglie la segnalazione',async()=>{
    let rows=[original(),upgrade()],d=snapshot,pending,calls=0;
    const m=U.monitor({A:{...A,upgradeInAttesa:e=>pending=e},leggiOrdini:async()=>rows,caricaDati:async()=>d,
        ridisegna:async()=>{},richiediAggiornamento:async()=>calls++});
    await m.tick();rows=[original(),upgrade('refunded')];await m.tick();
    assert.equal(calls,1);assert.equal(pending[0].ritirato,true);
    d={generato:'new',pcs:{80:{linea_id:'222',unita:0,upgrade_pagati:[]}}};await m.tick();assert.equal(pending.length,0);
});

test('il clic WhatsApp verifica anche i pagamenti e blocca un catalogo non ancora allineato',()=>{
    const app=fs.readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
    const f=app.slice(app.indexOf('async function upgradeDellOrdine'),app.indexOf('const upgradeWhatsAppInCorso'));
    assert.match(f,/await window\.UpgradePaidSync\?\.verifica\(\)/);
    assert.match(f,/upgradeDaAllineare/);assert.match(f,/upgrade_pagato_in_aggiornamento/);
    const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.equal((html.match(/src="assets\/js\/upgrade-paid-sync\.js/g)||[]).length,1);
    assert.ok(html.indexOf('upgrade-paid-sync.js')<html.indexOf('assets/js/app.js?v='));
});
