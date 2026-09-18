// ============================================================
// session-no-timeout.js (v1) - Minimal Gamers Gestionale - 18/09/2026
// Richiesta dell'utente: il gestionale non deve piu' disconnettere.
//  - Auto-logout per inattivita' portato a "Mai" (una tantum, poi resta
//    quello scelto nelle impostazioni).
//  - La sessione salvata nel browser (shopify_session) viene rinnovata a
//    30 giorni all'apertura e poi ogni minuto (prima scadeva dopo 2 ore).
// Caricato da search-fix.js (stesso meccanismo di configuratore-ordini.js).
// Non tocca app.js: se questo file manca, tutto funziona come prima.
// ============================================================
(function () {
    if (window.__sessionNoTimeoutApplied) return;
    window.__sessionNoTimeoutApplied = true;

    var DAYS_30 = 30 * 24 * 60 * 60 * 1000;

    function renewSession() {
        try {
            var raw = localStorage.getItem('shopify_session');
            if (!raw) return;
            var s = JSON.parse(raw);
            if (!s || !s.apiKey) return;
            if (Date.now() > s.expiry) return; // gia' scaduta: non la resuscita
            if (s.expiry < Date.now() + DAYS_30 - 60000) {
                s.expiry = Date.now() + DAYS_30;
                localStorage.setItem('shopify_session', JSON.stringify(s));
            }
        } catch (e) { /* ignora */ }
    }

    // 1) Timeout inattivita' -> "Mai" (una sola volta; poi vale l'impostazione).
    try {
        if (localStorage.getItem('session_timeout_v2') !== '1') {
            localStorage.setItem('session_timeout', '0');
            localStorage.setItem('session_timeout_v2', '1');
        }
        if (localStorage.getItem('session_timeout') === null) {
            localStorage.setItem('session_timeout', '0');
        }
    } catch (e) { /* ignora */ }

    // 2) Rinnovo immediato e periodico della sessione salvata.
    renewSession();
    setInterval(renewSession, 60000);

    // 3) Se app.js ha gia' avviato il timer di inattivita', lo spegne.
    function stopInactivityTimer() {
        try {
            if (localStorage.getItem('session_timeout') === '0' &&
                typeof initSessionTimeout === 'function') {
                initSessionTimeout(0);
            }
            var sel = document.getElementById('session-timeout-select');
            if (sel && localStorage.getItem('session_timeout') === '0') sel.value = '0';
        } catch (e) { /* ignora */ }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(stopInactivityTimer, 0); });
    } else {
        setTimeout(stopInactivityTimer, 0);
    }
    window.addEventListener('load', function () { setTimeout(stopInactivityTimer, 500); });

    console.log('✅ session-no-timeout.js attivo (v1: auto-logout su Mai, sessione 30 giorni)');
})();
