/* ============================================================================
   A VERTICAL SWIPE OVER A WIDE TABLE SCROLLS THE PAGE.

   This bug was reported three times against three different tables, and each
   fix was a different wording of touch-action on a box with overflow-x:auto:

     pan-x        the element handles horizontal AND NOTHING ELSE, so a
                  vertical drag beginning on the table was discarded outright
     pan-x pan-y  reads right, and leaves the browser arbitrating which axis a
                  touch belongs to — an overflow-x:auto box wins that often
                  enough that a finger over the numbers still strands you
     hidden+hand  no scrollable surface to arbitrate over, pan-y hands vertical
                  to the page, and horizontal is driven from pointer events

   The third one shipped — to fulltable.js only. Every other wide surface on
   the platform (the leaders board, WOWY, lineups, fixtures, the tab bar)
   builds its own .ft-wrap and could not see it, which is why the same bug kept
   coming back against them after it was fixed. So the two halves have to agree
   GLOBALLY, and that is what this asserts:

     1. no managed scroller is left as a native scroller on a phone
     2. the hand drag is central, and reaches every managed class
     3. it claims a gesture only once it is clearly horizontal, and lets a
        vertical one go without preventDefault or pointer capture
     4. the court draws its own colours, so it is visible on a page that does
        not load boxscore.css — which is how the season shot chart came out as
        bins floating on an empty rectangle

     node supabase/tests/touchscroll.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const xscroll   = rd('epinoia', 'xscroll.js');
const tableCss  = rd('epinoia', 'kit', 'table.css');
const kitCss    = rd('epinoia', 'kit', 'epinoia-kit.css');
const fulltable = rd('epinoia', 'fulltable.js');
const scorer    = rd('epinoia', 'score', 'index.html');
const boxjs     = rd('epinoia', 'boxscore.js');
const chart     = rd('epinoia', 'shotchart.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

/* ---- 1. the CSS leaves nothing for the browser to arbitrate --------------- */
console.log('\nno native scroller survives on a phone');

/* Comments out first. These blocks argue at length about the very declarations
   being asserted — "NOT overflow-x:auto" in the prose reads to a regex exactly
   like the declaration it warns against. */
const bare     = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const ftMobile = bare(tableCss).slice(bare(tableCss).indexOf('@media (max-width:640px)'));
const ftAt     = ftMobile.indexOf('.ft-wrap{');
const ftWrap   = ftMobile.slice(ftAt, ftMobile.indexOf('}', ftAt) + 1);
ok('.ft-wrap hides overflow on both axes below 640px',
   /overflow:hidden/.test(ftWrap), ftWrap.slice(0, 200));
ok('...and does NOT re-open overflow-x',
   !/overflow-x:\s*(auto|scroll)/.test(ftWrap));
ok("...and names pan-y, so vertical is the page's in as many words",
   /touch-action:\s*pan-y\s*;/.test(ftWrap));

/* The kit's two classes are declared for desktop first, so the phone block has
   to come AFTER them in the file — same specificity, file order decides. It is
   the exact trap that lost the news-title override. */
const kitBare = bare(kitCss);
const xsBase  = kitBare.indexOf('.ep-xscroll{');
const xsPhone = kitBare.indexOf('.ep-xscroll, .ep-xtabs{');
ok("the kit's phone override is declared after the base rules it overrides",
   xsBase > -1 && xsPhone > xsBase, `base@${xsBase} phone@${xsPhone}`);
const xsBlock = kitBare.slice(xsPhone, xsPhone + 200);
ok('...and hides overflow with touch-action:pan-y',
   /overflow:hidden/.test(xsBlock) && /touch-action:\s*pan-y/.test(xsBlock), xsBlock);

/* ---- 2. the drag is central and reaches everything ------------------------ */
console.log('\nthe hand drag is shared, not stranded in one file');

ok('xscroll.js owns the drag', /function drag\(/.test(xscroll));
['.ep-xscroll', '.ft-wrap', '.ep-tw', '.ep-xtabs'].forEach(c =>
  ok(`...and its managed list covers ${c}`, xscroll.includes(c)));
ok('...it is exported for a surface built outside the sweep',
   /window\.epinoiaDragScroll\s*=\s*drag/.test(xscroll));
ok('fulltable.js no longer keeps a private copy',
   !/function wireHorizontalDrag/.test(fulltable));
ok('...it calls the shared one instead',
   /window\.epinoiaDragScroll\(wrap\)/.test(fulltable));

/* A managed box must count as a scroller even though its computed overflow is
   hidden, or the sweep wraps a second box around every table it already has. */
ok('a managed box counts as a scroller despite overflow:hidden',
   /matches\(MANAGED\)\)\s*return true/.test(xscroll));

/* ---- 3. the axis rule, executed ------------------------------------------ */
console.log('\nthe axis rule releases a vertical gesture untouched');

/* Load xscroll.js against a DOM small enough to reason about. Only the parts
   drag() touches are implemented — everything else is a stub that returns
   nothing, and the sweep is harmless against it. */
function harness() {
  const listeners = new Map();
  const box = {
    dataset: {}, scrollLeft: 0, className: 'ft-wrap', captured: null,
    matches: () => true,
    addEventListener (t, fn) {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    setPointerCapture (id) { this.captured = id; },
    releasePointerCapture () { this.captured = null; },
  };
  const fire = (t, x, y) => {
    const e = { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y,
                button: 0, prevented: false,
                preventDefault () { this.prevented = true; } };
    (listeners.get(t) || []).forEach(fn => fn(e));
    return e;
  };
  return { box, fire };
}

const src = xscroll.replace(/\}\)\(\);\s*$/, '  globalThis.__drag = drag;\n})();');
const stubDoc = { readyState: 'complete', addEventListener () {},
                  querySelectorAll: () => [], documentElement: {} };
const g = {
  matchMedia: () => ({ matches: true }),
  addEventListener () {},
  MutationObserver: null,
  document: stubDoc,
  getComputedStyle: () => ({ overflowX: 'hidden' }),
  setTimeout, clearTimeout,
};
g.window = g; g.globalThis = g;
new Function('window', 'document', 'getComputedStyle', 'matchMedia',
             'MutationObserver', 'globalThis', src)
  (g, stubDoc, g.getComputedStyle, g.matchMedia, null, g);
const drag = g.__drag;
ok('drag() loaded out of xscroll.js', typeof drag === 'function');

if (typeof drag === 'function') {
  /* horizontal: claimed, and it pans */
  const h = harness(); drag(h.box);
  h.fire('pointerdown', 300, 400);
  h.fire('pointermove', 288, 401);              // 12 across, 1 down — past slop
  const hm = h.fire('pointermove', 200, 403);
  ok('a horizontal drag pans the box', h.box.scrollLeft === 100, `got ${h.box.scrollLeft}`);
  ok('...and is claimed, so the browser does not also act on it',
     hm.prevented === true && h.box.captured === 1);

  /* vertical: dropped, untouched */
  const v = harness(); drag(v.box);
  v.fire('pointerdown', 300, 400);
  const vm1 = v.fire('pointermove', 302, 380);
  const vm2 = v.fire('pointermove', 303, 250);  // and it keeps going after release
  ok('a vertical drag never moves the box', v.box.scrollLeft === 0);
  ok('...preventDefault is never called on it', !vm1.prevented && !vm2.prevented);
  ok('...and the pointer is never captured, so the page keeps scrolling',
     v.box.captured === null);

  /* a tap must still reach a sortable header underneath */
  const t = harness(); drag(t.box);
  t.fire('pointerdown', 300, 400);
  const tm = t.fire('pointermove', 302, 402);   // inside the slop
  t.fire('pointerup', 302, 402);
  ok('a tap is not claimed, so column sorting still works',
     !tm.prevented && t.box.captured === null && t.box.scrollLeft === 0);

  /* the sweep and the render site both wire; that must not double the pan */
  const d = harness(); drag(d.box); drag(d.box);
  d.fire('pointerdown', 300, 400);
  d.fire('pointermove', 288, 400);
  d.fire('pointermove', 200, 400);
  ok('wiring the same box twice does not double its panning',
     d.box.scrollLeft === 100, `got ${d.box.scrollLeft}`);
}

/* ---- 4. the court carries its own colours -------------------------------- */
console.log('\nthe court is visible on a page that does not load boxscore.css');

ok('courtSVG names a fallback colour, not a bare token',
   /var\(--line-hi,\s*rgba\(/.test(scorer),
   'a bare var(--line-hi) resolves to stroke:none off the scorer');
ok('...and the generated box score carries it too',
   /var\(--line-hi,\s*rgba\(/.test(boxjs));

/* The season chart is the whole card, so it wants the full markings — plain
   drops the lane ticks, which is right only for a box-score thumbnail. */
ok('the season shot chart asks for the full court, not the plain one',
   /B\.courtSVG\(null\)/.test(chart) && !/plain:\s*true/.test(chart));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
