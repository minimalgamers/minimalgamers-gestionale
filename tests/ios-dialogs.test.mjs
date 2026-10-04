import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
import vm from 'node:vm';
const css=fs.readFileSync(new URL('../assets/css/ios-dialogs.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../assets/js/ios-dialogs.js',import.meta.url),'utf8');
test('dialogs are presentation only and do not control opening, closing or data',()=>{
    assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|supabase|password|innerHTML|outerHTML|addEventListener)\b/);
    assert.doesNotMatch(js,/\.disabled\s*=|\.hidden\s*=|\.dataset\./);
    assert(js.includes('el.closest(roots)'));assert(js.includes('new WeakSet()'));assert(js.includes('.observe(document.body,{childList:true})'));
    assert.doesNotMatch(css,/z-index:|pointer-events:/);
    assert.doesNotMatch(css,/:is\(#payment-popup[^{}]+\)\s*\{[^}]*display:/);
    assert(js.includes('textarea,#template-priority-popup'));
    assert(css.includes('#template-priority-popup > div'));
});
test('all existing dialog types share readable controls and keep confirmation distinct',()=>{
    for(const id of ['payment-popup','component-search-popup','add-custom-item-popup','bulk-replace-popup','supplier-select-popup','add-manual-order-popup','finalize-all-popup'])assert(css.includes(id)&&js.includes(id));
    assert(css.includes('button:disabled'));assert(css.includes('button[data-si]'));assert(css.includes('min-height: 44px'));assert(css.includes('max-height: calc(100dvh - 32px)'));assert(css.includes('prefers-reduced-motion'));
});

test('initial and dynamic dialog decoration preserves values, text, identity and handlers',()=>{
    const observers=[];
    class El {
        constructor(tag='div',text='',root=null){this.tag=tag;this.textContent=text;this.root=root;this.style={color:'white',background:'rgba(0, 0, 0, 0.8)'};this.classes=new Set();this.classList={add:x=>this.classes.add(x),contains:x=>this.classes.has(x)};this.value='original';this.disabled=true;this.hidden=false;this.onclick=()=>42;this.children=[];}
        closest(){return this.root;}matches(s){if(s==='button')return this.tag==='button';if(s.startsWith('button,input,select,textarea'))return ['button','input','select','textarea'].includes(this.tag);return this.isRoot===true;}
        querySelectorAll(s){return s==='[style],button'?this.children:[];}
    }
    const root=new El();root.root=root;root.isRoot=true;const close=new El('button','✕',root);root.children.push(close);
    const body=new El();body.classes.add('mg-ios');const document={body,querySelectorAll:()=>[root]};
    class Observer{constructor(cb){this.cb=cb;}observe(el,options){observers.push({el,options,cb:this.cb});}}
    const handler=close.onclick;vm.runInNewContext(js,{document,HTMLElement:El,MutationObserver:Observer});
    assert(root.classes.has('mg-modal-surface'));assert(close.classes.has('mg-modal-close-icon'));assert.equal(close.textContent,'✕');assert.equal(close.value,'original');assert(close.disabled);assert.equal(close.onclick,handler);
    const dynamic=new El('input','',root);observers[0].cb([{addedNodes:[dynamic]}]);assert(dynamic.classes.has('mg-modal-ink'));assert(!dynamic.classes.has('mg-modal-surface'));assert.equal(dynamic.value,'original');
    const outside=new El('button','✕');observers[0].cb([{addedNodes:[outside]}]);assert.equal(outside.classes.size,0);
    assert.equal(observers[0].options.attributes,undefined);assert.equal(observers[1].options.subtree,undefined);
    observers[1].cb([{addedNodes:[root]}]);assert.equal(observers.length,2,'same root not observed twice');
});
