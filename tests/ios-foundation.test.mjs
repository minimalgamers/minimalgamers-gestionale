import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/ios-foundation.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('foundation is local and loaded after the two legacy stylesheets', () => {
  assert.match(html, /<body class="mg-ios">/);
  assert.ok(html.indexOf('ios-foundation.css?v=1') > html.indexOf('style_mobile.css?v=32'));
  for (const name of ['plus', 'cube', 'truck', 'desktop', 'chat-circle', 'gear-six']) {
    assert.ok(fs.existsSync(path.join(root, `assets/icons/${name}.svg`)));
    assert.match(html, new RegExp(`assets/icons/${name}\\.svg`));
  }
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/LICENSE')));
});
test('existing navigation keys, authentication fields and controls remain present', () => {
  for (const id of ['accessPassword','accessUsername','passwordForm','top-actions-container',
    'tabs-container','tabs-buttons-container','process-selected-orders-container',
    'move-to-worksheet-container','since-id-input','operator-filter-container']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  for (const key of ['orders','processed','processed-e2','processed-e3','processed-e4','finalized','hidden']) {
    assert.match(html, new RegExp(`class="tab-button[^"\\n]*" data-tab="${key}"`));
  }
  assert.match(html, /id="accessPassword"[^>]+type|type="password" id="accessPassword"/);
  assert.match(html, /id="tabs-container" style="display:none;"/);
  for (const id of ['settings-btn','add-manual-order-btn','custom-components-btn']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*style="display: none;"`));
  }
});
test('all existing IDs, classes, data attributes and inline handlers are unchanged', () => {
  const contract = (html.match(/\b(?:id|data-[\w-]+|on\w+|class)="[^"]*"/g) || [])
    .filter(x => !['class="mg-ios"','class="mg-masthead"'].includes(x));
  // Captured from main ffd263f before the visual changes; no credentials or values.
  assert.equal(createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
    '7e413c758e19571e06665da00ab1338e24e6716e81b2ed40ea4609f8e9c0c266');
});
test('CSS never forces hidden tab/action containers visible or replaces user wallpaper', () => {
  for (const block of css.split('}')) {
    if (/\{[^{}]*display:[^;}]*!important/.test(block)) {
      assert.ok(block.includes('#settings-btn:not([style*="display: none"])') ||
        block.includes('#fixed-header:not(.loaded)'), 'Unexpected forced visibility: '+block);
    }
  }
  assert.doesNotMatch(css, /background-image\s*:/);
  assert.doesNotMatch(css, /\.(?:order-card|acc-)[\w-]*\s*\{/);
});
test('focus, reduced motion, local fonts and comfortable target sizing exist', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--mg-touch: 44px/);
  assert.match(css, /-apple-system/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
});
