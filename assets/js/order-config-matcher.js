// ============================================================
// ORDER CONFIG MATCHER v13 - Minimal Gamers
// ============================================================
// Strategia di match (in ordine di priorità):
//  1. Match esatto del nome (come l'originale)
//  2. Match esatto normalizzato (case-insensitive, whitespace collassato, trim)
//  3. Match per "nome breve" estratto dal nome prodotto
//     es. "PC GAMING SINNER - RYZEN ..." → cerca config la cui chiave finisce con "SINNER"
//  4. Match per parentesi quadre [REX] (come l'originale)
// ============================================================
(function (globalScope) {
    function normalize(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    function normalizeStrong(value) {
        return normalize(value).toLowerCase();
    }

    function identifyPCConfigFromConfigs(productName, configs, silent = false) {
        if (!productName) return null;

        const safeConfigs = configs && typeof configs === 'object' ? configs : {};
        const configEntries = Object.entries(safeConfigs);
        if (configEntries.length === 0) {
            if (!silent) console.warn('⚠️ Config matcher: PC_CONFIGS vuoto (ancora in caricamento?)');
            return null;
        }

        const normalizedName = normalize(productName);
        const normalizedNameLower = normalizeStrong(productName);

        // ---- 1. Match esatto del nome prodotto ↔ fullName
        for (const [configKey, config] of configEntries) {
            if (!config || !config.fullName) continue;
            if (normalize(config.fullName) === normalizedName) {
                return {
                    configKey,
                    fullName: config.fullName,
                    components: config.components,
                    isFallback: false
                };
            }
        }

        // ---- 2. Match normalizzato case-insensitive
        for (const [configKey, config] of configEntries) {
            if (!config || !config.fullName) continue;
            if (normalizeStrong(config.fullName) === normalizedNameLower) {
                return {
                    configKey,
                    fullName: config.fullName,
                    components: config.components,
                    isFallback: false
                };
            }
        }

        // ---- 3. Match per nome breve (la parte distintiva)
        //
        // I config_key sono tipo "PC GAMING SINNER", "MSI BASTION", "[CUSTOM] REX",
        // "[PC+MONITOR+KIT]", "NEBULA". L'ultima parola (o tutto se è 1-2 parole)
        // di solito è il nome distintivo: SINNER, BASTION, REX, NEBULA…
        //
        // BLACKLIST: parole troppo generiche che NON identificano un modello.
        // Senza questa lista, "PC GAMING" matcherebbe qualsiasi cosa.
        const GENERIC_WORDS = new Set([
            'PC', 'GAMING', 'MSI', 'CUSTOM', 'INTEL', 'AMD', 'RYZEN', 'CORE',
            'MONITOR', 'KIT', 'COPIA', 'NEW', 'BLACK', 'WHITE', 'RGB',
            'PC+MONITOR+KIT'
        ]);

        const shortKeyMap = []; // [{configKey, shortKey, config}]
        for (const [configKey, config] of configEntries) {
            if (!config) continue;
            let key = String(configKey).toUpperCase();

            const inBrackets = key.match(/\[([^\]]+)\]/);
            const cleaned = key.replace(/\[[^\]]+\]/g, '').trim();
            // Cerco l'ultima parola distintiva (non in blacklist, almeno 4 caratteri)
            const words = cleaned.split(/\s+/).filter(w => w);
            let distinctive = null;
            for (let i = words.length - 1; i >= 0; i--) {
                const w = words[i].replace(/[^A-Z0-9+]/g, '');
                if (w.length >= 4 && !GENERIC_WORDS.has(w) && !/^V\.?\d+/.test(w)) {
                    distinctive = w;
                    break;
                }
            }
            if (distinctive) {
                shortKeyMap.push({ configKey, shortKey: distinctive, config });
            }
            // Aggiungo anche il contenuto delle parentesi se distintivo
            if (inBrackets) {
                const b = inBrackets[1].toUpperCase().replace(/[^A-Z0-9+]/g, '');
                if (b.length >= 4 && !GENERIC_WORDS.has(b)) {
                    shortKeyMap.push({ configKey, shortKey: b, config });
                }
            }
        }

        // Provo a far match: il nome prodotto contiene la shortKey come parola intera?
        // Uso uppercase per il confronto.
        const productUpper = ' ' + String(productName).toUpperCase().replace(/[^\w+]/g, ' ') + ' ';
        for (const { configKey, shortKey, config } of shortKeyMap) {
            // Cerco la shortKey come parola intera (bordata da non-alfanumerici)
            const sk = shortKey.replace(/[^\w+]/g, '');
            if (!sk) continue;
            // Regex per cercare la parola intera
            const re = new RegExp('(?:^|[^\\w+])' + sk.replace(/[+]/g, '\\+') + '(?:$|[^\\w+])');
            if (re.test(productUpper)) {
                if (!silent) {
                    console.warn(`🔁 FUZZY MATCH: "${String(productName).substring(0, 60)}…" → config "${configKey}" (parola chiave: ${shortKey})`);
                }
                return {
                    configKey,
                    fullName: (config && config.fullName) || '',
                    components: config ? config.components : [],
                    isFallback: true,
                    fallbackReason: `Match parola chiave "${shortKey}"`
                };
            }
        }

        // ---- 4. Match per parentesi quadre [REX] (compat originale)
        const bracketMatch = String(productName).match(/\[([^\]]+)\]/);
        if (bracketMatch) {
            const shortName = bracketMatch[1];
            for (const [configKey, config] of configEntries) {
                const fullName = (config && config.fullName) || '';
                if (configKey.includes(shortName) || fullName.includes(`[${shortName}]`)) {
                    if (!silent) {
                        console.warn(`⚠️ FALLBACK su parentesi: "${String(productName).substring(0, 50)}…" → config "${configKey}"`);
                    }
                    return {
                        configKey,
                        fullName,
                        components: config.components,
                        isFallback: true,
                        fallbackReason: `Match su [${shortName}]`
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
    console.log('✅ OrderConfigMatcher v13 attivo');
})(window);
