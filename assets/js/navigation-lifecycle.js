/* One navigation boundary for transient UI. Never clicks a save/confirm action. */
(function () {
    'use strict';
    const pages = ['gpo-mapping-page','custom-components-page','standard-configs-page','settings-popup'];
    const fixed = ['payment-popup','component-search-popup','add-custom-item-popup','bulk-replace-popup',
        'supplier-select-popup','add-manual-order-popup','finalize-all-popup','template-priority-popup'];
    const dynamic = ['bulk-replace-supplier-popup','bulk-replace-confirm-popup','delete-config-popup',
        'add-component-popup','remove-component-password-popup','config-supplier-popup','add-config-popup',
        'manual-entry-inline-popup','edit-gpo-mapping-popup','edit-custom-component-popup'];
    const shades = ['payment-popup-overlay','component-search-overlay','add-custom-item-overlay','bulk-replace-overlay',
        'supplier-select-overlay','add-manual-order-overlay','finalize-all-overlay','delete-config-overlay',
        'add-component-overlay','remove-component-password-overlay','add-config-overlay'];
    const floating = '.acc-finestra,.search-component-popup-gpo,[data-mg-transient]';
    const suggestions = '.config-suggestions,#gpo-ean-search-results,#edit-gpo-ean-search-results,#manual-search-results,#editor-search-results,#inventory-search-results';
    const cancel = '[data-no],[data-annulla],[data-mg-cancel],button[id^="cancel-"],button[id^="close-"],#template-priority-close';
    let epoch = 0;
    const doc = typeof document === 'undefined' ? null : document;
    const byId = id => doc?.getElementById(id);
    const visible = el => !!el?.isConnected && !el.hidden && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const allDialogs = () => [...fixed,...dynamic].map(byId).filter(Boolean).concat([...doc.querySelectorAll(floating)]);
    function dismiss(el) {
        if (!el) return;
        const button = el.querySelector(cancel);
        if (button && !button.disabled) button.click(); // resolves a waiting confirmation with cancellation
        if (fixed.includes(el.id)) el.style.display = 'none';
        else el.remove();
    }
    function transient() {
        for (const el of new Set(allDialogs())) dismiss(el);
        for (const id of shades) {
            const el = byId(id); if (!el) continue;
            if (['delete-config-overlay','add-component-overlay','remove-component-password-overlay','add-config-overlay'].includes(id)) el.remove();
            else el.style.display = 'none';
        }
        doc.querySelectorAll(suggestions).forEach(el => { el.style.display = 'none'; });
        const search = byId('search-bar'); if (search) search.style.display = 'none';
    }
    function closePages() {
        pages.map(byId).filter(Boolean).forEach(el => { el.style.display = 'none'; });
        doc.body.classList.remove('no-scroll');
        window.MGOrderGlass?.sync();
    }
    function begin(withPages = false) {
        epoch++;
        if (doc) {
            window.dispatchEvent(new Event('mg:navigate'));
            transient(); if (withPages) closePages();
        }
        return epoch;
    }
    const api = { begin, transient, closePages, current: () => epoch, valid: ticket => ticket === epoch,
        pages, fixed, dynamic, shades };
    if (typeof window !== 'undefined') window.MGNavigation = api;
    if (!doc) return;

    const routes = '.tab-button,#gpo-mapping-btn,#custom-components-btn,#standard-configs-btn,#close-gpo-mapping,#close-custom-components,#close-standard-configs,#settings-btn,#message-templates-btn,#export-btn,[data-glass-order]';
    doc.addEventListener('click', e => {
        const route = e.target.closest?.(routes);
        if (route) begin(route.matches('.tab-button'));
    }, true);

    const lastFocus = new WeakMap();
    const opened = new WeakSet();
    const topDialog = () => [...new Set(allDialogs())].filter(visible).sort((a,b) =>
        (Number(getComputedStyle(a).zIndex)||0)-(Number(getComputedStyle(b).zIndex)||0)).pop();
    doc.addEventListener('keydown', e => {
        const dialog = topDialog();
        if (e.key === 'Escape') {
            if (dialog) {
                epoch++;
                e.preventDefault(); e.stopPropagation(); const focus = lastFocus.get(dialog); dismiss(dialog);
                for (const id of [dialog.id.replace(/-popup$/, '-overlay'),dialog.id+'-overlay']) {
                    const shade = byId(id); if (shade && shade !== dialog) shade.style.display = 'none';
                }
                if (visible(focus)) focus.focus({preventScroll:true});
            } else if (pages.map(byId).some(visible)) { e.preventDefault(); begin(true); }
            else transient();
        }
        if (e.key !== 'Tab' || !dialog) return;
        const controls = [...dialog.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')]
            .filter(el => visible(el) && !el.disabled && el.tabIndex >= 0);
        const first = controls[0], last = controls.at(-1);
        if (!first) { e.preventDefault(); dialog.focus(); return; }
        if (!dialog.contains(doc.activeElement) || (!e.shiftKey && doc.activeElement === last)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    }, true);
    function decorate() {
        for (const el of new Set(allDialogs())) {
            if (el.dataset.mgTransient === 'order-custom-item') el.firstElementChild?.classList.add('mg-managed-dialog-content');
            else if (el.id !== 'template-priority-popup' && !el.classList.contains('acc-finestra')) el.classList.add('mg-managed-dialog');
            if (!visible(el)) { opened.delete(el); continue; }
            if (!el.hasAttribute('role')) el.setAttribute('role','dialog');
            if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal','true');
            if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby'))
                el.setAttribute('aria-label',el.querySelector('h2,h3,h4')?.textContent.trim() || 'Finestra del gestionale');
            if (!opened.has(el)) { opened.add(el); lastFocus.set(el,doc.activeElement); }
        }
    }
    // Ignore our own role/class decoration. Observe only dialog visibility/discovery, not order text changes.
    let queued = false;
    new MutationObserver(records => {
        if (!records.some(r => r.type === 'childList' && [...r.addedNodes,...r.removedNodes].some(n => n.nodeType===1 &&
            (n.matches?.(floating+',.mg-managed-dialog') || [...fixed,...dynamic].includes(n.id))) ||
            r.type === 'attributes' && (fixed.includes(r.target.id) || dynamic.includes(r.target.id) || r.target.matches(floating)))) return;
        if (!queued) { queued = true; queueMicrotask(() => { queued = false; decorate(); }); }
    }).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','hidden']});
    decorate();
})();
