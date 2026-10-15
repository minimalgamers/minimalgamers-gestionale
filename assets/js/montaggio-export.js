// Vista per gli assemblatori: solo presentazione, nessuna scrittura di pezzi/prezzi.
(function () {
    'use strict';
    const key = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = ['CPU', 'MOBO', 'SSD', 'RAM', 'GPU', 'PSU', 'COOLER', 'CASE'];
    const aliases = {
        PROCESSORE: 'CPU', CPU: 'CPU', SCHEDAMADRE: 'MOBO', MOBO: 'MOBO', MOTHERBOARD: 'MOBO',
        SSD: 'SSD', RAM: 'RAM', GPU: 'GPU', SCHEDAVIDEO: 'GPU', PSU: 'PSU', ALIMENTATORE: 'PSU',
        COOLER: 'COOLER', DISSIPATORE: 'COOLER', CASE: 'CASE',
        VENTOLE: 'VENTOLE', VENTOLERGB: 'VENTOLE', WIFI: 'CONNETTIVITÀ', CONNETTIVITA: 'CONNETTIVITÀ',
        SOFTWARE: 'SOFTWARE', SCATOLE: 'SCATOLE', SCATOLECOMPONENTI: 'SCATOLE', SERVIZIO: 'SCATOLE',
        SSDEXTRA: 'ARCHIVIAZIONE AGGIUNTIVA', SSDADDON: 'ARCHIVIAZIONE AGGIUNTIVA',
        SSDAGGIUNTIVO: 'ARCHIVIAZIONE AGGIUNTIVA', ARCHIVIAZIONEAGGIUNTIVA: 'ARCHIVIAZIONE AGGIUNTIVA',
        MONITOR: 'MONITOR', KIT: 'KIT GAMING', KITGAMING: 'KIT GAMING', SEDIA: 'SEDIA', SCRIVANIA: 'SCRIVANIA'
    };
    const categoria = tipo => aliases[key(tipo)] || 'EXTRA';
    function colore(testo) {
        const s = String(testo || '').toUpperCase();
        const bianco = /\bWHITE\b|\bBIANC[OAHEI]*\b|\bSNOW\b/.test(s);
        const nero = /\bBLACK\b|\bNER[OAHEI]*\b|\bPITCH\b/.test(s);
        return bianco === nero ? '' : bianco ? 'WHITE' : 'BLACK';
    }
    function proprietaCase(props) {
        return Object.entries(props || {}).filter(([k]) => /^(CASE|COLORE CASE|CASE COLOR)$/i.test(k.trim())).map(([,v]) => v).join(' ');
    }
    function coloreCase(componenti, ordine, salvato) {
        const c = (componenti || []).find(x => categoria(x.tipo || x.type) === 'CASE') || {};
        // Il colore del pezzo effettivamente salvato prevale. Mai derivarlo da GPU/MOBO.
        const reale = colore(c.nome || c.name) || colore(c.ean || c.value);
        if (reale) return reale;
        const noti = { 'GEHY-037':'BLACK', 'GEHY-034':'WHITE', 'GELI-975':'BLACK', 'GELI-976':'WHITE' };
        if (noti[String(c.ean || c.value || '').toUpperCase()]) return noti[String(c.ean || c.value).toUpperCase()];
        const props = colore(proprietaCase(salvato?.customProperties));
        if (props) return props;
        // items contiene solo il PC di questa scheda (anche per ordini divisi).
        const pcs = (ordine?.items || []).filter(x => /PC GAMING|MSI|DEEPCOOL/i.test(x.name || ''));
        if (pcs.length === 1) return colore(proprietaCase(pcs[0].customProperties || pcs[0].custom_properties));
        return '';
    }
    const nomeColore = c => c === 'WHITE' ? 'BIANCO (WHITE)' : c === 'BLACK' ? 'NERO (BLACK)' : 'DA VERIFICARE';
    function descrizioneCase(nome, c) {
        return String(nome || '').replace(/\s*[-·]\s*COLORE(?: CASE)?:.*$/i, '').trim() + ' - COLORE: ' + nomeColore(c);
    }
    function descrizioneVentole(nome, c) {
        if (!/BUILD\s+FULL\s+VENTOLE/i.test(String(nome))) return String(nome || '');
        return 'BUILD FULL VENTOLE - 5X VENTOLE RGB - ' + nomeColore(c) + ' - stesso colore del case';
    }
    function distinta(righe, opzioni, pagati, piano, c) {
        const records = [], seen = new Set();
        const add = (tipo, nome, scelta) => {
            const testo = String(nome || '').trim();
            if (!testo) return;
            const cat = categoria(tipo), id = cat + '|' + key(scelta || testo);
            if (seen.has(id)) return;
            const etichetta = String(tipo || '').trim();
            const leggibile = cat === 'EXTRA' && key(etichetta) !== 'EXTRA' && !key(testo).includes(key(etichetta))
                ? etichetta + ': ' + testo : testo;
            seen.add(id); records.push({ tipo: cat, nome: leggibile, scelta: scelta || testo });
        };
        for (const r of righe || []) add(r.tipo, r.nome, r.scelta);
        for (const r of opzioni || []) add(r.tipo, r.nome, r.scelta);
        for (const u of pagati || []) {
            const cat = categoria(u.categoria) !== 'EXTRA' ? categoria(u.categoria) : categoria(u.chiave);
            if (base.includes(cat)) {
                const p = (piano || []).find(x => categoria(x.tipo) === cat);
                const existing = records.findIndex(x => x.tipo === cat);
                const r = { tipo: cat, nome: p?.descrizione || u.valore, scelta: u.valore };
                if (existing >= 0) records[existing] = r; else add(cat, r.nome, r.scelta);
            } else {
                const p = records.find(x => x.tipo === cat && key(x.scelta) === key(u.valore));
                if (!p) add(cat === 'EXTRA' ? u.categoria || u.chiave || 'EXTRA' : cat, u.valore, u.valore);
            }
        }
        // La chiave di deduplica resta quella della scelta, non il testo arricchito.
        return records.map(r => ({ ...r, nome: r.tipo === 'CASE' ? descrizioneCase(r.nome, c)
            : r.tipo === 'VENTOLE' ? descrizioneVentole(r.nome, c) : r.nome }));
    }
    const api = { categoria, colore, coloreCase, nomeColore, descrizioneCase, descrizioneVentole, distinta, base };
    if (typeof window !== 'undefined') window.MontaggioExport = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
