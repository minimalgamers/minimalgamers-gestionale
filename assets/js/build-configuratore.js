// ============================================================
// PC DEL CONFIGURATORE E COLORI DELLE LINEE (Antonio 03/10/2026)
// ------------------------------------------------------------
// «Gli ordini dei PC del configuratore non hanno una pagina nel gestionale... VA ASSOLUTAMENTE RISOLTO.
//  [...] sia nella sezione ORDINI, sia nella relativa scrivania in cui li buttiamo gli diamo un colore diverso
//  cosi sono riconoscibili. Le BUILD MSI le facciamo rosse, le DeepCool CYAN e quelle del configuratore con un
//  tag ben visibile.»
//
// * Un PC del configuratore si riconosce dallo SKU della sua riga d'ordine («MG-CFG-<id prodotto>», messo dal
//   configuratore dal 03/10) oppure perche' i listini lo portano nei dati cifrati (dati.configuratore).
// * Segue lo stesso percorso degli altri: compare in «Ordini» e si manda a mano in una scrivania E1–E4.
// * La scheda si fa con la lista dei pezzi che il configuratore ha salvato sul prodotto quando e' nato il PC:
//   per ogni pezzo lo STESSO prodotto scelto dal cliente, dal fornitore piu' conveniente di oggi con le regole
//   delle build Minimal (pagina Automatico), con codice, nome e fornitore; la grafica integrata ha la sua riga.
// * Niente regole delle distinte (alimentatore, case Minimal, mappature GPO): il cliente ha scelto ogni pezzo.
// ============================================================
(function () {
    'use strict';

    const SKU = 'MG-CFG-';
    const PREFISSO_CONFIG = 'CONFIGURATORE';
    const STILE_ID = 'mg-linee-stile';

    const LINEE = {
        MSI: { classe: 'mg-linea-msi', etichetta: 'MSI', titolo: 'Build MSI' },
        DEEPCOOL: { classe: 'mg-linea-deepcool', etichetta: 'DEEPCOOL', titolo: 'Build DeepCool' },
        CONFIGURATORE: { classe: 'mg-linea-configuratore', etichetta: '🧩 BUILD CONFIGURATORE',
            titolo: 'PC creato dal cliente nel configuratore: ogni pezzo e\' quello che ha scelto lui' }
    };

    const testo = (x) => String(x == null ? '' : x);
    const esc = (s) => testo(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function stile() {
        if (typeof document === 'undefined' || !document.head || document.getElementById(STILE_ID)) return;
        const s = document.createElement('style');
        s.id = STILE_ID;
        s.textContent = [
            // anello colorato attorno alla card, in Ordini, nelle scrivanie e nei finalizzati
            '.order-card.mg-linea-msi{box-shadow:0 0 0 3px #dc2626,0 4px 30px rgba(0,0,0,.15)!important}',
            '.order-card.mg-linea-deepcool{box-shadow:0 0 0 3px #06b6d4,0 4px 30px rgba(0,0,0,.15)!important}',
            '.order-card.mg-linea-configuratore{box-shadow:0 0 0 3px #8b5cf6,0 4px 30px rgba(0,0,0,.15)!important}',
            // intestazione del colore della linea (non nei finalizzati, che hanno i colori dello stato)
            '.order-card.mg-linea-msi:not(.mg-stato) .card-header{background:linear-gradient(135deg,#7f1d1d,#dc2626)!important}',
            '.order-card.mg-linea-deepcool:not(.mg-stato) .card-header{background:linear-gradient(135deg,#155e75,#06b6d4)!important}',
            '.order-card.mg-linea-configuratore:not(.mg-stato) .card-header{background:linear-gradient(135deg,#4c1d95,#8b5cf6)!important}',
            '.mg-tag-linea{display:inline-block;margin-left:8px;padding:3px 9px;border-radius:999px;font-size:.72em;font-weight:800;',
            'letter-spacing:.4px;color:#fff;vertical-align:middle;white-space:nowrap;border:1px solid rgba(255,255,255,.55)}',
            '.mg-tag-linea.msi{background:#dc2626}.mg-tag-linea.deepcool{background:#0891b2}',
            '.mg-tag-linea.configuratore{background:#7c3aed;font-size:.8em;padding:4px 11px;box-shadow:0 0 0 2px rgba(255,255,255,.25)}',
            '.config-badge.mg-badge-configuratore{background:#7c3aed!important;border-color:#c4b5fd!important;color:#fff!important}',
            '.mg-nota-configuratore{margin:6px 0 0;font-size:.82em;color:#6d28d9;font-weight:600}',
            // pagina Automatico: titolo del PC con il colore della linea
            '.acc-pc-titolo.mg-titolo-msi{border-left:4px solid #dc2626;padding-left:8px}',
            '.acc-pc-titolo.mg-titolo-deepcool{border-left:4px solid #06b6d4;padding-left:8px}',
            '.acc-pc-titolo.mg-titolo-configuratore{border-left:4px solid #8b5cf6;padding-left:8px}',
            '.order-card-processed .mg-nota-configuratore{color:#ddd6fe}'
        ].join('');
        document.head.appendChild(s);
    }

    function dati() {
        const A = typeof window !== 'undefined' ? window.AccoppiamentoAuto : null;
        return A && A.stato ? A.stato.dati : null;
    }

    async function caricaDati() {
        const A = typeof window !== 'undefined' ? window.AccoppiamentoAuto : null;
        if (!A || typeof A.carica !== 'function') return null;
        try { return await A.carica(); } catch (e) { return null; }
    }

    const idProdotto = (item) => testo(item && (item.product_id ?? item.productId)).replace(/^gid:\/\/shopify\/Product\//, '');

    // Riga d'ordine di un PC del configuratore? (lo SKU basta; senza SKU servono i dati dei listini)
    function eConfiguratore(item, d) {
        if (!item) return false;
        if (testo(item.sku).toUpperCase().startsWith(SKU)) return true;
        const pid = idProdotto(item);
        const elenco = (d || dati() || {}).configuratore;
        return !!(pid && Array.isArray(elenco) && elenco.map(String).includes(pid));
    }

    function eConfigConfiguratore(configKey) {
        return testo(configKey).trim().toUpperCase().startsWith(PREFISSO_CONFIG);
    }

    function lineaDaConfig(configKey) {
        const k = testo(configKey).trim().toUpperCase();
        if (!k) return null;
        if (eConfigConfiguratore(k)) return 'CONFIGURATORE';
        if (/^MSI\b/.test(k)) return 'MSI';
        if (/\bDEEPCOOL\b/.test(k)) return 'DEEPCOOL';
        return 'MINIMAL';
    }

    // Ordine Shopify completo (con product_id e SKU delle righe) dalla sessione
    function ordineShopify(orderId) {
        const base = testo(orderId).split('.')[0];
        try {
            const ordini = JSON.parse(sessionStorage.getItem('shopify_orders') || '[]') || [];
            return ordini.find(o => testo(o.id) === base) || null;
        } catch (e) {
            return null;
        }
    }

    const ePc = (li) => {
        const nome = testo(li && (li.name || li.title)).toUpperCase();
        if (testo(li && li.sku).toUpperCase().startsWith(SKU)) return true;
        if (nome.includes('PC GAMING')) return true;
        return typeof identifyPCConfig === 'function' && identifyPCConfig(li.name || li.title || '', true, li.product_id ?? li.productId) !== null;
    };

    // Riga del PC di questa card: per gli ordini sdoppiati (123.2) quella con lo stesso nome
    function rigaPcDellOrdine(order) {
        const full = ordineShopify(order && (order.originalOrderId || order.id));
        const righe = ((full && full.line_items) || []).filter(ePc);
        if (!righe.length) return null;
        const nome = testo(order && order.items && order.items[0] && order.items[0].name).trim();
        if (testo(order && order.id).includes('.') && nome) return righe.find(li => testo(li.name || li.title).trim() === nome) || righe[0];
        return righe[0];
    }

    function lineaDellaRiga(li, d) {
        if (!li) return null;
        if (eConfiguratore(li, d)) return 'CONFIGURATORE';
        const cfg = typeof identifyPCConfig === 'function' ? identifyPCConfig(li.name || li.title || '', true, li.product_id ?? li.productId) : null;
        return cfg ? lineaDaConfig(cfg.configKey) : null;
    }

    function applicaLinea(card, linea, opzioni) {
        const def = LINEE[linea];
        if (!card || !def) return;
        stile();
        Object.values(LINEE).forEach(x => card.classList.remove(x.classe));
        card.classList.add(def.classe);
        card.dataset.linea = linea;
        if (opzioni && opzioni.stato) card.classList.add('mg-stato');
        const titoli = card.querySelectorAll('.card-header h2');
        titoli.forEach(h2 => {
            if (h2.querySelector('.mg-tag-linea')) return;
            const tag = document.createElement('span');
            tag.className = `mg-tag-linea ${linea.toLowerCase()}`;
            tag.textContent = def.etichetta;
            tag.title = def.titolo;
            h2.appendChild(tag);
        });
    }

    // Card della pagina «Ordini» (e Finalizzati / Nascosti): colore della linea del PC dell'ordine
    async function decoraOrdine(card, order, containerId) {
        try {
            const stato = containerId === 'finalized-container' || containerId === 'hidden-container';
            const li = rigaPcDellOrdine(order);
            if (!li) return null;
            let linea = lineaDellaRiga(li, null);
            if (!linea || linea === 'MINIMAL') {
                // PC senza SKU (creati prima del 03/10): i dati dei listini dicono se viene dal configuratore
                const d = await caricaDati();
                if (d && eConfiguratore(li, d)) linea = 'CONFIGURATORE';
            }
            if (linea && linea !== 'MINIMAL') applicaLinea(card, linea, { stato });
            if (linea === 'CONFIGURATORE' && !stato && !card.querySelector('.mg-nota-configuratore')) {
                const corpo = card.querySelector('.card-body');
                if (corpo) {
                    const nota = document.createElement('div');
                    nota.className = 'mg-nota-configuratore';
                    nota.textContent = 'PC del configuratore: con E1–E4 la scheda si riempie con i pezzi scelti dal cliente.';
                    corpo.appendChild(nota);
                }
            }
            return linea;
        } catch (e) {
            console.warn('[CONFIGURATORE] colore card', e);
            return null;
        }
    }

    // Card di una scrivania E1–E4: la linea si legge dalla build salvata
    function decoraScrivania(card, order, configKey) {
        try {
            const linea = lineaDaConfig(configKey || (order && order.configName));
            if (!linea || linea === 'MINIMAL') return linea;
            applicaLinea(card, linea);
            if (linea === 'CONFIGURATORE') {
                const badge = card.querySelector('.config-badge');
                if (badge) {
                    const nome = testo(configKey || order.configName).replace(/^CONFIGURATORE\s*/i, '').trim();
                    badge.classList.add('mg-badge-configuratore');
                    badge.textContent = nome ? `PC ${nome}` : 'PC personalizzato';
                    badge.title = LINEE.CONFIGURATORE.titolo;
                }
            }
            return linea;
        } catch (e) {
            console.warn('[CONFIGURATORE] colore scrivania', e);
            return null;
        }
    }

    // PC dei dati dei listini per questa riga d'ordine (stesso prodotto)
    function pcDellaRiga(d, orderId, item) {
        const base = testo(orderId).split('.')[0];
        const o = d && d.ordini ? d.ordini[base] : null;
        if (!o || !Array.isArray(o.pc)) return null;
        const pid = idProdotto(item);
        const conf = o.pc.filter(pc => pc && pc.configuratore);
        return conf.find(pc => testo(pc.product_id) === pid) || (conf.length === 1 && !pid ? conf[0] : null);
    }

    function componentiDaPc(pc) {
        return (pc.pezzi || []).map(p => {
            const m = p.manuale || {};
            const a = p.auto || null;
            const integrata = String(p.tipo).toUpperCase() === 'GPU' && testo(m.codice).toUpperCase() === 'INTEGRATA';
            const quantita = Math.max(1, parseInt((a && a.quantita) || m.quantita, 10) || 1);
            if (integrata) {
                return { type: 'GPU', ean: 'INTEGRATA', name: p.cliente || 'Grafica integrata del processore',
                    supplier: 'INTEGRATA', price: null, quantity: 1 };
            }
            return {
                type: p.tipo_gestionale || p.tipo,
                ean: a ? a.codice : (m.codice || ''),
                name: (a && a.descrizione) || m.descrizione || p.cliente || '',
                supplier: (a ? a.fornitore : m.fornitore) || null,
                price: null,
                quantity: quantita
            };
        }).filter(c => c.ean);
    }

    // Pezzi della scheda per un PC del configuratore.
    // null = non e' un PC del configuratore; { ok:false, errore } = lo e', ma la lista non e' ancora arrivata.
    async function componenti(orderId, item) {
        if (!item) return null;
        const sku = testo(item.sku).toUpperCase().startsWith(SKU);
        const d = await caricaDati();
        if (!sku && !eConfiguratore(item, d)) return null;
        const pc = pcDellaRiga(d, orderId, item);
        if (!pc) {
            return { ok: false, errore: 'PC del configuratore: la lista dei pezzi non è ancora arrivata dai listini ' +
                '(si aggiornano ogni 30 minuti). Riprova tra poco: la scheda si riempie da sola con i pezzi scelti dal cliente.' };
        }
        const components = componentiDaPc(pc);
        if (!components.length) return { ok: false, errore: 'PC del configuratore senza pezzi nella lista: controlla il prodotto su Shopify.' };
        const nome = testo(pc.nome_build || '').trim().toUpperCase();
        return { ok: true, configName: `${PREFISSO_CONFIG}${nome ? ' ' + nome : ''}`, components, pc };
    }

    const api = { SKU, PREFISSO_CONFIG, LINEE, eConfiguratore, eConfigConfiguratore, lineaDaConfig, lineaDellaRiga,
        rigaPcDellOrdine, applicaLinea, decoraOrdine, decoraScrivania, pcDellaRiga, componentiDaPc, componenti, stile };
    if (typeof window !== 'undefined') window.BuildConfiguratore = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
