/* Presentation only: bounded dialog surfaces. No events, network or app state. */
(() => {
    'use strict';
    if (!document.body.classList.contains('mg-ios')) return;
    const roots = '#payment-popup,#component-search-popup,#add-custom-item-popup,#bulk-replace-popup,#supplier-select-popup,#add-manual-order-popup,#finalize-all-popup,#template-priority-popup,.acc-finestra';
    const seen = new WeakSet();
    function decorate(el) {
        if (!(el instanceof HTMLElement) || !el.closest(roots)) return;
        const s = el.style;
        if (/^(white|#fff|rgb\(255, 255, 255\))$/i.test(s.color)) el.classList.add('mg-modal-ink');
        if (/^rgba\(255, 255, 255,/.test(s.color)) el.classList.add('mg-modal-muted');
        if (!el.matches('button,input,select,textarea,#template-priority-popup') && /rgba?\((0, 0, 0|30, 30, 30|8, 14, 24)/.test(s.background)) el.classList.add('mg-modal-surface');
        if (el.matches('button') && /^(?:✕|×|❌)$/.test(el.textContent.trim())) {
            el.classList.add('mg-modal-close-icon');
        }
    }
    function scan(node) {
        if (!(node instanceof HTMLElement)) return;
        decorate(node);node.querySelectorAll('[style],button').forEach(decorate);
    }
    function attach(root) {
        if (seen.has(root)) return;seen.add(root);scan(root);
        new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) scan(node);
        }).observe(root,{childList:true,subtree:true});
    }
    document.querySelectorAll(roots).forEach(attach);
    // Only discover dialogs appended to the body; never scan an order card.
    new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches(roots)) attach(node);
            node.querySelectorAll(roots).forEach(attach);
        }
    }).observe(document.body,{childList:true});
})();
