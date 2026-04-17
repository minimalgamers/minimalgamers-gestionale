(function () {
    if (!window.MessageTemplateEngine) {
        return;
    }

    const requiredRoot = document.getElementById('add-rule-btn');
    if (!requiredRoot) {
        return;
    }

    const GPO_MAPPING_API_URL = 'api_gateway/db_bridge/components_service/endpoint/api-gpo-mapping.php';
    const CUSTOM_COMPONENTS_API_URL = 'api_gateway/db_bridge/components_service/endpoint/api-custom-components.php';
    const TEMPLATE_CATEGORIES = ['DISSIPATORE', 'MOBO WIFI', 'SCHEDA MADRE', 'CASE', 'KIT VENTOLE', 'FPS BOOSTER', 'FINALE'];
    const UNIQUE_CATEGORY = 'MOBO WIFI';
    const UNIQUE_CATEGORIES = ['MOBO WIFI', 'FPS BOOSTER', 'FINALE'];
    const SPECIAL_MOBO_RULE_NAME = 'MOBO WIFI (eccezione)';
    const SPECIAL_FPS_RULE_NAME = 'FPS BOOSTER';
    const SPECIAL_FINAL_RULE_NAME = 'FINALE';

    let workingConfig = window.MessageTemplateEngine.loadConfig();
    let gpoArticles = [];
    let selectedRuleId = null;
    let autoSaveTimer = null;
    const AUTO_SAVE_DELAY_MS = 700;

    function byId(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeEan(value) {
        return String(value || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '');
    }

    function normalizeSearchText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function buildGpoDisplayName(componentName, variant) {
        const name = String(componentName || '').trim();
        const variantValue = String(variant || '').trim();

        if (!name && !variantValue) return 'Articolo GPO';
        if (!name) return variantValue;
        if (!variantValue) return name;

        const nameNorm = normalizeSearchText(name);
        const variantNorm = normalizeSearchText(variantValue);

        if (variantNorm.includes(nameNorm)) return variantValue;
        if (nameNorm.includes(variantNorm)) return name;

        return `${name} ${variantValue}`.trim();
    }

    function getSpecialRuleName(category) {
        const normalized = String(category || '').toUpperCase().trim();
        if (normalized === 'MOBO WIFI') return SPECIAL_MOBO_RULE_NAME;
        if (normalized === 'FPS BOOSTER') return SPECIAL_FPS_RULE_NAME;
        if (normalized === 'FINALE') return SPECIAL_FINAL_RULE_NAME;
        return '';
    }

    function ensureSpecialRuleName(rule) {
        if (!rule) return;
        const specialName = getSpecialRuleName(rule.templateCategory);
        if (specialName && !String(rule.ruleName || '').trim()) {
            rule.ruleName = specialName;
        }
    }

    function createArticleRecord({ ean, category, name, label, source }) {
        return {
            ean: normalizeEan(ean),
            category: String(category || '').trim(),
            name: String(name || '').trim(),
            label: String(label || '').trim(),
            source: String(source || '').trim().toUpperCase()
        };
    }

    function showStatus(message, isError) {
        const box = byId('status-box');
        if (!box) return;

        box.textContent = message;
        box.style.display = 'block';
        box.style.background = isError ? 'rgba(248, 113, 113, 0.2)' : 'rgba(34, 211, 238, 0.2)';
        box.style.borderColor = isError ? 'rgba(248, 113, 113, 0.6)' : 'rgba(34, 211, 238, 0.6)';
    }

    function syncStatusBoxVisibility() {
        const box = byId('status-box');
        if (!box) return;

        const isMessageTabActive = !!document.querySelector('.tab-button[data-tab="message-templates"].active');
        if (!isMessageTabActive) {
            box.style.display = 'none';
        }
    }

    function getRuleById(ruleId) {
        return workingConfig.rules.find(rule => String(rule.id) === String(ruleId)) || null;
    }

    function getRuleArticleEans(rule) {
        if (!rule) return [];
        const rawList = Array.isArray(rule.articleEans) ? rule.articleEans : [rule.articleEan];
        return rawList
            .map(item => normalizeEan(item))
            .filter(Boolean);
    }

    function getRuleArticleLabels(rule) {
        if (!rule) return [];
        const eans = getRuleArticleEans(rule);
        const labelsMap = new Map();

        if (Array.isArray(rule.articleLabels)) {
            rule.articleLabels.forEach((item) => {
                const ean = normalizeEan(item?.ean || '');
                const label = String(item?.label || '').trim();
                if (ean && label) labelsMap.set(ean, label);
            });
        }

        return eans.map((ean) => ({
            ean,
            label: labelsMap.get(ean) || getArticleLabelByEan(ean)
        }));
    }

    function setRuleArticles(rule, labelsList) {
        const normalized = (labelsList || [])
            .map(item => ({ ean: normalizeEan(item?.ean), label: String(item?.label || '').trim() }))
            .filter(item => item.ean);

        const unique = [];
        const seen = new Set();
        normalized.forEach((item) => {
            if (seen.has(item.ean)) return;
            seen.add(item.ean);
            unique.push(item);
        });

        rule.articleEans = unique.map(item => item.ean);
        rule.articleLabels = unique.map(item => ({ ean: item.ean, label: item.label || getArticleLabelByEan(item.ean) }));
        rule.articleEan = rule.articleEans[0] || '';
        rule.articleLabel = rule.articleLabels[0]?.label || '';
        if (!rule.ruleName && rule.articleLabel) {
            rule.ruleName = extractRuleNameFromArticleLabel(rule.articleLabel);
        }
    }

    function renderSelectedArticles(rule) {
        const container = byId('editor-selected-articles');
        if (!container) return;

        const selectedArticles = getRuleArticleLabels(rule);
        if (!selectedArticles.length) {
            container.innerHTML = '<span style="color: rgba(255,255,255,0.6); font-size: 0.82em;">Nessun articolo selezionato</span>';
            return;
        }

        container.innerHTML = selectedArticles.map((item) => {
            return `
                <span style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; border:1px solid rgba(125,211,252,0.45); background: rgba(125,211,252,0.2); color:white; font-size:0.8em;">
                    ${escapeHtml(item.label)}
                    <button type="button" data-action="remove-picked-article" data-ean="${escapeHtml(item.ean)}" style="border:none; background:transparent; color:#e2e8f0; cursor:pointer; font-size:0.95em; line-height:1;">x</button>
                </span>
            `;
        }).join('');
    }

    function getUniqueCategoryOwnerRuleId(categoryName) {
        const normalized = String(categoryName || '').toUpperCase().trim();
        const owner = workingConfig.rules.find((rule) => String(rule.templateCategory || '').toUpperCase().trim() === normalized);
        return owner ? String(owner.id) : null;
    }

    function refreshCategorySelectAvailability(currentRule) {
        const select = byId('editor-template-category');
        if (!select || !currentRule) return;

        const currentRuleId = String(currentRule.id);

        Array.from(select.options).forEach((option) => {
            const optionCategory = String(option.value || '').toUpperCase();
            if (!UNIQUE_CATEGORIES.includes(optionCategory)) {
                option.disabled = false;
                return;
            }

            const ownerRuleId = getUniqueCategoryOwnerRuleId(optionCategory);
            option.disabled = !!ownerRuleId && ownerRuleId !== currentRuleId;
        });
    }

    function syncSpecialRuleEditorUI(rule) {
        const articleWrap = byId('editor-article-search-wrap');
        const specialInfo = byId('editor-special-rule-info');
        const specialInfoText = byId('editor-special-rule-info-text');
        const category = String(rule?.templateCategory || '').toUpperCase().trim();
        const isMoboSpecial = category === 'MOBO WIFI';
        const isFpsBoosterSpecial = category === 'FPS BOOSTER';
        const isFinalSpecial = category === 'FINALE';
        const isSpecial = isMoboSpecial || isFpsBoosterSpecial || isFinalSpecial;

        if (articleWrap) {
            articleWrap.style.display = isSpecial ? 'none' : 'block';
        }

        if (specialInfo) {
            specialInfo.style.display = isSpecial ? 'block' : 'none';
        }

        if (specialInfoText && isSpecial) {
            if (isMoboSpecial) {
                specialInfoText.textContent = 'Ricerca nella scheda madre del WiFi: questa regola eccezionale si attiva solo se nella tabella Scheda_Madre il campo wifi vale 0 per la motherboard dell\'ordine elaborato.';
            } else if (isFpsBoosterSpecial) {
                specialInfoText.textContent = 'FPS BOOSTER: regola eccezionale senza ricerca GPO. Il testo di questo template viene aggiunto in coda al messaggio principale, prima dell\'eventuale chiusura finale.';
            } else {
                specialInfoText.textContent = 'CHIUSURA FINALE: regola eccezionale senza ricerca GPO. Il testo di questo template viene aggiunto sempre per ultimo, dopo anche l\'eventuale FPS BOOSTER.';
            }
        }

        if (isSpecial) {
            hideSearchResults();
        }
    }

    function ensureSpecialMoboWifiRule() {
        const moboRules = workingConfig.rules.filter((rule) => String(rule.templateCategory || '').toUpperCase().trim() === UNIQUE_CATEGORY);

        if (!moboRules.length) {
            const specialRule = window.MessageTemplateEngine.createDefaultRule();
            specialRule.ruleName = SPECIAL_MOBO_RULE_NAME;
            specialRule.templateCategory = UNIQUE_CATEGORY;
            specialRule.articleEan = '';
            specialRule.articleLabel = '';
            specialRule.messageTemplate = '';
            workingConfig.rules.unshift(specialRule);
            return;
        }

        const keeper = moboRules[0];
        if (!keeper.ruleName) {
            keeper.ruleName = SPECIAL_MOBO_RULE_NAME;
        }

        const keeperId = String(keeper.id);
        workingConfig.rules = workingConfig.rules.filter((rule) => {
            const isMobo = String(rule.templateCategory || '').toUpperCase().trim() === UNIQUE_CATEGORY;
            if (!isMobo) return true;
            return String(rule.id) === keeperId;
        });
    }

    function extractRuleNameFromArticleLabel(label) {
        return String(label || '')
            .replace(/^\d+\s*-\s*/, '')
            .replace(/\s*\[[^\]]+\]\s*$/, '')
            .trim();
    }

    function getArticleLabelByEan(ean) {
        const normalized = normalizeEan(ean);
        const found = gpoArticles.find(article => article.ean === normalized);
        return found ? found.label : normalized;
    }

    function getUsedArticleEans(excludeRuleId = null) {
        const used = new Set();

        workingConfig.rules.forEach((rule) => {
            if (excludeRuleId && String(rule.id) === String(excludeRuleId)) return;
            getRuleArticleEans(rule).forEach(ean => used.add(ean));
        });

        return used;
    }

    function filterArticles(searchText, currentRuleId = null) {
        const usedEans = getUsedArticleEans(currentRuleId);
        const term = normalizeSearchText(searchText);

        const availableArticles = gpoArticles.filter(article => !usedEans.has(article.ean));

        if (!term) {
            return availableArticles;
        }

        return availableArticles
            .filter(article => {
                const hayLabel = normalizeSearchText(article.label);
                const hayName = normalizeSearchText(article.name || '');
                return hayLabel.includes(term) || hayName.includes(term) || article.ean.includes(term);
            });
    }

    async function loadGpoArticles() {
        const [gpoResponse, amazonResponse] = await Promise.all([
            fetch(GPO_MAPPING_API_URL),
            fetch(CUSTOM_COMPONENTS_API_URL)
        ]);

        if (!gpoResponse.ok) {
            throw new Error(`HTTP ${gpoResponse.status}`);
        }

        if (!amazonResponse.ok) {
            throw new Error(`HTTP ${amazonResponse.status}`);
        }

        const gpoData = await gpoResponse.json();
        const amazonData = await amazonResponse.json();

        if (!gpoData.success || !Array.isArray(gpoData.mappings)) {
            throw new Error('Risposta GPO non valida.');
        }

        if (!amazonData.success || !Array.isArray(amazonData.components)) {
            throw new Error('Risposta componenti Amazon non valida.');
        }

        const allVariants = [];
        const seenKeys = new Set();

        gpoData.mappings.forEach((mapping) => {
            const ean = normalizeEan(mapping.ean);
            if (!ean) return;

            const variable = String(mapping.variable || '').trim();
            const componentTarget = String(mapping.component_target || '').trim();
            const variant = String(mapping.variant_value || '').trim();
            const componentName = String(mapping.component_name || '').trim();

            const category = variable || componentTarget || 'Altro';
            const name = buildGpoDisplayName(componentName, variant);
            const article = createArticleRecord({
                ean,
                category,
                name,
                label: `${category} - ${name}`,
                source: 'GPO'
            });
            const dedupeKey = `${article.source}:${article.ean}:${article.label}`;
            if (seenKeys.has(dedupeKey)) return;
            seenKeys.add(dedupeKey);
            allVariants.push(article);
        });

        amazonData.components.forEach((component) => {
            const ean = normalizeEan(component.ean);
            if (!ean) return;

            const category = String(component.categoria || 'ALTRO').trim().toUpperCase();
            const name = String(component.nome || '').trim();
            if (!name) return;

            const article = createArticleRecord({
                ean,
                category,
                name,
                label: `AMAZON ${category} - ${name}`,
                source: 'AMAZON'
            });
            const dedupeKey = `${article.source}:${article.ean}:${article.label}`;
            if (seenKeys.has(dedupeKey)) return;
            seenKeys.add(dedupeKey);
            allVariants.push(article);
        });

        gpoArticles = allVariants.sort((a, b) => {
            const categoryCmp = a.category.localeCompare(b.category, 'it', { sensitivity: 'base' });
            if (categoryCmp !== 0) return categoryCmp;
            return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
        });
    }

    function ensureRuleTemplate(rule) {
        if (!rule.messageTemplate) {
            rule.messageTemplate = workingConfig.defaults.messageTemplate || '';
        }

        if (!TEMPLATE_CATEGORIES.includes(String(rule.templateCategory || '').toUpperCase())) {
            rule.templateCategory = '';
        }

        if (!rule.ruleName && rule.articleLabel) {
            rule.ruleName = extractRuleNameFromArticleLabel(rule.articleLabel);
        }

        ensureSpecialRuleName(rule);

        if (!Array.isArray(rule.articleEans) || !Array.isArray(rule.articleLabels)) {
            setRuleArticles(rule, [{
                ean: rule.articleEan || '',
                label: rule.articleLabel || ''
            }]);
        }
    }

    function renderRulesList() {
        const list = byId('rules-list');
        if (!list) return;

        ensureSpecialMoboWifiRule();

        if (!workingConfig.rules.length) {
            list.innerHTML = '<div style="color: rgba(255,255,255,0.75); border: 1px dashed rgba(255,255,255,0.3); border-radius: 8px; padding: 10px; font-size: 0.9em;">Nessuna regola attiva</div>';
            return;
        }

        const configuredPriority = Array.isArray(workingConfig?.defaults?.templateCategoryPriority)
            ? workingConfig.defaults.templateCategoryPriority.map(item => String(item || '').toUpperCase().trim()).filter(Boolean)
            : [];

        const displayPriority = [...configuredPriority];
        TEMPLATE_CATEGORIES.forEach((category) => {
            const normalized = String(category || '').toUpperCase().trim();
            if (!displayPriority.includes(normalized)) {
                displayPriority.push(normalized);
            }
        });

        const sortedRules = [...workingConfig.rules].sort((a, b) => {
            const categoryA = String(a.templateCategory || '').toUpperCase().trim();
            const categoryB = String(b.templateCategory || '').toUpperCase().trim();

            const idxA = categoryA ? displayPriority.indexOf(categoryA) : Number.MAX_SAFE_INTEGER;
            const idxB = categoryB ? displayPriority.indexOf(categoryB) : Number.MAX_SAFE_INTEGER;
            const priorityA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
            const priorityB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            const labelA = String(a.ruleName || a.articleLabel || a.articleEan || '').toUpperCase();
            const labelB = String(b.ruleName || b.articleLabel || b.articleEan || '').toUpperCase();
            return labelA.localeCompare(labelB, 'it', { sensitivity: 'base' });
        });

        list.innerHTML = sortedRules.map((rule, index) => {
            const isActive = String(rule.id) === String(selectedRuleId);
            const label = rule.ruleName || rule.articleLabel || rule.articleEan || `Regola ${index + 1}`;
            const categoryBadge = rule.templateCategory ? `<span style="display:inline-block; margin-bottom: 6px; padding: 2px 8px; border-radius: 999px; background: rgba(56,189,248,0.22); border:1px solid rgba(56,189,248,0.5); color:#bae6fd; font-size:0.72em;">${escapeHtml(rule.templateCategory)}</span>` : '';
            return `
                <div data-rule-id="${escapeHtml(rule.id)}" style="border: 1px solid ${isActive ? 'rgba(125,211,252,0.88)' : 'rgba(255,255,255,0.3)'}; border-radius: 10px; padding: 10px; background: ${isActive ? 'rgba(125,211,252,0.32)' : 'rgba(10,20,35,0.56)'};">
                    ${categoryBadge}
                    <div style="font-size: 0.9em; color: white; margin-bottom: 8px; word-break: break-word;">${escapeHtml(label)}</div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" data-action="edit-rule" data-rule-id="${escapeHtml(rule.id)}" style="flex: 1; border: 1px solid rgba(255,255,255,0.45); background: rgba(255,255,255,0.3); color: white; border-radius: 8px; padding: 6px 8px; cursor: pointer;">Modifica</button>
                        <button type="button" data-action="delete-rule" data-rule-id="${escapeHtml(rule.id)}" style="flex: 1; border: 1px solid rgba(248,113,113,0.7); background: rgba(248,113,113,0.36); color: #ffe4e6; border-radius: 8px; padding: 6px 8px; cursor: pointer;">Elimina</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderSearchResults(searchText) {
        const resultsContainer = byId('editor-search-results');
        const currentRule = getRuleById(selectedRuleId);

        if (!resultsContainer || !currentRule) return;

        const results = filterArticles(searchText, currentRule.id);
        const selectedEans = new Set(getRuleArticleEans(currentRule));

        if (!results.length) {
            resultsContainer.innerHTML = '<div style="padding: 8px 10px; color: rgba(255,255,255,0.65); font-size: 0.85em;">Nessun articolo trovato</div>';
            resultsContainer.style.display = 'block';
            return;
        }

        resultsContainer.innerHTML = results.map((article) => {
            const selected = selectedEans.has(article.ean);
            return `
                <button type="button" data-action="pick-article" data-ean="${escapeHtml(article.ean)}" data-label="${escapeHtml(article.label)}" style="display:block; width:100%; text-align:left; border: none; border-bottom: 1px solid rgba(255,255,255,0.16); padding: 9px 10px; color: ${selected ? '#7dd3fc' : 'rgba(255,255,255,0.96)'}; background: ${selected ? 'rgba(125,211,252,0.38)' : 'rgba(255,255,255,0.12)'}; cursor:pointer;">
                    ${escapeHtml(article.label)}
                </button>
            `;
        }).join('');

        resultsContainer.style.display = 'block';
    }

    function hideSearchResults() {
        const resultsContainer = byId('editor-search-results');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
    }

    function renderEditor() {
        const empty = byId('rule-editor-empty');
        const editor = byId('rule-editor');
        const rule = getRuleById(selectedRuleId);

        if (!rule) {
            if (empty) empty.style.display = 'block';
            if (editor) editor.style.display = 'none';
            syncSpecialRuleEditorUI(null);
            return;
        }

        if (empty) empty.style.display = 'none';
        if (editor) editor.style.display = 'block';

        byId('rule-editor-title').textContent = `Modifica Regola: ${rule.ruleName || rule.articleLabel || rule.articleEan || 'Nuova regola'}`;
        byId('editor-article-search').value = '';
        byId('editor-article-ean').value = '';
        renderSelectedArticles(rule);
        byId('editor-template-category').value = rule.templateCategory || '';
        refreshCategorySelectAvailability(rule);
        syncSpecialRuleEditorUI(rule);
        byId('editor-message-template').value = rule.messageTemplate || '';
        hideSearchResults();
    }

    function renderAll() {
        renderRulesList();
        renderEditor();
    }

    function selectRule(ruleId) {
        selectedRuleId = ruleId;
        renderAll();
    }

    function addRule() {
        const newRule = window.MessageTemplateEngine.createDefaultRule();
        ensureRuleTemplate(newRule);
        workingConfig.rules.push(newRule);
        selectedRuleId = newRule.id;
        renderAll();
        showStatus('Regola aggiunta.');
        scheduleAutoSave();
    }

    function persistConfig({ showSuccessMessage = false, strictMode = false } = {}) {
        ensureSpecialMoboWifiRule();

        workingConfig.rules = workingConfig.rules.map((rule) => ({
            ...rule,
            articleEans: getRuleArticleEans(rule),
            ruleName: String(rule.ruleName || '').trim() || extractRuleNameFromArticleLabel(rule.articleLabel || ''),
            templateCategory: TEMPLATE_CATEGORIES.includes(String(rule.templateCategory || '').toUpperCase())
                ? String(rule.templateCategory || '').toUpperCase()
                : '',
            articleLabels: getRuleArticleLabels(rule),
            articleEan: getRuleArticleEans(rule)[0] || '',
            articleLabel: getRuleArticleLabels(rule)[0]?.label || '',
            messageTemplate: String(rule.messageTemplate || '').trim()
        }));

        if (strictMode) {
            workingConfig.rules = workingConfig.rules.filter(rule => {
                const isExceptional = UNIQUE_CATEGORIES.includes(String(rule.templateCategory || '').toUpperCase().trim());
                return rule.messageTemplate && (isExceptional || (Array.isArray(rule.articleEans) && rule.articleEans.length > 0));
            });
        }

        const assignedUniqueCategories = new Set();
        workingConfig.rules = workingConfig.rules.map((rule) => {
            const category = String(rule.templateCategory || '').toUpperCase().trim();
            if (!UNIQUE_CATEGORIES.includes(category)) {
                return rule;
            }

            if (!assignedUniqueCategories.has(category)) {
                assignedUniqueCategories.add(category);
                return rule;
            }

            return {
                ...rule,
                templateCategory: ''
            };
        });

        workingConfig = window.MessageTemplateEngine.saveConfig(workingConfig);

        if (!getRuleById(selectedRuleId)) {
            selectedRuleId = workingConfig.rules[0]?.id || null;
        }

        renderAll();

        if (showSuccessMessage) {
            showStatus('Regole salvate con successo.');
        }
    }

    function scheduleAutoSave() {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }

        autoSaveTimer = setTimeout(() => {
            persistConfig();
            autoSaveTimer = null;
        }, AUTO_SAVE_DELAY_MS);
    }

    function saveConfig() {
        persistConfig({ showSuccessMessage: true, strictMode: true });
    }

    function resetConfig() {
        if (!confirm('Ripristinare configurazione base?')) return;

        workingConfig = window.MessageTemplateEngine.createDefaultConfig();
        selectedRuleId = null;
        renderAll();
        persistConfig();
        showStatus('Configurazione ripristinata.');
    }

    function deleteRule(ruleId) {
        const ruleToDelete = getRuleById(ruleId);
        if (ruleToDelete && String(ruleToDelete.templateCategory || '').toUpperCase().trim() === UNIQUE_CATEGORY) {
            showStatus('La regola MOBO WIFI eccezionale non puo essere eliminata.', true);
            return;
        }

        workingConfig.rules = workingConfig.rules.filter(rule => String(rule.id) !== String(ruleId));
        if (String(selectedRuleId) === String(ruleId)) {
            selectedRuleId = workingConfig.rules[0]?.id || null;
        }
        renderAll();
        showStatus('Regola eliminata.');
        scheduleAutoSave();
    }

    function initEvents() {
        byId('add-rule-btn').addEventListener('click', addRule);

        byId('rules-list').addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const actionBtn = target.closest('button[data-action]');
            if (!actionBtn) return;

            const ruleId = actionBtn.dataset.ruleId;
            if (!ruleId) return;

            if (actionBtn.dataset.action === 'edit-rule') {
                selectRule(ruleId);
                return;
            }

            if (actionBtn.dataset.action === 'delete-rule') {
                deleteRule(ruleId);
            }
        });

        byId('editor-article-search').addEventListener('input', (event) => {
            const rule = getRuleById(selectedRuleId);
            if (!rule) return;

            const typed = String(event.target.value || '').trim();
            renderSearchResults(typed);
        });

        byId('editor-article-search').addEventListener('focus', (event) => {
            renderSearchResults(event.target.value || '');
        });

        byId('editor-message-template').addEventListener('input', (event) => {
            const rule = getRuleById(selectedRuleId);
            if (!rule) return;
            rule.messageTemplate = event.target.value;
            scheduleAutoSave();
        });

        byId('editor-template-category').addEventListener('change', (event) => {
            const rule = getRuleById(selectedRuleId);
            if (!rule) return;
            const chosen = String(event.target.value || '').toUpperCase();

            if (UNIQUE_CATEGORIES.includes(chosen)) {
                const ownerRuleId = getUniqueCategoryOwnerRuleId(chosen);
                if (ownerRuleId && ownerRuleId !== String(rule.id)) {
                    event.target.value = rule.templateCategory || '';
                    showStatus(`${chosen} e una categoria esclusiva: puo essere assegnata a una sola regola.`, true);
                    return;
                }
            }

            rule.templateCategory = TEMPLATE_CATEGORIES.includes(chosen) ? chosen : '';
            ensureSpecialRuleName(rule);
            renderRulesList();
            refreshCategorySelectAvailability(rule);
            syncSpecialRuleEditorUI(rule);
            scheduleAutoSave();
        });

        byId('editor-search-results').addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const actionBtn = target.closest('button[data-action="pick-article"]');
            if (!actionBtn) return;

            const rule = getRuleById(selectedRuleId);
            if (!rule) return;

            const pickedEan = normalizeEan(actionBtn.dataset.ean || '');
            const pickedLabel = String(actionBtn.dataset.label || '').trim();

            const selectedArticles = getRuleArticleLabels(rule);
            const exists = selectedArticles.some(item => item.ean === pickedEan);
            const nextArticles = exists
                ? selectedArticles.filter(item => item.ean !== pickedEan)
                : [...selectedArticles, { ean: pickedEan, label: pickedLabel || getArticleLabelByEan(pickedEan) }];
            setRuleArticles(rule, nextArticles);

            byId('editor-article-search').value = '';
            byId('editor-article-ean').value = '';
            renderSelectedArticles(rule);

            renderRulesList();
            renderSearchResults('');
            scheduleAutoSave();
        });

        byId('editor-selected-articles').addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const removeBtn = target.closest('button[data-action="remove-picked-article"]');
            if (!removeBtn) return;

            const rule = getRuleById(selectedRuleId);
            if (!rule) return;

            const removeEan = normalizeEan(removeBtn.dataset.ean || '');
            const nextArticles = getRuleArticleLabels(rule).filter(item => item.ean !== removeEan);
            setRuleArticles(rule, nextArticles);
            renderSelectedArticles(rule);
            renderRulesList();
            renderSearchResults(byId('editor-article-search').value || '');
            scheduleAutoSave();
        });

        window.addEventListener('beforeunload', () => {
            if (autoSaveTimer) {
                clearTimeout(autoSaveTimer);
                persistConfig();
                autoSaveTimer = null;
            }
        });

        document.querySelectorAll('.tab-button').forEach((btn) => {
            btn.addEventListener('click', () => {
                setTimeout(syncStatusBoxVisibility, 0);
            });
        });

        const priorityBtn = byId('template-priority-btn');
        const priorityPopup = byId('template-priority-popup');
        const priorityClose = byId('template-priority-close');

        priorityBtn?.addEventListener('click', () => {
            if (priorityPopup) {
                priorityPopup.style.display = 'flex';
            }
        });

        priorityClose?.addEventListener('click', () => {
            if (priorityPopup) {
                priorityPopup.style.display = 'none';
            }
        });

        priorityPopup?.addEventListener('click', (event) => {
            if (event.target === priorityPopup) {
                priorityPopup.style.display = 'none';
            }
        });

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const editorPanel = byId('rule-editor-panel');
            if (editorPanel && !editorPanel.contains(target)) {
                hideSearchResults();
            }
        });
    }

    async function boot() {
        if (typeof window.MessageTemplateEngine.init === 'function') {
            await window.MessageTemplateEngine.init();
        }

        workingConfig = window.MessageTemplateEngine.normalizeConfig(workingConfig);
        workingConfig = window.MessageTemplateEngine.loadConfig();
        ensureSpecialMoboWifiRule();
        selectedRuleId = workingConfig.rules[0]?.id || null;

        initEvents();

        try {
            await loadGpoArticles();
            showStatus(`Articoli template caricati: ${gpoArticles.length} (GPO + Amazon)`);
        } catch (error) {
            showStatus(`Errore caricamento GPO: ${error.message}`, true);
        }

        renderAll();
        syncStatusBoxVisibility();
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
