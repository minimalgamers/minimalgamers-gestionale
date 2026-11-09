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

const contatti = {
    invii: [
        {id: 'OMEGA_CPU', nome: 'OMEGA · solo CPU (diretto)', fornitori: ['OMEGA'],
            solo_categorie: ['CPU'], a: ['omega@example.test']},
        {id: 'INTERMEDIARIO', nome: 'Intermediario GT Officine del Computer', intermediario: true,
            fornitori: ['OMEGA', 'ACTION'], a: ['intermediario@example.test']},
        {id: 'FOCELDA', nome: 'FOCELDA · referente commerciale', fornitori: ['FOCELDA'],
            da_confermare: true, a: ['focelda@example.test']},
    ],
    senza_email: {AMAZON: 'si compra sul sito', NOUA: 'contatto da indicare'},
};

function piano(...righe) {
    const normalizzate = righe.map((r, n) => ({
        n, codice: `CODICE-${n}`, descrizione: `Componente ${n}`, quantita: 1, costo: 100,
        ordini: ['#4906'], pezzi: [{tipo: r.categoria}], ...r,
    }));
    const fornitori = elenco => [...new Set(elenco.map(r => r.fornitore))].map(nome => {
        const righeFornitore = elenco.filter(r => r.fornitore === nome);
        return {nome, righe: righeFornitore, pezzi: righeFornitore.length, costo: righeFornitore.length * 100};
    });
    return {
        esclusi: [], esclusioni: [], righe: normalizzate, fornitori: fornitori(normalizzate),
        categorie: [...new Set(normalizzate.map(r => r.categoria))].map(nome => {
            const dellaCategoria = normalizzate.filter(r => r.categoria === nome);
            return {nome, fornitori: fornitori(dellaCategoria), pezzi: dellaCategoria.length, costo: dellaCategoria.length * 100};
        }),
    };
}

function linkOutlook(html) {
    return [...html.matchAll(/href="(https:\/\/outlook\.office\.com\/mail\/deeplink\/compose[^"]*)"/gi)]
        .map(match => new URL(match[1].replaceAll('&amp;', '&')));
}

test('la proposta CPU OMEGA espone i due canali di contatto senza creare una bozza ordine', () => {
    const A = caricaGestionale();
    const r = piano({fornitore: 'OMEGA', categoria: 'CPU', daApplicare: true});
    for (const html of [A.htmlFornitoriDaOrdinare(r, 'OMEGA', contatti), A.htmlCategorieDaOrdinare(r, contatti)]) {
        assert.match(html, /Contatti commerciali/);
        assert.match(html, /OMEGA · solo CPU \(diretto\)/);
        assert.match(html, /Intermediario GT Officine del Computer · altro hardware/);
        assert.match(html, /Scrivi in Outlook/);
        assert.match(html, /data-rf-applica="0"/);
        const links = linkOutlook(html);
        assert.deepEqual(links.map(url => url.searchParams.get('to')).sort(),
            ['intermediario@example.test', 'omega@example.test']);
        for (const url of links) {
            assert.equal(url.searchParams.get('subject') || '', '');
            assert.equal(url.searchParams.get('body') || '', '');
        }
    }
    assert.equal(A.ordiniEmail(r, contatti).invii.length, 0);
    assert.doesNotMatch(A.htmlEmailOrdini(r, contatti), /data-rf-email=/);
});

test('i recapiti da verificare, i fornitori senza recapito e gli acquisti sul sito restano distinti', () => {
    const A = caricaGestionale();
    const r = piano(
        {fornitore: 'FOCELDA', categoria: 'RAM'},
        {fornitore: 'NOUA', categoria: 'CASE'},
        {fornitore: 'AMAZON', categoria: 'SSD'},
    );
    const focelda = A.htmlFornitoriDaOrdinare(r, 'FOCELDA', contatti);
    assert.match(focelda, /Contatto da confermare/i);
    assert.deepEqual(linkOutlook(focelda).map(url => url.searchParams.get('to')), ['focelda@example.test']);
    const noua = A.htmlFornitoriDaOrdinare(r, 'NOUA', contatti);
    assert.match(noua, /Recapito da indicare/i);
    assert.equal(linkOutlook(noua).length, 0);
    const amazon = A.htmlFornitoriDaOrdinare(r, 'AMAZON', contatti);
    assert.match(amazon, /Si compra sul sito/i);
    assert.doesNotMatch(amazon, /Recapito da indicare/i);
    assert.equal(linkOutlook(amazon).length, 0);
});

test('il referente di una casella condivisa compare nell’oggetto del contatto e della richiesta', () => {
    const A = caricaGestionale();
    const r = piano({fornitore: 'TRADERBAR', categoria: 'GPU'});
    const rubrica = {invii: [{id: 'TRADERBAR', nome: 'TRADERBAR · Ervin', fornitori: ['TRADERBAR'],
        a: ['sales@example.test'], lingua: 'en', attenzione: 'Ervin', richiesta_quotazione: true}]};
    const [link] = linkOutlook(A.htmlFornitoriDaOrdinare(r, 'TRADERBAR', rubrica));
    assert.equal(link.searchParams.get('to'), 'sales@example.test');
    assert.equal(link.searchParams.get('subject'), 'Attn: Ervin');
    assert.equal(link.searchParams.get('body'), '');
    const [invio] = A.ordiniEmail(r, rubrica).invii;
    const mail = A.testoEmail(invio, rubrica, '09/11/2026');
    assert.equal(mail.a, 'sales@example.test');
    assert.match(mail.oggetto, /^Attn: Ervin — Availability and quotation request/);
    assert.match(mail.corpo, /This is a quotation request, not an order confirmation/);
});
