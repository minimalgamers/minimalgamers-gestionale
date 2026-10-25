
























// La stessa assegnazione viene usata dal percorso singolo e da quello multiplo.
// Ogni articolo conserva SKU, nome e quantità: tastiere e mouse non sono kit intercambiabili.
function shopifyItemQuantity(item) {
    return Math.max(0, parseInt(item?.current_quantity ?? item?.quantity ?? 1, 10) || 0);
}

function shopifyAccessoryType(item) {
    const name = String(item?.name || item?.title || '').toUpperCase();
    if (/^OPZIONI\b|PC GAMING/.test(name) || identifyPCConfig(name, true, item?.product_id ?? item?.productId)) return null;
    if (isMonitorLineItem(item)) return 'MONITOR';
    if (/\bKIT\b/.test(name)) return 'KIT GAMING';
    if (/TASTIERA|KEYBOARD/.test(name)) return 'TASTIERA';
    if (/\bMOUSE\b/.test(name)) return 'MOUSE';
    if (/CUFFIE|HEADSET|HEADPHONE/.test(name)) return 'CUFFIE';
    return null;
}

function shopifyAccessoryAssignments(order) {
    const pcs = [];
    for (const item of order?.line_items || []) {
        if (/^OPZIONI\b/i.test(item?.name || item?.title || '')) continue;
        if (!identifyPCConfig(item?.name || item?.title || '', true, item?.product_id ?? item?.productId) &&
            !/PC GAMING/i.test(item?.name || item?.title || '')) continue;
        for (let i = 0; i < shopifyItemQuantity(item); i++) pcs.push(item);
    }
    if (!pcs.length) return [];
    const assigned = pcs.map(() => []), counters = {};
    const props = item => ({ ...(item?.custom_properties || item?.customProperties || {}),
        ...Object.fromEntries((item?.properties || []).map(p => [p.name, p.value])) });
    for (const [lineIndex, item] of (order?.line_items || []).entries()) {
        const type = shopifyAccessoryType(item);
        if (!type) continue;
        const count = shopifyItemQuantity(item);
        const parent = props(item)._gpo_parent_product_group;
        const targets = pcs.map((pc, i) => !parent || props(pc)._gpo_product_group === parent ? i : -1).filter(i => i >= 0);
        if (!targets.length) continue; // collegamento esplicito sconosciuto: non indovinare un altro PC
        const key = `${type}|${parent || ''}`;
        for (let unit = 0; unit < count; unit++) {
            const index = targets[(counters[key] || 0) % targets.length];
            counters[key] = (counters[key] || 0) + 1;
            const lineId = String(item.id ?? `line-${lineIndex}`);
            let entry = assigned[index].find(c => c.sourceLineId === lineId);
            if (!entry) {
                const sku = String(item.sku || '').trim();
                const value = sku && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sku)
                    ? sku : String(item.name || item.title || type);
                entry = { type, value, ean: value, name: item.name || item.title || value,
                    supplier: item.supplier || null, quantity: 0, sourceLineId: lineId };
                assigned[index].push(entry);
            }
            entry.quantity++;
        }
    }
    return assigned;
}

function appendShopifyAccessories(components, order, pcIndex = 0) {
    for (const item of shopifyAccessoryAssignments(order)[pcIndex] || []) components.push({ ...item });
    return components;
}

// Piano di sola lettura: nessun ordine storico viene riscritto durante il ricalcolo.
function shopifyAccessoryRepairPlan(order, pcIndex, saved, verifiedExtras = null) {
    const expected = verifiedExtras || shopifyAccessoryAssignments(order)[pcIndex] || [];
    const hasAccessoryLines = (order?.line_items || []).some(item => shopifyAccessoryType(item));
    if ((!expected.length && !hasAccessoryLines) || saved.some(c => c.price != null && c.price !== '')) return null;
    const pcs = [];
    for (const item of order?.line_items || []) {
        if (/^OPZIONI\b/i.test(item.name || item.title || '')) continue;
        if (!identifyPCConfig(item.name || item.title || '', true, item.product_id ?? item.productId)) continue;
        for (let i = 0; i < shopifyItemQuantity(item); i++) pcs.push(item);
    }
    const item = pcs[pcIndex];
    const config = item && identifyPCConfig(item.name || item.title || '', true, item.product_id ?? item.productId);
    if (!config) return null;
    const types = ['MONITOR', 'KIT GAMING', 'TASTIERA', 'MOUSE', 'CUFFIE'];
    const externalCodes = new Set(expected.map(c => String(c.ean)));
    const desired = [];
    for (const base of config.components || []) {
        if (!types.includes(base.type)) continue;
        const present = saved.find(c => c.type === base.type && !externalCodes.has(String(c.ean)) && !c.isCustom && !c.is_custom);
        const value = String(base.value || base.ean || '');
        const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(value);
        desired.push(present ? { ...present, quantity: Math.max(1, Number(base.quantity) || 1) } : {
            type: base.type, ean: match ? match[1].trim() : value,
            name: base.type === 'MONITOR' && typeof getMonitorDisplayValue === 'function' ? getMonitorDisplayValue(item) : base.name || value,
            supplier: base.supplier || (match ? match[2].trim() : null), quantity: Math.max(1, Number(base.quantity) || 1), price: null
        });
    }
    for (const extra of expected) {
        const present = saved.find(c => c.ean === extra.ean);
        desired.push({ type: extra.type, ean: extra.ean, name: extra.name,
            supplier: present?.supplier || extra.supplier || null, quantity: extra.quantity, price: null });
    }
    const canonical = list => JSON.stringify(list.map(c => [c.type, c.ean || '', c.name || '', c.supplier || '', Number(c.quantity) || 1]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const previous = saved.filter(c => types.includes(c.type) && !c.isCustom && !c.is_custom);
    return { types, components: desired, previous, changed: canonical(previous) !== canonical(desired) };
}

function shopifyAccessorySummary(orderId, saved) {
    let order;
    const [base, n] = String(orderId).split('.');
    try { order = JSON.parse(sessionStorage.getItem('shopify_orders') || '[]').find(o => String(o.id) === base); } catch (e) { return ''; }
    if (!order) return '';
    const index = (Number(n) || 1) - 1;
    const extras = shopifyAccessoryAssignments(order)[index] || [];
    if (!extras.length) return '';
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const plan = shopifyAccessoryRepairPlan(order, index, saved);
    return '<div class="shopify-accessories-summary" style="margin:10px 0;padding:10px;border:1px solid rgba(128,128,128,.4);border-radius:8px;font-size:.85rem"><strong>Articoli acquistati su Shopify</strong>' +
        extras.map(c => `<div>${esc(c.type)}: ${esc(c.name)} ×${c.quantity} <small>(${esc(c.ean)})</small></div>`).join('') +
        (plan?.changed ? '<p role="status">Gli accessori salvati differiscono dall’ordine. «Aggiorna prezzi» mostra la rettifica da verificare prima di applicarla.</p>' : '') + '</div>';
}

function isKitGamingLineItem(itemName, productId = null) {
    const upperName = String(itemName || '').toUpperCase();
    return (upperName.includes('KIT') ||
            upperName.includes('TASTIERA') ||
            upperName.includes('MOUSE') ||
            upperName.includes('CUFFIE')) &&
           !upperName.includes('PC GAMING') &&
           identifyPCConfig(itemName, true, productId) === null;
}

function extractKitUnitsFromOrder(fullOrder) {
    const kitUnits = [];
    const items = fullOrder?.line_items || [];

    for (const item of items) {
        const itemName = item?.name || item?.title || '';
        if (!isKitGamingLineItem(itemName, item.product_id ?? item.productId)) continue;

        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        for (let index = 0; index < quantity; index++) {
            kitUnits.push(item);
        }
    }

    return kitUnits;
}

function isMonitorLineItem(item) {
    const itemName = item?.name || item?.title || '';
    const upperName = String(itemName || '').toUpperCase();
    const customProps = item?.custom_properties || item?.customProperties || {};
    const hasCustomProps = customProps && Object.keys(customProps).length > 0;
    const hasExplicitMonitor = upperName.includes('MONITOR');
    const hasMonitorKeyword = hasExplicitMonitor ||
        upperName.includes('DISPLAY') ||
        upperName.includes('SCHERMO');
    const nonMonitorHints = [
        'DISSIPAT', 'COOLER', 'AIO', 'LIQUID', 'CPU', 'GPU', 'RAM', 'SSD', 'NVME',
        'M.2', 'M2', 'ALIMENTAT', 'PSU', 'SCHEDA MADRE', 'MOBO', 'CASE', 'VENTOLA',
        'FAN', 'KIT', 'TASTIERA', 'MOUSE', 'CUFFIE'
    ];
    const hasNonMonitorHints = !hasExplicitMonitor && nonMonitorHints.some(hint => upperName.includes(hint));

    return hasMonitorKeyword &&
           !hasNonMonitorHints &&
           !upperName.includes('PC GAMING') &&
           identifyPCConfig(itemName, true, item.product_id ?? item.productId) === null;
}

function extractMonitorUnitsFromOrder(fullOrder) {
    const monitorUnits = [];
    const items = fullOrder?.line_items || [];

    for (const item of items) {
        if (!isMonitorLineItem(item)) continue;

        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        for (let index = 0; index < quantity; index++) {
            monitorUnits.push(item);
        }
    }

    return monitorUnits;
}

function applyKitGamingToComponents(finalComponents, kitItem, quantity = 1) {
    if (!kitItem || !Array.isArray(finalComponents)) return;

    const itemName = kitItem.name || kitItem.title || '';
    const itemSku = String(kitItem.sku || '').trim();
    const kitValue = itemSku || itemName;

    if (!kitValue) return;

    const kitIndex = finalComponents.findIndex(component => String(component.type || '').toUpperCase() === 'KIT GAMING');
    if (kitIndex !== -1) {
        finalComponents[kitIndex] = {
            type: finalComponents[kitIndex].type,
            value: kitValue,
            quantity: Math.max(1, parseInt(quantity, 10) || 1)
        };
        return;
    }

    finalComponents.push({
        type: 'KIT GAMING',
        value: kitValue,
        quantity: Math.max(1, parseInt(quantity, 10) || 1)
    });
}

function applyMonitorToComponents(finalComponents, monitorItem, quantity = 1) {
    if (!monitorItem || !Array.isArray(finalComponents)) return;

    const monitorIndex = finalComponents.findIndex(component => String(component.type || '').toUpperCase() === 'MONITOR');
    // v24: usa la funzione smart di app.js (caricato prima) per derivare label corretta
    // (es. MONITOR 24'' 180HZ - FULL HD da product_id o pattern [PC+MONITOR+KIT])
    const monitorValue = (typeof getMonitorDisplayValue === 'function')
        ? getMonitorDisplayValue(monitorItem)
        : 'Generico (AMAZON)';

    if (monitorIndex !== -1) {
        finalComponents[monitorIndex] = {
            type: finalComponents[monitorIndex].type,
            value: monitorValue,
            quantity: Math.max(1, parseInt(quantity, 10) || 1)
        };
        return;
    }

    finalComponents.push({
        type: 'MONITOR',
        value: monitorValue,
        quantity: Math.max(1, parseInt(quantity, 10) || 1)
    });
}

function updateSplitComponentIfExists(finalComponents, componentType, newValue, contextLabel = '') {
    const normalizedType = String(componentType || '').toUpperCase() === 'SSD AGGIUNTIVO'
        ? 'SSD ADDON'
        : String(componentType || '').toUpperCase();

    const componentIndex = finalComponents.findIndex(component =>
        String(component.type || '').toUpperCase() === normalizedType
    );

    if (componentIndex === -1) {
        if (normalizedType === 'SSD ADDON') {
            finalComponents.push({
                type: 'SSD ADDON',
                value: newValue
            });
            console.log(`ℹ️ Extra aggiunto (${contextLabel || 'split'}): SSD ADDON`);
            return true;
        }

        console.warn(`⚠️ Variante ignorata (${contextLabel || 'split'}): componente ${componentType} non presente nella configurazione standard`);
        return false;
    }

    finalComponents[componentIndex] = {
        type: finalComponents[componentIndex].type,
        value: newValue
    };
    return true;
}

function processPendingOrdersWithSplitting(pendingOrders, pendingOrdersMap, processedOrderIds) {
    pendingOrders.forEach(order => {
        const orderName = order.name || order.order_number;
        
        
        const pcItems = order.line_items?.filter(item => {
            const itemName = item.name || item.title || '';
            
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true, item.product_id ?? item.productId) !== null;
        }) || [];
        
        
        let totalPCs = 0;
        const pcConfigurations = [];
        
        for (const pcItem of pcItems) {
            const quantity = shopifyItemQuantity(pcItem);
            for (let i = 0; i < quantity; i++) {
                pcConfigurations.push(pcItem);
            }
            totalPCs += quantity;
        }
        
        
        if (totalPCs > 1) {
            console.log(`🔀 Sdoppiamento ordine ${orderName} in ${totalPCs} PC`, {
                orderId: order.id,
                processedOrderIds: processedOrderIds.filter(id => id.includes(String(order.id)))
            });
            
            pcConfigurations.forEach((pcItem, index) => {
                const pcNumber = index + 1;
                const suffix = `.${pcNumber}`;
                const splitOrderName = orderName + suffix;
                const splitOrderId = String(order.id) + suffix;
                
                
                const isAlreadyProcessed = processedOrderIds.includes(splitOrderId);
                
                console.log(`  ${splitOrderName}: ${isAlreadyProcessed ? '✅ già elaborato' : '⏳ da elaborare'}`);
                
                if (isAlreadyProcessed) {
                    return; 
                }
                
                pendingOrdersMap.set(splitOrderName, {
                    id: splitOrderId,
                    name: splitOrderName,
                    email: order.email || order.customer?.email || 'N/A',
                    phone: order.phone || order.customer?.phone || order.customer?.default_address?.phone || 'N/A',
                    createdAt: order.created_at,
                    financialStatus: order.financial_status,
                    fulfillmentStatus: order.fulfillment_status,
                    total: order.total_price || order.current_total_price,
                    currency: order.currency,
                    billingName: order.billing_address?.name || order.customer?.first_name + ' ' + order.customer?.last_name || 'N/A',
                    operator: getOperatorAssignment(order.id),
                        foglioDiLavoro: processedOrdersCache[order.id]?.foglioDiLavoro || 1,
                    originalOrderId: order.id, 
                    items: [{
                        name: pcItem.name || pcItem.title,
                        quantity: 1,
                        price: pcItem.price,
                        customProperties: pcItem.custom_properties || {}
                    }]
                });
            });
        } else {
            
            pendingOrdersMap.set(orderName, {
                id: order.id,
                name: orderName,
                email: order.email || order.customer?.email || 'N/A',
                phone: order.phone || order.customer?.phone || order.customer?.default_address?.phone || 'N/A',
                createdAt: order.created_at,
                financialStatus: order.financial_status,
                fulfillmentStatus: order.fulfillment_status,
                total: order.total_price || order.current_total_price,
                currency: order.currency,
                billingName: order.billing_address?.name || order.customer?.first_name + ' ' + order.customer?.last_name || 'N/A',
                operator: getOperatorAssignment(order.id),
                    foglioDiLavoro: processedOrdersCache[order.id]?.foglioDiLavoro || 1,
                items: (order.line_items || []).map(item => ({
                    name: item.name || item.title,
                    quantity: item.quantity,
                    price: item.price,
                    customProperties: item.custom_properties || {}
                }))
            });
        }
    });
}







async function processProcessedOrdersWithSplitting(processedOrders, processedOrdersMap, processedOrdersCache) {
    for (const order of processedOrders) {
        const orderName = order.name || order.order_number;
        const orderId = String(order.id);
        
        
        if (processedOrdersCache[order.id]?.stato === 'finalizzati') continue;
        
        
        const componentsFromDB = processedOrdersCache[order.id]?.components || [];
        
        
        const pcItems = order.line_items?.filter(item => {
            const itemName = item.name || item.title || '';
            
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true, item.product_id ?? item.productId) !== null;
        }) || [];
        
        let totalPCs = 0;
        pcItems.forEach(item => {
            totalPCs += (item.quantity || 1);
        });
        
        
        const hasSubOrders = Object.keys(processedOrdersCache).some(id => 
            id.startsWith(orderId + '.')
        );
        
        
        if (totalPCs > 1 && !hasSubOrders) {
            console.log(`🔄 Sdoppiamento retroattivo ordine ${orderId} con ${totalPCs} PC`);
            
            
            await deleteProcessedOrderFromDB(orderId);
            
            
            await processOrder(parseInt(orderId), true);
            
            continue; 
        }
        
        
        if (hasSubOrders) {
            continue;
        }
        
        
        processedOrdersMap.set(orderName, {
            id: order.id,
            name: orderName,
            email: order.email || order.customer?.email || 'N/A',
            phone: order.phone || order.customer?.phone || order.customer?.default_address?.phone || 'N/A',
            createdAt: order.created_at,
            financialStatus: order.financial_status,
            fulfillmentStatus: order.fulfillment_status,
            total: order.total_price || order.current_total_price,
            currency: order.currency,
            billingName: order.billing_address?.name || order.customer?.first_name + ' ' + order.customer?.last_name || 'N/A',
            operator: getOperatorAssignment(order.id),
            foglioDiLavoro: processedOrdersCache[order.id]?.foglioDiLavoro || 1,
            components: componentsFromDB,
            configName: processedOrdersCache[order.id]?.configName || null, 
            items: (order.line_items || []).map(item => ({
                name: item.name || item.title,
                quantity: item.quantity,
                customProperties: item.custom_properties || {}
            }))
        });
    }
}






function addSplitOrdersFromCache(processedOrdersCache, processedOrdersMap) {
    for (const [shopifyId, savedOrder] of Object.entries(processedOrdersCache)) {
        
        if (shopifyId.includes('.') && !shopifyId.startsWith('MANUAL_')) {
            
            if (savedOrder.stato === 'finalizzati') continue;
            
            
            const baseOrderName = savedOrder.orderIdFlip || shopifyId.split('.')[0];
            const suffix = shopifyId.substring(shopifyId.indexOf('.'));
            const orderName = baseOrderName + suffix; 
            
            console.log(`🔍 Tentativo aggiunta ordine sdoppiato: ${shopifyId} -> ${orderName}`, {
                exists: processedOrdersMap.has(orderName),
                mapSize: processedOrdersMap.size
            });
            
            
            if (!processedOrdersMap.has(orderName)) {
                processedOrdersMap.set(orderName, {
                    id: shopifyId,
                    name: orderName,
                    email: savedOrder.customerEmail || 'N/A',
                    phone: savedOrder.customerPhone || 'N/A',
                    createdAt: new Date().toISOString(),
                    financialStatus: 'paid',
                    fulfillmentStatus: null,
                    total: '0',
                    currency: 'EUR',
                    billingName: 'PC sdoppiato',
                    operator: savedOrder.operator || null,
                    foglioDiLavoro: savedOrder.foglioDiLavoro || 1,
                    components: savedOrder.components || [],
                    configName: savedOrder.configName || null, 
                    items: [{
                        name: savedOrder.pcItemName || ('PC GAMING ' + (savedOrder.configName || 'STANDARD')),
                        quantity: 1,
                        customProperties: savedOrder.customProperties || {}
                    }]
                });
                
                console.log(`✅ Ordine sdoppiato aggiunto: ${orderName}`);
            }
        }
    }
}







function addFinalizedSplitOrdersFromCache(processedOrdersCache, orderedOrdersMap) {
    for (const [shopifyId, savedOrder] of Object.entries(processedOrdersCache)) {
        if (!shopifyId.includes('.') || shopifyId.startsWith('MANUAL_')) continue;
        if (savedOrder.stato !== 'finalizzati') continue;

        const baseOrderName = savedOrder.orderIdFlip || shopifyId.split('.')[0];
        const suffix = shopifyId.substring(shopifyId.indexOf('.'));
        const orderName = baseOrderName + suffix;

        if (orderedOrdersMap.has(orderName)) continue;

        orderedOrdersMap.set(orderName, {
            id: shopifyId,
            name: orderName,
            email: savedOrder.customerEmail || 'N/A',
            phone: savedOrder.customerPhone || 'N/A',
            createdAt: new Date().toISOString(),
            financialStatus: 'paid',
            fulfillmentStatus: 'fulfilled',
            total: '0',
            currency: 'EUR',
            billingName: 'PC sdoppiato',
            operator: savedOrder.operator || null,
            foglioDiLavoro: savedOrder.foglioDiLavoro || 1,
            components: savedOrder.components || [],
            configName: savedOrder.configName || null,
            items: [{
                name: savedOrder.pcItemName || ('PC GAMING ' + (savedOrder.configName || 'STANDARD')),
                quantity: 1,
                customProperties: savedOrder.customProperties || {}
            }]
        });
    }
}










async function processSingleSplitPC(orderId, fullOrder, pcItemIndex, counters, skipReload = false, worksheetNumber = 1) {
    const foglioDiLavoro = Math.min(4, Math.max(1, parseInt(worksheetNumber, 10) || 1));
    
    const pcItems = fullOrder?.line_items?.filter(item => {
        const itemName = item.name || item.title || '';
        
        return itemName.toUpperCase().includes('PC GAMING') || 
               identifyPCConfig(itemName, false, item.product_id ?? item.productId) !== null;
    }) || [];
    
    if (pcItems.length === 0) {
        console.error(`❌ Nessun PC gaming trovato nell'ordine`);
        return false;
    }
    
    console.log(`🔄 Elaborazione PC sdoppiato: ${orderId}, indice: ${pcItemIndex}`);
    
    
    const allPCs = [];
    for (const pcItem of pcItems) {
        const quantity = shopifyItemQuantity(pcItem);
        for (let i = 0; i < quantity; i++) {
            allPCs.push(pcItem);
        }
    }
    
    console.log(`📦 Totale PC trovati: ${allPCs.length}`);
    
    
    const targetPcItem = allPCs[pcItemIndex];
    
    if (!targetPcItem) {
        console.error(`❌ PC con indice ${pcItemIndex} non trovato (totale: ${allPCs.length})`);
        return false;
    }
    
    console.log(`✅ PC target trovato: ${targetPcItem.name}`);
    
    // Antonio 03/10/2026: PC del configuratore = la lista dei pezzi scelti dal cliente (build-configuratore.js)
    const daConfiguratore = window.BuildConfiguratore
        ? await window.BuildConfiguratore.componenti(orderId, targetPcItem) : null;
    if (daConfiguratore && !daConfiguratore.ok) {
        if (typeof showNotification === 'function') showNotification(daConfiguratore.errore, 'error');
        return false;
    }
    
    const config = daConfiguratore ? null : identifyPCConfig(targetPcItem.name, false, targetPcItem.product_id ?? targetPcItem.productId);
    
    if (!config && !daConfiguratore) {
        console.error(`❌ Configurazione non trovata per: ${targetPcItem.name}`);
        return false;
    }
    
    console.log(`✅ Configurazione identificata: ${daConfiguratore ? daConfiguratore.configName : config.configKey}`);
    
    const assignedOperator = counters.countA <= counters.countB ? 'OperatoreA' : 'OperatoreB';
    
    let componentsToSave = daConfiguratore ? daConfiguratore.components : [];
    let configName = daConfiguratore ? daConfiguratore.configName : null;
    
    if (config) {
        configName = config.configKey;
        let finalComponents = JSON.parse(JSON.stringify(config.components));
        // v26: rimpiazzo MONITOR generico clonato dalla config con label smart
        try {
            const monitorIdx = finalComponents.findIndex(c => String(c.type || '').toUpperCase() === 'MONITOR');
            if (monitorIdx !== -1 && typeof getMonitorDisplayValue === 'function') {
                const smartValue = getMonitorDisplayValue(targetPcItem);
                if (smartValue && smartValue !== 'Generico (AMAZON)') {
                    console.log(`🖥️ [MONITOR v26 split] → "${smartValue}"`);
                    finalComponents[monitorIdx].value = smartValue;
                }
            }
        } catch (e) { console.warn('MONITOR v26 split fail:', e); }
        // v27: NOUA VITRA override per STRIKE/VEGA/VORTEX/bundle RTX 3050
        try {
            if (typeof applyVitraCaseOverride === 'function') {
                applyVitraCaseOverride(finalComponents, config.configKey, targetPcItem);
            }
        } catch (e) { console.warn('VITRA-OVERRIDE v27 split fail:', e); }
        // v29: PSU specifico se MOBO richiede doppio EPS ecc.
        try {
            if (typeof window.applyMoboPsuRules === 'function') {
                window.applyMoboPsuRules(finalComponents, targetPcItem, fullOrder);
            }
        } catch (e) { console.warn('MOBO-PSU v30 split fail:', e); }
        // v31: 10 config target → 80+ GOLD 850W
        try {
            if (typeof window.applyConfigPsuOverride === 'function') {
                window.applyConfigPsuOverride(finalComponents, config.configKey, targetPcItem);
            }
        } catch (e) { console.warn('CONFIG-PSU v31 split fail:', e); }
        const variants = targetPcItem.custom_properties || {};
        
        
        const normalVariants = [];
        const ramSsdVariants = [];
        
        for (const [key, value] of Object.entries(variants)) {
            if (['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name', 'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'].includes(key) || !value) continue;
            
            
            const splitResult = splitRAMandSSD(value);
            if (splitResult.ram && splitResult.ssd) {
                ramSsdVariants.push({ key, value, splitResult });
            } else {
                normalVariants.push({ key, value });
            }
        }
        
        
        for (const { key, value } of normalVariants) {
            const resolved = typeof resolveVariantTypeFromKeyAndValue === 'function'
                ? resolveVariantTypeFromKeyAndValue(key, value)
                : {
                    componentType: identifyComponentTypeFromValue(value),
                    gpoSearchType: identifyComponentTypeFromValue(value),
                    baseComponentType: identifyComponentTypeFromValue(value)
                };

            if (!resolved.componentType) continue;
            if (resolved.componentType === 'MONITOR' || resolved.componentType === 'KIT GAMING') continue;

            const componentIndex = finalComponents.findIndex(c =>
                c.type.toUpperCase() === String(resolved.baseComponentType).toUpperCase()
            );

            // v37: la scelta del cliente vince, tranne "MINIMAL CASE" (vale la regola)
            if (resolved.gpoSearchType === 'CASE' && /MINIMAL\s*CASE/i.test(String(value || ''))) {
                console.log(`🔒 [CASE-RULE v37] split: "${value}" → mantengo case da regola`);
                continue;
            }
            // v29/v31: preserva PSU TACENS 850W o 80+ GOLD 850W settato da regola
            if ((resolved.gpoSearchType === 'PSU' || resolved.gpoSearchType === 'ALIMENTATORE') && componentIndex !== -1) {
                const currentPsuValue = String(finalComponents[componentIndex].value || '');
                if (/TACENS|80\+?\s*GOLD\s*850W|DEEPCOOL/i.test(currentPsuValue)) {
                    console.log(`🔒 [PSU-LOCK v31] split: PSU "${currentPsuValue}" preservato`);
                    continue;
                }
            }

            const gpoMatch = findGpoMapping(resolved.gpoSearchType, value, config.configKey);
            const finalValue = gpoMatch
                ? (gpoMatch.supplier ? `${gpoMatch.ean} (${gpoMatch.supplier})` : gpoMatch.ean)
                : value;

            if (componentIndex !== -1) {
                finalComponents[componentIndex] = {
                    type: finalComponents[componentIndex].type,
                    value: finalValue
                };
            } else {
                updateSplitComponentIfExists(finalComponents, resolved.baseComponentType, finalValue, `split ${resolved.baseComponentType}`);
            }
        }
        
        
        for (const { value, splitResult } of ramSsdVariants) {
            const applyMappedValue = (type, mappedValue) => {
                if (!mappedValue) return;
                updateSplitComponentIfExists(finalComponents, type, mappedValue, `split ${type}`);
            };

            const ramGpoMatchComplete = findGpoMapping('RAM', value, config.configKey);
            const ssdGpoMatchComplete = findGpoMapping('SSD', value, config.configKey);

            let ramValue = null;
            if (ramGpoMatchComplete) {
                ramValue = ramGpoMatchComplete.supplier
                    ? `${ramGpoMatchComplete.ean} (${ramGpoMatchComplete.supplier})`
                    : ramGpoMatchComplete.ean;
            } else if (splitResult.ram) {
                const ramGpoMatch = findGpoMapping('RAM', splitResult.ram, config.configKey);
                ramValue = ramGpoMatch
                    ? (ramGpoMatch.supplier ? `${ramGpoMatch.ean} (${ramGpoMatch.supplier})` : ramGpoMatch.ean)
                    : splitResult.ram;
            }

            let ssdValue = null;
            if (ssdGpoMatchComplete) {
                ssdValue = ssdGpoMatchComplete.supplier
                    ? `${ssdGpoMatchComplete.ean} (${ssdGpoMatchComplete.supplier})`
                    : ssdGpoMatchComplete.ean;
            } else if (splitResult.ssd) {
                const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd, config.configKey);
                ssdValue = ssdGpoMatch
                    ? (ssdGpoMatch.supplier ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` : ssdGpoMatch.ean)
                    : splitResult.ssd;
            }

            applyMappedValue('RAM', ramValue);
            applyMappedValue('SSD', ssdValue);
        }

        // v34: conversione PSU -> Deepcool (ABACO) anche negli ordini sdoppiati
        try {
            if (typeof window.applySinnerGpuPsuRule === 'function') {
                window.applySinnerGpuPsuRule(finalComponents, config.configKey);
            }
        } catch (e) { console.warn('SINNER-GPU v35 split fail:', e); }
        try {
            if (typeof window.applyGpuPsuRule === 'function') {
                window.applyGpuPsuRule(finalComponents, config.configKey, targetPcItem);
            }
        } catch (e) { console.warn('GPU-PSU 26/09 split fail:', e); }
        try {
            if (typeof window.applyDeepcoolPsuMapping === 'function') {
                window.applyDeepcoolPsuMapping(finalComponents, config.configKey);
            }
        } catch (e) { console.warn('PSU-DEEPCOOL v34 split fail:', e); }
        try {
            if (typeof window.applyComponentNormalization === 'function') {
                window.applyComponentNormalization(finalComponents, config.configKey, targetPcItem, fullOrder);
            }
        } catch (e) { console.warn('NORM v35 split fail:', e); }

        appendShopifyAccessories(finalComponents, fullOrder, pcItemIndex);
        
        for (const comp of finalComponents) {
            const match = String(comp.value || comp.ean || '').match(/^(.*\S)\s*\(([^()]+)\)$/);
            let ean = comp.value || comp.ean;
            let supplier = comp.supplier || '';
            
            if (match) {
                ean = match[1].trim();
                if (!supplier) supplier = match[2].trim();
            }
            
            componentsToSave.push({
                type: comp.type,
                ean: ean,
                name: comp.name || null,
                supplier: supplier || null,
                price: null,
                quantity: Math.max(1, parseInt(comp.quantity, 10) || 1)
            });
        }
    }
    
    if (daConfiguratore) appendShopifyAccessories(componentsToSave, fullOrder, pcItemIndex);

    // Antonio 30/09: pezzi piu' convenienti di oggi con le regole di sempre (app.js, applicaPezziMigliori)
    // (PC del configuratore: i pezzi migliori sono gia' quelli della lista, stesso prodotto)
    if (!daConfiguratore && typeof window.applicaPezziMigliori === 'function') {
        await window.applicaPezziMigliori(componentsToSave, configName, targetPcItem, orderId);
    }
    
    const success = await saveProcessedOrderToDB(orderId, {
        orderIdFlip: fullOrder?.name || fullOrder?.order_number || null,
        operator: assignedOperator,
        configName: configName,
        pcItemName: targetPcItem.name,
        customProperties: targetPcItem.custom_properties || {},
        customerEmail: fullOrder?.email || fullOrder?.customer?.email || null,
        customerPhone: fullOrder?.phone || fullOrder?.customer?.phone || fullOrder?.customer?.default_address?.phone || null,
        foglioDiLavoro,
        components: componentsToSave
    });
    
    if (success) {
        await incrementMonthlyCounter(1);
        await saveOperatorAssignmentToDB(orderId, assignedOperator);
        
        if (!skipReload) {
            showNotification(`PC elaborato e assegnato a ${assignedOperator}`);
            setTimeout(() => {
                loadOrdersFromShopify();
            }, 500);
        }
    }
    
    return success;
}









async function processMultiPCOrder(orderId, fullOrder, counters, skipReload = false, worksheetNumber = 1) {
    const foglioDiLavoro = Math.min(4, Math.max(1, parseInt(worksheetNumber, 10) || 1));
    const pcItems = fullOrder?.line_items?.filter(item => {
        const itemName = item.name || item.title || '';
        return itemName.toUpperCase().includes('PC GAMING') || 
               identifyPCConfig(itemName, true, item.product_id ?? item.productId) !== null;
    }) || [];
    
    
    let totalPCs = 0;
    const pcConfigurations = [];
    
    for (const pcItem of pcItems) {
        const quantity = shopifyItemQuantity(pcItem);
        const config = identifyPCConfig(pcItem.name, false, pcItem.product_id ?? pcItem.productId);
        
        
        for (let i = 0; i < quantity; i++) {
            pcConfigurations.push({
                item: pcItem,
                config: config
            });
        }
        totalPCs += quantity;
    }
    
    let successCount = 0;
    
    for (let pcIndex = 0; pcIndex < pcConfigurations.length; pcIndex++) {
        const { item: pcItem, config } = pcConfigurations[pcIndex];
        const pcNumber = pcIndex + 1;
        const orderIdWithSuffix = `${orderId}.${pcNumber}`;
        
        
        const assignedOperator = (counters.countA + pcIndex) <= (counters.countB + pcIndex) ? 'OperatoreA' : 'OperatoreB';
        if (assignedOperator === 'OperatoreA') counters.countA++;
        else counters.countB++;
        
        // Antonio 03/10/2026: PC del configuratore = la lista dei pezzi scelti dal cliente (build-configuratore.js)
        const daConfiguratore = window.BuildConfiguratore
            ? await window.BuildConfiguratore.componenti(orderIdWithSuffix, pcItem) : null;
        if (daConfiguratore && !daConfiguratore.ok) {
            if (typeof showNotification === 'function') showNotification(`${orderIdWithSuffix}: ${daConfiguratore.errore}`, 'error');
            continue;
        }
        let componentsToSave = daConfiguratore ? daConfiguratore.components : [];
        let configName = daConfiguratore ? daConfiguratore.configName : null;
        
        if (config && !daConfiguratore) {
            configName = config.configKey;
            let finalComponents = JSON.parse(JSON.stringify(config.components));
            // v26: rimpiazzo MONITOR generico clonato dalla config con label smart
            try {
                const monitorIdx = finalComponents.findIndex(c => String(c.type || '').toUpperCase() === 'MONITOR');
                if (monitorIdx !== -1 && typeof getMonitorDisplayValue === 'function') {
                    const smartValue = getMonitorDisplayValue(pcItem);
                    if (smartValue && smartValue !== 'Generico (AMAZON)') {
                        console.log(`🖥️ [MONITOR v26 multi] → "${smartValue}"`);
                        finalComponents[monitorIdx].value = smartValue;
                    }
                }
            } catch (e) { console.warn('MONITOR v26 multi fail:', e); }
            // v27: NOUA VITRA override per STRIKE/VEGA/VORTEX/bundle RTX 3050
            try {
                if (typeof applyVitraCaseOverride === 'function') {
                    applyVitraCaseOverride(finalComponents, config.configKey, pcItem);
                }
            } catch (e) { console.warn('VITRA-OVERRIDE v27 multi fail:', e); }
            // v29: PSU specifico se MOBO richiede doppio EPS ecc.
            try {
                if (typeof window.applyMoboPsuRules === 'function') {
                    window.applyMoboPsuRules(finalComponents, pcItem, fullOrder);
                }
            } catch (e) { console.warn('MOBO-PSU v30 multi fail:', e); }
            // v31: 10 config target → 80+ GOLD 850W
            try {
                if (typeof window.applyConfigPsuOverride === 'function') {
                    window.applyConfigPsuOverride(finalComponents, config.configKey, pcItem);
                }
            } catch (e) { console.warn('CONFIG-PSU v31 multi fail:', e); }
            
            const variants = pcItem.custom_properties || {};
            
            
            const normalVariants = [];
            const ramSsdVariants = [];
            
            for (const [key, value] of Object.entries(variants)) {
                if (['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name', 'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'].includes(key) || !value) continue;
                
                
                const splitResult = splitRAMandSSD(value);
                if (splitResult.ram && splitResult.ssd) {
                    ramSsdVariants.push({ key, value, splitResult });
                } else {
                    normalVariants.push({ key, value });
                }
            }
            
            
            for (const { key, value } of normalVariants) {
                const resolved = typeof resolveVariantTypeFromKeyAndValue === 'function'
                    ? resolveVariantTypeFromKeyAndValue(key, value)
                    : {
                        componentType: identifyComponentTypeFromValue(value),
                        gpoSearchType: identifyComponentTypeFromValue(value),
                        baseComponentType: identifyComponentTypeFromValue(value)
                    };

                if (!resolved.componentType) continue;
                if (resolved.componentType === 'MONITOR' || resolved.componentType === 'KIT GAMING') continue;

                const componentIndex = finalComponents.findIndex(c =>
                    c.type.toUpperCase() === String(resolved.baseComponentType).toUpperCase()
                );

                // v37: la scelta del cliente vince, tranne "MINIMAL CASE" (vale la regola)
                if (resolved.gpoSearchType === 'CASE' && /MINIMAL\s*CASE/i.test(String(value || ''))) {
                    console.log(`🔒 [CASE-RULE v37] multiPC: "${value}" → mantengo case da regola`);
                    continue;
                }
                // v29/v31: preserva PSU TACENS 850W o 80+ GOLD 850W settato da regola
                if ((resolved.gpoSearchType === 'PSU' || resolved.gpoSearchType === 'ALIMENTATORE') && componentIndex !== -1) {
                    const currentPsuValue = String(finalComponents[componentIndex].value || '');
                    if (/TACENS|80\+?\s*GOLD\s*850W|DEEPCOOL/i.test(currentPsuValue)) {
                        console.log(`🔒 [PSU-LOCK v31] multiPC: PSU "${currentPsuValue}" preservato`);
                        continue;
                    }
                }

                const gpoMatch = findGpoMapping(resolved.gpoSearchType, value, config.configKey);
                const finalValue = gpoMatch
                    ? (gpoMatch.supplier ? `${gpoMatch.ean} (${gpoMatch.supplier})` : gpoMatch.ean)
                    : value;

                if (componentIndex !== -1) {
                    finalComponents[componentIndex] = {
                        type: finalComponents[componentIndex].type,
                        value: finalValue
                    };
                } else {
                    updateSplitComponentIfExists(finalComponents, resolved.baseComponentType, finalValue, `multiPC ${resolved.baseComponentType}`);
                }
            }
            
            
            for (const { value, splitResult } of ramSsdVariants) {
                const applyMappedValue = (type, mappedValue) => {
                    if (!mappedValue) return;
                    updateSplitComponentIfExists(finalComponents, type, mappedValue, `multiPC ${type}`);
                };

                const ramGpoMatchComplete = findGpoMapping('RAM', value, config.configKey);
                const ssdGpoMatchComplete = findGpoMapping('SSD', value, config.configKey);

                let ramValue = null;
                if (ramGpoMatchComplete) {
                    ramValue = ramGpoMatchComplete.supplier
                        ? `${ramGpoMatchComplete.ean} (${ramGpoMatchComplete.supplier})`
                        : ramGpoMatchComplete.ean;
                } else if (splitResult.ram) {
                    const ramGpoMatch = findGpoMapping('RAM', splitResult.ram, config.configKey);
                    ramValue = ramGpoMatch
                        ? (ramGpoMatch.supplier ? `${ramGpoMatch.ean} (${ramGpoMatch.supplier})` : ramGpoMatch.ean)
                        : splitResult.ram;
                }

                let ssdValue = null;
                if (ssdGpoMatchComplete) {
                    ssdValue = ssdGpoMatchComplete.supplier
                        ? `${ssdGpoMatchComplete.ean} (${ssdGpoMatchComplete.supplier})`
                        : ssdGpoMatchComplete.ean;
                } else if (splitResult.ssd) {
                    const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd, config.configKey);
                    ssdValue = ssdGpoMatch
                        ? (ssdGpoMatch.supplier ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` : ssdGpoMatch.ean)
                        : splitResult.ssd;
                }

                applyMappedValue('RAM', ramValue);
                applyMappedValue('SSD', ssdValue);
            }

            // v34: conversione PSU -> Deepcool (ABACO) per ogni PC sdoppiato
            try {
                if (typeof window.applySinnerGpuPsuRule === 'function') {
                    window.applySinnerGpuPsuRule(finalComponents, config.configKey);
                }
            } catch (e) { console.warn('SINNER-GPU v35 split-multi fail:', e); }
            try {
                if (typeof window.applyGpuPsuRule === 'function') {
                    window.applyGpuPsuRule(finalComponents, config.configKey, pcItem);
                }
            } catch (e) { console.warn('GPU-PSU 26/09 split-multi fail:', e); }
            try {
                if (typeof window.applyDeepcoolPsuMapping === 'function') {
                    window.applyDeepcoolPsuMapping(finalComponents, config.configKey);
                }
            } catch (e) { console.warn('PSU-DEEPCOOL v34 split-multi fail:', e); }
            try {
                if (typeof window.applyComponentNormalization === 'function') {
                    window.applyComponentNormalization(finalComponents, config.configKey, pcItem, fullOrder);
                }
            } catch (e) { console.warn('NORM v35 split-multi fail:', e); }

            appendShopifyAccessories(finalComponents, fullOrder, pcIndex);
            
            
            for (const comp of finalComponents) {
                const match = String(comp.value || comp.ean || '').match(/^(.*\S)\s*\(([^()]+)\)$/);
                let ean = comp.value || comp.ean;
                let supplier = comp.supplier || '';
                
                if (match) {
                    ean = match[1].trim();
                    if (!supplier) supplier = match[2].trim();
                }
                
                componentsToSave.push({
                    type: comp.type,
                    ean: ean,
                    name: comp.name || null,
                    supplier: supplier || null,
                    price: null,
                    quantity: Math.max(1, parseInt(comp.quantity, 10) || 1)
                });
            }
        }
        
        
    if (daConfiguratore) appendShopifyAccessories(componentsToSave, fullOrder, pcIndex);

        // Antonio 30/09: pezzi piu' convenienti di oggi con le regole di sempre (app.js, applicaPezziMigliori)
        if (!daConfiguratore && typeof window.applicaPezziMigliori === 'function') {
            await window.applicaPezziMigliori(componentsToSave, configName, pcItem, orderIdWithSuffix);
        }
        
        const success = await saveProcessedOrderToDB(orderIdWithSuffix, {
            orderIdFlip: fullOrder?.name || fullOrder?.order_number || null,
            operator: assignedOperator,
            configName: configName,
            pcItemName: pcItem.name,
            customProperties: pcItem.custom_properties || {},
            customerEmail: fullOrder?.email || fullOrder?.customer?.email || null,
            customerPhone: fullOrder?.phone || fullOrder?.customer?.phone || fullOrder?.customer?.default_address?.phone || null,
            foglioDiLavoro,
            components: componentsToSave
        });
        
        if (success) {
            successCount++;
            await saveOperatorAssignmentToDB(orderIdWithSuffix, assignedOperator);
        }
    }
    
    if (successCount > 0) {
        await incrementMonthlyCounter(successCount);
        
        if (!skipReload) {
            showNotification(`Ordine sdoppiato in ${successCount} PC elaborati`);
            setTimeout(() => {
                loadOrdersFromShopify();
            }, 500);
        }
    }
    
    return successCount;
}

console.log('✅ multi-order-handler.js caricato');
