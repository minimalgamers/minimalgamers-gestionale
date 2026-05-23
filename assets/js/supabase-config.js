// ============================================================
// SUPABASE CONFIG v13 - Minimal Gamers Gestionale Ordini
// ============================================================
// v13: bump versione (nessun cambio funzionale qui).
//      Il fix è in order-config-matcher.js v13 (fuzzy matcher).
// v12: Skip filtro `fornitore` sulle tabelle che NON hanno quella
//      colonna (RAM, HDD, Scheda_Aggiuntiva). Verificato via
//      information_schema.columns.
// v11: Fix ilike→eq sul fornitore (causava 400 quando il valore
//      non conteneva % wildcard, es. "PROKS", "OMEGA").
// v10: Replica fedele del backend PHP originale di Stetco.
//      - I componenti vanno SEMPRE nella tabella processed_order_components
//      - GET ricostruisce l'array components[] via JOIN su processed_orders.id
//      - I custom items (orderId-scoped) usano processed_order_components.is_custom=1
//      - Il catalogo "articoli_aggiunti" è separato (gestito da api-adapter, non qui)
// ============================================================

const SUPABASE_URL = 'https://nulkachuhjdzohkzwvly.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jodHsyRQmowfQrcm-YbuHg_3kRdy9L3';

// Password gestionale (SHA-256 di 'mini_mals22')
const ACCESS_PASSWORD_HASH = '703f23740c261e210b81117806ae3189856ab18163b38e7be4df8e9565b4742d';

// Shopify (chiamata via Edge Function shopify-proxy)
const SHOPIFY_STORE = 'minimalgamers.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = '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';
const SHOPIFY_API_KEY = '483112c3d1d5bd734b3c2f52b50cb5d6';
const SHOPIFY_PROXY_URL = null;

// ============================================================
// TABELLE CATALOGO - case-sensitive PostgreSQL!
// I dati reali sono nelle versioni MAIUSCOLE (verificato su DB live).
// Le versioni lowercase esistono ma sono vuote (artefatto migrazione MySQL).
// ============================================================
const CATALOG_TABLES = ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'Alimentatore', 'Scheda_Madre', 'Case_PC', 'Dissipatore', 'Scheda_Aggiuntiva'];
const CATALOG_TABLES_SEARCH = ['CPU', 'GPU', 'RAM', 'SSD', 'Alimentatore', 'Scheda_Madre', 'Case_PC', 'Dissipatore'];

// Solo queste tabelle hanno la colonna `fornitore` (verificato su DB live).
// Su RAM, HDD, Scheda_Aggiuntiva la colonna NON esiste: filtrando esplode con 400.
const TABLES_WITH_FORNITORE = new Set(['CPU', 'GPU', 'SSD', 'Alimentatore', 'Scheda_Madre', 'Case_PC', 'Dissipatore']);

// Whitelist colonne valide di processed_orders (per evitare PGRST204)
const PROCESSED_ORDERS_COLS = new Set([
    'shopify_order_id', 'order_id_flip', 'operator', 'config_name', 'pc_item_name',
    'custom_properties', 'customer_email', 'customer_phone', 'stato', 'foglio_di_lavoro',
    'created_at', 'updated_at'
]);

// ============================================================
// INIT SUPABASE CLIENT
// ============================================================
let supabase = null;

(async () => {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase DB pronto (v13)');
    window.SupabaseDB._ready = true;
    if (window.SupabaseDB._onReady) window.SupabaseDB._onReady();
})();

// ============================================================
// AUTH
// ============================================================
async function verifyPassword(password) {
    if (password === 'mini_mals22') return true;
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === ACCESS_PASSWORD_HASH;
}

// ============================================================
// PROCESSED ORDERS + COMPONENTS (replica fedele del PHP originale)
// ============================================================

// Filtra solo le colonne valide della tabella processed_orders
function sanitizeProcessedOrderFields(orderData) {
    const clean = {};
    for (const [k, v] of Object.entries(orderData || {})) {
        if (PROCESSED_ORDERS_COLS.has(k)) clean[k] = v;
    }
    return clean;
}

// GET tutti gli ordini elaborati + JOIN con processed_order_components.
// Il frontend si aspetta una mappa { [shopifyOrderId]: orderObj }
// dove orderObj.components è array di {type, ean, name, supplier, price, quantity}.
async function dbGetProcessedOrders() {
    // 1. Carico tutti gli ordini
    const { data: orders, error: errOrders } = await supabase
        .from('processed_orders')
        .select('id, shopify_order_id, order_id_flip, operator, config_name, pc_item_name, custom_properties, customer_email, customer_phone, stato, foglio_di_lavoro')
        .order('created_at', { ascending: false });
    if (errOrders) throw errOrders;
    if (!orders || orders.length === 0) return {};

    // 2. Carico TUTTI i componenti in un colpo solo
    const orderIds = orders.map(o => o.id);
    const { data: components, error: errComps } = await supabase
        .from('processed_order_components')
        .select('order_id, component_type, ean, product_name, supplier, price, quantity, is_custom')
        .in('order_id', orderIds);
    if (errComps) throw errComps;

    // 3. Indicizzo i componenti per order_id (FK numerica)
    const compsByOrderId = {};
    (components || []).forEach(c => {
        if (!compsByOrderId[c.order_id]) compsByOrderId[c.order_id] = [];
        compsByOrderId[c.order_id].push({
            type: c.component_type,
            ean: c.ean || '',
            name: c.product_name || '',
            supplier: c.supplier || '',
            price: c.price,
            quantity: c.quantity || 1,
            isCustom: !!c.is_custom
        });
    });

    // 4. Costruisco l'output con la stessa shape che usava il PHP
    const result = {};
    orders.forEach(o => {
        // Parse custom_properties se è stringa
        let cp = o.custom_properties;
        if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch { cp = null; } }
        result[o.shopify_order_id] = {
            // shape PHP-compatibile (camelCase)
            orderIdFlip: o.order_id_flip,
            operator: o.operator,
            configName: o.config_name,
            pcItemName: o.pc_item_name,
            customProperties: cp,
            stato: o.stato || 'elaborati',
            foglioDiLavoro: parseInt(o.foglio_di_lavoro, 10) || 1,
            components: (compsByOrderId[o.id] || []).filter(c => !c.isCustom),
            // shape snake_case (alcuni punti di app.js leggono così)
            shopify_order_id: o.shopify_order_id,
            order_id_flip: o.order_id_flip,
            config_name: o.config_name,
            pc_item_name: o.pc_item_name,
            custom_properties: cp,
            customer_email: o.customer_email,
            customer_phone: o.customer_phone,
            foglio_di_lavoro: parseInt(o.foglio_di_lavoro, 10) || 1,
            _internalId: o.id  // ci serve per i salvataggi successivi
        };
    });
    return result;
}

// POST: salva (upsert) un ordine + sostituisce TUTTI i suoi componenti.
// Replica esatta del PHP: DELETE * WHERE order_id = X, poi INSERT dei nuovi.
async function dbSaveProcessedOrder(shopifyOrderId, orderData) {
    const incoming = { ...(orderData || {}) };

    // Estraggo l'array components prima di sanificare
    let componentsArray = null;
    if (Array.isArray(incoming.components)) {
        componentsArray = incoming.components;
        delete incoming.components;
    }

    // Normalizza foglio_di_lavoro (1-4)
    if (incoming.foglio_di_lavoro !== undefined) {
        const f = parseInt(incoming.foglio_di_lavoro, 10) || 1;
        incoming.foglio_di_lavoro = Math.min(4, Math.max(1, f));
    }
    if (incoming.foglioDiLavoro !== undefined) {
        const f = parseInt(incoming.foglioDiLavoro, 10) || 1;
        incoming.foglio_di_lavoro = Math.min(4, Math.max(1, f));
        delete incoming.foglioDiLavoro;
    }
    // Normalizza camelCase residui
    if (incoming.orderIdFlip !== undefined) { incoming.order_id_flip = incoming.orderIdFlip; delete incoming.orderIdFlip; }
    if (incoming.configName !== undefined) { incoming.config_name = incoming.configName; delete incoming.configName; }
    if (incoming.pcItemName !== undefined) { incoming.pc_item_name = incoming.pcItemName; delete incoming.pcItemName; }
    if (incoming.customProperties !== undefined) { incoming.custom_properties = incoming.customProperties; delete incoming.customProperties; }
    if (incoming.customerEmail !== undefined) { incoming.customer_email = incoming.customerEmail; delete incoming.customerEmail; }
    if (incoming.customerPhone !== undefined) { incoming.customer_phone = incoming.customerPhone; delete incoming.customerPhone; }

    const clean = sanitizeProcessedOrderFields(incoming);

    // Upsert dell'ordine (RESTITUISCE l'id interno per la FK)
    const { data: upserted, error: errUp } = await supabase
        .from('processed_orders')
        .upsert({
            shopify_order_id: String(shopifyOrderId),
            ...clean,
            updated_at: new Date().toISOString()
        }, { onConflict: 'shopify_order_id' })
        .select('id')
        .single();
    if (errUp) throw errUp;
    const internalId = upserted.id;

    // Se sono stati passati componenti, REPLACE: DELETE non-custom + INSERT
    // ATTENZIONE: NON tocco i record con is_custom=1 (gestiti separatamente)
    if (componentsArray && Array.isArray(componentsArray)) {
        // Cancello solo i componenti standard, lascio in vita i custom
        const { error: errDel } = await supabase
            .from('processed_order_components')
            .delete()
            .eq('order_id', internalId)
            .or('is_custom.is.null,is_custom.eq.0');
        if (errDel) throw errDel;

        // Inserisco i nuovi (se ce ne sono)
        if (componentsArray.length > 0) {
            const rows = componentsArray
                .filter(c => c && c.type)
                .map(c => ({
                    order_id: internalId,
                    component_type: c.type,
                    ean: c.ean || null,
                    product_name: c.name || null,
                    supplier: c.supplier || null,
                    price: (c.price !== undefined && c.price !== null && c.price !== '') ? c.price : null,
                    quantity: parseInt(c.quantity, 10) || 1,
                    is_custom: 0
                }));
            if (rows.length > 0) {
                const { error: errIns } = await supabase
                    .from('processed_order_components')
                    .insert(rows);
                if (errIns) throw errIns;
            }
        }
    }
}

// PUT: aggiorna SOLO i campi scalari dell'ordine (operator, configName, stato, foglio).
// Non tocca i componenti.
async function dbUpdateProcessedOrder(shopifyOrderId, fields) {
    const f = { ...(fields || {}) };
    // Normalizza camelCase
    if (f.orderIdFlip !== undefined) { f.order_id_flip = f.orderIdFlip; delete f.orderIdFlip; }
    if (f.configName !== undefined) { f.config_name = f.configName; delete f.configName; }
    if (f.pcItemName !== undefined) { f.pc_item_name = f.pcItemName; delete f.pcItemName; }
    if (f.customProperties !== undefined) { f.custom_properties = f.customProperties; delete f.customProperties; }
    if (f.foglioDiLavoro !== undefined) {
        const v = parseInt(f.foglioDiLavoro, 10) || 1;
        f.foglio_di_lavoro = Math.min(4, Math.max(1, v));
        delete f.foglioDiLavoro;
    }
    const clean = sanitizeProcessedOrderFields(f);
    if (Object.keys(clean).length === 0) return;
    const { error } = await supabase
        .from('processed_orders')
        .update({ ...clean, updated_at: new Date().toISOString() })
        .eq('shopify_order_id', String(shopifyOrderId));
    if (error) throw error;
}

// PATCH: aggiorna o inserisce UN singolo componente (per type)
// Replica del PATCH del PHP api-processed-orders.php
async function dbUpsertSingleComponent(shopifyOrderId, componentType, ean, productName, supplier) {
    // Trovo l'id interno dell'ordine
    const { data: orderRow, error: errOrd } = await supabase
        .from('processed_orders')
        .select('id')
        .eq('shopify_order_id', String(shopifyOrderId))
        .maybeSingle();
    if (errOrd) throw errOrd;
    if (!orderRow) throw new Error('Ordine non trovato');
    const internalId = orderRow.id;

    // Cerco se esiste già un componente per questo type
    const { data: existing, error: errEx } = await supabase
        .from('processed_order_components')
        .select('id')
        .eq('order_id', internalId)
        .eq('component_type', componentType)
        .or('is_custom.is.null,is_custom.eq.0')
        .maybeSingle();
    if (errEx) throw errEx;

    if (existing) {
        const { error } = await supabase
            .from('processed_order_components')
            .update({
                ean: ean || null,
                product_name: productName || null,
                supplier: supplier || null
            })
            .eq('id', existing.id);
        if (error) throw error;
        return 'update';
    } else {
        const { error } = await supabase
            .from('processed_order_components')
            .insert({
                order_id: internalId,
                component_type: componentType,
                ean: ean || null,
                product_name: productName || null,
                supplier: supplier || null,
                quantity: 1,
                is_custom: 0
            });
        if (error) throw error;
        return 'insert';
    }
}

async function dbDeleteProcessedOrder(shopifyOrderId) {
    // Le righe in processed_order_components hanno ON DELETE CASCADE? Per sicurezza cancello a mano:
    const { data: orderRow } = await supabase
        .from('processed_orders').select('id')
        .eq('shopify_order_id', String(shopifyOrderId)).maybeSingle();
    if (orderRow) {
        await supabase.from('processed_order_components').delete().eq('order_id', orderRow.id);
    }
    const { error } = await supabase.from('processed_orders')
        .delete().eq('shopify_order_id', String(shopifyOrderId));
    if (error) throw error;
}

// ============================================================
// CUSTOM ITEMS PER ORDINE
// (voci aggiuntive a specifici ordini, salvate con is_custom=1)
// Replica fedele di processed_orders_service/api-custom-items.php
// ============================================================
async function dbGetCustomItemsByOrder(shopifyOrderId) {
    const { data: orderRow } = await supabase
        .from('processed_orders').select('id')
        .eq('shopify_order_id', String(shopifyOrderId)).maybeSingle();
    if (!orderRow) return [];
    const { data, error } = await supabase
        .from('processed_order_components')
        .select('component_type, product_name, supplier, ean')
        .eq('order_id', orderRow.id)
        .eq('is_custom', 1)
        .order('id', { ascending: true });
    if (error) return [];
    return (data || []).map(it => ({
        name: it.component_type,
        value: it.product_name,
        supplier: it.supplier || '',
        ean: it.ean || ''
    }));
}

async function dbSaveCustomItemsForOrder(shopifyOrderId, customItems) {
    if (!Array.isArray(customItems)) customItems = [];
    if (customItems.length > 5) customItems = customItems.slice(0, 5);

    // Upsert "stub" dell'ordine se non esiste
    const { data: existing } = await supabase
        .from('processed_orders').select('id')
        .eq('shopify_order_id', String(shopifyOrderId)).maybeSingle();
    let internalId;
    if (existing) {
        internalId = existing.id;
    } else {
        const { data: created, error } = await supabase
            .from('processed_orders')
            .insert({ shopify_order_id: String(shopifyOrderId), stato: 'elaborati', foglio_di_lavoro: 1 })
            .select('id').single();
        if (error) throw error;
        internalId = created.id;
    }

    // Cancello i custom esistenti e re-inserisco
    await supabase.from('processed_order_components')
        .delete().eq('order_id', internalId).eq('is_custom', 1);

    if (customItems.length > 0) {
        const rows = customItems.map(it => ({
            order_id: internalId,
            component_type: it.name || '',
            product_name: it.value || '',
            supplier: it.supplier || '',
            ean: it.ean || '',
            quantity: 1,
            is_custom: 1
        }));
        const { error } = await supabase.from('processed_order_components').insert(rows);
        if (error) throw error;
    }
    return true;
}

async function dbDeleteCustomItemsForOrder(shopifyOrderId) {
    const { data: orderRow } = await supabase
        .from('processed_orders').select('id')
        .eq('shopify_order_id', String(shopifyOrderId)).maybeSingle();
    if (!orderRow) return 0;
    const { error, count } = await supabase
        .from('processed_order_components')
        .delete({ count: 'exact' })
        .eq('order_id', orderRow.id).eq('is_custom', 1);
    if (error) throw error;
    return count || 0;
}

// ============================================================
// ARTICOLI AGGIUNTI (catalogo riutilizzabile)
// Replica di components_service/api-custom-items.php
// ============================================================
async function dbSearchArticoliAggiunti(search, type) {
    let query = supabase.from('articoli_aggiunti').select('*');
    if (search) query = query.or(`nome.ilike.%${search}%,ean.ilike.%${search}%`);
    if (type) query = query.eq('categoria', type);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) return [];
    return data || [];
}

async function dbInsertArticoloAggiunto(nome, ean, categoria, fornitore, prezzo) {
    if (!nome) throw new Error('Nome obbligatorio');
    if (!ean) throw new Error('EAN obbligatorio');
    // Check duplicato EAN
    const { data: dup } = await supabase
        .from('articoli_aggiunti').select('id').eq('ean', ean).maybeSingle();
    if (dup) throw new Error('EAN già esistente');
    const { data, error } = await supabase
        .from('articoli_aggiunti')
        .insert({ nome, ean, categoria: categoria || null, fornitore: fornitore || null, prezzo: parseFloat(prezzo) || 0, quantita: 999 })
        .select('id').single();
    if (error) throw error;
    return data.id;
}

async function dbDeleteArticoloAggiunto({ id, ean }) {
    let q = supabase.from('articoli_aggiunti').delete({ count: 'exact' });
    if (id) q = q.eq('id', id);
    else if (ean) q = q.eq('ean', ean);
    else throw new Error('ID o EAN richiesto');
    const { error, count } = await q;
    if (error) throw error;
    return count || 0;
}

// ============================================================
// COMPONENTS (ricerca per EAN o testo)
// ============================================================
async function dbGetComponentByEan(ean, supplier = null) {
    // Skip se l'ean è palesemente non valido (vuoto o troppo "strano")
    if (!ean || typeof ean !== 'string' || ean.trim() === '') return null;
    const eanClean = ean.trim();

    // Normalizza il fornitore: trim + uppercase per fare match consistente
    const supplierNorm = (supplier && typeof supplier === 'string')
        ? supplier.trim().toUpperCase()
        : null;
    const useSupplierFilter = supplierNorm && supplierNorm !== '' && supplierNorm !== 'N/D' && supplierNorm !== '--' && supplierNorm !== 'FORNITORE';

    // 1. Cerca prima in custom_amazon_components
    try {
        let q = supabase.from('custom_amazon_components').select('*').eq('ean', eanClean);
        if (useSupplierFilter) q = q.eq('fornitore', supplierNorm);
        const { data } = await q.limit(1);
        if (data && data.length > 0) return { ...data[0], _table: 'custom_amazon_components' };
    } catch(e) {}

    // 2. Cerca in articoli_aggiunti
    try {
        const { data } = await supabase.from('articoli_aggiunti').select('*').eq('ean', eanClean).limit(1);
        if (data && data.length > 0) return { ...data[0], _table: 'articoli_aggiunti' };
    } catch(e) {}

    // 3. Itera sulle tabelle catalogo MAIUSCOLE
    for (const table of CATALOG_TABLES) {
        try {
            let q = supabase.from(table).select('*').eq('ean', eanClean);
            // Applica il filtro fornitore SOLO sulle tabelle che hanno quella colonna
            if (useSupplierFilter && TABLES_WITH_FORNITORE.has(table)) {
                q = q.eq('fornitore', supplierNorm);
            }
            const { data, error } = await q.limit(1);
            if (error) continue;
            if (data && data.length > 0) return { ...data[0], _table: table };
        } catch(e) {}
    }
    return null;
}

async function dbSearchComponents(searchText, categoria = '') {
    const results = [];
    const tables = categoria && CATALOG_TABLES.includes(categoria) ? [categoria] : CATALOG_TABLES_SEARCH;
    for (const table of tables) {
        try {
            let query = supabase.from(table).select('id, ean, nome, fornitore, prezzo, quantita').gt('quantita', 0);
            if (searchText) query = query.ilike('nome', `%${searchText}%`);
            const { data, error } = await query.limit(10);
            if (error) continue;
            if (data) results.push(...data.map(r => ({ ...r, _table: table })));
        } catch(e) {}
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
                    type: c.component_type || '',
                    value: c.ean_value || '',
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
        .upsert({ config_name: configName, full_name: configData.fullName, updated_at: new Date().toISOString() }, { onConflict: 'config_name' })
        .select();
    if (error) throw error;
    const configId = data[0].id;
    if (configData.components) {
        await supabase.from('standard_config_components').delete().eq('config_id', configId);
        const comps = configData.components
            .filter(c => c && c.type)
            .map(c => ({
                config_id: configId,
                component_type: c.type,
                ean_value: c.value || '',
                supplier: c.supplier || null
            }));
        if (comps.length > 0) await supabase.from('standard_config_components').insert(comps);
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
        .upsert({ shopify_order_id: String(orderId), status, updated_at: new Date().toISOString() }, { onConflict: 'shopify_order_id' });
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
        .upsert({ shopify_order_id: String(orderId), operator, updated_at: new Date().toISOString() }, { onConflict: 'shopify_order_id' });
    if (error) throw error;
}
async function dbDeleteOperatorAssignment(orderId) {
    const { error } = await supabase.from('operator_assignments').delete().eq('shopify_order_id', String(orderId));
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
    await supabase.from('hidden_orders').upsert({ shopify_order_id: String(orderId) }, { onConflict: 'shopify_order_id' });
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
    await supabase.from('ordered_ids').upsert({ shopify_order_id: String(orderId) }, { onConflict: 'shopify_order_id' });
}
async function dbRemoveOrderedId(orderId) {
    await supabase.from('ordered_ids').delete().eq('shopify_order_id', String(orderId));
}

// ============================================================
// MONTHLY COUNTER (gestione robusta: niente errori 406 se manca la riga)
// ============================================================
async function dbGetMonthlyCounter() {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // .maybeSingle() restituisce null se la riga non c'è (no 406)
    const { data } = await supabase.from('monthly_counter')
        .select('counter_value').eq('month_year', monthYear).maybeSingle();
    return data?.counter_value || 0;
}
async function dbIncrementMonthlyCounter(amount = 1) {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const current = await dbGetMonthlyCounter();
    const newValue = current + amount;
    await supabase.from('monthly_counter').upsert(
        { month_year: monthYear, counter_value: newValue, last_reset: new Date().toISOString() },
        { onConflict: 'month_year' }
    );
    return newValue;
}

// ============================================================
// INVENTORY
// ============================================================
async function dbGetInventory() {
    const { data } = await supabase.from('warehouse_inventory').select('*');
    return data || [];
}
async function dbSaveInventoryItem(ean, name, quantity) {
    await supabase.from('warehouse_inventory')
        .upsert({ ean, name, quantity, updated_at: new Date().toISOString() }, { onConflict: 'ean' });
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
            .insert({ id: 1, config_json: json, updated_at: new Date().toISOString() });
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
        .insert({ order_count: orderIds.length })
        .select();
    return data?.[0]?.id;
}
async function dbDeleteSupplierLog(id) {
    await supabase.from('supplier_logs').delete().eq('id', id);
}

// ============================================================
// SHOPIFY ORDERS CACHE (DISABILITATA - sempre via Edge Function)
// ============================================================
async function dbSaveShopifyOrders(orders) { return; }
async function dbGetShopifyOrders() { return []; }

// ============================================================
// SHOPIFY API via Edge Function
// ============================================================
async function fetchShopifyOrders(apiKey) {
    const edgeFunctionUrl = 'https://nulkachuhjdzohkzwvly.supabase.co/functions/v1/shopify-proxy';
    const response = await fetch(edgeFunctionUrl);
    if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
    const data = await response.json();
    const orders = data.orders || [];
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
// EXPORT GLOBALE
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
    upsertSingleComponent: dbUpsertSingleComponent,
    // Custom items per ordine
    getCustomItemsByOrder: dbGetCustomItemsByOrder,
    saveCustomItemsForOrder: dbSaveCustomItemsForOrder,
    deleteCustomItemsForOrder: dbDeleteCustomItemsForOrder,
    // Articoli aggiunti (catalogo)
    searchArticoliAggiunti: dbSearchArticoliAggiunti,
    insertArticoloAggiunto: dbInsertArticoloAggiunto,
    deleteArticoloAggiunto: dbDeleteArticoloAggiunto,
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
    // Shopify cache (no-op)
    saveShopifyOrders: dbSaveShopifyOrders,
    getShopifyOrders: dbGetShopifyOrders,
};
