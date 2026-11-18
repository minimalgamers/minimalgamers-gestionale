/* Build degli ordini manuali. Le preferenze arrivano dallo stesso motore del Buyer Desk. */
(function () {
    'use strict';
    const baseTypes = ['CPU','MOBO','RAM','GPU','SSD','PSU','CASE','COOLER'];
    const state = {token:0, data:null, build:'', rows:[], loading:false};
    const api = () => window.AccoppiamentoAuto;
    const normal = s => String(s || '').trim().toUpperCase();
    const key = (supplier, code) => JSON.stringify([normal(supplier),api().chiave(code)]);
    const round = n => Math.round(n * 100) / 100;
    const cache = () => typeof processedOrdersCache === 'undefined' ? {} : processedOrdersCache;
    const props = o => o?.customProperties || o?.custom_properties || {};
    function findOffer(data, supplier, code) {
        const own = (data?.offerte_ordinabili || []).filter(a => normal(a.fornitore) === normal(supplier));
        const exact = own.find(a => key(a.fornitore,a.codice) === key(supplier,code));
        if (exact) return exact;
        return own.filter(a => [a.ean,a.mpn].some(id => id && api().chiave(id) === api().chiave(code)))
            .filter(a => api().offertaOrdinabile(a)).sort((a,b) => a.costo_unitario-b.costo_unitario)[0];
    }
    const isPaid = (o,c) => {
        const cp = props(o), p = cp._acquisti_parziali_gestionale?.[c.id];
        return o?.stato === 'finalizzati' || !!cp._acquisto_confermato_gestionale || c.price != null && c.price !== '' ||
            p && ['ordinato','pagato'].includes(p.stato) && p.type === c.type && p.ean === c.ean && p.supplier === c.supplier &&
                Number(p.quantity) === Number(c.quantity || 1) ||
            Object.values(cp._esclusioni_acquisto_gestionale || {}).some(x => (x.escluso || x.excluded) &&
                String(x.componentId) === String(c.id) && x.tipo === c.type && x.ean === c.ean &&
                x.fornitore === c.supplier && Number(x.quantita) === Number(c.quantity || 1));
    };

    function reserved(data, saved = {}) {
        const used = new Map(), seen = new Set();
        const codes = new Set(), aliases = new Map();
        for (const a of data.offerte_ordinabili || []) {
            const canonical = key(a.fornitore,a.codice);
            codes.add(canonical);
            for (const id of [a.ean,a.mpn].filter(Boolean)) {
                const alias = key(a.fornitore,id);
                if (!aliases.has(alias)) aliases.set(alias,new Set());
                aliases.get(alias).add(canonical);
            }
        }
        const add = (supplier, code, n) => {
            const k = key(supplier,code);
            // Uno storico con EAN/MPN consuma le stesse unità dello SKU del listino.
            const references = codes.has(k) ? [k] : aliases.get(k) || [k];
            for (const reference of references) used.set(reference,(used.get(reference) || 0) + n);
        };
        for (const [id,order] of Object.entries(data.ordini || {})) {
            let unit = 0;
            for (const pc of order.pc || []) {
                for (let i = 0; i < Math.max(1,Number(pc.quantita) || 1); i++) {
                    unit++;
                    const ownId = unit === 1 && saved[id] ? id : id + '.' + unit;
                    const own = saved[ownId];
                    if (own) seen.add(ownId);
                    if (order.elaborato?.acquistato || order.elaborato?.stato === 'finalizzati' ||
                        pc.elaborato?.acquistato || pc.elaborato?.stato === 'finalizzati') continue;
                    for (const p of pc.pezzi || []) {
                        const c = own?.components?.find(c => c.type === p.tipo &&
                            (p.componente_gestionale_id == null || String(c.id) === String(p.componente_gestionale_id)));
                        if (c && isPaid(own,c) || p.acquistato || p.escluso_acquisto) continue;
                        const explicit = c && Object.values(props(own)._scelte_acquisto_gestionale || {}).some(s =>
                            s.ean === c.ean && s.fornitore === c.supplier && String(s.componentId) === String(c.id));
                        if (explicit) { add(c.supplier,c.ean,Number(c.quantity) || 1); continue; }
                        const a = api().parteDellUnita(p,i)?.auto;
                        if (a && api().offertaOrdinabile(a)) add(a.fornitore,a.codice,Number(a.quantita) || 1);
                    }
                }
            }
        }
        // I manuali sono nella cache condivisa, anche prima del prossimo ricalcolo dei listini.
        for (const [id,o] of Object.entries(saved)) {
            if (seen.has(id) || !id.startsWith('MANUAL_')) continue;
            for (const c of o.components || []) if (!isPaid(o,c))
                add(c.supplier,c.ean,Number(c.quantity) || 1);
        }
        return used;
    }

    function propose(data, build, saved = {}) {
        if (data.build_manuali_versione !== 1) throw new Error('Elenco build in aggiornamento. Riprova tra poco.');
        const template = data.distinte?.[build];
        if (!template) throw new Error('Seleziona una build dell’elenco.');
        const used = reserved(data,saved);
        return Object.entries(template).map(([type,index]) => {
            const v = data.voci[index], source = v.manuale || {};
            const a = (v.preferenze || []).find(a => api().offertaOrdinabile(a) &&
                Number(a.stock) - (used.get(key(a.fornitore,a.codice)) || 0) >= Number(a.quantita || 1));
            if (a) {
                const k = key(a.fornitore,a.codice), quantity = Number(a.quantita) || 1;
                const free = Number(a.stock) - (used.get(k) || 0);
                used.set(k,(used.get(k) || 0) + quantity);
                const fixed = api().costoHardwareFisso(type,a.codice,a.fornitore,data);
                return {type,name:a.descrizione,ean:a.codice,supplier:a.fornitore,quantity,
                    unit:fixed ?? a.costo_unitario,auto:true,free,
                    note:free + ' disponibili dopo gli altri ordini · ' + (v.regola || '')};
            }
            const f = v.fisso;
            const integrated = type === 'GPU' && /INTEGRATA/i.test(source.codice || source.descrizione || '');
            if (f && Number.isFinite(f.costo) || integrated) return {
                type,name:f?.descrizione || source.descrizione || source.codice,ean:integrated ? 'INTEGRATA' : f.descrizione,
                supplier:f?.fornitore || source.fornitore || 'DA SCEGLIERE',quantity:Number(source.quantita) || 1,
                unit:integrated ? 0 : f.costo / (Number(source.quantita) || 1),auto:false,fixed:true,
                note:integrated ? 'Grafica integrata' : 'Costo fisso · modello e disponibilità da verificare'
            };
            return {type,name:'',ean:'',supplier:'',quantity:Number(source.quantita) || 1,unit:null,auto:false,
                note:'Disponibilità insufficiente per ' + (v.requisito || type) + '. Scegli il componente a mano.'};
        });
    }

    function controls(type) {
        const id = type.toLowerCase().replace(/[^a-z0-9_-]/g,'-');
        return {name:document.getElementById('manual-'+id),ean:document.getElementById('manual-'+id+'-ean'),
            supplier:document.getElementById('manual-'+id+'-supplier-value'),quantity:document.getElementById('manual-'+id+'-quantity'),
            cost:document.getElementById('manual-'+id+'-cost'),note:document.getElementById('manual-'+id+'-note')};
    }
    function addEditor(wrapper,type) {
        const c = controls(type);
        for (const [input,label] of [[c.ean,'Codice articolo'],[c.supplier,'Fornitore']]) {
            if (!input) continue;
            input.type='text';input.classList.add('manual-build-detail');input.setAttribute('aria-label',label+' '+type);
            const l=document.createElement('label');l.className='manual-build-detail-label';l.textContent=label;
            input.before(l);l.appendChild(input);
        }
        const costs=document.createElement('div');costs.className='manual-build-costs';
        costs.innerHTML='<label>Quantità<input id="manual-'+type.toLowerCase().replace(/[^a-z0-9_-]/g,'-')+'-quantity" type="number" min="1" step="1" value="1"></label>' +
            '<label>Costo unitario netto €<input id="manual-'+type.toLowerCase().replace(/[^a-z0-9_-]/g,'-')+'-cost" type="text" inputmode="decimal"></label>';
        const note=document.createElement('p');note.id='manual-'+type.toLowerCase().replace(/[^a-z0-9_-]/g,'-')+'-note';note.className='manual-build-note';
        wrapper.append(costs,note);
        c.name.addEventListener('input', () => {
            const original=state.rows.find(r=>r.type===type);
            if(original && c.name.value!==original.name) {
                c.ean.value='';controls(type).cost.value='';
                controls(type).note.textContent='Scelta manuale · inserisci codice, costo e verifica la disponibilità';
            }
        });
    }
    function setRow(row) {
        const c=controls(row.type);
        c.name.value=row.name;c.ean.value=row.ean;c.supplier.value=row.supplier;c.quantity.value=row.quantity;
        c.cost.value=row.unit == null ? '' : String(round(row.unit)).replace('.',',');
        c.note.textContent=row.note || '';
    }
    const status = text => { const n=document.getElementById('manual-build-status');if(n)n.textContent=text; };
    async function readData() {
        const data=await api().carica(true);
        api().verificaListini(data);
        if (typeof loadProcessedOrdersFromDB === 'function') await loadProcessedOrdersFromDB();
        return data;
    }
    async function open() {
        const token=++state.token;state.build='';state.rows=[];state.data=null;state.loading=true;
        document.getElementById('manual-build-select').value='';
        document.getElementById('manual-build-extras').replaceChildren();
        for (const type of baseTypes) {const c=controls(type);c.quantity.value=1;c.cost.value='';c.note.textContent='';}
        status('Carico le build e i listini…');
        try {
            const data=await readData();
            if(token!==state.token)return;
            state.data=data;
            const options=document.getElementById('manual-build-options');options.replaceChildren();
            for(const name of Object.keys(data.distinte || {}).sort((a,b)=>a.localeCompare(b,'it'))) {
                const option=document.createElement('option');option.value=name;options.appendChild(option);
            }
            status('Scegli una build oppure compila i componenti a mano.');
        } catch(e) { if(token===state.token)status(e.message); }
        finally {if(token===state.token)state.loading=false;}
    }
    function close() {state.token++;state.loading=false;}
    async function loadBuild() {
        if(state.loading)return;
        const build=document.getElementById('manual-build-select').value.trim(),token=state.token;
        state.loading=true;status('Verifico prezzi e quantità disponibili…');
        try {
            const data=await readData();
            if(token!==state.token)return;
            const rows=propose(data,build,cache());
            const extras=document.getElementById('manual-build-extras');extras.replaceChildren();
            for(const row of rows) {
                if(!baseTypes.includes(row.type)) {
                    const wrap=document.createElement('div');wrap.className='manual-component-wrapper';
                    const id=row.type.toLowerCase().replace(/[^a-z0-9_-]/g,'-');
                    wrap.innerHTML='<label></label><input type="text" id="manual-'+id+'"><input type="hidden" id="manual-'+id+'-ean"><input type="hidden" id="manual-'+id+'-supplier-value">';
                    wrap.querySelector('label').textContent=row.type;
                    extras.appendChild(wrap);addEditor(wrap,row.type);
                }
                setRow(row);
            }
            // Una build incompleta non eredita i campi del caricamento precedente.
            for(const type of baseTypes)if(!rows.some(r=>r.type===type))setRow({type,name:'',ean:'',supplier:'',quantity:1,unit:null,note:'Componente da scegliere'});
            state.data=data;state.rows=rows;state.build=build;
            status('Distinta caricata. Puoi modificare pezzi, quantità, fornitori e costi prima di salvare.');
        }catch(e){if(token===state.token)status(e.message);}
        finally{if(token===state.token)state.loading=false;}
    }
    function selected(input,name,ean,supplier) {
        const type=input.dataset.component;
        const c=controls(type);
        if(!c.cost)return;
        const offer=findOffer(state.data,supplier,ean);
        if(offer)c.ean.value=offer.codice;
        c.cost.value=offer ? String(api().costoHardwareFisso(type,ean,supplier,state.data) ?? offer.costo_unitario).replace('.',',') : '';
        c.quantity.value=1;
        c.note.textContent=offer ? 'Scelta manuale · '+offer.disponibilita : 'Scelta manuale · verifica costo e disponibilità';
    }
    async function prepareSave(components) {
        if(state.loading)throw new Error('Attendi il caricamento della distinta.');
        const token=state.token;
        const data=state.build ? await readData() : state.data;
        if(token!==state.token)throw new Error('Inserimento annullato.');
        const used=data ? reserved(data,cache()) : new Map();
        const result=components.map(c=>({...c}));
        for(const row of state.rows.filter(r=>!baseTypes.includes(r.type))) {
            const c=controls(row.type);
            if(c.name.value.trim())result.push({type:row.type,name:c.name.value.trim(),ean:c.ean.value.trim(),supplier:c.supplier.value.trim()});
        }
        const costs={},now=new Date().toISOString();
        for(const p of result) {
            const c=controls(p.type),quantity=Number(c.quantity.value),unit=api().numeroCosto(c.cost.value);
            if(!Number.isInteger(quantity)||quantity<1)throw new Error('Quantità non valida per '+p.type);
            if(state.build && unit==null)throw new Error('Inserisci il costo netto di '+p.type);
            p.quantity=quantity;p.ean=p.ean||p.name;p.supplier=normal(p.supplier);p.price=null;
            if(state.build && !p.supplier)throw new Error('Inserisci il fornitore di '+p.type);
            const original=state.rows.find(r=>r.type===p.type);
            const offer=findOffer(data,p.supplier,p.ean);
            if(offer)p.ean=offer.codice;
            if(original?.auto && key(original.supplier,original.ean)===key(p.supplier,p.ean) && !offer)
                throw new Error(p.type+': offerta non più disponibile. Ricarica la build o scegli un altro componente.');
            if(offer) {
                const k=key(p.supplier,p.ean),free=Number(offer.stock)-(used.get(k)||0);
                if(!api().offertaOrdinabile(offer)||quantity>free)throw new Error(p.type+': restano '+Math.max(0,free)+' pezzi disponibili dopo gli altri ordini.');
                used.set(k,(used.get(k)||0)+quantity);
                const currentCost=api().costoHardwareFisso(p.type,p.ean,p.supplier,data) ?? offer.costo_unitario;
                if(original?.auto && key(original.supplier,original.ean)===k && unit===round(original.unit) && unit!==round(currentCost)) {
                    c.cost.value=String(round(currentCost)).replace('.',',');
                    throw new Error('Costo aggiornato per '+p.type+'. Controlla il nuovo importo e premi Salva ordine.');
                }
            }
            if(unit!=null)costs[api().chiaveCostoOrdine(p.type,p.ean,p.supplier)]={unitario:unit,ambito:'ordine',il:now,fonte:'ordine_manuale'};
        }
        return {components:result,configName:state.build || 'MANUALE',pcItemName:state.build || null,
            customProperties:{_costi_netti_gestionale:costs,
                _origine_build_manuale:{nome:state.build || null,listini:data?.listini || null,il:now}}};
    }
    function init() {
        if(!document.getElementById('manual-build-select'))return;
        for(const type of baseTypes)addEditor(document.getElementById('manual-'+type.toLowerCase()).closest('.manual-component-wrapper'),type);
        document.getElementById('manual-build-load').addEventListener('click',loadBuild);
    }
    window.MGManualBuild={open,close,selected,prepareSave,propose,reserved};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
