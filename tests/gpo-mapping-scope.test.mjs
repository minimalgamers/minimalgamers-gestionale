import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Verifica lo scope per linea delle mappature GPO (19/09/2026).
// Le build MSI devono leggere PRIMA la riga "MSI <VARIABILE>"; le build Minimal
// non devono mai poter pescare una riga dedicata MSI.
const source = readFileSync(new URL('../assets/js/gpo-manager.js', import.meta.url), 'utf8');
const warnings = [];
const sandbox = {
  window: {},
  fetch: () => { throw new Error('fetch non deve essere chiamata dal test'); },
  console: { log() {}, error() {}, warn(msg) { warnings.push(String(msg)); } }
};
vm.createContext(sandbox);
vm.runInContext(`${source}\nwindow.__setCache = (rows) => { gpoMappingsCache = rows; };`, sandbox);

const { findGpoMapping, resolveGpoLineScope, splitGpoScopedVariable, __setCache } = sandbox.window;

// --- riconoscimento della linea dalla chiave configurazione ---
assert.equal(resolveGpoLineScope('MSI ORION'), 'MSI');
assert.equal(resolveGpoLineScope('MSI BUNDLE BASTION'), 'MSI');
assert.equal(resolveGpoLineScope('MSI NEBULA'), 'MSI');
assert.equal(resolveGpoLineScope('PC GAMING REX'), null);
assert.equal(resolveGpoLineScope('MIRAGE'), null);
assert.equal(resolveGpoLineScope(null), null);
assert.equal(resolveGpoLineScope(''), null);

// --- split della variabile ---
const split = (value) => {
  const parts = splitGpoScopedVariable(value);
  return { scope: parts.scope, base: parts.base };
};
assert.deepEqual(split('MSI GPU'), { scope: 'MSI', base: 'GPU' });
assert.deepEqual(split('  msi   scheda  madre '), { scope: 'MSI', base: 'SCHEDA MADRE' });
assert.deepEqual(split('GPU'), { scope: null, base: 'GPU' });
// "MSI" da solo non e' uno scope: resta una variabile globale
assert.deepEqual(split('MSI'), { scope: null, base: 'MSI' });
// livello build, separatore "::"
assert.deepEqual(split('MSI CHIMERA::GPU'), { scope: 'MSI CHIMERA', base: 'GPU' });
assert.deepEqual(split(' msi chimera :: gpu '), { scope: 'MSI CHIMERA', base: 'GPU' });

const rows = [
  // stesso testo di variante condiviso tra le due linee
  { id: 1, variable: 'GPU', variant_value: 'RTX 5070 12GB GDDR7', ean: 'EAN-MINIMAL-5070', component_name: 'GPU generica 5070', supplier: 'OMEGA', updated_at: '2026-09-01T00:00:00Z' },
  { id: 2, variable: 'MSI GPU', variant_value: 'RTX 5070 12GB GDDR7', ean: 'EAN-MSI-5070', component_name: 'MSI RTX 5070 VENTUS', supplier: 'TIER ONE', updated_at: '2026-09-19T00:00:00Z' },
  // riga solo MSI: non deve mai finire in una build Minimal
  { id: 3, variable: 'MSI SCHEDA MADRE', variant_value: 'B650 GAMING PLUS WIFI', ean: 'EAN-MSI-B650', component_name: 'MSI B650 GAMING PLUS WIFI', supplier: 'OMEGA', updated_at: '2026-09-19T00:00:00Z' },
  // riga solo globale: la build MSI ci ricade sopra, con avviso
  { id: 4, variable: 'CASE', variant_value: 'CASE ATX NERO', ean: 'EAN-CASE-GLOBALE', component_name: 'Case ATX', supplier: 'NOUA', updated_at: '2026-09-10T00:00:00Z' },
  // alias di variabile (MOBO -> SCHEDA MADRE) lato globale
  { id: 5, variable: 'MOBO', variant_value: 'B650 GAMING PLUS WIFI', ean: 'EAN-MINIMAL-B650', component_name: 'B650 a rotazione', supplier: 'ACTION', updated_at: '2026-09-05T00:00:00Z' }
];
__setCache(rows);

// 1. build MSI: vince la riga MSI anche se quella globale esiste
const msiGpu = findGpoMapping('GPU', 'RTX 5070 12GB GDDR7', 'MSI SENTINEL');
assert.equal(msiGpu.ean, 'EAN-MSI-5070');
assert.equal(msiGpu.scope, 'MSI');
assert.equal(msiGpu.scopeFallback, false);

// 2. build Minimal: stessa identica scelta, ma resta sulla riga globale
const minimalGpu = findGpoMapping('GPU', 'RTX 5070 12GB GDDR7', 'PC GAMING REX');
assert.equal(minimalGpu.ean, 'EAN-MINIMAL-5070');
assert.equal(minimalGpu.scope, null);
assert.equal(minimalGpu.scopeFallback, false);

// 3. nessuna configKey (chiamate legacy): comportamento invariato = globale
assert.equal(findGpoMapping('GPU', 'RTX 5070 12GB GDDR7').ean, 'EAN-MINIMAL-5070');

// 4. riga solo MSI invisibile alle build Minimal
assert.equal(findGpoMapping('SCHEDA MADRE', 'B650 GAMING PLUS WIFI', 'PC GAMING REX').ean, 'EAN-MINIMAL-B650');
assert.equal(findGpoMapping('SCHEDA MADRE', 'B650 GAMING PLUS WIFI', 'MSI VIPER').ean, 'EAN-MSI-B650');
// alias MOBO/MOTHERBOARD risolti in entrambe le direzioni
assert.equal(findGpoMapping('MOBO', 'B650 GAMING PLUS WIFI', 'MSI VIPER').ean, 'EAN-MSI-B650');

// 5. fallback controllato: build MSI senza riga dedicata usa la globale e avvisa
warnings.length = 0;
const fallback = findGpoMapping('CASE', 'CASE ATX NERO', 'MSI ATLAS');
assert.equal(fallback.ean, 'EAN-CASE-GLOBALE');
assert.equal(fallback.scope, null);
assert.equal(fallback.scopeFallback, true);
assert.equal(warnings.length, 1);
assert.ok(warnings[0].includes('[GPO scope]'));

// 6. nessun match: null
assert.equal(findGpoMapping('GPU', 'VALORE INESISTENTE', 'MSI ATLAS'), null);

// 7. normalizzazione valore (nbsp, trattini tipografici, spazi doppi)
assert.equal(findGpoMapping('GPU', 'RTX 5070  12GB–GDDR7'.replace('–', ' '), 'MSI SENTINEL').ean, 'EAN-MSI-5070');

// --- livello build: stesso testo, pezzo MSI diverso a seconda della build ---
__setCache([
  ...rows,
  { id: 10, variable: 'MSI GPU', variant_value: 'RTX 5070 12GB GDDR7 TRIO', ean: 'EAN-MSI-LINEA', component_name: 'fallback di linea', supplier: 'ABACO', updated_at: '2026-09-19T00:00:00Z' },
  { id: 11, variable: 'MSI CHIMERA::GPU', variant_value: 'RTX 5070 12GB GDDR7 TRIO', ean: 'EAN-MSI-TRIO', component_name: 'MSI RTX 5070 Gaming Trio OC', supplier: 'ABACO', updated_at: '2026-09-19T00:00:00Z' },
  { id: 12, variable: 'MSI FALCON::GPU', variant_value: 'RTX 5070 12GB GDDR7 TRIO', ean: 'EAN-MSI-VENTUS', component_name: 'MSI RTX 5070 Ventus 2X OC', supplier: 'BREVI', updated_at: '2026-09-19T00:00:00Z' }
]);

const chimera = findGpoMapping('GPU', 'RTX 5070 12GB GDDR7 TRIO', 'MSI CHIMERA');
assert.equal(chimera.ean, 'EAN-MSI-TRIO');
assert.equal(chimera.scope, 'MSI CHIMERA');
const falcon = findGpoMapping('GPU', 'RTX 5070 12GB GDDR7 TRIO', 'MSI FALCON');
assert.equal(falcon.ean, 'EAN-MSI-VENTUS');
// build MSI senza riga dedicata: scende al livello di linea, non alla globale
const altraBuild = findGpoMapping('GPU', 'RTX 5070 12GB GDDR7 TRIO', 'MSI ATLAS');
assert.equal(altraBuild.ean, 'EAN-MSI-LINEA');
assert.equal(altraBuild.scope, 'MSI');
assert.equal(altraBuild.scopeFallback, false);
// una build Minimal non vede nessuna delle tre righe MSI
assert.equal(findGpoMapping('GPU', 'RTX 5070 12GB GDDR7 TRIO', 'PC GAMING REX'), null);

console.log('gpo-mapping-scope: scope build/linea/globale, alias variabili, fallback con avviso — PASS');
