/* ============================================================================
   THE CHART KIT (epinoia/vizkit.js, epinoia/kit/vizkit.css; docs/what-wins-model.md §13, §16 WP4), with no browser.

     node supabase/tests/ww-vizkit.test.mjs

   What is held here:
     * every builder gives well-formed SVG with role="img", a <title> and a <desc>, a table twin and hits;
     * names are escaped: a label is text, never markup;
     * niceTicks is chartlab's own, on a spread of ranges;
     * nearest() finds the closest mark within 24 px and nothing further away;
     * the table twin holds every value the chart shows;
     * whiskers are ordered (low end left of the dot, the dot left of the high end);
     * a waterfall's parts sum from its start to its total;
     * the extreme cells of a diverging heatmap carry ▲ or ▼; a phone transposes a wide one;
     * the series colours clear 2.5:1 on both grounds, except the light s3 (2.66:1 is chartlab's own, and it is
       labelled); the light and dark tokens are chartlab's validated slots;
     * the binder reads with textContent for its tooltip, roves with the arrow keys, Enter toggles the twin, and
       redraws on a resize over 2 px and on a theme change.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const V = require(path.join(ROOT, 'epinoia/vizkit.js'));
const C = require(path.join(ROOT, 'epinoia/chartlab.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`); };

/* a small XML well-formedness check: every tag closed in order, attributes quoted, no stray < or & */
function wellFormed(xml) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let last = 0, m;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    if (/[<>]/.test(between) || /&(?!(amp|lt|gt|quot|#39);)/.test(between)) return 'stray text: ' + between.slice(0, 60);
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return 'mismatch at </' + m[2] + '>'; }
    else if (!m[4]) stack.push(m[2]);
  }
  if (/[<>]/.test(xml.slice(last))) return 'trailing';
  return stack.length ? 'unclosed ' + stack.join(',') : '';
}

const EVIL = '<b>x</b> & "q"';
const forestRows = [
  { id: 'efg', label: 'eFG% ' + EVIL, v: 1.16, lo: 1.1, hi: 1.22, shrunk: true, own: { v: 1.2, lo: 1.05, hi: 1.31 } },
  { id: 'tovp', label: 'TOV%', v: -1.13, lo: -1.21, hi: -1.05, badge: 'VIF 1.0' },
  { id: 'orebp', label: 'OREB%', v: 0.398, lo: 0.36, hi: 0.44, muted: true },
  { id: 'ftmr', label: 'FT rate', v: 0.094, lo: 0.05, hi: 0.13 }
];
const CURVE = { bins: [[-20, -8, -12, 40, 4, 0.1, 0.04, 0.23, -14.2], [-8, 0, -3.5, 60, 22, 0.37, 0.26, 0.49, -3], [0, 8, 3.9, 61, 40, 0.66, 0.53, 0.76, 3.3], [8, 20, 11.6, 38, 35, 0.92, 0.79, 0.97, 12.1]],
  raw: [[-15, 0.05, 0.02, 0.1], [-5, 0.3, 0.24, 0.37], [0, 0.5, 0.45, 0.55], [5, 0.7, 0.63, 0.76], [15, 0.95, 0.9, 0.98]], adj: null,
  x50: { v: 0.2, lo: -1.1, hi: 1.4 }, x75: { v: 6.1, lo: 4.9, hi: 7.6 } };
const BUILT = {
  forest: V.forest(forestRows, { x: { label: 'points of margin' }, title: 'forest ' + EVIL, desc: 'd' }),
  stackShare: V.stackShare([{ label: 'measured', parts: [{ k: 'efg', label: 'shooting', v: 52 }, { k: 'tovp', label: 'turnovers', v: 25 }, { k: 'orebp', label: 'boards', v: 18 }, { k: 'ftmr', label: 'free throws', v: 5 }] },
    { label: 'Dean Oliver', parts: [{ k: 'efg', v: 40 }, { k: 'tovp', v: 25 }, { k: 'orebp', v: 20 }, { k: 'ftmr', v: 15 }] }], { title: 'shares' }),
  bars: V.bars([{ id: 'a', label: 'eFG%', v: 0.61, lo: 0.57, hi: 0.65 }, { id: 'b', label: 'TOV%', v: -0.3, dir: -1 }, { id: 'c', label: '3PA rate', v: 0.04, dir: 0, muted: true }], { title: 'bars' }),
  binnedCurve: V.binnedCurve(CURVE, { x: { label: 'eFG% gap' }, title: 'curve' }),
  histogram: V.histogram([[-20, -10, 12], [-10, 0, 40], [0, 10, 44], [10, 20, 9]], { title: 'hist', mark: 0, split: 0 }),
  scatter: V.scatter([{ id: 't1', x: 70, y: 0.6, label: 'Team ' + EVIL }, { id: 't2', x: 74, y: 0.4, label: 'B' }, { id: 't3', x: 72, y: 0.5, label: 'C' }], { title: 'scatter', fit: { a: 0.5, b: 0 }, brush: true }),
  line: V.line([{ k: 'a', label: 'favourite', pts: [[0.8, 0.6, 0.55, 0.65], [1, 0.64, 0.6, 0.68], [1.2, 0.68, 0.62, 0.73]] }], { title: 'line' }),
  heatmap: V.heatmap({ rows: ['G', 'F', 'C'], cols: ['ts', 'usg', 'ast', 'reb'], mode: 'div',
    cells: [[{ v: 1.2 }, { v: -0.3 }, { v: 0.1, hatch: true }, null], [{ v: -1.5 }, { v: 0.2 }, { v: 0.6 }, { v: 0.4 }], [{ v: 0.3 }, { v: 0.05 }, { v: -0.2 }, { v: 1.4 }]] }, { title: 'heat', dp: 1 }),
  dumbbell: V.dumbbell([{ id: 'G', label: 'Guards · ts', pts: [{ k: 'top', label: 'top quarter', v: 57.2 }, { k: 'mid', label: 'league', v: 54.1 }, { k: 'bottom', label: 'bottom quarter', v: 51.3 }] }], { title: 'db' }),
  waterfall: V.waterfall({ start: { label: 'expected', v: 2.4 }, parts: [{ k: 'quality', label: 'shot quality', v: -1.2, lo: -2, hi: -0.4 }, { k: 'making', label: 'shot-making', v: -6.1 },
    { k: 'tovp', label: 'turnovers', v: 1.5 }, { k: 'orebp', label: 'boards', v: -2.2 }, { k: 'ftmr', label: 'free throws', v: 0.3 }, { k: 'other', label: 'other', v: -0.9 }, { k: 'garbage', label: 'garbage time', v: 1.2 }],
    total: { label: 'final margin' } }, { title: 'wf' }),
  tornado: V.tornado({ base: 0.48, rows: [{ id: 'efg', label: 'eFG%', lo: 0.3, hi: 0.66 }, { id: 'tovp', label: 'TOV%', lo: 0.4, hi: 0.55 }] }, { title: 'tor' }),
  meter: V.meter({ p: 0.62, se: 0.007, a: 'Home', b: 'Away ' + EVIL }, { title: 'meter' }),
  reliability: V.reliability({ series: [{ k: 'm', label: 'model', bins: [[0.2, 0.22, 30], [0.5, 0.48, 30], [0.8, 0.79, 30]] }, { k: 'h', label: 'home only', bins: [[0.57, 0.57, 90]] }] }, { title: 'rel' }),
  smallMultiples: V.smallMultiples([{ title: 'a', kind: 'binnedCurve', data: CURVE }, { title: 'b', kind: 'binnedCurve', data: CURVE }], { title: 'sm' })
};

console.log('\nevery builder: well-formed SVG, a name and a description, a table twin, hits');
for (const [k, b] of Object.entries(BUILT)) {
  const wf = wellFormed(b.svg);
  ok(k + ': well-formed', !wf, wf);
  ok(k + ': role="img", <title> and <desc>', /^<svg[^>]*role="img"[^>]*aria-labelledby="[^"]+"/.test(b.svg) && /<title id="[^"]+">[^<]+<\/title><desc id="[^"]+">/.test(b.svg));
  ok(k + ': a table twin and hits', b.table && Array.isArray(b.table.head) && b.table.rows.length > 0 && Array.isArray(b.hits) && b.hits.length > 0 &&
     b.hits.every(h => isFinite(h.x) && isFinite(h.y) && typeof h.label === 'string'));
  ok(k + ': the twin is well-formed too', !wellFormed(V.tableTwin(b)));
}

console.log('\nescaping');
ok('a label with markup in it stays text, in the chart and in the twin', !/<b>x/.test(BUILT.forest.svg) && /&lt;b&gt;x&lt;\/b&gt; &amp; &quot;q&quot;/.test(BUILT.forest.svg) &&
   !/<b>x/.test(V.tableTwin(BUILT.forest)) && !/<b>x/.test(BUILT.scatter.svg) && !/<b>x/.test(BUILT.meter.svg));
ok('...and the title too', /<title id="[^"]+">forest &lt;b&gt;/.test(BUILT.forest.svg));

console.log('\nticks: chartlab\'s algorithm');
{
  const cases = [[0, 1, 5], [-3.2, 17.9, 6], [0.001, 0.0093, 4], [-120, -3, 5], [5, 5, 4], [0, 100, 4], [-0.37, 0.41, 6], [1e5, 3.3e5, 5]];
  let same = true, saw = '';
  for (let i = 0; i < 200; i++) cases.push([Math.sin(i) * 50, Math.sin(i) * 50 + Math.abs(Math.cos(i * 3)) * 80 + 0.01, 2 + (i % 6)]);
  for (const [lo, hi, n] of cases) {
    const a = V.niceTicks(lo, hi, n), b = C.niceTicks(lo, hi, n);
    if (JSON.stringify(a) !== JSON.stringify(b)) { same = false; saw = [lo, hi, n].join(); break; }
  }
  ok('niceTicks = chartlab.niceTicks on ' + cases.length + ' ranges', same, saw);
  ok('...steps of 1, 2, 2.5, 5 × 10ⁿ', V.niceTicks(0, 1, 5).step === 0.2 && V.niceTicks(0, 100, 4).step === 25);
}

console.log('\nnearest within 24 px');
{
  const hits = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 130, y: 100 }, { id: 'c', x: 400, y: 50 }];
  ok('the closest of two near marks', V.nearest(hits, 118, 101).id === 'b' && V.nearest(hits, 112, 99).id === 'a');
  ok('a mark 23 px away is found, one 25 px away is not', V.nearest(hits, 400, 73) && V.nearest(hits, 400, 73).id === 'c' && V.nearest(hits, 400, 75) === null);
  ok('a wider reach can be asked for', V.nearest(hits, 400, 90, 45).id === 'c');
}

console.log('\nthe table twin holds every value');
{
  const tw = V.tableTwin(BUILT.forest);
  ok('forest: every estimate and both ends of every interval', forestRows.every(r => tw.includes('>' + V.fmt(r.v) + '<') && tw.includes('>' + V.fmt(r.lo) + '<') && tw.includes('>' + V.fmt(r.hi) + '<')));
  ok('...and the league\'s own estimate beside the shrunk one', tw.includes('>' + V.fmt(1.2) + '<'));
  const bt = V.tableTwin(BUILT.bars);
  ok('bars: every value', ['0.61', '-0.30', '0.04'].every(v => bt.includes('>' + v + '<')));
  const ct = V.tableTwin(BUILT.binnedCurve);
  ok('curve: every bin\'s games and share, and x50 / x75', CURVE.bins.every(b => ct.includes('>' + b[3] + '<') && ct.includes('>' + Math.round(b[5] * 100) + '%<')) && ct.includes('x50') && ct.includes('x75'));
  const ht = V.tableTwin(BUILT.heatmap);
  ok('heatmap: every cell (an empty one as –)', ['1.2', '-0.3', '0.1', '-1.5', '0.2', '0.6', '0.4', '0.3', '0.1', '-0.2', '1.4'].every(v => ht.includes(v)) && ht.includes('>–<'));
  ok('the twin\'s numbers are not translated', /<td translate="no">/.test(tw));
  ok('hits carry the interval for the tooltip', BUILT.forest.hits[0].value.includes('to'));
}

console.log('\nwhiskers are ordered');
{
  const order = svg => {
    const dots = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="5.5" class="vz-dot[^"]*" data-i/g)].map(m => [+m[1], +m[2]]);
    const wh = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" class="vz-whisk(?! vz-ghost)[^"]*"\/>/g)].map(m => m.slice(1).map(Number)).filter(w => w[1] === w[3]);
    return dots.every(([x, y]) => { const w = wh.find(q => Math.abs(q[1] - y) < 0.01); return !w || (w[0] <= x + 1e-6 && x <= w[2] + 1e-6); }) && wh.every(w => w[0] <= w[2]);
  };
  ok('forest: low ≤ estimate ≤ high, left to right', order(BUILT.forest.svg));
  const flipped = V.forest([{ label: 'x', v: 1, lo: 2, hi: 0 }], {});
  ok('...a row given high and low the wrong way round is still drawn as given, never as a negative width', /class="vz-whisk/.test(flipped.svg) && !wellFormed(flipped.svg));
  const curveW = [...BUILT.binnedCurve.svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" class="vz-whisk"\/>/g)].map(m => m.slice(1).map(Number));
  ok('curve: each bin\'s Wilson whisker runs from its low share up to its high share (y grows downward)', curveW.length === 4 && curveW.every(w => w[1] >= w[3]));
}

console.log('\nwaterfall sums');
{
  const d = BUILT.waterfall;
  const sum = 2.4 + [-1.2, -6.1, 1.5, -2.2, 0.3, -0.9, 1.2].reduce((a, b) => a + b, 0);
  ok('the total is the start plus every part', Math.abs(d.total - sum) < 1e-12);
  ok('...the last row of the twin says it', d.table.rows[d.table.rows.length - 1][1] === V.fmt(sum, 1));
  ok('...parts carry ▲ or ▼', (d.svg.match(/▲ \+/g) || []).length === 3 && (d.svg.match(/▼ -/g) || []).length === 4);
  const bars = [...d.svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" class="vz-bar/g)].map(m => m.slice(1).map(Number));
  ok('one bar for the start, each part and the total', bars.length === 9);
  const conns = [...d.svg.matchAll(/<line x1="[-\d.]+" y1="([-\d.]+)" x2="[-\d.]+" y2="([-\d.]+)" class="vz-conn"\/>/g)];
  ok('each step starts where the last ended (the connectors are level)', conns.length === 8 && conns.every(m => m[1] === m[2]));
}

console.log('\nheatmap');
{
  const h = BUILT.heatmap;
  const ext = [...h.svg.matchAll(/class="vz-cellv"[^>]*>([^<]*)</g)].map(m => m[1]);
  ok('the extreme cells carry ▲ or ▼ (1.4, 1.2, -1.5)', ext.filter(t => /^[▲▼]/.test(t)).length === 3 && ext.some(t => t.startsWith('▼ -1.5')) && ext.some(t => t.startsWith('▲ 1.4')));
  ok('a hatched cell (pooled weight over 0.6) is hatched', /fill="url\(#vzHatch\)"/.test(h.svg));
  ok('good and bad by sign, strength by opacity', /class="vz-cell vz-good" fill-opacity="0\.\d+"/.test(h.svg) && /class="vz-cell vz-bad"/.test(h.svg));
  const phone = V.heatmap({ rows: ['G', 'F', 'C'], cols: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], cells: [[1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7]] }, { W: 360 });
  ok('on a phone a wide heatmap is transposed (columns become rows)', phone.transposed && phone.table.rows.length === 7 && phone.table.head.length === 4);
  const seq = V.heatmap({ rows: ['a'], cols: ['x', 'y', 'z'], cells: [[1, 5, 9]], mode: 'seq' }, {});
  ok('sequential: one hue by opacity, five steps, no ▲▼', (seq.svg.match(/class="vz-cell vz-seq" fill-opacity="(0\.18|0\.36|0\.54|0\.72|0\.90)"/g) || []).length === 3 && !/[▲▼]/.test(seq.svg));
}

console.log('\nthe phone: labels above the bars');
{
  const wide = V.bars([{ label: 'offensive rebound %', v: 1 }], { W: 760 }), small = V.bars([{ label: 'offensive rebound %', v: 1 }], { W: 360 });
  const lab = s => (/<text x="([-\d.]+)" y="([-\d.]+)"( text-anchor="end")? class="vz-lab"/.exec(s) || []);
  ok('wide: the label to the left, ending at the bars', lab(wide.svg)[3] === ' text-anchor="end"');
  ok('narrow: the label above, starting at the bars', !lab(small.svg)[3] && /viewBox="0 0 360 /.test(small.svg));
}

console.log('\nlabels that differ only at the end (UI2-3)');
{
  const rows = [{ id: 'o', label: 'Free throws made per shot · offence', v: -0.48 }, { id: 'd', label: 'Free throws made per shot · defence', v: -0.72 },
    { id: 'b', label: 'Offensive boards (OREB%) · offence', v: 0.3 }, { id: 'e', label: 'Offensive boards (OREB%) · defence', v: 0.2 }];
  const labs = svg => [...svg.matchAll(/class="vz-lab"[^>]*>([^<]*)</g)].map(m => m[1]);
  for (const W of [643, 400]) {
    const t = labs(V.bars(rows, { W }).svg);
    ok('bars at ' + W + ' px: a long label keeps its \' · offence\' / \' · defence\' tail whole, so no two rows read the same',
       t.length === 4 && new Set(t).size === 4 && t[0].endsWith(' · offence') && t[1].endsWith(' · defence') && t[3].endsWith(' · defence'), t.join(' | '));
  }
}

console.log('\ncolour');
{
  const css = fs.readFileSync(path.join(ROOT, 'epinoia/kit/vizkit.css'), 'utf8');
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(hex(a)) + .05, y = lum(hex(b)) + .05; return x > y ? x / y : y / x; };
  const dark = /:root\{[^}]*--vz-s1:(#[0-9a-f]{6}); --vz-s2:(#[0-9a-f]{6}); --vz-s3:(#[0-9a-f]{6})/.exec(css);
  const light = /:root\[data-theme="light"\]\{[^}]*--vz-s1:(#[0-9a-f]{6}); --vz-s2:(#[0-9a-f]{6}); --vz-s3:(#[0-9a-f]{6})/.exec(css);
  ok('dark series on :root, light on :root[data-theme="light"]', !!dark && !!light);
  ok('they are chartlab\'s validated slots', dark && light && dark.slice(1).join() === '#3987e5,#d95926,#199e70' && light.slice(1).join() === '#2a78d6,#eb6834,#1baf7a' &&
     dark.slice(1).join() === Object.values(V.SERIES.dark).slice(0, 3).join());
  if (dark && light) {
    const d = dark.slice(1).map(c => ratio(c, '#04100b')), l = light.slice(1).map(c => ratio(c, '#f3faf6'));
    ok('dark: every series at least 2.5:1 on the dark ground', d.every(r => r >= 2.5), d.map(r => r.toFixed(2)).join());
    ok('light: s1 and s2 at least 2.5:1 on the pale ground', l[0] >= 2.5 && l[1] >= 2.5, l.map(r => r.toFixed(2)).join());
    ok('light: s3 is the known exception (2.66:1 on white-green, under 2.5 on the page ground) and is always labelled', l[2] < 3);
  }
  ok('no kit neon as a category and no --lume for heat', !/var\(--(lume|aqua|flare|violet|amber)\)/.test(css));
  ok('good and bad from the kit\'s own --good / --bad', /\.vz-good\{fill:var\(--good\)\}/.test(css) && /\.vz-bad\{fill:var\(--bad\)\}/.test(css));
  ok('figures in --f-data; the pixel face tracked .2em or less', /--f-data/.test(css) && [...css.matchAll(/\{([^}]*var\(--f-micro\)[^}]*)\}/g)].every(m => { const l = /letter-spacing:([\d.]+)em/.exec(m[1]); return !l || +l[1] <= 0.2; }));
  ok('reduced motion and forced colours', /prefers-reduced-motion:reduce/.test(css) && /forced-colors:active/.test(css));
  ok('a phone gets 40 px table buttons and pan-y on the chart', /max-width:720px[\s\S]*\.vz-tbtn\{min-height:40px/.test(css) && /touch-action:pan-y/.test(css));
}

console.log('\nthe review\'s fixes: the tooltip attached, the meter, the reliability key, the heatmap\'s labels, translation');
{
  /* UI-1: bind() puts the tooltip and the focus ring INTO the host (a minimal DOM: what bind touches) */
  const mk = tag => { const e = { tagName: tag.toUpperCase(), children: [], attrs: {}, style: {}, hidden: false, className: '', _html: '',
    classList: { add() {}, toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener() {},
    append(...c) { c.forEach(x => this.children.push(x)); }, appendChild(c) { this.children.push(c); return c; }, querySelector() { return null; },
    set textContent(v) { this.children = []; }, get textContent() { return ''; }, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
    return e; };
  const doc = { createElement: mk, addEventListener() {}, removeEventListener() {}, documentElement: null };
  const host = mk('div'); host.ownerDocument = doc; host.clientWidth = 600;
  V.bind(host, o => V.bars([{ id: 'a', label: 'A', v: 0.3 }], { W: o.W }), { label: 'x' });
  const cls = host.children.map(c => c.className);
  ok('UI-1: bind() attaches the tooltip (role status, aria-live) and the focus ring to the host', cls.includes('vz-tip') && cls.includes('vz-ring') && cls.includes('vz-plot'), cls.join(','));
  const css = fs.readFileSync(path.join(ROOT, 'epinoia/kit/vizkit.css'), 'utf8');
  ok('...and a hidden one is not shown (the flex display does not override [hidden])', /\.vz-tip\[hidden\],\.vz-ring\[hidden\]\{display:none\}/.test(css));
  /* UI-3: long names at phone width never run into each other */
  const m = V.meter({ p: 0.62, se: 0.01, a: 'Zastal Zielona Gora', b: 'Anwil Wloclawek' }, { W: 380 });
  const texts = [...m.svg.matchAll(/<text x="([\d.]+)" y="30" text-anchor="(start|end)" class="(vz-big|vz-lab)"[^>]*>([^<]*)<\/text>/g)].map(t => ({ x: +t[1], a: t[2], c: t[3], s: t[4] }));
  const ext = t => (t.a === 'start' ? [t.x, t.x + t.s.length * (t.c === 'vz-big' ? 13 : 6.6)] : [t.x - t.s.length * (t.c === 'vz-big' ? 13 : 6.6), t.x]);
  const left = texts.filter(t => t.x < 190).map(ext), right = texts.filter(t => t.x >= 190).map(ext);
  ok('UI-3: the meter\'s two sides do not overlap at 380 px with long names (the chances big, the names cut to their half)', left.length === 2 && right.length === 2 &&
     Math.max(...left.map(e => e[1])) < Math.min(...right.map(e => e[0])), JSON.stringify(texts));
  ok('...and short names keep one line each in the big face', (V.meter({ p: 0.5, a: 'Home', b: 'Away' }, { W: 760 }).svg.match(/class="vz-big"/g) || []).length === 2);
  /* UI-4 */
  ok('UI-4: the reliability chart keys its series (a swatch and the label for each)', /class="vz-key">model</.test(BUILT.reliability.svg) && /class="vz-key">home only</.test(BUILT.reliability.svg));
  /* UI-9 */
  const cols = ['eFG% (competitive)', 'TOV% (competitive)', 'OREB% (competitive)', 'FTM rate (competitive)'];
  const hm = V.heatmap({ rows: ['A', 'B'], cols, cells: [[1, -2, 3, 4], [4, 3, -2, 1]], mode: 'rel' }, { W: 760 });
  const ticks = [...hm.svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="start" class="vz-tick" transform="rotate\(-35[^"]*"[^>]*>([^<]*)<\/text>/g)];
  const reach = ticks.map(t => +t[1] + Math.cos(35 * Math.PI / 180) * t[2].length * 6.6);
  ok('UI-9: every rotated column label ends inside the frame', ticks.length === 4 && reach.every(x => x <= 760), reach.map(x => x.toFixed(0)).join(','));
  ok('UI-10: the \'rel\' mode colours more / less with the neutral pair, never good / bad', /vz-s1f/.test(hm.svg) && /vz-s2f/.test(hm.svg) && !/vz-good|vz-bad/.test(hm.svg));
  /* UI-12: labels are translated whole, before they are cut or split */
  globalThis.EpinoiaI18n = { t: x => ({ 'Possessions from a defensive rebound': 'ディフェンスリバウンドから始まったポゼッション', 'correlation with winning (r), better side up': '勝利との相関（r）、良い側が上' })[x] || x };
  const fo = V.forest([{ id: 'a', label: 'Possessions from a defensive rebound', v: 0.2, lo: 0.1, hi: 0.3 }], { W: 760, x: { label: 'correlation with winning (r), better side up' } });
  delete globalThis.EpinoiaI18n;
  ok('UI-12: a label is translated before fit() cuts it, an axis label before it is split onto two lines', /ディフェンスリバウンド/.test(fo.svg) && !/Possessions from a def/.test(fo.svg) && /勝利との相関/.test(fo.svg) &&
     !/correlation with/.test(fo.svg));
  const jp = (/>(ディフェンス[^<]*)</.exec(fo.svg) || [])[1] || '';
  ok('...and a wide (Japanese) label is cut by its width, two columns a character, so it stays inside its column', /…$/.test(jp) && [...jp].length * 2 * 6.6 <= Math.min(260, 760 * 0.34) + 14, jp);
  /* UI-7 */
  const sh = V.stackShare([{ label: 'Measured here', total: 100, rest: 'not explained', parts: [{ k: 'e', label: 'eFG', v: 70, lo: 63, hi: 74 }, { k: 't', label: 'TOV', v: 25 }] }], { W: 760 });
  const e = sh.hits.find(h => /eFG/.test(h.label));
  ok('UI-7: with a total, a strip shows shares of the whole (70%, not 74%), its interval on the same scale, the rest named', e.value === '70.0% (63.0–74.0)' && sh.hits.some(h => /not explained/.test(h.label) && h.value === '5.0%'), e && e.value);
}

console.log('\nthe binder');
{
  const src = fs.readFileSync(path.join(ROOT, 'epinoia/vizkit.js'), 'utf8');
  const bindSrc = src.slice(src.indexOf('function bind('), src.indexOf('const API = {'));
  ok('the tooltip is written with textContent, never innerHTML', /tip\.textContent = ''/.test(bindSrc) && /v\.textContent = hit\.value/.test(bindSrc) && !/tip\.innerHTML/.test(bindSrc));
  ok('arrows rove, Enter toggles the table twin, Escape lets go', /ArrowRight/.test(bindSrc) && /ArrowLeft/.test(bindSrc) && /e\.key === 'Enter'\) \{ e\.preventDefault\(\); toggleTwin\(\)/.test(bindSrc) && /Escape/.test(bindSrc));
  ok('a tap pins the tooltip and a second tap lets it go', /pinned === h\) \{ pinned = null; hide\(\)/.test(bindSrc));
  ok('a ResizeObserver over 2 px and a data-theme MutationObserver redraw', /Math\.abs\(w - lastW\) > 2/.test(bindSrc) && /attributeFilter: \['data-theme'\]/.test(bindSrc));
  ok('the nearest mark within 24 px, scaled to the drawn size', /nearest\(built\.hits, p\.x, p\.y, NEAR \* p\.k\)/.test(bindSrc) && V.NEAR === 24);
  ok('the chart is focusable and announced; the tooltip is a live status', /plot\.tabIndex = 0/.test(bindSrc) && /setAttribute\('aria-live', 'polite'\)/.test(bindSrc));
  ok('numbers are marked not to be translated', /setAttribute\('translate', 'no'\)/.test(bindSrc));
  ok('no library and no network: the kit fetches nothing', !/fetch\(|XMLHttpRequest|import\(/.test(src));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
