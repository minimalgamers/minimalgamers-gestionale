/* Paid upgrades stay attached to their original physical PC. No order/database writes. */
(function () {
    'use strict';
    const norm = v => String(v || '').trim().toUpperCase();
    const id = v => String(v || '').split('/').pop();
    const props = li => Array.isArray(li.properties) ? Object.fromEntries(li.properties.map(p => [p.name, p.value])) : li.properties || {};
    const pc = li => !/^OPZIONI\b/i.test(li.name || li.title || '') &&
        (/\bPC\s+GAMING\b/i.test(li.name || li.title || '') || props(li)._has_gpo);
    const quantity = li => Number(li.current_quantity ?? li.quantity);

    function riferimenti(ordini) {
        const originali = new Map((ordini || []).map(o => [String(o.id), o]));
        const out = new Map();
        for (const o of ordini || []) {
            if (o.cancelled_at || !['paid', 'partially_refunded'].includes(o.financial_status)) continue;
            const lines = o.line_items || [];
            if (o.financial_status === 'partially_refunded') {
                const total = Number(o.current_total_price);
                const remaining = lines.reduce((n, li) => n + Number(li.price || 0) * quantity(li) -
                    (li.discount_allocations || []).reduce((t, d) => t + Number(d.amount || 0), 0) * quantity(li) / Number(li.quantity || 1), 0);
                if (o.current_total_price == null || !Number.isFinite(total) || total + .01 < remaining) continue;
            }
            lines.forEach((li, indice) => {
                const p = props(li), original = originali.get(String(p._upgrade_ordine_id || ''));
                if (!original || original.cancelled_at || original.fulfillment_status === 'fulfilled' || quantity(li) <= 0 ||
                    !p._upgrade_chiave || !p._upgrade_valore || !p._upgrade_linea_id) return;
                const pcs = (original.line_items || []).filter(pc);
                const target = pcs.find(l => id(l.id) === id(p._upgrade_linea_id));
                const unit = p._upgrade_unita == null || p._upgrade_unita === '' ? 0 : Number(p._upgrade_unita);
                if (!target || !Number.isInteger(unit) || unit < 0 || unit >= quantity(target) ||
                    quantity(target) !== Number(target.quantity)) return;
                // Older records without a unit never extend one purchase to two identical PCs.
                if ((p._upgrade_unita == null || p._upgrade_unita === '') && target.quantity > 1) return;
                const totalPc = pcs.reduce((n, l) => n + Number(l.quantity), 0);
                const number = pcs.slice(0, pcs.indexOf(target)).reduce((n, l) => n + Number(l.quantity), 0) + unit + 1;
                const key = `${o.id}:${li.id || indice}`;
                out.set(key, { key, id_upgrade: String(o.id), ordine_upgrade: o.name,
                    originale: String(original.id), scheda: String(original.id) + (totalPc > 1 ? '.' + number : ''),
                    linea_id: id(target.id), unita: unit, categoria: p._upgrade_categoria || p._upgrade_chiave,
                    valore: p._upgrade_valore });
            });
        }
        return [...out.values()];
    }

    function inAttesa(events, dati, A) {
        return events.filter(e => {
            const p = A.pcAutomatico(dati, e.scheda);
            if (!p || id(p.linea_id) !== e.linea_id || p.unita !== e.unita) return true;
            return !(p.upgrade_pagati || []).some(u =>
                (u.id_upgrade ? String(u.id_upgrade) === e.id_upgrade : u.ordine_upgrade === e.ordine_upgrade) &&
                norm(u.valore) === norm(e.valore));
        });
    }

    function monitor(config) {
        let running = null, lastRequest = -Infinity, lastSignature = null, previous = [], withdrawn = [];
        const now = config.now || Date.now;
        function tick(initial) {
            if (running) return running;
            running = (async () => {
                if (config.attivo && !config.attivo()) return;
                const orders = initial || await config.leggiOrdini();
                const events = riferimenti(orders);
                if (!events.length && lastSignature === null) return;
                const dati = await config.caricaDati();
                const pending = inAttesa(events, dati, config.A);
                withdrawn = [...new Map([...withdrawn, ...previous.filter(e => !events.some(n => n.key === e.key))].map(e => [e.key,e])).values()]
                    .filter(e => !events.some(n => n.key === e.key) && inAttesa([e], dati, config.A).length === 0);
                previous = events;
                config.A.upgradeInAttesa([...pending, ...withdrawn.map(e => ({...e, ritirato:true}))]);
                const signature = JSON.stringify([dati.generato, events, pending, withdrawn]);
                if (signature !== lastSignature) {
                    await config.ridisegna();
                    lastSignature = signature;
                }
                if ((pending.length || withdrawn.length) && now() - lastRequest >= 5 * 60 * 1000) {
                    lastRequest = now();
                    await config.richiediAggiornamento();
                }
                return { pagati: events.length, in_attesa: pending.length };
            })().catch(() => { config.errore?.(); }).finally(() => { running = null; });
            return running;
        }
        return { tick };
    }
    let singleton;
    function avvia(config, ordini) {
        if (!singleton) {
            singleton = monitor(config);
            setInterval(() => singleton.tick(), 60 * 1000);
            document.addEventListener('visibilitychange', () => { if (!document.hidden) singleton.tick(); });
        }
        return singleton.tick(ordini);
    }
    const api = { riferimenti, inAttesa, monitor, avvia, verifica: () => singleton?.tick() };
    if (typeof window !== 'undefined') window.UpgradePaidSync = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
