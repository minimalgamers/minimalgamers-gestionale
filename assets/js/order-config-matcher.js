(function (globalScope) {
    function normalizeSpaces(value) {
        return String(value || '').replace(/\s+/g, ' ');
    }

    function identifyPCConfigFromConfigs(productName, configs, silent = false) {
        if (!productName) return null;

        const normalizedName = normalizeSpaces(productName);
        const safeConfigs = configs && typeof configs === 'object' ? configs : {};

        for (const [configKey, config] of Object.entries(safeConfigs)) {
            if (!config || !config.fullName) continue;

            const normalizedFullName = normalizeSpaces(config.fullName);
            if (normalizedName === normalizedFullName) {
                return {
                    configKey,
                    fullName: config.fullName,
                    components: config.components,
                    isFallback: false
                };
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
        identifyPCConfigFromConfigs
    };
    console.log('✅ OrderConfigMatcher v25 attivo (bundle multi-GPU)');
})(window);
