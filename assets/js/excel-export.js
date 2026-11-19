// ============================================================
// Funzione condivisa: raccoglie gli ordini da esportare con i
// loro componenti leggibili. Usata sia da Excel che da PDF.
// Ritorna un array di { orderName, configName, lines: [string] }
// ============================================================
async function collectOrdersForExport({ verificaPagamenti = false } = {}) {
    if (verificaPagamenti) {
        const verifica = await window.UpgradePaidSync?.verifica?.();
        if (!verifica?.ok) throw Error('Non riesco a verificare i pagamenti degli upgrade su Shopify. Riprova prima di stampare.');
    }
    const componentOrder = ['CPU', 'MOBO', 'SSD', 'RAM', 'GPU', 'PSU', 'COOLER', 'CASE'];
    const M = window.MontaggioExport, A = window.AccoppiamentoAuto;
    if (!M || !A?.upgradePagatiDellUnita) throw Error('Ricarica il gestionale per aggiornare la stampa.');
    // Legge i requisiti pagati, non ricalcola né salva la distinta acquistata.
    let dati = A.stato?.dati;
    try { dati = await A.carica(); } catch (e) {
        if (!dati) throw Error('Dati upgrade non disponibili: riprova prima di stampare una distinta incompleta.');
        showNotification('Stampa con gli ultimi dati upgrade disponibili; verifica eventuali pagamenti recenti.', 'warning');
    }

    const getWorksheetNumberForOrder = (order) => {
        const cachedOrder = processedOrdersCache[order.id] || {};
        return Math.min(4, Math.max(1, parseInt(cachedOrder.foglioDiLavoro ?? order.foglioDiLavoro ?? 1, 10) || 1));
    };

    const activeFilter = document.querySelector('.filter-button.active');
    const filterOperator = activeFilter ? activeFilter.dataset.operator : null;
    const activeWorksheetNumber = getActiveWorksheetTab();

    const ordersToExport = [];
    for (const [orderName, order] of processedOrdersMap.entries()) {
        if (getWorksheetNumberForOrder(order) !== activeWorksheetNumber) continue;
        if (filterOperator) {
            const operatorAssignment = getOperatorAssignment(order.id);
            if (operatorAssignment !== filterOperator) continue;
        }
        ordersToExport.push([orderName, order]);
    }

    const result = [];

    for (const [orderName, order] of ordersToExport) {
        if (A.upgradeDaAllineare?.(order.id)) throw Error('Upgrade pagato in aggiornamento per ' + orderName + ': attendi prima di stampare.');
        const auto = A.pcAutomatico(dati, order.id);
        const savedOrder = processedOrdersCache[order.id];
        const savedComponents = savedOrder?.components || [];

        const componentsByType = {};
        for (const comp of savedComponents) {
            componentsByType[String(comp.type || '').trim().toUpperCase()] = comp;
        }

        const domComponents = {};

        const orderInputs = document.querySelectorAll(`input[data-order-id="${order.id}"][data-ean]`);
        const orderSpans = document.querySelectorAll(`.component-name-display[data-order-id="${order.id}"][data-ean]`);

        orderInputs.forEach(input => {
            const compType = input.dataset.componentType;
            const compTypeKey = String(compType || '').trim().toUpperCase();
            const ean = input.value || input.dataset.ean || '';
            const title = input.title || '';
            let name = '';
            if (title && title.includes(':')) {
                const parts = title.split('\n');
                if (parts[0]) name = parts[0].split(':').slice(1).join(':').trim();
            }
            const supplierBadge = document.querySelector(`.supplier-badge-clickable[data-order-id="${order.id}"][data-component-type="${compType}"]`);
            const supplier = supplierBadge?.dataset?.supplier || '';
            domComponents[compTypeKey] = { ean, name, supplier };
        });

        orderSpans.forEach(span => {
            const compType = span.dataset.componentType;
            const compTypeKey = String(compType || '').trim().toUpperCase();
            const ean = span.dataset.ean || '';
            const title = span.title || '';
            const textContent = span.textContent.trim();
            let name = textContent;
            if (title && title.includes(':')) {
                const parts = title.split('\n');
                if (parts[0]) {
                    const titlePart = parts[0];
                    if (titlePart.startsWith('EAN:')) name = textContent;
                    else name = titlePart.split(':').slice(1).join(':').trim();
                }
            }
            if (name === 'Caricamento...') name = '';
            const supplierBadge = document.querySelector(`.supplier-badge-clickable[data-order-id="${order.id}"][data-component-type="${compType}"]`);
            const supplier = supplierBadge?.dataset?.supplier || '';
            domComponents[compTypeKey] = { ean, name, supplier };
        });

        const componentLines = [];
        const componentRecords = [];
        const seenLines = new Set();
        const pushLine = (t, tipo = 'EXTRA', scelta) => {
            const v = String(t || '').trim();
            if (!v) return;
            const k = tipo + '|' + v.toUpperCase();
            if (seenLines.has(k)) return;
            seenLines.add(k);
            componentLines.push(v);
            componentRecords.push({ tipo, nome: v, scelta: scelta || v });
        };

        // v35: colore del case per applicare l'etichetta a GPU/MOBO nel PDF
        const componentiColore = Object.entries(componentsByType).map(([tipo,c]) => ({...c,tipo}));
        for (const [tipo,c] of Object.entries(domComponents)) {
            const i = componentiColore.findIndex(x => x.tipo === tipo);
            if (i >= 0) componentiColore[i] = {...componentiColore[i],...c}; else componentiColore.push({...c,tipo});
        }
        let pdfCaseColor = M.coloreCase(componentiColore, order, savedOrder);
        {
            const caseComp = domComponents['CASE'] || componentsByType['CASE'];
            const caseTxt = `${caseComp?.name || ''} ${caseComp?.ean || ''}`.toUpperCase();
            pdfCaseColor = M.colore(caseTxt) || pdfCaseColor;
            if (!pdfCaseColor && caseComp?.ean) {
                try {
                    const SB_URL = window.SUPABASE_URL || 'https://nulkachuhjdzohkzwvly.supabase.co';
                    const SB_KEY = window.SUPABASE_KEY || 'sb_publishable_jodHsyRQmowfQrcm-YbuHg_3kRdy9L3';
                    const r = await fetch(`${SB_URL}/rest/v1/gpo_mapping?ean=eq.${encodeURIComponent(caseComp.ean)}&select=component_name,variant_value&limit=1`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
                    if (r.ok) {
                        const rows = await r.json();
                        const nm = `${rows[0]?.component_name || ''} ${rows[0]?.variant_value || ''}`.toUpperCase();
                        pdfCaseColor = M.colore(nm);
                    }
                } catch (e) {}
            }
        }

        for (let index = 0; index < componentOrder.length; index++) {
            const compType = componentOrder[index];
            const comp = componentsByType[compType];
            const domComp = domComponents[compType];

            let ean = '';
            let descrizione = '';
            let fornitore = '';

            if (domComp && domComp.ean) {
                const rawEan = domComp.ean;
                ean = String(rawEan).trim();
                descrizione = domComp.name || '';
                fornitore = domComp.supplier || extractSupplierFromText(String(rawEan)) || '';

                if (String(ean).toUpperCase() === 'INTEGRATA') {
                    descrizione = 'GPU Integrata';
                    ean = '';
                } else if (ean) {
                    const dbData = await getComponentDataFromDB(ean, fornitore);
                    if (dbData?.nome && !M.codiceNonRisolto(dbData.nome, ean)) descrizione = dbData.nome;
                    if (!descrizione) descrizione = domComp.name || comp?.name || '';
                }
            } else if (comp && comp.ean) {
                const rawEan = comp.ean;
                ean = String(rawEan).trim();
                fornitore = comp.supplier || extractSupplierFromText(String(rawEan)) || '';
                if (ean) {
                    const dbData = await getComponentDataFromDB(ean, fornitore);
                    descrizione = dbData?.nome && !M.codiceNonRisolto(dbData.nome, ean) ? dbData.nome : (comp.name || '');
                }
            }

            // Risoluzione per identità esatta; nessuna ricerca di un prodotto alternativo.
            if (ean) {
                const esatto = A.nomeDaCodice?.(dati, ean, {line_items: order.line_items || order.items || []}, compType);
                if (esatto?.nome && !M.codiceNonRisolto(esatto.nome, ean) &&
                    (esatto.fonte!=='identita_storica' || !descrizione || M.codiceNonRisolto(descrizione,ean))) descrizione = esatto.nome;
                if (!descrizione || M.codiceNonRisolto(descrizione, ean)) {
                    const fixed = (auto?.pezzi || []).find(p=>M.categoria(p.tipo)===compType &&
                        [p.manuale?.codice,p.auto?.codice,p.fisso?.codice].some(c=>c && String(c).trim().toUpperCase()===ean.toUpperCase()));
                    if (fixed?.fisso?.descrizione && !M.codiceNonRisolto(fixed.fisso.descrizione,ean)) descrizione=fixed.fisso.descrizione;
                }
            }
            if (M.codiceNonRisolto(descrizione || ean, ean)) {
                pushLine((descrizione || ean) + ' - DA VERIFICARE: modello del codice non risolto; identificare il prodotto prima del montaggio.', compType);
                continue;
            }

            // v35: normalizzazione generici + colore anche nel PDF/Excel
            if (descrizione && typeof window.normalizeDisplayName === 'function' &&
                (compType === 'GPU' || compType === 'SSD' || compType === 'MOBO')) {
                descrizione = window.normalizeDisplayName(compType, descrizione, ['WHITE', 'BLACK'].includes(pdfCaseColor) ? pdfCaseColor : '');
            }

            const testo = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
            if (testo) pushLine(testo, compType);
        }

        // Tipi EXTRA presenti nell'ordine ma non tra gli 8 base
        // (es. MONITOR, KIT GAMING, SSD ADDON, ARCHIVIAZIONE AGGIUNTIVA...).
        // Senza questo blocco il PDF/Excel li saltava.
        const baseTypesSet = new Set(componentOrder.map(t => String(t).toUpperCase()));
        const extraTypesSet = new Set();
        for (const t of Object.keys(componentsByType)) {
            const k = String(t || '').trim().toUpperCase();
            if (k && !baseTypesSet.has(k)) extraTypesSet.add(k);
        }
        for (const t of Object.keys(domComponents)) {
            const k = String(t || '').trim().toUpperCase();
            if (k && !baseTypesSet.has(k)) extraTypesSet.add(k);
        }

        for (const compTypeKey of extraTypesSet) {
            const domComp = domComponents[compTypeKey];
            const comp = componentsByType[compTypeKey] || componentsByType[Object.keys(componentsByType).find(k => String(k).toUpperCase() === compTypeKey)];

            let ean = '';
            let descrizione = '';
            let fornitore = '';

            if (domComp && (domComp.ean || domComp.name)) {
                ean = String(domComp.ean || '').trim();
                descrizione = domComp.name || '';
                fornitore = domComp.supplier || extractSupplierFromText(String(ean)) || '';
                if (ean && String(ean).toUpperCase() !== 'INTEGRATA') {
                    const dbData = await getComponentDataFromDB(ean, fornitore);
                    if (dbData?.nome && !M.codiceNonRisolto(dbData.nome, ean)) descrizione = dbData.nome;
                }
            } else if (comp && (comp.ean || comp.name)) {
                ean = String(comp.ean || '').trim();
                fornitore = comp.supplier || extractSupplierFromText(String(ean)) || '';
                descrizione = comp.name || '';
                if (ean) {
                    const dbData = await getComponentDataFromDB(ean, fornitore);
                    if (dbData?.nome && !M.codiceNonRisolto(dbData.nome, ean)) descrizione = dbData.nome;
                }
            }

            if (ean) {
                const esatto = (compTypeKey === 'MONITOR' && typeof window.nomeLeggibileDelCodice === 'function'
                    ? await window.nomeLeggibileDelCodice(order.id, ean, 'MONITOR') : null) ||
                    A.nomeDaCodice?.(dati, ean, {line_items: order.line_items || order.items || []}, compTypeKey);
                if (esatto?.nome && !M.codiceNonRisolto(esatto.nome, ean)) descrizione = esatto.nome;
            }
            let testoExtraType = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
            if (M.codiceNonRisolto(testoExtraType, ean)) testoExtraType += ' - DA VERIFICARE: modello del codice non risolto; identificare il prodotto prima della preparazione.';
            if (testoExtraType) pushLine(testoExtraType, compTypeKey);
        }

        // Custom items (HDD aggiuntivo, monitor, kit, ecc.)
        const customItems = await loadCustomItemsFromDB(order.id);
        const escapedOrderId = CSS.escape(String(order.id));
        const customItemRows = document.querySelectorAll(`#custom-items-${escapedOrderId} .custom-item-row`);
        const domCustomItems = [];
        customItemRows.forEach(row => {
            const name = row.querySelector('strong')?.textContent?.replace(':', '').trim() || '';
            const spans = row.querySelectorAll('span');
            const value = spans?.[0]?.textContent?.trim() || '';
            const supplier = row.dataset?.supplier || '';
            const ean = row.dataset?.ean || '';
            if (name || value || ean) domCustomItems.push({ name, value, supplier, ean });
        });
        const allCustomItems = [...customItems];
        for (const domItem of domCustomItems) {
            const exists = customItems.some(item =>
                String(item?.name || '') === String(domItem?.name || '') &&
                String(item?.value || '') === String(domItem?.value || '')
            );
            if (!exists) allCustomItems.push(domItem);
        }
        for (const item of allCustomItems) {
            let itemEan = String(item?.ean || '').trim();
            let itemDesc = String(item?.value || item?.name || '').trim();
            let itemSupplier = String(item?.supplier || '').trim();
            if (itemEan) {
                const dbData = await getComponentDataFromDB(itemEan, itemSupplier);
                if (dbData && dbData.nome) itemDesc = dbData.nome;
                const esatto = A.nomeDaCodice?.(dati, itemEan, {line_items: order.line_items || order.items || []}, item.name);
                if (esatto?.nome && !M.codiceNonRisolto(esatto.nome, itemEan)) itemDesc = esatto.nome;
            }
            let testoExtra = itemDesc || itemEan;
            if (M.codiceNonRisolto(testoExtra, itemEan)) testoExtra += ' - DA VERIFICARE: modello del codice non risolto; identificare il prodotto prima della preparazione.';
            if (testoExtra) pushLine(testoExtra, item.name || 'EXTRA');
        }

        // Opzioni derivate (ventole, software, scatole...) non hanno data-ean e
        // prima erano escluse. Il motore copre anche schede non ancora renderizzate.
        const presenti = new Set(componentRecords.map(x => M.categoria(x.tipo)));
        const opzioni = (auto?.pezzi || []).filter(p => {
            const cat=M.categoriaVoce(p.tipo,p.cliente || p.fisso?.descrizione || '');
            return !M.base.includes(cat) && (!presenti.has(cat) || ['EXTRA','SOFTWARE'].includes(cat));
        }).map(p => ({
            tipo:p.tipo, nome:p.cliente || p.fisso?.descrizione || p.manuale?.codice || p.auto?.descrizione || '',
            scelta:p.cliente || p.fisso?.descrizione || ''
        }));
        document.querySelectorAll(`#components-${CSS.escape(String(order.id))} .acc-riga-opzione`).forEach(row => {
            if (row.dataset.exportValue) opzioni.push({tipo:row.dataset.exportType,nome:row.dataset.exportValue});
        });
        const righeSalvate = savedComponents.map(c => ({tipo:c.type,ean:c.ean,nome:c.name,fornitore:c.supplier}));
        const piano = A.pianoMontaggioUpgrade(auto, righeSalvate, {});
        // I servizi/accessori venduti come prodotti separati (es. Minimal Booster)
        // non sono tutti presenti nel piano del Buyer Desk. Non vanno persi.
        const righeOrdine = M.extraOrdine(order, componentRecords, [...savedComponents, ...Object.values(domComponents), ...allCustomItems]);
        const records = M.distinta(componentRecords, [...opzioni, ...righeOrdine], A.upgradePagatiDellUnita(auto), piano, pdfCaseColor);

        const configBadge = document.querySelector(`.config-badge[data-order-id="${order.id}"], .order-card[data-order-id="${order.id}"] .config-badge`);
        const configName = (configBadge ? configBadge.textContent.trim() : (savedOrder?.configName || '')) || 'PC GAMING';

        result.push({ orderName, configName, lines: componentLines, records });
    }

    return { orders: result, worksheetNumber: activeWorksheetNumber };
}


// ============================================================
// EXPORT PDF — formato stampa: ogni ordine è una tabella bordata
// e NON si spezza mai tra due pagine (salto pagina anticipato).
// ============================================================
async function exportProcessedOrdersToPDF() {
    if (!processedOrdersMap || processedOrdersMap.size === 0) {
        showNotification('Nessun ordine elaborato da esportare', 'warning');
        return;
    }

    // jsPDF è caricato come window.jspdf.jsPDF (build UMD)
    const jsPDFRef = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    if (!jsPDFRef) {
        showNotification('Errore: libreria PDF non caricata', 'error');
        return;
    }

    const pdfBtn = document.getElementById('export-pdf-btn');
    const prevTitle = pdfBtn ? pdfBtn.title : '';
    if (pdfBtn) { pdfBtn.disabled = true; pdfBtn.title = 'Generazione PDF...'; }

    try {
        const { orders, worksheetNumber } = await collectOrdersForExport({ verificaPagamenti: true });

        if (!orders.length) {
            showNotification('Nessun ordine da esportare con i filtri attuali', 'warning');
            if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.title = prevTitle; }
            return;
        }

        const doc = new jsPDFRef({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageHeight = doc.internal.pageSize.getHeight(); // ~297mm
        const pageWidth = doc.internal.pageSize.getWidth();    // ~210mm
        const marginTop = 15;
        const marginBottom = 15;
        const marginX = 12;

        // larghezze colonne
        const colOrderW = 27;
        const colTypeW = 27;
        const colConfigW = pageWidth - marginX * 2 - colOrderW - colTypeW;

        // stima altezza riga (autotable usa ~ font 10 -> ~6-7mm con padding)
        const headerRowH = 6;   // intestazione tabella
        const titleRowH = 5.5;    // riga nome config
        const lineRowH = 4.2;   // riga componente

        let cursorY = marginTop;

        // intestazione generale solo sulla prima pagina
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(`ORDINI — Tavolo ${worksheetNumber}`, marginX, cursorY);
        cursorY += 7;

        for (const ord of orders) {
            // altezza totale del blocco di questo ordine
            const records = ord.records || ord.lines.map(nome => ({tipo:'EXTRA',nome}));
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            const blockHeight = headerRowH + titleRowH + records.reduce((h,r) => h + 1.6 + Math.max(
                doc.splitTextToSize(window.MontaggioExport.testoPdf(r.nome), colConfigW - 2).length,
                doc.splitTextToSize(r.tipo, colTypeW - 2).length) * 3.3, 0) + 4;

            // se non ci sta nella pagina corrente -> nuova pagina (anti-spezzamento)
            if (cursorY > marginTop && cursorY + blockHeight > pageHeight - marginBottom) {
                doc.addPage();
                cursorY = marginTop;
            }

            // Costruisco le righe del corpo: prima il nome config, poi i componenti numerati
            const body = [];
            body.push([
                { content: ord.orderName, rowSpan: records.length + 1, styles: { fontStyle: 'bold', fontSize: 9, valign: 'top', halign: 'left' } },
                { content: ord.configName, colSpan:2, styles: { fontStyle: 'bold', fontSize: 9 } }
            ]);
            records.forEach(r => {
                // Con rowSpan il plugin legacy non avvolge sempre le righe lunghe:
                // precompongo le linee con la stessa font e la larghezza stampabile.
                doc.setFont('helvetica','bold'); doc.setFontSize(8);
                const categoria = doc.splitTextToSize(r.tipo, colTypeW - 2).join('\n');
                doc.setFont('helvetica','normal');
                const nome = doc.splitTextToSize(window.MontaggioExport.testoPdf(r.nome), colConfigW - 2).join('\n');
                body.push([{ content:categoria, styles:{fontStyle:'bold',fontSize:8} }, { content:nome, styles:{fontSize:8} }]);
            });

            doc.autoTable({
                startY: cursorY,
                margin: { left: marginX, right: marginX },
                head: [[
                    { content: 'NUMERO ORDINE', styles: { halign: 'left' } },
                    { content: 'CATEGORIA', styles: { halign: 'left' } },
                    { content: 'COMPONENTE / EXTRA', styles: { halign: 'left' } }
                ]],
                body: body,
                theme: 'grid',
                styles: {
                    lineColor: [60, 60, 60],
                    lineWidth: 0.25,
                    cellPadding: 0.8,
                    textColor: [20, 20, 20],
                    overflow: 'linebreak'
                },
                headStyles: {
                    fillColor: [64, 64, 64],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    fontSize: 8,
                    lineColor: [60, 60, 60],
                    lineWidth: 0.25
                },
                columnStyles: {
                    0: { cellWidth: colOrderW },
                    1: { cellWidth: colTypeW },
                    2: { cellWidth: colConfigW }
                },
                // evita che autotable spezzi una riga a metà
                rowPageBreak: 'avoid',
                pageBreak: 'avoid'
            });

            cursorY = doc.lastAutoTable.finalY + 6;
        }

        const now = new Date();
        const dateStr = `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}`;
        const timeStr = `${now.getHours()}-${now.getMinutes()}`;
        doc.save(`Ordini_PDF_E${worksheetNumber}_${dateStr}_${timeStr}.pdf`);

        const daVerificare = orders.reduce((n,o) => n + (o.records || []).filter(r => r.avviso).length, 0);
        showNotification(`PDF generato: ${orders.length} ordini` + (daVerificare ? `; ${daVerificare} voci DA VERIFICARE nella distinta.` : ''), daVerificare ? 'warning' : 'success');
    } catch (error) {
        console.error('❌ Errore durante export PDF:', error);
        showNotification('Errore durante export PDF: ' + error.message, 'error');
    } finally {
        if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.title = prevTitle || 'Esporta ordini in PDF'; }
    }
}


// ============================================================
// EXPORT EXCEL (formato 2 colonne, invariato dalla v28)
// ============================================================
async function exportProcessedOrdersToExcel() {
    if (!processedOrdersMap || processedOrdersMap.size === 0) {
        showNotification('Nessun ordine elaborato da esportare', 'warning'); return;
    }
    if (typeof XLSX === 'undefined') {
        showNotification('Errore: libreria Excel non caricata', 'error'); return;
    }
    const btn = document.getElementById('export-excel-btn');
    const previousHtml = btn?.innerHTML, previousDisabled = btn?.disabled, previousTitle = btn?.title;
    if (btn) { btn.disabled = true; btn.title = 'Verifica upgrade e generazione Excel...'; }
    try {
        // La stessa distinta del PDF: stessi pagamenti verificati, sostituzioni, extra e filtri.
        const { orders, worksheetNumber } = await collectOrdersForExport({ verificaPagamenti: true });
        if (!orders.length) { showNotification('Nessun ordine da esportare con i filtri attuali', 'warning'); return; }
        const rows = [['NUMERO ORDINE', 'CATEGORIA', 'COMPONENTE / EXTRA']], merges = [], headers = [];
        for (const ord of orders) {
            const start = rows.length;
            rows.push([ord.orderName, ord.configName, '']); headers.push(start);
            merges.push({s:{r:start,c:1},e:{r:start,c:2}});
            for (const r of ord.records) rows.push(['',r.tipo,r.nome]);
            if (rows.length > start + 1) merges.push({s:{r:start,c:0},e:{r:rows.length-1,c:0}});
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const style = (r,c,value) => { const cell=ws[XLSX.utils.encode_cell({r,c})]; if(cell) cell.s=value; };
        const heading = {font:{bold:true,color:{rgb:'FFFFFF'},sz:11},fill:{patternType:'solid',fgColor:{rgb:'404040'}},alignment:{vertical:'center',wrapText:true}};
        for(let c=0;c<3;c++) style(0,c,heading);
        for(let r=1;r<rows.length;r++) for(let c=0;c<3;c++) style(r,c,{font:{bold:c===0 || headers.includes(r)},alignment:{vertical:'top',wrapText:true}});
        ws['!merges']=merges; ws['!cols']=[{wch:18},{wch:27},{wch:95}];
        ws['!rows']=rows.map((r,i)=>({hpt:i===0?26:headers.includes(i)?23:Math.max(23,Math.ceil(String(r[2] || '').length/85)*14+8)}));
        const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,`Tavolo ${worksheetNumber}`);
        const now=new Date();
        XLSX.writeFile(wb,`Ordini_E${worksheetNumber}_${now.getDate()}-${now.getMonth()+1}-${now.getFullYear()}_${now.getHours()}-${now.getMinutes()}.xlsx`);
        const warnings=orders.reduce((n,o)=>n+o.records.filter(r=>r.avviso).length,0);
        showNotification(`Export Excel completato: ${orders.length} ordini`+(warnings?`; ${warnings} voci DA VERIFICARE nella distinta.`:''),warnings?'warning':'success');
    } catch(error) {
        console.error('Errore durante export Excel:',error);
        showNotification('Errore durante export Excel: '+error.message,'error');
    } finally {
        if(btn) {btn.innerHTML=previousHtml;btn.disabled=previousDisabled;btn.title=previousTitle || 'Esporta ordini in Excel';}
    }
}

const componentDataLookupCache = new Map();

async function getComponentDataFromDB(ean, supplier = '') {
    if (!ean || ean === 'MANUALE' || ean === 'GENERICO' || ean === '') return null;

    const rawEan = String(ean).trim();
    if (!rawEan || rawEan === 'INTEGRATA' || rawEan === 'GENERICO') return null;
    const eanIsNumeric = isValidEAN(rawEan); // true solo per codici numerici
    const supplierHint = String(supplier || '').trim();
    const normalizedSupplier = (supplierHint && supplierHint !== 'SENZA FORNITORE' && supplierHint !== 'FORNITORE') ? supplierHint : '';
    const cacheKey = `${rawEan}::${normalizedSupplier}`;

    if (componentDataLookupCache.has(cacheKey)) {
        return componentDataLookupCache.get(cacheKey);
    }

    if (eanIsNumeric) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let lookupUrl = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(rawEan)}`;
        if (normalizedSupplier) lookupUrl += `&supplier=${encodeURIComponent(normalizedSupplier)}`;
        const response = await fetch(lookupUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.component) {
                const resolved = {
                    nome: data.component.nome || '',
                    prezzo: data.component.prezzo || '',
                    quantita: data.component.quantita || '',
                    fornitore: data.component.fornitore || ''
                };
                componentDataLookupCache.set(cacheKey, resolved);
                return resolved;
            }
        }
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 5000);
        const invResponse = await fetch(`api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php?ean=${encodeURIComponent(rawEan)}`, { signal: controller2.signal });
        clearTimeout(timeoutId2);
        if (invResponse.ok) {
            const invData = await invResponse.json();
            if (invData.success && invData.item) {
                const resolved = { nome: invData.item.name || '', prezzo: '', quantita: String(invData.item.quantity ?? ''), fornitore: '' };
                componentDataLookupCache.set(cacheKey, resolved);
                return resolved;
            }
        }
    } catch (error) {
    }
    }

    // Fallback: risolvo il nome da gpo_mapping (copre EAN alfanumerici come GEHY-037,
    // GELI-975 ecc. che isValidEAN scarta e che gli endpoint sopra non trovano).
    try {
        const SB_URL = (window.SUPABASE_URL) || 'https://nulkachuhjdzohkzwvly.supabase.co';
        const SB_KEY = (window.SUPABASE_KEY) || 'sb_publishable_jodHsyRQmowfQrcm-YbuHg_3kRdy9L3';
        const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
        const q = `${SB_URL}/rest/v1/gpo_mapping?ean=eq.${encodeURIComponent(rawEan)}&select=component_name,supplier&limit=1`;
        const r = await fetch(q, { headers: H });
        if (r.ok) {
            const rows = await r.json();
            const row = Array.isArray(rows) ? rows.find(x => x && x.component_name) : null;
            if (row && row.component_name) {
                const resolved = { nome: row.component_name, prezzo: '', quantita: '', fornitore: row.supplier || '' };
                componentDataLookupCache.set(cacheKey, resolved);
                return resolved;
            }
        }
    } catch (e) {
    }

    componentDataLookupCache.set(cacheKey, null);
    return null;
}




function initializeExportExcelButton() {
    const exportExcelBtn = document.getElementById('export-excel-btn');
    if (exportExcelBtn) {
        exportExcelBtn.disabled = true;
        exportExcelBtn.title = 'Caricamento dati in corso...';
        exportExcelBtn.addEventListener('click', () => {
            if (exportExcelBtn.disabled) {
                showNotification('Attendere il caricamento dei dati...', 'warning');
                return;
            }
            exportProcessedOrdersToExcel();
        });
    }

    // bottone PDF (se presente nell'HTML)
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', () => {
            exportProcessedOrdersToPDF();
        });
    }
}

console.log('✅ excel-export.js caricato: distinta unica PDF/Excel con verifica pagamenti');
