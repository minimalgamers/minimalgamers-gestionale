const loadFromShopifyBtn = document.getElementById('loadFromShopify');
const errorMessage = document.getElementById('errorMessage');
const loadingMessage = document.getElementById('loadingMessage');
const accessPassword = document.getElementById('accessPassword');

let isAuthenticated = false;
let apiKey = null;
let processedOrdersMap = new Map(); 
let processedOrdersCache = {}; 
let processedRenderToken = 0;
const PROCESSED_TAB_TO_WORKSHEET = {
    processed: 1,
    'processed-e2': 2,
    'processed-e3': 3,
    'processed-e4': 4
};

function isProcessedTab(tabName) {
    return Object.prototype.hasOwnProperty.call(PROCESSED_TAB_TO_WORKSHEET, tabName);
}

function getWorksheetFromTab(tabName) {
    return PROCESSED_TAB_TO_WORKSHEET[tabName] || 1;
}

function getActiveWorksheetTab() {
    const activeTab = document.querySelector('.tab-button.active');
    return getWorksheetFromTab(activeTab ? activeTab.dataset.tab : 'processed');
}

function isProcessedOrdersViewLoading() {
    const processedContainer = document.getElementById('processed-container');
    if (!processedContainer) return false;

    if (processedContainer.textContent.includes('Caricamento componenti...')) {
        return true;
    }

    return Array.from(processedContainer.querySelectorAll('.component-name-display')).some(display =>
        display.textContent.trim() === 'Caricamento...'
    );
}

function updateSupplierSummaryButtonVisibility(tabName = null) {
    const exportBtn = document.getElementById('export-btn');
    if (!exportBtn) return;

    const resolvedTabName = tabName || document.querySelector('.tab-button.active')?.dataset.tab || 'orders';
    const isVisible = isProcessedTab(resolvedTabName);

    exportBtn.style.display = isVisible ? 'block' : 'none';

    if (!isVisible) {
        exportBtn.disabled = false;
        exportBtn.title = 'Riepilogo Fornitori';
        exportBtn.setAttribute('aria-disabled', 'false');
        return;
    }

    const isLoading = isProcessedOrdersViewLoading();
    exportBtn.disabled = isLoading;
    exportBtn.title = isLoading
        ? 'Attendi il caricamento completo degli ordini elaborati in questa pagina'
        : 'Riepilogo Fornitori';
    exportBtn.setAttribute('aria-disabled', String(isLoading));
}

function getFilteredProcessedOrdersMap(sourceMap, worksheetNumber) {
    const targetWorksheet = Math.min(4, Math.max(1, parseInt(worksheetNumber, 10) || 1));
    const filteredMap = new Map();

    sourceMap.forEach((orderData, orderName) => {
        const cachedOrder = processedOrdersCache[orderData.id] || {};
        
        if (cachedOrder.stato === 'finalizzati') {
            return;
        }
        const worksheet = Math.min(4, Math.max(1, parseInt(cachedOrder.foglioDiLavoro ?? orderData.foglioDiLavoro ?? 1, 10) || 1));
        if (worksheet === targetWorksheet) {
            filteredMap.set(orderName, orderData);
        }
    });

    return filteredMap;
}

function normalizePhoneForStorage(rawPhone) {
    if (!rawPhone) return null;

    const trimmed = String(rawPhone).trim();
    if (!trimmed || trimmed.toUpperCase() === 'N/A') return null;

    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;

    if (trimmed.startsWith('+')) {
        if (digits.length === 10) {
            return `+39${digits}`;
        }

        return `+${digits}`;
    }

    if (trimmed.startsWith('00')) {
        return `+${digits.replace(/^00/, '')}`;
    }

    if (digits.length === 10) {
        return `+39${digits}`;
    }

    return digits;
}

function formatPhoneForWhatsApp(rawPhone) {
    const normalized = normalizePhoneForStorage(rawPhone);
    if (!normalized) return '';

    if (normalized.startsWith('+')) {
        return normalized.slice(1);
    }

    return normalized.replace(/^00/, '');
}

function openWhatsAppDesktop(rawPhone, prefilledText = '') {
    const phone = formatPhoneForWhatsApp(rawPhone);
    if (!phone) return false;

    const encodedText = prefilledText ? `&text=${encodeURIComponent(prefilledText)}` : '';
    const protocolUrl = `whatsapp://send?phone=${phone}${encodedText}`;

    
    const launcher = document.createElement('iframe');
    launcher.style.display = 'none';
    launcher.src = protocolUrl;
    document.body.appendChild(launcher);

    setTimeout(() => {
        if (launcher.parentNode) {
            launcher.parentNode.removeChild(launcher);
        }
    }, 1200);

    return false;
}

function getPreferredCustomerPhone(order) {
    const candidates = [
        order?.phone,
        order?.customer?.phone,
        order?.customer?.default_address?.phone,
        order?.shipping_address?.phone,
        order?.billing_address?.phone
    ]
        .map(normalizePhoneForStorage)
        .filter(Boolean);

    if (!candidates.length) return 'N/A';

    const withInternationalPrefix = candidates.find(phone => phone.startsWith('+'));
    return withInternationalPrefix || candidates[0];
}

function getCurrentProcessedOrderById(orderId) {
    const targetId = String(orderId);
    for (const order of processedOrdersMap.values()) {
            if (String(order?.id) === targetId) {
            return order;
        }
    }
    return null;
}

function collectOrderComponentsForMessaging(orderId, fallbackOrder = null) {
    const components = [];
    const rows = document.querySelectorAll(`.component-row[data-order-id="${String(orderId)}"]`);

    rows.forEach((row) => {
        const type = row.dataset.componentType || '';
        const nameEl = row.querySelector('.component-name-display');
        const supplierEl = row.querySelector('.supplier-badge-clickable');

        const name = (nameEl?.textContent || '').trim();
        const ean = (nameEl?.dataset?.ean || nameEl?.dataset?.originalValue || '').trim();
        const supplier = (supplierEl?.dataset?.supplier || supplierEl?.textContent || '').trim();
        const wifi = nameEl?.dataset?.wifi;

        if (name || ean || type || supplier) {
            components.push({ type, name, ean, supplier, wifi });
        }
    });

    if (components.length) return components;

    const sourceOrder = fallbackOrder || getCurrentProcessedOrderById(orderId);
    const savedComponents = Array.isArray(sourceOrder?.components) ? sourceOrder.components : [];

    return savedComponents.map((component) => ({
        type: String(component?.type || component?.componentType || '').trim(),
        name: String(component?.name || component?.value || component?.productName || '').trim(),
        ean: String(component?.ean || '').trim(),
        supplier: String(component?.supplier || '').trim(),
        wifi: component?.wifi ?? null
    })).filter(component => component.type || component.name || component.ean || component.supplier);
}

const messageTemplateComponentLookupCache = new Map();

function isMotherboardComponentForMessaging(component) {
    const normalizedType = String(component?.type || '').trim().toUpperCase().replace(/\s+/g, '_');
    return normalizedType === 'SCHEDA_MADRE' || normalizedType === 'MOTHERBOARD' || normalizedType === 'MOBO';
}

function normalizeWifiFlag(value) {
    if (value === 1 || value === '1' || value === true || value === 'true') return 1;
    if (value === 0 || value === '0' || value === false || value === 'false') return 0;
    return null;
}

async function fetchMotherboardWifiFlag(component) {
    const ean = String(component?.ean || '').trim();
    if (!ean) {
        return null;
    }

    const supplier = String(component?.supplier || '').trim();
    const cacheKey = `${ean}::${supplier}`;
    if (messageTemplateComponentLookupCache.has(cacheKey)) {
        return messageTemplateComponentLookupCache.get(cacheKey);
    }

    let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
    if (supplier && supplier !== '--' && supplier !== 'N/A') {
        url += `&supplier=${encodeURIComponent(supplier)}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json().catch(() => null);
        const wifi = normalizeWifiFlag(data?.component?.wifi);
        messageTemplateComponentLookupCache.set(cacheKey, wifi);
        return wifi;
    } catch (error) {
        console.warn('⚠️ Impossibile leggere il flag wifi della scheda madre:', error);
        messageTemplateComponentLookupCache.set(cacheKey, null);
        return null;
    }
}

async function enrichComponentsForTemplateMessaging(components = []) {
    return Promise.all((Array.isArray(components) ? components : []).map(async (component) => {
        const wifi = normalizeWifiFlag(component?.wifi);
        if (!isMotherboardComponentForMessaging(component) || wifi !== null) {
            return { ...component, wifi };
        }

        const fetchedWifi = await fetchMotherboardWifiFlag(component);
        return { ...component, wifi: fetchedWifi };
    }));
}

async function buildContactMessage(channel, order, components, selectedRuleId = null) {
    if (!window.MessageTemplateEngine?.buildMessageForChannel) {
        return null;
    }

    try {
        const enrichedComponents = await enrichComponentsForTemplateMessaging(components);
        return window.MessageTemplateEngine.buildMessageForChannel(channel, order, { components: enrichedComponents }, null, selectedRuleId);
    } catch (error) {
        console.error('❌ Errore generazione template messaggio:', error);
        return null;
    }
}

async function openEmailForOrder(order, components = [], selectedRuleId = null) {
    const email = String(order?.email || '').trim();
    if (!email || email === 'N/A') return false;

    const result = await buildContactMessage('email', order, components, selectedRuleId);
    const subject = encodeURIComponent(result?.subject || '');
    const body = encodeURIComponent(result?.body || '');
    const outlookWebUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email)}&subject=${subject}&body=${body}`;

    window.open(outlookWebUrl, 'outlook-web-compose', 'noopener');
    return true;
}

async function openWhatsAppForOrder(order, components = [], selectedRuleId = null) {
    const messageResult = await buildContactMessage('whatsapp', order, components, selectedRuleId);
    const prefilledText = messageResult?.text || '';
    return openWhatsAppDesktop(order?.phone, prefilledText);
}

async function getApplicableTemplateRules(order, components = []) {
    if (!window.MessageTemplateEngine?.getApplicableRulesForOrder) {
        return [];
    }

    try {
        const enrichedComponents = await enrichComponentsForTemplateMessaging(components);
        return window.MessageTemplateEngine.getApplicableRulesForOrder(order, { components: enrichedComponents });
    } catch (error) {
        console.error('❌ Errore rilevamento regole template:', error);
        return [];
    }
}

function pickTemplateRuleForChannel(channel, rules = []) {
    return new Promise((resolve) => {
        if (!Array.isArray(rules) || rules.length <= 1) {
            resolve(rules[0]?.id || null);
            return;
        }

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.65)';
        overlay.style.backdropFilter = 'blur(3px)';
        overlay.style.zIndex = '4000';

        const popup = document.createElement('div');
        popup.style.position = 'fixed';
        popup.style.top = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.width = 'min(92vw, 620px)';
        popup.style.maxHeight = '80vh';
        popup.style.overflow = 'auto';
        popup.style.background = 'rgba(10, 18, 30, 0.92)';
        popup.style.border = '1px solid rgba(255, 255, 255, 0.24)';
        popup.style.borderRadius = '12px';
        popup.style.padding = '14px';
        popup.style.zIndex = '4001';

        const title = document.createElement('h3');
        title.textContent = 'Sono state trovate piu regole template. Scegli quale usare:';
        title.style.margin = '0 0 12px 0';
        title.style.fontSize = '1rem';
        title.style.color = 'white';

        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '8px';

        rules.forEach((rule, index) => {
            const btn = document.createElement('button');
            const label = (rule.ruleName || rule.articleLabel || rule.articleEan || `Regola ${index + 1}`).trim();
            btn.type = 'button';
            btn.textContent = label;
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            btn.style.padding = '10px 12px';
            btn.style.borderRadius = '8px';
            btn.style.border = '1px solid rgba(255, 255, 255, 0.34)';
            btn.style.background = 'rgba(255, 255, 255, 0.2)';
            btn.style.color = 'white';
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => {
                cleanup();
                resolve(rule.id);
            });
            list.appendChild(btn);
        });

        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.marginTop = '12px';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Annulla';
        cancelBtn.style.padding = '8px 12px';
        cancelBtn.style.borderRadius = '8px';
        cancelBtn.style.border = '1px solid rgba(255,255,255,0.32)';
        cancelBtn.style.background = 'rgba(255,255,255,0.12)';
        cancelBtn.style.color = 'white';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        footer.appendChild(cancelBtn);
        popup.appendChild(title);
        popup.appendChild(list);
        popup.appendChild(footer);

        function cleanup() {
            popup.remove();
            overlay.remove();
        }

        overlay.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        document.body.appendChild(overlay);
        document.body.appendChild(popup);
    });
}

async function contactWithTemplateSelection(channel, order, components = []) {
    if (channel === 'whatsapp') {
        return await openWhatsAppForOrder(order, components);
    }

    if (channel === 'email') {
        return await openEmailForOrder(order, components);
    }

    const applicableRules = await getApplicableTemplateRules(order, components);
    let selectedRuleId = null;

    if (applicableRules.length > 1) {
        selectedRuleId = await pickTemplateRuleForChannel(channel, applicableRules);
        if (!selectedRuleId) {
            return false;
        }
    } else if (applicableRules.length === 1) {
        selectedRuleId = applicableRules[0].id;
    }

    if (channel === 'email') {
        return await openEmailForOrder(order, components, selectedRuleId);
    }

    return await openWhatsAppForOrder(order, components, selectedRuleId);
}


function isValidEAN(ean) {
    if (!ean || typeof ean !== 'string') return false;
    const trimmed = ean.trim();
    if (!trimmed) return false;
    
    
    return /^\d{5,}$/.test(trimmed);
}

function updateComponentIfExists(finalComponents, componentType, newValue, contextLabel = '') {
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
            console.log(`ℹ️ Extra aggiunto (${contextLabel || 'N/A'}): SSD ADDON`);
            return true;
        }

        console.warn(`⚠️ Variante ignorata (${contextLabel || 'N/A'}): componente ${componentType} non presente nella configurazione standard`);
        return false;
    }

    finalComponents[componentIndex] = {
        type: finalComponents[componentIndex].type,
        value: newValue
    };
    return true;
}

function extractSupplierFromText(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const match = raw.match(/\(([^)]+)\)/);
    return match ? match[1].trim() : '';
}


function getSupplierAbbreviation(supplier) {
    if (!supplier) return '--';
    const sup = supplier.toUpperCase().trim();
    const abbr = {
        'AMAZON': 'AZ',
        'OMEGA': 'OM',
        'TIER ONE': 'TO',
        'PROKS': 'PR',
        'ECOM': 'EC',
        'NOUA': 'NO',
        'INTEGRATA': 'IG',
        'MSI': 'MS',
        'CASEKING': 'CK',
        'NAVY BLUE': 'NB'
    };
    return abbr[sup] || sup.substring(0, 2);
}


const API_ENDPOINT = 'api_gateway/shopify_bridge/order_service/endpoint/api-orders.php';
const AUTH_ENDPOINT = 'auth_module/verify_access/token_manager/handler/auth.php';
const PROCESSED_ORDERS_API_URL = 'api_gateway/db_bridge/processed_orders_service/endpoint/api-processed-orders.php';
const SHOPIFY_ORDERS_DB_API_URL = 'api_gateway/db_bridge/shopify_orders_service/endpoint/api-shopify-orders.php';






async function loadProcessedOrdersFromDB() {
    try {
        const response = await fetch(PROCESSED_ORDERS_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.orders) {
                processedOrdersCache = data.orders;
                const orderCount = Object.keys(processedOrdersCache).length;
                return processedOrdersCache;
            } else {
                console.warn('⚠️ API risponde ma nessun ordine trovato:', data);
            }
        } else {
            console.error('❌ Errore risposta API processed orders:', response.status, response.statusText);
        }
        return {};
    } catch (error) {
        console.error('❌ Errore caricamento ordini elaborati:', error);
        return {};
    }
}


async function getProcessedOrderIdsFromDB() {
    try {
        const response = await fetch(`${PROCESSED_ORDERS_API_URL}?stato=elaborati`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.orders) {
                const ids = Object.keys(data.orders);
                return ids;
            }
        }
        console.warn('⚠️ Nessun ordine elaborato trovato nel database');
        return [];
    } catch (error) {
        console.error('❌ Errore query database ordini elaborati:', error);
        return [];
    }
}


function isOrderProcessed(orderId, processedOrderIds) {
    const orderIdStr = String(orderId);
    
    return processedOrderIds.includes(orderIdStr) || 
           processedOrderIds.some(id => id.startsWith(orderIdStr + '.'));
}


async function saveProcessedOrderToDB(shopifyOrderId, orderData) {
    try {
        const foglioDiLavoro = Math.min(4, Math.max(1, parseInt(orderData.foglioDiLavoro, 10) || 1));
        const response = await fetch(PROCESSED_ORDERS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopifyOrderId: shopifyOrderId,
                orderIdFlip: orderData.orderIdFlip || null,
                operator: orderData.operator || null,
                configName: orderData.configName || null,
                pcItemName: orderData.pcItemName || null,
                customProperties: orderData.customProperties || null,
                customerEmail: orderData.customerEmail || null,
                customerPhone: orderData.customerPhone || null,
                foglioDiLavoro,
                components: orderData.components || []
            })
        });
        const data = await response.json();
        
        if (data.success) {
            processedOrdersCache[shopifyOrderId] = {
                ...orderData,
                foglioDiLavoro
            };
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore salvataggio ordine elaborato:', error);
        return false;
    }
}


async function updateProcessedOrderOperator(shopifyOrderId, operator) {
    try {
        const response = await fetch(PROCESSED_ORDERS_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopifyOrderId: shopifyOrderId,
                operator: operator
            })
        });
        const data = await response.json();
        if (data.success && processedOrdersCache[shopifyOrderId]) {
            processedOrdersCache[shopifyOrderId].operator = operator;
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore aggiornamento operatore:', error);
        return false;
    }
}


async function deleteProcessedOrderFromDB(shopifyOrderId) {
    try {
        const response = await fetch(`${PROCESSED_ORDERS_API_URL}?id=${encodeURIComponent(shopifyOrderId)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            delete processedOrdersCache[shopifyOrderId];
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore eliminazione ordine elaborato:', error);
        return false;
    }
}


async function updateProcessedOrderStato(shopifyOrderId, stato) {
    try {
        const response = await fetch(PROCESSED_ORDERS_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopifyOrderId: shopifyOrderId,
                stato: stato
            })
        });
        const data = await response.json();
        if (data.success && processedOrdersCache[shopifyOrderId]) {
            processedOrdersCache[shopifyOrderId].stato = stato;
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore aggiornamento stato ordine:', error);
        return false;
    }
}


async function updateProcessedOrderWorksheet(shopifyOrderId, foglioDiLavoro) {
    try {
        const worksheet = Math.min(4, Math.max(1, parseInt(foglioDiLavoro, 10) || 1));
        const response = await fetch(PROCESSED_ORDERS_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopifyOrderId: shopifyOrderId,
                foglioDiLavoro: worksheet
            })
        });
        const data = await response.json();
        if (data.success && processedOrdersCache[shopifyOrderId]) {
            processedOrdersCache[shopifyOrderId].foglioDiLavoro = worksheet;
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore aggiornamento foglio di lavoro ordine:', error);
        return false;
    }
}


function getProcessedOrderIds() {
    return Object.keys(processedOrdersCache);
}


async function updateProcessedOrderComponent(shopifyOrderId, componentType, ean, productName = null, supplier = null) {
    try {
        
        const response = await fetch(PROCESSED_ORDERS_API_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopifyOrderId: shopifyOrderId,
                componentType: componentType,
                ean: ean,
                productName: productName,
                supplier: supplier
            })
        });
        const data = await response.json();
        
        
        if (!data.success) {
            console.error('❌ Errore dal server:', data.error);
        }
        
        return data.success;
    } catch (error) {
        console.error('❌ Errore aggiornamento componente:', error);
        return false;
    }
}





async function saveAllCurrentComponentsToDB(orderId, modifiedType, modifiedEan, modifiedName, modifiedSupplier, showNotif = true) {
    try {
        
        const componentRows = document.querySelectorAll(`.component-row[data-order-id="${orderId}"]`);
        
        if (componentRows.length === 0) {
            console.error(`Nessun componente trovato nel DOM per ordine ${orderId}`);
            return false;
        }
        
        
        const components = [];
        
        for (const row of componentRows) {
            const componentType = row.dataset.componentType;
            const componentSpan = row.querySelector('.component-name-display');
            const supplierBadge = row.querySelector('.supplier-badge-clickable');
            
            let ean, name, supplier;
            
            
            if (componentType === modifiedType) {
                ean = modifiedEan;
                name = modifiedName;
                supplier = modifiedSupplier;
            } else {
                
                ean = componentSpan?.dataset.ean || componentSpan?.dataset.originalValue || '';
                name = componentSpan?.textContent || '';
                supplier = supplierBadge?.dataset.supplier || '';
            }
            
            if (ean) {
                components.push({
                    type: componentType,
                    ean: ean,
                    name: name || null,
                    supplier: supplier || null
                });
            }
        }
        
        
        const response = await fetch(PROCESSED_ORDERS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopifyOrderId: orderId,
                components: components
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            
            if (!processedOrdersCache[orderId]) {
                processedOrdersCache[orderId] = {};
            }
            processedOrdersCache[orderId].components = components;
            
            if (showNotif) {
                showNotification(`✅ ${modifiedType} e tutti gli altri componenti salvati nel database`);
            }
            return true;
        } else {
            console.error('❌ Errore salvataggio componenti:', data.error);
            if (showNotif) {
                showNotification(`⚠️ Errore nel salvataggio: ${data.error}`);
            }
            return false;
        }
    } catch (error) {
        console.error('❌ Errore saveAllCurrentComponentsToDB:', error);
        if (showNotif) {
            showNotification(`⚠️ Errore nel salvataggio`);
        }
        return false;
    }
}





const ORDER_STATUSES_API_URL = 'api_gateway/db_bridge/order_statuses_service/endpoint/api-order-statuses.php';
let orderStatusesCache = {};


async function loadOrderStatusesFromDB() {
    try {
        const response = await fetch(ORDER_STATUSES_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.statuses) {
                orderStatusesCache = data.statuses;
                return orderStatusesCache;
            }
        }
        return {};
    } catch (error) {
        console.error('❌ Errore caricamento stati ordini:', error);
        return {};
    }
}


async function saveOrderStatusToDB(orderId, status) {
    try {
        const response = await fetch(ORDER_STATUSES_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, status })
        });
        const data = await response.json();
        if (data.success) {
            orderStatusesCache[orderId] = status;
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore salvataggio stato ordine:', error);
        return false;
    }
}


function getOrderStatus(orderId) {
    return orderStatusesCache[orderId] || 'todo';
}





const OPERATOR_ASSIGNMENTS_API_URL = 'api_gateway/db_bridge/operator_assignments_service/endpoint/api-operator-assignments.php';
let operatorAssignmentsCache = {};


async function loadOperatorAssignmentsFromDB() {
    try {
        const response = await fetch(OPERATOR_ASSIGNMENTS_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.assignments) {
                operatorAssignmentsCache = data.assignments;
                return operatorAssignmentsCache;
            }
        }
        return {};
    } catch (error) {
        console.error('❌ Errore caricamento assegnazioni operatori:', error);
        return {};
    }
}


async function saveOperatorAssignmentToDB(orderId, operator) {
    try {
        const response = await fetch(OPERATOR_ASSIGNMENTS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, operator })
        });
        const data = await response.json();
        if (data.success) {
            operatorAssignmentsCache[orderId] = operator;
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore salvataggio assegnazione operatore:', error);
        return false;
    }
}


async function deleteOperatorAssignmentFromDB(orderId) {
    try {
        const response = await fetch(`${OPERATOR_ASSIGNMENTS_API_URL}?id=${encodeURIComponent(orderId)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            delete operatorAssignmentsCache[orderId];
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore eliminazione assegnazione operatore:', error);
        return false;
    }
}


function getOperatorAssignment(orderId) {
    return operatorAssignmentsCache[orderId] || '';
}





const HIDDEN_ORDERS_API_URL = 'api_gateway/db_bridge/hidden_orders_service/endpoint/api-hidden-orders.php';
let hiddenOrdersCache = [];


async function loadHiddenOrdersFromDB() {
    try {
        const response = await fetch(HIDDEN_ORDERS_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.hiddenOrders) {
                hiddenOrdersCache = data.hiddenOrders;
                return hiddenOrdersCache;
            }
        }
        return [];
    } catch (error) {
        console.error('❌ Errore caricamento ordini nascosti:', error);
        return [];
    }
}


async function hideOrderInDB(orderId) {
    try {
        const response = await fetch(HIDDEN_ORDERS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId })
        });
        const data = await response.json();
        if (data.success && !hiddenOrdersCache.includes(String(orderId))) {
            hiddenOrdersCache.push(String(orderId));
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore nascondimento ordine:', error);
        return false;
    }
}


async function restoreHiddenOrderFromDB(orderId) {
    try {
        const response = await fetch(`${HIDDEN_ORDERS_API_URL}?id=${encodeURIComponent(orderId)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            hiddenOrdersCache = hiddenOrdersCache.filter(id => id !== String(orderId));
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore ripristino ordine nascosto:', error);
        return false;
    }
}


function isOrderHidden(orderId) {
    return hiddenOrdersCache.includes(String(orderId));
}





const ORDERED_IDS_API_URL = 'api_gateway/db_bridge/ordered_ids_service/endpoint/api-ordered-ids.php';
let orderedIdsCache = [];


async function loadOrderedIdsFromDB() {
    try {
        const response = await fetch(ORDERED_IDS_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.orderedIds) {
                orderedIdsCache = data.orderedIds;
                return orderedIdsCache;
            }
        }
        return [];
    } catch (error) {
        console.error('❌ Errore caricamento ID ordinati:', error);
        return [];
    }
}


async function addOrderedIdToDB(orderId) {
    try {
        const response = await fetch(ORDERED_IDS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId })
        });
        const data = await response.json();
        if (data.success && !orderedIdsCache.includes(String(orderId))) {
            orderedIdsCache.push(String(orderId));
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore aggiunta ID ordinato:', error);
        return false;
    }
}


async function removeOrderedIdFromDB(orderId) {
    try {
        const response = await fetch(`${ORDERED_IDS_API_URL}?id=${encodeURIComponent(orderId)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            orderedIdsCache = orderedIdsCache.filter(id => id !== String(orderId));
        }
        return data.success;
    } catch (error) {
        console.error('❌ Errore rimozione ID ordinato:', error);
        return false;
    }
}


function isOrderOrdered(orderId) {
    return orderedIdsCache.includes(String(orderId));
}





const CUSTOM_ITEMS_API_URL = 'api_gateway/db_bridge/processed_orders_service/endpoint/api-custom-items.php';


async function loadCustomItemsFromDB(orderId) {
    try {
        const response = await fetch(`${CUSTOM_ITEMS_API_URL}?orderId=${encodeURIComponent(orderId)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                return data.customItems || [];
            }
        }
        return [];
    } catch (error) {
        console.error('❌ Errore caricamento voci personalizzate:', error);
        return [];
    }
}


async function saveCustomItemsToDB(orderId, customItems) {
    
    if (customItems.length > 5) {
        showNotification('⚠️ Massimo 5 voci personalizzate consentite');
        return false;
    }
    
    try {
        const response = await fetch(CUSTOM_ITEMS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, customItems })
        });
        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('❌ Errore salvataggio voci personalizzate:', error);
        return false;
    }
}

function normalizeCustomComparableText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCustomComparableEan(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 5) return digits;
    return normalizeCustomComparableText(raw);
}

function buildCustomItemMatchers(customItems) {
    const eanSet = new Set();
    const nameSet = new Set();

    (customItems || []).forEach((item) => {
        const normalizedEan = normalizeCustomComparableEan(item?.ean);
        if (normalizedEan) {
            eanSet.add(normalizedEan);
        }

        const normalizedName = normalizeCustomComparableText(item?.name);
        if (normalizedName) {
            nameSet.add(normalizedName);
        }
    });

    return { eanSet, nameSet };
}

function isDuplicateOfCustomItem(componentEan, componentName, customMatchers) {
    if (!customMatchers) return false;

    const normalizedEan = normalizeCustomComparableEan(componentEan);
    if (normalizedEan && customMatchers.eanSet.has(normalizedEan)) {
        return true;
    }

    const normalizedName = normalizeCustomComparableText(componentName);
    if (normalizedName && customMatchers.nameSet.has(normalizedName)) {
        return true;
    }

    return false;
}





const MONTHLY_COUNTER_API_URL = 'api_gateway/db_bridge/monthly_counter_service/endpoint/api-monthly-counter.php';
let monthlyCounter = 0;


async function loadMonthlyCounter() {
    try {
        const response = await fetch(MONTHLY_COUNTER_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                monthlyCounter = data.counter;
                return monthlyCounter;
            }
        }
        return 0;
    } catch (error) {
        console.error('❌ Errore caricamento contatore mensile:', error);
        return 0;
    }
}


async function incrementMonthlyCounter(amount = 1) {
    try {
        const response = await fetch(MONTHLY_COUNTER_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ increment: amount })
        });
        const data = await response.json();
        if (data.success) {
            monthlyCounter = data.counter;
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Errore incremento contatore:', error);
        return false;
    }
}


async function resetProcessedOrdersCounter() {
    try {
        const response = await fetch(MONTHLY_COUNTER_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            const data = await response.json();
            monthlyCounter = 0;
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Errore reset contatore:', error);
        return false;
    }
}


function initBackgroundSelector() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsTabBtn = document.querySelector('.tab-button[data-tab="settings"]');
    const bgDropZone = document.getElementById('bg-drop-zone');
    const bgInput = document.getElementById('bg-file-input');
    const desktopNotificationsToggle = document.getElementById('desktop-notifications-toggle');
    const showTotalsToggle = document.getElementById('show-totals-toggle');
    const sessionTimeoutSelect = document.getElementById('session-timeout-select');
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const openFinalizedPageBtn = document.getElementById('open-finalized-page-btn');
    const openInventoryPageBtn = document.getElementById('open-inventory-page-btn');
    const messageTemplatesBtn = document.getElementById('message-templates-btn');
    
    
    const savedBg = localStorage.getItem('custom_background');

    if (window.MessageTemplateEngine && typeof window.MessageTemplateEngine.init === 'function') {
        window.MessageTemplateEngine.init().catch((error) => {
            console.warn('⚠️ Init template messaggi da DB fallita:', error?.message || error);
        });
    }
    if (savedBg) {
        
        document.body.style.backgroundImage = `url('${savedBg}')`;
    } else {
        
        document.body.style.backgroundImage = `url('assets/img/background.avif')`;
    }
    
    
    const desktopNotifications = localStorage.getItem('desktop_notifications') === 'true';
    const showTotals = localStorage.getItem('show_totals') === 'true'; 
    let sessionTimeout = localStorage.getItem('session_timeout') || '1800000'; 

    
    if (sessionTimeout === '3600000') {
        sessionTimeout = '14400000';
        localStorage.setItem('session_timeout', sessionTimeout);
    }
    
    desktopNotificationsToggle.checked = desktopNotifications;
    showTotalsToggle.checked = showTotals;
    sessionTimeoutSelect.value = sessionTimeout;
    
    
    applyShowTotalsSetting(showTotals);
    
    
    initSessionTimeout(parseInt(sessionTimeout));
    
    
    settingsBtn.addEventListener('click', async () => {
        
        await closeAllOverlayPages(true);
        settingsTabBtn?.click();
    });

    messageTemplatesBtn?.addEventListener('click', () => {
        const tabBtn = document.querySelector('.tab-button[data-tab="message-templates"]');
        if (tabBtn) {
            tabBtn.click();
        }
    });

    openFinalizedPageBtn?.addEventListener('click', () => {
        const finalizedTabBtn = document.querySelector('.tab-button[data-tab="finalized"]');
        finalizedTabBtn?.click();
    });

    openInventoryPageBtn?.addEventListener('click', async () => {
        const inventoryTabBtn = document.querySelector('.tab-button[data-tab="inventory"]');
        inventoryTabBtn?.click();
        await loadInventory();
        renderInventoryTable();
    });
    
    
    bgDropZone.addEventListener('click', () => {
        bgInput.click();
    });
    
    
    bgDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        bgDropZone.classList.add('drag-over');
    });
    
    bgDropZone.addEventListener('dragleave', () => {
        bgDropZone.classList.remove('drag-over');
    });
    
    bgDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        bgDropZone.classList.remove('drag-over');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            loadBackgroundImage(file);
        } else {
            showNotification('Seleziona un file immagine valido');
        }
    });
    
    
    bgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            loadBackgroundImage(file);
        }
    });
    
    
    function loadBackgroundImage(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            document.body.style.backgroundImage = `url('${dataUrl}')`;
            localStorage.setItem('custom_background', dataUrl);
            showNotification('Sfondo aggiornato ✓');
        };
        reader.readAsDataURL(file);
    }
    
    
    desktopNotificationsToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        
        if (enabled) {
            
            if ('Notification' in window) {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    localStorage.setItem('desktop_notifications', 'true');
                    showNotification('Notifiche desktop abilitate ✓');
                    
                    new Notification('Dashboard Ordini', {
                        body: 'Notifiche desktop attive!',
                        icon: 'https://www.minimalgamers.it/cdn/shop/files/LOGO_MINIMAL_GAMERS.jpg'
                    });
                } else {
                    e.target.checked = false;
                    showNotification('Permesso notifiche negato');
                }
            } else {
                e.target.checked = false;
                showNotification('Browser non supporta notifiche');
            }
        } else {
            localStorage.setItem('desktop_notifications', 'false');
            showNotification('Notifiche desktop disabilitate');
        }
    });
    
    
    showTotalsToggle.addEventListener('change', (e) => {
        const show = e.target.checked;
        localStorage.setItem('show_totals', show);
        applyShowTotalsSetting(show);
        showNotification(show ? 'Totali visibili ✓' : 'Totali nascosti');
    });
    
    
    sessionTimeoutSelect.addEventListener('change', (e) => {
        const timeout = parseInt(e.target.value);
        localStorage.setItem('session_timeout', timeout);
        initSessionTimeout(timeout);
        
        if (timeout === 0) {
            showNotification('Timeout sessione disabilitato');
        } else {
            const minutes = Math.floor(timeout / 60000);
            showNotification(`Timeout impostato: ${minutes} minuti`);
        }
    });

    
    clearCacheBtn?.addEventListener('click', async () => {
        clearCacheBtn.disabled = true;
        clearCacheBtn.textContent = 'Pulizia cache...';

        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
            }

            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));
            }
        } catch (error) {
            console.error('Errore pulizia cache:', error);
        } finally {
            const url = new URL(window.location.href);
            url.searchParams.set('cacheBust', Date.now().toString());
            window.location.replace(url.toString());
        }
    });
}


function applyShowTotalsSetting(show) {
    const style = document.getElementById('totals-style') || document.createElement('style');
    style.id = 'totals-style';
    
    if (!show) {
        style.textContent = `
            .card-footer .total-amount,
            .card-footer .total-label {
                display: none !important;
            }
        `;
    } else {
        style.textContent = '';
    }
    
    if (!document.getElementById('totals-style')) {
        document.head.appendChild(style);
    }
}


let sessionTimeoutId = null;
let lastActivityTime = Date.now();

function initSessionTimeout(timeout) {
    
    if (sessionTimeoutId) {
        clearTimeout(sessionTimeoutId);
        sessionTimeoutId = null;
    }
    
    if (timeout === 0) return; 
    
    const checkInactivity = () => {
        const inactiveTime = Date.now() - lastActivityTime;
        
        if (inactiveTime >= timeout) {
            
            localStorage.removeItem('shopify_session');
            sessionStorage.removeItem('shopify_orders');
            showNotification('Sessione scaduta per inattività');
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            
            sessionTimeoutId = setTimeout(checkInactivity, 60000);
        }
    };
    
    
    sessionTimeoutId = setTimeout(checkInactivity, 60000);
    
    
    const updateActivity = () => {
        lastActivityTime = Date.now();
    };
    
    
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, updateActivity, { passive: true });
    });
}


function sendDesktopNotification(title, body) {
    const enabled = localStorage.getItem('desktop_notifications') === 'true';
    
    if (enabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: 'https://www.minimalgamers.it/cdn/shop/files/LOGO_MINIMAL_GAMERS.jpg',
            badge: 'https://www.minimalgamers.it/cdn/shop/files/LOGO_MINIMAL_GAMERS.jpg'
        });
    }
}


document.addEventListener('DOMContentLoaded', initBackgroundSelector);


function saveSession(apiKey) {
    const sessionData = {
        apiKey: apiKey,
        expiry: Date.now() + (2 * 60 * 60 * 1000) 
    };
    localStorage.setItem('shopify_session', JSON.stringify(sessionData));
}

function loadSession() {
    const sessionStr = localStorage.getItem('shopify_session');
    if (!sessionStr) return null;
    
    try {
        const session = JSON.parse(sessionStr);
        if (Date.now() > session.expiry) {
            localStorage.removeItem('shopify_session');
            return null;
        }
        return session.apiKey;
    } catch (e) {
        localStorage.removeItem('shopify_session');
        return null;
    }
}

function clearSession() {
    localStorage.removeItem('shopify_session');
}


(async () => {
    try {
        const savedApiKey = loadSession();
        if (savedApiKey) {
            isAuthenticated = true;
            apiKey = savedApiKey;
            accessPassword.style.display = 'none';
            
            
            await syncAndLoadOrders();
            
            
            const sinceIdFilterContainer = document.getElementById('since-id-filter-container');
            if (sinceIdFilterContainer) {
                sinceIdFilterContainer.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Errore caricamento sessione:', error);
        clearSession();
    }
})();


async function syncAndLoadOrders() {
    loadingMessage.style.display = 'block';
    document.querySelector('.submit-arrow').style.display = 'none';
    
    try {
        
        const shopifyResponse = await fetch(API_ENDPOINT, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (!shopifyResponse.ok) {
            if (shopifyResponse.status === 401) {
                clearSession();
                isAuthenticated = false;
                apiKey = null;
                accessPassword.style.display = 'block';
            }
            throw new Error(`Errore Shopify: ${shopifyResponse.status}`);
        }
        
        const shopifyData = await shopifyResponse.json();
        const shopifyOrders = Array.isArray(shopifyData) ? shopifyData : (shopifyData.orders || []);
        
        
        if (shopifyOrders.length > 0) {
            await saveOrdersToDatabase(shopifyOrders);
        }
        
        
        const dbData = await loadOrdersFromDatabase();
        const ordersToDisplay = dbData.orders || [];
        
        
        const sinceIdInput = document.getElementById('since-id-input');
        const orderNumberFilter = sinceIdInput ? sinceIdInput.value.trim().replace('#', '') : '';
        
        let filteredOrders = ordersToDisplay;
        if (orderNumberFilter) {
            const minOrderNumber = parseInt(orderNumberFilter, 10);
            if (!isNaN(minOrderNumber)) {
                filteredOrders = ordersToDisplay.filter(order => {
                    const orderNum = parseInt(order.name.replace('#', ''), 10);
                    return orderNum >= minOrderNumber;
                });
            }
        }
        
        
        await processShopifyOrders(filteredOrders);
        
    } catch (error) {
        console.error('❌ Errore sincronizzazione:', error);
        showError(`Errore: ${error.message}`);
    } finally {
        loadingMessage.style.display = 'none';
        
        document.querySelector('.submit-arrow').style.display = 'none';
    }
}


const passwordForm = document.getElementById('passwordForm');
passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    authenticateUser();
});

accessPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        authenticateUser();
    }
});


async function authenticateUser() {
    const password = accessPassword.value;
    
    if (!password) {
        showError('Inserisci la password');
        return;
    }
    
    errorMessage.style.display = 'none';
    
    try {
        const response = await fetch(AUTH_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: password })
        });
        
        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Errore del server');
            } else {
                const errorText = await response.text();
                console.error('Risposta HTML:', errorText);
                throw new Error('Errore: Verifica che i file siano caricati correttamente');
            }
        }
        
        const data = await response.json();
        
        if (data.success) {
            isAuthenticated = true;
            apiKey = data.api_key;
            saveSession(apiKey); 
            accessPassword.style.display = 'none';
            
            
            await loadOrdersFromShopify();
        } else {
            throw new Error('Autenticazione fallita');
        }
        
    } catch (error) {
        console.error('Errore autenticazione:', error);
        showError(error.message || 'Errore di connessione. Verifica che il backend sia online.');
    }
}


async function saveOrdersToDatabase(orders) {
    try {
        const response = await fetch(SHOPIFY_ORDERS_DB_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orders })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Errore HTTP:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('❌ Errore salvataggio ordini:', error);
        throw error;
    }
}


async function loadOrdersFromDatabase() {
    try {
        const response = await fetch(SHOPIFY_ORDERS_DB_API_URL);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.orders) {
            
            const orders = data.orders.map(dbOrder => {
                
                if (dbOrder.raw_order_data) {
                    return dbOrder.raw_order_data;
                }
                
                
                return {
                    id: dbOrder.shopify_order_id,
                    name: dbOrder.order_name,
                    email: dbOrder.email,
                    customer: dbOrder.customer_name ? {
                        first_name: dbOrder.customer_name.split(' ')[0],
                        last_name: dbOrder.customer_name.split(' ').slice(1).join(' ')
                    } : null,
                    created_at: dbOrder.created_at,
                    financial_status: dbOrder.financial_status,
                    fulfillment_status: dbOrder.fulfillment_status,
                    total_price: dbOrder.total_price,
                    current_total_price: dbOrder.total_price,
                    currency: dbOrder.currency,
                    billing_address: dbOrder.billing_address,
                    line_items: dbOrder.line_items
                };
            });
            
            return { orders };
        }
        
        return { orders: [] };
    } catch (error) {
        console.error('❌ Errore caricamento ordini da DB:', error);
        return { orders: [] };
    }
}


async function loadOrdersFromShopify() {
    if (!apiKey) {
        showError('Errore di autenticazione');
        clearSession();
        return;
    }
    
    
    await syncAndLoadOrders();
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}


async function processShopifyOrders(ordersData) {
    
    const orders = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
    
    document.getElementById('fixed-header').classList.add('loaded');
    document.getElementById('tabs-container').style.display = 'block';
    document.body.classList.add('orders-loaded');
    
    
    document.querySelectorAll('.auth-required').forEach(btn => {
        
        const excludedIds = ['export-btn', 'bulk-replace-btn', 'hidden-orders-btn', 'select-finalized-btn', 'rielabora-selected-btn', 'hide-selected-btn', 'select-orders-btn', 'process-selected-orders-container', 'select-processed-btn', 'finalize-selected-processed-btn', 'move-to-orders-btn', 'move-to-worksheet-container', 'add-manual-order-btn', 'processed-counter', 'orders-counter'];
        if (!excludedIds.includes(btn.id)) {
            btn.style.display = 'block';
        }
    });
    
    
    const activeTab = document.querySelector('.tab-button.active');
    const currentTab = activeTab ? activeTab.dataset.tab : 'orders';
    
    const bulkReplaceBtn = document.getElementById('bulk-replace-btn');
    const hiddenOrdersBtn = document.getElementById('hidden-orders-btn');
    const selectOrdersBtn = document.getElementById('select-orders-btn');
    const selectProcessedBtn = document.getElementById('select-processed-btn');
    const processedCounter = document.getElementById('processed-counter');
    const ordersCounter = document.getElementById('orders-counter');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    
    if (selectOrdersBtn) {
        selectOrdersBtn.style.display = currentTab === 'orders' ? 'block' : 'none';
    }
    if (ordersCounter) {
        ordersCounter.style.display = currentTab === 'orders' ? 'inline-block' : 'none';
    }
    if (bulkReplaceBtn) {
        bulkReplaceBtn.style.display = isProcessedTab(currentTab) ? 'block' : 'none';
    }
    if (processedCounter) {
        processedCounter.style.display = isProcessedTab(currentTab) ? 'inline-block' : 'none';
    }
    if (selectProcessedBtn) {
        selectProcessedBtn.style.display = isProcessedTab(currentTab) ? 'block' : 'none';
    }
    if (exportExcelBtn) {
        exportExcelBtn.style.display = isProcessedTab(currentTab) ? 'flex' : 'none';
    }
    if (hiddenOrdersBtn) {
        hiddenOrdersBtn.style.display = currentTab === 'finalized' ? 'block' : 'none';
    }
    
    
    const addManualOrderBtn = document.getElementById('add-manual-order-btn');
    if (addManualOrderBtn) {
        addManualOrderBtn.style.display = isProcessedTab(currentTab) ? 'flex' : 'none';
    }

    updateSupplierSummaryButtonVisibility(currentTab);
    
    
    sessionStorage.setItem('shopify_orders', JSON.stringify(orders));
    
    
    const paidOrders = orders.filter(o => o.financial_status === 'paid');
    
    
    await loadOrderedIdsFromDB();
    
    
    await loadProcessedOrdersFromDB();
    
    
    const processedOrderIds = await getProcessedOrderIdsFromDB();
    
    
    
    await loadGpoMappingsGlobal();
    
    
    await loadOrderStatusesFromDB();
    
    
    await loadOperatorAssignmentsFromDB();
    
    
    await loadHiddenOrdersFromDB();
    
    
    const pendingOrders = paidOrders.filter(o => {
        if (o.fulfillment_status === 'fulfilled' || isOrderOrdered(o.id) || isOrderHidden(o.id)) {
            return false;
        }
        
        
        const pcItems = o.line_items?.filter(item => {
            const itemName = item.name || item.title || '';
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true) !== null;
        }) || [];
        
        let totalPCs = 0;
        for (const pcItem of pcItems) {
            totalPCs += (pcItem.quantity || 1);
        }
        
        if (totalPCs > 1) {
            
            let allProcessed = true;
            for (let i = 1; i <= totalPCs; i++) {
                const splitId = String(o.id) + '.' + i;
                if (!processedOrderIds.includes(splitId)) {
                    allProcessed = false;
                    break;
                }
            }
            
            return !allProcessed;
        } else {
            
            return !isOrderProcessed(o.id, processedOrderIds);
        }
    });
    
    const orderedOrders = paidOrders.filter(o => 
        (o.fulfillment_status === 'fulfilled' || isOrderOrdered(o.id)) &&
        !isOrderHidden(o.id)
    );
    const processedOrders = paidOrders.filter(o => isOrderProcessed(o.id, processedOrderIds) && !isOrderHidden(o.id));
    const hiddenOrders = paidOrders.filter(o => isOrderHidden(o.id));
    
    const pendingOrdersMap = new Map();
    const orderedOrdersMap = new Map();
    processedOrdersMap.clear(); 
    
    
    
    processPendingOrdersWithSplitting(pendingOrders, pendingOrdersMap, processedOrderIds);
    
    
    orderedOrders.forEach(order => {
        const orderName = order.name || order.order_number;
        orderedOrdersMap.set(orderName, {
            id: order.id,
            name: orderName,
            email: order.email || order.customer?.email || 'N/A',
            phone: getPreferredCustomerPhone(order),
            createdAt: order.created_at,
            financialStatus: order.financial_status,
            fulfillmentStatus: order.fulfillment_status,
            total: order.total_price || order.current_total_price,
            currency: order.currency,
            billingName: order.billing_address?.name || order.customer?.first_name + ' ' + order.customer?.last_name || 'N/A',
            operator: getOperatorAssignment(order.id),
            items: (order.line_items || []).map(item => ({
                name: item.name || item.title,
                quantity: item.quantity,
                customProperties: item.custom_properties || {}
            }))
        });
    });

    
    
    await processProcessedOrdersWithSplitting(processedOrders, processedOrdersMap, processedOrdersCache);
    
    
    
    addSplitOrdersFromCache(processedOrdersCache, processedOrdersMap);
    addFinalizedSplitOrdersFromCache(processedOrdersCache, orderedOrdersMap);
    
    
    for (const [shopifyId, savedOrder] of Object.entries(processedOrdersCache)) {
        if (shopifyId.startsWith('MANUAL_')) {
            const orderName = savedOrder.orderIdFlip || shopifyId;
            
            
            if (isOrderHidden(shopifyId)) {
                
                const orderData = {
                    id: shopifyId,
                    name: orderName,
                    email: savedOrder.customerEmail || 'N/A',
                    phone: savedOrder.customerPhone || 'N/A',
                    createdAt: new Date().toISOString(),
                    financialStatus: 'paid',
                    fulfillmentStatus: null,
                    total: '0',
                    currency: 'EUR',
                    billingName: 'Ordine Manuale',
                    operator: savedOrder.operator || null,
                    foglioDiLavoro: savedOrder.foglioDiLavoro || 1,
                    isManualOrder: true,
                    components: savedOrder.components || [], 
                    items: [{
                        name: 'PC GAMING ' + (savedOrder.configName || 'MANUALE'),
                        quantity: 1,
                        customProperties: {}
                    }]
                };
                
                
                if (!hiddenOrders.some(o => o.id === shopifyId)) {
                    hiddenOrders.push(orderData);
                }
                continue; 
            }
            
            
            const isFinalized = savedOrder.stato === 'finalizzati' || orderedIdsCache.includes(shopifyId);
            
            
            if (!processedOrdersMap.has(orderName) && !orderedOrdersMap.has(orderName)) {
                const orderData = {
                    id: shopifyId,
                    name: orderName,
                    email: savedOrder.customerEmail || 'N/A',
                    phone: savedOrder.customerPhone || 'N/A',
                    createdAt: new Date().toISOString(),
                    financialStatus: 'paid',
                    fulfillmentStatus: null,
                    total: '0',
                    currency: 'EUR',
                    billingName: 'Ordine Manuale',
                    operator: savedOrder.operator || null,
                    foglioDiLavoro: savedOrder.foglioDiLavoro || 1,
                    isManualOrder: true,
                    components: savedOrder.components || [], 
                    items: [{
                        name: 'PC GAMING ' + (savedOrder.configName || 'MANUALE'),
                        quantity: 1,
                        customProperties: {}
                    }]
                };
                
                
                if (isFinalized) {
                    orderedOrdersMap.set(orderName, orderData);
                } else {
                    processedOrdersMap.set(orderName, orderData);
                }
            }
        }
    }

    
    const hiddenOrdersMap = new Map();
    hiddenOrders.forEach(order => {
        const orderName = order.name || order.order_number;
        hiddenOrdersMap.set(orderName, {
            id: order.id,
            name: orderName,
            email: order.email || order.customer?.email || 'N/A',
            phone: getPreferredCustomerPhone(order),
            createdAt: order.created_at,
            financialStatus: order.financial_status,
            fulfillmentStatus: order.fulfillment_status,
            total: order.total_price || order.current_total_price,
            currency: order.currency,
            billingName: order.billing_address?.name || order.customer?.first_name + ' ' + order.customer?.last_name || 'N/A',
            operator: getOperatorAssignment(order.id),
            items: (order.line_items || []).map(item => ({
                name: item.name || item.title,
                quantity: item.quantity,
                customProperties: item.custom_properties || {}
            }))
        });
    });

    renderOrders(pendingOrdersMap, 'orders-container', false);
    const activeWorksheet = getActiveWorksheetTab();
    renderProcessedOrders(getFilteredProcessedOrdersMap(processedOrdersMap, activeWorksheet)); 
    renderOrders(orderedOrdersMap, 'finalized-container', false);
    renderOrders(hiddenOrdersMap, 'hidden-container', false); 
    
    
    updateOrdersCounter();
    updateProcessedCounter(getActiveWorksheetTab());
    
    
    await loadMonthlyCounter();
    
    
    let processedTotal = 0;
    processedOrdersMap.forEach(order => {
        const totalPrice = order.total || '0';
        const priceValue = parseFloat(totalPrice.toString().replace(/[^0-9.-]/g, ''));
        if (!isNaN(priceValue)) {
            processedTotal += priceValue / 100;
        }
    });
    
    
    const countElement = document.getElementById('processed-count');
    const totalElement = document.getElementById('processed-total');
    const totalContainer = document.getElementById('processed-total-container');
    if (countElement) countElement.textContent = monthlyCounter;
    if (totalElement) {
        totalElement.textContent = processedTotal.toFixed(2);
        
        const fullTotal = processedTotal * 100;
        if (totalContainer) {
            totalContainer.title = `Totale 100%: €${fullTotal.toFixed(2)}`;
        }
    }
    
    
    
    
    
    
    
    
    
    
    initializeTabs();
    
    
    initializeBulkReplaceButton();
    
    
    
    
    
    initializeHiddenOrdersButton();

    
    const excelBtn = document.getElementById('export-excel-btn');
    if (excelBtn) {
        excelBtn.disabled = false;
        excelBtn.title = 'Esporta ordini in Excel';
    }
}

function renderOrders(ordersMap, containerId, showPrices) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (ordersMap.size === 0) {
        container.innerHTML = '<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Nessun ordine trovato.</p>';
        return;
    }

    ordersMap.forEach(async order => {

        const card = document.createElement('div');
        card.className = 'order-card';
        card.dataset.orderId = order.id;
        card.dataset.orderName = order.name;

        
        let statusClass = 'status-pending';
        if (order.financialStatus === 'paid') statusClass = 'status-paid';
        else if (order.financialStatus === 'refunded') statusClass = 'status-refunded';

        
        let isToday = false;
        try {
            const orderDate = new Date(order.createdAt);
            const today = new Date();
            isToday = orderDate.getDate() === today.getDate() &&
                     orderDate.getMonth() === today.getMonth() &&
                     orderDate.getFullYear() === today.getFullYear();
        } catch(e) {}
        
        
        const orderNameColor = isToday ? '#bb86fc' : 'inherit';

        
        const itemsHtml = order.items.map(item => {
            let customPropsHtml = '';
            if (item.customProperties && Object.keys(item.customProperties).length > 0) {
                const propsEntries = Object.entries(item.customProperties)
                    .filter(([key]) => !['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name', 'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'].includes(key))
                    .map(([key, value]) => {
                        
                        const displayKey = key.replace(/^_/, '').replace(/_/g, ' ').toUpperCase();
                        return `<div class="custom-prop"><strong>${displayKey}:</strong> ${value}</div>`;
                    })
                    .join('');
                
                if (propsEntries) {
                    customPropsHtml = `<div class="item-config">${propsEntries}</div>`;
                }
            }
            
            return `
                <tr>
                    <td>
                        <strong>${item.name}</strong>
                        <span class="item-quantity">x${item.quantity}</span>
                        ${customPropsHtml}
                    </td>
                </tr>
            `;
        }).join('');
        
        const processButtonHtml = containerId === 'finalized-container'
            ? ''
            : [1, 2, 3, 4].map(sheet =>
                '<button class="process-order-btn" data-order-id="' + order.id + '" data-worksheet="' + sheet + '" style="background: linear-gradient(135deg, #667eea 0%, #5a67d8 100%); color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.72em; font-weight: 700; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 6px rgba(102, 126, 234, 0.3); margin-right: 4px; min-width: 34px;" onmouseover="this.style.transform=\'translateY(-1px)\'; this.style.boxShadow=\'0 3px 9px rgba(102, 126, 234, 0.45)\';" onmouseout="this.style.transform=\'\'; this.style.boxShadow=\'0 1px 6px rgba(102, 126, 234, 0.3)\';" title="Elabora questo ordine nel foglio di lavoro E' + sheet + '">E' + sheet + '</button>'
            ).join('');
        
        const finalizeButtonHtml = containerId === 'finalized-container' 
            ? '' 
            : '<button class="finalize-order-btn" data-order-id="' + order.id + '" style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; border: none; padding: 6px 16px; border-radius: 8px; font-size: 0.85em; font-weight: 600; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);" onmouseover="this.style.transform=\'translateY(-2px)\'; this.style.boxShadow=\'0 4px 12px rgba(76, 175, 80, 0.5)\';" onmouseout="this.style.transform=\'\'; this.style.boxShadow=\'0 2px 8px rgba(76, 175, 80, 0.3)\';" title="Sposta questo ordine direttamente nei Finalizzati">Finalizza</button>';
        
        const restoreButtonHtml = containerId === 'finalized-container' 
            ? '<button class="restore-to-pending-btn" title="Sposta in Ordini"><img src="https://img.icons8.com/?size=512&id=fFl7SUNX1Tte&format=png" style="width: 28px; height: 28px; vertical-align: middle;"></button><button class="hide-order-btn" data-order-id="' + order.id + '" title="Nascondi ordine" style="background: none; border: none; cursor: pointer; margin-left: 8px; opacity: 0.7; transition: opacity 0.3s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7"><img src="https://img.icons8.com/?size=500&id=60022&format=png" style="width: 24px; height: 24px; vertical-align: middle; filter: brightness(0) invert(1);"></button>' 
            : containerId === 'hidden-container'
            ? '<button class="restore-from-hidden-btn" data-order-id="' + order.id + '" title="Ripristina in Finalizzati" style="background: none; border: none; cursor: pointer; opacity: 0.7; transition: opacity 0.3s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7"><img src="https://img.icons8.com/?size=500&id=60022&format=png" style="width: 24px; height: 24px; vertical-align: middle; filter: brightness(0) invert(1);"></button>'
            : '';
        
        
        const orderStatus = getOrderStatus(order.id);
        
        
        let headerStyle = '';
        let headerTextColor = 'inherit';
        let headerIconFilter = '';
        if (containerId === 'finalized-container') {
            if (orderStatus === 'todo') {
                headerStyle = 'background: linear-gradient(135deg, rgba(241, 196, 15, 0.7) 0%, rgba(243, 156, 18, 0.7) 100%); border-bottom: 2px solid rgba(241, 196, 15, 0.9);';
                headerTextColor = '#1a1a1a';
                headerIconFilter = 'brightness(0)';
            } else if (orderStatus === 'inprogress') {
                headerStyle = 'background: linear-gradient(135deg, rgba(52, 152, 219, 0.7) 0%, rgba(41, 128, 185, 0.7) 100%); border-bottom: 2px solid rgba(52, 152, 219, 0.9);';
                headerTextColor = '#1a1a1a';
                headerIconFilter = 'brightness(0)';
            } else if (orderStatus === 'done') {
                headerStyle = 'background: linear-gradient(135deg, rgba(46, 204, 113, 0.7) 0%, rgba(39, 174, 96, 0.7) 100%); border-bottom: 2px solid rgba(46, 204, 113, 0.9);';
                headerTextColor = '#1a1a1a';
                headerIconFilter = 'brightness(0)';
            } else {
                
                headerStyle = 'background: linear-gradient(135deg, rgba(0, 0, 0, 0.5) 0%, rgba(30, 30, 30, 0.5) 100%); border-bottom: 2px solid rgba(50, 50, 50, 0.6);';
                headerTextColor = '#ffffff';
                headerIconFilter = 'brightness(0) invert(1)';
            }
        }
        
        
        const footerHtml = `
            <span class="total-label">Totale</span>
            <span class="total-amount">${order.total} ${order.currency}</span>
        `;
        
        
        const finalHeaderTextColor = containerId === 'finalized-container' ? headerTextColor : orderNameColor;
        const iconFilterStyle = containerId === 'finalized-container' && headerIconFilter ? `filter: ${headerIconFilter};` : '';
        
        card.innerHTML = `
            <div class="card-header" style="${headerStyle}">
                <h2 style="margin: 0; color: ${finalHeaderTextColor};">${order.name}</h2>
                <div class="header-icons" style="${iconFilterStyle}">
                    ${finalizeButtonHtml}
                    ${processButtonHtml}
                    ${restoreButtonHtml}
                </div>
            </div>
            <div class="card-body">
                <table class="line-items">
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>
            </div>
            <div class="card-footer">
                ${footerHtml}
            </div>
        `;

        
        if (containerId === 'finalized-container') {
            const restoreBtn = card.querySelector('.restore-to-pending-btn');
            if (restoreBtn) {
                restoreBtn.addEventListener('click', () => {
                    moveOrderedToPending(order.id, order.name);
                });
            }
        }
        
        
        if (containerId === 'hidden-container') {
            const restoreFromHiddenBtn = card.querySelector('.restore-from-hidden-btn');
            if (restoreFromHiddenBtn) {
                restoreFromHiddenBtn.addEventListener('click', () => {
                    restoreFromHidden(order.id, order.name);
                });
            }
        }

        container.appendChild(card);
    });
}




async function renderProcessedOrders(ordersMap) {
    const renderToken = ++processedRenderToken;
    const container = document.getElementById('processed-container');
    container.innerHTML = '<p style="text-align:center; color: rgba(255,255,255,0.7);">Caricamento componenti...</p>';
    updateSupplierSummaryButtonVisibility();

    const activeTab = document.querySelector('.tab-button.active');
    const activeTabName = activeTab ? activeTab.dataset.tab : 'processed';
    const sourceMap = processedOrdersMap && processedOrdersMap.size > 0 ? processedOrdersMap : ordersMap;
    const ordersToRender = isProcessedTab(activeTabName)
        ? getFilteredProcessedOrdersMap(sourceMap, getWorksheetFromTab(activeTabName))
        : ordersMap;
    
    
    if (customAmazonComponents.length === 0) {
        try {
            const response = await fetch(CUSTOM_COMPONENTS_API_URL);
            if (renderToken !== processedRenderToken) return;
            const data = await response.json();
            if (data.success && data.components) {
                customAmazonComponents = data.components;
            }
        } catch (error) {
            console.error('Errore caricamento componenti Amazon:', error);
        }
    }

    if (renderToken !== processedRenderToken) return;
    
    if (ordersToRender.size === 0) {
        container.innerHTML = '<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Nessun ordine elaborato.</p>';
        updateSupplierSummaryButtonVisibility();
        return;
    }
    
    
    const activeFilter = document.querySelector('.filter-button.active');
    const selectedOperator = activeFilter ? activeFilter.dataset.operator : null;
    
    
    let ordersArray = Array.from(ordersToRender.entries());
    
    
    ordersArray.sort((a, b) => {
        const orderA = a[1];
        const orderB = b[1];
        
        
        const getOrderNumber = (order) => {
            const name = order.name || '';
            const match = name.match(/\d+/);
            return match ? parseInt(match[0]) : 0;
        };
        
        const numA = getOrderNumber(orderA);
        const numB = getOrderNumber(orderB);
        
        
        return numB - numA;
    });
    
    container.innerHTML = ''; 
    
    let filteredCount = 0;
    
    for (const [orderName, order] of ordersArray) {
        if (renderToken !== processedRenderToken) return;
        
        if (selectedOperator && order.operator !== selectedOperator) {
            continue;
        }
        
        filteredCount++;
        
        const card = document.createElement('div');
        card.className = 'order-card order-card-processed';
        card.dataset.orderId = order.id;
        
        
        const isManualOrder = order.isManualOrder || (typeof order.id === 'string' && order.id.startsWith('MANUAL_'));
        
        
        const pcItem = order.items.find(item => {
            const itemName = item.name || item.title || '';
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true) !== null;
        });
        
        if (!pcItem && !isManualOrder) {
            
            container.appendChild(createStandardCard(order));
            continue;
        }
        
        
        let config;
        if (isManualOrder) {
            config = {
                configKey: 'MANUALE',
                components: {}
            };
        } else if (order.configName) {
            
            config = {
                configKey: order.configName,
                components: {} 
            };
        } else {
            config = identifyPCConfig(pcItem.name);
        }
        
        if (!config) {
            
            container.appendChild(createStandardCard(order));
            continue;
        }
        
        
        const assignedOperator = getOperatorAssignment(order.id);
        
        
        const itemsHtml = order.items.map(item => {
            let customPropsHtml = '';
            if (item.customProperties && Object.keys(item.customProperties).length > 0) {
                const propsEntries = Object.entries(item.customProperties)
                    .filter(([key]) => !['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name', 'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'].includes(key))
                    .map(([key, value]) => {
                        const displayKey = key.replace(/^_/, '').replace(/_/g, ' ').toUpperCase();
                        return `<div class="custom-prop"><strong>${displayKey}:</strong> ${value}</div>`;
                    })
                    .join('');
                
                if (propsEntries) {
                    customPropsHtml = `<div class="item-config">${propsEntries}</div>`;
                }
            }
            
            return `
                <tr>
                    <td>
                        <strong>${item.name}</strong>
                        <span class="item-quantity">x${item.quantity}</span>
                        ${customPropsHtml}
                    </td>
                </tr>
            `;
        }).join('');
        
        
        const cleanConfigName = config.configKey;
        const isFallbackMatch = config.isFallback || false;
        const fallbackReason = config.fallbackReason || '';
        
        
        let operatorLetter = '';
        let operatorColor = 'rgba(255,255,255,0.5)';
        if (assignedOperator === 'OperatoreA') {
            operatorLetter = 'A';
            operatorColor = '#3498db';
        } else if (assignedOperator === 'OperatoreB') {
            operatorLetter = 'B';
            operatorColor = '#9b59b6';
        }
        
        card.innerHTML = `
            <div class="flip-container">
                <div class="flip-front">
                    <div class="card-header">
                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                            <h2 style="margin: 0; cursor: pointer;" class="order-id-flip" data-order-id="${order.id}">${order.name}</h2>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="config-badge" style="${isFallbackMatch ? 'background: rgba(241, 196, 15, 0.3); border-color: rgba(241, 196, 15, 0.6); color: #f1c40f;' : ''}" title="${isFallbackMatch ? '⚠️ FALLBACK: ' + fallbackReason : ''}">${isFallbackMatch ? '⚠️ ' : ''}${cleanConfigName}</span>
                                <div class="operator-selector" data-order-id="${order.id}" style="width: 24px; height: 24px; border-radius: 6px; background: rgba(0,0,0,0.4); border: 2px solid ${operatorColor}; display: flex; align-items: center; justify-content: center; cursor: pointer; font-weight: 700; font-size: 0.85em; color: ${operatorColor}; transition: all 0.3s ease; flex-shrink: 0;" title="Click per cambiare operatore">
                                    ${operatorLetter || '?'}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card-body">
                        <div id="components-${order.id}" style="color: rgba(255,255,255,0.8); font-size: 0.95em; line-height: 1.8;">
                            Caricamento componenti...
                        </div>
                        <div id="custom-items-${order.id}" style="margin-top: 15px;">
                        </div>
                    </div>
                    <div class="card-footer" style="padding: 15px; background: rgba(0, 0, 0, 0.2); border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; gap: 12px; align-items: center;">
                        <button class="add-custom-item-btn" data-order-id="${order.id}" style="background: rgba(33, 150, 243, 0.2); border: 1px dashed rgba(33, 150, 243, 0.5); color: #2196F3; padding: 10px 16px; border-radius: 6px; cursor: pointer; flex: 1; font-weight: 600; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(33, 150, 243, 0.3)'" onmouseout="this.style.background='rgba(33, 150, 243, 0.2)'">
                            + Aggiungi voce personalizzata
                        </button>
                        ${order.email && order.email !== 'N/A' ? `
                        <a href="#" class="contact-email-btn" style="background: none; border: none; cursor: pointer; padding: 4px; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; opacity: 0.8; text-decoration: none;" onmouseover="this.style.opacity='1'; this.style.transform='scale(1.1)'" onmouseout="this.style.opacity='0.8'; this.style.transform='scale(1)'" title="Invia Email con template">
                            <img src="assets/img/gmail.avif" alt="Email" style="width: 28px; height: 28px;">
                        </a>
                        ` : ''}
                        ${order.phone && order.phone !== 'N/A' ? `
                        <a href="#" class="contact-whatsapp-btn" style="background: none; border: none; cursor: pointer; padding: 4px; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; opacity: 0.8; text-decoration: none;" onmouseover="this.style.opacity='1'; this.style.transform='scale(1.1)'" onmouseout="this.style.opacity='0.8'; this.style.transform='scale(1)'" title="Contatta su WhatsApp con template">
                            <img src="assets/img/whatsapp.avif" alt="WhatsApp" style="width: 28px; height: 28px;">
                        </a>
                        ` : ''}
                    </div>
                </div>
                
                <div class="flip-back">
                    <div class="card-header">
                        <h2 style="margin: 0; cursor: pointer;" class="order-id-flip" data-order-id="${order.id}">${order.name}</h2>
                    </div>
                    <div class="card-body">
                        <table class="line-items">
                            <tbody>
                                ${itemsHtml}
                            </tbody>
                        </table>
                    </div>
                    <div class="card-footer">
                        <span class="total-label">Totale</span>
                        <span class="total-amount">${order.total} ${order.currency}</span>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(card);

        const emailBtn = card.querySelector('.contact-email-btn');
        if (emailBtn) {
            emailBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                const liveOrder = getCurrentProcessedOrderById(order.id) || order;
                const components = collectOrderComponentsForMessaging(order.id, liveOrder);
                await contactWithTemplateSelection('email', liveOrder, components);
            });
        }

        const whatsappBtn = card.querySelector('.contact-whatsapp-btn');
        if (whatsappBtn) {
            whatsappBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                const liveOrder = getCurrentProcessedOrderById(order.id) || order;
                const components = collectOrderComponentsForMessaging(order.id, liveOrder);
                await contactWithTemplateSelection('whatsapp', liveOrder, components);
            });
        }
        
        
        if (isManualOrder) {
            
            loadManualOrderComponents(order.id);
        } else {
            
            loadComponentsForOrder(order.id, config.components, pcItem.customProperties || {}, order.items);
        }
        
        
        await loadCustomItems(order.id);
    }
    
    
    if (filteredCount === 0) {
        if (selectedOperator) {
            container.innerHTML = `<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Nessun ordine assegnato a ${selectedOperator}.</p>`;
        } else {
            container.innerHTML = '<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Nessun ordine elaborato.</p>';
        }
    }

    updateSupplierSummaryButtonVisibility();
    
    
    updateProcessedCounter(getWorksheetFromTab(activeTabName));
    
    
    setTimeout(() => {
        const exportExcelBtn = document.getElementById('export-excel-btn');
        if (exportExcelBtn) {
            exportExcelBtn.disabled = false;
            exportExcelBtn.title = 'Esporta ordini in Excel';
        }
    }, 8000);
}




function updateProcessedCounter(worksheetNumber = null) {
    const counter = document.getElementById('processed-counter');
    if (!counter) return;

    const worksheet = Math.min(4, Math.max(1, parseInt(worksheetNumber, 10) || getActiveWorksheetTab()));
    let count = 0;

    
    const cacheValues = Object.values(processedOrdersCache || {});
    if (cacheValues.length > 0) {
        count = cacheValues.filter(order => {
            const stato = order?.stato || 'elaborati';
            if (stato === 'finalizzati') return false;
            const foglio = Math.min(4, Math.max(1, parseInt(order?.foglioDiLavoro, 10) || 1));
            return foglio === worksheet;
        }).length;
    } else {
        
        const filteredMap = getFilteredProcessedOrdersMap(processedOrdersMap, worksheet);
        count = filteredMap.size;
    }

    counter.textContent = String(count);
}




function updateOrdersCounter() {
    const counter = document.getElementById('orders-counter');
    if (counter) {
        const ordersContainer = document.getElementById('orders-container');
        const count = ordersContainer ? ordersContainer.querySelectorAll('.order-card').length : 0;
        counter.textContent = count;
    }
}





function splitRAMandSSD(value) {
    const upperValue = value.toUpperCase();
    
    
    const hasRAM = upperValue.includes('DDR') || upperValue.match(/\d+GB\s*(DDR|RAM)/i);
    const hasSSD = upperValue.includes('SSD') || upperValue.includes('M.2') || upperValue.includes('NVME') || upperValue.includes('TB') || upperValue.includes('SATA');
    
    if (!hasRAM || !hasSSD) {
        return { ram: null, ssd: null, original: value };
    }
    
    
    const parts = value.split(/\s*\+\s*/);
    
    if (parts.length !== 2) {
        return { ram: null, ssd: null, original: value };
    }
    
    
    let ramPart = null;
    let ssdPart = null;
    
    parts.forEach(part => {
        const upperPart = part.toUpperCase();
        if (upperPart.includes('DDR') || upperPart.match(/\d+GB\s*(DDR|RAM)/i)) {
            ramPart = part.trim();
            
            if (!ramPart.includes('(')) {
                ramPart = `${ramPart} (AMAZON)`;
            }
        } else if (upperPart.includes('TB') || upperPart.includes('M.2') || upperPart.includes('SSD') || upperPart.includes('NVME')) {
            ssdPart = part.trim();
            
            
            if (upperPart.includes('1TB') || upperPart.includes('1 TB')) {
                ssdPart = '3076 (TIER ONE)';
            } else if (upperPart.includes('500GB') || upperPart.includes('500 GB')) {
                ssdPart = '6082 (TIER ONE)';
            } else {
                
                if (!ssdPart.includes('(')) {
                    ssdPart = `${ssdPart} (TIER ONE)`;
                }
            }
        }
    });
    
    return { ram: ramPart, ssd: ssdPart, original: value };
}






async function searchCaseEANByName(caseName) {
    
    const caseNameMapping = {
        'MINIMAL CASE WHITE': 'Noua Vision Mini ZH100 White',
        'MINIMAL CASE BLACK': 'Noua Vision Mini ZK100 Black'
    };
    
    const normalizeCaseName = (value) => String(value || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[‐‑‒–—―]/g, '-')
        .replace(/\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    
    const searchName = caseNameMapping[normalizeCaseName(caseName)] || caseName;
    
    try {
        const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(searchName)}&type=Case_PC`);
        const data = await response.json();
        
        if (data.success && data.components && data.components.length > 0) {
            const targetName = normalizeCaseName(searchName);

            
            const exactMatch = data.components.find(c => normalizeCaseName(c.nome) === targetName);
            
            if (exactMatch && exactMatch.ean) {
                return exactMatch.ean;
            }

            
            const containsMatch = data.components.find(c => {
                const normalizedName = normalizeCaseName(c.nome);
                return normalizedName.includes(targetName) || targetName.includes(normalizedName);
            });

            if (containsMatch && containsMatch.ean) {
                return containsMatch.ean;
            }

            
            return null;
        }
        
        return null;
    } catch (error) {
        console.error(`❌ Errore ricerca EAN per CASE "${caseName}":`, error);
        return null;
    }
}






function isEANCode(value) {
    
    const cleanValue = value.replace(/\s*\([^)]+\)\s*$/, '').trim();
    
    
    return /^[0-9A-Z-]{4,20}$/i.test(cleanValue) && !cleanValue.includes(' ');
}





function identifyComponentTypeFromValue(value) {
    
    if (!value || typeof value !== 'string') {
        return null;
    }
    
    const upperValue = value.toUpperCase();
    const hasAddonHint = upperValue.includes('ADDON') || upperValue.includes('ADD-ON') || upperValue.includes('AGGIUNT');
    const hasStorageHint = upperValue.includes('SSD') ||
                           upperValue.includes('M.2') ||
                           upperValue.includes('M2') ||
                           upperValue.includes('NVME') ||
                           upperValue.includes('SATA') ||
                           upperValue.includes('STORAGE') ||
                           upperValue.includes('ARCHIVIAZ');

    
    if (hasAddonHint && hasStorageHint) {
        return 'SSD ADDON';
    }
    
    
    if (upperValue.includes('RAM') || 
        upperValue.match(/\d+GB\s*DDR[345]/i) ||
        upperValue.includes('MEMORIA')) {
        return 'RAM';
    }
    
    
    if ((upperValue.includes('SSD') || 
        upperValue.includes('M.2') || 
        upperValue.includes('M2') ||
        upperValue.includes('NVME') ||
        upperValue.includes('STORAGE') ||
        upperValue.includes('ARCHIVIAZ') ||
        upperValue.includes('SATA')) &&
        !hasAddonHint) {
        return 'SSD';
    }
    
    
    if (upperValue.includes('RTX') || 
        upperValue.includes('GTX') ||
        upperValue.includes('RX ') ||
        upperValue.includes('GPU') ||
        upperValue.includes('SCHEDA VIDEO') ||
        upperValue.includes('GDDR')) {
        return 'GPU';
    }
    
    
    if (upperValue.includes('RYZEN') || 
        upperValue.includes('INTEL') ||
        upperValue.includes('CORE I') ||
        upperValue.includes('PROCESSORE') ||
        upperValue.match(/I[3579]-\d+/)) {
        return 'CPU';
    }
    
    
    if (upperValue.includes('MOTHERBOARD') || 
        upperValue.includes('SCHEDA MADRE') ||
        upperValue.match(/^MOBO\s*:/i) ||
        upperValue.match(/B\d{3}[A-Z]/i) ||
        upperValue.match(/X\d{3}/i) ||
        upperValue.match(/Z\d{3}/i)) {
        return 'SCHEDA MADRE';
    }
    
    
    
    
    
    
    
    if (upperValue.includes('ALIMENTATORE') ||
        upperValue.includes('PSU') ||
        /\bALI\b/.test(upperValue) ||
        upperValue.match(/\d+W/)) {
        return 'PSU';
    }
    
    
    if (upperValue.includes('CASE') || 
        upperValue.includes('CABINET') ||
        upperValue.includes('CHASSIS') ||
        upperValue.match(/\bH\d{2,3}\b/i) || 
        upperValue.match(/\bH\d{2,3}\s*(ELITE|FLOW|i|COMPACT)/i) || 
        upperValue.includes('TOWER') ||
        upperValue.includes('MIDI') ||
        upperValue.includes('MINI-ITX') ||
        upperValue.includes('ATX')) {
        return 'CASE';
    }
    
    
    if (upperValue.includes('MONITOR') || 
        upperValue.includes('DISPLAY') ||
        upperValue.includes('SCHERMO')) {
        return 'MONITOR';
    }
    
    
    if (upperValue.includes('KIT') || 
        upperValue.includes('TASTIERA') ||
        upperValue.includes('MOUSE') ||
        upperValue.includes('CUFFIE')) {
        return 'KIT GAMING';
    }
    
    return null; 
}




async function loadManualOrderComponents(orderId) {
    const componentsContainer = document.getElementById(`components-${orderId}`);
    
    if (!componentsContainer) {
        console.error(`Container componenti non trovato per ordine manuale ${orderId}`);
        updateSupplierSummaryButtonVisibility();
        return;
    }
    
    
    const savedOrder = processedOrdersCache[orderId];
    
    if (!savedOrder || !savedOrder.components || savedOrder.components.length === 0) {
        componentsContainer.innerHTML = '<p style="color: rgba(255,255,255,0.5); font-style: italic;">Nessun componente trovato</p>';
        updateSupplierSummaryButtonVisibility();
        return;
    }
    
    const customItems = await loadCustomItemsFromDB(orderId);
    const customMatchers = buildCustomItemMatchers(customItems);

    
    let html = '';
    
    for (const comp of savedOrder.components) {
        const componentType = comp.type || 'ALTRO';
        const componentName = comp.name || 'N/A';
        const componentEan = comp.ean || 'MANUALE';
        const supplier = comp.supplier || '';

        if (isDuplicateOfCustomItem(componentEan, componentName, customMatchers)) {
            continue;
        }
        
        
        let supplierColor = '#95a5a6';
        if (supplier === 'PROKS') supplierColor = '#e74c3c';
        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        else if (supplier === 'MSI') supplierColor = '#d35400';
        else if (supplier === 'CASEKING') supplierColor = '#16a085';
        else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
        
        
        html += `
            <div class="component-row" data-order-id="${orderId}" data-component-type="${componentType}" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; transition: background 0.3s;">
                <div style="flex: 1; overflow: hidden; display: flex; align-items: center; flex-wrap: nowrap;">
                    <strong style="color: #5dade2; font-size: 0.9em; white-space: nowrap;">${componentType}:</strong>
                    <span data-order-id="${orderId}" data-component-type="${componentType}" data-original-value="${componentEan}" data-ean="${componentEan}" class="component-name-display" title="EAN: ${componentEan}" style="color: rgba(255,255,255,0.95); padding: 2px 4px; font-size: 0.88em; font-weight: 600; margin-left: 8px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Caricamento...</span>
                </div>
                <span class="supplier-badge-clickable" data-order-id="${orderId}" data-component-type="${componentType}" data-supplier="${supplier || ''}" style="background: ${supplier ? supplierColor + '33' : 'rgba(149,165,166,0.2)'}; color: ${supplier ? supplierColor : '#95a5a6'}; padding: 2px 4px; border-radius: 4px; font-size: 0.75em; font-weight: 600; border: 1px solid ${supplier ? supplierColor + '66' : 'rgba(149,165,166,0.4)'}; min-width: 28px; text-align: center; display: inline-block; flex-shrink: 0; cursor: pointer;">${supplier ? getSupplierAbbreviation(supplier) : '--'}</span>
            </div>
        `;
    }
    
    componentsContainer.innerHTML = html;
    
    
    await loadProductNamesForEANs(orderId);
}









async function loadComponentsForOrder(orderId, baseComponents, variants = {}, allItems = []) {
    const componentsContainer = document.getElementById(`components-${orderId}`);
    
    
    
    
    const savedComponents = processedOrdersCache[orderId]?.components || [];
    
    
    if (savedComponents.length > 0) {
        
        renderComponentsFromDatabase(orderId, savedComponents, allItems);
        return;
    }
    
    
    
    
    let finalComponents = JSON.parse(JSON.stringify(baseComponents));
    
    
    const ramSsdVariants = [];
    const normalVariants = [];
    
    for (const [key, value] of Object.entries(variants)) {
        if (['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name', 'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'].includes(key) || !value) continue;

        
        const splitResult = splitRAMandSSD(value);
        if (splitResult.ram && splitResult.ssd) {
            
            ramSsdVariants.push({ key, value });
        } else {
            
            normalVariants.push({ key, value });
        }
    }
    
    
    for (const { key, value } of normalVariants) {
        
        const upperKey = key.toUpperCase();
        const upperValue = String(value || '').toUpperCase();
        const hasAddonHint = (text) => {
            const upperText = String(text || '').toUpperCase();
            return upperText.includes('ADDON') || upperText.includes('ADD-ON') || upperText.includes('AGGIUNT');
        };
        const hasStorageHint = (text) => {
            const upperText = String(text || '').toUpperCase();
            return upperText.includes('SSD') ||
                   upperText.includes('M.2') ||
                   upperText.includes('M2') ||
                   upperText.includes('NVME') ||
                   upperText.includes('SATA') ||
                   upperText.includes('STORAGE') ||
                   upperText.includes('ARCHIVIAZ');
        };
        const isSsdAddon =
            (hasAddonHint(upperKey) && hasStorageHint(`${upperKey} ${upperValue}`)) ||
            (hasAddonHint(upperValue) && hasStorageHint(upperValue));
        let componentType = null;
        
        if (upperKey.includes('CASE') || upperKey.includes('CABINET') || upperKey.includes('CHASSIS')) {
            componentType = 'CASE';
        } else if (upperKey.includes('CPU') || upperKey.includes('PROCESSORE')) {
            componentType = 'CPU';
        } else if (upperKey.includes('PSU') || upperKey.includes('ALIMENTATORE')) {
            componentType = 'PSU';
        } else if (upperKey.includes('MONITOR')) {
            componentType = 'MONITOR';
        } else if (upperKey.includes('COOLER') || upperKey.includes('DISSIPATORE') || upperKey.includes('RAFFREDDAMENTO')) {
            componentType = 'COOLER';
        } else if (isSsdAddon) {
            componentType = 'SSD ADDON';
        } else if (upperKey.includes('SCHEDA MADRE') || upperKey.includes('MOTHERBOARD') || upperKey.includes('MOBO')) {
            componentType = 'SCHEDA MADRE';
        } else if (upperKey.includes('GPU') || upperKey.includes('SCHEDA VIDEO')) {
            componentType = 'GPU';
        } else if (upperKey.includes('RAM') || upperKey.includes('MEMORIA')) {
            componentType = 'RAM';
        } else if (upperKey.includes('SSD') && !upperKey.includes('ADDON')) {
            componentType = 'SSD';
        } else {
            componentType = identifyComponentTypeFromValue(value);
        }
        
        if (!componentType) continue;

        if (componentType === 'MONITOR' || componentType === 'KIT GAMING') {
            continue;
        }
        
        
        const gpoSearchType = componentType;
        let baseComponentType = componentType;
        if (componentType === 'SCHEDA MADRE') baseComponentType = 'MOBO';
        if (componentType === 'SSD ADDON' || componentType === 'SSD AGGIUNTIVO') baseComponentType = 'SSD ADDON';
        if (componentType === 'DISSIPATORE') baseComponentType = 'COOLER';
        
        
        const componentIndex = finalComponents.findIndex(c => 
            c.type.toUpperCase() === baseComponentType.toUpperCase()
        );
        
        let variantValue = value;
        
        
        const gpoMappableTypes = ['CPU', 'PSU', 'ALIMENTATORE', 'CASE', 'GPU', 'SCHEDA MADRE', 'SSD', 'SSD ADDON', 'RAM', 'COOLER', 'DISSIPATORE'];
        if (gpoMappableTypes.includes(gpoSearchType)) {
            const gpoMatch = findGpoMapping(gpoSearchType, value);
            if (gpoMatch) {
                variantValue = gpoMatch.supplier 
                    ? `${gpoMatch.ean} (${gpoMatch.supplier})` 
                    : gpoMatch.ean;
                
                if (componentIndex !== -1) {
                    finalComponents[componentIndex] = {
                        type: finalComponents[componentIndex].type,
                        value: variantValue
                    };
                } else {
                    updateComponentIfExists(finalComponents, baseComponentType, variantValue, `GPO ${baseComponentType}`);
                }
                continue;
            }
        }
        
        
        if (componentType === 'SSD ADDON' || componentType === 'SSD AGGIUNTIVO') {
            if (value.toUpperCase().includes('1TB') || value.toUpperCase().includes('1 TB')) {
                variantValue = '3076 (TIER ONE)';
            } else if (!value.includes('(')) {
                variantValue = `${value} (TIER ONE)`;
            }
        } else if (componentType === 'CASE') {
            const caseValueClean = value.replace(/\s*\([^)]+\)\s*$/, '').trim();
            if (!isEANCode(caseValueClean)) {
                const foundEAN = await searchCaseEANByName(caseValueClean);
                if (foundEAN) {
                    const supplierMatch = value.match(/\(([^)]+)\)$/);
                    let supplier = supplierMatch ? supplierMatch[1] : null;
                    
                    if (!supplier && componentIndex !== -1) {
                        const originalSupplier = finalComponents[componentIndex].value.match(/\((.+?)\)$/);
                        supplier = originalSupplier ? originalSupplier[1] : 'NOUA';
                    }
                    
                    variantValue = supplier ? `${foundEAN} (${supplier})` : foundEAN;
                } else {
                    const variantMatch = value.match(/^(.+?)\s*\((.+?)\)$/);
                    if (!variantMatch && componentIndex !== -1) {
                        const originalSupplier = finalComponents[componentIndex].value.match(/\((.+?)\)$/);
                        const supplierPart = originalSupplier ? ` ${originalSupplier[0]}` : '';
                        variantValue = `${value}${supplierPart}`;
                    }
                }
            } else {
                const variantMatch = value.match(/^(.+?)\s*\((.+?)\)$/);
                if (!variantMatch && componentIndex !== -1) {
                    const originalSupplier = finalComponents[componentIndex].value.match(/\((.+?)\)$/);
                    const supplierPart = originalSupplier ? ` ${originalSupplier[0]}` : '';
                    variantValue = `${value}${supplierPart}`;
                }
            }
        } else {
            const variantMatch = value.match(/^(.+?)\s*\((.+?)\)$/);
            
            if (componentIndex !== -1) {
                if (!variantMatch) {
                    const originalSupplier = finalComponents[componentIndex].value.match(/\((.+?)\)$/);
                    const supplierPart = originalSupplier ? ` ${originalSupplier[0]}` : '';
                    variantValue = `${value}${supplierPart}`;
                }
            }
        }
        
        
        if (componentIndex !== -1) {
            finalComponents[componentIndex] = {
                type: finalComponents[componentIndex].type,
                value: variantValue
            };
        } else {
            updateComponentIfExists(finalComponents, baseComponentType, variantValue, `variant ${baseComponentType}`);
        }
    }
    
    
    for (const { key, value } of ramSsdVariants) {
        const splitResult = splitRAMandSSD(value);
        
        
        
        const ramGpoMatchComplete = findGpoMapping('RAM', value);
        
        const ssdGpoMatchComplete = findGpoMapping('SSD', value);
        
        if (ramGpoMatchComplete || ssdGpoMatchComplete) {
            
            
            
            if (ramGpoMatchComplete) {
                const ramIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'RAM');
                const ramValue = ramGpoMatchComplete.supplier 
                    ? `${ramGpoMatchComplete.ean} (${ramGpoMatchComplete.supplier})` 
                    : ramGpoMatchComplete.ean;
                
                updateComponentIfExists(finalComponents, 'RAM', ramValue, 'RAM complete mapping');
            } else {
                
                const ramIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'RAM');
                let ramValue = splitResult.ram;
                
                const ramGpoMatch = findGpoMapping('RAM', splitResult.ram);
                if (ramGpoMatch) {
                    ramValue = ramGpoMatch.supplier 
                        ? `${ramGpoMatch.ean} (${ramGpoMatch.supplier})` 
                        : ramGpoMatch.ean;
                }
                
                updateComponentIfExists(finalComponents, 'RAM', ramValue, 'RAM split mapping');
            }
            
            
            if (ssdGpoMatchComplete) {
                const ssdIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'SSD');
                const ssdValue = ssdGpoMatchComplete.supplier 
                    ? `${ssdGpoMatchComplete.ean} (${ssdGpoMatchComplete.supplier})` 
                    : ssdGpoMatchComplete.ean;
                
                updateComponentIfExists(finalComponents, 'SSD', ssdValue, 'SSD complete mapping');
            } else {
                
                const ssdIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'SSD');
                let ssdValue = splitResult.ssd;
                
                const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd);
                if (ssdGpoMatch) {
                    ssdValue = ssdGpoMatch.supplier 
                        ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` 
                        : ssdGpoMatch.ean;
                }
                
                updateComponentIfExists(finalComponents, 'SSD', ssdValue, 'SSD split mapping');
            }
        } else {
            
            
            
            const ramIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'RAM');
            let ramValue = splitResult.ram;
            
            const ramGpoMatch = findGpoMapping('RAM', splitResult.ram);
            if (ramGpoMatch) {
                ramValue = ramGpoMatch.supplier 
                    ? `${ramGpoMatch.ean} (${ramGpoMatch.supplier})` 
                    : ramGpoMatch.ean;
            }
            
            updateComponentIfExists(finalComponents, 'RAM', ramValue, 'RAM direct split');
            
            
            const ssdIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'SSD');
            let ssdValue = splitResult.ssd;
            
            const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd);
            if (ssdGpoMatch) {
                ssdValue = ssdGpoMatch.supplier 
                    ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` 
                    : ssdGpoMatch.ean;
            }
            
            updateComponentIfExists(finalComponents, 'SSD', ssdValue, 'SSD direct split');
        }
    }
    
    
    if (allItems && allItems.length > 0) {
        const kitItem = allItems.find(item => {
            const itemName = item.name || item.title || '';
            return itemName.toUpperCase().includes('KIT') && 
                   !itemName.toUpperCase().includes('PC GAMING') &&
                   identifyPCConfig(itemName, true) === null;
        });
        
        if (kitItem) {
            const kitValue = String(kitItem.sku || '').trim() || kitItem.name;
            const kitIndex = finalComponents.findIndex(component => String(component.type || '').toUpperCase() === 'KIT GAMING');
            if (kitIndex !== -1) {
                finalComponents[kitIndex] = {
                    type: finalComponents[kitIndex].type,
                    value: kitValue
                };
            } else {
                finalComponents.push({
                    type: 'KIT GAMING',
                    value: kitValue
                });
            }
        }

        const monitorItem = allItems.find(item => {
            const itemName = item.name || item.title || '';
            const upperItemName = itemName.toUpperCase();
            const customProps = item.customProperties || item.custom_properties || {};
            const hasCustomProps = customProps && Object.keys(customProps).length > 0;
            const hasExplicitMonitor = upperItemName.includes('MONITOR');
            const hasMonitorKeyword = hasExplicitMonitor ||
                upperItemName.includes('DISPLAY') ||
                upperItemName.includes('SCHERMO');
            const nonMonitorHints = [
                'DISSIPAT', 'COOLER', 'AIO', 'LIQUID', 'CPU', 'GPU', 'RAM', 'SSD', 'NVME',
                'M.2', 'M2', 'ALIMENTAT', 'PSU', 'SCHEDA MADRE', 'MOBO', 'CASE', 'VENTOLA',
                'FAN', 'KIT', 'TASTIERA', 'MOUSE', 'CUFFIE'
            ];
            const hasNonMonitorHints = !hasExplicitMonitor && nonMonitorHints.some(hint => upperItemName.includes(hint));

            return hasMonitorKeyword &&
                   !hasNonMonitorHints &&
                   !hasCustomProps &&
                   !upperItemName.includes('PC GAMING') &&
                   identifyPCConfig(itemName, true) === null;
        });

        if (monitorItem) {
            const monitorIndex = finalComponents.findIndex(component => String(component.type || '').toUpperCase() === 'MONITOR');
            const monitorValue = 'Generico (AMAZON)';
            if (monitorIndex !== -1) {
                finalComponents[monitorIndex] = {
                    type: finalComponents[monitorIndex].type,
                    value: monitorValue
                };
            } else {
                finalComponents.push({
                    type: 'MONITOR',
                    value: monitorValue
                });
            }
        }
    }
    
    
    let html = '';
    const customItems = await loadCustomItemsFromDB(orderId);
    const customMatchers = buildCustomItemMatchers(customItems);
    
    const eanModifications = loadEANModifications(orderId);
    const supplierModifications = loadSupplierModifications(orderId);
    const deletedComponents = loadDeletedComponents(orderId);
    
    for (const component of finalComponents) {
        if (deletedComponents.includes(component.type)) continue;
        
        const match = component.value.match(/^(.+?)\s*\((.+?)\)$/);
        
        let ean = component.value;
        let supplier = component.supplier ? String(component.supplier).trim().toUpperCase() : '';
        
        if (match) {
            ean = match[1].trim();
            if (!supplier) {
                supplier = match[2].trim();
            }
        }
        
        if (eanModifications[component.type]) {
            ean = eanModifications[component.type];
        }
        
        if (supplierModifications[component.type]) {
            supplier = supplierModifications[component.type];
        }

        if (isDuplicateOfCustomItem(ean, component.type, customMatchers)) {
            continue;
        }
        
        let supplierColor = '#95a5a6';
        if (supplier === 'PROKS') supplierColor = '#e74c3c';
        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        else if (supplier === 'MSI') supplierColor = '#d35400';
        
        html += `
            <div class="component-row" data-order-id="${orderId}" data-component-type="${component.type}" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; transition: background 0.3s;">
                <div style="flex: 1; overflow: hidden; display: flex; align-items: center; flex-wrap: nowrap;">
                    <strong style="color: #5dade2; font-size: 0.9em; white-space: nowrap;">${component.type}:</strong>
                    <span data-order-id="${orderId}" data-component-type="${component.type}" data-original-value="${ean}" data-ean="${ean}" class="component-name-display" title="EAN: ${ean}" style="color: rgba(255,255,255,0.95); padding: 2px 4px; font-size: 0.88em; font-weight: 600; margin-left: 8px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Caricamento...</span>
                </div>
                <span class="supplier-badge-clickable" data-order-id="${orderId}" data-component-type="${component.type}" data-supplier="${supplier || ''}" style="background: ${supplier ? supplierColor + '33' : 'rgba(149,165,166,0.2)'}; color: ${supplier ? supplierColor : '#95a5a6'}; padding: 2px 4px; border-radius: 4px; font-size: 0.75em; font-weight: 600; border: 1px solid ${supplier ? supplierColor + '66' : 'rgba(149,165,166,0.4)'}; min-width: 28px; text-align: center; display: inline-block; flex-shrink: 0; cursor: pointer;">${supplier ? getSupplierAbbreviation(supplier) : '--'}</span>
            </div>
        `;
    }
    
    componentsContainer.innerHTML = html;
    
    await loadProductNamesForEANs(orderId, allItems);
    highlightMismatchedColors(orderId);
    
    
    await saveAllCurrentComponentsToDB(orderId, null, null, null, null, false);
}





async function renderComponentsFromDatabase(orderId, savedComponents, allItems = []) {
    const componentsContainer = document.getElementById(`components-${orderId}`);
    
    if (!componentsContainer) {
        console.error(`❌ Container non trovato per ordine ${orderId}`);
        return;
    }
    
    savedComponents.forEach((comp, index) => {
    });
    
    
    const eanModifications = loadEANModifications(orderId);
    const supplierModifications = loadSupplierModifications(orderId);
    const deletedComponents = loadDeletedComponents(orderId);
    
    if (Object.keys(eanModifications).length > 0) {
    }
    if (Object.keys(supplierModifications).length > 0) {
    }
    
    let html = '';
    const customItems = await loadCustomItemsFromDB(orderId);
    const customMatchers = buildCustomItemMatchers(customItems);
    
    for (const component of savedComponents) {
        
        if (deletedComponents.includes(component.type)) continue;
        
        
        let ean = component.ean || '';
        let supplier = component.supplier || '';
        
        
        if (!ean && component.value) {
            const match = component.value.match(/^(.+?)\s*\((.+?)\)$/);
            if (match) {
                ean = match[1].trim();
                if (!supplier) supplier = match[2].trim();
            } else {
                ean = component.value.split(' ')[0];
            }
        }
        
        
        if (eanModifications[component.type]) {
            ean = eanModifications[component.type];
        }
        
        if (supplierModifications[component.type]) {
            supplier = supplierModifications[component.type];
        }

        const componentName = component.name || component.value || component.type || '';
        if (isDuplicateOfCustomItem(ean, componentName, customMatchers)) {
            continue;
        }
        
        let supplierColor = '#95a5a6';
        if (supplier === 'PROKS') supplierColor = '#e74c3c';
        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        else if (supplier === 'MSI') supplierColor = '#d35400';
        
        html += `
            <div class="component-row" data-order-id="${orderId}" data-component-type="${component.type}" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; transition: background 0.3s;">
                <div style="flex: 1; overflow: hidden; display: flex; align-items: center; flex-wrap: nowrap;">
                    <strong style="color: #5dade2; font-size: 0.9em; white-space: nowrap;">${component.type}:</strong>
                    <span data-order-id="${orderId}" data-component-type="${component.type}" data-original-value="${ean}" data-ean="${ean}" class="component-name-display" title="EAN: ${ean}" style="color: rgba(255,255,255,0.95); padding: 2px 4px; font-size: 0.88em; font-weight: 600; margin-left: 8px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Caricamento...</span>
                </div>
                <span class="supplier-badge-clickable" data-order-id="${orderId}" data-component-type="${component.type}" data-supplier="${supplier || ''}" style="background: ${supplier ? supplierColor + '33' : 'rgba(149,165,166,0.2)'}; color: ${supplier ? supplierColor : '#95a5a6'}; padding: 2px 4px; border-radius: 4px; font-size: 0.75em; font-weight: 600; border: 1px solid ${supplier ? supplierColor + '66' : 'rgba(149,165,166,0.4)'}; min-width: 28px; text-align: center; display: inline-block; flex-shrink: 0; cursor: pointer;">${supplier ? getSupplierAbbreviation(supplier) : '--'}</span>
            </div>
        `;
    }
    
    componentsContainer.innerHTML = html;
    
    await loadProductNamesForEANs(orderId, allItems);
    highlightMismatchedColors(orderId);
}




function highlightMismatchedColors(orderId) {
    
    const coolerRow = document.querySelector(`.component-row[data-order-id="${orderId}"][data-component-type="COOLER"]`);
    const caseRow = document.querySelector(`.component-row[data-order-id="${orderId}"][data-component-type="CASE"]`);
    
    if (!coolerRow || !caseRow) return;
    
    
    const coolerNameEl = coolerRow.querySelector('.component-name-display');
    const caseNameEl = caseRow.querySelector('.component-name-display');
    
    if (!coolerNameEl || !caseNameEl) return;
    
    const coolerName = coolerNameEl.textContent.toUpperCase();
    const caseName = caseNameEl.textContent.toUpperCase();
    
    
    const coolerSupplierBadge = coolerRow.querySelector('.supplier-badge-clickable');
    const caseSupplierBadge = caseRow.querySelector('.supplier-badge-clickable');
    const coolerSupplier = coolerSupplierBadge ? coolerSupplierBadge.dataset.supplier : '';
    const caseSupplier = caseSupplierBadge ? caseSupplierBadge.dataset.supplier : '';
    
    
    const extractColor = (name) => {
        
        if (name.includes('BIANCO') || name.includes('WHITE')) return 'BIANCO';
        if (name.includes('NERO') || name.includes('BLACK')) return 'NERO';
        
        if (name.includes('ROSSO') || name.includes('RED')) return 'ROSSO';
        if (name.includes('BLU') || name.includes('BLUE')) return 'BLU';
        if (name.includes('VERDE') || name.includes('GREEN')) return 'VERDE';
        if (name.includes('GRIGIO') || name.includes('GRAY') || name.includes('GREY')) return 'GRIGIO';
        return null;
    };
    
    
    const getAmazonComponentColor = (componentName, componentType) => {
        
        for (const comp of customAmazonComponents) {
            if (comp.categoria === componentType) {
                
                const compNameUpper = comp.nome.toUpperCase();
                const words = compNameUpper.split(/\s+/).filter(w => w.length > 2); 
                
                
                const matchCount = words.filter(word => componentName.includes(word)).length;
                if (matchCount >= 2 || (words.length === 1 && componentName.includes(compNameUpper))) {
                    const savedColor = localStorage.getItem(`amazon-component-color-${comp.id}-${componentType}`);
                    if (savedColor && savedColor !== 'ALTRO' && savedColor !== '') {
                        return savedColor;
                    }
                }
            }
        }
        return null;
    };
    
    
    let coolerColor = extractColor(coolerName);
    let caseColor = extractColor(caseName);
    
    
    if (!coolerColor && coolerSupplier === 'AMAZON') {
        
        const savedCoolerColor = localStorage.getItem(`component-color-${orderId}-COOLER`);
        if (savedCoolerColor && savedCoolerColor !== 'ALTRO' && savedCoolerColor !== '') {
            coolerColor = savedCoolerColor;
        } else {
            
            coolerColor = getAmazonComponentColor(coolerName, 'COOLER');
        }
    }
    
    if (!caseColor && caseSupplier === 'AMAZON') {
        
        const savedCaseColor = localStorage.getItem(`component-color-${orderId}-CASE`);
        if (savedCaseColor && savedCaseColor !== 'ALTRO' && savedCaseColor !== '') {
            caseColor = savedCaseColor;
        } else {
            
            caseColor = getAmazonComponentColor(caseName, 'CASE');
        }
    }
    
    
    if (coolerColor && caseColor && coolerColor !== caseColor) {
        coolerNameEl.style.color = '#FFD700';
        coolerNameEl.style.fontWeight = '700';
        coolerNameEl.style.textShadow = '0 0 8px rgba(255, 215, 0, 0.6)';
        
        caseNameEl.style.color = '#FFD700';
        caseNameEl.style.fontWeight = '700';
        caseNameEl.style.textShadow = '0 0 8px rgba(255, 215, 0, 0.6)';
    }
}






async function loadProductNamesForEANs(orderId, orderItems = []) {
    const displays = document.querySelectorAll(`span[data-order-id="${orderId}"][data-ean]`);
    
    
    
    const amazonProductsMap = new Map();
    if (orderItems && orderItems.length > 0) {
        for (const item of orderItems) {
            if (item.customProperties) {
                const props = item.customProperties;
                
                const ean = props.EAN || props.ean || props.ASIN || props.asin;
                if (ean && item.name) {
                    amazonProductsMap.set(String(ean).trim(), item.name);
                }
            }
        }
    }
    
    
    for (const display of displays) {
        const eanRaw = display.dataset.ean;
        const ean = String(eanRaw || '').trim();
        const displayEan = ean;
        const componentType = display.dataset.componentType;
        
        
        
        if (ean === 'Generico') {
            display.textContent = 'Monitor generico';
            display.title = `EAN: Generico`;
            continue;
        }
        
        
        if (String(ean).toUpperCase() === 'INTEGRATA') {
            display.textContent = 'GPU Integrata';
            display.title = `EAN: INTEGRATA`;
            continue;
        }
        
        
        if (String(ean).toUpperCase() === 'MANUALE') {
            display.textContent = 'Componente manuale';
            display.title = `Componente inserito manualmente`;
            continue;
        }
        
        
        if (String(ean).toUpperCase() === 'GENERICO') {
            display.textContent = 'Componente generico';
            display.title = `Componente generico`;
            continue;
        }
        
        
        
        if ((ean.match(/ /g) || []).length >= 3) {
            display.textContent = ean;
            display.title = `Descrizione: ${ean}`;
            continue;
        }

        
        
        const hasWhitespace = /\s/.test(ean);
        const hasLetters = /[A-Za-z]/.test(ean);
        const hasStrongDescriptionPattern = /(\d+\s*MM|\d+\s*W|\d+\s*TB|\d+\s*GB|DISSIPATORE|LIQUIDO|COOLER|MONITOR|CASE|ALIMENTATORE|CPU|GPU|RAM|SSD|HDD)/i.test(ean);
        if (hasWhitespace && hasLetters && hasStrongDescriptionPattern) {
            display.textContent = ean;
            display.title = `Descrizione: ${ean}`;
            continue;
        }

        
        if (amazonProductsMap.has(ean)) {
            const productName = amazonProductsMap.get(ean);
            display.textContent = productName;
            display.title = `EAN: ${ean}\n[Prodotto Amazon]`;
            
            
            const supplierSpan = display.closest('div').querySelector('span[style*="min-width: 28px"]');
            if (supplierSpan) {
                supplierSpan.textContent = 'AZ';
                supplierSpan.style.background = '#f39c1233';
                supplierSpan.style.color = '#f39c12';
                supplierSpan.style.borderColor = '#f39c1266';
            }
            continue;
        }

        
        const lookupEan = displayEan;
        const componentRow = display.closest('.component-row');
        const supplierBadge = componentRow ? componentRow.querySelector('.supplier-badge-clickable') : null;
        const supplierHint = supplierBadge && supplierBadge.dataset && supplierBadge.dataset.supplier
            ? String(supplierBadge.dataset.supplier).trim()
            : '';
        
        
        try {
            let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(lookupEan)}`;
            if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
                url += `&supplier=${encodeURIComponent(supplierHint)}`;
            }
            const response = await fetch(url);
            const data = response.ok ? await response.json() : { success: false };
            
            
            if (data.success && data.component) {
                
                const nomeProdotto = data.component.nome || 'Nome non disponibile';
                display.textContent = nomeProdotto;
                display.title = `EAN: ${displayEan}\nCategoria: ${data.component.categoria || 'N/D'}`;
                
                
                if (data.component.fornitore) {
                    const supplierSpan = display.closest('div').querySelector('span[style*="min-width: 28px"]');
                    if (supplierSpan) {
                        const supplier = data.component.fornitore.toUpperCase();
                        
                        
                        let supplierColor = '#95a5a6';
                        if (supplier === 'PROKS') supplierColor = '#e74c3c';
                        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
                        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
                        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
                        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
                        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
                        else if (supplier === 'MSI') supplierColor = '#d35400';
                        else if (supplier === 'CASEKING') supplierColor = '#16a085';
                        else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
                        
                        supplierSpan.textContent = getSupplierAbbreviation(supplier);
                        supplierSpan.style.background = `${supplierColor}33`;
                        supplierSpan.style.color = supplierColor;
                        supplierSpan.style.borderColor = `${supplierColor}66`;
                    }
                }
            } else {
                
                try {
                    const invUrl = `api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php?ean=${encodeURIComponent(lookupEan)}`;
                    const invResponse = await fetch(invUrl);
                    const invData = invResponse.ok ? await invResponse.json() : { success: false };
                    if (invData.success && invData.item) {
                        const nomeProdotto = invData.item.name || 'Nome non disponibile';
                        display.textContent = nomeProdotto;
                        display.title = `EAN: ${displayEan}`;
                    } else {
                        
                        display.textContent = displayEan;
                        display.title = `EAN: ${displayEan}\n(Prodotto non trovato)`;
                    }
                } catch (e) {
                    display.textContent = displayEan;
                    display.title = `EAN: ${displayEan}\n(Prodotto non trovato)`;
                }
            }
        } catch (error) {
            
            display.textContent = displayEan;
            display.title = `EAN: ${displayEan}`;
        }
    }

    updateSupplierSummaryButtonVisibility();
}




function createStandardCard(order) {
    const card = document.createElement('div');
    card.className = 'order-card order-card-processed';
    card.dataset.orderId = order.id;
    card.dataset.orderName = order.name;
    card.innerHTML = `
        <div class="card-header">
            <h2 style="margin: 0;">${order.name}</h2>
            <span class="config-badge" style="background: rgba(241, 196, 15, 0.3); border-color: rgba(241, 196, 15, 0.6); color: #f1c40f;" title="Configurazione non trovata">⚠️ NON RICONOSCIUTO</span>
        </div>
        <div class="card-body">
            <p style="color: rgba(255,255,255,0.7);">Ordine non-PC o configurazione non riconosciuta</p>
        </div>
    `;
    return card;
}


function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const operatorFilterContainer = document.getElementById('operator-filter-container');
    
    
    const activeTab = document.querySelector('.tab-button.active');
    const activeTabName = activeTab ? activeTab.dataset.tab : 'orders';
    
    
    if (operatorFilterContainer) {
        if (isProcessedTab(activeTabName)) {
            operatorFilterContainer.style.display = 'block';
        } else {
            operatorFilterContainer.style.display = 'none';
        }
    }
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            const targetContentKey = isProcessedTab(targetTab) ? 'processed' : targetTab;
            
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            
            button.classList.add('active');
            
            
            const targetContent = document.querySelector(`[data-content="${targetContentKey}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
            
            
            const hiddenTabBtn = document.querySelector('.tab-button[data-tab="hidden"]');
            if (hiddenTabBtn && targetTab !== 'hidden') {
                hiddenTabBtn.style.display = 'none';
            }
            
            
            if (operatorFilterContainer) {
                if (isProcessedTab(targetTab)) {
                    operatorFilterContainer.style.display = 'block';
                } else {
                    operatorFilterContainer.style.display = 'none';
                }
            }
            
            
            
            
            
            
            
            
            
            
            
            
            const selectOrdersBtn = document.getElementById('select-orders-btn');
            const ordersCounter = document.getElementById('orders-counter');
            const sinceIdFilterContainer = document.getElementById('since-id-filter-container');
            if (selectOrdersBtn) {
                if (targetTab === 'orders') {
                    selectOrdersBtn.style.display = 'block';
                } else {
                    selectOrdersBtn.style.display = 'none';
                    
                    exitOrdersSelectionMode();
                }
            }
            
            
            if (ordersCounter) {
                ordersCounter.style.display = targetTab === 'orders' ? 'inline-block' : 'none';
            }
            
            
            if (sinceIdFilterContainer) {
                sinceIdFilterContainer.style.display = targetTab === 'orders' ? 'block' : 'none';
            }
            
            
            const bulkReplaceBtn = document.getElementById('bulk-replace-btn');
            const hiddenOrdersBtn = document.getElementById('hidden-orders-btn');
            const processedCounter = document.getElementById('processed-counter');
            const exportExcelBtn = document.getElementById('export-excel-btn');
            
            if (bulkReplaceBtn) {
                if (isProcessedTab(targetTab)) {
                    bulkReplaceBtn.style.display = 'block';
                } else {
                    bulkReplaceBtn.style.display = 'none';
                }
            }
            
            if (exportExcelBtn) {
                if (isProcessedTab(targetTab)) {
                    exportExcelBtn.style.display = 'flex';
                    exportExcelBtn.disabled = true;
                    exportExcelBtn.title = 'Caricamento dati in corso...';
                } else {
                    exportExcelBtn.style.display = 'none';
                }
            }
            
            if (processedCounter) {
                if (isProcessedTab(targetTab)) {
                    processedCounter.style.display = 'inline-block';
                    updateProcessedCounter(getWorksheetFromTab(targetTab));
                } else {
                    processedCounter.style.display = 'none';
                }
            }
            
            
            const addManualOrderBtn = document.getElementById('add-manual-order-btn');
            if (addManualOrderBtn) {
                if (isProcessedTab(targetTab)) {
                    addManualOrderBtn.style.display = 'flex';
                } else {
                    addManualOrderBtn.style.display = 'none';
                }
            }
            
            
            const selectProcessedBtn = document.getElementById('select-processed-btn');
            if (selectProcessedBtn) {
                if (isProcessedTab(targetTab)) {
                    selectProcessedBtn.style.display = 'block';
                } else {
                    selectProcessedBtn.style.display = 'none';
                    
                    exitProcessedSelectionMode();
                }
            }

            if (isProcessedTab(targetTab)) {
                const worksheet = getWorksheetFromTab(targetTab);
                renderProcessedOrders(getFilteredProcessedOrdersMap(processedOrdersMap, worksheet));
            }
            
            
            if (hiddenOrdersBtn) {
                if (targetTab === 'finalized') {
                    hiddenOrdersBtn.style.display = 'block';
                } else {
                    hiddenOrdersBtn.style.display = 'none';
                }
            }
            
            
            const selectFinalizedBtn = document.getElementById('select-finalized-btn');
            if (selectFinalizedBtn) {
                if (targetTab === 'finalized') {
                    selectFinalizedBtn.style.display = 'block';
                } else {
                    selectFinalizedBtn.style.display = 'none';
                    
                    exitFinalizedSelectionMode();
                }
            }

            updateSupplierSummaryButtonVisibility(targetTab);
            
            
            const generateBtn = document.getElementById('generate-orders-btn');
            if (generateBtn) {
                if (targetTab === 'suppliers' && window.currentSupplierData && Object.keys(window.currentSupplierData).length > 0) {
                    generateBtn.style.display = 'block';
                } else {
                    generateBtn.style.display = 'none';
                }
            }
        });
    });
    
    initializeOperatorFilters();
    initializeExportExcelButton();
}


function initializeBulkReplaceButton() {
    const bulkReplaceBtn = document.getElementById('bulk-replace-btn');
    if (!bulkReplaceBtn) return;
    
    bulkReplaceBtn.addEventListener('click', () => {
        openBulkReplacePopup();
    });
}


function initializeHiddenOrdersButton() {
    const hiddenOrdersBtn = document.getElementById('hidden-orders-btn');
    if (!hiddenOrdersBtn) return;
    
    hiddenOrdersBtn.addEventListener('click', () => {
        
        const hiddenTabBtn = document.querySelector('.tab-button[data-tab="hidden"]');
        if (hiddenTabBtn) {
            
            hiddenTabBtn.style.display = 'inline-block';
            hiddenTabBtn.click();
        }
    });
}


async function refreshProcessedOrders() {
    
    await loadPCConfigs();
    
    
    if (!processedOrdersMap || processedOrdersMap.size === 0) {
        return;
    }
    
    
    for (const [orderName, order] of processedOrdersMap.entries()) {
        const pcItem = order.items.find(item => {
            const itemName = item.name || item.title || '';
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true) !== null;
        });
        
        if (pcItem) {
            const config = identifyPCConfig(pcItem.name);
            if (config) {
                
                const componentsContainer = document.getElementById(`components-${order.id}`);
                if (componentsContainer) {
                    componentsContainer.innerHTML = '';
                }
                
                
                
                await loadComponentsForOrder(order.id, config.components, pcItem.customProperties || {}, order.items);
            }
        }
    }
}


function initializeOperatorFilters() {
    const filterButtons = document.querySelectorAll('.filter-button');
    const resetButton = document.querySelector('.filter-reset-button');
    
    
    const hasActiveFilter = document.querySelector('.filter-button.active');
    
    if (hasActiveFilter) {
        
        resetButton.style.display = 'block';
    } else {
        
        resetButton.style.display = 'none';
    }
    
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            
            if (button.classList.contains('active')) {
                return;
            }
            
            
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            
            resetButton.style.display = 'block';
            
            
            reloadCurrentTab();
        });
    });
    
    resetButton.addEventListener('click', () => {
        filterButtons.forEach(btn => btn.classList.remove('active'));
        
        
        resetButton.style.display = 'none';
        
        reloadCurrentTab();
    });
}


function reloadCurrentTab() {
    
    const activeTab = document.querySelector('.tab-button.active');
    const activeTabName = activeTab ? activeTab.dataset.tab : 'orders';
    if (isProcessedTab(activeTabName)) {
        const worksheet = getWorksheetFromTab(activeTabName);
        renderProcessedOrders(getFilteredProcessedOrdersMap(processedOrdersMap, worksheet));
    } else {
        loadOrdersFromShopify();
    }
}







async function saveOperatorAssignment(orderId, operator) {
    await saveOperatorAssignmentToDB(orderId, operator);
}










































function moveOrderToOrdered(orderId, orderName) {
    
    const dockItems = document.getElementById('dock-items');
    const dockHint = document.querySelector('.dock-hint');
    if (dockHint) dockHint.style.display = 'none';
    
    const dockItem = document.createElement('div');
    dockItem.className = 'dock-item';
    dockItem.dataset.orderId = orderId;
    dockItem.dataset.orderName = orderName;
    dockItem.innerHTML = `
        <strong>${orderName}</strong>
        <small>In attesa</small>
        <button class="dock-item-restore" title="Riporta in Da Ordinare">↶</button>
    `;
    
    
    const restoreBtn = dockItem.querySelector('.dock-item-restore');
    restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreOrderToPending(orderId, orderName);
        dockItem.remove();
        
        
        if (dockItems.children.length === 0 && dockHint) {
            dockHint.style.display = 'block';
        }
    });
    
    dockItems.appendChild(dockItem);
    
    
    const card = document.querySelector(`[data-order-id="${orderId}"]`);
    if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(100px)';
        setTimeout(() => card.remove(), 300);
    }
    
    
    showNotification(`${orderName} aggiunto al dock ✓`);
}


function restoreOrderToPending(orderId, orderName) {
    
    showNotification(`${orderName} ripristinato in "Da Ordinare" ✓`);
    
    
    setTimeout(() => {
        loadOrdersFromShopify();
    }, 500);
}


async function moveOrderedToPending(orderId, orderName) {
    try {
        
        const order = await fetchSingleOrderFromShopify(orderId);
        
        if (!order) {
            showNotification(`❌ Impossibile recuperare l'ordine ${orderName} da Shopify`);
            return;
        }
        
        
        await removeOrderedIdFromDB(orderId);
        
        
        await updateProcessedOrderStato(orderId, 'elaborati');
        
        
        showNotification(`${orderName} spostato in "Ordini" ✓`);
        
        
        setTimeout(() => {
            loadOrdersFromShopify();
        }, 500);
    } catch (error) {
        console.error('Errore spostamento ordine:', error);
        showNotification(`❌ Errore durante lo spostamento di ${orderName}`);
    }
}


async function fetchSingleOrderFromShopify(orderId) {
    try {
        const response = await fetch(`${API_ENDPOINT}?orderId=${encodeURIComponent(orderId)}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (!response.ok) {
            console.error('Errore recupero ordine da Shopify:', response.status);
            return null;
        }
        
        const data = await response.json();
        return data.order || null;
    } catch (error) {
        console.error('Errore fetch ordine singolo:', error);
        return null;
    }
}


async function hideOrder(orderId, orderName) {
    const success = await hideOrderInDB(orderId);
    
    if (success) {
        
        setTimeout(() => {
            loadOrdersFromShopify();
        }, 500);
    }
}


async function restoreFromHidden(orderId, orderName) {
    const success = await restoreHiddenOrderFromDB(orderId);
    
    if (success) {
        showNotification(`${orderName} ripristinato in "Finalizzati" ✓`);
        
        
        setTimeout(() => {
            loadOrdersFromShopify();
        }, 500);
    }
}


function showNotification(message, type = 'info') {
    const msg = String(message || '');
    const lowerMsg = msg.toLowerCase();
    const isMoveNotification = (lowerMsg.includes('spostato') || lowerMsg.includes('spostati'));
    const isErrorLike = type === 'error' || lowerMsg.includes('errore') || lowerMsg.includes('impossibile');
    if (isMoveNotification && !isErrorLike) {
        return;
    }

    
    let bgColor = 'rgba(52, 152, 219, 0.3)'; 
    if (type === 'success') {
        bgColor = 'rgba(46, 204, 113, 0.3)'; 
    } else if (type === 'error') {
        bgColor = 'rgba(231, 76, 60, 0.3)'; 
    } else if (type === 'warning') {
        bgColor = 'rgba(241, 196, 15, 0.3)'; 
    }
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: -100px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bgColor};
        backdrop-filter: blur(15px);
        -webkit-backdrop-filter: blur(15px);
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        font-weight: 600;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        z-index: 9999;
        transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    
    setTimeout(() => {
        notification.style.top = '20px';
    }, 10);
    
    
    setTimeout(() => {
        notification.style.top = '-100px';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 400);
    }, 2000);
}





async function processOrder(orderId, skipReload = false, worksheetNumber = 1) {
    const foglioDiLavoro = Math.min(4, Math.max(1, parseInt(worksheetNumber, 10) || 1));
    
    const processedOrderIds = await getProcessedOrderIdsFromDB();
    
    
    if (isOrderProcessed(orderId, processedOrderIds)) {
        console.warn(`⚠️ Ordine ${orderId} già elaborato`);
        return;
    }
    
    
    const isPreSplit = String(orderId).includes('.');
    let originalOrderId = orderId;
    let pcItemIndex = 0;
    
    if (isPreSplit) {
        
        const parts = String(orderId).split('.');
        originalOrderId = parseInt(parts[0]);
        pcItemIndex = parseInt(parts[1]) - 1; 
    }
    
    
    const shopifyOrders = JSON.parse(sessionStorage.getItem('shopify_orders') || '[]');
    const fullOrder = shopifyOrders.find(o => String(o.id) === String(originalOrderId));
    
    if (!fullOrder) {
        console.error(`❌ Ordine ${originalOrderId} non trovato in sessionStorage`);
        return;
    }
        
    
    let countA = 0;
    let countB = 0;
    
    Object.values(processedOrdersCache).forEach(order => {
        if (order.operator === 'OperatoreA') countA++;
        else if (order.operator === 'OperatoreB') countB++;
    });
    
    
    if (isPreSplit) {
        const counters = { countA, countB };
        await processSingleSplitPC(orderId, fullOrder, pcItemIndex, counters, skipReload, foglioDiLavoro);
        return;
    }
    
    
    const pcItems = fullOrder?.line_items?.filter(item => {
        const itemName = item.name || item.title || '';
        
        return itemName.toUpperCase().includes('PC GAMING') || 
               identifyPCConfig(itemName) !== null;
    }) || [];
    
    if (pcItems.length === 0) {
        console.error(`❌ Nessun PC gaming trovato nell'ordine ${originalOrderId}`);
        return;
    }
    
    
    let totalPCs = 0;
    for (const pcItem of pcItems) {
        totalPCs += (pcItem.quantity || 1);
    }
    
    
    if (totalPCs > 1) {
        const counters = { countA, countB };
        await processMultiPCOrder(orderId, fullOrder, counters, skipReload, foglioDiLavoro);
        return;
    }
    
    
    const assignedOperator = countA <= countB ? 'OperatoreA' : 'OperatoreB';
        
        
        let componentsToSave = [];
        let configName = null;
        
        
        const pcItem = fullOrder?.line_items?.find(item => {
            const itemName = item.name || item.title || '';
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true) !== null;
        });
        
        if (pcItem) {
            
            const config = identifyPCConfig(pcItem.name);
            
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
                    const resolved = resolveVariantTypeFromKeyAndValue(key, value);
                    if (!resolved.componentType) continue;
                    if (resolved.componentType === 'MONITOR' || resolved.componentType === 'KIT GAMING') continue;

                    const { gpoSearchType, baseComponentType } = resolved;
                    const componentIndex = finalComponents.findIndex(c =>
                        c.type.toUpperCase() === baseComponentType.toUpperCase()
                    );

                    const gpoMatch = findGpoMapping(gpoSearchType, value);
                    const finalValue = gpoMatch
                        ? (gpoMatch.supplier ? `${gpoMatch.ean} (${gpoMatch.supplier})` : gpoMatch.ean)
                        : value;

                    if (componentIndex !== -1) {
                        finalComponents[componentIndex] = {
                            type: finalComponents[componentIndex].type,
                            value: finalValue
                        };
                    } else {
                        updateComponentIfExists(finalComponents, baseComponentType, finalValue, `processOrder ${baseComponentType}`);
                    }
                }

                for (const { value, splitResult } of ramSsdVariants) {
                    const applyMappedValue = (type, mappedValue) => {
                        if (!mappedValue) return;
                        updateComponentIfExists(finalComponents, type, mappedValue, `processOrder ${type}`);
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

                const kitUnits = [];
                const monitorUnits = [];
                for (const item of (fullOrder?.line_items || [])) {
                    const itemName = item?.name || item?.title || '';
                    const upperItemName = String(itemName).toUpperCase();
                    const isKitItem = (upperItemName.includes('KIT') ||
                                       upperItemName.includes('TASTIERA') ||
                                       upperItemName.includes('MOUSE') ||
                                       upperItemName.includes('CUFFIE')) &&
                                      !upperItemName.includes('PC GAMING') &&
                                      identifyPCConfig(itemName, true) === null;
                    const itemCustomProps = item?.custom_properties || item?.customProperties || {};
                    const hasItemCustomProps = itemCustomProps && Object.keys(itemCustomProps).length > 0;
                    const hasExplicitMonitor = upperItemName.includes('MONITOR');
                    const hasMonitorKeyword = hasExplicitMonitor ||
                                           upperItemName.includes('DISPLAY') ||
                                           upperItemName.includes('SCHERMO');
                    const nonMonitorHints = [
                        'DISSIPAT', 'COOLER', 'AIO', 'LIQUID', 'CPU', 'GPU', 'RAM', 'SSD', 'NVME',
                        'M.2', 'M2', 'ALIMENTAT', 'PSU', 'SCHEDA MADRE', 'MOBO', 'CASE', 'VENTOLA',
                        'FAN', 'KIT', 'TASTIERA', 'MOUSE', 'CUFFIE'
                    ];
                    const hasNonMonitorHints = !hasExplicitMonitor && nonMonitorHints.some(hint => upperItemName.includes(hint));
                    const isMonitorItem = hasMonitorKeyword &&
                                          !hasNonMonitorHints &&
                                          !hasItemCustomProps &&
                                          !upperItemName.includes('PC GAMING') &&
                                          identifyPCConfig(itemName, true) === null;

                    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
                    if (isKitItem) {
                        for (let index = 0; index < quantity; index++) {
                            kitUnits.push(item);
                        }
                    }
                    if (isMonitorItem) {
                        for (let index = 0; index < quantity; index++) {
                            monitorUnits.push(item);
                        }
                    }
                }

                if (kitUnits.length > 0) {
                    const kitItem = kitUnits[0];
                    const kitValue = String(kitItem?.sku || '').trim() || (kitItem?.name || kitItem?.title || '');

                    if (kitValue) {
                        const kitIndex = finalComponents.findIndex(component => String(component.type || '').toUpperCase() === 'KIT GAMING');
                        if (kitIndex !== -1) {
                            finalComponents[kitIndex] = {
                                type: finalComponents[kitIndex].type,
                                value: kitValue,
                                quantity: kitUnits.length
                            };
                        } else {
                            finalComponents.push({
                                type: 'KIT GAMING',
                                value: kitValue,
                                quantity: kitUnits.length
                            });
                        }
                    }
                }

                if (monitorUnits.length > 0) {
                    const monitorIndex = finalComponents.findIndex(component => String(component.type || '').toUpperCase() === 'MONITOR');
                    const monitorValue = 'Generico (AMAZON)';

                    if (monitorIndex !== -1) {
                        finalComponents[monitorIndex] = {
                            type: finalComponents[monitorIndex].type,
                            value: monitorValue,
                            quantity: monitorUnits.length
                        };
                    } else {
                        finalComponents.push({
                            type: 'MONITOR',
                            value: monitorValue,
                            quantity: monitorUnits.length
                        });
                    }
                }
                
                
                for (const comp of finalComponents) {
                    
                    const match = comp.value.match(/^(.+?)\s*\((.+?)\)$/);
                    let ean = comp.value;
                    let supplier = comp.supplier ? String(comp.supplier).trim().toUpperCase() : '';
                    
                    if (match) {
                        ean = match[1].trim();
                        if (!supplier) {
                            supplier = match[2].trim();
                        }
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
        }
        
        
        const success = await saveProcessedOrderToDB(orderId, {
            orderIdFlip: fullOrder?.name || fullOrder?.order_number || null,
            operator: assignedOperator,
            configName: configName,
            customerEmail: fullOrder?.email || fullOrder?.customer?.email || null,
            customerPhone: normalizePhoneForStorage(getPreferredCustomerPhone(fullOrder)) || null,
            foglioDiLavoro,
            components: componentsToSave
        });
        
        if (success) {
            
            await incrementMonthlyCounter(1);
            
            
            await saveOperatorAssignmentToDB(orderId, assignedOperator);
            
            if (!skipReload) {
                showNotification(`Ordine spostato in Elaborati e assegnato a ${assignedOperator}`);
            
                
                setTimeout(() => {
                    loadOrdersFromShopify();
                }, 500);
            }
        }
}




async function restoreProcessedOrder(orderId) {
    const success = await deleteProcessedOrderFromDB(orderId);
    
    if (success) {
        
        setTimeout(() => {
            loadOrdersFromShopify();
        }, 500);
    }
}




async function finalizeOrder(orderId) {
    if (!isOrderOrdered(orderId)) {
        await addOrderedIdToDB(orderId);
        
        await updateProcessedOrderStato(orderId, 'finalizzati');
        showNotification('Ordine spostato in Finalizzati');
        
        
        setTimeout(() => {
            loadOrdersFromShopify();
        }, 500);
    }
}


document.addEventListener('click', (e) => {
    if (e.target.classList.contains('process-order-btn') || e.target.closest('.process-order-btn')) {
        const btn = e.target.classList.contains('process-order-btn') ? e.target : e.target.closest('.process-order-btn');
        const orderId = btn.dataset.orderId;
        const worksheetNumber = Math.min(4, Math.max(1, parseInt(btn.dataset.worksheet, 10) || 1));
        if (orderId) {
            processOrder(orderId, false, worksheetNumber);
        }
    }
    
    if (e.target.classList.contains('finalize-order-btn') || e.target.closest('.finalize-order-btn')) {
        const btn = e.target.classList.contains('finalize-order-btn') ? e.target : e.target.closest('.finalize-order-btn');
        const orderId = btn.dataset.orderId;
        if (orderId) {
            finalizeOrder(orderId);
        }
    }
    
    if (e.target.classList.contains('restore-processed-btn') || e.target.closest('.restore-processed-btn')) {
        const btn = e.target.classList.contains('restore-processed-btn') ? e.target : e.target.closest('.restore-processed-btn');
        const orderId = btn.dataset.orderId;
        if (orderId) {
            restoreProcessedOrder(orderId);
        }
    }
    
    
    if (e.target.classList.contains('hide-order-btn') || e.target.closest('.hide-order-btn')) {
        const btn = e.target.classList.contains('hide-order-btn') ? e.target : e.target.closest('.hide-order-btn');
        const orderId = btn.dataset.orderId;
        if (orderId) {
            const card = btn.closest('.order-card');
            const orderName = card ? card.querySelector('h2')?.textContent : `#${orderId}`;
            hideOrder(orderId, orderName);
        }
    }
});


document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('operator-selector') || e.target.closest('.operator-selector')) {
        const selector = e.target.classList.contains('operator-selector') ? e.target : e.target.closest('.operator-selector');
        const orderId = selector.dataset.orderId;
        
        const currentOperator = getOperatorAssignment(orderId);
        
        
        let newOperator = '';
        if (!currentOperator) {
            newOperator = 'OperatoreA';
        } else if (currentOperator === 'OperatoreA') {
            newOperator = 'OperatoreB';
        } else {
            newOperator = '';
        }
        
        if (newOperator) {
            await saveOperatorAssignmentToDB(orderId, newOperator);
            showNotification(`Ordine assegnato a ${newOperator}`);
        } else {
            await deleteOperatorAssignmentFromDB(orderId);
            showNotification('Assegnazione operatore rimossa');
        }
        
        
        loadOrdersFromShopify();
    }
});


let orderIdPressTimer = null;
let orderIdPressStartTime = null;
let orderIdPressElement = null;
const ORDER_ID_LONG_PRESS_DURATION = 5000; 


document.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('order-id-flip')) {
        orderIdPressElement = e.target;
        orderIdPressStartTime = Date.now();
        
        
        orderIdPressTimer = setTimeout(() => {
            enableOrderIdEdit(orderIdPressElement);
        }, ORDER_ID_LONG_PRESS_DURATION);
    }
});

document.addEventListener('touchstart', (e) => {
    if (e.target.classList.contains('order-id-flip')) {
        orderIdPressElement = e.target;
        orderIdPressStartTime = Date.now();
        
        orderIdPressTimer = setTimeout(() => {
            enableOrderIdEdit(orderIdPressElement);
        }, ORDER_ID_LONG_PRESS_DURATION);
    }
}, { passive: true });


document.addEventListener('mouseup', (e) => {
    if (e.target.classList.contains('order-id-flip')) {
        const pressDuration = Date.now() - orderIdPressStartTime;
        
        
        if (orderIdPressTimer) {
            clearTimeout(orderIdPressTimer);
            orderIdPressTimer = null;
        }
        
        
        if (pressDuration < ORDER_ID_LONG_PRESS_DURATION) {
            const flipContainer = e.target.closest('.flip-container');
            if (flipContainer) {
                flipContainer.classList.toggle('flipped');
            }
        }
        
        orderIdPressStartTime = null;
        orderIdPressElement = null;
    }
});

document.addEventListener('touchend', (e) => {
    if (orderIdPressElement && orderIdPressElement.classList.contains('order-id-flip')) {
        const pressDuration = Date.now() - orderIdPressStartTime;
        
        if (orderIdPressTimer) {
            clearTimeout(orderIdPressTimer);
            orderIdPressTimer = null;
        }
        
        if (pressDuration < ORDER_ID_LONG_PRESS_DURATION) {
            const flipContainer = orderIdPressElement.closest('.flip-container');
            if (flipContainer) {
                flipContainer.classList.toggle('flipped');
            }
        }
        
        orderIdPressStartTime = null;
        orderIdPressElement = null;
    }
}, { passive: true });


document.addEventListener('mousemove', (e) => {
    if (orderIdPressTimer && orderIdPressElement) {
        const rect = orderIdPressElement.getBoundingClientRect();
        
        if (e.clientX < rect.left || e.clientX > rect.right || 
            e.clientY < rect.top || e.clientY > rect.bottom) {
            clearTimeout(orderIdPressTimer);
            orderIdPressTimer = null;
        }
    }
});




async function enableOrderIdEdit(element) {
    const orderId = element.dataset.orderId;
    const currentName = element.textContent.trim();
    
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.style.cssText = `
        width: 100%;
        background: rgba(255, 255, 255, 0.95);
        color: #000;
        border: 2px solid #3498db;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 1.2em;
        font-weight: bold;
        box-shadow: 0 0 20px rgba(52, 152, 219, 0.5);
    `;
    
    
    element.style.display = 'none';
    element.parentNode.insertBefore(input, element);
    input.focus();
    input.select();
    
    
    const saveEdit = async () => {
        const newName = input.value.trim();
        
        if (!newName || newName === currentName) {
            
            input.remove();
            element.style.display = '';
            return;
        }
        
        try {
            
            input.disabled = true;
            input.style.background = 'rgba(255, 255, 255, 0.7)';
            
            
            const response = await fetch('api_gateway/db_bridge/shopify_orders_service/endpoint/api-update-order-name.php', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    shopify_order_id: orderId,
                    new_order_name: newName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                
                element.textContent = newName;
                input.remove();
                element.style.display = '';
                
                
                showNotification(`✅ Order ID aggiornato: ${currentName} → ${newName}`, 'success');
            } else {
                throw new Error(result.error || 'Errore durante il salvataggio');
            }
            
        } catch (error) {
            console.error('Errore aggiornamento order ID:', error);
            showNotification(`❌ Errore: ${error.message}`, 'error');
            
            
            input.disabled = false;
            input.style.background = 'rgba(255, 255, 255, 0.95)';
            input.focus();
            input.select();
        }
    };
    
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            input.remove();
            element.style.display = '';
        }
    });
    
    
    input.addEventListener('blur', saveEdit);
}







async function checkAndApplyEAN(input, ean, componentType) {
    
    try {
        const supplierSpan = input.closest('div').querySelector('span[style*="min-width: 65px"]');
        const supplierHint = supplierSpan && supplierSpan.dataset && supplierSpan.dataset.supplier
            ? String(supplierSpan.dataset.supplier).trim()
            : '';
        let lookupUrl = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
        if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
            lookupUrl += `&supplier=${encodeURIComponent(supplierHint)}`;
        }

        const response = await fetch(lookupUrl);
        const data = await response.json();
        
        if (data.success && data.component) {
            
            input.title = `${componentType}: ${data.component.nome}\nEAN: ${ean}`;
            
            
            if (data.component.fornitore) {
                const supplierSpan = input.closest('div').querySelector('span[style*="min-width: 65px"]');
                if (supplierSpan) {
                    const supplier = data.component.fornitore.toUpperCase();
                    
                    let supplierColor = '#95a5a6';
                    if (supplier === 'PROKS') supplierColor = '#e74c3c';
                    else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
                    else if (supplier === 'TIER ONE') supplierColor = '#3498db';
                    else if (supplier === 'AMAZON') supplierColor = '#f39c12';
                    else if (supplier === 'NOUA') supplierColor = '#2ecc71';
                    else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
                    else if (supplier === 'MSI') supplierColor = '#d35400';
                    else if (supplier === 'CASEKING') supplierColor = '#16a085';
                    else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
                    
                    supplierSpan.textContent = getSupplierAbbreviation(supplier);
                    supplierSpan.style.background = `${supplierColor}33`;
                    supplierSpan.style.color = supplierColor;
                    supplierSpan.style.borderColor = `${supplierColor}66`;
                    supplierSpan.dataset.supplier = supplier;
                }
            }
            
            showNotification(`✅ EAN ${componentType} trovato: ${data.component.nome}`);
        } else {
            
            input.title = `${componentType}: ${ean}\n(Prodotto non trovato in database)`;
            openSupplierSelectPopup(input, ean, componentType);
        }
    } catch (error) {
        console.error(`Errore verifica EAN ${ean}:`, error);
        input.title = `${componentType}: ${ean}`;
        showNotification(`⚠️ Errore verifica EAN, seleziona fornitore manualmente`);
        openSupplierSelectPopup(input, ean, componentType);
    }
}




function saveEANModification(orderId, componentType, newEAN) {
    const key = `ean_modifications`;
    const modifications = JSON.parse(localStorage.getItem(key) || '{}');
    
    if (!modifications[orderId]) {
        modifications[orderId] = {};
    }
    
    modifications[orderId][componentType] = newEAN;
    localStorage.setItem(key, JSON.stringify(modifications));
    
}




function saveSupplierModification(orderId, componentType, supplier) {
    const key = `supplier_modifications`;
    const modifications = JSON.parse(localStorage.getItem(key) || '{}');
    
    if (!modifications[orderId]) {
        modifications[orderId] = {};
    }
    
    modifications[orderId][componentType] = supplier;
    localStorage.setItem(key, JSON.stringify(modifications));
    
}




function loadSupplierModifications(orderId) {
    const key = `supplier_modifications`;
    const modifications = JSON.parse(localStorage.getItem(key) || '{}');
    return modifications[orderId] || {};
}




function loadEANModifications(orderId) {
    const key = `ean_modifications`;
    const modifications = JSON.parse(localStorage.getItem(key) || '{}');
    return modifications[orderId] || {};
}




function saveDeletedComponent(orderId, componentType) {
    const key = `deleted_components`;
    const deletions = JSON.parse(localStorage.getItem(key) || '{}');
    
    if (!deletions[orderId]) {
        deletions[orderId] = [];
    }
    
    if (!deletions[orderId].includes(componentType)) {
        deletions[orderId].push(componentType);
        localStorage.setItem(key, JSON.stringify(deletions));
    }
}




function loadDeletedComponents(orderId) {
    const key = `deleted_components`;
    const deletions = JSON.parse(localStorage.getItem(key) || '{}');
    return deletions[orderId] || [];
}





async function loadProductNameForInput(input, showSupplierPopup = false) {
    const ean = input.dataset.ean;
    const componentType = input.dataset.componentType;
    
    if (ean === 'Generico') {
        input.title = `${componentType}: Monitor generico`;
        return;
    }
    
    try {
        
        const supplierSpan = input.closest('div').querySelector('span[style*="min-width: 28px"]');
        const supplierHint = supplierSpan && supplierSpan.dataset && supplierSpan.dataset.supplier
            ? String(supplierSpan.dataset.supplier).trim()
            : '';
        let lookupUrl = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
        if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
            lookupUrl += `&supplier=${encodeURIComponent(supplierHint)}`;
        }

        const response = await fetch(lookupUrl);
        const data = await response.json();
        
        if (data.success && data.component) {
            input.value = data.component.nome;
            input.title = `EAN: ${ean}\nCategoria: ${data.component.categoria || 'N/D'}`;
            
            
            if (data.component.fornitore) {
                const supplierSpan = input.closest('div').querySelector('span[style*="min-width: 28px"]');
                if (supplierSpan) {
                    const supplier = data.component.fornitore.toUpperCase();
                    
                    
                    let supplierColor = '#95a5a6';
                    if (supplier === 'PROKS') supplierColor = '#e74c3c';
                    else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
                    else if (supplier === 'TIER ONE') supplierColor = '#3498db';
                    else if (supplier === 'AMAZON') supplierColor = '#f39c12';
                    else if (supplier === 'NOUA') supplierColor = '#2ecc71';
                    else if (supplier === 'MSI') supplierColor = '#d35400';
                    else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
                    else if (supplier === 'CASEKING') supplierColor = '#16a085';
                    else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
                    
                    supplierSpan.textContent = getSupplierAbbreviation(supplier);
                    supplierSpan.style.background = `${supplierColor}33`;
                    supplierSpan.style.color = supplierColor;
                    supplierSpan.style.borderColor = `${supplierColor}66`;
                }
            }
        } else {
            
            try {
                const customResponse = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-custom-items.php?search=${encodeURIComponent(ean)}`);
                
                if (customResponse.ok) {
                    const customData = await customResponse.json();
                    
                    if (customData.success && customData.items && customData.items.length > 0) {
                        
                        const item = customData.items.find(i => i.ean === ean);
                        
                        if (item) {
                            input.value = item.nome;
                            input.title = `EAN: ${ean}\nCategoria: ${item.categoria || 'N/D'}\n[Articolo Custom]`;
                            
                            
                            if (item.fornitore) {
                                const supplierSpan = input.closest('div').querySelector('span[style*="min-width: 28px"]');
                                if (supplierSpan) {
                                    const supplier = item.fornitore.toUpperCase();
                                    
                                    let supplierColor = '#95a5a6';
                                    if (supplier === 'PROKS') supplierColor = '#e74c3c';
                                    else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
                                    else if (supplier === 'TIER ONE') supplierColor = '#3498db';
                                    else if (supplier === 'AMAZON') supplierColor = '#f39c12';
                                    else if (supplier === 'NOUA') supplierColor = '#2ecc71';
                                    else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
                                    else if (supplier === 'MSI') supplierColor = '#d35400';
                                    else if (supplier === 'CASEKING') supplierColor = '#16a085';
                                    else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
                                    
                                    supplierSpan.textContent = getSupplierAbbreviation(supplier);
                                    supplierSpan.style.background = `${supplierColor}33`;
                                    supplierSpan.style.color = supplierColor;
                                    supplierSpan.style.borderColor = `${supplierColor}66`;
                                }
                            }
                            return;
                        }
                    }
                }
            } catch (customError) {
                console.warn('Errore ricerca articoli custom:', customError);
                
            }
            
            
            input.value = ean;
            input.title = `EAN: ${ean}\n(Prodotto non trovato in database)`;
            
            
            if (showSupplierPopup) {
                openSupplierSelectPopup(input, ean, componentType);
            }
        }
    } catch (error) {
        console.error(`Errore caricamento prodotto per EAN ${ean}:`, error);
        input.value = ean;
        input.title = `EAN: ${ean}`;
    }
}


let currentSupplierSelectInput = null;
let currentSupplierSelectOrderId = null;
let currentSupplierSelectComponentType = null;


function openSupplierSelectPopup(input, ean, componentType) {
    currentSupplierSelectInput = input;
    currentSupplierSelectOrderId = input.dataset.orderId;
    currentSupplierSelectComponentType = input.dataset.componentType || componentType;
    
    
    const popup = document.getElementById('supplier-select-popup');
    const overlay = document.getElementById('supplier-select-overlay');
    const eanDisplay = document.getElementById('supplier-select-ean');
    const customInput = document.getElementById('custom-supplier-input');
    
    if (!popup || !overlay) return;
    
    eanDisplay.innerHTML = `<strong>${currentSupplierSelectComponentType}</strong>: ${ean}`;
    customInput.value = '';
    
    popup.style.display = 'block';
    overlay.style.display = 'block';
}


document.addEventListener('click', (e) => {
    if (e.target.classList.contains('supplier-option')) {
        const supplier = e.target.dataset.supplier;
        applyManualSupplier(supplier);
    }
});


document.getElementById('confirm-custom-supplier')?.addEventListener('click', () => {
    const customInput = document.getElementById('custom-supplier-input');
    const supplier = customInput.value.trim().toUpperCase();
    
    if (supplier) {
        applyManualSupplier(supplier);
    } else {
        showNotification('Inserisci un nome fornitore');
    }
});


function applyManualSupplier(supplier) {
    if (!currentSupplierSelectOrderId || !currentSupplierSelectComponentType) {
        closeSupplierSelectPopup();
        return;
    }
    
    
    
    const supplierSpan = document.querySelector(`.supplier-badge-clickable[data-order-id="${currentSupplierSelectOrderId}"][data-component-type="${currentSupplierSelectComponentType}"]`);
    
    
    if (supplierSpan) {
        
        let supplierColor = '#95a5a6';
        if (supplier === 'PROKS') supplierColor = '#e74c3c';
        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
        else if (supplier === 'MSI') supplierColor = '#d35400';
        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        else if (supplier === 'CASEKING') supplierColor = '#16a085';
        else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
        
        supplierSpan.textContent = getSupplierAbbreviation(supplier);
        supplierSpan.style.background = `${supplierColor}33`;
        supplierSpan.style.color = supplierColor;
        supplierSpan.style.borderColor = `${supplierColor}66`;
        supplierSpan.dataset.supplier = supplier;
        
        
        saveSupplierModification(currentSupplierSelectOrderId, currentSupplierSelectComponentType, supplier);
        
        showNotification(`Fornitore impostato: ${supplier}`);
    } else {
        showNotification(`⚠️ Impossibile aggiornare badge fornitore`);
    }
    
    
    closeSupplierSelectPopup();
}


function closeSupplierSelectPopup() {
    document.getElementById('supplier-select-popup').style.display = 'none';
    document.getElementById('supplier-select-overlay').style.display = 'none';
    currentSupplierSelectInput = null;
    currentSupplierSelectOrderId = null;
    currentSupplierSelectComponentType = null;
}

document.getElementById('cancel-supplier-select')?.addEventListener('click', closeSupplierSelectPopup);
document.getElementById('supplier-select-overlay')?.addEventListener('click', closeSupplierSelectPopup);


document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('add-custom-item-btn')) {
        const orderId = e.target.dataset.orderId;
        const customItemsContainer = document.getElementById(`custom-items-${orderId}`);
        
        
        const existingItems = customItemsContainer.querySelectorAll('.custom-item-row').length;
        
        if (existingItems >= 4) {
            showNotification('Massimo 4 voci personalizzate raggiunto');
            return;
        }
        
        
        showCustomItemPopup(orderId);
    }
    
    
    if (e.target.classList.contains('remove-custom-item-btn')) {
        const itemId = e.target.dataset.itemId;
        const itemDiv = document.querySelector(`[data-item-id="${itemId}"]`);
        
        if (itemDiv) {
            
            const itemName = itemDiv.querySelector('strong').textContent.replace(':', '').trim();
            
            
            if (confirm(`Vuoi davvero rimuovere la voce "${itemName}"?`)) {
                const orderId = itemId.split('-')[2]; 
                const itemEan = itemDiv.dataset.ean || '';
                
                
                itemDiv.remove();
                await saveCustomItems(orderId);
                
                
            }
        }
    }
});


function removeItemFromLineItems(orderId, ean, itemName) {
    
    const orderCard = document.querySelector(`[data-order-id="${orderId}"]`)?.closest('.flip-card-inner');
    
    if (!orderCard) {
        console.warn(`Card non trovata per ordine ${orderId}`);
        return;
    }
    
    
    const lineItemsTable = orderCard.querySelector('.flip-back .line-items tbody');
    
    if (!lineItemsTable) {
        console.warn(`Tabella line-items non trovata per ordine ${orderId}`);
        return;
    }
    
    
    const rows = lineItemsTable.querySelectorAll('tr');
    
    for (const row of rows) {
        const rowText = row.textContent;
        const strongElement = row.querySelector('strong');
        
        if (strongElement) {
            const rowName = strongElement.textContent;
            
            
            if (rowName.toUpperCase() === itemName.toUpperCase() || rowText.includes(ean)) {
                row.remove();
                return;
            }
        }
    }
    
}


async function saveCustomItemToSQL(nome, ean, categoria, fornitore, prezzo) {
    
    try {
        const response = await fetch('api_gateway/db_bridge/components_service/endpoint/api-custom-items.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nome: nome,
                ean: ean,
                categoria: categoria,
                fornitore: fornitore,
                prezzo: prezzo
            })
        });
        
        
        if (!response.ok) {
            console.warn('⚠️ Impossibile salvare in SQL:', response.statusText);
            const errorText = await response.text();
            console.warn('Dettaglio errore:', errorText);
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('✅ Articolo salvato nel database');
        } else {
            console.warn('❌ Errore salvataggio SQL:', data.error);
            showNotification('⚠️ Errore salvataggio: ' + data.error, 'warning');
        }
    } catch (error) {
        console.error('❌ Errore salvataggio SQL:', error);
        showNotification('❌ Errore di rete: ' + error.message, 'error');
    }
}


async function deleteCustomItemFromSQL(ean, nome) {
    
    try {
        const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-custom-items.php?ean=${encodeURIComponent(ean)}`, {
            method: 'DELETE'
        });
        
        
        if (!response.ok) {
            console.warn('⚠️ Impossibile eliminare da SQL:', response.statusText);
            const errorText = await response.text();
            console.warn('Dettaglio errore:', errorText);
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            if (data.affected_rows > 0) {
                showNotification('✅ Articolo rimosso dal database');
            } else {
            }
        } else {
            console.warn('❌ Errore eliminazione SQL:', data.error);
        }
    } catch (error) {
        console.error('❌ Errore eliminazione SQL:', error);
    }
}


function showCustomItemPopup(orderId) {
    
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(5px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease;
    `;
    
    
    const popup = document.createElement('div');
    popup.style.cssText = `
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 16px;
        padding: 30px;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: slideIn 0.3s ease;
    `;
    
    popup.innerHTML = `
        <h3 style="margin: 0 0 20px 0; color: white; font-size: 1.4em; text-align: center;">Aggiungi Voce Personalizzata</h3>

        <div style="margin-bottom: 20px;">
            <label style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 600; font-size: 0.95em;">Voci preimpostate</label>
            <select id="order-custom-item-preset" style="width: 100%; padding: 12px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-size: 1em; outline: none; transition: all 0.3s ease; box-sizing: border-box; cursor: pointer;" onfocus="this.style.borderColor='rgba(255,255,255,0.6)'; this.style.background='rgba(255,255,255,0.25)'" onblur="this.style.borderColor='rgba(255,255,255,0.3)'; this.style.background='rgba(255,255,255,0.15)'">
                <option value="" style="background: #1a1a1a; color: white;">Seleziona voce predefinita...</option>
                <option value="WIFI PCI" style="background: #1a1a1a; color: white;">WIFI PCI</option>
                <option value="KIT VENTOLE WHITE" style="background: #1a1a1a; color: white;">KIT VENTOLE WHITE</option>
                <option value="KIT VENTOLE BLACK" style="background: #1a1a1a; color: white;">KIT VENTOLE BLACK</option>
                <option value="MINI MONITORINO 3,5&quot; POLLICI" style="background: #1a1a1a; color: white;">MINI MONITORINO 3,5" POLLICI</option>
                <option value="SLEEVE RGB WHITE" style="background: #1a1a1a; color: white;">SLEEVE RGB WHITE</option>
                <option value="SLEEVE RGB BLACK" style="background: #1a1a1a; color: white;">SLEEVE RGB BLACK</option>
                <option value="HDD 500GB AGGIUNTIVO" style="background: #1a1a1a; color: white;">HDD 500GB AGGIUNTIVO</option>
                <option value="HDD 1TB AGGIUNTIVO" style="background: #1a1a1a; color: white;">HDD 1TB AGGIUNTIVO</option>
                <option value="HDD 2TB AGGIUNTIVO" style="background: #1a1a1a; color: white;">HDD 2TB AGGIUNTIVO</option>
                <option value="HDD 4TB AGGIUNTIVO" style="background: #1a1a1a; color: white;">HDD 4TB AGGIUNTIVO</option>
                <option value="SCATOLE PEZZI" style="background: #1a1a1a; color: white;">SCATOLE PEZZI</option>
            </select>
        </div>
        
        <div style="margin-bottom: 20px;">
            <label style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 600; font-size: 0.95em;">Nome della voce *</label>
            <input type="text" id="order-custom-item-name" placeholder="es: Note, Accessori, Upgrade..." required style="width: 100%; padding: 12px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-size: 1em; outline: none; transition: all 0.3s ease; box-sizing: border-box; text-transform: uppercase;" onfocus="this.style.borderColor='rgba(255,255,255,0.6)'; this.style.background='rgba(255,255,255,0.25)'" onblur="this.style.borderColor='rgba(255,255,255,0.3)'; this.style.background='rgba(255,255,255,0.15)'">
        </div>
        
        <div style="margin-bottom: 20px;">
            <label style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 600; font-size: 0.95em;">Contenuto *</label>
            <textarea id="order-custom-item-value" placeholder="Inserisci il contenuto..." rows="3" required style="width: 100%; padding: 12px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-size: 1em; outline: none; resize: vertical; transition: all 0.3s ease; box-sizing: border-box; font-family: inherit;" onfocus="this.style.borderColor='rgba(255,255,255,0.6)'; this.style.background='rgba(255,255,255,0.25)'" onblur="this.style.borderColor='rgba(255,255,255,0.3)'; this.style.background='rgba(255,255,255,0.15)'"></textarea>
        </div>
        
        <div style="margin-bottom: 20px;">
            <label style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 600; font-size: 0.95em;">Fornitore *</label>
            <select id="order-custom-item-supplier" required style="width: 100%; padding: 12px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-size: 1em; outline: none; transition: all 0.3s ease; box-sizing: border-box; cursor: pointer;" onfocus="this.style.borderColor='rgba(255,255,255,0.6)'; this.style.background='rgba(255,255,255,0.25)'" onblur="this.style.borderColor='rgba(255,255,255,0.3)'; this.style.background='rgba(255,255,255,0.15)'">
                <option value="PROKS" style="background: #1a1a1a; color: white;">PROKS</option>
                <option value="OMEGA" style="background: #1a1a1a; color: white;">OMEGA</option>
                <option value="TIER ONE" style="background: #1a1a1a; color: white;">TIER ONE</option>
                <option value="AMAZON" style="background: #1a1a1a; color: white;">AMAZON</option>
                <option value="NOUA" style="background: #1a1a1a; color: white;">NOUA</option>
                <option value="INTEGRATA" style="background: #1a1a1a; color: white;">INTEGRATA</option>
            </select>
        </div>
        
        <div style="margin-bottom: 25px;">
            <label style="display: block; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 600; font-size: 0.95em;">EAN *</label>
            <input type="text" id="order-custom-item-ean" placeholder="Inserisci EAN..." required style="width: 100%; padding: 12px; border: 2px solid rgba(255,255,255,0.3); border-radius: 8px; background: rgba(255,255,255,0.15); color: white; font-size: 1em; outline: none; transition: all 0.3s ease; box-sizing: border-box;" onfocus="this.style.borderColor='rgba(255,255,255,0.6)'; this.style.background='rgba(255,255,255,0.25)'" onblur="this.style.borderColor='rgba(255,255,255,0.3)'; this.style.background='rgba(255,255,255,0.15)'">
        </div>
        
        <div style="display: flex; gap: 12px;">
            <button id="cancel-order-custom-item" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.3); color: white; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 1em; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">Annulla</button>
            <button id="confirm-order-custom-item" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.9); border: 2px solid white; color: #667eea; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 1em; transition: all 0.3s ease;" onmouseover="this.style.background='white'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.9)'; this.style.transform=''; this.style.boxShadow=''">Aggiungi</button>
        </div>
    `;
    
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    
    setTimeout(() => {
        document.getElementById('order-custom-item-name').focus();
    }, 100);
    
    
    const cancelBtn = popup.querySelector('#cancel-order-custom-item');
    const confirmBtn = popup.querySelector('#confirm-order-custom-item');
    const presetSelect = popup.querySelector('#order-custom-item-preset');

    presetSelect.addEventListener('change', () => {
        const selectedPreset = presetSelect.value;
        if (!selectedPreset) return;

        const nameInput = document.getElementById('order-custom-item-name');
        const valueInput = document.getElementById('order-custom-item-value');
        const supplierInput = document.getElementById('order-custom-item-supplier');
        const eanInput = document.getElementById('order-custom-item-ean');

        nameInput.value = selectedPreset;
        valueInput.value = selectedPreset;
        supplierInput.value = 'AMAZON';
        eanInput.value = selectedPreset;
    });
    
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });
    
    confirmBtn.addEventListener('click', () => {
        const itemName = document.getElementById('order-custom-item-name').value.trim();
        const itemValue = document.getElementById('order-custom-item-value').value.trim();
        const itemSupplier = document.getElementById('order-custom-item-supplier').value;
        const itemEan = document.getElementById('order-custom-item-ean').value.trim();
        
        if (!itemName) {
            alert('❌ Nome della voce obbligatorio');
            document.getElementById('order-custom-item-name').style.borderColor = '#f44336';
            document.getElementById('order-custom-item-name').focus();
            return;
        }
        
        if (!itemValue) {
            alert('❌ Contenuto obbligatorio');
            document.getElementById('order-custom-item-value').style.borderColor = '#f44336';
            document.getElementById('order-custom-item-value').focus();
            return;
        }
        
        if (!itemEan) {
            alert('❌ EAN obbligatorio');
            document.getElementById('order-custom-item-ean').style.borderColor = '#f44336';
            document.getElementById('order-custom-item-ean').focus();
            return;
        }
        
        
        addCustomItem(orderId, itemName, itemValue, itemSupplier, itemEan);
        overlay.remove();
        showNotification(`Voce "${itemName}" aggiunta`);
    });
    
    
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
        }
    });
    
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}


async function addCustomItem(orderId, itemName, itemValue, itemSupplier = '', itemEan = '') {
    const customItemsContainer = document.getElementById(`custom-items-${orderId}`);
    
    
    const currentItems = customItemsContainer.querySelectorAll('.custom-item-row');
    if (currentItems.length >= 5) {
        showNotification('⚠️ Massimo 5 voci personalizzate consentite');
        return;
    }
    
    
    const itemNameUpper = itemName.toUpperCase();
    
    
    let supplierColor = '#95a5a6';
    if (itemSupplier === 'PROKS') supplierColor = '#e74c3c';
    else if (itemSupplier === 'OMEGA') supplierColor = '#9b59b6';
    else if (itemSupplier === 'TIER ONE') supplierColor = '#3498db';
    else if (itemSupplier === 'AMAZON') supplierColor = '#f39c12';
    else if (itemSupplier === 'NOUA') supplierColor = '#2ecc71';
    else if (itemSupplier === 'INTEGRATA') supplierColor = '#7f8c8d';
    
    
    const itemId = `custom-item-${orderId}-${Date.now()}`;
    const itemDiv = document.createElement('div');
    itemDiv.className = 'custom-item-row';
    itemDiv.dataset.itemId = itemId;
    itemDiv.dataset.supplier = itemSupplier;
    itemDiv.dataset.ean = itemEan;
    itemDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 8px; background: rgba(33, 150, 243, 0.1); border-radius: 6px; border: 1px solid rgba(33, 150, 243, 0.3);';
    
    itemDiv.innerHTML = `
        <div style="flex: 1;">
            <strong style="color: #2196F3; font-size: 0.9em;">${itemNameUpper}:</strong>
            <span style="color: rgba(255,255,255,0.95); font-size: 0.88em; font-weight: 600; margin-left: 8px;">${itemValue}</span>
            ${itemEan ? `<span style="color: rgba(255,255,255,0.6); font-size: 0.8em; margin-left: 8px;">(EAN: ${itemEan})</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: ${supplierColor}; color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.75em; font-weight: 700; min-width: 65px; text-align: center;">${itemSupplier}</span>
            <button class="remove-custom-item-btn" data-item-id="${itemId}" style="background: rgba(244, 67, 54, 0.2); border: 1px solid rgba(244, 67, 54, 0.5); color: #f44336; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: 600; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.3)'" onmouseout="this.style.background='rgba(244, 67, 54, 0.2)'">
                ✕
            </button>
        </div>
    `;
    
    customItemsContainer.appendChild(itemDiv);
    
    
    await saveCustomItems(orderId);
}


async function saveCustomItems(orderId) {
    const customItemsContainer = document.getElementById(`custom-items-${orderId}`);
    const items = [];
    
    customItemsContainer.querySelectorAll('.custom-item-row').forEach(row => {
        const name = row.querySelector('strong').textContent.replace(':', '').trim();
        const spans = row.querySelectorAll('span');
        const value = spans[0].textContent.trim();
        const supplier = row.dataset.supplier || '';
        const ean = row.dataset.ean || '';
        items.push({ name, value, supplier, ean });
    });
    
    await saveCustomItemsToDB(orderId, items);
}


async function loadCustomItems(orderId) {
    const customItemsContainer = document.getElementById(`custom-items-${orderId}`);
    
    if (!customItemsContainer) return;
    
    const items = await loadCustomItemsFromDB(orderId);
    
    items.forEach((item, index) => {
        const itemSupplier = item.supplier || '';
        const itemEan = item.ean || '';
        
        
        let supplierColor = '#95a5a6';
        if (itemSupplier === 'PROKS') supplierColor = '#e74c3c';
        else if (itemSupplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (itemSupplier === 'TIER ONE') supplierColor = '#3498db';
        else if (itemSupplier === 'AMAZON') supplierColor = '#f39c12';
        else if (itemSupplier === 'NOUA') supplierColor = '#2ecc71';
        else if (itemSupplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        
        const itemId = `custom-item-${orderId}-${Date.now()}-${index}`;
        const itemDiv = document.createElement('div');
        itemDiv.className = 'custom-item-row';
        itemDiv.dataset.itemId = itemId;
        itemDiv.dataset.supplier = itemSupplier;
        itemDiv.dataset.ean = itemEan;
        itemDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 8px; background: rgba(33, 150, 243, 0.1); border-radius: 6px; border: 1px solid rgba(33, 150, 243, 0.3);';
        
        
        const itemNameUpper = item.name.toUpperCase();
        
        itemDiv.innerHTML = `
            <div style="flex: 1;">
                <strong style="color: #2196F3; font-size: 0.9em;">${itemNameUpper}:</strong>
                <span style="color: rgba(255,255,255,0.95); font-size: 0.88em; font-weight: 600; margin-left: 8px;">${item.value}</span>
                ${itemEan ? `<span style="color: rgba(255,255,255,0.6); font-size: 0.8em; margin-left: 8px;">(EAN: ${itemEan})</span>` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                ${itemSupplier ? `<span style="background: ${supplierColor}; color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.75em; font-weight: 700; min-width: 65px; text-align: center;">${itemSupplier}</span>` : ''}
                <button class="remove-custom-item-btn" data-item-id="${itemId}" style="background: rgba(244, 67, 54, 0.2); border: 1px solid rgba(244, 67, 54, 0.5); color: #f44336; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: 600; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(244, 67, 54, 0.3)'" onmouseout="this.style.background='rgba(244, 67, 54, 0.2)'">
                    ✕
                </button>
            </div>
        `;
        
        customItemsContainer.appendChild(itemDiv);
    });
}





const searchBtn = document.getElementById('search-btn');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');

async function toggleSearchBar() {
    const isVisible = searchBar.style.display === 'flex';
    if (!isVisible) {
        
        if (typeof window.closeAllOverlayPages === 'function') {
            await window.closeAllOverlayPages(true);
        }
    }
    searchBar.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
        searchInput.focus();
    }
}


searchBtn?.addEventListener('click', toggleSearchBar);


searchClearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    searchBar.style.display = 'none';
});


searchInput?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.trim().toUpperCase();
    const cards = document.querySelectorAll('.order-card');
    
    cards.forEach(card => {
        const orderHeader = card.querySelector('h2');
        if (!orderHeader) return;
        
        const orderName = orderHeader.textContent.toUpperCase();
        
        if (!searchTerm || orderName.includes(searchTerm)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
});


document.addEventListener('click', (e) => {
    const clickedSearchBtn = searchBtn ? searchBtn.contains(e.target) : false;
    if (!searchBar.contains(e.target) && !clickedSearchBtn) {
        if (searchBar.style.display === 'flex') {
            searchBar.style.display = 'none';
        }
    }
});












let ordersSelectionMode = false;
let selectedOrders = new Set();

function toggleOrdersSelectionMode() {
    ordersSelectionMode = !ordersSelectionMode;
    const selectBtn = document.getElementById('select-orders-btn');
    const hideSelectedOrdersBtn = document.getElementById('hide-selected-orders-btn');
    
    if (ordersSelectionMode) {
        
        selectBtn.querySelector('img').style.opacity = '1';
        selectBtn.querySelector('img').style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
        
        
        document.querySelectorAll('#orders-container .order-card').forEach(card => {
            addOrdersSelectionIconToCard(card);
        });
    } else {
        
        exitOrdersSelectionMode();
    }
}

function exitOrdersSelectionMode() {
    ordersSelectionMode = false;
    selectedOrders.clear();
    
    const selectBtn = document.getElementById('select-orders-btn');
    const processSelectedOrdersContainer = document.getElementById('process-selected-orders-container');
    
    if (selectBtn) {
        selectBtn.querySelector('img').style.opacity = '0.9';
        selectBtn.querySelector('img').style.filter = 'brightness(0) invert(1)';
    }
    
    if (processSelectedOrdersContainer) {
        processSelectedOrdersContainer.style.display = 'none';
    }
    
    
    document.querySelectorAll('.orders-select-icon').forEach(icon => icon.remove());
}

function addOrdersSelectionIconToCard(card) {
    const headerIcons = card.querySelector('.header-icons');
    if (!headerIcons || headerIcons.querySelector('.orders-select-icon')) return;
    
    const orderId = card.dataset.orderId;
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'orders-select-icon';
    iconContainer.dataset.orderId = orderId;
    iconContainer.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; padding: 6px; border-radius: 8px; transition: all 0.2s ease; margin-right: 6px; vertical-align: middle;';
    
    const icon = document.createElement('img');
    icon.src = 'https://img.icons8.com/?size=512&id=3pldZIZvVCVB&format=png';
    icon.style.cssText = 'width: 20px; height: 20px; filter: brightness(0) invert(1); transition: all 0.2s ease; vertical-align: middle;';
    
    iconContainer.appendChild(icon);
    
    
    iconContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOrdersSelection(orderId, iconContainer, icon);
    });
    
    
    headerIcons.insertBefore(iconContainer, headerIcons.firstChild);
}

function toggleOrdersSelection(orderId, container, icon) {
    if (selectedOrders.has(orderId)) {
        
        selectedOrders.delete(orderId);
        icon.style.filter = 'brightness(0) invert(1)';
        container.style.background = 'transparent';
    } else {
        
        selectedOrders.add(orderId);
        icon.style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
        container.style.background = 'rgba(46, 204, 113, 0.2)';
    }
    
    updateProcessSelectedOrdersButton();
}

function updateProcessSelectedOrdersButton() {
    const processSelectedOrdersContainer = document.getElementById('process-selected-orders-container');
    const processSelectedOrdersButtons = document.querySelectorAll('.process-selected-orders-btn');
    
    if (selectedOrders.size > 0) {
        if (processSelectedOrdersContainer) {
            processSelectedOrdersContainer.style.display = 'flex';
        }
        processSelectedOrdersButtons.forEach(btn => {
            const worksheet = btn.dataset.worksheet || '1';
            btn.textContent = `E${worksheet}`;
            btn.title = `Elabora ${selectedOrders.size} ordini selezionati in E${worksheet}`;
            btn.style.color = '#ffffff';
            btn.style.background = '#2f62ff';
        });
    } else {
        if (processSelectedOrdersContainer) processSelectedOrdersContainer.style.display = 'none';
    }
}

async function processSelectedOrders(worksheetNumber = null) {
    if (selectedOrders.size === 0) return;
    
    const count = selectedOrders.size;
    
    if (!confirm(`Vuoi elaborare ${count} ordini?`)) {
        return;
    }
    
    const targetWorksheet = Math.min(4, Math.max(1, parseInt(worksheetNumber, 10) || getActiveWorksheetTab()));

    
    for (const orderId of selectedOrders) {
        await processOrder(orderId, true, targetWorksheet);
    }
    
    
    exitOrdersSelectionMode();
    setTimeout(() => {
        loadOrdersFromShopify();
    }, 500);
    
    showNotification(`📦 ${count} ordini elaborati in E${targetWorksheet}`);
}


document.getElementById('select-orders-btn')?.addEventListener('click', toggleOrdersSelectionMode);
document.querySelectorAll('.process-selected-orders-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const worksheet = btn.dataset.worksheet;
        processSelectedOrders(worksheet);
    });
});





let processedSelectionMode = false;
let selectedProcessedOrders = new Set();

function toggleProcessedSelectionMode() {
    processedSelectionMode = !processedSelectionMode;
    const selectBtn = document.getElementById('select-processed-btn');
    const tabsContainer = document.getElementById('tabs-buttons-container');
    const finalizeSelectedBtn = document.getElementById('finalize-selected-processed-btn');
    const moveToOrdersBtn = document.getElementById('move-to-orders-btn');
    const moveToWorksheetContainer = document.getElementById('move-to-worksheet-container');
    
    if (processedSelectionMode) {
        
        selectBtn.querySelector('img').style.opacity = '1';
        selectBtn.querySelector('img').style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
        
        
        if (tabsContainer) {
            tabsContainer.style.display = 'none';
        }
        
        
        if (finalizeSelectedBtn) {
            finalizeSelectedBtn.style.display = 'block';
            finalizeSelectedBtn.textContent = `✅ Finalizza (0)`;
            finalizeSelectedBtn.style.color = '#111111';
        }
        if (moveToOrdersBtn) {
            moveToOrdersBtn.style.display = 'block';
            moveToOrdersBtn.textContent = `📋 Ordini (0)`;
            moveToOrdersBtn.style.color = '#111111';
        }
        if (moveToWorksheetContainer) {
            moveToWorksheetContainer.style.display = 'flex';
        }
        
        
        document.querySelectorAll('#processed-container .order-card').forEach(card => {
            addProcessedSelectionIconToCard(card);
        });
    } else {
        
        exitProcessedSelectionMode();
    }
}

function exitProcessedSelectionMode() {
    processedSelectionMode = false;
    selectedProcessedOrders.clear();
    
    const selectBtn = document.getElementById('select-processed-btn');
    const finalizeSelectedBtn = document.getElementById('finalize-selected-processed-btn');
    const moveToOrdersBtn = document.getElementById('move-to-orders-btn');
    const moveToWorksheetContainer = document.getElementById('move-to-worksheet-container');
    const tabsContainer = document.getElementById('tabs-buttons-container');
    
    if (selectBtn) {
        selectBtn.querySelector('img').style.opacity = '0.9';
        selectBtn.querySelector('img').style.filter = 'brightness(0) invert(1)';
    }
    
    if (finalizeSelectedBtn) {
        finalizeSelectedBtn.style.display = 'none';
    }
    
    if (moveToOrdersBtn) {
        moveToOrdersBtn.style.display = 'none';
    }

    if (moveToWorksheetContainer) {
        moveToWorksheetContainer.style.display = 'none';
    }
    
    
    if (tabsContainer) {
        tabsContainer.style.display = 'flex';
    }
    
    
    document.querySelectorAll('.processed-select-icon').forEach(icon => icon.remove());
}

function addProcessedSelectionIconToCard(card) {
    
    if (card.querySelector('.processed-select-icon')) return;
    
    const orderId = card.dataset.orderId;
    if (!orderId) return; 
    
    
    const configBadge = card.querySelector('.config-badge');
    const cardHeader = card.querySelector('.card-header');
    
    if (!cardHeader) return;
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'processed-select-icon';
    iconContainer.dataset.orderId = orderId;
    iconContainer.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; padding: 4px; border-radius: 6px; transition: all 0.2s ease; vertical-align: middle;';
    
    const icon = document.createElement('img');
    icon.src = 'https://img.icons8.com/?size=512&id=3pldZIZvVCVB&format=png';
    icon.style.cssText = 'width: 20px; height: 20px; filter: brightness(0) invert(1); transition: all 0.2s ease; vertical-align: middle;';
    
    iconContainer.appendChild(icon);
    
    
    iconContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleProcessedSelection(orderId, iconContainer, icon);
    });
    
    
    if (configBadge && configBadge.parentNode) {
        configBadge.parentNode.insertBefore(iconContainer, configBadge);
    } else {
        
        cardHeader.insertBefore(iconContainer, cardHeader.firstChild);
    }
}

function toggleProcessedSelection(orderId, container, icon) {
    if (selectedProcessedOrders.has(orderId)) {
        
        selectedProcessedOrders.delete(orderId);
        icon.style.filter = 'brightness(0) invert(1)';
        container.style.background = 'transparent';
    } else {
        
        selectedProcessedOrders.add(orderId);
        icon.style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
        container.style.background = 'rgba(46, 204, 113, 0.2)';
    }
    
    updateProcessedSelectionButtons();
}

function updateProcessedSelectionButtons() {
    const finalizeSelectedBtn = document.getElementById('finalize-selected-processed-btn');
    const moveToOrdersBtn = document.getElementById('move-to-orders-btn');
    const moveToWorksheetButtons = document.querySelectorAll('.move-to-worksheet-btn');
    
    if (selectedProcessedOrders.size > 0) {
        if (finalizeSelectedBtn) {
            finalizeSelectedBtn.style.display = 'block';
            finalizeSelectedBtn.textContent = `✅ Finalizza (${selectedProcessedOrders.size})`;
            finalizeSelectedBtn.style.color = '#111111';
        }
        if (moveToOrdersBtn) {
            moveToOrdersBtn.style.display = 'block';
            moveToOrdersBtn.textContent = `📋 Ordini (${selectedProcessedOrders.size})`;
            moveToOrdersBtn.style.color = '#111111';
        }
        moveToWorksheetButtons.forEach(btn => {
            const targetWorksheet = btn.dataset.targetWorksheet || '1';
            btn.style.display = 'inline-flex';
            btn.style.color = '#111111';
            btn.textContent = `Sposta E${targetWorksheet} (${selectedProcessedOrders.size})`;
            btn.title = `Sposta ${selectedProcessedOrders.size} ordini selezionati in E${targetWorksheet}`;
        });
    } else {
        if (finalizeSelectedBtn) finalizeSelectedBtn.style.display = 'none';
        if (moveToOrdersBtn) moveToOrdersBtn.style.display = 'none';
        moveToWorksheetButtons.forEach(btn => {
            const targetWorksheet = btn.dataset.targetWorksheet || '1';
            btn.style.display = 'inline-flex';
            btn.textContent = `Sposta E${targetWorksheet}`;
        });
    }
}

async function finalizeSelectedProcessedOrders() {
    if (selectedProcessedOrders.size === 0) return;
    
    const count = selectedProcessedOrders.size;
    
    if (!confirm(`Vuoi finalizzare ${count} ordini?`)) {
        return;
    }
    
    let successCount = 0;
    
    
    for (const orderId of selectedProcessedOrders) {
        
        const saved = await addOrderedIdToDB(orderId);
        
        if (saved) {
            
            await updateProcessedOrderStato(orderId, 'finalizzati');
            successCount++;
            const card = document.querySelector(`#processed-container .order-card[data-order-id="${orderId}"]`);
            if (card) {
                
                const selectIcon = card.querySelector('.processed-select-icon');
                if (selectIcon) selectIcon.remove();
                
                
                const finalizedContainer = document.getElementById('finalized-container');
                if (finalizedContainer) {
                    finalizedContainer.appendChild(card);
                }
            }
        }
    }
    
    
    exitProcessedSelectionMode();
    
    showNotification(`✅ ${successCount} ordini finalizzati`);
    
    
    updateOrderCounts();
    updateProcessedCounter(getActiveWorksheetTab());
}

async function moveSelectedToOrders() {
    if (selectedProcessedOrders.size === 0) return;
    
    const count = selectedProcessedOrders.size;
    
    if (!confirm(`Vuoi spostare ${count} ordini in "Ordini"? Le elaborazioni verranno rimosse.`)) {
        return;
    }
    
    
    for (const orderId of selectedProcessedOrders) {
        
        await deleteProcessedOrderFromDB(orderId);
    }
    
    
    exitProcessedSelectionMode();
    
    showNotification(`📋 ${count} ordini spostati in "Ordini"`);
    
    
    setTimeout(() => {
        loadOrdersFromShopify();
    }, 500);
}

async function moveSelectedToWorksheet(targetWorksheet) {
    if (selectedProcessedOrders.size === 0) return;

    const worksheet = Math.min(4, Math.max(1, parseInt(targetWorksheet, 10) || 1));
    const count = selectedProcessedOrders.size;

    if (!confirm(`Vuoi spostare ${count} ordini in E${worksheet}?`)) {
        return;
    }

    let successCount = 0;
    for (const orderId of selectedProcessedOrders) {
        const moved = await updateProcessedOrderWorksheet(orderId, worksheet);
        if (moved) {
            successCount++;
        }
    }

    exitProcessedSelectionMode();
    showNotification(`📦 ${successCount} ordini spostati in E${worksheet}`);

    setTimeout(() => {
        loadOrdersFromShopify();
    }, 350);
}


function selectAllProcessedOrders() {
    if (!processedSelectionMode) return;
    
    const allCards = document.querySelectorAll('#processed-container .order-card');
    
    allCards.forEach(card => {
        const orderId = card.dataset.orderId;
        const iconContainer = card.querySelector('.processed-select-icon');
        const icon = iconContainer?.querySelector('img');
        
        if (orderId && iconContainer && icon && !selectedProcessedOrders.has(orderId)) {
            selectedProcessedOrders.add(orderId);
            icon.style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
            iconContainer.style.background = 'rgba(46, 204, 113, 0.2)';
        }
    });
    
    updateProcessedSelectionButtons();
}


document.addEventListener('keydown', (e) => {
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (processedSelectionMode) {
            e.preventDefault(); 
            selectAllProcessedOrders();
        } else if (finalizedSelectionMode) {
            e.preventDefault();
            selectAllFinalizedOrders();
        }
    }
});


document.getElementById('select-processed-btn')?.addEventListener('click', toggleProcessedSelectionMode);
document.getElementById('finalize-selected-processed-btn')?.addEventListener('click', finalizeSelectedProcessedOrders);
document.getElementById('move-to-orders-btn')?.addEventListener('click', moveSelectedToOrders);
document.querySelectorAll('.move-to-worksheet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetWorksheet = btn.dataset.targetWorksheet;
        moveSelectedToWorksheet(targetWorksheet);
    });
});





let finalizedSelectionMode = false;
let selectedFinalizedOrders = new Set();

function toggleFinalizedSelectionMode() {
    finalizedSelectionMode = !finalizedSelectionMode;
    const selectBtn = document.getElementById('select-finalized-btn');
    const rielaboraBtn = document.getElementById('rielabora-selected-btn');
    
    if (finalizedSelectionMode) {
        
        selectBtn.querySelector('img').style.opacity = '1';
        selectBtn.querySelector('img').style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
        
        
        document.querySelectorAll('#finalized-container .order-card').forEach(card => {
            addSelectionIconToCard(card);
            
            
            const restoreBtn = card.querySelector('.restore-to-pending-btn');
            const hideBtn = card.querySelector('.hide-order-btn');
            if (restoreBtn) restoreBtn.style.display = 'none';
            if (hideBtn) hideBtn.style.display = 'none';
        });
    } else {
        
        exitFinalizedSelectionMode();
    }
}

function exitFinalizedSelectionMode() {
    finalizedSelectionMode = false;
    selectedFinalizedOrders.clear();
    
    const selectBtn = document.getElementById('select-finalized-btn');
    const rielaboraBtn = document.getElementById('rielabora-selected-btn');
    const hideSelectedBtn = document.getElementById('hide-selected-btn');
    
    if (selectBtn) {
        selectBtn.querySelector('img').style.opacity = '0.7';
        selectBtn.querySelector('img').style.filter = 'brightness(0) invert(1)';
    }
    
    if (rielaboraBtn) {
        rielaboraBtn.style.display = 'none';
    }
    
    if (hideSelectedBtn) {
        hideSelectedBtn.style.display = 'none';
    }
    
    
    document.querySelectorAll('.finalized-select-icon').forEach(icon => icon.remove());
    
    
    document.querySelectorAll('#finalized-container .order-card').forEach(card => {
        const restoreBtn = card.querySelector('.restore-to-pending-btn');
        const hideBtn = card.querySelector('.hide-order-btn');
        if (restoreBtn) restoreBtn.style.display = '';
        if (hideBtn) hideBtn.style.display = '';
    });
}


function selectAllFinalizedOrders() {
    if (!finalizedSelectionMode) return;
    
    const allCards = document.querySelectorAll('#finalized-container .order-card');
    
    allCards.forEach(card => {
        const orderId = card.dataset.orderId;
        const iconContainer = card.querySelector('.finalized-select-icon');
        const icon = iconContainer?.querySelector('img');
        
        if (orderId && iconContainer && icon && !selectedFinalizedOrders.has(orderId)) {
            selectedFinalizedOrders.add(orderId);
            icon.style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
            iconContainer.style.background = 'rgba(46, 204, 113, 0.2)';
        }
    });
    
    updateRielaboraButton();
}

function addSelectionIconToCard(card) {
    const header = card.querySelector('.card-header');
    if (!header || header.querySelector('.finalized-select-icon')) return;
    
    const orderId = card.dataset.orderId;
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'finalized-select-icon';
    iconContainer.dataset.orderId = orderId;
    iconContainer.style.cssText = 'position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; z-index: 10; padding: 8px; border-radius: 50%; transition: all 0.2s ease;';
    
    const icon = document.createElement('img');
    icon.src = 'https://img.icons8.com/?size=512&id=3pldZIZvVCVB&format=png';
    icon.style.cssText = 'width: 24px; height: 24px; filter: brightness(0) invert(1); transition: all 0.2s ease;';
    
    iconContainer.appendChild(icon);
    
    
    iconContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOrderSelection(orderId, iconContainer, icon);
    });
    
    
    header.style.position = 'relative';
    header.appendChild(iconContainer);
}

function toggleOrderSelection(orderId, container, icon) {
    if (selectedFinalizedOrders.has(orderId)) {
        
        selectedFinalizedOrders.delete(orderId);
        icon.style.filter = 'brightness(0) invert(1)';
        container.style.background = 'transparent';
    } else {
        
        selectedFinalizedOrders.add(orderId);
        icon.style.filter = 'brightness(0) saturate(100%) invert(73%) sepia(28%) saturate(1207%) hue-rotate(93deg) brightness(92%) contrast(85%)';
        container.style.background = 'rgba(46, 204, 113, 0.2)';
    }
    
    updateRielaboraButton();
}

function updateRielaboraButton() {
    const rielaboraBtn = document.getElementById('rielabora-selected-btn');
    const hideSelectedBtn = document.getElementById('hide-selected-btn');
    
    if (selectedFinalizedOrders.size > 0) {
        if (rielaboraBtn) {
            rielaboraBtn.style.display = 'block';
            rielaboraBtn.textContent = `🔄 Rielabora (${selectedFinalizedOrders.size})`;
        }
        if (hideSelectedBtn) {
            hideSelectedBtn.style.display = 'block';
            hideSelectedBtn.textContent = `👁️ Nascondi (${selectedFinalizedOrders.size})`;
        }
    } else {
        if (rielaboraBtn) rielaboraBtn.style.display = 'none';
        if (hideSelectedBtn) hideSelectedBtn.style.display = 'none';
    }
}

async function rielaboraSelectedOrders() {
    if (selectedFinalizedOrders.size === 0) return;
    
    const count = selectedFinalizedOrders.size;
    
    if (!confirm(`Vuoi rielaborare ${count} ordini? Verranno spostati in "Elaborati" con i componenti aggiornati.`)) {
        return;
    }
    
    
    
    for (const orderId of selectedFinalizedOrders) {
        await removeOrderedIdFromDB(orderId);
        await updateProcessedOrderStato(orderId, 'elaborati');
    }
    
    
    exitFinalizedSelectionMode();
    
    showNotification(`🔄 Rielaborazione di ${count} ordini in corso...`);
    
    
    setTimeout(() => {
        loadOrdersFromShopify();
    }, 500);
}


async function hideSelectedOrders() {
    if (selectedFinalizedOrders.size === 0) return;
    
    const count = selectedFinalizedOrders.size;
    
    if (!confirm(`Vuoi nascondere ${count} ordini?`)) {
        return;
    }
    
    
    for (const orderId of selectedFinalizedOrders) {
        await hideOrderInDB(orderId);
    }
    
    
    exitFinalizedSelectionMode();
    
    showNotification(`👁️ ${count} ordini nascosti`);
    
    
    setTimeout(() => {
        loadOrdersFromShopify();
    }, 500);
}


document.getElementById('select-finalized-btn')?.addEventListener('click', toggleFinalizedSelectionMode);
document.getElementById('rielabora-selected-btn')?.addEventListener('click', rielaboraSelectedOrders);
document.getElementById('hide-selected-btn')?.addEventListener('click', hideSelectedOrders);






const SUPPLIER_LOGS_API_URL = 'api_gateway/db_bridge/supplier_logs_service/endpoint/api-supplier-logs.php';

async function saveSupplierLog(orderIds, supplierData) {
    try {
        const response = await fetch(SUPPLIER_LOGS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderIds: orderIds,
                supplierData: supplierData
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            
            updateSupplierLogDisplay();
        } else {
            console.error('❌ Errore salvataggio log:', data.error);
        }
    } catch (error) {
        console.error('❌ Errore salvataggio log:', error);
    }
}

async function updateSupplierLogDisplay() {
    const logList = document.getElementById('suppliers-log-list');
    if (!logList) return;
    
    try {
        const response = await fetch(SUPPLIER_LOGS_API_URL);
        const data = await response.json();
        
        if (!data.success || !data.logs || data.logs.length === 0) {
            logList.innerHTML = '<p style="color: rgba(255,255,255,0.5); font-size: 0.9em;">Nessun aggiornamento ancora</p>';
            return;
        }
        
        const logs = data.logs;
        
        let html = '';
        logs.forEach((log) => {
            const date = new Date(log.timestamp);
            const formattedDate = date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const formattedTime = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            
            
            const formattedOrders = log.orderIds.map(id => `#${String(id).padStart(4, '0')}`).join(', ');
            
            html += `
                <div class="suppliers-log-item" data-log-id="${log.id}" title="Ordini: ${formattedOrders}" style="cursor: pointer;">
                    <span class="suppliers-log-time">${formattedDate} ${formattedTime}</span>
                    <span class="suppliers-log-count">${log.count} ordini</span>
                </div>
            `;
        });
        
        logList.innerHTML = html;
        
        
        document.querySelectorAll('.suppliers-log-item').forEach(item => {
            let pressTimer;
            
            
            item.addEventListener('mousedown', (e) => {
                const logId = item.dataset.logId;
                
                pressTimer = setTimeout(async () => {
                    if (confirm(`Vuoi eliminare questo log?`)) {
                        try {
                            const deleteResponse = await fetch(`${SUPPLIER_LOGS_API_URL}?id=${logId}`, {
                                method: 'DELETE'
                            });
                            const deleteData = await deleteResponse.json();
                            
                            if (deleteData.success) {
                                
                                updateSupplierLogDisplay();
                                showNotification('🗑️ Log eliminato');
                            } else {
                                showNotification('❌ Errore eliminazione log');
                            }
                        } catch (error) {
                            console.error('Errore eliminazione log:', error);
                            showNotification('❌ Errore eliminazione log');
                        }
                    }
                }, 5000); 
            });
            
            item.addEventListener('mouseup', () => {
                clearTimeout(pressTimer);
            });
            
            item.addEventListener('mouseleave', () => {
                clearTimeout(pressTimer);
            });
            
            
            item.addEventListener('click', async () => {
                clearTimeout(pressTimer); 
                
                const logId = item.dataset.logId;
                
                try {
                    const logResponse = await fetch(`${SUPPLIER_LOGS_API_URL}?id=${logId}`);
                    const logData = await logResponse.json();
                    
                    if (logData.success && logData.log && logData.log.supplierData) {
                        populateSuppliersSection(logData.log.supplierData);
                        window.currentSupplierData = logData.log.supplierData;
                        
                        showNotification(`📅 Caricati dati del ${new Date(logData.log.timestamp).toLocaleDateString('it-IT')}`);
                    }
                } catch (error) {
                    console.error('Errore caricamento log:', error);
                    showNotification('❌ Errore caricamento log');
                }
            });
        });
        
    } catch (error) {
        console.error('Errore caricamento log:', error);
        logList.innerHTML = '<p style="color: rgba(255,255,255,0.5); font-size: 0.9em;">Errore caricamento log</p>';
    }
}


document.addEventListener('DOMContentLoaded', () => {
    updateSupplierLogDisplay();
    
    
    const sinceIdInput = document.getElementById('since-id-input');
    
    
    const savedSinceId = localStorage.getItem('since_id_filter');
    if (savedSinceId && sinceIdInput) {
        sinceIdInput.value = savedSinceId;
    }
    
    
    if (sinceIdInput) {
        sinceIdInput.addEventListener('blur', () => {
            const sinceId = sinceIdInput.value.trim();
            if (sinceId) {
                localStorage.setItem('since_id_filter', sinceId);
            } else {
                localStorage.removeItem('since_id_filter');
            }
            loadOrdersFromShopify();
        });
        
        
        sinceIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sinceIdInput.blur(); 
            }
        });
    }
});





const processedStatsDiv = document.getElementById('processed-stats');
const paymentPopup = document.getElementById('payment-popup');
const paymentPopupOverlay = document.getElementById('payment-popup-overlay');
const closePaymentPopupBtn = document.getElementById('close-payment-popup');


function calculateDaysRemaining() {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const currentDay = today.getDate();
    
    
    let targetDate;
    if (currentDay <= 20) {
        
        targetDate = new Date(currentYear, currentMonth, 20);
    } else {
        
        targetDate = new Date(currentYear, currentMonth + 1, 20);
    }
    
    
    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}


function updateStatsBoxColor() {
    if (!processedStatsDiv) return;
    
    const daysRemaining = calculateDaysRemaining();
    
    if (daysRemaining <= 3) {
        
        processedStatsDiv.style.background = 'rgba(231, 76, 60, 0.25)';
        processedStatsDiv.style.borderColor = 'rgba(231, 76, 60, 0.4)';
    } else if (daysRemaining <= 5) {
        
        processedStatsDiv.style.background = 'rgba(243, 156, 18, 0.25)';
        processedStatsDiv.style.borderColor = 'rgba(243, 156, 18, 0.4)';
    } else {
        
        processedStatsDiv.style.background = 'rgba(255, 255, 255, 0.15)';
        processedStatsDiv.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    }
}


processedStatsDiv?.addEventListener('click', () => {
    const daysRemaining = calculateDaysRemaining();
    const daysElement = document.getElementById('days-remaining');
    
    if (daysElement) {
        if (daysRemaining === 0) {
            daysElement.textContent = '⚠️ Scade oggi!';
            daysElement.style.color = '#f39c12';
        } else if (daysRemaining < 0) {
            daysElement.textContent = `⛔ Scaduto da ${Math.abs(daysRemaining)} giorni`;
            daysElement.style.color = '#e74c3c';
        } else {
            daysElement.textContent = `${daysRemaining} giorni`;
            daysElement.style.color = daysRemaining <= 3 ? '#f39c12' : '#2ecc71';
        }
    }
    
    
    const causaleElement = document.getElementById('payment-causale');
    if (causaleElement) {
        const today = new Date();
        const currentDay = today.getDate();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        
        let invoiceMonth, invoiceYear;
        if (currentDay > 20) {
            
            if (currentMonth === 11) { 
                invoiceMonth = 0; 
                invoiceYear = currentYear + 1;
            } else {
                invoiceMonth = currentMonth + 1;
                invoiceYear = currentYear;
            }
        } else {
            
            invoiceMonth = currentMonth;
            invoiceYear = currentYear;
        }
        
        
        const month = String(invoiceMonth + 1).padStart(2, '0');
        const formattedDate = `20/${month}/${invoiceYear}`;
        
        causaleElement.textContent = `Pagamento fattura XXX del ${formattedDate}`;
    }
    
    paymentPopup.style.display = 'block';
    paymentPopupOverlay.style.display = 'block';
});


async function sendStatsToWebhook() {
    try {
        const countElement = document.getElementById('processed-count');
        const totalElement = document.getElementById('processed-total');
        
        const ordersCount = countElement ? parseInt(countElement.textContent) || 0 : 0;
        const totalAmount = totalElement ? parseFloat(totalElement.textContent) || 0 : 0;
        
        
        const now = new Date();
        const formattedDateTime = now.toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const payload = {
            ordini_elaborati: ordersCount,
            totale_euro: totalAmount,
            data_invio: formattedDateTime
        };
        
        await fetch('https://hook.eu2.make.com/pwx1q4lh5closk6yz2b4mdhe33a3g4ty', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        
        
        setTimeout(async () => {
            await resetProcessedOrdersCounter();
            
            loadOrdersFromShopify();
        }, 5 * 60 * 1000); 
        
    } catch (error) {
        console.error('❌ Errore invio webhook:', error);
    }
}


function checkAndSendScheduledWebhook() {
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    
    const webhookKey = `webhook_sent_${currentYear}_${currentMonth}`;
    const alreadySent = localStorage.getItem(webhookKey);
    
    
    if (currentDay === 20 && !alreadySent) {
        sendStatsToWebhook();
        localStorage.setItem(webhookKey, 'true');
    }
}


setTimeout(() => {
    checkAndSendScheduledWebhook();
}, 3000); 


setInterval(() => {
    checkAndSendScheduledWebhook();
}, 60 * 60 * 1000); 


if (processedStatsDiv) {
    
    updateStatsBoxColor();
    
    
    const observer = new MutationObserver(() => {
        if (processedStatsDiv.style.display !== 'none') {
            updateStatsBoxColor();
        }
    });
    observer.observe(processedStatsDiv, { attributes: true, attributeFilter: ['style'] });
}


closePaymentPopupBtn?.addEventListener('click', () => {
    paymentPopup.style.display = 'none';
    paymentPopupOverlay.style.display = 'none';
});

paymentPopupOverlay?.addEventListener('click', () => {
    paymentPopup.style.display = 'none';
    paymentPopupOverlay.style.display = 'none';
});





let currentSearchContext = null; 


document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('supplier-badge-clickable')) {
        const orderId = e.target.dataset.orderId;
        const componentType = e.target.dataset.componentType;
        const supplier = e.target.dataset.supplier;
        
        currentSearchContext = { orderId, componentType, supplier };
        
        
        const eanInput = document.querySelector(`input[data-order-id="${orderId}"][data-component-type="${componentType}"]`);
        const currentEan = eanInput ? eanInput.value.trim() : '';
        
        
        const popup = document.getElementById('component-search-popup');
        const overlay = document.getElementById('component-search-overlay');
        const input = document.getElementById('component-search-input');
        const results = document.getElementById('component-search-results');
        
        
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.left = '50%';
        popup.style.top = '50%';
        
        popup.style.display = 'flex';
        overlay.style.display = 'block';
        
        
        if (currentEan && currentEan.length > 3) {
            input.value = '';
            results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Caricamento nome componente...</p>';
            
            try {
                let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(currentEan)}`;
                if (supplier && supplier !== '--' && supplier !== 'FORNITORE') {
                    url += `&supplier=${encodeURIComponent(supplier)}`;
                }
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.success && data.component && data.component.nome) {
                    
                    input.value = data.component.nome;
                    input.focus();
                    input.select(); 
                    
                    
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    
                    input.value = currentEan;
                    input.focus();
                    input.select();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            } catch (error) {
                console.error('Errore ricerca nome componente:', error);
                input.value = currentEan;
                input.focus();
                results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita per cercare...</p>';
            }
        } else {
            input.value = '';
            input.focus();
            results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita per cercare...</p>';
        }
    }
});


let searchDebounceTimer = null;


document.getElementById('component-search-input')?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const results = document.getElementById('component-search-results');
    
    
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }
    
    if (query.length < 2) {
        results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita almeno 2 caratteri...</p>';
        return;
    }
    
    results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Ricerca in corso...</p>';
    
    
    searchDebounceTimer = setTimeout(async () => {
        try {
        
        const componentType = currentSearchContext?.componentType || '';
        
        
        let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}`;
        if (componentType) {
            url += `&type=${encodeURIComponent(componentType)}`;
        }
        
        
        const response = await fetch(url);
        const data = await response.json();
        
        
        let customData = { success: false, items: [] };
        try {
            let customUrl = `api_gateway/db_bridge/components_service/endpoint/api-custom-items.php?search=${encodeURIComponent(query)}`;
            if (componentType) {
                customUrl += `&type=${encodeURIComponent(componentType)}`;
            }
            const customResponse = await fetch(customUrl);
            if (customResponse.ok) {
                customData = await customResponse.json();
            }
        } catch (customError) {
            console.warn('Articoli custom non disponibili:', customError);
            
        }
        
        
        let allComponents = [];
        if (data.success && data.components) {
            allComponents = [...data.components];
        }
        if (customData.success && customData.items) {
            
            const customItems = customData.items.map(item => ({
                ...item,
                nome: item.nome,
                ean: item.ean,
                categoria: item.categoria,
                fornitore: item.fornitore,
                prezzo: item.prezzo,
                quantita: item.quantita || 999,
                isCustom: true 
            }));
            allComponents = [...allComponents, ...customItems];
        }
        
        if (allComponents.length > 0) {
            
            const availableComponents = allComponents.filter(c => parseInt(c.quantita) > 0);
            
            if (availableComponents.length === 0) {
                results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun componente disponibile (quantità > 0)</p>';
                return;
            }
            
            
            let recommended;
            
            
            const componentType = currentSearchContext?.componentType || '';
            if (componentType === 'SSD') {
                
                const m2Components = availableComponents.filter(c => 
                    c.nome.toLowerCase().includes('m.2') || 
                    c.nome.toLowerCase().includes('m2') ||
                    c.nome.toLowerCase().includes('nvme')
                );
                
                if (m2Components.length > 0) {
                    
                    const sortedM2 = [...m2Components].sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
                    recommended = sortedM2[0];
                } else {
                    
                    const sortedByPrice = [...availableComponents].sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
                    recommended = sortedByPrice[0];
                }
            } else {
                
                const sortedByPrice = [...availableComponents].sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
                recommended = sortedByPrice[0];
            }
            
            
            let html = '';
            
            
            html += `
                <div class="component-search-result" data-ean="${recommended.ean}" data-supplier="${recommended.fornitore || ''}" style="padding: 12px; margin-bottom: 12px; background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1)); border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 1px solid rgba(46, 204, 113, 0.4);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 700;">⭐ CONSIGLIATO</span>
                        <span style="color: #2ecc71; font-weight: 700; font-size: 1.1em;">€${parseFloat(recommended.prezzo).toFixed(2)}</span>
                    </div>
                    <div style="color: white; font-weight: 600; font-size: 0.95em; margin-bottom: 4px;">${recommended.nome}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">EAN: ${recommended.ean}</span>
                    </div>
                    <div style="color: rgba(255,255,255,0.5); font-size: 0.8em; margin-top: 4px;">Qtà: ${recommended.quantita} | ${recommended.fornitore || 'N/D'}</div>
                </div>
            `;
            
            
            if (availableComponents.length > 1) {
                html += '<div style="border-bottom: 1px solid rgba(255,255,255,0.1); margin: 8px 0; padding-bottom: 4px; color: rgba(255,255,255,0.4); font-size: 0.8em;">Altri risultati (dal meno caro)</div>';
                
                
                const otherResults = availableComponents
                    .filter(c => c.ean !== recommended.ean)
                    .sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
                
                html += otherResults.map(c => `
                        <div class="component-search-result" data-ean="${c.ean}" data-supplier="${c.fornitore || ''}" style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">
                            <div style="color: white; font-weight: 600; font-size: 0.95em; margin-bottom: 4px;">${c.nome}</div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">EAN: ${c.ean}</span>
                                <span style="color: #2ecc71; font-weight: 600; font-size: 0.9em;">€${parseFloat(c.prezzo).toFixed(2)}</span>
                            </div>
                            <div style="color: rgba(255,255,255,0.5); font-size: 0.8em; margin-top: 4px;">Qtà: ${c.quantita} | ${c.fornitore || 'N/D'}</div>
                        </div>
                    `).join('');
            }
            
            results.innerHTML = html;
            
            
            results.querySelectorAll('.component-search-result').forEach(el => {
                el.addEventListener('mouseenter', () => {
                    if (el.style.background.includes('linear-gradient')) {
                        el.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.35), rgba(39, 174, 96, 0.2))';
                    } else {
                        el.style.background = 'rgba(255,255,255,0.2)';
                    }
                });
                el.addEventListener('mouseleave', () => {
                    if (el.style.border && el.style.border.includes('46, 204, 113')) {
                        el.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1))';
                    } else {
                        el.style.background = 'rgba(255,255,255,0.1)';
                    }
                });
            });
        } else {
            results.innerHTML = `
                <div style="text-align: center; padding: 30px 20px;">
                    <p style="color: rgba(255,255,255,0.5); margin-bottom: 20px; font-size: 1em;">Nessun componente trovato</p>
                    <button id="add-custom-item-btn" style="background: linear-gradient(135deg, #2ecc71, #27ae60); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 0.95em; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(46, 204, 113, 0.3);">
                        ➕ Aggiungi Manualmente
                    </button>
                </div>
            `;
            
            
            document.getElementById('add-custom-item-btn')?.addEventListener('click', () => {
                openAddCustomItemPopup();
            });
        }
    } catch (error) {
        console.error('Errore ricerca componenti:', error);
        results.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">Errore nella ricerca</p>';
    }
    }, 300); 
});


document.getElementById('component-search-results')?.addEventListener('click', async (e) => {
    const resultItem = e.target.closest('.component-search-result');
    if (!resultItem || !currentSearchContext) return;
    
    const newEan = resultItem.dataset.ean;
    const supplier = resultItem.dataset.supplier || '';
    
    
    if (currentSearchContext.isConfigSearch) {
        
        const { configKey, componentType, componentIndex } = currentSearchContext;
        
        
        const input = document.querySelector(`.component-ean-input[data-config-key="${configKey}"][data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
        if (input) {
            input.value = newEan;
            input.dataset.tooltipLoaded = 'false';
            
            
            applyConfigSuggestion(newEan, supplier, configKey, componentType, componentIndex);
            
            showNotification(`${componentType} aggiornato`);
        }
    } else {
        
        const { orderId, componentType } = currentSearchContext;
        
        
        const eanInput = document.querySelector(`input[data-order-id="${orderId}"][data-component-type="${componentType}"]`);
        if (eanInput) {
            eanInput.value = newEan;
            eanInput.dataset.ean = newEan;
            eanInput.dataset.originalValue = newEan;
            
            
            await loadProductNameForInput(eanInput);
            
            showNotification(`EAN ${componentType} aggiornato: ${newEan}`);
        } else {
            
            const componentSpan = document.querySelector(`.component-name-display[data-order-id="${orderId}"][data-component-type="${componentType}"]`);
            if (componentSpan) {
                
                let productName = null;
                let supplierName = null;
                
                try {
                    let lookupUrl = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(newEan)}`;
                    if (supplier && supplier !== '--' && supplier !== 'FORNITORE') {
                        lookupUrl += `&supplier=${encodeURIComponent(supplier)}`;
                    }
                    const response = await fetch(lookupUrl);
                    const data = await response.json();
                    
                    if (data.success && data.component) {
                        productName = data.component.nome;
                        supplierName = data.component.fornitore;
                        
                        componentSpan.textContent = productName || newEan;
                        componentSpan.title = `EAN: ${newEan}\nCategoria: ${data.component.categoria || 'N/D'}`;
                        
                        
                        if (supplierName) {
                            const componentRow = componentSpan.closest('.component-row');
                            const supplierBadge = componentRow ? componentRow.querySelector('.supplier-badge-clickable') : null;
                            
                            if (supplierBadge) {
                                const supplier = supplierName.toUpperCase();
                                
                                
                                let supplierColor = '#95a5a6';
                                if (supplier === 'PROKS') supplierColor = '#e74c3c';
                                else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
                                else if (supplier === 'TIER ONE') supplierColor = '#3498db';
                                else if (supplier === 'AMAZON') supplierColor = '#f39c12';
                                else if (supplier === 'NOUA') supplierColor = '#2ecc71';
                                else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
                                else if (supplier === 'MSI') supplierColor = '#d35400';
                                else if (supplier === 'CASEKING') supplierColor = '#16a085';
                                else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
                                
                                supplierBadge.textContent = getSupplierAbbreviation(supplier);
                                supplierBadge.style.background = `${supplierColor}33`;
                                supplierBadge.style.color = supplierColor;
                                supplierBadge.style.borderColor = `${supplierColor}66`;
                                supplierBadge.dataset.supplier = supplier;
                            }
                        }
                    } else {
                        componentSpan.textContent = newEan;
                        componentSpan.title = `EAN: ${newEan}\n(Prodotto non trovato in database)`;
                    }
                } catch (error) {
                    console.error(`Errore caricamento prodotto per EAN ${newEan}:`, error);
                    componentSpan.textContent = newEan;
                    componentSpan.title = `EAN: ${newEan}`;
                }
                
                
                componentSpan.dataset.ean = newEan;
                componentSpan.dataset.originalValue = newEan;
                
                
                const savedComponents = processedOrdersCache[orderId]?.components || [];
                
                if (savedComponents.length === 0) {
                    
                    await saveAllCurrentComponentsToDB(orderId, componentType, newEan, productName, supplierName);
                } else {
                    
                    const success = await updateProcessedOrderComponent(orderId, componentType, newEan, productName, supplierName);
                    
                    if (success) {
                        showNotification(`✅ ${componentType} aggiornato nel database`);
                    } else {
                        console.error(`Errore salvataggio componente - OrderID: ${orderId}, ComponentType: ${componentType}, EAN: ${newEan}`);
                        showNotification(`⚠️ Errore nel salvataggio database`);
                    }
                }
            } else {
                showNotification('⚠️ Impossibile aggiornare il componente');
            }
        }
    }
    
    
    document.getElementById('component-search-popup').style.display = 'none';
    document.getElementById('component-search-overlay').style.display = 'none';
    currentSearchContext = null;
});


document.getElementById('close-component-search')?.addEventListener('click', () => {
    document.getElementById('component-search-popup').style.display = 'none';
    document.getElementById('component-search-overlay').style.display = 'none';
    currentSearchContext = null;
});

document.getElementById('component-search-overlay')?.addEventListener('click', () => {
    document.getElementById('component-search-popup').style.display = 'none';
    document.getElementById('component-search-overlay').style.display = 'none';
    currentSearchContext = null;
});


(function() {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    
    
    document.addEventListener('mousedown', (e) => {
        const header = e.target.closest('#component-search-header');
        if (!header) return;
        
        const popup = document.getElementById('component-search-popup');
        if (!popup || popup.style.display === 'none') return;
        
        e.preventDefault();
        isDragging = true;
        
        
        const rect = popup.getBoundingClientRect();
        popup.style.transform = 'none';
        popup.style.left = rect.left + 'px';
        popup.style.top = rect.top + 'px';
        
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        header.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const popup = document.getElementById('component-search-popup');
        if (!popup) return;
        
        e.preventDefault();
        
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;
        
        
        const popupRect = popup.getBoundingClientRect();
        const maxX = window.innerWidth - popupRect.width;
        const maxY = window.innerHeight - popupRect.height;
        
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        popup.style.left = newX + 'px';
        popup.style.top = newY + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        
        isDragging = false;
        document.body.style.userSelect = '';
        
        const header = document.getElementById('component-search-header');
        if (header) {
            header.style.cursor = 'move';
        }
    });
})();





let bulkReplaceMinQty = 0;
let bulkReplaceDebounceTimer = null;


function openBulkReplacePopup() {
    const popup = document.getElementById('bulk-replace-popup');
    const overlay = document.getElementById('bulk-replace-overlay');
    
    if (!popup || !overlay) return;
    
    
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.display = 'flex';
    overlay.style.display = 'block';
    
    
    document.getElementById('bulk-replace-search').value = '';
    document.getElementById('bulk-replace-new').value = '';
    document.getElementById('bulk-replace-new').disabled = true;
    document.getElementById('bulk-replace-count').style.display = 'none';
    document.getElementById('bulk-replace-min-qty').style.display = 'none';
    document.getElementById('bulk-replace-results').innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Inserisci prima il testo/EAN da cercare...</p>';
    
    bulkReplaceMinQty = 0;
    
    
    setTimeout(() => {
        document.getElementById('bulk-replace-search').focus();
    }, 100);
}


function countOccurrencesInProcessed(searchText) {
    if (!searchText || searchText.length < 2) return 0;
    
    const searchLower = searchText.toLowerCase();
    let count = 0;
    
    
    const processedContainer = document.getElementById('processed-container');
    if (!processedContainer) return 0;
    
    const eanInputs = processedContainer.querySelectorAll('input[data-ean]');
    eanInputs.forEach(input => {
        const ean = input.value || '';
        const tooltip = input.title || '';
        
        
        if (ean.toLowerCase().includes(searchLower) || tooltip.toLowerCase().includes(searchLower)) {
            count++;
        }
    });
    
    return count;
}


document.getElementById('bulk-replace-search')?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const countDiv = document.getElementById('bulk-replace-count');
    const countNumber = document.getElementById('bulk-replace-count-number');
    const newInput = document.getElementById('bulk-replace-new');
    const minQtyDiv = document.getElementById('bulk-replace-min-qty');
    const minQtyNumber = document.getElementById('bulk-replace-min-qty-number');
    const results = document.getElementById('bulk-replace-results');
    
    if (query.length < 2) {
        countDiv.style.display = 'none';
        newInput.disabled = true;
        newInput.value = '';
        minQtyDiv.style.display = 'none';
        results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Inserisci almeno 2 caratteri...</p>';
        bulkReplaceMinQty = 0;
        return;
    }
    
    
    const count = countOccurrencesInProcessed(query);
    countNumber.textContent = count;
    countDiv.style.display = 'block';
    
    if (count === 0) {
        newInput.disabled = true;
        minQtyDiv.style.display = 'none';
        results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessuna corrispondenza trovata negli ordini elaborati</p>';
        bulkReplaceMinQty = 0;
    } else {
        newInput.disabled = false;
        bulkReplaceMinQty = count;
        minQtyNumber.textContent = count;
        minQtyDiv.style.display = 'block';
        results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Ora cerca il nuovo componente...</p>';
    }
});


document.getElementById('bulk-replace-new')?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const results = document.getElementById('bulk-replace-results');
    
    
    if (bulkReplaceDebounceTimer) {
        clearTimeout(bulkReplaceDebounceTimer);
    }
    
    if (query.length < 2) {
        results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita almeno 2 caratteri...</p>';
        return;
    }
    
    results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Ricerca in corso...</p>';
    
    
    bulkReplaceDebounceTimer = setTimeout(async () => {
        try {
            const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            if (data.success && data.components && data.components.length > 0) {
                
                const availableComponents = data.components.filter(c => parseInt(c.quantita) >= bulkReplaceMinQty);
                
                if (availableComponents.length === 0) {
                    results.innerHTML = `<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun componente con quantità ≥ ${bulkReplaceMinQty}</p>`;
                    return;
                }
                
                
                const sortedByPrice = [...availableComponents].sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
                const recommended = sortedByPrice[0];
                
                let html = '';
                
                
                html += `
                    <div class="bulk-replace-result" data-ean="${recommended.ean}" style="padding: 12px; margin-bottom: 12px; background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1)); border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 1px solid rgba(46, 204, 113, 0.4);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 700;">⭐ CONSIGLIATO</span>
                            <span style="color: #2ecc71; font-weight: 700; font-size: 1.1em;">€${parseFloat(recommended.prezzo).toFixed(2)}</span>
                        </div>
                        <div style="color: white; font-weight: 600; font-size: 0.95em; margin-bottom: 4px;">${recommended.nome}</div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">EAN: ${recommended.ean}</span>
                        </div>
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.8em; margin-top: 4px;">Qtà: ${recommended.quantita} | ${recommended.fornitore || 'N/D'}</div>
                    </div>
                `;
                
                
                if (availableComponents.length > 1) {
                    html += '<div style="border-bottom: 1px solid rgba(255,255,255,0.1); margin: 8px 0; padding-bottom: 4px; color: rgba(255,255,255,0.4); font-size: 0.8em;">Altri risultati</div>';
                    
                    html += availableComponents
                        .filter(c => c.ean !== recommended.ean)
                        .map(c => `
                            <div class="bulk-replace-result" data-ean="${c.ean}" style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">
                                <div style="color: white; font-weight: 600; font-size: 0.95em; margin-bottom: 4px;">${c.nome}</div>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">EAN: ${c.ean}</span>
                                    <span style="color: #2ecc71; font-weight: 600; font-size: 0.9em;">€${parseFloat(c.prezzo).toFixed(2)}</span>
                                </div>
                                <div style="color: rgba(255,255,255,0.5); font-size: 0.8em; margin-top: 4px;">Qtà: ${c.quantita} | ${c.fornitore || 'N/D'}</div>
                            </div>
                        `).join('');
                }
                
                results.innerHTML = html;
                
                
                results.querySelectorAll('.bulk-replace-result').forEach(el => {
                    el.addEventListener('mouseenter', () => {
                        if (el.style.background.includes('linear-gradient')) {
                            el.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.35), rgba(39, 174, 96, 0.2))';
                        } else {
                            el.style.background = 'rgba(255,255,255,0.2)';
                        }
                    });
                    el.addEventListener('mouseleave', () => {
                        if (el.style.border && el.style.border.includes('46, 204, 113')) {
                            el.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1))';
                        } else {
                            el.style.background = 'rgba(255,255,255,0.1)';
                        }
                    });
                });
            } else {
                
                results.innerHTML = `
                    <p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px 20px 10px;">Nessun componente trovato</p>
                    <div style="text-align: center; padding: 10px;">
                        <button id="save-manual-component" style="background: linear-gradient(135deg, #3498db, #2980b9); color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.95em; transition: all 0.2s ease;">
                            💾 SALVA COMPONENTE MANUALE
                        </button>
                    </div>
                `;
                
                
                document.getElementById('save-manual-component')?.addEventListener('click', () => {
                    const manualText = query; 
                    const searchText = document.getElementById('bulk-replace-search').value.trim();
                    
                    
                    showSupplierSelectionForBulkReplace(manualText, searchText);
                });
            }
        } catch (error) {
            console.error('Errore ricerca componenti:', error);
            results.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">Errore nella ricerca</p>';
        }
    }, 300);
});


document.getElementById('bulk-replace-results')?.addEventListener('click', async (e) => {
    const resultItem = e.target.closest('.bulk-replace-result');
    if (!resultItem) return;
    
    const newEan = resultItem.dataset.ean;
    const searchText = document.getElementById('bulk-replace-search').value.trim().toLowerCase();
    
    if (!searchText || !newEan) return;
    
    
    const processedContainer = document.getElementById('processed-container');
    if (!processedContainer) return;
    
    const eanInputs = processedContainer.querySelectorAll('input[data-ean]');
    let replacedCount = 0;
    
    for (const input of eanInputs) {
        const ean = input.value || '';
        const tooltip = input.title || '';
        
        
        if (ean.toLowerCase().includes(searchText) || tooltip.toLowerCase().includes(searchText)) {
            const orderId = input.dataset.orderId;
            const componentType = input.dataset.componentType;
            
            
            input.value = newEan;
            input.dataset.ean = newEan;
            input.dataset.originalValue = newEan;
            
            
            saveEANModification(orderId, componentType, newEan);
            
            
            await loadProductNameForInput(input);
            
            replacedCount++;
        }
    }
    
    
    document.getElementById('bulk-replace-popup').style.display = 'none';
    document.getElementById('bulk-replace-overlay').style.display = 'none';
    
    showNotification(`✅ Sostituiti ${replacedCount} componenti con EAN: ${newEan}`);
});


document.getElementById('close-bulk-replace')?.addEventListener('click', () => {
    document.getElementById('bulk-replace-popup').style.display = 'none';
    document.getElementById('bulk-replace-overlay').style.display = 'none';
});

document.getElementById('bulk-replace-overlay')?.addEventListener('click', () => {
    document.getElementById('bulk-replace-popup').style.display = 'none';
    document.getElementById('bulk-replace-overlay').style.display = 'none';
});


(function() {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    
    document.addEventListener('mousedown', (e) => {
        const header = e.target.closest('#bulk-replace-header');
        if (!header) return;
        
        const popup = document.getElementById('bulk-replace-popup');
        if (!popup || popup.style.display === 'none') return;
        
        e.preventDefault();
        isDragging = true;
        
        const rect = popup.getBoundingClientRect();
        popup.style.transform = 'none';
        popup.style.left = rect.left + 'px';
        popup.style.top = rect.top + 'px';
        
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        header.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const popup = document.getElementById('bulk-replace-popup');
        if (!popup) return;
        
        e.preventDefault();
        
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;
        
        const popupRect = popup.getBoundingClientRect();
        const maxX = window.innerWidth - popupRect.width;
        const maxY = window.innerHeight - popupRect.height;
        
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        popup.style.left = newX + 'px';
        popup.style.top = newY + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        
        isDragging = false;
        document.body.style.userSelect = '';
        
        const header = document.getElementById('bulk-replace-header');
        if (header) {
            header.style.cursor = 'move';
        }
    });
})();


let bulkReplaceManualText = '';
let bulkReplaceManualSearchText = '';
let bulkReplaceSelectedSupplier = '';


function showSupplierSelectionForBulkReplace(manualText, searchText) {
    bulkReplaceManualText = manualText;
    bulkReplaceManualSearchText = searchText;
    bulkReplaceSelectedSupplier = '';
    
    
    const existingPopup = document.getElementById('bulk-replace-supplier-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const popup = document.createElement('div');
    popup.id = 'bulk-replace-supplier-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1005; background: rgba(30, 30, 30, 0.95); backdrop-filter: blur(20px); border-radius: 16px; padding: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.3); width: 400px; display: block;';
    
    popup.innerHTML = `
        <h3 style="margin: 0 0 8px 0; color: white; font-size: 1.1em; font-weight: 600;">🔧 Seleziona Fornitore</h3>
        <p style="color: rgba(255,255,255,0.6); font-size: 0.9em; margin: 0 0 16px 0;">Componente manuale: <strong style="color: #3498db;">${manualText}</strong></p>
        
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
            <button class="bulk-supplier-option" data-supplier="PROKS" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.4); transition: all 0.2s ease;">PROKS</button>
            <button class="bulk-supplier-option" data-supplier="OMEGA" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(155, 89, 182, 0.2); color: #9b59b6; border: 1px solid rgba(155, 89, 182, 0.4); transition: all 0.2s ease;">OMEGA</button>
            <button class="bulk-supplier-option" data-supplier="TIER ONE" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(52, 152, 219, 0.2); color: #3498db; border: 1px solid rgba(52, 152, 219, 0.4); transition: all 0.2s ease;">TIER ONE</button>
            <button class="bulk-supplier-option" data-supplier="AMAZON" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(243, 156, 18, 0.2); color: #f39c12; border: 1px solid rgba(243, 156, 18, 0.4); transition: all 0.2s ease;">AMAZON</button>
            <button class="bulk-supplier-option" data-supplier="NOUA" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(46, 204, 113, 0.2); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4); transition: all 0.2s ease;">NOUA</button>
            <button class="bulk-supplier-option" data-supplier="INTEGRATA" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(127, 140, 141, 0.2); color: #7f8c8d; border: 1px solid rgba(127, 140, 141, 0.4); transition: all 0.2s ease;">INTEGRATA</button>
            <button class="bulk-supplier-option" data-supplier="MSI" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(211, 84, 0, 0.2); color: #d35400; border: 1px solid rgba(211, 84, 0, 0.4); transition: all 0.2s ease;">MSI</button>
            <button class="bulk-supplier-option" data-supplier="CASEKING" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(22, 160, 133, 0.2); color: #16a085; border: 1px solid rgba(22, 160, 133, 0.4); transition: all 0.2s ease;">CASEKING</button>
            <button class="bulk-supplier-option" data-supplier="NAVY BLUE" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(26, 86, 219, 0.2); color: #1a56db; border: 1px solid rgba(26, 86, 219, 0.4); transition: all 0.2s ease;">NAVY BLUE</button>
        </div>
        
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Oppure inserisci nuovo fornitore:</label>
            <input type="text" id="bulk-custom-supplier-input" placeholder="Nome nuovo fornitore..." style="width: 100%; box-sizing: border-box; padding: 10px 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; font-size: 0.95em;">
        </div>
        
        <div style="display: flex; gap: 8px;">
            <button id="confirm-bulk-custom-supplier" style="flex: 1; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">Conferma</button>
            <button id="cancel-bulk-supplier-select" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 600; cursor: pointer;">Annulla</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    
    popup.querySelectorAll('.bulk-supplier-option').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.filter = 'brightness(1.2)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
            btn.style.filter = 'brightness(1)';
        });
    });
    
    
    popup.querySelectorAll('.bulk-supplier-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const supplier = btn.dataset.supplier;
            bulkReplaceSelectedSupplier = supplier;
            showBulkReplaceConfirmation();
        });
    });
    
    
    document.getElementById('confirm-bulk-custom-supplier')?.addEventListener('click', () => {
        const customInput = document.getElementById('bulk-custom-supplier-input');
        const supplier = customInput.value.trim().toUpperCase();
        
        if (supplier) {
            bulkReplaceSelectedSupplier = supplier;
            showBulkReplaceConfirmation();
        } else {
            showNotification('Inserisci un nome fornitore');
        }
    });
    
    
    document.getElementById('cancel-bulk-supplier-select')?.addEventListener('click', closeBulkReplaceSupplierPopup);
}


function closeBulkReplaceSupplierPopup() {
    const popup = document.getElementById('bulk-replace-supplier-popup');
    if (popup) {
        popup.remove();
    }
}


function showBulkReplaceConfirmation() {
    closeBulkReplaceSupplierPopup();
    
    const existingPopup = document.getElementById('bulk-replace-confirm-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const processedContainer = document.getElementById('processed-container');
    if (!processedContainer) return;
    
    
    const eanInputs = processedContainer.querySelectorAll('input[data-ean]');
    let matchCount = 0;
    
    for (const input of eanInputs) {
        const ean = input.value || '';
        const tooltip = input.title || '';
        
        if (ean.toLowerCase().includes(bulkReplaceManualSearchText.toLowerCase()) || 
            tooltip.toLowerCase().includes(bulkReplaceManualSearchText.toLowerCase())) {
            matchCount++;
        }
    }
    
    const popup = document.createElement('div');
    popup.id = 'bulk-replace-confirm-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1005; background: rgba(30, 30, 30, 0.95); backdrop-filter: blur(20px); border-radius: 16px; padding: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.3); width: 450px; display: block;';
    
    popup.innerHTML = `
        <h3 style="margin: 0 0 16px 0; color: white; font-size: 1.1em; font-weight: 600;">⚠️ Conferma Sostituzione di Massa</h3>
        
        <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <div style="margin-bottom: 12px;">
                <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">Cerca e sostituisci:</span>
                <div style="color: #e74c3c; font-weight: 600; margin-top: 4px; font-size: 0.95em;">${bulkReplaceManualSearchText}</div>
            </div>
            <div style="margin-bottom: 12px;">
                <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">Con componente manuale:</span>
                <div style="color: #2ecc71; font-weight: 600; margin-top: 4px; font-size: 0.95em;">${bulkReplaceManualText}</div>
            </div>
            <div>
                <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">Fornitore:</span>
                <div style="color: #3498db; font-weight: 600; margin-top: 4px; font-size: 0.95em;">${bulkReplaceSelectedSupplier}</div>
            </div>
        </div>
        
        <p style="color: rgba(255,255,255,0.8); font-size: 0.9em; margin: 0 0 20px 0; text-align: center;">
            Verranno sostituiti <strong style="color: #f39c12;">${matchCount} componenti</strong> negli ordini elaborati.
        </p>
        
        <div style="display: flex; gap: 8px;">
            <button id="confirm-bulk-replace-manual" style="flex: 1; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">✅ Conferma</button>
            <button id="cancel-bulk-replace-manual" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">❌ Annulla</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    
    const confirmBtn = document.getElementById('confirm-bulk-replace-manual');
    const cancelBtn = document.getElementById('cancel-bulk-replace-manual');
    
    confirmBtn.addEventListener('mouseenter', () => {
        confirmBtn.style.background = '#27ae60';
        confirmBtn.style.transform = 'scale(1.02)';
    });
    confirmBtn.addEventListener('mouseleave', () => {
        confirmBtn.style.background = '#2ecc71';
        confirmBtn.style.transform = 'scale(1)';
    });
    
    cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.background = 'rgba(255,255,255,0.3)';
        cancelBtn.style.transform = 'scale(1.02)';
    });
    cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.background = 'rgba(255,255,255,0.2)';
        cancelBtn.style.transform = 'scale(1)';
    });
    
    
    confirmBtn.addEventListener('click', async () => {
        await applyBulkReplaceManual();
    });
    
    cancelBtn.addEventListener('click', closeBulkReplaceConfirmPopup);
}


function closeBulkReplaceConfirmPopup() {
    const popup = document.getElementById('bulk-replace-confirm-popup');
    if (popup) {
        popup.remove();
    }
}


async function applyBulkReplaceManual() {
    const processedContainer = document.getElementById('processed-container');
    if (!processedContainer) return;
    
    const eanInputs = processedContainer.querySelectorAll('input[data-ean]');
    let replacedCount = 0;
    
    for (const input of eanInputs) {
        const ean = input.value || '';
        const tooltip = input.title || '';
        
        
        if (ean.toLowerCase().includes(bulkReplaceManualSearchText.toLowerCase()) || 
            tooltip.toLowerCase().includes(bulkReplaceManualSearchText.toLowerCase())) {
            const orderId = input.dataset.orderId;
            const componentType = input.dataset.componentType;
            
            
            input.value = bulkReplaceManualText;
            input.dataset.ean = bulkReplaceManualText;
            input.dataset.originalValue = bulkReplaceManualText;
            
            
            saveEANModification(orderId, componentType, bulkReplaceManualText);
            
            
            saveSupplierModification(orderId, componentType, bulkReplaceSelectedSupplier);
            
            
            const supplierSpan = document.querySelector(`.supplier-badge-clickable[data-order-id="${orderId}"][data-component-type="${componentType}"]`);
            if (supplierSpan) {
                let supplierColor = '#95a5a6';
                if (bulkReplaceSelectedSupplier === 'PROKS') supplierColor = '#e74c3c';
                else if (bulkReplaceSelectedSupplier === 'OMEGA') supplierColor = '#9b59b6';
                else if (bulkReplaceSelectedSupplier === 'TIER ONE') supplierColor = '#3498db';
                else if (bulkReplaceSelectedSupplier === 'AMAZON') supplierColor = '#f39c12';
                else if (bulkReplaceSelectedSupplier === 'NOUA') supplierColor = '#2ecc71';
                else if (bulkReplaceSelectedSupplier === 'INTEGRATA') supplierColor = '#7f8c8d';
                else if (bulkReplaceSelectedSupplier === 'NAVY BLUE') supplierColor = '#1a56db';
                
                supplierSpan.textContent = getSupplierAbbreviation(bulkReplaceSelectedSupplier);
                supplierSpan.style.background = `${supplierColor}33`;
                supplierSpan.style.color = supplierColor;
                supplierSpan.style.borderColor = `${supplierColor}66`;
                supplierSpan.dataset.supplier = bulkReplaceSelectedSupplier;
            }
            
            
            input.title = `${componentType} - ${bulkReplaceManualText}`;
            
            replacedCount++;
        }
    }
    
    
    closeBulkReplaceConfirmPopup();
    
    
    document.getElementById('bulk-replace-popup').style.display = 'none';
    document.getElementById('bulk-replace-overlay').style.display = 'none';
    
    showNotification(`✅ Sostituiti ${replacedCount} componenti con: ${bulkReplaceManualText} (${bulkReplaceSelectedSupplier})`);
}






document.getElementById('standard-configs-btn')?.addEventListener('click', async () => {
    
    await closeAllOverlayPages(false);
    
    openStandardConfigsPage();
});


document.getElementById('close-standard-configs')?.addEventListener('click', () => {
    closeStandardConfigsPage();
});

function openStandardConfigsPage() {
    const page = document.getElementById('standard-configs-page');
    if (!page) return;
    
    page.style.display = 'block';
    renderStandardConfigsCards();
}

function closeStandardConfigsPage() {
    const page = document.getElementById('standard-configs-page');
    if (page) {
        page.style.display = 'none';
    }
}

async function renderStandardConfigsCards() {
    const container = document.getElementById('standard-configs-container');
    if (!container) return;
    
    container.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 40px;">Caricamento configurazioni...</p>';
    
    
    await loadPCConfigs();
    
    if (!PC_CONFIGS || Object.keys(PC_CONFIGS).length === 0) {
        container.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 40px;">Nessuna configurazione trovata</p>';
        return;
    }
    
    let html = '';
    
    
    html += `
        <div id="add-new-config-card" style="background: rgba(255,255,255,0.03); backdrop-filter: blur(10px); border: 2px dashed rgba(255,255,255,0.2); border-radius: 12px; padding: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s ease; min-height: 200px;">
            <div style="text-align: center;">
                <div style="font-size: 4em; color: rgba(255,255,255,0.4); margin-bottom: 12px; transition: all 0.3s ease;">+</div>
                <p style="color: rgba(255,255,255,0.5); font-size: 1.1em; margin: 0; font-weight: 600;">Aggiungi Configurazione</p>
            </div>
        </div>
    `;
    
    for (const [configKey, config] of Object.entries(PC_CONFIGS)) {
        const configId = configKey.replace(/\s+/g, '_');
        
        html += `
            <div class="config-card" data-config-key="${configKey}" style="background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; transition: all 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 class="config-title" data-config-key="${configKey}" style="color: white; font-size: 1.2em; margin: 0; font-weight: 600; cursor: pointer; user-select: none;" title="Tieni premuto per 5 secondi per eliminare">${configKey}</h3>
                </div>
                <p class="config-fullname" data-config-key="${configKey}" style="color: rgba(255,255,255,0.5); font-size: 0.9em; margin: 0 0 16px 0; line-height: 1.5; cursor: pointer; user-select: none;" title="Triplo click per modificare">${config.fullName || ''}</p>
                
                <div class="components-list" style="display: flex; flex-direction: column; gap: 12px;">
        `;
        
        config.components.forEach((component, index) => {
            const componentId = `${configId}_${component.type}_${index}`;
            
            
            let ean = component.value;
            let supplier = '';
            
            
            if (component.supplier) {
                supplier = component.supplier.trim().toUpperCase();
            } 
            
            else {
                const match = component.value.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
                if (match) {
                    ean = match[1].trim();
                    supplier = match[2].trim().toUpperCase();
                }
            }
            
            
            let supplierColor = '#95a5a6';
            if (supplier === 'PROKS') supplierColor = '#e74c3c';
            else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
            else if (supplier === 'TIER ONE') supplierColor = '#3498db';
            else if (supplier === 'AMAZON') supplierColor = '#f39c12';
            else if (supplier === 'MSI') supplierColor = '#d35400';
            else if (supplier === 'NOUA') supplierColor = '#2ecc71';
            else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
            else if (supplier === 'CASEKING') supplierColor = '#16a085';
            else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
            
            
            const canRemove = config.components.length > 1;
            
            html += `
                <div class="component-row" style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 12px; border: 1px solid rgba(255,255,255,0.1); position: relative;">
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <label style="color: #5dade2; font-size: 0.9em; font-weight: 700; min-width: 80px; white-space: nowrap;">${component.type}</label>
                        <div style="flex: 3; position: relative;">
                            <input 
                                type="text" 
                                class="component-ean-input" 
                                data-config-key="${configKey}" 
                                data-component-type="${component.type}"
                                data-component-index="${index}"
                                value="${ean}" 
                                placeholder="EAN o codice componente"
                                style="width: 100%; box-sizing: border-box; padding: 10px 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; font-size: 0.95em; transition: all 0.2s ease;"
                            >
                            <div class="config-suggestions" data-config-key="${configKey}" data-component-type="${component.type}" data-component-index="${index}" style="display: none; position: absolute; top: 100%; left: 0; right: -150px; margin-top: 4px; background: rgba(20, 20, 20, 0.98); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; max-height: 300px; overflow-y: auto; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.3);"></div>
                        </div>
                        <span class="config-supplier-badge" 
                            data-config-key="${configKey}" 
                            data-component-type="${component.type}"
                            data-component-index="${index}"
                            data-supplier="${supplier}"
                            style="background: ${supplier ? supplierColor + '33' : 'rgba(149,165,166,0.2)'}; color: ${supplier ? supplierColor : '#95a5a6'}; padding: 10px 16px; border-radius: 6px; font-size: 0.85em; font-weight: 600; border: 1px solid ${supplier ? supplierColor + '66' : 'rgba(149,165,166,0.4)'}; min-width: 110px; text-align: center; cursor: pointer; transition: all 0.2s ease; white-space: nowrap;">
                            ${supplier || 'FORNITORE'}
                        </span>
                        ${canRemove ? `
                            <button class="remove-component-btn" 
                                data-config-key="${configKey}" 
                                data-component-type="${component.type}"
                                style="background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.5); border-radius: 6px; padding: 8px 12px; cursor: pointer; font-weight: 700; font-size: 0.9em; transition: all 0.2s ease; white-space: nowrap;"
                                title="Rimuovi componente">
                                ✕
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        html += `
                    <div class="add-component-btn" data-config-key="${configKey}" style="background: rgba(46, 204, 113, 0.1); border: 2px dashed rgba(46, 204, 113, 0.3); border-radius: 8px; padding: 12px; text-align: center; cursor: pointer; transition: all 0.3s ease; margin-top: 8px;">
                        <span style="color: rgba(46, 204, 113, 0.8); font-weight: 600; font-size: 0.95em;">+ Aggiungi Componente</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    
    const addNewConfigCard = document.getElementById('add-new-config-card');
    if (addNewConfigCard) {
        addNewConfigCard.addEventListener('mouseenter', () => {
            addNewConfigCard.style.background = 'rgba(46, 204, 113, 0.1)';
            addNewConfigCard.style.borderColor = 'rgba(46, 204, 113, 0.5)';
            const plusIcon = addNewConfigCard.querySelector('div[style*="font-size: 4em"]');
            if (plusIcon) {
                plusIcon.style.color = '#2ecc71';
                plusIcon.style.transform = 'rotate(90deg) scale(1.1)';
            }
        });
        addNewConfigCard.addEventListener('mouseleave', () => {
            addNewConfigCard.style.background = 'rgba(255,255,255,0.03)';
            addNewConfigCard.style.borderColor = 'rgba(255,255,255,0.2)';
            const plusIcon = addNewConfigCard.querySelector('div[style*="font-size: 4em"]');
            if (plusIcon) {
                plusIcon.style.color = 'rgba(255,255,255,0.4)';
                plusIcon.style.transform = 'rotate(0deg) scale(1)';
            }
        });
        addNewConfigCard.addEventListener('click', () => {
            showAddNewConfigPopup();
        });
    }
    
    
    container.querySelectorAll('.config-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.background = 'rgba(255,255,255,0.08)';
            card.style.borderColor = 'rgba(255,255,255,0.2)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.background = 'rgba(255,255,255,0.05)';
            card.style.borderColor = 'rgba(255,255,255,0.1)';
        });
    });
    
    
    let configSearchDebounceTimer = null;
    
    container.querySelectorAll('.component-ean-input').forEach(input => {
        input.addEventListener('focus', () => {
            input.style.borderColor = 'rgba(46, 204, 113, 0.6)';
            input.style.background = 'rgba(0,0,0,0.5)';
        });
        input.addEventListener('blur', (e) => {
            
            setTimeout(() => {
                input.style.borderColor = 'rgba(255,255,255,0.2)';
                input.style.background = 'rgba(0,0,0,0.4)';
                
                const suggestionsDiv = document.querySelector(`.config-suggestions[data-config-key="${input.dataset.configKey}"][data-component-type="${input.dataset.componentType}"][data-component-index="${input.dataset.componentIndex}"]`);
                if (suggestionsDiv) {
                    suggestionsDiv.style.display = 'none';
                }
            }, 200);
        });
        
        
        input.addEventListener('mouseenter', async () => {
            
            if (input.dataset.tooltipLoaded === 'true') return;
            
            const ean = input.value.trim();
            const componentType = input.dataset.componentType;
            
            if (!ean) {
                input.title = `${componentType}: (Nessun EAN inserito)`;
                return;
            }
            
            if (ean === 'Generico') {
                input.title = `${componentType}: Monitor generico`;
                input.dataset.tooltipLoaded = 'true';
                return;
            }
            
            if (ean.toUpperCase() === 'INTEGRATA') {
                input.title = `${componentType}: GPU Integrata`;
                input.dataset.tooltipLoaded = 'true';
                return;
            }
            
            
            try {
                let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
                const supplierBadge = document.querySelector(`.config-supplier-badge[data-config-key="${input.dataset.configKey}"][data-component-type="${componentType}"][data-component-index="${input.dataset.componentIndex}"]`);
                const supplierHint = supplierBadge && supplierBadge.dataset && supplierBadge.dataset.supplier
                    ? String(supplierBadge.dataset.supplier).trim()
                    : '';
                if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
                    url += `&supplier=${encodeURIComponent(supplierHint)}`;
                }
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.success && data.component) {
                    const nomeProdotto = data.component.nome || 'Nome non disponibile';
                    const fornitore = data.component.fornitore || 'N/D';
                    const categoria = data.component.categoria || 'N/D';
                    const quantita = data.component.quantita_disponibile !== undefined ? data.component.quantita_disponibile : 'N/D';
                    
                    input.title = `${componentType}: ${nomeProdotto}\nEAN: ${ean}\nCategoria: ${categoria}\nDisponibilità: ${quantita}`;
                    input.dataset.tooltipLoaded = 'true';
                } else {
                    input.title = `${componentType}: ${ean}\n(Prodotto non trovato in database)`;
                }
            } catch (error) {
                console.error(`Errore caricamento tooltip per EAN ${ean}:`, error);
                input.title = `${componentType}: ${ean}`;
            }
        });
        
        
        input.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            const componentType = input.dataset.componentType;
            const configKey = input.dataset.configKey;
            const componentIndex = input.dataset.componentIndex;
            const currentEan = input.value.trim();
            
            
            currentSearchContext = { 
                configKey, 
                componentType, 
                componentIndex,
                isConfigSearch: true 
            };
            
            
            const popup = document.getElementById('component-search-popup');
            const overlay = document.getElementById('component-search-overlay');
            const searchInput = document.getElementById('component-search-input');
            const results = document.getElementById('component-search-results');
            
            
            popup.style.transform = 'translate(-50%, -50%)';
            popup.style.left = '50%';
            popup.style.top = '50%';
            
            popup.style.display = 'flex';
            overlay.style.display = 'block';
            
            
            if (currentEan && currentEan.length > 3) {
                searchInput.value = '';
                results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Caricamento nome componente...</p>';
                
                try {
                    let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(currentEan)}`;
                    const configSupplierBadge = document.querySelector(`.config-supplier-badge[data-config-key="${configKey}"][data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
                    const supplierHint = configSupplierBadge && configSupplierBadge.dataset && configSupplierBadge.dataset.supplier
                        ? String(configSupplierBadge.dataset.supplier).trim()
                        : '';
                    if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
                        url += `&supplier=${encodeURIComponent(supplierHint)}`;
                    }
                    const response = await fetch(url);
                    const data = await response.json();
                    
                    if (data.success && data.component && data.component.nome) {
                        searchInput.value = data.component.nome;
                        searchInput.focus();
                        searchInput.select();
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        searchInput.value = currentEan;
                        searchInput.focus();
                        searchInput.select();
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } catch (error) {
                    console.error('Errore ricerca nome componente:', error);
                    searchInput.value = currentEan;
                    searchInput.focus();
                    results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita per cercare...</p>';
                }
            } else {
                searchInput.value = '';
                searchInput.focus();
                results.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita per cercare...</p>';
            }
        });
    });
    
    
    container.querySelectorAll('.config-supplier-badge').forEach(badge => {
        badge.addEventListener('mouseenter', () => {
            badge.style.transform = 'scale(1.05)';
            badge.style.filter = 'brightness(1.2)';
        });
        badge.addEventListener('mouseleave', () => {
            badge.style.transform = 'scale(1)';
            badge.style.filter = 'brightness(1)';
        });
        badge.addEventListener('click', () => {
            const configKey = badge.dataset.configKey;
            const componentType = badge.dataset.componentType;
            const componentIndex = badge.dataset.componentIndex;
            showConfigSupplierSelectPopup(configKey, componentType, componentIndex);
        });
    });
    
    
    container.querySelectorAll('.remove-component-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(231, 76, 60, 0.3)';
            btn.style.transform = 'scale(1.1)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(231, 76, 60, 0.2)';
            btn.style.transform = 'scale(1)';
        });
        btn.addEventListener('click', () => {
            const configKey = btn.dataset.configKey;
            const componentType = btn.dataset.componentType;
            removeComponentFromConfig(configKey, componentType);
        });
    });
    
    
    container.querySelectorAll('.add-component-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(46, 204, 113, 0.2)';
            btn.style.borderColor = 'rgba(46, 204, 113, 0.5)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(46, 204, 113, 0.1)';
            btn.style.borderColor = 'rgba(46, 204, 113, 0.3)';
        });
        btn.addEventListener('click', () => {
            const configKey = btn.dataset.configKey;
            showAddComponentToConfigPopup(configKey);
        });
    });
    
    
    const saveAllBtn = document.getElementById('save-all-configs-btn');
    if (saveAllBtn) {
        saveAllBtn.addEventListener('mouseenter', () => {
            saveAllBtn.style.transform = 'translateY(-2px)';
            saveAllBtn.style.boxShadow = '0 6px 20px rgba(46, 204, 113, 0.4)';
        });
        saveAllBtn.addEventListener('mouseleave', () => {
            saveAllBtn.style.transform = 'translateY(0)';
            saveAllBtn.style.boxShadow = '0 4px 12px rgba(46, 204, 113, 0.3)';
        });
        saveAllBtn.addEventListener('click', () => {
            saveAllConfigurations();
        });
    }
    
    
    let longPressTimer = null;
    let longPressProgress = null;
    
    container.querySelectorAll('.config-title').forEach(title => {
        let pressStartTime = 0;
        let progressBar = null;
        let clickCount = 0;
        let clickTimer = null;
        
        
        title.addEventListener('click', (e) => {
            
            if (progressBar) return;
            
            clickCount++;
            
            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 500); 
            }
            
            if (clickCount === 3) {
                clearTimeout(clickTimer);
                clickCount = 0;
                e.stopPropagation();
                makeConfigTitleEditable(title);
            }
        });
        
        const startLongPress = (e) => {
            e.preventDefault();
            pressStartTime = Date.now();
            
            
            progressBar = document.createElement('div');
            progressBar.style.cssText = 'position: absolute; bottom: 0; left: 0; height: 3px; background: linear-gradient(90deg, #e74c3c, #c0392b); width: 0%; transition: width 0.1s linear; border-radius: 0 0 0 12px;';
            title.closest('.config-card').style.position = 'relative';
            title.closest('.config-card').appendChild(progressBar);
            
            
            title.style.color = '#e74c3c';
            
            
            longPressProgress = setInterval(() => {
                const elapsed = Date.now() - pressStartTime;
                const progress = Math.min((elapsed / 5000) * 100, 100);
                progressBar.style.width = progress + '%';
                
                if (progress >= 100) {
                    clearInterval(longPressProgress);
                    cancelLongPress();
                    showDeleteConfigPopup(title.dataset.configKey);
                }
            }, 50);
        };
        
        const cancelLongPress = () => {
            if (longPressProgress) {
                clearInterval(longPressProgress);
                longPressProgress = null;
            }
            
            if (progressBar) {
                progressBar.remove();
                progressBar = null;
            }
            
            title.style.color = 'white';
        };
        
        
        title.addEventListener('mousedown', startLongPress);
        title.addEventListener('mouseup', cancelLongPress);
        title.addEventListener('mouseleave', cancelLongPress);
        
        
        title.addEventListener('touchstart', startLongPress);
        title.addEventListener('touchend', cancelLongPress);
        title.addEventListener('touchcancel', cancelLongPress);
    });
    
    
    container.querySelectorAll('.config-fullname').forEach(fullNameElement => {
        let clickCount = 0;
        let clickTimer = null;
        
        fullNameElement.addEventListener('click', (e) => {
            clickCount++;
            
            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 500);
            }
            
            if (clickCount === 3) {
                clearTimeout(clickTimer);
                clickCount = 0;
                e.stopPropagation();
                makeConfigFullNameEditable(fullNameElement);
            }
        });
    });
}




function makeConfigFullNameEditable(fullNameElement) {
    const configKey = fullNameElement.dataset.configKey;
    const currentText = fullNameElement.textContent.trim();
    
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.placeholder = 'Nome completo della configurazione';
    input.style.cssText = `
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.9em;
        background: rgba(255, 255, 255, 0.1);
        border: 2px solid #3498db;
        border-radius: 6px;
        padding: 4px 8px;
        width: 100%;
        box-sizing: border-box;
        outline: none;
        margin: 0 0 16px 0;
    `;
    
    
    fullNameElement.style.display = 'none';
    fullNameElement.parentNode.insertBefore(input, fullNameElement);
    input.focus();
    input.select();
    
    const saveChanges = async () => {
        const newFullName = input.value.trim();
        
        
        if (newFullName === currentText) {
            input.remove();
            fullNameElement.style.display = '';
            return;
        }
        
        try {
            
            input.disabled = true;
            input.style.borderColor = '#f39c12';
            
            
            const response = await fetch('api_gateway/db_bridge/configs_service/endpoint/api-configs.php', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    config_name: configKey,
                    full_name: newFullName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                
                if (PC_CONFIGS[configKey]) {
                    PC_CONFIGS[configKey].fullName = newFullName;
                }
                
                
                fullNameElement.textContent = newFullName;
                
                
                input.remove();
                fullNameElement.style.display = '';
                
                
                showNotification('✅ Nome completo aggiornato con successo', 'success');
            } else {
                throw new Error(result.error || 'Errore nel salvataggio');
            }
        } catch (error) {
            console.error('Errore nell\'aggiornare il nome completo:', error);
            alert('Errore nel salvare il nome completo: ' + error.message);
            input.disabled = false;
            input.style.borderColor = '#3498db';
            input.focus();
            input.select();
        }
    };
    
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveChanges();
        } else if (e.key === 'Escape') {
            input.remove();
            fullNameElement.style.display = '';
        }
    });
    
    
    input.addEventListener('blur', () => {
        
        setTimeout(saveChanges, 100);
    });
}




function makeConfigTitleEditable(titleElement) {
    const oldConfigKey = titleElement.dataset.configKey;
    const currentText = titleElement.textContent.trim();
    
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.style.cssText = `
        color: white;
        font-size: 1.2em;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.1);
        border: 2px solid #3498db;
        border-radius: 6px;
        padding: 4px 8px;
        width: 100%;
        box-sizing: border-box;
        outline: none;
    `;
    
    
    titleElement.style.display = 'none';
    titleElement.parentNode.insertBefore(input, titleElement);
    input.focus();
    input.select();
    
    const saveChanges = async () => {
        const newConfigKey = input.value.trim();
        
        
        if (!newConfigKey || newConfigKey === oldConfigKey) {
            input.remove();
            titleElement.style.display = '';
            return;
        }
        
        
        if (PC_CONFIGS[newConfigKey] && newConfigKey !== oldConfigKey) {
            alert('Esiste già una configurazione con questo nome!');
            input.focus();
            input.select();
            return;
        }
        
        try {
            
            input.disabled = true;
            input.style.borderColor = '#f39c12';
            
            
            const response = await fetch('api_gateway/db_bridge/configs_service/endpoint/api-configs.php', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    old_config_name: oldConfigKey,
                    new_config_name: newConfigKey
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                
                PC_CONFIGS[newConfigKey] = PC_CONFIGS[oldConfigKey];
                delete PC_CONFIGS[oldConfigKey];
                
                
                titleElement.textContent = newConfigKey;
                titleElement.dataset.configKey = newConfigKey;
                titleElement.closest('.config-card').dataset.configKey = newConfigKey;
                
                
                input.remove();
                titleElement.style.display = '';
                
                
                showNotification('✅ Configurazione rinominata con successo', 'success');
            } else {
                throw new Error(result.error || 'Errore nel salvataggio');
            }
        } catch (error) {
            console.error('Errore nel rinominare la configurazione:', error);
            alert('Errore nel salvare il nuovo nome: ' + error.message);
            input.disabled = false;
            input.style.borderColor = '#3498db';
            input.focus();
            input.select();
        }
    };
    
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveChanges();
        } else if (e.key === 'Escape') {
            input.remove();
            titleElement.style.display = '';
        }
    });
    
    
    input.addEventListener('blur', () => {
        
        setTimeout(saveChanges, 100);
    });
}




function showDeleteConfigPopup(configKey) {
    const existingPopup = document.getElementById('delete-config-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'delete-config-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 3000; backdrop-filter: blur(5px);';
    
    const popup = document.createElement('div');
    popup.id = 'delete-config-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3001; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(231, 76, 60, 0.3); width: 500px; max-width: 90%;';
    
    popup.innerHTML = `
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="font-size: 4em; margin-bottom: 16px;">⚠️</div>
            <h3 style="margin: 0 0 12px 0; color: white; font-size: 1.4em; font-weight: 700;">Eliminare Configurazione?</h3>
            <p style="color: rgba(255,255,255,0.7); font-size: 1em; margin: 0;">Sei sicuro di voler eliminare la configurazione:</p>
            <p style="color: #e74c3c; font-size: 1.1em; font-weight: 600; margin: 12px 0;">"${configKey}"</p>
            <p style="color: rgba(255,255,255,0.5); font-size: 0.9em; margin: 12px 0 0 0;">Questa azione non può essere annullata.</p>
        </div>
        
        <div style="display: flex; gap: 12px; margin-top: 24px;">
            <button id="cancel-delete-config" style="flex: 1; padding: 14px; background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 1em; transition: all 0.2s ease;">Annulla</button>
            <button id="confirm-delete-config" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 1em; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(231, 76, 60, 0.4);">🗑️ Elimina</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
    
    
    const cancelBtn = document.getElementById('cancel-delete-config');
    const confirmBtn = document.getElementById('confirm-delete-config');
    
    const closePopup = () => {
        popup.remove();
        overlay.remove();
    };
    
    cancelBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);
    
    confirmBtn.addEventListener('mouseenter', () => {
        confirmBtn.style.transform = 'scale(1.05)';
    });
    confirmBtn.addEventListener('mouseleave', () => {
        confirmBtn.style.transform = 'scale(1)';
    });
    
    confirmBtn.addEventListener('click', () => {
        deleteConfiguration(configKey);
        closePopup();
    });
}




async function deleteConfiguration(configKey) {
    const success = await deleteConfigFromDatabase(configKey);
    
    if (success) {
        showNotification(`🗑️ Configurazione "${configKey}" eliminata`);
        
        
        renderStandardConfigsCards();
    } else {
        showNotification('❌ Errore durante l\'eliminazione');
    }
}




function showAddComponentToConfigPopup(configKey) {
    const existingPopup = document.getElementById('add-component-popup');
    if (existingPopup) existingPopup.remove();
    
    if (!PC_CONFIGS[configKey]) {
        showNotification('❌ Configurazione non trovata');
        return;
    }
    
    
    const allComponentTypes = [
        { type: 'CPU', color: '#e74c3c', icon: '🔥' },
        { type: 'GPU', color: '#9b59b6', icon: '🎮' },
        { type: 'RAM', color: '#3498db', icon: '💾' },
        { type: 'MOBO', color: '#f39c12', icon: '🔌' },
        { type: 'SSD', color: '#2ecc71', icon: '💿' },
        { type: 'PSU', color: '#7f8c8d', icon: '⚡' },
        { type: 'COOLER', color: '#3498db', icon: '❄️' },
        { type: 'CASE', color: '#9b59b6', icon: '📦' },
        { type: 'MONITOR', color: '#1abc9c', icon: '🖥️' },
        { type: 'KIT GAMING', color: '#34495e', icon: '🎮' }
    ];
    
    
    const existingTypes = PC_CONFIGS[configKey].components.map(c => c.type);
    
    
    const missingComponents = allComponentTypes.filter(comp => !existingTypes.includes(comp.type));
    
    if (missingComponents.length === 0) {
        showNotification('✅ Tutti i componenti sono già presenti');
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'add-component-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 2999;';
    
    const popup = document.createElement('div');
    popup.id = 'add-component-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.3); width: 600px; max-width: 90%; max-height: 85vh; overflow-y: auto;';
    
    
    let componentsButtonsHtml = '';
    missingComponents.forEach(comp => {
        componentsButtonsHtml += `
            <button class="component-type-btn" data-component-type="${comp.type}" style="padding: 16px; background: ${comp.color}22; color: ${comp.color}; border: 2px solid ${comp.color}66; border-radius: 10px; font-weight: 700; font-size: 1.1em; cursor: pointer; transition: all 0.3s ease;">
                ${comp.icon} ${comp.type}
            </button>
        `;
    });
    
    popup.innerHTML = `
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="font-size: 3em; margin-bottom: 16px;">➕</div>
            <h3 style="margin: 0 0 12px 0; color: white; font-size: 1.4em; font-weight: 700;">Aggiungi Componente</h3>
            <p style="color: rgba(255,255,255,0.7); font-size: 1em; margin: 0;">Seleziona il tipo di componente da aggiungere:</p>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px;">
            ${componentsButtonsHtml}
        </div>
        
        <button id="cancel-add-component" style="width: 100%; padding: 14px; background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 1em; transition: all 0.2s ease;">Annulla</button>
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
    
    
    popup.querySelectorAll('.component-type-btn').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.filter = 'brightness(1.2)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
            btn.style.filter = 'brightness(1)';
        });
        btn.addEventListener('click', () => {
            const componentType = btn.dataset.componentType;
            addComponentToConfig(configKey, componentType);
            popup.remove();
            overlay.remove();
        });
    });
    
    
    const cancelBtn = document.getElementById('cancel-add-component');
    const closePopup = () => {
        popup.remove();
        overlay.remove();
    };
    
    cancelBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);
}




async function addComponentToConfig(configKey, componentType) {
    if (!PC_CONFIGS[configKey]) {
        showNotification('❌ Configurazione non trovata');
        return;
    }
    
    
    const existingComponent = PC_CONFIGS[configKey].components.find(c => c.type === componentType);
    if (existingComponent) {
        showNotification(`⚠️ ${componentType} già presente nella configurazione`);
        return;
    }
    
    
    const card = document.querySelector(`.config-card[data-config-key="${configKey}"]`);
    if (card) {
        const eanInputs = card.querySelectorAll('.component-ean-input');
        const updatedComponents = [];
        
        eanInputs.forEach(input => {
            const compType = input.dataset.componentType;
            const compIndex = input.dataset.componentIndex;
            const ean = input.value.trim();
            
            
            const badge = card.querySelector(`.config-supplier-badge[data-component-type="${compType}"][data-component-index="${compIndex}"]`);
            const supplier = badge ? badge.dataset.supplier : '';
            
            
            const value = supplier ? `${ean} (${supplier})` : ean;
            
            updatedComponents.push({
                type: compType,
                value: value
            });
        });
        
        
        PC_CONFIGS[configKey].components = updatedComponents;
    }
    
    
    PC_CONFIGS[configKey].components.push({
        type: componentType,
        value: ''
    });
    
    
    const success = await updateConfigInDatabase(configKey, PC_CONFIGS[configKey]);
    
    if (success) {
        showNotification(`✅ ${componentType} aggiunto alla configurazione`);
        renderStandardConfigsCards();
    } else {
        showNotification('❌ Errore durante il salvataggio');
    }
}




async function removeComponentFromConfig(configKey, componentType) {
    if (!PC_CONFIGS[configKey]) {
        showNotification('❌ Configurazione non trovata');
        return;
    }
    
    
    if (PC_CONFIGS[configKey].components.length <= 1) {
        showNotification('❌ Non puoi rimuovere l\'unico componente della configurazione');
        return;
    }
    
    
    showRemoveComponentPasswordPopup(configKey, componentType);
}




function showRemoveComponentPasswordPopup(configKey, componentType) {
    const existingPopup = document.getElementById('remove-component-password-popup');
    if (existingPopup) existingPopup.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'remove-component-password-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 2999;';
    
    const popup = document.createElement('div');
    popup.id = 'remove-component-password-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.3); width: 450px; max-width: 90%;';
    
    popup.innerHTML = `
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="font-size: 4em; margin-bottom: 16px;">🔒</div>
            <h3 style="margin: 0 0 12px 0; color: white; font-size: 1.4em; font-weight: 700;">Rimuovi Componente</h3>
            <p style="color: rgba(255,255,255,0.7); font-size: 1em; margin: 0 0 8px 0;">Stai per rimuovere:</p>
            <p style="color: #e74c3c; font-size: 1.1em; font-weight: 600; margin: 0 0 16px 0;">${componentType}</p>
            <p style="color: rgba(255,255,255,0.5); font-size: 0.9em; margin: 0;">Inserisci la password per confermare:</p>
        </div>
        
        <div style="margin-bottom: 24px;">
            <input 
                type="password" 
                id="remove-component-password-input" 
                placeholder="Password"
                style="width: 100%; box-sizing: border-box; padding: 14px; background: rgba(0,0,0,0.4); border: 2px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 1em; transition: all 0.2s ease;"
            >
        </div>
        
        <div style="display: flex; gap: 12px;">
            <button id="cancel-remove-component" style="flex: 1; padding: 14px; background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 1em; transition: all 0.2s ease;">Annulla</button>
            <button id="confirm-remove-component" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 1em; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(231, 76, 60, 0.4);">🗑️ Rimuovi</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
    
    const passwordInput = document.getElementById('remove-component-password-input');
    const cancelBtn = document.getElementById('cancel-remove-component');
    const confirmBtn = document.getElementById('confirm-remove-component');
    
    const closePopup = () => {
        popup.remove();
        overlay.remove();
    };
    
    
    setTimeout(() => passwordInput.focus(), 100);
    
    
    passwordInput.addEventListener('focus', () => {
        passwordInput.style.borderColor = 'rgba(231, 76, 60, 0.6)';
    });
    passwordInput.addEventListener('blur', () => {
        passwordInput.style.borderColor = 'rgba(255,255,255,0.2)';
    });
    
    
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmBtn.click();
        }
    });
    
    
    cancelBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);
    
    confirmBtn.addEventListener('mouseenter', () => {
        confirmBtn.style.transform = 'scale(1.05)';
    });
    confirmBtn.addEventListener('mouseleave', () => {
        confirmBtn.style.transform = 'scale(1)';
    });
    
    confirmBtn.addEventListener('click', async () => {
        const password = passwordInput.value.trim();
        
        if (!password) {
            passwordInput.style.borderColor = '#e74c3c';
            passwordInput.placeholder = 'Inserisci la password!';
            passwordInput.style.animation = 'shake 0.3s';
            setTimeout(() => {
                passwordInput.style.animation = '';
            }, 300);
            return;
        }
        
        
        if (password !== 'admin') {
            passwordInput.value = '';
            passwordInput.style.borderColor = '#e74c3c';
            passwordInput.placeholder = 'Password errata!';
            passwordInput.style.animation = 'shake 0.3s';
            setTimeout(() => {
                passwordInput.style.animation = '';
                passwordInput.placeholder = 'Password';
            }, 1000);
            return;
        }
        
        
        closePopup();
        await confirmRemoveComponent(configKey, componentType);
    });
}




async function confirmRemoveComponent(configKey, componentType) {
    
    const originalLength = PC_CONFIGS[configKey].components.length;
    PC_CONFIGS[configKey].components = PC_CONFIGS[configKey].components.filter(c => c.type !== componentType);
    
    if (PC_CONFIGS[configKey].components.length === originalLength) {
        showNotification(`⚠️ ${componentType} non trovato nella configurazione`);
        return;
    }
    
    
    const success = await updateConfigInDatabase(configKey, PC_CONFIGS[configKey]);
    
    if (success) {
        showNotification(`✅ ${componentType} rimosso dalla configurazione`);
        renderStandardConfigsCards();
    } else {
        showNotification('❌ Errore durante il salvataggio');
    }
}

async function saveAllConfigurations() {
    const container = document.getElementById('standard-configs-container');
    if (!container) return;
    
    const cards = container.querySelectorAll('.config-card');
    let savedCount = 0;
    
    for (const card of cards) {
        const configKey = card.dataset.configKey;
        const eanInputs = card.querySelectorAll('.component-ean-input');
        const updatedComponents = [];
        
        eanInputs.forEach(input => {
            const componentType = input.dataset.componentType;
            const componentIndex = input.dataset.componentIndex;
            const ean = input.value.trim();
            
            
            const badge = card.querySelector(`.config-supplier-badge[data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
            let supplier = badge ? badge.dataset.supplier : '';
            
            
            if (!supplier || supplier === '' || supplier === 'FORNITORE' || supplier === 'undefined') {
                supplier = null;
            }
            
            console.log(`💾 Salvataggio ${componentType}: EAN="${ean}", Supplier="${supplier}"`);
            
            
            updatedComponents.push({
                type: componentType,
                value: ean,  
                supplier: supplier  
            });
        });
        
        
        const configData = {
            fullName: PC_CONFIGS[configKey]?.fullName || '',
            components: updatedComponents
        };
        
        const success = await updateConfigInDatabase(configKey, configData);
        if (success) savedCount++;
    }
    
    
    await loadPCConfigs();
    
    showNotification(`✅ Salvate ${savedCount} configurazioni`);
}

async function saveConfigurationChanges(configKey) {
    const card = document.querySelector(`.config-card[data-config-key="${configKey}"]`);
    if (!card) return;
    
    const eanInputs = card.querySelectorAll('.component-ean-input');
    const updatedComponents = [];
    
    eanInputs.forEach(input => {
        const componentType = input.dataset.componentType;
        const componentIndex = input.dataset.componentIndex;
        const ean = input.value.trim();
        
        
        const badge = card.querySelector(`.config-supplier-badge[data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
        let supplier = badge ? badge.dataset.supplier : '';
        
        
        if (!supplier || supplier === '' || supplier === 'FORNITORE' || supplier === 'undefined') {
            supplier = null;
        }
        
        console.log(`💾 Salvataggio ${componentType}: EAN="${ean}", Supplier="${supplier}"`);
        
        
        updatedComponents.push({
            type: componentType,
            value: ean,  
            supplier: supplier  
        });
    });
    
    
    const configData = {
        fullName: PC_CONFIGS[configKey]?.fullName || '',
        components: updatedComponents
    };
    
    const success = await updateConfigInDatabase(configKey, configData);
    
    if (success) {
        
        await loadPCConfigs();
        showNotification(`✅ Configurazione "${configKey}" salvata`);
    } else {
        showNotification('❌ Errore durante il salvataggio');
    }
}


let currentConfigSupplierKey = null;
let currentConfigSupplierType = null;
let currentConfigSupplierIndex = null;

function showConfigSupplierSelectPopup(configKey, componentType, componentIndex) {
    currentConfigSupplierKey = configKey;
    currentConfigSupplierType = componentType;
    currentConfigSupplierIndex = componentIndex;
    
    const existingPopup = document.getElementById('config-supplier-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const popup = document.createElement('div');
    popup.id = 'config-supplier-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000; background: rgba(30, 30, 30, 0.95); backdrop-filter: blur(20px); border-radius: 16px; padding: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.3); width: 400px;';
    
    popup.innerHTML = `
        <h3 style="margin: 0 0 8px 0; color: white; font-size: 1.1em; font-weight: 600;">🔧 Seleziona Fornitore</h3>
        <p style="color: rgba(255,255,255,0.6); font-size: 0.9em; margin: 0 0 16px 0;">Componente: <strong style="color: #3498db;">${componentType}</strong></p>
        
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
            <button class="config-supplier-option" data-supplier="PROKS" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.4); transition: all 0.2s ease;">PROKS</button>
            <button class="config-supplier-option" data-supplier="OMEGA" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(155, 89, 182, 0.2); color: #9b59b6; border: 1px solid rgba(155, 89, 182, 0.4); transition: all 0.2s ease;">OMEGA</button>
            <button class="config-supplier-option" data-supplier="TIER ONE" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(52, 152, 219, 0.2); color: #3498db; border: 1px solid rgba(52, 152, 219, 0.4); transition: all 0.2s ease;">TIER ONE</button>
            <button class="config-supplier-option" data-supplier="AMAZON" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(243, 156, 18, 0.2); color: #f39c12; border: 1px solid rgba(243, 156, 18, 0.4); transition: all 0.2s ease;">AMAZON</button>
            <button class="config-supplier-option" data-supplier="NOUA" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(46, 204, 113, 0.2); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4); transition: all 0.2s ease;">NOUA</button>
            <button class="config-supplier-option" data-supplier="INTEGRATA" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(127, 140, 141, 0.2); color: #7f8c8d; border: 1px solid rgba(127, 140, 141, 0.4); transition: all 0.2s ease;">INTEGRATA</button>
            <button class="config-supplier-option" data-supplier="MSI" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(211, 84, 0, 0.2); color: #d35400; border: 1px solid rgba(211, 84, 0, 0.4); transition: all 0.2s ease;">MSI</button>
            <button class="config-supplier-option" data-supplier="CASEKING" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(22, 160, 133, 0.2); color: #16a085; border: 1px solid rgba(22, 160, 133, 0.4); transition: all 0.2s ease;">CASEKING</button>
            <button class="config-supplier-option" data-supplier="NAVY BLUE" style="flex: 1 1 45%; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; background: rgba(26, 86, 219, 0.2); color: #1a56db; border: 1px solid rgba(26, 86, 219, 0.4); transition: all 0.2s ease;">NAVY BLUE</button>
        </div>
        
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Oppure inserisci nuovo fornitore:</label>
            <input type="text" id="config-custom-supplier-input" placeholder="Nome nuovo fornitore..." style="width: 100%; box-sizing: border-box; padding: 10px 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; font-size: 0.95em;">
        </div>
        
        <div style="display: flex; gap: 8px;">
            <button id="confirm-config-custom-supplier" style="flex: 1; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">Conferma</button>
            <button id="cancel-config-supplier-select" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 600; cursor: pointer;">Annulla</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    
    popup.querySelectorAll('.config-supplier-option').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.filter = 'brightness(1.2)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
            btn.style.filter = 'brightness(1)';
        });
        btn.addEventListener('click', () => {
            applyConfigSupplier(btn.dataset.supplier);
        });
    });
    
    
    document.getElementById('confirm-config-custom-supplier')?.addEventListener('click', () => {
        const customInput = document.getElementById('config-custom-supplier-input');
        const supplier = customInput.value.trim().toUpperCase();
        
        if (supplier) {
            applyConfigSupplier(supplier);
        } else {
            showNotification('Inserisci un nome fornitore');
        }
    });
    
    
    document.getElementById('cancel-config-supplier-select')?.addEventListener('click', closeConfigSupplierPopup);
}

function applyConfigSupplier(supplier) {
    if (!currentConfigSupplierKey || !currentConfigSupplierType || currentConfigSupplierIndex === null) {
        closeConfigSupplierPopup();
        return;
    }
    
    
    const badge = document.querySelector(`.config-supplier-badge[data-config-key="${currentConfigSupplierKey}"][data-component-type="${currentConfigSupplierType}"][data-component-index="${currentConfigSupplierIndex}"]`);
    
    if (badge) {
        
        let supplierColor = '#95a5a6';
        if (supplier === 'PROKS') supplierColor = '#e74c3c';
        else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
        else if (supplier === 'TIER ONE') supplierColor = '#3498db';
        else if (supplier === 'MSI') supplierColor = '#d35400';
        else if (supplier === 'AMAZON') supplierColor = '#f39c12';
        else if (supplier === 'NOUA') supplierColor = '#2ecc71';
        else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
        else if (supplier === 'CASEKING') supplierColor = '#16a085';
        else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
        
        badge.textContent = supplier;
        badge.dataset.supplier = supplier;
        badge.style.background = `${supplierColor}33`;
        badge.style.color = supplierColor;
        badge.style.borderColor = `${supplierColor}66`;
        
        showNotification(`Fornitore impostato: ${supplier}`);
    }
    
    closeConfigSupplierPopup();
}

function closeConfigSupplierPopup() {
    const popup = document.getElementById('config-supplier-popup');
    if (popup) {
        popup.remove();
    }
    currentConfigSupplierKey = null;
    currentConfigSupplierType = null;
    currentConfigSupplierIndex = null;
}


async function searchNewConfigComponents(query, componentType, componentIndex, suggestionsDiv) {
    if (!suggestionsDiv) return;
    
    try {
        
        const typeMap = {
            'CPU': 'CPU',
            'MOBO': 'Scheda_Madre',
            'GPU': 'GPU',
            'RAM': 'RAM',
            'SSD': 'SSD',
            'HDD': 'HDD',
            'PSU': 'Alimentatore',
            'COOLER': 'Dissipatore',
            'CASE': 'Case_PC'
        };
        
        const dbType = typeMap[componentType] || '';
        
        
        let results = [];
        
        try {
            const popup = document.getElementById('add-config-popup');
            const supplierInput = popup ? popup.querySelector(`.new-component-supplier[data-component-index="${componentIndex}"]`) : null;
            const supplierHint = supplierInput ? String(supplierInput.value || '').trim() : '';
            const [eanResponse, searchResponse] = await Promise.all([
                fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(query)}${supplierHint && supplierHint !== 'N/D' && supplierHint !== 'FORNITORE' ? `&supplier=${encodeURIComponent(supplierHint)}` : ''}`).catch(() => null),
                fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}&type=${encodeURIComponent(dbType)}`).catch(() => null)
            ]);
            
            
            if (eanResponse) {
                const eanData = await eanResponse.json();
                if (eanData.success && eanData.component) {
                    results.push(eanData.component);
                }
            }
            
            
            if (searchResponse) {
                const searchData = await searchResponse.json();
                if (searchData.success && searchData.components && searchData.components.length > 0) {
                    
                    const eanSet = new Set(results.map(c => c.ean));
                    searchData.components.forEach(comp => {
                        if (!eanSet.has(comp.ean)) {
                            results.push(comp);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Errore ricerca componenti:', error);
        }
        
        if (results.length > 0) {
            suggestionsDiv.style.display = 'block';
            
            
            if (componentType === 'SSD') {
                results.sort((a, b) => {
                    const aIsM2 = a.nome?.toUpperCase().includes('M.2') || a.categoria?.toUpperCase().includes('M.2');
                    const bIsM2 = b.nome?.toUpperCase().includes('M.2') || b.categoria?.toUpperCase().includes('M.2');
                    if (aIsM2 && !bIsM2) return -1;
                    if (!aIsM2 && bIsM2) return 1;
                    return 0;
                });
            }
            
            let html = '';
            results.slice(0, 10).forEach(comp => {
                const isM2 = comp.nome?.toUpperCase().includes('M.2') || comp.categoria?.toUpperCase().includes('M.2');
                const borderColor = isM2 ? 'rgba(46, 204, 113, 0.6)' : 'rgba(255,255,255,0.15)';
                const background = isM2 ? 'linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1))' : 'rgba(255,255,255,0.05)';
                
                html += `
                    <div class="new-config-suggestion-item" 
                        data-ean="${comp.ean}" 
                        data-supplier="${comp.fornitore || ''}"
                        style="padding: 10px 14px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: all 0.2s ease; background: ${background}; border-left: 3px solid ${borderColor};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="color: white; font-weight: 600; font-size: 0.9em;">${comp.nome || 'N/D'}</span>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                ${comp.prezzo ? `<span style="background: rgba(46, 204, 113, 0.2); color: #2ecc71; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; font-weight: 700;">€${parseFloat(comp.prezzo).toFixed(2)}</span>` : ''}
                                ${comp.fornitore ? `<span style="background: rgba(${comp.fornitore === 'PROKS' ? '231, 76, 60' : comp.fornitore === 'OMEGA' ? '155, 89, 182' : comp.fornitore === 'TIER ONE' ? '52, 152, 219' : comp.fornitore === 'AMAZON' ? '243, 156, 18' : comp.fornitore === 'NOUA' ? '46, 204, 113' : '149, 165, 166'}, 0.3); color: ${comp.fornitore === 'PROKS' ? '#e74c3c' : comp.fornitore === 'OMEGA' ? '#9b59b6' : comp.fornitore === 'TIER ONE' ? '#3498db' : comp.fornitore === 'AMAZON' ? '#f39c12' : comp.fornitore === 'NOUA' ? '#2ecc71' : '#95a5a6'}; padding: 3px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 700;">${comp.fornitore}</span>` : ''}
                            </div>
                        </div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 0.8em;">EAN: ${comp.ean}</div>
                        ${comp.categoria ? `<div style="color: rgba(255,255,255,0.4); font-size: 0.75em; margin-top: 2px;">${comp.categoria}</div>` : ''}
                        ${isM2 ? '<div style="color: #2ecc71; font-size: 0.75em; font-weight: 600; margin-top: 4px;">⭐ M.2 SSD</div>' : ''}
                    </div>
                `;
            });
            
            suggestionsDiv.innerHTML = html;
            
            
            suggestionsDiv.querySelectorAll('.new-config-suggestion-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    if (item.style.border.includes('46, 204, 113')) {
                        item.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.35), rgba(39, 174, 96, 0.2))';
                    } else {
                        item.style.background = 'rgba(255,255,255,0.1)';
                    }
                });
                item.addEventListener('mouseleave', () => {
                    if (item.style.border.includes('46, 204, 113')) {
                        item.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1))';
                    } else {
                        item.style.background = 'rgba(255,255,255,0.05)';
                    }
                });
                item.addEventListener('click', () => {
                    const ean = item.dataset.ean;
                    const supplier = item.dataset.supplier || '';
                    applyNewConfigSuggestion(ean, componentIndex, supplier);
                    suggestionsDiv.style.display = 'none';
                });
            });
            
        } else {
            suggestionsDiv.style.display = 'block';
            suggestionsDiv.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 12px; margin: 0;">Nessun componente trovato</p>';
        }
    } catch (error) {
        console.error('Errore ricerca componenti:', error);
        suggestionsDiv.style.display = 'block';
        suggestionsDiv.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 12px; margin: 0;">Errore nella ricerca</p>';
    }
}


async function applyNewConfigSuggestion(ean, componentIndex, supplier = '') {
    const popup = document.getElementById('add-config-popup');
    if (!popup) return;
    
    const input = popup.querySelector(`.new-component-ean[data-component-index="${componentIndex}"]`);
    const supplierInput = popup.querySelector(`.new-component-supplier[data-component-index="${componentIndex}"]`);
    const supplierBadge = popup.querySelector(`.component-supplier-badge[data-component-index="${componentIndex}"]`);
    
    if (input) {
        input.value = ean;
        
        
        const componentType = input.dataset.componentType;
        
        try {
            let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
            if (supplier && supplier !== '--' && supplier !== 'FORNITORE') {
                url += `&supplier=${encodeURIComponent(supplier)}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success && data.component) {
                const nomeProdotto = data.component.nome || 'Nome non disponibile';
                const fornitore = data.component.fornitore || 'N/D';
                const categoria = data.component.categoria || 'N/D';
                const quantita = data.component.quantita_disponibile !== undefined ? data.component.quantita_disponibile : 'N/D';
                
                input.title = `${componentType}: ${nomeProdotto}\nEAN: ${ean}\nCategoria: ${categoria}\nDisponibilità: ${quantita}`;
                input.dataset.tooltipLoaded = 'true';
                
                
                if (supplierInput) {
                    supplierInput.value = fornitore;
                }
                
                if (supplierBadge && fornitore && fornitore !== 'N/D') {
                    
                    const supplierColors = {
                        'PROKS': { bg: 'rgba(231, 76, 60, 0.3)', color: '#e74c3c', border: 'rgba(231, 76, 60, 0.6)' },
                        'OMEGA': { bg: 'rgba(155, 89, 182, 0.3)', color: '#9b59b6', border: 'rgba(155, 89, 182, 0.6)' },
                        'TIER ONE': { bg: 'rgba(52, 152, 219, 0.3)', color: '#3498db', border: 'rgba(52, 152, 219, 0.6)' },
                        'AMAZON': { bg: 'rgba(243, 156, 18, 0.3)', color: '#f39c12', border: 'rgba(243, 156, 18, 0.6)' },
                        'NOUA': { bg: 'rgba(46, 204, 113, 0.3)', color: '#2ecc71', border: 'rgba(46, 204, 113, 0.6)' },
                        'ECOM': { bg: 'rgba(52, 152, 219, 0.3)', color: '#3498db', border: 'rgba(52, 152, 219, 0.6)' },
                        'MSI': { bg: 'rgba(211, 84, 0, 0.3)', color: '#d35400', border: 'rgba(211, 84, 0, 0.6)' },
                        'CASEKING': { bg: 'rgba(230, 126, 34, 0.3)', color: '#e67e22', border: 'rgba(230, 126, 34, 0.6)' },
                        'NAVY BLUE': { bg: 'rgba(26, 86, 219, 0.3)', color: '#1a56db', border: 'rgba(26, 86, 219, 0.6)' }
                    };
                    
                    const colors = supplierColors[fornitore.toUpperCase()] || { bg: 'rgba(149, 165, 166, 0.3)', color: '#95a5a6', border: 'rgba(149, 165, 166, 0.6)' };
                    supplierBadge.style.background = colors.bg;
                    supplierBadge.style.color = colors.color;
                    supplierBadge.style.borderColor = colors.border;
                    supplierBadge.textContent = fornitore;
                } else if (supplierBadge) {
                    supplierBadge.style.background = 'rgba(255,255,255,0.05)';
                    supplierBadge.style.color = 'rgba(255,255,255,0.3)';
                    supplierBadge.style.borderColor = 'rgba(255,255,255,0.1)';
                    supplierBadge.textContent = 'N/D';
                }
            } else {
                input.title = `${componentType}: ${ean}`;
                input.dataset.tooltipLoaded = 'true';
            }
        } catch (error) {
            console.error('Errore caricamento tooltip:', error);
            input.title = `${componentType}: ${ean}`;
        }
    }
}


async function searchConfigComponents(query, componentType, configKey, componentIndex) {
    const suggestionsDiv = document.querySelector(`.config-suggestions[data-config-key="${configKey}"][data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
    
    if (!suggestionsDiv) return;
    
    try {
        
        const typeMap = {
            'CPU': 'CPU',
            'MOBO': 'Scheda_Madre',
            'GPU': 'GPU',
            'RAM': 'RAM',
            'SSD': 'SSD',
            'HDD': 'HDD',
            'PSU': 'Alimentatore',
            'COOLER': 'Dissipatore',
            'CASE': 'Case_PC',
            'SCHEDA AGGIUNTIVA': 'Scheda_Aggiuntiva',
            'MONITOR': 'Scheda_Aggiuntiva',
            'KIT GAMING': 'Scheda_Aggiuntiva'
        };
        
        const dbType = typeMap[componentType] || '';
        
        
        let components = [];
        
        try {
            const supplierBadge = document.querySelector(`.config-supplier-badge[data-config-key="${configKey}"][data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
            const supplierHint = supplierBadge && supplierBadge.dataset && supplierBadge.dataset.supplier
                ? String(supplierBadge.dataset.supplier).trim()
                : '';
            const [eanResponse, searchResponse] = await Promise.all([
                fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(query)}${supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE' ? `&supplier=${encodeURIComponent(supplierHint)}` : ''}`).catch(() => null),
                dbType 
                    ? fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}&type=${encodeURIComponent(dbType)}`).catch(() => null)
                    : fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}`).catch(() => null)
            ]);
            
            
            if (eanResponse) {
                const eanData = await eanResponse.json();
                if (eanData.success && eanData.component) {
                    components.push(eanData.component);
                }
            }
            
            
            if (searchResponse) {
                const searchData = await searchResponse.json();
                if (searchData.success && searchData.components && searchData.components.length > 0) {
                    
                    const eanSet = new Set(components.map(c => c.ean));
                    searchData.components.forEach(comp => {
                        if (!eanSet.has(comp.ean)) {
                            components.push(comp);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Errore ricerca componenti:', error);
        }
        
        if (components.length > 0) {
            
            let availableComponents = data.components.filter(c => parseFloat(c.quantita) > 0);
            
            
            if (componentType === 'SSD') {
                const m2Components = availableComponents.filter(c => 
                    c.nome.toLowerCase().includes('m.2') || 
                    c.nome.toLowerCase().includes('nvme') ||
                    c.nome.toLowerCase().includes('m2')
                );
                
                const otherComponents = availableComponents.filter(c => 
                    !c.nome.toLowerCase().includes('m.2') && 
                    !c.nome.toLowerCase().includes('nvme') &&
                    !c.nome.toLowerCase().includes('m2')
                );
                
                if (m2Components.length > 0) {
                    const sortedM2 = m2Components.sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
                    availableComponents = [...sortedM2, ...otherComponents];
                }
            } else {
                
                availableComponents.sort((a, b) => parseFloat(a.prezzo) - parseFloat(b.prezzo));
            }
            
            if (availableComponents.length === 0) {
                suggestionsDiv.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 12px; margin: 0;">Nessun componente disponibile</p>';
                return;
            }
            
            const recommended = availableComponents[0];
            let html = '';
            
            
            html += `
                <div class="config-suggestion-item" data-ean="${recommended.ean}" data-supplier="${recommended.fornitore || ''}" style="padding: 12px; margin: 8px; background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1)); border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 1px solid rgba(46, 204, 113, 0.4);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 700;">⭐ CONSIGLIATO</span>
                        <span style="color: #2ecc71; font-weight: 700; font-size: 1em;">€${parseFloat(recommended.prezzo).toFixed(2)}</span>
                    </div>
                    <div style="color: white; font-weight: 600; font-size: 0.9em; margin-bottom: 4px;">${recommended.nome}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: rgba(255,255,255,0.6); font-size: 0.8em;">EAN: ${recommended.ean}</span>
                    </div>
                    <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">Qtà: ${recommended.quantita} | ${recommended.fornitore || 'N/D'}</div>
                </div>
            `;
            
            
            if (availableComponents.length > 1) {
                html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 8px; padding-top: 8px; color: rgba(255,255,255,0.4); font-size: 0.75em; text-align: center;">Altri risultati</div>';
                
                availableComponents.slice(1).forEach(c => {
                    html += `
                        <div class="config-suggestion-item" data-ean="${c.ean}" data-supplier="${c.fornitore || ''}" style="padding: 12px; margin: 8px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="color: white; font-weight: 600; font-size: 0.9em; margin-bottom: 4px;">${c.nome}</div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: rgba(255,255,255,0.6); font-size: 0.8em;">EAN: ${c.ean}</span>
                                <span style="color: #2ecc71; font-weight: 600; font-size: 0.85em;">€${parseFloat(c.prezzo).toFixed(2)}</span>
                            </div>
                            <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">Qtà: ${c.quantita} | ${c.fornitore || 'N/D'}</div>
                        </div>
                    `;
                });
            }
            
            suggestionsDiv.innerHTML = html;
            
            
            suggestionsDiv.querySelectorAll('.config-suggestion-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    if (item.style.border.includes('46, 204, 113')) {
                        item.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.35), rgba(39, 174, 96, 0.2))';
                    } else {
                        item.style.background = 'rgba(255,255,255,0.1)';
                    }
                });
                item.addEventListener('mouseleave', () => {
                    if (item.style.border.includes('46, 204, 113')) {
                        item.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1))';
                    } else {
                        item.style.background = 'rgba(255,255,255,0.05)';
                    }
                });
                item.addEventListener('click', () => {
                    const ean = item.dataset.ean;
                    const supplier = item.dataset.supplier;
                    applyConfigSuggestion(ean, supplier, configKey, componentType, componentIndex);
                    suggestionsDiv.style.display = 'none';
                });
            });
            
        } else {
            suggestionsDiv.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 12px; margin: 0;">Nessun componente trovato</p>';
        }
    } catch (error) {
        console.error('Errore ricerca componenti config:', error);
        suggestionsDiv.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 12px; margin: 0;">Errore nella ricerca</p>';
    }
}


async function applyConfigSuggestion(ean, supplier, configKey, componentType, componentIndex) {
    
    const input = document.querySelector(`.component-ean-input[data-config-key="${configKey}"][data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
    if (input) {
        input.value = ean;
        
        
        try {
            let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
            if (supplier && supplier !== '--' && supplier !== 'FORNITORE') {
                url += `&supplier=${encodeURIComponent(supplier)}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success && data.component) {
                const nomeProdotto = data.component.nome || 'Nome non disponibile';
                const fornitore = data.component.fornitore || 'N/D';
                const categoria = data.component.categoria || 'N/D';
                    const quantita = data.component.quantita_disponibile !== undefined ? data.component.quantita_disponibile : 'N/D';
                
                input.title = `${componentType}: ${nomeProdotto}\nEAN: ${ean}\nCategoria: ${categoria}\nDisponibilità: ${quantita}`;
                input.dataset.tooltipLoaded = 'true';
            } else {
                input.title = `${componentType}: ${ean}`;
                input.dataset.tooltipLoaded = 'true';
            }
        } catch (error) {
            console.error('Errore caricamento tooltip:', error);
            input.title = `${componentType}: ${ean}`;
        }
    }
    
    
    if (supplier) {
        const badge = document.querySelector(`.config-supplier-badge[data-config-key="${configKey}"][data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
        if (badge) {
            let supplierColor = '#95a5a6';
            if (supplier === 'PROKS') supplierColor = '#e74c3c';
            else if (supplier === 'OMEGA') supplierColor = '#9b59b6';
            else if (supplier === 'MSI') supplierColor = '#d35400';
            else if (supplier === 'TIER ONE') supplierColor = '#3498db';
            else if (supplier === 'AMAZON') supplierColor = '#f39c12';
            else if (supplier === 'NOUA') supplierColor = '#2ecc71';
            else if (supplier === 'INTEGRATA') supplierColor = '#7f8c8d';
            else if (supplier === 'CASEKING') supplierColor = '#16a085';
            else if (supplier === 'NAVY BLUE') supplierColor = '#1a56db';
            
            badge.textContent = supplier;
            badge.dataset.supplier = supplier;
            badge.style.background = `${supplierColor}33`;
            badge.style.color = supplierColor;
            badge.style.borderColor = `${supplierColor}66`;
        }
    }
    
    showNotification(`✅ Componente selezionato: ${ean}`);
}


function showAddNewConfigPopup() {
    const existingPopup = document.getElementById('add-config-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const popup = document.createElement('div');
    popup.id = 'add-config-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.3); width: 900px; max-width: 95%; max-height: 85vh; overflow-y: auto;';
    
    
    const defaultComponents = [
        { type: 'CPU', value: '' },
        { type: 'GPU', value: '' },
        { type: 'RAM', value: '' },
        { type: 'MOBO', value: '' },
        { type: 'SSD', value: '' },
        { type: 'PSU', value: '' },
        { type: 'COOLER', value: '' },
        { type: 'CASE', value: '' },
        { type: 'MONITOR', value: '' },
        { type: 'KIT GAMING', value: '' }
    ];
    
    let componentsHtml = '';
    defaultComponents.forEach((comp, index) => {
        
        let compColor = '#95a5a6';
        if (comp.type === 'CPU') compColor = '#e74c3c';
        else if (comp.type === 'GPU') compColor = '#9b59b6';
        else if (comp.type === 'RAM') compColor = '#3498db';
        else if (comp.type === 'MOBO') compColor = '#f39c12';
        else if (comp.type === 'SSD') compColor = '#2ecc71';
        else if (comp.type === 'PSU') compColor = '#7f8c8d';
        else if (comp.type === 'COOLER') compColor = '#3498db';
        else if (comp.type === 'CASE') compColor = '#9b59b6';
        else if (comp.type === 'MONITOR') compColor = '#1abc9c';
        else if (comp.type === 'KIT GAMING') compColor = '#34495e';
        
        componentsHtml += `
            <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 12px; border: 1px solid rgba(255,255,255,0.1); position: relative;">
                <div style="display: flex; gap: 12px; align-items: center;">
                    <label style="color: ${compColor}; font-size: 0.9em; font-weight: 700; min-width: 80px; white-space: nowrap;">${comp.type}</label>
                    <div style="flex: 1; position: relative;">
                        <input 
                            type="text" 
                            class="new-component-ean" 
                            data-component-type="${comp.type}"
                            data-component-index="${index}"
                            placeholder="Cerca per EAN o nome componente..."
                            style="width: 100%; box-sizing: border-box; padding: 10px 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; font-size: 0.95em;"
                        >
                        <input 
                            type="hidden" 
                            class="new-component-supplier" 
                            data-component-index="${index}"
                        >
                        <div class="new-config-suggestions" data-component-type="${comp.type}" data-component-index="${index}" style="display: none; position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: rgba(20, 20, 20, 0.98); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; max-height: 250px; overflow-y: auto; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.3);"></div>
                    </div>
                    <div class="component-supplier-badge" data-component-index="${index}" style="min-width: 70px; padding: 6px 12px; border-radius: 6px; font-size: 0.8em; font-weight: 700; text-align: center; background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.1);">N/D</div>
                </div>
            </div>
        `;
    });
    
    popup.innerHTML = `
        <h3 style="margin: 0 0 8px 0; color: white; font-size: 1.4em; font-weight: 600;">➕ Aggiungi Nuova Configurazione</h3>
        <p style="color: rgba(255,255,255,0.6); font-size: 0.95em; margin: 0 0 24px 0;">Crea una nuova configurazione PC predefinita</p>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
            <div>
                <label style="color: rgba(255,255,255,0.8); font-size: 0.9em; display: block; margin-bottom: 8px; font-weight: 600;">Nome Configurazione</label>
                <input type="text" id="new-config-name" placeholder="es. PC GAMING ULTIMATE" style="width: 100%; box-sizing: border-box; padding: 12px 16px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; font-size: 1em;">
            </div>
            
            <div>
                <label style="color: rgba(255,255,255,0.8); font-size: 0.9em; display: block; margin-bottom: 8px; font-weight: 600;">Nome Completo</label>
                <input type="text" id="new-config-fullname" placeholder="es. PC GAMING ULTIMATE - RTX 5090 + i9 14900K..." style="width: 100%; box-sizing: border-box; padding: 12px 16px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: white; font-size: 1em;">
            </div>
        </div>
        
        <div style="margin-bottom: 24px;">
            <label style="color: rgba(255,255,255,0.8); font-size: 0.9em; display: block; margin-bottom: 12px; font-weight: 600;">Componenti</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                ${componentsHtml}
            </div>
        </div>
        
        <div style="display: flex; gap: 12px;">
            <button id="confirm-add-config" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #2ecc71, #27ae60); color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; font-size: 1.05em;">✅ Crea Configurazione</button>
            <button id="cancel-add-config" style="flex: 1; padding: 14px; background: rgba(255,255,255,0.2); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; font-size: 1.05em;">❌ Annulla</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    
    const overlay = document.createElement('div');
    overlay.id = 'add-config-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2999; backdrop-filter: blur(5px);';
    document.body.appendChild(overlay);
    
    const closePopup = () => {
        popup.remove();
        overlay.remove();
    };
    
    
    let newConfigSearchDebounceTimer = null;
    
    popup.querySelectorAll('.new-component-ean').forEach(input => {
        input.addEventListener('focus', () => {
            input.style.borderColor = 'rgba(46, 204, 113, 0.6)';
            input.style.background = 'rgba(0,0,0,0.5)';
        });
        
        input.addEventListener('blur', (e) => {
            setTimeout(() => {
                input.style.borderColor = 'rgba(255,255,255,0.2)';
                input.style.background = 'rgba(0,0,0,0.4)';
                
                const suggestionsDiv = popup.querySelector(`.new-config-suggestions[data-component-type="${input.dataset.componentType}"][data-component-index="${input.dataset.componentIndex}"]`);
                if (suggestionsDiv) {
                    suggestionsDiv.style.display = 'none';
                }
            }, 200);
        });
        
        
        input.addEventListener('mouseenter', async () => {
            
            if (input.dataset.tooltipLoaded === 'true') return;
            
            const ean = input.value.trim();
            const componentType = input.dataset.componentType;
            
            if (!ean) {
                input.title = `${componentType}: (Nessun EAN inserito)`;
                return;
            }
            
            if (ean === 'Generico') {
                input.title = `${componentType}: Monitor generico`;
                input.dataset.tooltipLoaded = 'true';
                return;
            }
            
            if (ean.toUpperCase() === 'INTEGRATA') {
                input.title = `${componentType}: GPU Integrata`;
                input.dataset.tooltipLoaded = 'true';
                return;
            }
            
            
            try {
                let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
                const supplierInput = popup.querySelector(`.new-component-supplier[data-component-index="${input.dataset.componentIndex}"]`);
                const supplierHint = supplierInput ? String(supplierInput.value || '').trim() : '';
                if (supplierHint && supplierHint !== 'N/D' && supplierHint !== 'FORNITORE') {
                    url += `&supplier=${encodeURIComponent(supplierHint)}`;
                }
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.success && data.component) {
                    const nomeProdotto = data.component.nome || 'Nome non disponibile';
                    const fornitore = data.component.fornitore || 'N/D';
                    const categoria = data.component.categoria || 'N/D';
                    const quantita = data.component.quantita_disponibile !== undefined ? data.component.quantita_disponibile : 'N/D';
                    
                    input.title = `${componentType}: ${nomeProdotto}\nEAN: ${ean}\nCategoria: ${categoria}\nDisponibilità: ${quantita}`;
                    input.dataset.tooltipLoaded = 'true';
                } else {
                    input.title = `${componentType}: ${ean}\n(Prodotto non trovato in database)`;
                }
            } catch (error) {
                console.error(`Errore caricamento tooltip per EAN ${ean}:`, error);
                input.title = `${componentType}: ${ean}`;
            }
        });
        
        input.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            const componentType = input.dataset.componentType;
            const componentIndex = input.dataset.componentIndex;
            
            
            input.dataset.tooltipLoaded = 'false';
            input.title = '';
            
            if (newConfigSearchDebounceTimer) {
                clearTimeout(newConfigSearchDebounceTimer);
            }
            
            const suggestionsDiv = popup.querySelector(`.new-config-suggestions[data-component-type="${componentType}"][data-component-index="${componentIndex}"]`);
            
            if (query.length < 2) {
                if (suggestionsDiv) suggestionsDiv.style.display = 'none';
                return;
            }
            
            newConfigSearchDebounceTimer = setTimeout(() => {
                searchNewConfigComponents(query, componentType, componentIndex, suggestionsDiv);
            }, 300);
        });
    });
    
    
    document.getElementById('confirm-add-config')?.addEventListener('click', () => {
        const name = document.getElementById('new-config-name').value.trim();
        const fullName = document.getElementById('new-config-fullname').value.trim();
        
        if (!name) {
            showNotification('⚠️ Inserisci un nome per la configurazione');
            return;
        }
        
        
        const components = [];
        const eanInputs = popup.querySelectorAll('.new-component-ean');
        const supplierInputs = popup.querySelectorAll('.new-component-supplier');
        defaultComponents.forEach((comp, index) => {
            const eanInput = eanInputs[index];
            const supplierInput = supplierInputs[index];
            const ean = eanInput ? eanInput.value.trim() : '';
            const supplier = supplierInput ? supplierInput.value.trim() : '';
            if (ean) {
                components.push({
                    type: comp.type,
                    value: ean,
                    supplier: supplier || ''
                });
            }
        });
        
        if (components.length === 0) {
            showNotification('⚠️ Inserisci almeno un EAN componente');
            return;
        }
        
        createNewConfiguration(name, fullName, components);
        closePopup();
    });
    
    
    document.getElementById('cancel-add-config')?.addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);
    
    
    const confirmBtn = document.getElementById('confirm-add-config');
    const cancelBtn = document.getElementById('cancel-add-config');
    
    if (confirmBtn) {
        confirmBtn.addEventListener('mouseenter', () => confirmBtn.style.transform = 'scale(1.02)');
        confirmBtn.addEventListener('mouseleave', () => confirmBtn.style.transform = 'scale(1)');
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.transform = 'scale(1.02)');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.transform = 'scale(1)');
    }
}

async function createNewConfiguration(name, fullName, components) {
    
    const configData = {
        fullName: fullName || name,
        components: components
    };
    
    const success = await saveConfigToDatabase(name, configData);
    
    if (success) {
        
        await loadPCConfigs();
        renderStandardConfigsCards();
        showNotification(`✅ Configurazione "${name}" creata con successo`);
    } else {
        showNotification('❌ Errore durante la creazione');
    }
}





let inventoryData = [];


const INVENTORY_API_URL = 'api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php';


async function loadInventory() {
    try {
        const response = await fetch(INVENTORY_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.inventory) {
                inventoryData = data.inventory;
            }
        }
    } catch (error) {
        console.error('❌ Errore caricamento inventario:', error);
        inventoryData = [];
    }
}


async function saveInventoryItem(ean, name, quantity) {
    try {
        const response = await fetch(INVENTORY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ean, name, quantity })
        });
        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('❌ Errore salvataggio inventario:', error);
        return false;
    }
}


async function updateInventoryQuantity(ean, delta) {
    try {
        const response = await fetch(INVENTORY_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ean, delta })
        });
        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('❌ Errore aggiornamento quantità:', error);
        return false;
    }
}


async function deleteInventoryItem(ean) {
    try {
        const response = await fetch(`${INVENTORY_API_URL}?ean=${encodeURIComponent(ean)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('❌ Errore eliminazione inventario:', error);
        return false;
    }
}


async function loadComponentsForSelect() {
    try {
        const response = await fetch('api_gateway/db_bridge/components_service/endpoint/api-components.php');
        if (!response.ok) throw new Error('Errore caricamento componenti');
        
        const data = await response.json();
        return data.components || [];
    } catch (error) {
        console.error('Errore:', error);
        return [];
    }
}


function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    
    const addRow = document.createElement('tr');
    addRow.className = 'inventory-add-row';
    addRow.innerHTML = `
        <td>
            <div style="position: relative;">
                <input type="text" 
                    id="inventory-search-ean" 
                    class="inventory-search-input" 
                    placeholder="EAN..." 
                    autocomplete="off">
                <div id="inventory-ean-results" class="inventory-search-results" style="display: none;"></div>
            </div>
        </td>
        <td>
            <div style="position: relative;">
                <input type="text" 
                    id="inventory-search-input" 
                    class="inventory-search-input" 
                    placeholder="Cerca per nome..." 
                    autocomplete="off">
                <div id="inventory-search-results" class="inventory-search-results" style="display: none;"></div>
            </div>
        </td>
        <td>
            <div class="inventory-quantity-controls">
                <button class="inventory-qty-btn" id="new-item-decrease" disabled>-</button>
                <input type="number" id="new-item-quantity" class="inventory-qty-input" value="1" min="1">
                <button class="inventory-qty-btn" id="new-item-increase">+</button>
            </div>
        </td>
        <td>
            <button class="inventory-action-btn" id="confirm-add-item" disabled style="padding: 8px 16px; width: auto;">✓ Aggiungi</button>
        </td>
    `;
    tbody.appendChild(addRow);
    
    
    inventoryData.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.ean || '-'}</td>
            <td>${item.name || '-'}</td>
            <td>
                <div class="inventory-quantity-controls">
                    <button class="inventory-qty-btn inventory-decrease" data-index="${index}">-</button>
                    <span class="inventory-qty-display">${item.quantity || 0}</span>
                    <button class="inventory-qty-btn inventory-increase" data-index="${index}">+</button>
                </div>
            </td>
            <td>
                <button class="inventory-delete-btn" data-index="${index}">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    
    setupInventorySearch();
    
    
    document.getElementById('new-item-decrease')?.addEventListener('click', () => {
        const input = document.getElementById('new-item-quantity');
        const currentValue = parseInt(input.value) || 1;
        if (currentValue > 1) {
            input.value = currentValue - 1;
        }
    });
    
    document.getElementById('new-item-increase')?.addEventListener('click', () => {
        const input = document.getElementById('new-item-quantity');
        const currentValue = parseInt(input.value) || 1;
        input.value = currentValue + 1;
    });
    
    
    document.querySelectorAll('.inventory-increase').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const index = parseInt(e.target.dataset.index);
            const item = inventoryData[index];
            const success = await updateInventoryQuantity(item.ean, 1);
            if (success) {
                inventoryData[index].quantity = (inventoryData[index].quantity || 0) + 1;
                renderInventoryTable();
            }
        });
    });
    
    document.querySelectorAll('.inventory-decrease').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const index = parseInt(e.target.dataset.index);
            const item = inventoryData[index];
            if (item.quantity > 0) {
                const success = await updateInventoryQuantity(item.ean, -1);
                if (success) {
                    inventoryData[index].quantity -= 1;
                    renderInventoryTable();
                }
            }
        });
    });
    
    
    document.querySelectorAll('.inventory-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const index = parseInt(e.target.dataset.index);
            const item = inventoryData[index];
            if (confirm('Sei sicuro di voler eliminare questo componente dall\'inventario?')) {
                const success = await deleteInventoryItem(item.ean);
                if (success) {
                    inventoryData.splice(index, 1);
                    renderInventoryTable();
                    showNotification('🗑️ Componente rimosso dall\'inventario');
                }
            }
        });
    });
}


let selectedComponent = null;

async function setupInventorySearch() {
    const searchInput = document.getElementById('inventory-search-input');
    const eanInput = document.getElementById('inventory-search-ean');
    const searchResultsDiv = document.getElementById('inventory-search-results');
    const eanResultsDiv = document.getElementById('inventory-ean-results');
    const confirmBtn = document.getElementById('confirm-add-item');
    const decreaseBtn = document.getElementById('new-item-decrease');
    
    if (!searchInput || !eanInput) return;
    
    let searchTimeout;
    
    
    async function performSearch(query, isEAN = false) {
        const resultsDiv = isEAN ? eanResultsDiv : searchResultsDiv;
        const otherResultsDiv = isEAN ? searchResultsDiv : eanResultsDiv;
        
        if (query.length < 2) {
            resultsDiv.style.display = 'none';
            selectedComponent = null;
            confirmBtn.disabled = true;
            decreaseBtn.disabled = true;
            if (isEAN) {
                searchInput.value = '';
            } else {
                eanInput.value = '';
            }
            return;
        }
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            try {
                let components = [];
                let url;
                
                if (isEAN) {
                    
                    url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(query)}`;
                    const response = await fetch(url);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.success && data.component) {
                            components = [data.component];
                        }
                    }
                } else {
                    
                    url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}`;
                    const response = await fetch(url);
                    if (response.ok) {
                        const data = await response.json();
                        components = data.components || [];
                    }
                }
                
                if (components.length === 0) {
                    resultsDiv.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun risultato</p>';
                    resultsDiv.style.display = 'block';
                    return;
                }
                
                
                
                const sortedByPrice = [...components].sort((a, b) => parseFloat(a.prezzo || 0) - parseFloat(b.prezzo || 0));
                
                
                let html = sortedByPrice.map(c => `
                    <div class="component-search-result" data-ean="${c.ean}" data-name="${c.name || c.nome || ''}" style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">
                        <div style="color: white; font-weight: 600; font-size: 0.95em; margin-bottom: 4px;">${c.name || c.nome || 'N/A'}</div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: rgba(255,255,255,0.6); font-size: 0.85em;">EAN: ${c.ean}</span>
                            <span style="color: #2ecc71; font-weight: 600; font-size: 0.9em;">€${parseFloat(c.prezzo || 0).toFixed(2)}</span>
                        </div>
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.8em; margin-top: 4px;">Qtà: ${c.quantita || 0} | ${c.supplier || c.fornitore || 'N/D'}</div>
                    </div>
                `).join('');
                
                resultsDiv.innerHTML = html;
                resultsDiv.style.display = 'block';
                otherResultsDiv.style.display = 'none'; 
                
                
                resultsDiv.querySelectorAll('.component-search-result').forEach(el => {
                    el.addEventListener('mouseenter', () => {
                        el.style.background = 'rgba(255,255,255,0.2)';
                    });
                    el.addEventListener('mouseleave', () => {
                        el.style.background = 'rgba(255,255,255,0.1)';
                    });
                    
                    
                    el.addEventListener('click', () => {
                        const ean = el.dataset.ean;
                        const name = el.dataset.name;
                        
                        if (ean) {
                            selectedComponent = { ean, name };
                            eanInput.value = ean;
                            searchInput.value = name;
                            resultsDiv.style.display = 'none';
                            otherResultsDiv.style.display = 'none';
                            confirmBtn.disabled = false;
                            decreaseBtn.disabled = false;
                        }
                    });
                });
                
            } catch (error) {
                console.error('Errore ricerca:', error);
                resultsDiv.innerHTML = '<div class="inventory-search-item" style="color: rgba(231, 76, 60, 0.8);">Errore durante la ricerca</div>';
                resultsDiv.style.display = 'block';
            }
        }, 300);
    }
    
    
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        performSearch(query, false);
        
        if (query.length > 0 || eanInput.value.trim().length > 0) {
            confirmBtn.disabled = false;
            decreaseBtn.disabled = false;
        }
    });
    
    
    eanInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        performSearch(query, true);
        
        if (query.length > 0 || searchInput.value.trim().length > 0) {
            confirmBtn.disabled = false;
            decreaseBtn.disabled = false;
        }
    });
    
    
    confirmBtn?.addEventListener('click', async () => {
        const quantity = parseInt(document.getElementById('new-item-quantity').value) || 1;
        const eanValue = eanInput.value.trim();
        const nameValue = searchInput.value.trim();
        
        
        if (!selectedComponent) {
            if (!eanValue && !nameValue) {
                showNotification('⚠️ Inserisci almeno EAN o Nome del componente', 'error');
                return;
            }
            
            
            selectedComponent = {
                ean: eanValue || `MANUAL_${Date.now()}`, 
                name: nameValue || 'Componente Manuale'
            };
        }
        
        const existingIndex = inventoryData.findIndex(item => item.ean === selectedComponent.ean);
        
        let newQuantity = quantity;
        if (existingIndex >= 0) {
            newQuantity = inventoryData[existingIndex].quantity + quantity;
        }
        
        const success = await saveInventoryItem(selectedComponent.ean, selectedComponent.name, newQuantity);
        
        if (success) {
            if (existingIndex >= 0) {
                inventoryData[existingIndex].quantity = newQuantity;
                showNotification('📦 Quantità aggiornata in inventario');
            } else {
                inventoryData.push({
                    ean: selectedComponent.ean,
                    name: selectedComponent.name,
                    quantity: quantity
                });
                showNotification('✅ Componente aggiunto all\'inventario');
            }
        }
        
        selectedComponent = null;
        searchInput.value = '';
        if (eanInput) eanInput.value = '';
        document.getElementById('new-item-quantity').value = '1';
        confirmBtn.disabled = true;
        decreaseBtn.disabled = true;
        renderInventoryTable();
    });
    
    
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.style.display = 'none';
        }
    });
}


let longPressTimer = null;
let longPressTarget = null;
let progressInterval = null;
let initialDelayTimer = null;


function cancelLongPress() {
    if (initialDelayTimer) {
        clearTimeout(initialDelayTimer);
        initialDelayTimer = null;
    }
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    
    if (longPressTarget) {
        longPressTarget.style.background = '';
        longPressTarget = null;
    }
}

document.addEventListener('mousedown', (e) => {
    const componentRow = e.target.closest('.component-row');
    if (!componentRow) return;
    
    
    
    const clickedElement = e.target;
    const isInteractive = clickedElement.closest('.component-name') || 
                          clickedElement.closest('.component-ean') ||
                          clickedElement.closest('[data-ean]') ||
                          clickedElement.tagName === 'SPAN' ||
                          clickedElement.style.cursor === 'pointer' ||
                          window.getComputedStyle(clickedElement).cursor === 'pointer';
    
    if (isInteractive) {
        return; 
    }
    
    longPressTarget = componentRow;
    const orderId = componentRow.dataset.orderId;
    const componentType = componentRow.dataset.componentType;
    
    
    componentRow.style.background = 'rgba(231, 76, 60, 0.05)';
    componentRow.style.transition = 'background 0.3s';
    
    initialDelayTimer = setTimeout(() => {
        
        let progress = 0;
        const duration = 8000; 
        const stepInterval = 50; 
        const totalSteps = duration / stepInterval;
        
        componentRow.style.background = 'rgba(231, 76, 60, 0.1)';
        
        progressInterval = setInterval(() => {
            progress += (100 / totalSteps);
            if (progress <= 100) {
                componentRow.style.background = `linear-gradient(90deg, rgba(231, 76, 60, 0.3) ${progress}%, rgba(231, 76, 60, 0.1) ${progress}%)`;
            }
        }, stepInterval);
        
        longPressTimer = setTimeout(() => {
            clearInterval(progressInterval);
            
            
            const confirmed = confirm(`Vuoi eliminare il componente "${componentType}" da questo ordine?\n\nQuesta azione verrà salvata e il componente non verrà più mostrato.`);
            
            if (confirmed) {
                
                saveDeletedComponent(orderId, componentType);
                
                
                componentRow.style.transition = 'all 0.5s ease';
                componentRow.style.opacity = '0';
                componentRow.style.transform = 'translateX(-20px)';
                
                setTimeout(() => {
                    componentRow.remove();
                }, 500);
            } else {
                
                componentRow.style.background = '';
            }
            
            longPressTarget = null;
        }, duration);
    }, 2000); 
});

document.addEventListener('mouseup', (e) => {
    cancelLongPress();
});

document.addEventListener('mouseleave', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('component-row')) {
        cancelLongPress();
    }
});





let currentManualSearchInput = null;
let manualSearchTimeout = null;


function updateAddManualOrderButtonVisibility() {
    const btn = document.getElementById('add-manual-order-btn');
    const activeTab = document.querySelector('.tab-button.active');
    const currentTab = activeTab ? activeTab.dataset.tab : 'orders';
    
    if (btn) {
        btn.style.display = isProcessedTab(currentTab) ? 'flex' : 'none';
    }
}


document.getElementById('add-manual-order-btn')?.addEventListener('click', () => {
    const popup = document.getElementById('add-manual-order-popup');
    const overlay = document.getElementById('add-manual-order-overlay');
    
    if (popup && overlay) {
        popup.style.display = 'flex';
        overlay.style.display = 'block';
        
        
        document.getElementById('manual-order-id').value = '';
        document.querySelectorAll('.manual-component-search').forEach(input => {
            input.value = '';
            input.style.borderColor = 'rgba(255,255,255,0.2)';
            input.style.background = 'rgba(0,0,0,0.3)';
            
            const componentType = input.id.replace('manual-', '');
            const eanInput = document.getElementById(`manual-${componentType}-ean`);
            const supplierInput = document.getElementById(`manual-${componentType}-supplier-value`);
            const supplierBadge = document.getElementById(`manual-${componentType}-supplier`);
            
            if (eanInput) eanInput.value = '';
            if (supplierInput) supplierInput.value = '';
            if (supplierBadge) {
                supplierBadge.style.display = 'none';
                supplierBadge.textContent = '';
            }
        });
        document.getElementById('manual-custom-items-container').innerHTML = '';
        document.getElementById('manual-order-email').value = '';
        document.getElementById('manual-order-phone').value = '';
    }
});


document.getElementById('close-manual-order-popup')?.addEventListener('click', closeManualOrderPopup);
document.getElementById('cancel-manual-order')?.addEventListener('click', closeManualOrderPopup);
document.getElementById('add-manual-order-overlay')?.addEventListener('click', closeManualOrderPopup);

function closeManualOrderPopup() {
    const popup = document.getElementById('add-manual-order-popup');
    const overlay = document.getElementById('add-manual-order-overlay');
    const results = document.getElementById('manual-search-results');
    
    if (popup) popup.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    if (results) results.style.display = 'none';
}


document.getElementById('add-manual-custom-item')?.addEventListener('click', () => {
    const container = document.getElementById('manual-custom-items-container');
    const itemDiv = document.createElement('div');
    itemDiv.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    itemDiv.innerHTML = `
        <input type="text" placeholder="Nome voce" class="manual-custom-name" style="flex: 1; padding: 8px 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; font-size: 0.85em;">
        <input type="text" placeholder="EAN/Valore" class="manual-custom-value" style="flex: 1; padding: 8px 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; font-size: 0.85em;">
        <button class="remove-manual-custom" style="padding: 6px 10px; background: rgba(231, 76, 60, 0.3); border: none; color: #e74c3c; border-radius: 6px; cursor: pointer;">✕</button>
    `;
    container.appendChild(itemDiv);
    
    itemDiv.querySelector('.remove-manual-custom').addEventListener('click', () => {
        itemDiv.remove();
    });
});


document.querySelectorAll('.manual-component-search').forEach(input => {
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        currentManualSearchInput = e.target;
        
        if (manualSearchTimeout) clearTimeout(manualSearchTimeout);
        
        if (query.length < 2) {
            document.getElementById('manual-search-results').style.display = 'none';
            return;
        }
        
        manualSearchTimeout = setTimeout(() => {
            searchManualComponent(query, e.target);
        }, 300);
    });
    
    input.addEventListener('focus', (e) => {
        currentManualSearchInput = e.target;
    });
});

async function searchManualComponent(query, inputElement) {
    const resultsDiv = document.getElementById('manual-search-results');
    const componentType = inputElement.dataset.component.toLowerCase();
    
    
    const componentTypeMapping = {
        'cpu': 'CPU',
        'gpu': 'GPU',
        'ram': 'RAM',
        'ssd': ['SSD'],
        'mobo': ['Scheda_Madre'],
        'psu': ['Alimentatore'],
        'case': ['Case_PC'],
        'cooler': ['Dissipatore'],
        'monitor': 'MONITOR'
    };
    
    const validCategories = componentTypeMapping[componentType];
    const categoryArray = Array.isArray(validCategories) ? validCategories : [validCategories];
    
    try {
        
        const [standardResponse, amazonResponse] = await Promise.all([
            fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}&limit=10`),
            fetch(`api_gateway/db_bridge/components_service/endpoint/api-custom-components.php`)
        ]);
        
        const standardData = await standardResponse.json();
        const amazonData = await amazonResponse.json();
        
        
        let amazonComponents = [];
        if (amazonData.success && amazonData.components) {
            const queryLower = query.toLowerCase();
            amazonComponents = amazonData.components.filter(comp => {
                const matchesQuery = comp.nome.toLowerCase().includes(queryLower) || 
                    (comp.ean && comp.ean.toLowerCase().includes(queryLower));
                const matchesType = categoryArray.some(cat => 
                    comp.categoria && comp.categoria.toLowerCase().includes(cat.toLowerCase())
                );
                return matchesQuery && matchesType;
            }).slice(0, 5); 
        }
        
        
        const inputRect = inputElement.getBoundingClientRect();
        const popupRect = document.getElementById('add-manual-order-popup').getBoundingClientRect();
        
        resultsDiv.style.top = (inputRect.bottom - popupRect.top + 5) + 'px';
        resultsDiv.style.left = (inputRect.left - popupRect.left) + 'px';
        resultsDiv.style.width = inputRect.width + 'px';
        
        let resultsHtml = '';
        
        
        if (amazonComponents.length > 0) {
            resultsHtml += `<div style="padding: 6px 12px; background: rgba(243, 156, 18, 0.15); border-bottom: 1px solid rgba(243, 156, 18, 0.3);"><span style="color: #f39c12; font-size: 0.75em; font-weight: 600;">📦 AMAZON PERSONALIZZATI</span></div>`;
            
            amazonComponents.forEach(comp => {
                resultsHtml += `
                <div class="manual-search-result" data-ean="${comp.ean}" data-name="${comp.nome}" data-supplier="AMAZON" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background 0.2s; background: rgba(243, 156, 18, 0.05);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="color: white; font-weight: 500; font-size: 0.9em; flex: 1;">${comp.nome}</div>
                        <span style="background: rgba(243, 156, 18, 0.2); color: #f39c12; padding: 2px 6px; border-radius: 4px; font-size: 0.7em; font-weight: 600;">AMAZON</span>
                    </div>
                    <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">EAN: ${comp.ean} | ${comp.categoria}</div>
                </div>`;
            });
        }
        
        
        if (standardData.success && standardData.components && standardData.components.length > 0) {
            
            const filteredComponents = standardData.components.filter(comp => {
                return categoryArray.some(cat => 
                    (comp.categoria && comp.categoria.toLowerCase().includes(cat.toLowerCase())) ||
                    (comp.nome && comp.nome.toLowerCase().includes(cat.toLowerCase()))
                );
            });
            
            if (filteredComponents.length > 0) {
                if (amazonComponents.length > 0) {
                    resultsHtml += `<div style="padding: 6px 12px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1);"><span style="color: rgba(255,255,255,0.6); font-size: 0.75em; font-weight: 600;">🗄️ DATABASE STANDARD</span></div>`;
                }
                
                resultsHtml += filteredComponents.map(comp => {
                    const prezzo = comp.prezzo ? parseFloat(comp.prezzo).toFixed(2) + '€' : 'N/A';
                    const quantita = comp.quantita !== undefined ? parseInt(comp.quantita) : 0;
                    
                    
                    const consigliatoBadge = quantita >= 5 ? `<span style="background: rgba(46, 204, 113, 0.2); color: #2ecc71; font-size: 0.65em; padding: 2px 5px; border-radius: 3px; margin-left: 6px; font-weight: 600;">⭐ CONSIGLIATO</span>` : '';
                    
                    return `
                <div class="manual-search-result" data-ean="${comp.ean}" data-name="${comp.nome}" data-supplier="${comp.fornitore || ''}" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background 0.2s;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="color: white; font-weight: 500; font-size: 0.9em; flex: 1;">${comp.nome}${consigliatoBadge}</div>
                        <span style="color: #3498db; font-weight: 600; font-size: 0.85em;">${prezzo}</span>
                    </div>
                    <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">EAN: ${comp.ean} ${comp.fornitore ? '| ' + comp.fornitore : ''} | Qtà: ${quantita}</div>
                </div>
            `}).join('');
            }
        }
        
        
        if (amazonComponents.length === 0 && (!standardData.success || !standardData.components || 
            standardData.components.filter(comp => categoryArray.some(cat => 
                (comp.categoria && comp.categoria.toLowerCase().includes(cat.toLowerCase())) ||
                (comp.nome && comp.nome.toLowerCase().includes(cat.toLowerCase()))
            )).length === 0)) {
            resultsHtml += `
                <div style="padding: 16px 12px; text-align: center;">
                    <div style="color: rgba(255,255,255,0.5); font-size: 0.9em; margin-bottom: 8px;">🔍 Nessun componente trovato</div>
                    <div style="color: rgba(255,255,255,0.4); font-size: 0.75em;">Prova con un termine di ricerca diverso o inserisci manualmente</div>
                </div>
            `;
        }
        
        
        resultsHtml += `
            <div class="manual-entry-option" style="padding: 12px; background: rgba(241, 196, 15, 0.1); border-top: 1px solid rgba(241, 196, 15, 0.3); cursor: pointer;">
                <div style="color: #f1c40f; font-weight: 600; font-size: 0.85em;">⚠️ Non trovi il componente? Inseriscilo manualmente</div>
                <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">Clicca qui per inserire EAN e scegliere il fornitore</div>
            </div>
        `;
        
        resultsDiv.innerHTML = resultsHtml;
        resultsDiv.style.display = 'block';
        
        
        resultsDiv.querySelectorAll('.manual-search-result').forEach(result => {
            result.addEventListener('click', () => {
                selectManualComponent(inputElement, result.dataset.name, result.dataset.ean, result.dataset.supplier);
                resultsDiv.style.display = 'none';
            });
            
            result.addEventListener('mouseenter', () => {
                result.style.background = 'rgba(255,255,255,0.1)';
            });
            result.addEventListener('mouseleave', () => {
                result.style.background = 'transparent';
            });
        });
        
        
        resultsDiv.querySelector('.manual-entry-option')?.addEventListener('click', () => {
            resultsDiv.style.display = 'none';
            showManualEntryPopup(inputElement, query);
        });
        
    } catch (error) {
        console.error('Errore ricerca componenti:', error);
        resultsDiv.style.display = 'none';
    }
}


function selectManualComponent(inputElement, name, ean, supplier) {
    const componentType = inputElement.id.replace('manual-', '');
    
    inputElement.value = name;
    
    const eanInput = document.getElementById(`manual-${componentType}-ean`);
    if (eanInput) eanInput.value = ean;
    
    const supplierInput = document.getElementById(`manual-${componentType}-supplier-value`);
    if (supplierInput) supplierInput.value = supplier;
    
    
    const supplierBadge = document.getElementById(`manual-${componentType}-supplier`);
    if (supplierBadge && supplier) {
        supplierBadge.textContent = supplier;
        supplierBadge.style.display = 'inline-block';
        
        
        const supplierColors = {
            'PROKS': { bg: 'rgba(231, 76, 60, 0.3)', color: '#e74c3c' },
            'OMEGA': { bg: 'rgba(155, 89, 182, 0.3)', color: '#9b59b6' },
            'TIER ONE': { bg: 'rgba(52, 152, 219, 0.3)', color: '#3498db' },
            'AMAZON': { bg: 'rgba(243, 156, 18, 0.3)', color: '#f39c12' },
            'NOUA': { bg: 'rgba(46, 204, 113, 0.3)', color: '#2ecc71' },
            'ECOM': { bg: 'rgba(52, 152, 219, 0.3)', color: '#3498db' },
            'MSI': { bg: 'rgba(211, 84, 0, 0.3)', color: '#d35400' },
            'CASEKING': { bg: 'rgba(230, 126, 34, 0.3)', color: '#e67e22' },
            'NAVY BLUE': { bg: 'rgba(26, 86, 219, 0.3)', color: '#1a56db' }
        };
        
        const colors = supplierColors[supplier.toUpperCase()] || { bg: 'rgba(127, 140, 141, 0.3)', color: '#7f8c8d' };
        supplierBadge.style.background = colors.bg;
        supplierBadge.style.color = colors.color;
    }
    
    
    inputElement.style.borderColor = 'rgba(46, 204, 113, 0.5)';
    inputElement.style.background = 'rgba(46, 204, 113, 0.1)';
}


function showManualEntryPopup(inputElement, currentQuery) {
    const componentType = inputElement.dataset.component;
    
    
    const popup = document.createElement('div');
    popup.id = 'manual-entry-inline-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1010; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 12px; padding: 20px; border: 1px solid rgba(241, 196, 15, 0.4); width: 350px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);';
    
    popup.innerHTML = `
        <h4 style="margin: 0 0 16px 0; color: #f1c40f; font-size: 1em;">⚠️ Inserimento Manuale ${componentType}</h4>
        
        <div style="margin-bottom: 12px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 4px;">Nome Componente</label>
            <input type="text" id="manual-entry-name" value="${currentQuery}" style="width: 100%; box-sizing: border-box; padding: 10px 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: white; font-size: 0.9em;">
        </div>
        
        <div style="margin-bottom: 12px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 4px;">EAN (opzionale)</label>
            <input type="text" id="manual-entry-ean" value="${currentQuery}" placeholder="Es: 1234567890123" style="width: 100%; box-sizing: border-box; padding: 10px 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: white; font-size: 0.9em;">
        </div>
        
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 8px;">Fornitore *</label>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                <button class="manual-supplier-btn" data-supplier="PROKS" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.4);">PROKS</button>
                <button class="manual-supplier-btn" data-supplier="OMEGA" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(155, 89, 182, 0.2); color: #9b59b6; border: 1px solid rgba(155, 89, 182, 0.4);">OMEGA</button>
                <button class="manual-supplier-btn" data-supplier="TIER ONE" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(52, 152, 219, 0.2); color: #3498db; border: 1px solid rgba(52, 152, 219, 0.4);">TIER ONE</button>
                <button class="manual-supplier-btn" data-supplier="AMAZON" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(243, 156, 18, 0.2); color: #f39c12; border: 1px solid rgba(243, 156, 18, 0.4);">AMAZON</button>
                <button class="manual-supplier-btn" data-supplier="NOUA" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(46, 204, 113, 0.2); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4);">NOUA</button>
                <button class="manual-supplier-btn" data-supplier="CASEKING" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(230, 126, 34, 0.2); color: #e67e22; border: 1px solid rgba(230, 126, 34, 0.4);">CASEKING</button>
                <button class="manual-supplier-btn" data-supplier="NAVY BLUE" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(26, 86, 219, 0.2); color: #1a56db; border: 1px solid rgba(26, 86, 219, 0.4);">NAVY BLUE</button>
                <button class="manual-supplier-btn" data-supplier="ALTRO" style="flex: 1 1 45%; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.8em; background: rgba(127, 140, 141, 0.2); color: #7f8c8d; border: 1px solid rgba(127, 140, 141, 0.4);">ALTRO</button>
            </div>
        </div>
        
        <div style="display: flex; gap: 8px;">
            <button id="manual-entry-cancel" style="flex: 1; padding: 10px; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; cursor: pointer; font-weight: 600;">Annulla</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    
    popup.querySelectorAll('.manual-supplier-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = popup.querySelector('#manual-entry-name').value.trim();
            const ean = popup.querySelector('#manual-entry-ean').value.trim();
            const supplier = btn.dataset.supplier;
            
            if (!name) {
                showNotification('Inserisci il nome del componente', 'error');
                return;
            }
            
            selectManualComponent(inputElement, name, ean || 'MANUALE', supplier);
            popup.remove();
        });
    });
    
    popup.querySelector('#manual-entry-cancel').addEventListener('click', () => {
        popup.remove();
    });
}


document.addEventListener('click', (e) => {
    const resultsDiv = document.getElementById('manual-search-results');
    if (resultsDiv && !resultsDiv.contains(e.target) && !e.target.classList.contains('manual-component-search')) {
        resultsDiv.style.display = 'none';
    }
});


document.getElementById('save-manual-order')?.addEventListener('click', async () => {
    const orderId = document.getElementById('manual-order-id').value.trim();
    
    if (!orderId) {
        showNotification('Inserisci un ID/Nome ordine', 'error');
        return;
    }
    
    
    const components = [];
    const componentTypes = ['cpu', 'mobo', 'ram', 'gpu', 'ssd', 'psu', 'case', 'cooler'];
    const componentLabels = {
        'cpu': 'CPU',
        'mobo': 'Scheda Madre',
        'ram': 'RAM',
        'gpu': 'GPU',
        'ssd': 'SSD',
        'psu': 'Alimentatore',
        'case': 'Case',
        'cooler': 'Dissipatore'
    };
    
    let missingComponents = [];
    
    for (const type of componentTypes) {
        const nameInput = document.getElementById(`manual-${type}`);
        const eanInput = document.getElementById(`manual-${type}-ean`);
        const supplierInput = document.getElementById(`manual-${type}-supplier-value`);
        
        if (!nameInput || !nameInput.value.trim()) {
            missingComponents.push(componentLabels[type]);
        } else {
            components.push({
                type: type.toUpperCase(),
                name: nameInput.value.trim(),
                ean: eanInput ? eanInput.value.trim() : '',
                supplier: supplierInput ? supplierInput.value.trim() : ''
            });
        }
    }
    
    if (missingComponents.length > 0) {
        showNotification(`Compila tutti i componenti: ${missingComponents.join(', ')}`, 'error');
        return;
    }
    
    
    const customItems = [];
    document.querySelectorAll('#manual-custom-items-container > div').forEach(item => {
        const name = item.querySelector('.manual-custom-name')?.value.trim();
        const value = item.querySelector('.manual-custom-value')?.value.trim();
        if (name) {
            customItems.push({ name, value: value || '' });
        }
    });
    
    const email = document.getElementById('manual-order-email').value.trim();
    const phone = document.getElementById('manual-order-phone').value.trim();
    
    
    const manualOrderId = 'MANUAL_' + Date.now();
    
    
    const caseColor = document.getElementById('manual-case-color')?.value;
    const coolerColor = document.getElementById('manual-cooler-color')?.value;
    
    if (caseColor) {
        localStorage.setItem(`component-color-${manualOrderId}-CASE`, caseColor);
    }
    if (coolerColor) {
        localStorage.setItem(`component-color-${manualOrderId}-COOLER`, coolerColor);
    }
    
    
    let countA = 0;
    let countB = 0;
    
    Object.values(processedOrdersCache).forEach(order => {
        if (order.operator === 'OperatoreA') countA++;
        else if (order.operator === 'OperatoreB') countB++;
    });
    
    const assignedOperator = countA <= countB ? 'OperatoreA' : 'OperatoreB';
    
    
    const orderData = {
        shopifyOrderId: manualOrderId,
        orderIdFlip: orderId,
        operator: assignedOperator,
        configName: 'MANUALE',
        customerEmail: email || null,
        customerPhone: phone || null,
        foglioDiLavoro: getActiveWorksheetTab(),
        components: components
    };
    
    try {
        
        const success = await saveProcessedOrderToDB(manualOrderId, orderData);
        
        if (success) {
            
            await saveOperatorAssignmentToDB(manualOrderId, assignedOperator);
            
            
            for (const item of customItems) {
                await saveCustomItemToDB(manualOrderId, item.name, item.value);
            }
            
            showNotification(`✅ Ordine manuale aggiunto e assegnato a ${assignedOperator}!`);
            closeManualOrderPopup();
            
            
            loadOrdersFromShopify();
        } else {
            showNotification('Errore nel salvataggio', 'error');
        }
    } catch (error) {
        console.error('Errore salvataggio ordine manuale:', error);
        showNotification('Errore nel salvataggio', 'error');
    }
});


document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
        setTimeout(updateAddManualOrderButtonVisibility, 100);
    });
});






function openAddCustomItemPopup() {
    const popup = document.getElementById('add-custom-item-popup');
    const overlay = document.getElementById('add-custom-item-overlay');
    
    
    if (currentSearchContext?.componentType) {
        document.getElementById('custom-item-category').value = currentSearchContext.componentType;
    }
    
    
    document.getElementById('custom-item-name').value = '';
    document.getElementById('custom-item-ean').value = '';
    document.getElementById('custom-item-supplier').value = '';
    document.getElementById('custom-item-price').value = '';
    
    popup.style.display = 'flex';
    overlay.style.display = 'block';
    
    
    setTimeout(() => {
        document.getElementById('custom-item-name').focus();
    }, 100);
}

function closeAddCustomItemPopup() {
    document.getElementById('add-custom-item-popup').style.display = 'none';
    document.getElementById('add-custom-item-overlay').style.display = 'none';
}


document.getElementById('save-custom-item')?.addEventListener('click', async () => {
    const name = document.getElementById('custom-item-name').value.trim();
    const ean = document.getElementById('custom-item-ean').value.trim();
    const category = document.getElementById('custom-item-category').value.trim();
    const supplier = document.getElementById('custom-item-supplier').value.trim();
    const price = parseFloat(document.getElementById('custom-item-price').value) || 0;
    
    
    if (!name) {
        alert('❌ Nome prodotto obbligatorio');
        document.getElementById('custom-item-name').focus();
        return;
    }
    
    if (!ean) {
        alert('❌ EAN / Codice obbligatorio');
        document.getElementById('custom-item-ean').focus();
        return;
    }
    
    if (!category) {
        alert('❌ Categoria obbligatoria');
        document.getElementById('custom-item-category').focus();
        return;
    }
    
    if (!supplier) {
        alert('❌ Fornitore obbligatorio');
        document.getElementById('custom-item-supplier').focus();
        return;
    }
    
    if (!price || price <= 0) {
        alert('❌ Prezzo obbligatorio e deve essere maggiore di 0');
        document.getElementById('custom-item-price').focus();
        return;
    }
    
    try {
        const response = await fetch('api_gateway/db_bridge/components_service/endpoint/api-custom-items.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nome: name,
                ean: ean,
                categoria: category,
                fornitore: supplier,
                prezzo: price
            })
        });
        
        if (!response.ok) {
            throw new Error('Errore nella risposta del server');
        }
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('✅ Articolo aggiunto con successo!');
            closeAddCustomItemPopup();
            
            
            if (currentSearchContext) {
                const { orderId, componentType } = currentSearchContext;
                const eanInput = document.querySelector(`input[data-order-id="${orderId}"][data-component-type="${componentType}"]`);
                
                if (eanInput) {
                    eanInput.value = ean;
                    eanInput.dataset.ean = ean;
                    eanInput.dataset.originalValue = ean;
                    
                    
                    saveEANModification(orderId, componentType, ean);
                    
                    
                    await loadProductNameForInput(eanInput);
                }
                
                
                document.getElementById('component-search-popup').style.display = 'none';
                document.getElementById('component-search-overlay').style.display = 'none';
                currentSearchContext = null;
            }
        } else {
            alert('Errore: ' + (data.error || 'Impossibile salvare l\'articolo'));
        }
    } catch (error) {
        console.error('Errore salvataggio articolo:', error);
        alert('Errore durante il salvataggio');
    }
});


document.getElementById('cancel-custom-item')?.addEventListener('click', () => {
    closeAddCustomItemPopup();
});


document.getElementById('add-custom-item-overlay')?.addEventListener('click', () => {
    closeAddCustomItemPopup();
});