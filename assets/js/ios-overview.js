/* Bounded presentation observer. Original values, state and controls untouched. */
(() => {
    'use strict';
    const root = document.getElementById('automatico-container');
    if (!root || !document.body.classList.contains('mg-ios')) return;
    const selector = '.acc-esito:is(.pos,.neg,.basso,.incompleto)';
    const decoration = /^[\s]*(?:[\p{Extended_Pictographic}\uFE0F\u200D])+\s*/u;
    function decorate(el) {
        if (!(el instanceof HTMLElement) || !root.contains(el)) return;
        if (el.matches('.acc-tabella')) {
            // Labels are copied from this table's own headings, never inferred
            // from prices or product data. Native table nodes stay in place.
            const headings = Array.from(el.querySelectorAll('thead th'));
            for (const row of el.querySelectorAll('tbody tr')) {
                Array.from(row.children).forEach((cell, index) => {
                    if (cell.tagName === 'TD' && headings[index]) cell.setAttribute('data-mg-col', headings[index].textContent.trim());
                });
            }
            return;
        }
        if (!el.matches(selector)) return;
        el.classList.add('mg-overview-profit');
        for (const node of Array.from(el.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const match = node.textContent.match(decoration);
            if (!match || !match[0].trim()) continue;
            const span = document.createElement('span');
            span.className = 'mg-overview-original-decor';
            span.textContent = match[0];
            node.before(span);
            node.textContent = node.textContent.slice(match[0].length);
        }
    }
    function scan(node) {
        if (!(node instanceof HTMLElement) || !root.contains(node)) return;
        decorate(node);
        node.querySelectorAll(selector + ',.acc-tabella').forEach(decorate);
    }
    scan(root);
    new MutationObserver(records => {
        // A row may be appended to an already existing table.
        root.querySelectorAll('.acc-tabella').forEach(decorate);
        for (const record of records) {
            if (record.type === 'characterData') decorate(record.target.parentElement);
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.TEXT_NODE) decorate(node.parentElement);
                else if (!node.classList?.contains('mg-overview-original-decor')) scan(node);
            }
        }
    }).observe(root, {childList: true, characterData: true, subtree: true});
})();
