
const operatorName = 'OperatoreB';
let currentStatusFilter = 'todo'; 




const PROCESSED_ORDERS_API_URL = 'api_gateway/db_bridge/processed_orders_service/endpoint/api-processed-orders.php';
const ORDER_STATUSES_API_URL = 'api_gateway/db_bridge/order_statuses_service/endpoint/api-order-statuses.php';
const OPERATOR_ASSIGNMENTS_API_URL = 'api_gateway/db_bridge/operator_assignments_service/endpoint/api-operator-assignments.php';
const GPO_MAPPING_API_URL_GLOBAL = 'api_gateway/db_bridge/components_service/endpoint/api-gpo-mapping.php';

let processedOrdersCache = {};
let orderStatusesCache = {};
let operatorAssignmentsCache = {};
let gpoMappingsCache = [];






async function loadGpoMappingsGlobal() {
    try {
        const response = await fetch(GPO_MAPPING_API_URL_GLOBAL);
        const data = await response.json();
        
        if (data.success && data.mappings) {
            gpoMappingsCache = data.mappings;
            console.log('✅ GPO Mappings caricati:', gpoMappingsCache.length);
            return gpoMappingsCache;
        }
        return [];
    } catch (error) {
        console.error('❌ Errore caricamento GPO mappings:', error);
        return [];
    }
}







function findGpoMapping(variable, variantValue) {
    if (!gpoMappingsCache || gpoMappingsCache.length === 0) {
        return null;
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
    const normalizeVariable = (value) => {
        const normalized = String(value || '').trim().toUpperCase();
        if (normalized === 'MOBO' || normalized === 'MOTHERBOARD') return 'SCHEDA MADRE';
        if (normalized === 'SSD AGGIUNTIVO') return 'SSD ADDON';
        if (normalized === 'DISSIPATORE') return 'COOLER';
        if (normalized === 'ALIMENTATORE') return 'PSU';
        return normalized;
    };

    const normalizeVariantValue = (value) => String(value || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[‐‑‒–—―]/g, '-')
        .replace(/\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    const normalizedVariable = normalizeVariable(variable);
    const normalizedValue = normalizeVariantValue(variantValue);
    
    
    const candidates = gpoMappingsCache.filter(m => 
        normalizeVariable(m.variable) === normalizedVariable &&
        normalizeVariantValue(m.variant_value) === normalizedValue
    );

    if (candidates.length === 0) {
        return null;
    }

    const mapping = candidates.sort((left, right) => {
        const leftUpdated = new Date(left.updated_at || left.created_at || 0).getTime();
        const rightUpdated = new Date(right.updated_at || right.created_at || 0).getTime();
        if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;

        const leftId = parseInt(left.id, 10) || 0;
        const rightId = parseInt(right.id, 10) || 0;
        return rightId - leftId;
    })[0];
    
    if (mapping) {
        console.log(`🎯 GPO Mapping trovato per ${variable}: "${variantValue}" -> EAN: ${mapping.ean}, Nome: ${mapping.component_name}, Supplier: ${mapping.supplier}`);
        return {
            ean: mapping.ean,
            component_name: mapping.component_name,
            supplier: mapping.supplier
        };
    }
    
    return null;
}


async function loadProcessedOrdersFromDB() {
    try {
        const response = await fetch(PROCESSED_ORDERS_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.orders) {
                processedOrdersCache = data.orders;
                console.log('✅ Ordini elaborati caricati dal database:', Object.keys(processedOrdersCache).length);
                return processedOrdersCache;
            }
        }
        return {};
    } catch (error) {
        console.error('❌ Errore caricamento ordini elaborati:', error);
        return {};
    }
}


function getProcessedOrderIds() {
    return Object.keys(processedOrdersCache);
}


async function loadOrderStatusesFromDB() {
    try {
        const response = await fetch(ORDER_STATUSES_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.statuses) {
                orderStatusesCache = data.statuses;
                console.log('✅ Stati ordini caricati dal database:', Object.keys(orderStatusesCache).length);
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


async function loadOperatorAssignmentsFromDB() {
    try {
        const response = await fetch(OPERATOR_ASSIGNMENTS_API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.assignments) {
                operatorAssignmentsCache = data.assignments;
                console.log('✅ Assegnazioni operatori caricate dal database:', Object.keys(operatorAssignmentsCache).length);
                return operatorAssignmentsCache;
            }
        }
        return {};
    } catch (error) {
        console.error('❌ Errore caricamento assegnazioni operatori:', error);
        return {};
    }
}


function getOperatorAssignment(orderId) {
    return operatorAssignmentsCache[orderId] || '';
}


function initBackgroundSelector() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPopup = document.getElementById('settings-popup');
    const settingsCloseBtn = document.querySelector('.settings-close-btn');
    const bgSelectorBtnPopup = document.getElementById('bg-selector-btn-popup');
    const bgResetBtn = document.getElementById('bg-reset-btn');
    const bgInput = document.getElementById('bg-file-input');
    
    
    const savedBg = localStorage.getItem('custom_background');
    if (savedBg) {
        document.body.style.backgroundImage = `url('${savedBg}')`;
    }
    
    
    settingsBtn.addEventListener('click', () => {
        settingsPopup.style.display = 'flex';
    });
    
    
    settingsCloseBtn.addEventListener('click', () => {
        settingsPopup.style.display = 'none';
    });
    
    
    settingsPopup.addEventListener('click', (e) => {
        if (e.target === settingsPopup) {
            settingsPopup.style.display = 'none';
        }
    });
    
    
    bgSelectorBtnPopup.addEventListener('click', () => {
        bgInput.click();
    });
    
    
    bgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                document.body.style.backgroundImage = `url('${dataUrl}')`;
                localStorage.setItem('custom_background', dataUrl);
            };
            reader.readAsDataURL(file);
        }
    });
    
    
    bgResetBtn.addEventListener('click', () => {
        document.body.style.backgroundImage = "url('assets/img/background.avif')";
        localStorage.removeItem('custom_background');
    });
}


window.addEventListener('DOMContentLoaded', () => {
    
    initBackgroundSelector();
    
    
    document.body.classList.add('orders-loaded');
    
    
    const container = document.getElementById('orders-container');
    if (container) {
        container.style.display = 'grid';
    }
    
    
    loadOperatorOrders();
    
    
    initializeStatusTabs();
    
    
    initializeSearchBar();
    
    
    setInterval(loadOperatorOrders, 30000);
});





function initializeSearchBar() {
    const searchBtn = document.getElementById('search-btn');
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    
    
    searchBtn?.addEventListener('click', () => {
        const isVisible = searchBar.style.display === 'flex';
        searchBar.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) {
            searchInput.focus();
        }
    });
    
    
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
        if (searchBar && searchBtn) {
            const isClickInsideSearch = searchBar.contains(e.target) || searchBtn.contains(e.target);
            if (!isClickInsideSearch && searchBar.style.display === 'flex') {
                searchBar.style.display = 'none';
            }
        }
    });
}

function initializeStatusTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            
            
            button.classList.add('active');
            
            
            currentStatusFilter = button.dataset.tab;
            
            
            loadOperatorOrders();
        });
    });
}

function updateTabCounts(todoCount, inProgressCount, completedCount) {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        const tabName = button.dataset.tab;
        let count = 0;
        
        if (tabName === 'todo') count = todoCount;
        else if (tabName === 'in-progress') count = inProgressCount;
        else if (tabName === 'completed') count = completedCount;
        
        
        const oldCounter = button.querySelector('.tab-counter');
        if (oldCounter) oldCounter.remove();
        
        
        const counter = document.createElement('span');
        counter.className = 'tab-counter';
        counter.textContent = count;
        button.appendChild(counter);
    });
}

async function loadOperatorOrders() {
    try {
        
        let orders = JSON.parse(sessionStorage.getItem('shopify_orders') || '[]');
        
        
        if (orders.length === 0) {
            const savedApiKey = loadSession();
            if (savedApiKey) {
                console.log('Caricamento ordini da API...');
                orders = await fetchOrdersFromAPI(savedApiKey);
                console.log(`Caricati ${orders.length} ordini`);
            } else {
                console.warn('Nessuna sessione trovata - redirect a index.html');
                
                window.location.href = 'index.html';
                return;
            }
        }
        
        if (orders.length > 0) {
            processOrdersForOperator(orders);
        } else {
            console.warn('Nessun ordine disponibile');
            const container = document.getElementById('orders-container');
            container.innerHTML = '<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Nessun ordine disponibile. <a href="index.html" style="color: #3498db;">Torna alla dashboard principale</a></p>';
        }
    } catch (error) {
        console.error('Errore caricamento ordini:', error);
        const container = document.getElementById('orders-container');
        container.innerHTML = '<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Errore caricamento ordini. <a href="index.html" style="color: #3498db;">Torna alla dashboard principale</a></p>';
    }
}

async function fetchOrdersFromAPI(apiKey) {
    const API_ENDPOINT = 'api_gateway/shopify_bridge/order_service/endpoint/api-orders.php';
    
    const response = await fetch(API_ENDPOINT, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        }
    });
    
    if (response.ok) {
        const orders = await response.json();
        sessionStorage.setItem('shopify_orders', JSON.stringify(orders));
        return orders;
    }
    
    return [];
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
        return null;
    }
}

async function processOrdersForOperator(orders) {
    
    const paidOrders = orders.filter(o => o.financial_status === 'paid');
    
    
    await loadProcessedOrdersFromDB();
    await loadOperatorAssignmentsFromDB();
    await loadOrderStatusesFromDB();
    await loadGpoMappingsGlobal();
    
    const processedOrderIds = getProcessedOrderIds();
    
    
    const myOrders = paidOrders.filter(o => 
        processedOrderIds.includes(String(o.id)) &&
        operatorAssignmentsCache[o.id] === operatorName
    );
    
    const myOrdersMap = new Map();
    
    myOrders.forEach(order => {
        const orderName = order.name || order.order_number;
        myOrdersMap.set(orderName, {
            id: order.id,
            name: orderName,
            email: order.email || order.customer?.email || 'N/A',
            createdAt: order.created_at,
            financialStatus: order.financial_status,
            fulfillmentStatus: order.fulfillment_status,
            total: order.total_price || order.current_total_price,
            currency: order.currency,
            billingName: order.billing_address?.name || order.customer?.first_name + ' ' + order.customer?.last_name || 'N/A',
            operator: operatorName,
            status: getOrderStatus(order.id),
            items: (order.line_items || []).map(item => ({
                name: item.name || item.title,
                quantity: item.quantity,
                price: item.price,
                customProperties: item.custom_properties || {}
            }))
        });
    });
    
    renderOrdersForOperator(myOrdersMap);
}

function renderOrdersForOperator(ordersMap) {
    const container = document.getElementById('orders-container');
    container.innerHTML = '';
    
    
    const allOrders = Array.from(ordersMap.values());
    const todoCounts = allOrders.filter(o => o.status === 'todo').length;
    const inProgressCounts = allOrders.filter(o => o.status === 'in-progress').length;
    const completedCounts = allOrders.filter(o => o.status === 'completed').length;
    
    
    updateTabCounts(todoCounts, inProgressCounts, completedCounts);
    
    
    const filteredOrders = Array.from(ordersMap.values()).filter(order => 
        order.status === currentStatusFilter
    );
    
    if (filteredOrders.length === 0) {
        container.innerHTML = '<p style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align:center; width:100%; color: rgba(255,255,255,0.7); font-size: 1.5rem;">Nessun ordine in questo stato.</p>';
        return;
    }
    
    filteredOrders.forEach(order => {
        
        const pcItem = order.items.find(item => {
            const itemName = item.name || item.title || '';
            return itemName.toUpperCase().includes('PC GAMING') || 
                   identifyPCConfig(itemName, true) !== null;
        });
        
        if (!pcItem) {
            
            container.appendChild(createStandardCard(order));
            return;
        }
        
        
        const config = identifyPCConfig(pcItem.name);
        
        if (!config) {
            
            container.appendChild(createStandardCard(order));
            return;
        }
        
        const card = document.createElement('div');
        card.className = 'order-card order-card-processed';
        
        
        const cleanConfigName = config.configKey.replace(/^PC GAMING\s*/i, '');
        
        
        const itemsHtml = order.items.map(item => {
            
            const cleanItemName = item.name.replace(/PC GAMING\s*/gi, '');
            
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
                        <strong>${cleanItemName}</strong>
                        <span class="item-quantity">x${item.quantity}</span>
                        ${customPropsHtml}
                    </td>
                </tr>
            `;
        }).join('');
        
        card.innerHTML = `
            <div class="flip-container">
                <div class="flip-front">
                    <div class="card-header">
                        <h2 style="margin: 0; cursor: pointer;" class="order-id-flip" data-order-id="${order.id}">${order.name}</h2>
                        <span class="config-badge">${cleanConfigName}</span>
                    </div>
                    <div class="card-body">
                        <div id="components-${order.id}" style="color: rgba(255,255,255,0.8); font-size: 0.95em; line-height: 1.8;">
                            Caricamento componenti...
                        </div>
                    </div>
                    <div class="card-footer">
                        <div class="status-buttons">
                            <button class="status-btn ${order.status === 'todo' ? 'active' : ''}" data-status="todo" data-order-id="${order.id}" title="Segna come da fare">📋 Da Fare</button>
                            <button class="status-btn ${order.status === 'in-progress' ? 'active' : ''}" data-status="in-progress" data-order-id="${order.id}" title="Segna come in corso">⚙️ In Corso</button>
                            <button class="status-btn ${order.status === 'completed' ? 'active' : ''}" data-status="completed" data-order-id="${order.id}" title="Segna come completato">✓ Completato</button>
                        </div>
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
                        <div class="status-buttons">
                            <button class="status-btn ${order.status === 'todo' ? 'active' : ''}" data-status="todo" data-order-id="${order.id}" title="Segna come da fare">📋 Da Fare</button>
                            <button class="status-btn ${order.status === 'in-progress' ? 'active' : ''}" data-status="in-progress" data-order-id="${order.id}" title="Segna come in corso">⚙️ In Corso</button>
                            <button class="status-btn ${order.status === 'completed' ? 'active' : ''}" data-status="completed" data-order-id="${order.id}" title="Segna come completato">✓ Completato</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        
        const statusButtons = card.querySelectorAll('.status-btn');
        statusButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newStatus = e.target.dataset.status;
                const orderId = e.target.dataset.orderId;
                updateOrderStatus(orderId, newStatus);
            });
        });
        
        
        const flipTriggers = card.querySelectorAll('.order-id-flip');
        flipTriggers.forEach(trigger => {
            trigger.addEventListener('click', () => {
                const flipContainer = card.querySelector('.flip-container');
                if (flipContainer) {
                    flipContainer.classList.toggle('flipped');
                }
            });
        });
        
        container.appendChild(card);
        
        
        loadComponentsForOrder(order.id, config.components, pcItem.customProperties || {}, order.items);
    });
}

function createStandardCard(order) {
    const card = document.createElement('div');
    card.className = 'order-card';
    
    
    let statusBadgeClass = 'status-todo';
    let statusText = 'Da Fare';
    if (order.status === 'in-progress') {
        statusBadgeClass = 'status-in-progress';
        statusText = 'In Corso';
    } else if (order.status === 'completed') {
        statusBadgeClass = 'status-completed';
        statusText = 'Completato';
    }
    
    
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
    
    card.innerHTML = `
        <div class="order-status-badge ${statusBadgeClass}">${statusText}</div>
        <div class="card-header">
            <div>
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
            <div class="status-buttons">
                <button class="status-btn ${order.status === 'todo' ? 'active' : ''}" data-status="todo" data-order-id="${order.id}" title="Segna come da fare">📋 Da Fare</button>
                <button class="status-btn ${order.status === 'in-progress' ? 'active' : ''}" data-status="in-progress" data-order-id="${order.id}" title="Segna come in corso">⚙️ In Corso</button>
                <button class="status-btn ${order.status === 'completed' ? 'active' : ''}" data-status="completed" data-order-id="${order.id}" title="Segna come completato">✓ Completato</button>
            </div>
        </div>
    `;
    
    
    const statusButtons = card.querySelectorAll('.status-btn');
    statusButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newStatus = e.target.dataset.status;
            const orderId = e.target.dataset.orderId;
            updateOrderStatus(orderId, newStatus);
        });
    });
    
    return card;
}

async function updateOrderStatus(orderId, newStatus) {
    
    await saveOrderStatusToDB(orderId, newStatus);
    
    
    loadOperatorOrders();
}


const style = document.createElement('style');
style.textContent = `
    .order-status-badge {
        position: absolute;
        top: 10px;
        right: 10px;
        padding: 5px 15px;
        border-radius: 20px;
        font-size: 0.8em;
        font-weight: bold;
        z-index: 10;
    }
    
    .status-todo {
        background: rgba(241, 196, 15, 0.3);
        color: #f1c40f;
        border: 1px solid #f1c40f;
    }
    
    .status-in-progress {
        background: rgba(52, 152, 219, 0.3);
        color: #3498db;
        border: 1px solid #3498db;
    }
    
    .status-completed {
        background: rgba(46, 204, 113, 0.3);
        color: #2ecc71;
        border: 1px solid #2ecc71;
    }
    
    .card-footer {
        padding: 15px;
        background: rgba(0, 0, 0, 0.2);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .status-buttons {
        display: flex;
        gap: 10px;
        width: 100%;
    }
    
    .status-btn {
        flex: 1;
        padding: 12px 8px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        transition: all 0.3s ease;
        white-space: nowrap;
    }
    
    .status-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.3);
        color: #fff;
    }
    
    .status-btn.active[data-status="todo"] {
        background: rgba(241, 196, 15, 0.5);
        color: #000;
        border-color: #f1c40f;
        text-shadow: none;
    }
    
    .status-btn.active[data-status="in-progress"] {
        background: rgba(52, 152, 219, 0.5);
        color: #000;
        border-color: #3498db;
        text-shadow: none;
    }
    
    .status-btn.active[data-status="completed"] {
        background: rgba(46, 204, 113, 0.5);
        color: #000;
        border-color: #2ecc71;
        text-shadow: none;
    }
    
    .tab-counter {
        display: inline-block;
        margin-left: 8px;
        padding: 2px 8px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        font-size: 0.85em;
        font-weight: bold;
        min-width: 20px;
        text-align: center;
    }
    
    .tab-button.active .tab-counter {
        background: rgba(255, 255, 255, 0.3);
    }
`;
document.head.appendChild(style);





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
    console.log(`🔍 Ricerca CASE: "${caseName}" -> "${searchName}"`);
    
    try {
        const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(searchName)}&type=Case_PC`);
        const data = await response.json();
        
        if (data.success && data.components && data.components.length > 0) {
            const targetName = normalizeCaseName(searchName);

            
            const exactMatch = data.components.find(c => normalizeCaseName(c.nome) === targetName);
            
            if (exactMatch && exactMatch.ean) {
                console.log(`🔍 CASE "${caseName}" -> EAN trovato: ${exactMatch.ean}`);
                return exactMatch.ean;
            }

            
            const containsMatch = data.components.find(c => {
                const normalizedName = normalizeCaseName(c.nome);
                return normalizedName.includes(targetName) || targetName.includes(normalizedName);
            });

            if (containsMatch && containsMatch.ean) {
                console.log(`🔍 CASE "${caseName}" -> EAN (match contenimento): ${containsMatch.ean}`);
                return containsMatch.ean;
            }

            
            return null;
        }
        
        console.log(`⚠️ CASE "${caseName}" -> Nessun EAN trovato nel database`);
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
        upperValue.includes('CHASSIS')) {
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









async function loadComponentsForOrder(orderId, baseComponents, variants = {}, allItems = []) {
    const componentsContainer = document.getElementById(`components-${orderId}`);
    
    
    let finalComponents = JSON.parse(JSON.stringify(baseComponents));

    const updateComponentIfExistsOrAllowedExtra = (componentType, newValue, context = '') => {
        const normalizedType = String(componentType || '').toUpperCase() === 'SSD AGGIUNTIVO'
            ? 'SSD ADDON'
            : String(componentType || '').toUpperCase();

        const componentIndex = finalComponents.findIndex(component =>
            String(component.type || '').toUpperCase() === normalizedType
        );

        if (componentIndex !== -1) {
            finalComponents[componentIndex] = {
                type: finalComponents[componentIndex].type,
                value: newValue
            };
            return true;
        }

        if (normalizedType === 'SSD ADDON') {
            finalComponents.push({
                type: 'SSD ADDON',
                value: newValue
            });
            console.log(`ℹ️ Extra aggiunto (${context || 'OperatoreB'}): SSD ADDON`);
            return true;
        }

        console.warn(`⚠️ Variante ignorata (${context || 'OperatoreB'}): componente ${componentType} non presente nella configurazione standard`);
        return false;
    };
    
    
    for (const [key, value] of Object.entries(variants)) {
        if (['_has_gpo', '_gpo_product_group', '_gpo_personalize', 'gpo_field_name', 'gpo_parent_product_group', '_gpo_field_name', '_gpo_parent_product_group'].includes(key) || !value) continue; 
        
        
        const splitResult = splitRAMandSSD(value);
        
        if (splitResult.ram && splitResult.ssd) {
            
            console.log(`🔀 Variante combinata rilevata: "${value}"`);
            console.log(`  → RAM: "${splitResult.ram}"`);
            console.log(`  → SSD: "${splitResult.ssd}"`);
            
            
            const ramFullGpoMatch = findGpoMapping('RAM', value);
            const ssdFullGpoMatch = findGpoMapping('SSD', value);
            
            
            const ramIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'RAM');
            let ramValue = splitResult.ram;
            if (ramFullGpoMatch) {
                ramValue = ramFullGpoMatch.supplier 
                    ? `${ramFullGpoMatch.ean} (${ramFullGpoMatch.supplier})` 
                    : ramFullGpoMatch.ean;
                console.log(`  🎯 GPO Mapping RAM (valore completo): "${value}" -> "${ramValue}"`);
            } else {
                const ramGpoMatch = findGpoMapping('RAM', splitResult.ram);
                if (ramGpoMatch) {
                    ramValue = ramGpoMatch.supplier 
                        ? `${ramGpoMatch.ean} (${ramGpoMatch.supplier})` 
                        : ramGpoMatch.ean;
                    console.log(`  🎯 GPO Mapping RAM (valore splittato): "${splitResult.ram}" -> "${ramValue}"`);
                }
            }
            updateComponentIfExistsOrAllowedExtra('RAM', ramValue, 'OperatoreB split RAM');
            
            
            const ssdIndex = finalComponents.findIndex(c => c.type.toUpperCase() === 'SSD');
            let ssdValue = splitResult.ssd;
            if (ssdFullGpoMatch) {
                ssdValue = ssdFullGpoMatch.supplier 
                    ? `${ssdFullGpoMatch.ean} (${ssdFullGpoMatch.supplier})` 
                    : ssdFullGpoMatch.ean;
                console.log(`  🎯 GPO Mapping SSD (valore completo): "${value}" -> "${ssdValue}"`);
            } else {
                const ssdGpoMatch = findGpoMapping('SSD', splitResult.ssd);
                if (ssdGpoMatch) {
                    ssdValue = ssdGpoMatch.supplier 
                        ? `${ssdGpoMatch.ean} (${ssdGpoMatch.supplier})` 
                        : ssdGpoMatch.ean;
                    console.log(`  🎯 GPO Mapping SSD (valore splittato): "${splitResult.ssd}" -> "${ssdValue}"`);
                }
            }
            updateComponentIfExistsOrAllowedExtra('SSD', ssdValue, 'OperatoreB split SSD');
            
            continue; 
        }
        
        
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
        } else {
            
            
            componentType = identifyComponentTypeFromValue(value);
        }
        
        if (!componentType) continue; 
        if (componentType === 'MONITOR' || componentType === 'KIT GAMING') continue; 
        
        
        
        
        
        const gpoSearchType = componentType;
        
        let baseComponentType = componentType;
        if (componentType === 'SCHEDA MADRE') {
            baseComponentType = 'MOBO'; 
        }
        if (componentType === 'SSD ADDON' || componentType === 'SSD AGGIUNTIVO') {
            baseComponentType = 'SSD ADDON'; 
        }
        
        
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
                console.log(`🎯 GPO Mapping applicato per ${gpoSearchType}: "${value}" -> "${variantValue}"`);
                
                
                if (componentIndex !== -1) {
                    finalComponents[componentIndex] = {
                        type: finalComponents[componentIndex].type, 
                        value: variantValue
                    };
                } else {
                    updateComponentIfExistsOrAllowedExtra(baseComponentType, variantValue, `OperatoreB GPO ${gpoSearchType}`);
                }
                continue; 
            }
            
            console.log(`⚠️ Nessun GPO mapping trovato per ${gpoSearchType}: "${value}" - uso logica standard`);
        }
        
        if (componentType === 'SSD ADDON' || componentType === 'SSD AGGIUNTIVO') {
            
            if (!value.includes('(')) {
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
                    console.log(`✅ CASE convertito: "${value}" -> "${variantValue}"`);
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
            updateComponentIfExistsOrAllowedExtra(baseComponentType, variantValue, `OperatoreB variant ${baseComponentType}`);
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
    
    
    const eanModifications = loadEANModifications(orderId);
    const deletedComponents = loadDeletedComponents(orderId);
    
    for (const component of finalComponents) {
        
        if (deletedComponents.includes(component.type)) {
            console.log(`🚫 Componente eliminato (nascosto): ${component.type}`);
            continue;
        }
        
        
        const match = component.value.match(/^(.+?)\s*\((.+?)\)$/);
        
        let ean = component.value;
        let supplier = '';
        
        if (match) {
            ean = match[1].trim();
            supplier = match[2].trim();
        }
        
        
        if (eanModifications[component.type]) {
            ean = eanModifications[component.type];
            console.log(`📝 Applicata modifica salvata: ${component.type} = ${ean}`);
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
    
    
    await loadProductNamesForEANs(orderId);
}





async function loadProductNamesForEANs(orderId) {
    const displays = document.querySelectorAll(`span[data-order-id="${orderId}"][data-ean]`);
    
    for (const display of displays) {
        const ean = display.dataset.ean;
        const componentType = display.dataset.componentType;
        
        
        if (ean === 'Generico') {
            display.textContent = 'Monitor generico';
            display.title = `EAN: Generico`;
            continue;
        }
        
        
        try {
            const componentRow = display.closest('.component-row');
            const supplierBadge = componentRow ? componentRow.querySelector('.supplier-badge-clickable') : null;
            const supplierHint = supplierBadge && supplierBadge.dataset && supplierBadge.dataset.supplier
                ? String(supplierBadge.dataset.supplier).trim()
                : '';

            let lookupUrl = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
            if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
                lookupUrl += `&supplier=${encodeURIComponent(supplierHint)}`;
            }

            const response = await fetch(lookupUrl);
            const data = await response.json();
            
            if (data.success && data.component) {
                
                display.textContent = data.component.nome || ean;
                display.title = `EAN: ${ean}\nCategoria: ${data.component.categoria || 'N/D'}`;
                
                
                if (data.component.fornitore) {
                    const componentRow = display.closest('.component-row');
                    const supplierBadge = componentRow ? componentRow.querySelector('.supplier-badge-clickable') : null;
                    
                    if (supplierBadge) {
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
                        
                        supplierBadge.textContent = getSupplierAbbreviation(supplier);
                        supplierBadge.style.background = `${supplierColor}33`;
                        supplierBadge.style.color = supplierColor;
                        supplierBadge.style.borderColor = `${supplierColor}66`;
                        supplierBadge.dataset.supplier = supplier;
                    }
                }
            } else {
                
                display.textContent = ean;
                display.title = `EAN: ${ean}\n(Prodotto non trovato in database)`;
            }
        } catch (error) {
            console.error(`Errore caricamento prodotto per EAN ${ean}:`, error);
            display.textContent = ean;
            display.title = `EAN: ${ean}`;
        }
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
    
    console.log(`💾 EAN salvato: Ordine ${orderId}, ${componentType} = ${newEAN}`);
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
        console.log(`🗑️ Componente eliminato: Ordine ${orderId}, ${componentType}`);
    }
}




function loadDeletedComponents(orderId) {
    const key = `deleted_components`;
    const deletions = JSON.parse(localStorage.getItem(key) || '{}');
    return deletions[orderId] || [];
}




async function loadProductNameForInput(input) {
    const ean = input.dataset.ean;
    const componentType = input.dataset.componentType;
    
    if (ean === 'Generico') {
        input.title = `${componentType}: Monitor generico`;
        return;
    }
    
    try {
        const componentRow = input.closest('.component-row');
        const supplierBadge = componentRow ? componentRow.querySelector('.supplier-badge-clickable') : null;
        const supplierHint = supplierBadge && supplierBadge.dataset && supplierBadge.dataset.supplier
            ? String(supplierBadge.dataset.supplier).trim()
            : '';

        let lookupUrl = `/api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(ean)}`;
        if (supplierHint && supplierHint !== '--' && supplierHint !== 'FORNITORE') {
            lookupUrl += `&supplier=${encodeURIComponent(supplierHint)}`;
        }

        const response = await fetch(lookupUrl);
        const data = await response.json();
        
        if (data.success && data.component) {
            input.title = `${componentType}: ${data.component.nome}\nEAN: ${ean}`;
        } else {
            input.title = `${componentType}: ${ean}\n(Prodotto non trovato in database)`;
        }
    } catch (error) {
        console.error(`Errore caricamento prodotto per EAN ${ean}:`, error);
        input.title = `${componentType}: ${ean}`;
    }
}





let longPressTimer = null;
let longPressTarget = null;
let progressInterval = null;
let initialDelayTimer = null;

document.addEventListener('mousedown', (e) => {
    const componentRow = e.target.closest('.component-row');
    if (!componentRow) return;
    
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
        
        
        const confirmed = confirm(`Vuoi eliminare il componente \"${componentType}\" da questo ordine?\\n\\nQuesta azione verrà salvata e il componente non verrà più mostrato.`);
        
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
});

document.addEventListener('mouseleave', (e) => {
    if (e.target.classList.contains('component-row')) {
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
});
