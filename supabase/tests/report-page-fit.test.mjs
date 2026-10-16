// THE REPORTS' CONTENT FITS ITS PAGES (2026-10-03; report.js, report-teampages.js, kit/report.css, kit/teamviz.css). A page
// of each report (player, club, game analysis) was measured in a browser against live data, and what ran off a page or
// was cut short is held here, with no browser:
//   * the club report's and the game analysis's "both teams, zone by zone" table is cut into the parts the other zone tables
//     are (a heading for each kind of shot), each club's name once over three columns, in fixed columns that sum to the
//     page's width (it ran off the right of the page, with a club's name on every column);
//   * A CREST OR A PHOTO THAT DOES NOT LOAD is replaced by its monogram (stand), not a broken-picture icon;
//   * the layout engine: a block that is a little too tall for what is left of its page is made smaller (alone to 88%, or the
//     whole page together to 92%) before it is given a page of its own, so a chart is not alone on a page that is nearly
//     empty; a block much too tall still goes to a new page;
//   * the cover's names under the spots wrap, a long name in the rotations wraps, a lineup tile's text has its room.
//
//   node supabase/tests/report-page-fit.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));

/* a document just big enough for the engine: a node has children, a style, a class list, a height; a page's body is as
   tall as its blocks (each at its zoom) and has the room a real one has */
const BODY = 1000;
function node(tag) {
  const n = {
    tag, className: '', children: [], parent: null, dataset: {}, listeners: {}, offsetHeight: 0,
    style: { zoom: '', setProperty() {} },
    classList: {
      contains: c => n.className.split(/\s+/).includes(c),
      add: c => { if (!n.classList.contains(c)) n.className = (n.className + ' ' + c).trim(); },
      remove: c => { n.className = n.className.split(/\s+/).filter(x => x && x !== c).join(' '); }
    },
    appendChild(k) { if (k.parent) k.remove(); n.children.push(k); k.parent = n; return k; },
    insertBefore(k, ref) { if (k.parent) k.remove(); const i = n.children.indexOf(ref); n.children.splice(i < 0 ? n.children.length : i, 0, k); k.parent = n; return k; },
    get firstChild() { return n.children[0] || null; },
    setAttribute(k, v) { (n.attrs = n.attrs || {})[k] = String(v); },
    /* a page body's box is BODY tall from 0; a block's sits under the blocks before it, each at its zoom */
    getBoundingClientRect() {
      if (n._geo) return { top: 0, bottom: BODY, height: BODY };
      const p = n.parent, before = p ? p.children.slice(0, p.children.indexOf(n)) : [];
      const top = before.reduce((s, k) => s + k.offsetHeight * (+k.style.zoom || 1), 0);
      return { top, bottom: top + n.offsetHeight * (+n.style.zoom || 1), height: n.offsetHeight * (+n.style.zoom || 1) };
    },
    remove() { if (n.parent) { n.parent.children = n.parent.children.filter(x => x !== n); n.parent = null; } },
    querySelector(sel) { return sel === '.rp-body' ? n._body || null : null; },
    getAttribute: k => (n.attrs && k in n.attrs ? n.attrs[k] : null),
    addEventListener(ev, fn) { (n.listeners[ev] = n.listeners[ev] || []).push(fn); },
    get lastElementChild() { return n.children[n.children.length - 1] || null; },
    get parentNode() { return n.parent; },
  };
  Object.defineProperty(n, 'textContent', { get: () => n._t || '', set(v) { n._t = v; n.children = []; } });
  Object.defineProperty(n, 'innerHTML', { set(v) { if (/rp-body/.test(v)) { n._body = node('div'); n._body.className = 'rp-body'; n.appendChild(n._body); } else n.children = []; } });
  return n;
}
globalThis.document = { createElement: node };
const E = require(path.join(ROOT, 'epinoia', 'report.js'));

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* a page body is BODY tall; what it holds is as tall as the blocks' heights at their zooms */
function geometry(host) {
  host.children.forEach(pg => {
    const body = pg._body;
    if (body._geo) return;
    body._geo = true;
    Object.defineProperty(body, 'clientHeight', { get: () => BODY });
    Object.defineProperty(body, 'scrollHeight', { get: () => Math.max(BODY, Math.round(body.children.reduce((s, k) => s + k.offsetHeight * (+k.style.zoom || 1), 0))) });
  });
}
/* run the engine over blocks of the given heights; a page's body gets its geometry when it is made */
function run(heights, opt) {
  const host = node('div');
  const append = host.appendChild;
  host.appendChild = k => { const r = append(k); geometry(host); return r; };
  const blocks = heights.map(h => { const b = node('div'); b.className = 'rp-blk'; b.offsetHeight = h; return b; });
  E.layout(host, {}, 'TEST', blocks, opt);
  return { pages: host.children.map(pg => pg._body.children.map(b => b.offsetHeight + (b.style.zoom ? '@' + b.style.zoom : ''))), blocks };
}

console.log('\nthe layout engine: a little too tall is made smaller, not given a page of its own');
{
  let r = run([400, 500]);
  ok('what fits is untouched', r.pages.length === 1 && r.blocks.every(b => !b.style.zoom), r.pages);
  r = run([500, 520]);
  ok('1020 into 1000: the last block alone, to 96%, on the one page (as it always was)', r.pages.length === 1 && +r.blocks[1].style.zoom > 0.95 && !r.blocks[0].style.zoom, r.pages);
  r = run([861, 176]);
  ok('1037 into 1000: a small block would have to shrink to 82% alone; the two of them to 96% together instead, one page (the game flow\'s rotations and the margin chart were two pages, the second nearly empty)',
     r.pages.length === 1 && r.blocks.every(b => +b.style.zoom > 0.95 && +b.style.zoom < 1), r.pages);
  r = run([520, 560]);
  ok('1080 into 1000 (the last alone would be 85%): both together, to 92%', r.pages.length === 1 && r.blocks.every(b => +b.style.zoom >= 0.92 && +b.style.zoom < 0.95), r.pages);
  r = run([520, 600]);
  ok('1120 into 1000 (the whole page would be under 92%): a page of its own for the second, both at full size', r.pages.length === 2 && r.blocks.every(b => !b.style.zoom), r.pages);
  r = run([900, 300]);
  ok('1200 into 1000: two pages, nothing shrunk', r.pages.length === 2 && r.blocks.every(b => !b.style.zoom), r.pages);
  r = run([1200]);
  ok('one block taller than a page is drawn smaller to fit (it always was)', r.pages.length === 1 && +r.blocks[0].style.zoom < 0.9 && +r.blocks[0].style.zoom >= 0.4, r.pages);
  r = run([300, 300, 300, 300]);
  ok('four blocks of 300: three on the first page and one on the next (1200 is 120%)', r.pages.length === 2 && r.pages[0].length === 3, r.pages);
  r = run([700, 200, 140]);
  ok('1040 in three blocks: the three together, 96%', r.pages.length === 1 && r.blocks.every(b => +b.style.zoom > 0.95), r.pages);
  r = run([400, 600, 410]);
  ok('a third block that makes it 1410: it goes on a page of its own, the first two stay full size', r.pages.length === 2 && !r.blocks[0].style.zoom && !r.blocks[1].style.zoom, r.pages);
}

console.log('\nno dead space (2026-10-16): a block of parts is cut where the page ends; a section may flow on; a last small piece squeezes in');
{
  /* a block of parts (splitBlock): its height the sum of the parts it draws */
  const parts = hs => E.splitBlock(hs, ps => { const b = node('div'); b.className = 'rp-blk'; b.offsetHeight = ps.reduce((s, h) => s + h, 0); b._ps = ps; return b; });
  const runB = (blocks, opt, host) => {
    host = host || node('div');
    if (!host._wired) { const append = host.appendChild; host.appendChild = k => { const r = append(k); geometry(host); return r; }; host._wired = true; }
    E.layout(host, {}, 'TEST', blocks, opt);
    return { host, pages: host.children.map(pg => pg._body.children.filter(b => b.offsetHeight).map(b => (b.style.zoom ? b.offsetHeight + '@' + b.style.zoom : b.offsetHeight))) };
  };
  const blk = h => { const b = node('div'); b.className = 'rp-blk'; b.offsetHeight = h; return b; };
  let r = runB([blk(300), parts([200, 200, 200, 200, 200])]);
  ok('a season line and five groups of 200 (MAIN STATS): three groups under the line, two overleaf - it was the line alone and the groups on the next page',
     JSON.stringify(r.pages) === '[[300,600],[400]]', r.pages);
  r = runB([parts([400, 400, 400])]);
  ok('a block of parts taller than a page: cut at full size, never shrunk to 83%', JSON.stringify(r.pages) === '[[800],[400]]', r.pages);
  r = runB([blk(950), parts([200, 200])]);
  ok('...and when not even one part fits, the whole goes overleaf', JSON.stringify(r.pages) === '[[950],[400]]', r.pages);
  /* flowing on: what the section before left */
  const prev = runB([blk(500)]);
  r = runB([blk(300), blk(400)], { pack: 'flow' }, prev.host);
  ok('a flowing section begins under the one before when its first block fits and 30% or more is free (500 of 1000 used)',
     JSON.stringify(r.pages) === '[[500,300],[400]]', r.pages);
  ok('...under its own name and a rule (joinHead)', prev.host.children[0]._body.children.some(b => b.classList.contains('rp-join') && b.children.some(k => k.className === 'rp-joinlbl' && k.textContent === 'TEST')));
  const full = runB([blk(750)]);
  r = runB([blk(200)], { pack: 'flow' }, full.host);
  ok('...but not on a page a quarter free: a heading and a few lines at its foot would read as clutter (FLOW_FREE 30%)', JSON.stringify(r.pages) === '[[750],[200]]', r.pages);
  const legendish = runB([blk(800)]);
  r = runB([blk(150)], { pack: 'flow', free: 0.15 }, legendish.host);
  ok('...a section that says so (the legend, its key alone) may begin lower: 20% free', JSON.stringify(r.pages) === '[[800,150]]', r.pages);
  /* the last small piece */
  r = run([800, 200, 100]);
  ok('1100 whose last block is small (a legend\'s last rows): the whole page to 90%, where a page of its own would hold 10%', r.pages.length === 1 && r.blocks.every(b => +b.style.zoom >= 0.86 && +b.style.zoom < 0.92), r.pages);
  r = run([700, 400]);
  ok('...not a large last block: 1100 with a last block of 400 still goes overleaf, nothing shrunk below 92%', r.pages.length === 2 && r.blocks.every(b => !b.style.zoom), r.pages);
}
{
  const R = read('epinoia', 'report.js'), PP = read('epinoia', 'report-playerpages.js');
  ok('the player report\'s groups, legend rows and on/off table are blocks of parts; its later sections and the legend flow',
     /out\.push\(E\.splitBlock \? E\.splitBlock\(gl, gCols\) : gCols\(gl\)\);/.test(PP) && /if \(rows\.length\) out\.push\(splitBlock\(rows, ps =>/.test(R)
     && /E\.splitBlock\(parts, tbl\)/.test(PP) && (PP.match(/pack: 'flow'/g) || []).length >= 7 && /key: 'legend', title: 'Legend', on: true, pack: 'flow', free: 0\.15/.test(PP));
  ok('a page naming two sections says "continued" after the first, in a smaller face when long (the name beside it never cut)',
     R.includes("(cont && i === 0 ? '<i> ") && R.includes("continued</i>' : '')).join(")
     && R.includes("m.classList.toggle('long', labels.join(") && R.includes(").length > 26);"));
}

console.log('\na crest or a photo that does not load');
{
  const img = (fb, o) => { const box = node('span'); box.className = 'rp-ph img'; const i = node('img'); i.attrs = { 'data-fb': fb }; Object.assign(i, o); box.appendChild(i); return { i, box }; };
  const scope = list => ({ querySelectorAll: sel => (sel === 'img[data-fb]' ? list : []) });
  let a = img('TJ', { complete: true, naturalWidth: 0 });
  E.stand(scope([a.i]));
  ok('one that finished with nothing drawn is replaced at once by its initials, and the box stops being a picture', a.box.children.length === 1 && a.box.children[0].tag === 'b' && a.box.children[0].textContent === 'TJ' && !a.box.classList.contains('img'), a.box.children.map(k => k.tag));
  a = img('TJ', { complete: true, naturalWidth: 120 });
  E.stand(scope([a.i]));
  ok('one that drew is left alone', a.box.children.length === 1 && a.box.children[0].tag === 'img' && a.box.classList.contains('img'));
  a = img('12', { complete: false, naturalWidth: 0 });
  E.stand(scope([a.i]));
  ok('one still loading waits, and when it fails is replaced (the jersey number, here)', a.box.children[0].tag === 'img' && (a.i.listeners.error || []).length === 1);
  (a.i.listeners.error || []).forEach(f => f());
  ok('... by the number', a.box.children.length === 1 && a.box.children[0].textContent === '12', a.box.children.map(k => k.tag));
  a = img('', { complete: true, naturalWidth: 0 });
  E.stand(scope([a.i]));
  ok('an empty fallback just takes the picture out (a lineup\'s small photos, where an empty disc is worse)', a.box.children.length === 0);
  /* where the browser can decode(), that is what is asked (a vector logo with no size of its own has no naturalWidth and is no failure) */
  a = img('TJ', { decode: () => Promise.reject(new Error('EncodingError')), complete: true, naturalWidth: 300 });
  const b = img('TJ', { decode: () => Promise.resolve(), complete: true, naturalWidth: 0 });
  E.stand(scope([a.i, b.i]));
  await new Promise(r => setTimeout(r, 0));
  ok('one that cannot be decoded is replaced, one that can is left alone even with no naturalWidth (an SVG crest)',
     a.box.children.length === 1 && a.box.children[0].tag === 'b' && b.box.children.length === 1 && b.box.children[0].tag === 'img', [a.box.children.map(k => k.tag), b.box.children.map(k => k.tag)]);
  const tp = read('epinoia', 'report-teampages.js'), tv = read('epinoia', 'teamviz.js'), rs = read('epinoia', 'report.js');
  ok('the crest in the page\'s top-left, the club report\'s player photos and the lineups\' five carry a fallback, and a report runs it once the pages are built',
     /crossorigin="anonymous" data-fb=/.test(rs) && /data-fb="' \+ esc\(m\.jersey/.test(tp) && /crossorigin="anonymous" data-fb=""/.test(tv) && /stand\(host\);?\s*[\s\S]{0,200}onBuilt|stand\(pagesHost\)|stand\([a-z]+\)/.test(rs));
}

console.log('\nboth teams, zone by zone');
{
  const tp = read('epinoia', 'report-teampages.js'), css = read('epinoia', 'kit', 'report.css');
  ok('cut into the parts the other zone tables are: a banner for each of the two lists, then SC.parts\' heading rows and the rows on their kind', /SC\.parts\(list, which\)/.test(tp) && /<tr class="rp-zg"><td colspan="8">/.test(tp) && /<tr class="rp-zk"/.test(tp) && /'<tr' \+ \(any\.kind \? ' data-k="'/.test(tp));
  ok('a club\'s name is once, over its three columns, and the columns are the same in every row (not "FC Name made/att, FC Name % of shots, ...")',
     /<th colspan="3" class="rp-zh-a">' \+ nameA/.test(tp) && /<th colspan="3" class="rp-zh-b">' \+ nameB/.test(tp) && /<th>made\/att<\/th><th>% of shots<\/th><th>FG%<\/th><th>made\/att<\/th><th>% of shots<\/th><th>FG%<\/th>/.test(tp) && !/' made\/att<\/th>/.test(tp));
  ok('the table is the zone table (rp-zt, so its kinds\' bars and headings), in fixed columns', /<table class="rp-tbl rp-zt rp-zz"><colgroup>/.test(tp) && /\.rp-zz\{ table-layout:fixed \}/.test(css));
  const w = c => { const m = css.match(new RegExp('\\.rp-zz col' + c + '\\{ width:([\\d.]+)%')); return m ? +m[1] : NaN; };
  const sum = w('') * 6 + w('\\.z') + w('\\.be');
  ok('and the columns add up to the page\'s width, 100% (a zone\'s label, six of figures, the break-even)', Math.abs(sum - 100) < 0.2, sum);
  ok('each club\'s colour under its name (the page\'s two accents)', /th\.rp-zh-a, \.rp-zz thead th\.rp-zh-b\{[^}]*inset 0 -3px 0 var\(--rp-a/.test(css) && /th\.rp-zh-b\{ box-shadow:inset 0 -3px 0 var\(--rp-b/.test(css));
}

console.log('\ncontent that was cut short');
{
  const css = read('epinoia', 'kit', 'report.css'), tv = read('epinoia', 'kit', 'teamviz.css');
  ok('the names under the cover\'s five spots wrap at 112px instead of running off the court (a long name: T. Donald Macdonnell Johnson)', /\.rp-spot em\{[^}]*width:max-content; max-width:112px;[^}]*text-align:center/.test(css) && !/\.rp-spot em\{[^}]*nowrap/.test(css));
  ok('a long name in the rotations wraps in the report\'s pages (the box score\'s own cell keeps its ellipsis)', /\.rp-pg \.rot-nm b\{[^}]*white-space:normal/.test(css));
  ok('a lineup tile has 2px a side, not 4, in the club report and in the game analysis (its "opp eFG% −44.5" was three pixels too long)', /\.tv-t\{[^}]*padding:5px 2px 4px/.test(tv) && /\.ga-lus \.tv-t\{ padding:3px 2px \}/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
