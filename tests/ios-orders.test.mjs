import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),'..');
const css=fs.readFileSync(path.join(root,'assets/css/ios-orders.css'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('Ordini stylesheet loads after the foundation and is cache-versioned',()=>{
 assert(html.indexOf('ios-orders.css?v=1')>html.indexOf('ios-foundation.css?v=1'));
});
test('Ordini CSS is strictly scoped: no processed, automatic or finalized rules',()=>{
 const withoutComments=css.replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(withoutComments,/#(?:processed|automatico|finalized|hidden)-container|\.acc-/);
 for(const selector of withoutComments.split('{').slice(0,-1).map(x=>x.split('}').at(-1).trim())){
  if(selector&&!selector.startsWith('@')&&selector!==':root')assert(selector.includes('body.mg-ios #orders-container'),selector);
 }
 assert.doesNotMatch(css,/(?:opacity:\s*0|display:\s*none|visibility:\s*hidden)/);
});
test('Preserves tab visibility while providing a 3/2/1 grid and 44px controls',()=>{
 assert.match(css,/repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/min-width:\s*var\(--mg-touch\)/);
 assert.match(css,/min-height:\s*var\(--mg-touch\)/);
 assert.doesNotMatch(css,/#orders-container\s*\{[^}]*display\s*:/);
 assert.match(css,/:focus-visible/);
 assert.match(css,/prefers-reduced-motion/);
});
test('Uses approved hot palette through existing lineage classes; never changes lineage logic',()=>{
 for(const line of ['msi','deepcool','configuratore'])assert(css.includes('.mg-linea-'+line));
 for(const token of ['--mg-line-msi','--mg-line-deepcool','--mg-line-configurator','--mg-line-minimal'])assert(css.includes(token));
 assert.match(css,/--mg-card-surface:\s*rgba\(255,255,255,\.88\)/);
 const luminance=h=>{const c=h.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 for(const [a,b]of [['ffffff','050505'],['ffffff','ed0028'],['083344','00d9ed'],['ffffff','e10084'],['5b606c','e0e0e0']]){
  const x=luminance(a),y=luminance(b);assert((Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5,`${a} on ${b}`);
 }
});
