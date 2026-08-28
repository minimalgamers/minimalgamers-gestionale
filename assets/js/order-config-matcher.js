(function (globalScope) {
    // Mappa stabile Shopify product_id -> chiave configurazione gestionale.
    // Il match per titolo resta come fallback per i prodotti non ancora censiti.
    const PRODUCT_ID_CONFIG_KEYS = Object.freeze({
        '10358135882071': 'PC GAMING TERMINATOR',
        '10239585059159': 'PC GAMING INFERNUS',
        '8450749595991': 'PC GAMING BLACKNOVA',
        '10358228844887': 'PC GAMING TITAN',
        '9932076712279': 'PC GAMING RAGNAROK',
        '10239534137687': 'PC GAMING PREDATOR',
        '10645356872023': 'PC GAMING SINNER',
        '10524971368791': 'PC GAMING MADAME',
        '10358150431063': 'PC GAMING DOMINATOR V.2',
        '10239585747287': 'PC GAMING DOMINATOR V.1',
        '10067047186775': 'PC GAMING HELLFIRE',
        '10045693526359': 'PC GAMING VANGUARD',
        '9395079840087': 'PC GAMING ZEUS',
        '8406087237975': 'PC GAMING NEMESIS',
        '9022880940375': 'PC GAMING STERMINATOR',
        '7374130839741': 'PC GAMING PERFY',
        '8458647011671': 'PC GAMING HELLSTORM',
        '10239011455319': 'PC GAMING STRIKE',
        '10358321119575': 'PC GAMING VORTEX',
        '9980815475031': 'PC GAMING CRIMSON',
        '9018276512087': 'PC GAMING HECTORE',
        '10291800277335': 'PC GAMING REX',
        '7451312914621': 'PC GAMING VEGA',
        '9979364901207': '[PC+MONITOR+KIT]',
        '10241024655703': '[PC+MONITOR+KIT] PC GAMING',
        '10510842331479': '[PC+MONITOR+KIT] PC GAMING ARC A770',
        '10739861520727': '[PC+MONITOR+KIT] PC GAMING RTX 5070'
    });

    function normalizeSpaces(value) {
        return String(value || '').replace(/\s+/g, ' ');
    }

    function normalizeProductId(value) {
        if (value === null || value === undefined || value === '') return '';
        return String(value).replace(/^gid:\/\/shopify\/Product\//, '').trim();
    }

    function buildResult(configKey, config, matchSource) {
        return {
            configKey,
            fullName: config.fullName,
            components: config.components,
            isFallback: false,
            matchSource
        };
    }

    function identifyPCConfigFromConfigs(productName, configs, silent = false, productId = null) {
        const safeConfigs = configs && typeof configs === 'object' ? configs : {};
        const normalizedProductId = normalizeProductId(productId);

        if (normalizedProductId && PRODUCT_ID_CONFIG_KEYS[normalizedProductId]) {
            const configKey = PRODUCT_ID_CONFIG_KEYS[normalizedProductId];
            const config = safeConfigs[configKey];
            if (config && config.fullName) {
                return buildResult(configKey, config, 'product_id');
            }

            if (!silent) {
                console.error(`❌ CONFIG PRODUCT_ID NON PRESENTE: ${normalizedProductId} → "${configKey}"`);
            }
        }

        if (!productName) return null;

        const normalizedName = normalizeSpaces(productName);

        for (const [configKey, config] of Object.entries(safeConfigs)) {
            if (!config || !config.fullName) continue;

            const normalizedFullName = normalizeSpaces(config.fullName);
            if (normalizedName === normalizedFullName) {
                return buildResult(configKey, config, 'exact_title');
            }
        }

        const bracketMatch = String(productName).match(/\[([^\]]+)\]/);
        if (bracketMatch) {
            const shortName = bracketMatch[1];

            // v25: per i bundle [PC+MONITOR+KIT] cerco la config specifica per GPU.
            // Esistono 4 config bundle nel DB con GPU diverse: RX 9060XT (#6), RTX 3050 (#25),
            // ARC A770 (#45), RTX 5070 (#46). Senza questa logica il matcher faceva fallback
            // alla prima trovata, attribuendo GPU sbagliate.
            if (shortName.includes('PC+MONITOR+KIT')) {
                const nameUpper = String(productName).toUpperCase();
                // Pattern GPU → identificatore della config nel DB
                const GPU_PATTERNS = [
                    { regex: /\bARC\s*A770\b/i,          configMarker: 'ARC A770' },
                    { regex: /\bRTX\s*5070\b/i,          configMarker: 'RTX 5070' },
                    { regex: /\bRX\s*9060\s*XT?\b/i,     configMarker: 'RX 9060' },     // fallback se la config si chiama in modo diverso
                    { regex: /\bRTX\s*3050\b/i,          configMarker: 'RTX 3050' },
                ];
                for (const { regex, configMarker } of GPU_PATTERNS) {
                    if (!regex.test(nameUpper)) continue;
                    // Cerco la config bundle che ha questa GPU specifica nel suo configKey
                    for (const [configKey, config] of Object.entries(safeConfigs)) {
                        if (!config || !config.fullName) continue;
                        if (!configKey.includes('PC+MONITOR+KIT')) continue;
                        if (configKey.toUpperCase().includes(configMarker.toUpperCase())) {
                            console.log(`✅ Bundle [PC+MONITOR+KIT] mappato su GPU "${configMarker}" → config "${configKey}"`);
                            return {
                                configKey,
                                fullName: config.fullName,
                                components: config.components,
                                isFallback: false
                            };
                        }
                    }
                    // Caso speciale: per RX 9060XT la config si chiama "[PC+MONITOR+KIT] PC GAMING" senza la GPU nel nome
                    if (configMarker === 'RX 9060') {
                        for (const [configKey, config] of Object.entries(safeConfigs)) {
                            if (configKey === '[PC+MONITOR+KIT] PC GAMING' && config?.fullName) {
                                console.log(`✅ Bundle [PC+MONITOR+KIT] RX 9060 → config base "${configKey}"`);
                                return {
                                    configKey,
                                    fullName: config.fullName,
                                    components: config.components,
                                    isFallback: false
                                };
                            }
                        }
                    }
                    // Caso speciale: per RTX 3050 la config si chiama "[PC+MONITOR+KIT]"
                    if (configMarker === 'RTX 3050') {
                        for (const [configKey, config] of Object.entries(safeConfigs)) {
                            if (configKey === '[PC+MONITOR+KIT]' && config?.fullName) {
                                console.log(`✅ Bundle [PC+MONITOR+KIT] RTX 3050 → config "${configKey}"`);
                                return {
                                    configKey,
                                    fullName: config.fullName,
                                    components: config.components,
                                    isFallback: false
                                };
                            }
                        }
                    }
                }
            }

            for (const [configKey, config] of Object.entries(safeConfigs)) {
                const fullName = (config && config.fullName) || '';
                if (configKey.includes(shortName) || fullName.includes(`[${shortName}]`)) {
                    console.warn(`⚠️ FALLBACK: "${String(productName).substring(0, 50)}..." → config "${configKey}"`);
                    return {
                        configKey,
                        fullName,
                        components: config.components,
                        isFallback: true,
                        fallbackReason: `Match su [${shortName}] - verificare configurazione`
                    };
                }
            }
        }

        if (!silent) {
            console.error(`❌ CONFIG NON TROVATA: "${productName}"`);
        }

        return null;
    }

    globalScope.OrderConfigMatcher = {
        identifyPCConfigFromConfigs,
        PRODUCT_ID_CONFIG_KEYS
    };
    console.log('✅ OrderConfigMatcher v26 attivo (product_id + fallback titolo)');
})(window);
