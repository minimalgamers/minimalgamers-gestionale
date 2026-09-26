// ============================================================
// ACCOPPIAMENTO AUTOMATICO v4 (26/09/2026)
// ------------------------------------------------------------
// Due pagine separate (Antonio 26/09):
//   * «Ordini» (manuale): resta com'e'. Sotto ogni build c'e' il riquadro dell'utile con i
//     costi dei pezzi manuali e gli avvisi quando l'ordine non corrisponde alla distinta.
//   * «Automatico»: per ogni ordine da spedire tutti i pezzi scelti dal motore dei listini
//     (fornitori con le regole di GPU Watch, scelte del cliente e titolo del SUO ordine sempre
//     rispettati, alimentatore deciso dalla scheda video), costi, utile e riepilogo fornitori.
//
// I dati arrivano cifrati dal sito dei listini (accoppiamento.bin, ogni 30 minuti con il
// Buyer Desk) e si aprono con la password del gestionale. La pagina Automatico non cambia gli
// ordini e non ordina nulla. L'unica scrittura e' il magazzino (tabella dell'Inventario), e solo
// quando Antonio conferma «Prendi dal magazzino», «Annulla» o la quantita' dei pezzi a terra.
// ============================================================
(function () {
    'use strict';

    const URL_DATI = 'https://minimal-gamers-listini.pages.dev/accoppiamento.bin';
    const IVA = 1.22;
    const COMMISSIONI = 0.045;
    const QUOTA_SRL = 0.70;
    const K_COSTI = 'accoppiamento_costi_manuali'; // { 'TIPO|CODICE': 12.3 } costi netti inseriti a mano
    const K_FISSI = 'accoppiamento_costi_fissi';   // { id costo fisso | 'TIPO|testo': 12.3 }
    const K_FILTRO = 'accoppiamento_filtro';
    const K_ESCLUSI = 'accoppiamento_esclusi_riepilogo';

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
    const eur = (x) => (x == null || isNaN(x)) ? '—' : Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tonda = (x) => Math.round(x * 100) / 100;

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
        const vecchio = Date.now() - stato.caricatoIl > 10 * 60 * 1000;
        if (stato.promessa && !forza && !vecchio) return stato.promessa;
        stato.promessa = (async () => {
            const pwd = password();
            if (!pwd) throw new Error('accedi al gestionale per vedere l\'automatico');
            const r = await fetch(URL_DATI, { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status === 404 ? 'dati automatici non ancora pubblicati' : `errore ${r.status}`);
            const dati = annota(await decifra(await r.json(), pwd));
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

    // ---------------------------------------------------------------- magazzino (Antonio 26/09)
    // Le quantita' dei pezzi a terra stanno nella tabella dell'Inventario, alla riga con il codice
    // della giacenza (es. MAG-DARKCAVE-NERO). Si scalano solo quando Antonio conferma «Prendi dal
    // magazzino»: un pezzo in meno e una riga MAG-USO-<ordine>-<pc>-<giacenza> che ricorda per quale
    // ordine (la pagina Inventario non la mostra). «Annulla» fa il contrario. Nei conti dell'utile
    // il pezzo preso costa quanto e' stato pagato (o il prezzo di oggi, se non e' stato inserito).
    const URL_INV = 'api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php';
    const PREFISSO_USO = 'MAG-USO-';
    const inv = { righe: null, errore: null };

    const chiaveUso = (idOrdine, nPc, idGiacenza) => `${PREFISSO_USO}${idOrdine}-${nPc}-${idGiacenza}`;

    // Collega ogni pezzo con giacenza alla sua riga d'uso e alla definizione del magazzino
    function annota(dati) {
        const defs = {};
        for (const g of (dati && dati.magazzino) || []) defs[g.id] = g;
        for (const [id, o] of Object.entries((dati && dati.ordini) || {})) {
            (o.pc || []).forEach((pc, i) => {
                for (const p of pc.pezzi || []) {
                    if (p.giacenza && defs[p.giacenza] && defs[p.giacenza].codice) {
                        Object.defineProperty(p, 'mag', { value: { def: defs[p.giacenza], uso: chiaveUso(id, i + 1, p.giacenza), ordine: o.nome }, enumerable: false, configurable: true });
                    }
                }
            });
        }
        return dati;
    }

    async function rispostaInv(r) {
        const d = r && r.ok ? await r.json() : null;
        if (!d || !d.success) throw new Error((d && d.error) || 'inventario non raggiungibile');
        return d;
    }

    async function leggiInventario() {
        try {
            const d = await rispostaInv(await fetch(URL_INV, { cache: 'no-store' }));
            const righe = {};
            for (const x of d.inventory || []) righe[x.ean] = x;
            inv.righe = righe;
            inv.errore = null;
        } catch (e) {
            inv.errore = e && e.message ? e.message : String(e);
            throw e;
        }
        return inv.righe;
    }

    const scriviRiga = async (ean, name, quantity) => rispostaInv(await fetch(URL_INV, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ean, name, quantity })
    }));
    const cancellaRiga = async (ean) => rispostaInv(await fetch(`${URL_INV}?ean=${encodeURIComponent(ean)}`, { method: 'DELETE' }));

    // pezzi a terra di quella giacenza: numero, oppure null se Antonio non l'ha ancora inserito
    function quantitaMagazzino(def) {
        const r = inv.righe && def ? inv.righe[def.codice] : null;
        return r ? (parseInt(r.quantity, 10) || 0) : null;
    }

    const pezzoPreso = (p) => !!(p && p.mag && inv.righe && inv.righe[p.mag.uso]);

    function avvisa(testo, tipo) {
        if (typeof showNotification === 'function') showNotification(testo, tipo || 'info');
        else console.log('[ACCOPPIAMENTO] ' + testo);
    }

    function pezzoDaUso(dati, uso) {
        for (const o of Object.values((dati && dati.ordini) || {})) {
            for (const pc of o.pc || []) for (const p of pc.pezzi || []) if (p.mag && p.mag.uso === uso) return p;
        }
        return null;
    }

    // «Prendi dal magazzino»: chiede conferma, poi un pezzo in meno e la riga d'uso per l'ordine.
    // Ritorna true se il magazzino e' cambiato.
    async function prendiDalMagazzino(dati, uso, conferma) {
        const p = pezzoDaUso(dati, uso);
        if (!p) return false;
        const { def, ordine } = p.mag;
        await leggiInventario();
        if (inv.righe[uso]) { avvisa(`${def.descrizione}: già preso dal magazzino per ${ordine}.`); return false; }
        const n = quantitaMagazzino(def);
        if (!n) {
            avvisa(`Nel magazzino non risultano pezzi di ${def.descrizione}: inserisci la quantità in alto nella pagina.`, 'warning');
            return false;
        }
        const ok = (conferma || confirm)(`Prendere 1 × ${def.descrizione} dal magazzino per l'ordine ${ordine}?\n\n` +
            `Nel magazzino restano ${n - 1} pezzi. Nell'utile resta il prezzo pagato.`);
        if (!ok) return false;
        await scriviRiga(uso, `Magazzino → ordine ${ordine}: ${def.descrizione}`, 1);
        try {
            await scriviRiga(def.codice, inv.righe[def.codice].name || def.descrizione, n - 1);
        } catch (e) {
            await cancellaRiga(uso).catch(() => {});
            throw e;
        }
        await leggiInventario();
        if (!inv.righe[uso] || quantitaMagazzino(def) !== n - 1) throw new Error('il magazzino non si è aggiornato: ricarica la pagina e controlla l\'Inventario');
        avvisa(`${def.descrizione} preso dal magazzino per ${ordine}: ne restano ${n - 1}.`, 'success');
        return true;
    }

    // «Annulla»: il pezzo torna nel magazzino e l'ordine torna al fornitore
    async function annullaDalMagazzino(dati, uso, conferma) {
        const p = pezzoDaUso(dati, uso);
        if (!p) return false;
        const { def, ordine } = p.mag;
        await leggiInventario();
        if (!inv.righe[uso]) return false;
        const n = quantitaMagazzino(def) || 0;
        const ok = (conferma || confirm)(`Annullare? ${def.descrizione} torna nel magazzino (${n + 1} pezzi) ` +
            `e per l'ordine ${ordine} si torna al fornitore.`);
        if (!ok) return false;
        await scriviRiga(def.codice, (inv.righe[def.codice] && inv.righe[def.codice].name) || def.descrizione, n + 1);
        await cancellaRiga(uso);
        await leggiInventario();
        avvisa(`${def.descrizione} rimesso nel magazzino: ora sono ${quantitaMagazzino(def)}.`, 'success');
        return true;
    }

    // Quantita' dei pezzi a terra, inserita da Antonio (vale come la pagina Inventario)
    async function impostaQuantita(def, quantita) {
        const n = parseInt(quantita, 10);
        if (!def || isNaN(n) || n < 0) return false;
        await scriviRiga(def.codice, def.descrizione, n);
        await leggiInventario();
        return true;
    }

    // ---------------------------------------------------------------- ricerca voce (pagina manuale)
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
        return { lordo: tonda(lordo), srl: tonda(lordo > 0 ? QUOTA_SRL * lordo : lordo) };
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
        return { totale: tonda(base + opzioni), pc: base, opzioni: tonda(opzioni), righeOpzioni };
    }

    const costoManualeSalvato = (tipo, ean) => leggiLS(K_COSTI, {})[`${tipo}|${chiave(ean)}`];

    // ---------------------------------------------------------------- stile
    const COLORI = { PROKS: '#e74c3c', OMEGA: '#9b59b6', 'TIER ONE': '#3498db', AMAZON: '#f39c12', NOUA: '#2ecc71',
        INTEGRATA: '#7f8c8d', MSI: '#d35400', ACTION: '#1abc9c', ABACO: '#16a085', RUNNER: '#e67e22',
        CASEKING: '#c0392b', FOCELDA: '#8e44ad', 'NAVY BLUE': '#2c3e50', ESPRINET: '#2980b9', BREVI: '#27ae60',
        MEEMO: '#f1c40f', ALTRO: '#95a5a6', 'FORNITORE LOCALE': '#bdc3c7', MAGAZZINO: '#27ae60' };

    function stile() {
        if (document.getElementById('accoppiamento-auto-style')) return;
        const st = document.createElement('style');
        st.id = 'accoppiamento-auto-style';
        st.textContent = `
.acc-utile{margin-top:10px;padding:8px 10px;border-radius:6px;font-size:.82em;line-height:1.6;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);color:#fff}
.acc-utile.pos{border-color:rgba(46,204,113,.6);background:rgba(46,204,113,.10)}
.acc-utile.neg{border-color:rgba(231,76,60,.7);background:rgba(231,76,60,.12)}
.acc-utile.incompleto{border-color:rgba(241,196,15,.7);background:rgba(241,196,15,.08)}
.acc-utile .riga{display:flex;justify-content:space-between;gap:8px}
.acc-utile .forte{font-weight:700;font-size:1.1em}
.acc-pos{color:#2ecc71}.acc-neg{color:#e74c3c}
.acc-utile .mancanti,.acc-avvisi{color:#f1c40f;margin-top:4px}
.acc-utile .mancanti a,.acc-link{color:#f1c40f;cursor:pointer;text-decoration:underline}
.acc-avvisi{font-size:.85em;line-height:1.5}
#automatico-container.tab-content{grid-template-columns:1fr;gap:0;padding:12px 16px}
#automatico-container.tab-content.active{display:block}
.acc-pagina{color:#fff;max-width:1500px}
.acc-testa{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}
.acc-testa h2{margin:0;font-size:1.3em}
.acc-testa .acc-info{color:rgba(255,255,255,.75);font-size:.85em;flex:1;min-width:220px}
.acc-btn{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:600;font-size:.85em}
.acc-btn.attivo{background:rgba(46,204,113,.3);border-color:rgba(46,204,113,.7)}
.acc-cerca{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:8px;padding:6px 10px;font-size:.85em;width:110px}
.acc-totali{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.acc-totale{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:8px 14px;min-width:150px}
.acc-totale small{display:block;color:rgba(255,255,255,.65);font-size:.75em}
.acc-totale b{font-size:1.15em}
.acc-ordine{background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:12px 14px;margin-bottom:14px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.acc-ordine-testa{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}
.acc-ordine-testa .num{font-weight:700;font-size:1.05em}
.acc-badge{font-size:.72em;padding:2px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.3)}
.acc-badge.fatto{background:rgba(52,152,219,.25);border-color:rgba(52,152,219,.6)}
.acc-badge.da-fare{background:rgba(46,204,113,.2);border-color:rgba(46,204,113,.6)}
.acc-pc-titolo{color:rgba(255,255,255,.85);font-size:.85em;margin:6px 0}
.acc-tabella{width:100%;border-collapse:collapse;font-size:.8em}
.acc-tabella th{text-align:left;color:rgba(255,255,255,.6);font-weight:600;border-bottom:1px solid rgba(255,255,255,.2);padding:4px 6px}
.acc-tabella td{border-bottom:1px solid rgba(255,255,255,.08);padding:5px 6px;vertical-align:top}
.acc-tabella td.num{text-align:right;white-space:nowrap}
.acc-forn{display:inline-block;font-size:.8em;font-weight:700;padding:1px 6px;border-radius:5px;border:1px solid}
.acc-cod{font-family:monospace;font-size:.95em;color:rgba(255,255,255,.8);cursor:copy}
.acc-descr{color:#fff}
.acc-nota{color:rgba(255,255,255,.55);font-size:.9em}
.acc-riga-fisso td{color:rgba(255,255,255,.85)}
.acc-riga-vuota td{color:#f5b041}
.acc-riga-magazzino td{color:#d5f5e3}
.acc-mag{margin-top:4px;color:rgba(255,255,255,.6);font-size:.95em}
.acc-mag.si{color:#abebc6}
.acc-btn.acc-btn-mini{padding:2px 8px;font-size:.85em;border-radius:6px}
.acc-disp-ok{color:#2ecc71}.acc-disp-conf{color:#f1c40f}.acc-disp-arr{color:#5dade2}
.acc-riepilogo{background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:12px 14px;margin-top:18px}
.acc-riepilogo h3{margin:0 0 8px;font-size:1.05em}
.acc-forn-blocco{margin:10px 0}
.acc-forn-blocco .testa{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.acc-vuoto{color:rgba(255,255,255,.75);padding:20px;background:rgba(0,0,0,.3);border-radius:10px}
.acc-tabella td.acc-sopra{color:#ff8a80;font-weight:700}.acc-tabella td.acc-sotto{color:#82e0aa}
.acc-tabella td.col-excel{white-space:normal;min-width:64px}.acc-tabella td.col-excel small{font-weight:400;display:block}
.acc-excel-sopra{color:#ff8a80;font-weight:700}.acc-excel-ok{color:#82e0aa}
@media (max-width:760px){.acc-tabella .col-cliente,.acc-tabella .col-disp{display:none}.acc-tabella td.col-excel,.acc-tabella th.col-excel{font-size:.9em;max-width:78px}}`;
        document.head.appendChild(st);
    }

    // ================================================================ PAGINA MANUALE
    function righe(orderId) {
        return Array.from(document.querySelectorAll(`.component-row[data-order-id="${orderId}"]`));
    }

    function manualeDellaRiga(row) {
        const span = row.querySelector('.component-name-display');
        const badge = row.querySelector('.supplier-badge-clickable');
        return { ean: span ? span.dataset.ean : '', fornitore: badge ? badge.dataset.supplier : '' };
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

    // PC accoppiato dall'automatico per questo ordine (orderId «123» o «123.2» per il secondo PC)
    function pcAutomatico(dati, orderId) {
        if (!dati || !dati.ordini) return null;
        const [idBase, n] = String(orderId).split('.');
        const o = dati.ordini[idBase];
        if (!o || !o.pc) return null;
        return o.pc[(parseInt(n, 10) || 1) - 1] || null;
    }

    async function aggiornaOrdine(orderId) {
        const ctx = contesti[orderId];
        if (!ctx) return;
        stile();
        let dati = null;
        try { dati = await carica(); } catch (e) { /* mostrato nel riquadro */ }
        const conti = { man: 0, mancanti: [], stime: 0 };
        for (const row of righe(orderId)) {
            const tipo = row.dataset.componentType;
            const man = manualeDellaRiga(row);
            const v = dati ? voceAutomatica(dati, ctx, tipo, man.ean, man.fornitore) : null;
            let costo = null, stima = false;
            if (v && v.manuale && v.manuale.costo != null) costo = v.manuale.costo;
            else if (costoManualeSalvato(tipo, man.ean) != null) costo = costoManualeSalvato(tipo, man.ean);
            else if (v && v.fisso && v.fisso.costo != null) costo = v.fisso.costo;
            else if (v && v.auto && v.auto.costo != null) { costo = v.auto.costo; stima = true; }
            if (costo == null) conti.mancanti.push({ tipo, ean: man.ean });
            else { conti.man += costo; if (stima) conti.stime++; }
        }
        await mostraUtile(orderId, conti, dati);
    }

    async function mostraUtile(orderId, conti, dati) {
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
        const auto = pcAutomatico(dati, orderId);
        const servizi = tonda(serviziPc(auto).reduce((t, x) => t + (x.costo || 0), 0));
        const costo = conti.man + extra + servizi;
        const avvisi = auto && auto.avvisi && auto.avvisi.length
            ? `<div class="acc-avvisi">⚠ ${auto.avvisi.map(esc).join('<br>⚠ ')}<br><small>L'ordine è stato comprato così: controlla la distinta prima di ordinare.</small></div>` : '';
        if (!vendita) {
            el.className = 'acc-utile';
            el.innerHTML = `<div class="riga"><span>Costo pezzi (manuale)</span><span class="forte">${eur(costo)}</span></div>` +
                `<div class="mancanti">Prezzo di vendita non trovato per questo ordine: utile non calcolabile.</div>` + avvisi;
            return;
        }
        const lista = conti.mancanti;
        const u = utile(vendita.totale, costo);
        el.className = 'acc-utile ' + (u.lordo < 0 ? 'neg' : (lista.length ? 'incompleto' : 'pos'));
        const mancanti = lista.length
            ? `<div class="mancanti">Mancano i costi di: ${lista.map((m, i) =>
                `<a data-i="${i}" title="Inserisci il costo netto di questo pezzo">${esc(m.tipo)}</a>`).join(', ')} — l'utile qui sopra non li conta.</div>`
            : '';
        const ca = auto ? contiPc(auto, leggiLS(K_FISSI, {})) : null;
        const confronto = auto
            ? `<div class="riga"><small>Con l'accoppiamento automatico: costo ${eur(ca.costo)}, utile ${eur(ca.utile.lordo)} · nei conti dell'Excel ${eur(ca.excel.costo)}${ca.costo > ca.excel.costo + TOLLERANZA_EXCEL ? ' <b class="acc-neg">▲ oggi costa di più</b>' : ''} · <a class="acc-link" data-vai="${esc(String(orderId).split('.')[0])}">apri nell'Automatico</a></small></div>`
            : (stato.errore ? `<div class="riga"><small>Automatico non disponibile: ${esc(stato.errore)}</small></div>` : '');
        el.innerHTML =
            `<div class="riga"><span>Venduto a (IVA incl.)</span><span>${eur(vendita.totale)}${vendita.opzioni ? ` <small>(PC ${eur(vendita.pc)} + opzioni ${eur(vendita.opzioni)})</small>` : ''}</span></div>` +
            `<div class="riga"><span>Costo pezzi manuale${extra ? ' + voci personalizzate' : ''}${conti.stime ? ` <small>(${conti.stime} stimati)</small>` : ''}</span><span>${eur(conti.man + extra)}</span></div>` +
            `<div class="riga"><span>Montaggio e spedizione <small>(come nei conti dell'Excel)</small></span><span>${eur(servizi)}</span></div>` +
            `<div class="riga forte"><span>Utile</span><span class="${u.lordo >= 0 ? 'acc-pos' : 'acc-neg'}">${eur(u.lordo)} · SRL ${eur(u.srl)}</span></div>` +
            confronto + mancanti + avvisi;
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
        el.querySelectorAll('[data-vai]').forEach(a => a.addEventListener('click', (ev) => {
            ev.stopPropagation();
            apriAutomatico(a.dataset.vai);
        }));
    }

    // Chiamata dopo che l'operatore ha cambiato a mano un pezzo: si ricalcola l'utile
    function pezzoModificato(orderId) {
        if (contesti[orderId]) aggiornaOrdine(orderId).catch(() => {});
    }

    // Chiamata da loadComponentsForOrder quando le righe dell'ordine sono pronte
    function decora(orderId, ctx) {
        contesti[orderId] = { configKey: ctx.configKey, variants: ctx.variants || {}, allItems: ctx.allItems || [] };
        aggiornaOrdine(orderId).catch(err => console.warn('[ACCOPPIAMENTO] ', err));
    }

    // ================================================================ PAGINA AUTOMATICO
    // costo di un pezzo nella pagina automatica (automatico, fisso, inserito a mano)
    function chiaveFisso(p) {
        return p.fisso && p.fisso.id ? p.fisso.id : `${p.tipo}|${chiave((p.fisso && p.fisso.descrizione) || p.cliente || p.manuale.codice)}`;
    }

    function costoPezzo(p, salvati) {
        if (pezzoPreso(p)) {                         // preso dal magazzino: il prezzo pagato resta nei conti
            const pagato = p.mag.def.costo;
            const oggi = p.auto && p.auto.costo != null ? p.auto.costo : (p.fisso ? p.fisso.costo : null);
            const costo = pagato != null ? pagato : oggi;
            return { costo: costo != null ? costo : null, fonte: 'magazzino' };
        }
        if (p.auto && p.auto.costo != null) return { costo: p.auto.costo, fonte: 'auto' };
        const k = chiaveFisso(p);
        if (salvati && salvati[k] != null) return { costo: salvati[k], fonte: 'inserito' };
        if (p.fisso && p.fisso.costo != null) return { costo: p.fisso.costo, fonte: 'fisso' };
        if (p.manuale && p.manuale.costo != null) return { costo: p.manuale.costo, fonte: 'manuale' };
        return { costo: null, fonte: null };
    }

    // montaggio e spedizione che l'Excel delle build conta in ogni PC
    const SERVIZI_BASE = [{ nome: 'Montaggio e collaudo', costo: 32.79 }, { nome: 'Spedizione BRT', costo: 11 }];
    const serviziPc = (pc) => (pc && Array.isArray(pc.servizi) ? pc.servizi : SERVIZI_BASE);
    const TOLLERANZA_EXCEL = 1;                     // sotto 1 € di differenza il pezzo e' «in linea» con l'Excel

    function contiPc(pc, salvati) {
        let costo = 0, excel = 0;
        const mancanti = [], senzaExcel = [], sopra = [];
        for (const p of pc.pezzi) {
            const c = costoPezzo(p, salvati);
            if (c.costo == null) mancanti.push(p);
            else costo += c.costo;
            if (p.excel && p.excel.costo != null) {
                excel += p.excel.costo;
                if (c.costo != null && c.costo > p.excel.costo + TOLLERANZA_EXCEL) sopra.push(p);
            } else if (!p.senza_costo) senzaExcel.push(p);
        }
        const servizi = serviziPc(pc).reduce((t, x) => t + (x.costo || 0), 0);
        costo = tonda(costo + servizi);
        excel = tonda(excel + servizi);
        return { costo, mancanti, utile: utile(pc.prezzo.totale, costo),
            excel: { costo: excel, utile: utile(pc.prezzo.totale, excel), senza: senzaExcel, sopra } };
    }

    // cella «nei conti dell'Excel» accanto al costo del pezzo: rossa se oggi costa di piu'
    function cellaExcel(p, costo) {
        if (!p.excel || p.excel.costo == null) return `<td class="num col-excel"><span class="acc-nota" title="L'Excel non ha il costo di questa scelta">—</span></td>`;
        const e = p.excel.costo;
        const d = costo == null ? null : tonda(costo - e);
        const titolo = esc(`Nei conti dell'Excel: ${eur(e)} (${p.excel.fonte || ''})`);
        if (d != null && d > TOLLERANZA_EXCEL) {
            const mag = p.mag && !pezzoPreso(p) ? ' · a magazzino costa meno' : '';
            return `<td class="num col-excel acc-sopra" title="${titolo}">${eur(e)}<br><small>▲ +${eur(d)}${esc(mag)}</small></td>`;
        }
        if (d != null && d < -TOLLERANZA_EXCEL) return `<td class="num col-excel acc-sotto" title="${titolo}">${eur(e)}<br><small>▼ ${eur(d)}</small></td>`;
        return `<td class="num col-excel" title="${titolo}">${eur(e)}</td>`;
    }

    // Riepilogo per fornitore degli ordini scelti: { FORNITORE: [{codice, descrizione, quantita, costo, ordini}] }
    // I pezzi senza offerta ordinabile oggi finiscono sotto «DA DECIDERE».
    function riepilogoFornitori(dati, idOrdini, salvati) {
        const out = {};
        for (const id of idOrdini) {
            const o = dati.ordini[id];
            if (!o) continue;
            for (const pc of o.pc) {
                for (const p of pc.pezzi) {
                    let forn, codice, descr, q, costo;
                    if (pezzoPreso(p)) {                                  // preso dal magazzino: non si ordina
                        forn = 'MAGAZZINO'; codice = ''; descr = p.mag.def.descrizione;
                        q = 1; costo = costoPezzo(p, salvati).costo;
                    } else if (p.auto) {
                        forn = p.auto.fornitore; codice = p.auto.codice; descr = p.auto.descrizione;
                        q = p.auto.quantita || 1; costo = p.auto.costo;
                    } else if (p.fisso) {
                        if (p.fisso.costo === 0) continue;                 // incluso o servizio senza costo
                        forn = p.fisso.fornitore || 'FUORI LISTINO'; codice = ''; descr = p.fisso.descrizione;
                        q = 1; costo = costoPezzo(p, salvati).costo;
                    } else {
                        forn = 'DA DECIDERE'; codice = p.manuale.codice || ''; descr = `${p.nome_tipo}: ${p.cliente || p.manuale.descrizione || ''}`;
                        q = 1; costo = costoPezzo(p, salvati).costo;
                    }
                    const lista = out[forn] = out[forn] || [];
                    const k = `${chiave(codice)}|${codice ? '' : descr}`;
                    let r = lista.find(x => x.k === k);
                    if (!r) { r = { k, codice, descrizione: descr, quantita: 0, costo: 0, ordini: [], senzaCosto: false }; lista.push(r); }
                    r.quantita += q;
                    if (costo == null) r.senzaCosto = true; else r.costo = tonda(r.costo + costo);
                    if (!r.ordini.includes(o.nome)) r.ordini.push(o.nome);
                }
            }
        }
        return out;
    }

    function disponibilita(a) {
        const t = String(a.disponibilita || '');
        const cls = a.da_confermare ? 'acc-disp-conf' : (/arriv/i.test(t) ? 'acc-disp-arr' : 'acc-disp-ok');
        return `<span class="${cls}">${esc(t)}${a.da_confermare && !/confermare/i.test(t) ? ' · da confermare' : ''}</span>`;
    }

    function badgeFornitore(f) {
        const col = COLORI[f] || '#95a5a6';
        return `<span class="acc-forn" style="color:#fff;border-color:${col};background:${col}cc">${esc(f || '—')}</span>`;
    }

    function rigaPezzo(p, salvati) {
        const c = costoPezzo(p, salvati);
        const cliente = p.cliente ? esc(p.cliente) : `<span class="acc-nota">${esc(p.origine === 'distinta' ? 'di serie' : p.origine)}</span>`;
        const note = [p.requisito ? `Requisito: ${p.requisito}` : '', p.regola, p.nota].filter(Boolean).join(' · ');
        const man = p.manuale && p.manuale.codice
            ? `Manuale: ${p.manuale.fornitore || '—'} ${p.manuale.codice}${p.manuale.costo != null ? ' · ' + eur(p.manuale.costo) : ''}` : '';
        const titolo = esc([note, man].filter(Boolean).join('\n'));
        if (pezzoPreso(p)) {
            const d = p.mag.def;
            const poi = p.auto ? `se annulli: ${p.auto.fornitore} ${p.auto.codice} · ${eur(p.auto.costo)}` : '';
            const prezzo = d.costo != null ? 'prezzo pagato' : 'prezzo pagato non inserito: vale quello di oggi';
            return `<tr class="acc-riga-magazzino" title="${titolo}"><td>${esc(p.nome_tipo)}</td><td class="col-cliente">${cliente}</td>` +
                `<td>${badgeFornitore('MAGAZZINO')} ${esc(d.descrizione)} <span class="acc-nota">(preso dal magazzino · ${esc(prezzo)})</span>` +
                ` <button class="acc-btn acc-btn-mini" data-annulla="${esc(p.mag.uso)}">Annulla</button>` +
                `${poi ? `<br><span class="acc-nota">${esc(poi)}</span>` : ''}</td>` +
                `<td class="num">${eur(c.costo)}</td>${cellaExcel(p, c.costo)}<td class="col-disp"><span class="acc-disp-ok">a terra</span></td></tr>`;
        }
        const mag = lineaMagazzino(p);
        if (p.auto) {
            const a = p.auto;
            return `<tr title="${titolo}"><td>${esc(p.nome_tipo)}</td><td class="col-cliente">${cliente}</td>` +
                `<td>${badgeFornitore(a.fornitore)} <span class="acc-cod" data-copia="${esc(a.codice)}" title="Copia il codice">${esc(a.codice)}</span>` +
                `${a.quantita > 1 ? ` <b>×${a.quantita}</b>` : ''}<br><span class="acc-descr">${esc(a.descrizione)}</span>` +
                `${p.nota ? `<br><span class="acc-nota">${esc(p.nota)}</span>` : ''}${mag}</td>` +
                `<td class="num">${eur(c.costo)}</td>${cellaExcel(p, c.costo)}<td class="col-disp">${disponibilita(a)}</td></tr>`;
        }
        if (p.fisso) {
            const f = p.fisso;
            const costo = c.costo != null ? eur(c.costo) + (c.fonte === 'inserito' ? ' <small>(inserito)</small>' : '')
                : `<a class="acc-link" data-costo="${esc(chiaveFisso(p))}" data-nome="${esc(f.descrizione)}">inserisci costo</a>`;
            return `<tr class="acc-riga-fisso" title="${titolo}"><td>${esc(p.nome_tipo)}</td><td class="col-cliente">${cliente}</td>` +
                `<td>${badgeFornitore(f.fornitore || 'FUORI LISTINO')} ${esc(f.descrizione)}<br><span class="acc-nota">${esc(p.nota || 'fuori dai listini')}</span>${mag}</td>` +
                `<td class="num">${costo}</td>${cellaExcel(p, c.costo)}<td class="col-disp"></td></tr>`;
        }
        const costo = c.costo != null ? eur(c.costo) + ' <small>(manuale)</small>'
            : `<a class="acc-link" data-costo="${esc(chiaveFisso(p))}" data-nome="${esc(p.nome_tipo)}">inserisci costo</a>`;
        return `<tr class="acc-riga-vuota" title="${titolo}"><td>${esc(p.nome_tipo)}</td><td class="col-cliente">${cliente}</td>` +
            `<td>Nessun pezzo ordinabile oggi nei listini<br><span class="acc-nota">${esc(p.nota || '')}${man ? ' · ' + esc(man) : ''}</span>${mag}</td>` +
            `<td class="num">${costo}</td>${cellaExcel(p, c.costo)}<td class="col-disp"></td></tr>`;
    }

    function righeServizi(pc) {
        return serviziPc(pc).map(x => `<tr class="acc-riga-fisso"><td>Servizio</td><td class="col-cliente"></td>` +
            `<td>${esc(x.nome)} <span class="acc-nota">(come nei conti dell'Excel)</span></td>` +
            `<td class="num">${eur(x.costo)}</td><td class="num col-excel">${eur(x.costo)}</td><td class="col-disp"></td></tr>`).join('');
    }

    // sotto un pezzo che potrebbe uscire dal magazzino: quanti ce ne sono e il pulsante per prenderlo
    function lineaMagazzino(p) {
        if (!p.mag) return '';
        const d = p.mag.def;
        if (inv.errore || !inv.righe) return `<div class="acc-mag">Magazzino (${esc(d.descrizione)}) non leggibile ora${inv.errore ? ': ' + esc(inv.errore) : ''}</div>`;
        const n = quantitaMagazzino(d);
        if (n == null) return `<div class="acc-mag">Magazzino: quantità di ${esc(d.descrizione)} non ancora inserita (in alto nella pagina)</div>`;
        if (n <= 0) return `<div class="acc-mag">Magazzino: 0 pezzi di ${esc(d.descrizione)}</div>`;
        return `<div class="acc-mag si">In magazzino: <b>${n}</b> ${n === 1 ? 'pezzo' : 'pezzi'} · ` +
            `<button class="acc-btn acc-btn-mini" data-prendi="${esc(p.mag.uso)}">Prendi dal magazzino</button></div>`;
    }

    function schedaOrdine(id, o, salvati, esclusi) {
        const fatto = o.elaborato && o.elaborato.stato;
        const badge = fatto
            ? `<span class="acc-badge fatto">elaborato${o.elaborato.foglio ? ' E' + esc(o.elaborato.foglio) : ''}${o.elaborato.stato === 'finalizzati' ? ' · finalizzato' : ''}</span>`
            : `<span class="acc-badge da-fare">da elaborare</span>`;
        let html = `<div class="acc-ordine" data-ordine="${esc(id)}"><div class="acc-ordine-testa">` +
            `<span class="num">${esc(o.nome)}</span><span class="acc-nota">${esc(o.data)}</span>${badge}` +
            `<label class="acc-nota" style="margin-left:auto;cursor:pointer"><input type="checkbox" data-riepilogo="${esc(id)}" ${esclusi[id] ? '' : 'checked'}> nel riepilogo fornitori</label></div>`;
        for (const pc of o.pc) {
            const c = contiPc(pc, salvati);
            const cls = c.utile.lordo < 0 ? 'neg' : (c.mancanti.length ? 'incompleto' : 'pos');
            html += `<div class="acc-pc-titolo"><b>${esc(pc.build)}</b> · ${esc(pc.titolo)}${pc.gpu ? ` · alimentatore per ${esc(pc.gpu)}` : ''}</div>`;
            if (pc.avvisi && pc.avvisi.length) {
                html += `<div class="acc-avvisi">⚠ ${pc.avvisi.map(esc).join('<br>⚠ ')}<br><small>L'automatico segue quello che il cliente ha comprato.</small></div>`;
            }
            html += `<table class="acc-tabella"><thead><tr><th>Pezzo</th><th class="col-cliente">Scelto dal cliente</th><th>Da ordinare</th><th class="num">Costo netto</th><th class="num col-excel">Nei conti Excel</th><th class="col-disp">Disponibilità</th></tr></thead><tbody>` +
                pc.pezzi.map(p => rigaPezzo(p, salvati)).join('') + righeServizi(pc) + `</tbody></table>`;
            html += `<div class="acc-utile ${cls}">` +
                `<div class="riga"><span>Venduto a (IVA incl.)</span><span>${eur(pc.prezzo.totale)}${pc.prezzo.opzioni ? ` <small>(PC ${eur(pc.prezzo.pc)} + opzioni ${eur(pc.prezzo.opzioni)})</small>` : ''}</span></div>` +
                `<div class="riga"><span>Costo automatico (pezzi + montaggio e spedizione)</span><span>${eur(c.costo)}</span></div>` +
                `<div class="riga forte"><span>Utile</span><span class="${c.utile.lordo >= 0 ? 'acc-pos' : 'acc-neg'}">${eur(c.utile.lordo)} · SRL ${eur(c.utile.srl)}</span></div>` +
                rigaConfrontoExcel(c) +
                (c.mancanti.length ? `<div class="mancanti">Mancano i costi di: ${c.mancanti.map(p => esc(p.nome_tipo)).join(', ')} — l'utile non li conta.</div>` : '') +
                `</div>`;
        }
        return html + '</div>';
    }

    // confronto con i conti dell'Excel delle build (stessi pezzi, costo che l'Excel mette in conto)
    function rigaConfrontoExcel(c) {
        const e = c.excel;
        if (!e) return '';
        const d = tonda(c.costo - e.costo);
        const senza = e.senza.length ? ` <small class="acc-nota">(senza ${e.senza.map(p => esc(p.nome_tipo)).join(', ')}: l'Excel non ne ha il costo)</small>` : '';
        const esito = d > TOLLERANZA_EXCEL
            ? `<div class="riga acc-excel-sopra"><span>▲ Oggi costa ${eur(d)} più dei conti dell'Excel${e.sopra.length ? ` (${e.sopra.map(p => esc(p.nome_tipo)).join(', ')})` : ''}</span></div>`
            : `<div class="riga acc-excel-ok"><span>✓ In linea con i conti dell'Excel${d < -TOLLERANZA_EXCEL ? ` (${eur(-d)} in meno)` : ''}</span></div>`;
        return `<div class="riga"><span>Nei conti dell'Excel${senza}</span><span>${eur(e.costo)} · utile ${eur(e.utile.lordo)} · SRL ${eur(e.utile.srl)}</span></div>` + esito;
    }

    function renderRiepilogo(dati, ids, salvati) {
        const r = riepilogoFornitori(dati, ids, salvati);
        const fornitori = Object.keys(r).sort((a, b) => a.localeCompare(b));
        if (!fornitori.length) return `<div class="acc-riepilogo"><h3>Riepilogo fornitori</h3><div class="acc-nota">Nessun ordine selezionato.</div></div>`;
        let html = `<div class="acc-riepilogo"><h3>Riepilogo fornitori <small class="acc-nota">(${ids.length} ordini selezionati; solo consultazione, non ordina nulla)</small></h3>`;
        for (const f of fornitori) {
            const righe = r[f];
            const tot = tonda(righe.reduce((s, x) => s + x.costo, 0));
            html += `<div class="acc-forn-blocco"><div class="testa">${badgeFornitore(f)} <b>${eur(tot)}</b>` +
                (f === 'MAGAZZINO' ? ' <small class="acc-nota">già a terra: da non ordinare (il costo resta nei conti)</small>' : '') +
                `${righe.some(x => x.senzaCosto) ? ' <small class="acc-nota">+ pezzi senza costo</small>' : ''}` +
                ` <button class="acc-btn" data-copia-forn="${esc(f)}">Copia elenco</button></div>` +
                `<table class="acc-tabella"><thead><tr><th>Codice</th><th>Prodotto</th><th class="num">Q.tà</th><th class="num">Costo</th><th>Ordini</th></tr></thead><tbody>` +
                righe.map(x => `<tr><td><span class="acc-cod" data-copia="${esc(x.codice)}">${esc(x.codice || '—')}</span></td><td>${esc(x.descrizione)}</td>` +
                    `<td class="num">${x.quantita}</td><td class="num">${x.senzaCosto && !x.costo ? '—' : eur(x.costo)}</td><td class="acc-nota">${esc(x.ordini.join(', '))}</td></tr>`).join('') +
                `</tbody></table></div>`;
        }
        return html + '</div>';
    }

    // riquadro in alto: pezzi a terra, quanti sono gia' presi per gli ordini da spedire, quantita' da inserire
    function boxMagazzino(dati) {
        const defs = dati.magazzino || [];
        if (!defs.length) return '';
        const presi = {}, possibili = {};
        for (const o of Object.values(dati.ordini || {})) for (const pc of o.pc) for (const p of pc.pezzi) {
            if (!p.mag) continue;
            const k = p.mag.def.id;
            if (pezzoPreso(p)) presi[k] = (presi[k] || 0) + 1; else possibili[k] = (possibili[k] || 0) + 1;
        }
        const nota = `<div class="acc-nota" style="margin:-6px 0 6px">Magazzino: si scala solo quando premi «Prendi dal magazzino» e confermi. ` +
            `Le quantità sono le stesse della pagina Inventario.${inv.errore ? ` <b class="acc-neg">Inventario non leggibile: ${esc(inv.errore)}</b>` : ''}</div>`;
        return nota + `<div class="acc-totali">` + defs.map(d => {
            const n = quantitaMagazzino(d);
            const prezzo = d.costo != null ? `costo netto pagato ${eur(d.costo)}` : 'prezzo pagato da inserire: intanto vale quello di oggi';
            return `<div class="acc-totale"><small>Magazzino · ${esc(d.descrizione)}</small>` +
                `<b>${n == null ? 'quantità da inserire' : `${n} ${n === 1 ? 'pezzo' : 'pezzi'}`}</b> ` +
                `<button class="acc-btn acc-btn-mini" data-quantita="${esc(d.id)}" ${inv.righe ? '' : 'disabled'}>${n == null ? 'Inserisci' : 'Cambia'}</button>` +
                `<small>presi per ordini da spedire: ${presi[d.id] || 0} · possibili: ${possibili[d.id] || 0}<br>${esc(prezzo)}</small></div>`;
        }).join('') + `</div>`;
    }

    function copia(testo) {
        try { navigator.clipboard.writeText(testo); } catch (e) { /* appunti non disponibili */ }
        if (typeof showNotification === 'function') showNotification('Copiato negli appunti', 'success');
    }

    async function renderPagina(forza) {
        const cont = document.getElementById('automatico-container');
        if (!cont) return;
        stile();
        if (forza || !stato.dati) cont.innerHTML = `<div class="acc-pagina"><div class="acc-vuoto">Carico l'accoppiamento automatico…</div></div>`;
        let dati;
        try {
            dati = await carica(forza);
        } catch (e) {
            cont.innerHTML = `<div class="acc-pagina"><div class="acc-testa"><h2>Accoppiamento automatico</h2></div>` +
                `<div class="acc-vuoto">Automatico non disponibile: ${esc(stato.errore)}.<br><small>I dati si preparano con l'aggiornamento dei listini, ogni 30 minuti.</small></div></div>`;
            return;
        }
        if ((dati.magazzino || []).length) {
            try { await leggiInventario(); } catch (e) { /* mostrato accanto ai pezzi */ }
        }
        const filtro = leggiLS(K_FILTRO, 'da-fare');
        const esclusi = leggiLS(K_ESCLUSI, {});
        const salvati = leggiLS(K_FISSI, {});
        const cerca = String((document.getElementById('acc-cerca') || {}).value || '').replace(/\D/g, '');
        const tutti = Object.entries(dati.ordini || {}).sort((a, b) =>
            String(b[1].data).localeCompare(String(a[1].data)) || String(b[1].nome).localeCompare(String(a[1].nome)));
        const visibili = tutti.filter(([, o]) => (filtro === 'tutti' || !(o.elaborato && o.elaborato.stato))
            && (!cerca || String(o.nome).replace(/\D/g, '').includes(cerca)));
        let venduto = 0, costo = 0, mancanti = 0, perdita = 0, sopraExcel = 0, costoExcel = 0;
        for (const [, o] of visibili) for (const pc of o.pc) {
            const c = contiPc(pc, salvati);
            venduto += pc.prezzo.totale; costo += c.costo; mancanti += c.mancanti.length;
            costoExcel += c.excel.costo;
            if (c.costo > c.excel.costo + TOLLERANZA_EXCEL) sopraExcel++;
            if (c.utile.lordo < 0) perdita++;
        }
        const u = utile(venduto, costo);
        const quando = (x) => { try { return new Date(x).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return x; } };
        const selezionati = visibili.map(([id]) => id).filter(id => !esclusi[id]);
        const magazzino = boxMagazzino(dati);
        cont.innerHTML = `<div class="acc-pagina">` +
            `<div class="acc-testa"><h2>Accoppiamento automatico</h2>` +
            `<span class="acc-info">Listini del ${esc(quando(dati.listini))} · preparato il ${esc(quando(dati.generato))} · ordini da spedire: ${tutti.length}</span>` +
            `<button class="acc-btn ${filtro !== 'tutti' ? 'attivo' : ''}" data-filtro="da-fare">Da elaborare</button>` +
            `<button class="acc-btn ${filtro === 'tutti' ? 'attivo' : ''}" data-filtro="tutti">Tutti da spedire</button>` +
            `<input id="acc-cerca" class="acc-cerca" placeholder="# ordine" value="${esc(cerca)}">` +
            `<button class="acc-btn" data-aggiorna="1">Aggiorna</button></div>` +
            `<div class="acc-totali">` +
            `<div class="acc-totale"><small>Ordini mostrati</small><b>${visibili.length}</b></div>` +
            `<div class="acc-totale"><small>Venduto (IVA incl.)</small><b>${eur(venduto)}</b></div>` +
            `<div class="acc-totale"><small>Costo automatico (con montaggio e spedizione)</small><b>${eur(costo)}</b></div>` +
            `<div class="acc-totale"><small>Nei conti dell'Excel</small><b>${eur(costoExcel)}</b><small>PC che oggi costano di più: <b class="${sopraExcel ? 'acc-neg' : 'acc-pos'}">${sopraExcel}</b></small></div>` +
            `<div class="acc-totale"><small>Utile totale</small><b class="${u.lordo >= 0 ? 'acc-pos' : 'acc-neg'}">${eur(u.lordo)}</b></div>` +
            `<div class="acc-totale"><small>PC in perdita / costi mancanti</small><b>${perdita} / ${mancanti}</b></div></div>` +
            magazzino +
            (visibili.length ? visibili.map(([id, o]) => schedaOrdine(id, o, salvati, esclusi)).join('')
                : `<div class="acc-vuoto">Nessun ordine ${filtro === 'tutti' ? 'da spedire' : 'da elaborare'}${cerca ? ' con questo numero' : ''}.</div>`) +
            renderRiepilogo(dati, selezionati, salvati) + `</div>`;

        cont.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => { scriviLS(K_FILTRO, b.dataset.filtro); renderPagina(); }));
        cont.querySelectorAll('[data-aggiorna]').forEach(b => b.addEventListener('click', () => renderPagina(true)));
        const campo = cont.querySelector('#acc-cerca');
        if (campo) campo.addEventListener('change', () => renderPagina());
        cont.querySelectorAll('[data-riepilogo]').forEach(ch => ch.addEventListener('change', () => {
            const e = leggiLS(K_ESCLUSI, {});
            if (ch.checked) delete e[ch.dataset.riepilogo]; else e[ch.dataset.riepilogo] = true;
            scriviLS(K_ESCLUSI, e);
            renderPagina();
        }));
        cont.querySelectorAll('[data-costo]').forEach(a => a.addEventListener('click', () => {
            const val = prompt(`Costo netto (IVA esclusa) di ${a.dataset.nome}:\n(vale per tutti gli ordini con questo pezzo)`);
            const num = parseFloat(String(val || '').replace(',', '.'));
            if (!isNaN(num) && num >= 0) {
                const s = leggiLS(K_FISSI, {});
                s[a.dataset.costo] = num;
                scriviLS(K_FISSI, s);
                renderPagina();
            }
        }));
        // magazzino: ogni scrittura parte solo da un clic di Antonio, con conferma
        const agisci = async (fn, bottone) => {
            if (bottone) bottone.disabled = true;
            let cambiato = false;
            try { cambiato = await fn(); } catch (e) { avvisa('Magazzino: ' + (e && e.message ? e.message : e), 'error'); cambiato = true; }
            if (cambiato) renderPagina(); else if (bottone) bottone.disabled = false;
        };
        cont.querySelectorAll('[data-prendi]').forEach(b => b.addEventListener('click', () => agisci(() => prendiDalMagazzino(dati, b.dataset.prendi), b)));
        cont.querySelectorAll('[data-annulla]').forEach(b => b.addEventListener('click', () => agisci(() => annullaDalMagazzino(dati, b.dataset.annulla), b)));
        cont.querySelectorAll('[data-quantita]').forEach(b => b.addEventListener('click', () => {
            const d = (dati.magazzino || []).find(x => x.id === b.dataset.quantita);
            if (!d) return;
            const attuale = quantitaMagazzino(d);
            const val = prompt(`Quanti pezzi di ${d.descrizione} hai a terra adesso?`, attuale == null ? '' : String(attuale));
            if (val == null || String(val).trim() === '') return;
            if (!/^\d+$/.test(String(val).trim())) { avvisa('Scrivi un numero intero, per esempio 5.', 'warning'); return; }
            agisci(() => impostaQuantita(d, String(val).trim()), b);
        }));
        cont.querySelectorAll('[data-copia]').forEach(el => el.addEventListener('click', () => { if (el.dataset.copia) copia(el.dataset.copia); }));
        cont.querySelectorAll('[data-copia-forn]').forEach(b => b.addEventListener('click', () => {
            const righe = riepilogoFornitori(dati, selezionati, salvati)[b.dataset.copiaForn] || [];
            copia(righe.map(x => `${x.codice || x.descrizione} x${x.quantita}`).join('\n'));
        }));
    }

    function apriAutomatico(idOrdine) {
        const btn = document.querySelector('.tab-button[data-tab="automatico"]');
        if (btn) btn.click();
        setTimeout(() => {
            const el = document.querySelector(`.acc-ordine[data-ordine="${CSS.escape(String(idOrdine))}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 600);
    }

    function collegaTab() {
        const btn = document.querySelector('.tab-button[data-tab="automatico"]');
        if (!btn || btn.dataset.accCollegato) return;
        btn.dataset.accCollegato = '1';
        btn.addEventListener('click', () => setTimeout(() => renderPagina(), 0));
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', collegaTab);
        else collegaTab();
    }

    const api = { decora, pezzoModificato, aggiornaOrdine, carica, decifra, voceAutomatica, prezzoVendita, utile, chiave,
        idMappatura, scelteCliente, stato, renderPagina, riepilogoFornitori, costoPezzo, contiPc, pcAutomatico,
        annota, inv, leggiInventario, quantitaMagazzino, pezzoPreso, prendiDalMagazzino, annullaDalMagazzino,
        impostaQuantita, boxMagazzino, rigaPezzo, cellaExcel, rigaConfrontoExcel, serviziPc };
    if (typeof window !== 'undefined') window.AccoppiamentoAuto = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
