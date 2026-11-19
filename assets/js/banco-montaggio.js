// Banco: arrivi e montaggio (pagina «Banco»).
//
// Il gestionale ordini resta l'unica fonte per: pezzi della scheda, fornitore, acquisti,
// sostituzioni, costi e giacenze. Questa pagina li LEGGE e registra soltanto tre fatti fisici:
// il pezzo e' arrivato, il pezzo e' stato montato (con il seriale), il PC e' finito.
// Non scrive mai componenti, prezzi, acquisti o quantita' dell'Inventario.
// Tabelle proprie: banco_pezzi, banco_pc, banco_codici (sql/banco_montaggio.sql).
(function () {
    'use strict';

    const K_ACQUISTI = '_acquisti_parziali_gestionale';
    const K_CONFERMATO = '_acquisto_confermato_gestionale';
    const K_ESCLUSIONI = '_esclusioni_acquisto_gestionale';
    const PREFISSO_USO = 'MAG-USO-';
    // stessa tabella dei tipi del motore di accoppiamento
    const TIPI = {
        GPU: 'GPU', CPU: 'CPU', RAM: 'RAM', SSD: 'SSD', 'SSD ADDON': 'SSD_EXTRA', 'SSD AGGIUNTIVO': 'SSD_EXTRA', MOBO: 'MOBO',
        'SCHEDA MADRE': 'MOBO', PSU: 'PSU', ALIMENTATORE: 'PSU', COOLER: 'COOLER', DISSIPATORE: 'COOLER',
        CASE: 'CASE', MONITOR: 'MONITOR', 'KIT GAMING': 'ACCESSORIO', KIT: 'ACCESSORIO', SEDIA: 'ACCESSORIO', SCRIVANIA: 'ACCESSORIO'
    };

    /* ============================ LOGICA PURA ============================ */

    const su = s => String(s == null ? '' : s).toUpperCase().trim();
    // stessa normalizzazione dei codici usata dal gestionale (supabase-config.js)
    const norm = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
    const tipoMotore = t => TIPI[su(t)] || su(t);
    const unita = id => { const [base, n] = String(id).split('.'); return { base, n: Number(n) || 1 }; };
    const quanti = c => Math.max(1, Number(c && c.quantity) || 1);
    function proprieta(cp) {
        if (typeof cp === 'string') { try { return JSON.parse(cp) || {}; } catch (e) { return {}; } }
        return cp || {};
    }
    const identita = c => [su(c.type), norm(c.ean), su(c.supplier)].join('|');
    const identitaBanco = b => [su(b.tipo), norm(b.codice), su(b.fornitore)].join('|');

    // Stato d'acquisto letto dal gestionale: non si deduce nulla, si riporta cio' che e' registrato.
    function statoAcquisto(c, cp) {
        if (c.price !== null && c.price !== undefined && c.price !== '') return 'acquistato';
        const p = proprieta(cp);
        if (p[K_CONFERMATO] && !c.isCustom) return 'acquistato';
        const a = c.id == null ? null : (p[K_ACQUISTI] || {})[c.id];
        if (a && (a.stato === 'ordinato' || a.stato === 'pagato') && a.type === c.type &&
            String(a.ean || '') === String(c.ean || '') && String(a.supplier || '') === String(c.supplier || '') &&
            Number(a.quantity) === quanti(c)) return a.stato;
        // «Fuori dagli acquisti»: esclusione ancora valida per questa stessa riga (stesso pezzo, fornitore e quantita').
        if (c.id != null && Object.values(p[K_ESCLUSIONI] || {}).some(v => v && (v.excluded === true || v.escluso === true) &&
            !v.personalizzato && v.componentId != null && String(v.componentId) === String(c.id) && v.tipo === c.type &&
            norm(v.ean) === norm(c.ean) && su(v.fornitore) === su(c.supplier) && Number(v.quantita) === quanti(c))) return 'escluso';
        return 'da_acquistare';
    }

    // ---- Valori d'acquisto: solo importi gia' registrati in Acquisti, mai stime o listini. ----
    // Stesse regole di «come si paga» del gestionale (accoppiamento-auto.js): ACTION, OMEGA, TIER ONE e CASEKING
    // passano dall'intermediario (pagato IVA inclusa, netto = pagato / 1,22); le loro CPU sono dirette in reverse
    // charge (art. 17: nessuna IVA versata al fornitore); i distributori italiani fatturano con IVA 22%.
    const IVA = 1.22, CANALE_INT = ['ACTION', 'OMEGA', 'TIER ONE', 'CASEKING'],
        CANALE_DIST = ['ABACO', 'RUNNER', 'ESPRINET', 'BREVI', 'FOCELDA', 'NAVY BLUE'];
    const REGIMI = { intermediario: 'Intermediario · IVA inclusa', iva: 'IVA normale 22%', art17: 'Art. 17 · reverse charge', altro: 'IVA da definire' };
    const tonda = n => Math.round(n * 100) / 100;
    const importo = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
    function regimeAcquisto(c) {
        const fornitore = su(c.supplier);
        if (CANALE_INT.includes(fornitore)) return tipoMotore(c.type) === 'CPU' ? 'art17' : 'intermediario';
        return CANALE_DIST.includes(fornitore) ? 'iva' : 'altro';
    }
    // Netto dell'intera riga (quantita' compresa) con la sua fonte; null = importo non registrato.
    // Zero esplicito e' un importo valido; un campo vuoto resta mancante.
    function costoNetto(c, cp) {
        const p = proprieta(cp), righe = (p[K_CONFERMATO] && p[K_CONFERMATO].righe) || [];
        const fissato = righe.find(r => r && (r.componentId != null ? String(r.componentId) === String(c.id)
            : r.tipo === c.type && norm(r.ean) === norm(c.ean)));
        if (fissato && importo(fissato.costo) != null) return { netto: tonda(importo(fissato.costo)), fonte: 'confermato' };
        if (importo(c.price) != null) return { netto: tonda(importo(c.price)), fonte: 'confermato' };
        const a = c.id == null ? null : (p[K_ACQUISTI] || {})[c.id];
        if (a && a.type === c.type && String(a.ean || '') === String(c.ean || '') &&
            String(a.supplier || '') === String(c.supplier || '') && Number(a.quantity) === quanti(c)) {
            if (a.stato === 'pagato' && importo(a.costo) != null) return { netto: tonda(importo(a.costo)), fonte: 'pagato' };
            if (a.stato === 'ordinato' && importo(a.costo_previsto) != null) return { netto: tonda(importo(a.costo_previsto)), fonte: 'concordato' };
        }
        return null;
    }
    function importi(netto, regime) {
        if (regime === 'art17') return { netto, iva: 0, totale: netto };
        if (regime === 'intermediario' || regime === 'iva') { const totale = tonda(netto * IVA); return { netto, iva: tonda(totale - netto), totale }; }
        return { netto, iva: null, totale: null };                      // regime sconosciuto: solo il netto
    }
    // Somma per regime. voci: [{ r, pezzi }], pezzi = quanti pezzi della riga contare.
    // Un pezzo senza importo registrato non vale zero: viene contato a parte e il totale e' dichiarato parziale.
    function sommaValori(voci) {
        const out = { regimi: {}, pezzi: 0, netto: 0, iva: 0, totale: 0, senzaImporto: 0, ivaDaDefinire: 0 };
        for (const { r, pezzi } of voci || []) {
            if (!(pezzi > 0)) continue;
            out.pezzi += pezzi;
            if (!r.costo) { out.senzaImporto += pezzi; continue; }
            const g = out.regimi[r.regime] || (out.regimi[r.regime] = { pezzi: 0, netto: 0, iva: 0, totale: 0 });
            const v = importi(tonda(r.costo.netto * pezzi / r.quantita), r.regime);
            g.pezzi += pezzi; g.netto = tonda(g.netto + v.netto); out.netto = tonda(out.netto + v.netto);
            if (v.totale == null) { out.ivaDaDefinire += pezzi; g.iva = null; g.totale = null; }
            else { g.iva = tonda(g.iva + v.iva); g.totale = tonda(g.totale + v.totale); out.iva = tonda(out.iva + v.iva); out.totale = tonda(out.totale + v.totale); }
        }
        return out;
    }

    // Software e servizi non arrivano in una scatola: si spuntano a mano, senza codice a barre.
    function rigaFisica(c, categoriaVoce) {
        if (/^(SERVIZIO|SOFTWARE|MONTAGGIO|SPEDIZIONE)\b/.test(su(c.type))) return false;
        if (typeof categoriaVoce === 'function') {
            let cat = '';
            try { cat = categoriaVoce(c.type, c.name); } catch (e) { cat = ''; }
            if (cat === 'SOFTWARE' || cat === 'SCATOLE') return false;
        }
        return true;
    }

    // Prelievi registrati con «Prendi dal magazzino» per quel PC (righe MAG-USO-… dell'Inventario).
    function prelieviDellUnita(inventario, id) {
        const { base, n } = unita(id), prefisso = `${PREFISSO_USO}${base}-${n}-`;
        const out = [];
        for (const r of inventario || []) {
            const ean = String(r && r.ean || '');
            if (!ean.startsWith(prefisso)) continue;
            const defId = ean.slice(prefisso.length);
            let descrizione = String(r.name || '');
            try { const j = JSON.parse(r.name); if (j && j.nome) descrizione = String(j.nome); } catch (e) { /* registro precedente: testo semplice */ }
            descrizione = descrizione.replace(/^Magazzino\s*→[^:]*:\s*/, '');
            const m = /^PROD-([^-]+)-(.*)-[0-9a-f]+$/.exec(defId);
            out.push({ uso: ean, defId, tipo: m ? m[1] : null, codice: m ? m[2] : null, descrizione,
                quantita: Math.max(1, Number(r.quantity) || 1) });
        }
        return out;
    }

    // Un prelievo copre una riga solo se tipo e codice coincidono: un prelievo del pezzo
    // precedente non rende «pronto» il pezzo nuovo.
    function assegnaPrelievi(componenti, prelievi) {
        const perRiga = new Map(), liberi = [];
        for (const p of prelievi || []) {
            const c = p.tipo && p.codice ? (componenti || []).find(x => !perRiga.has(x.id) &&
                tipoMotore(x.type) === p.tipo && norm(x.ean) && norm(x.ean) === norm(p.codice)) : null;
            if (c) perRiga.set(c.id, p); else liberi.push(p);
        }
        return { perRiga, liberi };
    }

    // Lega le righe del banco ai pezzi di oggi. La scheda puo' cambiare dopo un arrivo:
    //  - stesso id ma pezzo diverso  -> «cambiato» (sostituzione confermata nel gestionale)
    //  - id sparito ma stesso pezzo  -> ricollegato (scheda rielaborata)
    //  - id sparito e pezzo sparito  -> «orfano»: e' a banco ma la scheda non lo chiede piu'
    function collega(componenti, banco) {
        const usato = new Set(), righe = [], daRivedere = [], ricollegare = [];
        const registrato = b => (Number(b.arrivati) || 0) > 0 || !!b.montato_il;
        for (const c of componenti || []) {
            let b = (banco || []).find(x => String(x.componente_id) === String(c.id)) || null;
            if (b) {
                usato.add(b);
                if (identitaBanco(b) !== identita(c)) {
                    if (registrato(b)) daRivedere.push(b);
                    // la riga resta agganciata: un nuovo arrivo la riscrive con il pezzo di oggi
                    righe.push({ c, b, cambiato: registrato(b) });
                    continue;
                }
            }
            righe.push({ c, b, cambiato: false });
        }
        for (const b of banco || []) {
            if (usato.has(b)) continue;
            const r = righe.find(x => !x.b && identita(x.c) === identitaBanco(b));
            if (r) { r.b = b; ricollegare.push({ b, componente_id: r.c.id }); }
            else if (registrato(b)) daRivedere.push(b);
        }
        return { righe, daRivedere, ricollegare };
    }

    function costruisciUnita(ordine, componenti, ctx) {
        ctx = ctx || {};
        const id = String(ordine.shopify_order_id), { base, n } = unita(id), cp = proprieta(ordine.custom_properties);
        const legame = collega(componenti, ctx.banco || []);
        const ass = assegnaPrelievi(componenti, prelieviDellUnita(ctx.inventario || [], id));
        const piano = Array.isArray(ctx.piano) ? ctx.piano : null;
        const righe = legame.righe.map(({ c, b, cambiato }) => {
            const up = (piano || []).find(p => p && p.precedente && (p.precedente.id != null
                ? String(p.precedente.id) === String(c.id)
                : su(p.precedente.tipo) === su(c.type) && norm(p.precedente.ean) === norm(c.ean)));
            const quantita = quanti(c), fisica = rigaFisica(c, ctx.categoriaVoce);
            const prelievo = ass.perRiga.get(c.id) || null;
            const arrivati = cambiato || !b ? 0 : Math.min(quantita, Number(b.arrivati) || 0);
            const montato = !cambiato && !!(b && b.montato_il);
            return { c, b, cambiato, fisica, quantita, prelievo, arrivati, montato,
                acquisto: prelievo ? 'magazzino' : statoAcquisto(c, cp), costo: costoNetto(c, cp), regime: regimeAcquisto(c),
                nonMontare: up ? { scelta: up.scelta || '', descrizione: up.descrizione || up.scelta || '', ordine: up.ordine || '' } : null,
                pronto: montato || !fisica || !!prelievo || arrivati >= quantita };
        });
        const u = { id, base, n, nome: (ordine.order_id_flip || `#${base}`) + (String(id).includes('.') ? ` · PC ${n}` : ''),
            build: ordine.config_name || ordine.pc_item_name || '', foglio: Number(ordine.foglio_di_lavoro) || 1,
            righe, daRivedere: legame.daRivedere, ricollegare: legame.ricollegare, prelieviLiberi: ass.liberi,
            pc: ctx.pc || null, upgrade: piano || [], upgradeVerificati: piano !== null };
        u.stato = statoUnita(u);
        return u;
    }

    function statoUnita(u) {
        const vive = u.righe.filter(r => !r.nonMontare);
        const montati = vive.filter(r => r.montato).length, pronti = vive.filter(r => r.pronto).length, totale = vive.length;
        const mancanti = vive.filter(r => !r.pronto);
        // «da ordinare»: in Acquisti non risulta ne' ordinato ne' pagato. «da confermare»: comprato (o gia' in casa
        // secondo Acquisti) ma l'arrivo non e' ancora stato confermato al banco.
        const daOrdinare = mancanti.filter(r => r.acquisto === 'da_acquistare'), daConfermare = mancanti.filter(r => r.acquisto !== 'da_acquistare');
        const pz = n => `${n} ${n === 1 ? 'pezzo' : 'pezzi'}`;
        let codice, etichetta;
        if (!totale) { codice = 'vuoto'; etichetta = 'SENZA PEZZI'; }
        else if (montati === totale && u.pc && u.pc.stato === 'collaudato') { codice = 'collaudato'; etichetta = 'COLLAUDATO'; }
        else if (montati === totale && u.pc && u.pc.stato === 'assemblato') { codice = 'assemblato'; etichetta = 'ASSEMBLATO'; }
        else if (montati === totale) { codice = 'montato'; etichetta = 'MONTATO · da chiudere'; }
        else if (montati > 0) { codice = 'montaggio'; etichetta = 'IN MONTAGGIO'; }
        else if (pronti === totale) { codice = 'pronto'; etichetta = 'PRONTO DA MONTARE'; }
        else if (!daOrdinare.length) { codice = 'confermare'; etichetta = `ARRIVI DA CONFERMARE · ${pz(daConfermare.length)}`; }
        else { codice = 'acquisti'; etichetta = `DA ORDINARE · ${pz(daOrdinare.length)}`; }
        return { codice, etichetta, montati, pronti, totale, mancanti, daOrdinare, daConfermare, daRivedere: u.daRivedere.length > 0 };
    }

    // codici della scheda a cui puo' corrispondere il codice letto: se' stesso + quelli imparati
    function codiciPossibili(letto, codici) {
        const l = norm(letto), out = new Set(l ? [l] : []);
        for (const x of codici || []) if (norm(x.codice_letto) === l && norm(x.codice)) out.add(norm(x.codice));
        return out;
    }

    // Righe che aspettano quel codice. Prima l'ordine indicato, poi gli acquisti registrati,
    // poi l'ordine piu' vecchio: lo stesso prodotto comprato per piu' PC va al primo in coda.
    function candidatiArrivo(letto, lista, codici, preferito) {
        const ok = codiciPossibili(letto, codici), pref = su(preferito).replace(/^#/, ''), out = [];
        if (!ok.size) return out;
        for (const u of lista || []) for (const r of u.righe) {
            if (!r.fisica || r.nonMontare || r.montato || r.prelievo || r.arrivati >= r.quantita) continue;
            if (ok.has(norm(r.c.ean))) out.push({ u, r });
        }
        const eDelPreferito = u => !!pref && [u.id, u.base, u.nome, String(u.nome).split(' ')[0]].some(x => su(x).replace(/^#/, '') === pref);
        const registrato = a => a === 'acquistato' || a === 'pagato' || a === 'ordinato';
        const peso = x => (eDelPreferito(x.u) ? 0 : 10) + (registrato(x.r.acquisto) ? 0 : 1);
        return out.sort((a, b) => peso(a) - peso(b) || String(a.u.base).localeCompare(String(b.u.base), undefined, { numeric: true }) || a.u.n - b.u.n);
    }

    function candidatiMontaggio(letto, u, codici) {
        const ok = codiciPossibili(letto, codici);
        return u.righe.filter(r => !r.montato && !r.nonMontare && ok.has(norm(r.c.ean)));
    }

    /* ============================ DATI ============================ */

    const CONCORRENZA = 'Aggiornato nel frattempo da un altro operatore: premi Aggiorna e riprova';
    function creaDati(sb, adesso) {
        const ora = () => (adesso ? adesso() : new Date()).toISOString();
        const esegui = async q => { const r = await q; if (r.error) throw r.error; return r.data; };
        async function inBlocchi(tabella, colonne, campo, valori) {
            const out = [];
            // gli URL di PostgREST hanno un limite: mai troppi id in una sola richiesta
            for (let i = 0; i < valori.length; i += 80)
                out.push(...(await esegui(sb.from(tabella).select(colonne).in(campo, valori.slice(i, i + 80))) || []));
            return out;
        }
        async function leggi(ids) {
            ids = [...new Set((ids || []).map(String))];
            const ordini = await inBlocchi('processed_orders',
                'id, shopify_order_id, order_id_flip, config_name, pc_item_name, custom_properties, stato, foglio_di_lavoro', 'shopify_order_id', ids);
            const grezzi = await inBlocchi('processed_order_components',
                'id, order_id, component_type, ean, product_name, supplier, price, quantity, is_custom', 'order_id', ordini.map(o => o.id));
            const componenti = {};
            for (const c of grezzi) (componenti[c.order_id] = componenti[c.order_id] || []).push({ id: c.id, type: c.component_type,
                ean: c.ean || '', name: c.product_name || '', supplier: c.supplier || '', price: c.price, quantity: c.quantity || 1, isCustom: !!c.is_custom });
            const [banco, pc, codici, inventario] = await Promise.all([
                inBlocchi('banco_pezzi', '*', 'ordine_id', ids), inBlocchi('banco_pc', '*', 'ordine_id', ids),
                esegui(sb.from('banco_codici').select('*')),
                esegui(sb.from('warehouse_inventory').select('ean, name, quantity').like('ean', `${PREFISSO_USO}%`))]);
            return { ordini, componenti, banco, pc, codici: codici || [], inventario: inventario || [] };
        }
        const foto = (u, r) => ({ ordine_id: u.id, componente_id: r.c.id, tipo: r.c.type, codice: r.c.ean,
            fornitore: r.c.supplier, nome: r.c.name, quantita: r.quantita });
        async function scrivi(u, r, valori, guardia) {
            if (r.cambiato) throw new Error('La scheda ora chiede un altro pezzo: prima togli dal banco quello arrivato');
            if (!r.b) {
                const res = await sb.from('banco_pezzi').insert({ ...foto(u, r), ...valori, creato_il: ora(), aggiornato_il: ora() }).select().maybeSingle();
                if (res.error) throw (/duplicate|unique/i.test(res.error.message || '') ? new Error(CONCORRENZA) : res.error);
                return res.data;
            }
            const righe = await esegui(guardia(sb.from('banco_pezzi').update({ ...foto(u, r), ...valori, aggiornato_il: ora() }).eq('id', r.b.id)).select());
            if (!righe || !righe.length) throw new Error(CONCORRENZA);
            return righe[0];
        }
        async function segnaArrivo(u, r, q, letto, chi) {
            if (r.montato) throw new Error('Pezzo già montato');
            const prima = r.b ? Number(r.b.arrivati) || 0 : 0, base = r.cambiato || !r.b ? 0 : prima;
            const arrivati = Math.min(r.quantita, base + Math.max(1, Number(q) || 1));
            return scrivi(u, r, { arrivati, arrivato_il: ora(), arrivato_da: chi || null, codice_letto: letto ? String(letto).trim() : (r.b && r.b.codice_letto) || null },
                x => x.eq('arrivati', prima));
        }
        // Conferma senza lettore di piu' pezzi insieme (merce attesa da un fornitore, pezzi comprati di un PC).
        // Ogni riga ha la sua guardia: una riga cambiata nel frattempo fallisce da sola, senza fermare le altre.
        async function segnaArrivi(voci, chi) {
            const fatti = [], falliti = [];
            for (let i = 0; i < voci.length; i += 8) await Promise.all(voci.slice(i, i + 8).map(async x => {
                try { fatti.push(await segnaArrivo(x.u, x.r, x.r.quantita, null, chi)); }
                catch (e) { falliti.push({ u: x.u, r: x.r, errore: (e && e.message) || String(e) }); }
            }));
            return { fatti, falliti };
        }
        async function annullaArrivo(u, r) {
            if (!r.b) return null;
            if (r.montato) throw new Error('Pezzo montato: prima smontalo');
            return scrivi(u, r, { arrivati: 0, arrivato_il: null, arrivato_da: null, codice_letto: null }, x => x.is('montato_il', null));
        }
        async function segnaMontato(u, r, seriale, chi, letto) {
            if (r.nonMontare) throw new Error('Pezzo sostituito da un upgrade pagato: non va montato');
            if (r.montato) throw new Error('Pezzo già montato');
            const valori = { montato_il: ora(), montato_da: chi || null, seriale: seriale ? String(seriale).trim() : null };
            if (r.fisica && !r.prelievo && r.arrivati < r.quantita)   // montato senza passare dagli arrivi: l'arrivo e' implicito
                Object.assign(valori, { arrivati: r.quantita, arrivato_il: ora(), arrivato_da: chi || null, note: 'Arrivo registrato al montaggio' });
            if (letto) valori.codice_letto = String(letto).trim();
            return scrivi(u, r, valori, x => x.is('montato_il', null));
        }
        async function smonta(u, r) {
            if (!r.b || !r.montato) return null;
            return scrivi(u, r, { montato_il: null, montato_da: null, seriale: null }, x => x.eq('id', r.b.id));
        }
        const togli = b => esegui(sb.from('banco_pezzi').delete().eq('id', b.id));
        const ricollega = x => esegui(sb.from('banco_pezzi').update({ componente_id: x.componente_id, aggiornato_il: ora() }).eq('id', x.b.id));
        async function associa(letto, c, chi) {
            const riga = { codice_letto: norm(letto), codice: norm(c.ean), tipo: c.type, fornitore: c.supplier || null, nome: c.name || null, creato_da: chi || null, creato_il: ora() };
            if (!riga.codice_letto || !riga.codice) throw new Error('Codice non valido');
            const res = await sb.from('banco_codici').insert(riga).select().maybeSingle();
            if (res.error && !/duplicate|unique/i.test(res.error.message || '')) throw res.error;
            return res.data || riga;
        }
        async function salvaPc(ordineId, valori) {
            const esiste = await esegui(sb.from('banco_pc').select('id').eq('ordine_id', String(ordineId)).maybeSingle());
            const dati = { ...valori, aggiornato_il: ora() };
            if (esiste) return esegui(sb.from('banco_pc').update(dati).eq('id', esiste.id).select().maybeSingle());
            return esegui(sb.from('banco_pc').insert({ ordine_id: String(ordineId), ...dati, creato_il: ora() }).select().maybeSingle());
        }
        const riapriPc = ordineId => esegui(sb.from('banco_pc').delete().eq('ordine_id', String(ordineId)));
        return { leggi, segnaArrivo, segnaArrivi, annullaArrivo, segnaMontato, smonta, togli, ricollega, associa, salvaPc, riapriPc };
    }

    const logica = { K_ACQUISTI, K_CONFERMATO, K_ESCLUSIONI, PREFISSO_USO, norm, su, unita, tipoMotore, proprieta, identita, identitaBanco, statoAcquisto,
        REGIMI, regimeAcquisto, costoNetto, importi, sommaValori, rigaFisica, prelieviDellUnita, assegnaPrelievi, collega, costruisciUnita, statoUnita, codiciPossibili,
        candidatiArrivo, candidatiMontaggio, creaDati };
    if (typeof module !== 'undefined') module.exports = logica;
    if (typeof window === 'undefined') return;
    window.BancoMontaggio = logica;
    if (typeof document === 'undefined') return;

    /* ============================ INTERFACCIA ============================ */

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const el = id => document.getElementById(id);
    // stesse parole della pagina Acquisti
    const ACQUISTO = { acquistato: 'Acquistato', pagato: 'Acquistato e pagato', ordinato: 'Ordinato, da pagare', magazzino: 'Dal magazzino',
        da_acquistare: 'Da ordinare', escluso: 'Fuori dagli acquisti' };
    const COLORE_ACQUISTO = { da_acquistare: 'rosso', ordinato: 'giallo', escluso: 'grigio' };
    const PESO_STATO = { pronto: 0, montaggio: 1, montato: 2, confermare: 3, acquisti: 4, assemblato: 5, collaudato: 6, vuoto: 7 };
    const comprato = a => a === 'acquistato' || a === 'pagato' || a === 'ordinato';
    const eur = n => (n == null ? '—' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }));
    const daContare = l => l.map(x => ({ r: x.r, pezzi: x.r.quantita - x.r.arrivati }));      // pezzi ancora da confermare
    const daArrivare = l => l.reduce((n, x) => n + x.r.quantita - x.r.arrivati, 0);
    const gruppiAperti = new Set(), gruppiVisibili = new Map();   // gruppi della merce attesa: aperti / disegnati ora
    let root = null, dati = null, modello = { unita: [], codici: [] }, sezione = 'arrivi', aperta = null;
    const registro = { di: null, righe: [] };      // registro del montaggio del PC aperto

    const CSS = `
    #banco-container.tab-content{grid-template-columns:1fr;gap:0;padding:12px 16px}
    #banco-container.tab-content.active{display:block}
    /* Superficie chiara e opaca: si legge con qualunque sfondo scelto dall'utente. */
    .bm-page{color:var(--mg-ink,#1d2029);background:rgba(255,255,255,.95);border:1px solid rgba(29,32,41,.1);border-radius:14px;padding:16px 18px 24px;box-shadow:0 2px 6px rgba(29,32,41,.06);font-size:16px;line-height:1.45}
    .bm-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}
    .bm-head h2{margin:0 8px 0 0;color:inherit}
    .bm-status{font-size:13px;padding:4px 10px;border-radius:6px;display:none}
    .bm-status.ok{display:inline-block;background:#d9f3e3;color:#17643a}
    .bm-status.err{display:inline-block;background:#fde2e0;color:#a11c12}
    .bm-status.info{display:inline-block;background:#dceafe;color:#0b4fae}
    .bm-subnav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
    .bm-subnav button{background:#ededf0;color:#1d2029;border:1px solid rgba(29,32,41,.12);border-radius:10px;padding:9px 16px;cursor:pointer;font-size:16px;font-weight:600}
    .bm-subnav button.active{background:#1d2029;border-color:#1d2029;color:#fff}
    .bm-panel{display:none}.bm-panel.active{display:block}
    .bm-card{background:#fff;border:1px solid rgba(29,32,41,.12);border-radius:12px;padding:14px;margin-bottom:12px}
    .bm-card h3{margin:0 0 10px;font-size:19px;color:inherit}
    .bm-card.rosso{border-color:#e5a3a3;background:#fdecec}
    .bm-card.giallo{border-color:#e8cf7a;background:#fff6dc}
    .bm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
    .bm-page input,.bm-page select,.bm-modal input,.bm-modal select{background:#fff;color:#1d2029;border:1px solid rgba(29,32,41,.28);border-radius:8px;padding:9px 11px;font-size:16px}
    .bm-page input::placeholder,.bm-modal input::placeholder{color:#7b808c}
    .bm-scan{font-size:20px!important;padding:10px 12px!important;min-width:260px;border:2px solid #005bd5!important}
    .bm-btn{background:#ededf0;color:#1d2029;border:1px solid rgba(29,32,41,.15);border-radius:8px;padding:8px 13px;cursor:pointer;font-size:15px;font-weight:600;white-space:nowrap}
    .bm-btn:hover{background:#dcdce0}
    .bm-btn.primary{background:#005bd5;border-color:#005bd5;color:#fff}.bm-btn.ok{background:#1f8a4c;border-color:#1f8a4c;color:#fff}
    .bm-btn.danger{background:#c0392b;border-color:#c0392b;color:#fff}.bm-btn.sm{padding:6px 10px;font-size:14px}
    .bm-btn.primary:hover{background:#0049ab}.bm-btn.ok:hover{background:#18703d}.bm-btn.danger:hover{background:#a23024}
    .bm-wrap{overflow:auto;max-height:calc(100vh - 340px)}
    .bm-table{width:100%;border-collapse:collapse;font-size:15px;color:#1d2029}
    .bm-table td.bm-nome{font-size:16px;font-weight:600}
    .bm-table th{position:sticky;top:0;background:#f0f0f3;color:#1d2029;text-align:left;padding:8px;font-weight:700;border-bottom:1px solid rgba(29,32,41,.15)}
    .bm-table td{padding:7px 8px;border-top:1px solid rgba(29,32,41,.08);vertical-align:middle}
    .bm-table tr.spento td{opacity:.55}
    .bm-pill{display:inline-block;padding:3px 9px;border-radius:10px;font-size:13px;font-weight:700;white-space:nowrap}
    .bm-pill.rosso{background:#fde2e0;color:#a11c12}.bm-pill.giallo{background:#fff0c2;color:#7a5200}
    .bm-pill.blu{background:#dceafe;color:#0b4fae}.bm-pill.viola{background:#eadcf8;color:#5b2a91}
    .bm-pill.verde{background:#d9f3e3;color:#17643a}.bm-pill.grigio{background:#ececef;color:#4a4e59}
    .bm-muted{color:var(--mg-muted,#626773);font-size:14px}
    .bm-log{font-family:Consolas,monospace;font-size:14px;max-height:190px;min-height:24px;overflow:auto;background:#f5f4f1;border:1px solid rgba(29,32,41,.1);border-radius:8px;padding:8px;color:#1d2029}
    .bm-log div{padding:2px 0}.bm-log .e{color:#a11c12;font-weight:600}.bm-log .o{color:#17643a}.bm-log .w{color:#7a5200}
    .bm-modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999}
    .bm-modal{background:#fff;color:#1d2029;border:1px solid rgba(29,32,41,.15);border-radius:14px;padding:18px 20px;width:min(560px,92vw);max-height:90vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.25)}
    .bm-modal h3{margin:0 0 8px;color:inherit}.bm-modal .bm-nota{font-size:15px;color:#7a5200;margin:0 0 10px}
    .bm-modal label{display:block;font-size:14px;color:#626773;margin:8px 0 3px}
    .bm-modal input,.bm-modal select{width:100%;box-sizing:border-box}
    .bm-modal .bm-chk{display:flex;align-items:center;gap:8px;margin-top:10px}.bm-modal .bm-chk input{width:auto}
    .bm-modal .bm-chk label{margin:0;font-size:16px;color:#1d2029}
    .bm-modal-azioni{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
    .bm-numeri{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 14px}
    .bm-numero{background:#fff;border:1px solid rgba(29,32,41,.12);border-left:6px solid #c9ccd3;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
    .bm-numero b{font-size:30px;line-height:1.1}.bm-numero span{font-size:14px;color:#626773}
    .bm-numero.verde{border-left-color:#1f8a4c}.bm-numero.viola{border-left-color:#7a46b8}.bm-numero.giallo{border-left-color:#d9a400}.bm-numero.rosso{border-left-color:#c0392b}
    .bm-sez{margin:18px 0 4px;font-size:18px}
    .bm-numero.blu{border-left-color:#005bd5}
    .bm-table tr.bm-totale td{border-top:2px solid rgba(29,32,41,.35);font-weight:700;background:#f5f4f1}
    .bm-avviso{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:#fff6dc;border:1px solid #e8cf7a;color:#7a5200;font-size:14px}
    .bm-gruppo{border:1px solid rgba(29,32,41,.12);border-radius:10px;margin:8px 0;background:#fff}
    .bm-gruppo>summary{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;list-style:none;font-size:17px}
    .bm-gruppo>summary::-webkit-details-marker{display:none}
    .bm-gruppo>summary>span::before{content:'\\25B8  ';color:#626773}.bm-gruppo[open]>summary>span::before{content:'\\25BE  '}
    .bm-gruppo[open]>summary{border-bottom:1px solid rgba(29,32,41,.1)}
    @media (max-width:700px){.bm-page{padding:12px}.bm-scan{min-width:0;width:100%}.bm-wrap{max-height:none}.bm-table{font-size:14px}.bm-table td.bm-nome{font-size:15px}}
    `;

    function stato(testo, tipo) {
        const s = el('bm-status');
        if (!s) return;
        s.className = 'bm-status ' + (tipo || 'info');
        s.textContent = testo;
        clearTimeout(stato.t);
        stato.t = setTimeout(() => { s.className = 'bm-status'; }, tipo === 'err' ? 10000 : 4500);
    }
    function testoErrore(e) {
        const m = (e && (e.message || e.details)) || String(e);
        if (/banco_(pezzi|pc|codici)/.test(m) && /does not exist|Could not find the table|schema cache/i.test(m))
            return 'Tabelle del banco non ancora create: esegui sql/banco_montaggio.sql in Supabase (SQL Editor).';
        return m;
    }
    let inCorso = 0;                               // operazioni aperte: niente aggiornamenti automatici sopra
    async function azione(fn) {
        inCorso++;
        try { return await fn(); }
        catch (e) { console.error('[Banco]', e); stato(testoErrore(e), 'err'); return undefined; }
        finally { inCorso--; }
    }
    function log(id, testo, cls) {
        if (id === 'bm-mon-log') registro.righe.unshift({ testo: new Date().toLocaleTimeString('it-IT') + '  ' + testo, cls: cls || '' });
        const box = el(id);
        if (!box) return;
        const d = document.createElement('div');
        d.className = cls || '';
        d.textContent = new Date().toLocaleTimeString('it-IT') + '  ' + testo;
        box.prepend(d);
    }
    function operatore() {
        const v = (el('bm-operatore') && el('bm-operatore').value.trim()) || '';
        try { localStorage.setItem('banco_operatore', v); } catch (e) { /* solo comodita' */ }
        return v || null;
    }
    const chiudiFinestre = () => document.querySelectorAll('.bm-modal-ov').forEach(x => x.dispatchEvent(new Event('bm-chiudi')));

    // Finestra interna (niente alert/confirm del browser). Ritorna i valori oppure null.
    function finestra(titolo, campi, opz) {
        opz = opz || {};
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'bm-modal-ov';
            ov.innerHTML = `<div class="bm-modal" role="dialog" aria-modal="true"><h3>${esc(titolo)}</h3>` +
                (opz.nota ? `<p class="bm-nota">${esc(opz.nota)}</p>` : '') + '<form>' + campi.map(f => {
                    if (f.type === 'checkbox') return `<div class="bm-chk"><input type="checkbox" name="${f.name}" id="bm-f-${f.name}" ${f.value ? 'checked' : ''}><label for="bm-f-${f.name}">${esc(f.label)}</label></div>`;
                    if (f.type === 'select') return `<label>${esc(f.label)}</label><select name="${f.name}">` +
                        f.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('') + '</select>';
                    return `<label>${esc(f.label)}</label><input name="${f.name}" type="text" value="${esc(f.value == null ? '' : f.value)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off">`;
                }).join('') + `<div class="bm-modal-azioni"><button type="button" class="bm-btn" data-annulla>Annulla</button>` +
                `<button type="submit" class="bm-btn primary">${esc(opz.ok || 'Conferma')}</button></div></form></div>`;
            document.body.appendChild(ov);
            const form = ov.querySelector('form');
            const chiudi = v => { ov.remove(); resolve(v); };
            ov.addEventListener('bm-chiudi', () => chiudi(null));
            ov.querySelector('[data-annulla]').onclick = () => chiudi(null);
            ov.addEventListener('keydown', e => { if (e.key === 'Escape') chiudi(null); });
            form.onsubmit = e => {
                e.preventDefault();
                const out = {};
                for (const f of campi) {
                    const x = form.elements[f.name];
                    out[f.name] = f.type === 'checkbox' ? x.checked : x.value.trim();
                    if (f.required && !out[f.name]) { x.focus(); return; }
                }
                chiudi(out);
            };
            const primo = form.querySelector('input,select');
            if (primo) setTimeout(() => primo.focus(), 30);
        });
    }

    /* ---- lettura: schede aperte del gestionale + registrazioni del banco ---- */
    function db() {
        if (!dati) {
            let c = null;
            try { c = (typeof supabase !== 'undefined' && supabase) || null; } catch (e) { c = null; }
            c = c || (window.SupabaseDB && window.SupabaseDB.supabase) || null;
            if (!c) throw new Error('Database non ancora pronto: riprova tra un momento');
            dati = creaDati(c);
        }
        return dati;
    }
    // le stesse schede delle scrivanie E1–E4: elaborate e ancora da spedire
    function schedeAperte() {
        const A = window.AccoppiamentoAuto;
        try { if (A && typeof A.schedeElaborate === 'function') return A.schedeElaborate().map(x => String(x.id)); } catch (e) { /* sotto */ }
        return null;
    }
    // Upgrade pagati dopo l'acquisto: il pezzo precedente non va montato. Lo decide il motore
    // del gestionale; se i suoi dati non sono caricati qui, la verifica resta «non fatta».
    function pianoUpgrade(id, componenti) {
        const A = window.AccoppiamentoAuto;
        try {
            const d = A && A.stato && A.stato.dati;
            if (!d || typeof A.pcAutomatico !== 'function' || typeof A.pianoMontaggioUpgrade !== 'function') return null;
            const auto = A.pcAutomatico(d, id);
            if (!auto) return null;
            let salvati = {};
            try { salvati = (typeof processedOrdersCache !== 'undefined' && processedOrdersCache && processedOrdersCache[id]) || {}; } catch (e) { salvati = {}; }
            return A.pianoMontaggioUpgrade(auto, componenti.filter(c => !c.isCustom).map(c => ({ id: c.id, tipo: c.type, ean: c.ean, nome: c.name })), salvati) || [];
        } catch (e) { console.warn('[Banco] upgrade pagati non verificabili', e); return null; }
    }
    async function carica() {
        const ids = schedeAperte();
        if (!ids) throw new Error('Elenco delle schede non disponibile: apri prima la pagina Ordini, poi torna al Banco');
        const d = await db().leggi(ids), M = window.MontaggioExport;
        const lista = d.ordini.filter(o => (o.stato || 'elaborati') === 'elaborati').map(o => {
            const id = String(o.shopify_order_id), comp = d.componenti[o.id] || [];
            return costruisciUnita(o, comp, { banco: d.banco.filter(b => String(b.ordine_id) === id),
                pc: d.pc.find(p => String(p.ordine_id) === id) || null, inventario: d.inventario,
                piano: pianoUpgrade(id, comp), categoriaVoce: M && M.categoriaVoce });
        });
        for (const u of lista) for (const x of u.ricollegare) {       // schede rielaborate: stesso pezzo, riga nuova
            try { await db().ricollega(x); x.b.componente_id = x.componente_id; } catch (e) { console.warn('[Banco] ricollegamento non riuscito', e); }
        }
        lista.sort((a, b) => String(a.base).localeCompare(String(b.base), undefined, { numeric: true }) || a.n - b.n);
        modello = { unita: lista, codici: d.codici };
        return modello;
    }
    const tutte = () => modello.unita.flatMap(u => u.righe.map(r => ({ u, r })));
    const inAttesa = () => tutte().filter(x => x.r.fisica && !x.r.nonMontare && !x.r.montato && !x.r.prelievo && x.r.arrivati < x.r.quantita);
    const corrente = () => modello.unita.find(u => u.id === aperta) || null;
    const nomePezzo = c => {
        const M = window.MontaggioExport;
        try { return (M && M.descrizioneHardware ? M.descrizioneHardware(c.name) : c.name) || c.ean || ''; } catch (e) { return c.name || c.ean || ''; }
    };

    // «A quale pezzo corrisponde questa scatola?» — lo decide una persona, mai una somiglianza di nome.
    async function scegliPezzo(titolo, nota, voci) {
        const gruppi = [];
        for (const x of voci) {
            const k = identita(x.r.c), g = gruppi.find(y => y.k === k);
            if (g) g.voci.push(x); else gruppi.push({ k, voci: [x] });
        }
        const r = await finestra(titolo, [{ name: 'pezzo', label: 'Pezzo scritto in scheda', type: 'select', options: gruppi.map((g, i) => {
            const c = g.voci[0].r.c, ordini = [...new Set(g.voci.map(x => x.u.nome))];
            return { value: i, label: `${c.type} · ${nomePezzo(c)} · ${c.ean}${c.supplier ? ' · ' + c.supplier : ''} — ${ordini.join(', ')}` };
        }) }, { name: 'sicuro', label: 'Ho controllato: è esattamente questo prodotto', type: 'checkbox', required: true }], { nota, ok: 'È questo pezzo' });
        return r ? gruppi[Number(r.pezzo)].voci[0] : null;
    }

    /* ------------------------------ struttura ------------------------------ */
    function costruisci() {
        root = el('banco-container');
        if (!root) return false;
        if (!el('bm-style')) { const st = document.createElement('style'); st.id = 'bm-style'; st.textContent = CSS; document.head.appendChild(st); }
        let ricordato = '';
        try { ricordato = localStorage.getItem('banco_operatore') || ''; } catch (e) { ricordato = ''; }
        root.innerHTML = `<div class="bm-page">
          <div class="bm-head"><h2>Banco · arrivi e montaggio</h2>
            <input id="bm-operatore" placeholder="Chi sei (facoltativo)" value="${esc(ricordato)}" style="width:170px">
            <button id="bm-aggiorna" class="bm-btn">Aggiorna</button><span id="bm-status" class="bm-status"></span></div>
          <div class="bm-muted" style="margin-bottom:10px">Qui si registra solo ciò che succede al banco: arrivo dei pezzi, montaggio e seriali.
            Pezzi, fornitori, acquisti, sostituzioni e costi restano nelle schede degli ordini; le quantità a scorta nella pagina Inventario.</div>
          <div id="bm-riepilogo" class="bm-numeri"></div>
          <div class="bm-subnav"><button data-bm="arrivi" class="active">Arrivi</button><button data-bm="pc">PC da montare</button><button data-bm="banco">Banco</button><button data-bm="valore">Valore</button></div>
          <div class="bm-panel active" data-bmp="arrivi">
            <div class="bm-card"><h3>È arrivata merce</h3>
              <div class="bm-row"><input id="bm-arr-codice" class="bm-scan" placeholder="Spara il codice a barre" autocomplete="off">
                <input id="bm-arr-ordine" placeholder="Ordine (facoltativo, es. #4776)" style="min-width:210px">
                <button id="bm-arr-btn" class="bm-btn primary">Registra arrivo</button></div>
              <div class="bm-muted">Due modi per confermare un arrivo: spari le scatole con il lettore, oppure qui sotto confermi senza lettore la merce che il gestionale si aspetta.</div>
              <div id="bm-arr-log" class="bm-log" style="margin-top:8px"></div></div>
            <div class="bm-card"><div class="bm-row" style="justify-content:space-between"><h3 style="margin:0">Merce che il gestionale si aspetta</h3>
              <input id="bm-arr-cerca" placeholder="Cerca ordine, pezzo, codice, fornitore" style="min-width:260px"></div>
              <div id="bm-arr-gruppi"></div></div>
          </div>
          <div class="bm-panel" data-bmp="pc"><div class="bm-card"><h3>PC da montare</h3>
            <div class="bm-muted" style="margin-bottom:8px">In cima i PC più vicini a essere montati. «Da confermare» = pezzi comprati di cui manca solo la conferma dell'arrivo. «Da ordinare» = pezzi che in Acquisti non risultano ancora ordinati.</div>
            <div class="bm-wrap"><table class="bm-table" id="bm-pc-tab"></table></div></div></div>
          <div class="bm-panel" data-bmp="valore"><div id="bm-valore"></div></div>
          <div class="bm-panel" data-bmp="banco">
            <div class="bm-card"><div class="bm-row"><input id="bm-banco-ordine" placeholder="Ordine (es. #4776)" style="min-width:200px">
              <button id="bm-banco-apri" class="bm-btn primary">Apri PC</button></div></div>
            <div id="bm-banco-corpo"></div></div>
        </div>`;
        root.querySelectorAll('.bm-subnav button').forEach(b => b.addEventListener('click', () => vai(b.dataset.bm)));
        el('bm-aggiorna').onclick = () => aggiorna(true);
        el('bm-arr-codice').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ricevi(); } });
        el('bm-arr-btn').onclick = ricevi;
        el('bm-arr-cerca').addEventListener('input', disegnaAttesa);
        el('bm-banco-ordine').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apriPc(el('bm-banco-ordine').value); } });
        el('bm-banco-apri').onclick = () => apriPc(el('bm-banco-ordine').value);
        return true;
    }
    function vai(nome) {
        sezione = nome;
        root.querySelectorAll('.bm-subnav button').forEach(b => b.classList.toggle('active', b.dataset.bm === nome));
        root.querySelectorAll('.bm-panel').forEach(p => p.classList.toggle('active', p.dataset.bmp === nome));
        disegna();
    }
    function disegna() {
        disegnaRiepilogo();
        if (sezione === 'arrivi') { disegnaAttesa(); setTimeout(() => el('bm-arr-codice') && el('bm-arr-codice').focus(), 50); }
        else if (sezione === 'pc') disegnaPc();
        else if (sezione === 'valore') disegnaValore();
        else disegnaBanco();
    }
    async function aggiorna(avvisa) {
        await azione(async () => { await carica(); disegna(); if (avvisa) stato(`${modello.unita.length} PC da spedire in lavorazione`, 'ok'); });
    }

    /* ------------------------------- ARRIVI ------------------------------- */
    // I numeri che contano, sempre in alto.
    function disegnaRiepilogo() {
        const box = el('bm-riepilogo');
        if (!box) return;
        const conta = (...codici) => modello.unita.filter(u => codici.includes(u.stato.codice)).length;
        const attesa = inAttesa();
        const carte = [[conta('pronto'), 'PC pronti da montare', 'verde'], [conta('montaggio', 'montato'), 'PC in montaggio', 'viola'],
            [conta('confermare'), 'PC a cui manca solo la conferma degli arrivi', 'giallo'], [conta('acquisti'), 'PC fermi per pezzi da ordinare', 'rosso'],
            [daArrivare(attesa.filter(x => comprato(x.r.acquisto))), 'pezzi comprati, arrivo da confermare', 'giallo'],
            [daArrivare(attesa.filter(x => x.r.acquisto === 'escluso')), 'pezzi già in casa secondo Acquisti, da confermare', 'giallo'],
            [daArrivare(attesa.filter(x => x.r.acquisto === 'da_acquistare')), 'pezzi ancora da ordinare', 'rosso']];
        const casa = sommaValori(inCasa());
        carte.push([eur(casa.netto), 'valore netto della merce in casa' + (casa.senzaImporto ? ' · parziale' : ''), 'blu']);
        box.innerHTML = carte.map(([n, t, c]) => `<div class="bm-numero ${c}"><b>${n}</b><span>${esc(t)}</span></div>`).join('');
    }

    // Merce che il gestionale si aspetta: cio' che in Acquisti risulta comprato, fornitore per fornitore.
    function disegnaAttesa() {
        const box = el('bm-arr-gruppi'), q = su(el('bm-arr-cerca').value);
        gruppiVisibili.clear();
        if (!modello.unita.length) { box.innerHTML = '<p class="bm-muted">Nessuna scheda elaborata da spedire. Se hai appena aperto il gestionale, passa prima dalla pagina Ordini e premi Aggiorna.</p>'; return; }
        const voci = inAttesa().filter(x => !q || su([x.u.nome, x.r.c.type, x.r.c.name, x.r.c.ean, x.r.c.supplier].join(' ')).includes(q));
        const fornitori = new Map(), inCasa = [], daOrdinare = [];
        for (const x of voci) {
            if (comprato(x.r.acquisto)) { const nome = su(x.r.c.supplier) || 'SENZA FORNITORE'; if (!fornitori.has(nome)) fornitori.set(nome, []); fornitori.get(nome).push(x); }
            else if (x.r.acquisto === 'escluso') inCasa.push(x);
            else daOrdinare.push(x);
        }
        const pz = n => `${n} ${n === 1 ? 'pezzo' : 'pezzi'}`;
        const blocco = (chiave, titolo, lista, bottone) => {
            const prodotti = new Map();
            for (const x of lista) { const k = identita(x.r.c); if (!prodotti.has(k)) prodotti.set(k, []); prodotti.get(k).push(x); }
            gruppiVisibili.set(chiave, { titolo, voci: lista });
            const valore = sommaValori(daContare(lista));
            const righe = [...prodotti].map(([k, l]) => {
                const c = l[0].r.c, kp = `${chiave}|${k}`, n = daArrivare(l);
                gruppiVisibili.set(kp, { titolo: nomePezzo(c), voci: l });
                return `<tr><td><b>${n} ×</b></td><td class="bm-nome">${esc(nomePezzo(c))}<div class="bm-muted">${esc(c.type)} · ${esc(c.ean)}</div></td>
                  <td>${esc([...new Set(l.map(x => x.u.nome))].join(', '))}</td>
                  <td>${[...new Set(l.map(x => x.r.acquisto))].map(a => `<span class="bm-pill ${COLORE_ACQUISTO[a] || 'blu'}">${esc(ACQUISTO[a])}</span>`).join(' ')}</td>
                  <td>${valoreProdotto(l)}</td>
                  <td style="text-align:right"><button type="button" class="bm-btn sm" data-conferma="${esc(kp)}">${n === 1 ? 'Arrivato' : `Arrivati tutti e ${n}`}</button></td></tr>`;
            }).join('');
            return `<details class="bm-gruppo" data-gruppo="${esc(chiave)}"${q || gruppiAperti.has(chiave) ? ' open' : ''}>
              <summary><span><b>${esc(titolo)}</b> · ${pz(daArrivare(lista))}${valore.pezzi > valore.senzaImporto ? ` · ${eur(valore.netto)} netti${valore.senzaImporto ? ` <span class="bm-muted">(parziale: ${pz(valore.senzaImporto)} senza importo)</span>` : ''}` : ''}</span>
                <button type="button" class="bm-btn sm ok" data-conferma="${esc(chiave)}">${esc(bottone)}</button></summary>
              <table class="bm-table"><tr><th>Q.tà</th><th>Pezzo in scheda</th><th>Per gli ordini</th><th>Acquisto</th><th>Valore netto</th><th></th></tr>${righe}</table></details>`;
        };
        const comprati = [...fornitori].sort((a, b) => daArrivare(b[1]) - daArrivare(a[1]));
        box.innerHTML =
            `<h4 class="bm-sez">Comprata, arrivo da confermare · ${pz(comprati.reduce((n, x) => n + daArrivare(x[1]), 0))}</h4>
             <p class="bm-muted">In Acquisti risulta ordinata o pagata. Quando arriva: sparala con il lettore, oppure confermala qui (un prodotto alla volta o tutto il fornitore).</p>` +
            (comprati.map(([nome, l]) => blocco('forn:' + nome, nome, l, 'È arrivato tutto')).join('') || '<p class="bm-muted">Nessun pezzo comprato in attesa di conferma.</p>') +
            (inCasa.length ? `<h4 class="bm-sez">Già in casa secondo Acquisti · ${pz(daArrivare(inCasa))}</h4>
             <p class="bm-muted">In Acquisti sono «fuori dagli acquisti», cioè non vanno comprati: conferma che ci sono davvero.</p>` + blocco('casa', 'Fuori dagli acquisti', inCasa, 'Ci sono tutti') : '') +
            (daOrdinare.length ? `<h4 class="bm-sez">Ancora da ordinare · ${pz(daArrivare(daOrdinare))}</h4>
             <p class="bm-muted">Non sono attesi: in Acquisti non risultano né ordinati né pagati. Se un pezzo è già in casa puoi confermarlo lo stesso.</p>` + blocco('ordinare', 'Da ordinare', daOrdinare, 'Li ho già tutti') : '');
        box.querySelectorAll('details.bm-gruppo').forEach(d => d.addEventListener('toggle', () => {
            if (su(el('bm-arr-cerca').value)) return;                 // con una ricerca i gruppi sono aperti per mostrare i risultati
            if (d.open) gruppiAperti.add(d.dataset.gruppo); else gruppiAperti.delete(d.dataset.gruppo);
        }));
        box.querySelectorAll('[data-conferma]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); confermaGruppo(b.dataset.conferma); }));
    }
    // Valore di un prodotto della merce attesa: netto registrato e come si paga. Senza importo resta «non registrato».
    function valoreProdotto(l) {
        const v = sommaValori(daContare(l)), regime = l[0].r.regime;
        if (v.pezzi === v.senzaImporto) return '<span class="bm-muted">importo non registrato</span>';
        const comeSiPaga = regime === 'art17' ? 'senza IVA' : v.totale && !v.ivaDaDefinire ? `${eur(v.totale)} con IVA` : '';
        return `<b>${eur(v.netto)}</b>${v.senzaImporto ? ' <span class="bm-muted">(parziale)</span>' : ''}<div class="bm-muted">${esc(REGIMI[regime])}${comeSiPaga ? ' · ' + comeSiPaga : ''}</div>`;
    }
    // Merce in casa: arrivo confermato al banco, per PC non ancora spediti. I pezzi presi dalla scorta
    // dell'Inventario non sono inclusi: il loro costo e' quello del prelievo, gia' nei conti dell'ordine.
    const inCasa = () => tutte().filter(x => x.r.fisica && !x.r.prelievo && x.r.arrivati > 0).map(x => ({ r: x.r, pezzi: x.r.arrivati }));
    const inArrivo = () => daContare(inAttesa().filter(x => comprato(x.r.acquisto)));
    function tabellaValore(titolo, nota, v) {
        const righe = Object.keys(REGIMI).filter(k => v.regimi[k]).map(k => { const g = v.regimi[k]; return `<tr><td><b>${esc(REGIMI[k])}</b></td>
            <td>${g.pezzi}</td><td>${eur(g.netto)}</td><td>${eur(g.iva)}</td><td><b>${eur(g.totale)}</b></td></tr>`; }).join('');
        const avvisi = [v.senzaImporto ? `${v.senzaImporto} ${v.senzaImporto === 1 ? 'pezzo non ha' : 'pezzi non hanno'} un importo registrato in Acquisti: il totale è parziale.` : '',
            v.ivaDaDefinire ? `${v.ivaDaDefinire} ${v.ivaDaDefinire === 1 ? 'pezzo è' : 'pezzi sono'} di un fornitore senza regola IVA nel gestionale: contato solo il netto.` : ''].filter(Boolean);
        return `<div class="bm-card"><h3>${esc(titolo)}</h3><p class="bm-muted" style="margin:0 0 8px">${esc(nota)}</p>` +
            (righe ? `<table class="bm-table"><tr><th>Come si paga</th><th>Pezzi</th><th>Netto</th><th>IVA</th><th>Totale con IVA</th></tr>${righe}
              <tr class="bm-totale"><td>Totale${v.senzaImporto ? ' parziale' : ''}</td><td>${v.pezzi - v.senzaImporto}</td><td>${eur(v.netto)}</td><td>${eur(v.iva)}</td><td>${eur(v.totale)}</td></tr></table>`
                : '<p class="bm-muted">Nessun pezzo con un importo registrato.</p>') +
            avvisi.map(a => `<p class="bm-avviso">${esc(a)}</p>`).join('') + '</div>';
    }
    function disegnaValore() {
        el('bm-valore').innerHTML =
            tabellaValore('Merce in casa', 'Pezzi con l\'arrivo confermato al banco, per PC non ancora spediti (anche se già montati).', sommaValori(inCasa())) +
            tabellaValore('Merce comprata, arrivo da confermare', 'Pezzi ordinati o pagati che il banco non ha ancora visto arrivare.', sommaValori(inArrivo())) +
            `<p class="bm-muted">Gli importi sono quelli già registrati in Acquisti (prezzo confermato, pagato o concordato), netti di IVA; l'IVA segue la regola «come si paga» del gestionale.
              I pezzi presi dalla scorta dell'Inventario non sono inclusi. Nella scheda di montaggio del PC i valori non compaiono.</p>`;
    }
    // Conferma senza lettore: un prodotto, un fornitore intero o i pezzi comprati di un PC.
    async function confermaVoci(titolo, voci) {
        const n = daArrivare(voci);
        if (!n) return;
        const ok = await finestra(`${titolo}: confermi l'arrivo di ${n === 1 ? '1 pezzo' : n + ' pezzi'}?`, [
            { name: 'sicuro', label: n === 1 ? 'Il pezzo è qui' : `Ho controllato: ci sono tutti e ${n}`, type: 'checkbox', required: true }],
            { nota: 'Conferma senza lettore. Se manca qualcosa, annulla e conferma un prodotto alla volta.', ok: 'Conferma arrivo' });
        if (!ok) return;
        await azione(async () => {
            const esito = await db().segnaArrivi(voci, operatore());
            const fatti = esito.fatti.reduce((t, b) => t + (Number(b && b.arrivati) || 0), 0);
            if (esito.fatti.length) log('bm-arr-log', `Confermato senza lettore: ${titolo} · ${fatti === 1 ? '1 pezzo' : fatti + ' pezzi'}`, 'o');
            if (esito.falliti.length) log('bm-arr-log', `${titolo}: ${esito.falliti.length} non confermati (${esito.falliti[0].errore})`, 'e');
            stato(esito.falliti.length ? `Confermati ${esito.fatti.length}, da rivedere ${esito.falliti.length}` : `Arrivo confermato: ${titolo}`, esito.falliti.length ? 'err' : 'ok');
            await carica(); disegna();
        });
    }
    function confermaGruppo(chiave) {
        const g = gruppiVisibili.get(chiave);
        return g ? confermaVoci(g.titolo, g.voci) : undefined;
    }
    const trova = chiave => { const [id, cid] = String(chiave).split('|'); const u = modello.unita.find(x => x.id === id); const r = u && u.righe.find(x => String(x.c.id) === cid); return u && r ? { u, r } : null; };
    function avvisoAcquisto(r) {
        return r.acquisto === 'da_acquistare' ? '  (attenzione: nella pagina Acquisti non risulta ancora ordinato o pagato)'
            : r.acquisto === 'escluso' ? '  (nella pagina Acquisti è fuori dagli acquisti)' : '';
    }

    async function ricevi() {
        const campo = el('bm-arr-codice'), letto = campo.value.trim(), pref = el('bm-arr-ordine').value.trim();
        if (!letto) { campo.focus(); return; }
        await azione(async () => {
            await carica();
            let cand = candidatiArrivo(letto, modello.unita, modello.codici, pref);
            if (!cand.length) {
                const ok = codiciPossibili(letto, modello.codici), noti = tutte().filter(x => ok.has(norm(x.r.c.ean)));
                if (noti.length) {
                    log('bm-arr-log', `${letto}: nessun PC lo aspetta più (già arrivato, montato o preso dal magazzino per ${[...new Set(noti.map(x => x.u.nome))].join(', ')}).`, 'w');
                    campo.select(); return;
                }
                if (!inAttesa().length) { log('bm-arr-log', `${letto}: non ci sono pezzi in attesa di arrivo.`, 'w'); campo.select(); return; }
                const scelta = await scegliPezzo(`Codice ${letto} mai visto`, 'A quale pezzo in attesa corrisponde questa scatola? Se è un prodotto diverso da quelli in elenco, annulla: la sostituzione si conferma nella scheda dell\'ordine.', inAttesa());
                if (!scelta) { log('bm-arr-log', `Annullato: ${letto}`, 'w'); campo.select(); return; }
                await db().associa(letto, scelta.r.c, operatore());
                await carica();
                cand = candidatiArrivo(letto, modello.unita, modello.codici, pref);
                if (!cand.length) throw new Error('Il pezzo non è più in attesa: premi Aggiorna');
            }
            if (pref && cand.every(x => ![x.u.id, x.u.base, x.u.nome, String(x.u.nome).split(' ')[0]].some(v => su(v).replace(/^#/, '') === su(pref).replace(/^#/, '')))) {
                log('bm-arr-log', `L'ordine ${pref} non aspetta questo pezzo. Lo aspettano: ${[...new Set(cand.map(x => x.u.nome))].join(', ')}. Svuota il campo ordine per darlo al primo in coda.`, 'w');
                campo.select(); return;
            }
            const { u, r } = cand[0];
            const b = await db().segnaArrivo(u, r, 1, letto, operatore());
            log('bm-arr-log', `Arrivato ${r.c.type} · ${nomePezzo(r.c)} → ${u.nome}  [${b.arrivati}/${r.quantita}]${avvisoAcquisto(r)}`, r.acquisto === 'da_acquistare' ? 'w' : 'o');
            stato(`Arrivo registrato per ${u.nome}`, 'ok');
            campo.value = '';
            await carica(); disegna();
        });
    }
    async function arrivoAMano(chiave) {
        const x = trova(chiave);
        if (!x) return;
        const ok = await finestra(`Arrivato senza lettore: ${x.r.c.type} per ${x.u.nome}`, [
            { name: 'sicuro', label: `È arrivato: ${nomePezzo(x.r.c)} (${x.r.c.ean})`, type: 'checkbox', required: true }],
            { nota: x.r.quantita > 1 ? `Segna arrivati tutti i ${x.r.quantita} pezzi.` : '', ok: 'Registra arrivo' });
        if (!ok) return;
        await azione(async () => {
            await db().segnaArrivo(x.u, x.r, x.r.quantita, null, operatore());
            log('bm-arr-log', `Arrivato (a mano) ${x.r.c.type} · ${nomePezzo(x.r.c)} → ${x.u.nome}${avvisoAcquisto(x.r)}`, x.r.acquisto === 'da_acquistare' ? 'w' : 'o');
            await carica(); disegna();
        });
    }

    /* ---------------------------- PC DA MONTARE ---------------------------- */
    const coloreStato = c => ({ pronto: 'verde', montaggio: 'viola', montato: 'verde', assemblato: 'verde', collaudato: 'verde', confermare: 'giallo', acquisti: 'rosso', vuoto: 'grigio' }[c] || 'grigio');
    function disegnaPc() {
        const t = el('bm-pc-tab');
        const lista = modello.unita.slice().sort((a, b) => PESO_STATO[a.stato.codice] - PESO_STATO[b.stato.codice] ||
            a.stato.daOrdinare.length - b.stato.daOrdinare.length || a.stato.daConfermare.length - b.stato.daConfermare.length);
        if (!lista.length) { t.innerHTML = '<tr><td class="bm-muted">Nessuna scheda elaborata da spedire.</td></tr>'; return; }
        const tipi = l => esc(l.map(r => r.c.type).join(', '));
        t.innerHTML = '<tr><th>Ordine</th><th>Build</th><th>Scrivania</th><th>Stato</th><th>Arrivati</th><th>Arrivo da confermare</th><th>Da ordinare</th><th>Montati</th><th></th></tr>' +
            lista.map(u => `<tr><td><b>${esc(u.nome)}</b></td><td>${esc(u.build)}</td><td>E${u.foglio}</td>
              <td><span class="bm-pill ${coloreStato(u.stato.codice)}">${esc(u.stato.etichetta)}</span>${u.stato.daRivedere ? ' <span class="bm-pill rosso">pezzo cambiato</span>' : ''}</td>
              <td>${u.stato.pronti}/${u.stato.totale}</td>
              <td>${u.stato.daConfermare.length ? `<b>${u.stato.daConfermare.length}</b> <span class="bm-muted">${tipi(u.stato.daConfermare)}</span>` : ''}</td>
              <td>${u.stato.daOrdinare.length ? `<b>${u.stato.daOrdinare.length}</b> <span class="bm-muted">${tipi(u.stato.daOrdinare)}</span>` : ''}</td>
              <td>${u.stato.montati}/${u.stato.totale}</td>
              <td><button class="bm-btn sm primary" data-pc="${esc(u.id)}">Apri</button></td></tr>`).join('');
        t.querySelectorAll('[data-pc]').forEach(b => { b.onclick = () => { aperta = b.dataset.pc; vai('banco'); }; });
    }

    /* -------------------------------- BANCO -------------------------------- */
    async function apriPc(testo) {
        const q = su(testo).replace(/^#/, '');
        if (!q) { stato('Scrivi il numero dell\'ordine', 'info'); return; }
        await azione(async () => {
            await carica();
            const trovati = modello.unita.filter(u => [u.id, u.base, u.nome, String(u.nome).split(' ')[0]].some(v => su(v).replace(/^#/, '') === q));
            if (!trovati.length) { aperta = null; disegnaBanco(); stato(`Ordine ${testo}: nessuna scheda elaborata da spedire`, 'err'); return; }
            if (trovati.length > 1 && !trovati.some(u => u.id === aperta)) {
                const r = await finestra(`L'ordine ${testo} ha ${trovati.length} PC`, [{ name: 'pc', label: 'Quale apri?', type: 'select', options: trovati.map(u => ({ value: u.id, label: `${u.nome} · ${u.build}` })) }], { ok: 'Apri' });
                if (!r) return;
                aperta = r.pc;
            } else if (trovati.length === 1) aperta = trovati[0].id;
            disegnaBanco();
        });
    }
    function disegnaBanco() {
        const corpo = el('bm-banco-corpo'), u = corrente();
        if (!u) { corpo.innerHTML = '<div class="bm-card bm-muted">Apri un PC scrivendo il numero dell\'ordine, oppure sceglilo da «PC da montare».</div>'; return; }
        if (registro.di !== u.id) { registro.di = u.id; registro.righe = []; }
        const s = u.stato, finito = s.totale > 0 && s.montati === s.totale;
        const comprati = u.righe.filter(r => r.fisica && !r.nonMontare && !r.montato && !r.prelievo && r.arrivati < r.quantita && r.acquisto !== 'da_acquistare');
        const avvisi = [];
        if (u.daRivedere.length) avvisi.push(`<div class="bm-card rosso"><h3>Pezzi a banco che la scheda non chiede più</h3>
            <div class="bm-muted" style="margin-bottom:8px">La scheda è cambiata dopo l'arrivo (sostituzione o modifica nel gestionale). Metti da parte il pezzo e toglilo dal banco; per rimetterlo a scorta usa la pagina Inventario.</div>` +
            u.daRivedere.map(b => `<div class="bm-row"><span><b>${esc(b.tipo)}</b> · ${esc(b.nome || b.codice)} <span class="bm-muted">${esc(b.codice)} · ${esc(b.fornitore || '')}</span> — ${b.montato_il ? 'era stato MONTATO: va smontato' : `arrivati ${b.arrivati}`}</span>
              <button class="bm-btn sm danger" data-togli="${esc(b.id)}">Tolto dal banco</button></div>`).join('') + '</div>');
        if (!u.upgradeVerificati) avvisi.push('<div class="bm-card giallo">Upgrade pagati non verificati qui: i dati della Panoramica non sono caricati in questa sessione. Prima di montare controlla il riquadro «Upgrade» della scheda o il PDF di montaggio.</div>');
        if (u.upgrade.length) avvisi.push('<div class="bm-card giallo"><h3>Upgrade pagati dal cliente</h3>' + u.upgrade.map(p =>
            `<div>Al posto di <b>${esc(p.precedente && (p.precedente.nome || p.precedente.ean))}</b> si monta <b>${esc(p.descrizione || p.scelta)}</b> <span class="bm-muted">(${esc(p.tipo)}${p.ordine ? ' · ordine upgrade ' + esc(p.ordine) : ''})</span></div>`).join('') + '</div>');
        if (u.prelieviLiberi.length) avvisi.push('<div class="bm-card giallo">Prelievi di magazzino registrati per questo PC che non corrispondono a un pezzo della scheda di oggi: ' +
            u.prelieviLiberi.map(p => `<b>${esc(p.descrizione || p.defId)}</b>`).join(', ') + '. Controlla la scheda dell\'ordine.</div>');
        const righe = u.righe.map(r => {
            const k = `${esc(u.id)}|${esc(r.c.id)}`;
            let arrivo, cls = '';
            if (r.nonMontare) { arrivo = '<span class="bm-pill grigio">NON MONTARE</span>'; cls = 'spento'; }
            else if (!r.fisica) arrivo = '<span class="bm-pill grigio">Da fare al banco</span>';
            else if (r.prelievo) arrivo = '<span class="bm-pill blu">Dal magazzino</span>';
            else if (r.arrivati >= r.quantita) arrivo = '<span class="bm-pill blu">Arrivato</span>';
            else if (r.acquisto === 'da_acquistare') arrivo = `<span class="bm-pill rosso">${r.arrivati ? `Arrivati ${r.arrivati}/${r.quantita} · ` : ''}Da ordinare</span>`;
            else arrivo = `<span class="bm-pill ${COLORE_ACQUISTO[r.acquisto] || 'giallo'}">${r.arrivati ? `Arrivati ${r.arrivati}/${r.quantita}` : 'Arrivo da confermare'} · ${esc(ACQUISTO[r.acquisto].toLowerCase())}</span>`;
            const montaggio = r.nonMontare ? `<span class="bm-muted">monta: ${esc(r.nonMontare.descrizione)}</span>`
                : r.montato ? `<span class="bm-pill verde">Montato</span>${r.b.seriale ? ` <span class="bm-muted">S/N ${esc(r.b.seriale)}</span>` : ''}` : '';
            const azioni = r.nonMontare ? '' : r.montato ? `<button class="bm-btn sm danger" data-smo="${k}">Smonta</button>`
                : `<button class="bm-btn sm ok" data-mon="${k}">Montato</button>` + (r.fisica && !r.prelievo
                    ? (r.arrivati >= r.quantita ? ` <button class="bm-btn sm" data-noarr="${k}">Annulla arrivo</button>` : ` <button class="bm-btn sm" data-arr="${k}">Arrivato</button>`) : '');
            return `<tr class="${cls}"><td><b>${esc(r.c.type)}</b>${r.quantita > 1 ? ` × ${r.quantita}` : ''}</td><td class="bm-nome">${esc(nomePezzo(r.c))}</td><td class="bm-muted">${esc(r.c.ean)}</td>
              <td>${esc(r.c.supplier)}</td><td>${arrivo}</td><td>${montaggio}</td><td style="white-space:nowrap">${azioni}</td></tr>`;
        }).join('');
        corpo.innerHTML = avvisi.join('') + `<div class="bm-card">
            <div class="bm-row" style="justify-content:space-between"><h3 style="margin:0">${esc(u.nome)} · ${esc(u.build)} <span class="bm-pill ${coloreStato(s.codice)}">${esc(s.etichetta)}</span></h3>
              <span class="bm-muted">scrivania E${u.foglio} · montati ${s.montati}/${s.totale}</span></div>
            ${finito ? '' : `<div class="bm-row"><input id="bm-mon-codice" class="bm-scan" placeholder="Spara il pezzo che stai montando" autocomplete="off">
              <input id="bm-mon-seriale" placeholder="Seriale del pezzo (facoltativo)" style="min-width:200px"><button id="bm-mon-btn" class="bm-btn ok">Monta</button></div>`}
            ${comprati.length ? `<div class="bm-row"><button id="bm-pc-arrivati" class="bm-btn">Sono arrivati tutti i pezzi comprati di questo PC (${daArrivare(comprati.map(r => ({ u, r })))})</button></div>` : ''}
            <div id="bm-mon-log" class="bm-log" style="max-height:110px">${registro.righe.map(x => `<div class="${x.cls}">${esc(x.testo)}</div>`).join('')}</div></div>
          <div class="bm-card"><div class="bm-wrap"><table class="bm-table"><tr><th>Tipo</th><th>Pezzo in scheda</th><th>Codice</th><th>Fornitore</th><th>Arrivo</th><th>Montaggio</th><th></th></tr>${righe}</table></div></div>` +
          (finito ? chiusura(u) : '');
        const campo = el('bm-mon-codice');
        if (campo) {
            campo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); monta(); } });
            el('bm-mon-btn').onclick = monta;
            setTimeout(() => campo.focus(), 50);
        }
        corpo.querySelectorAll('[data-arr]').forEach(b => { b.onclick = () => arrivoAMano(b.dataset.arr); });
        corpo.querySelectorAll('[data-noarr]').forEach(b => { b.onclick = () => conRiga(b.dataset.noarr, x => db().annullaArrivo(x.u, x.r), 'Arrivo annullato'); });
        corpo.querySelectorAll('[data-mon]').forEach(b => { b.onclick = () => montaAMano(b.dataset.mon); });
        corpo.querySelectorAll('[data-smo]').forEach(b => { b.onclick = () => conRiga(b.dataset.smo, x => db().smonta(x.u, x.r), 'Pezzo smontato'); });
        corpo.querySelectorAll('[data-togli]').forEach(b => { b.onclick = () => togliDalBanco(u, b.dataset.togli); });
        const bAss = el('bm-pc-assemblato'), bCol = el('bm-pc-collaudato'), bRia = el('bm-pc-riapri');
        if (bAss) bAss.onclick = () => chiudiPc(u);
        if (el('bm-pc-arrivati')) el('bm-pc-arrivati').onclick = () => confermaVoci(u.nome, comprati.map(r => ({ u, r })));
        if (bCol) bCol.onclick = () => azione(async () => { await db().salvaPc(u.id, { stato: 'collaudato', collaudato_il: new Date().toISOString() }); stato(`${u.nome}: collaudato`, 'ok'); await carica(); disegna(); });
        if (bRia) bRia.onclick = () => azione(async () => { await db().riapriPc(u.id); stato(`${u.nome}: riaperto`, 'info'); await carica(); disegna(); });
    }
    function chiusura(u) {
        const pc = u.pc;
        if (!pc) return '<div class="bm-card"><h3>Tutti i pezzi sono montati</h3><button id="bm-pc-assemblato" class="bm-btn ok">Segna PC ASSEMBLATO</button></div>';
        return `<div class="bm-card"><h3>PC ${esc(pc.stato === 'collaudato' ? 'collaudato' : 'assemblato')}</h3><div class="bm-row"><span>Seriale PC <b>${esc(pc.seriale_pc || '—')}</b>${pc.operatore ? ` · ${esc(pc.operatore)}` : ''}</span>
            ${pc.stato === 'assemblato' ? '<button id="bm-pc-collaudato" class="bm-btn primary">Collaudato</button>' : ''}<button id="bm-pc-riapri" class="bm-btn">Riapri</button></div>
            <div class="bm-muted">La spedizione si registra come sempre: qui lo stato si ferma al collaudo.</div></div>`;
    }
    async function conRiga(chiave, fn, messaggio) {
        const x = trova(chiave);
        if (!x) return;
        await azione(async () => { await fn(x); stato(messaggio, 'ok'); await carica(); disegna(); });
    }
    async function monta() {
        const campo = el('bm-mon-codice'), letto = campo.value.trim(), seriale = el('bm-mon-seriale').value.trim();
        if (!letto) { campo.focus(); return; }
        await azione(async () => {
            await carica();
            let u = corrente();
            if (!u) throw new Error('Il PC non è più tra le schede da spedire');
            let cand = candidatiMontaggio(letto, u, modello.codici);
            if (!cand.length) {
                const ok = codiciPossibili(letto, modello.codici), qui = u.righe.filter(r => ok.has(norm(r.c.ean)));
                const fermo = qui.find(r => r.nonMontare);
                if (fermo) { log('bm-mon-log', `NON MONTARE ${fermo.c.type}: il cliente ha pagato un upgrade. Si monta ${fermo.nonMontare.descrizione}.`, 'e'); campo.select(); return; }
                if (qui.length) { log('bm-mon-log', `${nomePezzo(qui[0].c)}: già montato su questo PC.`, 'w'); campo.select(); return; }
                const altrove = tutte().filter(x => x.u.id !== u.id && !x.r.montato && ok.has(norm(x.r.c.ean)));
                if (altrove.length) {
                    log('bm-mon-log', `BLOCCATO: questo pezzo è per ${[...new Set(altrove.map(x => x.u.nome))].join(', ')}, non è nella scheda di ${u.nome}. Se il fornitore lo ha mandato al posto di un altro, conferma prima la sostituzione nella scheda dell'ordine.`, 'e');
                    campo.select(); return;
                }
                const libere = u.righe.filter(r => r.fisica && !r.montato && !r.nonMontare);
                if (!libere.length) { log('bm-mon-log', `${letto}: su questo PC non ci sono pezzi da montare.`, 'w'); campo.select(); return; }
                const scelta = await scegliPezzo(`Codice ${letto} mai visto`, 'A quale pezzo di questa scheda corrisponde? Se è un prodotto diverso da quello scritto in scheda, annulla e usa «Sostituisci» nella scheda dell\'ordine: al banco si monta solo ciò che la scheda chiede.', libere.map(r => ({ u, r })));
                if (!scelta) { log('bm-mon-log', `Annullato: ${letto}`, 'w'); campo.select(); return; }
                await db().associa(letto, scelta.r.c, operatore());
                await carica();
                u = corrente();
                cand = u ? candidatiMontaggio(letto, u, modello.codici) : [];
                if (!cand.length) throw new Error('Il pezzo non è più da montare: premi Aggiorna');
            }
            const r = cand[0], senzaArrivo = r.fisica && !r.prelievo && r.arrivati < r.quantita;
            await db().segnaMontato(u, r, seriale, operatore(), letto);
            log('bm-mon-log', `Montato ${r.c.type} · ${nomePezzo(r.c)}${seriale ? ' · S/N ' + seriale : ''}${senzaArrivo ? '  (arrivo registrato adesso)' : ''}`, 'o');
            await carica(); disegna();
            stato(`Montato ${r.c.type}`, 'ok');
        });
    }
    async function montaAMano(chiave) {
        const x = trova(chiave);
        if (!x) return;
        const r = await finestra(`${x.r.fisica ? 'Montato' : 'Fatto'}: ${x.r.c.type} per ${x.u.nome}`, [
            ...(x.r.fisica ? [{ name: 'seriale', label: 'Seriale del pezzo (facoltativo)' }] : []),
            { name: 'sicuro', label: `${x.r.fisica ? 'Ho montato' : 'Fatto'}: ${nomePezzo(x.r.c)}${x.r.fisica ? ` (${x.r.c.ean})` : ''}`, type: 'checkbox', required: true }],
            { ok: x.r.fisica ? 'Segna montato' : 'Segna fatto' });
        if (!r) return;
        await azione(async () => { await db().segnaMontato(x.u, x.r, r.seriale || '', operatore(), null); stato(`${x.r.c.type}: registrato`, 'ok'); await carica(); disegna(); });
    }
    async function togliDalBanco(u, idRiga) {
        const b = u.daRivedere.find(x => String(x.id) === String(idRiga));
        if (!b) return;
        const r = await finestra(`Togliere dal banco: ${b.nome || b.codice}`, [{ name: 'sicuro', label: b.montato_il ? 'Ho smontato il pezzo e l\'ho messo da parte' : 'Ho messo il pezzo da parte', type: 'checkbox', required: true }],
            { nota: 'Il banco dimentica questo arrivo. Non cambia giacenze né acquisti: per quelli usa Inventario e la scheda dell\'ordine.', ok: 'Togli dal banco' });
        if (!r) return;
        await azione(async () => { await db().togli(b); stato('Pezzo tolto dal banco', 'ok'); await carica(); disegna(); });
    }
    async function chiudiPc(u) {
        const r = await finestra(`${u.nome}: PC assemblato`, [{ name: 'seriale_pc', label: 'Seriale del PC finito (facoltativo)' },
            ...u.upgrade.map((p, i) => ({ name: 'up' + i, label: `Upgrade pagato montato: ${p.descrizione || p.scelta}`, type: 'checkbox', required: true })),
            ...(u.upgradeVerificati ? [] : [{ name: 'upv', label: 'Ho controllato gli upgrade pagati nella scheda o nel PDF di montaggio', type: 'checkbox', required: true }])],
            { ok: 'Segna ASSEMBLATO' });
        if (!r) return;
        await azione(async () => {
            await db().salvaPc(u.id, { stato: 'assemblato', seriale_pc: r.seriale_pc || null, operatore: operatore(), assemblato_il: new Date().toISOString(), collaudato_il: null });
            stato(`${u.nome}: PC ASSEMBLATO`, 'ok');
            await carica(); disegna();
        });
    }

    // Come la pagina Acquisti: tornando sulla scheda del browser si rileggono distinte e stati d'acquisto,
    // cosi' un acquisto o una sostituzione fatti altrove non restano fermi a prima. Mai sopra un lavoro in corso.
    function aggiornaAlRitorno() {
        if (document.visibilityState !== 'visible' || inCorso || !root || document.querySelector('.bm-modal-ov') ||
            !document.querySelector('#banco-container.active') ||
            ['bm-arr-codice', 'bm-mon-codice', 'bm-mon-seriale'].some(id => el(id) && el(id).value.trim())) return;
        aggiorna(false);
    }

    /* -------------------------------- avvio -------------------------------- */
    function avvia() {
        if (!costruisci()) return;
        document.querySelectorAll('.tab-button').forEach(b => b.addEventListener('click', () => {
            chiudiFinestre();                                   // nessuna finestra del banco resta aperta su un'altra pagina
            if (b.dataset.tab === 'banco') aggiorna(false);
        }));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia); else avvia();
    document.addEventListener('visibilitychange', aggiornaAlRitorno);
    window.BancoMontaggio.ui = { aggiorna, vai, apriPc };
})();
