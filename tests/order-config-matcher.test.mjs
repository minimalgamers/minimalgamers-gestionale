import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/order-config-matcher.js', import.meta.url), 'utf8');
const sandbox = {
  window: {},
  console: { log() {}, warn() {}, error() {} }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { identifyPCConfigFromConfigs, PRODUCT_ID_CONFIG_KEYS, CONFIG_KEY_ALIASES } = sandbox.window.OrderConfigMatcher;
const configs = Object.fromEntries(
  Object.values(PRODUCT_ID_CONFIG_KEYS).map(configKey => [configKey, {
    fullName: `TITOLO CORRENTE ${configKey}`,
    components: [{ type: 'CPU', value: `CPU ${configKey}` }]
  }])
);
Object.assign(configs, {
  'PC GAMING PERFY': {
    fullName: 'PC GAMING PERFY - TITOLO ATTUALE',
    components: [{ type: 'CPU', value: 'INTEL I5 14600K' }]
  },
  'PC GAMING HELLSTORM': {
    fullName: 'PC GAMING HELLSTORM - TITOLO ATTUALE',
    components: [{ type: 'CPU', value: 'RYZEN 7 5700X3D' }]
  },
  '[PC+MONITOR+KIT] PC GAMING RTX 5070': {
    fullName: '[PC+MONITOR+KIT] PC GAMING RTX 5070 - TITOLO ATTUALE',
    components: [{ type: 'GPU', value: 'RTX 5070' }]
  },
  'PC GAMING SOLO TITOLO': {
    fullName: 'PC GAMING SOLO TITOLO - ESATTO',
    components: [{ type: 'CPU', value: 'TEST' }]
  }
});

const renamedPerfy = identifyPCConfigFromConfigs(
  'UN TITOLO COMPLETAMENTE NUOVO',
  configs,
  false,
  7374130839741
);
assert.equal(renamedPerfy.configKey, 'PC GAMING PERFY');
assert.equal(renamedPerfy.matchSource, 'product_id');
assert.equal(renamedPerfy.isFallback, false);

const gidHellstorm = identifyPCConfigFromConfigs(
  '',
  configs,
  false,
  'gid://shopify/Product/8458647011671'
);
assert.equal(gidHellstorm.configKey, 'PC GAMING HELLSTORM');
assert.equal(gidHellstorm.matchSource, 'product_id');

const exactTitle = identifyPCConfigFromConfigs(
  'PC  GAMING SOLO TITOLO - ESATTO',
  configs,
  false,
  999999999
);
assert.equal(exactTitle.configKey, 'PC GAMING SOLO TITOLO');
assert.equal(exactTitle.matchSource, 'exact_title');

const renamedBundle = identifyPCConfigFromConfigs(
  'BUNDLE NOME NUOVO SENZA PARENTESI',
  configs,
  false,
  10739861520727
);
assert.equal(renamedBundle.configKey, '[PC+MONITOR+KIT] PC GAMING RTX 5070');
assert.equal(renamedBundle.matchSource, 'product_id');

assert.equal(identifyPCConfigFromConfigs('PRODOTTO NON MAPPATO', configs, true, 999), null);
assert.equal(Object.isFrozen(PRODUCT_ID_CONFIG_KEYS), true);
assert.equal(Object.isFrozen(CONFIG_KEY_ALIASES), true);
assert.equal(Object.keys(PRODUCT_ID_CONFIG_KEYS).length, 69);

// Nuove build Minimal (fase 2E, 18/09/2026): id stabile -> chiave config.
const newBuildVolt = identifyPCConfigFromConfigs(
  'PC GAMING VOLT - RYZEN 5 5500F 2026 + INTEL ARC B580 12GB GDDR6 + 16GB RAM DDR4 3200MHz + SSD M.2 NVMe 500GB',
  configs,
  false,
  'gid://shopify/Product/11191758750039'
);
assert.equal(newBuildVolt.configKey, 'PC GAMING VOLT');
assert.equal(newBuildVolt.matchSource, 'product_id');
assert.equal(PRODUCT_ID_CONFIG_KEYS['11191796629847'], 'PC GAMING ARMAGEDDON');
// PERFY archiviata ma ancora riconosciuta per gli ordini storici.
assert.equal(PRODUCT_ID_CONFIG_KEYS['7374130839741'], 'PC GAMING PERFY');

// Build MSI (fase 3, 19/09/2026): id stabile -> chiave config esistente/nuova.
const msiOmega = identifyPCConfigFromConfigs(
  'MSI OMEGA - PC GAMING RYZEN 9 9950X3D + RTX 5090 32GB GDDR7 + 32GB RAM DDR5 6000MHz + SSD M.2 NVMe 1TB + AIO 360 LIQUIDO',
  configs,
  false,
  'gid://shopify/Product/10487168041303'
);
assert.equal(msiOmega.configKey, 'MSI OMEGA');
assert.equal(msiOmega.matchSource, 'product_id');
assert.equal(PRODUCT_ID_CONFIG_KEYS['11192508547415'], 'MSI VIPER');
assert.equal(PRODUCT_ID_CONFIG_KEYS['11192508645719'], 'MSI BUNDLE BASTION');
assert.equal(PRODUCT_ID_CONFIG_KEYS['11192864735575'], 'SETUP VOLT');
assert.equal(PRODUCT_ID_CONFIG_KEYS['11192864768343'], 'SETUP SINNER');

// MSI NEBULA: il record storico del DB si chiama 'NEBULA'.
const legacyNebulaConfigs = {
  'NEBULA': {
    fullName: 'MSI NEBULA - Intel i7 14700K 5.6Ghz + RTX 5070 12GB GDDR7 + 16B RAM DDR5 + SSD M.2 500GB',
    components: [{ type: 'GPU', value: 'V532-003R' }]
  }
};
const nebulaFromStableId = identifyPCConfigFromConfigs(
  'MSI NEBULA - PC GAMING INTEL CORE i7-14700KF + RTX 5070 12GB GDDR7 + 16GB RAM DDR5 6000MHz + SSD M.2 NVMe 1TB + AIO 240 LIQUIDO',
  legacyNebulaConfigs,
  false,
  10487191896407
);
assert.equal(nebulaFromStableId.configKey, 'MSI NEBULA');
assert.equal(nebulaFromStableId.resolvedConfigKey, 'NEBULA');
assert.equal(nebulaFromStableId.matchSource, 'product_id');
const nebulaByTitle = identifyPCConfigFromConfigs(
  'MSI NEBULA - Intel i7 14700K 5.6Ghz + RTX 5070 12GB GDDR7 + 16B RAM DDR5 + SSD M.2 500GB',
  legacyNebulaConfigs,
  false,
  null
);
assert.equal(nebulaByTitle.configKey, 'MSI NEBULA');
assert.equal(nebulaByTitle.resolvedConfigKey, 'NEBULA');
assert.equal(nebulaByTitle.matchSource, 'exact_title');

const legacyMirageConfigs = {
  'INFERNUS CUSTOM': {
    fullName: '[CUSTOM] PC GAMING INFERNUS - RYZEN 9 9950X3D + RTX 5080',
    components: [{ type: 'GPU', value: 'RTX 5080' }]
  }
};
const mirageFromStableId = identifyPCConfigFromConfigs(
  'PC GAMING MIRAGE - TITOLO SHOPIFY NUOVO',
  legacyMirageConfigs,
  false,
  10786981806423
);
assert.equal(mirageFromStableId.configKey, 'PC GAMING MIRAGE');
assert.equal(mirageFromStableId.resolvedConfigKey, 'INFERNUS CUSTOM');
assert.equal(mirageFromStableId.matchSource, 'product_id');

const renamedMirageConfigs = {
  'PC GAMING MIRAGE': {
    fullName: 'PC GAMING MIRAGE - RTX 5080 + RYZEN 9 9950X3D',
    components: [{ type: 'GPU', value: 'RTX 5080' }]
  }
};
const mirageAfterDbRename = identifyPCConfigFromConfigs(
  'QUALSIASI TITOLO FUTURO',
  renamedMirageConfigs,
  false,
  'gid://shopify/Product/10786981806423'
);
assert.equal(mirageAfterDbRename.configKey, 'PC GAMING MIRAGE');
assert.equal(mirageAfterDbRename.matchSource, 'product_id');
assert.equal('resolvedConfigKey' in mirageAfterDbRename, false);

const historicMirageWithoutId = identifyPCConfigFromConfigs(
  '[CUSTOM] PC GAMING INFERNUS - RYZEN 9 9950X3D 5.7GHZ + RTX 5080 16GB GDDR7',
  renamedMirageConfigs,
  false
);
assert.equal(historicMirageWithoutId.configKey, 'PC GAMING MIRAGE');
assert.equal(historicMirageWithoutId.matchSource, 'legacy_title');

for (const [productId, expectedConfigKey] of Object.entries(PRODUCT_ID_CONFIG_KEYS)) {
  const result = identifyPCConfigFromConfigs('TITOLO RINOMINATO', configs, false, productId);
  assert.equal(result.configKey, expectedConfigKey);
  assert.equal(result.matchSource, 'product_id');
  assert.equal(result.isFallback, false);
}

console.log('order-config-matcher: base + MIRAGE rename compatibility + product_id map 69/69 PASS');
