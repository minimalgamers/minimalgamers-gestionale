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

// --- pagina Automatico: ordini accoppiati, costi, riepilogo fornitori ---
assert.equal(Object.keys(dati.ordini).length, 2);
const pc = A.pcAutomatico(dati, '555');
assert.equal(pc.build, 'PC GAMING PROVA');
assert.equal(A.pcAutomatico(dati, '555.2'), null);                 // un solo PC in quell'ordine
assert.equal(A.pcAutomatico(dati, '999'), null);
// costi: automatico, fisso, servizio a costo zero, mancanti (case senza costo, scheda madre senza offerta)
let c = A.contiPc(pc, {});
assert.equal(c.costo, 348.61);
assert.deepEqual(Array.from(c.mancanti, p => p.tipo), ['CASE', 'MOBO']);
assert.equal(c.utile.lordo, Math.round((1069.9 / 1.22 - 0.045 * 1069.9 - 348.61) * 100) / 100);
// costo inserito a mano per il case (chiave = id del costo fisso): vale per tutti gli ordini
c = A.contiPc(pc, { case_atx: 50 });
assert.equal(c.costo, 398.61);
assert.deepEqual(Array.from(c.mancanti, p => p.tipo), ['MOBO']);
assert.equal(JSON.stringify(A.costoPezzo(pc.pezzi[2], { case_atx: 50 })), JSON.stringify({ costo: 50, fonte: 'inserito' }));
// riepilogo fornitori: somma le quantita' tra ordini, esclude i servizi a costo zero
const r = A.riepilogoFornitori(dati, ['555', '556'], {});
assert.equal(r.ACTION.find(x => x.codice === 'GPU-1').quantita, 2);
assert.deepEqual(Array.from(r.ACTION.find(x => x.codice === 'GPU-1').ordini), ['#9001', '#9002']);
assert.equal(r.ACTION.find(x => x.codice === 'RAM-8').quantita, 2);
assert.equal(r['FORNITORE LOCALE'][0].costo, 8.61);
assert.equal(r.ALTRO[0].senzaCosto, true);
assert.ok(r['DA DECIDERE'][0].descrizione.startsWith('Scheda madre'));
assert.ok(!Object.values(r).flat().some(x => x.descrizione === 'Scatole'));
// --- magazzino (26/09): si scala solo con la conferma di Antonio, il prezzo pagato resta nei conti ---
// Il modulo scrive nella tabella dell'Inventario passando dall'adapter vero (api-adapter.js),
// qui collegato a un finto database in memoria.
const adapter = readFileSync(new URL('../assets/js/api-adapter.js', import.meta.url), 'utf8');
const tabella = [];
sandbox.window.SupabaseDB = {
  _ready: true,
  async getInventory() { return tabella.map(x => ({ ...x })); },
  async saveInventoryItem(ean, name, quantity) {
    const r = tabella.find(x => x.ean === ean);
    if (r) { if (name !== undefined) r.name = name; if (quantity !== undefined) r.quantity = quantity; }
    else tabella.push({ ean, name, quantity });
  },
  async deleteInventoryItem(ean) { const i = tabella.findIndex(x => x.ean === ean); if (i >= 0) tabella.splice(i, 1); }
};
sandbox.window.fetch = () => { throw new Error('niente rete nel test'); };
sandbox.location = { href: 'https://gestionale.test/' };
sandbox.Response = Response;
sandbox.URL = URL;
vm.runInContext(adapter, sandbox);
sandbox.fetch = (...a) => sandbox.window.fetch(...a);
const riga = (ean) => tabella.find(x => x.ean === ean);
const si = () => true, no = () => false;

A.annota(dati);
const pc2 = A.pcAutomatico(dati, '556');
const psu = pc2.pezzi[1];
assert.equal(psu.mag.uso, 'MAG-USO-556-1-psu_600');
assert.ok(!('mag' in JSON.parse(JSON.stringify(psu))));            // non finisce nei dati salvati
// prima di leggere il magazzino, e finche' non si prende: fornitore e prezzo di oggi
assert.equal(A.pezzoPreso(psu), false);
assert.equal(A.contiPc(pc2, {}).costo, 328);
assert.deepEqual(Array.from(Object.keys(A.riepilogoFornitori(dati, ['556'], {}))), ['ACTION']);
await A.leggiInventario();
assert.equal(A.quantitaMagazzino(dati.magazzino[0]), null);         // quantita' non ancora inserita
assert.match(A.rigaPezzo(psu, {}), /non ancora inserita/);
assert.equal(await A.prendiDalMagazzino(dati, psu.mag.uso, si), false);   // niente a terra: non si prende
assert.equal(tabella.length, 0);
// quantita' inserita da Antonio (come nella pagina Inventario)
assert.equal(await A.impostaQuantita(dati.magazzino[0], '3'), true);
assert.equal(riga('MAG-PSU-600W').quantity, 3);
assert.match(A.rigaPezzo(psu, {}), /data-prendi="MAG-USO-556-1-psu_600"/);
assert.match(A.boxMagazzino(dati), /3 pezzi/);
// senza conferma non cambia nulla
assert.equal(await A.prendiDalMagazzino(dati, psu.mag.uso, no), false);
assert.equal(riga('MAG-PSU-600W').quantity, 3);
assert.equal(riga(psu.mag.uso), undefined);
// con la conferma: un pezzo in meno, riga d'uso per l'ordine, costo pagato nei conti, riepilogo MAGAZZINO
let domanda = '';
assert.equal(await A.prendiDalMagazzino(dati, psu.mag.uso, (t) => { domanda = t; return true; }), true);
assert.match(domanda, /#9002/);
assert.match(domanda, /restano 2 pezzi/);
assert.equal(riga('MAG-PSU-600W').quantity, 2);
assert.equal(riga('MAG-USO-556-1-psu_600').quantity, 1);
assert.equal(A.pezzoPreso(psu), true);
assert.equal(JSON.stringify(A.costoPezzo(psu, {})), JSON.stringify({ costo: 25, fonte: 'magazzino' }));
assert.equal(A.contiPc(pc2, {}).costo, 325);
const r2 = A.riepilogoFornitori(dati, ['556'], {});
assert.deepEqual(Array.from(Object.keys(r2)).sort(), ['ACTION', 'MAGAZZINO']);
assert.equal(r2.ACTION.length, 1);                                  // l'alimentatore non va ordinato
assert.equal(r2.MAGAZZINO[0].costo, 25);
assert.match(A.rigaPezzo(psu, {}), /data-annulla=/);
assert.match(A.boxMagazzino(dati), /presi per ordini da spedire: 1/);
// due volte lo stesso pezzo per lo stesso ordine: no
assert.equal(await A.prendiDalMagazzino(dati, psu.mag.uso, si), false);
assert.equal(riga('MAG-PSU-600W').quantity, 2);
// Annulla: il pezzo torna in magazzino e l'ordine torna al fornitore
assert.equal(await A.annullaDalMagazzino(dati, psu.mag.uso, no), false);
assert.equal(riga('MAG-PSU-600W').quantity, 2);
assert.equal(await A.annullaDalMagazzino(dati, psu.mag.uso, si), true);
assert.equal(riga('MAG-PSU-600W').quantity, 3);
assert.equal(riga(psu.mag.uso), undefined);
assert.equal(A.contiPc(pc2, {}).costo, 328);
// prezzo pagato non inserito: nei conti resta il prezzo di oggi
dati.magazzino[0].costo = null;
await A.prendiDalMagazzino(dati, psu.mag.uso, si);
assert.equal(JSON.stringify(A.costoPezzo(psu, {})), JSON.stringify({ costo: 28, fonte: 'magazzino' }));
// pulsanti +/- della pagina Inventario: arriva solo «delta» (prima non si salvava)
let res = await sandbox.fetch('api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php',
  { method: 'PUT', body: JSON.stringify({ ean: 'MAG-PSU-600W', delta: -1 }) });
assert.equal((await res.json()).success, true);
assert.equal(riga('MAG-PSU-600W').quantity, 1);
res = await sandbox.fetch('api_gateway/db_bridge/inventory_service/endpoint/api-inventory.php',
  { method: 'PUT', body: JSON.stringify({ ean: 'MAG-PSU-600W', delta: -5 }) });
assert.equal(riga('MAG-PSU-600W').quantity, 0);                    // mai sotto zero
assert.equal(riga('MAG-PSU-600W').name, 'Alimentatore DeepCool PF-600X');

console.log('accoppiamento-auto: tutti i test passati');
