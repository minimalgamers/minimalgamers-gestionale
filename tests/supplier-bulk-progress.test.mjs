import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');

function sospesa() {
    let completa;
    const promessa = new Promise(resolve => { completa = resolve; });
    return {promessa, completa};
}

function ambiente({salva, ricarica} = {}) {
    const cache = {}, avvisi = [], finestre = [], chiamate = [];
    const now = new Date().toISOString();
    const scadenza = new Date(Date.now() + 3600_000).toISOString();
    const dati = {regole_acquisto: 'buyerdesk-netto-stock-v1', generato: now, listini: now, ordini: {}, offerte_ordinabili: []};
    const schede = [];
    for (const [id, fornitore, tipo, n] of [['10', 'ACTION', 'RAM', 1], ['11', 'ACTION', 'SSD', 2], ['12', 'TIER ONE', 'CPU', 3]]) {
        const c = {id: n, type: tipo, ean: `OLD-${n}`, name: `Pezzo ${n}`, supplier: 'ABACO', quantity: 1, price: null};
        const offerta = {codice: `NEW-${n}`, descrizione: `Nuovo ${n}`, fornitore, quantita: 1, costo: 70,
            costo_unitario: 70, stock: 10, disponibilita: '10 pz', ordinabile: true,
            stock_valid_until: scadenza, price_valid_until: scadenza};
        cache[id] = {components: [c]};
        dati.ordini[id] = {nome: `#${id}`, pc: [{quantita: 1, pezzi: [{tipo, auto: offerta}]}]};
        dati.offerte_ordinabili.push(offerta);
        schede.push({id, nome: `#${id}`, foglio: 1, salvati: [c], voci: [],
            righe: [{tipo, ean: c.ean, nome: c.name, fornitore: c.supplier, quantita: 1, costo: 90, fonte: 'listino'}]});
    }
    const sandbox = {
        window: {SupabaseDB: {async replacePurchaseComponent(id, piano) {
            chiamate.push({id, piano});
            await salva?.(id, piano);
            return {component: {id: piano.expected.id, type: piano.expected.type, ...piano.replacement, price: null}};
        }}},
        console: {log() {}, warn() {}, error() {}},
        localStorage: {getItem: () => null, setItem() {}},
        processedOrdersCache: cache,
        loadProcessedOrdersFromDB: ricarica || (async () => {}),
        showNotification: (testo, tipo) => avvisi.push({testo, tipo}),
        fetch: () => { throw new Error('Nessuna chiamata di rete nei test'); },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const A = sandbox.window.AccoppiamentoAuto;
    A.riepilogo.modo = 'manuale';
    const progresso = {textContent: '', hidden: true};
    const action = {textContent: 'Rivedi ACTION', disabled: false, dataset: {rfApplicaFornitore: 'ACTION'}};
    const tierOne = {textContent: 'Rivedi TIER ONE', disabled: false, dataset: {rfApplicaFornitore: 'TIER ONE'}};
    const giaDisabilitato = {textContent: 'Copia', disabled: true, dataset: {}};
    sandbox.document = {
        getElementById: id => id === 'accoppiamento-auto-style' ? {} : null,
        querySelectorAll: selector => selector === '[data-rf-progress]' ? [progresso] :
            selector.includes('[data-rf-applica-fornitore]') ? [action, tierOne, giaDisabilitato] : [],
        body: {appendChild: dialogo => finestre.push(dialogo)},
        createElement() {
            const controlli = {};
            return {innerHTML: '', remove() {}, querySelector: q => q === '.acc-finestra-corpo' ? {} :
                controlli[q] ||= {addEventListener: (_evento, fn) => { controlli[q].click = fn; }}};
        },
    };
    const r = A.daOrdinare(dati, schede, {});
    const fornitore = nome => r.fornitori.find(f => f.nome === nome);
    return {A, dati, r, fornitore, avvisi, finestre, chiamate, progresso, action, tierOne, giaDisabilitato};
}

test('il lotto attivo mostra fase e avanzamento e avvisa quando si prova un altro fornitore', async () => {
    const listino = sospesa(), iniziata = sospesa(), scrittura = sospesa(), aggiornamento = sospesa(), aggiornata = sospesa();
    let primaScrittura = true;
    const f = ambiente({
        salva: async () => {
            if (!primaScrittura) return;
            primaScrittura = false;
            iniziata.completa();
            await scrittura.promessa;
        },
        ricarica: async () => { aggiornamento.completa(); await aggiornata.promessa; },
    });
    const {A} = f;
    assert.equal(A.statoConfermaProposte(), null);
    const esito = A.confermaProposteFornitore(f.fornitore('ACTION'), () => listino.promessa);
    assert.equal(A.statoConfermaProposte()?.fornitore, 'ACTION');
    assert.equal(A.statoConfermaProposte()?.fase, 'revisione');
    f.finestre[0].querySelector('[data-si]').click();
    await Promise.resolve();
    assert.equal(A.statoConfermaProposte()?.fase, 'verifica');
    listino.completa(f.dati);
    await iniziata.promessa;
    const inCorso = A.statoConfermaProposte();
    assert.equal(inCorso.fase, 'salvataggio');
    assert.equal(inCorso.totale, 2);
    assert.equal(inCorso.elaborati, 0);
    assert.equal(f.progresso.hidden, false);
    assert.match(f.progresso.textContent, /ACTION.*0\/2 elaborati/);
    assert.equal(f.action.disabled, true);
    assert.equal(f.tierOne.disabled, true);
    assert.match(f.tierOne.textContent, /Attendi ACTION/);
    const lato = A.htmlLatoDaOrdinare(f.r, 1, '10:30', 'fornitori', 'TIER ONE');
    assert.match(lato, /ACTION/);
    assert.match(lato, /salvat|aggiornamento in corso/i);
    assert.match(lato, /(?:aria-live|role="status")/i);

    await A.confermaProposteFornitore(f.fornitore('TIER ONE'), () => {
        assert.fail('Il secondo fornitore non deve partire con un lotto attivo');
    });
    assert.equal(f.finestre.length, 1);
    assert.equal(f.chiamate.length, 1);
    assert.ok(f.avvisi.some(a => /ACTION/.test(a.testo) && /in corso|attendi/i.test(a.testo)));
    scrittura.completa();
    await aggiornamento.promessa;
    const sincronizzazione = A.statoConfermaProposte();
    assert.equal(sincronizzazione.fase, 'aggiornamento');
    assert.equal(sincronizzazione.elaborati, 2);
    assert.equal(sincronizzazione.fatti, 2);
    aggiornata.completa();
    assert.equal((await esito).fatti, 2);
    assert.equal(A.statoConfermaProposte(), null);
    assert.match(f.progresso.textContent, /ACTION.*2\/2 componenti aggiornati/);
    assert.equal(f.action.disabled, false);
    assert.equal(f.tierOne.disabled, false);
    assert.equal(f.tierOne.textContent, 'Rivedi TIER ONE');
    assert.equal(f.giaDisabilitato.disabled, true);

    const prossimo = A.confermaProposteFornitore(f.fornitore('TIER ONE'), async () => f.dati);
    assert.equal(f.finestre.length, 2);
    f.finestre[1].querySelector('[data-no]').click();
    await prossimo;
    assert.equal(A.statoConfermaProposte(), null);
    assert.equal(f.chiamate.length, 2);
});

test('un listino cambiato libera lo stato senza scritture', async () => {
    const {A, dati, fornitore, finestre, chiamate} = ambiente();
    const aggiornato = JSON.parse(JSON.stringify(dati));
    aggiornato.offerte_ordinabili[0].costo_unitario += 1;
    aggiornato.offerte_ordinabili[0].costo += 1;
    const esito = A.confermaProposteFornitore(fornitore('ACTION'), async () => aggiornato);
    finestre[0].querySelector('[data-si]').click();
    await assert.rejects(esito, /prezzo/i);
    assert.equal(chiamate.length, 0);
    assert.equal(A.statoConfermaProposte(), null);
});

test('l’avanzamento conta separatamente le scritture fallite e il lotto si chiude', async () => {
    const aggiornamento = sospesa(), aggiornata = sospesa();
    const f = ambiente({
        salva: async id => { if (id === '10') throw new Error('Scheda aggiornata da un operatore'); },
        ricarica: async () => { aggiornamento.completa(); await aggiornata.promessa; },
    });
    const esito = f.A.confermaProposteFornitore(f.fornitore('ACTION'), async () => f.dati);
    f.finestre[0].querySelector('[data-si]').click();
    await aggiornamento.promessa;
    const stato = f.A.statoConfermaProposte();
    assert.equal(stato.elaborati, 2);
    assert.equal(stato.fatti, 1);
    assert.equal(stato.falliti, 1);
    aggiornata.completa();
    const risultato = await esito;
    assert.equal(risultato.fatti, 1);
    assert.equal(risultato.falliti.length, 1);
    assert.equal(f.A.statoConfermaProposte(), null);
});
