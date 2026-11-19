import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const saved = {id:21, type:'CPU', ean:'5848', supplier:'TIER ONE', name:'AMD Ryzen 7 9700X', quantity:1, price:null};
const row = {tipo:'CPU', ean:saved.ean, fornitore:saved.supplier, nome:saved.name, quantita:1, costo:190, fonte:'listino'};
const record = {...saved, stato:'pagato', costo:188.5, canale:'TIER ONE', il:'2026-11-19T10:00:00Z'};
const desk = components => ({foglioDiLavoro:1, stato:'elaborati', components, customProperties:{}});
const node = () => ({innerHTML:'', querySelectorAll:()=>[], querySelector:()=>null, setAttribute(){}, removeAttribute(){}});
function setup() {
    const panel = node();
    const navigation = node();
    const sidebar = node();
    navigation.querySelector = () => sidebar;
    const header = node();
    header.querySelector = () => navigation;
    const elements = {'suppliers-header':header,'riepilogo-auto':panel};
    const context = vm.createContext({
        window:{}, console, localStorage:{getItem:()=>null},
        document:{getElementById:id=>elements[id] || node(), querySelector:()=>null, querySelectorAll:()=>[]},
        processedOrdersCache:{'4884':desk([saved])}
    });
    vm.runInContext(source,context);
    const app = context.window.AccoppiamentoAuto;
    const data = {ordini:{}};
    Object.assign(app.stato,{dati:data, promessa:Promise.resolve(data), caricatoIl:Date.now()});
    Object.assign(app.riepilogo,{n:1, ids:['4884'], nomi:{'4884':'#4884'}, modo:'auto'});
    app.ultimiConti['4884'] = {righe:[row]};
    return {context,app,panel};
}

test('aprire Acquisti rilegge un pagamento fatto in un’altra scheda prima di mostrare il residuo', async () => {
    const {context,app,panel}=setup();
    let reads = 0;
    context.loadProcessedOrdersFromDB = async () => {
        reads++;
        const fresh = desk([saved]);
        fresh.customProperties._acquisti_parziali_gestionale = {'21':record};
        return context.processedOrdersCache = {'4884':fresh};
    };
    await app.renderRiepilogoAuto(false,true);
    assert.equal(reads,1);
    assert.equal(app.riepilogo.ultimo.righe.length,0);
    assert.equal(app.riepilogo.ultimo.registrati[0].registrato.stato,'pagato');
    assert.match(panel.innerHTML,/data-rf-fase="pronti" aria-pressed="true"[\s\S]*Nessun pezzo pronto/);
    assert.doesNotMatch(panel.innerHTML,/AMD Ryzen 7 9700X/);

    app.riepilogo.fase = 'storico';
    app.disegnaRiepilogo();
    assert.match(panel.innerHTML,/Acquistati e pagati[\s\S]*AMD Ryzen 7 9700X/);
    assert.doesNotMatch(panel.innerHTML,/data-rf-forn=|data-rf-email=/);
});

test('un articolo cambiato e pagato altrove prevale sullo SKU ancora visibile nella scheda',async () => {
    const {context,app}=setup();
    const replacement = {...saved, ean:'CPU-NETTO', supplier:'ACTION'};
    context.loadProcessedOrdersFromDB = async () => {
        const fresh = desk([replacement]);
        fresh.customProperties._acquisti_parziali_gestionale = {'21':{...record,...replacement}};
        return context.processedOrdersCache = {'4884':fresh};
    };
    await app.renderRiepilogoAuto(false,true);
    await app.renderRiepilogoAuto();
    assert.equal(app.riepilogo.ultimo.righe.length,0);
    assert.equal(app.riepilogo.ultimo.registrati[0].ean,'CPU-NETTO');
});

test('la proposta rimane nel controllo e le azioni secondarie sono raccolte in un menu',() => {
    const {app}=setup();
    const ready = {fornitore:'ACTION', categoria:'CPU', codice:'CPU-A', descrizione:'AMD Ryzen 5 9600X', quantita:2, costo:220, n:0};
    const pending = {fornitore:'ACTION', categoria:'COOLER', codice:'COOLER-A', descrizione:'MSI MAG CoreFrozr AA13', quantita:1,
        costo:19, n:1, daApplicare:true, pezzi:[{id:'4880',tipo:'COOLER',componentId:29}]};
    const summary = {righe:[ready,pending], fornitori:[{nome:'ACTION',righe:[ready,pending]}], categorie:[]};
    const [pronti,verifica] = app.fasiAcquisti(summary);
    assert.equal(pronti.numero,2);
    assert.equal(verifica.numero,1);
    const first = app.htmlAcquistiAttivi(summary,pronti.righe,'pronti','fornitori');
    assert.match(first,/AMD Ryzen 5 9600X/);
    assert.doesNotMatch(first,/MSI MAG CoreFrozr|data-rf-forn=/);
    const second = app.htmlAcquistiAttivi(summary,verifica.righe,'verifica','fornitori');
    assert.match(second,/MSI MAG CoreFrozr[\s\S]*<summary>Altre azioni<\/summary>[\s\S]*Cambia dal Buyer Desk/);
});
