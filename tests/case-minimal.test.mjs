import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Regola case Minimal (v36 + Antonio 26/09): nelle build economiche MINIMAL CASE = NOUA Vitra (M-ATX),
// ma se il cliente cambia la scheda madre serve il CASE ATX. In tutte le altre (come l'Excel) sempre CASE ATX.
const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const a = app.indexOf('const CASE_TOP_CONFIGS = new Set([');
const b = app.indexOf('// v29/v32: regole MOBO', a);
assert.ok(a >= 0 && b > a, 'blocco regola case non trovato');
const sandbox = { console: { log() {} } };
vm.createContext(sandbox);
vm.runInContext(app.slice(a, b) + '\nthis.applyVitraCaseOverride = applyVitraCaseOverride;', sandbox);

function caso(configKey, props) {
  const comps = [{ type: 'CASE', value: 'VALORE DISTINTA', supplier: 'X' }];
  sandbox.applyVitraCaseOverride(comps, configKey, { custom_properties: props });
  return `${comps[0].value} | ${comps[0].supplier}`;
}

// Economiche (Vitra di serie): VOLT, SETUP VOLT, CRIMSON, BUNDLE CRIMSON, VORTEX, VEGA, STRIKE, STREAM.
assert.equal(caso('PC GAMING VEGA', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'NOUA VITRA BLACK | NOUA');
assert.equal(caso('PC GAMING STREAM', { CASE: 'MINIMAL CASE WHITE - 1x RGB', 'SCHEDA MADRE': 'MOBO B650 GAMING X  [ASROCK - GIGABYTE - MSI]' }),
  'NOUA VITRA WHITE | NOUA');                                         // scheda madre di serie
assert.equal(caso('SETUP VOLT', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'NOUA VITRA BLACK | NOUA');
assert.equal(caso('[PC+MONITOR+KIT]', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'NOUA VITRA BLACK | NOUA');
assert.equal(caso('PC GAMING VOLT', { CASE: 'MINIMAL CASE BLACK - 1x RGB', 'SCHEDA MADRE': 'MSI MAG B850 TOMAHAWK WIFI 7' }),
  'CASE ATX BLACK | ALTRO');                                          // scheda madre cambiata
assert.equal(caso('PC GAMING STRIKE', { CASE: 'MINIMAL CASE WHITE - 1x RGB', 'SCHEDA MADRE': 'ASUS ROG STRIX B550 WIFI' }),
  'CASE ATX WHITE | ALTRO');                                          // prima finiva nella Vitra
// Tutte le altre (come l'Excel): CASE ATX anche con la scheda madre di serie.
assert.equal(caso('PC GAMING REX', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'CASE ATX BLACK | ALTRO');
assert.equal(caso('PC GAMING HECTORE', { CASE: 'MINIMAL CASE WHITE - 1x RGB' }), 'CASE ATX WHITE | ALTRO');
assert.equal(caso('[PC+MONITOR+KIT] PC GAMING ARC A770', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'CASE ATX BLACK | ALTRO');
assert.equal(caso('PC GAMING NEUTRON', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'CASE ATX BLACK | ALTRO');
assert.equal(caso('SETUP SINNER', { CASE: 'MINIMAL CASE WHITE - 1x RGB' }), 'CASE ATX WHITE | ALTRO');
assert.equal(caso('PC GAMING TERMINATOR', { CASE: 'MINIMAL CASE WHITE - 1x RGB' }), 'CASE ATX WHITE | ALTRO');
assert.equal(caso('PC GAMING REX', { CASE: 'DEEPCOOL CG530 BLACK - 4x RGB', 'SCHEDA MADRE': 'MSI MAG B850 TOMAHAWK WIFI 7' }),
  'VALORE DISTINTA | X');                                             // case scelto dal cliente: non si tocca
assert.equal(caso('MSI ORION', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'VALORE DISTINTA | X');
assert.equal(caso('DEEPCOOL CRYO', { CASE: 'MINIMAL CASE BLACK - 1x RGB' }), 'VALORE DISTINTA | X');

console.log('case-minimal: tutti i test passati');
