import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const marker = source.indexOf('NORMALIZZAZIONE COMPONENTI');
const end = marker < 0 ? -1 : source.lastIndexOf('/*', marker);
assert.ok(end > 0, 'sezione PSU non individuata');
const sandbox = {
  document: { getElementById() { return null; } },
  window: {},
  console: { log() {} }
};
vm.createContext(sandbox);
vm.runInContext(source.slice(0, end), sandbox);

const mapped = (value, config = 'PC GAMING HELLSTORM') => {
  const components = [{ type: 'PSU', value, supplier: 'AMAZON' }];
  sandbox.window.applyDeepcoolPsuMapping(components, config);
  return components[0];
};

assert.deepEqual(
  { value: mapped('TACENS 850W').value, supplier: mapped('TACENS 850W').supplier },
  { value: 'DEEPCOOL PN850-D V2 80+ GOLD', supplier: 'ABACO' }
);
assert.equal(mapped('TACENS 850 W').value, 'DEEPCOOL PN850-D V2 80+ GOLD');
assert.equal(mapped('80+ GOLD 850W').value, 'DEEPCOOL PN850-D V2 80+ GOLD');
assert.equal(mapped('TACENS 750W').value, 'DEEPCOOL PF-600X 80+ BRONZE');
assert.equal(mapped('MSI MAG A850GL').value, 'MSI MAG A850GL');
assert.equal(mapped('DEEPCOOL PN850-D V2 80+ GOLD').value, 'DEEPCOOL PN850-D V2 80+ GOLD');
assert.equal(mapped('ALI 1000W 80+ GOLD', 'PC GAMING MIRAGE').value, 'DEEPCOOL PQ1000-G 1000W 80+ GOLD');
console.log('PSU Deepcool: 7 verifiche superate');

