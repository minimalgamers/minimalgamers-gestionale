import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const s={window:{},Intl};vm.createContext(s);vm.runInContext(readFileSync(new URL('../assets/js/order-glass.js',import.meta.url),'utf8'),s);
const G=s.window.MGOrderGlass;
const input=()=>({conti:{righe:[{tipo:'GPU',ean:'GPU',fornitore:'ACTION',nome:'Demo GPU',costo:120,quantita:1,fonte:'listino'},
 {tipo:'CPU',ean:'CPU',nome:'Demo CPU',costo:80,fonte:'acquistato'}]},nMancanti:0,utile:{srl:70,lordo:100},vendita:{totale:500},costo:230,obiettivo:80,
 auto:{pezzi:[{tipo:'GPU',manuale:{codice:'GPU'},excel:{costo:100}}]},extraLista:[{tipo:'VENTOLE',nome:'5 ventole RGB',chiave:'FAN',costo:20}],
 custom:[{id:4,value:'Personalizzazione XYZ',costo:0}],montaggio:[],servizi:[{nome:'Montaggio',costo:10}]});

test('one list includes hardware, extras, named custom requests and services without inventing missing prices',()=>{
 const model=G.render(input());assert.equal(model.list.length,5);
 for(const name of ['Demo GPU','Demo CPU','5 ventole RGB','Personalizzazione XYZ','Montaggio'])assert.ok(model.html.includes(name));
 assert.ok(model.html.includes('0,00'));assert.ok(!model.html.includes('Alla vendita'));
 assert.equal(model.list[0].delta,20);assert.equal(model.list[0].ref.historical,false);
 assert.equal(model.list.find(r=>r.kind==='custom').tipo,'PERSONALIZZATO');
 assert.match(model.html,/Excel build/);assert.match(model.html,/non sono una fotografia dei costi alla vendita/);
});

test('purchased prices stay locked and a customer paid replacement is a separate mounting row',()=>{
 const i=input();i.montaggio=[{tipo:'CPU',descrizione:'New CPU',costo:100,ordine:'#DEMO-UP'}];
 const {list,html}=G.render(i),old=list.find(r=>r.title==='Demo CPU'),upgrade=list.find(r=>r.title==='New CPU');
 assert.equal(old.costo,80);assert.equal(old.locked,true);assert.equal(old.replaced,true);
 assert.equal(upgrade.kind,'upgrade');assert.match(html,/non montare/);assert.match(html,/Da montare · upgrade pagato/);
 assert.ok(!html.includes('data-glass-change="1"'));
});

test('incomplete totals cannot show healthy profit or a spending allowance',()=>{
 const i=input();i.nMancanti=1;i.conti.righe[0].costo=null;
 const {html}=G.render(i);assert.match(html,/Costi incompleti/);assert.match(html,/Costi noti · totale parziale/);
 assert.ok(!html.includes('70,00'));assert.ok(!html.includes('Limiti di spesa'));
 assert.equal(G.budget(100,{lordo:50},80,false),null);
});

test('reference needs matching identity and quantity; current Excel cannot become historical cost',()=>{
 const i=input(),r=i.conti.righe[0];
 assert.equal(G.reference({...r,ean:'OTHER'},i.auto),null);
 assert.equal(G.reference({...r,quantita:2},i.auto),null);
 assert.equal(G.reference(r,{...i.auto,configuratore:true,lista_creata_il:'2026-10-20'}).historical,false);
});

test('spending allowance conserves the total of all other costs and corporate profit objective',()=>{
 const b=G.budget(100,{lordo:100},70,true);assert.equal(b.zero,199.99);assert.equal(b.target,99.99);
 const {html}=G.render(input());assert.match(html,/A parità degli altri costi/);
 const bad=G.render({...input(),obiettivo:900});assert.match(bad.html,/non raggiungibile cambiando solo questa riga/);
});

test('visible sort keeps original row indexes and safe labels',()=>{
 const i=input();i.conti.righe.reverse();i.conti.righe[1].nome='<img src=x>';
 const {html}=G.render(i);assert.ok(html.indexOf('&lt;img src=x&gt;')<html.indexOf('Demo CPU'));
 assert.match(html,/data-glass-change="1"/);assert.ok(!html.includes('<img src=x>'));
 assert.equal(G.selection(['a','b'],'b'),'b');assert.equal(G.selection(['a','b'],'gone'),'a');assert.equal(G.selection([],''),'');
});

test('critical notices and an alternative supplier remain visible in the main account',()=>{
 const i=input();i.avvisi=['Verify CPU <demo>'];i.conti.righe[0].costo=null;i.nMancanti=1;
 i.conti.righe[0].offertaAlternativa={fornitore:'ABACO',mpn:'EXACT-MPN',costo_unitario:90};
 const {html}=G.render(i);assert.match(html,/role="alert"/);assert.match(html,/Verify CPU &lt;demo&gt;/);
 assert.match(html,/Prezzo ACTION non disponibile/);assert.match(html,/Valuta offerta ABACO/);assert.match(html,/90,00/);
 assert.ok(!html.includes('Verify CPU <demo>'));
});

test('sidebar economics distinguish loss, break even, under-target and unknown costs',()=>{
 assert.equal(G.render({...input(),utile:{srl:-10,lordo:-10}}).state,'negative');
 const zero=G.render({...input(),utile:{srl:0,lordo:0}});assert.equal(zero.state,'warning');assert.match(zero.html,/In pareggio/);
 assert.equal(G.render(input()).state,'warning');
 assert.equal(G.render({...input(),nMancanti:1}).state,'unknown');
});

test('a shipped card retains all accounting rows and does not offer purchasing or replacement actions',()=>{
 const i=input();i.auto.solo_contabile=true;i.montaggio=[{tipo:'COOLER',descrizione:'Paid cooler',costo:50,ordine:'#DEMO-UP'}];
 const {html,list}=G.render(i);
 assert.ok(list.some(r=>r.title==='Paid cooler'));assert.match(html,/Upgrade della build spedita/);
 assert.match(html,/data-glass-confirm disabled/);assert.match(html,/Ordine già spedito/);
 assert.doesNotMatch(html,/data-glass-change=|class="mg-budget"/);
});

test('a shipped account with no registered paid costs is labelled as a current reference estimate',()=>{
 const i=input();i.auto.solo_contabile=true;i.utile={srl:-50,lordo:-50};
 const r=G.render(i);assert.equal(r.state,'reference');assert.match(r.html,/stima ai costi di riferimento/);assert.doesNotMatch(r.html,/>In perdita</);
 i.conti.confermato=true;assert.equal(G.render(i).state,'negative');
});

test('known budgets and alternate quotations complete estimates without pretending to be original supplier prices',()=>{
 const i=input();i.conti.righe[0]={...i.conti.righe[0],fonte:'riferimento_altro',riferimento:{fornitore_riferimento:'ABACO',nota:'Confermare prezzo'}};
 const r=G.render(i);assert.equal(r.state,'reference');assert.equal(r.list[0].delta,null);
 assert.match(r.html,/Stima da ABACO/);assert.match(r.html,/≈ /);assert.match(r.html,/quotazioni da confermare/);
 assert.doesNotMatch(r.html,/>In obiettivo</);assert.match(r.html,/>ACTION</);
 i.conti.righe[0].fonte='budget';assert.match(G.render(i).html,/Budget previsto/);
});
