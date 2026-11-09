import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// In-memory DB doubles only: these tests must never read or write live records.
const source=readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8');
const storage=new Map(), calls=[];
const sandbox={window:{}, console:{log(){},warn(){},error(){}}, processedOrdersCache:{},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  fetch:()=>{throw Error('Network prohibited in purchase summary tests');}};
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const A=sandbox.window.AccoppiamentoAuto, J=x=>JSON.parse(JSON.stringify(x));
const component=(id,type,code,supplier,quantity=1)=>({id,type,ean:code,supplier,name:code,quantity,price:null});
const row=c=>({tipo:c.type,ean:c.ean,fornitore:c.supplier,nome:c.name,quantita:c.quantity,costo:50*c.quantity,fonte:'listino'});
const card=(id,components,foglio=1)=>({id,nome:`#${id}`,foglio,salvati:components,righe:components.map(row),voci:[]});
const offer=(code,supplier,cost,stock=100,quantity=1)=>({codice:code,fornitore:supplier,descrizione:`SSD NVMe ${code}`,costo:cost,
  quantita:quantity,disponibilita:`${stock} pz`,stock_libero_prima:stock,prezzo_listino:cost});

// Real allocation is per PC unit. Partial coverage must not reuse the first offer for missing units.
const aa=offer('SSD-A','ACTION',50,1),bb=offer('SSD-B','ABACO',55,1);
const part={tipo:'SSD',requisito:'NVMe 500GB o superiore',manuale:{codice:'OLD'},auto:null,costo:null,
  auto_parti:[{...aa,pc:1},{...bb,pc:1}],quantita_non_coperta:1,
  regola_acquisto:'Primari: ACTION, OMEGA, TIER ONE',allocazione:{pc_richiesti:3,pc_coperti:2,pc_mancanti:1}};
assert.equal(A.parteDellUnita(part,0).auto.codice,'SSD-A');
assert.equal(A.parteDellUnita(part,1).auto.codice,'SSD-B');
assert.equal(A.parteDellUnita(part,2).auto,null);
assert.equal(A.parteDellUnita(part,2).allocazione_unita.coperta,false);
const data={ordini:{'900':{nome:'#900',pc:[{quantita:3,pezzi:[part]}]}}};
const cards=['900','900.2','900.3'].map((id,i)=>card(id,[component(10+i,'SSD','OLD','CASEKING')]));
const before=J(cards), plan=J(A.daOrdinare(data,cards,{}));
assert.deepEqual(J(cards),before,'opening/recalculating must never replace assembly components');
assert.deepEqual(plan.fornitori.map(f=>[f.nome,f.pezzi,f.costo]),[['ABACO',1,55],['ACTION',1,50],['DA SCEGLIERE',1,0]]);
assert.equal(plan.daApplicare,2);assert.equal(plan.pezzi,3);assert.equal(plan.totale,105);
assert.equal(plan.pronti,0);assert.equal(plan.prontoTotale,0);
assert.equal(A.rigaOrdinabile({quantita:1,costo:50,daVerificare:true}),false,'unverified supplier availability cannot enter an order');
assert.equal(plan.righe.find(r=>r.daDecidere).quantita,1);
assert.equal(plan.righe.find(r=>r.codice==='SSD-B').pezzi[0].id,'900.2');
assert.equal(plan.righe.find(r=>r.codice==='SSD-A').pezzi[0].ean,'OLD');
assert.equal(plan.righe.find(r=>r.codice==='SSD-A').pezzi[0].componentId,10);
for(const f of plan.fornitori)assert.equal(A.testoOrdineFornitore(f),'','pending or uncovered rows cannot be ordered');
assert.equal(A.ordiniEmail(plan,{invii:[{nome:'test',fornitori:['ACTION','ABACO'],a:['none@example.invalid']}]}).invii.length,0);
const rendered=A.htmlFornitoriDaOrdinare(plan);
assert.match(rendered,/Applica proposta alle schede/);assert.match(rendered,/Quantità ancora da coprire: 1/);
assert.match(rendered,/Acquisto netto unitario/);assert.match(rendered,/totale riga/);
assert.match(rendered,/Stock libero: 1 pezzi/);assert.match(rendered,/Perché questo pezzo/);
assert.doesNotMatch(rendered,/si allinea con|gli altri vanno presi altrove/);

// Ready rows group quantity and cost; unknown names do not display a distributor SKU as a product name.
const c1=component(20,'SSD','SSD-A','ACTION'),c2=component(21,'SSD','SSD-A','ACTION');
const readyData={ordini:{'901':{pc:[{quantita:2,pezzi:[{tipo:'SSD',auto:{...aa,disponibilita:'10 pz',stock_libero_prima:10},requisito:'NVMe 500GB'}]}]}}};
const readyCards=[card('901',[c1]),card('901.2',[c2])];
const ready=J(A.daOrdinare(readyData,readyCards,{}));
assert.deepEqual([ready.pronti,ready.pezzi,ready.totale,ready.prontoTotale],[2,2,100,100]);
assert.equal(A.testoOrdineFornitore(ready.fornitori[0]),'x2 | SSD-A - SSD NVMe SSD-A');
assert.equal(ready.righe[0].pezzi.length,2);
assert.equal(A.nomeAcquisto('VGAASUATI0472',['VGAASUATI0472','RTX 5060 Ti 8GB'],'GPU'),'RTX 5060 Ti 8GB');
assert.equal(A.nomeAcquisto('CODE',['CODE'],'GPU'),'GPU — nome prodotto da verificare');
const noCatalog=J(A.daOrdinare(null,[card('902',[component(22,'GPU','BARE-SKU','ACTION')])],{}));
assert.equal(noCatalog.righe[0].descrizione,'GPU — nome prodotto da verificare');

// Exclusion is keyed to an exact order/unit/component. It cannot leak to other units or desks.
const target=ready.righe[0].pezzi[0],excludedCards=J(readyCards);
excludedCards[0].esclusioni={[target.chiaveAcquisto]:{...target,escluso:true,quantita:1,foglio:1}};
const excluded=J(A.daOrdinare(readyData,excludedCards,{}));
assert.deepEqual([excluded.pezzi,excluded.totale,excluded.pronti,excluded.esclusioni.length],[1,50,1,1]);
assert.equal(excluded.esclusioni[0].pezzi[0].id,'901');
assert.equal(excluded.righe[0].pezzi[0].id,'901.2');
assert.equal(A.testoOrdineFornitore(excluded.fornitori[0]),'x1 | SSD-A - SSD NVMe SSD-A');
assert.match(A.htmlEsclusioniAcquisto(excluded),/Restano nella distinta di montaggio/);
assert.match(A.htmlEsclusioniAcquisto(excluded),/data-rf-ripristina="0"/);
assert.deepEqual(excludedCards[0].salvati,readyCards[0].salvati,'trash never edits the assembly BOM');
const unrelated=card('903',[component(23,'SSD','SSD-A','ACTION')],4);
unrelated.esclusioni=excludedCards[0].esclusioni;
assert.equal(A.daOrdinare(null,[unrelated],{}).esclusioni.length,0);
// Moving the same physical PC to another desk retains its do-not-order flag; it does not become an acquisition.
excludedCards[0].foglio=4;
assert.equal(A.daOrdinare(readyData,[excludedCards[0]],{}).pezzi,0);
// Recreated identical SKU or changed quantities do not inherit the old physical row's exclusion.
const previousExclusion=J(excludedCards[0].esclusioni);
excludedCards[0].salvati[0].id=999;
assert.equal(A.daOrdinare(readyData,[excludedCards[0]],{}).esclusioni.length,0);
excludedCards[0].salvati[0].id=20;excludedCards[0].salvati[0].quantity=2;
assert.equal(A.daOrdinare(readyData,[excludedCards[0]],{}).esclusioni.length,0);
excludedCards[0].salvati[0].quantity=1;
assert.equal(A.daOrdinare(readyData,[excludedCards[0]],{}).esclusioni.length,1);
excludedCards[0].esclusioni={[target.chiaveAcquisto]:{escluso:true}};
assert.equal(A.daOrdinare(readyData,[excludedCards[0]],{}).esclusioni.length,0,'incomplete legacy flags cannot hide an unverified row');
excludedCards[0].esclusioni={};
assert.equal(A.daOrdinare(readyData,[excludedCards[0]],{}).pezzi,1);
// Even without an order-wide snapshot, individually purchased rows never become new demand.
const partiallyPaid=card('part-paid',[{...component(50,'CPU','CPU-PAID','ACTION'),price:100},component(51,'RAM','RAM-NEW','ACTION')]);
const partiallyPaidBefore=J(partiallyPaid);
const partialSummary=J(A.daOrdinare(null,[partiallyPaid],{}));
assert.equal(partialSummary.pezzi,1);assert.equal(partialSummary.righe[0].codice,'RAM-NEW');
assert.equal(partialSummary.giaAcquistati.length,1);assert.equal(partialSummary.giaAcquistati[0].tipo,'CPU');
assert.deepEqual(J(partiallyPaid),partiallyPaidBefore);
const paidOnly=card('paid-source',[component(52,'SSD','PAID-SSD','ACTION')]);paidOnly.righe[0].fonte='acquistato';
assert.equal(A.daOrdinare(null,[paidOnly],{}).pezzi,0);

// A whole-row kit replacement may change physical quantity, while the expected old row remains exact.
const kit=offer('RAM-2X8','ACTION',80,20,2);
const kitData={ordini:{'904':{pc:[{quantita:1,pezzi:[{tipo:'RAM',auto:kit,requisito:'16GB DDR5'}]}]}}};
const kitCard=card('904',[component(24,'RAM','RAM-1X16','ACTION')]);
const kitPlan=J(A.daOrdinare(kitData,[kitCard],{}));
assert.equal(kitPlan.righe[0].quantita,2);assert.equal(kitPlan.righe[0].pezzi[0].quantita,1);
assert.equal(kitPlan.totale,80);assert.equal(kitPlan.righe[0].daApplicare,true);

// Precise persistence updates only the requested PC and row, and preserves unrelated paid prices.
sandbox.processedOrdersCache={
  '905':{components:[component(30,'GPU','ARC-B580','ACTION'),component(31,'RAM','DDR5','ACTION')]},
  '905.2':{components:[component(32,'GPU','ARC-B580','ACTION')]},
  '906':{components:[{...component(33,'GPU','ARC-B580','ACTION'),price:190}]}
};
sandbox.window.SupabaseDB={
  async replacePurchaseComponent(id,p){
    calls.push({op:'replace',id,p:J(p)});
    const saved={id:p.expected.id,type:p.expected.type,...p.replacement,price:null};
    const customProperties=J(sandbox.processedOrdersCache[id].customProperties||{});
    if(p.source!=='allocation_plan'){
      const choice={tipo:saved.type,ean:saved.ean,fornitore:saved.supplier,componentId:saved.id,
        quantita:saved.quantity,descrizione:saved.name,esplicita:true,il:new Date().toISOString()};
      customProperties._scelte_acquisto_gestionale={...customProperties._scelte_acquisto_gestionale,[saved.type]:choice};
    }
    return{component:saved,customProperties};
  },
  async setProcurementExclusion(id,v){
    calls.push({op:'exclude',id,v:J(v)});
    const cp=J(sandbox.processedOrdersCache[id].customProperties||{}),entries=cp[A.K_ESCLUSIONI_ACQUISTO]||{};
    if(v.excluded)entries[v.key]={...v,escluso:true,quantita:v.quantita,foglio:v.foglio};else delete entries[v.key];
    return{...cp,[A.K_ESCLUSIONI_ACQUISTO]:entries};
  }
};
const sourceTarget=A.identitaAcquisto({id:'905',nome:'#905',foglio:2},row(sandbox.processedOrdersCache['905'].components[0]),sandbox.processedOrdersCache['905'].components[0]);
const chosen={codice:'ARC-B570',descrizione:'Intel Arc B570 10GB',fornitore:'ACTION'};
const saved=await A.sostituisciAcquisto(sourceTarget,chosen);
assert.equal(saved.ean,'ARC-B570');assert.equal(calls[0].p.source,'buyer_desk');
assert.deepEqual(calls[0].p.expected,{id:30,type:'GPU',ean:'ARC-B580',supplier:'ACTION',quantity:1});
assert.equal(sandbox.processedOrdersCache['905'].components[0].ean,'ARC-B570');
assert.equal(sandbox.processedOrdersCache['905.2'].components[0].ean,'ARC-B580');
assert.equal(sandbox.processedOrdersCache['905'].components[1].ean,'DDR5');
assert.ok(sandbox.processedOrdersCache['905'].customProperties._scelte_acquisto_gestionale);
await assert.rejects(()=>A.sostituisciAcquisto(sourceTarget,chosen),/cambiata|univoca/);
const paidTarget={...sourceTarget,id:'906',componentId:33};
await assert.rejects(()=>A.sostituisciAcquisto(paidTarget,chosen),/storico protetto/);
assert.equal(sandbox.processedOrdersCache['906'].components[0].price,190);
assert.throws(()=>A.bersaglioCambioPreciso({...sourceTarget,componentId:null},[component(40,'GPU','ARC-B580','ACTION'),component(41,'GPU','ARC-B580','ACTION')]),/univoca/);
assert.throws(()=>A.bersaglioCambioPreciso({...sourceTarget,quantita:2},[component(30,'GPU','ARC-B580','ACTION')]),/Quantità cambiata/);
await assert.rejects(()=>A.sostituisciAcquisto({...sourceTarget,personalizzato:true},chosen),/voce extra/);
const cacheBom=J(sandbox.processedOrdersCache['905.2'].components);
const t=A.identitaAcquisto({id:'905.2',nome:'#905 PC2',foglio:2},row(cacheBom[0]),cacheBom[0]);
await A.modificaEsclusioneAcquisto({pezzi:[t]},true);
assert.deepEqual(J(sandbox.processedOrdersCache['905.2'].components),cacheBom);
assert.equal(sandbox.processedOrdersCache['905.2'].customProperties[A.K_ESCLUSIONI_ACQUISTO][t.chiaveAcquisto].escluso,true);
assert.equal(calls.at(-1).id,'905.2');assert.equal(calls.at(-1).v.foglio,2);
await A.modificaEsclusioneAcquisto({pezzi:[t]},false);
assert.deepEqual(J(sandbox.processedOrdersCache['905.2'].customProperties[A.K_ESCLUSIONI_ACQUISTO]),{});
assert.deepEqual(J(sandbox.processedOrdersCache['905.2'].components),cacheBom);
await A.sostituisciAcquisto(t,chosen,'allocation_plan');
assert.equal(calls.at(-1).p.source,'allocation_plan','automatic allocation must not pin a manual choice');

// A stale encrypted artifact cannot immediately undo the explicit Buyer Desk choice.
const explicit={tipo:'GPU',ean:'ARC-B570',fornitore:'ACTION',componentId:32,quantita:1,
  descrizione:'Intel Arc B570 10GB',esplicita:true,il:'2026-11-06T12:00:00Z'};
sandbox.processedOrdersCache['905.2'].customProperties={_scelte_acquisto_gestionale:{test:explicit}};
const chosenCard=card('905.2',sandbox.processedOrdersCache['905.2'].components);
const stalePart={tipo:'GPU',manuale:{codice:'ARC-B580',fornitore:'ACTION',quantita:1},
  requisito:'Intel Arc B580 12GB',auto:{...offer('ARC-B580','ACTION',200),descrizione:'Intel Arc B580 12GB'}};
const oldArtifact={generato:'2026-11-06T11:00:00Z',ordini:{'905':{pc:[{quantita:2,pezzi:[stalePart]}]}}};
const guarded=J(A.daOrdinare(oldArtifact,[chosenCard],{}));
assert.equal(guarded.righe[0].codice,'ARC-B570');assert.equal(guarded.righe[0].daApplicare,false);
assert.equal(guarded.righe[0].daConfermare,true);assert.equal(guarded.pronti,0);
assert.match(guarded.righe[0].motivi.join(' '),/listino deve ancora confermare codice, prezzo e disponibilità/);
assert.deepEqual(J(A.proposteOrdine(oldArtifact,'905.2',chosenCard.righe)),[]);
// A recent timestamp alone does not prove that the artifact incorporated this specific intent.
oldArtifact.generato='2026-11-06T13:00:00Z';
assert.equal(A.pianoRispettaSceltaEsplicita('905.2',chosenCard.righe[0],stalePart),false);
const currentPart={...stalePart,scelta_esplicita:true,componente_gestionale_id:32,
  manuale:{codice:'ARC-B570',fornitore:'ACTION',quantita:1},
  auto:{...offer('B570-OTHER-SKU','ABACO',185),descrizione:'Intel Arc B570 10GB'}};
const newArtifact={ordini:{'905':{pc:[{quantita:2,pezzi:[currentPart]}]}}};
assert.equal(A.pianoRispettaSceltaEsplicita('905.2',chosenCard.righe[0],currentPart),true);
const cheaper=J(A.daOrdinare(newArtifact,[chosenCard],{}));
assert.equal(cheaper.righe[0].codice,'B570-OTHER-SKU');assert.equal(cheaper.righe[0].daApplicare,true);
assert.equal(cheaper.righe[0].pezzi[0].ean,'ARC-B570');
// Metadata from an unsuccessful concurrent update is ignored unless it matches the actual saved row.
sandbox.processedOrdersCache['905.2'].customProperties={_scelte_acquisto_gestionale:{test:{...explicit,ean:'OTHER'}}};
assert.equal(A.sceltaEsplicitaAcquisto('905.2',chosenCard.righe[0]),null);

// A confirmed Buyer Desk replacement must flow into the current supplier draft while the old allocation is still published.
const emailContacts={invii:[
  {id:'caseking',nome:'CASEKING',fornitori:['CASEKING'],a:['caseking@example.invalid']},
  {id:'abaco',nome:'ABACO',fornitori:['ABACO'],a:['abaco@example.invalid']},
]};
const oldRam=component(60,'RAM','RAM-1X16','CASEKING');
const abacoRam=component(61,'RAM','RAM-2X8','ABACO');
sandbox.processedOrdersCache['907']={components:[oldRam]};
sandbox.processedOrdersCache['908']={components:[abacoRam]};
const freshUntil=new Date(Date.now()+60*60*1000).toISOString();
const abacoOffer={...offer('RAM-2X8','ABACO',50,3),descrizione:'RAM DDR5 8 GB',stock:3,costo_unitario:50,ordinabile:true,
  stock_valid_until:freshUntil,price_valid_until:freshUntil};
const oldRamOffer={...offer('RAM-1X16','CASEKING',50),descrizione:'RAM DDR5 16 GB'};
const oldRamPlan={ordini:{
  '907':{pc:[{quantita:1,pezzi:[{tipo:'RAM',manuale:oldRamOffer,auto:oldRamOffer}]}]},
  '908':{pc:[{quantita:1,pezzi:[{tipo:'RAM',manuale:abacoOffer,auto:abacoOffer}]}]},
}};
const ramCards=()=>['907','908'].map(id=>card(id,sandbox.processedOrdersCache[id].components));
const summaryWithOffer=(quote,plan=oldRamPlan)=>A.daOrdinare({...plan,offerte_ordinabili:[quote]},ramCards(),{});
const emailOrders=summary=>A.ordiniEmail(summary,emailContacts).invii;
const emailCounts=summary=>J(emailOrders(summary).map(x=>[x.id,x.pezzi]));
assert.deepEqual(emailCounts(summaryWithOffer(abacoOffer)),[['caseking',1],['abaco',1]]);
const ramTarget=A.identitaAcquisto({id:'907',nome:'#907',foglio:1},row(oldRam),oldRam);
await A.sostituisciAcquisto(ramTarget,{...abacoOffer,quantita:2});
const afterChange=summaryWithOffer(abacoOffer);
assert.deepEqual(emailCounts(afterChange),[['abaco',3]],'confirmed changes update supplier and quantity before a new allocation is published');
const draft=A.testoEmail(emailOrders(afterChange)[0],emailContacts,'06/11/2026');
assert.equal(draft.a,'abaco@example.invalid');
assert.match(draft.corpo,/3 x RAM DDR5 8 GB .*RAM-2X8/);
assert.match(draft.corpo,/Totale: 3 pezzi/);
assert.doesNotMatch(draft.corpo,/RAM-1X16/);
const emailButtons=A.htmlEmailOrdini(afterChange,emailContacts);
assert.match(emailButtons,/ABACO · 3 pz/);
assert.doesNotMatch(emailButtons,/data-rf-email="caseking"/);
assert.equal(afterChange.pronti,3);
assert.equal(afterChange.daApplicare,0);

for(const [why,quote] of [
  ['insufficient shared stock',{...abacoOffer,stock:2,disponibilita:'2 pz',stock_libero_prima:2}],
  ['an alias from a different SKU',{...abacoOffer,codice:'OTHER-SKU',mpn:'RAM-2X8'}],
  ['a different SKU with the same normalized alias',{...abacoOffer,codice:'RAM2X8'}],
  ['expired supplier stock',{...abacoOffer,stock_valid_until:'2000-01-01T00:00:00Z'}],
]){
  const emails=emailOrders(summaryWithOffer(quote));
  assert.ok(emails.every(x=>x.id==='abaco'&&x.pezzi<=1),`${why} must not put the replaced units or the old SKU in a draft`);
}
const offDeskPlan={ordini:{...oldRamPlan.ordini,
  '909':{elaborato:{foglio:2},pc:[{quantita:1,pezzi:[{tipo:'RAM',manuale:abacoOffer,auto:abacoOffer}]}]},
}};
assert.deepEqual(emailCounts(summaryWithOffer(abacoOffer,offDeskPlan)),[['abaco',1]],
  'an off-desk allocation uses the same stock; hold the replacement and retain the already-ready unit');

const similarCode=component(62,'RAM','RAM2X8','ABACO');
const similarOffer={...abacoOffer,codice:'RAM2X8',descrizione:'Altra RAM DDR5'};
const similarPlan={...oldRamPlan.ordini,'910':{pc:[{quantita:1,pezzi:[{tipo:'RAM',manuale:similarOffer,auto:similarOffer}]}]}};
const withSimilarCode=A.daOrdinare({ordini:similarPlan,offerte_ordinabili:[similarOffer,abacoOffer]},
  [...ramCards(),card('910',[similarCode])],{});
const distinctDraft=A.testoEmail(emailOrders(withSimilarCode)[0],emailContacts,'06/11/2026');
assert.match(distinctDraft.corpo,/3 x RAM DDR5 8 GB .*RAM-2X8/);
assert.match(distinctDraft.corpo,/1 x Altra RAM DDR5 .*RAM2X8/);
console.log('purchase-summary: allocation, exact replacement, exclusions and order drafts passed');
