import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8');
const sandbox={window:{},console,localStorage:{getItem(){return null;}}};
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const A=sandbox.window.AccoppiamentoAuto;
const contacts={invii:[{id:'cpu',nome:'TIER ONE · solo CPU',fornitori:['TIER ONE'],solo_categorie:['CPU'],a:['cpu@example.invalid']},
    {id:'gt',nome:'Intermediario GT',intermediario:true,fornitori:['TIER ONE'],a:['gt@example.invalid']}]};
const row=(categoria,quantita,more={})=>({categoria,fornitore:'TIER ONE',codice:categoria,descrizione:categoria,
    quantita,costo:quantita*100,disponibilita:'100 pz',...more});
test('8 CPU pronte e 34 in proposta: la mail rende visibile il fabbisogno completo e separa GT',()=>{
    const ready=row('CPU',8),pending=row('CPU',34,{daApplicare:true}),hardware=row('MOBO',3,{daApplicare:true});
    const summary={fornitori:[{nome:'TIER ONE',righe:[ready,pending,hardware]}]};
    const result=A.ordiniEmail(summary,contacts),cpu=result.invii.find(x=>x.id==='cpu');
    assert.equal(cpu.pezzi,8);assert.equal(cpu.pezziSospesi,34);
    assert.equal(cpu.gruppi[0].righe.includes(pending),false,'nessuna proposta finisce silenziosamente nella bozza');
    const check=A.completezzaOrdine(cpu);assert.equal(check.pronti+check.sospesi,42);
    const gt=result.incompleti.find(x=>x.id==='gt');assert.equal(gt.pezzi,0);assert.equal(gt.pezziSospesi,3);
    assert.ok(gt.sospese.every(r=>r.categoria!=='CPU'));
    assert.match(A.htmlEmailOrdini(summary,contacts),/Rivedi ordine[^<]*TIER ONE[^<]*8 pronti[^<]*34 da risolvere/);
});
test('anche un canale senza righe pronte deve essere visibile; esclusioni intenzionali restano fuori',()=>{
    const summary={fornitori:[{nome:'TIER ONE',righe:[row('CPU',37,{daApplicare:true}),row('CPU',2,{esclusa:true})]}]};
    const result=A.ordiniEmail(summary,contacts);
    assert.equal(result.invii.length,0);assert.equal(result.incompleti[0].pezziSospesi,37);
    assert.match(A.htmlEmailOrdini(summary,contacts),/0 pronti · 37 da risolvere/);
});
test('le bozze e la copia non possono eludere la verifica di completezza',()=>{
    assert.match(source,/if \(x\.pezziSospesi && !parziale\)[\s\S]*await rivediOrdineIncompleto\(x\)/);
    assert.match(source,/ORDINE PARZIALE/);
    assert.match(source,/if \(!x\.pezzi\) return avvisa/);
    assert.match(source,/if \(!esito \|\| esito\.falliti\?\.length\) return/);
});

test('il clic email apre prima il controllo; annullare non prepara bozze, parziale va etichettato',async()=>{
    const windows=[],context={window:{},console,localStorage:{getItem(){return null;}},
        document:{getElementById(){return {};},body:{appendChild(d){windows.push(d);}},
            createElement(){const controls={};return {innerHTML:'',remove(){},querySelector(q){
                return controls[q] ||= {value:'',addEventListener(_e,fn){this.click=fn;}};}};}}};
    vm.createContext(context);vm.runInContext(source,context);
    const api=context.window.AccoppiamentoAuto;api.stato.dati={contatti_ordini:contacts};
    const summary={fornitori:[{nome:'TIER ONE',righe:[row('CPU',8),row('CPU',34,{daApplicare:true})]}]};
    const cancelled=api.apriEmailOrdine('cpu',summary);
    assert.equal(windows.length,1);assert.match(windows[0].innerHTML,/8 pezzi pronti · 34 pezzi ancora esclusi/);
    assert.doesNotMatch(windows[0].innerHTML,/data-em-corpo/);
    windows[0].querySelector('[data-no]').click();await cancelled;assert.equal(windows.length,1);
    const partial=api.apriEmailOrdine('cpu',summary);
    windows[1].querySelector('[data-parziale]').click();await partial;
    assert.equal(windows.length,3);
    assert.match(windows[2].querySelector('[data-em-oggetto]').value,/^ORDINE PARZIALE/);
    assert.match(windows[2].querySelector('[data-em-corpo]').value,/esclusivamente i 8 pezzi/);
    assert.match(windows[2].querySelector('[data-em-corpo]').value,/8 x CPU/);
    assert.doesNotMatch(windows[2].querySelector('[data-em-corpo]').value,/34 x CPU/);
});
