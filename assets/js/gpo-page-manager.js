



const GPO_MAPPING_API_URL = 'api_gateway/db_bridge/components_service/endpoint/api-gpo-mapping.php';
let gpoMappings = [];
let currentGpoFilter = 'ALL';

function setGeneratePdfButtonVisibility(visible) {
    const generateBtn = document.getElementById('generate-orders-btn');
    if (!generateBtn) return;
    generateBtn.style.display = visible ? 'block' : 'none';
}

function hasSupplierSummaryData() {
    return !!(window.currentSupplierData && Object.keys(window.currentSupplierData).length > 0);
}

document.getElementById('gpo-mapping-btn')?.addEventListener('click', async () => {
    await closeAllOverlayPages(true);

    const page = document.getElementById('gpo-mapping-page');
    if (page) {
        
        setGeneratePdfButtonVisibility(false);
        page.style.display = 'block';
        document.body.classList.add('no-scroll');
        loadGpoMappings();
    }
});

document.getElementById('close-gpo-mapping')?.addEventListener('click', () => {
    const page = document.getElementById('gpo-mapping-page');
    if (page) {
        page.style.display = 'none';
        document.body.classList.remove('no-scroll');

        
        setGeneratePdfButtonVisibility(hasSupplierSummaryData());
    }
});

document.querySelectorAll('.gpo-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.gpo-filter-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = 'rgba(255,255,255,0.1)';
            b.style.borderColor = 'rgba(255,255,255,0.2)';
            b.style.color = 'rgba(255,255,255,0.7)';
        });
        btn.classList.add('active');
        btn.style.background = 'rgba(155, 89, 182, 0.3)';
        btn.style.borderColor = 'rgba(155, 89, 182, 0.5)';
        btn.style.color = '#9b59b6';

        currentGpoFilter = btn.dataset.filter;
        renderGpoMappingList();
    });
});

async function loadGpoMappings() {
    const listContainer = document.getElementById('gpo-mapping-list');

    try {
        const response = await fetch(GPO_MAPPING_API_URL);
        const data = await response.json();

        if (data.success && data.mappings) {
            gpoMappings = data.mappings;
            renderGpoMappingList();
        } else {
            listContainer.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun mapping salvato</p>';
        }
    } catch (error) {
        console.error('Errore caricamento GPO mapping:', error);
        listContainer.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">Errore caricamento</p>';
    }
}

async function renderGpoMappingList() {
    const listContainer = document.getElementById('gpo-mapping-list');

    let filteredMappings = gpoMappings;
    if (currentGpoFilter !== 'ALL') {
        filteredMappings = gpoMappings.filter(m => m.variable === currentGpoFilter || m.variable.includes(currentGpoFilter));
    }

    if (filteredMappings.length === 0) {
        listContainer.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun mapping trovato</p>';
        return;
    }

    const mappingsWithNames = await Promise.all(filteredMappings.map(async (m) => {
        if (!m.component_name || m.component_name === '') {
            try {
                let url = `api_gateway/db_bridge/components_service/endpoint/api-components.php?ean=${encodeURIComponent(m.ean)}`;
                if (m.supplier) {
                    url += `&supplier=${encodeURIComponent(m.supplier)}`;
                }
                const response = await fetch(url);
                const data = await response.json();
                if (data.success && data.component && data.component.nome) {
                    return { ...m, component_name: data.component.nome };
                }
            } catch (e) {}
        }
        return m;
    }));

    const grouped = {};
    mappingsWithNames.forEach(m => {
        const variable = m.variable || 'ALTRO';
        if (!grouped[variable]) grouped[variable] = [];
        grouped[variable].push(m);
    });

    let html = '';

    const variableColors = {
        'CPU': '#e74c3c',
        'GPU': '#3498db',
        'RAM': '#2ecc71',
        'SSD': '#f39c12',
        'SSD ADDON': '#f1c40f',
        'SCHEDA MADRE': '#9b59b6',
        'PSU': '#e67e22',
        'CASE': '#1abc9c',
        'COOLER': '#00bcd4',
        'MONITOR': '#ff9800',
        'KIT': '#795548'
    };

    for (const [variable, mappings] of Object.entries(grouped)) {
        const varColor = variableColors[variable] || '#95a5a6';

        html += `<div style="margin-bottom: 16px;">
            <h4 style="color: ${varColor}; margin: 0 0 8px 0; font-size: 0.9em; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
                <span style="background: ${varColor}33; padding: 4px 10px; border-radius: 6px; border: 1px solid ${varColor}66;">${variable}</span>
                <span style="color: rgba(255,255,255,0.4); font-size: 0.85em;">(${mappings.length} mapping)</span>
            </h4>`;

        mappings.forEach(m => {
            const supplierColors = {
                'PROKS': { bg: 'rgba(231, 76, 60, 0.2)', color: '#e74c3c' },
                'OMEGA': { bg: 'rgba(155, 89, 182, 0.2)', color: '#9b59b6' },
                'TIER ONE': { bg: 'rgba(52, 152, 219, 0.2)', color: '#3498db' },
                'AMAZON': { bg: 'rgba(243, 156, 18, 0.2)', color: '#f39c12' },
                'NOUA': { bg: 'rgba(46, 204, 113, 0.2)', color: '#2ecc71' },
                'ECOM': { bg: 'rgba(52, 152, 219, 0.2)', color: '#3498db' },
                'MSI': { bg: 'rgba(211, 84, 0, 0.2)', color: '#d35400' },
                'CASEKING': { bg: 'rgba(230, 126, 34, 0.2)', color: '#e67e22' },
                'NAVY BLUE': { bg: 'rgba(26, 86, 219, 0.2)', color: '#1a56db' }
            };
            const supplierStyle = supplierColors[m.supplier] || { bg: 'rgba(127, 140, 141, 0.2)', color: '#7f8c8d' };

            html += `
                <div class="gpo-mapping-item" data-id="${m.id}" style="display: grid; grid-template-columns: 1fr 1.5fr auto auto; gap: 12px; align-items: center; padding: 12px 16px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 6px; border-left: 3px solid ${varColor};">
                    <div>
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.7em; text-transform: uppercase; margin-bottom: 2px;">Valore Variante</div>
                        <div style="color: white; font-weight: 600; font-size: 0.95em;">${m.variant_value}</div>
                    </div>
                    <div>
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.7em; text-transform: uppercase; margin-bottom: 2px;">Componente Associato</div>
                        <div class="gpo-ean-clickable" data-mapping-id="${m.id}" data-variable="${m.variable}" style="color: #3498db; font-weight: 600; font-size: 0.85em; font-family: monospace; background: rgba(52,152,219,0.1); padding: 4px 8px; border-radius: 4px; display: inline-block; cursor: pointer; transition: all 0.2s; border: 1px solid rgba(52,152,219,0.3);" title="Clicca per cambiare componente">${m.ean}</div>
                        <div style="color: rgba(255,255,255,0.8); font-size: 0.85em; margin-top: 4px; font-weight: 500;">${m.component_name || '<span style="color: rgba(255,255,255,0.4); font-style: italic;">Nome non trovato</span>'}</div>
                    </div>
                    <div>
                        ${m.supplier ? `<span style="background: ${supplierStyle.bg}; color: ${supplierStyle.color}; padding: 4px 10px; border-radius: 4px; font-size: 0.8em; font-weight: 600;">${m.supplier}</span>` : '<span style="color: rgba(255,255,255,0.3); font-size: 0.8em;">---</span>'}
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button class="edit-gpo-mapping" data-id="${m.id}" style="background: rgba(52, 152, 219, 0.2); border: none; color: #3498db; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em;" title="Modifica">✏️</button>
                        <button class="delete-gpo-mapping" data-id="${m.id}" style="background: rgba(231, 76, 60, 0.2); border: none; color: #e74c3c; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em;" title="Elimina">🗑️</button>
                    </div>
                </div>
            `;
        });

        html += '</div>';
    }

    listContainer.innerHTML = html;

    listContainer.querySelectorAll('.edit-gpo-mapping').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('button').dataset.id;
            const mapping = gpoMappings.find(m => m.id == id);
            if (mapping) openEditGpoMappingPopup(mapping);
        });
    });

    listContainer.querySelectorAll('.delete-gpo-mapping').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.closest('button').dataset.id;
            if (confirm('Eliminare questo mapping?')) {
                await deleteGpoMapping(id);
            }
        });
    });

    listContainer.querySelectorAll('.gpo-ean-clickable').forEach(eanDiv => {
        eanDiv.addEventListener('click', async (e) => {
            const mappingId = e.target.dataset.mappingId;
            const variable = e.target.dataset.variable;
            openGPOComponentSearchPopup(mappingId, variable);
        });

        eanDiv.addEventListener('mouseenter', (e) => {
            e.target.style.background = 'rgba(52,152,219,0.25)';
            e.target.style.transform = 'scale(1.05)';
        });
        eanDiv.addEventListener('mouseleave', (e) => {
            e.target.style.background = 'rgba(52,152,219,0.1)';
            e.target.style.transform = 'scale(1)';
        });
    });
}

document.getElementById('add-gpo-mapping-btn')?.addEventListener('click', async () => {
    const variable = document.getElementById('new-gpo-variable').value;
    const variantValue = document.getElementById('new-gpo-value').value.trim();
    let ean = document.getElementById('new-gpo-ean').value.trim();
    const componentName = document.getElementById('new-gpo-component-name').value.trim();
    const supplier = document.getElementById('new-gpo-supplier').value;

    if (!ean && componentName) {
        ean = componentName;
    }

    if (!variantValue || !ean) {
        showNotification('Inserisci valore variante e almeno uno tra EAN o Nome componente', 'error');
        return;
    }

    try {
        const response = await fetch(GPO_MAPPING_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variable,
                variant_value: variantValue,
                ean,
                component_name: componentName || ean,
                supplier
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Mapping aggiunto!');
            document.getElementById('new-gpo-value').value = '';
            document.getElementById('new-gpo-ean').value = '';
            document.getElementById('new-gpo-component-name').value = '';
            document.getElementById('new-gpo-supplier').value = '';
            loadGpoMappings();
        } else {
            showNotification('Errore: ' + (data.error || 'Sconosciuto'), 'error');
        }
    } catch (error) {
        console.error('Errore aggiunta mapping:', error);
        showNotification('Errore di connessione', 'error');
    }
});

function openEditGpoMappingPopup(mapping) {
    const existingPopup = document.getElementById('edit-gpo-mapping-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.id = 'edit-gpo-mapping-popup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3000; background: rgba(30, 30, 30, 0.98); backdrop-filter: blur(20px); border-radius: 16px; padding: 24px; border: 1px solid rgba(155, 89, 182, 0.4); width: 500px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);';

    popup.innerHTML = `
        <h3 style="margin: 0 0 20px 0; color: #9b59b6; font-size: 1.2em;">✏️ Modifica Mapping GPO</h3>
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Variabile</label>
            <select id="edit-gpo-variable" style="width: 100%; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
                <option value="CPU" ${mapping.variable === 'CPU' ? 'selected' : ''}>CPU</option>
                <option value="GPU" ${mapping.variable === 'GPU' ? 'selected' : ''}>GPU</option>
                <option value="RAM" ${mapping.variable === 'RAM' ? 'selected' : ''}>RAM</option>
                <option value="SSD" ${mapping.variable === 'SSD' ? 'selected' : ''}>SSD</option>
                <option value="SSD ADDON" ${mapping.variable === 'SSD ADDON' ? 'selected' : ''}>SSD ADDON</option>
                <option value="SCHEDA MADRE" ${mapping.variable === 'SCHEDA MADRE' ? 'selected' : ''}>SCHEDA MADRE</option>
                <option value="PSU" ${mapping.variable === 'PSU' ? 'selected' : ''}>PSU</option>
                <option value="CASE" ${mapping.variable === 'CASE' ? 'selected' : ''}>CASE</option>
                <option value="COOLER" ${mapping.variable === 'COOLER' ? 'selected' : ''}>COOLER</option>
                <option value="MONITOR" ${mapping.variable === 'MONITOR' ? 'selected' : ''}>MONITOR</option>
                <option value="KIT" ${mapping.variable === 'KIT' ? 'selected' : ''}>KIT</option>
            </select>
        </div>
        <div style="margin-bottom: 16px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Valore Variante</label>
            <input type="text" id="edit-gpo-value" value="${mapping.variant_value.replace(/"/g, '&quot;')}" style="width: 100%; box-sizing: border-box; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
        </div>
        <div style="margin-bottom: 16px; position: relative;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">EAN / Codice</label>
            <input type="text" id="edit-gpo-ean" value="${mapping.ean}" placeholder="Cerca o inserisci EAN..." style="width: 100%; box-sizing: border-box; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
            <input type="hidden" id="edit-gpo-component-name" value="${mapping.component_name || ''}">
            <div id="edit-gpo-ean-search-results" style="display: none; position: absolute; background: rgba(20,20,20,0.98); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; max-height: 300px; overflow-y: auto; z-index: 3010; width: 100%; margin-top: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);"></div>
        </div>
        <div style="margin-bottom: 20px;">
            <label style="color: rgba(255,255,255,0.7); font-size: 0.85em; display: block; margin-bottom: 6px;">Fornitore</label>
            <select id="edit-gpo-supplier" style="width: 100%; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: white; font-size: 0.95em;">
                <option value="">-- Nessuno --</option>
                <option value="PROKS" ${mapping.supplier === 'PROKS' ? 'selected' : ''}>PROKS</option>
                <option value="OMEGA" ${mapping.supplier === 'OMEGA' ? 'selected' : ''}>OMEGA</option>
                <option value="TIER ONE" ${mapping.supplier === 'TIER ONE' ? 'selected' : ''}>TIER ONE</option>
                <option value="AMAZON" ${mapping.supplier === 'AMAZON' ? 'selected' : ''}>AMAZON</option>
                <option value="NOUA" ${mapping.supplier === 'NOUA' ? 'selected' : ''}>NOUA</option>
            </select>
        </div>
        <div style="display: flex; gap: 12px;">
            <button id="save-edit-gpo" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #9b59b6, #8e44ad); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">💾 Salva Modifiche</button>
            <button id="cancel-edit-gpo" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; font-weight: 600; cursor: pointer;">Annulla</button>
        </div>
    `;

    document.body.appendChild(popup);

    const editEanInput = document.getElementById('edit-gpo-ean');
    const editEanResults = document.getElementById('edit-gpo-ean-search-results');
    let editEanSearchTimer = null;

    editEanInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        if (editEanSearchTimer) clearTimeout(editEanSearchTimer);

        if (query.length < 2) {
            editEanResults.style.display = 'none';
            return;
        }

        editEanSearchTimer = setTimeout(async () => {
            try {
                const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}&limit=15`);
                const data = await response.json();

                if (data.success && data.components && data.components.length > 0) {
                    const sorted = [...data.components].sort((a, b) => {
                        const priceA = parseFloat(a.prezzo) || 999999;
                        const priceB = parseFloat(b.prezzo) || 999999;
                        return priceA - priceB;
                    });

                    const cheapest = sorted[0];
                    let html = '';

                    html += `
                        <div class="edit-gpo-ean-result" data-ean="${cheapest.ean}" data-name="${cheapest.nome}" data-supplier="${cheapest.fornitore || ''}" style="padding: 12px; cursor: pointer; background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1)); border-bottom: 2px solid rgba(46, 204, 113, 0.4); transition: background 0.2s;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <span style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; font-weight: 700;">💰 PIÙ ECONOMICO</span>
                                <span style="color: #2ecc71; font-weight: 700; font-size: 1.1em;">€${parseFloat(cheapest.prezzo).toFixed(2)}</span>
                            </div>
                            <div style="color: white; font-weight: 600; font-size: 0.9em;">${cheapest.nome}</div>
                            <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">EAN: ${cheapest.ean} | ${cheapest.fornitore || 'N/D'} | Qtà: ${cheapest.quantita || 0}</div>
                        </div>
                    `;

                    if (sorted.length > 1) {
                        html += '<div style="padding: 6px 12px; background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.5); font-size: 0.75em;">Altri risultati</div>';

                        sorted.slice(1).forEach(c => {
                            const price = parseFloat(c.prezzo) || 0;
                            html += `
                                <div class="edit-gpo-ean-result" data-ean="${c.ean}" data-name="${c.nome}" data-supplier="${c.fornitore || ''}" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background 0.2s;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                        <div style="flex: 1;">
                                            <div style="color: white; font-weight: 500; font-size: 0.85em;">${c.nome}</div>
                                            <div style="color: rgba(255,255,255,0.5); font-size: 0.7em; margin-top: 2px;">EAN: ${c.ean} | ${c.fornitore || 'N/D'} | Qtà: ${c.quantita || 0}</div>
                                        </div>
                                        <span style="color: #f39c12; font-weight: 600; font-size: 0.95em; margin-left: 12px;">€${price.toFixed(2)}</span>
                                    </div>
                                </div>
                            `;
                        });
                    }

                    editEanResults.innerHTML = html;
                    editEanResults.style.display = 'block';

                    editEanResults.querySelectorAll('.edit-gpo-ean-result').forEach(item => {
                        item.addEventListener('click', () => {
                            editEanInput.value = item.dataset.ean;
                            document.getElementById('edit-gpo-component-name').value = item.dataset.name;
                            const supplierSelect = document.getElementById('edit-gpo-supplier');
                            if (item.dataset.supplier && supplierSelect) {
                                supplierSelect.value = item.dataset.supplier;
                            }
                            editEanResults.style.display = 'none';
                        });

                        item.addEventListener('mouseenter', (e) => {
                            if (!e.target.style.background.includes('gradient')) {
                                e.target.style.background = 'rgba(255,255,255,0.1)';
                            }
                        });
                        item.addEventListener('mouseleave', (e) => {
                            if (!e.target.style.background.includes('gradient')) {
                                e.target.style.background = 'transparent';
                            }
                        });
                    });
                } else {
                    editEanResults.style.display = 'none';
                }
            } catch (error) {
                console.error('Errore ricerca EAN:', error);
                editEanResults.style.display = 'none';
            }
        }, 300);
    });

    const closeEditResults = (e) => {
        if (editEanResults && !editEanResults.contains(e.target) && e.target !== editEanInput) {
            editEanResults.style.display = 'none';
        }
    };
    document.addEventListener('click', closeEditResults);

    document.getElementById('save-edit-gpo').addEventListener('click', async () => {
        const newVariable = document.getElementById('edit-gpo-variable').value;
        const newValue = document.getElementById('edit-gpo-value').value.trim();
        const newEan = document.getElementById('edit-gpo-ean').value.trim();
        const newComponentName = document.getElementById('edit-gpo-component-name').value.trim();
        const newSupplier = document.getElementById('edit-gpo-supplier').value;

        if (!newValue || !newEan) {
            showNotification('Inserisci valore variante e EAN', 'error');
            return;
        }

        await updateGpoMapping(mapping.id, newVariable, newValue, newEan, newSupplier, newComponentName);
        popup.remove();
    });

    document.getElementById('cancel-edit-gpo').addEventListener('click', () => {
        popup.remove();
    });
}

function openGPOComponentSearchPopup(mappingId, variableType) {
    const mapping = gpoMappings.find(m => m.id == mappingId);
    if (!mapping) return;

    const popup = document.createElement('div');
    popup.className = 'search-component-popup-gpo';
    popup.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(15, 15, 15, 0.98); border: 2px solid rgba(155, 89, 182, 0.6);
        border-radius: 16px; padding: 24px; z-index: 3000; width: 600px; max-height: 80vh;
        overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5); backdrop-filter: blur(10px);
    `;

    popup.innerHTML = `
        <h3 style="color: #9b59b6; margin: 0 0 16px 0; font-size: 1.3em;">🔍 Seleziona Componente per "${mapping.variant_value}"</h3>
        <p style="color: rgba(255,255,255,0.6); margin: 0 0 16px 0; font-size: 0.9em;">Tipo: <strong style="color: #9b59b6;">${variableType}</strong></p>
        <input type="text" id="gpo-component-search-input" placeholder="Cerca componente per nome, EAN o SKU..." 
            style="width: 100%; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); 
            border-radius: 8px; color: white; font-size: 0.95em; margin-bottom: 16px;">
        <div id="gpo-component-search-results-list" style="max-height: 400px; overflow-y: auto; margin-bottom: 16px;"></div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancel-gpo-search" style="padding: 10px 20px; background: rgba(231, 76, 60, 0.2); color: #e74c3c; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Annulla</button>
        </div>
    `;

    document.body.appendChild(popup);

    const searchInput = document.getElementById('gpo-component-search-input');
    const resultsList = document.getElementById('gpo-component-search-results-list');
    let searchTimer = null;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        if (searchTimer) clearTimeout(searchTimer);

        if (query.length < 2) {
            resultsList.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Digita almeno 2 caratteri per cercare...</p>';
            return;
        }

        searchTimer = setTimeout(async () => {
            try {
                const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}&limit=30`);
                const data = await response.json();

                if (data.success && data.components && data.components.length > 0) {
                    const sorted = [...data.components].sort((a, b) => {
                        const priceA = parseFloat(a.prezzo) || 999999;
                        const priceB = parseFloat(b.prezzo) || 999999;
                        return priceA - priceB;
                    });

                    let html = '';
                    sorted.forEach((comp, index) => {
                        const price = parseFloat(comp.prezzo) || 0;
                        const isCheapest = index === 0;

                        html += `
                            <div class="gpo-search-result-item" data-ean="${comp.ean}" data-name="${comp.nome}" data-supplier="${comp.fornitore || ''}"
                                style="padding: 12px; cursor: pointer; border-radius: 8px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1);
                                background: ${isCheapest ? 'linear-gradient(135deg, rgba(46, 204, 113, 0.15), rgba(39, 174, 96, 0.1))' : 'rgba(255,255,255,0.05)'};
                                transition: all 0.2s;">
                                ${isCheapest ? '<div style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; font-weight: 700; display: inline-block; margin-bottom: 6px;">💰 PIÙ ECONOMICO</div>' : ''}
                                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <div style="flex: 1;">
                                        <div style="color: white; font-weight: 600; font-size: 0.95em; margin-bottom: 4px;">${comp.nome}</div>
                                        <div style="color: rgba(255,255,255,0.5); font-size: 0.75em;">
                                            EAN: ${comp.ean} | ${comp.fornitore || 'N/D'} | Qtà: ${comp.quantita || 0}
                                        </div>
                                    </div>
                                    <span style="color: ${isCheapest ? '#2ecc71' : '#f39c12'}; font-weight: 700; font-size: 1.1em; margin-left: 16px;">€${price.toFixed(2)}</span>
                                </div>
                            </div>
                        `;
                    });

                    resultsList.innerHTML = html;

                    resultsList.querySelectorAll('.gpo-search-result-item').forEach(item => {
                        item.addEventListener('click', async () => {
                            const ean = item.dataset.ean;
                            const name = item.dataset.name;
                            const supplier = item.dataset.supplier;

                            await updateGpoMapping(mappingId, variableType, mapping.variant_value, ean, supplier, name);
                            popup.remove();
                        });

                        item.addEventListener('mouseenter', (e) => {
                            e.target.style.background = 'rgba(155, 89, 182, 0.2)';
                            e.target.style.borderColor = 'rgba(155, 89, 182, 0.4)';
                        });
                        item.addEventListener('mouseleave', (e) => {
                            const isCheapest = e.target.querySelector('div[style*="PIÙ ECONOMICO"]');
                            e.target.style.background = isCheapest ? 'linear-gradient(135deg, rgba(46, 204, 113, 0.15), rgba(39, 174, 96, 0.1))' : 'rgba(255,255,255,0.05)';
                            e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                        });
                    });
                } else {
                    resultsList.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nessun componente trovato</p>';
                }
            } catch (error) {
                console.error('Errore ricerca componenti:', error);
                resultsList.innerHTML = '<p style="color: #e74c3c; text-align: center; padding: 20px;">Errore ricerca</p>';
            }
        }, 300);
    });

    document.getElementById('cancel-gpo-search').addEventListener('click', () => {
        popup.remove();
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            popup.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    searchInput.focus();
}

async function updateGpoMapping(id, variable, variantValue, ean, supplier, componentName = null) {
    try {
        const payload = {
            id,
            variable,
            variant_value: variantValue,
            ean,
            supplier
        };

        if (componentName) {
            payload.component_name = componentName;
        }

        const response = await fetch(GPO_MAPPING_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Mapping aggiornato!');
            await loadGpoMappingsGlobal();
            await loadGpoMappings();
        } else {
            showNotification('Errore: ' + (data.error || 'Sconosciuto'), 'error');
        }
    } catch (error) {
        console.error('Errore aggiornamento mapping:', error);
        showNotification('Errore di connessione', 'error');
    }
}

async function deleteGpoMapping(id) {
    try {
        const response = await fetch(`${GPO_MAPPING_API_URL}?id=${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Mapping eliminato');
            loadGpoMappings();
        } else {
            showNotification('Errore eliminazione', 'error');
        }
    } catch (error) {
        console.error('Errore eliminazione:', error);
        showNotification('Errore di connessione', 'error');
    }
}

let gpoEanSearchTimer = null;
document.getElementById('new-gpo-ean')?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const resultsDiv = document.getElementById('gpo-ean-search-results');

    if (gpoEanSearchTimer) clearTimeout(gpoEanSearchTimer);

    if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }

    gpoEanSearchTimer = setTimeout(async () => {
        try {
            const response = await fetch(`api_gateway/db_bridge/components_service/endpoint/api-components.php?search=${encodeURIComponent(query)}&limit=15`);
            const data = await response.json();

            if (data.success && data.components && data.components.length > 0) {
                const inputRect = e.target.getBoundingClientRect();
                resultsDiv.style.top = (inputRect.bottom + 5) + 'px';
                resultsDiv.style.left = inputRect.left + 'px';
                resultsDiv.style.width = (inputRect.width + 100) + 'px';
                resultsDiv.style.maxHeight = '350px';

                const sortedComponents = [...data.components].sort((a, b) => {
                    const priceA = parseFloat(a.prezzo) || 999999;
                    const priceB = parseFloat(b.prezzo) || 999999;
                    return priceA - priceB;
                });

                const cheapest = sortedComponents[0];

                let html = '';
                html += `
                    <div class="gpo-ean-result" data-ean="${cheapest.ean}" data-name="${cheapest.nome}" data-supplier="${cheapest.fornitore || ''}" style="padding: 12px; cursor: pointer; background: linear-gradient(135deg, rgba(46, 204, 113, 0.2), rgba(39, 174, 96, 0.1)); border-bottom: 2px solid rgba(46, 204, 113, 0.4); transition: background 0.2s;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="background: #2ecc71; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; font-weight: 700;">💰 PIÙ ECONOMICO</span>
                            <span style="color: #2ecc71; font-weight: 700; font-size: 1.1em;">€${parseFloat(cheapest.prezzo).toFixed(2)}</span>
                        </div>
                        <div style="color: white; font-weight: 600; font-size: 0.9em;">${cheapest.nome}</div>
                        <div style="color: rgba(255,255,255,0.5); font-size: 0.75em; margin-top: 4px;">EAN: ${cheapest.ean} | ${cheapest.fornitore || 'N/D'} | Qtà: ${cheapest.quantita || 0}</div>
                    </div>
                `;

                if (sortedComponents.length > 1) {
                    html += '<div style="padding: 6px 12px; background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.5); font-size: 0.75em;">Altri risultati (dal meno caro)</div>';

                    sortedComponents.slice(1).forEach(c => {
                        const price = parseFloat(c.prezzo) || 0;
                        html += `
                            <div class="gpo-ean-result" data-ean="${c.ean}" data-name="${c.nome}" data-supplier="${c.fornitore || ''}" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background 0.2s;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <div style="flex: 1;">
                                        <div style="color: white; font-weight: 500; font-size: 0.85em;">${c.nome}</div>
                                        <div style="color: rgba(255,255,255,0.5); font-size: 0.7em; margin-top: 2px;">EAN: ${c.ean} | ${c.fornitore || 'N/D'} | Qtà: ${c.quantita || 0}</div>
                                    </div>
                                    <span style="color: #f39c12; font-weight: 600; font-size: 0.95em; margin-left: 12px;">€${price.toFixed(2)}</span>
                                </div>
                            </div>
                        `;
                    });
                }

                resultsDiv.innerHTML = html;
                resultsDiv.style.display = 'block';

                resultsDiv.querySelectorAll('.gpo-ean-result').forEach(item => {
                    item.addEventListener('click', () => {
                        document.getElementById('new-gpo-ean').value = item.dataset.ean;
                        document.getElementById('new-gpo-component-name').value = item.dataset.name;
                        if (item.dataset.supplier) {
                            document.getElementById('new-gpo-supplier').value = item.dataset.supplier;
                        }
                        resultsDiv.style.display = 'none';
                    });
                    item.addEventListener('mouseenter', () => {
                        if (!item.style.background.includes('gradient')) {
                            item.style.background = 'rgba(255,255,255,0.1)';
                        }
                    });
                    item.addEventListener('mouseleave', () => {
                        if (!item.style.background.includes('gradient')) {
                            item.style.background = 'transparent';
                        }
                    });
                });
            } else {
                resultsDiv.style.display = 'none';
            }
        } catch (error) {
            console.error('Errore ricerca EAN:', error);
            resultsDiv.style.display = 'none';
        }
    }, 300);
});

document.addEventListener('click', (e) => {
    const resultsDiv = document.getElementById('gpo-ean-search-results');
    if (resultsDiv && !resultsDiv.contains(e.target) && e.target.id !== 'new-gpo-ean') {
        resultsDiv.style.display = 'none';
    }
});

document.getElementById('new-gpo-value')?.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    const variableSelect = document.getElementById('new-gpo-variable');
    const selectedVariable = variableSelect ? variableSelect.value : null;

    document.querySelectorAll('.gpo-mapping-item').forEach(item => {
        item.style.background = 'rgba(255,255,255,0.05)';
        item.style.boxShadow = 'none';
    });

    if (!value) {
        e.target.style.background = 'rgba(0,0,0,0.4)';
        e.target.style.borderColor = 'rgba(255,255,255,0.2)';
        return;
    }

    const existingMapping = gpoMappings.find(m => {
        const valueMatch = m.variant_value.toUpperCase() === value;
        const variableMatch = !selectedVariable || m.variable === selectedVariable;
        return valueMatch && variableMatch;
    });

    if (existingMapping) {
        e.target.style.background = 'rgba(241, 196, 15, 0.3)';
        e.target.style.borderColor = 'rgba(241, 196, 15, 0.6)';

        const mappingItem = document.querySelector(`.gpo-mapping-item[data-id="${existingMapping.id}"]`);
        if (mappingItem) {
            mappingItem.style.background = 'rgba(241, 196, 15, 0.2)';
            mappingItem.style.boxShadow = '0 0 20px rgba(241, 196, 15, 0.4)';
            mappingItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } else {
        e.target.style.background = 'rgba(0,0,0,0.4)';
        e.target.style.borderColor = 'rgba(255,255,255,0.2)';
    }
});

document.getElementById('new-gpo-variable')?.addEventListener('change', (e) => {
    const valueInput = document.getElementById('new-gpo-value');
    if (valueInput) {
        valueInput.dispatchEvent(new Event('input'));
    }

    const selectedVariable = e.target.value;
    const filterBtn = document.querySelector(`.gpo-filter-btn[data-filter="${selectedVariable}"]`);

    if (filterBtn) {
        document.querySelectorAll('.gpo-filter-btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = 'rgba(255,255,255,0.1)';
            b.style.borderColor = 'rgba(255,255,255,0.2)';
            b.style.color = 'rgba(255,255,255,0.7)';
        });

        filterBtn.classList.add('active');
        filterBtn.style.background = 'rgba(155, 89, 182, 0.3)';
        filterBtn.style.borderColor = 'rgba(155, 89, 182, 0.5)';
        filterBtn.style.color = '#9b59b6';

        currentGpoFilter = selectedVariable;
        renderGpoMappingList();
    }
});
