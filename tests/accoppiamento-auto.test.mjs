import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Accoppiamento automatico (26/09/2026): decifratura del file dei listini, scelta della voce
// (opzione del cliente -> distinta -> pezzo), prezzo di vendita del PC e utile.
const gpo = readFileSync(new URL('../assets/js/gpo-manager.js', import.meta.url), 'utf8');
const auto = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('./fixture-accoppiamento.json', import.meta.url), 'utf8'));

const sandbox = {
  window: {}, console: { log() {}, error() {}, warn() {} },
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder, TextDecoder, crypto: webcrypto, globalThis: { crypto: webcrypto },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch: () => { throw new Error('niente rete nel test'); }
};
sandbox.globalThis = sandbox;
sandbox.crypto = webcrypto;
vm.createContext(sandbox);
vm.runInContext(`${gpo}\nwindow.__setCache = (rows) => { gpoMappingsCache = rows; };\n${auto}`, sandbox);
const A = sandbox.window.AccoppiamentoAuto;

// --- decifratura del file prodotto dal Python (accoppiamento/cifra.py) ---
const dati = await A.decifra(fixture, 'prova-gestionale', webcrypto.subtle);
assert.equal(dati.voci.length, 3);
await assert.rejects(() => A.decifra(fixture, 'password-sbagliata', webcrypto.subtle));

// --- chiave dei codici ---
assert.equal(A.chiave('00B650M S2H'), 'B650MS2H');
assert.equal(A.chiave('90-MXBDJ0-A0UAYZ'), '90MXBDJ0A0UAYZ');

// --- scelta della voce ---
sandbox.window.__setCache([
  { id: 77, variable: 'GPU', variant_value: 'RX 9070 XT 16GB GDDR6', ean: 'VGAASRATI0111', supplier: 'ACTION', updated_at: '2026-09-20' }
]);
const ctx = (variants) => ({ configKey: 'PC GAMING PROVA', variants });
// 1) il cliente ha scelto la GPU: vale la voce della mappatura (le scelte del cliente si rispettano)
let v = A.voceAutomatica(dati, ctx({ GPU: 'RX 9070 XT 16GB GDDR6' }), 'GPU', 'VGAASRATI0111', 'ACTION');
assert.equal(v.origine, 'opzione');
assert.equal(v.auto.codice, 'VGAASRATI0101');
// 2) nessuna scelta: distinta base, se il pezzo e' ancora quello della distinta
v = A.voceAutomatica(dati, ctx({}), 'GPU', 'VCG507012TFXPB1', 'OMEGA');
assert.equal(v.origine, 'distinta');
assert.equal(v.auto.codice, 'VGAASUNVD0931');
// 3) pezzo cambiato rispetto alla distinta: si cerca il pezzo com'e' scritto
v = A.voceAutomatica(dati, { configKey: 'ALTRA BUILD', variants: {} }, 'MOBO', 'B650M S2H', 'OMEGA');
assert.equal(v.origine, 'pezzo');
assert.equal(v.auto.codice, 'PLYASRAM50021');
// pezzo sconosciuto: nessuna alternativa
assert.equal(A.voceAutomatica(dati, ctx({}), 'CASE', 'NOUA VITRA BLACK', 'NOUA'), null);

// --- prezzo di vendita: riga del PC + righe OPZIONI collegate a quel PC ---
const ordini = [{
  id: 4814,
  line_items: [
    { name: 'PC GAMING HECTORE - RYZEN 7 5700X', price: '1341.00', quantity: 1,
      properties: [{ name: '_gpo_product_group', value: 'G1' }] },
    { name: 'OPZIONI HECTORE - SSD M.2 PRINCIPALE - SSD M.2 NVMe 1TB', price: '137.00', quantity: 1,
      properties: [{ name: '_gpo_parent_product_group', value: 'G1' }] },
    { name: 'OPZIONI HECTORE - CONNETTIVITA', price: '69.90', quantity: 1,
      properties: [{ name: '_gpo_parent_product_group', value: 'G1' }] },
    { name: 'OPZIONI ALTRO PC - X', price: '50.00', quantity: 1,
      properties: [{ name: '_gpo_parent_product_group', value: 'G2' }] }
  ]
}];
const p = A.prezzoVendita('4814', ordini);
assert.equal(p.totale, 1547.9);
assert.equal(p.opzioni, 206.9);
assert.equal(A.prezzoVendita('4814.2', ordini), null);   // un solo PC nell'ordine

// --- utile: prezzo/1,22 - 4,5% del prezzo - costo; SRL = 70% se positivo ---
const u = A.utile(1220, 800);
assert.equal(u.lordo, Math.round((1220 / 1.22 - 0.045 * 1220 - 800) * 100) / 100);
assert.equal(u.lordo, 145.1);
assert.equal(u.srl, Math.round(0.7 * u.lordo * 100) / 100);
assert.equal(A.utile(1000, 900).srl, A.utile(1000, 900).lordo);  // in perdita: nessuno sconto

console.log('accoppiamento-auto: tutti i test passati');
