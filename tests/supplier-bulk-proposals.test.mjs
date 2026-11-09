import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const j = value => JSON.parse(JSON.stringify(value));

function fixture({erroreComponente} = {}) {
    const chiamate = [], finestre = [];
    let attiva = false, ricariche = 0;
    const cache = {}, dati = {
        ordini: {}, offerte_ordinabili: [], regole_acquisto: 'buyerdesk-netto-stock-v1',
        generato: new Date().toISOString(), listini: new Date().toISOString(),
    };
    const scadenza = new Date(Date.now() + 3600_000).toISOString();
    const offerta = (codice, fornitore, costoUnitario, stock = 10, quantita = 1) => ({
        codice, fornitore, costo_unitario: costoUnitario, costo: costoUnitario * quantita, stock, quantita,
        disponibilita: `${stock} pz`, descrizione: `Modello ${codice}`, ordinabile: true,
        stock_valid_until: scadenza, price_valid_until: scadenza,
    });
    const ram = offerta('RAM-OMEGA', 'OMEGA', 46);
    const ssd = offerta('SSD-OMEGA', 'OMEGA', 71);
    const altroFornitore = offerta('GPU-ABACO', 'ABACO', 200);
    const bloccata = {...offerta('PSU-OMEGA', 'OMEGA', 65, 0), da_confermare: true, ordinabile: false};
    dati.offerte_ordinabili = [ram, ssd, altroFornitore];
    const schede = [];
    function aggiungi(id, specifiche) {
        const salvati = specifiche.map(([componentId, tipo, target, pronto]) => ({
            id: componentId, type: tipo, ean: pronto ? target.codice : `OLD-${componentId}`,
            supplier: pronto ? target.fornitore : 'ACTION', name: `Componente ${componentId}`,
            quantity: 1, price: null,
        }));
        cache[id] = {components: salvati};
        dati.ordini[id] = {nome: `#${id}`, pc: [{quantita: 1, pezzi: specifiche.map(([, tipo, target]) => ({tipo, auto: target}))}]};
        schede.push({id, nome: `#${id}`, foglio: 1, salvati, voci: [], righe: salvati.map(c => ({
            tipo: c.type, ean: c.ean, nome: c.name, fornitore: c.supplier, quantita: c.quantity, costo: 35, fonte: 'listino',
        }))});
    }
    aggiungi('4906', [[1, 'RAM', ram], [2, 'SSD', ssd], [3, 'PSU', bloccata]]);
    aggiungi('4907', [[4, 'RAM', {...ram, quantita: 2, costo: 92}]]);
    aggiungi('4908', [[5, 'GPU', altroFornitore]]);
    aggiungi('4909', [[6, 'RAM', ram, true]]);

    const sandbox = {
        window: {SupabaseDB: {async replacePurchaseComponent(id, piano) {
            assert.equal(attiva, false, 'le scritture dello stesso ordine non si sovrappongono');
            attiva = true;
            try {
                await Promise.resolve();
                chiamate.push({id, piano: j(piano)});
                if (piano.expected.id === erroreComponente) throw new Error('Test: scheda cambiata');
                return {component: {id: piano.expected.id, type: piano.expected.type, ...piano.replacement, price: null}};
            } finally {
                attiva = false;
            }
        }}},
        console: {log() {}, warn() {}, error() {}},
        localStorage: {getItem: () => null, setItem() {}},
        processedOrdersCache: cache,
        loadProcessedOrdersFromDB: async () => { ricariche++; },
        showNotification() {},
        fetch: () => { throw new Error('Nessuna chiamata di rete nei test'); },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const A = sandbox.window.AccoppiamentoAuto;
    A.riepilogo.modo = 'manuale';
    sandbox.document = {
        getElementById: id => id === 'accoppiamento-auto-style' ? {} : null,
        body: {appendChild: dialogo => finestre.push(dialogo)},
        createElement() {
            const controlli = {};
            return {innerHTML: '', remove() {}, querySelector: q => q === '.acc-finestra-corpo' ? {} :
                controlli[q] ||= {addEventListener: (_evento, fn) => { controlli[q].click = fn; }}};
        },
    };
    const riepilogo = () => A.daOrdinare(dati, schede.map(s => ({
        ...s, salvati: cache[s.id].components, righe: s.righe.map((r, i) => {
            const c = cache[s.id].components[i];
            return {...r, ean: c.ean, nome: c.name, fornitore: c.supplier, quantita: c.quantity};
        }),
    })), {});
    return {A, chiamate, dati, finestre, riepilogo, ricariche: () => ricariche,
        omega: () => riepilogo().fornitori.find(f => f.nome === 'OMEGA')};
}

test('conferma per fornitore salva ogni offerta e quantità esatta, lasciando fuori le altre righe', async () => {
    const f = fixture();
    const r = f.riepilogo(), omega = r.fornitori.find(g => g.nome === 'OMEGA');
    assert.match(f.A.htmlFornitoriDaOrdinare(r, 'OMEGA'), /data-rf-applica-fornitore="OMEGA"/);
    assert.match(f.A.htmlLatoDaOrdinare(r, 1, '10:30', 'fornitori', 'OMEGA'), /data-rf-applica-fornitore="OMEGA"/);
    assert.match(f.A.htmlFornitoriDaOrdinare(r, 'OMEGA'), /data-rf-applica="\d+"/);
    assert.equal(omega.righe.find(x => x.codice === 'RAM-OMEGA' && x.daApplicare).quantita, 3);
    const esito = f.A.confermaProposteFornitore(omega, async () => f.dati);
    assert.equal(f.chiamate.length, 0);
    assert.equal(f.finestre.length, 1);
    assert.match(f.finestre[0].innerHTML, /RAM-OMEGA/);
    assert.match(f.finestre[0].innerHTML, /SSD-OMEGA/);
    assert.doesNotMatch(f.finestre[0].innerHTML, /PSU-OMEGA|GPU-ABACO/);
    f.finestre[0].querySelector('[data-si]').click();
    assert.deepEqual(j(await esito), {fatti: 3, falliti: []});
    const sostituzioni = f.chiamate.map(({id, piano}) => [
        id, piano.expected.id, piano.expected.quantity, piano.replacement.ean, piano.replacement.quantity, piano.source,
    ]).sort((a, b) => a[1] - b[1]);
    assert.deepEqual(sostituzioni, [
        ['4906', 1, 1, 'RAM-OMEGA', 1, 'allocation_plan'],
        ['4906', 2, 1, 'SSD-OMEGA', 1, 'allocation_plan'],
        ['4907', 4, 1, 'RAM-OMEGA', 2, 'allocation_plan'],
    ]);
    assert.equal(f.ricariche(), 1);
    assert.equal(f.omega().righe.filter(f.A.rigaOrdinabile).reduce((n, r) => n + r.quantita, 0), 5);
});

test('annullare la conferma del fornitore non aggiorna le schede', async () => {
    const f = fixture();
    const esito = f.A.confermaProposteFornitore(f.omega(), async () => {
        assert.fail('Il listino viene verificato soltanto dopo la conferma');
    });
    f.finestre[0].querySelector('[data-no]').click();
    await esito;
    assert.equal(f.chiamate.length, 0);
    assert.equal(f.ricariche(), 0);
});

test('prezzo o stock cambiati bloccano tutte le scritture prima della prima sostituzione', async () => {
    for (const muta of [
        a => ({...a, costo_unitario: a.costo_unitario + 1, costo: a.costo + 1}),
        a => ({...a, stock: 3, disponibilita: '3 pz'}),
    ]) {
        const f = fixture();
        const correnti = j(f.dati);
        correnti.offerte_ordinabili[0] = muta(correnti.offerte_ordinabili[0]);
        const esito = f.A.confermaProposteFornitore(f.omega(), async () => correnti);
        f.finestre[0].querySelector('[data-si]').click();
        await assert.rejects(esito, /prezzo|quantità|stock|disponibil/i);
        assert.equal(f.chiamate.length, 0);
        assert.equal(f.ricariche(), 0);
    }
});

test('un errore durante la scrittura viene riportato senza attribuire come aggiornato il componente', async () => {
    const f = fixture({erroreComponente: 2});
    const esito = f.A.confermaProposteFornitore(f.omega(), async () => f.dati);
    f.finestre[0].querySelector('[data-si]').click();
    const r = await esito;
    assert.equal(r.fatti, 2);
    assert.equal(r.falliti.length, 1);
    assert.match(r.falliti[0], /4906.*scheda cambiata/i);
    assert.equal(f.omega().righe.find(x => x.codice === 'SSD-OMEGA').daApplicare, true);
    assert.equal(f.ricariche(), 1);
});
