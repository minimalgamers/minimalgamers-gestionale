















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
            const orderNumberRowIndexes = [];
            let ordersExported = 0;

            excelData.push(['Ordine', 'EAN', 'Descrizione', 'Titolo']);
            excelData.push(['', '', '', '']);

            for (const [orderName, order] of ordersForWorksheet) {
                if (ordersExported > 0) {
                    excelData.push(['', '', '', '']);
                    excelData.push(['', '', '', '']);
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
                                if (!fornitore && dbData.fornitore) fornitore = dbData.fornitore;
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
                                if (!fornitore && dbData.fornitore) fornitore = dbData.fornitore;
                            } else {
                                descrizione = comp.name || '';
                            }
                        }
                    }

                    const ordineCell = index === 0 ? orderName : '';

                    let titoloCell = '';
                    if (index === 0) {
                        const configBadge = document.querySelector(`.config-badge[data-order-id="${order.id}"], .order-card[data-order-id="${order.id}"] .config-badge`);
                        titoloCell = configBadge ? configBadge.textContent.trim() : (savedOrder?.configName || '');
                    }

                    const nextRowIndex = excelData.length + 1;
                    excelData.push([
                        ordineCell,
                        ean || (descrizione ? descrizione : ''),
                        descrizione,
                        titoloCell
                    ]);

                    if (ordineCell) orderNumberRowIndexes.push(nextRowIndex);
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

                    if (name || value || ean) {
                        domCustomItems.push({ name, value, supplier, ean });
                    }
                });

                const allCustomItems = [...customItems];
                for (const domItem of domCustomItems) {
                    const exists = customItems.some(item =>
                        String(item?.name || '') === String(domItem?.name || '') &&
                        String(item?.value || '') === String(domItem?.value || '') &&
                        String(item?.ean || '') === String(domItem?.ean || '')
                    );
                    if (!exists) allCustomItems.push(domItem);
                }

                const ssdAddonDom = domComponents['SSD ADDON'];
                let ssdAddonEan = String(ssdAddonDom?.ean || '').trim();
                let ssdAddonDesc = '';
                let ssdAddonSupplier = ssdAddonDom?.supplier || extractSupplierFromText(String(ssdAddonDom?.ean || '')) || '';

                if (!ssdAddonEan) {
                    const ssdAddon = allCustomItems.find(item => {
                        const nameLower = String(item?.name || '').toLowerCase();
                        const valueLower = String(item?.value || '').toLowerCase();

                        const explicitAddon =
                            nameLower.includes('ssd addon') ||
                            nameLower.includes('ssd add-on') ||
                            nameLower.includes('ssd aggiuntivo') ||
                            valueLower.includes('ssd addon') ||
                            valueLower.includes('ssd add-on') ||
                            valueLower.includes('ssd aggiuntivo');
                        if (explicitAddon) return true;

                        const comboAddon = (nameLower.includes('addon') || nameLower.includes('aggiunt')) &&
                                           (nameLower.includes('ssd') || valueLower.includes('ssd'));
                        const comboAddon2 = (valueLower.includes('addon') || valueLower.includes('aggiunt')) &&
                                            (valueLower.includes('ssd') || nameLower.includes('ssd'));

                        return comboAddon || comboAddon2;
                    });

                    ssdAddonEan = String(ssdAddon?.ean || '').trim();
                    if (ssdAddon?.value) ssdAddonDesc = ssdAddon.value;
                    else if (ssdAddon?.name) ssdAddonDesc = ssdAddon.name;
                    if (ssdAddon?.supplier) ssdAddonSupplier = ssdAddon.supplier;
                } else {
                    ssdAddonDesc = ssdAddonDom.name || '';
                }

                if (ssdAddonEan) {
                    const dbData = await getComponentDataFromDB(ssdAddonEan, ssdAddonSupplier);
                    if (dbData) {
                        ssdAddonDesc = dbData.nome || ssdAddonDesc;
                        if (!ssdAddonSupplier && dbData.fornitore) ssdAddonSupplier = dbData.fornitore;
                    }
                }

                if (!ssdAddonEan && !ssdAddonDesc) {
                    ssdAddonSupplier = '';
                }

                excelData.push(['', ssdAddonEan || '', ssdAddonDesc, '']);

                const monitorDom = domComponents['MONITOR'];
                let monitorEan = String(monitorDom?.ean || '').trim();
                let monitorDesc = '';
                let monitorSupplier = monitorDom?.supplier || extractSupplierFromText(String(monitorDom?.ean || '')) || '';

                if (!monitorEan || monitorEan === 'Generico') {
                    const monitor = allCustomItems.find(item => {
                        const nameLower = String(item?.name || '').toLowerCase();
                        const valueLower = String(item?.value || '').toLowerCase();
                        return nameLower.includes('monitor') || valueLower.includes('monitor');
                    });

                    if (monitor) {
                        monitorEan = String(monitor.ean || '').trim();
                        monitorDesc = monitor.value || monitor.name || '';
                        if (monitor?.supplier) monitorSupplier = monitor.supplier;
                    }
                } else {
                    monitorDesc = monitorDom.name || '';
                }

                if (monitorEan && monitorEan !== 'Generico') {
                    const dbData = await getComponentDataFromDB(monitorEan, monitorSupplier);
                    if (dbData) {
                        monitorDesc = dbData.nome || monitorDesc;
                        if (!monitorSupplier && dbData.fornitore) monitorSupplier = dbData.fornitore;
                    }
                }

                if ((!monitorEan || monitorEan === 'Generico') && !monitorDesc) {
                    monitorSupplier = '';
                }

                const monitorEanCell = monitorEan === 'Generico' ? '' : (monitorEan || '');
                excelData.push(['', monitorEanCell || (monitorDesc ? monitorDesc : ''), monitorDesc, '']);

                const otherCustomItems = allCustomItems.filter(item => {
                    const nameLower = String(item?.name || '').toLowerCase();
                    const valueLower = String(item?.value || '').toLowerCase();

                    if (!nameLower && !valueLower && !String(item?.ean || '')) return false;

                    return !nameLower.includes('ssd') && !valueLower.includes('ssd') &&
                           !nameLower.includes('monitor') && !valueLower.includes('monitor');
                });

                for (let i = 0; i < 5; i++) {
                    const item = otherCustomItems[i];
                    let itemEan = String(item?.ean || '').trim();
                    let itemDesc = '';
                    let itemSupplier = item?.supplier || '';

                    if (!itemSupplier) itemSupplier = extractSupplierFromText(String(item?.ean || '')) || '';

                    if (item) {
                        itemDesc = item.value || item.name || '';
                    }

                    if (itemEan) {
                        const dbData = await getComponentDataFromDB(itemEan, itemSupplier);
                        if (dbData) {
                            itemDesc = dbData.nome || itemDesc;
                            if (!itemSupplier && dbData.fornitore) itemSupplier = dbData.fornitore;
                        }
                    }

                    excelData.push(['', itemEan || (itemDesc ? itemDesc : ''), itemDesc, '']);
                }

                ordersExported++;
                onOrderExported();
            }

            return { excelData, orderNumberRowIndexes, ordersExported };
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
        const lightYellowFill = { fill: { patternType: 'solid', fgColor: { rgb: 'FFF9C4' } } };

        {
            const worksheetNumber = activeWorksheetNumber;
            const { excelData, orderNumberRowIndexes, ordersExported: worksheetExportedCount } = await createWorksheetPayload(
                ordersToExport,
                componentOrder,
                () => {
                    ordersDoneForProgress++;
                    updateExportProgress(ordersDoneForProgress);
                }
            );

            const ws = XLSX.utils.aoa_to_sheet(excelData);
            const applyFill = (rowIndex0, colIndex0) => {
                const addr = XLSX.utils.encode_cell({ r: rowIndex0, c: colIndex0 });
                if (!ws[addr]) return;
                ws[addr].s = { ...(ws[addr].s || {}), ...lightYellowFill };
            };

            for (let c = 0; c < 4; c++) applyFill(0, c);
            for (const r1 of orderNumberRowIndexes) applyFill(r1 - 1, 0);

            ws['!cols'] = [
                { wch: 18 },
                { wch: 18 },
                { wch: 60 },
                { wch: 40 }
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

console.log('✅ excel-export.js caricato');
