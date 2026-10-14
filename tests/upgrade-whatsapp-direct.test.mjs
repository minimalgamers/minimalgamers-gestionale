// Antonio 10/10: un clic WhatsApp, tutte le proposte, scelta e pagamento al cliente.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const autoSource = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const blocco = (da, a) => source.slice(source.indexOf(da), source.indexOf(a));
const ordine = { id: '6100000000001.2', name: '#4824.2', billingName: 'MARIO ROSSI', phone: '+393331234567', email: 'mario.test@example.invalid' };
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
        pezzi: [], upgrade: proposte, upgrade_pagati: opzioni.pagati || [], upgrade_catalogo: opzioni.catalogo };
    const traccia = { richieste: [], finestre: [], aperture: [], notifiche: [], forza: [], email: 0, legacy: 0 };
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
        const f = { closed: false, opener: {}, document: { title: '', body: { children: [],
            appendChild(n) { this.children.push(n); } }, createElement: tag => ({ tag, style: {} }) },
            location: { replace(url) { if (opzioni.erroreApp) throw new Error('protocollo_bloccato'); f.url = url; } }, close() { f.closed = true; } };
        traccia.finestre.push(f);
        return f;
    };
    const s = { window: { AccoppiamentoAuto: api, open: (url, target, features) => {
        if (opzioni.erroreBozza) throw new Error('popup_bloccato');
        if (opzioni.bloccato) return null;
        const f = finestra(); Object.assign(f, { url, target, features }); return f;
    },
        location: { assign(url) { if(opzioni.erroreApp)throw new Error('protocollo_bloccato'); traccia.aperture.push(url); } } },
        URL, console, showNotification: (msg, tipo, action) => traccia.notifiche.push({ msg, tipo, action }),
        openEmailForOrder: async () => { traccia.email++; return 'email'; },
        openWhatsAppForOrder: async () => { traccia.legacy++; return 'legacy'; } };
    vm.createContext(s);
    vm.runInContext(blocco('function normalizePhoneForStorage', 'function getCurrentProcessedOrderById'), s);
    vm.runInContext(blocco('async function upgradeDellOrdine', 'function isValidEAN'), s);
    return { s, traccia, api, pc };
}

test('template 12/10: testo finale Antonio, nome ordine e link personali, grassetto WhatsApp valido', () => {
    const { api } = ambiente();
    const url = 'https://www.minimalgamers.it/pages/aggiornamento-ordine?c=LINK-PERSONALE-DI-PROVA';
    const msg = api.messaggioPaginaUpgrade({ id:'6100000000001',name:'#4816',customerName:'MARIA ROSSI' },url);
    assert.match(msg,/^Ciao Maria! 👋\nIl tuo PC GAMING dell'ordine #4816 è \*FINALMENTE\* nelle fasi finali dell'assemblaggio\./);
    assert.match(msg,/ringraziarti di tutta la pazienza/);
    assert.match(msg,/Vogliamo darti un PC GAMING spaziale/);
    assert.match(msg,/\*pagina personale solo per te\* 👇\n\n/);
    assert.equal(msg.split(url).length,2);
    assert.match(msg,/\*Al montaggio pensiamo noi\*/);
    assert.match(msg,/Gli \*upgrade\* sono tutti facoltativi; \*paghi solo quelli selezionati\*/);
    assert.match(msg,/\*rate disponibili al checkout\*/);
    assert.match(msg,/\*premium e definitiva\*/);
    assert.match(msg,/\*CHI PARTECIPA AGLI UPGRADE AVRÀ PRIORITÀ ASSOLUTA PER NOI\*/);
    assert.match(msg,/spedizione della tua build nei prossimi giorni/);
    assert.match(msg,/Apri il link e ascolta la guida 🎧\nTI ASPETTIAMO <3$/);
    assert.doesNotMatch(msg,/\*\*|\\\*|undefined|6100000000001|ROSSI|solo il PC/);
    assert.equal((msg.match(/\*/g)||[]).length % 2,0);
});

test('template 12/10: senza nome niente anagrafica inventata e per due PC distinzione conservata', () => {
    const { api } = ambiente();
    const primo = api.messaggioPaginaUpgrade({name:'#4824.1',customerName:'undefined undefined'},'https://example.invalid/?c=PC1', {pc_numero:1,pc_totale:2});
    const secondo = api.messaggioPaginaUpgrade({name:'#4824.2',billingName:'LUCA BIANCHI'},'https://example.invalid/?c=PC2', {pc_numero:2,pc_totale:2});
    assert.match(primo,/^Ciao! 👋/);
    assert.match(primo,/solo il PC 1 di 2/);
    assert.match(secondo,/^Ciao Luca! 👋/);
    assert.match(secondo,/solo il PC 2 di 2/);
    assert.match(secondo,/ordine #4824 è/);
    assert.doesNotMatch(secondo,/#4824\.2|BIANCHI|c=PC1/);
});

test('un clic crea tutte le 13 alternative di tutte le 7 famiglie, non solo i consigliati', async () => {
    const { s, traccia } = ambiente();
    const lavoro = s.contactWithTemplateSelection('whatsapp', ordine);
    assert.equal(traccia.finestre.length, 0, 'nessuna finestra durante la preparazione');
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
    const chat = new URL(traccia.aperture[0]);
    assert.equal(chat.protocol, 'whatsapp:');
    assert.equal(chat.hostname, 'send');
    assert.equal(chat.searchParams.get('phone'), '393331234567');
    assert.match(chat.searchParams.get('text'), /Ciao Mario!.*\n/);
    assert.match(chat.searchParams.get('text'), /solo il PC 2 di 2/);
    assert.match(chat.searchParams.get('text'), /aggiornamento-ordine\?c=/);
    assert.match(chat.searchParams.get('text'), /\*FINALMENTE\*/);
    assert.match(chat.searchParams.get('text'), /PRIORITÀ ASSOLUTA/);
    assert.match(chat.searchParams.get('text'), /tutti facoltativi/);
    assert.equal(traccia.finestre.length,0);
    assert.match(traccia.notifiche.at(-1).msg, /In WhatsApp premi Invia/);
    assert.equal(traccia.notifiche.at(-1).action.href,traccia.aperture[0]);
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
    assert.equal(traccia.finestre.length, 0);
    assert.equal(traccia.aperture.length,1);
    assert.equal(await s.preparaWhatsAppUpgrade(ordine), true, 'un secondo invio intenzionale rimane possibile');
});

test('PC 1 e PC 2 mantengono identità e messaggi separati, anche con richieste concorrenti', async () => {
    const { s, traccia } = ambiente();
    await Promise.all([s.preparaWhatsAppUpgrade({ ...ordine, id: '6100000000001.1', name: '#4824.1' }), s.preparaWhatsAppUpgrade(ordine)]);
    assert.deepEqual(traccia.richieste.map(x => x.corpo.ordine.unita), [0, 1]);
    assert.match(new URL(traccia.aperture[0]).searchParams.get('text'), /solo il PC 1 di 2/);
    assert.match(new URL(traccia.aperture[1]).searchParams.get('text'), /solo il PC 2 di 2/);
});

test('FPS BOOSTER già pagato per quel PC non viene proposto una seconda volta', async () => {
    const { s, traccia } = ambiente({ pagati: [{ categoria: 'FPS BOOSTER', prezzo: 99 }] });
    await s.preparaWhatsAppUpgrade(ordine);
    assert.equal(traccia.richieste[0].corpo.fps, false);
});

for (const stato of ['set_non_identificato', 'calcolo_non_riuscito']) {
    test('catalogo non verificato: mai pagina apparentemente completa con il solo FPS (' + stato + ')', async () => {
        const { s, traccia, pc } = ambiente({ catalogo: { stato, set: null } });
        pc.upgrade = [];
        assert.equal(await s.preparaWhatsAppUpgrade(ordine), false);
        assert.equal(traccia.richieste.length, 0);
        assert.equal(traccia.finestre.length,0);
        assert.equal(traccia.aperture.length,0);
        assert.match(traccia.notifiche.at(-1).msg, /Buyer Desk|incompleta/);
    });
}

test('file precedente senza diagnostica e nessuna proposta: non indovina FPS-only', async () => {
    const { s, traccia, pc } = ambiente();
    pc.upgrade = [];
    assert.equal(await s.preparaWhatsAppUpgrade(ordine), false);
    assert.equal(traccia.richieste.length, 0);
});

test('catalogo verificato senza altre aggiunte: FPS-only rimane legittimo', async () => {
    const { s, traccia, pc } = ambiente({ catalogo: { stato: 'ok', set: '901' } });
    pc.upgrade = [];
    assert.equal(await s.preparaWhatsAppUpgrade(ordine), true);
    assert.equal(traccia.richieste[0].corpo.proposte.length, 0);
    assert.equal(traccia.richieste[0].corpo.fps, true);
});

for (const opzioni of [{ errore: 'ordine_non_verificabile' }, { erroreDati: true },
    { url: 'https://altro.test/?c=x' }, { url: 'javascript:alert(1)' }]) {
    test('errore o link inatteso: nessun WhatsApp o messaggio senza link (' + JSON.stringify(opzioni) + ')', async () => {
        const { s, traccia } = ambiente(opzioni);
        assert.equal(await s.preparaWhatsAppUpgrade(ordine), false);
        assert.equal(traccia.finestre.length,0);
        assert.equal(traccia.aperture.length,0);
        assert.equal(traccia.legacy, 0);
        assert.equal(traccia.notifiche.at(-1).tipo, 'error');
    });
}

test('numero mancante: non crea una pagina e non apre app o schede', async () => {
    const { s, traccia } = ambiente();
    assert.equal(await s.preparaWhatsAppUpgrade({ ...ordine, phone: 'N/A' }), false);
    assert.equal(traccia.richieste.length,0);
    assert.equal(traccia.aperture.length,0);
    assert.equal(traccia.finestre.length,0);
});

test('popup bloccati: il percorso senza schede continua a preparare il messaggio', async () => {
    const {s,traccia}=ambiente({bloccato:true});
    assert.equal(await s.preparaWhatsAppUpgrade(ordine),true);
    assert.equal(traccia.richieste.length,1);
    assert.equal(traccia.aperture.length,1);
    assert.equal(traccia.finestre.length,0);
});

test('nessun PC corrispondente: non usa il primo PC e permette di riprovare', async () => {
    const { s, traccia } = ambiente();
    assert.equal(await s.preparaWhatsAppUpgrade({ ...ordine, id: '6100000000001.9' }), false);
    assert.equal(traccia.richieste.length, 0);
    assert.equal(await s.preparaWhatsAppUpgrade(ordine), true);
});

test('email usa la stessa proposta personale; vecchia selezione rimossa e cache incrementate', async () => {
    const { s, traccia } = ambiente();
    assert.equal(await s.contactWithTemplateSelection('email', ordine), true);
    assert.equal(traccia.email, 0, 'non richiama il vecchio template');
    assert.equal(traccia.richieste.length, 1);
    assert.doesNotMatch(source, /scegliUpgradeWhatsApp|data-pagina|data-up="/);
    assert.match(source, /aria-busy/);
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /app\.js\?v=75/);
    assert.match(html, /accoppiamento-auto\.js\?v=36/);
});

test('email: tutte le alternative, destinatario e PC esatti, testo equivalente senza asterischi di formattazione', async () => {
    const { s, traccia, api } = ambiente();
    const lavoro = s.preparaEmailUpgrade({ ...ordine, phone: '' });
    assert.equal(traccia.finestre.length, 0, 'non apre about:blank durante la preparazione');
    assert.equal(await lavoro, true, 'email non richiede il telefono');
    assert.equal(traccia.richieste[0].corpo.proposte.length, 13);
    assert.equal(traccia.richieste[0].corpo.ordine.unita, 1);
    assert.equal(traccia.finestre.length, 1);
    const bozza = new URL(traccia.finestre[0].url);
    assert.equal(bozza.origin, 'https://outlook.office.com');
    assert.equal(bozza.pathname, '/mail/deeplink/compose');
    assert.equal(bozza.searchParams.get('to'), ordine.email);
    assert.match(bozza.searchParams.get('subject'), /ordine #4824 · PC 2 di 2$/);
    const url = 'https://www.minimalgamers.it/pages/aggiornamento-ordine?c=CODICE-FINTO-DEL-TEST';
    assert.equal(bozza.searchParams.get('body'), api.messaggioPaginaUpgrade(ordine, url, { pc_numero: 2, pc_totale: 2 }).replace(/\*/g, ''));
    assert.match(bozza.searchParams.get('body'), /Ciao Mario! 👋/);
    assert.equal(traccia.finestre[0].features, 'noopener');
    assert.equal(traccia.aperture.length, 0, 'non apre WhatsApp');
    assert.match(traccia.notifiche.at(-1).msg, /Controlla il destinatario.*premi Invia/);
    assert.equal(new URL(traccia.notifiche.at(-1).action.href).href, bozza.href);
});

test('template email non altera caratteri del link e gestisce cliente senza nome', () => {
    const { api } = ambiente();
    const link = 'https://www.minimalgamers.it/pages/aggiornamento-ordine?c=_TOKEN-test&nota=*';
    const msg = api.messaggioEmailPaginaUpgrade({name:'#4824'}, link);
    assert.match(msg.body, /^Ciao! 👋/);
    assert.ok(msg.body.includes(link));
    assert.doesNotMatch(msg.body, /\*FINALMENTE\*|undefined|PC undefined/);
});

test('email e WhatsApp concorrenti per lo stesso PC condividono una richiesta e lo stesso link', async () => {
    let termina;
    const { s, traccia } = ambiente({ attesa: new Promise(r => { termina = r; }) });
    const email = s.preparaEmailUpgrade(ordine);
    const whatsapp = s.preparaWhatsAppUpgrade(ordine);
    termina();
    assert.deepEqual(await Promise.all([email, whatsapp]), [true, true]);
    assert.equal(traccia.richieste.length, 1);
    assert.equal(traccia.finestre.length, 1);
    const testoMail = new URL(traccia.finestre[0].url).searchParams.get('body');
    const testoWhatsApp = new URL(traccia.aperture[0]).searchParams.get('text');
    assert.equal(testoMail, testoWhatsApp.replace(/\*/g, ''));
});

test('email doppio clic: una pagina e una bozza; PC1/PC2 invece restano separati', async () => {
    const { s, traccia } = ambiente();
    const primo = s.preparaEmailUpgrade(ordine);
    assert.equal(primo, s.preparaEmailUpgrade(ordine));
    assert.equal(await primo, true);
    assert.equal(traccia.richieste.length, 1);
    assert.equal(traccia.finestre.length, 1);
    assert.equal(await s.preparaEmailUpgrade({ ...ordine, id:'6100000000001.1', name:'#4824.1' }), true);
    assert.equal(traccia.richieste[1].corpo.ordine.unita, 0);
    assert.match(new URL(traccia.finestre[1].url).searchParams.get('subject'), /PC 1 di 2$/);
});

test('email senza destinatario valido non crea pagine né bozze', async () => {
    for (const email of ['', 'N/A', 'cliente@', 'uno@example.invalid\nBcc:altro@example.invalid', 'a@example.invalid b@example.invalid']) {
        const { s, traccia } = ambiente();
        assert.equal(await s.preparaEmailUpgrade({ ...ordine, email }), false);
        assert.equal(traccia.richieste.length, 0);
        assert.equal(traccia.finestre.length, 0);
        assert.match(traccia.notifiche.at(-1).msg, /indirizzo email valido/);
    }
});

test('email conserva il link di apertura se il popup è bloccato o noopener restituisce null', async () => {
    for (const opzioni of [{ erroreBozza: true }, { bloccato: true }]) {
        const { s, traccia } = ambiente(opzioni);
        assert.equal(await s.preparaEmailUpgrade(ordine), !opzioni.erroreBozza);
        assert.equal(traccia.richieste.length, 1);
        assert.match(traccia.notifiche.at(-1).action.href, /^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?/);
        assert.equal(traccia.finestre.length, 0);
    }
});

test('email blocca catalogo incompleto, ordine non identificato e link esterno senza fallback legacy', async () => {
    for (const opzioni of [{catalogo:{stato:'incompleto'}}, {url:'https://example.invalid/?c=errato'}, {errore:'ordine_annullato'}, {erroreDati:true}]) {
        const { s, traccia } = ambiente(opzioni);
        assert.equal(await s.preparaEmailUpgrade(ordine), false);
        assert.equal(traccia.finestre.length, 0);
        assert.equal(traccia.email, 0);
    }
    const {s,traccia} = ambiente();
    assert.equal(await s.preparaEmailUpgrade({...ordine,id:'6100000000001.9'}),false);
    assert.equal(traccia.richieste.length,0);
    assert.equal(await s.preparaEmailUpgrade(ordine),true,'dopo errore è possibile riprovare');
});

test('email rispetta pagamenti in aggiornamento e non ripropone FPS Booster già pagato', async () => {
    const {s,traccia} = ambiente({pagati:[{categoria:'FPS BOOSTER',prezzo:99}]});
    s.window.UpgradePaidSync = {verifica:async()=>true};
    s.window.AccoppiamentoAuto.upgradeDaAllineare = () => true;
    assert.equal(await s.preparaEmailUpgrade(ordine),false);
    assert.equal(traccia.richieste.length,0);
    s.window.AccoppiamentoAuto.upgradeDaAllineare = () => false;
    assert.equal(await s.preparaEmailUpgrade(ordine),true);
    assert.equal(traccia.richieste[0].corpo.fps,false);
});

test('13/10: app installata senza pagina intermedia, riapertura con stesso testo/link e nessuna nuova richiesta', async () => {
    const {s,traccia}=ambiente();
    assert.equal(await s.preparaWhatsAppUpgrade(ordine),true);
    const link=traccia.notifiche.at(-1).action;
    assert.equal(link.href,traccia.aperture[0]);
    assert.equal(new URL(link.href).protocol,'whatsapp:');
    assert.match(link.label,/Apri WhatsApp/);
    assert.match(traccia.notifiche.at(-1).msg,/Consenti l’apertura/);
    assert.equal(traccia.richieste.length,1);
    assert.doesNotMatch(blocco('function preparaWhatsAppUpgrade','function preparaEmailUpgrade'),/['"`]https:\/\/(?:api|web)\.whatsapp\.com|['"`]https:\/\/wa\.me/);
    assert.doesNotMatch(blocco('function preparaWhatsAppUpgrade','function preparaEmailUpgrade'),/window\.open|about:blank|_blank|chat\.document/);
    const testo=new URL(traccia.aperture[0]).searchParams.get('text');
    assert.ok(testo.includes('👋')&&testo.includes('🎧'));
    assert.ok(testo.includes('\n\nhttps://www.minimalgamers.it/pages/aggiornamento-ordine?c='));
    assert.doesNotMatch(testo,/�/);
});

test('13/10: rifiuto immediato del protocollo non dichiara WhatsApp aperto e non ripiega sul web', async () => {
    const {s,traccia}=ambiente({erroreApp:true});
    assert.equal(await s.preparaWhatsAppUpgrade(ordine),false);
    assert.equal(traccia.finestre.length,0);
    assert.equal(traccia.aperture.length,0);
    assert.equal(traccia.richieste.length,1);
    assert.equal(traccia.notifiche.at(-1).tipo,'error');
    assert.equal(new URL(traccia.notifiche.at(-1).action.href).protocol,'whatsapp:');
    assert.equal(traccia.legacy,0);
});
