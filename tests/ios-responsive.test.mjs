import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
const css=fs.readFileSync(new URL('../assets/css/ios-responsive.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('responsive enhancement is local, conditional and scoped to the design root',()=>{
    assert(html.includes('ios-responsive.css?v=1'));
    assert(html.indexOf('ios-responsive.css?v=1')>html.indexOf('ios-secondary.css?v=1'));
    const clean=css.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const selector of clean.split('{').slice(0,-1).map(s=>s.split('}').at(-1).trim()))
        if(selector&&!selector.startsWith('@'))assert(selector.startsWith('body.mg-ios'),selector);
    assert(css.includes('@media (max-width: 768px)'));assert(css.includes('@media (max-width: 374px)'));
    assert.doesNotMatch(css,/@import|https?:\/\//);
});
test('phone fields retain values and visibility; only legibility, wrapping and padding change',()=>{
    assert(css.includes('font-size: 16px !important'));
    assert(css.includes('env(safe-area-inset-bottom)'));
    assert(css.includes('flex-wrap: wrap'));assert(css.includes('flex-basis: 100%'));
    assert.doesNotMatch(css,/\b(?:display|visibility|pointer-events|content|background|color)\s*:/);
    assert.doesNotMatch(css,/\[(?:disabled|hidden|checked)\]/);
});
