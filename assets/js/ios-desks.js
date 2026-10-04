/* Presentation-only decorator. No data, persistence, network or action handlers.
   It changes neither the original elements nor their textContent or disabled state. */
(() => {
    'use strict';
    const root = document.getElementById('processed-container');
    if (!root || !document.body.classList.contains('mg-ios')) return;
    const decoration = /^[\s]*(?:[\p{Extended_Pictographic}\u2197\u2715\u2716\u2705\uFE0F\u200D])+\s*/u;
    const selectors = [
        ['.acc-menu [data-sez="conto"]', 'credit-card'],
        ['.acc-menu [data-sez="pezzi"]', 'cube'],
        ['.acc-menu [data-sez="opzioni"]', 'plus'],
        ['.acc-menu [data-sez="avvisi"]', 'warning-circle'],
        ['.acc-menu [data-ordine-cliente]', 'receipt'],
        ['.acc-cambia', 'arrows-clockwise'],
        ['.acc-barra button:not(.acc-btn-conferma)', 'arrows-clockwise'],
        ['.acc-btn-conferma', 'check-circle'],
        ['.add-custom-item-btn', 'plus'],
        ['a.contact-email-btn', 'envelope-simple'],
        ['a.contact-whatsapp-btn', 'chat-circle'],
    ];
    const profitSelector = '.acc-esito:is(.pos,.neg,.basso,.incompleto)';
    const query = [profitSelector, ...selectors.map(([selector]) => selector)].join(',');
    function wrapDecoration(el) {
        for (const node of Array.from(el.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const match = node.textContent.match(decoration);
            if (!match || !match[0].trim()) continue;
            const span = document.createElement('span');
            span.className = 'mg-desk-original-decor';
            span.textContent = match[0];
            node.before(span);
            node.textContent = node.textContent.slice(match[0].length);
        }
    }
    function decorate(el) {
        if (!(el instanceof HTMLElement) || !root.contains(el)) return;
        if (el.matches(profitSelector)) {
            el.classList.add('mg-desk-profit');
            wrapDecoration(el);
            return;
        }
        const icon = selectors.find(([selector]) => el.matches(selector))?.[1];
        if (!icon) return;
        el.classList.add('mg-desk-icon');
        // URLs inside custom properties resolve at the consuming CSS file.
        el.style.setProperty('--desk-icon', `url("../icons/${icon}.svg")`);
        wrapDecoration(el);
    }
    function scan(node) {
        if (!(node instanceof HTMLElement) || !root.contains(node)) return;
        decorate(node);
        node.querySelectorAll(query).forEach(decorate);
    }
    scan(root);
    // Only observe this stable desk container; not the entire app. Ignore own spans
    // and attribute changes, so adding classes/styles cannot create feedback loops.
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'characterData') decorate(record.target.parentElement);
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.TEXT_NODE) decorate(node.parentElement);
                else if (!node.classList?.contains('mg-desk-original-decor')) scan(node);
            }
        }
    }).observe(root, {childList: true, characterData: true, subtree: true});
})();
