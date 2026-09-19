



const GPO_MAPPING_API_URL_GLOBAL = 'api_gateway/db_bridge/components_service/endpoint/api-gpo-mapping.php';

let gpoMappingsCache = [];

async function loadGpoMappingsGlobal() {
    try {
        const response = await fetch(GPO_MAPPING_API_URL_GLOBAL);
        const data = await response.json();

        if (data.success && data.mappings) {
            gpoMappingsCache = data.mappings;
            return gpoMappingsCache;
        }
        return [];
    } catch (error) {
        console.error('❌ Errore caricamento GPO mappings:', error);
        return [];
    }
}

// --- Scope per linea di prodotto (19/09/2026) -------------------------------
// Le build Minimal (REX ecc.) vivono di brand a rotazione: conta la classe del
// pezzo (B650, RTX 5070), non la marca. Le build MSI sono l'opposto: il pezzo
// ordinato deve essere SEMPRE quello MSI della distinta.
// Nel DB le mappature delle build MSI hanno la variabile prefissata
// ("MSI GPU", "MSI SCHEDA MADRE", ...). Senza questo scope una sola riga
// servirebbe entrambe le linee (28 testi di variante sono identici tra set
// Minimal e set MSI) e l'ordine MSI riceverebbe il pezzo scelto per la Minimal.
const GPO_LINE_SCOPES = Object.freeze([
    { prefix: 'MSI', test: /^\s*MSI\b/i }
]);

function resolveGpoLineScope(configKey) {
    const key = String(configKey || '');
    if (!key) return null;
    const scope = GPO_LINE_SCOPES.find(item => item.test.test(key));
    return scope ? scope.prefix : null;
}

// "MSI GPU" -> { scope: 'MSI', base: 'GPU' } ; "GPU" -> { scope: null, base: 'GPU' }
function splitGpoScopedVariable(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    for (const item of GPO_LINE_SCOPES) {
        const head = item.prefix + ' ';
        if (raw.startsWith(head) && raw.length > head.length) {
            return { scope: item.prefix, base: raw.slice(head.length) };
        }
    }
    return { scope: null, base: raw };
}

function normalizeGpoVariableName(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (normalized === 'MOBO' || normalized === 'MOTHERBOARD') return 'SCHEDA MADRE';
    if (normalized === 'SSD AGGIUNTIVO') return 'SSD ADDON';
    if (normalized === 'DISSIPATORE') return 'COOLER';
    if (normalized === 'ALIMENTATORE') return 'PSU';
    return normalized;
}

function normalizeGpoVariantValue(value) {
    return String(value || '')
        .replace(/ /g, ' ')
        .replace(/[‐‑‒–—―]/g, '-')
        .replace(/\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

// configKey = chiave della configurazione dell'ordine (es. "MSI ORION", "REX").
// Ricerca a due passi: prima la riga della linea (MSI), poi quella globale.
function findGpoMapping(variable, variantValue, configKey = null) {
    if (!gpoMappingsCache || gpoMappingsCache.length === 0) {
        return null;
    }

    const requestedScope = resolveGpoLineScope(configKey);
    const normalizedVariable = normalizeGpoVariableName(splitGpoScopedVariable(variable).base);
    const normalizedValue = normalizeGpoVariantValue(variantValue);

    const pickNewest = (rows) => rows.sort((left, right) => {
        const leftUpdated = new Date(left.updated_at || left.created_at || 0).getTime();
        const rightUpdated = new Date(right.updated_at || right.created_at || 0).getTime();
        if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;

        const leftId = parseInt(left.id, 10) || 0;
        const rightId = parseInt(right.id, 10) || 0;
        return rightId - leftId;
    })[0];

    // Un ordine MSI cerca prima "MSI <VARIABILE>"; una build Minimal (scope null)
    // vede solo le righe globali e non puo' mai pescare un pezzo MSI dedicato.
    const attempts = requestedScope ? [requestedScope, null] : [null];

    for (const wantedScope of attempts) {
        const candidates = gpoMappingsCache.filter(m => {
            const parts = splitGpoScopedVariable(m.variable);
            if (parts.scope !== wantedScope) return false;
            if (normalizeGpoVariableName(parts.base) !== normalizedVariable) return false;
            return normalizeGpoVariantValue(m.variant_value) === normalizedValue;
        });

        if (candidates.length === 0) continue;

        const mapping = pickNewest(candidates);
        if (!mapping) continue;

        if (requestedScope && wantedScope === null) {
            console.warn(`[GPO scope] "${normalizedVariable}" / "${normalizedValue}": manca la riga ${requestedScope}, uso quella globale (verificare il pezzo)`);
        }

        return {
            ean: mapping.ean,
            component_name: mapping.component_name,
            supplier: mapping.supplier,
            scope: wantedScope,
            scopeFallback: Boolean(requestedScope) && wantedScope === null
        };
    }

    return null;
}

if (typeof window !== 'undefined') {
    window.resolveGpoLineScope = resolveGpoLineScope;
    window.splitGpoScopedVariable = splitGpoScopedVariable;
    window.findGpoMapping = findGpoMapping;
}

// Valori "base" delle opzioni obbligatorie dei set GPO dedicati (18/09/2026):
// la scelta gratuita che non aggiunge nessun pezzo. Non e' un componente da
// ordinare, quindi non deve mai sostituire CASE/COOLER/SSD ADDON della distinta.
// Esempi: "VENTOLE INCLUSE NEL CASE", "SENZA SCATOLE COMPONENTI",
// "SOLO ETHERNET (SENZA WI-FI)", "NESSUN SOFTWARE AGGIUNTIVO", "NESSUN HDD AGGIUNTIVO".
const GPO_BASE_NO_COMPONENT_VALUE = /^\s*(NESSUN[AO]?\b|SENZA\b|SOLO\s+ETHERNET|VENTOLE\s+INCLUSE)/i;

function isGpoBaseNoComponentValue(value) {
    return GPO_BASE_NO_COMPONENT_VALUE.test(String(value || ''));
}

function resolveVariantTypeFromKeyAndValue(key, value) {
    const upperKey = String(key || '').toUpperCase();
    const upperValue = String(value || '').toUpperCase();

    if (isGpoBaseNoComponentValue(value)) {
        return {
            componentType: null,
            gpoSearchType: null,
            baseComponentType: null
        };
    }
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

    if (!componentType) {
        return {
            componentType: null,
            gpoSearchType: null,
            baseComponentType: null
        };
    }

    let gpoSearchType = componentType;
    let baseComponentType = componentType;

    if (componentType === 'SCHEDA MADRE') baseComponentType = 'MOBO';
    if (componentType === 'DISSIPATORE') {
        gpoSearchType = 'COOLER';
        baseComponentType = 'COOLER';
    }

    return {
        componentType,
        gpoSearchType,
        baseComponentType
    };
}
