/* Presentation only. Original controls, state and data are never rewritten. */
(() => {
    'use strict';
    if (!document.body.classList.contains('mg-ios')) return;
    const roots = '#gpo-mapping-page,#custom-components-page,#standard-configs-page,#message-templates-container,#inventory-container,#settings-container,#suppliers-container,#finalized-container,#hidden-container';
    const icons = ['desktop','chat-circle','credit-card','gear-six','arrows-clockwise','check-circle','cube'];
    const decoration=/^[\s]*(?:[\p{Extended_Pictographic}\uFE0F\u200D])+\s*/u;
    function decorate(el) {
        if (!(el instanceof HTMLElement) || !el.closest(roots)) return;
        // State headings keep their existing meaning and palette.
        if (el.closest('.order-card.mg-stato .card-header')) return;
        const s = el.style;
        if (/^(white|#fff|rgb\(255, 255, 255\))$/i.test(s.color)) el.classList.add('mg-secondary-ink');
        if (/^rgba\(255, 255, 255,/.test(s.color)) el.classList.add('mg-secondary-muted');
        if (!el.matches('button,input,select,textarea,#template-priority-popup') && /rgba?\((0, 0, 0|10, 10, 10|20, 20, 20|8, 14, 24)/.test(s.background)) el.classList.add('mg-secondary-surface');
        if (el.matches('button') && /^(?:✕|×|❌)$/.test(el.textContent.trim())) el.classList.add('mg-secondary-close-symbol');
        if (el.matches('button,h2,h3')) for (const node of Array.from(el.childNodes)) {
            if (node.nodeType!==Node.TEXT_NODE) continue;
            const match=node.textContent.match(decoration);if(!match||!match[0].trim())continue;
            const symbol=match[0];
            const icon=symbol.includes('🗑')?'trash':symbol.includes('✏')?'pencil-simple':symbol.includes('📦')?'cube':symbol.includes('📋')?'receipt':symbol.includes('➕')?'plus':symbol.includes('⚙')?'gear-six':symbol.includes('✓')?'check':'arrows-clockwise';
            el.classList.add('mg-secondary-icon');el.style.setProperty('--mg-secondary-icon',`url("../icons/${icon}.svg")`);
            const span=document.createElement('span');span.className='mg-secondary-original-decor';span.textContent=symbol;node.before(span);node.textContent=node.textContent.slice(symbol.length);
        }
        if (el.matches('.settings-icon')) {
            const index = Array.from(el.closest('#settings-container').querySelectorAll('.settings-icon')).indexOf(el);
            if (icons[index]) el.style.setProperty('--mg-setting-icon',`url("../icons/${icons[index]}.svg")`);
        }
        if (el.matches('.inventory-table')) {
            const headers=Array.from(el.querySelectorAll('thead th'));
            for (const row of el.querySelectorAll('tbody tr')) Array.from(row.children).forEach((cell,index)=>{
                if (cell.tagName==='TD' && headers[index]) cell.setAttribute('data-mg-col',headers[index].textContent.trim());
            });
        }
    }
    function scan(node) {
        if (!(node instanceof HTMLElement)) return;
        decorate(node);node.querySelectorAll('[style],button,h2,h3,.inventory-table,.settings-icon').forEach(decorate);
    }
    for (const root of document.querySelectorAll(roots)) {
        scan(root);
        new MutationObserver(records=>{
            root.querySelectorAll('.inventory-table').forEach(decorate);
            for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) scan(node);
        }).observe(root,{childList:true,subtree:true});
    }
})();
