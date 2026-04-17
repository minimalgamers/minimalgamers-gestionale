




const DEBUG_SUPPLIER = true;

function debugLog(...args) {
    if (DEBUG_SUPPLIER) {
        console.log('🔍 [SUPPLIER DEBUG]', ...args);
    }
}


const exportBtn = document.getElementById('export-btn');
let lastSupplierSummaryContext = null;

function getVisibleProcessedOrderIds() {
    return new Set(
        Array.from(document.querySelectorAll('#processed-container .order-card[data-order-id]'))
            .filter(card => {
                const style = window.getComputedStyle(card);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map(card => String(card.dataset.orderId).trim())
            .filter(Boolean)
    );
}

function getVisibleProcessedOrderNumbers() {
    return new Set(
        Array.from(document.querySelectorAll('#processed-container .order-card[data-order-id]'))
            .filter(card => {
                const style = window.getComputedStyle(card);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map(card => {
                const flipElement = card.querySelector('.order-id-flip');
                const orderLabel = flipElement ? flipElement.textContent : card.dataset.orderId;
                return String(orderLabel || '').replace('#', '').trim();
            })
            .filter(Boolean)
    );
}

exportBtn?.addEventListener('click', async () => {
    debugLog('Click sul pulsante export');

    const activeTab = document.querySelector('.tab-button.active');
    const activeTabName = activeTab ? activeTab.dataset.tab : 'orders';
    const summaryContext = isProcessedTab(activeTabName)
        ? {
            sourceTabName: activeTabName,
            visibleProcessedOrderIds: getVisibleProcessedOrderIds(),
            visibleProcessedOrderNumbers: getVisibleProcessedOrderNumbers()
        }
        : lastSupplierSummaryContext;

    lastSupplierSummaryContext = summaryContext;
    
    
    await closeAllOverlayPages(true);
    
    
    const suppliersTab = document.querySelector('[data-tab="suppliers"]');
    if (suppliersTab) {
        suppliersTab.click();
    }
    
    generateSupplierSummary(summaryContext);
});





async function generateSupplierSummary(context = null) {
    debugLog('=== INIZIO GENERAZIONE RIEPILOGO ===');

    const activeTab = document.querySelector('.tab-button.active');
    const activeTabName = activeTab ? activeTab.dataset.tab : 'orders';
    const resolvedContext = context || lastSupplierSummaryContext;
    const sourceTabName = isProcessedTab(activeTabName)
        ? activeTabName
        : resolvedContext?.sourceTabName;

    if (!isProcessedTab(sourceTabName)) {
        debugLog('Riepilogo fornitori disponibile solo nelle tab E1-E4');
        return;
    }

    const activeWorksheet = getWorksheetFromTab(sourceTabName);
    const visibleProcessedOrderIds = resolvedContext?.visibleProcessedOrderIds || getVisibleProcessedOrderIds();
    const visibleProcessedOrderNumbers = resolvedContext?.visibleProcessedOrderNumbers || getVisibleProcessedOrderNumbers();
    lastSupplierSummaryContext = {
        sourceTabName,
        visibleProcessedOrderIds,
        visibleProcessedOrderNumbers
    };

    debugLog(`Generazione riepilogo per tab ${sourceTabName} (E${activeWorksheet}) con`, visibleProcessedOrderIds.size, 'ordini visibili');
    
    
    await loadInventory();
    debugLog('Inventario caricato:', inventoryData.length, 'items');
    
    
    const warehouseStock = {};
    inventoryData.forEach(item => {
        warehouseStock[item.ean] = item.quantity;
    });
    debugLog('Magazzino:', Object.keys(warehouseStock).length, 'EAN distinti');
    
    
    const supplierData = {};
    const orderIdsFlip = new Set();
    
    
    const componentRequests = [];
    
    
    const allEanElements = document.querySelectorAll('.component-name-display');
    debugLog('Trovati', allEanElements.length, 'elementi component-name-display');
    
    allEanElements.forEach((element, index) => {
        const ean = element.dataset.ean?.trim();
        const componentType = element.dataset.componentType;
        const orderId = element.dataset.orderId;

        if (!orderId || !visibleProcessedOrderIds.has(String(orderId).trim())) {
            return;
        }
        
        if (index < 3) {
            debugLog(`Elemento ${index}:`, {
                ean,
                componentType,
                orderId,
                title: element.title,
                textContent: element.textContent.substring(0, 50)
            });
        }
        
        if (!ean || ean === 'Generico') return;
        
        
        if (componentType === 'GPU' && ean.toUpperCase() === 'INTEGRATA') {
            return;
        }
        
        
        let orderNumber = orderId;
        const orderCard = element.closest('.order-card');
        if (orderCard) {
            const flipElement = orderCard.querySelector('.order-id-flip');
            if (flipElement && flipElement.textContent) {
                orderNumber = flipElement.textContent.replace('#', '').trim();
                orderIdsFlip.add(orderNumber);
            }
        }
        
        
        let supplier = 'SENZA FORNITORE';
        const rowContainer = element.closest('div[style*="display: flex"][style*="justify-content: space-between"]');
        if (rowContainer) {
            const supplierSpan = rowContainer.querySelector('.supplier-badge-clickable');
            if (supplierSpan) {
                supplier = supplierSpan.dataset.supplier || supplierSpan.textContent.trim();
            }
        }
        
        
        let productName = null;
        if (element.title) {
            debugLog(`Title elemento ${index}:`, element.title);
            
            const titleParts = element.title.split('\n');
            if (titleParts.length > 0) {
                const firstLine = titleParts[0];
                if (firstLine.includes(': ')) {
                    const namePart = firstLine.split(': ');
                    if (namePart.length > 1) {
                        productName = namePart.slice(1).join(': ').trim();
                    }
                } else {
                    
                    productName = firstLine.trim();
                }
            }
        }
        
        
        if (!productName || productName === 'Caricamento...' || productName === '' || productName.startsWith('EAN:')) {
            const textContent = element.textContent.trim();
            if (textContent && textContent !== 'Caricamento...' && !textContent.startsWith('EAN:')) {
                productName = textContent;
            } else {
                productName = null; 
            }
        }
        
        if (index < 3) {
            debugLog(`Nome estratto per ${ean}:`, productName);
        }
        
        
        let normalizedComponentType = componentType;
        if (componentType === 'SSD AGGIUNTIVO') {
            normalizedComponentType = 'SSD';
        }
        
        componentRequests.push({
            ean,
            componentType: normalizedComponentType,
            supplier,
            name: productName,
            orderNumber: orderNumber
        });
    });
    
    debugLog('Raccolti', componentRequests.length, 'componenti da ordini elaborati');
    
    
    const customItems = document.querySelectorAll('.custom-item-row');
    debugLog('Trovate', customItems.length, 'voci personalizzate');
    
    customItems.forEach(item => {
        const supplier = item.dataset.supplier;
        const ean = item.dataset.ean;
        const itemName = item.querySelector('strong')?.textContent.replace(':', '').trim();
        
        if (!supplier || !ean) {
            return;
        }
        
        let orderNumber = '';
        const customItemsContainer = item.closest('[id^="custom-items-"]');
        if (customItemsContainer) {
            const orderId = customItemsContainer.id.replace('custom-items-', '');
            if (!visibleProcessedOrderIds.has(String(orderId).trim())) {
                return;
            }
            const orderCard = document.querySelector(`[data-order-id="${orderId}"]`);
            if (orderCard) {
                const flipElement = orderCard.querySelector('.order-id-flip');
                if (flipElement && flipElement.textContent) {
                    orderNumber = flipElement.textContent.replace('#', '').trim();
                    orderIdsFlip.add(orderNumber);
                }
            }
        }
        
        componentRequests.push({
            ean,
            componentType: itemName,
            supplier,
            name: null,
            orderNumber: orderNumber
        });
    });
    
    debugLog('Totale richieste componenti:', componentRequests.length);
    
    
    componentRequests.forEach((req, index) => {
        const { ean, componentType, supplier, name, orderNumber } = req;
        
        
        const stockAvailable = warehouseStock[ean] || 0;
        
        if (stockAvailable > 0) {
            
            warehouseStock[ean]--;
            
            
            if (!supplierData['MAGAZZINO']) {
                supplierData['MAGAZZINO'] = {};
            }
            
            const key = `${componentType}|${ean}`;
            if (!supplierData['MAGAZZINO'][key]) {
                supplierData['MAGAZZINO'][key] = {
                    count: 0,
                    componentType: componentType,
                    ean: ean,
                    name: name,
                    orders: []
                };
            }
            supplierData['MAGAZZINO'][key].count++;
            if (orderNumber && !supplierData['MAGAZZINO'][key].orders.includes(orderNumber)) {
                supplierData['MAGAZZINO'][key].orders.push(orderNumber);
            }
            
        } else {
            
            if (!supplierData[supplier]) {
                supplierData[supplier] = {};
            }
            
            const key = `${componentType}|${ean}`;
            if (!supplierData[supplier][key]) {
                supplierData[supplier][key] = {
                    count: 0,
                    componentType: componentType,
                    ean: ean,
                    name: name,
                    orders: []
                };
            }
            supplierData[supplier][key].count++;
            if (orderNumber && !supplierData[supplier][key].orders.includes(orderNumber)) {
                supplierData[supplier][key].orders.push(orderNumber);
            }
        }
        
        if (index < 3) {
            debugLog(`Componente ${index} processato:`, { ean, componentType, supplier, name });
        }
    });
    
    debugLog('Dati fornitori prima enrichment:', JSON.parse(JSON.stringify(supplierData)));
    
    
    if (supplierData['MAGAZZINO']) {
        debugLog('Aggiornamento magazzino...');
        
        for (const [key, item] of Object.entries(supplierData['MAGAZZINO'])) {
            const usedQuantity = item.count;
            
            
            const success = await updateInventoryQuantity(item.ean, -usedQuantity);
            
            if (success) {
                debugLog(`✅ Scalato ${usedQuantity} di ${item.ean}`);
            } else {
                console.error(`❌ Errore aggiornamento ${item.ean}`);
            }
        }
        
        showNotification(`📦 Magazzino aggiornato - ${Object.keys(supplierData['MAGAZZINO']).length} componenti scalati`);
    }
    
    
    saveSupplierLog(Array.from(visibleProcessedOrderNumbers), supplierData);
    
    
    debugLog('Inizio enrichment nomi...');
    await enrichMissingNames(supplierData);
    debugLog('Dati fornitori dopo enrichment:', JSON.parse(JSON.stringify(supplierData)));
    
    
    debugLog('Popolamento sezione fornitori...');
    populateSuppliersSection(supplierData);
    debugLog('=== FINE GENERAZIONE RIEPILOGO ===');
}




async function enrichMissingNames(supplierData) {
    const eansToLookup = [];
    
    
    for (const supplier of Object.keys(supplierData)) {
        for (const [key, item] of Object.entries(supplierData[supplier])) {
            
            const needsLookup = !item.name || 
                               item.name === 'Nome non disponibile' || 
                               item.name === 'N/A' || 
                               item.name === null || 
                               item.name === '' || 
                               item.name === 'Caricamento...' ||
                               item.name === item.ean; 
            
            if (needsLookup) {
                eansToLookup.push({ supplier, key, ean: item.ean });
            }
        }
    }
    
    if (eansToLookup.length === 0) {
        return;
    }

    const lookupCache = new Map();
    
    
    await Promise.all(eansToLookup.map(async (lookup) => {
        const supplierHint = lookup.supplier && lookup.supplier !== 'SENZA FORNITORE' ? String(lookup.supplier).trim() : '';
        const cacheKey = `${lookup.ean}::${supplierHint}`;

        if (!lookupCache.has(cacheKey)) {
            const promise = (async () => {
                try {
                    let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(lookup.ean)}`;
                    if (supplierHint) {
                        url += `&supplier=${encodeURIComponent(supplierHint)}`;
                    }
                    const response = await fetch(url);
                    const data = await response.json();
                    if (data.success && data.component && data.component.nome) {
                        return data.component.nome;
                    }
                } catch (error) {
                    console.error(`Errore ricerca ${lookup.ean}:`, error);
                }
                return lookup.ean;
            })();

            lookupCache.set(cacheKey, promise);
        }

        const resolvedName = await lookupCache.get(cacheKey);
        supplierData[lookup.supplier][lookup.key].name = resolvedName;
    }));
}




function populateSuppliersSection(supplierData) {
    debugLog('Popolamento UI con', Object.keys(supplierData).length, 'fornitori');
    
    const suppliersGrid = document.getElementById('suppliers-grid');
    const updateTimeSpan = document.getElementById('suppliers-update-time');
    
    if (!suppliersGrid) {
        console.error('❌ Container suppliers-grid non trovato');
        return;
    }
    
    
    if (updateTimeSpan) {
        updateTimeSpan.textContent = new Date().toLocaleString('it-IT');
    }
    
    
    if (Object.keys(supplierData).length === 0) {
        suppliersGrid.innerHTML = `
            <div class="suppliers-empty-state">
                <h2>📦 Nessun Componente</h2>
                <p>Non ci sono ordini elaborati al momento.</p>
                <p style="margin-top: 12px; font-size: 0.9em;">Elabora alcuni ordini per visualizzare il riepilogo fornitori.</p>
            </div>
        `;
        return;
    }
    
    
    const supplierOrder = ['MAGAZZINO', 'PROKS', 'OMEGA', 'TIER ONE', 'AMAZON', 'NOUA', 'NAVY BLUE', 'SENZA FORNITORE'];
    const sortedSuppliers = Object.keys(supplierData).sort((a, b) => {
        const indexA = supplierOrder.indexOf(a);
        const indexB = supplierOrder.indexOf(b);
        if (indexA === -1 && indexB === -1) return a.localeCompare(b);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });
    
    debugLog('Fornitori ordinati:', sortedSuppliers);
    
    
    let html = '';
    
    sortedSuppliers.forEach(supplier => {
        const items = supplierData[supplier];
        const itemsArray = Object.values(items);
        const totalItems = itemsArray.reduce((sum, item) => sum + item.count, 0);
        
        debugLog(`Fornitore ${supplier}: ${Object.keys(items).length} items distinti, ${totalItems} pezzi totali`);
        
        const supplierClass = supplier.replace(/\s+/g, '-').toUpperCase();
        
        
        let supplierColor = '#95a5a6';
        if (supplier === 'MAGAZZINO') supplierColor = '#1abc9c';
        else if (supplier === 'PROKS') supplierColor = '#e74c3c';
        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        else if (supplier === 'MSI') supplierColor = '#d35400';
        else if (supplier === 'CASEKING') supplierColor = '#16a085';
        else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
        
        html += `
        <div class="supplier-card">
            <div class="supplier-header ${supplierClass}">
                <span>${supplier}</span>
                <span class="supplier-count">${totalItems} pz</span>
            </div>
            <div class="supplier-items-list">
        `;
        
        
        const sortedItems = Object.entries(items).sort((a, b) => {
            const typeA = a[1].componentType;
            const typeB = b[1].componentType;
            if (typeA !== typeB) return typeA.localeCompare(typeB);
            return a[1].ean.localeCompare(b[1].ean);
        });
        
        sortedItems.forEach(([key, item], itemIndex) => {
            if (itemIndex < 2) {
                debugLog(`  Item ${itemIndex}: ${item.componentType} - ${item.ean} - Nome: "${item.name}"`);
            }
            
            
            const ordersArray = item.orders || [];
            const ordersText = ordersArray.length > 0 
                ? ordersArray.map(o => '#' + o).join(', ')
                : 'Nessun ordine';
            const ordersTooltip = ordersArray.length > 0 
                ? `Usato in: ${ordersText}` 
                : '';
            
            const displayName = item.name || 'Nome non disponibile';
            
            html += `
                <div class="supplier-item" data-quantity="${item.count}" data-ean="${item.ean}" data-name="${displayName}" data-orders="${ordersArray.join(',')}">
                    <div class="supplier-item-header">
                        <span class="supplier-item-quantity" style="background: ${supplierColor}; box-shadow: 0 2px 8px ${supplierColor}40;">x${item.count}</span>
                        <div class="supplier-item-type" style="color: ${supplierColor}; text-shadow: 0 1px 4px ${supplierColor}40;">${item.componentType}</div>
                        <div class="supplier-item-ean" title="${ordersTooltip}" style="cursor: ${ordersArray.length > 0 ? 'help' : 'default'}; position: relative;">${item.ean}
                            ${ordersArray.length > 0 ? `<span class="orders-badge" style="margin-left: 6px; background: rgba(52, 152, 219, 0.3); color: #3498db; font-size: 0.7em; padding: 2px 5px; border-radius: 4px; font-weight: 600;">${ordersArray.map(o => '#' + o).join(' ')}</span>` : ''}
                        </div>
                    </div>
                    <div class="supplier-item-name" style="color: rgba(255, 255, 255, 0.95); font-size: 0.9em; font-weight: 500; line-height: 1.4; width: 100%; padding-left: 0; margin-top: 4px;">${displayName}</div>
                </div>
            `;
        });
        
        html += `
            </div>
            <div class="supplier-card-footer">
                <button class="copy-supplier-btn" data-supplier="${supplier}" style="width: 100%; background: rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.3); color: white; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; font-size: 0.9em;" onmouseover="this.style.background='rgba(255, 255, 255, 0.25)'; this.style.transform='translateY(-2px)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.15)'; this.style.transform=''">📋 Copia</button>
            </div>
        </div>
        `;
    });
    
    suppliersGrid.innerHTML = html;
    debugLog('HTML inserito nel DOM');
    
    
    document.querySelectorAll('.copy-supplier-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const supplier = btn.dataset.supplier;
            const supplierCard = btn.closest('.supplier-card');
            const items = supplierCard.querySelectorAll('.supplier-item');
            
            let copyText = '';
            items.forEach(item => {
                const quantity = item.dataset.quantity;
                const ean = item.dataset.ean;
                const name = item.dataset.name;
                
                
                copyText += `x${quantity} | ${ean} - ${name}\n`;
            });
            
            
            navigator.clipboard.writeText(copyText.trim()).then(() => {
                showNotification('✅ Dati copiati in clipboard');
            }).catch(err => {
                console.error('Errore copia clipboard:', err);
                showNotification('❌ Errore durante la copia');
            });
        });
    });
    
    
    const generateBtn = document.getElementById('generate-orders-btn');
    if (generateBtn && Object.keys(supplierData).length > 0) {
        generateBtn.style.display = 'block';
    }
    
    
    window.currentSupplierData = supplierData;
    
    debugLog('Popolamento UI completato');
}





const generateOrdersBtn = document.getElementById('generate-orders-btn');

generateOrdersBtn?.addEventListener('click', async () => {
    if (!window.currentSupplierData) {
        alert('Nessun dato disponibile. Aggiorna prima i dati dei fornitori.');
        return;
    }
    
    await generateSupplierPDFs(window.currentSupplierData);
});

async function generateSupplierPDFs(supplierData) {
    debugLog('Generazione PDF per', Object.keys(supplierData).length, 'fornitori');
    
    
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    
    let orderNumber = 1;
    const sortedSuppliers = Object.keys(supplierData).sort();
    
    
    for (const supplier of sortedSuppliers) {
        const items = supplierData[supplier];
        const fileName = `${dateStr}-${supplier.replace(/\s+/g, '-')}-${String(orderNumber).padStart(3, '0')}`;
        
        await generateAndDownloadSupplierPDF(supplier, items, fileName);
        
        orderNumber++;
        
        
        await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    showNotification(`${sortedSuppliers.length} PDF generati e scaricati`);
}

async function generateAndDownloadSupplierPDF(supplier, items, fileName) {
    const itemsArray = Object.values(items);
    const totalItems = itemsArray.reduce((sum, item) => sum + item.count, 0);
    
    
    const sortedItems = Object.entries(items).sort((a, b) => {
        const typeA = a[1].componentType;
        const typeB = b[1].componentType;
        if (typeA !== typeB) return typeA.localeCompare(typeB);
        return a[1].ean.localeCompare(b[1].ean);
    });
    
    
    let supplierColor = [149, 165, 166]; 
    if (supplier === 'PROKS') supplierColor = [231, 76, 60];
    else if (supplier === 'OMEGA') supplierColor = [155, 89, 182];
    else if (supplier === 'TIER ONE') supplierColor = [52, 152, 219];
    else if (supplier === 'AMAZON') supplierColor = [243, 156, 18];
    else if (supplier === 'NOUA') supplierColor = [46, 204, 113];
    else if (supplier === 'INTEGRATA') supplierColor = [127, 140, 141];
    else if (supplier === 'MSI') supplierColor = [211, 84, 0];
    else if (supplier === 'CASEKING') supplierColor = [22, 160, 133];
    
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('it-IT');
    
    
    doc.setFillColor(supplierColor[0], supplierColor[1], supplierColor[2]);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(`ORDINE ${supplier}`, 105, 20, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(dateStr, 105, 28, { align: 'center' });
    doc.text(timeStr, 105, 34, { align: 'center' });
    
    
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(15, 45, 180, 25, 3, 3, 'F');
    
    doc.setDrawColor(supplierColor[0], supplierColor[1], supplierColor[2]);
    doc.setLineWidth(2);
    doc.line(15, 45, 15, 70);
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Fornitore:', 20, 52);
    doc.setFont('helvetica', 'normal');
    doc.text(supplier, 60, 52);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Totale Componenti:', 20, 60);
    doc.setFont('helvetica', 'normal');
    doc.text(`${totalItems} pezzi`, 60, 60);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Righe Ordine:', 20, 68);
    doc.setFont('helvetica', 'normal');
    doc.text(`${sortedItems.length}`, 60, 68);
    
    
    const tableData = await Promise.all(sortedItems.map(async ([key, item]) => {
        let nome = item.name || item.ean;
        
        
        if (nome === item.ean) {
            try {
                let url = 'api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=' + encodeURIComponent(item.ean);
                if (supplier && supplier !== 'SENZA FORNITORE') {
                    url += '&supplier=' + encodeURIComponent(supplier);
                }
                const response = await fetch(url);
                const data = await response.json();
                if (data.success && data.component && data.component.nome) {
                    nome = data.component.nome;
                }
            } catch (error) {
                
            }
        }
        
        return [
            `x${item.count}`,
            item.componentType,
            item.ean,
            nome
        ];
    }));
    
    
    doc.autoTable({
        startY: 78,
        head: [['QTÀ', 'TIPO', 'EAN', 'NOME COMPONENTE']],
        body: tableData,
        theme: 'grid',
        headStyles: {
            fillColor: supplierColor,
            textColor: [255, 255, 255],
            fontSize: 11,
            fontStyle: 'bold',
            halign: 'left'
        },
        columnStyles: {
            0: { cellWidth: 20, halign: 'center', fontStyle: 'bold', textColor: supplierColor },
            1: { cellWidth: 30, fontStyle: 'bold' },
            2: { cellWidth: 50, font: 'courier' },
            3: { cellWidth: 'auto' }
        },
        styles: {
            fontSize: 10,
            cellPadding: 4
        },
        alternateRowStyles: {
            fillColor: [248, 249, 250]
        }
    });
    
    
    const finalY = doc.lastAutoTable.finalY + 15;
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text('Ordine generato automaticamente dal sistema Minimal Gamers', 105, finalY, { align: 'center' });
    doc.text('Per assistenza contattare l\'amministrazione', 105, finalY + 5, { align: 'center' });
    
    
    doc.save(`${fileName}.pdf`);
}

debugLog('File supplier-summary.js caricato');
