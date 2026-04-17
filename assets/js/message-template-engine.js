(function () {
    const MESSAGE_TEMPLATE_API_URL = 'api_gateway/db_bridge/message_templates_service/endpoint/api-message-templates.php';
    const DEFAULT_TEMPLATE_CATEGORY_PRIORITY = ['DISSIPATORE', 'MOBO WIFI', 'KIT VENTOLE', 'CASE', 'FPS BOOSTER'];
    const MESSAGE_SECTION_SEPARATOR = '-------------------------';

    let inMemoryConfig = null;
    let initPromise = null;

    function createDefaultConfig() {
        return {
            version: 1,
            updatedAt: new Date().toISOString(),
            defaults: {
                messageTemplate: 'Ciao {{customerName}}, ho verificato la tua build {{orderName}}. Se vuoi, ti posso proporre una soluzione alternativa dedicata.',
                emailSubject: 'Aggiornamento sulla tua build {{orderName}}',
                templateCategoryPriority: [...DEFAULT_TEMPLATE_CATEGORY_PRIORITY]
            },
            rules: []
        };
    }

    function createDefaultRule() {
        return {
            id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            enabled: true,
            ruleName: '',
            templateCategory: '',
            articleEans: [],
            articleLabels: [],
            articleEan: '',
            articleLabel: '',
            messageTemplate: ''
        };
    }

    function normalizePriorityList(priorityList) {
        const normalized = Array.isArray(priorityList)
            ? priorityList
                .map(item => String(item || '').trim().toUpperCase())
                .filter(Boolean)
            : [];

        const unique = normalized.filter((item, index, arr) => arr.indexOf(item) === index);
        const withoutCase = unique.filter(item => item !== 'CASE');
        const fpsIndex = withoutCase.indexOf('FPS BOOSTER');

        if (fpsIndex === -1) {
            withoutCase.push('CASE');
        } else {
            withoutCase.splice(fpsIndex, 0, 'CASE');
        }

        return withoutCase.filter((item, index, arr) => arr.indexOf(item) === index);
    }

    function normalizeConfig(inputConfig) {
        const fallback = createDefaultConfig();
        const config = inputConfig && typeof inputConfig === 'object' ? inputConfig : {};
        const defaults = config.defaults && typeof config.defaults === 'object' ? config.defaults : {};
        const rules = Array.isArray(config.rules) ? config.rules : [];

        const configuredPriority = Array.isArray(defaults.templateCategoryPriority)
            ? defaults.templateCategoryPriority
            : [];
        const normalizedCategoryPriority = normalizePriorityList(configuredPriority);

        const normalizedRules = rules
            .map(normalizeRule)
            .filter(Boolean);

        return {
            version: Number(config.version || fallback.version),
            updatedAt: config.updatedAt || fallback.updatedAt,
            defaults: {
                messageTemplate: String(defaults.messageTemplate || defaults.whatsapp || fallback.defaults.messageTemplate),
                emailSubject: String(defaults.emailSubject || fallback.defaults.emailSubject),
                templateCategoryPriority: normalizedCategoryPriority.length
                    ? normalizedCategoryPriority
                    : [...DEFAULT_TEMPLATE_CATEGORY_PRIORITY]
            },
            rules: normalizedRules
        };
    }

    function normalizeRule(rule) {
        if (!rule || typeof rule !== 'object') return null;
        const fallback = createDefaultRule();

        let articleEan = String(rule.articleEan || '').trim();
        if (!articleEan && rule.triggers && rule.triggers[0] && String(rule.triggers[0].field || '') === 'ean') {
            articleEan = String(rule.triggers[0].value || '').trim();
        }

        const articleEansRaw = Array.isArray(rule.articleEans) ? rule.articleEans : [articleEan];
        const articleEans = articleEansRaw
            .map(item => normalizeEan(item))
            .filter(Boolean)
            .filter((ean, index, arr) => arr.indexOf(ean) === index);

        const articleLabelsRaw = Array.isArray(rule.articleLabels) ? rule.articleLabels : [];
        const articleLabels = articleLabelsRaw
            .map(item => ({
                ean: normalizeEan(item?.ean || ''),
                label: String(item?.label || '').trim()
            }))
            .filter(item => item.ean)
            .filter((item, index, arr) => arr.findIndex(x => x.ean === item.ean) === index);

        const primaryEan = articleEans[0] || normalizeEan(articleEan);
        const primaryLabel = String(rule.articleLabel || articleLabels[0]?.label || rule.name || '').trim();

        const templates = rule.templates && typeof rule.templates === 'object' ? rule.templates : {};
        const messageTemplate = String(
            rule.messageTemplate || templates.whatsapp || templates.emailBody || ''
        ).trim();

        return {
            id: String(rule.id || fallback.id),
            enabled: rule.enabled !== false,
            ruleName: String(rule.ruleName || '').trim(),
            templateCategory: String(rule.templateCategory || rule.category || '').trim().toUpperCase(),
            articleEans: articleEans.length ? articleEans : (primaryEan ? [primaryEan] : []),
            articleLabels,
            articleEan: primaryEan,
            articleLabel: primaryLabel,
            messageTemplate
        };
    }

    function loadConfig() {
        if (inMemoryConfig) {
            return normalizeConfig(inMemoryConfig);
        }

        inMemoryConfig = createDefaultConfig();
        return normalizeConfig(inMemoryConfig);
    }

    async function fetchConfigFromApi() {
        const response = await fetch(MESSAGE_TEMPLATE_API_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Errore lettura configurazione template da DB');
        }

        return data.config || null;
    }

    async function saveConfigToApi(config) {
        const response = await fetch(MESSAGE_TEMPLATE_API_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Errore salvataggio configurazione template su DB');
        }
    }

    async function init() {
        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            try {
                const remoteRawConfig = await fetchConfigFromApi();

                if (remoteRawConfig) {
                    const remoteConfig = normalizeConfig(remoteRawConfig);
                    inMemoryConfig = remoteConfig;
                    return inMemoryConfig;
                }

                
                inMemoryConfig = createDefaultConfig();
                await saveConfigToApi(inMemoryConfig);
                return inMemoryConfig;
            } catch (error) {
                console.warn('⚠️ Template DB non disponibile:', error.message || error);
                
                inMemoryConfig = createDefaultConfig();
                return inMemoryConfig;
            }
        })();

        return initPromise;
    }

    function saveConfig(config) {
        const normalized = normalizeConfig(config);
        normalized.updatedAt = new Date().toISOString();
        inMemoryConfig = normalized;

        
        saveConfigToApi(normalized).catch((error) => {
            console.warn('⚠️ Salvataggio template su DB fallito:', error.message || error);
        });

        return normalized;
    }

    function normalizeEan(value) {
        return String(value || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '');
    }

    function normalizeComparableText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function extractRuleLabelCore(rule) {
        const labels = [];
        if (Array.isArray(rule?.articleLabels)) {
            rule.articleLabels.forEach((item) => {
                if (item?.label) labels.push(String(item.label));
            });
        }

        if (labels.length === 0 && rule?.articleLabel) {
            labels.push(String(rule.articleLabel));
        }

        const cores = labels
            .map((raw) => {
                const rawLabel = String(raw || '').trim();
                if (!rawLabel) return '';
                const parts = rawLabel.split(' - ');
                const core = parts.length > 1 ? parts.slice(1).join(' - ') : rawLabel;
                return normalizeComparableText(core || rawLabel);
            })
            .filter(Boolean);

        return cores;
    }

    function isMoboWifiCategory(rule) {
        return String(rule?.templateCategory || '').trim().toUpperCase() === 'MOBO WIFI';
    }

    function isFpsBoosterCategory(rule) {
        return String(rule?.templateCategory || '').trim().toUpperCase() === 'FPS BOOSTER';
    }

    function isFinalCategory(rule) {
        return String(rule?.templateCategory || '').trim().toUpperCase() === 'FINALE';
    }

    function isMotherboardComponent(component) {
        const type = normalizeComparableText(component?.type || '');
        const name = normalizeComparableText(component?.name || '');

        if (type.includes('mobo') || type.includes('motherboard') || type.includes('scheda madre')) {
            return true;
        }

        return name.includes('motherboard') || name.includes('scheda madre');
    }

    function motherboardHasWifi(components) {
        const motherboardComponents = components.filter(isMotherboardComponent);
        if (!motherboardComponents.length) return false;

        return motherboardComponents.some((component) => {
            const wifiValue = component?.wifi;
            return wifiValue === 1 || wifiValue === '1' || wifiValue === true || wifiValue === 'true';
        });
    }

    function normalizeComponent(component) {
        const source = component && typeof component === 'object' ? component : {};
        const rawWifi = source.wifi;
        const normalizedWifi = rawWifi === 1 || rawWifi === '1' || rawWifi === true || rawWifi === 'true'
            ? 1
            : (rawWifi === 0 || rawWifi === '0' || rawWifi === false || rawWifi === 'false' ? 0 : null);

        return {
            type: String(source.type || source.componentType || '').trim(),
            name: String(source.name || source.value || source.productName || '').trim(),
            supplier: String(source.supplier || '').trim(),
            ean: String(source.ean || '').trim(),
            wifi: normalizedWifi
        };
    }

    function extractEanFromText(textValue) {
        const value = String(textValue || '').trim();
        if (/^[A-Z0-9._\-]{5,}$/i.test(value) && /\d/.test(value)) {
            return normalizeEan(value);
        }

        const match = value.match(/\b\d{5,14}\b/);
        return match ? normalizeEan(match[0]) : '';
    }

    function isRuleMatchedByComponents(rule, components) {
        if (!rule.enabled) return false;

        
        if (isFpsBoosterCategory(rule) || isFinalCategory(rule)) {
            return false;
        }

        
        
        if (isMoboWifiCategory(rule)) {
            return !motherboardHasWifi(components);
        }

        const expectedEans = Array.isArray(rule.articleEans) && rule.articleEans.length
            ? rule.articleEans.map(normalizeEan).filter(Boolean)
            : [normalizeEan(rule.articleEan)].filter(Boolean);
        const expectedLabelCores = extractRuleLabelCore(rule);

        if (expectedEans.length === 0 && expectedLabelCores.length === 0) return false;

        return components.some((component) => {
            const componentEan = normalizeEan(component.ean) || extractEanFromText(component.name);
            if (componentEan && expectedEans.includes(componentEan)) {
                return true;
            }

            if (expectedLabelCores.length === 0) {
                return false;
            }

            const componentName = normalizeComparableText(component.name);
            if (!componentName) {
                return false;
            }

            return expectedLabelCores.some((expectedLabelCore) => {
                return componentName.includes(expectedLabelCore) || expectedLabelCore.includes(componentName);
            });
        });
    }

    function buildPlaceholders(order, components, matchedRule) {
        const matchedArticle = String(matchedRule?.articleLabel || '').trim();

        const customerName = extractFirstName(order);
        const orderNumber = extractOrderNumber(order);

        const componentsList = components
            .map((component) => {
                const label = component.name || component.ean || component.type || 'Componente';
                const typeSuffix = component.type ? ` [${component.type}]` : '';
                return `${label}${typeSuffix}`;
            })
            .join(', ');

        return {
            orderName: String(order.name || order.orderName || ''),
            orderId: String(order.id || ''),
            orderNumber,
            customerName,
            billingName: String(order.billingName || ''),
            email: String(order.email || ''),
            phone: String(order.phone || ''),
            configName: String(order.configName || ''),
            total: String(order.total || ''),
            currency: String(order.currency || ''),
            matchedComponent: matchedArticle,
            matchedComponents: matchedArticle,
            componentsList,
            suggestion: '',
            matchedArticle,
            today: new Date().toLocaleDateString('it-IT')
        };
    }

    function applyTemplate(template, placeholders) {
        return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key) => {
            return placeholders[key] !== undefined ? String(placeholders[key]) : '';
        });
    }

    function extractOrderNumber(order) {
        const rawValue = String(
            order?.name
            || order?.orderName
            || order?.order_number
            || order?.orderNumber
            || ''
        ).trim();

        if (!rawValue) {
            return '';
        }

        if (rawValue.startsWith('#')) {
            return rawValue;
        }

        const numericLikeValue = rawValue.match(/^\d+(?:\.\d+)?$/);
        if (numericLikeValue) {
            return `#${rawValue}`;
        }

        const embeddedNumberMatch = rawValue.match(/#\d+(?:\.\d+)?/);
        return embeddedNumberMatch ? embeddedNumberMatch[0] : rawValue;
    }

    function extractFirstName(order) {
        const directFirstName = String(order?.customer?.first_name || order?.firstName || '').trim();
        if (directFirstName) {
            return directFirstName;
        }

        const fullName = String(order?.customerName || order?.billingName || '').trim();
        if (!fullName) {
            return 'cliente';
        }

        return fullName.split(/\s+/).filter(Boolean)[0] || 'cliente';
    }

    function joinMessageSections(sections) {
        const normalizedSections = Array.isArray(sections)
            ? sections.map(section => String(section || '').trim()).filter(Boolean)
            : [];

        return normalizedSections.join(`\n\n${MESSAGE_SECTION_SEPARATOR}\n\n`);
    }

    function resolveConfig(overrideConfig) {
        return normalizeConfig(overrideConfig || loadConfig());
    }

    function normalizeComponentsFromOptions(options) {
        const rawComponents = Array.isArray(options?.components) ? options.components : [];
        return rawComponents.map(normalizeComponent).filter(component => {
            return component.name || component.ean || component.type || component.supplier;
        });
    }

    function getCategoryPriority(config) {
        return Array.isArray(config?.defaults?.templateCategoryPriority)
            ? config.defaults.templateCategoryPriority.map(item => String(item || '').trim().toUpperCase())
            : DEFAULT_TEMPLATE_CATEGORY_PRIORITY;
    }

    function getRulePriorityIndex(categoryPriority, rule) {
        const category = String(rule?.templateCategory || '').trim().toUpperCase();
        const idx = categoryPriority.indexOf(category);
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    }

    function getMatchedRules(config, components) {
        const categoryPriority = getCategoryPriority(config);

        return config.rules
            .filter(rule => isRuleMatchedByComponents(rule, components))
            .sort((a, b) => getRulePriorityIndex(categoryPriority, a) - getRulePriorityIndex(categoryPriority, b));
    }

    function getApplicableRulesForOrder(_order, options, overrideConfig) {
        const config = resolveConfig(overrideConfig);
        const components = normalizeComponentsFromOptions(options);

        return getMatchedRules(config, components).map(rule => ({ ...rule }));
    }

    function resolveSelectedRule(config, components, selectedRuleId = null) {
        const matchedRules = getMatchedRules(config, components);

        if (selectedRuleId) {
            const exactMatchedRule = matchedRules.find((rule) => String(rule.id) === String(selectedRuleId));
            if (exactMatchedRule) {
                return exactMatchedRule;
            }

            const exactRule = config.rules.find((rule) => String(rule.id) === String(selectedRuleId));
            if (exactRule) {
                return exactRule;
            }
        }

        if (!matchedRules.length) {
            return null;
        }

        return matchedRules[0];
    }

    function resolveFpsBoosterRule(config) {
        return config.rules.find((rule) => {
            return rule.enabled !== false && isFpsBoosterCategory(rule) && String(rule.messageTemplate || '').trim();
        }) || null;
    }

    function resolveFinalRule(config) {
        return config.rules.find((rule) => {
            return rule.enabled !== false && isFinalCategory(rule) && String(rule.messageTemplate || '').trim();
        }) || null;
    }

    function buildMessageForChannel(channel, order, options, overrideConfig, selectedRuleId = null) {
        const config = resolveConfig(overrideConfig);
        const channelName = channel === 'email' ? 'email' : 'whatsapp';

        const components = normalizeComponentsFromOptions(options);
        const matchedRules = getMatchedRules(config, components);
        const selectedRule = resolveSelectedRule(config, components, selectedRuleId);

        const placeholders = buildPlaceholders(order || {}, components, selectedRule);
        const chosenMessageTemplate = selectedRule?.messageTemplate || config.defaults.messageTemplate;
        const fpsBoosterRule = resolveFpsBoosterRule(config);
        const finalRule = resolveFinalRule(config);
        const fpsBoosterText = fpsBoosterRule ? applyTemplate(fpsBoosterRule.messageTemplate, placeholders) : '';
        const finalRuleText = finalRule ? applyTemplate(finalRule.messageTemplate, placeholders) : '';

        if (channelName === 'whatsapp') {
            const prioritizedRuleTexts = matchedRules
                .map((rule) => {
                    const ruleTemplate = String(rule?.messageTemplate || '').trim();
                    if (!ruleTemplate) {
                        return '';
                    }

                    const rulePlaceholders = buildPlaceholders(order || {}, components, rule);
                    return applyTemplate(ruleTemplate, rulePlaceholders).trim();
                })
                .filter(Boolean);

            const baseText = prioritizedRuleTexts.length
                ? joinMessageSections(prioritizedRuleTexts)
                : applyTemplate(config.defaults.messageTemplate, placeholders);
            const tailParts = [fpsBoosterText, finalRuleText].filter(Boolean);
            const finalText = joinMessageSections([baseText, ...tailParts]);
            return {
                channel: channelName,
                rule: selectedRule || null,
                rules: matchedRules.map(rule => ({ ...rule })),
                text: finalText,
                placeholders
            };
        }

        const subjectTemplate = config.defaults.emailSubject;
        const prioritizedRuleBodies = matchedRules
            .map((rule) => {
                const ruleTemplate = String(rule?.messageTemplate || '').trim();
                if (!ruleTemplate) {
                    return '';
                }

                const rulePlaceholders = buildPlaceholders(order || {}, components, rule);
                return applyTemplate(ruleTemplate, rulePlaceholders).trim();
            })
            .filter(Boolean);

        const baseBody = prioritizedRuleBodies.length
            ? joinMessageSections(prioritizedRuleBodies)
            : applyTemplate(chosenMessageTemplate, placeholders);
        const tailParts = [fpsBoosterText, finalRuleText].filter(Boolean);
        const finalBody = joinMessageSections([baseBody, ...tailParts]);

        return {
            channel: channelName,
            rule: selectedRule || null,
            rules: matchedRules.map(rule => ({ ...rule })),
            subject: applyTemplate(subjectTemplate, placeholders),
            body: finalBody,
            placeholders
        };
    }

    window.MessageTemplateEngine = {
        MESSAGE_TEMPLATE_API_URL,
        createDefaultConfig,
        createDefaultRule,
        normalizeConfig,
        loadConfig,
        saveConfig,
        init,
        getApplicableRulesForOrder,
        buildMessageForChannel
    };
})();
