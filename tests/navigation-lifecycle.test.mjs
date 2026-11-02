import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const manager=fs.readFileSync(new URL('../assets/js/navigation-lifecycle.js',import.meta.url),'utf8');
const overlays=fs.readFileSync(new URL('../assets/js/amazon-products-manager.js',import.meta.url),'utf8');
test('a navigation ticket becomes invalid even on return to the same page',()=>{
 const env={window:{}};vm.createContext(env);vm.runInContext(manager,env);
 const n=env.window.MGNavigation,t=n.begin();assert(n.valid(t));n.begin();n.begin();assert(!n.valid(t));
});
test('a late configuration save cannot close or reopen the destination page',async()=>{
 const fn=overlays.slice(overlays.indexOf('async function closeAllOverlayPages('),overlays.indexOf("document.getElementById('custom-components-btn')"));
 const elements=Object.fromEntries(['standard-configs-page','gpo-mapping-page','custom-components-page','settings-popup','search-bar'].map(id=>[id,{style:{display:'none'}}]));
 elements['standard-configs-page'].style.display='block';let release,epoch=1,cleanups=0;
 const env={window:{MGNavigation:{current:()=>epoch,valid:t=>t===epoch,transient:()=>cleanups++}},
  document:{getElementById:id=>elements[id],body:{classList:{remove(){}}}},saveAllConfigurations:()=>new Promise(r=>release=r)};
 vm.createContext(env);vm.runInContext(fn,env);
 const pending=env.closeAllOverlayPages(true);epoch++;elements['gpo-mapping-page'].style.display='block';release();
 assert.equal(await pending,false);assert.equal(cleanups,0);assert.equal(elements['gpo-mapping-page'].style.display,'block');
 elements['standard-configs-page'].style.display='none';assert.equal(await env.closeAllOverlayPages(false),true);
 assert.equal(cleanups,1);assert.equal(elements['gpo-mapping-page'].style.display,'none');
});
