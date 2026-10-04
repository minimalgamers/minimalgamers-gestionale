import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
import vm from 'node:vm';
const css=fs.readFileSync(new URL('../assets/css/ios-secondary.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../assets/js/ios-secondary.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('secondary local presentation assets and all intended pages are wired',()=>{
    assert(html.includes('ios-secondary.css?v=1'));assert(html.includes('ios-secondary.js?v=1'));
    for(const id of ['gpo-mapping-page','custom-components-page','standard-configs-page','message-templates-container','inventory-container','settings-container','suppliers-container','finalized-container','hidden-container'])assert(css.includes(id)&&js.includes(id));
    assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|supabase|password|innerHTML|outerHTML|addEventListener|replaceWith)\b/);
    assert.doesNotMatch(js,/\.disabled\s*=|\.checked\s*=|\.value\s*=|\.hidden\s*=/);
});
test('state headings stay untouched and mobile keeps inventory columns and original checkboxes',()=>{
    assert(js.includes("el.closest('.order-card.mg-stato .card-header')"));
    assert.doesNotMatch(css,/\.order-card \.card-header\s*\{[^}]*background/);
    assert.doesNotMatch(css,/\.order-card \.card-header\s*\{[^}]*color/);
    assert(css.includes('attr(data-mg-col)'));assert(js.includes('headers[index].textContent.trim()'));
    assert(css.includes('.settings-toggle input[type="checkbox"] { display: block'));
    assert(css.includes(':focus-within'));assert(css.includes(':focus-visible'));assert(css.includes('button:disabled'));assert(css.includes('min-height: 44px'));assert(css.includes('prefers-reduced-motion'));
});
test('secondary roots retain original visibility and save paths',()=>{
    assert.doesNotMatch(css,/#(?:gpo-mapping-page|custom-components-page|standard-configs-page)\s*\{[^}]*display:/);
    assert.doesNotMatch(css,/\.tab-content(?:\.active)?\s*\{[^}]*display:/);
    assert.doesNotMatch(js,/\.dataset\.|setAttribute\('(?!data-mg-col)/);
    assert(js.includes('.observe(root,{childList:true,subtree:true})'));
});
test('decorator keeps text, original controls and state headings through repeated renders',()=>{
    let callback;
    class Text{constructor(t){this.nodeType=3;this.textContent=t;}before(n){const p=this.parentElement;p.childNodes.splice(p.childNodes.indexOf(this),0,n);n.parentElement=p;}}
    class El{
        constructor(tag='div',root=null){this.nodeType=1;this.tag=tag;this.root=root;this.childNodes=[];this.classes=new Set();this.classList={add:x=>this.classes.add(x),contains:x=>this.classes.has(x)};this.style={color:'white',background:'rgba(0, 0, 0, 0.3)',setProperty:(k,v)=>this[k]=v};this.value='original';this.id='original-id';this.disabled=true;this.hidden=false;this.onclick=()=>42;}
        closest(s){return s==='.order-card.mg-stato .card-header'?(this.stateHeader?this:null):this.root;}
        matches(s){if(s.startsWith('button,input'))return ['button','input','select','textarea'].includes(this.tag);return s.split(',').includes(this.tag);}
        get textContent(){return this.childNodes.map(n=>n.textContent).join('');}set textContent(t){const n=new Text(t);n.parentElement=this;this.childNodes=[n];}
        querySelectorAll(s){return this.childNodes.filter(n=>n instanceof El&&(s!=='.inventory-table'));}
    }
    const root=new El();root.root=root;const heading=new El('h2',root);heading.textContent='📦 Componenti Amazon Personalizzati';const button=new El('button',root);button.textContent='🗑️ Elimina';const status=new El('h2',root);status.stateHeader=true;status.textContent='Ordine';root.childNodes=[heading,button,status];
    const body=new El();body.classes.add('mg-ios');const document={body,querySelectorAll:()=>[root],createElement:()=>new El()};class Observer{constructor(cb){callback=cb;}observe(){}}
    const handler=button.onclick;vm.runInNewContext(js,{document,HTMLElement:El,Node:{TEXT_NODE:3},MutationObserver:Observer});
    for(let i=0;i<3;i++)callback([{addedNodes:[button]}]);
    assert.equal(button.textContent,'🗑️ Elimina');assert.equal(button.childNodes.length,2);assert.equal(button.onclick,handler);assert(button.disabled);assert.equal(button.value,'original');assert.equal(button.id,'original-id');assert.equal(heading.textContent,'📦 Componenti Amazon Personalizzati');assert.equal(status.classes.size,0);
});
