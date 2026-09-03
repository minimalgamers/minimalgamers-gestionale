




let PC_CONFIGS = {};


const CONFIGS_API_URL = 'api_gateway/db_bridge/configs_service/endpoint/api-configs.php';

const LEGACY_MIRAGE_CONFIG = 'INFERNUS CUSTOM';
const MIRAGE_CONFIG = 'PC GAMING MIRAGE';

function getMirageFullName(config) {
    const currentName = String(config?.fullName || '').trim();
    if (!currentName) return MIRAGE_CONFIG;

    return currentName
        .replace(/^\[CUSTOM\]\s*PC\s+GAMING\s+INFERNUS\b/i, MIRAGE_CONFIG)
        .replace(/^PC\s+GAMING\s+INFERNUS\b/i, MIRAGE_CONFIG)
        .replace(/^INFERNUS\s+CUSTOM\b/i, MIRAGE_CONFIG);
}

async function migrateLegacyMirageConfig(configs) {
    const legacyConfig = configs?.[LEGACY_MIRAGE_CONFIG];
    if (!legacyConfig || configs[MIRAGE_CONFIG]) return configs;

    const migratedConfig = {
        fullName: getMirageFullName(legacyConfig),
        components: Array.isArray(legacyConfig.components) ? legacyConfig.components : []
    };

    // Prima crea la nuova chiave e solo dopo elimina quella storica: in caso di
    // errore non perdiamo mai i componenti della build.
    const saved = await saveConfigToDatabase(MIRAGE_CONFIG, migratedConfig);
    if (!saved) {
        console.warn('⚠️ Migrazione MIRAGE rimandata: creazione nuova chiave non riuscita');
        return configs;
    }

    const deleted = await deleteConfigFromDatabase(LEGACY_MIRAGE_CONFIG);
    if (!deleted) {
        console.warn('⚠️ MIRAGE creata, ma la chiave storica non è stata ancora rimossa');
    }

    configs[MIRAGE_CONFIG] = migratedConfig;
    delete configs[LEGACY_MIRAGE_CONFIG];
    console.log('✅ Configurazione rinominata: INFERNUS CUSTOM → PC GAMING MIRAGE');
    return configs;
}






async function saveConfigToDatabase(configName, configData) {
    try {
        const response = await fetch(CONFIGS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                config_name: configName,
                full_name: configData.fullName || '',
                components: configData.components
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Configurazione salvata nel database:', configName);
            return true;
        } else {
            console.error('❌ Errore salvataggio configurazione:', data.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Errore salvataggio configurazione:', error);
        return false;
    }
}






async function updateConfigInDatabase(configName, configData) {
    try {
        const response = await fetch(CONFIGS_API_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                config_name: configName,
                full_name: configData.fullName || '',
                components: configData.components
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Configurazione aggiornata nel database:', configName);
            return true;
        } else {
            console.error('❌ Errore aggiornamento configurazione:', data.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Errore aggiornamento configurazione:', error);
        return false;
    }
}





async function deleteConfigFromDatabase(configName) {
    try {
        const response = await fetch(`${CONFIGS_API_URL}?name=${encodeURIComponent(configName)}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Configurazione eliminata dal database:', configName);
            
            delete PC_CONFIGS[configName];
            return true;
        } else {
            console.error('❌ Errore eliminazione configurazione:', data.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Errore eliminazione configurazione:', error);
        return false;
    }
}




async function loadPCConfigs() {
    try {
        
        const response = await fetch(CONFIGS_API_URL);
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.success && data.configs) {
                PC_CONFIGS = data.configs;
                PC_CONFIGS = await migrateLegacyMirageConfig(PC_CONFIGS);
                console.log('✅ Configurazioni PC caricate dal database:', Object.keys(PC_CONFIGS).length);
                return PC_CONFIGS;
            }
        }
        
        console.error('❌ Impossibile caricare le configurazioni dal database');
        return {};
    } catch (error) {
        console.error('❌ Errore caricamento configurazioni PC:', error);
        return {};
    }
}


loadPCConfigs();






function identifyPCConfig(productName, silent = false, productId = null) {
    if (window.OrderConfigMatcher && typeof window.OrderConfigMatcher.identifyPCConfigFromConfigs === 'function') {
        return window.OrderConfigMatcher.identifyPCConfigFromConfigs(productName, PC_CONFIGS, silent, productId);
    }

    console.error('❌ Modulo OrderConfigMatcher non caricato');
    return null;
}
