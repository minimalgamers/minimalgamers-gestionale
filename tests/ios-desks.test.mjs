import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root,'assets/css/ios-desks.css'),'utf8');
const js = fs.readFileSync(path.join(root,'assets/js/ios-desks.js'),'utf8');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
test('desks use local versioned presentation assets after the existing assets',()=>{
    assert(html.indexOf('ios-desks.css?v=1')>html.indexOf('ios-orders.css?v=1'));
    assert(html.indexOf('ios-desks.js?v=1')>html.indexOf('category-summary.js?v=7'));
    for(const icon of ['credit-card','cube','plus','warning-circle','receipt','arrows-clockwise','check-circle','envelope-simple','chat-circle','check','warning','x'])
        assert(fs.existsSync(path.join(root,`assets/icons/${icon}.svg`)));
});
test('every CSS selector is restricted to the shared E1–E4 container',()=>{
    const clean=css.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const selector of clean.split('{').slice(0,-1).map(s=>s.split('}').at(-1).trim()))
        if(selector&&!selector.startsWith('@'))assert(selector.startsWith('body.mg-ios #processed-container'),selector);
    assert.doesNotMatch(clean,/#(?:orders|automatico|finalized|hidden)-container/);
    assert.doesNotMatch(clean,/#processed-container\s*\{[^}]*display\s*:/);
    assert.doesNotMatch(clean,/\.acc-sez(?:\[hidden\])?\s*\{[^}]*display\s*:/);
    assert.match(clean,/\.acc-menu button\[data-vai\] \{ display: none !important; \}/);
});
test('grid, keyboard focus, disabled state and touch areas are preserved',()=>{
    for(const columns of [2,3])assert(css.includes(`repeat(${columns},minmax(0,1fr))`));
    assert.match(css,/:focus-visible/);
    assert.match(css,/:disabled/);
    assert.match(css,/prefers-reduced-motion/);
    assert.match(css,/min-height: 44px/);
    assert.match(css,/@container \(max-width: 650px\)/);
});
test('four original profit states remain distinct, alpha applies to fill only',()=>{
    for(const state of ['pos','neg','basso','incompleto'])assert(css.includes(state));
    for(const fill of ['rgba(0,235,117,.24)','rgba(255,23,68,.22)','rgba(255,122,0,.28)'])assert(css.includes(fill));
    assert.doesNotMatch(css,/\.acc-esito[^}]*\{[^}]*opacity:/);
    const luminance=hex=>{const c=hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
    for(const [ink,rgb,alpha]of [['075b31',[0,235,117],.24],['930823',[255,23,68],.22],['743306',[255,122,0],.28]]){
        // Composite on a darker-than-observed light card, including backdrop veil.
        const fill=rgb.map(c=>Math.round(c*alpha+210*(1-alpha)).toString(16).padStart(2,'0')).join('');
        const a=luminance(ink),b=luminance(fill);assert((b+.05)/(a+.05)>4.5,ink);
    }
});
test('decorator has no network, credentials, persistence or business handlers',()=>{
    assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|Supabase|supabase|password|innerHTML|outerHTML|replaceWith|addEventListener)\b/);
    assert.doesNotMatch(js,/\.disabled\s*=|\.hidden\s*=|\.dataset\./);
    assert.match(js,/getElementById\('processed-container'\)/);
    assert.match(js,/root\.contains\(el\)/);
    assert.match(js,/\.observe\(root, \{childList: true, characterData: true, subtree: true\}\)/);
});
// Tiny isolated DOM double: no app data or browser dependencies needed to test
// original node identities/text, re-renders and the decorator's bounded observer.
function harness(){
    let callback, observed;
    class Text {
        constructor(text){this.nodeType=3;this.textContent=text;}
        before(el){const p=this.parentElement;p.childNodes.splice(p.childNodes.indexOf(this),0,el);el.parentElement=p;}
    }
    class Element {
        constructor(matchers=[]){this.nodeType=1;this.matchers=matchers;this.childNodes=[];this.parentElement=null;this.className='';this.classes=new Set();this.properties={};this.disabled=false;this.hidden=false;this.handler=()=>42;
            this.classList={add:x=>this.classes.add(x),contains:x=>this.classes.has(x)};this.style={setProperty:(k,v)=>this.properties[k]=v};}
        get textContent(){return this.childNodes.map(n=>n.textContent).join('');}
        set textContent(t){const n=new Text(t);n.parentElement=this;this.childNodes=[n];}
        contains(e){return e===this||this.childNodes.some(n=>n instanceof Element&&n.contains(e));}
        matches(s){return this.matchers.includes(s);}
        querySelectorAll(s){return this.childNodes.flatMap(n=>n instanceof Element?[...(n.matchers.some(m=>s.includes(m))?[n]:[]),...n.querySelectorAll(s)]:[]);}
        append(e){this.childNodes.push(e);e.parentElement=this;return e;}
    }
    const desk=new Element(),body=new Element();body.classList.add('mg-ios');
    const document={body,getElementById:()=>desk,createElement:()=>new Element()};
    class Observer {constructor(cb){callback=cb;}observe(el,options){observed={el,options};}}
    const run=()=>vm.runInNewContext(js,{document,HTMLElement:Element,Node:{TEXT_NODE:3},MutationObserver:Observer});
    return {desk,Element,run,observer:()=>observed,notify:n=>callback([{type:'childList',addedNodes:[n]}])};
}
test('profit decoration keeps original text, state, element and handler; repeated scans are idempotent',()=>{
    const h=harness(),profit=h.desk.append(new h.Element(['.acc-esito:is(.pos,.neg,.basso,.incompleto)']));
    profit.textContent='🟡 UTILE SRL 86,34 € · sotto obiettivo di 33,66 €';profit.classes.add('basso');
    const text=profit.textContent,handler=profit.handler;h.run();h.notify(profit);h.notify(profit);
    assert.equal(profit.textContent,text);assert.equal(profit.childNodes.length,2);assert(profit.classes.has('basso'));assert.equal(profit.handler,handler);
    assert.equal(h.observer().el,h.desk);assert.equal(h.observer().options.attributes,undefined);
});
test('dynamic buttons keep disabled state and original names; unrelated nodes are not decorated',()=>{
    const h=harness();h.run();const button=h.desk.append(new h.Element(['.acc-menu [data-sez="conto"]']));
    button.textContent='💶 Conto';button.disabled=true;const handler=button.handler;h.notify(button);
    assert.equal(button.textContent,'💶 Conto');assert.equal(button.disabled,true);assert.equal(button.handler,handler);
    assert.equal(button.properties['--desk-icon'],'url("../icons/credit-card.svg")');
    const elsewhere=new h.Element(['.acc-menu [data-sez="conto"]']);elsewhere.textContent='💶 Conto';h.notify(elsewhere);assert.equal(elsewhere.classes.size,0);
});
test('empty container can be re-rendered repeatedly with no loss of original IDs or section visibility',()=>{
    const h=harness();h.run();for(let i=0;i<5;i++){
        const menu=h.desk.append(new h.Element(['.acc-menu [data-sez="avvisi"]']));menu.textContent='⚠ Avvisi (1)';menu.hidden=i%2===0;menu.id='same-app-control';
        h.notify(menu);assert.equal(menu.textContent,'⚠ Avvisi (1)');assert.equal(menu.hidden,i%2===0);assert.equal(menu.id,'same-app-control');
    }
});
