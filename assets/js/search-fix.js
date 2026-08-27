// ============================================================
// search-fix.js  (v6)
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
// ============================================================
(function () {
    if (window.__searchFixApplied) return;
    window.__searchFixApplied = true;

    const _prevFetch = window.fetch.bind(window);

    function fixUrl(url) {
        let u = String(url);

        // La tabella del configuratore non c'entra con la ricerca componenti:
        // le sue query non vanno toccate. In particolare non deve perdere
        // niente dal select, che qui sotto verrebbe ripulito.
        if (/configuratore_liste_fornitori/i.test(u)) return u;

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

    // Carica la sezione degli ordini del configuratore. Se il file non c'e o
    // non parte, il gestionale resta esattamente quello di prima: la sezione e
    // aggiuntiva e non tocca niente di quello che gia funziona.
    try {
        const script = document.createElement('script');
        script.src = 'assets/js/configuratore-ordini.js?v=2';
        script.async = true;
        script.onerror = function () {
            console.warn('Sezione configuratore non caricata: il resto del gestionale non ne risente.');
        };
        document.head.appendChild(script);
    } catch (e) {
        console.warn('Sezione configuratore non agganciata.', e);
    }

    console.log('✅ search-fix.js attivo (v6 - no fornitore + custom items senza filtro categoria + sezione configuratore)');
})();
