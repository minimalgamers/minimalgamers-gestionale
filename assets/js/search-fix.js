// ============================================================
// search-fix.js  (v8)
// FIX ricerca componenti nel popup "Cerca Componente".
// Avvolge window.fetch (DOPO api-adapter.js) e corregge gli URL
// di ricerca al volo. Lavora SOLO su stringhe, come l'adapter,
// per non creare oggetti Request (che causavano errori).
//
// Problemi risolti:
//  1) Le query Supabase chiedono la colonna `fornitore`, assente in
//     alcune tabelle (es. RAM) -> errore 400 -> ricerca incompleta.
//     -> Rimuove `fornitore` dal parametro select.
//  2) La query custom items (`articoli_aggiunti`) filtra per
//     categoria=eq.XXX, escludendo articoli con categoria diversa dal
//     tipo (es. "Dissipatore" vs "COOLER").
//     -> Rimuove il filtro categoria da quella query.
//
// v5: carica anche configuratore-ordini.js, la sezione degli ordini del
//     configuratore. Sta qui e non in index.html perche quel file e grosso e
//     riscriverlo per intero per aggiungere una riga di <script> sarebbe un
//     rischio sproporzionato. Se e possibile aggiungere quella riga a mano, il
//     posto giusto e index.html insieme agli altri script, e questo blocco va
//     tolto.
// v6: alzata la versione di configuratore-ordini.js da 1 a 2, altrimenti il
//     browser continua a servire la copia vecchia dalla cache. Ogni volta che
//     quel file cambia in modo visibile, va alzato anche questo numero.
// v7: carica anche session-no-timeout.js (18/09/2026): niente auto-logout per
//     inattivita' e sessione salvata per 30 giorni invece di 2 ore. Stesso
//     motivo del v5: index.html e' troppo grosso per riscriverlo.
// v8 (03/10/2026): niente piu' scheda «Configuratore» (configuratore-ordini.js). Leggeva le liste dalla
//     tabella Supabase configuratore_liste_fornitori, leggibile con la chiave pubblica e non piu' scritta dal
//     configuratore: i PC del configuratore ora passano da Ordini -> E1-E4 come le altre build, con la card
//     viola (build-configuratore.js), e i loro pezzi sono anche nella pagina Automatico.
// ============================================================
(function () {
    if (window.__searchFixApplied) return;
    window.__searchFixApplied = true;

    const _prevFetch = window.fetch.bind(window);

    function fixUrl(url) {
        let u = String(url);

        // (1) togli "fornitore" dal SELECT nelle query REST Supabase
        if (/\/rest\/v1\//i.test(u) && /fornitore/i.test(u)) {
            u = u
                .replace(/%2Cfornitore/gi, '')
                .replace(/fornitore%2C/gi, '')
                .replace(/,fornitore/gi, '')
                .replace(/fornitore,/gi, '');
        }

        // (2) sulla query articoli_aggiunti, togli il filtro categoria=eq.XXX
        if (/articoli_aggiunti/i.test(u)) {
            u = u
                .replace(/[?&]categoria=eq\.[^&]*/gi, function (m) {
                    return m.charAt(0) === '?' ? '?' : '';
                })
                .replace(/\?&/g, '?')
                .replace(/&&/g, '&')
                .replace(/[?&]$/g, '');
        }

        return u;
    }

    window.fetch = function (url, options) {
        try {
            // Modifico solo se url e' una stringa (caso reale dell'app).
            if (typeof url === 'string') {
                url = fixUrl(url);
            }
        } catch (e) { /* in caso di errore lascio l'url originale */ }
        return _prevFetch(url, options);
    };

    // Sessione senza scadenza (v7). Se il file manca, il gestionale resta
    // esattamente com'era (timeout da impostazioni, sessione 2 ore).
    try {
        const sessionScript = document.createElement('script');
        sessionScript.src = 'assets/js/session-no-timeout.js?v=1';
        sessionScript.async = true;
        sessionScript.onerror = function () {
            console.warn('session-no-timeout.js non caricato: valgono timeout e scadenza di prima.');
        };
        document.head.appendChild(sessionScript);
    } catch (e) {
        console.warn('session-no-timeout.js non agganciato.', e);
    }

    console.log('✅ search-fix.js attivo (v8 - no fornitore + custom items senza filtro categoria + sessione senza scadenza)');
})();
