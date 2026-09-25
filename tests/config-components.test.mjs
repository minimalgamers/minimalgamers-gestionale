import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Distinta base (25/09/2026): Supabase restituisce al massimo 1000 righe per
// richiesta e il 20/09 ogni distinta era stata salvata 4 volte con le righe
// mescolate. dbGetConfigs deve leggere tutte le pagine e contare una volta sola
// le copie identiche, senza toccare i componenti doppi legittimi.
let source = readFileSync(new URL('../assets/js/supabase-config.js', import.meta.url), 'utf8');
// Il client vero si scarica da CDN: nel test lo sostituisce un finto Supabase.
source = source.replace(/\(async \(\) => \{\s*const \{ createClient \}[\s\S]*?\}\)\(\);/, '');

function fakeSupabase(tables) {
  const calls = [];
  const query = (table) => {
    const state = { table, order: null, range: null };
    const run = () => {
      let rows = [...(tables[table] || [])];
      if (state.order) rows.sort((a, b) => a[state.order] - b[state.order]);
      const [from, to] = state.range || [0, 999];
      calls.push({ table, from, to });
      return { data: rows.slice(from, Math.min(to, from + 999) + 1), error: null };   // max 1000 righe
    };
    const builder = {
      select() { return builder; },
      order(col) { state.order = col; return builder; },
      range(from, to) { state.range = [from, to]; return builder; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } }
    };
    return builder;
  };
  return { from: query, calls };
}

const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} }, TextEncoder, crypto: globalThis.crypto };
vm.createContext(sandbox);
vm.runInContext(`${source}\nwindow.__setSupabase = (c) => { supabase = c; };\nwindow.__getConfigs = dbGetConfigs;`, sandbox);

const row = (id, config_id, component_type, ean_value, supplier) => ({ id, config_id, component_type, ean_value, supplier });
const components = [];
let id = 1;
// 1.200 righe di riempimento prima (altre configurazioni), cosi' le distinte sotto
// finiscono oltre la prima pagina da 1000, come nel database vero.
for (let i = 0; i < 1200; i++) components.push(row(id++, 99, 'CPU', `X${i}`, 'ACTION'));
// config 1: 4 copie mescolate (come MSI DOMINION il 20/09)
const base = [['CPU', '1298', 'TIER ONE'], ['MOBO', 'B650M S2H', 'OMEGA'], ['GPU', 'NE75', 'OMEGA'], ['CASE', 'CASE ATX', 'ALTRO']];
const order = [0, 0, 1, 2, 1, 3, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
for (const i of order) components.push(row(id++, 1, ...base[i]));
// config 2: due ventole uguali legittime, salvata 2 volte
for (let copy = 0; copy < 2; copy++) for (const c of [['CASE', 'H6', 'ACTION'], ['FAN', 'P12', 'AMAZON'], ['FAN', 'P12', 'AMAZON']]) components.push(row(id++, 2, ...c));
// config 3: distinta normale con due componenti uguali, una sola copia
for (const c of [['CPU', '7537', 'TIER ONE'], ['RAM', '16GB', 'AMAZON'], ['RAM', '16GB', 'AMAZON']]) components.push(row(id++, 3, ...c));

const fake = fakeSupabase({
  standard_configs: [
    { id: 1, config_name: 'MSI DOMINION', full_name: 'MSI DOMINION - i5' },
    { id: 2, config_name: 'SETUP VOLT', full_name: 'SETUP VOLT' },
    { id: 3, config_name: 'PC GAMING HECTORE', full_name: 'HECTORE' },
    { id: 4, config_name: 'VUOTA', full_name: 'VUOTA' }
  ],
  standard_config_components: components
});
sandbox.window.__setSupabase(fake);
const cfgs = JSON.parse(JSON.stringify(await sandbox.window.__getConfigs()));   // oggetti del contesto vm -> normali

assert.deepEqual(cfgs['MSI DOMINION'].components.map(c => c.type), ['CPU', 'MOBO', 'GPU', 'CASE']);
assert.deepEqual(cfgs['MSI DOMINION'].components[0], { type: 'CPU', value: '1298', supplier: 'TIER ONE' });
assert.deepEqual(cfgs['SETUP VOLT'].components.map(c => c.type), ['CASE', 'FAN', 'FAN']);
assert.deepEqual(cfgs['PC GAMING HECTORE'].components.map(c => c.type), ['CPU', 'RAM', 'RAM']);
assert.deepEqual(cfgs['VUOTA'].components, []);
// tutte le pagine lette, ordinate per id
const pagine = fake.calls.filter(c => c.table === 'standard_config_components');
assert.equal(pagine.length, 2);
assert.deepEqual(pagine.map(p => p.from), [0, 1000]);

console.log('config-components: ok');
