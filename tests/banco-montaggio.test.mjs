import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { creaSupabaseFinto, datiDiProva } from './fixtures/banco-supabase-finto.mjs';

// Banco: arrivi e montaggio. Il banco legge le schede del gestionale e registra solo
// arrivo, montaggio e seriali. Dati inventati: nessun prezzo o fornitore reale.
const sorgente = readFileSync(new URL('../assets/js/banco-montaggio.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../sql/banco_montaggio.sql', import.meta.url), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(sorgente, sandbox);
const B = sandbox.window.BancoMontaggio;

const orologio = () => { let t = Date.UTC(2026, 10, 19, 9, 0, 0); return () => new Date(t += 1000); };
async function banco(db = datiDiProva()) {
    const sb = creaSupabaseFinto(db), dati = B.creaDati(sb, orologio());
    const leggi = async () => {
        const d = await dati.leggi(db.processed_orders.map(o => o.shopify_order_id));
        return { d, unita: d.ordini.filter(o => o.stato === 'elaborati').map(o => B.costruisciUnita(o, d.componenti[o.id] || [], {
            banco: d.banco.filter(b => b.ordine_id === o.shopify_order_id), pc: d.pc.find(p => p.ordine_id === o.shopify_order_id) || null,
            inventario: d.inventario, piano: [] })) };
    };
    return { db, sb, dati, leggi };
}
// le liste nascono nella sandbox vm: si confrontano per contenuto
const uguali = (a, b) => assert.deepEqual(Array.from(a), b);
const riga = (unita, id, tipo) => { const u = unita.find(x => x.id === id); return { u, r: u.righe.find(x => x.c.type === tipo) }; };

test('i codici si confrontano come nel gestionale: maiuscole, simboli e zeri iniziali non contano', () => {
    assert.equal(B.norm(' gpu-5070 demo '), 'GPU5070DEMO');
    assert.equal(B.norm('0730143314572'), B.norm('730143314572'));
    assert.equal(JSON.stringify(B.unita('6002.2')), JSON.stringify({ base: '6002', n: 2 }));
    assert.equal(B.unita('6001').n, 1);
    assert.equal(B.identita({ type: 'gpu', ean: 'A-1', supplier: ' alfa ' }), B.identitaBanco({ tipo: 'GPU', codice: 'a1', fornitore: 'ALFA' }));
});

test('lo stato d\'acquisto viene letto dal gestionale, mai dedotto', () => {
    const c = { id: 11, type: 'GPU', ean: 'X1', supplier: 'ALFA', quantity: 1, price: null };
    const libro = stato => ({ _acquisti_parziali_gestionale: { 11: { type: 'GPU', ean: 'X1', supplier: 'ALFA', quantity: 1, stato } } });
    assert.equal(B.statoAcquisto(c, {}), 'da_acquistare');
    assert.equal(B.statoAcquisto(c, libro('ordinato')), 'ordinato');
    assert.equal(B.statoAcquisto(c, JSON.stringify(libro('pagato'))), 'pagato');
    assert.equal(B.statoAcquisto(c, libro('annullato')), 'da_acquistare');
    // la registrazione vale solo per lo stesso pezzo: dopo una sostituzione non conta piu'
    assert.equal(B.statoAcquisto({ ...c, ean: 'X2' }, libro('pagato')), 'da_acquistare');
    assert.equal(B.statoAcquisto({ ...c, quantity: 2 }, libro('pagato')), 'da_acquistare');
    assert.equal(B.statoAcquisto({ ...c, price: 0 }, {}), 'acquistato');          // zero esplicito e' un prezzo registrato
    assert.equal(B.statoAcquisto(c, { _acquisto_confermato_gestionale: { righe: [1] } }), 'acquistato');
});

test('«fuori dagli acquisti» vale solo per la stessa riga, come nella pagina Acquisti (#155)', () => {
    const c = { id: 11, type: 'GPU', ean: 'X1', supplier: 'ALFA', quantity: 1, price: null };
    const esclusa = (extra = {}) => ({ _esclusioni_acquisto_gestionale: { k: { excluded: true, tipo: 'GPU', ean: 'X1', fornitore: 'alfa', quantita: 1, componentId: 11, ...extra } } });
    assert.equal(B.statoAcquisto(c, esclusa()), 'escluso');
    assert.equal(B.statoAcquisto(c, esclusa({ excluded: undefined, escluso: true })), 'escluso');       // forma precedente del campo
    assert.equal(B.statoAcquisto(c, esclusa({ excluded: false })), 'da_acquistare');                   // rimessa da ordinare
    assert.equal(B.statoAcquisto(c, esclusa({ componentId: 99 })), 'da_acquistare');                   // riga reinserita
    assert.equal(B.statoAcquisto(c, esclusa({ quantita: 2 })), 'da_acquistare');                       // quantita' cambiata
    assert.equal(B.statoAcquisto({ ...c, ean: 'X2' }, esclusa()), 'da_acquistare');                    // pezzo sostituito
    assert.equal(B.statoAcquisto(c, esclusa({ personalizzato: true })), 'da_acquistare');
    // un acquisto registrato prevale su una vecchia esclusione
    const cp = esclusa(); cp._acquisti_parziali_gestionale = { 11: { type: 'GPU', ean: 'X1', supplier: 'ALFA', quantity: 1, stato: 'pagato' } };
    assert.equal(B.statoAcquisto(c, cp), 'pagato');
    // un pezzo fuori dagli acquisti deve comunque esserci fisicamente: resta atteso, ma dopo quelli comprati
    const u = (id, acquisti) => B.costruisciUnita({ shopify_order_id: id, custom_properties: acquisti }, [{ ...c }], { piano: [] });
    const coda = B.candidatiArrivo('X1', [u('7001', esclusa()), u('7002', cp)], []);
    assert.equal(coda.length, 2);
    assert.equal(coda[0].u.id, '7002');
    assert.equal(coda[1].r.acquisto, 'escluso');
});

test('software e servizi non si aspettano in una scatola', () => {
    assert.equal(B.rigaFisica({ type: 'GPU', name: 'x' }), true);
    assert.equal(B.rigaFisica({ type: 'SOFTWARE', name: 'x' }), false);
    assert.equal(B.rigaFisica({ type: 'SERVIZIO', name: 'Consegna scatole originali' }), false);
    assert.equal(B.rigaFisica({ type: 'EXTRA', name: 'x' }, () => 'SCATOLE'), false);
    assert.equal(B.rigaFisica({ type: 'EXTRA', name: 'x' }, () => { throw new Error('rotto'); }), true);
});

test('un prelievo di magazzino vale solo per quel PC e per quel pezzo, e non porta costi', async () => {
    const { leggi } = await banco(), { unita } = await leggi();
    const psu = riga(unita, '6001', 'PSU').r;
    assert.equal(psu.acquisto, 'magazzino');
    assert.equal(psu.pronto, true);
    assert.equal(psu.prelievo.descrizione, 'Alimentatore demo 600W');
    assert.equal('unitario' in psu.prelievo || 'costo' in psu.prelievo, false);
    // il prelievo del dissipatore e' del PC 2: non rende pronto il dissipatore del PC 1
    assert.equal(riga(unita, '6002', 'COOLER').r.prelievo, null);
    const pc2 = unita.find(u => u.id === '6002.2');
    assert.equal(pc2.prelieviLiberi.length, 1);
    assert.equal(pc2.nome, '#4702 · PC 2');
    // prelievo di un pezzo diverso da quello di oggi: non copre la riga
    const p = B.prelieviDellUnita([{ ean: 'MAG-USO-6001-1-PROD-PSU-ALTROPSU-ff', name: 'x', quantity: 1 }], '6001');
    assert.equal(B.assegnaPrelievi([{ id: 13, type: 'PSU', ean: 'PF600-DEMO' }], p).liberi.length, 1);
});

test('solo le schede elaborate entrano al banco, ciascun PC con il suo stato', async () => {
    const { leggi } = await banco(), { unita } = await leggi();
    uguali(unita.map(u => u.id), ['6001', '6002', '6002.2']);
    const u = unita[0];
    assert.equal(u.stato.codice, 'acquisti');
    assert.equal(u.stato.totale, 5);
    assert.equal(u.stato.pronti, 2);                                   // alimentatore dal magazzino + software
    uguali(u.stato.mancanti.map(r => r.c.type), ['GPU', 'CPU', 'VENTOLE']);
    uguali(u.righe.map(r => r.acquisto), ['pagato', 'ordinato', 'magazzino', 'da_acquistare', 'da_acquistare']);
    assert.equal(riga(unita, '6002', 'GPU').r.acquisto, 'acquistato');
});

test('il banco parte da cio\' che e\' stato comprato: si conferma l\'arrivo, anche di piu\' pezzi insieme', async () => {
    const { leggi, dati, db } = await banco();
    let u = (await leggi()).unita;
    const pc = id => u.find(x => x.id === id);
    // un pezzo non ancora ordinato ferma il PC per gli acquisti; i pezzi comprati aspettano solo la conferma
    assert.match(pc('6001').stato.etichetta, /^DA ORDINARE · 1 pezzo$/);
    uguali(pc('6001').stato.daOrdinare.map(r => r.c.type), ['VENTOLE']);
    uguali(pc('6001').stato.daConfermare.map(r => r.c.type), ['GPU', 'CPU']);
    const tuttoComprato = B.costruisciUnita({ shopify_order_id: '7001' }, [{ id: 1, type: 'GPU', ean: 'A', supplier: 'ALFA', quantity: 1, price: 10 }], { piano: [] });
    assert.equal(tuttoComprato.stato.codice, 'confermare');
    assert.match(tuttoComprato.stato.etichetta, /^ARRIVI DA CONFERMARE · 1 pezzo$/);
    // conferma senza lettore dei pezzi comprati di un PC
    const voci = pc('6001').stato.daConfermare.map(r => ({ u: pc('6001'), r }));
    const esito = await dati.segnaArrivi(voci, 'Prova');
    assert.equal(esito.fatti.length, 2);
    assert.equal(esito.falliti.length, 0);
    assert.equal(db.banco_pezzi.filter(b => b.ordine_id === '6001' && b.arrivati === 1 && b.arrivato_da === 'Prova' && !b.codice_letto).length, 2);
    u = (await leggi()).unita;
    assert.equal(pc('6001').stato.daConfermare.length, 0);
    assert.equal(pc('6001').stato.pronti, 4);
    // la stessa conferma ripetuta da una schermata non aggiornata: ogni riga fallisce da sola, niente doppioni
    const ripetuta = await dati.segnaArrivi(voci, 'Altro');
    assert.equal(ripetuta.fatti.length, 0);
    assert.equal(ripetuta.falliti.length, 2);
    assert.match(ripetuta.falliti[0].errore, /altro operatore/);
    assert.equal(db.banco_pezzi.filter(b => b.ordine_id === '6001').length, 2);
});

test('valori d\'acquisto: solo importi registrati in Acquisti, divisi per come si paga', () => {
    const comp = (id, type, supplier, extra = {}) => ({ id, type, ean: 'C' + id, supplier, quantity: 1, price: null, ...extra });
    // stessa regola «come si paga» del gestionale
    assert.equal(B.regimeAcquisto(comp(1, 'GPU', 'action')), 'intermediario');
    assert.equal(B.regimeAcquisto(comp(1, 'CPU', 'TIER ONE')), 'art17');
    assert.equal(B.regimeAcquisto(comp(1, 'COOLER', 'ABACO')), 'iva');
    assert.equal(B.regimeAcquisto(comp(1, 'CPU', 'ABACO')), 'iva');
    assert.equal(B.regimeAcquisto(comp(1, 'CASE', 'ALTRO')), 'altro');
    assert.equal(JSON.stringify(B.importi(100, 'intermediario')), JSON.stringify({ netto: 100, iva: 22, totale: 122 }));
    assert.equal(JSON.stringify(B.importi(100, 'iva')), JSON.stringify({ netto: 100, iva: 22, totale: 122 }));
    assert.equal(JSON.stringify(B.importi(100, 'art17')), JSON.stringify({ netto: 100, iva: 0, totale: 100 }));
    assert.equal(B.importi(100, 'altro').totale, null);
    // da dove viene l'importo, e quando resta mancante
    const libro = voce => ({ _acquisti_parziali_gestionale: { 1: { type: 'GPU', ean: 'C1', supplier: 'ACTION', quantity: 1, ...voce } } });
    const gpu = comp(1, 'GPU', 'ACTION');
    assert.equal(B.costoNetto(gpu, {}), null);
    assert.equal(B.costoNetto({ ...gpu, price: '' }, {}), null);                                  // vuoto = mancante
    assert.equal(B.costoNetto({ ...gpu, price: 0 }, {}).netto, 0);                                // zero esplicito = valido
    assert.equal(JSON.stringify(B.costoNetto(gpu, libro({ stato: 'pagato', costo: 188.5 }))), JSON.stringify({ netto: 188.5, fonte: 'pagato' }));
    assert.equal(B.costoNetto(gpu, libro({ stato: 'ordinato', costo: null, costo_previsto: 50 })).fonte, 'concordato');
    assert.equal(B.costoNetto(gpu, libro({ stato: 'ordinato', costo: null })), null);
    assert.equal(B.costoNetto({ ...gpu, ean: 'ALTRO' }, libro({ stato: 'pagato', costo: 188.5 })), null);   // importo di un altro pezzo: non vale
    assert.equal(B.costoNetto(gpu, { ...libro({ stato: 'pagato', costo: 188.5 }),
        _acquisto_confermato_gestionale: { righe: [{ componentId: 1, tipo: 'GPU', ean: 'C1', costo: 190 }] } }).netto, 190);
    // un PC con tutti i casi
    const u = B.costruisciUnita({ shopify_order_id: '7100', custom_properties: { _acquisti_parziali_gestionale: {
        1: { type: 'GPU', ean: 'C1', supplier: 'ACTION', quantity: 1, stato: 'pagato', costo: 500 },
        2: { type: 'CPU', ean: 'C2', supplier: 'TIER ONE', quantity: 1, stato: 'pagato', costo: 200 },
        3: { type: 'PSU', ean: 'C3', supplier: 'ABACO', quantity: 1, stato: 'ordinato', costo: null, costo_previsto: 30 },
        5: { type: 'RAM', ean: 'C5', supplier: 'ACTION', quantity: 1, stato: 'ordinato', costo: null } } } },
        [comp(1, 'GPU', 'ACTION'), comp(2, 'CPU', 'TIER ONE'), comp(3, 'PSU', 'ABACO'), comp(4, 'VENTOLE', 'ALTRO', { quantity: 3, price: 30 }), comp(5, 'RAM', 'ACTION')], { piano: [] });
    const v = B.sommaValori(u.righe.map(r => ({ r, pezzi: r.quantita })));
    assert.equal(JSON.stringify(v.regimi.intermediario), JSON.stringify({ pezzi: 1, netto: 500, iva: 110, totale: 610 }));
    assert.equal(JSON.stringify(v.regimi.art17), JSON.stringify({ pezzi: 1, netto: 200, iva: 0, totale: 200 }));
    assert.equal(JSON.stringify(v.regimi.iva), JSON.stringify({ pezzi: 1, netto: 30, iva: 6.6, totale: 36.6 }));
    assert.equal(JSON.stringify(v.regimi.altro), JSON.stringify({ pezzi: 3, netto: 30, iva: null, totale: null }));
    assert.equal(v.pezzi, 7);
    assert.equal(v.senzaImporto, 1);                                    // la RAM ordinata senza importo non diventa zero
    assert.equal(v.ivaDaDefinire, 3);
    assert.equal(v.netto, 760);
    assert.equal(v.iva, 116.6);
    assert.equal(v.totale, 846.6);
    // una ventola arrivata su tre vale un terzo della riga
    assert.equal(B.sommaValori([{ r: u.righe[3], pezzi: 1 }]).netto, 10);
    assert.equal(B.sommaValori([{ r: u.righe[3], pezzi: 0 }]).pezzi, 0);
});

test('un arrivo va al primo PC in coda, prima a chi ha l\'acquisto registrato', async () => {
    const { leggi, dati, db } = await banco();
    let { unita, d } = await leggi();
    let c = B.candidatiArrivo('gpu 5070 demo', unita, d.codici);
    uguali(c.map(x => x.u.id), ['6001', '6002', '6002.2']);   // 6002.2 non ha l'acquisto registrato: ultimo
    uguali(B.candidatiArrivo('GPU-5070-DEMO', unita, d.codici, '#4702').map(x => x.u.id), ['6002', '6002.2', '6001']);
    assert.equal(B.candidatiArrivo('CODICE-IGNOTO', unita, d.codici).length, 0);
    assert.equal(B.candidatiArrivo('', unita, d.codici).length, 0);
    assert.equal(B.candidatiArrivo('PF600-DEMO', unita, d.codici).length, 0);   // gia' coperto dal magazzino
    // lettore senza lo zero iniziale dell'EAN
    assert.equal(B.candidatiArrivo('730143314572', unita, d.codici)[0].r.c.type, 'CPU');
    await dati.segnaArrivo(c[0].u, c[0].r, 1, 'GPU-5070-DEMO', 'Prova');
    ({ unita, d } = await leggi());
    uguali(B.candidatiArrivo('GPU-5070-DEMO', unita, d.codici).map(x => x.u.id), ['6002', '6002.2']);
    assert.equal(db.banco_pezzi[0].arrivato_da, 'Prova');
    assert.equal(db.banco_pezzi[0].codice_letto, 'GPU-5070-DEMO');
});

test('il codice sulla scatola si impara solo con una conferma, e vale da li\' in poi', async () => {
    const { leggi, dati, db } = await banco();
    let { unita, d } = await leggi();
    assert.equal(B.candidatiArrivo('8800001112223', unita, d.codici).length, 0);
    await dati.associa('8800001112223', riga(unita, '6001', 'VENTOLE').r.c, 'Prova');
    await dati.associa('8800001112223', riga(unita, '6001', 'VENTOLE').r.c, 'Prova');       // ripetuta: nessun doppione
    assert.equal(db.banco_codici.length, 1);
    ({ unita, d } = await leggi());
    const c = B.candidatiArrivo('8800001112223', unita, d.codici);
    assert.equal(c.length, 1);
    assert.equal(c[0].r.c.type, 'VENTOLE');
    await assert.rejects(dati.associa('---', c[0].r.c), /non valido/);
});

test('le quantita\' multiple arrivano un pezzo alla volta e non superano il richiesto', async () => {
    const { leggi, dati } = await banco();
    for (let i = 0; i < 4; i++) {
        const { unita } = await leggi(), x = riga(unita, '6001', 'VENTOLE');
        if (x.r.arrivati < 3) await dati.segnaArrivo(x.u, x.r, 1, null, null);
    }
    const { unita } = await leggi(), v = riga(unita, '6001', 'VENTOLE').r;
    assert.equal(v.arrivati, 3);
    assert.equal(v.pronto, true);
});

test('due operatori sulla stessa riga: il secondo viene fermato, non sovrascrive', async () => {
    const { leggi, dati } = await banco();
    const prima = riga((await leggi()).unita, '6001', 'VENTOLE');
    await dati.segnaArrivo(prima.u, prima.r, 1, null, 'A');
    await assert.rejects(dati.segnaArrivo(prima.u, prima.r, 1, null, 'B'), /altro operatore/);     // riga non ancora vista da B
    const vista = riga((await leggi()).unita, '6001', 'VENTOLE');
    await dati.segnaArrivo(vista.u, vista.r, 1, null, 'A');
    await assert.rejects(dati.segnaArrivo(vista.u, vista.r, 1, null, 'B'), /altro operatore/);     // copia vecchia di B
    assert.equal(riga((await leggi()).unita, '6001', 'VENTOLE').r.arrivati, 2);
});

test('montaggio: seriale, arrivo implicito, smontaggio e chiusura del PC', async () => {
    const { leggi, dati, db } = await banco();
    let x = riga((await leggi()).unita, '6002', 'GPU');
    assert.equal(B.candidatiMontaggio('GPU-5070-DEMO', x.u, []).length, 1);
    await dati.segnaMontato(x.u, x.r, ' SN-123 ', 'Prova', 'GPU-5070-DEMO');
    let u = (await leggi()).unita.find(y => y.id === '6002');
    assert.equal(u.stato.codice, 'montaggio');
    const g = u.righe.find(r => r.c.type === 'GPU');
    assert.equal(g.montato, true);
    assert.equal(g.b.seriale, 'SN-123');
    assert.equal(g.arrivati, 1);
    assert.equal(g.b.note, 'Arrivo registrato al montaggio');
    await assert.rejects(dati.segnaMontato(u, g, '', null, null), /già montato/);
    assert.equal(B.candidatiMontaggio('GPU-5070-DEMO', u, []).length, 0);
    await dati.smonta(u, g);
    x = riga((await leggi()).unita, '6002', 'GPU');
    assert.equal(x.r.montato, false);
    assert.equal(x.r.arrivati, 1);                                      // smontare non cancella l'arrivo
    await assert.rejects(dati.annullaArrivo(x.u, { ...x.r, montato: true }), /smontalo/);
    for (const tipo of ['GPU', 'COOLER']) { x = riga((await leggi()).unita, '6002', tipo); await dati.segnaMontato(x.u, x.r, '', null, null); }
    u = (await leggi()).unita.find(y => y.id === '6002');
    assert.equal(u.stato.codice, 'montato');
    await dati.salvaPc('6002', { stato: 'assemblato', seriale_pc: 'MG-0001' });
    assert.equal((await leggi()).unita.find(y => y.id === '6002').stato.codice, 'assemblato');
    await dati.salvaPc('6002', { stato: 'collaudato' });
    assert.equal(db.banco_pc.length, 1);
    assert.equal(db.banco_pc[0].seriale_pc, 'MG-0001');
    assert.equal((await leggi()).unita.find(y => y.id === '6002').stato.codice, 'collaudato');
    await dati.riapriPc('6002');
    assert.equal((await leggi()).unita.find(y => y.id === '6002').stato.codice, 'montato');
});

test('sostituzione confermata nel gestionale dopo l\'arrivo: il banco segnala il pezzo vecchio e aspetta il nuovo', async () => {
    const { leggi, dati, db } = await banco();
    let x = riga((await leggi()).unita, '6001', 'GPU');
    await dati.segnaArrivo(x.u, x.r, 1, 'GPU-5070-DEMO', 'Prova');
    // il gestionale cambia il pezzo sulla stessa riga (come dbReplacePurchaseComponent)
    Object.assign(db.processed_order_components.find(c => c.id === 11), { ean: 'GPU-ALTRA-DEMO', product_name: 'Scheda video demo sostitutiva', supplier: 'GAMMA' });
    let u = (await leggi()).unita.find(y => y.id === '6001');
    const g = u.righe.find(r => r.c.type === 'GPU');
    assert.equal(g.cambiato, true);
    assert.equal(g.arrivati, 0);
    assert.equal(g.pronto, false);
    assert.equal(g.acquisto, 'da_acquistare');                          // il «pagato» era del pezzo precedente
    assert.equal(u.stato.daRivedere, true);
    assert.equal(u.daRivedere[0].codice, 'GPU-5070-DEMO');
    await assert.rejects(dati.segnaArrivo(u, g, 1, 'GPU-ALTRA-DEMO', null), /togli dal banco/);
    await assert.rejects(dati.segnaMontato(u, g, '', null, null), /togli dal banco/);
    assert.equal(B.candidatiArrivo('GPU-5070-DEMO', [u], []).length, 0);  // il vecchio codice non viene piu' accettato
    await dati.togli(u.daRivedere[0]);
    x = riga((await leggi()).unita, '6001', 'GPU');
    assert.equal(x.u.stato.daRivedere, false);
    await dati.segnaArrivo(x.u, x.r, 1, 'GPU-ALTRA-DEMO', null);
    assert.equal(db.banco_pezzi.find(b => b.componente_id === 11).codice, 'GPU-ALTRA-DEMO');
});

test('scheda rielaborata: le righe ricreate ritrovano i loro arrivi, i pezzi spariti restano segnalati', async () => {
    const { leggi, dati, db } = await banco();
    for (const tipo of ['GPU', 'CPU']) { const x = riga((await leggi()).unita, '6001', tipo); await dati.segnaArrivo(x.u, x.r, 1, null, null); }
    db.processed_order_components.find(c => c.id === 11).id = 911;          // stessa GPU, riga nuova
    db.processed_order_components = db.processed_order_components.filter(c => c.id !== 12);   // CPU tolta dalla scheda
    const u = (await leggi()).unita.find(y => y.id === '6001');
    assert.equal(u.righe.find(r => r.c.type === 'GPU').arrivati, 1);
    assert.equal(u.ricollegare.length, 1);
    assert.equal(u.ricollegare[0].componente_id, 911);
    uguali(u.daRivedere.map(b => b.tipo), ['CPU']);
    await dati.ricollega(u.ricollegare[0]);
    assert.equal(db.banco_pezzi.find(b => b.tipo === 'GPU').componente_id, 911);
    assert.equal((await leggi()).unita.find(y => y.id === '6001').ricollegare.length, 0);
});

test('upgrade pagato: il pezzo precedente non si monta e non blocca il PC', async () => {
    const db = datiDiProva(), o = db.processed_orders[1], comp = db.processed_order_components.filter(c => c.order_id === 2)
        .map(c => ({ id: c.id, type: c.component_type, ean: c.ean, name: c.product_name, supplier: c.supplier, price: c.price, quantity: 1 }));
    const piano = [{ tipo: 'COOLER', precedente: { id: 22, tipo: 'COOLER', ean: 'AIR-DEMO' }, scelta: 'LIQUIDO 360', descrizione: 'Dissipatore a liquido demo 360', ordine: '#4800', costo: 99 }];
    const u = B.costruisciUnita(o, comp, { piano });
    const cooler = u.righe.find(r => r.c.type === 'COOLER');
    assert.equal(cooler.nonMontare.descrizione, 'Dissipatore a liquido demo 360');
    assert.equal('costo' in cooler.nonMontare, false);
    assert.equal(u.stato.totale, 1);                                    // conta solo cio' che si monta davvero
    assert.equal(B.candidatiMontaggio('AIR-DEMO', u, []).length, 0);
    assert.equal(B.candidatiArrivo('AIR-DEMO', [u], []).length, 0);
    await assert.rejects(B.creaDati(creaSupabaseFinto(db)).segnaMontato(u, cooler, '', null, null), /upgrade pagato/);
    assert.equal(B.costruisciUnita(o, comp, {}).upgradeVerificati, false); // senza i dati del motore la verifica resta «non fatta»
    assert.equal(u.upgradeVerificati, true);
});

test('molte schede: gli id viaggiano a blocchi, mai in un solo URL', async () => {
    const db = datiDiProva();
    for (let i = 0; i < 200; i++) db.processed_orders.push({ id: 100 + i, shopify_order_id: String(7000 + i), order_id_flip: `#${5000 + i}`, stato: 'elaborati' });
    const sb = creaSupabaseFinto(db), d = await B.creaDati(sb).leggi(db.processed_orders.map(o => o.shopify_order_id));
    assert.equal(d.ordini.length, 204);
    assert.ok(sb.registro.every(x => x.inSize <= 80));
});

test('il banco non scrive mai nelle tabelle del gestionale e non conserva costi', async () => {
    for (const m of sorgente.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)\s*\.(\w+)/g))
        if (!m[1].startsWith('banco_')) assert.equal(m[2], 'select', `scrittura su ${m[1]}`);
    for (const m of sorgente.matchAll(/inBlocchi\('([a-z_]+)'/g)) assert.ok(/^(banco_|processed_order)/.test(m[1]));
    const { leggi, dati, sb } = await banco();
    const x = riga((await leggi()).unita, '6001', 'GPU');
    await dati.segnaArrivo(x.u, x.r, 1, 'GPU-5070-DEMO', 'Prova');
    await dati.segnaMontato(x.u, riga((await leggi()).unita, '6001', 'GPU').r, 'SN', 'Prova', null);
    await dati.salvaPc('6001', { stato: 'assemblato' });
    uguali([...new Set(sb.registro.filter(r => r.op !== 'select').map(r => r.tabella))].sort(), ['banco_pc', 'banco_pezzi']);
    // i valori si leggono da Acquisti e si mostrano: nelle tabelle del banco non c'e' nessuna colonna di costo
    assert.doesNotMatch(sql, /\b(costo|prezzo|price|unitario)\w*\s+(NUMERIC|INTEGER|TEXT)/i);
    assert.doesNotMatch((sorgente.match(/const foto = [\s\S]*?\}\);/) || [''])[0], /netto|costo|prezzo|price/i);
    assert.doesNotMatch(sql, /ALTER TABLE (?!%I)|DROP TABLE|processed_orders\s*\(|warehouse_inventory\s*\(/i);
});
