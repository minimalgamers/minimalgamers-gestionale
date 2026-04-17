



const CUSTOM_COMPONENTS_API_URL = 'api_gateway/db_bridge/components_service/endpoint/api-custom-components.php';
let customAmazonComponents = [];

function setGeneratePdfButtonVisibility(visible) {
    const generateBtn = document.getElementById('generate-orders-btn');
    if (!generateBtn) return;
    generateBtn.style.display = visible ? 'block' : 'none';
}

function hasSupplierSummaryData() {
    return !!(window.currentSupplierData && Object.keys(window.currentSupplierData).length > 0);
}

async function closeAllOverlayPages(saveConfigsFirst = false) {
    if (saveConfigsFirst) {
        const configsPage = document.getElementById('standard-configs-page');
        if (configsPage && configsPage.style.display === 'block') {
            await saveAllConfigurations();
        }
    }

    const gpoPage = document.getElementById('gpo-mapping-page');
    if (gpoPage && gpoPage.style.display === 'block') {
        gpoPage.style.display = 'none';
    }

    const amazonPage = document.getElementById('custom-components-page');
    if (amazonPage && amazonPage.style.display === 'block') {
        amazonPage.style.display = 'none';
    }

    const configsPage = document.getElementById('standard-configs-page');
    if (configsPage && configsPage.style.display === 'block') {
        configsPage.style.display = 'none';
    }

    const settingsPopup = document.getElementById('settings-popup');
    if (settingsPopup && settingsPopup.style.display === 'flex') {
        settingsPopup.style.display = 'none';
    }

    const searchBar = document.getElementById('search-bar');
    if (searchBar && searchBar.style.display === 'flex') {
        searchBar.style.display = 'none';
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
    }

    document.body.classList.remove('no-scroll');
}

document.getElementById('custom-components-btn')?.addEventListener('click', async () => {
    await closeAllOverlayPages(true);

    const page = document.getElementById('custom-components-page');
    if (page) {
        
        setGeneratePdfButtonVisibility(false);
        page.style.display = 'block';
        document.body.classList.add('no-scroll');
        loadCustomAmazonComponents();
    }
});

document.getElementById('close-custom-components')?.addEventListener('click', () => {
    const page = document.getElementById('custom-components-page');
    if (page) {
        page.style.display = 'none';
        document.body.classList.remove('no-scroll');

        
        setGeneratePdfButtonVisibility(hasSupplierSummaryData());
    }
});

async function loadCustomAmazonComponents() {
    const listContainer = document.getElementById('custom-components-list');

    try {
        const response = await fetch(CUSTOM_COMPONENTS_API_URL);
        const data = await response.json();

        if (data.success && data.components) {
            customAmazonComponents = data.components;
            renderCustomComponentsList();
        } else {
            listContainer.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun componente salvato</p>';
        }
    } catch (error) {
        console.error('Errore caricamento componenti personalizzati:', error);
        listContainer.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">Errore caricamento</p>';
    }
}

function renderCustomComponentsList() {
    const listContainer = document.getElementById('custom-components-list');

    if (customAmazonComponents.length === 0) {
        listContainer.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun componente salvato. Aggiungi il primo!</p>';
        return;
    }

    const grouped = {};
    customAmazonComponents.forEach(comp => {
        const cat = comp.categoria || 'ALTRO';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(comp);
    });

    let html = '';

    for (const [categoria, components] of Object.entries(grouped)) {
        html += `<div style="margin-bottom: 16px;">
            <h4 style="color: #f39c12; margin: 0 0 8px 0; font-size: 0.9em; text-transform: uppercase;">${categoria}</h4>`;

        components.forEach(comp => {
            const showColorSelector = (categoria === 'CASE' || categoria === 'COOLER');
            const savedColor = localStorage.getItem(`amazon-component-color-${comp.id}-${categoria}`) || '';

            html += `
                <div class="custom-component-item" data-id="${comp.id}" data-nome="${comp.nome}" data-ean="${comp.ean}" data-categoria="${comp.categoria}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 6px; transition: all 0.2s; cursor: pointer;" title="Clicca per modificare">
                    <div style="flex: 1; display: flex; align-items: center; gap: 10px;">
                        <div style="flex: 1;">
                            <span class="comp-nome" style="color: white; font-weight: 500;">${comp.nome}</span>
                            <span class="comp-ean" style="color: rgba(255,255,255,0.5); font-size: 0.8em; margin-left: 12px;">EAN: ${comp.ean}</span>
                        </div>
                        ${showColorSelector ? `
                            <select class="amazon-comp-color-selector" data-id="${comp.id}" data-categoria="${categoria}" style="padding: 6px 8px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; font-size: 0.75em; cursor: pointer; min-width: 80px;" onclick="event.stopPropagation();">
                                <option value="" ${!savedColor ? 'selected' : ''}>Colore</option>
                                <option value="BIANCO" ${savedColor === 'BIANCO' ? 'selected' : ''}>Bianco</option>
                                <option value="NERO" ${savedColor === 'NERO' ? 'selected' : ''}>Nero</option>
                                <option value="ALTRO" ${savedColor === 'ALTRO' ? 'selected' : ''}>Altro</option>
                            </select>
                        ` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="background: rgba(243, 156, 18, 0.2); color: #f39c12; padding: 3px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 600;">AMAZON</span>
                        <button class="edit-custom-component" data-id="${comp.id}" style="background: rgba(52, 152, 219, 0.2); border: none; color: #3498db; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em;" title="Modifica">✏️</button>
                        <button class="delete-custom-component" data-id="${comp.id}" style="background: rgba(231, 76, 60, 0.2); border: none; color: #e74c3c; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em;" title="Elimina">🗑️</button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
    }

    listContainer.innerHTML = html;

    listContainer.querySelectorAll('.amazon-comp-color-selector').forEach(select => {
        select.addEventListener('change', (e) => {
            const compId = e.target.dataset.id;
            const categoria = e.target.dataset.categoria;
            const color = e.target.value;

            if (color && color !== '') {
                localStorage.setItem(`amazon-component-color-${compId}-${categoria}`, color);
                showNotification(`Colore ${color} salvato per questo ${categoria}`);
            } else {
                localStorage.removeItem(`amazon-component-color-${compId}-${categoria}`);
            }
        });
    });

    listContainer.querySelectorAll('.edit-custom-component').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = e.target.closest('.custom-component-item');
            openEditCustomComponentPopup(
                item.dataset.id,
                item.dataset.nome,
                item.dataset.ean,
                item.dataset.categoria
            );
        });
    });

    listContainer.querySelectorAll('.delete-custom-component').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = e.target.closest('button').dataset.id;
            if (confirm('Eliminare questo componente?')) {
                await deleteCustomAmazonComponent(id);
            }
        });
    });
}

function openEditCustomComponentPopup(id, nome, ean, categoria) {
    const existingPopup = document.getElementById('edit-custom-component-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.id = 'edit-custom-component-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 16px; padding: 24px; border: 1px solid rgba(243, 156, 18, 0.4); width: 450px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);';

    popup.innerHTML = `
        <h3 style="margin: 0 0 20px 0; color: #f39c12; font-size: 1.2em;">✏️ Modifica Componente Amazon</h3>
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Categoria</label>
            <select id="edit-comp-categoria" style="width: 100%; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
                <option value="CPU" ${categoria === 'CPU' ? 'selected' : ''}>CPU</option>
                <option value="GPU" ${categoria === 'GPU' ? 'selected' : ''}>GPU</option>
                <option value="RAM" ${categoria === 'RAM' ? 'selected' : ''}>RAM</option>
                <option value="SSD" ${categoria === 'SSD' ? 'selected' : ''}>SSD</option>
                <option value="MOBO" ${categoria === 'MOBO' ? 'selected' : ''}>Scheda Madre</option>
                <option value="PSU" ${categoria === 'PSU' ? 'selected' : ''}>Alimentatore</option>
                <option value="CASE" ${categoria === 'CASE' ? 'selected' : ''}>Case</option>
                <option value="COOLER" ${categoria === 'COOLER' ? 'selected' : ''}>Dissipatore</option>
                <option value="ALTRO" ${categoria === 'ALTRO' ? 'selected' : ''}>Altro</option>
            </select>
        </div>
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Nome Componente</label>
            <input type="text" id="edit-comp-nome" value="${nome.replace(/"/g, '&quot;')}" style="width: 100%; box-sizing: border-box; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
        </div>
        <div style="margin-bottom: 20px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">EAN / Codice</label>
            <input type="text" id="edit-comp-ean" value="${ean}" style="width: 100%; box-sizing: border-box; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
            <p style="color: rgba(255,255,255,0.4); font-size: 0.75em; margin-top: 6px;">⚠️ Se modifichi l'EAN, verrà aggiornato anche negli ordini elaborati che lo usano</p>
        </div>
        <div style="display: flex; gap: 12px;">
            <button id="save-edit-comp" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #f39c12, #e67e22); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">💾 Salva Modifiche</button>
            <button id="cancel-edit-comp" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; font-weight: 600; cursor: pointer;">Annulla</button>
        </div>
    `;

    document.body.appendChild(popup);
    document.getElementById('edit-comp-nome').focus();

    document.getElementById('save-edit-comp').addEventListener('click', async () => {
        const newCategoria = document.getElementById('edit-comp-categoria').value;
        const newNome = document.getElementById('edit-comp-nome').value.trim();
        const newEan = document.getElementById('edit-comp-ean').value.trim();

        if (!newNome) {
            showNotification('Inserisci il nome del componente', 'error');
            return;
        }

        await updateCustomAmazonComponent(id, newCategoria, newNome, newEan, ean);
        popup.remove();
    });

    document.getElementById('cancel-edit-comp').addEventListener('click', () => {
        popup.remove();
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            popup.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

async function updateCustomAmazonComponent(id, categoria, nome, ean, oldEan) {
    try {
        const response = await fetch(CUSTOM_COMPONENTS_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, categoria, nome, ean, oldEan })
        });

        const data = await response.json();

        if (data.success) {
            let message = '✅ Componente aggiornato!';
            if (data.updatedOrders > 0) {
                message += ` (${data.updatedOrders} ordini aggiornati)`;
            }
            showNotification(message);
            loadCustomAmazonComponents();

            if (data.updatedOrders > 0) {
                await loadProcessedOrdersFromDB();
            }
        } else {
            showNotification('Errore: ' + (data.error || 'Sconosciuto'), 'error');
        }
    } catch (error) {
        console.error('Errore aggiornamento componente:', error);
        showNotification('Errore di connessione', 'error');
    }
}

document.getElementById('add-custom-component-btn')?.addEventListener('click', async () => {
    const categoria = document.getElementById('new-custom-component-category').value;
    const nome = document.getElementById('new-custom-component-name').value.trim();
    const ean = document.getElementById('new-custom-component-ean').value.trim();

    if (!nome) {
        showNotification('Inserisci il nome del componente', 'error');
        return;
    }

    try {
        const response = await fetch(CUSTOM_COMPONENTS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoria, nome, ean })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Componente aggiunto!');
            document.getElementById('new-custom-component-name').value = '';
            document.getElementById('new-custom-component-ean').value = '';
            loadCustomAmazonComponents();
        } else {
            showNotification('Errore: ' + (data.error || 'Sconosciuto'), 'error');
        }
    } catch (error) {
        console.error('Errore aggiunta componente:', error);
        showNotification('Errore di connessione', 'error');
    }
});

async function deleteCustomAmazonComponent(id) {
    try {
        const response = await fetch(`${CUSTOM_COMPONENTS_API_URL}?id=${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Componente eliminato');
            loadCustomAmazonComponents();
        } else {
            showNotification('Errore eliminazione', 'error');
        }
    } catch (error) {
        console.error('Errore eliminazione:', error);
        showNotification('Errore di connessione', 'error');
    }
}
