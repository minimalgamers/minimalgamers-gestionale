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
    const referenceCost = r => ['budget','riferimento_excel','riferimento_altro'].includes(r.fonte);
    const referenceLabel = r => r.fonte==='budget' ? 'Budget previsto' : r.fonte==='riferimento_excel' ? 'Riferimento Excel · prezzo attuale da verificare' :
        `Stima da ${r.riferimento?.fornitore_riferimento || 'altro fornitore'} · cambio da confermare`;

    function freshness(input, now=Date.now()) {
        const dates=[input.generato,input.listini].filter(Boolean).map(Date.parse);
        const last=dates.length && dates.every(Number.isFinite) ? Math.min(...dates) : null;
        // Paid history is independent of today's supplier feed.
        return {stale:!input.conti.confermato && !input.auto?.solo_contabile && last!=null &&
            (now-last>60*60*1000 || last-now>60000), last};
    }

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

    function purchasePlan(input) {
        if (input.conti.confermato || input.auto?.solo_contabile || freshness(input,input.now).stale) return input;
        const used=[], righe=(input.conti.righe || []).map(r=>{
            if (!['listino','stima','riferimento_altro','riferimento_excel','budget'].includes(r.fonte) || ['PSU','COOLER'].includes(r.tipo) ||
                (input.montaggio || []).some(x=>x.tipo===r.tipo)) return r;
            const p=(input.proposte || []).find(p=>p.tipo===r.tipo && key(p.da.ean)===key(r.ean) && key(p.da.fornitore)===key(r.fornitore));
            if (!p || p.a?.ordinabile!==true || p.a?.daConfermare || !Number.isFinite(p.a?.costo) || p.a.costo<0) return r;
            used.push(p);
            return {...r,ean:p.a.codice,fornitore:p.a.fornitore,descrizione:p.a.descrizione,costo:p.a.costo,fonte:'listino',
                verificaDisponibilita:null,offertaAlternativa:null,salvato:r,proposto:true};
        });
        if (!used.length) return input;
        const delta=righe.reduce((s,r,i)=>s+(r.costo ?? 0)-(input.conti.righe[i].costo ?? 0),0);
        const mancanti=input.nMancanti-righe.filter(r=>r.proposto && !Number.isFinite(r.salvato.costo)).length;
        const costo=round(input.costo+delta);
        const lordo=Number.isFinite(input.vendita?.imponibile) ? input.vendita.imponibile-input.vendita.totale*.045-costo : input.utile?.lordo-delta;
        return {...input,conti:{...input.conti,righe},costo,nMancanti:mancanti,
            utile:{lordo:round(lordo),srl:round(lordo>0?lordo*.7:lordo)},
            piano:{proposte:used,costoSalvato:input.costo}};
    }

    function rows(input) {
        const replaced = new Set((input.montaggio || []).map(x => x.tipo));
        const hardware = (input.conti.righe || []).map((r, i) => {
            const ref = reference(r.salvato || r,input.auto), delta = !referenceCost(r) && ref && Number.isFinite(r.costo) ? round(r.costo-ref.cost) : null;
            return {...r, index:i, kind:'hardware', title:r.descrizione || r.nome || r.ean, ref, delta,
                replaced:replaced.has(r.tipo), locked:['acquistato','magazzino'].includes(r.fonte),
                customerPaid:!replaced.has(r.tipo) && (input.paidTypes || []).includes(r.tipo),
                state:r.proposto ? 'Proposta da confermare' : r.fonte === 'acquistato' ? 'Pagato' : r.fonte === 'magazzino' ? 'Prelevato' :
                    /DA ACQUISTARE/i.test(r.descrizione || r.nome || '') ? 'Da acquistare' : r.fonte==='fisso_utente' ? 'Costo fisso · gestione tua' :
                    referenceCost(r) ? referenceLabel(r) : input.auto?.solo_contabile ? 'Spedito · costo di riferimento' : r.verificaDisponibilita ? 'Da verificare' : r.fonte === 'inserito' ? 'Costo registrato' : 'Da ordinare'};
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
        input=purchasePlan(input);
        const list=rows(input), complete=input.nMancanti === 0, target=input.obiettivo;
        const freshnessState=freshness(input,input.now), stale=freshnessState.stale;
        const higher=list.filter(r => r.delta > .01), rest=list.filter(r => !(r.delta > .01));
        const delta=round(higher.reduce((s,r)=>s+r.delta,0)), covered=list.filter(r=>r.ref).length;
        const profit=complete ? input.utile?.srl : null;
        const unquoted = list.filter(referenceCost).length;
        const referenceOnly=Boolean(!input.conti.confermato && (unquoted || input.auto?.solo_contabile && list.some(r=>r.kind==='hardware' && !r.locked)));
        const status=stale ? 'Listini non aggiornati · conto da verificare' : !complete ? (input.vendita?.iva_vendita?.da_verificare ? 'Aliquote IVA da verificare' : 'Costi incompleti: utile da calcolare') : referenceOnly ? (input.auto?.solo_contabile ? 'Spedito · stima ai costi di riferimento' : 'Utile stimato · quotazioni da confermare') : profit < 0 ? 'In perdita' : profit===0 ? 'In pareggio' :
            !Number.isFinite(target) ? 'Positivo · obiettivo non disponibile' : profit >= target-5 ? 'In obiettivo' : `Positivo · ${money(target-profit)} sotto obiettivo`;
        const state=stale || !complete ? 'unknown' : referenceOnly ? 'reference' : profit < 0 ? 'negative' : profit===0 || Number.isFinite(target) && profit < target-5 ? 'warning' : 'positive';
        const rowHtml = r => {
            const q=Number(r.quantita)||1, lim=input.auto?.solo_contabile || stale ? null : budget(r.costo,input.utile,target,complete);
            const actionable=r.kind !== 'service' && r.ean && !r.locked;
            const costLabel=referenceCost(r) ? referenceLabel(r)+'; '+(r.riferimento?.nota || '') : ['acquistato','magazzino'].includes(r.fonte) ? 'Prezzo pagato / prelevato' : 'Costo netto della riga';
            return `<tr class="mg-ledger-row${r.delta > .01 ? ' mg-price-up' : ''}"><td data-label="Tipo"><b>${esc(r.labelTipo || r.tipo)}</b></td>` +
                `<td class="mg-ledger-product" data-label="Componente"><strong>${esc(r.title)}</strong>` +
                `<small>${q>1 ? `${q} pezzi · ` : ''}${esc(r.ean || '')}${r.kind==='extra' || r.kind==='custom' ? ' · Extra' : ''}${r.customerPaid ? ' · Upgrade pagato dal cliente' : ''}</small>` +
                (r.proposto ? `<small>Salvato: ${esc(r.salvato.fornitore)} · ${esc(r.salvato.nome || r.salvato.descrizione || r.salvato.ean)} · ${money(r.salvato.costo)}. Cambio non ancora applicato.</small>` : '') +
                (r.replaced ? '<small class="mg-ledger-alert">Sostituito dall’upgrade: non montare. Costo precedente conservato.</small>' : '') +
                (r.verificaDisponibilita ? `<small class="mg-ledger-alert">${esc(r.verificaDisponibilita.testo)}</small>` : '') +
                (r.offertaAlternativa ? `<small>Prezzo ${esc(r.fornitore)} non disponibile. Stesso modello da ${esc(r.offertaAlternativa.fornitore)}: ${money(r.offertaAlternativa.costo_unitario)} netti/pezzo.</small>` +
                    `<button type="button" class="mg-quote-action" data-glass-quote="${list.indexOf(r)}">Valuta offerta ${esc(r.offertaAlternativa.fornitore)}</button>` : '') +
                `</td><td data-label="Fornitore">${esc(r.fornitore || '—')}</td><td class="mg-num" data-label="Riferimento" title="${esc(r.ref ? r.ref.source+' '+date(r.ref.date) : 'Costo alla vendita non registrato')}">${r.ref ? money(r.ref.cost) : '—'}</td>` +
                `<td class="mg-num" data-label="Oggi / pagato" title="${esc(costLabel)}"><b>${Number.isFinite(r.costo) ? (referenceCost(r)?'≈ ':'')+money(r.costo) : 'Manca costo'}</b></td>` +
                `<td class="mg-num mg-delta" data-label="Scostamento">${Number.isFinite(r.delta) ? (r.delta>0?'+':'')+money(r.delta) : '—'}</td>` +
                `<td data-label="Acquisto"><span class="mg-purchase-state${r.locked?' paid':''}">${esc(r.state)}</span></td>` +
                `<td class="mg-ledger-actions">${actionable && r.kind==='hardware' && !input.auto?.solo_contabile ? `<button type="button" data-glass-change="${list.indexOf(r)}" aria-label="Cambia ${esc(r.tipo)}">Cambia</button>` : ''}` +
                `${actionable && !r.proposto ? `<button type="button" data-glass-cost="${list.indexOf(r)}" aria-label="${r.costo==null?'Inserisci':'Modifica'} costo ${esc(r.tipo)}">${icon('pencil-simple')}</button>` : r.locked && r.kind!=='service' ? '<small>Conservato</small>' : ''}` +
                (lim && !r.locked ? `<details class="mg-budget"><summary role="button" aria-label="Limiti di spesa ${esc(r.tipo)}">Limiti</summary><div><b>Massimo netto per questa riga</b><br>${lim.zero<0 ? 'Perdita non recuperabile cambiando solo questa riga' : `Per restare in positivo: ${money(lim.zero)}`}<br>` +
                    `${lim.target == null ? 'Obiettivo non disponibile' : lim.target<0 ? 'Obiettivo non raggiungibile cambiando solo questa riga' : `Per l’obiettivo: ${money(lim.target)}`}<br><small>A parità degli altri costi. ${q>1?'Totale per '+q+' pezzi.':''}</small></div></details>` : '') +
                '</td></tr>';
        };
        // Sorted views retain original row objects and indexes for edits.
        const ordered=[...higher,...rest];
        const label=stale ? 'Listini non aggiornati' : referenceOnly && complete ? 'Stima di riferimento' : profit===0 && complete ? 'In pareggio' : {unknown:'Da verificare',negative:'In perdita',warning:'Sotto obiettivo',positive:'Positivo'}[state];
        return {list, state, label, stale, input, html:`<section class="mg-glass-account" aria-label="Controllo costi ordine">` +
            `<div class="mg-glass-identity"><div><strong class="mg-glass-customer">${esc(input.cliente || '')}</strong><small>${input.vendita?.data ? 'Venduto il '+date(input.vendita.data) : ''}</small></div>` +
            `<div><small>Obiettivo utile SRL</small><strong>${money(target)}</strong></div></div>` +
            `<div class="mg-glass-metrics"><div><small>Venduto al cliente</small><strong>${money(input.vendita?.totale)}</strong><span>Ricavo storico · upgrade inclusi${input.vendita?.iva_vendita ? ' · IVA '+Math.round(input.vendita.iva_vendita.aliquota*100)+'%' : ''}${input.vendita?.iva_vendita?.fonte==='confermata utente'?' confermata da te':''}</span></div>` +
            `<div><small>${input.piano?'Costo piano di acquisto':'Costo totale'}${complete?'':' noto · parziale'}</small><strong>${money(input.costo)}</strong><span>Netto · extra e servizi inclusi</span></div>` +
            `<div><small>${stale?'Stima con listini non aggiornati':'Utile SRL stimato'}</small><strong>${money(profit)}</strong><span>${input.conti.confermato ? 'Costi acquistati conservati' : 'Sul ricavo di questo ordine'}</span></div>` +
            `<div class="mg-glass-status ${state}" role="status"><b>${esc(status)}</b><small>${input.nMancanti ? input.nMancanti+' costi da completare' : unquoted ? unquoted+' riferimenti di costo · confermare prima dell’acquisto' : 'Conto completo nelle fonti in basso'}</small></div></div>` +
            (stale ? `<div class="mg-glass-warnings" role="alert"><p><b>Listini fermi al ${date(freshnessState.last)}.</b> Aggiorna i listini prima di valutare costi, utile e limiti di spesa. Le quotazioni mancanti possono dipendere dal mancato aggiornamento; i prezzi pagati registrati restano conservati.</p></div>` : '') +
            (input.noticeHtml || '') + (input.avvisi?.length ? `<div class="mg-glass-warnings" role="alert">${input.avvisi.map(a=>`<p>${esc(a)}</p>`).join('')}</div>` : '') +
            (input.piano ? `<div class="mg-glass-increases"><b>Piano di acquisto di oggi · ${input.piano.proposte.length} cambi proposti</b><small>Utile calcolato sulle proposte evidenziate. Distinta salvata: ${money(input.piano.costoSalvato)}. Pezzi pagati e costi fissi conservati.</small><div class="mg-glass-actions"><button type="button" data-glass-plan>Rivedi e conferma i componenti proposti</button></div></div>` : '') +
            `<div class="mg-glass-increases"><b>${higher.length ? `${higher.length} voci sopra riferimento · +${money(delta)} netti` : 'Nessun aumento verificabile sui riferimenti disponibili'}</b>` +
            `<small>Confronto ${input.auto?.configuratore ? 'lista configuratore' : 'Excel build'} su ${covered} di ${list.length} voci. I riferimenti disponibili non sono una fotografia dei costi alla vendita.</small></div>` +
            `<div class="mg-ledger-scroll"><table class="mg-ledger"><caption>Elenco completo: hardware, extra, upgrade e servizi. Importi netti.</caption><thead><tr>` +
            '<th>Tipo</th><th>Componente</th><th>Fornitore</th><th>Riferimento</th><th>Oggi / pagato</th><th>Scostamento</th><th>Acquisto</th><th>Azioni</th></tr></thead><tbody>' +
            ordered.map((r,i) => (i===higher.length && higher.length && rest.length ? '<tr class="mg-ledger-divider"><th colspan="8">Altre voci dell’ordine</th></tr>' : '')+rowHtml(r)).join('') +
            `</tbody><tfoot><tr><th colspan="4">${complete?'Totale':'Costi noti · totale parziale'}</th><td class="mg-num">${money(input.costo)}</td><td colspan="3">${complete?'Montaggio e spedizione inclusi':'Utile non calcolabile finché mancano costi'}</td></tr></tfoot></table></div>` +
            `<div class="mg-glass-actions"><span class="acc-barra-stato" role="status">${input.generato ? 'Dati del '+date(input.generato) : 'Aggiornamento listini da verificare'} · importi netti</span>` +
            '<button type="button" data-glass-original aria-expanded="false">Componenti e gestione scorte</button><button type="button" data-glass-refresh>Aggiorna costi</button>' +
            `<button type="button" class="mg-primary" data-glass-confirm${input.conti.confermato || input.auto?.solo_contabile?' disabled':''}>${input.auto?.solo_contabile ? 'Ordine già spedito' : input.conti.confermato ? 'Acquisto già confermato' : input.piano ? 'Rivedi il piano prima dell’acquisto' : 'Conferma acquisto di questo PC'}</button></div></section>`};
    }

    function mount(el,input,actions) {
        if (!el.closest('#processed-container')) return;
        const view=render(input), card=el.closest('.order-card');input=view.input;
        const details=document.createElement('details'); details.className='mg-glass-sources';
        const summary=document.createElement('summary');summary.textContent='Conto completo, verifiche, fonti e storico';details.appendChild(summary);
        while(el.firstChild) details.appendChild(el.firstChild);
        const section=document.createElement('div');section.innerHTML=view.html;
        el.appendChild(section);el.appendChild(details);card?.classList.add('mg-glass-order');
        const get=b=>{const r=view.list[Number(b.dataset.glassChange ?? b.dataset.glassCost)];return r.salvato || r;};
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
        const review=async e=>{const b=e.currentTarget;b.disabled=true;try{await actions.plan();}catch(err){section.querySelector('.acc-barra-stato').textContent=err.message;}finally{b.disabled=false;}};
        section.querySelectorAll('[data-glass-plan]').forEach(b=>b.onclick=review);
        section.querySelector('[data-glass-confirm]').onclick=input.piano?review:()=>actions.confirm(section);
        // Economic states remain available to navigation without re-reading account data.
        card.dataset.glassProfit=view.stale ? 'Non aggiornato' : input.nMancanti ? 'Costi incompleti' : money(input.utile?.srl);
        card.dataset.glassState=view.state;
        card.dataset.glassLabel=view.label;
        card.dataset.glassCustomer=input.cliente || '';
        sync();
    }

    const desks=new Map();
    let currentDesk='', timer=null, scrollTracker=null, trackerDesk='', trackerCards=[];
    const setClass=(el,name,on)=>{if(el.classList.contains(name)!==on)el.classList.toggle(name,on);};
    const setHidden=(el,on)=>{if(el.hidden!==on)el.hidden=on;};
    const searchKey=v=>String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('it').trim();
    function deskState(key) {
        if(!desks.has(key))desks.set(key,{active:'',query:'',scrollTop:0,scrollLeft:0,listTop:0});
        return desks.get(key);
    }
    function rendered(el) {
        for(let node=el;node;node=node.parentElement){
            const style=node.ownerDocument.defaultView.getComputedStyle(node);
            if(node.hidden || style.display==='none' || style.visibility==='hidden')return false;
        }
        return true;
    }
    function deskVisible(container,tab,blocked=false) {
        return !blocked && (!tab || /^processed(?:-e[234])?$/.test(tab)) &&
            (!container.classList.contains('tab-content') || container.classList.contains('active')) && rendered(container);
    }
    function navigationSelection(items,requested,query) {
        const q=searchKey(query),matches=items.filter(i=>!q || searchKey(i.text).includes(q));
        return {ids:matches.map(i=>i.id),active:selection(items.map(i=>i.id),requested)};
    }
    function headerOffset(doc) {
        const win=doc.defaultView;
        return Math.max(0,...['fixed-header','tabs-container'].map(id=>{
            const el=doc.getElementById(id);
            if(!el || !rendered(el))return 0;
            const position=win.getComputedStyle(el).position;
            return position==='fixed' || position==='sticky' ? Math.max(0,el.getBoundingClientRect().bottom) : 0;
        }));
    }
    function readingLine(doc) {
        const nav=doc.getElementById('mg-order-navigation'),win=doc.defaultView;
        const bottom=nav && !nav.hidden && win.getComputedStyle(nav).position==='sticky' ? nav.getBoundingClientRect().bottom : 0;
        return Math.max(headerOffset(doc),bottom)+16;
    }
    function scrollToOrder(id) {
        const c=document.getElementById('processed-container');
        const card=[...c.querySelectorAll(':scope > .order-card[data-order-id]')].find(c=>c.dataset.orderId===id);
        if(!card || !rendered(card))return;
        const win=c.ownerDocument.defaultView;
        win.scrollTo({top:Math.max(0,win.scrollY+card.getBoundingClientRect().top-readingLine(c.ownerDocument)),behavior:'auto'});
    }
    function select(id) {
        if(!currentDesk)return;
        deskState(currentDesk).active=id;
        scrollToOrder(id);sync();
        [...(document.getElementById('mg-order-navigation')?.querySelectorAll('[data-glass-order]') || [])].find(b=>b.dataset.glassOrder===id)?.focus({preventScroll:true});
    }
    function selection(ids,requested) {return ids.includes(requested)?requested:ids[0] || '';}
    // Native desk/operator filters retain ownership of hidden/display. Navigation
    // never hides an order, so the browser's Find sees the complete visible desk.
    function inPurchaseScope(card) {
        if (card.hidden || card.style.display === 'none') return false;
        const style=card.ownerDocument.defaultView.getComputedStyle(card);
        return style.visibility !== 'hidden' && style.display !== 'none';
    }
    function purchaseScopeCards() {
        return typeof document === 'undefined' ? [] : [...document.querySelectorAll('#processed-container .order-card[data-order-id]')].filter(inPurchaseScope);
    }
    function activeOrderAtLine(ranges,line) {
        const usable=ranges.filter(r=>Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.bottom>r.top);
        if(!usable.length)return '';
        const containing=usable.find(r=>r.top<=line && r.bottom>line);
        if(containing)return containing.id;
        const preceding=usable.filter(r=>r.top<=line);
        return preceding.length ? preceding[preceding.length-1].id : usable[0].id;
    }
    function createOrderTracker({win,doc,container,cards,onActive,offset=()=>0}) {
        let disposed=false,frame=null,active='';
        const request=fn=>win.requestAnimationFrame ? win.requestAnimationFrame(fn) : win.setTimeout(fn,16);
        const cancel=id=>win.cancelAnimationFrame ? win.cancelAnimationFrame(id) : win.clearTimeout(id);
        const refresh=()=>{
            if(disposed)return;
            const ranges=cards.filter(inPurchaseScope).map(card=>{const rect=card.getBoundingClientRect();return {id:card.dataset.orderId,top:rect.top,bottom:rect.bottom};});
            const id=activeOrderAtLine(ranges,offset());
            if(id && id!==active){active=id;onActive(id);}
        };
        const schedule=()=>{
            if(disposed || frame!==null)return;
            frame=request(()=>{frame=null;refresh();});
        };
        const scrolled=e=>{
            const target=e?.target;
            if(!target || target===win || target===doc || target===doc.scrollingElement || target===container || container.contains(target))schedule();
        };
        win.addEventListener('scroll',scrolled,{passive:true});
        win.addEventListener('resize',schedule,{passive:true});
        doc.addEventListener('scroll',scrolled,{passive:true,capture:true});
        const observer=typeof win.IntersectionObserver==='function' ? new win.IntersectionObserver(schedule,{threshold:[0,1]}) : null;
        cards.forEach(card=>observer?.observe(card));
        refresh();
        return {refresh,schedule,dispose(){
            if(disposed)return;disposed=true;
            if(frame!==null)cancel(frame);
            frame=null;observer?.disconnect();
            win.removeEventListener('scroll',scrolled);
            win.removeEventListener('resize',schedule);
            doc.removeEventListener('scroll',scrolled,true);
        }};
    }
    function stopTracking() {
        scrollTracker?.dispose();scrollTracker=null;trackerDesk='';trackerCards=[];
    }
    function highlightActive(nav,id) {
        let selected=null;
        for(const button of nav.querySelectorAll('[data-glass-order]')){
            const active=button.dataset.glassOrder===id;
            if(active && !button.hidden)selected=button;
            setClass(button,'active',active);
            if(active){if(button.getAttribute('aria-current')!=='true')button.setAttribute('aria-current','true');}
            else if(button.hasAttribute('aria-current'))button.removeAttribute('aria-current');
        }
        // Keep the active menu item in its own scroller without moving the document.
        const list=nav.querySelector('.mg-order-list');
        if(selected && list){
            const item=selected.getBoundingClientRect(),bounds=list.getBoundingClientRect();
            if(list.scrollWidth>list.clientWidth){
                if(item.left<bounds.left)list.scrollLeft+=item.left-bounds.left;
                else if(item.right>bounds.right)list.scrollLeft+=item.right-bounds.right;
            }else{
                if(item.top<bounds.top)list.scrollTop+=item.top-bounds.top;
                else if(item.bottom>bounds.bottom)list.scrollTop+=item.bottom-bounds.bottom;
            }
            if(currentDesk){const state=deskState(currentDesk);state.listTop=list.scrollTop;state.scrollLeft=list.scrollLeft;}
        }
    }
    function trackOrders(container,cards,key,nav) {
        if(scrollTracker && trackerDesk===key && trackerCards.length===cards.length && trackerCards.every((c,i)=>c===cards[i])){
            scrollTracker.refresh();return;
        }
        stopTracking();trackerDesk=key;trackerCards=cards;
        scrollTracker=createOrderTracker({win:container.ownerDocument.defaultView,doc:container.ownerDocument,container,cards,
            offset:()=>readingLine(container.ownerDocument),onActive:id=>{
                if(currentDesk!==key || nav.hidden)return;
                deskState(key).active=id;highlightActive(nav,id);
            }});
    }
    function deskCards(container) {
        const cards=[...container.querySelectorAll(':scope > .order-card[data-order-id]')];
        cards.forEach(c=>setClass(c,'mg-order-inactive',false));
        return cards.filter(inPurchaseScope);
    }
    function sync() {
        if (typeof document==='undefined')return;
        const container=document.getElementById('processed-container');if(!container)return;
        let nav=document.getElementById('mg-order-navigation');
        if(!nav){
            nav=document.createElement('nav');nav.id='mg-order-navigation';nav.hidden=true;nav.setAttribute('aria-label','Ordini della scrivania');
            nav.innerHTML='<label class="mg-order-search">Cerca nel menu ordini<input type="search" placeholder="Ordine, cliente o build" aria-label="Cerca nel menu ordini"></label>' +
                '<p class="mg-order-count"></p><button type="button" class="mg-order-reset" data-glass-reset hidden>Tutti gli ordini nel menu</button>' +
                '<p class="mg-order-nav-help">Tutte le schede restano visibili. Ctrl+F cerca i componenti.</p><div class="mg-order-list"></div>' +
                '<p class="mg-order-empty" role="status" hidden>Nessun risultato nel menu. Le schede restano tutte visibili.</p>';
            container.before(nav);
            nav.addEventListener('click',e=>{
                const button=e.target.closest('button');if(!button || !currentDesk)return;
                if(button.dataset.glassOrder)select(button.dataset.glassOrder);
                else if(button.hasAttribute('data-glass-reset')){
                    deskState(currentDesk).query='';nav.querySelector('input').value='';sync();
                }
            });
            nav.querySelector('input').oninput=e=>{if(currentDesk){deskState(currentDesk).query=e.target.value;sync();}};
            nav.addEventListener('scroll',()=>{if(currentDesk)deskState(currentDesk).scrollTop=nav.scrollTop;},{passive:true});
            nav.querySelector('.mg-order-list').addEventListener('scroll',e=>{if(currentDesk){const state=deskState(currentDesk);state.scrollLeft=e.target.scrollLeft;state.listTop=e.target.scrollTop;}},{passive:true});
        }
        const cards=deskCards(container);
        const tab=document.querySelector('.tab-button.active')?.dataset.tab;
        const blocked=['gpo-mapping-page','custom-components-page','standard-configs-page','settings-popup'].some(id=>{
            const page=document.getElementById(id);return page && rendered(page);
        });
        const visible=deskVisible(container,tab,blocked) && cards.length>0;
        setClass(document.body,'mg-glass-desk',visible);setHidden(nav,!visible);
        if(!visible){stopTracking();return;}
        const key=tab || 'processed',changedDesk=key!==currentDesk;
        if(changedDesk)stopTracking();currentDesk=key;
        const state=deskState(key),input=nav.querySelector('input'),list=nav.querySelector('.mg-order-list');
        if(changedDesk)input.value=state.query;
        state.active=selection(cards.map(c=>c.dataset.orderId),state.active);
        const items=cards.map(c=>({id:c.dataset.orderId,text:[c.querySelector('.card-header h2')?.textContent,c.querySelector('.config-badge')?.textContent,c.dataset.glassCustomer].join(' ')}));
        const filtered=navigationSelection(items,state.active,state.query),matching=new Set(filtered.ids);
        nav.style.setProperty('--mg-order-header',`${headerOffset(container.ownerDocument)}px`);
        const html=cards.map(c=>{
                const id=c.dataset.orderId,title=c.querySelector('.card-header h2')?.textContent.trim() || id;
                const build=c.querySelector('.config-badge')?.textContent.trim() || '',customer=c.dataset.glassCustomer || '';
                const economic=c.dataset.glassState || 'unknown';
                const label=c.dataset.glassLabel || {unknown:'Da verificare',negative:'In perdita',warning:'Sotto obiettivo',positive:'Positivo'}[economic];
                return `<button type="button" class="mg-order-link${id===state.active?' active':''}" data-economic="${esc(economic)}" data-glass-order="${esc(id)}"${!matching.has(id)?' hidden':''}${id===state.active?' aria-current="true"':''}><b>${esc(title)}</b><strong>${esc(c.dataset.glassProfit || 'Calcolo…')}</strong><span>${esc(customer)}${label?' · '+label:''}</span><small>${esc(build)}</small></button>`;
            }).join('');
        const focusId=document.activeElement?.dataset.glassOrder;
        if(list.dataset.content!==html){
            list.innerHTML=html;list.dataset.content=html;
            if(focusId)[...list.querySelectorAll('[data-glass-order]')].find(b=>b.dataset.glassOrder===focusId && !b.hidden)?.focus({preventScroll:true});
        }
        const count=nav.querySelector('.mg-order-count');
        const text=state.query ? `${filtered.ids.length} ${filtered.ids.length===1?'risultato':'risultati'} nel menu · ${cards.length} ${cards.length===1?'scheda visibile':'schede visibili'}` : `${cards.length} ${cards.length===1?'ordine':'ordini'} · elenco completo`;
        if(count.textContent!==text)count.textContent=text;
        setHidden(nav.querySelector('[data-glass-reset]'),!state.query);
        setHidden(nav.querySelector('.mg-order-empty'),filtered.ids.length>0);
        container.querySelector('.mg-order-empty')?.remove(); // obsolete single-detail empty state
        nav.scrollTop=state.scrollTop;list.scrollLeft=state.scrollLeft;list.scrollTop=state.listTop;
        highlightActive(nav,state.active);
        trackOrders(container,cards,key,nav);
    }
    function init(){
        const c=document.getElementById('processed-container');if(!c)return;
        const schedule=()=>{clearTimeout(timer);timer=setTimeout(sync,50);};
        window.addEventListener('mg:navigate',stopTracking);
        window.addEventListener('pagehide',stopTracking);
        window.addEventListener('pageshow',schedule);
        new MutationObserver(records=>{
            if(records.some(({target})=>!target.closest?.('#mg-order-navigation') &&
                (target===document.body || c.contains(target) || target.contains?.(c) ||
                 target.matches?.('.tab-button,.tab-content,#gpo-mapping-page,#custom-components-page,#standard-configs-page,#settings-popup'))))schedule();
        }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden']});
        sync();
    }
    const api={reference,budget,rows,render,mount,sync,selection,select,freshness,purchasePlan,deskVisible,navigationSelection,inPurchaseScope,purchaseScopeCards,deskCards,activeOrderAtLine,createOrderTracker,stopTracking};
    if(typeof window!=='undefined')window.MGOrderGlass=api;
    if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init);
})();
