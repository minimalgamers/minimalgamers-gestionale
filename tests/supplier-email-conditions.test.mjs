import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const sandbox={window:{},console,localStorage:{getItem(){return null;},setItem(){}}};
sandbox.globalThis=sandbox;vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../assets/js/accoppiamento-auto.js',import.meta.url),'utf8'),sandbox);
const A=sandbox.window.AccoppiamentoAuto;
const route={id:'ED',nome:'ED SYSTEM',a:['sales@example.invalid'],lingua:'en',minimo_ordine_eur:1235,
  gruppi:[{nome:'ED SYSTEM',righe:[{categoria:'MOBO',codice:'2648790',mpn:'MAG B850 TOMAHAWK WIFI',ean:'4711377402859',
    descrizione:'MSI MAG B850 TOMAHAWK WIFI',quantita:1,costo:171.9}]}],pezzi:1};
let mail=A.testoEmail(route,{invii:[]},'06/11/2026');
assert.match(mail.oggetto,/quotation request/);assert.match(mail.corpo,/not an order confirmation/);
assert.match(mail.corpo,/1235/);assert.match(mail.corpo,/2648790/);assert.match(mail.corpo,/4711377402859/);
assert(A.avvisiEmail(route,{}).some(x=>/Minimo non raggiunto/.test(x)));
const enough={...route,gruppi:[{...route.gruppi[0],righe:[{...route.gruppi[0].righe[0],quantita:8,costo:1375.2}]}],pezzi:8};
mail=A.testoEmail(enough,{invii:[]},'06/11/2026');assert.match(mail.oggetto,/^Order/);
assert.doesNotMatch(mail.corpo,/quotation request/);
const quotation={...enough,richiesta_quotazione:true};
assert.match(A.testoEmail(quotation,{invii:[]}).oggetto,/quotation request/);
const unknown={...route,gruppi:[{...route.gruppi[0],righe:[{...route.gruppi[0].righe[0],costo:null}]}]};
assert.match(A.testoEmail(unknown,{invii:[]}).oggetto,/quotation request/);
assert.match(A.htmlEmailOrdini({fornitori:[]},{invii:[]}),/Niente|^$/);
console.log('Supplier drafts preserve identities and enforce quotation wording below minimums.');
