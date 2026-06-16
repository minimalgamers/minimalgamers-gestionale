// ============================================================
// category-summary.js (v1)
// Vista alternativa del Riepilogo: raggruppa i componenti PER TIPOLOGIA
// (CPU, GPU, MOBO, CASE, ...) invece che per fornitore.
// NON modifica supplier-summary.js: riusa i dati gia' calcolati in
// window.currentSupplierData e aggiunge solo un toggle + un render alternativo.
// ============================================================
(function () {
    'use strict';

    // ordine preferito delle categorie (quelle non elencate vanno in fondo, alfabetiche)
    const TYPE_ORDER = [
        'CPU', 'GPU', 'MOBO', 'RAM', 'SSD', 'SSD ADDON', 'HDD', 'PSU',
        'COOLER', 'CASE', 'MONITOR', 'KIT GAMING'
    ];

    // colore per categoria (riusa la palette del tool)
    function typeColor(type) {
        const t = String(type || '').toUpperCase();
        const map = {
            'CPU': '#3498db', 'GPU': '#9b59b6', 'MOBO': '#e67e22', 'RAM': '#f39c12',
            'SSD': '#1abc9c', 'SSD ADDON': '#16a085', 'HDD': '#16a085', 'PSU': '#e74c3c',
            'COOLER': '#2980b9', 'CASE': '#2ecc71', 'MONITOR': '#8e44ad', 'KIT GAMING': '#d35400'
        };
        return map[t] || '#95a5a6';
    }

    // Ri-aggrega i dati per tipologia a partire da window.currentSupplierData
    // Struttura di partenza: { supplier: { key: {componentType, ean, name, count, orders, supplier} } }
    // Struttura risultato:   { TYPE: { key: {componentType, ean, name, count, orders, supplier} } }
    function buildCategoryData(supplierData) {
        const byType = {};
        for (const supplier of Object.keys(supplierData || {})) {
            const items = supplierData[supplier] || {};
            for (const item of Object.values(items)) {
                const type = String(item.componentType || 'ALTRO').toUpperCase();
                // chiave di fusione: stesso ean + stesso nome + stesso fornitore = stessa riga
                const ean = item.ean || '';
                const name = item.name || '';
                const sup = item.supplier || supplier || '';
                const key = `${ean}|${name}|${sup}`;
                if (!byType[type]) byType[type] = {};
                if (!byType[type][key]) {
                    byType[type][key] = {
                        componentType: type,
                        ean: ean,
                        name: name,
                        supplier: sup,
                        count: 0,
                        orders: []
                    };
                }
                byType[type][key].count += (item.count || 0);
                for (const o of (item.orders || [])) {
                    if (!byType[type][key].orders.includes(o)) byType[type][key].orders.push(o);
                }
            }
        }
        return byType;
    }

    function sortedTypes(byType) {
        return Object.keys(byType).sort((a, b) => {
            const ia = TYPE_ORDER.indexOf(a);
            const ib = TYPE_ORDER.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
    }

    // Disegna la griglia per categoria dentro #suppliers-grid
    function renderByCategory(supplierData) {
        const grid = document.getElementById('suppliers-grid');
        if (!grid) return;

        const byType = buildCategoryData(supplierData);
        const types = sortedTypes(byType);

        if (types.length === 0) {
            grid.innerHTML = `
                <div class="suppliers-empty-state">
                    <h2>📦 Nessun Componente</h2>
                    <p>Non ci sono ordini elaborati al momento.</p>
                </div>`;
            return;
        }

        let html = '';
        for (const type of types) {
            const items = byType[type];
            const itemsArray = Object.values(items);
            const totalItems = itemsArray.reduce((s, it) => s + it.count, 0);
            const color = typeColor(type);
            const headerClass = String(type).replace(/\s+/g, '-').toUpperCase();

            html += `
            <div class="supplier-card">
                <div class="supplier-header ${headerClass}" style="background: ${color};">
                    <span>${type}</span>
                    <span class="supplier-count">${totalItems} pz</span>
                </div>
                <div class="supplier-items-list">`;

            // ordino per quantita' decrescente, poi per nome
            const sortedItems = itemsArray.sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return String(a.name || a.ean).localeCompare(String(b.name || b.ean));
            });

            for (const item of sortedItems) {
                const ordersArray = item.orders || [];
                const ordersText = ordersArray.length ? `Usato in: ${ordersArray.map(o => '#' + o).join(', ')}` : '';
                const displayName = item.name || 'Nome non disponibile';
                const supLabel = item.supplier ? `<span style="opacity:0.7; font-size:0.8em; margin-left:6px;">[${item.supplier}]</span>` : '';

                html += `
                <div class="supplier-item" data-quantity="${item.count}" data-ean="${item.ean}" data-name="${displayName}" data-orders="${ordersArray.join(',')}">
                    <div class="supplier-item-header">
                        <span class="supplier-item-quantity" style="background: ${color}; box-shadow: 0 2px 8px ${color}40;">x${item.count}</span>
                        <div class="supplier-item-type" style="color: ${color}; text-shadow: 0 1px 4px ${color}40;">${item.ean || '-'}</div>
                        <div class="supplier-item-ean" title="${ordersText}" style="cursor: ${ordersArray.length ? 'help' : 'default'}; position: relative;">
                            ${ordersArray.length ? `<span class="orders-badge" style="margin-left:6px; background: rgba(52,152,219,0.3); color:#3498db; font-size:0.7em; padding:2px 5px; border-radius:4px; font-weight:600;">${ordersArray.map(o => '#' + o).join(' ')}</span>` : ''}
                        </div>
                    </div>
                    <div class="supplier-item-name" style="color: rgba(255,255,255,0.95); font-size:0.9em; font-weight:500; line-height:1.4; width:100%; margin-top:4px;">${displayName}${supLabel}</div>
                </div>`;
            }

            html += `
                </div>
                <div class="supplier-card-footer">
                    <button class="copy-category-btn" data-type="${type}" style="width:100%; background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3); color:white; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600; transition:all 0.3s ease; font-size:0.9em;" onmouseover="this.style.background='rgba(255,255,255,0.25)'; this.style.transform='translateY(-2px)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'; this.style.transform=''">📋 Copia ${type}</button>
                </div>
            </div>`;
        }

        grid.innerHTML = html;

        // copia per categoria
        grid.querySelectorAll('.copy-category-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const card = btn.closest('.supplier-card');
                const items = card.querySelectorAll('.supplier-item');
                let txt = '';
                items.forEach(it => {
                    txt += `x${it.dataset.quantity} | ${it.dataset.ean} - ${it.dataset.name}\n`;
                });
                navigator.clipboard.writeText(txt.trim())
                    .then(() => window.showNotification && window.showNotification('✅ Dati copiati in clipboard'))
                    .catch(() => window.showNotification && window.showNotification('❌ Errore durante la copia'));
            });
        });
    }

    // Inserisce il toggle "Per fornitore / Per categoria" sopra la griglia
    function ensureToggle() {
        if (document.getElementById('summary-view-toggle')) return;
        const grid = document.getElementById('suppliers-grid');
        if (!grid) return;

        const wrap = document.createElement('div');
        wrap.id = 'summary-view-toggle';
        wrap.style.cssText = 'display:flex; gap:8px; justify-content:center; margin:0 0 16px 0;';

        const mkBtn = (label, mode) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.dataset.mode = mode;
            b.style.cssText = 'padding:8px 18px; border-radius:8px; border:1px solid rgba(255,255,255,0.3); background:rgba(255,255,255,0.12); color:white; cursor:pointer; font-weight:600; font-size:0.9em; transition:all 0.2s ease;';
            b.addEventListener('click', () => setView(mode));
            return b;
        };

        wrap.appendChild(mkBtn('Per fornitore', 'supplier'));
        wrap.appendChild(mkBtn('Per categoria', 'category'));
        grid.parentNode.insertBefore(wrap, grid);
        highlight('supplier');
    }

    function highlight(mode) {
        const wrap = document.getElementById('summary-view-toggle');
        if (!wrap) return;
        wrap.querySelectorAll('button').forEach(b => {
            const active = b.dataset.mode === mode;
            b.style.background = active ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.12)';
            b.style.boxShadow = active ? '0 2px 10px rgba(255,255,255,0.25)' : 'none';
        });
    }

    // snapshot dell'HTML "per fornitore" cosi' posso ripristinarlo senza ricalcolare
    function snapshotSupplierHTML() {
        const grid = document.getElementById('suppliers-grid');
        if (grid && grid.innerHTML && window.__summaryView !== 'category') {
            window.__supplierHTMLSnapshot = grid.innerHTML;
        }
    }

    function setView(mode) {
        window.__summaryView = mode;
        highlight(mode);
        const data = window.currentSupplierData;
        if (mode === 'category') {
            if (!data) return;
            window.__catRendering = true;
            renderByCategory(data);
            setTimeout(() => { window.__catRendering = false; }, 50);
        } else {
            const grid = document.getElementById('suppliers-grid');
            if (grid && window.__supplierHTMLSnapshot) {
                window.__catRendering = true;
                grid.innerHTML = window.__supplierHTMLSnapshot;
                rebindSupplierCopy(grid);
                setTimeout(() => { window.__catRendering = false; }, 50);
            }
        }
    }

    // ricollega i bottoni "Copia" della vista per fornitore dopo un ripristino da snapshot
    function rebindSupplierCopy(grid) {
        grid.querySelectorAll('.copy-supplier-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const card = btn.closest('.supplier-card');
                const items = card.querySelectorAll('.supplier-item');
                let txt = '';
                items.forEach(it => { txt += `x${it.dataset.quantity} | ${it.dataset.ean} - ${it.dataset.name}\n`; });
                navigator.clipboard.writeText(txt.trim())
                    .then(() => window.showNotification && window.showNotification('✅ Dati copiati in clipboard'))
                    .catch(() => {});
            });
        });
    }

    // Osservo la griglia: quando supplier-summary la ridisegna (nuovo riepilogo),
    // assicuro il toggle e, se l'utente era in "categoria", riapplico la vista.
    function watchGrid() {
        const grid = document.getElementById('suppliers-grid');
        if (!grid || grid.__catWatched) return;
        grid.__catWatched = true;
        const obs = new MutationObserver(() => {
            if (window.__catRendering) return; // ignoro le mie stesse modifiche
            ensureToggle();
            if (window.__summaryView === 'category' && window.currentSupplierData) {
                window.__catRendering = true;
                renderByCategory(window.currentSupplierData);
                highlight('category');
                setTimeout(() => { window.__catRendering = false; }, 50);
            } else {
                snapshotSupplierHTML();
                highlight('supplier');
            }
        });
        obs.observe(grid, { childList: true });
    }

    function boot() {
        ensureToggle();
        snapshotSupplierHTML();
        watchGrid();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    // ritento per qualche secondo nel caso la sezione fornitori compaia dopo
    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        if (document.getElementById('suppliers-grid')) boot();
        if (tries > 40) clearInterval(timer);
    }, 250);
})();
