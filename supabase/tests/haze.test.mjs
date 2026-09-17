/* ============================================================================
   epinoia/haze.js + kit/haze.css — the draw distance.

   Content comes up out of nothing at the near edge of the screen, settles in
   the middle and recedes at the far edge, driven by a scroll timeline rather
   than by anything this repo runs per frame. haze.js only decides WHAT counts
   as a block; the stylesheet does the rest.

   TWO WRONG VERSIONS GOT HERE FIRST, and both are what this pins:

     1. fading whole SECTIONS in and out as they crossed the viewport. A
        section can be taller than the screen, so it sat half-lit; and it put
        every word one un-delivered callback away from invisible.
     2. two fixed gradient bars in the page's ground colour. On a light theme
        that is a white strip across the screen — nothing appeared to come out
        of anything, because the fade was painted OVER the content rather than
        being a property of it.

   So: blocks small enough to fit the screen, marked; anything taller walked
   into; the furniture never touched; and if the browser never draws a frame,
   the whole thing takes itself off the document.
   ============================================================================ */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'haze.css'), 'utf8');
const SRC = path.join(ROOT, 'epinoia', 'haze.js');

let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  — saw ' + JSON.stringify(saw))); }
};
const eq = (what, a, b) => ok(what, JSON.stringify(a) === JSON.stringify(b), a);

/* ---------------------------------------------------------- a small DOM ---
   Every element carries its own height, because height is the whole question
   this file asks of the page. */
class El {
  constructor(name, cls, h) {
    this.tagName = name; this.cls = new Set(cls ? cls.split(' ') : []);
    this.children = []; this.parent = null; this.attrs = {}; this.h = h || 0;
    this.position = 'static';
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach(x => self.cls.add(x)),
      remove: (...c) => c.forEach(x => self.cls.delete(x)),
      contains: c => self.cls.has(c),
      toggle: (c, on) => { if (on) self.cls.add(c); else self.cls.delete(c); }
    };
  }
  get className() { return [...this.cls].join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  hasAttribute(k) { return k in this.attrs; }
  append(...ns) { ns.forEach(n => { n.parent = this; this.children.push(n); }); return this; }
  getBoundingClientRect() { return { height: this.h }; }
  closest(sel) {
    const want = String(sel).split(',').map(s => s.trim()).filter(s => s.startsWith('.')).map(s => s.slice(1));
    for (let x = this; x; x = x.parent) if (want.some(w => x.cls.has(w))) return x;
    return null;
  }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
}
const mk = (cls, h, ...kids) => new El('div', cls, h).append(...kids);
/* the marks this file adds are not part of what a block is called */
const names = list => list.map(n =>
  n.className.split(' ').filter(c => c !== 'hz' && c !== 'hz-tall').join(' '));

function world(o = {}) {
  const body = new El('body');
  const html = new El('html');
  if (o.splash) html.cls.add('m-splash');
  const frames = [];
  const timers = [];

  globalThis.document = {
    body, documentElement: html, readyState: 'complete',
    createElement: t => new El(t), querySelector: () => null, addEventListener() {}
  };
  globalThis.innerHeight = o.vh == null ? 1000 : o.vh;
  globalThis.requestAnimationFrame = o.noFrames ? undefined : (fn => { frames.push(fn); return frames.length; });
  globalThis.setTimeout = fn => { timers.push(fn); return timers.length; };
  globalThis.clearTimeout = () => {};
  globalThis.MutationObserver = class {
    constructor(fn) { this.fn = fn; world.last = this; }
    observe() { this.on = true; } disconnect() { this.on = false; }
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.getComputedStyle = n => ({ position: n.position || 'static' });

  return {
    body, html,
    hz: () => body.all().filter(n => n.cls.has('hz')).map(n => n.className),
    runFrames() { frames.splice(0).forEach(fn => fn()); },
    runTimers() { timers.splice(0).forEach(fn => fn()); },
    mutate() { world.last.fn(); this.runFrames(); }
  };
}

const load = () => { delete require.cache[require.resolve(SRC)]; return require(SRC); };

/* ------------------------------------------------------- what gets marked -- */
console.log('\n-- what counts as a block');
{
  /* a section 1800px tall holding three 300px cards, in a 1000px window: the
     section is too tall to fade as one thing, the cards are not */
  const w = world({ vh: 1000 });
  const H = load();
  const card = h => mk('card', h);
  w.body.append(mk('sec', 1800, card(300), card(300), card(300)),
                mk('sec', 400, card(120)));
  const m = H.mount();

  eq('the tall section is walked into, and its cards are what fade',
     names(m.marked()), ['card', 'card', 'card', 'sec']);
  ok('...so nothing taller than the screen is ever faded as one thing',
     m.marked().every(n => n.getBoundingClientRect().height <= 1000 * H.FITS));
  ok('the page is marked so the stylesheet applies', w.html.cls.has('hz-on'));
}
{
  const w = world({ vh: 1000 });
  const H = load();
  w.body.append(mk('ep-nav', 300, mk('item', 40)), mk('sec', 200));
  const m = H.mount();
  eq('the rail and everything in it is left alone', names(m.marked()), ['sec']);
}
{
  const w = world({ vh: 1000 });
  const H = load();
  const stuck = mk('bar', 60); stuck.position = 'sticky';
  w.body.append(stuck, mk('sec', 200));
  eq('a sticky bar is left alone — it does not travel with the page',
     names(H.mount().marked()), ['sec']);
}
{
  const w = world({ vh: 1000 });
  const H = load();
  w.body.append(mk('sec', 200), mk('sec hz-never', 200), mk('sec', 200, mk('x', 50)));
  const cls = H.mount().marked().map(n => n.className);
  ok('a block that opts out is left alone, and so is what is inside it',
     !cls.some(c => c.split(' ').some(k => k === 'hz-never' || k === 'x')), cls);
}
{
  /* nothing to descend into: a single 5000px block is left alone rather than
     dimmed for the whole time it is on screen */
  const w = world({ vh: 1000 });
  const H = load();
  w.body.append(mk('slab', 5000));
  eq('a tall block with nothing inside it is not faded', H.mount().marked().length, 0);
}

/* ------------------------------------------------------------ as it grows -- */
console.log('\n-- as the page fills in');
{
  const w = world({ vh: 1000 });
  const H = load();
  const list = mk('list', 200);
  w.body.append(mk('sec', 300, list));
  const m = H.mount();
  eq('what is there at load is marked', names(m.marked()), ['sec']);

  list.append(mk('fx', 90), mk('fx', 90));     // the fixtures arrived
  list.h = 900; list.parent.h = 1000;
  w.mutate();
  ok('and what arrives afterwards is marked too',
     m.marked().some(n => n.cls.has('fx')), names(m.marked()));
}
{
  const w = world({ vh: 1000 });
  const H = load();
  const box = mk('sec', 300);
  w.body.append(box);
  const m = H.mount();
  box.h = 2000;                                 // it grew past the screen
  w.mutate();
  ok('a block that grows past the screen stops being faded', box.cls.has('hz-tall'));
  box.h = 300;
  w.mutate();
  ok('...and is faded again when it shrinks back', !box.cls.has('hz-tall'));
}

/* ------------------------------------------------------------- the net ---- */
console.log('\n-- when the browser never draws');
{
  const w = world({ vh: 1000 });
  const H = load();
  w.body.append(mk('sec', 200));
  H.mount();
  ok('before the net, the page is marked', w.html.cls.has('hz-on'));
  w.runTimers();                                 // no frame was ever run
  ok('the mark comes off, so not one rule in the stylesheet applies',
     !w.html.cls.has('hz-on'));
}
{
  const w = world({ vh: 1000 });
  const H = load();
  w.body.append(mk('sec', 200));
  H.mount();
  w.runFrames();                                 // the browser drew
  w.runTimers();
  ok('a browser that draws keeps the effect', w.html.cls.has('hz-on'));
}
{
  const w = world({ splash: true });
  const H = load();
  w.body.append(mk('sec', 200));
  eq('the water splash owns its own edges', H.mount().marked().length, 0);
}

/* --------------------------------------------------------------- the CSS -- */
console.log('\n-- the stylesheet');
{
  ok('the fade is on the content, not a bar painted over it',
     !/position:fixed/.test(CSS) && /animation-timeline: view\(\)/.test(CSS));
  ok('...driven by the scroll position, so nothing runs per frame',
     /animation-range: entry .* exit /.test(CSS));
  ok('every rule is behind html.hz-on, which only the script sets',
     CSS.split('\n').filter(l => /^\s*html/.test(l)).every(l => l.includes('html.hz-on')));
  ok('a browser without scroll-driven animations matches nothing',
     /@supports \(animation-timeline: view\(\)\)/.test(CSS));
  ok('reduced motion is excluded by hand, because there is no duration to flatten',
     /prefers-reduced-motion: no-preference/.test(CSS));
  ok('a block taller than the screen is never left half-lit',
     /\.hz\.hz-tall\{ animation: none/.test(CSS));
  ok('print shows everything', /@media print\{ html\.hz-on \.hz\{ animation:none/.test(CSS));
}

/* ------------------------------------------------------------ it is wired -- */
console.log('\n-- the two pages that use it');
{
  const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
  [['the league front page', rd('epinoia', 'index.html'), 'haze.js', 'kit/haze.css'],
   ['HOME', rd('epinoia', 'home', 'index.html'), '../haze.js', '../kit/haze.css']]
    .forEach(([who, html, js, css]) => {
      ok(who + ' asks for the haze', /<body data-haze>/.test(html));
      ok(who + ' loads both halves', html.includes(js + '?v=') && html.includes(css + '?v='));
      ok(who + ' no longer loads the per-section reveal', !/reveal\.(js|css)/.test(html));
    });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
assert.equal(fail, 0);
