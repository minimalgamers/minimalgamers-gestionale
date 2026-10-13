import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const fresh = () => {
    const context = { window: {}, console, localStorage: { getItem() { return null; } },
        fetch() { throw Error('no network or writes'); } };
    vm.createContext(context); vm.runInContext(source, context);
    return { A: context.window.AccoppiamentoAuto, context };
};
const rows = () => [
    { tipo: 'COOLER', ean: 'DPAG300', nome: 'DeepCool AG300 AIR', fornitore: 'ABACO', costo: 15.90, fonte: 'acquistato' },
    { tipo: 'GPU', ean: 'RTX5070-AC', nome: 'RTX 5070 BLACK', fornitore: 'ACTION', costo: 500, fonte: 'acquistato' }
];
const event = (extra = {}) => ({ ordine_upgrade: '#4833', id_upgrade: '4833', linea_id: 'LINE1', unita: 0,
    categoria: 'DISSIPATORE', chiave: 'DISSIPATORE', valore: 'DISSIPATORE A LIQUIDO 360MM', prezzo: 139, ...extra });
const pc = (extra = {}) => ({ unita: 0, linea_id: 'LINE1', pc_totale: 1, quantita: 1,
    upgrade_pagati: [event()], pezzi: [{ tipo: 'COOLER', cliente: event().valore,
        auto: { codice: 'AIO360-BLK', descrizione: 'AIO a liquido 360MM BLACK', fornitore: 'ABACO', costo: 75 } }], ...extra });

test('4777: 360 da montare, acquisto AG300 e tutti gli altri pezzi immutati', () => {
    const { A } = fresh(), original = rows(), before = JSON.stringify(original);
    const plan = A.pianoMontaggioUpgrade(pc(), original, {});
    assert.equal(plan.length, 1); assert.equal(plan[0].codice, 'AIO360-BLK');
    assert.equal(plan[0].precedente.ean, 'DPAG300'); assert.equal(plan[0].precedente.costo, 15.9);
    assert.equal(plan[0].costo, 75); assert.equal(plan[0].stimato, true);
    assert.equal(JSON.stringify(original), before);
    assert.match(A.dettagliMontaggioUpgrade(plan), /NON MONTARE.*AG300/);
    assert.match(A.dettagliMontaggioUpgrade(plan), /Acquisto conservato/);
    assert.match(A.dettagliMontaggioUpgrade(plan), /ricezione da verificare/);
});
test('solo eventi pagati riconciliati: scelte non pagate, categoria non ammessa, linea errata escluse', () => {
    const { A } = fresh();
    assert.equal(A.pianoMontaggioUpgrade(pc({ upgrade_pagati: [] }), rows(), {}).length, 0);
    for (const ev of [event({ linea_id: 'ALTRO' }), event({ unita: 1 }), event({ categoria: 'CASE', chiave: 'CASE' }), event({ ordine_upgrade: '' })]) {
        assert.equal(A.pianoMontaggioUpgrade(pc({ upgrade_pagati: [ev] }), rows(), {}).length, 0);
    }
});
test('PC1/PC2 uguali: upgrade separato e vecchi riferimenti senza unità non si moltiplicano', () => {
    const { A } = fresh();
    assert.equal(A.pianoMontaggioUpgrade(pc({ pc_totale: 2, unita: 1 }), rows(), {}).length, 0);
    assert.equal(A.pianoMontaggioUpgrade(pc({ pc_totale: 2, unita: 1, upgrade_pagati: [event({ unita: 1 })] }), rows(), {}).length, 1);
    assert.equal(A.pianoMontaggioUpgrade(pc({ pc_totale: 2, upgrade_pagati: [event({ unita: null })] }), rows(), {}).length, 0);
});
test('nessun modello inventato se mapping assente o AIO 240 al posto di 360 con display', () => {
    const { A } = fresh();
    for (const p of [pc({ pezzi: [] }), pc({ pezzi: [{ tipo: 'COOLER', cliente: event().valore,
        auto: { codice: '240MM', descrizione: 'AIO 240MM', costo: 40 } }] })]) {
        const plan = A.pianoMontaggioUpgrade(p, rows(), {});
        assert.equal(plan[0].codice, event().valore); assert.equal(plan[0].modelloDaConfermare, true);
    }
    assert.equal(A.requisitoUpgradeUguale('COOLER', '360MM', '360MM CON DISPLAY LED'), false);
    assert.equal(A.requisitoUpgradeUguale('COOLER', '360 MM LCD', '360MM CON DISPLAY LED'), true);
});
test('nessuna doppia aggiunta se il 360 è già nella distinta; ultimo pagamento della categoria prevale', () => {
    const { A } = fresh();
    const mounted = rows(); mounted[0].ean = 'AIO360'; mounted[0].nome = '360MM BLACK';
    assert.equal(A.pianoMontaggioUpgrade(pc(), mounted, {}).length, 0);
    const plan = A.pianoMontaggioUpgrade(pc({ upgrade_pagati: [event({ valore: '240MM' }), event()] }), rows(), {});
    assert.equal(plan.length, 1); assert.equal(plan[0].scelta, event().valore);
});
test('ordine congelato nel riepilogo: solo nuovo AIO, mai riordinare AG300/GPU', () => {
    const { A } = fresh();
    const data = { ordini: { '4777': { pc: [pc()] } } };
    const summary = A.daOrdinare(data, [{ id: '4777', nome: '#4777', confermato: true, righe: rows(), salvati: [], voci: [] }], {});
    assert.equal(summary.righe.length, 1); assert.equal(summary.righe[0].codice, 'AIO360-BLK');
    assert.equal(summary.righe[0].daConfermare, true); assert.equal(summary.righe[0].stimato, true);
    assert.equal(summary.righe.some(r => /DPAG300|RTX5070/.test(r.codice)), false);
});
test('archiviazione secondaria mancante compare come aggiunta senza sostituire SSD principale', () => {
    const { A } = fresh();
    const data = { pezzi: [{ tipo: 'SSD_EXTRA', cliente: '2TB', fisso: { descrizione: '2TB aggiuntivi', costo: 100 } }] };
    const extra = A.extraOrdine(data, ['SSD'], [], {});
    assert.equal(extra.length, 1); assert.equal(extra[0].tipo, 'SSD_EXTRA');
    assert.equal(A.extraOrdine(data, ['SSD', 'SSD AGGIUNTIVO'], [], {}).length, 0);
});
test('post-acquisto anche senza prezzi registrati: riepilogo limitato ai soli upgrade pagati', () => {
    const { A } = fresh();
    const automatic = pc(); automatic.upgrade_pagati.push(event({ categoria: 'CONNETTIVITÀ', chiave: 'CONNETTIVITA', valore: 'WI-FI + BLUETOOTH', prezzo: 69.9 }));
    automatic.pezzi.push({ tipo: 'WIFI', cliente: 'WI-FI + BLUETOOTH', fisso: { descrizione: 'Wi-Fi PCIe', costo: 18, fornitore: 'FOCELDA' } });
    const summary = A.daOrdinare({ ordini: { '4777': { pc: [automatic] } } }, [{ id: '4777', nome: '#4777', confermato: false, righe: rows(), salvati: [], voci: [] }], {});
    assert.equal(summary.righe.length, 2);
    assert.ok(!summary.righe.some(r => /AG300|RTX5070/.test(r.codice)));
});
test('DOM idempotente e reversibile, nessun dato d’acquisto sovrascritto', () => {
    const { A, context } = fresh();
    const span = { dataset: { ean: 'DPAG300' }, textContent: 'AG300 AIR', title: 'originale' };
    const badge = { dataset: { supplier: 'ABACO' }, textContent: 'ABA', style: { cssText: 'color:blue' } };
    const row = { dataset: { componentType: 'COOLER' }, querySelector: sel => sel.includes('component-name') ? span : badge,
        addEventListener() {} };
    context.document = { querySelectorAll: () => [row] };
    const plan = A.pianoMontaggioUpgrade(pc(), rows(), {});
    A.mostraMontaggioUpgrade('4777', plan); A.mostraMontaggioUpgrade('4777', plan);
    assert.equal(span.textContent, 'AIO a liquido 360MM BLACK'); assert.equal(span.dataset.manEan, 'DPAG300');
    assert.equal(row.dataset.accPaid, '1'); assert.equal(badge.dataset.manSupplier, 'ABACO');
    A.mostraMontaggioUpgrade('4777', []);
    assert.equal(span.dataset.ean, 'DPAG300'); assert.equal(span.textContent, 'AG300 AIR');
    assert.equal(span.title, 'originale'); assert.equal(row.dataset.accPaid, undefined);
});
test('salvare un altro componente preserva il vecchio cooler e prezzo nel database', async () => {
    const span = { dataset: { ean: 'AIO360', manEan: 'DPAG300', manName: 'AG300 AIR' }, textContent: '360MM' };
    const badge = { dataset: { supplier: 'AMAZON', manSupplier: 'ABACO' } };
    const row = { dataset: { componentType: 'COOLER', accPaid: '1', accAuto: '1' }, querySelector: sel => sel.includes('component-name') ? span : badge };
    let payload;
    const context = { console, PROCESSED_ORDERS_API_URL: '/test', processedOrdersCache: { '4777': { components: [{ type: 'COOLER', ean: 'DPAG300', price: 15.9 }] } },
        document: { querySelectorAll() { return [row]; } }, showNotification() {},
        fetch: async (_, options) => { payload = JSON.parse(options.body); return { json: async () => ({ success: true }) }; } };
    const start = app.indexOf('async function saveAllCurrentComponentsToDB(');
    const end = app.indexOf('\nasync function ', start + 1);
    vm.createContext(context); vm.runInContext(app.slice(start, end), context);
    assert.equal(await context.saveAllCurrentComponentsToDB('4777', 'GPU', 'gpu', 'gpu', 'ACTION', false), true);
    assert.equal(payload.components[0].ean, 'DPAG300'); assert.equal(payload.components[0].price, 15.9);
    payload = null;
    assert.equal(await context.saveAllCurrentComponentsToDB('4777', 'COOLER', '360MM', '360MM', 'AMAZON', false), false);
    assert.equal(payload, null);
});
test('upgrade indipendente dai lookup dei nomi, anche con una risposta tardiva', () => {
    const start = app.indexOf('async function renderComponentsFromDatabase(');
    const end = app.indexOf('\nfunction highlightMismatchedColors', start);
    const render = app.slice(start, end);
    assert.ok(render.indexOf('AccoppiamentoAuto.decora') < render.indexOf('await loadProductNamesForEANs'));
    assert.match(render, /display.textContent = saved.name \|\| saved.ean/);
    const lookup = app.slice(app.indexOf('async function loadProductNamesForEANs('));
    const after = lookup.slice(lookup.indexOf('const data = response.ok ? await response.json()'));
    assert.ok(after.indexOf("dataset.accPaid === '1'") < after.indexOf('display.textContent ='));
});
test('lo storico usa una colonna leggibile, non la griglia a tre colonne dei prezzi', () => {
    const { A } = fresh();
    assert.match(A.dettagliMontaggioUpgrade(A.pianoMontaggioUpgrade(pc(), rows(), {})), /class="acc-upgrade-montaggio"/);
    assert.match(source, /\.acc-upgrade-montaggio\{display:flex;flex-direction:column/);
    assert.match(source, /\.acc-upgrade-montaggio>\*\{min-width:0;max-width:100%;white-space:normal/);
});
