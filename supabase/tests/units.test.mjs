/* ============================================================================
   METRIC OR IMPERIAL, ONE CHOICE FOR THE SITE (epinoia/units.js).

     * height() / weight(): one set of units, never both; nothing for a missing or zero value;
     * get() / set(): metric by default, remembered, and every listener told;
     * the pages: the profile, the roster and the stats tables all load it and read it.

     node supabase/tests/units.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

/* a localStorage and an event target, as a browser would give it */
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const heard = [];
const listeners = {};
globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
globalThis.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); };
globalThis.dispatchEvent = e => { (listeners[e.type] || []).forEach(fn => fn(e)); return true; };
if (typeof globalThis.CustomEvent !== 'function') globalThis.CustomEvent = class extends Event { constructor(t, o) { super(t); this.detail = o && o.detail; } };

const U = require(path.join(ROOT, 'epinoia', 'units.js'));

console.log('# formatting');
ok('206 cm is 206 cm, or 6\'9"', U.height(206, 'metric') === '206 cm' && U.height(206, 'imperial') === '6\'9"', [U.height(206, 'metric'), U.height(206, 'imperial')]);
ok('110 kg is 110 kg, or 243 lb', U.weight(110, 'metric') === '110 kg' && U.weight(110, 'imperial') === '243 lb');
ok('a height that rounds to a whole foot says 0 inches, never 12', U.height(182.5, 'imperial') === '6\'0"', U.height(182.5, 'imperial'));
ok('nothing known, nothing shown', [null, undefined, '', 0, NaN].every(v => U.height(v) === '' && U.weight(v) === ''));
ok('a column\'s unit follows the choice', U.heightUnit('metric') === 'cm' && U.heightUnit('imperial') === 'ft·in' && U.weightUnit('imperial') === 'lb');

console.log('# the choice');
ok('metric by default', U.get() === 'metric');
U.onChange(u => heard.push(u));
U.set('imperial');
ok('set() remembers it', U.get() === 'imperial' && store[U.KEY] === 'imperial');
ok('...and tells every listener', heard.join() === 'imperial', heard);
ok('...and the formatters follow it', U.height(206) === '6\'9"' && U.weight(110) === '243 lb');
U.set('furlongs');
ok('an unknown unit is ignored', U.get() === 'imperial' && heard.length === 1);
U.set('imperial');
ok('setting the same unit again tells nobody', heard.length === 1);

console.log('# the pages');
['p', 't', 'l', 'stats', 'scouting'].forEach(d => {
  const h = rd('epinoia', d, 'index.html');
  ok(d + '/ loads units.js (read when a table draws, so its place among the deferred scripts does not matter)', /<script src="\.\.\/units\.js\?v=\d+" defer><\/script>/.test(h));
});
ok('the profile, the roster and the stats tables read it', /U\.height\(pl\.height_cm\)/.test(rd('epinoia', 'p', 'player.js')) &&
   /U\.weight\(val\)/.test(rd('epinoia', 't', 'team.js')) && /bioUnit\(r\.bio_ht, 'height'\)/.test(rd('epinoia', 'fulltable.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
