import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function env() {
    const s={window:{},document:{getElementById:()=>null,readyState:'complete'}};
    vm.createContext(s);
    vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),s);
    vm.runInContext(readFileSync(new URL('../assets/js/manual-builds.js',import.meta.url),'utf8'),s);
    return s.window.MGManualBuild;
}
const offer=(code,supplier,cost,stock,quantity=1)=>({codice:code,fornitore:supplier,descrizione:code,costo_unitario:cost,
    costo:cost*quantity,stock,quantita:quantity,ordinabile:true,disponibilita:stock+' pz'});
const data=(options,orders={})=>({build_manuali_versione:1,distinte:{VANGUARD:{CPU:0}},voci:[{manuale:{},preferenze:options}],ordini:orders});
test('manual builds consume only stock left after all other orders and newly saved manual PCs',()=>{
    const M=env(),a=offer('TRAY','ACTION',326.73,3),b=offer('BOX','OMEGA',344,10);
    const d=data([a,b],{'77':{pc:[{quantita:2,pezzi:[{tipo:'CPU',auto:a}]}]}});
    const cache={MANUAL_1:{components:[{id:1,type:'CPU',ean:'TRAY',supplier:'ACTION',quantity:1,price:null}]}};
    assert.equal(M.propose(d,'VANGUARD',cache)[0].ean,'BOX');
    cache.MANUAL_1.customProperties={_acquisti_parziali_gestionale:{1:{type:'CPU',ean:'TRAY',supplier:'ACTION',quantity:1,stato:'pagato'}}};
    assert.equal(M.propose(d,'VANGUARD',cache)[0].ean,'TRAY');
});
test('physical module quantities are checked before selecting the lowest-cost available reference',()=>{
    const M=env(),a=offer('SINGLE-MODULE','ACTION',50,1,2),b=offer('KIT','ABACO',120,10);
    const p=M.propose(data([a,b]),'VANGUARD')[0];
    assert.equal(p.ean,'KIT');assert.equal(p.quantity,1);
    const missing=M.propose(data([a]),'VANGUARD')[0];
    assert.equal(missing.auto,false);assert.equal(missing.name,'');assert.equal(missing.unit,null);
});
test('manual builds reuse the supplier ranking from the engine and never revive unknown or expired stock',()=>{
    const M=env(),partner=offer('MSI','ABACO',730,2),other=offer('MSI','ACTION',500,5);
    assert.equal(M.propose(data([partner,other]),'VANGUARD')[0].supplier,'ABACO');
    partner.stock_valid_until='2020-01-01T00:00:00Z';
    assert.equal(M.propose(data([partner,other]),'VANGUARD')[0].supplier,'ACTION');
    other.stock=0;
    assert.equal(M.propose(data([partner,other]),'VANGUARD')[0].auto,false);
});
test('explicit saved choices reserve their actual supplier and finalized or excluded rows reserve nothing',()=>{
    const M=env(),a=offer('A','ACTION',50,2),b=offer('B','OMEGA',60,10);
    const d=data([a,b],{'77':{pc:[{quantita:1,pezzi:[{tipo:'CPU',auto:b}]}]}});
    const c={id:9,type:'CPU',ean:'A',supplier:'ACTION',quantity:2,price:null};
    const saved={'77':{components:[c],customProperties:{_scelte_acquisto_gestionale:{x:{componentId:9,ean:'A',fornitore:'ACTION'}}}}};
    assert.equal(M.propose(d,'VANGUARD',saved)[0].ean,'B');
    saved['77'].stato='finalizzati';
    assert.equal(M.propose(d,'VANGUARD',saved)[0].ean,'A');
});

test('an old exclusion does not cover additional physical units or a different component type',()=>{
    const M=env(),a=offer('A','ACTION',50,2),b=offer('B','OMEGA',60,10);
    const c={id:9,type:'CPU',ean:'A',supplier:'ACTION',quantity:2,price:null};
    const exclusion={componentId:9,tipo:'CPU',ean:'A',fornitore:'ACTION',quantita:1,escluso:true};
    const saved={MANUAL_1:{components:[c],customProperties:{_esclusioni_acquisto_gestionale:{x:exclusion}}}};
    assert.equal(M.propose(data([a,b]),'VANGUARD',saved)[0].ean,'B');
    exclusion.quantita=2;
    assert.equal(M.propose(data([a,b]),'VANGUARD',saved)[0].ean,'A');
    exclusion.tipo='GPU';
    assert.equal(M.propose(data([a,b]),'VANGUARD',saved)[0].ean,'B');
});
