import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/accoppiamento-auto.js', import.meta.url), 'utf8');
const montaggio = readFileSync(new URL('../assets/js/montaggio-export.js', import.meta.url), 'utf8');
const saved = {id:21, type:'CPU', ean:'5848', supplier:'TIER ONE', name:'AMD Ryzen 7 9700X', quantity:1, price:null};
const row = {tipo:'CPU', ean:saved.ean, fornitore:saved.supplier, nome:saved.name, quantita:1, costo:190, fonte:'listino'};
const record = {...saved, stato:'pagato', costo:188.5, canale:'TIER ONE', il:'2026-11-19T10:00:00Z'};
const desk = components => ({foglioDiLavoro:1, stato:'elaborati', components, customProperties:{}});
const node = () => ({innerHTML:'', querySelectorAll:()=>[], querySelector:()=>null, setAttribute(){}, removeAttribute(){}});
function setup() {
    const events = {};
    const panel = node();
    const navigation = node();
    const sidebar = node();
    navigation.querySelector = () => sidebar;
    const header = node();
    header.querySelector = () => navigation;
    const elements = {'suppliers-header':header,'riepilogo-auto':panel};
    const context = vm.createContext({
        window:{}, console, localStorage:{getItem:()=>null},
        document:{
            readyState:'loading', visibilityState:'visible',
            getElementById:id=>elements[id] || node(), querySelector:()=>null, querySelectorAll:()=>[],
            addEventListener(type,callback) { events[type] = callback; }
        },
        processedOrdersCache:{'4884':desk([saved])}
    });
    vm.runInContext(montaggio,context);
    vm.runInContext(source,context);
    const app = context.window.AccoppiamentoAuto;
    const data = {ordini:{}};
    Object.assign(app.stato,{dati:data, promessa:Promise.resolve(data), caricatoIl:Date.now()});
    Object.assign(app.riepilogo,{n:1, ids:['4884'], nomi:{'4884':'#4884'}, modo:'auto'});
    app.ultimiConti['4884'] = {righe:[row]};
    return {context,app,panel,events};
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
    assert.doesNotMatch(panel.innerHTML,/data-rf-forn=|data-rf-email=|data-rf-cambia(?:-gruppo)?=/);
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

test('tornare ad Acquisti controlla il registro in background e ridisegna solo quando cambia', async () => {
    const {context, app, panel, events} = setup();
    context.document.querySelector = selector => selector === '#suppliers-container.active' ? panel : null;
    await app.renderRiepilogoAuto();
    app.riepilogo.solo = 'TIER ONE';
    app.disegnaRiepilogo();
    const initial = panel.innerHTML;
    let reads = 0;
    let riceviOrdini;
    context.loadProcessedOrdersFromDB = () => {
        reads++;
        return new Promise(resolve => {
            riceviOrdini = ordini => resolve(context.processedOrdersCache = ordini);
        });
    };

    const verifica = events.visibilitychange();
    assert.equal(reads, 1);
    assert.equal(panel.innerHTML, initial);
    await events.visibilitychange();
    assert.equal(reads, 1);
    // Aggiunta simulata dal browser (per esempio un dettaglio aperto): resta se i dati coincidono.
    panel.innerHTML += '<details open>Già aperto</details>';
    riceviOrdini({'4884':desk([saved])});
    await verifica;
    assert.match(panel.innerHTML, /Già aperto/);
    await events.visibilitychange();
    assert.equal(reads, 1);

    app.riepilogo.riletturaIl = 0;
    const verificaDopoAcquisto = events.visibilitychange();
    const fresh = desk([saved]);
    fresh.customProperties._acquisti_parziali_gestionale = {'21':record};
    riceviOrdini({'4884':fresh});
    await verificaDopoAcquisto;
    assert.equal(app.riepilogo.ultimo.righe.length, 0);
    assert.equal(app.riepilogo.ultimo.registrati.length, 1);
    assert.match(panel.innerHTML, /Nessun pezzo pronto/);
});

test('la vista compatta mostra subito lo stock insufficiente e tiene gli ordini nei dettagli', () => {
    const { app } = setup();
    const riga = {fornitore:'ABACO', categoria:'COOLER', codice:'DPAG300', descrizione:'DeepCool AG300',
        quantita:38, costo:429.4, poco:5, n:0, ordini:['#1','#2','#3'], pezzi:[{id:'1',tipo:'COOLER'}]};
    const riepilogo = {righe:[riga], fornitori:[{nome:'ABACO',righe:[riga]}], categorie:[]};
    const [pronti, verifica] = app.fasiAcquisti(riepilogo);
    assert.equal(pronti.numero, 0);
    const html = app.htmlAcquistiAttivi(riepilogo, verifica.righe, 'verifica', 'fornitori');
    assert.match(html, /class="acc-rf-articoli"/);
    assert.match(html, /5 disponibili su 38 richiesti\.[\s\S]*data-rf-cambia="0"/);
    assert.match(html, /<summary>Dettagli · 3 ordini<\/summary>[\s\S]*#1 #2 #3/);
});

test('il colore del LT360 VISION in Acquisti viene dall’identità del prodotto', () => {
    const { app } = setup();
    const nome = "DEEPCOOL RAFF. LIQUIDO LT360 VISION ARGB LCD 4.5''";
    const prodotto = {fornitore:'ABACO', categoria:'COOLER', codice:'DPLT360VISIONARGB',
        descrizione:nome, quantita:4, costo:377.04, n:0, nonDisponibile:true};
    const html = riga => app.htmlAcquistiAttivi({righe:[riga], categorie:[],
        fornitori:[{nome:riga.fornitore, righe:[riga]}]}, [riga], 'verifica', 'fornitori');
    assert.match(html(prodotto), /DPLT360VISIONARGB[\s\S]*— NERO \(BLACK\)/);
    assert.match(html(prodotto), /oggi non disponibile da questo fornitore/);
    assert.match(html({...prodotto, codice:'ALTRO-CODICE', mpn:'R-LT360VISION-WHAMMC-G-1'}), /— BIANCO \(WHITE\)/);
    assert.match(html({...prodotto, codice:'ALTRO-CODICE', ean:'6933412730163'}), /— BIANCO \(WHITE\)/);
    assert.doesNotMatch(html({...prodotto, fornitore:'ALTRO'}), /NERO|BIANCO/);
    assert.match(html({...prodotto, mpn:'R-LT360VISION-WHAMMC-G-1'}), /colore da verificare/);
    assert.equal(prodotto.descrizione, nome);
});

test('il cambio fornitore è visibile su righe pronte, proposte e bloccate',() => {
    const {app}=setup();
    const ready = {fornitore:'ACTION', categoria:'CPU', codice:'CPU-A', descrizione:'AMD Ryzen 5 9600X', quantita:2,
        costo:220, n:0, pezzi:[{id:'4884',tipo:'CPU',componentId:21}]};
    const pending = {fornitore:'ACTION', categoria:'COOLER', codice:'COOLER-A', descrizione:'MSI MAG CoreFrozr AA13', quantita:1,
        costo:19, n:1, daApplicare:true, pezzi:[{id:'4880',tipo:'COOLER',componentId:29}]};
    const blocked = {fornitore:'ACTION', categoria:'RAM', codice:'RAM-A', descrizione:'RAM senza stock', quantita:1,
        costo:80, n:2, nonDisponibile:true, pezzi:[{id:'4880',tipo:'RAM',componentId:30}]};
    const righe = [ready,pending,blocked];
    const summary = {righe, fornitori:[{nome:'ACTION',righe}], categorie:[]};
    const [pronti,verifica] = app.fasiAcquisti(summary);
    assert.equal(pronti.numero,2);
    assert.equal(verifica.numero,2);
    const first = app.htmlAcquistiAttivi(summary,pronti.righe,'pronti','fornitori');
    assert.match(first,/AMD Ryzen 5 9600X[\s\S]*data-rf-cambia="0"[^>]*>🔁 Cambia fornitore<\/button><details class="acc-rf-menu">/);
    assert.doesNotMatch(first,/MSI MAG CoreFrozr|data-rf-forn=/);
    const second = app.htmlAcquistiAttivi(summary,verifica.righe,'verifica','fornitori');
    assert.match(second,/MSI MAG CoreFrozr[\s\S]*data-rf-applica="1"[^>]*>[^<]+<\/button><button[^>]+data-rf-cambia="1"/);
    assert.match(second,/RAM senza stock[\s\S]*data-rf-cambia="2"[^>]*>🔁 Cambia fornitore<\/button><details class="acc-rf-menu">/);
    assert.match(second,/<summary>Altre azioni<\/summary><div[^>]*><button[^>]+data-rf-escludi="1"/);
});
