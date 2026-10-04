import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const css = read('assets/css/ios-installable.css').replace(/\/\*[\s\S]*?\*\//g, '');
const base = 'c77b35349fce6d989f5f337d869c779095aa2cde';

test('installed iPhone app opens the same index inside this repository scope', () => {
    const origin = new URL('https://minimalgamers.github.io/minimalgamers-gestionale/');
    for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], origin).href, origin.href);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.orientation, 'any');
    assert.equal(manifest.lang, 'it');
    assert.equal(manifest.theme_color, '#f5f4f1');
    assert.match(html, /rel="manifest" href="manifest\.webmanifest\?v=1"/);
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="default"/);
    assert.match(html, /name="apple-mobile-web-app-title" content="MG Gestionale"/);
    assert.match(html, /width=device-width, initial-scale=1\.0, viewport-fit=cover/);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});

// JPEG SOF dimensions: no image editing, no external dependencies.
function jpegSize(bytes) {
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    for (let offset = 2; offset < bytes.length;) {
        assert.equal(bytes[offset], 0xff);
        const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
        if ([0xc0,0xc1,0xc2].includes(marker)) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
        if (marker === 0xda) break;
        offset += 2 + length;
    }
    throw new Error('JPEG dimensions missing');
}
test('local official-brand icons exist at their declared square sizes', () => {
    assert.equal(manifest.icons.length, 2);
    for (const icon of manifest.icons) {
        assert.equal(icon.type, 'image/jpeg');
        assert.equal(icon.purpose, 'any');
        const relative = icon.src.split('?')[0];
        assert.match(relative, /^assets\/app\/mg-icon-(180|512)\.jpg$/);
        const bytes = fs.readFileSync(path.join(root, relative));
        assert.equal(jpegSize(bytes).join('x'), icon.sizes);
    }
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="assets\/app\/mg-icon-180\.jpg\?v=1"/);
});

test('no business script, protected adapter, body markup or handler changes', () => {
    const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
    const before = git(['show', `${base}:index.html`]);
    const bodyHash = source => createHash('sha256').update(source.slice(source.indexOf('<body')).replace(/\r\n/g, '\n')).digest('hex');
    assert.equal(bodyHash(html), bodyHash(before), 'Body markup/handlers must remain identical (LF/CRLF normalized).');
    // Paths only: never open/read/copy protected adapters.
    assert.equal(git(['diff', '--name-only', base, '--', 'assets/js']), '');
    assert.equal(git(['diff', '--name-only', base, '--', 'assets/css/style.css', 'assets/css/style_mobile.css']), '');
    assert(html.indexOf('ios-installable.css?v=1') > html.indexOf('ios-responsive.css?v=1'));
    assert.doesNotMatch(css, /\b(?:display|visibility|pointer-events|content|background|color)\s*:/);
    assert.doesNotMatch(css, /@import|https?:\/\//);
    assert.doesNotMatch(JSON.stringify(manifest), /serviceWorker|fetch|localStorage|indexedDB|share_target|protocol_handlers/);
});

test('safe areas cover both orientations, login, dialogs and full-screen pages', () => {
    for (const side of ['top','bottom','left','right']) assert(css.includes(`env(safe-area-inset-${side}, 0px)`));
    assert(css.includes('@media (max-width: 1100px)'));
    assert(css.includes('@media (max-width: 768px)'));
    assert(css.includes('100dvh'));
    for (const id of ['#fixed-header','#component-search-popup','#gpo-mapping-page','#standard-configs-page','#close-standard-configs']) assert(css.includes(id));
    assert(css.includes('var(--mg-safe-top) - var(--mg-safe-bottom)'));
    assert(css.includes('2 * var(--mg-safe-side)'));
});
