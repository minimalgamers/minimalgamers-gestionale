import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Alias storici dei valori di variante (21/09/2026).
// Su Shopify "HDD 1TB AGGIUNTIVO" e' diventato "1TB AGGIUNTIVO": le righe di
// mappatura nel DB e gli ordini gia' registrati portano ancora il testo vecchio.
// Le due forme devono ridursi alla stessa chiave, in entrambe le direzioni.
const source = readFileSync(new URL('../assets/js/gpo-manager.js', import.meta.url), 'utf8');
const sandbox = {
  window: {},
  fetch: () => { throw new Error('fetch non deve essere chiamata dal test'); },
  console: { log() {}, error() {}, warn() {} }
};
vm.createContext(sandbox);
vm.runInContext(`${source}\nwindow.__setCache = (rows) => { gpoMappingsCache = rows; };`, sandbox);
const { findGpoMapping, normalizeGpoVariantValue, __setCache } = sandbox.window;

// --- normalizzazione diretta ---
assert.equal(normalizeGpoVariantValue('HDD 1TB AGGIUNTIVO'), '1TB AGGIUNTIVO');
assert.equal(normalizeGpoVariantValue('hdd 2tb aggiuntivo'), '2TB AGGIUNTIVO');
assert.equal(normalizeGpoVariantValue('HARD DISK 4TB AGGIUNTIVO'), '4TB AGGIUNTIVO');
assert.equal(normalizeGpoVariantValue('HARDDISK 1TB AGGIUNTIVO'), '1TB AGGIUNTIVO');
assert.equal(normalizeGpoVariantValue('1TB AGGIUNTIVO'), '1TB AGGIUNTIVO');

// il prefisso si toglie solo davanti a una taglia: nessun falso positivo
assert.equal(normalizeGpoVariantValue('HDD SEAGATE BARRACUDA'), 'HDD SEAGATE BARRACUDA');
assert.equal(normalizeGpoVariantValue('SSD M.2 NVMe 1TB'), 'SSD M.2 NVME 1TB');
assert.equal(normalizeGpoVariantValue('MEMORIA RAM 32GB'), 'MEMORIA RAM 32GB');

// --- una sola riga serve prima e dopo il rename ---
const rows = [
  { id: 1, variable: 'ARCHIVIAZIONE AGGIUNTIVA', variant_value: 'HDD 1TB AGGIUNTIVO', ean: 'EAN-HDD-1TB', component_name: 'Seagate Barracuda 1TB', supplier: 'ACTION', updated_at: '2026-09-10T00:00:00Z' },
  { id: 2, variable: 'ARCHIVIAZIONE AGGIUNTIVA', variant_value: '2TB AGGIUNTIVO', ean: 'EAN-HDD-2TB', component_name: 'Seagate Barracuda 2TB', supplier: 'ACTION', updated_at: '2026-09-21T00:00:00Z' }
];
__setCache(rows);

// riga vecchia nel DB + ordine nuovo da Shopify
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', '1TB AGGIUNTIVO', 'PC GAMING REX').ean, 'EAN-HDD-1TB');
// riga vecchia nel DB + ordine storico
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', 'HDD 1TB AGGIUNTIVO', 'PC GAMING REX').ean, 'EAN-HDD-1TB');
// riga gia' aggiornata + ordine storico
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', 'HDD 2TB AGGIUNTIVO', 'PC GAMING REX').ean, 'EAN-HDD-2TB');
// riga gia' aggiornata + ordine nuovo
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', '2TB AGGIUNTIVO', 'PC GAMING REX').ean, 'EAN-HDD-2TB');
// vale anche per le linee MSI e DEEPCOOL, che ricadono sulla riga globale
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', '1TB AGGIUNTIVO', 'MSI ATLAS').ean, 'EAN-HDD-1TB');
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', '1TB AGGIUNTIVO', 'DEEPCOOL CRYO').ean, 'EAN-HDD-1TB');
// un valore inesistente resta null
assert.equal(findGpoMapping('ARCHIVIAZIONE AGGIUNTIVA', '8TB AGGIUNTIVO', 'PC GAMING REX'), null);

console.log('hdd-alias: "HDD 1TB AGGIUNTIVO" e "1TB AGGIUNTIVO" risolvono la stessa riga, nessun falso positivo — PASS');
