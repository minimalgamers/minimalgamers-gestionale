import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Alimentatore deciso dalla scheda video (26/09/2026, Antonio): fino alla RX 9060 XT il DeepCool
// 600W Bronze; RX 7800 XT, RX 9070/9070 XT, RTX 5070/5070 Ti e 5080 l'850W Gold; RTX 5090 il PQ1000.
// Conta la scheda video finale: variante del cliente, altrimenti titolo del suo ordine.
const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const pezzo = (inizio, fine) => {
  const a = app.indexOf(inizio);
  const b = app.indexOf(fine, a);
  assert.ok(a >= 0 && b > a, `blocco non trovato: ${inizio}`);
  return app.slice(a, b + fine.length);
};
const sorgente = [
  pezzo('const PSU_DEEPCOOL = {', "console.log('✅ PSU Deepcool v34 registrato');"),
  pezzo('window.SINNER_HIGH_GPU_EANS', "console.log('✅ SINNER-GPU PSU v35 registrato');"),
  pezzo('window.GPU_PSU_RULE_ACTIVE = true;', "console.log('✅ Alimentatore per scheda video (26/09) registrato');"),
  pezzo('window.MOBO_PSU_RULES = [', "console.log('✅ applyMoboPsuRules v32 registrata');"),
].join('\n');
const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
vm.createContext(sandbox);
vm.runInContext(sorgente, sandbox);
const W = sandbox.window;

function psu(configKey, titolo, props = {}, psuIniziale = 'TACENS 750W') {
  const comps = [{ type: 'GPU', value: 'CODICE-GPU' }, { type: 'PSU', value: psuIniziale, supplier: 'AMAZON' }];
  const pcItem = { name: titolo, custom_properties: props };
  W.applyMoboPsuRules(comps, pcItem, null);                 // spenta: non deve cambiare nulla
  W.applyGpuPsuRule(comps, configKey, pcItem);
  W.applyDeepcoolPsuMapping(comps, configKey);
  const p = comps.find(c => c.type === 'PSU');
  return `${p.value} | ${p.supplier}`;
}

const BRONZE = 'DEEPCOOL PF-600X 80+ BRONZE | ABACO';
const GOLD = 'DEEPCOOL PN850-D V2 80+ GOLD | ABACO';
const PQ1000 = 'DEEPCOOL PQ1000-G 1000W 80+ GOLD | ABACO';

// Minimal: dal titolo dell'ordine
assert.equal(psu('PC GAMING REX', 'PC GAMING REX - RYZEN 5 9600X + RX 9060 XT 16GB GDDR6 + 16GB RAM'), BRONZE);
assert.equal(psu('PC GAMING TERMINATOR', 'PC GAMING TERMINATOR - RYZEN 5 9600X + RTX 5070 12GB GDDR7'), GOLD);
assert.equal(psu('PC GAMING MADAME', 'PC GAMING MADAME - RYZEN 5 9600X + RX 7800 XT 16GB GDDR6'), GOLD);
assert.equal(psu('PC GAMING VALHALLA', 'PC GAMING VALHALLA - RYZEN 7 9850X3D + RX 9070 16GB GDDR6'), GOLD);
assert.equal(psu('PC GAMING APOCALYPSE', 'PC GAMING APOCALYPSE - INTEL CORE ULTRA 9 285K + RTX 5080 16GB'), GOLD);
assert.equal(psu('PC GAMING KRONOS', 'PC GAMING KRONOS - RYZEN 7 9850X3D + RTX 5090 32GB GDDR7'), PQ1000);
// bundle con RTX 5070: prima finiva con il 600W
assert.equal(psu('[PC+MONITOR+KIT] PC GAMING RTX 5070', 'BUNDLE TERMINATOR - PC GAMING RYZEN 5 9600X + RTX 5070 12GB GDDR7 + MONITOR 180Hz 1ms'), GOLD);
// la variante del cliente vince sul titolo (REX con upgrade a 9070 XT)
assert.equal(psu('PC GAMING REX', 'PC GAMING REX - RYZEN 5 9600X + RX 9060 XT 16GB', { GPU: 'RX 9070 XT 16GB GDDR6' }), GOLD);
// la scheda madre non conta piu' (Tomahawk con 9060 XT: 600W)
assert.equal(psu('PC GAMING REX', 'PC GAMING REX - RYZEN 5 9600X + RX 9060 XT 16GB', { 'SCHEDA MADRE': 'MSI MAG B850 TOMAHAWK WIFI 7' }), BRONZE);
// grafica integrata
assert.equal(psu('PC GAMING VEGA', 'PC GAMING VEGA - RYZEN 7 5700G + RADEON VEGA 8 + 16GB RAM'), BRONZE);
// alimentatore scelto dal cliente (opzione PSU): la regola per scheda video non interviene
{
  const comps = [{ type: 'PSU', value: 'VALORE SCELTO', supplier: 'X' }];
  W.applyGpuPsuRule(comps, 'PC GAMING REX', { name: 'PC GAMING REX - RTX 5090', custom_properties: { PSU: 'ALIMENTATORE 1000W' } });
  assert.equal(comps[0].value, 'VALORE SCELTO');
}

// DeepCool: resta il suo alimentatore se basta, altrimenti il piu' potente
assert.equal(psu('DEEPCOOL CRYO', 'PC GAMING DEEPCOOL CRYO - RYZEN 7 7800X3D + RX 9060 XT 16GB', {}, 'DEEPCOOL PN650-D 650W 80+ GOLD'), 'DEEPCOOL PN650-D 650W 80+ GOLD | AMAZON');
assert.equal(psu('DEEPCOOL CRYO', 'PC GAMING DEEPCOOL CRYO - RYZEN 7 7800X3D + RX 9060 XT 16GB', { GPU: 'RTX 5070 12GB GDDR7' }, 'DEEPCOOL PN650-D 650W 80+ GOLD'), GOLD);
assert.equal(psu('DEEPCOOL AURORA', 'PC GAMING DEEPCOOL AURORA - RYZEN 7 7800X3D + RTX 5070 12GB', {}, 'DEEPCOOL PQ850G 850W 80+ GOLD'), 'DEEPCOOL PQ850G 850W 80+ GOLD | AMAZON');

// MSI: resta MSI; 5090 -> MSI 1000W; variante da 850W su un 650W -> MAG A850GL
assert.equal(psu('MSI COLOSSUS', 'MSI COLOSSUS - PC GAMING INTEL CORE i9-14900KF + RTX 5080 16GB', {}, 'MAG A850GL'), 'MAG A850GL | AMAZON');
assert.equal(psu('MSI ATLAS', 'MSI ATLAS - PC GAMING RYZEN 7 9800X3D + RTX 5090 32GB GDDR7', {}, 'MAG-A650BNPCIII'), 'MPG A1000G | RUNNER');
assert.equal(psu('MSI BASTION', 'MSI BASTION - PC GAMING RYZEN 5 5500F 2026 + RTX 5060 8GB', { GPU: 'RTX 5070 Ti 16GB GDDR7' }, 'MAG-A650BNPCIII'), 'MAG A850GL | RUNNER');
assert.equal(psu('MSI BASTION', 'MSI BASTION - PC GAMING RYZEN 5 5500F 2026 + RTX 5060 8GB', {}, 'MAG-A650BNPCIII'), 'MAG-A650BNPCIII | AMAZON');

console.log('gpu-psu: tutti i test passati');
