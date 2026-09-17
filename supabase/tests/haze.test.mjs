/* ============================================================================
   epinoia/haze.js + kit/haze.css — the draw distance.

   Two bands fixed to the top and bottom of the viewport, painted in the page's
   own background, fading to nothing. Content comes out of the haze at the edge
   of the screen and sinks back into it — no sections, nothing waiting its turn.

   WHAT MATTERS ENOUGH TO PIN:

     · the bands go away where there is nothing beyond them — at the top of the
       page, at the bottom, and on a page shorter than the window. A haze that
       never lifts is a vignette somebody forgot to turn off.
     · nothing is ever hidden. This is paint over the content: no opacity on
       anything real, no display, no visibility, and pointer-events:none so it
       cannot eat a tap.
     · it sits under the rail and under the phone's bar. A menu about to be
       pressed is not in the distance.

   This replaced a per-section reveal that faded the sections themselves, which
   put the page one un-delivered callback away from being blank.
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
const near = (what, a, b) => ok(what, Math.abs(Number(a) - b) < 0.02, a);

/* ---------------------------------------------------------- a small DOM --- */
class El {
  constructor(name) { this.tagName = name; this.cls = new Set(); this.children = [];
    this.parent = null; this.attrs = {}; this.style = {}; }
  get classList() {
    const self = this;
    return { add: (...c) => c.forEach(x => self.cls.add(x)),
             remove: (...c) => c.forEach(x => self.cls.delete(x)),
             contains: c => self.cls.has(c) };
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
}

/* A page `docH` tall in a `vh` window, scrolled to `y`. */
function world(o = {}) {
  const body = new El('body');
  const html = new El('html');
  if (o.splash) html.cls.add('m-splash');
  html.scrollHeight = o.docH == null ? 3000 : o.docH;
  body.scrollHeight = html.scrollHeight;
  html.scrollTop = 0;
  const frames = [];
  const listeners = {};

  globalThis.document = {
    body, documentElement: html, readyState: 'complete',
    createElement: t => new El(t),
    addEventListener() {}
  };
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  globalThis.setTimeout = (fn) => fn && 0;
  globalThis.clearTimeout = () => {};
  globalThis.ResizeObserver = undefined;      // exercise the timer fallback
  globalThis.innerHeight = o.vh == null ? 800 : o.vh;
  globalThis.pageYOffset = 0;
  globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  globalThis.removeEventListener = (t, fn) => {
    listeners[t] = (listeners[t] || []).filter(f => f !== fn);
  };

  return {
    body, html, listeners,
    bands: () => body.children.filter(n => n.cls.has('ep-haze')),
    band: side => body.children.find(n => n.cls.has('ep-haze') && n.cls.has(side)),
    scrollTo(y) { globalThis.pageYOffset = y; (listeners.scroll || []).forEach(f => f()); frames.splice(0).forEach(fn => fn()); },
    grow(h) { html.scrollHeight = body.scrollHeight = h; }
  };
}

const load = () => { delete require.cache[require.resolve(SRC)]; return require(SRC); };

/* ------------------------------------------------------------ the bands --- */
console.log('\n-- the two bands');
{
  const w = world({ docH: 3000, vh: 800 });     // 2200px of scrolling
  const H = load();
  const h = H.mount();

  eq('one band at each edge', w.bands().map(n => n.className),
     ['ep-haze top', 'ep-haze bottom']);
  eq('...and neither is in the accessibility tree',
     w.bands().map(n => n.getAttribute('aria-hidden')), ['true', 'true']);

  near('at the top of the page there is no haze above you', w.band('top').style.opacity, 0);
  near('...and the page below you is at full haze', w.band('bottom').style.opacity, 1);

  w.scrollTo(H.RAMP / 2);
  near('a little way down, the top band is coming in', w.band('top').style.opacity, 0.5);

  w.scrollTo(1000);
  near('mid-page, both edges are hazed', w.band('top').style.opacity, 1);
  near('...both', w.band('bottom').style.opacity, 1);

  w.scrollTo(2200);
  near('at the very bottom there is nothing below to draw', w.band('bottom').style.opacity, 0);
  near('...and everything above you is still hazed', w.band('top').style.opacity, 1);

  h.stop();
  eq('stopping takes both bands out of the page', w.bands().length, 0);
}

/* ------------------------------------------------------- nothing to draw -- */
console.log('\n-- when there is no distance');
{
  const w = world({ docH: 700, vh: 800 });      // the page fits the window
  const H = load();
  H.mount();
  eq('a page shorter than the window has neither band showing',
     [w.band('top').style.opacity, w.band('bottom').style.opacity], ['0', '0']);
}
{
  const w = world({ docH: 700, vh: 800 });
  const H = load();
  H.mount();
  w.grow(4000);                                  // the fixtures landed
  w.scrollTo(0);
  near('...until the page grows under it, and then the bottom one is back',
     w.band('bottom').style.opacity, 1);
}
{
  const w = world({ splash: true });
  const H = load();
  H.mount();
  eq('the water splash owns its own edges', w.bands().length, 0);
}

/* --------------------------------------------------------------- the CSS -- */
console.log('\n-- the stylesheet');
{
  ok('the bands never take a tap meant for the page', /pointer-events:none/.test(CSS));
  const z = Number((CSS.match(/z-index:(\d+)/) || [])[1]);
  ok('...and sit under the rail (900) and the phone bar (2000)', z > 0 && z < 900, z);
  ok('nothing on the page itself is hidden — no display or visibility rules here',
     !/display:(?!none\s*\})/.test(CSS.replace(/@media print\{[^}]*\}/g, '')) &&
     !/visibility\s*:/.test(CSS));
  ok('the haze is the page’s own background, so a league’s colours carry',
     /var\(--ground\)/.test(CSS));
  ok('a browser without color-mix still gets a fade', /@supports not \(color: color-mix/.test(CSS));
  ok('print has no viewport to fade at', /@media print\{ \.ep-haze\{ display:none \} \}/.test(CSS));
}

/* ------------------------------------------------------------ it is wired -- */
console.log('\n-- the two pages that use it');
{
  const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
  [['the league front page', rd('epinoia', 'index.html'), 'haze.js', 'kit/haze.css'],
   ['HOME', rd('epinoia', 'home', 'index.html'), '../haze.js', '../kit/haze.css']]
    .forEach(([who, html, js, css]) => {
      ok(who + ' asks for the haze', /<body data-haze>/.test(html));
      ok(who + ' loads both halves',
         html.includes(js + '?v=') && html.includes(css + '?v='));
      ok(who + ' no longer loads the per-section reveal',
         !/reveal\.(js|css)/.test(html));
    });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
assert.equal(fail, 0);
