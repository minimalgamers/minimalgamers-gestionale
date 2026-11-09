import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const sku = 'PROAMDRYZ0357';
const cpu = {
    fornitore: 'ACTION', codice: sku, descrizione: 'AMD Ryzen 7 9850X3D processor 4.7 GHz 96 MB L3 Box',
    costo: 347.06, costo_unitario: 347.06, quantita: 1, stock: 78, disponibilita: '78 pz', ordinabile: true
};
const gpu = {
    fornitore: 'ACTION', codice: 'VGASAPATI0621', categoria: 'GPU',
    descrizione: 'Sapphire Pulse Radeon RX 9070 GRE 12 GB', costo: 501.53, costo_unitario: 501.53,
    quantita: 1, stock: 50, disponibilita: '50 pz', ordinabile: true
};

function ambiente() {
    const scritture = [];
    const storage = new Map();
    const cache = {};
    const window = { SupabaseDB: {
        replacePurchaseComponent: async (id, p) => {
            scritture.push(p);
            const c = cache[id].components[0];
            return {component: {...c, ean:p.replacement.ean, supplier:p.replacement.supplier, quantity:p.replacement.quantity}};
        },
        saveProductReplacement: async (...args) => { scritture.push(args); return {}; },
        confirmOrderPurchase: async (...args) => { scritture.push(args); return {}; }
    } };
    vm.runInNewContext(source, {
        window, processedOrdersCache:cache, console, fetch:() => { throw new Error('Network prohibited'); },
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}
    });
    return {A: window.AccoppiamentoAuto, scritture, cache};
}

function scheda(id, salvati) {
    return {id, nome:`#${id}`, foglio:1, salvati,
        righe:salvati.map(c=>({tipo:c.type, ean:c.ean, fornitore:c.supplier, nome:c.name, costo:cpu.costo})), voci:[]};
}

function componente(id, type, offerta) {
    return {id, type, ean:offerta.codice, supplier:offerta.fornitore, name:offerta.descrizione, quantity:1, price:null};
}

const contatti = {invii:[
    {id:'gt',nome:'GT',fornitori:['ACTION'],intermediario:true},
    {id:'action',nome:'ACTION CPU',fornitori:['ACTION'],solo_categorie:['CPU']}
]};

test('la stessa referenza nei due slot GPU errati non raggiunge GT o la copia; le CPU corrette restano nel diretto', () => {
    const {A} = ambiente();
    const ids = ['4882','4876'];
    const cards = ids.map((id,i)=>scheda(id,[componente(i*2+1,'CPU',cpu),componente(i*2+2,'GPU',cpu)]));
    const dati = {offerte_ordinabili:[cpu], ordini:Object.fromEntries(ids.map(id=>[id,{
        pc:[{pezzi:[{tipo:'CPU',auto:cpu},{tipo:'GPU',auto:cpu}]}]
    }]))};
    const piano = A.daOrdinare(dati,cards,{});
    assert.equal(piano.pronti,2);
    const errata = piano.righe.find(r=>r.categoria==='GPU');
    assert.equal(errata.quantita,2);
    assert.equal(errata.senzaCosto,true);
    assert.match(errata.categoriaIncoerente,/è CPU, la distinta richiede GPU/);
    assert.equal(A.testoOrdineFornitore(piano.fornitori[0]).split('\n').length,1);
    const bozze = A.ordiniEmail(piano,contatti).invii;
    assert.equal(bozze.length,1);
    assert.equal(bozze[0].id,'action');
    assert.equal(bozze[0].pezzi,2);
    const html = A.htmlFornitoriDaOrdinare(piano);
    assert.match(html,/Categoria incompatibile: PROAMDRYZ0357 è CPU, la distinta richiede GPU/);
    assert.match(html,/Cambia dal Buyer Desk/);
    assert.equal(cards[0].salvati[1].ean,sku);
});

test('l’offerta incompatibile non si applica anche quando arriva come proposta', () => {
    const {A} = ambiente();
    const dati = {offerte_ordinabili:[cpu], ordini:{'4882':{pc:[{pezzi:[{tipo:'GPU',auto:cpu}]}]}}};
    const piano = A.daOrdinare(dati,[scheda('4882',[componente(1,'GPU',gpu)])],{});
    assert.equal(piano.daApplicare,0);
    assert.equal(piano.pronti,0);
    assert.match(piano.righe[0].categoriaIncoerente,/Categoria incompatibile/);
    assert.throws(()=>A.validaScelte(dati,[{orderId:'4882',ordine:'#4882',tipo:'GPU',a:cpu}]),/Categoria incompatibile/);
});

test('il salvataggio rifiuta un processore nello slot GPU e permette una GPU per correggere una riga già errata', async () => {
    const {A, scritture, cache} = ambiente();
    cache['4882'] = {components:[componente(1,'GPU',cpu)]};
    const p = {id:'4882',tipo:'GPU',ean:sku,fornitore:'ACTION',componentId:1,quantita:1};
    await assert.rejects(()=>A.sostituisciAcquisto(p,cpu), /è CPU, la distinta richiede GPU/);
    await assert.rejects(()=>A.salvaSostituzioneDefinitiva('4882',p,cpu), /Categoria incompatibile/);
    await assert.rejects(()=>A.salvaConfermaCompleta('4882',[{...cpu,tipo:'GPU'}],{}), /Categoria incompatibile/);
    assert.equal(scritture.length,0);
    const correzione = await A.sostituisciAcquisto(p,gpu);
    assert.equal(correzione.ean,gpu.codice);
    assert.equal(correzione.type,'GPU');
    assert.equal(scritture.length,1);
});

test('le righe legacy con titoli di dissipatori o schede madri non diventano CPU', () => {
    const {A} = ambiente();
    for (const [categoria,descrizione] of [
        ['MOBO','ASUS B650 motherboard for AMD Ryzen 7 9850X3D'],
        ['COOLER','DeepCool raff. CPU compatibile AMD Ryzen 7 9850X3D'],
        ['COOLER','Intel Core i7-14700K cooler'],
        ['ACCESSORIO','AMD Ryzen 7 9850X3D Bundle'],
        ['GPU','Custom SKU']
    ]) assert.equal(A.rigaOrdinabile({categoria,descrizione,fornitore:'ACTION'}),true,descrizione);
    assert.equal(A.rigaOrdinabile({categoria:'GPU',descrizione:cpu.descrizione,fornitore:'ACTION'}),false);
});
