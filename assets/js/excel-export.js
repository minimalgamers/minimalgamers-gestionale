// ============================================================
// Funzione condivisa: raccoglie gli ordini da esportare con i
// loro componenti leggibili. Usata sia da Excel che da PDF.
// Ritorna un array di { orderName, configName, lines: [string] }
// ============================================================
async function collectOrdersForExport() {
    const componentOrder = ['CPU', 'MOBO', 'SSD', 'RAM', 'GPU', 'PSU', 'COOLER', 'CASE'];

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
        const savedOrder = processedOrdersCache[order.id];
        const savedComponents = savedOrder?.components || [];

        const componentsByType = {};
        for (const comp of savedComponents) {
            componentsByType[comp.type] = comp;
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
        const seenLines = new Set();
        const pushLine = (t) => {
            const v = String(t || '').trim();
            if (!v) return;
            const k = v.toUpperCase();
            if (seenLines.has(k)) return;
            seenLines.add(k);
            componentLines.push(v);
        };

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
                    if (dbData && dbData.nome) descrizione = dbData.nome;
                    if (!descrizione) descrizione = domComp.name || comp?.name || '';
                }
            } else if (comp && comp.ean) {
                const rawEan = comp.ean;
                ean = String(rawEan).trim();
                fornitore = comp.supplier || extractSupplierFromText(String(rawEan)) || '';
                if (ean) {
                    const dbData = await getComponentDataFromDB(ean, fornitore);
                    descrizione = (dbData && dbData.nome) ? dbData.nome : (comp.name || '');
                }
            }

            const testo = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
            if (testo) pushLine(testo);
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
                    if (dbData && dbData.nome) descrizione = dbData.nome;
                }
            } else if (comp && (comp.ean || comp.name)) {
                ean = String(comp.ean || '').trim();
                fornitore = comp.supplier || extractSupplierFromText(String(ean)) || '';
                descrizione = comp.name || '';
                if (ean) {
                    const dbData = await getComponentDataFromDB(ean, fornitore);
                    if (dbData && dbData.nome) descrizione = dbData.nome;
                }
            }

            const testoExtraType = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
            if (testoExtraType) pushLine(testoExtraType);
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
            }
            const testoExtra = itemDesc || itemEan;
            if (testoExtra) pushLine(testoExtra);
        }

        const configBadge = document.querySelector(`.config-badge[data-order-id="${order.id}"], .order-card[data-order-id="${order.id}"] .config-badge`);
        const configName = (configBadge ? configBadge.textContent.trim() : (savedOrder?.configName || '')) || 'PC GAMING';

        result.push({ orderName, configName, lines: componentLines });
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
        const { orders, worksheetNumber } = await collectOrdersForExport();

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
        const colOrderW = 32;                       // NUMERO ORDINE
        const colConfigW = pageWidth - marginX * 2 - colOrderW; // resto

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
            const blockHeight = headerRowH + titleRowH + (ord.lines.length * lineRowH) + 4;

            // se non ci sta nella pagina corrente -> nuova pagina (anti-spezzamento)
            if (cursorY + blockHeight > pageHeight - marginBottom) {
                doc.addPage();
                cursorY = marginTop;
            }

            // Costruisco le righe del corpo: prima il nome config, poi i componenti numerati
            const body = [];
            body.push([
                { content: ord.orderName, rowSpan: ord.lines.length + 1, styles: { fontStyle: 'bold', fontSize: 9, valign: 'top', halign: 'left' } },
                { content: ord.configName, styles: { fontStyle: 'bold', fontSize: 8.5 } }
            ]);
            ord.lines.forEach((line, i) => {
                body.push([{ content: `${i + 1}. ${line}`, styles: { fontSize: 7.5 } }]);
            });

            doc.autoTable({
                startY: cursorY,
                margin: { left: marginX, right: marginX },
                head: [[
                    { content: 'NUMERO ORDINE', styles: { halign: 'left' } },
                    { content: 'CONFIGURAZIONE PC GAMING', styles: { halign: 'left' } }
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
                    1: { cellWidth: colConfigW }
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

        showNotification(`✅ PDF generato: ${orders.length} ordini`, 'success');
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
        showNotification('Nessun ordine elaborato da esportare', 'warning');
        return;
    }

    if (typeof XLSX === 'undefined') {
        showNotification('Errore: libreria Excel non caricata', 'error');
        return;
    }

    const exportExcelBtn = document.getElementById('export-excel-btn');
    const exportExcelBtnLabelEl = exportExcelBtn ? exportExcelBtn.querySelector('span') : null;
    const previousExcelBtnHtml = exportExcelBtn ? exportExcelBtn.innerHTML : '';
    const previousExcelBtnDisabled = exportExcelBtn ? exportExcelBtn.disabled : false;
    if (exportExcelBtn) exportExcelBtn.disabled = true;

    const setExcelBtnProgress = (pct, done, total) => {
        if (!exportExcelBtn || !exportExcelBtnLabelEl) return;
        exportExcelBtnLabelEl.textContent = `${pct}%`;
        exportExcelBtn.title = `Export Excel: ${pct}% (${done}/${total})`;
    };

    try {
        const activeFilter = document.querySelector('.filter-button.active');
        const filterOperator = activeFilter ? activeFilter.dataset.operator : null;

        const getWorksheetNumberForOrder = (order) => {
            const cachedOrder = processedOrdersCache[order.id] || {};
            return Math.min(4, Math.max(1, parseInt(cachedOrder.foglioDiLavoro ?? order.foglioDiLavoro ?? 1, 10) || 1));
        };

        const createWorksheetPayload = async (ordersForWorksheet, componentOrder, onOrderExported) => {
            const excelData = [];
            const orderHeaderRowIndexes = [];
            const configNameRowIndexes = [];
            const merges = [];
            let ordersExported = 0;

            excelData.push(['NUMERO ORDINE', 'CONFIGURAZIONE PC GAMING']);

            for (const [orderName, order] of ordersForWorksheet) {
                if (ordersExported > 0) excelData.push(['', '']);

                const savedOrder = processedOrdersCache[order.id];
                const savedComponents = savedOrder?.components || [];

                const componentsByType = {};
                for (const comp of savedComponents) componentsByType[comp.type] = comp;

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
                            if (dbData && dbData.nome) descrizione = dbData.nome;
                            if (!descrizione) descrizione = domComp.name || comp?.name || '';
                        }
                    } else if (comp && comp.ean) {
                        const rawEan = comp.ean;
                        ean = String(rawEan).trim();
                        fornitore = comp.supplier || extractSupplierFromText(String(rawEan)) || '';
                        if (ean) {
                            const dbData = await getComponentDataFromDB(ean, fornitore);
                            descrizione = (dbData && dbData.nome) ? dbData.nome : (comp.name || '');
                        }
                    }
                    const testo = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
                    if (testo) componentLines.push(testo);
                }

                // Tipi EXTRA (MONITOR, KIT GAMING, SSD ADDON, ...) non tra gli 8 base
                {
                    const baseSet = new Set(componentOrder.map(t => String(t).toUpperCase()));
                    const seenExcel = new Set(componentLines.map(l => String(l).trim().toUpperCase()));
                    const extraSet = new Set();
                    for (const t of Object.keys(componentsByType)) {
                        const k = String(t || '').trim().toUpperCase();
                        if (k && !baseSet.has(k)) extraSet.add(k);
                    }
                    for (const t of Object.keys(domComponents)) {
                        const k = String(t || '').trim().toUpperCase();
                        if (k && !baseSet.has(k)) extraSet.add(k);
                    }
                    for (const compTypeKey of extraSet) {
                        const domComp = domComponents[compTypeKey];
                        const comp = componentsByType[compTypeKey] || componentsByType[Object.keys(componentsByType).find(k => String(k).toUpperCase() === compTypeKey)];
                        let ean = '', descrizione = '', fornitore = '';
                        if (domComp && (domComp.ean || domComp.name)) {
                            ean = String(domComp.ean || '').trim();
                            descrizione = domComp.name || '';
                            fornitore = domComp.supplier || extractSupplierFromText(String(ean)) || '';
                            if (ean && String(ean).toUpperCase() !== 'INTEGRATA') {
                                const dbData = await getComponentDataFromDB(ean, fornitore);
                                if (dbData && dbData.nome) descrizione = dbData.nome;
                            }
                        } else if (comp && (comp.ean || comp.name)) {
                            ean = String(comp.ean || '').trim();
                            fornitore = comp.supplier || extractSupplierFromText(String(ean)) || '';
                            descrizione = comp.name || '';
                            if (ean) {
                                const dbData = await getComponentDataFromDB(ean, fornitore);
                                if (dbData && dbData.nome) descrizione = dbData.nome;
                            }
                        }
                        const testoX = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
                        if (testoX && !seenExcel.has(testoX.toUpperCase())) {
                            seenExcel.add(testoX.toUpperCase());
                            componentLines.push(testoX);
                        }
                    }
                }

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
                    }
                    const testoExtra = itemDesc || itemEan;
                    if (testoExtra) componentLines.push(testoExtra);
                }

                const configBadge = document.querySelector(`.config-badge[data-order-id="${order.id}"], .order-card[data-order-id="${order.id}"] .config-badge`);
                const configName = (configBadge ? configBadge.textContent.trim() : (savedOrder?.configName || '')) || 'PC GAMING';

                const blockStartRow0 = excelData.length;
                excelData.push([orderName, configName]);
                orderHeaderRowIndexes.push(blockStartRow0 + 1);
                configNameRowIndexes.push(blockStartRow0 + 1);

                componentLines.forEach((line, i) => {
                    excelData.push(['', `${i + 1}. ${line}`]);
                });

                const blockEndRow0 = excelData.length - 1;
                if (blockEndRow0 > blockStartRow0) {
                    merges.push({ s: { r: blockStartRow0, c: 0 }, e: { r: blockEndRow0, c: 0 } });
                }

                ordersExported++;
                onOrderExported();
            }

            return { excelData, orderHeaderRowIndexes, configNameRowIndexes, merges, ordersExported };
        };

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

        const totalOrdersToExport = ordersToExport.length;
        const updateExportProgress = (done) => {
            const pct = totalOrdersToExport > 0 ? Math.round((done / totalOrdersToExport) * 100) : 0;
            setExcelBtnProgress(pct, done, totalOrdersToExport);
        };
        updateExportProgress(0);

        const componentOrder = ['CPU', 'MOBO', 'SSD', 'RAM', 'GPU', 'PSU', 'COOLER', 'CASE'];
        let ordersExported = 0;
        let ordersDoneForProgress = 0;

        const wb = XLSX.utils.book_new();
        const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }, fill: { patternType: 'solid', fgColor: { rgb: '404040' } }, alignment: { vertical: 'center', horizontal: 'left' } };
        const orderNumberStyle = { font: { bold: true, sz: 12 }, alignment: { vertical: 'top', horizontal: 'left' } };
        const configNameStyle = { font: { bold: true, sz: 11 }, alignment: { vertical: 'top', horizontal: 'left' } };
        const componentStyle = { alignment: { vertical: 'top', horizontal: 'left', wrapText: true } };

        {
            const worksheetNumber = activeWorksheetNumber;
            const { excelData, orderHeaderRowIndexes, configNameRowIndexes, merges, ordersExported: worksheetExportedCount } = await createWorksheetPayload(
                ordersToExport, componentOrder,
                () => { ordersDoneForProgress++; updateExportProgress(ordersDoneForProgress); }
            );

            const ws = XLSX.utils.aoa_to_sheet(excelData);
            const setStyle = (rowIndex0, colIndex0, style) => {
                const addr = XLSX.utils.encode_cell({ r: rowIndex0, c: colIndex0 });
                if (!ws[addr]) return;
                ws[addr].s = { ...(ws[addr].s || {}), ...style };
            };
            setStyle(0, 0, headerStyle);
            setStyle(0, 1, headerStyle);
            for (const r1 of orderHeaderRowIndexes) setStyle(r1 - 1, 0, orderNumberStyle);
            for (const r1 of configNameRowIndexes) setStyle(r1 - 1, 1, configNameStyle);
            for (let r = 1; r < excelData.length; r++) {
                const addr = XLSX.utils.encode_cell({ r, c: 1 });
                if (ws[addr] && !configNameRowIndexes.includes(r + 1)) {
                    ws[addr].s = { ...(ws[addr].s || {}), ...componentStyle };
                }
            }
            if (merges.length) ws['!merges'] = merges;
            ws['!cols'] = [{ wch: 18 }, { wch: 65 }];

            XLSX.utils.book_append_sheet(wb, ws, `Tavolo ${worksheetNumber}`);
            ordersExported += worksheetExportedCount;
        }

        if (ordersExported === 0) {
            showNotification('Nessun ordine da esportare con i filtri attuali', 'warning');
            if (exportExcelBtn) {
                exportExcelBtn.innerHTML = previousExcelBtnHtml;
                exportExcelBtn.disabled = previousExcelBtnDisabled;
                exportExcelBtn.title = 'Esporta ordini in Excel';
            }
            return;
        }

        const now = new Date();
        const dateStr = `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}`;
        const timeStr = `${now.getHours()}-${now.getMinutes()}`;
        const fileName = `Ordini_E${activeWorksheetNumber}_${dateStr}_${timeStr}.xlsx`;
        XLSX.writeFile(wb, fileName);

        if (exportExcelBtn) {
            exportExcelBtn.innerHTML = previousExcelBtnHtml;
            exportExcelBtn.disabled = previousExcelBtnDisabled;
            exportExcelBtn.title = 'Esporta ordini in Excel';
        }
        showNotification(`✅ Export Excel completato: ${ordersExported} ordini`, 'success');

    } catch (error) {
        console.error('❌ Errore durante export Excel:', error);
        showNotification('Errore durante export Excel: ' + error.message, 'error');
        if (exportExcelBtn) {
            exportExcelBtn.innerHTML = previousExcelBtnHtml;
            exportExcelBtn.disabled = previousExcelBtnDisabled;
            exportExcelBtn.title = 'Esporta ordini in Excel';
        }
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

console.log('✅ excel-export.js caricato (v31 - PDF compatto + tipi extra + nomi HYTE/GELI)');
