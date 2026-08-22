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

/* ---- 5. the controls reference, and the ways into it ---------------------- */
console.log('\nevery door into the demo arrives at the controls');

ok('the help screen is a real screen showScreen knows about',
   /'logview',\s*\n\s*'helpview'/.test(src),
   'a screen missing from that list is shown without hiding the one behind it');
ok('the bottom menu has a controls button', /id="btnHelp"/.test(src));
ok('...wired to open the reference', /\$\('#btnHelp'\)\.addEventListener/.test(src));
ok('escape closes it like any other overlay',
   /overlayOpen = \['boxview','advview','logview','helpview'\]/.test(src));
ok('? and h open it', /case '\?': case 'h': openHelp\(\); break;/.test(src));
ok('the pregame card offers it before a ball is thrown', /id="pgHelp"/.test(src));
ok('...and the demo opens on it, once per load',
   /if\(EP_TRAIN && !window\.__hvSeen\)\{[\s\S]{0,80}openHelp\(\);/.test(src),
   'every ?train=1 link lands here, so gating it at this screen covers all of them');

/* ---- 6. it is two documents, not one with footnotes ----------------------- */
console.log('\nthe reference is built for the device in your hands');

/* Run renderControls for real, both ways, against a DOM small enough to stub.
   A static check could only confirm the branch exists; the requirement is that
   a touch reader is never shown a key they do not have, and that is a property
   of the OUTPUT, not of the source. */
const hvFrom = src.indexOf('let HV_MODE');
/* through closeHelp, not up to openHelp: renderControls wires it to two
   buttons, so a slice that stops short leaves it undefined at call time. */
const hvTo   = src.indexOf('function openLog()');
ok('the reference block can be located', hvFrom > -1 && hvTo > hvFrom);

const SHOTTYPES = ['layup', 'dunk', 'tip-in', 'jump shot', 'floater', 'hook', 'fadeaway'];
function build(isTouch) {
  const out = { html: '' };
  const $ = sel => sel === '#helpview' ? { set innerHTML(v) { out.html = v; } } : {};
  new Function('IS_TOUCH', '$', 'S', 'SHOTTYPES',
               src.slice(hvFrom, hvTo) + '\nrenderControls();')
    (isTouch, $, { phase: 'pregame' }, SHOTTYPES);
  return out.html;
}

let touch = '', keys = '';
try { touch = build(true); keys = build(false); ok('both variants render', true); }
catch (e) { ok('both variants render', false, String(e)); }

if (touch && keys) {
  /* THE TOUCH READER IS NEVER OFFERED A KEY. This is the bug the legend had —
     "✓ done · enter" on a phone with no enter — generalised to a whole page. */
  const keyish = [/ctrl \+/i, /\bhold 1\.5s\b/, /·\s*space\b/, /·\s*esc\b/, /·\s*enter\b/,
                  /type 2;10r/, /typing, once you are quick/, /\bclick\b/];
  keyish.forEach(re => ok(`touch: nothing about ${re.source}`, !re.test(touch),
    (touch.match(re) || [''])[0]));
  ok('touch: uses press &amp; hold for a made basket', /press &amp; hold/.test(touch));
  ok('touch: uses tap, not click', /tap a player/.test(touch));
  ok('touch: says how to reach the bottom sheet by hand', /drag the handle up/.test(touch));

  /* and the keyboard reader gets the half of the app that only exists there */
  ok('keyboard: names the 1.5s hold', /hold 1\.5s/.test(keys));
  ok('keyboard: has the typed command section', /typing, once you are quick/.test(keys));
  ok('keyboard: documents undo and redo',
     /ctrl \+ z/.test(keys) && /ctrl \+ shift \+ z/.test(keys));
  ok('keyboard: names the arm keys', /f \/ 2 \/ 3/.test(keys) && /t \/ p/.test(keys));
  ok('keyboard: does NOT tell a mouse user to press and hold', !/press &amp; hold/.test(keys));
  ok('the touch version is shorter, because it has less to say',
     touch.length < keys.length, `touch ${touch.length} vs keys ${keys.length}`);

  /* ---- the drags, which is what was asked for ---- */
  console.log('\nthe drags are named, and drawn');
  [['rebound', /drag <b>toward the middle<\/b> — that player takes the <b>rebound<\/b>/],
   ['block',   /drag <b>outward<\/b> — a <b>block<\/b>/],
   ['assist',  /teammate of the scorer<\/b>, drag <b>toward the middle<\/b> — an <b>assist<\/b>/],
   ['steal',   /opponent<\/b>, drag <b>toward the middle<\/b> — a <b>steal<\/b>/],
   ['sub out', /drag <b>down<\/b> to take them off/],
   ['sub in',  /drag <b>up<\/b> to bring them on/],
  ].forEach(([what, re]) =>
    ok(`both variants explain the ${what} drag`, re.test(touch) && re.test(keys)));

  ok('every drag says hold first',
     /hold first, then drag/.test(touch) && /hold first, then drag/.test(keys));
  ok('...and the ambiguity of "toward the middle" is resolved in words',
     /right for the left-hand team and left for the/.test(keys));

  const svg = (touch.match(/<svg class="hv-court"[\s\S]*?<\/svg>/) || [''])[0];
  ok('there is a diagram, not just prose', svg.length > 400);
  ok('...it labels both columns', /left team/.test(svg) && /right team/.test(svg));
  const arrows = (svg.match(/<path /g) || []).length;
  ok('...it draws inward, outward and both vertical arrows',
     arrows === 6, `${arrows} arrows, expected 6`);
  ok('...the substitution arrows are marked either team, not one column',
     /either team/.test(svg));
  ok('...and it carries a text alternative for a screen reader',
     /role="img"/.test(svg) && /aria-label="/.test(svg));
  ok("...the court colours survive off the scorer's stylesheet",
     /var\(--line-hi, rgba\(/.test(svg));
}

/* ---- 7. the legend names the drags too ------------------------------------ */
console.log('\nthe legend names the drags it used to leave vague');

ok('rebound says hold, and which way', /k\('hold \+ drag ▸ middle','any player — rebound/.test(src));
ok('block says outward', /k\('hold \+ drag ◂ outward','defender — block/.test(src));
ok('assist says hold, and which way', /k\('hold \+ drag ▸ middle','a teammate — assist/.test(src));
ok('steal says hold, and which way', /k\('hold \+ drag ▸ middle','an opponent — steal/.test(src));
ok('subbing in and out both name a direction',
   /k\('hold \+ drag ▲ up','bench player — sub in'\)/.test(src) &&
   /k\('hold \+ drag ▼ down','a player on court — sub out'\)/.test(src));
ok('the idle legend is no longer empty',
   !/default: return L;\s*\/\/ idle: no legend/.test(src),
   'the substitution drag has no button behind it, so an empty idle legend hid it entirely');
ok('...and what it offers when idle is device-gated',
   /IS_TOUCH\?'menu → controls':'\? or h'/.test(src) &&
   /'start · stop'\+\(IS_TOUCH\?'':'  ·  space'\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
