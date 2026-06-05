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

        // ============================================================
        // NUOVO FORMATO: 2 colonne -> NUMERO ORDINE | CONFIGURAZIONE PC GAMING
        // Ogni ordine = un blocco. A sinistra il numero ordine in alto.
        // A destra: nome config (riga 1) + lista numerata componenti (nome leggibile).
        // ============================================================
        const createWorksheetPayload = async (ordersForWorksheet, componentOrder, onOrderExported) => {
            const excelData = [];
            const orderHeaderRowIndexes = []; // righe (1-based) dove c'e' il numero ordine
            const configNameRowIndexes = [];  // righe (1-based) dove c'e' il nome del PC
            const merges = [];                 // celle unite (colonna numero ordine)
            let ordersExported = 0;

            // Intestazione
            excelData.push(['NUMERO ORDINE', 'CONFIGURAZIONE PC GAMING']);

            for (const [orderName, order] of ordersForWorksheet) {
                // riga vuota di separazione fra un ordine e l'altro
                if (ordersExported > 0) {
                    excelData.push(['', '']);
                }

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
                        if (parts[0]) {
                            name = parts[0].split(':').slice(1).join(':').trim();
                        }
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
                            if (titlePart.startsWith('EAN:')) {
                                name = textContent;
                            } else {
                                name = titlePart.split(':').slice(1).join(':').trim();
                            }
                        }
                    }

                    if (name === 'Caricamento...') {
                        name = '';
                    }

                    const supplierBadge = document.querySelector(`.supplier-badge-clickable[data-order-id="${order.id}"][data-component-type="${compType}"]`);
                    const supplier = supplierBadge?.dataset?.supplier || '';

                    domComponents[compTypeKey] = { ean, name, supplier };
                });

                // Costruisco la lista delle descrizioni leggibili (in ordine componenti)
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
                            fornitore = 'INTEGRATA';
                        } else if (ean) {
                            const dbData = await getComponentDataFromDB(ean, fornitore);
                            if (dbData) {
                                if (dbData.nome) descrizione = dbData.nome;
                                if (!descrizione) descrizione = domComp.name || '';
                                if (!descrizione) descrizione = comp?.name || '';
                            } else {
                                if (!descrizione) descrizione = domComp.name || '';
                                if (!descrizione) descrizione = comp?.name || '';
                            }
                        }
                    }
                    else if (comp && comp.ean) {
                        const rawEan = comp.ean;
                        ean = String(rawEan).trim();
                        fornitore = comp.supplier || '';
                        if (!fornitore) fornitore = extractSupplierFromText(String(rawEan)) || '';

                        if (ean) {
                            const dbData = await getComponentDataFromDB(ean, fornitore);
                            if (dbData) {
                                descrizione = dbData.nome || comp.name || '';
                            } else {
                                descrizione = comp.name || '';
                            }
                        }
                    }

                    // Se non c'e' descrizione leggibile, ripiego sull'EAN per non perdere la riga
                    const testo = (descrizione && descrizione.trim()) ? descrizione.trim() : (ean ? String(ean).trim() : '');
                    if (testo) {
                        componentLines.push(testo);
                    }
                }

                // Custom items (extra: HDD aggiuntivo, monitor, kit, ecc.)
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

                    if (name || value || ean) {
                        domCustomItems.push({ name, value, supplier, ean });
                    }
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
                        if (dbData && dbData.nome) {
                            itemDesc = dbData.nome;
                        }
                    }

                    const testoExtra = itemDesc || itemEan;
                    if (testoExtra) componentLines.push(testoExtra);
                }

                // Nome configurazione (dal badge in pagina, o dal salvato)
                const configBadge = document.querySelector(`.config-badge[data-order-id="${order.id}"], .order-card[data-order-id="${order.id}"] .config-badge`);
                const configName = (configBadge ? configBadge.textContent.trim() : (savedOrder?.configName || '')) || 'PC GAMING';

                // ---- Scrivo il blocco di questo ordine ----
                // Riga 1 del blocco: numero ordine (sx) + nome config (dx)
                const blockStartRow0 = excelData.length; // 0-based indice prima riga del blocco
                excelData.push([orderName, configName]);
                orderHeaderRowIndexes.push(blockStartRow0 + 1); // 1-based
                configNameRowIndexes.push(blockStartRow0 + 1);  // 1-based (nome config grassetto)

                // Righe successive: componenti numerati, solo colonna destra
                componentLines.forEach((line, i) => {
                    excelData.push(['', `${i + 1}. ${line}`]);
                });

                // Unisco la cella del numero ordine su tutta l'altezza del blocco
                const blockEndRow0 = excelData.length - 1;
                if (blockEndRow0 > blockStartRow0) {
                    merges.push({
                        s: { r: blockStartRow0, c: 0 },
                        e: { r: blockEndRow0, c: 0 }
                    });
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

        // Stili (NB: la versione community di SheetJS potrebbe non renderizzare i colori,
        // ma il grassetto e l'allineamento vengono comunque scritti nel file).
        const headerStyle = {
            font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 },
            fill: { patternType: 'solid', fgColor: { rgb: '404040' } },
            alignment: { vertical: 'center', horizontal: 'left' }
        };
        const orderNumberStyle = {
            font: { bold: true, sz: 12 },
            alignment: { vertical: 'top', horizontal: 'left' }
        };
        const configNameStyle = {
            font: { bold: true, sz: 11 },
            alignment: { vertical: 'top', horizontal: 'left' }
        };
        const componentStyle = {
            alignment: { vertical: 'top', horizontal: 'left', wrapText: true }
        };

        {
            const worksheetNumber = activeWorksheetNumber;
            const { excelData, orderHeaderRowIndexes, configNameRowIndexes, merges, ordersExported: worksheetExportedCount } = await createWorksheetPayload(
                ordersToExport,
                componentOrder,
                () => {
                    ordersDoneForProgress++;
                    updateExportProgress(ordersDoneForProgress);
                }
            );

            const ws = XLSX.utils.aoa_to_sheet(excelData);

            const setStyle = (rowIndex0, colIndex0, style) => {
                const addr = XLSX.utils.encode_cell({ r: rowIndex0, c: colIndex0 });
                if (!ws[addr]) return;
                ws[addr].s = { ...(ws[addr].s || {}), ...style };
            };

            // Intestazione (riga 0)
            setStyle(0, 0, headerStyle);
            setStyle(0, 1, headerStyle);

            // Numero ordine in grassetto
            for (const r1 of orderHeaderRowIndexes) setStyle(r1 - 1, 0, orderNumberStyle);
            // Nome config in grassetto
            for (const r1 of configNameRowIndexes) setStyle(r1 - 1, 1, configNameStyle);

            // Stile leggero su tutte le celle della colonna destra (wrap testo)
            for (let r = 1; r < excelData.length; r++) {
                const addr = XLSX.utils.encode_cell({ r, c: 1 });
                if (ws[addr] && !configNameRowIndexes.includes(r + 1)) {
                    ws[addr].s = { ...(ws[addr].s || {}), ...componentStyle };
                }
            }

            // Celle unite per la colonna numero ordine
            if (merges.length) {
                ws['!merges'] = merges;
            }

            ws['!cols'] = [
                { wch: 18 },  // NUMERO ORDINE
                { wch: 65 }   // CONFIGURAZIONE PC GAMING
            ];

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
    if (!rawEan || rawEan === 'INTEGRATA' || rawEan === 'GENERICO' || !isValidEAN(rawEan)) return null;
    const supplierHint = String(supplier || '').trim();
    const normalizedSupplier = (supplierHint && supplierHint !== 'SENZA FORNITORE' && supplierHint !== 'FORNITORE') ? supplierHint : '';
    const cacheKey = `${rawEan}::${normalizedSupplier}`;

    if (componentDataLookupCache.has(cacheKey)) {
        return componentDataLookupCache.get(cacheKey);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        let lookupUrl = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(rawEan)}`;
        if (normalizedSupplier) {
            lookupUrl += `&supplier=${encodeURIComponent(normalizedSupplier)}`;
        }

        const response = await fetch(lookupUrl, {
            signal: controller.signal
        });
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

        const invResponse = await fetch(`api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php?ean=${encodeURIComponent(rawEan)}`, {
            signal: controller2.signal
        });
        clearTimeout(timeoutId2);

        if (invResponse.ok) {
            const invData = await invResponse.json();
            if (invData.success && invData.item) {
                const resolved = {
                    nome: invData.item.name || '',
                    prezzo: '',
                    quantita: String(invData.item.quantity ?? ''),
                    fornitore: ''
                };
                componentDataLookupCache.set(cacheKey, resolved);
                return resolved;
            }
        }
    } catch (error) {

    }
    componentDataLookupCache.set(cacheKey, null);
    return null;
}




function initializeExportExcelButton() {
    const exportExcelBtn = document.getElementById('export-excel-btn');
    if (!exportExcelBtn) return;

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

console.log('✅ excel-export.js caricato (v28 - formato 2 colonne)');
