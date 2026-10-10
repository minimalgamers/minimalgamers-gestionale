// Antonio 10/10: un clic WhatsApp, tutte le proposte, scelta e pagamento al cliente.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const autoSource = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const blocco = (da, a) => source.slice(source.indexOf(da), source.indexOf(a));
const ordine = { id: '6100000000001.2', name: '#4824.2', billingName: 'MARIO ROSSI', phone: '+393331234567' };
const u = (categoria, scelta, extra = {}) => ({ categoria, scelta, chiave: categoria, differenza: 100, utile: 20,
    consigliato: false, ...extra });
const proposte = [
    ...['AK400 DIGITAL', 'AIO 240', 'AIO 360', 'AIO 360 DISPLAY'].map((s, i) => u('DISSIPATORE', s, { consigliato: i === 0 })),
    u('CONNETTIVITÀ', 'WI-FI + BLUETOOTH'), u('VENTOLE RGB', 'BUILD FULL VENTOLE'),
    u('SCATOLE COMPONENTI', 'SCATOLE ORIGINALI'),
    ...['1 TB', '2 TB', '4 TB'].map(s => u('ARCHIVIAZIONE AGGIUNTIVA', s)),
    u('SOFTWARE', 'OFFICE'), u('SOFTWARE', 'ANTIVIRUS'),
    u('ESPERIENZA ASSEMBLAGGIO IN LIVE', 'ESPERIENZA ASSEMBLAGGIO IN LIVE', { differenza: 100 }),
    u('GPU', 'RTX 5090'), u('DISSIPATORE', 'PERDITA', { utile: -1 }),
    u('SOFTWARE', 'SCONOSCIUTO', { utile: null }), u('SOFTWARE', 'VUOTO', { utile: '' }),
    u('SOFTWARE', 'INFINITO', { utile: Infinity }), u('SOFTWARE', 'INCLUSO', { differenza: 0 }),
    u('SOFTWARE', 'SENZA CHIAVE', { chiave: '' }), u('SOFTWARE', '', {}),
];

function ambiente(opzioni = {}) {
    const A = { window: {}, console: { log() {}, warn() {}, error() {} } };
    vm.createContext(A);
    vm.runInContext(autoSource, A);
    const api = A.window.AccoppiamentoAuto;
    const pc = { build: 'PC GAMING PROVA', riga: 0, riga_shopify: 0, linea_id: '111', quantita: 2,
        pezzi: [], upgrade: proposte, upgrade_pagati: opzioni.pagati || [] };
    const traccia = { richieste: [], finestre: [], notifiche: [], forza: [], email: 0, legacy: 0 };
    api.carica = async forza => {
        traccia.forza.push(forza);
        if (opzioni.erroreDati) throw new Error('rete');
        return { ordini: { 6100000000001: { pc: [pc] } } };
    };
    const originaleCrea = api.creaPaginaUpgrade;
    api.creaPaginaUpgrade = (...args) => originaleCrea(...args, async (url, init) => {
        traccia.richieste.push({ url, corpo: JSON.parse(init.body) });
        if (opzioni.attesa) await opzioni.attesa;
        return { ok: !opzioni.errore, status: opzioni.errore ? 503 : 200, json: async () => opzioni.errore
            ? { stato: opzioni.errore } : { stato: 'ok', url: opzioni.url || 'https://www.minimalgamers.it/pages/aggiornamento-ordine?c=CODICE-FINTO-DEL-TEST',
                proposte: args[2].length, fps: args[3] } };
    });
    const finestra = () => {
        const f = { closed: false, opener: {}, document: { title: '', body: {} },
            location: { replace(url) { f.url = url; } }, close() { f.closed = true; } };
        traccia.finestre.push(f);
        return f;
    };
    const s = { window: { AccoppiamentoAuto: api, open: () => opzioni.bloccato ? null : finestra() },
        URL, console, showNotification: (msg, tipo) => traccia.notifiche.push({ msg, tipo }),
        openEmailForOrder: async () => { traccia.email++; return 'email'; },
        openWhatsAppForOrder: async () => { traccia.legacy++; return 'legacy'; } };
    vm.createContext(s);
    vm.runInContext(blocco('function normalizePhoneForStorage', 'function getCurrentProcessedOrderById'), s);
    vm.runInContext(blocco('async function upgradeDellOrdine', 'function isValidEAN'), s);
    return { s, traccia, api, pc };
}

test('un clic crea tutte le 13 alternative di tutte le 7 famiglie, non solo i consigliati', async () => {
    const { s, traccia } = ambiente();
    const lavoro = s.contactWithTemplateSelection('whatsapp', ordine);
    assert.equal(traccia.finestre.length, 1, 'finestra riservata nel gesto prima di aspettare la rete');
    assert.equal(await lavoro, true);
    assert.equal(traccia.richieste.length, 1);
    const req = traccia.richieste[0].corpo;
    assert.equal(req.proposte.length, 13);
    assert.deepEqual(req.proposte.slice(0, 4).map(x => x.scelta), ['AK400 DIGITAL', 'AIO 240', 'AIO 360', 'AIO 360 DISPLAY']);
    assert.equal(new Set(req.proposte.map(x => x.categoria)).size, 7);
    assert.deepEqual([req.ordine.id, req.ordine.nome_ordine, req.ordine.linea_id, req.ordine.riga, req.ordine.unita],
        ['6100000000001', '#4824', '111', 0, 1]);
    assert.equal(req.ordine.nome_cliente, 'MARIO ROSSI');
    assert.equal(req.fps, true);
    assert.deepEqual(traccia.forza, [true]);
    assert.equal(traccia.legacy, 0);
    const chat = new URL(traccia.finestre[0].url);
    assert.equal(chat.origin, 'https://api.whatsapp.com');
    assert.equal(chat.searchParams.get('phone'), '393331234567');
    assert.match(chat.searchParams.get('text'), /Ciao Mario!.*\n/);
    assert.match(chat.searchParams.get('text'), /solo il PC 2 di 2/);
    assert.match(chat.searchParams.get('text'), /aggiornamento-ordine\?c=/);
    assert.match(chat.searchParams.get('text'), /tutti facoltativi/);
    assert.equal(traccia.finestre[0].opener, null);
    assert.match(traccia.notifiche.at(-1).msg, /In WhatsApp premi Invia/);
});

test('doppio clic sullo stesso PC: una sola richiesta e una sola chat', async () => {
    let termina;
    const attesa = new Promise(r => { termina = r; });
    const { s, traccia } = ambiente({ attesa });
    const a = s.preparaWhatsAppUpgrade(ordine);
    const b = s.preparaWhatsAppUpgrade(ordine);
    assert.equal(a, b);
    termina();
    assert.deepEqual(await Promise.all([a, b]), [true, true]);
    assert.equal(traccia.richieste.length, 1);
    assert.equal(traccia.finestre.length, 1);
    assert.equal(await s.preparaWhatsAppUpgrade(ordine), true, 'un secondo invio intenzionale rimane possibile');
});

test('PC 1 e PC 2 mantengono identità e messaggi separati, anche con richieste concorrenti', async () => {
    const { s, traccia } = ambiente();
    await Promise.all([s.preparaWhatsAppUpgrade({ ...ordine, id: '6100000000001.1', name: '#4824.1' }), s.preparaWhatsAppUpgrade(ordine)]);
    assert.deepEqual(traccia.richieste.map(x => x.corpo.ordine.unita), [0, 1]);
    assert.match(new URL(traccia.finestre[0].url).searchParams.get('text'), /solo il PC 1 di 2/);
    assert.match(new URL(traccia.finestre[1].url).searchParams.get('text'), /solo il PC 2 di 2/);
});

test('FPS BOOSTER già pagato per quel PC non viene proposto una seconda volta', async () => {
    const { s, traccia } = ambiente({ pagati: [{ categoria: 'FPS BOOSTER', prezzo: 99 }] });
    await s.preparaWhatsAppUpgrade(ordine);
    assert.equal(traccia.richieste[0].corpo.fps, false);
});

for (const opzioni of [{ errore: 'ordine_non_verificabile' }, { erroreDati: true },
    { url: 'https://altro.test/?c=x' }, { url: 'javascript:alert(1)' }]) {
    test('errore o link inatteso: nessun WhatsApp o messaggio senza link (' + JSON.stringify(opzioni) + ')', async () => {
        const { s, traccia } = ambiente(opzioni);
        assert.equal(await s.preparaWhatsAppUpgrade(ordine), false);
        assert.equal(traccia.finestre[0].url, undefined);
        assert.equal(traccia.finestre[0].closed, true);
        assert.equal(traccia.legacy, 0);
        assert.equal(traccia.notifiche.at(-1).tipo, 'error');
    });
}

test('numero mancante o popup bloccato: non crea una pagina e non invia nulla', async () => {
    for (const opzioni of [{ bloccato: true }, {}]) {
        const { s, traccia } = ambiente(opzioni);
        assert.equal(await s.preparaWhatsAppUpgrade(opzioni.bloccato ? ordine : { ...ordine, phone: 'N/A' }), false);
        assert.equal(traccia.richieste.length, 0);
    }
});

test('nessun PC corrispondente: non usa il primo PC e permette di riprovare', async () => {
    const { s, traccia } = ambiente();
    assert.equal(await s.preparaWhatsAppUpgrade({ ...ordine, id: '6100000000001.9' }), false);
    assert.equal(traccia.richieste.length, 0);
    assert.equal(await s.preparaWhatsAppUpgrade(ordine), true);
});

test('email immutata, vecchia selezione rimossa e versioni cache incrementate', async () => {
    const { s, traccia } = ambiente();
    assert.equal(await s.contactWithTemplateSelection('email', ordine), 'email');
    assert.equal(traccia.email, 1);
    assert.equal(traccia.richieste.length, 0);
    assert.doesNotMatch(source, /scegliUpgradeWhatsApp|data-pagina|data-up="/);
    assert.match(source, /aria-busy/);
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /app\.js\?v=68/);
    assert.match(html, /accoppiamento-auto\.js\?v=31/);
});
