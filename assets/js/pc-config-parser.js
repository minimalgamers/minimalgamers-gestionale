




let PC_CONFIGS = {};


const CONFIGS_API_URL = 'api_gateway/db_bridge/configs_service/endpoint/api-configs.php';






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






function identifyPCConfig(productName, silent = false) {
    if (window.OrderConfigMatcher && typeof window.OrderConfigMatcher.identifyPCConfigFromConfigs === 'function') {
        return window.OrderConfigMatcher.identifyPCConfigFromConfigs(productName, PC_CONFIGS, silent);
    }

    console.error('❌ Modulo OrderConfigMatcher non caricato');
    return null;
}
