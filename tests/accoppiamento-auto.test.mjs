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
// + montaggio (32,79) e spedizione BRT (11) come nei conti dell'Excel (26/09)
let c = A.contiPc(pc, {});
assert.equal(c.costo, 392.4);
assert.deepEqual(Array.from(c.mancanti, p => p.tipo), ['CASE', 'MOBO']);
assert.equal(c.utile.lordo, Math.round((1069.9 / 1.22 - 0.045 * 1069.9 - 392.4) * 100) / 100);
// costo inserito a mano per il case (chiave = id del costo fisso): vale per tutti gli ordini
c = A.contiPc(pc, { case_atx: 50 });
assert.equal(c.costo, 442.4);
assert.deepEqual(Array.from(c.mancanti, p => p.tipo), ['MOBO']);
assert.equal(JSON.stringify(A.costoPezzo(pc.pezzi[2], { case_atx: 50 })), JSON.stringify({ costo: 50, fonte: 'inserito' }));
// conti dell'Excel (26/09): costo di ogni pezzo nei conti, rosso se oggi costa piu' di 1 € in piu'
const conExcel = JSON.parse(JSON.stringify(pc));
conExcel.pezzi.forEach((p, i) => { p.excel = i === 0 ? { costo: (A.costoPezzo(p, {}).costo || 0) - 20, fonte: 'distinta' } : null; });
conExcel.servizi = [{ nome: 'Montaggio e collaudo', costo: 32.79 }, { nome: 'Spedizione BRT', costo: 11 }];
const ce = A.contiPc(conExcel, {});
assert.equal(ce.excel.sopra.length, 1);
assert.equal(ce.excel.senza.length, conExcel.pezzi.filter((p, i) => i > 0 && !p.senza_costo).length);
assert.equal(ce.excel.costo, Math.round(((A.costoPezzo(conExcel.pezzi[0], {}).costo - 20) + 43.79) * 100) / 100);
assert.match(A.cellaExcel(conExcel.pezzi[0], A.costoPezzo(conExcel.pezzi[0], {}).costo), /acc-sopra/);
assert.match(A.cellaExcel(conExcel.pezzi[0], A.costoPezzo(conExcel.pezzi[0], {}).costo), /\+20,00/);
assert.match(A.cellaExcel({ excel: { costo: 100 } }, 100.5), /^<td class="num col-excel" /);   // entro 1 €: in linea
assert.match(A.cellaExcel({ excel: null }, 10), /—/);
assert.match(A.rigaConfrontoExcel(ce), /oggi costa/i);
assert.match(A.rigaConfrontoExcel({ costo: 100, excel: { costo: 120, utile: A.utile(500, 120), senza: [], sopra: [] } }), /In linea/);
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
assert.equal(A.contiPc(pc2, {}).costo, 371.79);
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
assert.equal(A.contiPc(pc2, {}).costo, 368.79);
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
assert.equal(A.contiPc(pc2, {}).costo, 371.79);
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

// --- utile rispetto all'obiettivo, data e prezzo di oggi (Antonio 29/09) ---
assert.equal(A.valutaObiettivo(170, 180).inTarget, false);
assert.equal(A.valutaObiettivo(176, 180).inTarget, true);           // entro 5 € è in target
assert.equal(A.valutaObiettivo(200, null), null);
assert.match(A.rigaObiettivo(150.4, 180), /🔻 sotto di 29,60 €/);
assert.match(A.rigaObiettivo(200, 180), /✅ in target \(\+20,00 €\)/);
assert.equal(A.rigaObiettivo(200, null), '');
assert.equal(A.dataBreve('2026-09-27T10:00:00+02:00'), '27/09/2026');
let hv = A.righeVendita({ totale: 2425.9, pc: 2341, opzioni: 84.9 }, '2026-09-27T10:00:00+02:00', 2391);
assert.match(hv, /Venduto il 27\/09\/2026 a \(IVA incl.\)/);
assert.match(hv, /Oggi la build è a 2\.?391,00 € sul sito \(\+50,00 € rispetto al prezzo di questo ordine\)/);
hv = A.righeVendita({ totale: 2341, pc: 2341, opzioni: 0 }, '', 2341);
assert.doesNotMatch(hv, /Oggi la build/);
// con costi mancanti l'utile non si scrive (prima usciva gonfiato: #4816 «2.989,75 €» con i pezzi a zero)
assert.match(A.rigaUtile({ lordo: 2989.75, srl: 2092.82 }, 8), /da calcolare: mancano 8 costi/);
assert.doesNotMatch(A.rigaUtile({ lordo: 2989.75, srl: 2092.82 }, 8), /2\.?989/);
assert.match(A.rigaUtile({ lordo: 212.5, srl: 148.75 }, 0), /212,50 € · SRL 148,75 €/);
// prezzo di vendita con la data dell'ordine
assert.equal(A.prezzoVendita('4814', [{ id: 4814, created_at: '2026-09-28T09:00:00Z',
  line_items: [{ name: 'PC GAMING HECTORE', price: '1341.00', quantity: 1, properties: [] }] }]).data, '2026-09-28T09:00:00Z');

// --- esito in testa al riquadro (Antonio 29/09: «capire se sto in profitto o in negativo») ---
assert.match(A.rigaEsito({ lordo: 212.5, srl: 148.75 }, 2, 150), /🟠 DA COMPLETARE · mancano 2 costi/);
assert.match(A.rigaEsito({ lordo: 212.5, srl: 148.75 }, 1, 150), /manca 1 costo/);
assert.match(A.rigaEsito({ lordo: -35.2, srl: -35.2 }, 0, 150), /🔴 IN PERDITA · -35,20 €/);
assert.match(A.rigaEsito({ lordo: 150, srl: 105 }, 0, 150), /🟡 IN PROFITTO, SOTTO OBIETTIVO · SRL 105,00 € \(-45,00 €\)/);
assert.match(A.rigaEsito({ lordo: 212.5, srl: 148.75 }, 0, 150), /🟢 IN PROFITTO · SRL 148,75 € · in target/);
assert.match(A.rigaEsito({ lordo: 212.5, srl: 148.75 }, 0, null), /🟢 IN PROFITTO · SRL 148,75 €<\/div>/);

// --- alimentatore della scheda diverso da quello da comprare (MSI LEVIATHAN #4816, bundle RTX 5070) ---
assert.equal(A.wattAlimentatore('DEEPCOOL PF-600X 80+ BRONZE'), 600);
assert.equal(A.wattAlimentatore('MSI ALIMENTATORE MAG A850GL PCIE5, EU, 850W'), 850);
assert.equal(A.wattAlimentatore('GSPQ850G'), 850);
assert.equal(A.wattAlimentatore('MPG A1000G PCIE5'), 1000);
assert.equal(A.wattAlimentatore('0512'), null);                     // codice solo numerico: non si sa
assert.equal(A.wattAlimentatore('8435099500123'), null);            // EAN
const pcPsu = (codice, descrizione) => ({ pezzi: [{ tipo: 'PSU', nome_tipo: 'Alimentatore', fisso: null,
  manuale: { codice, descrizione, fornitore: 'ABACO' },
  auto: { codice, descrizione, fornitore: 'ACTION', costo: 90 } }] });
const msi = pcPsu('MAG A850GL', 'MSI ALIMENTATORE MAG A850GL PCIE5, EU, 850W, FULLY-MODULAR, 80 PLUS GOLD');
let dv = A.pezziDiversi([{ tipo: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE' }, { tipo: 'GPU', ean: 'X' }], msi);
assert.equal(dv.length, 1);
assert.equal(dv[0].motivo, '600W invece di 850W');
assert.equal(dv[0].giusto, 'MAG A850GL (oggi 90,00 € da ACTION)');
// stessa potenza ma non MSI in una build MSI
assert.equal(A.pezziDiversi([{ tipo: 'ALIMENTATORE', ean: 'DEEPCOOL PN850-D V2 80+ GOLD' }], msi)[0].motivo, 'serve un alimentatore MSI');
assert.equal(A.pezziDiversi([{ tipo: 'PSU', ean: 'MSI MAG A850GL' }], msi).length, 0);
// build DeepCool: stesso alimentatore con nomi diversi (scheda e listini) non e' un allarme
const dc850 = pcPsu('DEEPCOOL PN850-D V2 80+ GOLD', 'DEEPCOOL PN850-D V2 80+ GOLD');
assert.equal(A.pezziDiversi([{ tipo: 'PSU', ean: 'DEEPCOOL PN850-D V2 80+ GOLD' }], dc850).length, 0);
assert.equal(A.pezziDiversi([{ tipo: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE' }], dc850)[0].motivo, '600W invece di 850W');
assert.equal(A.pezziDiversi([{ tipo: 'PSU', ean: '0512' }], dc850).length, 0);        // codice numerico: niente allarme
assert.equal(A.pezziDiversi([{ tipo: 'PSU', ean: 'DEEPCOOL PQ1000M' }], dc850).length, 0);  // piu' potente: va bene
assert.equal(A.pezziDiversi([{ tipo: 'PSU', ean: 'DEEPCOOL PF-600X' }], null).length, 0);
// utile se si compra l'alimentatore giusto (prezzi di prova)
const uG = A.utileConPezziGiusti(1220, 800, dv, [{ tipo: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE', costo: 35 }]);
assert.equal(uG.lordo, A.utile(1220, 800 + 55).lordo);
assert.equal(A.utileConPezziGiusti(1220, 800, dv, [{ tipo: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE', costo: null }]), null);
assert.equal(A.utileConPezziGiusti(1220, 800, [], []), null);
const hd = A.righePezziDiversi(dv, uG);
assert.match(hd, /⚠ Alimentatore da cambiare/);
assert.match(hd, /nella scheda DEEPCOOL PF-600X 80\+ BRONZE → da ordinare MAG A850GL/);
assert.match(hd, /Con l'alimentatore giusto: utile 90,10 € · SRL 63,07 €/);
assert.equal(A.righePezziDiversi([], null), '');

// --- costo di un pezzo della scheda che la sua linea non usa (DeepCool 600W in un ordine MSI) ---
v = A.voceAutomatica(dati, { configKey: 'MSI ALTRA', variants: {} }, 'MOBO', 'B650M S2H', 'OMEGA');
assert.equal(v.origine, 'pezzo');
assert.equal(v.auto.codice, 'PLYASRAM50021');
v = A.voceAutomatica(dati, { configKey: 'MSI ALTRA', variants: {} }, 'SCHEDA MADRE', 'B650M-S2H', 'ALTRO FORNITORE');
assert.equal(v.auto.codice, 'PLYASRAM50021');                       // stesso codice, altro fornitore
assert.equal(A.cercaPerCodice(dati, 'MOBO', 'NIENTE', 'OMEGA'), null);
assert.equal(A.cercaPerCodice(dati, 'MOBO', '', 'OMEGA'), null);

// --- opzioni GPO nuove fuori scheda (Antonio 29/09: Wi-Fi, ventole, scatole, Office) ---
const pcExtra = { pezzi: [
  { tipo: 'WIFI', nome_tipo: 'Connettività', cliente: 'WI-FI + BLUETOOTH — ADATTATORE PCIE', manuale: { codice: 'WI-FI' },
    auto: null, fisso: { id: 'wifi_pcie', descrizione: 'Scheda WiFi + Bluetooth PCIe', fornitore: 'FORNITORE LOCALE', costo: 8 } },
  { tipo: 'SERVIZIO', nome_tipo: 'Servizio', cliente: 'CONSEGNA SCATOLE', manuale: { codice: 'SCATOLE' },
    auto: null, fisso: { id: 'scatole', descrizione: 'Consegna scatole originali', fornitore: '', costo: 0 } },
  { tipo: 'SOFTWARE', nome_tipo: 'Software', cliente: 'MICROSOFT OFFICE', manuale: { codice: 'OFFICE' },
    auto: null, fisso: { id: 'office', descrizione: 'Microsoft Office', fornitore: '', costo: null } },
  { tipo: 'ACCESSORIO', nome_tipo: 'Accessori', cliente: 'KIT', manuale: { codice: 'KIT' },
    auto: null, fisso: { id: 'kit_gaming', descrizione: 'Kit gaming', fornitore: 'AMAZON', costo: 40 } },
  { tipo: 'GPU', nome_tipo: 'Scheda video', manuale: { codice: 'X' }, auto: { costo: 300, fornitore: 'ACTION' }, fisso: null }
] };
let ex = A.extraOrdine(pcExtra, ['GPU', 'KIT GAMING'], [{ name: 'WIFI PCI', value: 'WIFI PCI' }], {});
assert.deepEqual(Array.from(ex, x => x.tipo), ['WIFI', 'SERVIZIO', 'SOFTWARE']);   // il kit e' gia' una riga della scheda
assert.equal(ex[0].costo, 8);
assert.equal(ex[0].personalizzata, true);                            // gia' aggiunta a mano come voce personalizzata
assert.equal(ex[1].costo, 0);
assert.equal(ex[2].costo, null);
assert.equal(ex[2].chiave, 'office');
ex = A.extraOrdine(pcExtra, ['GPU'], [], { office: 55 });             // costo di Office inserito da Antonio
assert.equal(ex.find(x => x.tipo === 'SOFTWARE').costo, 55);
assert.equal(ex.find(x => x.tipo === 'ACCESSORIO').costo, 40);
assert.equal(A.extraOrdine(null, [], [], {}).length, 0);
const hx = A.righeExtra(A.extraOrdine(pcExtra, ['KIT'], [], {}));
assert.match(hx, /Opzioni del cliente fuori scheda/);
assert.match(hx, /📶 <b>Connettività<\/b>: Scheda WiFi \+ Bluetooth PCIe <small>· FORNITORE LOCALE<\/small>/);
assert.match(hx, /8,00 €/);
assert.match(hx, /nessun costo/);
assert.match(hx, /data-extra="2"[^>]*>costo da inserire/);
assert.equal(A.righeExtra([]), '');

// --- costo del pezzo scritto nella scheda (per_codice) e stima col pezzo equivalente di oggi ---
const conCodici = { per_codice: { 'TIER ONE|3103': { costo: 250, fonte: 'listino' }, 'OMEGA|90GA5QZZ00UANF': { costo: 400, fonte: 'listino ACTION' } } };
assert.equal(A.costoScheda(conCodici, '3103', 'tier one').costo, 250);
assert.equal(A.costoScheda(conCodici, '90-GA5QZZ-00UANF', 'OMEGA').fonte, 'listino ACTION');
assert.equal(A.costoScheda(conCodici, '9999', 'TIER ONE'), null);
assert.equal(A.costoScheda({}, '3103', 'TIER ONE'), null);
assert.equal(A.costoEquivalente(pcExtra, 'GPU', {}), 300);
assert.equal(A.costoEquivalente(pcExtra, 'CPU', {}), null);
assert.equal(A.costoEquivalente(null, 'GPU', {}), null);

// --- conto dell'ordine come uno scontrino e pezzo per pezzo (Antonio 30/09: «troppo confusionarie») ---
const vend = { totale: 2440, pc: 2440, opzioni: 0, data: '2026-09-23T10:00:00Z' };
const costiProva = [{ testo: 'Pezzi della scheda', valore: 1500, sempre: true }, { testo: 'Opzioni fuori scheda', valore: 0 },
  { testo: 'Montaggio e spedizione', valore: 43.79, sempre: true }];
let hc = A.contoOrdine(vend, costiProva, 0, 180);
assert.match(hc, /Pagato dal cliente il 23\/09\/2026/);
assert.match(hc, /− IVA 22%<\/span><span>-440,00 €/);                       // 2440 − 2440/1,22
assert.match(hc, /− Scalapay e commissioni 4,5%<\/span><span>-109,80 €/);
assert.match(hc, /= Incasso netto<\/span><span>1890,20 €/);
assert.doesNotMatch(hc, /Opzioni fuori scheda/);                               // zero: non si scrive
const uc = A.utile(2440, 1543.79);
assert.match(hc, new RegExp(`= Utile.*${String(uc.lordo.toFixed(2)).replace('.', ',')}`));
assert.match(hc, /Utile SRL \(70%\) · obiettivo 180,00 €/);
assert.match(A.contoOrdine(vend, costiProva, 2, 180), /da calcolare: mancano 2 costi/);
assert.doesNotMatch(A.contoOrdine(vend, costiProva, 2, 180), /Utile SRL/);
const dp = A.dettaglioPezzi([
  { tipo: 'CPU', fornitore: 'TIER ONE', nome: '', ean: '9019', costo: 300, fonte: 'listino', consigliato: { costo: 220, fornitore: 'TIER ONE', descrizione: 'Ryzen 7 Tray' } },
  { tipo: 'GPU', fornitore: 'OMEGA', nome: '', ean: 'X1', costo: 700, fonte: 'stima', consigliato: { costo: 700, fornitore: 'ACTION', descrizione: 'RTX' } },
  { tipo: 'PSU', fornitore: 'ABACO', nome: 'DEEPCOOL PN850-D', ean: 'P', costo: 50, fonte: 'magazzino', consigliato: null },
  { tipo: 'CASE', fornitore: 'NOUA', nome: '', ean: 'C', costo: null, fonte: null, consigliato: null }]);
assert.match(dp, /<details class="acc-dettaglio"><summary>🔍 Pezzo per pezzo/);
assert.match(dp, /CPU<\/b> · TIER ONE 9019<\/span><span>300,00 €/);
assert.match(dp, /💡 consigliato: TIER ONE Ryzen 7 Tray a 220,00 € \(<b>−80,00 €<\/b>\)/);
assert.match(dp, /≈ 700,00 €/);                                               // stimato
assert.match(dp, /stimato col pezzo consigliato/);
assert.match(dp, /a magazzino: prezzo pagato/);
assert.match(dp, /CASE<\/b> · NOUA C<\/span><span><span class="acc-incompleto">manca/);
assert.equal(A.dettaglioPezzi([]), '');
// pezzo della scheda che e' quello a magazzino: prezzo pagato
const pcMag = { pezzi: [{ tipo: 'PSU', manuale: { codice: 'DEEPCOOL PN850-D V2 80+ GOLD' }, auto: { costo: 70, fornitore: 'ABACO', descrizione: 'PQ850G' }, fisso: null }] };
Object.defineProperty(pcMag.pezzi[0], 'mag', { value: { def: { costo: 50 } } });
assert.equal(A.costoMagazzino(pcMag, 'ALIMENTATORE', 'DEEPCOOL PN850-D V2 80+ GOLD'), 50);
assert.equal(A.costoMagazzino(pcMag, 'PSU', 'ALTRO ALIMENTATORE'), null);
assert.equal(A.consigliato(pcMag, 'PSU', {}).costo, 70);
assert.equal(A.consigliato(pcMag, 'GPU', {}), null);

// --- scrivanie E1–E4: AGGIORNA PREZZI PRODOTTO e CONFERMA ACQUISTO PEZZI (Antonio 30/09) ---
vm.runInContext(`var processedOrdersCache = { '556': { components: [
  { type: 'GPU', ean: 'GPU-VECCHIA', supplier: 'OMEGA', price: null },
  { type: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE', supplier: 'ABACO', price: null } ] } };`, sandbox);
assert.equal(A.acquistoConfermato('556'), false);
assert.equal(A.prezzoAcquisto('556', 'GPU', 'GPU-VECCHIA'), null);
// proposte: la scheda video cambia con quella scelta oggi; l'alimentatore a magazzino resta
const righeProva = [
  { tipo: 'GPU', ean: 'GPU-VECCHIA', fornitore: 'OMEGA', nome: 'Vecchia', costo: 350, fonte: 'stima' },
  { tipo: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE', fornitore: 'ABACO', nome: '', costo: 25, fonte: 'magazzino' }];
let prop = A.proposteOrdine(dati, '556', righeProva);
assert.equal(prop.length, 1);
assert.equal(prop[0].tipo, 'GPU');
assert.equal(prop[0].a.codice, 'GPU-1');
assert.equal(prop[0].a.fornitore, 'ACTION');
assert.equal(prop[0].ordine, '#9002');
// gia' il pezzo migliore (stesso codice e fornitore): niente da cambiare
assert.equal(A.proposteOrdine(dati, '556', [{ tipo: 'GPU', ean: 'GPU-1', fornitore: 'ACTION', costo: 300 }]).length, 0);
assert.equal(A.proposteOrdine(dati, '999', righeProva).length, 0);          // ordine senza automatico
const tp = A.tabellaProposte(prop);
assert.equal(tp.risparmio, 50);
assert.match(tp.html, /<b>#9002<\/b>/);
assert.match(tp.html, /GPU<\/b>: OMEGA Vecchia \(≈ 350,00 €\)<br>→ ACTION Scheda di prova <b>300,00 €<\/b>/);
assert.match(tp.html, /−50,00 €/);
// conferma acquisto: prezzi nella colonna price e nella copia in memoria
const scritti = [];
sandbox.window.SupabaseDB.setComponentPrices = async (id, prezzi) => { scritti.push({ id, prezzi }); return prezzi.length; };
await A.salvaPrezzi('556', [{ type: 'GPU', ean: 'GPU-VECCHIA', price: 312.456 }, { type: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE', price: 25 }]);
assert.equal(scritti.length, 1);
assert.equal(scritti[0].prezzi.length, 2);
assert.equal(A.acquistoConfermato('556'), true);
assert.equal(A.prezzoAcquisto('556', 'GPU', 'GPU VECCHIA'), 312.46);     // codici confrontati come sempre
// annulla conferma
await A.salvaPrezzi('556', [{ type: 'GPU', ean: 'GPU-VECCHIA', price: null }, { type: 'PSU', ean: 'DEEPCOOL PF-600X 80+ BRONZE', price: null }]);
assert.equal(A.acquistoConfermato('556'), false);
assert.match(A.URL_AGGIORNA_LISTINI, /^https:\/\/minimal-gamers-listini-scheduler\.theminimalgamers\.workers\.dev\/aggiorna-listini$/);
assert.match(A.dettaglioPezzi([{ tipo: 'CPU', fornitore: 'TIER ONE', nome: 'X', ean: '1', costo: 200, fonte: 'acquistato', consigliato: { costo: 100, fornitore: 'A', descrizione: 'B' } }]),
  /prezzo pagato \(acquisto confermato\)/);


// --- pezzi migliori all'elaborazione (Antonio 30/09): i pezzi piu' convenienti di oggi con le regole di sempre ---
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
// senza dati automatici (niente password/rete) la scheda resta com'e'
const schedaFerma = [{ type: 'CPU', ean: '9019', supplier: 'TIER ONE', name: null, quantity: 1 }];
assert.equal((await A.pezziMigliori(schedaFerma, { configKey: 'PC MINIMAL', variants: {} }, '999')).length, 0);
assert.equal(schedaFerma[0].ean, '9019');
const datiM = {
  generato: 'prova',
  voci: [
    { manuale: { codice: '9019', fornitore: 'TIER ONE', quantita: 1, descrizione: 'AMD Ryzen 7 7800X3D Box', costo: 250 },
      auto: { fornitore: 'TIER ONE', codice: '2520', mpn: '', descrizione: 'AMD Ryzen 7 7800X3D Tray', quantita: 1, costo: 205 }, fisso: null },
    { manuale: { codice: 'GPU-MSI-OLD', fornitore: 'ABACO', quantita: 1, descrizione: 'MSI RTX 5070 VENTUS', costo: 600 },
      auto: { fornitore: 'ACTION', codice: 'GPU-ASUS', mpn: '', descrizione: 'ASUS Dual RTX 5070', quantita: 1, costo: 560 }, fisso: null },
    { manuale: { codice: 'COOL-BIANCO', fornitore: 'ACTION', quantita: 1, descrizione: 'AIO 240 WHITE', costo: 70 },
      auto: { fornitore: 'ACTION', codice: 'COOL-NERO', mpn: '', descrizione: 'AIO 240 nero', quantita: 1, costo: 55 }, fisso: null },
    { manuale: { codice: 'RAM-KIT', fornitore: 'ACTION', quantita: 1, descrizione: 'RAM 16GB kit 2x8', costo: 60 },
      auto: { fornitore: 'ACTION', codice: 'RAM-8', mpn: '', descrizione: 'RAM 8GB', quantita: 2, costo: 40 }, fisso: null },
    { manuale: { codice: 'SSD-1TB', fornitore: 'OMEGA', quantita: 1, descrizione: 'SSD 1TB NVMe', costo: 60 },
      auto: { fornitore: 'ACTION', codice: 'SSD-A', mpn: '', descrizione: 'Crucial P3 1TB NVMe', quantita: 1, costo: 52 }, fisso: null }
  ],
  distinte: { 'PC MINIMAL': { CPU: 0, COOLER: 2, RAM: 3, SSD: 4 }, 'MSI BUILD': { GPU: 1 } },
  linee: { 'PC MINIMAL': 'MINIMAL', 'MSI BUILD': 'MSI' },
  varianti: {},
  per_valore: { 'MINIMAL|CPU|9019|TIER ONE': 0, 'MINIMAL|GPU|GPUMSIOLD|ABACO': 1, 'MINIMAL|COOLER|COOLBIANCO|ACTION': 2,
    'MINIMAL|RAM|RAMKIT|ACTION': 3, 'MINIMAL|SSD|SSD1TB|OMEGA': 4 },
  ordini: {
    '700': { nome: '#9700', pc: [
      { build: 'PC MINIMAL', linea: 'MINIMAL', quantita: 2, pezzi: [
        { tipo: 'CPU', cliente: '', manuale: { codice: '9019', descrizione: 'AMD Ryzen 7 7800X3D Box' },
          auto: { codice: '2520', fornitore: 'TIER ONE', descrizione: 'AMD Ryzen 7 7800X3D Tray', quantita: 1, costo: 205 }, fisso: null },
        { tipo: 'COOLER', cliente: '', manuale: { codice: 'COOL-BIANCO', descrizione: 'AIO 240 WHITE' },
          auto: { codice: 'COOL-NERO', fornitore: 'ACTION', descrizione: 'AIO 240 nero', quantita: 1, costo: 55 }, fisso: null }] },
      { build: 'MSI BUILD', linea: 'MSI', quantita: 1, pezzi: [
        { tipo: 'GPU', cliente: 'RTX 5070', manuale: { codice: 'GPU-MSI-OLD', descrizione: 'MSI RTX 5070 VENTUS' },
          auto: { codice: 'GPU-MSI-NEW', fornitore: 'ABACO', descrizione: 'GeForce RTX 5070 12G SHADOW 2X OC', quantita: 1, costo: 590 }, fisso: null },
        { tipo: 'PSU', cliente: '', manuale: { codice: 'MSI MAG A850GL', descrizione: 'MSI MAG A850GL 850W' },
          auto: { codice: 'MSI-A650', fornitore: 'ABACO', descrizione: 'MSI MAG A650BN 650W', quantita: 1, costo: 50 }, fisso: null }] }] }
  }
};
// il gestionale fa un PC per unita' (quantita' 2 -> .1 e .2), l'automatico una voce per riga
assert.equal(A.pcAutomatico(datiM, '700').build, 'PC MINIMAL');
assert.equal(A.pcAutomatico(datiM, '700.2').build, 'PC MINIMAL');
assert.equal(A.pcAutomatico(datiM, '700.3').build, 'MSI BUILD');
assert.equal(A.pcAutomatico(datiM, '700.4'), null);
// regole della scheda
assert.equal(A.marcaRispettata('MINIMAL', 'GPU', 'MSI RTX 5070', 'ASUS Dual RTX 5070'), true);     // Minimal: solo il chipset
assert.equal(A.marcaRispettata('MSI', 'GPU', 'RTX 5070', 'ASUS Dual RTX 5070'), false);           // MSI: sempre MSI
assert.equal(A.marcaRispettata('MSI', 'GPU', 'RTX 5070', 'GeForce RTX 5070 12G VENTUS 2X OC'), true);
assert.equal(A.marcaRispettata('MSI', 'MOBO', '4719072', 'ASRock B650M-H'), false);               // marca non nota: MSI
assert.equal(A.marcaRispettata('MSI', 'MOBO', 'ASUS PRIME B650M-A', 'ASRock B650M-H'), true);
assert.equal(A.marcaRispettata('MSI', 'PSU', 'MAG A850GL', 'MSI MAG A850GL PCIE5'), true);
assert.equal(A.marcaRispettata('DEEPCOOL', 'COOLER', 'DEEPCOOL AK400', 'ARCTIC Freezer 36'), false);
assert.equal(A.marcaRispettata('DEEPCOOL', 'COOLER', 'DEEPCOOL AK400', 'DeepCool AK400 Digital'), true);
assert.equal(A.marcaRispettata('DEEPCOOL', 'GPU', 'RTX 5060', 'ASUS RTX 5060'), true);
assert.equal(A.coloreRispettato('DISSIPATORE 240MM BIANCO', 'AIO 240 WHITE'), true);
assert.equal(A.coloreRispettato('DISSIPATORE 240MM BIANCO', 'AIO 240 nero'), false);
assert.equal(A.coloreRispettato('RAM 16GB', 'RAM 16GB Snow'), false);
assert.equal(A.coloreRispettato('RAM 16GB', 'RAM 16GB black'), true);
assert.equal(A.rispettaScheda('MINIMAL', 'PSU', 'DEEPCOOL PN850-D 850W', { descrizione: 'DeepCool PN650 650W', codice: 'X', quantita: 1 }, 1), false);
assert.equal(A.rispettaScheda('MINIMAL', 'RAM', 'RAM 16GB', { descrizione: 'RAM 8GB', codice: 'R', quantita: 2 }, 1), false);
// dati automatici pronti per le prove seguenti (stessa promessa che usa carica())
A.stato.promessa = Promise.resolve(datiM);
A.stato.caricatoIl = Date.now();
// ordine non ancora nei dati automatici: voci di distinta. Processore -> 2520 Tray; dissipatore bianco resta
// (l'automatico ne sceglie uno nero), RAM resta (2 moduli al posto del kit), case e alimentatore non si toccano
const schedaMin = [
  { type: 'CPU', ean: '9019', supplier: 'TIER ONE', name: null, quantity: 1 },
  { type: 'COOLER', ean: 'COOL-BIANCO', supplier: 'ACTION', name: null, quantity: 1 },
  { type: 'RAM', ean: 'RAM-KIT', supplier: 'ACTION', name: null, quantity: 1 },
  { type: 'SSD', ean: 'SSD-1TB', supplier: 'OMEGA', name: null, quantity: 1 },
  { type: 'PSU', ean: 'PSU-X', supplier: 'ACTION', name: null, quantity: 1 },
  { type: 'CASE', ean: 'CASE-X', supplier: 'NOUA', name: null, quantity: 1 }];
let cambi = await A.pezziMigliori(schedaMin, { configKey: 'PC MINIMAL', variants: {} }, '999');
assert.deepEqual(cambi.map(c => c.tipo).join(','), 'CPU,SSD');
assert.equal(schedaMin[0].ean, '2520');
assert.equal(schedaMin[0].supplier, 'TIER ONE');
assert.equal(schedaMin[0].name, 'AMD Ryzen 7 7800X3D Tray');
assert.equal(schedaMin[1].ean, 'COOL-BIANCO');
assert.equal(schedaMin[2].ean, 'RAM-KIT');
assert.equal(schedaMin[3].ean, 'SSD-A');
assert.equal(schedaMin[4].ean, 'PSU-X');
// gia' il pezzo migliore: la voce si ritrova anche dal codice scelto e il costo e' quello di oggi
v = A.voceAutomatica(datiM, { configKey: 'PC MINIMAL', variants: {} }, 'CPU', '2520', 'TIER ONE');
assert.equal(v.origine, 'distinta');
assert.equal(A.sceltaUguale(v, null, 'CPU', '2520'), 205);
assert.equal(A.voceAutomatica(datiM, { configKey: 'ALTRA', variants: {} }, 'CPU', '2520', 'TIER ONE').origine, 'scelta');
assert.equal((await A.pezziMigliori(schedaMin, { configKey: 'PC MINIMAL', variants: {} }, '999')).length, 0);
// build MSI senza dati dell'ordine: la voce trovata sceglie una scheda video ASUS -> resta la MSI
const schedaMsi = [{ type: 'GPU', ean: 'GPU-MSI-OLD', supplier: 'ABACO', name: null, quantity: 1 }];
assert.equal((await A.pezziMigliori(schedaMsi, { configKey: 'MSI BUILD', variants: {} }, '999')).length, 0);
assert.equal(schedaMsi[0].ean, 'GPU-MSI-OLD');
// ordine gia' nei dati automatici (terzo PC dell'ordine 700): scheda video MSI migliore si', alimentatore da 650W no
const schedaMsi3 = [
  { type: 'GPU', ean: 'GPU-MSI-OLD', supplier: 'ABACO', name: null, quantity: 1 },
  { type: 'PSU', ean: 'MSI MAG A850GL', supplier: 'ABACO', name: null, quantity: 1 }];
cambi = await A.pezziMigliori(schedaMsi3, { configKey: 'MSI BUILD', variants: {} }, '700.3');
assert.equal(cambi.length, 1);
assert.equal(schedaMsi3[0].ean, 'GPU-MSI-NEW');
assert.equal(schedaMsi3[1].ean, 'MSI MAG A850GL');
// PC dell'ordine con un'altra build: non si usa, si torna alle voci (scheda video ASUS rifiutata)
const schedaAltra = [{ type: 'GPU', ean: 'GPU-MSI-OLD', supplier: 'ABACO', name: null, quantity: 1 }];
assert.equal((await A.pezziMigliori(schedaAltra, { configKey: 'MSI BUILD', variants: {} }, '700.1')).length, 0);
// all'elaborazione si cambia solo il pezzo che l'automatico ha valutato (non quello messo dalle regole del gestionale)
const schedaDiversa = [{ type: 'CPU', ean: '3257', supplier: 'TIER ONE', name: null, quantity: 1 }];
assert.equal((await A.pezziMigliori(schedaDiversa, { configKey: 'PC MINIMAL', variants: {} }, '700.2')).length, 0);
const schedaPc2 = [{ type: 'CPU', ean: '9019', supplier: 'TIER ONE', name: null, quantity: 1 },
  { type: 'COOLER', ean: 'COOL-BIANCO', supplier: 'ACTION', name: null, quantity: 1 }];
cambi = await A.pezziMigliori(schedaPc2, { configKey: 'PC MINIMAL', variants: {} }, '700.2');
assert.equal(cambi.length, 1);
assert.equal(schedaPc2[0].ean, '2520');
assert.equal(schedaPc2[1].ean, 'COOL-BIANCO');
// AGGIORNA PREZZI PRODOTTO: stesse regole (qui il dissipatore bianco non diventa nero)
vm.runInContext(`processedOrdersCache['700.1'] = { components: [
  { type: 'CPU', ean: '3257', supplier: 'TIER ONE', name: '', price: null, quantity: 1 },
  { type: 'COOLER', ean: 'DISSIPATORE 240MM BIANCO', supplier: '', name: '', price: null, quantity: 1 } ] };`, sandbox);
prop = A.proposteOrdine(datiM, '700.1', [
  { tipo: 'CPU', ean: '3257', fornitore: 'TIER ONE', nome: 'Ryzen 7 5700X', costo: 150, fonte: 'listino' },
  { tipo: 'COOLER', ean: 'DISSIPATORE 240MM BIANCO', fornitore: '', nome: '', costo: 70, fonte: 'stima' }]);
assert.equal(prop.length, 1);                                       // il vecchio codice Tier One si cambia
assert.equal(prop[0].a.codice, '2520');
A.stato.promessa = null;

console.log('accoppiamento-auto: tutti i test passati');
