/* Presentation of existing order accounts. No supplier, order or inventory writes. */
(function () {
    'use strict';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const key = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const currency = new Intl.NumberFormat('it-IT', {style:'currency',currency:'EUR'});
    const money = n => Number.isFinite(n) ? currency.format(n) : 'Non disponibile';
    const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const icon = (name, label='') => `<img src="assets/icons/${name}.svg" alt="${esc(label)}" width="18" height="18">`;
    const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('it-IT') : ''; };

    function reference(row, pc) {
        const parts = (pc?.pezzi || []).filter(p => (p.tipo === row.tipo || p.nome_tipo === row.tipo) &&
            [p.manuale, p.auto].some(x => x && key(x.codice) === key(row.ean)) &&
            Math.max(1,Number(p.manuale?.quantita || p.quantita)||1) === Math.max(1,Number(row.quantita)||1));
        if (parts.length !== 1 || !Number.isFinite(parts[0].excel?.costo)) return null;
        const p = parts[0];
        // The Excel reference is not a historical sale-day observation.
        return {cost:p.excel.costo, source:pc?.configuratore ? 'Lista configuratore' : 'Excel build',
            date:pc?.configuratore ? pc.lista_creata_il || '' : '', historical:false};
    }

    function budget(rowCost, profit, target, complete) {
        if (!complete || !Number.isFinite(rowCost) || !Number.isFinite(profit?.lordo)) return null;
        // One cent reserves the rounded-account tolerance and a positive margin.
        return {zero:Math.floor((rowCost + profit.lordo - .01) * 100) / 100,
            target:Number.isFinite(target) && target >= 0 ? Math.floor((rowCost + profit.lordo - target / .7 - .01) * 100) / 100 : null};
    }

    function rows(input) {
        const replaced = new Set((input.montaggio || []).map(x => x.tipo));
        const hardware = (input.conti.righe || []).map((r, i) => {
            const ref = reference(r,input.auto), delta = ref && Number.isFinite(r.costo) ? round(r.costo-ref.cost) : null;
            return {...r, index:i, kind:'hardware', title:r.descrizione || r.nome || r.ean, ref, delta,
                replaced:replaced.has(r.tipo), locked:['acquistato','magazzino'].includes(r.fonte),
                customerPaid:!replaced.has(r.tipo) && (input.paidTypes || []).includes(r.tipo),
                state:r.fonte === 'acquistato' ? 'Pagato' : r.fonte === 'magazzino' ? 'Prelevato' :
                    input.auto?.solo_contabile ? 'Spedito · costo di riferimento' : r.verificaDisponibilita ? 'Da verificare' : r.fonte === 'inserito' ? 'Costo registrato' : 'Da ordinare'};
        });
        const extras = (input.extraLista || []).filter(x => !x.personalizzata).map(x => ({...x,kind:'extra',title:x.scelta || x.descrizione || x.nome,
            ean:x.codice || x.chiave,quantita:1,extra:true,customerPaid:(input.paidTypes || []).includes(x.tipo),state:x.locked?'Costo conservato':input.auto?.solo_contabile?'Extra della build spedita':'Da preparare',delta:null,ref:null}));
        const custom = (input.custom || []).map(x => ({...x,kind:'custom',tipo:'PERSONALIZZATO',labelTipo:'EXTRA',title:x.value || x.name || 'Voce personalizzata',
            ean:`CUSTOM-${x.id}`,extra:true,quantita:Math.max(1,Number(x.quantity ?? x.quantita)||1),
            costo:x.costo, state:'Costo registrato',delta:null,ref:null}));
        const upgrades = (input.montaggio || []).map(x => ({...x,kind:'upgrade',title:x.descrizione || x.scelta,ean:x.codice,
            quantita:1,extra:true,state:input.auto?.solo_contabile?'Upgrade della build spedita':'Da montare · upgrade pagato',delta:null,ref:null}));
        const services = (input.servizi || []).map(x => ({...x,kind:'service',tipo:'SERVIZIO',title:x.nome || x.testo || x.descrizione || 'Montaggio / spedizione',
            state:'Previsto',delta:null,ref:null,locked:true}));
        return [...hardware,...extras,...custom,...upgrades,...services];
    }

    function render(input) {
        const list=rows(input), complete=input.nMancanti === 0, target=input.obiettivo;
        const higher=list.filter(r => r.delta > .01), rest=list.filter(r => !(r.delta > .01));
        const delta=round(higher.reduce((s,r)=>s+r.delta,0)), covered=list.filter(r=>r.ref).length;
        const profit=complete ? input.utile?.srl : null;
        const referenceOnly=Boolean(input.auto?.solo_contabile && !input.conti.confermato && list.some(r=>r.kind==='hardware' && !r.locked));
        const status=!complete ? 'Costi incompleti: utile da calcolare' : referenceOnly ? 'Spedito · stima ai costi di riferimento' : profit < 0 ? 'In perdita' : profit===0 ? 'In pareggio' :
            !Number.isFinite(target) ? 'Positivo · obiettivo non disponibile' : profit >= target-5 ? 'In obiettivo' : `Positivo · ${money(target-profit)} sotto obiettivo`;
        const state=!complete ? 'unknown' : referenceOnly ? 'reference' : profit < 0 ? 'negative' : profit===0 || Number.isFinite(target) && profit < target-5 ? 'warning' : 'positive';
        const rowHtml = r => {
            const q=Number(r.quantita)||1, lim=input.auto?.solo_contabile ? null : budget(r.costo,input.utile,target,complete);
            const actionable=r.kind !== 'service' && r.ean && !r.locked;
            const costLabel=['acquistato','magazzino'].includes(r.fonte) ? 'Prezzo pagato / prelevato' : 'Costo netto della riga';
            return `<tr class="mg-ledger-row${r.delta > .01 ? ' mg-price-up' : ''}"><td data-label="Tipo"><b>${esc(r.labelTipo || r.tipo)}</b></td>` +
                `<td class="mg-ledger-product" data-label="Componente"><strong>${esc(r.title)}</strong>` +
                `<small>${q>1 ? `${q} pezzi · ` : ''}${esc(r.ean || '')}${r.kind==='extra' || r.kind==='custom' ? ' · Extra' : ''}${r.customerPaid ? ' · Upgrade pagato dal cliente' : ''}</small>` +
                (r.replaced ? '<small class="mg-ledger-alert">Sostituito dall’upgrade: non montare. Costo precedente conservato.</small>' : '') +
                (r.verificaDisponibilita ? `<small class="mg-ledger-alert">${esc(r.verificaDisponibilita.testo)}</small>` : '') +
                (r.offertaAlternativa ? `<small>Prezzo ${esc(r.fornitore)} non disponibile. Stesso modello da ${esc(r.offertaAlternativa.fornitore)}: ${money(r.offertaAlternativa.costo_unitario)} netti/pezzo.</small>` +
                    `<button type="button" class="mg-quote-action" data-glass-quote="${list.indexOf(r)}">Valuta offerta ${esc(r.offertaAlternativa.fornitore)}</button>` : '') +
                `</td><td data-label="Fornitore">${esc(r.fornitore || '—')}</td><td class="mg-num" data-label="Riferimento" title="${esc(r.ref ? r.ref.source+' '+date(r.ref.date) : 'Costo alla vendita non registrato')}">${r.ref ? money(r.ref.cost) : '—'}</td>` +
                `<td class="mg-num" data-label="Oggi / pagato" title="${costLabel}"><b>${Number.isFinite(r.costo) ? money(r.costo) : 'Manca costo'}</b></td>` +
                `<td class="mg-num mg-delta" data-label="Scostamento">${Number.isFinite(r.delta) ? (r.delta>0?'+':'')+money(r.delta) : '—'}</td>` +
                `<td data-label="Acquisto"><span class="mg-purchase-state${r.locked?' paid':''}">${esc(r.state)}</span></td>` +
                `<td class="mg-ledger-actions">${actionable && r.kind==='hardware' && !input.auto?.solo_contabile ? `<button type="button" data-glass-change="${list.indexOf(r)}" aria-label="Cambia ${esc(r.tipo)}">Cambia</button>` : ''}` +
                `${actionable ? `<button type="button" data-glass-cost="${list.indexOf(r)}" aria-label="${r.costo==null?'Inserisci':'Modifica'} costo ${esc(r.tipo)}">${icon('pencil-simple')}</button>` : r.locked && r.kind!=='service' ? '<small>Conservato</small>' : ''}` +
                (lim && !r.locked ? `<details class="mg-budget"><summary role="button" aria-label="Limiti di spesa ${esc(r.tipo)}">Limiti</summary><div><b>Massimo netto per questa riga</b><br>${lim.zero<0 ? 'Perdita non recuperabile cambiando solo questa riga' : `Per restare in positivo: ${money(lim.zero)}`}<br>` +
                    `${lim.target == null ? 'Obiettivo non disponibile' : lim.target<0 ? 'Obiettivo non raggiungibile cambiando solo questa riga' : `Per l’obiettivo: ${money(lim.target)}`}<br><small>A parità degli altri costi. ${q>1?'Totale per '+q+' pezzi.':''}</small></div></details>` : '') +
                '</td></tr>';
        };
        // Sorted views retain original row objects and indexes for edits.
        const ordered=[...higher,...rest];
        const label=referenceOnly && complete ? 'Stima di riferimento' : profit===0 && complete ? 'In pareggio' : {unknown:'Da verificare',negative:'In perdita',warning:'Sotto obiettivo',positive:'Positivo'}[state];
        return {list, state, label, html:`<section class="mg-glass-account" aria-label="Controllo costi ordine">` +
            `<div class="mg-glass-identity"><div><strong class="mg-glass-customer">${esc(input.cliente || '')}</strong><small>${input.vendita?.data ? 'Venduto il '+date(input.vendita.data) : ''}</small></div>` +
            `<div><small>Obiettivo utile SRL</small><strong>${money(target)}</strong></div></div>` +
            `<div class="mg-glass-metrics"><div><small>Venduto al cliente</small><strong>${money(input.vendita?.totale)}</strong><span>Ricavo storico · upgrade inclusi</span></div>` +
            `<div><small>Costo totale${complete?'':' noto · parziale'}</small><strong>${money(input.costo)}</strong><span>Netto · extra e servizi inclusi</span></div>` +
            `<div><small>Utile SRL stimato</small><strong>${money(profit)}</strong><span>${input.conti.confermato ? 'Costi acquistati conservati' : 'Sul ricavo di questo ordine'}</span></div>` +
            `<div class="mg-glass-status ${state}" role="status"><b>${esc(status)}</b><small>${input.nMancanti ? input.nMancanti+' costi da completare' : 'Conto completo nelle fonti in basso'}</small></div></div>` +
            (input.noticeHtml || '') + (input.avvisi?.length ? `<div class="mg-glass-warnings" role="alert">${input.avvisi.map(a=>`<p>${esc(a)}</p>`).join('')}</div>` : '') +
            `<div class="mg-glass-increases"><b>${higher.length ? `${higher.length} voci sopra riferimento · +${money(delta)} netti` : 'Nessun aumento verificabile sui riferimenti disponibili'}</b>` +
            `<small>Confronto ${input.auto?.configuratore ? 'lista configuratore' : 'Excel build'} su ${covered} di ${list.length} voci. I riferimenti disponibili non sono una fotografia dei costi alla vendita.</small></div>` +
            `<div class="mg-ledger-scroll"><table class="mg-ledger"><caption>Elenco completo: hardware, extra, upgrade e servizi. Importi netti.</caption><thead><tr>` +
            '<th>Tipo</th><th>Componente</th><th>Fornitore</th><th>Riferimento</th><th>Oggi / pagato</th><th>Scostamento</th><th>Acquisto</th><th>Azioni</th></tr></thead><tbody>' +
            ordered.map((r,i) => (i===higher.length && higher.length && rest.length ? '<tr class="mg-ledger-divider"><th colspan="8">Altre voci dell’ordine</th></tr>' : '')+rowHtml(r)).join('') +
            `</tbody><tfoot><tr><th colspan="4">${complete?'Totale':'Costi noti · totale parziale'}</th><td class="mg-num">${money(input.costo)}</td><td colspan="3">${complete?'Montaggio e spedizione inclusi':'Utile non calcolabile finché mancano costi'}</td></tr></tfoot></table></div>` +
            `<div class="mg-glass-actions"><span class="acc-barra-stato" role="status">${input.generato ? 'Dati del '+date(input.generato) : 'Aggiornamento listini da verificare'} · importi netti</span>` +
            '<button type="button" data-glass-original aria-expanded="false">Componenti e gestione scorte</button><button type="button" data-glass-refresh>Aggiorna costi</button>' +
            `<button type="button" class="mg-primary" data-glass-confirm${input.conti.confermato || input.auto?.solo_contabile?' disabled':''}>${input.auto?.solo_contabile ? 'Ordine già spedito' : input.conti.confermato ? 'Acquisto già confermato' : 'Conferma acquisto di questo PC'}</button></div></section>`};
    }

    function mount(el,input,actions) {
        if (!el.closest('#processed-container')) return;
        const view=render(input), card=el.closest('.order-card');
        const details=document.createElement('details'); details.className='mg-glass-sources';
        const summary=document.createElement('summary');summary.textContent='Conto completo, verifiche, fonti e storico';details.appendChild(summary);
        while(el.firstChild) details.appendChild(el.firstChild);
        const section=document.createElement('div');section.innerHTML=view.html;
        el.appendChild(section);el.appendChild(details);card?.classList.add('mg-glass-order');
        const get=b=>view.list[Number(b.dataset.glassChange ?? b.dataset.glassCost)];
        section.querySelectorAll('[data-glass-change]').forEach(b=>b.onclick=()=>actions.change(get(b)));
        section.querySelectorAll('[data-glass-quote]').forEach(b=>b.onclick=()=>{
            const r=view.list[Number(b.dataset.glassQuote)];
            actions.change({...r,ricerca:r.offertaAlternativa.mpn || r.offertaAlternativa.codice});
        });
        section.querySelectorAll('[data-glass-cost]').forEach(b=>b.onclick=()=>actions.cost(get(b)));
        section.querySelector('[data-glass-original]').onclick=e=>{
            const open=card.classList.toggle('mg-original-open');e.currentTarget.setAttribute('aria-expanded',String(open));
        };
        section.querySelector('[data-glass-refresh]').onclick=async e=>{
            const b=e.currentTarget;b.disabled=true;try{await actions.refresh();}catch(err){section.querySelector('.acc-barra-stato').textContent=err.message;}finally{b.disabled=false;}
        };
        section.querySelector('[data-glass-confirm]').onclick=()=>actions.confirm(section);
        // Economic states remain available to navigation without re-reading account data.
        card.dataset.glassProfit=input.nMancanti ? 'Costi incompleti' : money(input.utile?.srl);
        card.dataset.glassState=view.state;
        card.dataset.glassLabel=view.label;
        card.dataset.glassCustomer=input.cliente || '';
        sync();
    }

    let active='', showAll=false, timer=null;
    function select(id) { active=id;showAll=false;sync();document.getElementById('mg-order-navigation')?.querySelector('[aria-current="true"]')?.focus({preventScroll:true}); }
    function selection(ids,requested) {return ids.includes(requested)?requested:ids[0] || '';}
    function sync() {
        if (typeof document==='undefined')return;
        const container=document.getElementById('processed-container');if(!container)return;
        let nav=document.getElementById('mg-order-navigation');
        if(!nav){nav=document.createElement('nav');nav.id='mg-order-navigation';nav.setAttribute('aria-label','Ordini della scrivania');container.before(nav);}
        const cards=[...container.querySelectorAll(':scope > .order-card[data-order-id]')];
        const visible=container.ownerDocument.defaultView.getComputedStyle(container).display!=='none' && cards.length>0;
        document.body.classList.toggle('mg-glass-desk',visible);nav.hidden=!visible;
        if(!visible)return;
        active=selection(cards.map(c=>c.dataset.orderId),active);
        const query=nav.querySelector('input')?.value || '', searchFocused=document.activeElement===nav.querySelector('input');
        const html='<label class="mg-order-search">Cerca nella scrivania<input type="search" placeholder="Ordine, cliente o build" aria-label="Cerca nella scrivania"></label>' +
            '<button type="button" class="mg-all-orders">'+(showAll?'Scheda singola':'Tutti gli ordini')+'</button><div class="mg-order-list">' + cards.map(c=>{
                const id=c.dataset.orderId,title=c.querySelector('.card-header h2')?.textContent.trim() || id;
                const build=c.querySelector('.config-badge')?.textContent.trim() || '',customer=c.dataset.glassCustomer || '';
                c.classList.toggle('mg-order-inactive',!showAll && id!==active);
                const economic=c.dataset.glassState || 'unknown';
                const label=c.dataset.glassLabel || {unknown:'Da verificare',negative:'In perdita',warning:'Sotto obiettivo',positive:'Positivo'}[economic];
                return `<button type="button" class="mg-order-link${!showAll && id===active?' active':''}" data-economic="${esc(economic)}" data-glass-order="${esc(id)}"${id===active?' aria-current="true"':''}><b>${esc(title)}</b><strong>${esc(c.dataset.glassProfit || 'Calcolo…')}</strong><span>${esc(customer)}${label?' · '+label:''}</span><small>${esc(build)}</small></button>`;
            }).join('')+'</div>';
        if(nav.dataset.content!==html){nav.innerHTML=html;nav.dataset.content=html;nav.querySelector('input').value=query;
            if(searchFocused)nav.querySelector('input').focus({preventScroll:true});
            nav.querySelectorAll('[data-glass-order]').forEach(b=>b.onclick=()=>select(b.dataset.glassOrder));
            nav.querySelector('.mg-all-orders').onclick=()=>{showAll=!showAll;sync();};
            nav.querySelector('input').oninput=e=>{const q=e.target.value.toLocaleLowerCase('it');nav.querySelectorAll('.mg-order-link').forEach(b=>b.hidden=!b.textContent.toLocaleLowerCase('it').includes(q));};
        }
        if(query)nav.querySelector('input').dispatchEvent(new Event('input'));
    }
    function init(){
        const c=document.getElementById('processed-container');if(!c)return;
        const schedule=()=>{clearTimeout(timer);timer=setTimeout(sync,50);};
        new MutationObserver(schedule).observe(c,{childList:true,subtree:true});
        new MutationObserver(schedule).observe(c,{attributes:true,attributeFilter:['style','class']});
        sync();
    }
    const api={reference,budget,rows,render,mount,sync,selection,select};
    if(typeof window!=='undefined')window.MGOrderGlass=api;
    if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init);
})();
