// ============================================================
// ACCOPPIAMENTO AUTOMATICO v4 (26/09/2026, pezzi migliori all'elaborazione 30/09)
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
        CASE: 'CASE', MONITOR: 'MONITOR',
        // 30/09: righe accessori della scheda (kit dei bundle, sedia, scrivania) = pezzi ACCESSORIO dell'automatico
        'KIT GAMING': 'ACCESSORIO', KIT: 'ACCESSORIO', SEDIA: 'ACCESSORIO', SCRIVANIA: 'ACCESSORIO'
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
            if (v && (chiave(v.manuale.codice) === chiave(ean) || (v.auto && chiave(v.auto.codice) === chiave(ean)))) {
                return { ...v, origine: 'distinta' };                  // (30/09: anche il pezzo migliore gia' messo)
            }
        }
        return vocePerCodice(dati, ctx, tipoRiga, ean, fornitore);
    }

    // Voce del pezzo com'e' scritto nella scheda, senza guardare le scelte del cliente (30/09: se la scheda ha un
    // pezzo diverso da quello dell'opzione, per esempio il case ATX al posto del Minimal Case, conta il suo costo)
    function vocePerCodice(dati, ctx, tipoRiga, ean, fornitore) {
        if (!dati || !chiave(ean)) return null;
        const voce = (i) => (i == null ? null : dati.voci[i]);
        // 3) il pezzo com'e' scritto nell'ordine
        const tipo = TIPI[tipoRiga] || tipoRiga;
        const k = `${lineaDi(dati, ctx.configKey)}|${tipo}|${chiave(ean)}|${String(fornitore || '').toUpperCase()}`;
        if (dati.per_valore[k] != null) return { ...voce(dati.per_valore[k]), origine: 'pezzo' };
        // 4) lo stesso pezzo in un'altra linea o da un altro fornitore (29/09: la scheda di un ordine gia'
        //    elaborato puo' avere un pezzo che la sua linea non usa, ma il costo nei listini c'e')
        const altrove = cercaPerCodice(dati, tipo, ean, fornitore);
        if (altrove != null) return { ...voce(altrove), origine: 'pezzo' };
        // 5) un pezzo che l'automatico sceglie oggi per qualche voce (30/09: pezzi migliori messi nella scheda)
        const scelto = cercaPerScelta(dati, tipo, ean, fornitore);
        if (scelto != null) return { ...voce(scelto), origine: 'scelta' };
        return null;
    }

    // Pezzo dell'automatico di quest'ordine che corrisponde alla riga della scheda: stesso tipo e stesso pezzo di
    // partenza (distinta, opzione o regola del gestionale, es. «CASE ATX BLACK») o stesso pezzo scelto; per gli
    // accessori e il monitor basta la stessa famiglia (kit, sedia, scrivania, mouse + tastiera, monitor).
    const FAMIGLIA_ACCESSORIO = /KIT|SEDIA|SCRIVANIA|G61|K61|MONITOR/;
    function pezzoDellaRiga(auto, tipo, ean) {
        if (!auto || !Array.isArray(auto.pezzi)) return null;
        const t = TIPI[tipo] || tipo;
        const c = chiave(ean);
        const stessi = auto.pezzi.filter(x => x.tipo === t);
        if (!stessi.length || !c) return null;
        // stesso codice, anche con una nota in piu' (es. «ASIN B0G39F6MQH» e «ASIN B0G39F6MQH (nero)»)
        const simile = (k) => !!k && (k === c || (Math.min(k.length, c.length) >= 8 && (k.startsWith(c) || c.startsWith(k))));
        const uguale = stessi.find(x => simile(chiave(x.manuale && x.manuale.codice))) ||
            stessi.find(x => x.auto && simile(chiave(x.auto.codice)));
        if (uguale) return uguale;
        if (t !== 'ACCESSORIO' && t !== 'MONITOR') return null;
        const fam = (String(ean).toUpperCase().match(FAMIGLIA_ACCESSORIO) || [])[0] || (t === 'MONITOR' ? 'MONITOR' : '');
        const simili = stessi.filter(x => {
            const testo = `${x.manuale && x.manuale.codice || ''} ${x.cliente || ''} ${x.fisso && x.fisso.descrizione || ''}`.toUpperCase();
            return fam && (testo.includes(fam) || (fam === 'MONITOR' && t === 'MONITOR'));
        });
        return simili.length === 1 ? simili[0] : null;
    }

    function cercaPerScelta(dati, tipo, ean, fornitore) {
        if (!dati.__perScelta) {
            const idx = {};
            for (const [k, i] of Object.entries(dati.per_valore || {})) {
                const a = dati.voci[i] && dati.voci[i].auto;
                if (!a || !a.codice) continue;
                const t = k.split('|')[1];
                const c = chiave(a.codice);
                const f = String(a.fornitore || '').toUpperCase();
                if (idx[`${t}|${c}|${f}`] == null) idx[`${t}|${c}|${f}`] = i;
                if (idx[`${t}|${c}`] == null) idx[`${t}|${c}`] = i;
            }
            Object.defineProperty(dati, '__perScelta', { value: idx, enumerable: false, configurable: true });
        }
        const c = chiave(ean);
        if (!c) return null;
        const i = dati.__perScelta[`${tipo}|${c}|${String(fornitore || '').toUpperCase()}`];
        return i != null ? i : (dati.__perScelta[`${tipo}|${c}`] != null ? dati.__perScelta[`${tipo}|${c}`] : null);
    }

    function cercaPerCodice(dati, tipo, ean, fornitore) {
        if (!dati.__perCodice) {
            const idx = {};
            for (const [k, i] of Object.entries(dati.per_valore || {})) {
                const [, t, cod, forn] = k.split('|');
                if (idx[`${t}|${cod}|${forn}`] == null) idx[`${t}|${cod}|${forn}`] = i;
                if (idx[`${t}|${cod}`] == null) idx[`${t}|${cod}`] = i;
            }
            Object.defineProperty(dati, '__perCodice', { value: idx, enumerable: false, configurable: true });
        }
        const c = chiave(ean);
        if (!c) return null;
        const f = String(fornitore || '').toUpperCase();
        const i = dati.__perCodice[`${tipo}|${c}|${f}`];
        return i != null ? i : (dati.__perCodice[`${tipo}|${c}`] != null ? dati.__perCodice[`${tipo}|${c}`] : null);
    }

    // ---------------------------------------------------------------- vendita e utile
    function utile(prezzo, costo) {
        const lordo = prezzo / IVA - COMMISSIONI * prezzo - costo;
        return { lordo: tonda(lordo), srl: tonda(lordo > 0 ? QUOTA_SRL * lordo : lordo) };
    }

    // ---------------------------------------------------------------- obiettivo e prezzo (Antonio 29/09)
    // «L'utile va calcolato in base a quanto lo abbiamo venduto … e capire se quel PC è in target con l'utile in
    // base ai costi d'acquisto dei componenti». L'obiettivo è la colonna «Target utile» dell'Excel (utile SRL),
    // lo stesso del GPU Watch; arriva con i dati automatici. Entro 5 € dall'obiettivo l'ordine è in target.
    const TOLLERANZA_OBIETTIVO = 5;

    function valutaObiettivo(srl, obiettivo) {
        if (obiettivo == null || srl == null || isNaN(Number(obiettivo)) || isNaN(Number(srl))) return null;
        const scarto = tonda(Number(srl) - Number(obiettivo));
        return { obiettivo: Number(obiettivo), scarto, inTarget: scarto >= -TOLLERANZA_OBIETTIVO };
    }

    function rigaObiettivo(srl, obiettivo) {
        const v = valutaObiettivo(srl, obiettivo);
        if (!v) return '';
        return v.inTarget
            ? `<div class="riga acc-excel-ok"><span>🎯 Obiettivo utile SRL ${eur(v.obiettivo)}</span><span>✅ in target${v.scarto >= 1 ? ` (+${eur(v.scarto)})` : ''}</span></div>`
            : `<div class="riga acc-excel-sopra"><span>🎯 Obiettivo utile SRL ${eur(v.obiettivo)}</span><span>🔻 sotto di ${eur(-v.scarto)}</span></div>`;
    }

    const dataBreve = (x) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || ''));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
    };

    // «Venduto il 27/09/2026 a …» e, se oggi la build ha un altro prezzo sul sito, di quanto
    function righeVendita(vendita, data, listinoOggi) {
        const quando = dataBreve(data);
        let html = `<div class="riga"><span>Venduto${quando ? ` il ${quando}` : ''} a (IVA incl.)</span><span>${eur(vendita.totale)}` +
            `${vendita.opzioni ? ` <small>(PC ${eur(vendita.pc)} + opzioni ${eur(vendita.opzioni)})</small>` : ''}</span></div>`;
        if (listinoOggi != null && !isNaN(Number(listinoOggi)) && Math.abs(Number(listinoOggi) - vendita.pc) >= 1) {
            const d = tonda(Number(listinoOggi) - vendita.pc);
            html += `<div class="riga"><small>Oggi la build è a ${eur(Number(listinoOggi))} sul sito ` +
                `(${d > 0 ? '+' : ''}${eur(d)} rispetto al prezzo di questo ordine)</small></div>`;
        }
        return html;
    }

    // Antonio 29/09: «avere un'idea chiara se ciò che sto ordinando mi permette di stare in profitto o in
    // negativo». Una riga in testa al riquadro, calcolata sui pezzi della scheda (quello che si ordina).
    function rigaEsito(u, nMancanti, obiettivo) {
        if (nMancanti > 0) {
            return `<div class="acc-esito incompleto">🟠 DA COMPLETARE · ${nMancanti === 1 ? 'manca 1 costo' : `mancano ${nMancanti} costi`}</div>`;
        }
        if (u.lordo < 0) return `<div class="acc-esito neg">🔴 IN PERDITA · ${eur(u.lordo)}</div>`;
        // 01/10: il numero in testa e' l'utile SRL, quello che resta in tasca alla SRL al netto di tutto
        const v = valutaObiettivo(u.srl, obiettivo);
        if (v && !v.inTarget) return `<div class="acc-esito basso">🟡 UTILE SRL ${eur(u.srl)} · sotto obiettivo di ${eur(-v.scarto)}</div>`;
        return `<div class="acc-esito pos">🟢 UTILE SRL ${eur(u.srl)}${v ? ' · in target' : ''}</div>`;
    }

    // Alimentatore della scheda diverso da quello che va comprato oggi (Antonio 29/09, ordine MSI LEVIATHAN
    // elaborato con la regola vecchia: DeepCool 600W al posto di MSI 850W). Si confronta solo l'alimentatore,
    // per potenza e per marca MSI: gli altri pezzi hanno nomi diversi tra scheda e listini (codici Tier One,
    // descrizioni Amazon…) e un confronto per codice darebbe falsi allarmi su quasi tutti gli ordini.
    function wattAlimentatore(x) {
        const s = String(x || '').toUpperCase();
        if (!/[A-Z]/.test(s)) return null;                 // codice solo numerico (Tier One, EAN): non si sa
        const w = /(?<!\d)(\d{3,4})\s*W\b/.exec(s);
        if (w) return Number(w[1]);
        const n = (s.match(/(?<!\d)\d{3,4}(?!\d)/g) || []).map(Number).filter(v => v >= 400 && v <= 1600);
        return n.length ? n[0] : null;
    }
    const alimentatoreMsi = (x) => /\bMSI\b|\bMAG\b|\bMPG\b|\bMEG\b/.test(String(x || '').toUpperCase());

    function pezziDiversi(righeScheda, auto) {
        if (!auto || !Array.isArray(auto.pezzi)) return [];
        const p = auto.pezzi.find(x => x.tipo === 'PSU');
        if (!p || p.fisso) return [];
        const giustoNome = [p.manuale && p.manuale.codice, p.manuale && p.manuale.descrizione,
            p.auto && p.auto.codice, p.auto && p.auto.descrizione].filter(Boolean).join(' ');
        const wGiusto = wattAlimentatore(giustoNome);
        const out = [];
        for (const r of righeScheda) {
            if ((TIPI[r.tipo] || r.tipo) !== 'PSU' || !r.ean) continue;
            const wScheda = wattAlimentatore(r.ean);
            const pocaPotenza = wGiusto != null && wScheda != null && wScheda < wGiusto;
            const nonMsi = alimentatoreMsi(giustoNome) && /[A-Z]/i.test(r.ean) && !alimentatoreMsi(r.ean);
            if (!pocaPotenza && !nonMsi) continue;
            const m = p.manuale || {};
            const giusto = `${m.codice || (p.auto && p.auto.codice) || ''}` +
                `${p.auto && p.auto.costo != null ? ` (oggi ${eur(p.auto.costo)} da ${p.auto.fornitore})` : ''}`;
            out.push({ tipo: p.nome_tipo || 'Alimentatore', scheda: r.ean, giusto,
                costoGiusto: p.auto && p.auto.costo != null ? p.auto.costo : null,
                motivo: pocaPotenza ? `${wScheda}W invece di ${wGiusto}W` : 'serve un alimentatore MSI' });
        }
        return out;
    }

    // Utile se si compra il pezzo giusto al posto di quello della scheda (null se manca un costo)
    function utileConPezziGiusti(prezzo, costo, diversi, costiRiga) {
        if (!diversi.length) return null;
        let delta = 0;
        for (const d of diversi) {
            const r = (costiRiga || []).find(x => (TIPI[x.tipo] || x.tipo) === 'PSU' && x.ean === d.scheda);
            if (!r || r.costo == null || d.costoGiusto == null) return null;
            delta += d.costoGiusto - r.costo;
        }
        return utile(prezzo, costo + delta);
    }

    function righePezziDiversi(lista, uGiusto) {
        if (!lista.length) return '';
        return `<div class="acc-avvisi">⚠ Alimentatore da cambiare:<br>` +
            lista.map(x => `<b>${esc(x.tipo)}</b>: nella scheda ${esc(x.scheda)} → da ordinare ${esc(x.giusto)}` +
                (x.motivo ? ` <small>(${esc(x.motivo)})</small>` : '')).join('<br>') +
            (uGiusto ? `<br>Con l'alimentatore giusto: utile ${eur(uGiusto.lordo)} · SRL ${eur(uGiusto.srl)}` : '') +
            `<br><small>Se non è ancora stato comprato, cambialo nella scheda.</small></div>`;
    }

    // Costo di oggi del pezzo com'e' scritto nella scheda (dati automatici «per_codice», 29/09): serve per i
    // pezzi presi fuori da distinte e mappature, per esempio il processore di TIER ONE col suo codice.
    function costoScheda(dati, ean, fornitore) {
        const c = chiave(ean);
        if (!dati || !dati.per_codice || !c) return null;
        return dati.per_codice[`${String(fornitore || '').toUpperCase().trim()}|${c}`] || null;
    }

    // Ultima stima: il pezzo dello stesso tipo che l'automatico sceglie oggi per quest'ordine (stesso chip)
    function costoEquivalente(auto, tipo, salvati) {
        if (!auto || !Array.isArray(auto.pezzi)) return null;
        const t = TIPI[tipo] || tipo;
        const p = auto.pezzi.find(x => x.tipo === t);
        return p ? costoPezzo(p, salvati || {}).costo : null;
    }

    // Antonio 29/09: «le nuovissime varianti GPO che ci stanno sull'Excel non ci sono sul gestionale?». Le
    // opzioni nuove (connettivita' Wi-Fi, ventole RGB, scatole, Office…) non hanno una riga nella scheda:
    // l'automatico le conosce (pezzi fissi con il loro costo). Si mostrano sotto la scheda come pezzi da
    // comprare o preparare e il loro costo entra nell'utile dell'ordine.
    const TIPI_EXTRA = ['WIFI', 'VENTOLE', 'SERVIZIO', 'SOFTWARE', 'ACCESSORIO'];
    const TIPO_SCHEDA_EXTRA = { 'KIT GAMING': 'ACCESSORIO', KIT: 'ACCESSORIO', SEDIA: 'ACCESSORIO', SCRIVANIA: 'ACCESSORIO' };
    const VOCE_PERSONALIZZATA = { WIFI: /WI-?FI|BLUETOOTH/i, VENTOLE: /VENTOL/i, SERVIZIO: /SCATOL/i,
        SOFTWARE: /OFFICE|SOFTWARE|WINDOWS/i, ACCESSORIO: /KIT|SEDIA|SCRIVANIA|MOUSE|TASTIERA/i };
    const ICONA_EXTRA = { WIFI: '📶', VENTOLE: '🌀', SERVIZIO: '📦', SOFTWARE: '💿', ACCESSORIO: '🎮' };

    function extraOrdine(auto, tipiScheda, vociPersonalizzate, salvati) {
        if (!auto || !Array.isArray(auto.pezzi)) return [];
        const presenti = new Set((tipiScheda || []).map(t => TIPO_SCHEDA_EXTRA[t] || TIPI[t] || t));
        return auto.pezzi.filter(p => TIPI_EXTRA.includes(p.tipo) && !presenti.has(p.tipo)).map(p => {
            const re = VOCE_PERSONALIZZATA[p.tipo];
            const f = p.fisso || {};
            return {
                tipo: p.tipo, nome: p.nome_tipo || p.tipo,
                descrizione: f.descrizione || p.cliente || (p.manuale && p.manuale.codice) || '',
                fornitore: f.fornitore || (p.auto && p.auto.fornitore) || '',
                costo: costoPezzo(p, salvati || {}).costo, chiave: chiaveFisso(p),
                personalizzata: Boolean(re) && (vociPersonalizzate || []).some(v => re.test(`${v.name || ''} ${v.value || ''}`)),
                // 01/10: per la riga nella scheda: cosa ha scelto il cliente e se l'automatico ha trovato il pezzo
                scelta: p.cliente || f.descrizione || (p.manuale && p.manuale.codice) || '',
                pezzo: f.descrizione || (p.auto && (p.auto.descrizione || p.auto.codice)) || '',
                codice: (p.auto && p.auto.codice) || '', accoppiata: Boolean(p.fisso || p.auto)
            };
        });
    }

    function righeExtra(lista) {
        if (!lista.length) return '';
        return `<div class="acc-extra"><div><b>➕ Opzioni del cliente fuori scheda</b> <small>(da comprare o preparare)</small></div>` +
            lista.map((x, i) => `<div class="riga"><span>${ICONA_EXTRA[x.tipo] || '•'} <b>${esc(x.nome)}</b>: ${esc(x.descrizione)}` +
                `${x.fornitore ? ` <small>· ${esc(x.fornitore)}</small>` : ''}` +
                `${x.personalizzata ? ' <small>· già tra le voci personalizzate</small>' : ''}</span><span>` +
                (x.costo == null ? `<a data-extra="${i}" class="acc-incompleto" title="Inserisci il costo netto (vale per tutti gli ordini)">costo da inserire</a>`
                    : (x.costo === 0 ? 'nessun costo' : eur(x.costo))) + `</span></div>`).join('') + `</div>`;
    }

    // Antonio 01/10: «tutte le varianti che sceglie il cliente devono sempre vedersi nella scheda prodotto, esattamente
    // come gli altri componenti, così che possa vedere rapidamente che l'accoppiamento ha funzionato». Le opzioni senza
    // una riga nella scheda (Wi-Fi, ventole, scatole, Office…) diventano righe uguali ai componenti, con il fornitore del
    // pezzo trovato; «⚠ senza pezzo» se l'automatico non l'ha trovato. Solo vista: non vanno nel database.
    function righeOpzioniScheda(orderId, lista) {
        const cont = typeof document !== 'undefined' ? document.getElementById(`components-${orderId}`) : null;
        if (!cont) return 0;
        cont.querySelectorAll('.acc-riga-opzione').forEach(x => x.remove());
        let n = 0;
        for (const x of lista || []) {
            if (x.personalizzata) continue;                       // c'e' gia' come voce personalizzata
            const forn = String(x.fornitore || '').toUpperCase().trim();
            const ab = forn ? (typeof getSupplierAbbreviation === 'function' ? getSupplierAbbreviation(forn) : forn.slice(0, 2)) : '--';
            const col = COLORI[forn] || '#95a5a6';
            const riga = document.createElement('div');
            riga.className = 'acc-riga-opzione';
            riga.title = [`Scelta del cliente: ${x.scelta}`, x.pezzo ? `Pezzo: ${x.pezzo}` : 'Nessun pezzo trovato dall\'automatico',
                forn ? `Fornitore: ${forn}` : '', x.costo == null ? 'Costo da inserire' : (x.costo === 0 ? 'Nessun costo' : `Costo netto ${eur(x.costo)}`)].filter(Boolean).join('\n');
            riga.innerHTML = `<div class="acc-opz-testo"><strong>${esc(String(x.nome || x.tipo).toUpperCase())}:</strong>` +
                `<span>${esc(x.scelta || x.pezzo)}</span>${x.accoppiata ? '' : '<em class="acc-incompleto">⚠ senza pezzo</em>'}</div>` +
                `<span class="acc-opz-forn" style="background:${col}33;color:${forn ? col : '#95a5a6'};border-color:${col}66">${esc(ab)}</span>`;
            cont.appendChild(riga);
            n++;
        }
        return n;
    }

    // Pezzo della scheda che e' quello a magazzino (es. DeepCool PN850-D, non piu' a listino): prezzo pagato
    function costoMagazzino(auto, tipo, ean) {
        if (!auto || !Array.isArray(auto.pezzi)) return null;
        const t = TIPI[tipo] || tipo;
        const p = auto.pezzi.find(x => x.tipo === t);
        if (!p || !p.mag || !p.mag.def || p.mag.def.costo == null) return null;
        return chiave(p.manuale && p.manuale.codice) === chiave(ean) ? p.mag.def.costo : null;
    }

    // Pezzo che l'automatico consiglia oggi per quel tipo (piu' economico o disponibile): {costo, fornitore, descrizione}
    function consigliato(auto, tipo, salvati) {
        if (!auto || !Array.isArray(auto.pezzi)) return null;
        const t = TIPI[tipo] || tipo;
        const p = auto.pezzi.find(x => x.tipo === t);
        if (!p || !p.auto) return null;
        const c = costoPezzo(p, salvati || {}).costo;
        return c == null ? null : { costo: c, fornitore: p.auto.fornitore || '', descrizione: p.auto.descrizione || p.auto.codice || '' };
    }

    // Antonio 30/09: «ste schermate sono troppo confusionarie, non capisco». Il conto dell'ordine come uno
    // scontrino, dall'alto in basso. 01/10: «il nostro utile è quello che rimane nelle tasche della SRL già al netto di
    // tutto»: pagato, meno IVA, commissioni e costi = utile prima delle tasse; meno il 30% = UTILE SRL, l'ultima riga.
    function contoOrdine(vendita, costi, nMancanti, obiettivo) {
        const p = vendita.totale;
        const iva = tonda(p - p / IVA), comm = tonda(p * COMMISSIONI);
        const riga = (testo, valore, classe) => `<div class="riga${classe ? ' ' + classe : ''}"><span>${testo}</span><span class="val">${valore}</span></div>`;
        let h = riga(`Pagato dal cliente${dataBreve(vendita.data) ? ` il ${dataBreve(vendita.data)}` : ''}`, eur(p), 'pagato') +
            (vendita.opzioni ? `<div class="riga nota"><span>PC ${eur(vendita.pc)} + opzioni ${eur(vendita.opzioni)}</span></div>` : '') +
            riga('− IVA 22%', eur(-iva), 'meno') +
            riga('− Scalapay e commissioni 4,5%', eur(-comm), 'meno');
        for (const c of costi) if (c.valore || c.sempre) h += riga(`− ${c.testo}`, eur(-c.valore), 'meno');
        if (nMancanti > 0) {
            return h + riga('= Utile SRL', `<span class="acc-incompleto">da calcolare: ${nMancanti === 1 ? 'manca 1 costo' : `mancano ${nMancanti} costi`}</span>`, 'finale');
        }
        const u = utile(p, costi.reduce((t, c) => t + (c.valore || 0), 0));
        h += riga('= Utile prima delle tasse', eur(u.lordo), 'sub');
        if (u.lordo > 0) h += riga(`− Tasse ${Math.round((1 - QUOTA_SRL) * 100)}%`, eur(tonda(u.srl - u.lordo)), 'meno');
        h += riga(`= UTILE SRL <small>in tasca, al netto di tutto</small>`, `<span class="${u.srl >= 0 ? 'acc-pos' : 'acc-neg'}">${eur(u.srl)}</span>`, 'finale');
        const v = valutaObiettivo(u.srl, obiettivo);
        if (v) h += riga(`🎯 Obiettivo ${eur(v.obiettivo)}`, v.inTarget ? `✅ in target${v.scarto >= 1 ? ` (+${eur(v.scarto)})` : ''}`
            : `<span class="acc-neg">🔻 sotto di ${eur(-v.scarto)}</span>`, 'obiettivo');
        return h;
    }

    const NOME_FONTE = { acquistato: 'prezzo pagato (acquisto confermato)', listino: '', inserito: 'inserito da te', fisso: 'budget fisso', magazzino: 'a magazzino: prezzo pagato',
        altro: 'stimato: stesso pezzo, prezzo di un altro fornitore',
        stima: 'stimato col pezzo consigliato: questo non ha un prezzo di listino' };

    // Pezzo per pezzo (aperto a richiesta): quanto costa oggi, da dove viene il numero e se c'e' di meglio
    function corpoPezzi(righeConto, confermato) {
        if (!righeConto.length) return '<div class="acc-nota">Nessun pezzo nella scheda.</div>';
        return `<div class="acc-nota">${confermato ? 'Prezzi netti pagati' : 'Prezzi netti di oggi'}, pezzo per pezzo</div>` + righePezziConto(righeConto);
    }

    function dettaglioPezzi(righeConto, confermato) {
        if (!righeConto.length) return '';
        const corpo = righePezziConto(righeConto);
        return `<details class="acc-dettaglio"><summary>🔍 Pezzo per pezzo (${confermato ? 'prezzi netti pagati' : 'prezzi netti di oggi'})</summary>${corpo}</details>`;
    }

    function righePezziConto(righeConto) {
        return righeConto.map(r => {
            const nome = r.nome || r.ean || '';
            const val = r.costo == null ? '<span class="acc-incompleto">manca</span>' : `${r.fonte === 'stima' || r.fonte === 'altro' ? '≈ ' : ''}${eur(r.costo)}`;
            let sotto = NOME_FONTE[r.fonte] ? `<small>${esc(NOME_FONTE[r.fonte])}</small>` : '';
            const c = r.consigliato;
            if (c && r.costo != null && r.costo - c.costo >= 1 && r.fonte !== 'stima') {
                const d = String(c.descrizione || '');
                sotto += `${sotto ? '<br>' : ''}<small>💡 consigliato: ${esc(c.fornitore)} ${esc(d.length > 48 ? d.slice(0, 47) + '…' : d)} a ${eur(c.costo)} ` +
                    `(<b>−${eur(tonda(r.costo - c.costo))}</b>)</small>`;
            }
            return `<div class="acc-pezzo"><div class="riga"><span><b>${esc(r.tipo)}</b> · ${esc(r.fornitore || '')} ${esc(nome)}</span><span>${val}</span></div>${sotto ? `<div>${sotto}</div>` : ''}</div>`;
        }).join('');
    }

    // L'utile si scrive solo se ci sono i costi di tutti i pezzi: con costi mancanti sarebbe gonfiato (29/09)
    function rigaUtile(u, nMancanti) {
        if (nMancanti > 0) {
            return `<div class="riga forte"><span>Utile</span><span class="acc-incompleto">da calcolare: ` +
                `${nMancanti === 1 ? 'manca 1 costo' : `mancano ${nMancanti} costi`}</span></div>`;
        }
        return `<div class="riga forte"><span>Utile</span><span class="${u.lordo >= 0 ? 'acc-pos' : 'acc-neg'}">${eur(u.lordo)} · SRL ${eur(u.srl)}</span></div>`;
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
        return { totale: tonda(base + opzioni), pc: base, opzioni: tonda(opzioni), righeOpzioni, data: ord.created_at || '' };
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
.acc-incompleto{color:#f5b041;font-weight:700}
.acc-esito{font-weight:800;font-size:1.08em;letter-spacing:.2px;margin:0 0 6px;padding:4px 8px;border-radius:6px}
.acc-esito.pos{background:rgba(46,204,113,.22);color:#abebc6}
.acc-esito.basso{background:rgba(241,196,15,.18);color:#f9e79f}
.acc-esito.neg{background:rgba(231,76,60,.25);color:#f5b7b1}
.acc-esito.incompleto{background:rgba(245,176,65,.18);color:#f5b041}
.acc-conto .riga.meno span:first-child{padding-left:6px;opacity:.85}
.acc-conto .riga.sub{border-top:1px solid rgba(255,255,255,.18);font-weight:600}
.acc-conto .riga.forte{border-top:1px solid rgba(255,255,255,.35);margin-top:2px}
.acc-dettaglio{margin:6px 0}.acc-dettaglio summary{cursor:pointer;font-weight:600}
.acc-pezzo{padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.12)}
.acc-consiglio{margin:6px 0;padding:5px 8px;border-radius:6px;background:rgba(46,204,113,.12);border:1px solid rgba(46,204,113,.35)}
.acc-barra{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.15)}
.acc-barra button{padding:9px 14px;border-radius:8px;font-weight:800;cursor:pointer;border:1px solid rgba(255,255,255,.35);color:#fff;background:rgba(52,152,219,.35)}
.acc-barra button.acc-btn-conferma{background:rgba(46,204,113,.35)}
.acc-barra button:disabled{opacity:.5;cursor:wait}
.acc-barra-stato{color:#fff;font-size:.9em;opacity:.9}
.acc-acquistato{margin:6px 0;padding:5px 8px;border-radius:6px;background:rgba(46,204,113,.16);border:1px solid rgba(46,204,113,.45)}
.acc-finestra{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10050;display:flex;align-items:center;justify-content:center}
.acc-finestra-box{background:#15181d;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:18px;width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column}
.acc-finestra-box h3{margin:0 0 10px}
.acc-finestra-corpo{overflow:auto;font-size:.9em;line-height:1.5}
.acc-finestra-bottoni{display:flex;gap:10px;justify-content:flex-end;margin-top:12px}
.acc-finestra-bottoni button{padding:9px 16px;border-radius:8px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff}
.acc-finestra-bottoni button[data-si]{background:rgba(46,204,113,.45)}
.acc-fin-ordine{margin:8px 0;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.05)}
.acc-fin-riga{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.1)}
.acc-prezzo{width:90px;padding:3px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;text-align:right}
.acc-extra{margin:6px 0;padding:5px 8px;border-radius:6px;background:rgba(52,152,219,.14);border:1px solid rgba(52,152,219,.35)}
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
@media (max-width:760px){.acc-tabella .col-cliente,.acc-tabella .col-disp{display:none}.acc-tabella td.col-excel,.acc-tabella th.col-excel{font-size:.9em;max-width:78px}}
.acc-menu{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 4px}
.acc-menu button{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:7px;padding:3px 8px;font-size:.92em;font-weight:600;cursor:pointer;line-height:1.4}
.acc-menu button:hover{background:rgba(255,255,255,.2)}
.acc-menu button.attivo{background:rgba(52,152,219,.5);border-color:#5dade2}
.acc-menu button.allerta{border-color:#f1c40f;color:#f9e79f}
.acc-sez{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15)}
.acc-sez[hidden]{display:none}
.acc-conto .riga{align-items:baseline}
.acc-conto .riga .val{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}
.acc-conto .riga.pagato{font-weight:700}
.acc-conto .riga.nota span{font-size:.88em;opacity:.7;padding-left:6px}
.acc-conto .riga.finale{border-top:2px solid rgba(255,255,255,.45);margin-top:3px;padding-top:2px;font-weight:800;font-size:1.12em}
.acc-conto .riga.finale small{font-weight:400;font-size:.72em;opacity:.75}
.acc-conto .riga.obiettivo{font-size:.95em}
.acc-acquistati-mini{font-size:.85em;color:#abebc6;margin:-2px 0 4px}
.acc-riga-opzione{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.acc-opz-testo{flex:1;overflow:hidden;display:flex;align-items:center;flex-wrap:nowrap;min-width:0}
.acc-opz-testo strong{color:#5dade2;font-size:.9em;white-space:nowrap}
.acc-opz-testo span{color:rgba(255,255,255,.95);padding:2px 4px;font-size:.88em;font-weight:600;margin-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acc-opz-testo em{font-style:normal;font-size:.8em;margin-left:6px;white-space:nowrap}
.acc-opz-forn{padding:2px 4px;border-radius:4px;font-size:.75em;font-weight:600;border:1px solid;min-width:28px;text-align:center;display:inline-block;flex-shrink:0}
.acc-rf-modi{display:flex;gap:8px;margin:14px 0 6px}
.acc-rf-modi button{flex:1;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:10px;padding:8px 6px;cursor:pointer;font-weight:700;font-size:.9em;line-height:1.25}
.acc-rf-modi button small{display:block;font-weight:400;font-size:.8em;color:rgba(255,255,255,.75)}
.acc-rf-modi button.attivo{background:rgba(52,152,219,.55);border-color:#5dade2;box-shadow:0 0 0 2px rgba(93,173,226,.35)}
.acc-rf-scrivania{font-weight:700;font-size:1.05em;margin:6px 0}
.acc-rf-lato{text-align:left;margin-top:12px;font-size:.9em}
.acc-rf-tot{background:rgba(0,0,0,.25);border-radius:10px;padding:8px 10px;margin-bottom:8px}
.acc-rf-tot small{display:block;color:rgba(255,255,255,.7)}.acc-rf-tot b{font-size:1.4em}
.acc-rf-forn-riga{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.1)}
.acc-rf-forn-riga>span:not(.acc-forn){flex:1;color:#fff}
.acc-rf-forn-riga .acc-forn,.acc-rf-forn .acc-forn{flex:none}
.acc-rf-forn{margin:10px 0 2px;padding-bottom:3px;border-bottom:1px solid rgba(255,255,255,.2)}
.acc-rf-forn small{color:rgba(255,255,255,.8);font-size:.85em}
.acc-rf-forn:first-child{margin-top:0}
.acc-rf-costo{margin-left:auto;font-weight:700;white-space:nowrap;color:#fff}
#riepilogo-auto .acc-nota{color:rgba(255,255,255,.65)}
@media (max-width:900px){#suppliers-container.active{flex-direction:column;align-items:stretch}#suppliers-container .suppliers-section-header{max-width:none}}
.acc-rf-cambio{color:#f7dc6f;font-size:.82em;margin-top:3px}
.acc-rf-avviso{color:#ff8a80;font-size:.82em;font-weight:700;margin-top:3px}
.acc-rf-copia{width:100%;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;padding:9px 14px;border-radius:8px;cursor:pointer;font-weight:600;font-size:.9em;margin-top:8px}
.acc-rf-copia:hover{background:rgba(255,255,255,.25)}
.acc-rf-copia.acc-rf-mini{width:auto;padding:2px 8px;margin:0;font-size:.8em}
.acc-rf-viste{display:flex;gap:6px;margin:8px 0}
.acc-rf-viste button{flex:1;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.28);color:#fff;border-radius:8px;padding:6px;cursor:pointer;font-weight:700;font-size:.88em}
.acc-rf-viste button.attivo{background:rgba(46,204,113,.35);border-color:rgba(46,204,113,.8)}
.acc-rf-nome{background:none;border:0;padding:0;cursor:pointer}
.acc-rf-nome:hover .acc-forn{filter:brightness(1.25);text-decoration:underline}
.acc-rf-forn-riga.scelto{background:rgba(255,255,255,.1);border-radius:6px}
.acc-rf-cat{font-size:.72em;font-weight:700;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.15);color:#fff;white-space:nowrap}
.acc-rf-azioni{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}
.acc-rf-azione{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:2px 8px;font-size:.78em;font-weight:600;cursor:pointer;text-decoration:none}
.acc-rf-azione:hover{background:rgba(255,255,255,.25)}
#riepilogo-auto .supplier-item-name{margin-top:2px}`;
        document.head.appendChild(st);
    }

    // ================================================================ PAGINA MANUALE
    function righe(orderId) {
        return Array.from(document.querySelectorAll(`.component-row[data-order-id="${orderId}"]`));
    }

    function manualeDellaRiga(row) {
        const span = row.querySelector('.component-name-display');
        const badge = row.querySelector('.supplier-badge-clickable');
        return { ean: span ? span.dataset.ean : '', fornitore: badge ? badge.dataset.supplier : '',
            nome: span ? String(span.textContent || '').trim() : '' };
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

    // 30/09 «a scalare»: un ordine con piu' PC uguali puo' prendere un pezzo da piu' fornitori (auto_parti: quanti PC
    // da ognuno, nell'ordine in cui si prendono). Il PC numero «unita» (da 0) prende la sua parte.
    function parteDellUnita(p, unita) {
        if (!p || !p.auto || !Array.isArray(p.auto_parti) || !p.auto_parti.length) return p;
        let primo = 0;
        for (const parte of p.auto_parti) {
            const k = Math.max(1, parseInt(parte.pc, 10) || 1);
            if (unita < primo + k) {
                const { pc, ...a } = parte;
                return { ...p, auto: { ...p.auto, ...a }, costo: parte.costo != null ? parte.costo : p.costo };
            }
            primo += k;
        }
        return p;
    }

    // PC accoppiato dall'automatico per questo ordine (orderId «123» o «123.2» per il secondo PC)
    function pcAutomatico(dati, orderId) {
        if (!dati || !dati.ordini) return null;
        const [idBase, n] = String(orderId).split('.');
        const o = dati.ordini[idBase];
        if (!o || !o.pc) return null;
        // 30/09: il gestionale fa un PC per unita' (riga con quantita' 2 -> .1 e .2), l'automatico una voce per riga
        const indice = (parseInt(n, 10) || 1) - 1;
        let primo = 0;
        for (const pc of o.pc) {
            const q = Math.max(1, parseInt(pc.quantita, 10) || 1);
            if (indice < primo + q) {
                const unita = indice - primo;
                return (pc.pezzi || []).some(x => x && Array.isArray(x.auto_parti) && x.auto_parti.length)
                    ? { ...pc, unita, pezzi: pc.pezzi.map(x => parteDellUnita(x, unita)) } : pc;
            }
            primo += q;
        }
        return null;
    }

    // Costo di oggi quando il pezzo della scheda e' proprio quello scelto dall'automatico (voce o ordine)
    function sceltaUguale(v, auto, tipo, ean) {
        const c = chiave(ean);
        if (!c) return null;
        if (v && v.auto && v.auto.costo != null && chiave(v.auto.codice) === c) return v.auto.costo;
        const t = TIPI[tipo] || tipo;
        const p = auto && Array.isArray(auto.pezzi)
            ? auto.pezzi.find(x => x.tipo === t && x.auto && x.auto.costo != null && chiave(x.auto.codice) === c) : null;
        return p ? p.auto.costo : null;
    }

    async function aggiornaOrdine(orderId) {
        const ctx = contesti[orderId];
        if (!ctx) return;
        stile();
        let dati = null;
        try { dati = await carica(); } catch (e) { /* mostrato nel riquadro */ }
        const conti = { man: 0, mancanti: [], stime: 0, righe: [] };
        const auto = pcAutomatico(dati, orderId);
        const salvati = leggiLS(K_FISSI, {});
        for (const row of righe(orderId)) {
            const tipo = row.dataset.componentType;
            const man = manualeDellaRiga(row);
            const v = dati ? voceAutomatica(dati, ctx, tipo, man.ean, man.fornitore) : null;
            const sch = costoScheda(dati, man.ean, man.fornitore);
            let costo = null, stima = false, fonte = null;
            const pagato = prezzoAcquisto(orderId, tipo, man.ean);
            // 30/09 (Antonio: «il gestionale mi ha detto di non sapere il costo del kit»): conta sempre il pezzo scritto
            // nella scheda. La voce dell'opzione del cliente vale solo se la scheda ha proprio quel pezzo; altrimenti
            // vale la voce del pezzo della scheda (per codice) o il pezzo dell'automatico per quella riga (case ATX
            // della regola del gestionale, kit e monitor dei bundle, dissipatore del colore del case).
            const scelto = sceltaUguale(v, auto, tipo, man.ean);
            const vStesso = v && v.manuale && chiave(v.manuale.codice) === chiave(man.ean) ? v : vocePerCodice(dati, ctx, tipo, man.ean, man.fornitore);
            const pRiga = pezzoDellaRiga(auto, tipo, man.ean);
            const mag = costoMagazzino(auto, tipo, man.ean);
            if (pagato != null) { costo = pagato; fonte = 'acquistato'; }
            else if (mag != null) { costo = mag; fonte = 'magazzino'; }     // a terra: prezzo pagato, come nell'Excel
            else if (vStesso && vStesso.manuale && vStesso.manuale.costo != null && chiave(vStesso.manuale.codice) === chiave(man.ean)) { costo = vStesso.manuale.costo; fonte = 'listino'; }
            else if (scelto != null) { costo = scelto; fonte = 'listino'; }
            else if (pRiga && pRiga.manuale && pRiga.manuale.costo != null) { costo = pRiga.manuale.costo; fonte = 'listino'; }
            else if (costoManualeSalvato(tipo, man.ean) != null) { costo = costoManualeSalvato(tipo, man.ean); fonte = 'inserito'; }
            else if (pRiga && !pRiga.auto && costoPezzo(pRiga, salvati).costo != null) { costo = costoPezzo(pRiga, salvati).costo; fonte = 'fisso'; }
            else if (vStesso && vStesso.fisso && vStesso.fisso.costo != null) { costo = vStesso.fisso.costo; fonte = 'fisso'; }
            else if (sch && sch.costo != null && sch.fonte === 'listino') { costo = sch.costo; fonte = 'listino'; }
            else if (pRiga && costoPezzo(pRiga, salvati).costo != null) { costo = costoPezzo(pRiga, salvati).costo; stima = true; fonte = 'stima'; }
            else if (sch && sch.costo != null) { costo = sch.costo; stima = true; fonte = 'altro'; }
            else if (v && v.manuale && v.manuale.costo != null) { costo = v.manuale.costo; stima = true; fonte = 'stima'; }
            else if (v && v.fisso && v.fisso.costo != null) { costo = v.fisso.costo; stima = true; fonte = 'stima'; }
            else if (v && v.auto && v.auto.costo != null) { costo = v.auto.costo; stima = true; fonte = 'stima'; }
            else if (costoEquivalente(auto, tipo, salvati) != null) { costo = costoEquivalente(auto, tipo, salvati); stima = true; fonte = 'stima'; }
            conti.righe.push({ tipo, ean: man.ean, fornitore: man.fornitore, nome: man.nome, costo, fonte,
                consigliato: consigliato(auto, tipo, salvati) });
            if (costo == null) conti.mancanti.push({ tipo, ean: man.ean });
            else { conti.man += costo; if (stima) conti.stime++; }
        }
        conti.confermato = acquistoConfermato(orderId);
        ultimiConti[orderId] = conti;
        await mostraUtile(orderId, conti, dati);
    }

    async function mostraUtile(orderId, conti, dati) {
        const el = box(orderId);
        if (!el) return;
        let ordini = [];
        try { ordini = JSON.parse(sessionStorage.getItem('shopify_orders') || '[]'); } catch (e) { ordini = []; }
        const vendita = prezzoVendita(orderId, ordini);
        let extra = 0, vociPers = [];
        try {
            const voci = typeof loadCustomItemsFromDB === 'function' ? await loadCustomItemsFromDB(orderId) : [];
            vociPers = voci || [];
            for (const it of voci || []) {
                const p = parseFloat(it.price ?? it.prezzo);
                if (p > 0) extra += p * (parseInt(it.quantity ?? it.quantita, 10) || 1);
            }
        } catch (e) { /* voci personalizzate non leggibili */ }
        const auto = pcAutomatico(dati, orderId);
        const servizi = tonda(serviziPc(auto).reduce((t, x) => t + (x.costo || 0), 0));
        const extraLista = extraOrdine(auto, righe(orderId).map(row => row.dataset.componentType), vociPers, leggiLS(K_FISSI, {}));
        try { righeOpzioniScheda(orderId, extraLista); } catch (e) { console.warn('[ACCOPPIAMENTO] opzioni', e); }
        const costoExtra = tonda(extraLista.reduce((t, x) => t + (x.costo || 0), 0));
        const extraMancanti = extraLista.filter(x => x.costo == null).length;
        const costo = conti.man + extra + servizi + costoExtra;
        const avvisi = auto && auto.avvisi && auto.avvisi.length
            ? `<div class="acc-avvisi">⚠ ${auto.avvisi.map(esc).join('<br>⚠ ')}<br><small>L'ordine è stato comprato così: controlla la distinta prima di ordinare.</small></div>` : '';
        if (!vendita) {
            el.className = 'acc-utile';
            el.innerHTML = `<div class="riga"><span>Costo pezzi (manuale)</span><span class="forte">${eur(costo)}</span></div>` +
                `<div class="mancanti">Prezzo di vendita non trovato per questo ordine: utile non calcolabile.</div>` + avvisi;
            return;
        }
        const lista = conti.mancanti;
        const nMancanti = lista.length + extraMancanti;
        const u = utile(vendita.totale, costo);
        el.className = 'acc-utile ' + (nMancanti ? 'incompleto' : (u.lordo < 0 ? 'neg' : 'pos'));
        const perche = !auto && stato.errore
            ? ` I costi dei pezzi arrivano dai dati automatici (${esc(stato.errore)}): appena ci sono l'utile si calcola da solo.`
            : '';
        const mancanti = lista.length
            ? `<div class="mancanti">Mancano i costi di: ${lista.map((m, i) =>
                `<a data-i="${i}" title="Inserisci il costo netto di questo pezzo">${esc(m.tipo)}</a>`).join(', ')} <small>(clic sul nome per inserire il costo netto)</small>.${perche}</div>`
            : '';
        const ca = auto ? contiPc(auto, leggiLS(K_FISSI, {})) : null;
        let acquistato = '', consiglio = '';
        if (conti.confermato) {
            const senzaPrezzo = conti.righe.filter(r => r.fonte !== 'acquistato').length;
            acquistato = `<div class="acc-acquistato">✅ Pezzi acquistati: nei conti ci sono i prezzi pagati` +
                (senzaPrezzo ? ` <small>(${senzaPrezzo === 1 ? '1 pezzo cambiato dopo, a prezzo di oggi' : `${senzaPrezzo} pezzi cambiati dopo, a prezzo di oggi`})</small>` : '') +
                ` · <a class="acc-link" data-sblocca="1" title="I prezzi pagati si cancellano e si torna ai prezzi di oggi">annulla conferma</a></div>`;
        } else if (auto && !nMancanti && !ca.mancanti.length && ca.utile.srl - u.srl >= 5) {
            consiglio = `<div class="acc-consiglio">💡 Con i pezzi consigliati dall'Automatico l'utile SRL sarebbe <b>${eur(ca.utile.srl)}</b> ` +
                `(+${eur(tonda(ca.utile.srl - u.srl))}), se non li hai ancora comprati: «AGGIORNA PREZZI PRODOTTO» li propone</div>`;
        }
        const nonDisponibile = !auto && stato.errore && !conti.mancanti.length
            ? `<div class="riga"><small>Automatico non disponibile: ${esc(stato.errore)}</small></div>` : '';
        const diversi = pezziDiversi(righe(orderId).map(row => ({ tipo: row.dataset.componentType, ean: manualeDellaRiga(row).ean })), auto);
        const oggi = auto && auto.listino_oggi != null && Math.abs(Number(auto.listino_oggi) - vendita.pc) >= 1
            ? `<div class="riga nota"><span>Oggi la build è a ${eur(Number(auto.listino_oggi))} sul sito</span></div>` : '';
        const costi = [
            { testo: conti.confermato ? 'Pezzi acquistati <small>(prezzi pagati)</small>'
                : `Pezzi della scheda <small>(prezzi di oggi${conti.stime ? `, ${conti.stime} stimati` : ''})</small>`, valore: tonda(conti.man + extra), sempre: true },
            { testo: `Opzioni fuori scheda <small>(${esc(extraLista.map(x => x.nome).join(', '))})</small>`, valore: costoExtra },
            { testo: 'Montaggio e spedizione', valore: servizi, sempre: true },
        ];
        // 01/10: «il riquadretto … suddividerlo per menu: dei pulsanti che ci clicchi e si apre la parte interessata»
        const avvisiAuto = (auto && auto.avvisi) || [];
        const opzioniSenzaCosto = extraLista.filter(x => x.costo == null).map(x => x.nome);
        const mancantiOpzioni = opzioniSenzaCosto.length
            ? `<div class="mancanti">Manca il costo di: ${esc(opzioniSenzaCosto.join(', '))} <small>(inseriscilo in «➕ Opzioni»)</small></div>` : '';
        const nAvvisi = lista.length + opzioniSenzaCosto.length + diversi.length + avvisiAuto.length + (consiglio ? 1 : 0);
        const sezioni = [
            { id: 'conto', nome: '💶 Conto', html: `<div class="acc-conto">${contoOrdine({ ...vendita, data: vendita.data || (auto && auto.data) }, costi, nMancanti, auto ? auto.obiettivo : null)}${oggi}</div>` + acquistato },
            { id: 'pezzi', nome: '🔍 Pezzi', html: corpoPezzi(conti.righe, conti.confermato) + nonDisponibile },
            extraLista.length ? { id: 'opzioni', nome: `➕ Opzioni (${extraLista.length})`, html: righeExtra(extraLista) } : null,
            nAvvisi ? { id: 'avvisi', nome: `⚠ Avvisi (${nAvvisi})`, allerta: lista.length + opzioniSenzaCosto.length + diversi.length + avvisiAuto.length > 0,
                html: mancanti + mancantiOpzioni + righePezziDiversi(diversi, nMancanti ? null : utileConPezziGiusti(vendita.totale, costo, diversi, conti.righe)) + avvisi + consiglio } : null
        ].filter(Boolean);
        const aperta = sezioni.some(x => x.id === sezioniAperte[orderId]) ? sezioniAperte[orderId] : null;
        el.innerHTML =
            rigaEsito(u, nMancanti, auto ? auto.obiettivo : null) + (conti.confermato ? '<div class="acc-acquistati-mini">✅ pezzi acquistati</div>' : '') +
            `<div class="acc-menu">` + sezioni.map(x => `<button type="button" data-sez="${x.id}" class="${x.id === aperta ? 'attivo' : ''}${x.allerta ? ' allerta' : ''}">${x.nome}</button>`).join('') +
            `<button type="button" data-ordine-cliente="1" title="Gira la scheda: cosa ha comprato il cliente su Shopify">🧾 Ordine cliente</button>` +
            (auto ? `<button type="button" data-vai="${esc(String(orderId).split('.')[0])}" title="Apri quest'ordine nella pagina Automatico">↗ Automatico</button>` : '') + `</div>` +
            sezioni.map(x => `<div class="acc-sez" data-sez="${x.id}"${x.id === aperta ? '' : ' hidden'}>${x.html}</div>`).join('');
        el.querySelectorAll('.acc-menu [data-sez]').forEach(b => b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const id = b.dataset.sez;
            const giaAperta = sezioniAperte[orderId] === id;
            sezioniAperte[orderId] = giaAperta ? null : id;
            el.querySelectorAll('.acc-menu [data-sez]').forEach(x => x.classList.toggle('attivo', !giaAperta && x.dataset.sez === id));
            el.querySelectorAll('.acc-sez').forEach(x => { x.hidden = giaAperta || x.dataset.sez !== id; });
        }));
        el.querySelectorAll('[data-ordine-cliente]').forEach(b => b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const giro = el.closest('.flip-container');
            if (giro) giro.classList.add('flipped');
        }));
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
        el.querySelectorAll('[data-sblocca]').forEach(a => a.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (!confirm('Annullare la conferma di acquisto di questo PC?\nI prezzi pagati si cancellano e l\'utile torna ai prezzi di oggi.')) return;
            try {
                await salvaPrezzi(orderId, conti.righe.map(r => ({ type: r.tipo, ean: r.ean, price: null })));
                avvisa('Conferma di acquisto annullata', 'success');
            } catch (e) { avvisa('Conferma non annullata: ' + (e && e.message ? e.message : e), 'error'); }
            aggiornaOrdine(orderId);
        }));
        el.querySelectorAll('[data-extra]').forEach(a => a.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const x = extraLista[parseInt(a.dataset.extra, 10)];
            const val = prompt(`Costo netto (IVA esclusa) di ${x.nome}: ${x.descrizione}\n(vale per tutti gli ordini con questa opzione)`);
            const num = parseFloat(String(val || '').replace(',', '.'));
            if (!isNaN(num) && num >= 0) {
                const s = leggiLS(K_FISSI, {});
                s[x.chiave] = num;
                scriviLS(K_FISSI, s);
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
        try { barraScrivania(); } catch (e) { console.warn('[ACCOPPIAMENTO] barra', e); }
        aggiornaOrdine(orderId).catch(err => console.warn('[ACCOPPIAMENTO] ', err));
    }

    // ================================================================ SCRIVANIE E1–E4 (Antonio 30/09)
    // «Due pulsanti per ogni scrivania: AGGIORNA PREZZI PRODOTTO, che aggiorna in tempo reale i pezzi che
    // servono attraverso i nostri fornitori con le regole che conosci, e CONFERMA ACQUISTO PEZZI, quando
    // abbiamo comprato i pezzi dei PC di quella scrivania: fino ad allora si aggiorna quante volte si vuole.»
    const URL_AGGIORNA_LISTINI = 'https://minimal-gamers-listini-scheduler.theminimalgamers.workers.dev/aggiorna-listini';
    const ATTESA_LISTINI_MS = 9 * 60 * 1000;
    const ultimiConti = {};                      // orderId -> conti dell'ultimo calcolo del riquadro
    const sezioniAperte = {};                    // orderId -> sezione aperta nel riquadro (conto, pezzi, opzioni, avvisi)

    function componentiSalvati(orderId) {
        try {
            return (typeof processedOrdersCache !== 'undefined' && processedOrdersCache && processedOrdersCache[orderId]
                && processedOrdersCache[orderId].components) || [];
        } catch (e) { return []; }
    }

    // Prezzo pagato di un pezzo (colonna price, scritta da «CONFERMA ACQUISTO PEZZI»)
    function prezzoAcquisto(orderId, tipo, ean) {
        const c = componentiSalvati(orderId).find(x => x.type === tipo && chiave(x.ean) === chiave(ean));
        if (!c || c.price === null || c.price === undefined || c.price === '') return null;
        const n = Number(c.price);
        return isNaN(n) ? null : n;
    }

    const acquistoConfermato = (orderId) => componentiSalvati(orderId).some(x => x.price !== null && x.price !== undefined && x.price !== '');

    async function salvaPrezzi(orderId, prezzi) {
        const db = typeof window !== 'undefined' ? window.SupabaseDB : null;
        if (!db || typeof db.setComponentPrices !== 'function') throw new Error('database non pronto');
        await db.setComponentPrices(orderId, prezzi);
        for (const p of prezzi) {                  // stessa cosa nella copia in memoria del gestionale
            const c = componentiSalvati(orderId).find(x => x.type === p.type && chiave(x.ean) === chiave(p.ean))
                || (componentiSalvati(orderId).filter(x => x.type === p.type).length === 1 ? componentiSalvati(orderId).find(x => x.type === p.type) : null);
            if (c) c.price = p.price === null || p.price === undefined || p.price === '' ? null : Math.round(Number(p.price) * 100) / 100;
        }
    }

    function scrivaniaAttiva() {
        const t = document.querySelector('.tab-button.active');
        return ({ processed: 1, 'processed-e2': 2, 'processed-e3': 3, 'processed-e4': 4 })[t ? t.dataset.tab : ''] || null;
    }

    function ordiniScrivania() {
        return Array.from(document.querySelectorAll('#processed-container .order-card[data-order-id]'))
            .map(c => c.dataset.orderId).filter(id => contesti[id]);
    }

    function barraScrivania() {
        const cont = document.getElementById('processed-container');
        const n = scrivaniaAttiva();
        if (!cont || !n) return;
        const vecchia = cont.querySelector('.acc-barra');
        if (vecchia && vecchia.dataset.scrivania === String(n)) return;
        if (vecchia) vecchia.remove();
        stile();
        const b = document.createElement('div');
        b.className = 'acc-barra';
        b.dataset.scrivania = String(n);
        b.innerHTML = `<button type="button" class="acc-btn-aggiorna" title="Listini dei fornitori di adesso e pezzi migliori con le regole di sempre, per i PC non ancora acquistati">🔄 AGGIORNA PREZZI PRODOTTO</button>` +
            `<button type="button" class="acc-btn-conferma" title="Hai comprato i pezzi dei PC di questa scrivania: i prezzi pagati restano nei conti">✅ CONFERMA ACQUISTO PEZZI</button>` +
            `<span class="acc-barra-stato">Scrivania E${n}</span>`;
        cont.insertBefore(b, cont.firstChild);
        b.querySelector('.acc-btn-aggiorna').addEventListener('click', () => aggiornaScrivania(n, b));
        b.querySelector('.acc-btn-conferma').addEventListener('click', () => confermaScrivania(n, b));
    }

    // Finestra con due pulsanti; risolve con il contenitore se si preme il primo, con null altrimenti
    function finestra(titolo, corpo, si, no) {
        return new Promise(resolve => {
            stile();
            const ov = document.createElement('div');
            ov.className = 'acc-finestra';
            ov.innerHTML = `<div class="acc-finestra-box"><h3>${titolo}</h3><div class="acc-finestra-corpo">${corpo}</div>` +
                `<div class="acc-finestra-bottoni"><button type="button" data-no>${no}</button><button type="button" data-si>${si}</button></div></div>`;
            document.body.appendChild(ov);
            const chiudi = (ok) => { const c = ov.querySelector('.acc-finestra-corpo'); ov.remove(); resolve(ok ? c : null); };
            ov.querySelector('[data-si]').addEventListener('click', () => chiudi(true));
            ov.querySelector('[data-no]').addEventListener('click', () => chiudi(false));
        });
    }

    const oraBreve = (iso) => {
        const d = new Date(iso || '');
        return isNaN(d) ? '' : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    };

    // ================================================================ PEZZI MIGLIORI (Antonio 30/09)
    // «In background i pezzi esatti da ordinare ordine per ordine: per ogni build i modelli più vantaggiosi
    // economicamente, seguendo sempre tutte le regole, allineati all'Excel madre e alle varianti GPO. Nelle build
    // Minimal importa solo il chipset, il brand no; nelle MSI e DeepCool il brand preciso.»
    // Il pezzo dell'automatico (listini di oggi, fornitori con le regole del GPU Watch, scelte del cliente,
    // alimentatore per la scheda video) prende il posto di quello scritto nella scheda solo se rispetta anche:
    //   * il colore: pezzo bianco (o rosa) solo dove la scheda o il cliente lo vogliono, e viceversa
    //     (es. case bianco -> dissipatore bianco, regola del gestionale);
    //   * la marca della linea: build MSI -> scheda video MSI sempre; scheda madre, dissipatore, case e
    //     alimentatore MSI quando quello della scheda e' MSI o non si capisce di che marca e'; build DeepCool ->
    //     case, dissipatore e alimentatore DeepCool alle stesse condizioni. Minimal: il brand non conta;
    //   * la stessa quantita' (la scheda dell'assemblatore non mostra le quantita');
    //   * alimentatore mai meno potente di quello della scheda (regole del gestionale, es. doppio EPS).
    // All'assemblatore resta il chipset: scheda video, SSD e scheda madre si mostrano generici come sempre.
    const RE_BIANCO = /\b(WHITE|BIANC[OA]|SNOW)\b|-WH\b|\bWH\b/i;
    const RE_ROSA = /\b(PINK|ROSA)\b/i;
    const RE_MSI = /\bMSI\b|\bMAG\b(?!-)|\bMPG\b|\bMEG\b|\bVENTUS\b|\bINSPIRE\b|\bSUPRIM\b|\bSHADOW\s+\dX\b|\bGAMING\s+(X\s+)?TRIO\b|\bTOMAHAWK\b|\bMORTAR\b/i;
    const RE_DEEPCOOL = /DEEP\s*COOL/i;
    const RE_ALTRE_MARCHE = new RegExp('\\b(ASUS|ROG|TUF|GIGABYTE|AORUS|ASROCK|ZOTAC|PALIT|PNY|INNO3D|SAPPHIRE|POWERCOLOR|XFX|' +
        'GAINWARD|KFA2|GALAX|ARCTIC|NOCTUA|CORSAIR|NZXT|BE ?QUIET|THERMALRIGHT|COOLER ?MASTER|LIAN ?LI|ENDORFY|MARS ?GAMING|' +
        'KOLINK|THERMALTAKE|FRACTAL|PHANTEKS|MONTECH|SEASONIC|ANTEC|ID-?COOLING|XIGMATEK|ITEK|AEROCOOL|SHARKOON|NOUA|' +
        'DARK ?CAVE|ENERMAX|SILVERSTONE|FSP|SUPER ?FLOWER|HYTE|JONSBO|ZALMAN|COUGAR|SCYTHE|RAIJINTEK)\\b', 'i');
    const MARCA_LINEA = {
        MSI: { re: RE_MSI, sempre: ['GPU'], seSua: ['MOBO', 'COOLER', 'CASE', 'PSU'] },
        DEEPCOOL: { re: RE_DEEPCOOL, sempre: [], seSua: ['COOLER', 'CASE', 'PSU'] }
    };

    function coloreTesto(t) {
        const s = String(t || '');
        return RE_BIANCO.test(s) ? 'BIANCO' : (RE_ROSA.test(s) ? 'ROSA' : null);
    }

    const coloreRispettato = (scheda, nuovo) => coloreTesto(scheda) === coloreTesto(nuovo);

    function marcaRispettata(linea, tipo, scheda, nuovo) {
        const m = MARCA_LINEA[String(linea || '').toUpperCase()];
        if (!m) return true;                                        // Minimal: conta solo il chipset
        const serve = m.sempre.includes(tipo) ||
            (m.seSua.includes(tipo) && (m.re.test(scheda) || !RE_ALTRE_MARCHE.test(scheda)));
        return !serve || m.re.test(nuovo);
    }

    const stessaQuantita = (a, b) => (parseInt(a, 10) || 1) === (parseInt(b, 10) || 1);

    function rispettaScheda(linea, tipo, scheda, a, quantita) {
        const nuovo = [a.descrizione, a.codice, a.mpn].filter(Boolean).join(' ');
        if (!coloreRispettato(scheda, nuovo) || !marcaRispettata(linea, tipo, scheda, nuovo)) return false;
        if (!stessaQuantita(a.quantita, quantita)) return false;
        if (tipo === 'PSU') {
            const wScheda = wattAlimentatore(scheda), wNuovo = wattAlimentatore(nuovo);
            if (wScheda != null && (wNuovo == null || wNuovo < wScheda)) return false;
        }
        return true;
    }

    // Pezzo dell'automatico di quest'ordine da mettere al posto della riga r {tipo, ean, fornitore, nome,
    // quantita}, oppure null. «stessoPezzo»: solo se la riga e' ancora il pezzo di distinta/opzione che
    // l'automatico ha valutato (all'elaborazione: non si disfano le regole del gestionale sulla scheda).
    function sostitutoDaOrdine(auto, r, stessoPezzo) {
        if (!auto || !Array.isArray(auto.pezzi)) return null;
        const p = auto.pezzi.find(x => x.tipo === (TIPI[r.tipo] || r.tipo));
        if (!p) return null;
        const m = p.manuale || {};
        if (p.mag && chiave(m.codice) === chiave(r.ean)) return null;         // pezzo a magazzino: resta
        if (stessoPezzo && chiave(m.codice) !== chiave(r.ean)) return null;
        // 30/09: il case che la regola del gestionale vuole oggi (TOP o scheda madre cambiata: CASE ATX) quando nella
        // scheda c'e' ancora quello vecchio (es. NOUA Vitra M-ATX con una scheda madre ATX)
        if (!stessoPezzo && p.tipo === 'CASE' && /regola case/i.test(p.origine || '') && m.codice &&
            chiave(m.codice) !== chiave(r.ean) && !(p.auto && [p.auto.codice, p.auto.mpn].map(chiave).includes(chiave(r.ean)))) {
            const regolaCase = { ...p, auto: p.auto || { codice: m.codice, fornitore: m.fornitore || (p.fisso && p.fisso.fornitore) || 'ALTRO',
                descrizione: m.codice, costo: p.costo, quantita: 1, disponibilita: p.fisso ? 'budget del case (regola del gestionale)' : '' } };
            if (!regolaCase.auto.codice) return null;
            const schedaCase = [r.ean, r.nome, p.cliente].filter(Boolean).join(' ');
            return rispettaScheda(auto.linea, 'CASE', schedaCase, { ...regolaCase.auto, descrizione: `${regolaCase.auto.descrizione || ''} ${m.codice}` }, r.quantita) ? regolaCase : null;
        }
        if (!p.auto || !p.auto.codice || p.fisso) return null;
        const codici = [p.auto.codice, p.auto.mpn].filter(Boolean).map(chiave);
        const stessoFornitore = String(r.fornitore || '').toUpperCase().trim() === String(p.auto.fornitore || '').toUpperCase().trim();
        if (codici.includes(chiave(r.ean)) && stessoFornitore) return null;
        const scheda = [r.ean, r.nome, p.cliente, chiave(m.codice) === chiave(r.ean) ? m.descrizione : '']
            .filter(Boolean).join(' ');
        return rispettaScheda(auto.linea, p.tipo, scheda, p.auto, r.quantita) ? p : null;
    }

    // Stessa cosa quando l'ordine non e' ancora nei dati automatici (arrivato dopo l'ultimo aggiornamento):
    // la voce della distinta o dell'opzione GPO scelta dal cliente, per i pezzi dove conta il modello
    // equivalente (chipset e caratteristiche). Case e alimentatore restano quelli decisi dal gestionale.
    const TIPI_VOCE_MIGLIORE = ['GPU', 'CPU', 'RAM', 'SSD', 'SSD_EXTRA', 'MOBO', 'COOLER'];

    function sostitutoDaVoce(dati, ctx, c) {
        const tipo = TIPI[c.type] || c.type;
        if (!TIPI_VOCE_MIGLIORE.includes(tipo)) return null;
        const v = voceAutomatica(dati, ctx, c.type, c.ean, c.supplier);
        if (!v || !v.auto || !v.auto.codice || v.fisso) return null;
        const m = v.manuale || {};
        if (chiave(m.codice) !== chiave(c.ean)) return null;               // la voce non parla di questo pezzo
        const codici = [v.auto.codice, v.auto.mpn].filter(Boolean).map(chiave);
        const stessoFornitore = String(c.supplier || '').toUpperCase().trim() === String(v.auto.fornitore || '').toUpperCase().trim();
        if (codici.includes(chiave(c.ean)) && stessoFornitore) return null;
        const cliente = scelteCliente(c.type, ctx.variants).map(s => s.valore).join(' ');
        const scheda = [c.ean, c.name, cliente, m.descrizione].filter(Boolean).join(' ');
        return rispettaScheda(lineaDi(dati, ctx.configKey), tipo, scheda, v.auto, c.quantity) ? v.auto : null;
    }

    // Chiamata dal gestionale quando elabora un ordine, prima di salvare la scheda: cambia sul posto codice,
    // fornitore e nome dei pezzi. Se i dati automatici non arrivano in 8 secondi la scheda resta com'e'.
    // Ritorna i cambi fatti: [{ tipo, da: {ean, fornitore}, a: {codice, fornitore, descrizione} }].
    async function pezziMigliori(componenti, ctx, orderId) {
        const cambi = [];
        if (!Array.isArray(componenti) || !componenti.length || !ctx || !ctx.configKey) return cambi;
        let dati = null, timer = null;
        try {
            dati = await Promise.race([carica(), new Promise((_, no) => { timer = setTimeout(() => no(new Error('tempo scaduto')), 8000); })]);
        } catch (e) {
            return cambi;
        } finally {
            if (timer) clearTimeout(timer);
        }
        if (!dati) return cambi;
        const variants = ctx.variants || {};
        const auto = orderId != null ? pcAutomatico(dati, orderId) : null;
        const autoGiusto = auto && Array.isArray(auto.pezzi) && (!auto.build || auto.build === ctx.configKey) ? auto : null;
        for (const c of componenti) {
            const tipo = TIPI[c.type] || c.type;
            if (!tipo || TIPI_EXTRA.includes(tipo) || tipo === 'MONITOR' || c.isCustom || c.is_custom) continue;
            let a = null;
            if (autoGiusto) {
                const p = sostitutoDaOrdine(autoGiusto, { tipo: c.type, ean: c.ean, fornitore: c.supplier, nome: c.name,
                    quantita: c.quantity }, true);
                a = p ? p.auto : null;
            } else {
                a = sostitutoDaVoce(dati, { configKey: ctx.configKey, variants }, c);
            }
            if (!a) continue;
            cambi.push({ tipo: c.type, da: { ean: c.ean, fornitore: c.supplier || '' },
                a: { codice: a.codice, fornitore: a.fornitore, descrizione: a.descrizione || '' } });
            c.ean = a.codice;
            c.supplier = a.fornitore || c.supplier;
            c.name = a.descrizione || c.name || null;
        }
        return cambi;
    }

    // Pezzi della scheda da cambiare con quelli che l'automatico sceglie oggi (regole di sempre: fornitori
    // prioritari, marca MSI/DeepCool, alimentatore per la scheda video, RAM, scelte del cliente…). Restano come
    // sono i pezzi a magazzino, quelli a budget fisso (case, Amazon…) e quelli senza una scelta automatica.
    function proposteOrdine(dati, orderId, righeScheda) {
        const auto = pcAutomatico(dati, orderId);
        if (!auto || !Array.isArray(auto.pezzi)) return [];
        const out = [];
        for (const r of righeScheda) {
            const salvato = componentiSalvati(orderId).find(x => x.type === r.tipo && chiave(x.ean) === chiave(r.ean));
            // nome salvato, non quello mostrato (la scheda aggiunge il colore del case a scheda video e madre)
            const p = sostitutoDaOrdine(auto, { tipo: r.tipo, ean: r.ean, fornitore: r.fornitore,
                nome: salvato ? salvato.name : '', quantita: salvato ? salvato.quantity : 1 });
            if (!p) continue;
            out.push({ orderId, ordine: (dati.ordini[String(orderId).split('.')[0]] || {}).nome || `#${orderId}`,
                tipo: r.tipo, da: { ean: r.ean, fornitore: r.fornitore, nome: r.nome, costo: r.costo, fonte: r.fonte },
                a: { codice: p.auto.codice, fornitore: p.auto.fornitore, descrizione: p.auto.descrizione || p.auto.codice,
                    costo: p.auto.costo, disponibilita: p.auto.disponibilita, daConfermare: !!p.auto.da_confermare } });
        }
        return out;
    }

    function tabellaProposte(proposte) {
        const perOrdine = {};
        for (const x of proposte) (perOrdine[x.ordine] = perOrdine[x.ordine] || []).push(x);
        let risparmio = 0;
        const html = Object.entries(perOrdine).map(([nome, lista]) => `<div class="acc-fin-ordine"><b>${esc(nome)}</b>` +
            lista.map(x => {
                let d = x.da.costo != null && x.a.costo != null ? tonda(x.da.costo - x.a.costo) : null;
                if (d != null && Math.abs(d) < 0.005) d = null;
                if (d != null) risparmio += d;
                return `<div class="acc-fin-riga"><span><b>${esc(x.tipo)}</b>: ${esc(x.da.fornitore || '')} ${esc(x.da.nome || x.da.ean)}` +
                    `${x.da.costo != null ? ` (${x.da.fonte === 'stima' ? '≈ ' : ''}${eur(x.da.costo)})` : ''}<br>→ ${esc(x.a.fornitore)} ${esc(x.a.descrizione)} ` +
                    `<b>${eur(x.a.costo)}</b> <small>${esc(x.a.disponibilita || '')}</small></span>` +
                    `<span class="${d != null && d > 0 ? 'acc-pos' : (d != null && d < 0 ? 'acc-neg' : '')}">${d == null ? '' : (d > 0 ? `−${eur(d)}` : `+${eur(-d)}`)}</span></div>`;
            }).join('') + `</div>`).join('');
        return { html, risparmio: tonda(risparmio) };
    }

    // Le modifiche fatte a mano in questo browser (ean_modifications / supplier_modifications di app.js)
    // coprirebbero il pezzo nuovo appena salvato: per quel pezzo si tolgono.
    function pulisciModificheLocali(orderId, tipo) {
        for (const k of ['ean_modifications', 'supplier_modifications']) {
            const m = leggiLS(k, {});
            if (m && m[orderId] && m[orderId][tipo] !== undefined) {
                delete m[orderId][tipo];
                scriviLS(k, m);
            }
        }
    }

    async function aggiornaScrivania(n, barra) {
        const scrivi = (t) => { const s = barra.querySelector('.acc-barra-stato'); if (s) s.textContent = t; };
        const bottoni = Array.from(barra.querySelectorAll('button'));
        bottoni.forEach(x => { x.disabled = true; });
        try {
            const ids = ordiniScrivania().filter(id => !acquistoConfermato(id));
            if (!ids.length) { scrivi(`E${n}: i PC di questa scrivania hanno già i pezzi acquistati.`); return; }
            // 1) listini dei fornitori di adesso (lo stesso aggiornamento che parte da solo ogni mezz'ora)
            scrivi(`E${n}: chiedo ai fornitori i listini di adesso…`);
            let esito = null;
            try {
                const r = await fetch(URL_AGGIORNA_LISTINI, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: password() || '' }) });
                esito = await r.json();
            } catch (e) { esito = { stato: 'errore' }; }
            let dati = await carica(true);
            const prima = dati && dati.generato;
            if (esito && (esito.stato === 'avviato' || esito.stato === 'in_corso')) {
                const inizio = Date.now();
                while (Date.now() - inizio < ATTESA_LISTINI_MS) {
                    const sec = Math.round((Date.now() - inizio) / 1000);
                    scrivi(`E${n}: listini in aggiornamento dai fornitori (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}, di solito 4-5 minuti)…`);
                    await new Promise(r => setTimeout(r, 20000));
                    try { dati = await carica(true); } catch (e) { /* si riprova */ }
                    if (dati && dati.generato && dati.generato !== prima) break;
                }
            }
            const quando = oraBreve(dati && dati.generato);
            const nota = !esito || esito.stato === 'errore' || esito.stato === 'non_autorizzato'
                ? ' (aggiornamento dei fornitori non partito: uso gli ultimi listini)' : '';
            // 2) prezzi di adesso in ogni riquadro
            for (const id of ids) await aggiornaOrdine(id);
            // 3) pezzi migliori di oggi
            const proposte = [];
            for (const id of ids) proposte.push(...proposteOrdine(dati, id, (ultimiConti[id] && ultimiConti[id].righe) || []));
            if (!proposte.length) {
                scrivi(`E${n}: prezzi aggiornati con i listini delle ${quando}${nota}. I pezzi sono già i migliori di oggi.`);
                return;
            }
            const t = tabellaProposte(proposte);
            const corpo = `<p>Listini delle ${esc(quando)}${esc(nota)}. Con le regole di sempre questi pezzi oggi conviene prenderli così` +
                `${t.risparmio > 0 ? ` (<b>${eur(t.risparmio)} in meno</b> in totale)` : ''}:</p>${t.html}` +
                `<p><small>I PC con i pezzi già acquistati non si toccano. Se un pezzo l'hai già comprato, premi «Lascia così» e poi «CONFERMA ACQUISTO PEZZI».</small></p>`;
            const ok = await finestra(`🔄 Scrivania E${n}: ${proposte.length === 1 ? '1 pezzo da cambiare' : `${proposte.length} pezzi da cambiare`}`, corpo, 'Cambia i pezzi', 'Lascia così');
            if (!ok) { scrivi(`E${n}: prezzi aggiornati con i listini delle ${quando}${nota}. Pezzi lasciati come sono.`); return; }
            let fatti = 0;
            for (const x of proposte) {
                const salvato = typeof updateProcessedOrderComponent === 'function'
                    ? await updateProcessedOrderComponent(x.orderId, x.tipo, x.a.codice, x.a.descrizione, x.a.fornitore) : false;
                if (salvato) { fatti++; pulisciModificheLocali(x.orderId, x.tipo); }
            }
            scrivi(`E${n}: ${fatti} di ${proposte.length} pezzi cambiati con i listini delle ${quando}. Ricarico le schede…`);
            if (typeof loadProcessedOrdersFromDB === 'function') await loadProcessedOrdersFromDB();
            if (typeof renderProcessedOrders === 'function' && typeof getFilteredProcessedOrdersMap === 'function'
                && typeof processedOrdersMap !== 'undefined' && typeof getActiveWorksheetTab === 'function') {
                await renderProcessedOrders(getFilteredProcessedOrdersMap(processedOrdersMap, getActiveWorksheetTab()));
            }
            avvisa(`E${n}: ${fatti} pezzi aggiornati${fatti < proposte.length ? ` (${proposte.length - fatti} non salvati: riprova)` : ''}`, fatti === proposte.length ? 'success' : 'error');
        } catch (e) {
            scrivi(`E${n}: aggiornamento non riuscito (${e && e.message ? e.message : e}). Riprova.`);
        } finally {
            bottoni.forEach(x => { x.disabled = false; });
        }
    }

    async function confermaScrivania(n, barra) {
        const scrivi = (t) => { const s = barra.querySelector('.acc-barra-stato'); if (s) s.textContent = t; };
        const ids = ordiniScrivania().filter(id => !acquistoConfermato(id));
        if (!ids.length) { scrivi(`E${n}: non ci sono PC da confermare (sono già tutti acquistati).`); return; }
        for (const id of ids) await aggiornaOrdine(id);
        let dati = null;
        try { dati = await carica(); } catch (e) { /* nomi dal gestionale */ }
        const blocchi = ids.map(id => {
            const conti = ultimiConti[id];
            if (!conti || !conti.righe.length) return '';
            const nome = (dati && dati.ordini && (dati.ordini[String(id).split('.')[0]] || {}).nome) || `#${id}`;
            return `<div class="acc-fin-ordine"><label><input type="checkbox" data-ordine="${esc(id)}" checked> <b>${esc(nome)}</b></label>` +
                conti.righe.map((r, i) => `<div class="acc-fin-riga"><span><b>${esc(r.tipo)}</b>: ${esc(r.fornitore || '')} ${esc(r.nome || r.ean)}` +
                    `${r.fonte === 'stima' || r.fonte === 'altro' ? ' <small class="acc-incompleto">≈ stimato: metti il prezzo pagato</small>' : ''}</span>` +
                    `<span><input type="text" inputmode="decimal" class="acc-prezzo" data-ordine="${esc(id)}" data-i="${i}" value="${r.costo == null ? '' : String(r.costo).replace('.', ',')}"> €</span></div>`).join('') +
                `</div>`;
        }).join('');
        const corpo = `<p>Prezzi <b>netti (IVA esclusa)</b> pagati per ogni pezzo: sono già scritti quelli di oggi, correggi quelli diversi. ` +
            `Da qui in poi l'utile di questi PC usa i prezzi pagati e «AGGIORNA PREZZI PRODOTTO» non li tocca più.</p>${blocchi}`;
        const c = await finestra(`✅ Scrivania E${n}: conferma acquisto pezzi`, corpo, 'Confermo: pezzi acquistati', 'Annulla');
        if (!c) return;
        const scelti = Array.from(c.querySelectorAll('input[type=checkbox][data-ordine]')).filter(x => x.checked).map(x => x.dataset.ordine);
        let fatti = 0, errori = 0;
        for (const id of scelti) {
            const conti = ultimiConti[id];
            const prezzi = Array.from(c.querySelectorAll(`input.acc-prezzo[data-ordine="${CSS.escape(String(id))}"]`))
                .map(inp => ({ r: conti.righe[parseInt(inp.dataset.i, 10)], v: String(inp.value || '').trim().replace(/\s|€/g, '').replace(',', '.') }))
                .filter(x => x.r && x.v !== '' && !isNaN(Number(x.v)))
                .map(x => ({ type: x.r.tipo, ean: x.r.ean, price: Number(x.v) }));
            if (!prezzi.length) continue;
            try { await salvaPrezzi(id, prezzi); fatti++; } catch (e) { errori++; }
            aggiornaOrdine(id);
        }
        scrivi(`E${n}: acquisto confermato per ${fatti === 1 ? '1 PC' : `${fatti} PC`}${errori ? `, ${errori} non salvati (riprova)` : ''}.`);
        avvisa(`E${n}: acquisto confermato per ${fatti} PC${errori ? `, ${errori} non salvati` : ''}`, errori ? 'error' : 'success');
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
        // 30/09: pezzo diviso tra piu' fornitori per i PC della riga: costo medio per PC calcolato dall'automatico
        if (p.auto && Array.isArray(p.auto_parti) && p.auto_parti.length && p.costo != null) return { costo: p.costo, fonte: 'auto' };
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
    // I pezzi senza offerta ordinabile oggi finiscono sotto «DA DECIDERE». Un ordine con piu' PC uguali conta i pezzi
    // di tutti i suoi PC; un pezzo diviso tra piu' fornitori (30/09, «a scalare») va da ognuno con i suoi pezzi.
    function riepilogoFornitori(dati, idOrdini, salvati) {
        const out = {};
        const aggiungi = (o, forn, codice, descr, q, costo) => {
            const lista = out[forn] = out[forn] || [];
            const k = `${chiave(codice)}|${codice ? '' : descr}`;
            let r = lista.find(x => x.k === k);
            if (!r) { r = { k, codice, descrizione: descr, quantita: 0, costo: 0, ordini: [], senzaCosto: false }; lista.push(r); }
            r.quantita += q;
            if (costo == null) r.senzaCosto = true; else r.costo = tonda(r.costo + costo);
            if (!r.ordini.includes(o.nome)) r.ordini.push(o.nome);
        };
        const per = (costo, n) => (costo == null ? null : tonda(costo * n));
        for (const id of idOrdini) {
            const o = dati.ordini[id];
            if (!o) continue;
            for (const pc of o.pc) {
                const n = Math.max(1, parseInt(pc.quantita, 10) || 1);
                for (const p of pc.pezzi) {
                    if (pezzoPreso(p)) {                                  // preso dal magazzino: non si ordina
                        aggiungi(o, 'MAGAZZINO', '', p.mag.def.descrizione, 1, costoPezzo(p, salvati).costo);
                    } else if (p.auto && Array.isArray(p.auto_parti) && p.auto_parti.length) {
                        for (const a of p.auto_parti) {
                            const k = Math.max(1, parseInt(a.pc, 10) || 1);
                            aggiungi(o, a.fornitore, a.codice, a.descrizione, (a.quantita || 1) * k, per(a.costo, k));
                        }
                    } else if (p.auto) {
                        aggiungi(o, p.auto.fornitore, p.auto.codice, p.auto.descrizione, (p.auto.quantita || 1) * n, per(p.auto.costo, n));
                    } else if (p.fisso) {
                        if (p.fisso.costo === 0) continue;                 // incluso o servizio senza costo
                        aggiungi(o, p.fisso.fornitore || 'FUORI LISTINO', '', p.fisso.descrizione, n, per(costoPezzo(p, salvati).costo, n));
                    } else {
                        aggiungi(o, 'DA DECIDERE', p.manuale.codice || '', `${p.nome_tipo}: ${p.cliente || p.manuale.descrizione || ''}`,
                            n, per(costoPezzo(p, salvati).costo, n));
                    }
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
            const cls = c.mancanti.length ? 'incompleto' : (c.utile.lordo < 0 ? 'neg' : 'pos');
            html += `<div class="acc-pc-titolo"><b>${esc(pc.build)}</b> · ${esc(pc.titolo)}${pc.gpu ? ` · alimentatore per ${esc(pc.gpu)}` : ''}</div>`;
            if (pc.avvisi && pc.avvisi.length) {
                html += `<div class="acc-avvisi">⚠ ${pc.avvisi.map(esc).join('<br>⚠ ')}<br><small>L'automatico segue quello che il cliente ha comprato.</small></div>`;
            }
            html += `<table class="acc-tabella"><thead><tr><th>Pezzo</th><th class="col-cliente">Scelto dal cliente</th><th>Da ordinare</th><th class="num">Costo netto</th><th class="num col-excel">Nei conti Excel</th><th class="col-disp">Disponibilità</th></tr></thead><tbody>` +
                pc.pezzi.map(p => rigaPezzo(p, salvati)).join('') + righeServizi(pc) + `</tbody></table>`;
            html += `<div class="acc-utile ${cls}">` +
                rigaEsito(c.utile, c.mancanti.length, pc.obiettivo) +
                righeVendita(pc.prezzo, o.data, pc.listino_oggi) +
                `<div class="riga"><span>Costo automatico (pezzi + montaggio e spedizione)</span><span>${eur(c.costo)}</span></div>` +
                rigaUtile(c.utile, c.mancanti.length) +
                (c.mancanti.length ? '' : rigaObiettivo(c.utile.srl, pc.obiettivo)) +
                rigaConfrontoExcel(c) +
                (c.mancanti.length ? `<div class="mancanti">Mancano i costi di: ${c.mancanti.map(p => esc(p.nome_tipo)).join(', ')}: inseriscili qui sopra e l'utile si calcola.</div>` : '') +
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

    // ================================================================ RIEPILOGO FORNITORI DELLA SCRIVANIA (Antonio 30/09)
    // «La pagina di riepilogo fornitori deve essere associata ad ogni scrivania, con la doppia modalità: quella
    // manuale che già ci sta e divide i pezzi per categorie con i nomi generici (quelli del PDF per i ragazzi che
    // assemblano) e quella automatica, che serve a me per fare l'ordine: diviso per ogni categoria, quali sono i pezzi
    // che realisticamente devo acquistare, categoria per categoria e fornitore per fornitore.»
    // L'automatica non scrive nulla. Per ogni PC della scrivania prende i pezzi della scheda; dove l'automatico oggi
    // sceglie un altro pezzo con le regole di sempre (le stesse di «AGGIORNA PREZZI PRODOTTO»: colore, marca della
    // linea, quantita', alimentatore, disponibilita' a scalare tra i fornitori) mette quello e segna che la scheda e'
    // da allineare. I PC con l'acquisto gia' confermato non contano. In piu' le opzioni del cliente fuori scheda e le
    // voci personalizzate. Il magazzino resta a parte: pezzi gia' a terra, da non ordinare.
    const K_MODO_RIEPILOGO = 'riepilogo_fornitori_modo';
    const ORDINE_CATEGORIE = ['CPU', 'GPU', 'MOBO', 'RAM', 'SSD', 'SSD ADDON', 'HDD', 'PSU', 'COOLER', 'CASE', 'MONITOR',
        'KIT GAMING', 'SEDIA', 'SCRIVANIA', 'WI-FI', 'VENTOLE', 'SOFTWARE', 'SCATOLE', 'ACCESSORI'];
    const CATEGORIA_EXTRA = { WIFI: 'WI-FI', VENTOLE: 'VENTOLE', SOFTWARE: 'SOFTWARE', SERVIZIO: 'SCATOLE', ACCESSORIO: 'ACCESSORI' };
    const COLORI_CATEGORIA = { CPU: '#3498db', GPU: '#9b59b6', MOBO: '#e67e22', RAM: '#f39c12', SSD: '#1abc9c',
        'SSD ADDON': '#16a085', HDD: '#16a085', PSU: '#e74c3c', COOLER: '#2980b9', CASE: '#2ecc71', MONITOR: '#8e44ad',
        'KIT GAMING': '#d35400', SEDIA: '#c0392b', SCRIVANIA: '#8e6e53' };
    const SENZA_PEZZO = /^(GENERICO|INTEGRATA|N\/?A|-)?$/i;          // come il riepilogo manuale: righe senza un pezzo
    const riepilogo = { n: null, ids: [], nomi: {}, modo: null, token: 0, ultimo: null, quando: '', solo: null };

    function categoriaScheda(tipo) {
        const t = String(tipo || '').toUpperCase().trim();
        const alias = { 'SSD AGGIUNTIVO': 'SSD ADDON', 'SCHEDA MADRE': 'MOBO', ALIMENTATORE: 'PSU', DISSIPATORE: 'COOLER' };
        return alias[t] || t || 'ALTRO';
    }

    function categoriaVoce(v) {
        const testo = `${v.name || ''} ${v.value || ''}`;
        for (const [tipo, re] of Object.entries(VOCE_PERSONALIZZATA)) if (re.test(testo)) return CATEGORIA_EXTRA[tipo];
        return String(v.name || '').toUpperCase().trim() || 'ALTRO';
    }

    const pezziDisponibili = (t) => { const m = /^\s*(\d+)\s*pz/i.exec(String(t || '')); return m ? Number(m[1]) : null; };
    const posizione = (c) => { const i = ORDINE_CATEGORIE.indexOf(c); return i < 0 ? ORDINE_CATEGORIE.length : i; };

    // Antonio 01/10: «vedo un sacco di prodotti senza fornitore chiaro». Fornitore vuoto, «ALTRO» o «FUORI LISTINO»
    // vuol dire che il pezzo non e' nei listini e va scelto (budget del costo fisso): nel riepilogo si chiama
    // «DA SCEGLIERE», con la spiegazione del budget e il link di ricerca su Amazon.
    const DA_SCEGLIERE = 'DA SCEGLIERE';
    const FORNITORI_VAGHI = ['', 'ALTRO', 'FUORI LISTINO', 'SENZA FORNITORE', DA_SCEGLIERE];
    const fornitoreVago = (f) => FORNITORI_VAGHI.includes(String(f || '').toUpperCase().trim());

    // «Smart url» verso Amazon per i pezzi che non prendiamo dai fornitori: ASIN -> pagina del prodotto; altrimenti una
    // ricerca fatta per quel pezzo (archiviazione aggiuntiva dal prezzo piu' basso). Ritorna null se non serve.
    function linkAmazon(codice, descrizione, categoria) {
        const testo = `${codice || ''} ${descrizione || ''}`;
        const asin = /\b(B0[A-Z0-9]{8})\b/i.exec(testo);
        if (asin) return { url: `https://www.amazon.it/dp/${asin[1].toUpperCase()}`, testo: 'Apri su Amazon' };
        const T = testo.toUpperCase();
        const colore = /WHITE|BIANC/.test(T) ? ' bianco' : (/BLACK|NERO|NERA/.test(T) ? ' nero' : '');
        const cerca = (q, perPrezzo) => ({ url: `https://www.amazon.it/s?k=${encodeURIComponent(q)}${perPrezzo ? '&s=price-asc-rank' : ''}`,
            testo: perPrezzo ? 'Cerca su Amazon (dal prezzo più basso)' : 'Cerca su Amazon' });
        const tb = /(\d+)\s*TB/.exec(T);
        if (/HDD|HARD ?DISK/.test(T) || (categoria === 'SSD ADDON' && /AGGIUNTIV/.test(T))) return cerca(`hard disk 2,5 pollici ${tb ? tb[1] + 'TB' : '1TB'} SATA interno`, true);
        if (/240\s*MM/.test(T)) return cerca(`dissipatore a liquido 240mm ARGB${colore}`);
        if (/360\s*MM/.test(T)) return cerca(`dissipatore a liquido 360mm ARGB${colore}`);
        if (/MONITOR/.test(T)) {
            const pollici = /(\d{2})\s*('|"|POLLICI)/.exec(T), hz = /(\d{3})\s*HZ/.exec(T);
            return cerca(`monitor gaming${pollici ? ' ' + pollici[1] + ' pollici' : ''}${hz ? ' ' + hz[1] + 'Hz' : ''}${/2K|QHD|1440/.test(T) ? ' QHD' : ' Full HD'}`);
        }
        if (/KIT|4IN1|4 IN 1/.test(T)) return cerca(`kit gaming 4 in 1 mouse tastiera cuffie tappetino${colore}`);
        if (/VENTOL/.test(T)) return cerca('ventole 120mm ARGB kit');
        if (/CASE ATX/.test(T)) return cerca(`case ATX 4 ventole ARGB vetro temperato${colore}`);
        if (/DARK ?CAVE/.test(T)) return cerca(`Dark Cave AKU Curved${colore}`);
        if (categoria === 'CASE' || categoria === 'COOLER' || categoria === 'MONITOR') return cerca(String(codice || descrizione || '').slice(0, 80));
        return null;
    }

    // Pezzi da comprare per i PC di una scrivania. schede: [{ id, nome, confermato, righe: [{tipo, ean, fornitore, nome,
    // costo, fonte}] (le righe del riquadro dell'utile), salvati: componenti della scheda nel database, voci: voci
    // personalizzate [{name, value, supplier, ean}] }]. Ritorna le categorie con i loro fornitori e il totale per fornitore.
    function daOrdinare(dati, schede, salvatiFissi) {
        const out = { pc: 0, esclusi: [], cambi: 0, senzaCosto: 0, totale: 0, pezzi: 0, categorie: [], fornitori: [], righe: [] };
        const cat = {};                                          // CATEGORIA -> FORNITORE -> codice -> riga
        const aggiungi = (categoria, x, ordine) => {
            const forn = fornitoreVago(x.fornitore) ? DA_SCEGLIERE : String(x.fornitore).toUpperCase().trim();
            const c = cat[categoria] || (cat[categoria] = {});
            const f = c[forn] || (c[forn] = {});
            const k = chiave(x.codice) || `~${String(x.descrizione || '').toUpperCase().trim()}`;
            const r = f[k] || (f[k] = { codice: x.codice || '', descrizione: x.descrizione || x.codice || '', quantita: 0, costo: 0,
                senzaCosto: false, stimato: false, disponibilita: '', daConfermare: false, ordini: [], scheda: [], pezzi: [],
                link: forn === 'AMAZON' || forn === DA_SCEGLIERE ? linkAmazon(x.codice, x.descrizione, categoria) : null });
            if (x.pezzo) r.pezzi.push(x.pezzo);
            r.quantita += x.quantita;
            if (x.costo == null) r.senzaCosto = true; else r.costo = tonda(r.costo + x.costo);
            if (x.stimato) r.stimato = true;
            if (x.daConfermare) r.daConfermare = true;
            if (!r.disponibilita && x.disponibilita) r.disponibilita = x.disponibilita;
            if (ordine && !r.ordini.includes(ordine)) r.ordini.push(ordine);
            if (x.scheda && !r.scheda.includes(x.scheda)) r.scheda.push(x.scheda);
        };
        for (const s of schede || []) {
            if (s.confermato) { out.esclusi.push(s.nome); continue; }
            out.pc++;
            const auto = pcAutomatico(dati, s.id);
            const salvati = s.salvati || [];
            for (const r of s.righe || []) {
                if (SENZA_PEZZO.test(String(r.ean || '').trim())) continue;
                const categoria = categoriaScheda(r.tipo);
                const salvato = salvati.find(x => x.type === r.tipo && chiave(x.ean) === chiave(r.ean));
                const quantita = Math.max(1, parseInt(salvato && salvato.quantity, 10) || 1);
                const p = auto ? sostitutoDaOrdine(auto, { tipo: r.tipo, ean: r.ean, fornitore: r.fornitore,
                    nome: salvato ? salvato.name : '', quantita }) : null;
                const pezzo = { id: s.id, tipo: r.tipo, ean: r.ean, fornitore: r.fornitore || '', nome: r.nome || '', ordine: s.nome };
                if (p && p.auto && p.auto.codice) {                   // l'automatico oggi prende un altro pezzo
                    out.cambi++;
                    aggiungi(categoria, { fornitore: p.auto.fornitore, codice: p.auto.codice, descrizione: p.auto.descrizione,
                        quantita: parseInt(p.auto.quantita, 10) || quantita, costo: p.auto.costo != null ? p.auto.costo : null,
                        disponibilita: p.auto.disponibilita, daConfermare: !!p.auto.da_confermare,
                        scheda: `${r.fornitore || ''} ${r.ean}`.trim(), pezzo }, s.nome);
                    continue;
                }
                // il pezzo della scheda resta: nome e disponibilita' dai listini (pezzo dell'automatico con lo stesso
                // codice e fornitore, altrimenti il costo di oggi del pezzo della scheda)
                const forn = String(r.fornitore || '').toUpperCase().trim();
                const uguale = auto && Array.isArray(auto.pezzi) ? auto.pezzi.find(x => x.tipo === (TIPI[r.tipo] || r.tipo) && x.auto &&
                    [x.auto.codice, x.auto.mpn].filter(Boolean).map(chiave).includes(chiave(r.ean)) &&
                    String(x.auto.fornitore || '').toUpperCase().trim() === forn) : null;
                const sch = costoScheda(dati, r.ean, r.fornitore);
                const listino = sch && sch.fonte === 'listino' ? sch : null;
                const aTerra = r.fonte === 'magazzino';
                // pezzo fuori dai listini (costo fisso dell'automatico): fornitore e spiegazione del budget, se la scheda
                // non ha un fornitore chiaro (es. dissipatore 240mm bianco -> AMAZON; CASE ATX -> da scegliere)
                const pr = auto ? pezzoDellaRiga(auto, r.tipo, r.ean) : null;
                const fisso = pr && !pr.auto && pr.fisso ? pr.fisso : null;
                const vago = fornitoreVago(r.fornitore);
                aggiungi(categoria, { fornitore: aTerra ? 'MAGAZZINO' : (vago && fisso && fisso.fornitore ? fisso.fornitore : r.fornitore), codice: r.ean,
                    descrizione: (uguale && uguale.auto.descrizione) || (listino && listino.descrizione) ||
                        (vago && fisso && fisso.descrizione) || (salvato && salvato.name) || r.nome || r.ean,
                    quantita, costo: r.costo != null ? r.costo : null, stimato: r.fonte === 'stima' || r.fonte === 'altro',
                    disponibilita: aTerra ? 'a terra' : (uguale && uguale.auto.disponibilita) || (listino && listino.disponibilita) || '',
                    daConfermare: !!(uguale && uguale.auto.da_confermare), pezzo }, s.nome);
            }
            for (const x of extraOrdine(auto, (s.righe || []).map(r => r.tipo), s.voci, salvatiFissi)) {
                if (x.personalizzata || x.costo === 0) continue;          // gia' tra le voci personalizzate o senza costo
                aggiungi(CATEGORIA_EXTRA[x.tipo] || x.tipo, { fornitore: x.fornitore || 'FUORI LISTINO', codice: '',
                    descrizione: x.descrizione || x.nome, quantita: 1, costo: x.costo }, s.nome);
            }
            for (const v of s.voci || []) {
                const q = Math.max(1, parseInt(v.quantity != null ? v.quantity : v.quantita, 10) || 1);
                const prezzo = parseFloat(v.price != null ? v.price : v.prezzo);
                aggiungi(categoriaVoce(v), { fornitore: v.supplier, codice: v.ean || '', descrizione: v.value || v.name || v.ean,
                    quantita: q, costo: isNaN(prezzo) ? null : tonda(prezzo * q) }, s.nome);
            }
        }
        const forn = {};
        for (const nome of Object.keys(cat).sort((a, b) => posizione(a) - posizione(b) || a.localeCompare(b))) {
            const c = { nome, pezzi: 0, costo: 0, fornitori: [] };
            for (const [f, righe] of Object.entries(cat[nome])) {
                const lista = Object.values(righe).sort((a, b) => b.quantita - a.quantita || a.descrizione.localeCompare(b.descrizione));
                for (const r of lista) {
                    r.n = out.righe.length;                        // numero della riga (pulsanti «Cambia»)
                    out.righe.push(r);
                    const n = pezziDisponibili(r.disponibilita);
                    if (f !== 'MAGAZZINO' && n != null && r.quantita > n) r.poco = n;
                    if (f !== 'MAGAZZINO' && /^non disponibile/i.test(r.disponibilita)) r.nonDisponibile = true;
                }
                const pezzi = lista.reduce((t, r) => t + r.quantita, 0);
                const costo = tonda(lista.reduce((t, r) => t + r.costo, 0));
                c.fornitori.push({ nome: f, pezzi, costo, righe: lista });
                const g = forn[f] || (forn[f] = { nome: f, pezzi: 0, costo: 0, senzaCosto: 0, righe: [] });
                g.pezzi += pezzi;
                g.costo = tonda(g.costo + costo);
                for (const r of lista) {
                    g.righe.push({ categoria: nome, ...r });
                    if (r.senzaCosto) g.senzaCosto++;
                }
                if (f === 'MAGAZZINO') continue;
                c.pezzi += pezzi;
                c.costo = tonda(c.costo + costo);
            }
            // magazzino in fondo, poi i fornitori con piu' pezzi
            c.fornitori.sort((a, b) => (a.nome === 'MAGAZZINO') - (b.nome === 'MAGAZZINO') || b.pezzi - a.pezzi || a.nome.localeCompare(b.nome));
            out.categorie.push(c);
            out.pezzi += c.pezzi;
            out.totale = tonda(out.totale + c.costo);
        }
        const peso = (n) => (n === 'MAGAZZINO' ? 2 : (n === DA_SCEGLIERE ? 1 : 0));        // da scegliere e magazzino in fondo
        out.fornitori = Object.values(forn).sort((a, b) => peso(a.nome) - peso(b.nome) || b.costo - a.costo || a.nome.localeCompare(b.nome));
        out.senzaCosto = out.fornitori.filter(f => f.nome !== 'MAGAZZINO').reduce((t, f) => t + f.senzaCosto, 0);
        return out;
    }

    // Testo da incollare nell'ordine al fornitore (stesso formato del riepilogo manuale)
    function testoOrdineFornitore(f) {
        return f.righe.map(r => `x${r.quantita} | ${r.codice || '—'} - ${r.descrizione}`).join('\n');
    }

    function testoCategoria(c) {
        return c.fornitori.map(f => f.righe.map(r => `x${r.quantita} | ${f.nome} | ${r.codice || '—'} - ${r.descrizione}`).join('\n')).join('\n');
    }

    function htmlRigaDaOrdinare(r, colore, magazzino, categoria) {
        const disp = r.disponibilita ? `${r.disponibilita}${r.daConfermare && !/confermare/i.test(r.disponibilita) ? ' · da confermare' : ''}` : '';
        const costo = r.senzaCosto && !r.costo ? 'costo —' : `${r.stimato ? '≈ ' : ''}${eur(r.costo)}${r.senzaCosto ? ' +' : ''}`;
        const azioni = [
            r.link ? `<a class="acc-rf-azione" href="${esc(r.link.url)}" target="_blank" rel="noopener" title="${esc(r.link.url)}">🛒 ${esc(r.link.testo)}</a>` : '',
            r.pezzi && r.pezzi.length && !magazzino ? `<button type="button" class="acc-rf-azione" data-rf-cambia="${r.n}" title="Cerca un altro pezzo nel Buyer Desk: con un clic va al posto di questo nelle schede">🔁 Cambia dal Buyer Desk</button>` : ''
        ].filter(Boolean).join('');
        return `<div class="supplier-item">` +
            `<div class="supplier-item-header"><span class="supplier-item-quantity" style="background:${colore};box-shadow:0 2px 8px ${colore}40">x${r.quantita}</span>` +
            (categoria ? `<span class="acc-rf-cat">${esc(categoria)}</span>` : '') +
            `<span class="acc-cod" data-copia="${esc(r.codice)}" title="Copia il codice">${esc(r.codice || '—')}</span>` +
            `<span class="acc-rf-costo">${magazzino ? '' : costo}</span></div>` +
            `<div class="supplier-item-name">${esc(r.descrizione)}</div>` +
            `<div class="acc-nota">${esc(r.ordini.join(' '))}${disp ? ' · ' + esc(disp) : ''}</div>` +
            (r.scheda.length ? `<div class="acc-rf-cambio">🔄 nella scheda: ${esc(r.scheda.join(', '))} · si allinea con «AGGIORNA PREZZI PRODOTTO»</div>` : '') +
            (r.poco != null ? `<div class="acc-rf-avviso">⚠ il fornitore ne ha solo ${r.poco}: gli altri vanno presi altrove</div>` : '') +
            (r.nonDisponibile ? `<div class="acc-rf-avviso">⚠ oggi non disponibile da questo fornitore</div>` : '') +
            (azioni ? `<div class="acc-rf-azioni">${azioni}</div>` : '') +
            `</div>`;
    }

    // Vista «fornitore per fornitore» (Antonio 01/10: «per poter fare gli ordini rapidamente in fornitura»)
    function htmlFornitoriDaOrdinare(r, solo) {
        const lista = r.fornitori.filter(f => !solo || f.nome === solo);
        if (!lista.length) return htmlCategorieDaOrdinare(r);
        return lista.map(f => {
            const col = COLORI[f.nome] || '#95a5a6';
            const mag = f.nome === 'MAGAZZINO';
            return `<div class="supplier-card"><div class="supplier-header" style="background:${col}"><span>${esc(f.nome)}</span>` +
                `<span class="supplier-count">${f.pezzi} pz${mag ? ' a terra' : (f.costo ? ' · ' + eur(f.costo) : '')}</span></div><div class="supplier-items-list">` +
                (mag ? '<div class="acc-nota">Già a terra: non si ordinano.</div>' : '') +
                (f.nome === DA_SCEGLIERE ? '<div class="acc-nota">Pezzi fuori dai listini: si scelgono col budget scritto sotto (link Amazon per trovarli in fretta).</div>' : '') +
                f.righe.map(x => htmlRigaDaOrdinare(x, col, mag, x.categoria)).join('') +
                `</div><div class="supplier-card-footer">${mag ? '' : `<button type="button" class="acc-rf-copia" data-rf-forn="${esc(f.nome)}">📋 ${f.nome === DA_SCEGLIERE ? 'Copia elenco' : `Copia ordine ${esc(f.nome)}`}</button>`}</div></div>`;
        }).join('');
    }

    function htmlCategorieDaOrdinare(r) {
        if (!r.categorie.length) {
            return `<div class="suppliers-empty-state"><h2>📦 Niente da ordinare</h2><p>${r.esclusi.length
                ? 'I PC di questa scrivania hanno già l\'acquisto dei pezzi confermato.' : 'Nessun pezzo nelle schede di questa scrivania.'}</p></div>`;
        }
        return r.categorie.map(c => {
            const col = COLORI_CATEGORIA[c.nome] || '#95a5a6';
            return `<div class="supplier-card"><div class="supplier-header" style="background:${col}"><span>${esc(c.nome)}</span>` +
                `<span class="supplier-count">${c.pezzi} pz${c.costo ? ' · ' + eur(c.costo) : ''}</span></div><div class="supplier-items-list">` +
                c.fornitori.map(f => `<div class="acc-rf-forn">${badgeFornitore(f.nome)} <small>${f.pezzi} pz` +
                    `${f.nome === 'MAGAZZINO' ? ' · già a terra, non si ordinano' : (f.costo ? ' · ' + eur(f.costo) : '')}</small></div>` +
                    f.righe.map(x => htmlRigaDaOrdinare(x, col, f.nome === 'MAGAZZINO')).join('')).join('') +
                `</div><div class="supplier-card-footer"><button type="button" class="acc-rf-copia" data-rf-cat="${esc(c.nome)}">📋 Copia ${esc(c.nome)}</button></div></div>`;
        }).join('');
    }

    function htmlLatoDaOrdinare(r, n, quando, vista, solo) {
        const v = vista === 'fornitori' ? 'fornitori' : 'categorie';
        return `<div class="acc-rf-tot"><small>Da ordinare · netto IVA esclusa${quando ? ` · listini delle ${esc(quando)}` : ''}</small>` +
            `<b>${eur(r.totale)}</b><small>${r.pezzi} pezzi per ${r.pc === 1 ? '1 PC' : `${r.pc} PC`}` +
            `${r.senzaCosto ? ` · ${r.senzaCosto === 1 ? '1 pezzo' : `${r.senzaCosto} pezzi`} senza costo` : ''}</small></div>` +
            `<div class="acc-rf-viste"><button type="button" data-rf-vista="categorie" class="${v === 'categorie' ? 'attivo' : ''}">📂 Per categoria</button>` +
            `<button type="button" data-rf-vista="fornitori" class="${v === 'fornitori' ? 'attivo' : ''}">🏷 Per fornitore</button></div>` +
            (r.esclusi.length ? `<div class="acc-nota">Non contati, acquisto già confermato: ${esc(r.esclusi.join(', '))}</div>` : '') +
            (r.cambi ? `<div class="acc-rf-cambio">🔄 ${r.cambi === 1 ? '1 pezzo diverso' : `${r.cambi} pezzi diversi`} dalla scheda: ` +
                `per allinearla premi «AGGIORNA PREZZI PRODOTTO» nella scrivania E${n}</div>` : '') +
            `<div class="acc-nota" style="margin-top:6px">Clic sul fornitore: solo i suoi pezzi, pronti da ordinare</div>` +
            r.fornitori.map(f => `<div class="acc-rf-forn-riga${solo === f.nome ? ' scelto' : ''}">` +
                `<button type="button" class="acc-rf-nome" data-rf-vedi="${esc(f.nome)}" title="Vedi cosa compriamo da ${esc(f.nome)}">${badgeFornitore(f.nome)}</button> <span>${f.pezzi} pz` +
                `${f.nome === 'MAGAZZINO' ? ' a terra' : (f.senzaCosto && !f.costo ? ' · costo —' : ` · ${eur(f.costo)}${f.senzaCosto ? ' +' : ''}`)}</span>` +
                `${f.nome === 'MAGAZZINO' ? '' : `<button type="button" class="acc-rf-copia acc-rf-mini" data-rf-forn="${esc(f.nome)}" title="Copia l'ordine per ${esc(f.nome)}">📋 Copia</button>`}</div>`).join('') +
            (solo ? `<button type="button" class="acc-rf-copia" data-rf-vedi="">↩ Tutti i fornitori</button>` : '') +
            `<button type="button" class="acc-rf-copia" data-rf-ricalcola="1">🔄 Ricalcola con gli ultimi dati</button>`;
    }

    // PC visibili della scrivania aperta (stessi del riepilogo manuale: filtro operatore compreso)
    function catturaScrivania() {
        const n = scrivaniaAttiva();
        if (!n) {                                  // tab gia' cambiata: la scrivania che ha visto il riepilogo manuale
            let c = null;
            try { c = typeof lastSupplierSummaryContext !== 'undefined' ? lastSupplierSummaryContext : null; } catch (e) { c = null; }
            const m = c && ({ processed: 1, 'processed-e2': 2, 'processed-e3': 3, 'processed-e4': 4 })[c.sourceTabName];
            if (!m || !c.visibleProcessedOrderIds) return false;
            riepilogo.n = m;
            riepilogo.ids = Array.from(c.visibleProcessedOrderIds).map(String);
            riepilogo.nomi = {};
            return true;
        }
        const carte = Array.from(document.querySelectorAll('#processed-container .order-card[data-order-id]')).filter(c => {
            const s = window.getComputedStyle(c);
            return s.display !== 'none' && s.visibility !== 'hidden';
        });
        riepilogo.n = n;
        riepilogo.solo = null;
        riepilogo.ids = carte.map(c => String(c.dataset.orderId).trim()).filter(Boolean);
        riepilogo.nomi = {};
        for (const c of carte) {
            const flip = c.querySelector('.order-id-flip');
            const t = flip ? String(flip.textContent || '').trim() : '';
            riepilogo.nomi[String(c.dataset.orderId).trim()] = t ? (t.startsWith('#') ? t : `#${t}`) : '';
        }
        return true;
    }

    function righeDaScheda(id) {
        if (ultimiConti[id] && ultimiConti[id].righe) return ultimiConti[id].righe;
        return righe(id).map(row => ({ tipo: row.dataset.componentType, ...manualeDellaRiga(row), costo: null, fonte: null }));
    }

    function vociDaScheda(id) {
        const cont = document.getElementById(`custom-items-${id}`);
        if (!cont) return [];
        return Array.from(cont.querySelectorAll('.custom-item-row')).map(row => {
            const strong = row.querySelector('strong');
            const span = row.querySelector('span');
            return { name: strong ? strong.textContent.replace(':', '').trim() : '', value: span ? span.textContent.trim() : '',
                supplier: row.dataset.supplier || '', ean: row.dataset.ean || '' };
        });
    }

    function barraRiepilogo() {
        const testa = document.getElementById('suppliers-header');
        if (!testa) return null;
        stile();
        let barra = testa.querySelector('.acc-rf-barra');
        if (!barra) {
            barra = document.createElement('div');
            barra.className = 'acc-rf-barra';
            barra.innerHTML = `<div class="acc-rf-scrivania"></div><div class="acc-rf-modi">` +
                `<button type="button" data-rf-modo="manuale" title="Pezzi per categoria con i nomi generici, come nel PDF per chi assembla">📋 Manuale<small>per chi assembla</small></button>` +
                `<button type="button" data-rf-modo="auto" title="Pezzi da comprare oggi, per categoria e fornitore">🤖 Automatico<small>da ordinare</small></button></div>` +
                `<div class="acc-rf-lato"></div>`;
            const ora = testa.querySelector('.update-time');           // sotto il sottotitolo, prima dell'ora
            if (ora) testa.insertBefore(barra, ora); else testa.appendChild(barra);
            barra.querySelectorAll('[data-rf-modo]').forEach(b => b.addEventListener('click', () => mostraModo(b.dataset.rfModo)));
        }
        return barra;
    }

    function contenitoreAuto() {
        let el = document.getElementById('riepilogo-auto');
        const griglia = document.getElementById('suppliers-grid');
        if (!el && griglia) {
            el = document.createElement('div');
            el.id = 'riepilogo-auto';
            el.className = 'suppliers-grid';
            el.style.display = 'none';
            griglia.parentNode.insertBefore(el, griglia.nextSibling);
        }
        return el;
    }

    // «GENERA PDF» fa i PDF del riepilogo manuale: nella modalita' automatica non si mostra
    function sorvegliaPdf() {
        const b = document.getElementById('generate-orders-btn');
        if (!b || b.__accRf || typeof MutationObserver === 'undefined') return;
        b.__accRf = true;
        new MutationObserver(() => {
            if (riepilogo.modo === 'auto' && b.style.display !== 'none') b.style.display = 'none';
        }).observe(b, { attributes: true, attributeFilter: ['style'] });
    }

    function mostraModo(modo) {
        const m = modo === 'auto' ? 'auto' : 'manuale';
        riepilogo.modo = m;
        scriviLS(K_MODO_RIEPILOGO, m);
        const barra = barraRiepilogo();
        const griglia = document.getElementById('suppliers-grid');
        const auto = contenitoreAuto();
        sorvegliaPdf();
        if (barra) {
            barra.querySelectorAll('[data-rf-modo]').forEach(b => b.classList.toggle('attivo', b.dataset.rfModo === m));
            const s = barra.querySelector('.acc-rf-scrivania');
            if (s) s.textContent = riepilogo.n ? `Scrivania E${riepilogo.n} · ${riepilogo.ids.length === 1 ? '1 PC' : `${riepilogo.ids.length} PC`}` : '';
            const lato = barra.querySelector('.acc-rf-lato');
            if (lato) { lato.style.display = m === 'auto' ? '' : 'none'; if (m !== 'auto') lato.innerHTML = ''; }
        }
        const testa = document.getElementById('suppliers-header');
        const sotto = testa ? testa.querySelector('h1 ~ p') : null;
        if (sotto) sotto.textContent = m === 'auto' ? 'Pezzi da comprare oggi, categoria per categoria e fornitore per fornitore'
            : 'Pezzi per categoria con i nomi generici, come nel PDF per chi assembla';
        for (const sel of ['.suppliers-log-section', '.update-time']) {            // cronologia e ora del riepilogo manuale
            const el = testa ? testa.querySelector(sel) : null;
            if (el) el.style.display = m === 'auto' ? 'none' : '';
        }
        const pdf = document.getElementById('generate-orders-btn');
        if (griglia) griglia.style.display = m === 'auto' ? 'none' : '';
        if (auto) auto.style.display = m === 'auto' ? '' : 'none';
        if (m === 'auto') {
            if (pdf) pdf.style.display = 'none';
            return renderRiepilogoAuto();
        }
        const suTab = document.querySelector('.tab-button.active[data-tab="suppliers"]');
        if (pdf && suTab && typeof window !== 'undefined' && window.currentSupplierData && Object.keys(window.currentSupplierData).length) pdf.style.display = 'block';
        return Promise.resolve();
    }

    async function renderRiepilogoAuto(forza) {
        const box = contenitoreAuto();
        const barra = barraRiepilogo();
        const lato = barra ? barra.querySelector('.acc-rf-lato') : null;
        if (!box) return;
        const tok = ++riepilogo.token;
        if (!riepilogo.n) {
            box.innerHTML = `<div class="suppliers-empty-state"><h2>Apri il riepilogo da una scrivania</h2><p>Vai in E1, E2, E3 o E4 e premi il pulsante del riepilogo fornitori.</p></div>`;
            if (lato) lato.innerHTML = '';
            return;
        }
        box.innerHTML = `<div class="suppliers-empty-state"><h2>⏳ Calcolo i pezzi da ordinare…</h2><p>Scrivania E${riepilogo.n}: listini di oggi e disponibilità dei fornitori.</p></div>`;
        if (lato) lato.innerHTML = '';
        let dati;
        try {
            dati = await carica(forza);
        } catch (e) {
            if (tok !== riepilogo.token) return;
            box.innerHTML = `<div class="suppliers-empty-state"><h2>Automatico non disponibile</h2><p>${esc(stato.errore || (e && e.message) || e)}</p></div>`;
            return;
        }
        // riquadri dell'utile ricalcolati: costi dei pezzi della scheda con i listini appena letti
        await Promise.all(riepilogo.ids.filter(id => contesti[id]).map(id => aggiornaOrdine(id).catch(() => {})));
        if (tok !== riepilogo.token) return;
        const schede = riepilogo.ids.map(id => ({
            id, confermato: acquistoConfermato(id), righe: righeDaScheda(id), salvati: componentiSalvati(id), voci: vociDaScheda(id),
            nome: riepilogo.nomi[id] || ((dati.ordini || {})[String(id).split('.')[0]] || {}).nome || `#${id}`
        }));
        const r = daOrdinare(dati, schede, leggiLS(K_FISSI, {}));
        riepilogo.ultimo = r;
        riepilogo.quando = oraBreve(dati.listini || dati.generato);
        disegnaRiepilogo();
    }

    const K_VISTA_RIEPILOGO = 'riepilogo_fornitori_vista';

    // Disegna l'ultimo calcolo nella vista scelta (per categoria o per fornitore, anche uno solo)
    function disegnaRiepilogo() {
        const r = riepilogo.ultimo;
        const box = contenitoreAuto();
        const barra = barraRiepilogo();
        const lato = barra ? barra.querySelector('.acc-rf-lato') : null;
        if (!r || !box) return;
        const vista = riepilogo.solo ? 'fornitori' : leggiLS(K_VISTA_RIEPILOGO, 'categorie');
        box.innerHTML = vista === 'fornitori' ? htmlFornitoriDaOrdinare(r, riepilogo.solo) : htmlCategorieDaOrdinare(r);
        if (lato) lato.innerHTML = htmlLatoDaOrdinare(r, riepilogo.n, riepilogo.quando, vista, riepilogo.solo);
        const dove = [box, lato].filter(Boolean);
        const tutti = (sel) => dove.flatMap(x => Array.from(x.querySelectorAll(sel)));
        tutti('[data-copia]').forEach(el => el.addEventListener('click', () => { if (el.dataset.copia) copia(el.dataset.copia); }));
        tutti('[data-rf-cat]').forEach(b => b.addEventListener('click', () => {
            const c = r.categorie.find(x => x.nome === b.dataset.rfCat);
            if (c) copia(testoCategoria(c));
        }));
        tutti('[data-rf-forn]').forEach(b => b.addEventListener('click', () => {
            const f = r.fornitori.find(x => x.nome === b.dataset.rfForn);
            if (f) copia(testoOrdineFornitore(f));
        }));
        tutti('[data-rf-vista]').forEach(b => b.addEventListener('click', () => {
            scriviLS(K_VISTA_RIEPILOGO, b.dataset.rfVista);
            riepilogo.solo = null;
            disegnaRiepilogo();
        }));
        tutti('[data-rf-vedi]').forEach(b => b.addEventListener('click', () => {
            const f = b.dataset.rfVedi || null;
            riepilogo.solo = f && riepilogo.solo !== f ? f : null;
            if (riepilogo.solo) scriviLS(K_VISTA_RIEPILOGO, 'fornitori');
            disegnaRiepilogo();
            if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
        tutti('[data-rf-cambia]').forEach(b => b.addEventListener('click', () => apriCambio(r.righe[parseInt(b.dataset.rfCambia, 10)])));
        tutti('[data-rf-ricalcola]').forEach(b => b.addEventListener('click', () => renderRiepilogoAuto(true)));
    }

    // ================================================================ CAMBIA UN PEZZO DAL BUYER DESK (Antonio 01/10)
    // «modificare un pezzo: aprire listini.minimalgamers.it (buyer desk), cercare un prodotto da lì rapidamente e col clic
    // viene sostituito in automatico al posto di quello che voglio cambiare». Il Buyer Desk si apre in modalita' scelta
    // (?scegli=1): «Scegli» su un'offerta la manda qui (postMessage); qui si chiede conferma e si cambia il pezzo nelle
    // schede dei PC di quella riga (gli stessi salvataggi di «AGGIORNA PREZZI PRODOTTO»).
    const URL_BUYER_DESK = 'https://listini.minimalgamers.it/';
    const ORIGINI_BUYER_DESK = ['https://listini.minimalgamers.it', 'https://minimal-gamers-listini.pages.dev'];
    const cambio = { riga: null, aperto: 0 };

    function ricercaPerCambio(riga) {
        const nome = (riga.pezzi || []).map(p => p.nome).find(Boolean) || riga.descrizione || riga.codice || '';
        return String(nome).replace(/\b(WHITE|BLACK|BIANCO|BIANCA|NERO|NERA)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    function apriCambio(riga) {
        if (!riga || !riga.pezzi || !riga.pezzi.length) return;
        cambio.riga = riga;
        cambio.aperto = Date.now();
        const url = `${URL_BUYER_DESK}?scegli=1&q=${encodeURIComponent(ricercaPerCambio(riga))}` +
            `&da=${encodeURIComponent(`${riga.codice || ''} ${riga.descrizione || ''}`.trim().slice(0, 120))}`;
        const w = window.open(url, 'mg-buyer-desk');
        if (!w) avvisa('Il browser ha bloccato la finestra del Buyer Desk: consenti i pop-up per il gestionale.', 'warning');
        else avvisa('Buyer Desk aperto: cerca il pezzo e premi «Scegli»', 'info');
    }

    // Messaggio dal Buyer Desk: valido solo dalla sua origine, con un cambio chiesto da qui nell'ultima ora
    function sceltaValida(origine, d) {
        return ORIGINI_BUYER_DESK.includes(origine) && d && d.tipo === 'mg-buyer-scelta' && d.codice && d.fornitore &&
            !!cambio.riga && Date.now() - cambio.aperto < 60 * 60 * 1000;
    }

    async function applicaScelta(d) {
        const riga = cambio.riga;
        if (!riga) return;
        const pezzi = riga.pezzi.filter(p => p && p.id && p.tipo);
        const nuovo = `${esc(d.fornitore)} <b>${esc(d.codice)}</b> ${esc(d.descrizione || '')}${d.prezzo != null && !isNaN(Number(d.prezzo)) ? ` · <b>${eur(Number(d.prezzo))}</b> netti` : ''}` +
            `${d.disponibilita ? ` <small>${esc(d.disponibilita)}</small>` : ''}`;
        const corpo = `<p>Al posto di <b>${esc(riga.codice || '')}</b> ${esc(riga.descrizione || '')} metto:</p><p>${nuovo}</p>` +
            `<p>Nelle schede di questi PC:</p>` + pezzi.map((p, i) => `<div class="acc-fin-riga"><label><input type="checkbox" data-pc="${i}" checked> ` +
                `<b>${esc(p.ordine || p.id)}</b> · ${esc(p.tipo)}: ${esc(p.fornitore)} ${esc(p.ean)}</label></div>`).join('') +
            `<p><small>Se un pezzo l'hai già comprato, togli la spunta a quel PC.</small></p>`;
        const c = await finestra(`🔁 Cambia ${esc(riga.codice || 'pezzo')}`, corpo, 'Cambia nelle schede', 'Annulla');
        if (!c) return;
        const scelti = Array.from(c.querySelectorAll('input[data-pc]')).filter(x => x.checked).map(x => pezzi[parseInt(x.dataset.pc, 10)]);
        let fatti = 0;
        for (const p of scelti) {
            const ok = typeof updateProcessedOrderComponent === 'function'
                ? await updateProcessedOrderComponent(p.id, p.tipo, d.codice, d.descrizione || d.codice, d.fornitore) : false;
            if (ok) { fatti++; pulisciModificheLocali(p.id, p.tipo); }
        }
        // costo netto del Buyer Desk come costo inserito, se i dati automatici non lo conoscono ancora
        const prezzo = Number(d.prezzo);
        if (fatti && !isNaN(prezzo) && prezzo > 0) {
            const costi = leggiLS(K_COSTI, {});
            for (const p of scelti) { const k = `${p.tipo}|${chiave(d.codice)}`; if (costi[k] == null) costi[k] = tonda(prezzo); }
            scriviLS(K_COSTI, costi);
        }
        cambio.riga = null;
        avvisa(`${fatti} di ${scelti.length} PC aggiornati con ${d.fornitore} ${d.codice}`, fatti === scelti.length ? 'success' : 'error');
        if (!fatti) return;
        try {
            if (typeof loadProcessedOrdersFromDB === 'function') await loadProcessedOrdersFromDB();
            if (typeof renderProcessedOrders === 'function' && typeof getFilteredProcessedOrdersMap === 'function'
                && typeof processedOrdersMap !== 'undefined' && riepilogo.n) {
                await renderProcessedOrders(getFilteredProcessedOrdersMap(processedOrdersMap, riepilogo.n));
            }
            const inizio = Date.now();                        // le schede caricano i pezzi: si aspetta (massimo 20 secondi)
            while (Date.now() - inizio < 20000 && typeof isProcessedOrdersViewLoading === 'function' && isProcessedOrdersViewLoading()) {
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (e) { console.warn('[ACCOPPIAMENTO] ricarica schede', e); }
        if (riepilogo.modo === 'auto') renderRiepilogoAuto();
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('message', (ev) => {
            if (!sceltaValida(ev.origin, ev.data)) return;
            applicaScelta(ev.data).catch(e => avvisa('Cambio non riuscito: ' + (e && e.message ? e.message : e), 'error'));
        });
    }

    // Pulsante del riepilogo fornitori (E1–E4): la pagina si apre per quella scrivania, nella modalita' scelta l'ultima volta
    function collegaRiepilogo() {
        const b = document.getElementById('export-btn');
        if (!b || b.dataset.accRiepilogo) return;
        b.dataset.accRiepilogo = '1';
        // in fase di cattura: si legge la scrivania prima che il riepilogo manuale passi alla pagina dei fornitori
        b.addEventListener('click', () => {
            if (!catturaScrivania()) return;
            setTimeout(() => { mostraModo(leggiLS(K_MODO_RIEPILOGO, 'manuale')).catch(e => console.warn('[ACCOPPIAMENTO] riepilogo', e)); }, 0);
        }, true);
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
    const collega = () => { collegaTab(); collegaRiepilogo(); };
    if (typeof document !== 'undefined' && document.addEventListener) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', collega);
        else collega();
    }

    const api = { decora, pezzoModificato, aggiornaOrdine, carica, decifra, voceAutomatica, prezzoVendita, utile, chiave,
        idMappatura, scelteCliente, stato, renderPagina, riepilogoFornitori, costoPezzo, contiPc, pcAutomatico, parteDellUnita,
        annota, inv, leggiInventario, quantitaMagazzino, pezzoPreso, prendiDalMagazzino, annullaDalMagazzino,
        impostaQuantita, boxMagazzino, rigaPezzo, cellaExcel, rigaConfrontoExcel, serviziPc,
        valutaObiettivo, rigaObiettivo, righeVendita, rigaUtile, dataBreve, rigaEsito, pezziDiversi,
        righePezziDiversi, cercaPerCodice, wattAlimentatore, utileConPezziGiusti, costoScheda, costoEquivalente,
        extraOrdine, righeExtra, contoOrdine, dettaglioPezzi, consigliato, costoMagazzino, prezzoAcquisto,
        acquistoConfermato, proposteOrdine, tabellaProposte, salvaPrezzi, barraScrivania, aggiornaScrivania,
        confermaScrivania, ultimiConti, URL_AGGIORNA_LISTINI, pulisciModificheLocali, pezziMigliori, sostitutoDaOrdine,
        sostitutoDaVoce, rispettaScheda, coloreRispettato, marcaRispettata, cercaPerScelta, sceltaUguale, vocePerCodice,
        pezzoDellaRiga, daOrdinare, testoOrdineFornitore, testoCategoria, htmlCategorieDaOrdinare, htmlLatoDaOrdinare,
        categoriaScheda, categoriaVoce, catturaScrivania, mostraModo, renderRiepilogoAuto, riepilogo,
        htmlFornitoriDaOrdinare, htmlRigaDaOrdinare, linkAmazon, disegnaRiepilogo, apriCambio, sceltaValida, applicaScelta,
        cambio, ricercaPerCambio, righeOpzioniScheda, corpoPezzi, sezioniAperte, fornitoreVago, mostraUtile };
    if (typeof window !== 'undefined') window.AccoppiamentoAuto = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
