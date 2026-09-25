// ============================================================
// ACCOPPIAMENTO AUTOMATICO v1 (26/09/2026)
// ------------------------------------------------------------
// Accanto all'accoppiamento manuale (che resta com'e'), ogni ordine elaborato ha
// l'interruttore «Manuale / Automatico». In automatico ogni pezzo diventa quello che
// il motore dei listini ha scelto oggi (fornitori con le regole di GPU Watch, scelte
// del cliente sempre rispettate); ogni pezzo si puo' riportare al manuale con ↺.
// Sotto la build: prezzo di vendita, costo dei pezzi e utile (verde / rosso).
//
// I dati arrivano cifrati dal sito dei listini (accoppiamento.bin) e si aprono con la
// password del gestionale: i costi dei fornitori non stanno mai in chiaro.
// Il database resta sempre con il pezzo MANUALE: l'automatico cambia solo la vista,
// il riepilogo fornitori e le esportazioni.
// ============================================================
(function () {
    'use strict';

    const URL_DATI = 'https://minimal-gamers-listini.pages.dev/accoppiamento.bin';
    const IVA = 1.22;
    const COMMISSIONI = 0.045;
    const QUOTA_SRL = 0.70;
    const K_MODO = 'accoppiamento_modo';          // { orderId: 'auto' }
    const K_RIGHE = 'accoppiamento_righe_manuali'; // { orderId: { TIPO: true } }
    const K_COSTI = 'accoppiamento_costi_manuali'; // { 'TIPO|CODICE': 12.3 }

    // Tipi del gestionale -> tipi del motore (stessa tabella di accoppiamento/motore.py)
    const TIPI = {
        GPU: 'GPU', CPU: 'CPU', RAM: 'RAM', SSD: 'SSD', 'SSD ADDON': 'SSD_EXTRA', MOBO: 'MOBO',
        'SCHEDA MADRE': 'MOBO', PSU: 'PSU', ALIMENTATORE: 'PSU', COOLER: 'COOLER', DISSIPATORE: 'COOLER',
        CASE: 'CASE', MONITOR: 'MONITOR'
    };
    const CHIAVI_TECNICHE = ['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name',
        'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'];

    const stato = { dati: null, errore: null, promessa: null, caricatoIl: 0 };
    const contesti = {};   // orderId -> { configKey, variants, allItems }

    // ---------------------------------------------------------------- utilita'
    const leggiLS = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || '') || def; } catch (e) { return def; } };
    const scriviLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage pieno o bloccato */ } };
    const eur = (x) => (x == null || isNaN(x)) ? '—' : x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function chiave(x) {
        return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
    }

    function password() {
        try { if (typeof apiKey !== 'undefined' && apiKey) return apiKey; } catch (e) { /* non ancora definita */ }
        const s = leggiLS('shopify_session', null);
        return s && s.apiKey ? s.apiKey : null;
    }

    function b64(s) {
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    async function decifra(p, pwd, sottile) {
        const s = sottile || (globalThis.crypto && globalThis.crypto.subtle);
        const enc = new TextEncoder();
        const base = await s.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
        const key = await s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(p.salt), iterations: p.iter },
            base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const chiaro = await s.decrypt({ name: 'AES-GCM', iv: b64(p.iv), additionalData: enc.encode(p.aad || '') },
            key, b64(p.dati));
        return JSON.parse(new TextDecoder().decode(chiaro));
    }

    async function carica(forza) {
        const vecchio = Date.now() - stato.caricatoIl > 30 * 60 * 1000;
        if (stato.promessa && !forza && !vecchio) return stato.promessa;
        stato.promessa = (async () => {
            const pwd = password();
            if (!pwd) throw new Error('accedi al gestionale per vedere l\'automatico');
            const r = await fetch(URL_DATI, { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status === 404 ? 'dati automatici non ancora pubblicati' : `errore ${r.status}`);
            const dati = await decifra(await r.json(), pwd);
            stato.dati = dati;
            stato.errore = null;
            stato.caricatoIl = Date.now();
            return dati;
        })().catch(err => {
            stato.errore = err && err.message ? err.message : String(err);
            stato.promessa = null;
            throw err;
        });
        return stato.promessa;
    }

    // ---------------------------------------------------------------- ricerca voce
    function lineaDi(dati, configKey) {
        if (dati && dati.linee && dati.linee[configKey]) return dati.linee[configKey];
        const s = typeof resolveGpoLineScope === 'function' ? resolveGpoLineScope(configKey) : null;
        return s || 'MINIMAL';
    }

    // come findGpoMapping (gpo-manager.js) ma restituisce l'id della riga
    function idMappatura(variabile, valore, configKey) {
        const cache = (typeof gpoMappingsCache !== 'undefined' && Array.isArray(gpoMappingsCache)) ? gpoMappingsCache : [];
        if (!cache.length || typeof normalizeGpoVariantValue !== 'function') return null;
        const scopeLinea = typeof resolveGpoLineScope === 'function' ? resolveGpoLineScope(configKey) : null;
        const normVar = typeof normalizeGpoVariableName === 'function'
            ? normalizeGpoVariableName(splitGpoScopedVariable(variabile).base) : String(variabile).toUpperCase();
        const normVal = normalizeGpoVariantValue(valore);
        const scopeBuild = scopeLinea && typeof normalizeGpoScopeName === 'function' ? normalizeGpoScopeName(configKey) : null;
        const tentativi = scopeLinea ? [...new Set([scopeBuild, scopeLinea, null])] : [null];
        for (const voluto of tentativi) {
            const righe = cache.filter(m => {
                const parti = splitGpoScopedVariable(m.variable);
                if (parti.scope !== voluto) return false;
                const base = typeof normalizeGpoVariableName === 'function' ? normalizeGpoVariableName(parti.base) : parti.base;
                return base === normVar && normalizeGpoVariantValue(m.variant_value) === normVal;
            });
            if (!righe.length) continue;
            righe.sort((a, b) => {
                const ta = new Date(a.updated_at || a.created_at || 0).getTime();
                const tb = new Date(b.updated_at || b.created_at || 0).getTime();
                return tb !== ta ? tb - ta : (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0);
            });
            return righe[0].id;
        }
        return null;
    }

    // Scelte del cliente che riguardano un tipo di riga: [{variabile, valore}]
    function scelteCliente(tipoRiga, variants) {
        const out = [];
        for (const [k, v] of Object.entries(variants || {})) {
            if (!v || CHIAVI_TECNICHE.includes(k)) continue;
            if (typeof isGpoBaseNoComponentValue === 'function' && isGpoBaseNoComponentValue(v)) continue;
            const combinata = typeof splitRAMandSSD === 'function' ? splitRAMandSSD(v) : null;
            if (combinata && combinata.ram && combinata.ssd) {
                if (tipoRiga === 'RAM' || tipoRiga === 'SSD') out.push({ variabile: tipoRiga, valore: v });
                continue;
            }
            const r = typeof resolveVariantTypeFromKeyAndValue === 'function' ? resolveVariantTypeFromKeyAndValue(k, v) : null;
            if (!r || !r.componentType) continue;
            if (r.baseComponentType === tipoRiga || r.componentType === tipoRiga) out.push({ variabile: r.gpoSearchType, valore: v });
        }
        return out;
    }

    function voceAutomatica(dati, ctx, tipoRiga, ean, fornitore) {
        if (!dati) return null;
        const voce = (i) => (i == null ? null : dati.voci[i]);
        // 1) opzione scelta dal cliente
        for (const sc of scelteCliente(tipoRiga, ctx.variants)) {
            const id = idMappatura(sc.variabile, sc.valore, ctx.configKey);
            if (id != null && dati.varianti[String(id)] != null) return { ...voce(dati.varianti[String(id)]), origine: 'opzione' };
        }
        // 2) distinta base della build, se il pezzo e' ancora quello della distinta
        const d = dati.distinte[ctx.configKey];
        if (d && d[tipoRiga] != null) {
            const v = voce(d[tipoRiga]);
            if (v && chiave(v.manuale.codice) === chiave(ean)) return { ...v, origine: 'distinta' };
        }
        // 3) il pezzo com'e' scritto nell'ordine
        const tipo = TIPI[tipoRiga] || tipoRiga;
        const k = `${lineaDi(dati, ctx.configKey)}|${tipo}|${chiave(ean)}|${String(fornitore || '').toUpperCase()}`;
        if (dati.per_valore[k] != null) return { ...voce(dati.per_valore[k]), origine: 'pezzo' };
        return null;
    }

    // ---------------------------------------------------------------- vendita e utile
    function utile(prezzo, costo) {
        const lordo = prezzo / IVA - COMMISSIONI * prezzo - costo;
        return { lordo: Math.round(lordo * 100) / 100, srl: Math.round((lordo > 0 ? QUOTA_SRL * lordo : lordo) * 100) / 100 };
    }

    function proprieta(li) {
        const out = {};
        for (const p of (Array.isArray(li.properties) ? li.properties : [])) out[p.name] = p.value;
        return out;
    }

    // Prezzo IVA inclusa del PC dell'ordine (riga del PC + righe «OPZIONI» collegate a quel PC)
    function prezzoVendita(orderId, ordini) {
        const [idBase, n] = String(orderId).split('.');
        const ord = (ordini || []).find(o => String(o.id) === idBase);
        if (!ord || !Array.isArray(ord.line_items)) return null;
        const ePc = (li) => {
            const nome = li.name || li.title || '';
            if (/^OPZIONI\b/i.test(nome)) return false;
            if (nome.toUpperCase().includes('PC GAMING')) return true;
            return typeof identifyPCConfig === 'function' && identifyPCConfig(nome, true, li.product_id ?? li.productId) !== null;
        };
        const pcs = [];
        for (const li of ord.line_items) if (ePc(li)) for (let i = 0; i < (li.quantity || 1); i++) pcs.push(li);
        const pc = pcs[(parseInt(n, 10) || 1) - 1];
        if (!pc) return null;
        const gruppo = proprieta(pc)._gpo_product_group;
        let opzioni = 0;
        const righeOpzioni = [];
        if (gruppo) {
            for (const li of ord.line_items) {
                if (li === pc || proprieta(li)._gpo_parent_product_group !== gruppo) continue;
                const q = (li.quantity || 1) / (pc.quantity || 1);
                opzioni += (parseFloat(li.price) || 0) * q;
                righeOpzioni.push(li.name || li.title || '');
            }
        }
        const base = parseFloat(pc.price) || 0;
        return { totale: Math.round((base + opzioni) * 100) / 100, pc: base, opzioni: Math.round(opzioni * 100) / 100, righeOpzioni };
    }

    // ---------------------------------------------------------------- stato interruttori
    const modoOrdine = (id) => (leggiLS(K_MODO, {})[id] === 'auto' ? 'auto' : 'manuale');
    function impostaModo(id, modo) {
        const m = leggiLS(K_MODO, {});
        if (modo === 'auto') m[id] = 'auto'; else delete m[id];
        scriviLS(K_MODO, m);
    }
    const rigaManuale = (id, tipo) => !!(leggiLS(K_RIGHE, {})[id] || {})[tipo];
    function impostaRigaManuale(id, tipo, manuale) {
        const m = leggiLS(K_RIGHE, {});
        m[id] = m[id] || {};
        if (manuale) m[id][tipo] = true; else delete m[id][tipo];
        scriviLS(K_RIGHE, m);
    }
    const costoManualeSalvato = (tipo, ean) => leggiLS(K_COSTI, {})[`${tipo}|${chiave(ean)}`];

    // ---------------------------------------------------------------- vista
    const COLORI = { PROKS: '#e74c3c', OMEGA: '#9b59b6', 'TIER ONE': '#3498db', AMAZON: '#f39c12', NOUA: '#2ecc71',
        INTEGRATA: '#7f8c8d', MSI: '#d35400', ACTION: '#1abc9c', ABACO: '#16a085', RUNNER: '#e67e22',
        CASEKING: '#c0392b', FOCELDA: '#8e44ad', 'NAVY BLUE': '#2c3e50' };

    function stile() {
        if (document.getElementById('accoppiamento-auto-style')) return;
        const st = document.createElement('style');
        st.id = 'accoppiamento-auto-style';
        st.textContent = `
.acc-barra{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-size:.8em}
.acc-switch{display:inline-flex;border:1px solid rgba(255,255,255,.25);border-radius:6px;overflow:hidden}
.acc-switch button{background:transparent;border:0;color:rgba(255,255,255,.7);padding:3px 10px;cursor:pointer;font-weight:600;font-size:1em}
.acc-switch button.attivo{background:rgba(46,204,113,.25);color:#2ecc71}
.acc-switch button[data-modo="manuale"].attivo{background:rgba(93,173,226,.25);color:#5dade2}
.acc-stato{color:rgba(255,255,255,.6);text-align:right;flex:1}
.component-row.acc-auto{box-shadow:inset 3px 0 0 #2ecc71;padding-left:5px}
.component-row.acc-auto.acc-caro{box-shadow:inset 3px 0 0 #e67e22}
.acc-riporta{background:none;border:0;color:rgba(255,255,255,.55);cursor:pointer;font-size:.9em;padding:0 4px}
.acc-riporta:hover{color:#fff}
.acc-utile{margin-top:10px;padding:8px 10px;border-radius:6px;font-size:.82em;line-height:1.6;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12)}
.acc-utile.pos{border-color:rgba(46,204,113,.6);background:rgba(46,204,113,.10)}
.acc-utile.neg{border-color:rgba(231,76,60,.7);background:rgba(231,76,60,.12)}
.acc-utile.incompleto{border-color:rgba(241,196,15,.7);background:rgba(241,196,15,.08)}
.acc-utile .riga{display:flex;justify-content:space-between;gap:8px}
.acc-utile .forte{font-weight:700;font-size:1.1em}
.acc-utile .pos-t{color:#2ecc71}.acc-utile .neg-t{color:#e74c3c}
.acc-utile .mancanti{color:#f1c40f;margin-top:4px}
.acc-utile .mancanti a{color:#f1c40f;cursor:pointer;text-decoration:underline}`;
        document.head.appendChild(st);
    }

    function righe(orderId) {
        return Array.from(document.querySelectorAll(`.component-row[data-order-id="${orderId}"]`));
    }

    // Mette sulla riga il pezzo automatico (salvando il manuale negli attributi data-man-*)
    function applicaAuto(row, v) {
        const span = row.querySelector('.component-name-display');
        const badge = row.querySelector('.supplier-badge-clickable');
        if (!span || !badge || !v || !v.auto) return;
        if (row.dataset.accAuto !== '1') {
            span.dataset.manEan = span.dataset.ean || '';
            span.dataset.manName = span.textContent || '';
            badge.dataset.manSupplier = badge.dataset.supplier || '';
        }
        const a = v.auto;
        row.dataset.accAuto = '1';
        row.dataset.accAutoEan = a.codice;
        row.classList.add('acc-auto');
        const man = v.manuale || {};
        row.classList.toggle('acc-caro', a.costo != null && man.costo != null && a.costo > man.costo + 0.005);
        span.dataset.ean = a.codice;
        span.textContent = a.descrizione;
        span.title = `AUTOMATICO: ${a.fornitore} ${a.codice} · ${eur(a.costo)} · ${a.disponibilita}\n` +
            `Manuale: ${badge.dataset.manSupplier || '--'} ${span.dataset.manEan}` +
            (man.costo != null ? ` · ${eur(man.costo)}` : '') + `\nRequisito: ${v.requisito || ''}` +
            (v.nota ? `\nNote: ${v.nota}` : '');
        badge.dataset.supplier = a.fornitore;
        const col = COLORI[a.fornitore] || '#95a5a6';
        badge.textContent = typeof getSupplierAbbreviation === 'function' ? getSupplierAbbreviation(a.fornitore) : a.fornitore.slice(0, 2);
        badge.style.background = col + '33';
        badge.style.color = col;
        badge.style.borderColor = col + '66';
        if (!row.querySelector('.acc-riporta')) {
            const b = document.createElement('button');
            b.className = 'acc-riporta';
            b.title = 'Riporta questo pezzo al manuale';
            b.textContent = '↺';
            b.addEventListener('click', (ev) => {
                ev.stopPropagation();
                impostaRigaManuale(row.dataset.orderId, row.dataset.componentType, true);
                togliAuto(row);
                aggiornaOrdine(row.dataset.orderId);
            });
            badge.parentNode.insertBefore(b, badge);
        }
    }

    function togliAuto(row) {
        if (row.dataset.accAuto !== '1') return;
        const span = row.querySelector('.component-name-display');
        const badge = row.querySelector('.supplier-badge-clickable');
        span.dataset.ean = span.dataset.manEan || '';
        span.textContent = span.dataset.manName || span.dataset.manEan || '';
        span.title = `EAN: ${span.dataset.ean}`;
        const sup = badge.dataset.manSupplier || '';
        badge.dataset.supplier = sup;
        const col = COLORI[sup] || '#95a5a6';
        badge.textContent = sup ? (typeof getSupplierAbbreviation === 'function' ? getSupplierAbbreviation(sup) : sup.slice(0, 2)) : '--';
        badge.style.background = sup ? col + '33' : 'rgba(149,165,166,0.2)';
        badge.style.color = sup ? col : '#95a5a6';
        badge.style.borderColor = sup ? col + '66' : 'rgba(149,165,166,0.4)';
        delete row.dataset.accAuto;
        delete row.dataset.accAutoEan;
        row.classList.remove('acc-auto', 'acc-caro');
        const b = row.querySelector('.acc-riporta');
        if (b) b.remove();
    }

    // valori manuali della riga (anche quando mostra l'automatico)
    function manualeDellaRiga(row) {
        const span = row.querySelector('.component-name-display');
        const badge = row.querySelector('.supplier-badge-clickable');
        if (row.dataset.accAuto === '1') return { ean: span.dataset.manEan, fornitore: badge.dataset.manSupplier };
        return { ean: span ? span.dataset.ean : '', fornitore: badge ? badge.dataset.supplier : '' };
    }

    function barra(orderId) {
        const cont = document.getElementById(`components-${orderId}`);
        if (!cont) return null;
        let b = cont.parentNode.querySelector(`.acc-barra[data-order-id="${orderId}"]`);
        if (!b) {
            b = document.createElement('div');
            b.className = 'acc-barra';
            b.dataset.orderId = orderId;
            b.innerHTML = `<span class="acc-switch"><button data-modo="manuale">Manuale</button><button data-modo="auto">Automatico</button></span><span class="acc-stato"></span>`;
            b.querySelectorAll('.acc-switch button').forEach(btn => btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                impostaModo(orderId, btn.dataset.modo);
                if (btn.dataset.modo === 'auto') {                 // ripartendo dall'automatico valgono tutte le righe
                    const m = leggiLS(K_RIGHE, {}); delete m[orderId]; scriviLS(K_RIGHE, m);
                }
                aggiornaOrdine(orderId);
            }));
            cont.parentNode.insertBefore(b, cont);
        }
        const modo = modoOrdine(orderId);
        b.querySelectorAll('.acc-switch button').forEach(btn => btn.classList.toggle('attivo', btn.dataset.modo === modo));
        return b;
    }

    function box(orderId) {
        const cont = document.getElementById(`custom-items-${orderId}`) || document.getElementById(`components-${orderId}`);
        if (!cont) return null;
        let el = cont.parentNode.querySelector(`.acc-utile[data-order-id="${orderId}"]`);
        if (!el) {
            el = document.createElement('div');
            el.className = 'acc-utile';
            el.dataset.orderId = orderId;
            cont.parentNode.insertBefore(el, cont.nextSibling);
        }
        return el;
    }

    function costoRiga(v, inAuto, tipo, ean) {
        if (inAuto && v && v.auto && v.auto.costo != null) return { costo: v.auto.costo, fonte: 'auto' };
        if (v && v.manuale && v.manuale.costo != null) return { costo: v.manuale.costo, fonte: 'listino' };
        const salvato = costoManualeSalvato(tipo, ean);
        if (salvato != null) return { costo: salvato, fonte: 'inserito' };
        if (v && v.auto && v.auto.costo != null) return { costo: v.auto.costo, fonte: 'stima' };
        return { costo: null, fonte: null };
    }

    async function aggiornaOrdine(orderId) {
        const ctx = contesti[orderId];
        if (!ctx) return;
        stile();
        const b = barra(orderId);
        const stato_el = b ? b.querySelector('.acc-stato') : null;
        let dati = null;
        try {
            dati = await carica();
        } catch (e) {
            if (stato_el) stato_el.textContent = `automatico non disponibile: ${stato.errore}`;
        }
        const modo = modoOrdine(orderId);
        let nAuto = 0, diff = 0, nDiff = 0;
        const conti = { man: 0, auto: 0, mancantiMan: [], mancantiAuto: [], stime: 0 };
        for (const row of righe(orderId)) {
            const tipo = row.dataset.componentType;
            const man = manualeDellaRiga(row);
            const v = dati ? voceAutomatica(dati, ctx, tipo, man.ean, man.fornitore) : null;
            const usaAuto = !!(v && v.auto && !rigaManuale(orderId, tipo));
            if (modo === 'auto' && usaAuto) { applicaAuto(row, v); nAuto++; } else togliAuto(row);
            if (v && v.auto && v.auto.costo != null && v.manuale && v.manuale.costo != null) {
                diff += v.auto.costo - v.manuale.costo; nDiff++;
            }
            const cm = costoRiga(v, false, tipo, man.ean);
            const ca = usaAuto ? { costo: v.auto.costo, fonte: 'auto' } : cm;
            if (cm.costo == null) conti.mancantiMan.push({ tipo, ean: man.ean });
            else { conti.man += cm.costo; if (cm.fonte === 'stima') conti.stime++; }
            if (ca.costo == null) conti.mancantiAuto.push({ tipo, ean: man.ean });
            else conti.auto += ca.costo;
        }
        if (stato_el && dati) {
            stato_el.textContent = modo === 'auto'
                ? `${nAuto} pezzi automatici` + (nDiff ? ` · rispetto al manuale ${diff <= 0 ? '' : '+'}${eur(diff)}` : '')
                : (nDiff ? `automatico ${diff <= 0 ? '' : '+'}${eur(diff)} sui pezzi confrontabili` : 'listini di oggi caricati');
        }
        await mostraUtile(orderId, conti, modo, dati);
    }

    async function mostraUtile(orderId, conti, modo, dati) {
        const el = box(orderId);
        if (!el) return;
        let ordini = [];
        try { ordini = JSON.parse(sessionStorage.getItem('shopify_orders') || '[]'); } catch (e) { ordini = []; }
        const vendita = prezzoVendita(orderId, ordini);
        let extra = 0;
        try {
            const voci = typeof loadCustomItemsFromDB === 'function' ? await loadCustomItemsFromDB(orderId) : [];
            for (const it of voci || []) {
                const p = parseFloat(it.price ?? it.prezzo);
                if (p > 0) extra += p * (parseInt(it.quantity ?? it.quantita, 10) || 1);
            }
        } catch (e) { /* voci personalizzate non leggibili */ }
        const costoMan = conti.man + extra;
        const costoAuto = conti.auto + extra;
        const costo = modo === 'auto' ? costoAuto : costoMan;
        if (!vendita) {
            el.className = 'acc-utile';
            el.innerHTML = `<div class="riga"><span>Costo pezzi (${modo === 'auto' ? 'automatico' : 'manuale'})</span><span class="forte">${eur(costo)}</span></div>` +
                `<div class="mancanti">Prezzo di vendita non trovato per questo ordine: utile non calcolabile.</div>`;
            return;
        }
        const lista = modo === 'auto' ? conti.mancantiAuto : conti.mancantiMan;
        const u = utile(vendita.totale, costo);
        const uAltro = utile(vendita.totale, modo === 'auto' ? costoMan : costoAuto);
        // costi mancanti: il riquadro resta giallo anche se l'utile parziale e' positivo
        el.className = 'acc-utile ' + (u.lordo < 0 ? 'neg' : (lista.length ? 'incompleto' : 'pos'));
        const mancanti = lista.length
            ? `<div class="mancanti">Mancano i costi di: ${lista.map((m, i) =>
                `<a data-i="${i}" title="Inserisci il costo netto di questo pezzo">${esc(m.tipo)}</a>`).join(', ')} — l'utile qui sopra non li conta.</div>`
            : '';
        el.innerHTML =
            `<div class="riga"><span>Venduto a (IVA incl.)</span><span>${eur(vendita.totale)}${vendita.opzioni ? ` <small>(PC ${eur(vendita.pc)} + opzioni ${eur(vendita.opzioni)})</small>` : ''}</span></div>` +
            `<div class="riga"><span>Costo pezzi ${modo === 'auto' ? 'automatico' : 'manuale'}${extra ? ' + voci personalizzate' : ''}${conti.stime && modo !== 'auto' ? ` <small>(${conti.stime} stimati)</small>` : ''}</span><span>${eur(costo)}</span></div>` +
            `<div class="riga forte"><span>Utile</span><span class="${u.lordo >= 0 ? 'pos-t' : 'neg-t'}">${eur(u.lordo)} · SRL ${eur(u.srl)}</span></div>` +
            (dati ? `<div class="riga"><small>Con l'${modo === 'auto' ? 'accoppiamento manuale' : 'accoppiamento automatico'}: utile ${eur(uAltro.lordo)}</small></div>` : '') +
            mancanti;
        el.querySelectorAll('.mancanti a').forEach(a => a.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const m = lista[parseInt(a.dataset.i, 10)];
            const val = prompt(`Costo netto (IVA esclusa) di ${m.tipo} ${m.ean}:`);
            const num = parseFloat(String(val || '').replace(',', '.'));
            if (!isNaN(num) && num >= 0) {
                const c = leggiLS(K_COSTI, {});
                c[`${m.tipo}|${chiave(m.ean)}`] = num;
                scriviLS(K_COSTI, c);
                aggiornaOrdine(orderId);
            }
        }));
    }

    // Chiamata dopo che l'operatore ha cambiato a mano un pezzo (ricerca dal badge fornitore):
    // quel pezzo diventa manuale e resta com'e' anche in modalita' automatica.
    function pezzoModificato(orderId, tipo) {
        const row = document.querySelector(`.component-row[data-order-id="${orderId}"][data-component-type="${tipo}"]`);
        if (row && row.dataset.accAuto === '1') {
            const span = row.querySelector('.component-name-display');
            const badge = row.querySelector('.supplier-badge-clickable');
            span.dataset.manEan = span.dataset.ean;
            span.dataset.manName = span.textContent;
            badge.dataset.manSupplier = badge.dataset.supplier;
            delete row.dataset.accAuto;
            delete row.dataset.accAutoEan;
            row.classList.remove('acc-auto', 'acc-caro');
            const b = row.querySelector('.acc-riporta');
            if (b) b.remove();
        }
        impostaRigaManuale(orderId, tipo, true);
        if (contesti[orderId]) aggiornaOrdine(orderId).catch(() => {});
    }

    // Chiamata da loadComponentsForOrder quando le righe dell'ordine sono pronte
    function decora(orderId, ctx) {
        contesti[orderId] = { configKey: ctx.configKey, variants: ctx.variants || {}, allItems: ctx.allItems || [] };
        aggiornaOrdine(orderId).catch(err => console.warn('[ACCOPPIAMENTO] ', err));
    }

    const api = { decora, pezzoModificato, aggiornaOrdine, carica, decifra, voceAutomatica, prezzoVendita, utile, chiave, idMappatura, scelteCliente, stato };
    if (typeof window !== 'undefined') window.AccoppiamentoAuto = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
