// ============================================================
// API ADAPTER v11 - Minimal Gamers
// Intercetta fetch verso endpoint PHP e li reindirizza a Supabase.
// ============================================================
const _originalFetch = window.fetch.bind(window);

window.fetch = async function(url, options = {}) {
    const urlStr = String(url || '');

    // Lascia passare tutto ciò che non è del nostro gateway
    if (!urlStr.includes('api_gateway') && !urlStr.includes('auth_module')) {
        return _originalFetch(url, options);
    }

    const method = (options.method || 'GET').toUpperCase();
    let body = null;
    if (options.body) {
        try { body = JSON.parse(options.body); } catch(e) { body = options.body; }
    }
    const params = (() => {
        try { return Object.fromEntries(new URL(urlStr, location.href).searchParams); }
        catch { return {}; }
    })();
    const ok = (data) => new Response(JSON.stringify(data), {
        status: 200, headers: { 'Content-Type': 'application/json' }
    });

    // Aspetta che Supabase sia pronto (max 5 sec)
    let attempts = 0;
    while ((!window.SupabaseDB || !window.SupabaseDB._ready) && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    const DB = window.SupabaseDB;
    if (!DB || !DB._ready) return ok({ success: false, error: 'DB non pronto' });

    try {
        // -------- AUTH --------
        if (urlStr.includes('auth_module')) {
            const v = await DB.verifyPassword(body?.password || '');
            return ok(v ? { success: true, api_key: body?.password } : { success: false, error: 'Password errata' });
        }

        // -------- CUSTOM ITEMS (DUE endpoint diversi con stesso nome!) --------
        // 1) processed_orders_service/api-custom-items.php  → voci custom per UN ordine
        // 2) components_service/api-custom-items.php        → catalogo articoli_aggiunti
        if (urlStr.includes('api-custom-items')) {
            const isOrderScoped = urlStr.includes('processed_orders_service');

            if (isOrderScoped) {
                // Voci custom legate a un ordine specifico
                if (method === 'GET') {
                    const orderId = params.orderId || params.order_id;
                    if (!orderId) return ok({ success: true, customItems: [] });
                    const items = await DB.getCustomItemsByOrder(orderId);
                    return ok({ success: true, customItems: items });
                }
                if (method === 'POST') {
                    const orderId = body?.orderId || body?.order_id;
                    const items = body?.customItems || [];
                    if (!orderId) return ok({ success: false, error: 'orderId mancante' });
                    if (items.length > 5) return ok({ success: false, error: 'Massimo 5 voci personalizzate' });
                    await DB.saveCustomItemsForOrder(orderId, items);
                    return ok({ success: true, message: 'Voci personalizzate salvate' });
                }
                if (method === 'DELETE') {
                    const orderId = params.orderId || params.order_id;
                    if (!orderId) return ok({ success: false, error: 'orderId mancante' });
                    const deleted = await DB.deleteCustomItemsForOrder(orderId);
                    return ok({ success: true, message: 'Voci personalizzate eliminate', deleted });
                }
                return ok({ success: true });
            } else {
                // Catalogo "articoli_aggiunti" (riutilizzabili)
                if (method === 'GET') {
                    const search = params.search || '';
                    const type = params.type || '';
                    const items = await DB.searchArticoliAggiunti(search, type);
                    return ok({ success: true, items, count: items.length });
                }
                if (method === 'POST') {
                    try {
                        const id = await DB.insertArticoloAggiunto(
                            body?.nome, body?.ean, body?.categoria, body?.fornitore, body?.prezzo
                        );
                        return ok({ success: true, message: 'Articolo aggiunto con successo', id });
                    } catch (e) {
                        return new Response(JSON.stringify({ success: false, error: e.message }), {
                            status: 400, headers: { 'Content-Type': 'application/json' }
                        });
                    }
                }
                if (method === 'DELETE') {
                    const id = params.id ? parseInt(params.id, 10) : null;
                    const ean = params.ean || null;
                    const affected = await DB.deleteArticoloAggiunto({ id, ean });
                    return ok({ success: true, message: 'Articolo eliminato', affected_rows: affected });
                }
                return ok({ success: true });
            }
        }

        // -------- PROCESSED ORDERS --------
        if (urlStr.includes('api-processed-orders')) {
            if (method === 'GET') {
                const id = params.id;
                const stato = params.stato;
                const all = await DB.getProcessedOrders();
                if (id) {
                    // GET singolo ordine
                    const order = all[id];
                    if (!order) return ok({ success: false, error: 'Ordine non trovato' });
                    return ok({ success: true, order });
                }
                // GET tutti (opzionale filtro stato)
                if (stato && (stato === 'elaborati' || stato === 'finalizzati')) {
                    const filtered = {};
                    Object.entries(all).forEach(([k, v]) => { if (v.stato === stato) filtered[k] = v; });
                    return ok({ success: true, orders: filtered });
                }
                return ok({ success: true, orders: all });
            }
            if (method === 'POST') {
                const id = body?.shopify_order_id || body?.shopifyOrderId;
                if (!id) return ok({ success: false, error: 'shopifyOrderId mancante' });
                const { shopifyOrderId, shopify_order_id, ...rest } = body || {};
                await DB.saveProcessedOrder(id, rest);
                return ok({ success: true, message: 'Ordine salvato' });
            }
            if (method === 'PUT') {
                const id = body?.shopify_order_id || body?.shopifyOrderId;
                if (!id) return ok({ success: false, error: 'shopifyOrderId mancante' });
                const { shopifyOrderId, shopify_order_id, ...rest } = body || {};
                await DB.updateProcessedOrder(id, rest);
                return ok({ success: true, message: 'Ordine aggiornato' });
            }
            if (method === 'PATCH') {
                // PATCH = aggiorna SINGOLO componente (PHP api-processed-orders.php PATCH)
                const id = body?.shopifyOrderId || body?.shopify_order_id;
                const cType = body?.componentType;
                const ean = body?.ean;
                if (!id || !cType || ean === undefined) {
                    return ok({ success: false, error: 'Parametri mancanti (shopifyOrderId, componentType, ean richiesti)' });
                }
                try {
                    const op = await DB.upsertSingleComponent(id, cType, ean, body?.productName, body?.supplier);
                    return ok({ success: true, message: op === 'update' ? 'Componente aggiornato' : 'Componente creato', operation: op });
                } catch (e) {
                    return ok({ success: false, error: e.message });
                }
            }
            if (method === 'DELETE') {
                const id = params.id || params.shopify_order_id;
                await DB.deleteProcessedOrder(id);
                return ok({ success: true, message: 'Ordine eliminato' });
            }
        }

        // -------- SHOPIFY ORDERS via Edge Function --------
        if (urlStr.includes('api-orders.php') && urlStr.includes('shopify_bridge')) {
            try {
                const edgeUrl = 'https://nulkachuhjdzohkzwvly.supabase.co/functions/v1/shopify-proxy';
                const r = await _originalFetch(edgeUrl);
                if (!r.ok) throw new Error(`Edge Function HTTP ${r.status}`);
                const d = await r.json();
                const orders = d.orders || (Array.isArray(d) ? d : []);
                console.log('✅ Ordini Shopify caricati:', orders.length);
                return ok(orders);
            } catch(e) {
                console.error('❌ Edge Function error:', e);
                return ok([]);
            }
        }

        if (urlStr.includes('api-shopify-orders')) {
            if (method === 'POST') { await DB.saveShopifyOrders(body.orders || []); return ok({ success: true }); }
            try {
                const edgeUrl = 'https://nulkachuhjdzohkzwvly.supabase.co/functions/v1/shopify-proxy';
                const r = await _originalFetch(edgeUrl);
                if (!r.ok) throw new Error(`Edge Function HTTP ${r.status}`);
                const d = await r.json();
                const orders = d.orders || (Array.isArray(d) ? d : []);
                const formatted = orders.map(o => ({ shopify_order_id: String(o.id), raw_order_data: o }));
                return ok({ success: true, orders: formatted });
            } catch(e) {
                console.error('❌ Errore caricamento ordini:', e);
                return ok({ success: true, orders: [] });
            }
        }

        // -------- ORDER STATUSES --------
        if (urlStr.includes('api-order-statuses')) {
            if (method === 'GET') return ok({ success: true, statuses: await DB.getOrderStatuses() });
            await DB.saveOrderStatus(body.orderId, body.status);
            return ok({ success: true });
        }

        // -------- OPERATOR ASSIGNMENTS --------
        if (urlStr.includes('api-operator-assignments')) {
            if (method === 'GET') return ok({ success: true, assignments: await DB.getOperatorAssignments() });
            if (method === 'DELETE') { await DB.deleteOperatorAssignment(params.id); return ok({ success: true }); }
            await DB.saveOperatorAssignment(body.orderId, body.operator);
            return ok({ success: true });
        }

        // -------- HIDDEN ORDERS --------
        if (urlStr.includes('api-hidden-orders')) {
            if (method === 'GET') return ok({ success: true, hiddenOrders: await DB.getHiddenOrders() });
            if (method === 'DELETE') { await DB.restoreHiddenOrder(params.id); return ok({ success: true }); }
            await DB.hideOrder(body.orderId);
            return ok({ success: true });
        }

        // -------- ORDERED IDS --------
        if (urlStr.includes('api-ordered-ids')) {
            if (method === 'GET') return ok({ success: true, orderedIds: await DB.getOrderedIds() });
            if (method === 'DELETE') { await DB.removeOrderedId(params.id); return ok({ success: true }); }
            await DB.addOrderedId(body.orderId);
            return ok({ success: true });
        }

        // -------- COMPONENTS (catalogo) --------
        if (urlStr.includes('api-components')) {
            if (params.ean) {
                const c = await DB.getComponentByEan(params.ean, params.supplier);
                return ok(c ? { success: true, component: c } : { success: false, error: 'Non trovato' });
            }
            return ok({ success: true, components: await DB.searchComponents(params.search || '', params.type || '') });
        }

        // -------- GPO MAPPING --------
        if (urlStr.includes('api-gpo-mapping')) {
            if (method === 'GET') return ok({ success: true, mappings: await DB.getGpoMappings() });
            if (method === 'POST') return ok({ success: true, id: await DB.saveGpoMapping(body) });
            if (method === 'PUT') { await DB.updateGpoMapping(body.id, body); return ok({ success: true }); }
            await DB.deleteGpoMapping(params.id);
            return ok({ success: true });
        }

        // -------- CUSTOM AMAZON COMPONENTS --------
        if (urlStr.includes('api-custom-components')) {
            if (method === 'GET') return ok({ success: true, components: await DB.getCustomAmazonComponents() });
            if (method === 'POST') return ok({ success: true, id: await DB.saveCustomAmazonComponent(body) });
            if (method === 'PUT') { await DB.updateCustomAmazonComponent(body.id, body); return ok({ success: true }); }
            await DB.deleteCustomAmazonComponent(params.id);
            return ok({ success: true });
        }

        // -------- STANDARD CONFIGS --------
        if (urlStr.includes('api-configs')) {
            if (method === 'GET') {
                const c = await DB.getConfigs();
                return ok({ success: true, configs: c, config: params.name ? c[params.name] : undefined });
            }
            if (method === 'DELETE') { await DB.deleteConfig(params.name); return ok({ success: true }); }
            await DB.saveConfig(body.config_name || body.new_config_name, { fullName: body.full_name, components: body.components });
            return ok({ success: true });
        }

        // -------- MONTHLY COUNTER --------
        if (urlStr.includes('api-monthly-counter')) {
            if (method === 'GET') return ok({ success: true, counter: await DB.getMonthlyCounter() });
            return ok({ success: true, counter: await DB.incrementMonthlyCounter(body?.increment || 1) });
        }

        // -------- INVENTORY --------
        if (urlStr.includes('api-inventory')) {
            if (method === 'GET') return ok({ success: true, inventory: await DB.getInventory() });
            if (method === 'DELETE') { await DB.deleteInventoryItem(params.ean); return ok({ success: true }); }
            await DB.saveInventoryItem(body.ean, body.name, body.quantity);
            return ok({ success: true });
        }

        // -------- MESSAGE TEMPLATES --------
        if (urlStr.includes('api-message-templates')) {
            if (method === 'GET') return ok({ success: true, config: await DB.getMessageTemplateConfig() });
            await DB.saveMessageTemplateConfig(body.config || body);
            return ok({ success: true });
        }

        // -------- SUPPLIER LOGS --------
        if (urlStr.includes('api-supplier-logs')) {
            if (method === 'GET') {
                const logs = await DB.getSupplierLogs();
                return ok({ success: true, logs, log: params.id ? logs.find(x => x.id == params.id) : undefined });
            }
            if (method === 'DELETE') { await DB.deleteSupplierLog(params.id); return ok({ success: true }); }
            return ok({ success: true, id: await DB.saveSupplierLog(body.orderIds || [], body.supplierData || {}) });
        }

        // Default: passa al fetch nativo (ma stiamo intercettando solo URL del gateway, quindi non dovrebbe succedere)
        return _originalFetch(url, options);
    } catch(e) {
        console.error('❌ Adapter error:', urlStr, e);
        return ok({ success: false, error: e.message });
    }
};

console.log('✅ API Adapter v11 attivo');
