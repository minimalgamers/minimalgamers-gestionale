import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

// PC del configuratore e colori delle linee (Antonio 03/10/2026): «gli ordini dei PC del configuratore non hanno
// una pagina nel gestionale... VA ASSOLUTAMENTE RISOLTO», MSI rosse, DeepCool ciano, configuratore con etichetta.
const sorgente = readFileSync(new URL('../assets/js/build-configuratore.js', import.meta.url), 'utf8');

const datiListini = {
  configuratore: ['555'],
  ordini: {
    9100: { nome: '#9100', pc: [{
      configuratore: true, product_id: '555', nome_build: 'NEBULA', build: 'CONFIGURATORE', quantita: 1,
      pezzi: [
        { tipo: 'CPU', tipo_gestionale: 'CPU', cliente: 'AMD Ryzen 7 8700G',
          manuale: { codice: 'A87', fornitore: 'ACTION', descrizione: 'AMD Ryzen 7 8700G processor Box', quantita: 1 },
          auto: { codice: 'O87', fornitore: 'OMEGA', descrizione: 'AMD RYZEN 7 8700G BOX', quantita: 1, costo: 200 } },
        { tipo: 'GPU', tipo_gestionale: 'GPU', cliente: 'Grafica integrata AMD Radeon Graphics',
          manuale: { codice: 'INTEGRATA', fornitore: 'INTEGRATA', quantita: 1 }, auto: null,
          fisso: { costo: 0 } },
        { tipo: 'SSD', tipo_gestionale: 'SSD', cliente: 'Samsung 990 EVO Plus 1TB',
          manuale: { codice: 'SPARITO', fornitore: 'OMEGA', descrizione: 'Samsung 990 EVO Plus 1TB', quantita: 1, costo: 70 },
          auto: null },
        { tipo: 'MOUSE', tipo_gestionale: 'MOUSE', cliente: 'Logitech G502 X',
          manuale: { codice: 'M1', fornitore: 'ACTION', quantita: 1 },
          auto: { codice: 'M1', fornitore: 'ACTION', descrizione: 'Logitech G502 X Gaming Mouse', quantita: 1 } }
      ] }] },
    9200: { nome: '#9200', pc: [{ build: 'PC GAMING REX', product_id: '10291800277335', pezzi: [] }] }
  }
};

function sandbox(dati, ordiniShopify = []) {
  const s = {
    console: { log() {}, warn() {}, error() {} },
    sessionStorage: { getItem: (k) => (k === 'shopify_orders' ? JSON.stringify(ordiniShopify) : null) },
    identifyPCConfig: (nome, silent, pid) => {
      const n = String(nome).toUpperCase();
      if (String(pid) === '10487265689943' || n.startsWith('MSI ')) return { configKey: 'MSI ORION', components: [] };
      if (n.includes('DEEPCOOL')) return { configKey: 'PC GAMING DEEPCOOL CRYO', components: [] };
      if (n.startsWith('PC GAMING REX')) return { configKey: 'PC GAMING REX', components: [] };
      return null;
    }
  };
  s.window = s;
  s.window.AccoppiamentoAuto = { stato: { dati }, carica: async () => dati };
  vm.createContext(s);
  vm.runInContext(sorgente, s);
  return s;
}

const s = sandbox(datiListini);
const B = s.window.BuildConfiguratore;

// --- riconoscimento: SKU della riga, oppure i dati dei listini (PC creati prima dello SKU) ---
assert.equal(B.eConfiguratore({ name: 'PC GAMING REX', sku: 'MG-CFG-11129211388247', product_id: 1 }), true,
  'lo SKU dice configuratore anche se il nome coincide con una build Minimal');
assert.equal(B.eConfiguratore({ name: 'PC GAMING NEBULA', product_id: 555 }), true);
assert.equal(B.eConfiguratore({ name: 'PC GAMING REX - RYZEN 5 9600X', product_id: 10291800277335 }), false);

// --- linea dalla build ---
assert.equal(B.lineaDaConfig('MSI ORION'), 'MSI');
assert.equal(B.lineaDaConfig('MSI BUNDLE BASTION'), 'MSI');
assert.equal(B.lineaDaConfig('PC GAMING DEEPCOOL CRYO'), 'DEEPCOOL');
assert.equal(B.lineaDaConfig('DEEPCOOL AURORA'), 'DEEPCOOL');
assert.equal(B.lineaDaConfig('CONFIGURATORE NEBULA'), 'CONFIGURATORE');
assert.equal(B.lineaDaConfig('PC GAMING REX'), 'MINIMAL');
assert.equal(B.lineaDellaRiga({ name: 'MSI ORION - PC GAMING', product_id: 10487265689943 }), 'MSI');
assert.equal(B.lineaDellaRiga({ name: 'PC GAMING NEBULA', sku: 'MG-CFG-555', product_id: 555 }), 'CONFIGURATORE');

// --- pezzi della scheda: lo stesso prodotto dal fornitore di oggi, grafica integrata, nomi esatti ---
const r = await B.componenti('9100', { name: 'PC GAMING NEBULA', product_id: 555, sku: 'MG-CFG-555' });
assert.equal(r.ok, true);
assert.equal(r.configName, 'CONFIGURATORE NEBULA');
assert.deepEqual(JSON.parse(JSON.stringify(r.components)), [
  { type: 'CPU', ean: 'O87', name: 'AMD RYZEN 7 8700G BOX', supplier: 'OMEGA', price: null, quantity: 1 },
  { type: 'GPU', ean: 'INTEGRATA', name: 'Grafica integrata AMD Radeon Graphics', supplier: 'INTEGRATA', price: null, quantity: 1 },
  { type: 'SSD', ean: 'SPARITO', name: 'Samsung 990 EVO Plus 1TB', supplier: 'OMEGA', price: null, quantity: 1 },
  { type: 'MOUSE', ean: 'M1', name: 'Logitech G502 X Gaming Mouse', supplier: 'ACTION', price: null, quantity: 1 }
]);
// PC sdoppiato (9100.2): stesso prodotto, stessa lista
assert.equal((await B.componenti('9100.2', { name: 'PC GAMING NEBULA', product_id: 555 })).ok, true);
// build Minimal: non e' un PC del configuratore, resta alla sua distinta
assert.equal(await B.componenti('9200', { name: 'PC GAMING REX - X', product_id: 10291800277335 }), null);
// SKU del configuratore ma lista non ancora arrivata dai listini: non si elabora a vuoto
const attesa = await B.componenti('9300', { name: 'PC GAMING NUOVO', product_id: 777, sku: 'MG-CFG-777' });
assert.equal(attesa.ok, false);
assert.match(attesa.errore, /non è ancora arrivata/);

// --- colori delle card ---
function card() {
  const h2 = { children: [], appendChild(x) { this.children.push(x); }, querySelector(sel) { return this.children.find(c => sel === '.mg-tag-linea') || null; } };
  const classi = new Set(['order-card']);
  return {
    h2, dataset: {},
    classList: { add: (c) => classi.add(c), remove: (c) => classi.delete(c), contains: (c) => classi.has(c) },
    classi,
    querySelectorAll: (sel) => (sel === '.card-header h2' ? [h2] : []),
    querySelector: () => null
  };
}
s.document = {
  head: { appendChild() {} }, getElementById: () => null,
  createElement: () => ({ className: '', textContent: '', title: '' })
};
const ordiniShopify = [
  { id: 9100, line_items: [{ name: 'PC GAMING NEBULA', product_id: 555, sku: 'MG-CFG-555' }] },
  { id: 9400, line_items: [{ name: 'MSI ORION - PC GAMING', product_id: 10487265689943 }, { name: 'OPZIONI MSI ORION', product_id: 1 }] },
  { id: 9500, line_items: [{ name: 'PC GAMING DEEPCOOL CRYO - RYZEN 7', product_id: 11193690718551 }] },
  { id: 9200, line_items: [{ name: 'PC GAMING REX - RYZEN 5 9600X', product_id: 10291800277335 }] }
];
const s2 = sandbox(datiListini, ordiniShopify);
s2.document = s.document;
const B2 = s2.window.BuildConfiguratore;
for (const [id, attesaLinea, classe] of [[9100, 'CONFIGURATORE', 'mg-linea-configuratore'], [9400, 'MSI', 'mg-linea-msi'],
  [9500, 'DEEPCOOL', 'mg-linea-deepcool'], [9200, 'MINIMAL', null]]) {
  const c = card();
  const linea = await B2.decoraOrdine(c, { id, items: [{ name: 'x' }] }, 'orders-container');
  assert.equal(linea, attesaLinea, `linea dell'ordine ${id}`);
  if (classe) {
    assert.ok(c.classi.has(classe), `card ${id} colorata`);
    assert.equal(c.h2.children.length, 1, `etichetta sulla card ${id}`);
  } else {
    assert.equal(c.classi.size, 1, 'le build Minimal restano come sono');
  }
}
const scrivania = card();
assert.equal(B2.decoraScrivania(scrivania, { configName: 'CONFIGURATORE NEBULA' }, 'CONFIGURATORE NEBULA'), 'CONFIGURATORE');
assert.ok(scrivania.classi.has('mg-linea-configuratore'));
const finalizzato = card();
await B2.decoraOrdine(finalizzato, { id: 9400, items: [{ name: 'x' }] }, 'finalized-container');
assert.ok(finalizzato.classi.has('mg-stato'), 'nei finalizzati resta il colore dello stato, la linea e\' l\'anello');

// --- il gestionale usa la lista in ogni strada di elaborazione ---
const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const multi = readFileSync(new URL('../assets/js/multi-order-handler.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(app, /BuildConfiguratore\.componenti\(orderId, pcItem\)/, 'elaborazione di un PC');
assert.match(multi, /BuildConfiguratore\.componenti\(orderId, targetPcItem\)/, 'PC sdoppiato');
assert.match(multi, /BuildConfiguratore\.componenti\(orderIdWithSuffix, pcItem\)/, 'ordine con piu\' PC');
assert.match(app, /if \(!daConfiguratore\) await applicaPezziMigliori/, 'niente equivalenti: si compra il prodotto scelto');
assert.match(app, /BuildConfiguratore\.decoraOrdine\(card, order, containerId\)/);
assert.match(app, /BuildConfiguratore\.decoraScrivania\(card, order, config\.configKey\)/);
assert.ok(html.indexOf('build-configuratore.js') > html.indexOf('accoppiamento-auto.js'), 'si carica dopo l\'automatico');
// la vecchia scheda «Configuratore» (tabella Supabase leggibile con la chiave pubblica, non piu' scritta) e' tolta
const searchFix = readFileSync(new URL('../assets/js/search-fix.js', import.meta.url), 'utf8');
assert.doesNotMatch(searchFix, /script\.src = 'assets\/js\/configuratore-ordini\.js/, 'nessuna seconda strada per i PC del configuratore');
assert.equal(existsSync(new URL('../assets/js/configuratore-ordini.js', import.meta.url)), false);
assert.match(html, /search-fix\.js\?v=2/, 'versione nuova, altrimenti il browser tiene la vecchia scheda');

console.log('PC del configuratore e colori delle linee: verifiche superate');
