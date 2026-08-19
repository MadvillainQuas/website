/* ============================================================================
   A BROKEN LEGEND MUST NOT TAKE THE SHOT CHART WITH IT.

   The scorer's legend named its confirm and cancel controls like this:

       const DONEK = () => IS_TOUCH ? '✓ done' : DONEK();

   On a phone that returns the string. On a PC it calls itself until the stack
   gives out. helpSpec() is called by renderHelp(), and renderAll() ran its
   renderers as ONE statement:

       renderTopbar(); renderSubbar(); ... renderHelp(); renderMid(); ...

   so the throw in renderHelp took renderMid with it — and renderMid is what
   redraws the shot chart AND attaches its click handler. A one-word mistake in
   a legend therefore presented as "I can't click the shot chart on PC to
   register a shot location", with nothing on screen connecting the two.

   Two separate failures, so two separate guards:

     1. the labels are literals, not calls — the bug itself
     2. renderAll isolates each renderer — so the NEXT one costs one panel
        instead of every panel drawn after it

   And a third, found while reproducing it: a court that is hidden has a
   bounding box 0 wide, and both click handlers divide by it. That wrote a
   location of `null` into the event log rather than doing nothing.

     node supabase/tests/scorer-render.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const src = readFileSync(path.join(ROOT, 'epinoia', 'score', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- 1. the legend names keys, and does not call itself ------------------- */
console.log('\nthe legend labels are values, not recursion');

for (const name of ['DONEK', 'CANCK']) {
  const line = src.split('\n').find(l => l.startsWith(`const ${name} =`));
  ok(`${name} is declared`, !!line);
  if (!line) continue;
  const body = line.slice(line.indexOf('=>') + 2);
  ok(`...${name} does not call itself`, !new RegExp(`\\b${name}\\s*\\(`).test(body), line.trim());
  /* both arms of the ternary must be strings — the touch label and the key */
  ok(`...${name} gives a literal on both sides of the ternary`,
     (body.match(/'[^']*'/g) || []).length >= 2, line.trim());
}

/* The whole point of the ternary is that a phone has neither key. */
const donek = src.split('\n').find(l => l.startsWith('const DONEK =')) || '';
const canck = src.split('\n').find(l => l.startsWith('const CANCK =')) || '';
ok('the PC labels name enter and esc', /enter/.test(donek) && /esc/.test(canck));
ok('...and the touch labels name neither',
   !/enter/.test(donek.split('?')[1].split(':')[0]) &&
   !/esc/.test(canck.split('?')[1].split(':')[0]));

/* ---- 2. one renderer failing costs one panel ------------------------------ */
console.log('\nrenderAll isolates its renderers');

ok('renderAll no longer runs them as one statement',
   !/renderTopbar\(\);\s*renderSubbar\(\);/.test(src),
   'a single statement means the first throw skips every renderer after it');
ok('...each is called inside a try', /forEach\(fn=>\{\s*try\{ fn\(\); \}/.test(src));
ok('...and a failure is reported rather than swallowed',
   /catch\(err\)\{ console\.error\('render failed: '\+fn\.name, err\); \}/.test(src));

/* renderMid draws the shot chart and attaches its click handler, so it is the
   one that must survive a neighbour's failure. */
const rai = src.indexOf('[renderTopbar, renderSubbar');
const block = src.slice(rai, rai + 300);
['renderTopbar', 'renderSubbar', 'renderScore', 'renderCols', 'renderX',
 'renderHelp', 'renderMid', 'renderCmd', 'renderPregame'].forEach(fn =>
  ok(`...${fn} is in the isolated list`, block.includes(fn)));

/* ---- 3. a court with no box has no spot on it ----------------------------- */
console.log('\na hidden court cannot record a location');

ok('recordLoc refuses a coordinate that is not a finite number',
   /if\(!Number\.isFinite\(nx\) \|\| !Number\.isFinite\(ny\)\) return;/.test(src),
   'dividing by a zero-width bounding box yields Infinity or NaN, and ' +
   '+NaN.toFixed(3) is stored as null');
ok('...and clamps what it does accept to the floor',
   /nx = Math\.max\(0, Math\.min\(1, nx\)\);/.test(src));

const guards = (src.match(/if\(!r\.width \|\| !r\.height\) return;/g) || []).length;
ok('both court click handlers check the box before dividing by it',
   guards === 2, `found ${guards}, expected 2 (the midpanel court and the flow court)`);

/* ---- 4. nothing else in the scorer calls itself this way ------------------ */
console.log('\nno other one-line helper recurses');

const selfRef = [];
src.split('\n').forEach((l, i) => {
  const m = l.match(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>(.*)$/);
  if (!m) return;
  /* a call to itself with no argument, in a body that is a single expression */
  if (new RegExp(`(^|[^.\\w])${m[1]}\\s*\\(\\s*\\)`).test(m[2])) selfRef.push(`${i + 1}: ${l.trim()}`);
});
ok('no arrow helper calls itself with no argument',
   selfRef.length === 0, selfRef.join('\n          '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
