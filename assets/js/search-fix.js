// ============================================================
// search-fix.js  (v4)
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

    console.log('✅ search-fix.js attivo (v4 - no fornitore + custom items senza filtro categoria)');
})();
