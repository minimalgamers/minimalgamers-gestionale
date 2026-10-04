import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const css=fs.readFileSync(new URL('../assets/css/ios-overview.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../assets/js/ios-overview.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('overview assets local, versioned and strictly scoped',()=>{
    assert(html.includes('ios-overview.css?v=1'));assert(html.includes('ios-overview.js?v=1'));
    const clean=css.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const s of clean.split('{').slice(0,-1).map(s=>s.split('}').at(-1).trim()))if(s&&!s.startsWith('@'))assert(s.startsWith('body.mg-ios #automatico-container'),s);
    assert.doesNotMatch(clean,/#automatico-container\s*\{[^}]*display:/);
});
test('overview retains all original table columns, stacks labeled rows on mobile',()=>{
    assert(css.includes('grid-template-columns: repeat(2,minmax(0,1fr))'));assert(css.includes('attr(data-mg-col)'));
    assert(js.includes("headings[index].textContent.trim()"));
    assert(css.includes('font-size: 13px'));assert(css.includes('min-height: 44px'));assert(css.includes(':disabled'));assert(css.includes(':focus-visible'));
    assert.doesNotMatch(css,/display: none/);
});
test('overview preserves profit states and uses flat local symbols',()=>{
    for(const s of ['pos','neg','basso','incompleto'])assert(css.includes(s));
    for(const icon of ['check','warning','x'])assert(css.includes(`../icons/${icon}.svg`));
    assert.doesNotMatch(css,/\.acc-esito[^}]*\{[^}]*opacity:/);
});
test('overview decorator cannot change data or business actions',()=>{
    assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|supabase|password|innerHTML|outerHTML|replaceWith|addEventListener)\b/);
    assert.doesNotMatch(js,/\.disabled\s*=|\.hidden\s*=|\.dataset\./);
    assert(js.includes("getElementById('automatico-container')"));assert(js.includes('root.contains(el)'));
    assert(js.includes('{childList: true, characterData: true, subtree: true}'));
});
