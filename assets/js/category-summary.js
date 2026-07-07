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
    // colore case da testo (e nomi HYTE tipo "Pitch Black")
    function colorFromText(s) {
        const u = String(s || '').toUpperCase();
        if (/\b(WHITE|BIANCO|BIANCA|SNOW)\b/.test(u)) return 'WHITE';
        if (/\b(BLACK|NERO|NERA|PITCH)\b/.test(u)) return 'BLACK';
        return '';
    }

    // case con EAN alfanumerico che a volte non si risolvono a schermo
    const CASE_EAN_COLOR = {
        'GEHY-037': 'BLACK', // Hyte Y70 Pitch Black
        'GEHY-034': 'WHITE', // Hyte Y70 Snow White
        'GELI-975': 'BLACK', // Lian Li Vector V100 Black
        'GELI-976': 'WHITE'  // Lian Li Vector V100 White
    };

    // Mappa orderId -> colore del case, letta direttamente dai display CASE nel DOM.
    // Indipendente dal timing di normalizzazione delle card.
    function buildCaseColorMap() {
        const map = {};
        document.querySelectorAll('.component-name-display').forEach(d => {
            if (String(d.dataset.componentType || '').toUpperCase() !== 'CASE') return;
            const oid = d.dataset.orderId;
            if (!oid) return;
            const ean = d.dataset.ean || d.dataset.originalValue || '';
            const col = colorFromText(d.textContent) || colorFromText(ean) || CASE_EAN_COLOR[String(ean).toUpperCase()] || '';
            if (col) map[oid] = col;
        });
        return map;
    }

    function buildCategoryData(supplierData) {
        const byType = {};
        const norm = (typeof window.normalizeDisplayName === 'function') ? window.normalizeDisplayName : null;
        const caseColorMap = buildCaseColorMap();

        // 1) GPU/MOBO: li leggo direttamente dal DOM, con il colore del case del
        //    rispettivo ordine (robusto: non dipende dai nomi già normalizzati).
        const genericFromDom = { GPU: true, MOBO: true };
        const domHandled = { GPU: 0, MOBO: 0 };
        document.querySelectorAll('.component-name-display').forEach(d => {
            const type = String(d.dataset.componentType || '').toUpperCase();
            if (!genericFromDom[type]) return;
            let name = String(d.textContent || '').trim();
            if (!name || name === 'Caricamento...') return;
            const ean = d.dataset.ean || d.dataset.originalValue || '';
            const oid = d.dataset.orderId || '';
            const caseColor = caseColorMap[oid] || '';
            // normalizzo (generico) + applico il colore del case
            if (norm) name = norm(type, name, caseColor);
            const key = `${type}|${String(name).trim().toUpperCase()}`;
            if (!byType[type]) byType[type] = {};
            if (!byType[type][key]) {
                byType[type][key] = { componentType: type, ean, name, supplier: '', count: 0, orders: [] };
            }
            byType[type][key].count += 1;
            const ordNum = oid; // qui non ho il numero #, uso orderId
            domHandled[type]++;
        });

        // 2) tutti gli altri tipi (e GPU/MOBO se il DOM non ne ha) da supplierData
        for (const supplier of Object.keys(supplierData || {})) {
            const items = supplierData[supplier] || {};
            for (const item of Object.values(items)) {
                const type = String(item.componentType || 'ALTRO').toUpperCase();
                // se GPU/MOBO già gestiti dal DOM, salto
                if (genericFromDom[type] && domHandled[type] > 0) continue;
                const ean = item.ean || '';
                let name = item.name || '';
                const isGeneric = (type === 'GPU' || type === 'SSD' || type === 'MOBO' || type === 'RAM');
                if (norm && isGeneric) {
                    const looksRaw = /GEFORCE|RADEON|CRUCIAL|ASROCK|GIGABYTE|PALIT|PNY|INNO3D|POWERCOLOR|MSI |ASUS /i.test(name);
                    if (looksRaw) name = norm(type, name, '');
                }
                const key = isGeneric ? `${type}|${String(name).trim().toUpperCase()}` : `${ean}|${name}`;
                if (!byType[type]) byType[type] = {};
                if (!byType[type][key]) {
                    byType[type][key] = { componentType: type, ean, name, supplier: '', count: 0, orders: [] };
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

            // Raggruppo per NOME BASE (senza colore) così mostro le varianti
            // WHITE/BLACK come sotto-righe di uno stesso prodotto.
            const stripColor = (n) => String(n || '').replace(/\s*\b(WHITE|BLACK|BIANCO|NERO|BIANCA|NERA)\b\s*/ig, ' ').replace(/\s+/g, ' ').trim();
            const colorOf = (n) => {
                const u = String(n || '').toUpperCase();
                if (/\b(WHITE|BIANCO|BIANCA)\b/.test(u)) return 'WHITE';
                if (/\b(BLACK|NERO|NERA)\b/.test(u)) return 'BLACK';
                return '';
            };
            const bases = {};
            for (const item of sortedItems) {
                const base = stripColor(item.name || item.ean || '-');
                if (!bases[base]) bases[base] = { base, total: 0, ean: item.ean, variants: {}, orders: [] };
                bases[base].total += item.count;
                const col = colorOf(item.name);
                const ck = col || 'NEUTRO';
                if (!bases[base].variants[ck]) bases[base].variants[ck] = { color: col, count: 0, orders: [] };
                bases[base].variants[ck].count += item.count;
                for (const o of (item.orders || [])) {
                    if (!bases[base].variants[ck].orders.includes(o)) bases[base].variants[ck].orders.push(o);
                    if (!bases[base].orders.includes(o)) bases[base].orders.push(o);
                }
            }
            const basesArr = Object.values(bases).sort((a, b) => b.total - a.total);

            for (const b of basesArr) {
                const variantKeys = Object.keys(b.variants);
                const hasColors = variantKeys.some(k => k === 'WHITE' || k === 'BLACK');
                const copyName = b.base;
                // dettaglio colori per la copia (es. "WHITE x10 | BLACK x12")
                const colorDetail = ['WHITE','BLACK','NEUTRO']
                    .filter(k => b.variants[k])
                    .map(k => `${k === 'NEUTRO' ? 'N/A' : k} x${b.variants[k].count}`)
                    .join(' | ');

                html += `
                <div class="supplier-item" data-quantity="${b.total}" data-ean="${b.ean || ''}" data-name="${b.base}" data-colors="${colorDetail}" data-orders="${b.orders.join(',')}">
                    <div class="supplier-item-header">
                        <span class="supplier-item-quantity" style="background: ${color}; box-shadow: 0 2px 8px ${color}40;">x${b.total}</span>
                        <div class="supplier-item-name" style="color: rgba(255,255,255,0.97); font-size:0.98em; font-weight:600; flex:1; margin-left:8px;">${b.base}</div>
                    </div>`;

                if (hasColors) {
                    // sotto-righe per colore
                    const order = ['WHITE', 'BLACK', 'NEUTRO'];
                    const sortedVars = variantKeys.sort((x, y) => order.indexOf(x) - order.indexOf(y));
                    html += `<div style="margin-top:6px; padding-left:6px; display:flex; flex-direction:column; gap:4px;">`;
                    for (const vk of sortedVars) {
                        const v = b.variants[vk];
                        const isW = v.color === 'WHITE';
                        const isB = v.color === 'BLACK';
                        const dot = isW ? '#f5f5f5' : isB ? '#222' : '#888';
                        const label = isW ? 'WHITE' : isB ? 'BLACK' : 'Senza colore';
                        const border = isW ? 'border:1px solid #bbb;' : '';
                        html += `
                        <div style="display:flex; align-items:center; gap:8px; font-size:0.85em;">
                            <span style="width:14px; height:14px; border-radius:50%; background:${dot}; ${border} display:inline-block; flex-shrink:0;"></span>
                            <span style="color:rgba(255,255,255,0.85); min-width:90px;">${label}</span>
                            <span style="font-weight:700; color:${color};">x${v.count}</span>
                        </div>`;
                    }
                    html += `</div>`;
                }
                html += `</div>`;
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
                    txt += `x${it.dataset.quantity} | ${it.dataset.name}${it.dataset.colors ? ' (' + it.dataset.colors + ')' : ''}\n`;
                });
                navigator.clipboard.writeText(txt.trim())
                    .then(() => window.showNotification && window.showNotification('✅ Dati copiati in clipboard'))
                    .catch(() => window.showNotification && window.showNotification('❌ Errore durante la copia'));
            });
        });
    }

    // Toggle rimosso: ora la vista è SEMPRE per categoria (il fornitore non serve).
    function ensureToggle() {
        // non crea più bottoni; se ne esiste uno vecchio nel DOM, lo rimuovo
        const old = document.getElementById('summary-view-toggle');
        if (old) old.remove();
    }

    function highlight(mode) { /* no-op: toggle rimosso */ }

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
            // vista SEMPRE per categoria
            if (window.currentSupplierData) {
                window.__catRendering = true;
                renderByCategory(window.currentSupplierData);
                setTimeout(() => { window.__catRendering = false; }, 50);
            }
        });
        obs.observe(grid, { childList: true });
    }

    function boot() {
        ensureToggle();
        window.__summaryView = 'category';
        watchGrid();
        // primo render se i dati ci sono già
        if (window.currentSupplierData) {
            window.__catRendering = true;
            renderByCategory(window.currentSupplierData);
            setTimeout(() => { window.__catRendering = false; }, 50);
        }
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
