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
        SOFTWARE: 'SOFTWARE', SCATOLE: 'SCATOLE', SCATOLECOMPONENTI: 'SCATOLE',
        SSDEXTRA: 'ARCHIVIAZIONE AGGIUNTIVA', SSDADDON: 'ARCHIVIAZIONE AGGIUNTIVA',
        SSDAGGIUNTIVO: 'ARCHIVIAZIONE AGGIUNTIVA', ARCHIVIAZIONEAGGIUNTIVA: 'ARCHIVIAZIONE AGGIUNTIVA',
        MONITOR: 'MONITOR', KIT: 'KIT GAMING', KITGAMING: 'KIT GAMING', SEDIA: 'SEDIA', SCRIVANIA: 'SCRIVANIA'
    };
    const categoria = tipo => aliases[key(tipo)] || 'EXTRA';
    const fisici = [...base, 'VENTOLE', 'CONNETTIVITÀ', 'ARCHIVIAZIONE AGGIUNTIVA', 'MONITOR', 'KIT GAMING', 'SEDIA', 'SCRIVANIA'];
    // Contenuti da LISTINI-MINIMAL-GAMERS/pacchetti_software.json, blob
    // 43b57f2c9d714f5f7525bd5b4d638b805d69af09. Nessun prezzo/licenza dedotto.
    const software = {
        UFFICIOESTUDIO: ["LibreOffice (testi, fogli di calcolo e presentazioni; apre e salva i file Word, Excel e PowerPoint)", "PDF24 (crea, unisce e modifica PDF)", "7-Zip", "Google Chrome e Mozilla Firefox", "VLC", "Thunderbird (posta)", "Dizionario italiano"],
        STREAMINGPRONTO: ["OBS Studio gia' configurato (scene, codifica sulla scheda video, filtri del microfono)", "Discord", "NVIDIA Broadcast (con schede video RTX)", "ShareX (catture e clip)", "Audacity", "Shotcut (montaggio video)"],
        CREATOR: ["DaVinci Resolve", "GIMP", "Krita", "Inkscape", "Blender", "Audacity", "HandBrake"],
        GAMINGPRONTO: ["Steam", "Epic Games Launcher", "EA app", "Ubisoft Connect", "Battle.net", "GOG Galaxy", "Discord", "MSI Afterburner", "Driver della scheda video aggiornati"]
    };
    const chiaveSoftware = s => key(s).replace(/^SOFTWARE/, '').replace(/^PACCHETTO/, '');
    function categoriaVoce(tipo, nome) {
        // SERVIZIO non significa sempre scatole: una voce sconosciuta resta EXTRA.
        return key(tipo) === 'SERVIZIO' && /^CONSEGNASCATOLE(?:ORIGINALI(?:DISPONIBILI)?)?$/.test(key(nome)) ? 'SCATOLE' : categoria(tipo);
    }
    function codiceNonRisolto(nome, codice) {
        return Boolean(key(codice)) && key(String(nome || '').replace(/\s*\((?:ACTION|OMEGA|TIER ONE|ABACO|RUNNER|ESPRINET)\)\s*$/i, '')) === key(codice);
    }
    function colore(testo) {
        const s = String(testo || '').toUpperCase();
        const bianco = /\bWHITE\b|\bBIANC[OAHEI]*\b|\bSNOW\b/.test(s);
        const nero = /\bBLACK\b|\bNER[OAHEI]*\b|\bPITCH\b/.test(s);
        const rosa = /\bPINK\b|\bROSA\b/.test(s);
        return [bianco, nero, rosa].filter(Boolean).length !== 1 ? '' : bianco ? 'WHITE' : nero ? 'BLACK' : 'PINK';
    }
    function rigaPc(item) {
        const nome = String(item?.name || item?.title || '');
        if (/^\s*(?:OPZIONI|AGGIORNAMENTO ORDINE)\b/i.test(nome)) return false;
        const id = String(item?.product_id || item?.productId || '').replace(/^gid:\/\/shopify\/Product\//, '');
        const mappa = typeof window !== 'undefined' ? window.OrderConfigMatcher?.PRODUCT_ID_CONFIG_KEYS || {} : {};
        if (mappa[id]) return true;
        const n = nome.trim().replace(/\s+/g, ' ').toUpperCase();
        if (Object.values(mappa).some(k => /^(?:MSI|DEEPCOOL) /.test(k) && (n === k || n.startsWith(k + ' ') || n.startsWith(k + ' -')))) return true;
        return /\bPC\s+GAMING\b|^\s*(?:SETUP|BUNDLE)\b/i.test(nome);
    }
    function monitorIncluso(item, componente = '') {
        const titolo = String(item?.name || item?.title || '');
        // Legge solo la porzione monitor: mai il titolo intero o lo SKU del PC.
        const scelta = (titolo.match(/\bMONITOR\s+[^+|]+/i) || [''])[0].trim();
        const valore = String(componente || '').trim();
        const hz = s => (s.match(/\b(\d{2,3})\s*HZ\b/i) || [])[1] || '';
        const ms = s => (s.match(/\b(\d+(?:[.,]\d+)?)\s*MS\b/i) || [])[1]?.replace(',', '.') || '';
        // Il modello viene dalla distinta; se nel vecchio ordine era venduta
        // un'altra frequenza/risposta, resta la specifica storica, senza inventare un modello.
        const compatibile = (!hz(scelta) || hz(scelta) === hz(valore)) && (!ms(scelta) || ms(scelta) === ms(valore));
        if (valore && !/^MG-/i.test(valore) && !rigaPc({name:valore}) && (!scelta || compatibile)) return valore;
        return scelta;
    }
    function proprietaCase(props) {
        if (Array.isArray(props)) props = Object.fromEntries(props.map(p => [p.name || '', p.value]));
        return Object.entries(props || {}).filter(([k]) => /^(CASE|COLORE CASE|CASE COLOR)$/i.test(k.trim())).map(([,v]) => v).join(' ');
    }
    function coloreCase(componenti, ordine, salvato) {
        const c = (componenti || []).find(x => categoria(x.tipo || x.type) === 'CASE') || {};
        // Il colore del pezzo effettivamente salvato prevale. Mai derivarlo da GPU/MOBO.
        const reale = colore(String(c.nome || c.name || '').replace(/\s*[-·]\s*COLORE(?: CASE)?:.*$/i, '')) || colore(c.ean || c.value);
        if (reale) return reale;
        // Identificativi CG530 verificati sulla distinta, non un generico "BK" in qualsiasi codice.
        const mpn = String(c.nome || c.name || '').match(/\bR-CG530-(BK|WH)[A-Z0-9-]*\b/i);
        if (mpn) return mpn[1].toUpperCase() === 'WH' ? 'WHITE' : 'BLACK';
        const noti = { 'GEHY-037':'BLACK', 'GEHY-034':'WHITE', 'GELI-975':'BLACK', 'GELI-976':'WHITE', 'DPCG5304F':'BLACK', 'DPCG530WH4F':'WHITE' };
        if (noti[String(c.ean || c.value || '').toUpperCase()]) return noti[String(c.ean || c.value).toUpperCase()];
        const props = colore(proprietaCase(salvato?.customProperties || salvato?.custom_properties));
        if (props) return props;
        // items contiene solo il PC di questa scheda (anche per ordini divisi).
        const pcs = (ordine?.items || ordine?.line_items || []).filter(rigaPc);
        if (pcs.length === 1) return colore(proprietaCase(pcs[0].customProperties || pcs[0].custom_properties || pcs[0].properties));
        return '';
    }
    const nomeColore = c => c === 'WHITE' ? 'BIANCO (WHITE)' : c === 'BLACK' ? 'NERO (BLACK)' : c === 'PINK' ? 'ROSA (PINK)' : 'DA VERIFICARE';
    function descrizioneCase(nome, c) {
        return String(nome || '').replace(/\s*[-·]\s*COLORE(?: CASE)?:.*$/i, '').trim() + ' - COLORE: ' + nomeColore(c);
    }
    function descrizioneVentole(nome, c) {
        if (!/BUILD\s+FULL\s+VENTOLE/i.test(String(nome))) return String(nome || '');
        return 'BUILD FULL VENTOLE - 5X VENTOLE RGB - ' + nomeColore(c) + ' - stesso colore del case';
    }
    function descrizioneHardware(nome) {
        // Note di provenienza interne: non sono istruzioni per l'assemblatore.
        // Manteniamo modello, fornitore e identificativi tecnici, senza toccare la fonte.
        return String(nome || '').replace(/\s*\(\s*al posto (?:di|del|dello|della|dei|degli|delle)\b[^)]*\)/gi, '')
            .split('|').map(s => s.trim()).filter(s => s && !(
                !/^(?:MPN|SKU|EAN|CODICE|MODELLO|REV(?:ISIONE)?|SN)\b/i.test(s) &&
                /^[\p{L}][\p{L} .'-]*\s+\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\s*$/u.test(s)
            )).join(' | ').trim();
    }
    function descrizioneExtra(r) {
        let nome = r.nome;
        if (/ - PREPARAZIONE:| - DA VERIFICARE:/i.test(nome)) return { nome, avviso: / - DA VERIFICARE:/i.test(nome) };
        const scelta = fisici.includes(r.tipo) ? descrizioneHardware(r.scelta || nome) : r.scelta || nome;
        const s = key(scelta), senzaPrefisso = chiaveSoftware(scelta);
        const programmi = r.tipo === 'SOFTWARE' ? software[senzaPrefisso] : null;
        if (programmi) return { nome: nome + ' - PREPARAZIONE: installazione e configurazione di ' + programmi.join('; ') + '. Programmi gratuiti; non include licenze commerciali.' };
        const istruzioni = s === 'FPSBOOSTER' ? 'ottimizzazione delle impostazioni, verifica di temperature e stabilita; nessun aumento fisso di FPS garantito.'
            : s === 'ESPERIENZAASSEMBLAGGIOINLIVE' ? "concordare con il cliente data e ora per seguire in diretta l'assemblaggio della sua build."
            : r.tipo === 'SCATOLE' && /^CONSEGNASCATOLE(?:ORIGINALI(?:DISPONIBILI)?)?$/.test(s) ? 'preparare e consegnare le confezioni originali effettivamente disponibili.'
            : r.tipo === 'CONNETTIVITÀ' && s === 'WIFIBLUETOOTHADATTATOREPCIE' ? 'installare nel PC la scheda PCIe Wi-Fi + Bluetooth.'
            : /^(?:KITGAMING(?:MINIMALGAMERS)?4IN1)(?:BIANCO|NERO|WHITE|BLACK)?$/.test(s) ? 'kit composto da mouse, tastiera, cuffie e tappetino; rispettare il colore indicato nella scelta.'
            : r.tipo === 'ARCHIVIAZIONE AGGIUNTIVA' && /^(?:HDD|SSD)?(?:1|2|4)TBAGGIUNTIV[OI]$/.test(s) ? "installare come unita secondaria interna al PC; mantenere l'unita principale."
            : '';
        if (istruzioni) return { nome: nome + ' - PREPARAZIONE: ' + istruzioni };
        const n = key(nome).replace(/^(?:PERSONALIZZAZIONE|ACCESSORIO|EXTRA)/, '');
        const generica = /^(?:KIT|KITGAMING|KITAGGIUNTIVO|KITRICHIESTODALCLIENTE|PREPARARE(?:ANCHE)?ILKIT(?:AGGIUNTIVO)?RICHIESTODALCLIENTE|ACCESSORIAGGIUNTIVI|SOFTWARE|PACCHETTOSOFTWARE|SERVIZIO(?:AGGIUNTIVO|SPECIALE|GIASCELTO)?|MONITOR)?$/.test(n);
        if (generica || r.tipo === 'SOFTWARE') return { nome: nome + ' - DA VERIFICARE: ' + (r.tipo === 'SOFTWARE' ? "programmi/versione e licenze dall'ordine originale, senza sostituire il pacchetto acquistato." : 'contenuto o modello non specificato; chiarire prima della preparazione.'), avviso:true };
        return { nome, avviso: / - DA VERIFICARE:/i.test(nome) };
    }
    function distinta(righe, opzioni, pagati, piano, c) {
        const records = [], seen = new Set();
        const add = (tipo, nome, scelta) => {
            const testo = String(nome || '').trim();
            if (!testo) return;
            const cat = categoriaVoce(tipo, scelta || testo);
            const parti = cat === 'SOFTWARE' && key(testo) === key(scelta || testo) ? String(scelta || testo).split(/[,;\n]+/).map(s=>s.trim()) : [];
            if (parti.length > 1 && parti.every(s=>software[chiaveSoftware(s)])) {
                parti.forEach(s=>add(tipo,s,s)); return;
            }
            const sw = cat === 'SOFTWARE' && software[chiaveSoftware(scelta || testo)] ? chiaveSoftware(scelta || testo) : null;
            const id = cat + '|' + (sw || key(scelta || testo));
            if (seen.has(id)) return;
            const etichetta = String(tipo || '').trim();
            const leggibile = cat === 'EXTRA' && key(etichetta) !== 'EXTRA' && !key(testo).includes(key(etichetta))
                ? etichetta + ': ' + testo : testo;
            seen.add(id); records.push({ tipo: cat, nome: leggibile, scelta: scelta || testo });
        };
        for (const r of righe || []) add(r.tipo, r.nome, r.scelta);
        for (const r of opzioni || []) add(r.tipo, r.nome, r.scelta);
        for (const u of pagati || []) {
            const cat = categoriaVoce(u.categoria,u.valore) !== 'EXTRA' ? categoriaVoce(u.categoria,u.valore) : categoriaVoce(u.chiave,u.valore);
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
        return records.map(r => {
            const materiale = fisici.includes(r.tipo) || r.tipo === 'EXTRA' && /^ACCESSORIO\s*:/i.test(r.nome);
            const nome = materiale ? descrizioneHardware(r.nome) : r.nome;
            const preparazione = descrizioneExtra({...r,nome,scelta:materiale ? descrizioneHardware(r.scelta) : r.scelta});
            return { ...r, ...preparazione, avviso: Boolean(preparazione.avviso || (!c && (r.tipo === 'CASE' || r.tipo === 'VENTOLE' && /BUILD\s+FULL\s+VENTOLE/i.test(nome)))), nome: r.tipo === 'CASE' ? descrizioneCase(nome, c)
                : r.tipo === 'VENTOLE' ? descrizioneVentole(nome, c) : preparazione.nome };
        });
    }
    const api = { categoria, categoriaVoce, codiceNonRisolto, colore, coloreCase, nomeColore, descrizioneCase, descrizioneVentole, descrizioneHardware, descrizioneExtra, distinta, rigaPc, monitorIncluso, base, software };
    if (typeof window !== 'undefined') window.MontaggioExport = api;
    if (typeof module !== 'undefined') module.exports = api;
})();
