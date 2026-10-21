import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/gpo-manager.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
vm.createContext(sandbox);
vm.runInContext(source + '\nwindow.setRows = rows => { gpoMappingsCache = rows; };', sandbox);
const { setRows, findGpoMapping, normalizeGpoVariantValue } = sandbox.window;
for (const storedFans of [1, 3]) {
  const rows = ['BLACK', 'WHITE'].map((color, i) => ({ id: i + 1, variable: 'CASE',
    variant_value: `MINIMAL CASE ${color} - ${storedFans}x RGB`,
    ean: `TEST-${color}`, component_name: `Case ${color}`, supplier: 'TEST', updated_at: '2026-10-21T00:00:00Z' }));
  const original = JSON.stringify(rows);
  setRows(rows);
  for (const color of ['BLACK', 'WHITE']) {
    for (const requestedFans of [1, 3]) {
      const match = findGpoMapping('CASE', `MINIMAL CASE ${color} - ${requestedFans}x RGB`, 'PC GAMING SPARTAN');
      assert.equal(match.ean, `TEST-${color}`);
      assert.equal(match.supplier, 'TEST');
    }
  }
  assert.equal(findGpoMapping('CASE', 'MINIMAL CASE BLACK - 4x RGB', 'PC GAMING SPARTAN'), null);
  assert.equal(findGpoMapping('CASE', 'ALTRO CASE BLACK - 1x RGB', 'PC GAMING SPARTAN'), null);
  assert.equal(JSON.stringify(rows), original, 'Il riconoscimento non deve alterare i dati originali');
}
assert.equal(normalizeGpoVariantValue('minimal case black – 3 × rgb'), 'MINIMAL CASE BLACK - 3X RGB');
setRows([{ id: 1, variable: 'MSI CASE', variant_value: 'MINIMAL CASE BLACK - 3x RGB', ean: 'MSI-ONLY' }]);
assert.equal(findGpoMapping('CASE', 'MINIMAL CASE BLACK - 1x RGB', 'PC GAMING SPARTAN'), null);
assert.equal(findGpoMapping('CASE', 'MINIMAL CASE BLACK - 1x RGB', 'MSI ORION').ean, 'MSI-ONLY');
console.log('Minimal Case 1x/3x: storico, nuovi ordini, colori e scope corretti');
