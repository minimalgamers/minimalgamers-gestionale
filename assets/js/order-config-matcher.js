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
})(window);
