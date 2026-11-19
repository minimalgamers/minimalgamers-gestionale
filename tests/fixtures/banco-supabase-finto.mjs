// Supabase finto in memoria per i test del banco: solo il sottoinsieme di query usato da
// banco-montaggio.js, con i vincoli di unicita' di sql/banco_montaggio.sql. Dati inventati.
const UNICI = {
    banco_pezzi: ['ordine_id', 'componente_id'],
    banco_pc: ['ordine_id'],
    banco_codici: ['codice_letto', 'codice']
};
const PREDEFINITI = { banco_pezzi: { quantita: 1, arrivati: 0 }, banco_pc: { stato: 'assemblato' } };
const copia = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const uguale = (a, b) => a === b || (a != null && b != null && String(a) === String(b));

export function creaSupabaseFinto(db, opzioni = {}) {
    db._seq = db._seq || 1000;
    const registro = [];                      // ogni operazione eseguita: { tabella, op }
    class Q {
        constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.uno = false; this.p = null; }
        select() { return this; }
        eq(c, v) { this.f.push(r => uguale(r[c], v)); return this; }
        in(c, v) { this.f.push(r => v.some(x => uguale(r[c], x))); this.inSize = v.length; return this; }
        is(c, v) { this.f.push(r => (r[c] == null ? null : r[c]) === v); return this; }
        like(c, v) { const p = String(v).replace(/%$/, ''); this.f.push(r => String(r[c] || '').startsWith(p)); return this; }
        maybeSingle() { this.uno = true; return this; }
        insert(p) { this.op = 'insert'; this.p = p; return this; }
        update(p) { this.op = 'update'; this.p = p; return this; }
        delete() { this.op = 'delete'; return this; }
        then(ok, ko) { return Promise.resolve().then(() => this.esegui()).then(ok, ko); }
        esegui() {
            registro.push({ tabella: this.t, op: this.op, inSize: this.inSize || 0 });
            if ((opzioni.tabelleMancanti || []).includes(this.t))
                return { data: null, error: { message: `relation "public.${this.t}" does not exist` } };
            const righe = db[this.t] || (db[this.t] = []);
            const filtro = r => this.f.every(fn => fn(r));
            if (this.op === 'insert') {
                const r = { ...(PREDEFINITI[this.t] || {}) };
                for (const k of Object.keys(this.p)) if (this.p[k] !== undefined) r[k] = this.p[k];
                const chiavi = UNICI[this.t];
                if (chiavi && righe.some(x => chiavi.every(k => uguale(x[k], r[k]))))
                    return { data: null, error: { message: `duplicate key value violates unique constraint "${this.t}"` } };
                if (r.id == null) r.id = ++db._seq;
                righe.push(r);
                return { data: this.uno ? copia(r) : [copia(r)], error: null };
            }
            if (this.op === 'update') {
                const m = righe.filter(filtro);
                m.forEach(r => { for (const k of Object.keys(this.p)) if (this.p[k] !== undefined) r[k] = this.p[k]; });
                return { data: this.uno ? copia(m[0] || null) : copia(m), error: null };
            }
            if (this.op === 'delete') {
                const m = righe.filter(filtro);
                db[this.t] = righe.filter(r => !m.includes(r));
                return { data: copia(m), error: null };
            }
            const res = righe.filter(filtro);
            return { data: this.uno ? copia(res[0] || null) : copia(res), error: null };
        }
    }
    return { from: t => new Q(t), registro };
}

// Tre PC inventati: un Minimal, un ordine con due PC uguali, un PC con upgrade pagato.
export function datiDiProva() {
    const comp = (id, order_id, component_type, ean, product_name, supplier, extra = {}) =>
        ({ id, order_id, component_type, ean, product_name, supplier, price: null, quantity: 1, is_custom: 0, ...extra });
    return {
        processed_orders: [
            { id: 1, shopify_order_id: '6001', order_id_flip: '#4701', config_name: 'PC GAMING TERMINATOR', stato: 'elaborati', foglio_di_lavoro: 1,
              custom_properties: { _acquisti_parziali_gestionale: {
                  11: { id: 11, type: 'GPU', ean: 'GPU-5070-DEMO', supplier: 'ALFA', quantity: 1, stato: 'pagato' },
                  12: { id: 12, type: 'CPU', ean: '0730143314572', supplier: 'BETA', quantity: 1, stato: 'ordinato' } } } },
            { id: 2, shopify_order_id: '6002', order_id_flip: '#4702', config_name: 'PC GAMING REX', stato: 'elaborati', foglio_di_lavoro: 2, custom_properties: '{}' },
            { id: 3, shopify_order_id: '6002.2', order_id_flip: '#4702', config_name: 'PC GAMING REX', stato: 'elaborati', foglio_di_lavoro: 2, custom_properties: null },
            { id: 4, shopify_order_id: '5990', order_id_flip: '#4690', config_name: 'PC GAMING STREAM', stato: 'finalizzati', foglio_di_lavoro: 1, custom_properties: null }
        ],
        processed_order_components: [
            comp(11, 1, 'GPU', 'GPU-5070-DEMO', 'Scheda video demo 5070 12GB', 'ALFA'),
            comp(12, 1, 'CPU', '0730143314572', 'Processore demo 8 core', 'BETA'),
            comp(13, 1, 'PSU', 'PF600-DEMO', 'Alimentatore demo 600W', 'MAGAZZINO'),
            comp(14, 1, 'VENTOLE', 'FAN-RGB-DEMO', 'Ventola demo RGB', 'ALFA', { quantity: 3 }),
            comp(15, 1, 'SOFTWARE', 'UFFICIO E STUDIO', 'Pacchetto software demo', ''),
            comp(21, 2, 'GPU', 'GPU-5070-DEMO', 'Scheda video demo 5070 12GB', 'ALFA', { price: 1 }),
            comp(22, 2, 'COOLER', 'AIR-DEMO', 'Dissipatore ad aria demo', 'ALFA'),
            comp(31, 3, 'GPU', 'GPU-5070-DEMO', 'Scheda video demo 5070 12GB', 'ALFA'),
            comp(41, 4, 'GPU', 'GPU-5070-DEMO', 'Scheda video demo 5070 12GB', 'ALFA')
        ],
        warehouse_inventory: [
            { ean: 'MAG-PROD-PSU-PF600DEMO-1a2b', name: 'Alimentatore demo 600W', quantity: 4 },
            { ean: 'MAG-USO-6001-1-PROD-PSU-PF600DEMO-1a2b', name: JSON.stringify({ nome: 'Magazzino → ordine #4701: Alimentatore demo 600W', unitario: 1, quantita: 1 }), quantity: 1 },
            { ean: 'MAG-USO-6002-2-PROD-COOLER-AIRDEMO-9f9f', name: 'Magazzino → ordine #4702: Dissipatore ad aria demo', quantity: 1 }
        ],
        banco_pezzi: [], banco_pc: [], banco_codici: []
    };
}
