// API ADAPTER - Supabase per Minimal Gamers
const _originalFetch = window.fetch.bind(window);
window.fetch = async function(url, options = {}) {
    const urlStr = String(url || '');
    if (!urlStr.includes('api_gateway') && !urlStr.includes('auth_module')) return _originalFetch(url, options);
    const method = (options.method || 'GET').toUpperCase();
    let body = null;
    if (options.body) { try { body = JSON.parse(options.body); } catch(e) { body = options.body; } }
    const params = (() => { try { return Object.fromEntries(new URL(urlStr, location.href).searchParams); } catch { return {}; } })();
    const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const DB = window.SupabaseDB;
    if (!DB) return ok({ success: false, error: 'DB non pronto' });
    try {
        if (urlStr.includes('auth_module')) { const v = await DB.verifyPassword(body?.password||''); return ok(v ? {success:true,api_key:body?.password} : {success:false,error:'Password errata'}); }
        if (urlStr.includes('api-processed-orders')) {
            if (method==='GET') return ok({success:true, orders: await DB.getProcessedOrders()});
            if (method==='POST') { await DB.saveProcessedOrder(body.shopify_order_id, body); return ok({success:true}); }
            if (method==='PUT'||method==='PATCH') { const id=body.shopify_order_id||body.shopifyOrderId; const u={}; if(body.stato!==undefined)u.stato=body.stato; if(body.operator!==undefined)u.operator=body.operator; if(body.foglio_di_lavoro!==undefined)u.foglio_di_lavoro=body.foglio_di_lavoro; if(body.foglioDiLavoro!==undefined)u.foglio_di_lavoro=body.foglioDiLavoro; if(body.components!==undefined)u.components=body.components; await DB.updateProcessedOrder(id,u); return ok({success:true}); }
            if (method==='DELETE') { await DB.deleteProcessedOrder(params.id||params.shopify_order_id); return ok({success:true}); }
        }
        if (urlStr.includes('api-orders.php') && urlStr.includes('shopify_bridge')) {
            // Chiama la Supabase Edge Function come proxy Shopify
            try {
                const edgeUrl = 'https://nulkachuhjdzohkzwvly.supabase.co/functions/v1/shopify-proxy';
                const shopifyResp = await _originalFetch(edgeUrl);
                if (!shopifyResp.ok) throw new Error(`Shopify Edge Function HTTP ${shopifyResp.status}`);
                const shopifyOrders = await shopifyResp.json();
                const orders = shopifyOrders.orders || shopifyOrders || [];
                return ok(orders);
            } catch(e) {
                console.error('❌ Edge Function error:', e);
                return ok([]);
            }
        }
        if (urlStr.includes('api-shopify-orders')) { if(method==='POST'){await DB.saveShopifyOrders(body.orders||[]);return ok({success:true});} return ok({success:true,orders:await DB.getShopifyOrders()}); }
        if (urlStr.includes('api-order-statuses')) { if(method==='GET') return ok({success:true,statuses:await DB.getOrderStatuses()}); await DB.saveOrderStatus(body.orderId,body.status); return ok({success:true}); }
        if (urlStr.includes('api-operator-assignments')) { if(method==='GET') return ok({success:true,assignments:await DB.getOperatorAssignments()}); if(method==='DELETE'){await DB.deleteOperatorAssignment(params.id);return ok({success:true});} await DB.saveOperatorAssignment(body.orderId,body.operator); return ok({success:true}); }
        if (urlStr.includes('api-hidden-orders')) { if(method==='GET') return ok({success:true,hiddenOrders:await DB.getHiddenOrders()}); if(method==='DELETE'){await DB.restoreHiddenOrder(params.id);return ok({success:true});} await DB.hideOrder(body.orderId); return ok({success:true}); }
        if (urlStr.includes('api-ordered-ids')) { if(method==='GET') return ok({success:true,orderedIds:await DB.getOrderedIds()}); if(method==='DELETE'){await DB.removeOrderedId(params.id);return ok({success:true});} await DB.addOrderedId(body.orderId); return ok({success:true}); }
        if (urlStr.includes('api-components')) { if(params.ean){const c=await DB.getComponentByEan(params.ean);return ok(c?{success:true,component:c}:{success:false,error:'Non trovato'});} return ok({success:true,components:await DB.searchComponents(params.search||'',params.type||'')}); }
        if (urlStr.includes('api-gpo-mapping')) { if(method==='GET') return ok({success:true,mappings:await DB.getGpoMappings()}); if(method==='POST'){return ok({success:true,id:await DB.saveGpoMapping(body)});} if(method==='PUT'){await DB.updateGpoMapping(body.id,body);return ok({success:true});} await DB.deleteGpoMapping(params.id); return ok({success:true}); }
        if (urlStr.includes('api-custom-components')) { if(method==='GET') return ok({success:true,components:await DB.getCustomAmazonComponents()}); if(method==='POST'){return ok({success:true,id:await DB.saveCustomAmazonComponent(body)});} if(method==='PUT'){await DB.updateCustomAmazonComponent(body.id,body);return ok({success:true});} await DB.deleteCustomAmazonComponent(params.id); return ok({success:true}); }
        if (urlStr.includes('api-configs')) { if(method==='GET'){const c=await DB.getConfigs();return ok({success:true,configs:c,config:params.name?c[params.name]:undefined});} if(method==='DELETE'){await DB.deleteConfig(params.name);return ok({success:true});} await DB.saveConfig(body.config_name||body.new_config_name,{fullName:body.full_name,components:body.components}); return ok({success:true}); }
        if (urlStr.includes('api-monthly-counter')) { if(method==='GET') return ok({success:true,counter:await DB.getMonthlyCounter()}); return ok({success:true,counter:await DB.incrementMonthlyCounter(body?.increment||1)}); }
        if (urlStr.includes('api-inventory')) { if(method==='GET') return ok({success:true,inventory:await DB.getInventory()}); if(method==='DELETE'){await DB.deleteInventoryItem(params.ean);return ok({success:true});} await DB.saveInventoryItem(body.ean,body.name,body.quantity); return ok({success:true}); }
        if (urlStr.includes('api-message-templates')) { if(method==='GET') return ok({success:true,config:await DB.getMessageTemplateConfig()}); await DB.saveMessageTemplateConfig(body.config||body); return ok({success:true}); }
        if (urlStr.includes('api-supplier-logs')) { if(method==='GET'){const l=await DB.getSupplierLogs();return ok({success:true,logs:l,log:params.id?l.find(x=>x.id==params.id):undefined});} if(method==='DELETE'){await DB.deleteSupplierLog(params.id);return ok({success:true});} return ok({success:true,id:await DB.saveSupplierLog(body.orderIds||[],body.supplierData||{})}); }
        return _originalFetch(url, options);
    } catch(e) { console.error('❌ Adapter error:',urlStr,e); return ok({success:false,error:e.message}); }
};
console.log('✅ API Adapter Supabase attivo');
