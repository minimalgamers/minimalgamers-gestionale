// 10/10: testo WhatsApp del nuovo GPO «ESPERIENZA ASSEMBLAGGIO IN LIVE» (prima cadeva su «ALTRO»: «al posto di …»).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/message-template-engine.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const E = sandbox.window.MessageTemplateEngine;

assert.ok(E.UPGRADE_CATEGORIES.includes('UPGRADE ESPERIENZA ASSEMBLAGGIO IN LIVE'));   // modificabile dalla pagina Template
const testo = E.upgradeTemplate({ rules: [] }, 'ESPERIENZA ASSEMBLAGGIO IN LIVE');
assert.match(testo, /vivere in diretta l'assemblaggio della tua build/);
assert.match(testo, /concordare insieme data e ora/);
assert.doesNotMatch(testo, /al posto di|\{\{attuale\}\}|registraz|durata|garant/i);
assert.notEqual(testo, E.UPGRADE_DEFAULTS.ALTRO);
console.log('ok testo WhatsApp assemblaggio in live');
