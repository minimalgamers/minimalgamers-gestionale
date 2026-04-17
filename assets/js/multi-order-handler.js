
























function isKitGamingLineItem(itemName) {
    const upperName = String(itemName || '').toUpperCase();
    return (upperName.includes('KIT') ||
            upperName.includes('TASTIERA') ||
            upperName.includes('MOUSE') ||
            upperName.includes('CUFFIE')) &&
           !upperName.includes('PC GAMING') &&
           identifyPCConfig(itemName, true) === null;
}

function extractKitUnitsFromOrder(fullOrder) {
    const kitUnits = [];
    const items = fullOrder?.line_items || [];

    for (const item of items) {
        const itemName = item?.name || item?.title || '';
        if (!isKitGamingLineItem(itemName)) continue;

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
           !hasCustomProps &&
           !upperName.includes('PC GAMING') &&
           identifyPCConfig(itemName, true) === null;
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
    const monitorValue = 'Generico (AMAZON)';

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
                   identifyPCConfig(itemName, true) !== null;
        }) || [];
        
        
        let totalPCs = 0;
        const pcConfigurations = [];
        
        for (const pcItem of pcItems) {
            const quantity = pcItem.quantity || 1;
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
                   identifyPCConfig(itemName, true) !== null;
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
               identifyPCConfig(itemName) !== null;
    }) || [];
    
    if (pcItems.length === 0) {
        console.error(`❌ Nessun PC gaming trovato nell'ordine`);
        return false;
    }
    
    console.log(`🔄 Elaborazione PC sdoppiato: ${orderId}, indice: ${pcItemIndex}`);
    
    
    const allPCs = [];
    for (const pcItem of pcItems) {
        const quantity = pcItem.quantity || 1;
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
    
    
    const config = identifyPCConfig(targetPcItem.name);
    
    if (!config) {
        console.error(`❌ Configurazione non trovata per: ${targetPcItem.name}`);
        return false;
    }
    
    console.log(`✅ Configurazione identificata: ${config.configKey}`);
    
    const assignedOperator = counters.countA <= counters.countB ? 'OperatoreA' : 'OperatoreB';
    
    let componentsToSave = [];
    let configName = null;
    
    if (config) {
        configName = config.configKey;
        let finalComponents = JSON.parse(JSON.stringify(config.components));
        const variants = targetPcItem.custom_properties || {};
        const kitUnits = extractKitUnitsFromOrder(fullOrder);
        const monitorUnits = extractMonitorUnitsFromOrder(fullOrder);
        
        
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

            const gpoMatch = findGpoMapping(resolved.gpoSearchType, value);
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

            const ramGpoMatchComplete = findGpoMapping('RAM', value);
            const ssdGpoMatchComplete = findGpoMapping('SSD', value);

            let ramValue = null;
            if (ramGpoMatchComplete) {
                ramValue = ramGpoMatchComplete.supplier
                    ? `${ramGpoMatchComplete.ean} (${ramGpoMatchComplete.supplier})`
                    : ramGpoMatchComplete.ean;
            } else if (splitResult.ram) {
                const ramGpoMatch = findGpoMapping('RAM', splitResult.ram);
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
                const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd);
                ssdValue = ssdGpoMatch
                    ? (ssdGpoMatch.supplier ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` : ssdGpoMatch.ean)
                    : splitResult.ssd;
            }

            applyMappedValue('RAM', ramValue);
            applyMappedValue('SSD', ssdValue);
        }

        if (kitUnits.length > 0) {
            applyKitGamingToComponents(finalComponents, kitUnits[0], kitUnits.length);
        }

        if (monitorUnits.length > 0) {
            applyMonitorToComponents(finalComponents, monitorUnits[0], monitorUnits.length);
        }
        
        for (const comp of finalComponents) {
            const match = comp.value.match(/^(.+?)\s*\((.+?)\)$/);
            let ean = comp.value;
            let supplier = '';
            
            if (match) {
                ean = match[1].trim();
                supplier = match[2].trim();
            }
            
            componentsToSave.push({
                type: comp.type,
                ean: ean,
                name: null,
                supplier: supplier || null,
                price: null,
                quantity: Math.max(1, parseInt(comp.quantity, 10) || 1)
            });
        }
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
               identifyPCConfig(itemName, true) !== null;
    }) || [];
    
    
    let totalPCs = 0;
    const pcConfigurations = [];
    
    for (const pcItem of pcItems) {
        const quantity = pcItem.quantity || 1;
        const config = identifyPCConfig(pcItem.name);
        
        
        for (let i = 0; i < quantity; i++) {
            pcConfigurations.push({
                item: pcItem,
                config: config
            });
        }
        totalPCs += quantity;
    }
    
    let successCount = 0;
    const kitUnits = extractKitUnitsFromOrder(fullOrder);
    const monitorUnits = extractMonitorUnitsFromOrder(fullOrder);
    
    for (let pcIndex = 0; pcIndex < pcConfigurations.length; pcIndex++) {
        const { item: pcItem, config } = pcConfigurations[pcIndex];
        const pcNumber = pcIndex + 1;
        const orderIdWithSuffix = `${orderId}.${pcNumber}`;
        
        
        const assignedOperator = (counters.countA + pcIndex) <= (counters.countB + pcIndex) ? 'OperatoreA' : 'OperatoreB';
        if (assignedOperator === 'OperatoreA') counters.countA++;
        else counters.countB++;
        
        let componentsToSave = [];
        let configName = null;
        
        if (config) {
            configName = config.configKey;
            let finalComponents = JSON.parse(JSON.stringify(config.components));
            
            
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

                const gpoMatch = findGpoMapping(resolved.gpoSearchType, value);
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

                const ramGpoMatchComplete = findGpoMapping('RAM', value);
                const ssdGpoMatchComplete = findGpoMapping('SSD', value);

                let ramValue = null;
                if (ramGpoMatchComplete) {
                    ramValue = ramGpoMatchComplete.supplier
                        ? `${ramGpoMatchComplete.ean} (${ramGpoMatchComplete.supplier})`
                        : ramGpoMatchComplete.ean;
                } else if (splitResult.ram) {
                    const ramGpoMatch = findGpoMapping('RAM', splitResult.ram);
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
                    const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd);
                    ssdValue = ssdGpoMatch
                        ? (ssdGpoMatch.supplier ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` : ssdGpoMatch.ean)
                        : splitResult.ssd;
                }

                applyMappedValue('RAM', ramValue);
                applyMappedValue('SSD', ssdValue);
            }

            const kitForCurrentPc = kitUnits[pcIndex] || null;
            if (kitForCurrentPc) {
                applyKitGamingToComponents(finalComponents, kitForCurrentPc, 1);
            }

            const monitorForCurrentPc = monitorUnits[pcIndex] || null;
            if (monitorForCurrentPc) {
                applyMonitorToComponents(finalComponents, monitorForCurrentPc, 1);
            }
            
            
            for (const comp of finalComponents) {
                const match = comp.value.match(/^(.+?)\s*\((.+?)\)$/);
                let ean = comp.value;
                let supplier = '';
                
                if (match) {
                    ean = match[1].trim();
                    supplier = match[2].trim();
                }
                
                componentsToSave.push({
                    type: comp.type,
                    ean: ean,
                    name: null,
                    supplier: supplier || null,
                    price: null,
                    quantity: Math.max(1, parseInt(comp.quantity, 10) || 1)
                });
            }
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
