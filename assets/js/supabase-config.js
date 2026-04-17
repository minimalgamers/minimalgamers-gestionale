// ============================================================
// SUPABASE CONFIG - Minimal Gamers Gestionale Ordini
// ============================================================

const SUPABASE_URL = 'https://nulkachuhjdzohkzwvly.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jodHsyRQmowfQrcm-YbuHg_3kRdy9L3';

// Password di accesso al gestionale (SHA-256)
// Cambia questa con l'hash della tua password
// Genera l'hash su: https://emn178.github.io/online-tools/sha256.html
const ACCESS_PASSWORD_HASH = '703f23740c261e210b81117806ae3189856ab18163b38e7be4df8e9565b4742d'; // password: mini_mals22

// Shopify Config (da configurare dopo)
// Shopify - chiamata diretta alle API (token visibile, ok per uso interno)
const SHOPIFY_STORE = 'minimalgamers.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = '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';
const SHOPIFY_API_KEY = '483112c3d1d5bd734b3c2f52b50cb5d6';
const SHOPIFY_PROXY_URL = null; // non usato, chiamata diretta

// ============================================================
// INIT SUPABASE CLIENT
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// AUTH
// ============================================================
async function verifyPassword(password) {
    // Confronto diretto con la password in chiaro
    if (password === 'mini_mals22') return true;
    // Fallback: confronto SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === ACCESS_PASSWORD_HASH;
}

// ============================================================
// PROCESSED ORDERS
// ============================================================
async function dbGetProcessedOrders() {
    const { data, error } = await supabase.from('processed_orders').select('*');
    if (error) throw error;
    const result = {};
    data.forEach(row => { result[row.shopify_order_id] = row; });
    return result;
}

async function dbSaveProcessedOrder(shopifyOrderId, orderData) {
    const { error } = await supabase.from('processed_orders').upsert({
        shopify_order_id: String(shopifyOrderId),
        ...orderData,
        updated_at: new Date().toISOString()
    }, { onConflict: 'shopify_order_id' });
    if (error) throw error;
}

async function dbUpdateProcessedOrder(shopifyOrderId, fields) {
    const { error } = await supabase.from('processed_orders')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('shopify_order_id', String(shopifyOrderId));
    if (error) throw error;
}

async function dbDeleteProcessedOrder(shopifyOrderId) {
    const { error } = await supabase.from('processed_orders')
        .delete().eq('shopify_order_id', String(shopifyOrderId));
    if (error) throw error;
}

// ============================================================
// COMPONENTS (ricerca per EAN)
// ============================================================
async function dbGetComponentByEan(ean) {
    const tables = ['cpu', 'gpu', 'ram', 'ssd', 'alimentatore', 'scheda_madre', 'case_pc', 'dissipatore', 'hdd', 'scheda_aggiuntiva'];
    for (const table of tables) {
        const { data } = await supabase.from(table).select('*').eq('ean', ean).limit(1);
        if (data && data.length > 0) return { ...data[0], _table: table };
    }
    // Cerca anche in articoli_aggiunti e custom_amazon_components
    const { data: extra } = await supabase.from('articoli_aggiunti').select('*').eq('ean', ean).limit(1);
    if (extra && extra.length > 0) return { ...extra[0], _table: 'articoli_aggiunti' };
    const { data: amazon } = await supabase.from('custom_amazon_components').select('*').eq('ean', ean).limit(1);
    if (amazon && amazon.length > 0) return { ...amazon[0], _table: 'custom_amazon_components' };
    return null;
}

async function dbSearchComponents(searchText, categoria = '') {
    const tables = ['cpu', 'gpu', 'ram', 'ssd', 'alimentatore', 'scheda_madre', 'case_pc', 'dissipatore'];
    const results = [];
    for (const table of tables) {
        let query = supabase.from(table).select('id, ean, nome, fornitore, prezzo, quantita').gt('quantita', 0);
        if (searchText) query = query.ilike('nome', `%${searchText}%`);
        const { data } = await query.limit(10);
        if (data) results.push(...data.map(r => ({ ...r, _table: table })));
    }
    return results;
}

// ============================================================
// GPO MAPPINGS
// ============================================================
async function dbGetGpoMappings() {
    const { data, error } = await supabase.from('gpo_mapping').select('*');
    if (error) throw error;
    return data || [];
}

async function dbSaveGpoMapping(mappingData) {
    const { data, error } = await supabase.from('gpo_mapping').insert(mappingData).select();
    if (error) throw error;
    return data[0]?.id;
}

async function dbUpdateGpoMapping(id, fields) {
    const { error } = await supabase.from('gpo_mapping').update(fields).eq('id', id);
    if (error) throw error;
}

async function dbDeleteGpoMapping(id) {
    const { error } = await supabase.from('gpo_mapping').delete().eq('id', id);
    if (error) throw error;
}

// ============================================================
// STANDARD CONFIGS
// ============================================================
async function dbGetConfigs() {
    const { data: configs } = await supabase.from('standard_configs').select('*');
    const { data: components } = await supabase.from('standard_config_components').select('*');
    const result = {};
    if (configs) {
        configs.forEach(cfg => {
            const cfgComponents = (components || [])
                .filter(c => c.config_id === cfg.id)
                .map(c => ({
                    type: c.type || c.component_type || '',
                    value: c.value || (c.ean ? (c.supplier ? `${c.ean} (${c.supplier})` : c.ean) : ''),
                    supplier: c.supplier || ''
                }));
            result[cfg.config_name] = {
                fullName: cfg.full_name || cfg.config_name,
                components: cfgComponents
            };
        });
    }
    return result;
}

async function dbSaveConfig(configName, configData) {
    const { data, error } = await supabase.from('standard_configs')
        .upsert({ config_name: configName, full_name: configData.fullName }, { onConflict: 'config_name' })
        .select();
    if (error) throw error;
    const configId = data[0].id;
    if (configData.components) {
        await supabase.from('standard_config_components').delete().eq('config_id', configId);
        const comps = configData.components.map(c => ({ config_id: configId, ...c }));
        await supabase.from('standard_config_components').insert(comps);
    }
}

async function dbDeleteConfig(configName) {
    const { data } = await supabase.from('standard_configs').select('id').eq('config_name', configName).single();
    if (data) {
        await supabase.from('standard_config_components').delete().eq('config_id', data.id);
        await supabase.from('standard_configs').delete().eq('id', data.id);
    }
}

// ============================================================
// ORDER STATUSES
// ============================================================
async function dbGetOrderStatuses() {
    const { data } = await supabase.from('order_statuses').select('*');
    const result = {};
    (data || []).forEach(row => { result[row.shopify_order_id] = row.status; });
    return result;
}

async function dbSaveOrderStatus(orderId, status) {
    const { error } = await supabase.from('order_statuses')
        .upsert({ shopify_order_id: String(orderId), status }, { onConflict: 'shopify_order_id' });
    if (error) throw error;
}

// ============================================================
// OPERATOR ASSIGNMENTS
// ============================================================
async function dbGetOperatorAssignments() {
    const { data } = await supabase.from('operator_assignments').select('*');
    const result = {};
    (data || []).forEach(row => { result[row.shopify_order_id] = row.operator; });
    return result;
}

async function dbSaveOperatorAssignment(orderId, operator) {
    const { error } = await supabase.from('operator_assignments')
        .upsert({ shopify_order_id: String(orderId), operator }, { onConflict: 'shopify_order_id' });
    if (error) throw error;
}

async function dbDeleteOperatorAssignment(orderId) {
    const { error } = await supabase.from('operator_assignments')
        .delete().eq('shopify_order_id', String(orderId));
    if (error) throw error;
}

// ============================================================
// HIDDEN ORDERS
// ============================================================
async function dbGetHiddenOrders() {
    const { data } = await supabase.from('hidden_orders').select('shopify_order_id');
    return (data || []).map(r => r.shopify_order_id);
}

async function dbHideOrder(orderId) {
    await supabase.from('hidden_orders')
        .upsert({ shopify_order_id: String(orderId) }, { onConflict: 'shopify_order_id' });
}

async function dbRestoreHiddenOrder(orderId) {
    await supabase.from('hidden_orders').delete().eq('shopify_order_id', String(orderId));
}

// ============================================================
// ORDERED IDS (Finalizzati)
// ============================================================
async function dbGetOrderedIds() {
    const { data } = await supabase.from('ordered_ids').select('shopify_order_id');
    return (data || []).map(r => r.shopify_order_id);
}

async function dbAddOrderedId(orderId) {
    await supabase.from('ordered_ids')
        .upsert({ shopify_order_id: String(orderId) }, { onConflict: 'shopify_order_id' });
}

async function dbRemoveOrderedId(orderId) {
    await supabase.from('ordered_ids').delete().eq('shopify_order_id', String(orderId));
}

// ============================================================
// MONTHLY COUNTER
// ============================================================
async function dbGetMonthlyCounter() {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { data } = await supabase.from('monthly_counter')
        .select('counter_value').eq('month_year', monthYear).single();
    return data?.counter_value || 0;
}

async function dbIncrementMonthlyCounter(amount = 1) {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const current = await dbGetMonthlyCounter();
    await supabase.from('monthly_counter').upsert(
        { month_year: monthYear, counter_value: current + amount, last_reset: new Date().toISOString() },
        { onConflict: 'month_year' }
    );
    return current + amount;
}

// ============================================================
// INVENTORY (warehouse)
// ============================================================
async function dbGetInventory() {
    const { data } = await supabase.from('warehouse_inventory').select('*');
    return data || [];
}

async function dbSaveInventoryItem(ean, name, quantity) {
    await supabase.from('warehouse_inventory')
        .upsert({ ean, name, quantity }, { onConflict: 'ean' });
}

async function dbDeleteInventoryItem(ean) {
    await supabase.from('warehouse_inventory').delete().eq('ean', ean);
}

// ============================================================
// MESSAGE TEMPLATES
// ============================================================
async function dbGetMessageTemplateConfig() {
    const { data } = await supabase.from('message_template_configs')
        .select('config_json').order('id', { ascending: false }).limit(1);
    if (data && data.length > 0) {
        try { return JSON.parse(data[0].config_json); } catch { return null; }
    }
    return null;
}

async function dbSaveMessageTemplateConfig(config) {
    const { data: existing } = await supabase.from('message_template_configs').select('id').limit(1);
    const json = JSON.stringify(config);
    if (existing && existing.length > 0) {
        await supabase.from('message_template_configs')
            .update({ config_json: json, updated_at: new Date().toISOString() })
            .eq('id', existing[0].id);
    } else {
        await supabase.from('message_template_configs')
            .insert({ config_json: json, updated_at: new Date().toISOString() });
    }
}

// ============================================================
// CUSTOM AMAZON COMPONENTS
// ============================================================
async function dbGetCustomAmazonComponents() {
    const { data } = await supabase.from('custom_amazon_components').select('*');
    return data || [];
}

async function dbSaveCustomAmazonComponent(compData) {
    const { data, error } = await supabase.from('custom_amazon_components').insert(compData).select();
    if (error) throw error;
    return data[0]?.id;
}

async function dbUpdateCustomAmazonComponent(id, fields) {
    await supabase.from('custom_amazon_components').update(fields).eq('id', id);
}

async function dbDeleteCustomAmazonComponent(id) {
    await supabase.from('custom_amazon_components').delete().eq('id', id);
}

// ============================================================
// SUPPLIER LOGS
// ============================================================
async function dbGetSupplierLogs() {
    const { data } = await supabase.from('supplier_logs').select('*')
        .order('created_at', { ascending: false }).limit(20);
    return data || [];
}

async function dbSaveSupplierLog(orderIds, supplierData) {
    const { data } = await supabase.from('supplier_logs')
        .insert({ order_ids: orderIds, count: orderIds.length, supplier_data: supplierData })
        .select();
    return data?.[0]?.id;
}

async function dbDeleteSupplierLog(id) {
    await supabase.from('supplier_logs').delete().eq('id', id);
}

// ============================================================
// SHOPIFY ORDERS CACHE
// ============================================================
async function dbSaveShopifyOrders(orders) {
    if (!orders.length) return;
    const rows = orders.map(o => ({
        shopify_order_id: String(o.id),
        order_data: o,
        cached_at: new Date().toISOString()
    }));
    await supabase.from('shopify_orders').upsert(rows, { onConflict: 'shopify_order_id' });
}

async function dbGetShopifyOrders() {
    const { data } = await supabase.from('shopify_orders').select('order_data');
    return (data || []).map(r => r.order_data);
}

// ============================================================
// SHOPIFY API (via Cloudflare Worker proxy)
// ============================================================
async function fetchShopifyOrders(apiKey) {
    // Usa Supabase Edge Function come proxy sicuro per Shopify
    const edgeFunctionUrl = 'https://nulkachuhjdzohkzwvly.supabase.co/functions/v1/shopify-proxy';
    const response = await fetch(edgeFunctionUrl);
    if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
    const data = await response.json();
    const orders = data.orders || [];
    // Processa custom_properties come fa il PHP originale
    orders.forEach(order => {
        if (order.line_items) {
            order.line_items.forEach(item => {
                if (item.properties && item.properties.length > 0) {
                    const metafields = {};
                    const skipKeys = ['_gpo_product_group','_gpo_personalize','gpo_field_name','gpo_parent_product_group','_gpo_field_name','_gpo_parent_product_group'];
                    item.properties.forEach(prop => {
                        const name = String(prop.name || '').trim();
                        if (name && !skipKeys.includes(name)) metafields[name] = prop.value || '';
                    });
                    item.custom_properties = metafields;
                }
            });
        }
    });
    return orders;
}

// ============================================================
// ESPORTA TUTTO GLOBALMENTE
// ============================================================
window.SupabaseDB = {
    supabase,
    verifyPassword,
    fetchShopifyOrders,
    // Processed orders
    getProcessedOrders: dbGetProcessedOrders,
    saveProcessedOrder: dbSaveProcessedOrder,
    updateProcessedOrder: dbUpdateProcessedOrder,
    deleteProcessedOrder: dbDeleteProcessedOrder,
    // Components
    getComponentByEan: dbGetComponentByEan,
    searchComponents: dbSearchComponents,
    // GPO
    getGpoMappings: dbGetGpoMappings,
    saveGpoMapping: dbSaveGpoMapping,
    updateGpoMapping: dbUpdateGpoMapping,
    deleteGpoMapping: dbDeleteGpoMapping,
    // Configs
    getConfigs: dbGetConfigs,
    saveConfig: dbSaveConfig,
    deleteConfig: dbDeleteConfig,
    // Statuses
    getOrderStatuses: dbGetOrderStatuses,
    saveOrderStatus: dbSaveOrderStatus,
    // Operators
    getOperatorAssignments: dbGetOperatorAssignments,
    saveOperatorAssignment: dbSaveOperatorAssignment,
    deleteOperatorAssignment: dbDeleteOperatorAssignment,
    // Hidden
    getHiddenOrders: dbGetHiddenOrders,
    hideOrder: dbHideOrder,
    restoreHiddenOrder: dbRestoreHiddenOrder,
    // Ordered
    getOrderedIds: dbGetOrderedIds,
    addOrderedId: dbAddOrderedId,
    removeOrderedId: dbRemoveOrderedId,
    // Counter
    getMonthlyCounter: dbGetMonthlyCounter,
    incrementMonthlyCounter: dbIncrementMonthlyCounter,
    // Inventory
    getInventory: dbGetInventory,
    saveInventoryItem: dbSaveInventoryItem,
    deleteInventoryItem: dbDeleteInventoryItem,
    // Templates
    getMessageTemplateConfig: dbGetMessageTemplateConfig,
    saveMessageTemplateConfig: dbSaveMessageTemplateConfig,
    // Amazon components
    getCustomAmazonComponents: dbGetCustomAmazonComponents,
    saveCustomAmazonComponent: dbSaveCustomAmazonComponent,
    updateCustomAmazonComponent: dbUpdateCustomAmazonComponent,
    deleteCustomAmazonComponent: dbDeleteCustomAmazonComponent,
    // Supplier logs
    getSupplierLogs: dbGetSupplierLogs,
    saveSupplierLog: dbSaveSupplierLog,
    deleteSupplierLog: dbDeleteSupplierLog,
    // Shopify cache
    saveShopifyOrders: dbSaveShopifyOrders,
    getShopifyOrders: dbGetShopifyOrders,
};

console.log('✅ Supabase DB pronto');
