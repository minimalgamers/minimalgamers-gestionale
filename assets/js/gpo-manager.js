



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

function findGpoMapping(variable, variantValue) {
    if (!gpoMappingsCache || gpoMappingsCache.length === 0) {
        return null;
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
        return {
            ean: mapping.ean,
            component_name: mapping.component_name,
            supplier: mapping.supplier
        };
    }

    return null;
}

function resolveVariantTypeFromKeyAndValue(key, value) {
    const upperKey = String(key || '').toUpperCase();
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
