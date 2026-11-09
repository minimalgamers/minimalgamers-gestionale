import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function caricaGestionale() {
    const sandbox = {window: {}, console, localStorage: {getItem: () => null, setItem() {}}};
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8'), sandbox);
    return sandbox.window.AccoppiamentoAuto;
}

function pianoProposte() {
    const righe = [
        {fornitore: 'OMEGA', categoria: 'CPU'},
        {fornitore: 'NOUA', categoria: 'CASE'},
        {fornitore: 'AMAZON', categoria: 'SSD'},
    ].map((r, n) => ({...r, n, quantita: 1, costo: 100, daApplicare: true}));
    return {
        pc: 1, pezzi: righe.length, totale: 300, pronti: 0, daApplicare: righe.length, righe, esclusi: [],
        fornitori: righe.map(r => ({nome: r.fornitore, pezzi: 1, costo: r.costo, righe: [r]})),
    };
}

const contatti = {
    invii: [
        {id: 'OMEGA_CPU', nome: 'OMEGA · solo CPU (diretto)', fornitori: ['OMEGA'],
            solo_categorie: ['CPU'], a: ['omega@example.test']},
        {id: 'INTERMEDIARIO', nome: 'Intermediario GT Officine del Computer', intermediario: true,
            fornitori: ['OMEGA'], a: ['intermediario@example.test']},
        {id: 'TRADERBAR', nome: 'TRADERBAR · Ervin', fornitori: ['TRADERBAR'], lingua: 'en',
            attenzione: 'Ervin', da_confermare: true, richiesta_quotazione: true, a: ['traderbar@example.test']},
    ],
    senza_email: {AMAZON: 'si compra sul sito', NOUA: 'contatto da indicare'},
};

function titoliDettagli(html) {
    return [...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)]
        .map(match => match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

function linkOutlook(html) {
    return [...html.matchAll(/href="(https:\/\/outlook\.office\.com\/mail\/deeplink\/compose[^"]*)"/gi)]
        .map(match => new URL(match[1].replaceAll('&amp;', '&')));
}

test('la colonna sinistra mostra OMEGA in proposta e gli altri recapiti indipendentemente dalle bozze', () => {
    const A = caricaGestionale();
    const piano = pianoProposte();
    const html = A.htmlLatoDaOrdinare(piano, 1, '10:30', 'fornitori', 'NOUA', contatti);
    assert.match(html, /Contatti commerciali/);
    const titoli = titoliDettagli(html);
    assert.ok(titoli.some(titolo => /\bOMEGA\b/.test(titolo)), 'OMEGA ha un dettaglio riconoscibile nella colonna');
    assert.ok(titoli.some(titolo => /Altri fornitori/.test(titolo)));
    assert.ok(titoli.some(titolo => /\bTRADERBAR\b/.test(titolo)));
    assert.match(html, /OMEGA · solo CPU \(diretto\)/);
    assert.match(html, /Intermediario GT Officine del Computer · altro hardware/);
    assert.equal(A.ordiniEmail(piano, contatti).invii.length, 0);
    assert.doesNotMatch(html, /data-rf-email=/);

    const links = linkOutlook(html);
    assert.deepEqual(links.map(url => url.searchParams.get('to')).sort(),
        ['intermediario@example.test', 'omega@example.test', 'traderbar@example.test']);
    assert.equal(links.find(url => url.searchParams.get('to') === 'traderbar@example.test').searchParams.get('subject'), 'Attn: Ervin');
    assert.ok(links.every(url => !url.searchParams.get('body')));
});

test('la rubrica nella colonna distingue gli acquisti sul sito dai recapiti mancanti o da confermare', () => {
    const A = caricaGestionale();
    const html = A.htmlLatoDaOrdinare(pianoProposte(), 1, '10:30', 'categorie', null, contatti);
    assert.ok(titoliDettagli(html).some(titolo => /\bAMAZON\b/.test(titolo)));
    assert.ok(titoliDettagli(html).some(titolo => /\bNOUA\b/.test(titolo)));
    assert.match(html, /Si compra sul sito/i);
    assert.match(html, /Recapito da indicare/i);
    assert.match(html, /Contatto da confermare/i);
    assert.match(html, /Per richieste di quotazione/i);
});
