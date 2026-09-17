/* ============================================================================
   epinoia/reveal.js + kit/reveal.css — blocks arrive as you scroll to them and
   stand down behind you.

   WHAT IS ACTUALLY AT RISK HERE is not the animation, it is the page. Every
   rule that hides anything is behind html.rv-on, and only this script sets
   that class — so the failure modes worth testing are the ones where the
   script decides NOT to run and the content must be left alone:

     · no IntersectionObserver (an old browser)
     · prefers-reduced-motion (somebody who asked for less movement)

   and the ones where it does run:

     · a block in view is shown, one above is marked above, one below below
     · late content — every one of these pages renders from the network — is
       picked up rather than left invisible for ever

   The CSS is read as text: it must never hide with display or visibility,
   which would take a block out of the layout and out of browser find.
   ============================================================================ */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'reveal.css'), 'utf8');
const SRC = path.join(ROOT, 'epinoia', 'reveal.js');

let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  — saw ' + JSON.stringify(saw))); }
};
const eq = (what, a, b) => ok(what, JSON.stringify(a) === JSON.stringify(b), a);

/* ---------------------------------------------------------- a small DOM --- */
class El {
  constructor(name) { this.tagName = name; this.cls = new Set(); this.children = [];
    this.parent = null; this.attrs = {}; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach(x => self.cls.add(x)),
      remove: (...c) => c.forEach(x => self.cls.delete(x)),
      contains: c => self.cls.has(c)
    };
  }
  get className() { return [...this.cls].join(' '); }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  closest(sel) {
    const want = String(sel).split(',').map(s => s.trim().replace(/^\./, ''));
    for (let x = this; x; x = x.parent) if (want.some(w => x.cls.has(w))) return x;
    return null;
  }
  querySelectorAll(sel) {
    const want = String(sel).replace(/^\./, '');
    return this.all().filter(n => n.cls.has(want));
  }
}

function world(o = {}) {
  const body = new El('body');
  const html = new El('html');
  const observers = [];
  const mutators = [];
  const frames = [];

  globalThis.document = {
    body,
    documentElement: html,
    readyState: 'complete',
    addEventListener() {}
  };
  globalThis.matchMedia = () => ({ matches: !!o.reduced });
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  const timers = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push(fn); return timers.length; };
  globalThis.__timers = timers;
  globalThis.__realTimeout = realTimeout;
  globalThis.MutationObserver = class {
    constructor(fn) { this.fn = fn; mutators.push(this); }
    observe() { this.on = true; }
    disconnect() { this.on = false; }
  };
  globalThis.IntersectionObserver = o.noIO ? undefined : class {
    constructor(fn, opts) { this.fn = fn; this.opts = opts; this.seen = []; observers.push(this); }
    observe(n) { this.seen.push(n); }
    disconnect() { this.off = true; }
  };

  return {
    body, html, observers, mutators,
    block(cls) { const n = new El('section'); n.cls.add(cls); return body.appendChild(n); },
    /* what the browser hands the callback */
    enter(n) { observers[0].fn([{ target: n, isIntersecting: true }]); },
    leaveAbove(n) {
      observers[0].fn([{ target: n, isIntersecting: false,
                         boundingClientRect: { bottom: -40 }, rootBounds: { top: 0 } }]);
    },
    leaveBelow(n) {
      observers[0].fn([{ target: n, isIntersecting: false,
                         boundingClientRect: { bottom: 900 }, rootBounds: { top: 0 } }]);
    },
    runFrames() { const f = frames.splice(0); f.forEach(fn => fn()); },
    /* the 1.5s "nobody has told us anything" net */
    runTimers() { const t = globalThis.__timers.splice(0); t.forEach(fn => fn()); }
  };
}

const load = () => { delete require.cache[require.resolve(SRC)]; return require(SRC); };

/* ------------------------------------------------------------ it runs ----- */
console.log('\n-- when it runs');
{
  const w = world();
  const R = load();
  const a = w.block('sec'), b = w.block('sec');
  const m = R.mount({ root: w.body, selector: '.sec' });

  ok('the page is marked, so the CSS may hide things', w.html.cls.has('rv-on'));
  eq('every block is enrolled', [a.cls.has('rv'), b.cls.has('rv')], [true, true]);
  eq('...and observed', w.observers[0].seen.length, 2);

  w.enter(a);
  ok('a block that comes into view is shown', a.cls.has('rv-in'));
  w.leaveAbove(a);
  eq('...and scrolling past it marks it as behind you',
     [a.cls.has('rv-in'), a.cls.has('rv-above'), a.cls.has('rv-below')], [false, true, false]);
  w.enter(a);
  ok('scrolling back brings it in again', a.cls.has('rv-in') && !a.cls.has('rv-above'));
  w.leaveBelow(b);
  ok('a block still below the fold waits underneath', b.cls.has('rv-below'));

  /* late content: these pages all render from the network */
  const c = w.block('sec');
  w.mutators[0].fn();
  w.runFrames();
  ok('a block added after load joins in', c.cls.has('rv') && w.observers[0].seen.length === 3);
  eq('...without re-enrolling the ones already seen', w.observers[0].seen.filter(x => x === a).length, 1);

  m.stop();
  ok('stopping takes the mark off again', !w.html.cls.has('rv-on'));
}

/* ---------------------------------------------------------- the net ------- */
console.log('\n-- when the browser never reports back');
{
  /* A window the compositor has stopped painting, or a tab never brought to
     the front: the observer is never called and every block would sit at
     opacity 0 for ever.

     MARKING THEM ARRIVED IS NOT THE FIX, and the live page proved it — the
     same browser that never reports an intersection never advances a
     transition either, so a block told to fade IN also stays at 0. The class
     the stylesheet hangs on has to come off instead, which needs no frame. */
  const w = world();
  const R = load();
  const a = w.block('sec'), b = w.block('sec');
  R.mount({ root: w.body, selector: '.sec' });
  ok('before the net, the page is marked and the blocks are hidden',
     w.html.cls.has('rv-on') && a.cls.has('rv'));
  w.runTimers();
  ok('after it, the mark is gone, so not one rule in the stylesheet applies',
     !w.html.cls.has('rv-on'));
  ok('...and the observers are let go', w.observers[0].off === true && w.mutators[0].on === false);

  const c = w.block('sec');
  w.mutators[0].fn(); w.runFrames();
  ok('a block that arrives afterwards is not enrolled into an effect that is off',
     !c.cls.has('rv'));
}
{
  const w = world();
  const R = load();
  const a = w.block('sec');
  R.mount({ root: w.body, selector: '.sec' });
  w.enter(a);
  w.runTimers();
  ok('the net does not fire once the browser has reported anything',
     w.html.cls.has('rv-on') && w.observers[0].off !== true);
}

/* -------------------------------------------------------- it stands down -- */
console.log('\n-- when it must not run');
{
  const w = world({ reduced: true });
  const R = load();
  const a = w.block('sec');
  R.mount({ root: w.body, selector: '.sec' });
  ok('reduced motion: nothing is marked, so nothing is ever hidden',
     !w.html.cls.has('rv-on') && !a.cls.has('rv') && w.observers.length === 0);
  ok('...and the module says so', R.reduced() === true && R.usable() === false);
}
{
  const w = world({ noIO: true });
  const R = load();
  const a = w.block('sec');
  R.mount({ root: w.body, selector: '.sec' });
  ok('no IntersectionObserver: the page is left alone',
     !w.html.cls.has('rv-on') && !a.cls.has('rv'));
}
{
  const w = world();
  const R = load();
  const nav = w.block('ep-nav');
  const inside = new El('section'); inside.cls.add('sec'); nav.appendChild(inside);
  R.mount({ root: w.body, selector: '.sec' });
  ok('the furniture is never faded — a block inside the rail is skipped',
     !inside.cls.has('rv'));
}

/* ------------------------------------------------------------- the CSS --- */
console.log('\n-- the stylesheet');
{
  const rules = CSS.split('\n').filter(l => /^\s*html/.test(l));
  ok('every rule that hides is behind html.rv-on',
     rules.length > 0 && rules.every(l => l.includes('html.rv-on')), rules.find(l => !l.includes('html.rv-on')));
  ok('nothing is taken out of the layout (no display, no visibility)',
     !/display\s*:/.test(CSS) && !/visibility\s*:/.test(CSS));
  ok('a block holding the keyboard focus is never dimmed', /:focus-within\{opacity:1/.test(CSS));
  ok('reduced motion is answered in the CSS as well as the script',
     /@media \(prefers-reduced-motion:reduce\)/.test(CSS));
  ok('printing shows everything', /@media print/.test(CSS));
}

/* --------------------------------------------------------- it is wired --- */
console.log('\n-- the two pages that use it');
{
  const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
  const league = rd('epinoia', 'index.html');
  const home = rd('epinoia', 'home', 'index.html');
  ok('the league front page asks for it on its sections', /<body data-reveal="\.sec">/.test(league));
  ok('...and loads both halves',
     /reveal\.js\?v=\d+/.test(league) && /kit\/reveal\.css\?v=\d+/.test(league));
  ok('HOME asks for it on its sections and its foot', /<body data-reveal="\.sec, \.hm-foot">/.test(home));
  ok('...and loads both halves',
     /reveal\.js\?v=\d+/.test(home) && /kit\/reveal\.css\?v=\d+/.test(home));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
assert.equal(fail, 0);
