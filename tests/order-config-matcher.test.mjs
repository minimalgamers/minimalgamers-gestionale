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

const { identifyPCConfigFromConfigs, PRODUCT_ID_CONFIG_KEYS } = sandbox.window.OrderConfigMatcher;
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
assert.equal(Object.keys(PRODUCT_ID_CONFIG_KEYS).length, 27);

for (const [productId, expectedConfigKey] of Object.entries(PRODUCT_ID_CONFIG_KEYS)) {
  const result = identifyPCConfigFromConfigs('TITOLO RINOMINATO', configs, false, productId);
  assert.equal(result.configKey, expectedConfigKey);
  assert.equal(result.matchSource, 'product_id');
  assert.equal(result.isFallback, false);
}

console.log('order-config-matcher: base 6/6 + product_id map 27/27 PASS');
