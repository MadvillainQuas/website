'use strict';
/* ============================================================================
   THE CHART KIT (docs/what-wins-model.md §13): window.EpinoiaVizKit.

   Pure SVG-string builders plus one DOM binder; no library. Every builder is

       kind(data, o) -> { svg, table: { head, rows }, hits: [{ id, x, y, label, value, detail }] }
       o = { W = 760, H, x: { lo, hi, label, fmt }, y: { … }, theme, title, desc }

   so the same call draws the chart, its table twin (every value the chart shows, for a screen reader, for a reader
   who prefers numbers, and for the tests) and the hit list the binder uses for tooltips and keyboard focus. Hits are
   in the SVG's own coordinates (its viewBox is 0 0 W H, and the page passes W = the box's width, so a px is a px).

     forest        a coefficient per row with its 95% whisker; hollow = shrunk toward the pool, ghost = the league's
                   own estimate, muted = not distinguishable from noise, badge = a short tag ('score', 'VIF 7')
     stackShare    shares as stacked strips (measured beside Oliver's 40/25/20/15)
     bars          diverging bars around 0 with ▲▼ for better/worse and optional whiskers
     binnedCurve   win share by bin (Wilson whiskers), the fitted curve and its band, x50 / x75
     histogram     counts by bin ([lo, hi, n] or [x, n])
     scatter       points, an optional fit, brushing (the binder reports the brushed ids)
     line          series of [x, y, lo?, hi?] with bands
     heatmap       rows × columns, 'div' (good/bad around 0) or 'seq' (one hue by opacity), hatch, ▲▼ at the extremes
     dumbbell      two or three values per row (top quarter, league, bottom quarter)
     waterfall     a start, its parts and the total they sum to
     tornado       a base value and each row's low and high
     meter         a win probability with its ± error
     reliability   predicted against observed by bin, the diagonal and baselines
     smallMultiples  several of the above in one grid

   bind(host, built | (o) => built, { onHover, onPick, onBrush, label }) -> { redraw, destroy }: one pointer layer,
   the nearest hit within 24 px, a textContent tooltip, tap to pin, roving focus with the arrow keys, Enter toggles the
   table twin, a ResizeObserver (> 2 px) and a data-theme MutationObserver redraw.

   Helpers: niceTicks (chartlab's algorithm), nearest, theme(el), tableTwin, png(svg, w, h) (the page offers it to
   members only), esc, fmt.

   Colour (kit/vizkit.css): series --vz-s1..3 are chartlab's validated slots; G/F/C = s1/s2/s3; good/bad = --good /
   --bad at an opacity, always with ▲▼ or ± beside them; sequential = s1 by opacity in five steps. Never the kit's neons
   as categories and never --lume for heat. All colour is by class, so a theme switch needs no redraw for colour.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaVizKit = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const NEAR = 24;
let seq = 0;
const SERIES = {
  dark: { s1: '#3987e5', s2: '#d95926', s3: '#199e70', ground: '#04100b' },
  light: { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', ground: '#f3faf6' }
};
const GROUP_CLASS = { G: 'vz-s1', F: 'vz-s2', C: 'vz-s3' };

/* ------------------------------------------------------------------ helpers --- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;
const n1 = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
function fmt(v, dp) {
  if (!isNum(v)) return '–';
  const d = dp == null ? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) : dp;
  const s = v.toFixed(d);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}
const signed = (v, dp) => (isNum(v) ? (v > 0 ? '+' : '') + fmt(v, dp) : '–');
const fx = (axis, v) => (axis && typeof axis.fmt === 'function' ? axis.fmt(v) : fmt(v, axis && axis.dp));

/* chartlab's tick algorithm (epinoia/chartlab.js niceTicks), byte for byte in behaviour */
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-12) || raw;
  const out = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step, k = 0; t <= hi + step * 1e-9 && k < 200; t += step, k++) out.push(+t.toFixed(10));
  return { ticks: out, step };
}
/* the nearest hit to (x, y) within max px (24), or null */
function nearest(hits, x, y, max) {
  const lim = max == null ? NEAR : max;
  let best = null, bd = Infinity;
  (hits || []).forEach(h => {
    if (!isNum(h.x) || !isNum(h.y)) return;
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bd) { bd = d; best = h; }
  });
  return best && bd <= lim ? best : null;
}
/* the range of a set of values, with room, always taking in `keep` (0 for a difference) */
function range(vals, keep, padFrac) {
  let lo = Infinity, hi = -Infinity;
  vals.forEach(v => { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
  if (isNum(keep)) { lo = Math.min(lo, keep); hi = Math.max(hi, keep); }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi === lo) { lo -= 1; hi += 1; }
  const p = (hi - lo) * (padFrac == null ? 0.06 : padFrac);
  return [lo - p, hi + p];
}
const scale = (d0, d1, r0, r1_) => v => r0 + (r1_ - r0) * ((v - d0) / ((d1 - d0) || 1));
/* the reader's theme and the series colours for it (used by png() and anything that needs a literal colour) */
function theme(el) {
  let dark = true;
  try {
    const R = (el && el.ownerDocument || root.document).documentElement;
    dark = R.getAttribute('data-theme') !== 'light';
    const cs = root.getComputedStyle ? root.getComputedStyle(el || R) : null;
    const v = n => (cs ? (cs.getPropertyValue(n) || '').trim() : '');
    const base = SERIES[dark ? 'dark' : 'light'];
    return { name: dark ? 'dark' : 'light', dark, s1: v('--vz-s1') || base.s1, s2: v('--vz-s2') || base.s2, s3: v('--vz-s3') || base.s3,
      ink: v('--ink') || (dark ? '#e6fff1' : '#0d1f17'), ground: v('--ground') || base.ground, good: v('--good') || (dark ? '#63ffa0' : '#0a6d43'),
      bad: v('--bad') || (dark ? '#ff5f6b' : '#b32433'), rule: v('--rule-2') || (dark ? 'rgba(147,242,191,.44)' : 'rgba(13,31,23,.4)') };
  } catch (_) {
    return Object.assign({ name: 'dark', dark: true, ink: '#e6fff1', good: '#63ffa0', bad: '#ff5f6b', rule: 'rgba(147,242,191,.44)' }, SERIES.dark);
  }
}

/* the frame every builder shares: role img, a title and a description, a class for the kind */
function frame(kind, o, W, H, body) {
  const title = o.title || kind, desc = o.desc || '';
  const id = 'vz' + (o.id || ++seq);
  return '<svg xmlns="http://www.w3.org/2000/svg" class="vz vz-' + kind + '" viewBox="0 0 ' + W + ' ' + Math.round(H) + '" width="' + W + '" height="' +
    Math.round(H) + '" role="img" aria-labelledby="' + id + 't ' + id + 'd" preserveAspectRatio="xMinYMin meet">' +
    '<title id="' + id + 't">' + esc(title) + '</title><desc id="' + id + 'd">' + esc(desc) + '</desc>' + body + '</svg>';
}
const txt = (x, y, s, cls, anchor, extra) => '<text x="' + r1(x) + '" y="' + r1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') +
  ' class="' + (cls || 'vz-lab') + '"' + (extra || '') + '>' + esc(s) + '</text>';
const line = (x1, y1, x2, y2, cls, extra) => '<line x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '" class="' + cls + '"' + (extra || '') + '/>';
const rect = (x, y, w, h, cls, extra) => '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(Math.max(0, w)) + '" height="' + r1(Math.max(0, h)) + '" class="' + cls + '"' + (extra || '') + '/>';
const circ = (x, y, r, cls, extra) => '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r + '" class="' + cls + '"' + (extra || '') + '/>';
const path = (d, cls) => '<path d="' + d + '" class="' + cls + '"/>';
const poly = pts => pts.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join('');
/* an x axis: ticks, grid and a label, between px a and b at the baseline y */
function xAxis(sx, lo, hi, a, b, yTop, yBase, ax, n) {
  const t = niceTicks(lo, hi, n || 5).ticks.filter(v => v >= lo - 1e-9 && v <= hi + 1e-9);
  let s = t.map(v => line(sx(v), yTop, sx(v), yBase, 'vz-grid') + txt(sx(v), yBase + 13, fx(ax, v), 'vz-tick', 'middle')).join('');
  if (ax && ax.label) {
    /* the pixel face runs about 7.6 px a character: centred on the plot, cut to stay inside the frame */
    const room = (b - a) + 2 * Math.min(a, 40), lab = String(tr(ax.label));
    if (lab.length * 7.6 <= room) s += txt((a + b) / 2, yBase + 28, lab, 'vz-axis', 'middle');
    else {                                                   // two lines, broken at the space nearest the middle
      const sp = [...lab.matchAll(/ /g)].map(m => m.index).sort((p, q) => Math.abs(p - lab.length / 2) - Math.abs(q - lab.length / 2))[0];
      const l1 = sp == null ? lab : lab.slice(0, sp), l2 = sp == null ? '' : lab.slice(sp + 1);
      s += txt((a + b) / 2, yBase + 25, fitPx(l1, room), 'vz-axis', 'middle') + (l2 ? txt((a + b) / 2, yBase + 36, fitPx(l2, room), 'vz-axis', 'middle') : '');
    }
  }
  return s;
}
function yAxis(sy, lo, hi, xLeft, xRight, ax, n) {
  const t = niceTicks(lo, hi, n || 4).ticks.filter(v => v >= lo - 1e-9 && v <= hi + 1e-9);
  let s = t.map(v => line(xLeft, sy(v), xRight, sy(v), 'vz-grid') + txt(xLeft - 6, sy(v) + 3.5, fx(ax, v), 'vz-tick', 'end')).join('');
  if (ax && ax.label) s += txt(xLeft, 11, ax.label, 'vz-axis', 'start');
  return s;
}
const narrow = W => W < 480;
/* the page's translator (EpinoiaI18n.t when a pack is loaded): run on a whole label BEFORE it is cut to fit or split
   onto two lines, so the words that reach the SVG are already the reader's language (a cut or split English string
   no longer matches its dictionary entry). Identity without i18n.js, and on an English page. */
const tr = s => {
  if (typeof s !== 'string' || !s) return s;
  try { const I = root.EpinoiaI18n; if (I && typeof I.t === 'function') { const t = I.t(s); return typeof t === 'string' && t ? t : s; } } catch (_) { /* untranslated */ }
  return s;
};
/* a wide (CJK, full-width) character takes about two of the face's columns: cut by columns, not characters */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const cut = (s, m) => { let w = 0, i = 0; const cols = [...s].map(c => (WIDE.test(c) ? 2 : 1)), tot = cols.reduce((a, b) => a + b, 0); if (tot <= m) return s;
  const ch = [...s]; for (; i < ch.length && w + cols[i] <= m - 1; i++) w += cols[i]; return ch.slice(0, i).join('') + '…'; };
const fitPx = (s, px) => cut(s, Math.max(6, Math.floor(px / 7.6)));
/* a label translated, then cut to fit about `px` of width at ~6.6 px a character (the full label stays in the
   tooltip and the table twin) */
const fit = (s, px) => cut(String(s == null ? '' : tr(s)), Math.max(4, Math.floor(px / 6.6)));
/* a label whose last ' · ' part tells two rows apart ('Free throws made per shot · offence' / '· defence'): when it is too
   long, the head is cut and the tail kept whole ('Free throws made p… · offence'), so the two never read the same (UI2-3) */
const colsOf = t => [...t].reduce((a, c) => a + (WIDE.test(c) ? 2 : 1), 0);
const fitTail = (s, px) => {
  const t = String(s == null ? '' : tr(s)), m = Math.max(4, Math.floor(px / 6.6)), at = t.lastIndexOf(' · ');
  if (at < 0 || colsOf(t) <= m) return cut(t, m);
  const tail = t.slice(at), room = m - colsOf(tail);
  return room >= 5 ? cut(t.slice(0, at), room) + tail : cut(t, m);
};
const glyph = (v, dir) => (!isNum(v) || v === 0 || !dir ? '' : (v * dir > 0 ? '▲' : '▼'));
const goodBad = (v, dir) => (!dir || !isNum(v) || v === 0 ? 'vz-neu' : (v * dir > 0 ? 'vz-good' : 'vz-bad'));
/* a bar's colour: better or worse (dir ±1); a style measure (dir 0, no better side) its own neutral hue, so it is never
   read as the grey of noise; muted (not distinguishable from noise) is grey whatever the measure */
const barClass = (v, dir, muted) => (muted ? 'vz-neu vz-muted' : !dir ? 'vz-style' : goodBad(v, dir));

/* ------------------------------------------------------------------ forest --- */
/* rows [{id, label, v, lo, hi, shrunk?, own?: {v, lo, hi}, muted?, badge?, cls?}] */
function forest(rows, o) {
  o = o || {}; rows = (rows || []).filter(r => r && isNum(r.v));
  const W = o.W || 760, nar = narrow(W), rowH = nar ? 40 : 30, top = 22, labW = nar ? 0 : Math.min(260, W * 0.34);
  const H = o.H || top + rows.length * rowH + 40 + (nar ? 10 : 0);
  const ax = o.x || {};
  const [lo, hi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi]
    : range(rows.flatMap(r => [r.v, r.lo, r.hi, r.own && r.own.lo, r.own && r.own.hi]), o.zero == null ? 0 : o.zero);
  const badgeW = nar ? 0 : Math.max(0, ...rows.map(r => (r.badge ? String(r.badge).length * 7.2 + 14 : 0)));
  const a = labW + 12, b = W - (nar ? 12 : Math.max(64, badgeW)), sx = scale(lo, hi, a, b);
  const zero = o.zero == null ? 0 : o.zero;
  let s = xAxis(sx, lo, hi, a, b, top - 6, H - 34 - (nar ? 10 : 0), ax, nar ? 4 : 6);
  if (zero >= lo && zero <= hi) s += line(sx(zero), top - 6, sx(zero), H - 34 - (nar ? 10 : 0), 'vz-zero');
  const hits = [], trows = [];
  rows.forEach((r, i) => {
    const y = top + i * rowH + (nar ? 26 : rowH / 2);
    const cls = (r.muted ? ' vz-muted' : '') + (r.cls ? ' ' + r.cls : '');
    if (nar) s += txt(a, y - 13, fit(r.label, W - 24) + (r.badge ? '  ·  ' + r.badge : ''), 'vz-lab' + cls);
    else {
      s += txt(labW, y + 4, fit(r.label, labW - 8), 'vz-lab' + cls, 'end');
      if (r.badge) s += txt(b + 8, y + 4, r.badge, 'vz-badge' + cls, 'start');
    }
    if (r.own && isNum(r.own.v)) {
      if (isNum(r.own.lo) && isNum(r.own.hi)) s += line(sx(clamp(r.own.lo, lo, hi)), y + 5, sx(clamp(r.own.hi, lo, hi)), y + 5, 'vz-whisk vz-ghost');
      s += circ(sx(clamp(r.own.v, lo, hi)), y + 5, 3.5, 'vz-dot vz-ghost');
    }
    if (isNum(r.lo) && isNum(r.hi)) {
      s += line(sx(clamp(r.lo, lo, hi)), y, sx(clamp(r.hi, lo, hi)), y, 'vz-whisk' + cls) +
        line(sx(clamp(r.lo, lo, hi)), y - 4, sx(clamp(r.lo, lo, hi)), y + 4, 'vz-whisk' + cls) +
        line(sx(clamp(r.hi, lo, hi)), y - 4, sx(clamp(r.hi, lo, hi)), y + 4, 'vz-whisk' + cls);
    }
    s += circ(sx(clamp(r.v, lo, hi)), y, 5.5, 'vz-dot' + (r.shrunk ? ' vz-hollow' : '') + cls, ' data-i="' + i + '"');
    const range95 = isNum(r.lo) && isNum(r.hi) ? fx(ax, r.lo) + ' to ' + fx(ax, r.hi) : '';
    hits.push({ id: r.id != null ? r.id : i, x: sx(clamp(r.v, lo, hi)), y, label: r.label, value: fx(ax, r.v) + (range95 ? ' (' + range95 + ')' : ''), detail: r.detail || '' });
    trows.push([r.label, fx(ax, r.v), isNum(r.lo) ? fx(ax, r.lo) : '–', isNum(r.hi) ? fx(ax, r.hi) : '–',
      r.own && isNum(r.own.v) ? fx(ax, r.own.v) : '–', r.badge || (r.shrunk ? 'shrunk' : '')]);
  });
  return { svg: frame('forest', o, W, H, s), table: { head: [o.rowHead || 'factor', ax.label || 'estimate', '95% low', '95% high', 'own', 'note'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ stackShare --- */
/* rows [{label, total?, rest?, parts: [{k, label, v (share, %), lo?, hi?, cls?}]}] ; each strip sums to its own total, or
   to `total` when given (shares of a whole the parts do not fill: the gap is drawn as a grey segment named `rest`) */
function stackShare(rows, o) {
  o = o || {}; rows = rows || [];
  const W = o.W || 760, nar = narrow(W), labW = nar ? 0 : Math.min(150, W * 0.22), barH = 26, gap = nar ? 30 : 14, top = 8;
  const keys = [];
  rows.forEach(r => (r.parts || []).forEach(p => { if (keys.indexOf(p.k) < 0) keys.push(p.k); }));
  const restRow = rows.find(r => isNum(r.total) && r.total > (r.parts || []).reduce((t, p) => t + (isNum(p.v) ? Math.max(0, p.v) : 0), 0) + 1e-9);
  if (restRow) keys.push('_rest');
  const a = labW + (nar ? 0 : 12), b = W - 4;
  const keyLab = k => { if (k === '_rest') return restRow.rest || 'not explained'; const p = rows.flatMap(r => r.parts || []).find(q => q.k === k) || {}; return p.label || k; };
  const keyLines = []; let kl = [], kw = 0;
  keys.forEach(k => { const w = 32 + keyLab(k).length * 6.6; if (kl.length && a + kw + w > W) { keyLines.push(kl); kl = []; kw = 0; } kl.push(k); kw += w; });
  if (kl.length) keyLines.push(kl);
  const H = o.H || top + rows.length * (barH + gap) + 10 + keyLines.length * 20;
  let s = '';
  const hits = [], trows = [];
  rows.forEach((r, i) => {
    const y = top + i * (barH + gap) + (nar ? 16 : 0);
    const sumP = (r.parts || []).reduce((t, p) => t + (isNum(p.v) ? Math.max(0, p.v) : 0), 0);
    const tot = isNum(r.total) && r.total >= sumP ? r.total : (sumP || 1);
    s += nar ? txt(a, y - 4, r.label, 'vz-lab') : txt(labW, y + barH / 2 + 4, fit(r.label, labW - 6), 'vz-lab', 'end');
    let x = a;
    (r.parts || []).forEach(p => {
      const w = (b - a) * (isNum(p.v) ? Math.max(0, p.v) : 0) / tot;
      const ci = keys.indexOf(p.k);
      s += rect(x, y, Math.max(0, w - 2), barH, 'vz-seg ' + (p.cls || 'vz-c' + (ci % 6)));
      if (w > 44) s += txt(x + 6, y + barH / 2 + 4, Math.round(100 * p.v / tot) + '%', 'vz-segv');
      hits.push({ id: r.label + ':' + p.k, x: x + w / 2, y: y + barH / 2, label: r.label + ' · ' + (p.label || p.k), value: fmt(100 * p.v / tot, 1) + '%' +
        (isNum(p.lo) && isNum(p.hi) ? ' (' + fmt(100 * p.lo / tot, 1) + '–' + fmt(100 * p.hi / tot, 1) + ')' : '') });
      trows.push([r.label, p.label || p.k, fmt(100 * p.v / tot, 1) + '%']);
      x += w;
    });
    if (tot - sumP > 1e-9 && isNum(r.total)) {
      const w = (b - a) * (tot - sumP) / tot, lab = r.rest || 'not explained';
      s += rect(x, y, Math.max(0, w - 2), barH, 'vz-seg vz-neuf vz-rest');
      if (w > 44) s += txt(x + 6, y + barH / 2 + 4, Math.round(100 * (tot - sumP) / tot) + '%', 'vz-segv');
      hits.push({ id: r.label + ':_rest', x: x + w / 2, y: y + barH / 2, label: r.label + ' · ' + lab, value: fmt(100 * (tot - sumP) / tot, 1) + '%' });
      trows.push([r.label, lab, fmt(100 * (tot - sumP) / tot, 1) + '%']);
    }
  });
  /* the key, wrapped onto as many lines as it needs (the unexplained rest last, in its own grey) */
  keyLines.forEach((line_, li) => {
    const ky = top + rows.length * (barH + gap) + 14 + li * 20;
    let kx = a;
    line_.forEach(k => {
      const i = keys.indexOf(k), p = rows.flatMap(r => r.parts || []).find(q => q.k === k) || {}, lab = keyLab(k);
      s += rect(kx, ky - 9, 10, 10, 'vz-seg ' + (k === '_rest' ? 'vz-neuf vz-rest' : p.cls || 'vz-c' + (i % 6))) + txt(kx + 14, ky, lab, 'vz-key');
      kx += 32 + lab.length * 6.6;
    });
  });
  return { svg: frame('stack', o, W, H, s), table: { head: ['', 'part', 'share'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ bars --- */
/* rows [{id, label, v, lo?, hi?, dir? (+1 good high, -1 good low, 0 style), muted?, badge?, cls?}] diverging around 0 */
function bars(rows, o) {
  o = o || {}; rows = (rows || []).filter(r => r && isNum(r.v));
  const W = o.W || 760, nar = narrow(W), rowH = nar ? 38 : 26, top = 20, labW = nar ? 0 : Math.min(240, W * 0.32);
  const H = o.H || top + rows.length * rowH + 34 + (nar ? 10 : 0);
  const ax = o.x || {};
  const [lo, hi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi] : range(rows.flatMap(r => [r.v, r.lo, r.hi]), 0, 0.08);
  const badgeW = nar ? 0 : Math.max(0, ...rows.map(r => (r.badge ? String(r.badge).length * 7.2 + 10 : 0)));
  /* the value labels to the right of the bars ('▲ 0.10'): on a phone the plot gives way to the longest one, so
     it is never clipped at the SVG's edge (the 11px data face is wide: about 9px a character) */
  const valW = Math.max(0, ...rows.map(r => { const g = glyph(r.v, r.dir == null ? (o.dir == null ? 1 : o.dir) : r.dir); return (g ? g.length + 1 : 0) + String(fx(ax, r.v)).length; })) * 9 + 10;
  const a = labW + 12, b = W - (nar ? Math.max(50, valW) : 70 + badgeW), sx = scale(lo, hi, a, b), x0 = sx(clamp(0, lo, hi));
  const yb = H - 30 - (nar ? 10 : 0);
  let s = xAxis(sx, lo, hi, a, b, top - 6, yb, ax, nar ? 4 : 6) + line(x0, top - 6, x0, yb, 'vz-zero');
  const hits = [], trows = [];
  rows.forEach((r, i) => {
    const y = top + i * rowH + (nar ? 22 : 4), bh = nar ? 12 : rowH - 10;
    const dir = r.dir == null ? (o.dir == null ? 1 : o.dir) : r.dir;
    const cls = r.cls ? r.cls + (r.muted ? ' vz-muted' : '') : barClass(r.v, dir, r.muted);
    const xv = sx(clamp(r.v, lo, hi));
    if (nar) s += txt(a, y - 5, fitTail(r.label, W - 40) + (r.badge ? ' · ' + r.badge : ''), 'vz-lab' + (r.muted ? ' vz-muted' : ''));
    else s += txt(labW, y + bh / 2 + 4, fitTail(r.label, labW - 8), 'vz-lab' + (r.muted ? ' vz-muted' : ''), 'end');
    s += rect(Math.min(x0, xv), y, Math.max(1, Math.abs(xv - x0)), bh, 'vz-bar ' + cls);
    if (isNum(r.lo) && isNum(r.hi)) s += line(sx(clamp(r.lo, lo, hi)), y + bh / 2, sx(clamp(r.hi, lo, hi)), y + bh / 2, 'vz-whisk');
    const g = glyph(r.v, dir);
    s += txt(b + 6, y + bh / 2 + 4, (g ? g + ' ' : '') + fx(ax, r.v), 'vz-val', 'start', ' translate="no"');
    if (!nar && r.badge) s += txt(b + 66, y + bh / 2 + 4, r.badge, 'vz-badge', 'start');
    hits.push({ id: r.id != null ? r.id : i, x: xv, y: y + bh / 2, label: r.label, value: (g ? g + ' ' : '') + fx(ax, r.v) +
      (isNum(r.lo) && isNum(r.hi) ? ' (' + fx(ax, r.lo) + ' to ' + fx(ax, r.hi) + ')' : ''), detail: r.detail || '' });
    trows.push([r.label, fx(ax, r.v), isNum(r.lo) ? fx(ax, r.lo) : '–', isNum(r.hi) ? fx(ax, r.hi) : '–', g || '', r.badge || '']);
  });
  return { svg: frame('bars', o, W, H, s), table: { head: [o.rowHead || 'measure', ax.label || 'value', '95% low', '95% high', '', 'note'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ binnedCurve --- */
/* d = {bins: [lo, hi, x, n, wins, p, plo, phi, margin][], raw: [x, p, lo, hi][], adj?: Curve, x50?: CI, x75?: CI} */
function binnedCurve(d, o) {
  o = o || {}; d = d || {};
  const W = o.W || 760, H = o.H || (narrow(W) ? 260 : 320), L = 44, R = 14, T = 18, B = 42;
  const bins = (d.bins || []).filter(b => b && isNum(b[2]) && isNum(b[5]));
  const raw = (d.raw || []).filter(p => p && isNum(p[0]) && isNum(p[1]));
  const ax = o.x || {};
  const [lo, hi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi] : range(bins.map(b => b[2]).concat(raw.map(p => p[0])), 0, 0.04);
  const sx = scale(lo, hi, L, W - R), sy = scale(0, 1, H - B, T);
  const yax = Object.assign({ fmt: v => Math.round(v * 100) + '%' }, o.y || {});
  let s = yAxis(sy, 0, 1, L, W - R, yax, 4) + xAxis(sx, lo, hi, L, W - R, T, H - B, ax, narrow(W) ? 4 : 6);
  s += line(L, sy(0.5), W - R, sy(0.5), 'vz-ref');
  if (lo <= 0 && hi >= 0) s += line(sx(0), T, sx(0), H - B, 'vz-zero');
  const band = c => {
    const up = c.filter(p => isNum(p[2]) && isNum(p[3]));
    if (up.length < 2) return '';
    return path(poly(up.map(p => [sx(p[0]), sy(clamp(p[3], 0, 1))])) + poly(up.slice().reverse().map(p => [sx(p[0]), sy(clamp(p[2], 0, 1))])).replace(/^M/, 'L') + 'Z', 'vz-band');
  };
  if (raw.length > 1) s += band(raw) + path(poly(raw.map(p => [sx(p[0]), sy(clamp(p[1], 0, 1))])), 'vz-curve vz-s1l');
  if (d.adj && d.adj.length > 1) s += path(poly(d.adj.filter(p => isNum(p[1])).map(p => [sx(p[0]), sy(clamp(p[1], 0, 1))])), 'vz-curve vz-s2l vz-dash');
  const hits = [], trows = [];
  bins.forEach((b, i) => {
    const x = sx(clamp(b[2], lo, hi)), y = sy(clamp(b[5], 0, 1));
    if (isNum(b[6]) && isNum(b[7])) s += line(x, sy(clamp(b[6], 0, 1)), x, sy(clamp(b[7], 0, 1)), 'vz-whisk');
    s += circ(x, y, 4.5, 'vz-dot vz-bin');
    hits.push({ id: 'bin' + i, x, y, label: fx(ax, b[0]) + ' to ' + fx(ax, b[1]), value: Math.round(b[5] * 100) + '% won (' + Math.round(b[6] * 100) + '–' +
      Math.round(b[7] * 100) + '%)', detail: b[3] + ' games' + (isNum(b[8]) ? ', mean margin ' + signed(b[8], 1) : '') });
    trows.push([fx(ax, b[0]) + ' to ' + fx(ax, b[1]), String(b[3]), Math.round(b[5] * 100) + '%', Math.round(b[6] * 100) + '%', Math.round(b[7] * 100) + '%', isNum(b[8]) ? signed(b[8], 1) : '–']);
  });
  [['x50', d.x50, '50%'], ['x75', d.x75, '75%']].forEach(([k, c, lab], li) => {
    if (!c || !isNum(c.v) || c.v < lo || c.v > hi) return;
    const x = sx(c.v);
    if (isNum(c.lo) && isNum(c.hi)) s += rect(sx(clamp(c.lo, lo, hi)), T, sx(clamp(c.hi, lo, hi)) - sx(clamp(c.lo, lo, hi)), H - B - T, 'vz-xband');
    const right = x > (L + W - R) / 2;
    s += line(x, T, x, H - B, 'vz-mark') + txt(x + (right ? -4 : 4), T + 12 + li * 15, lab + ' at ' + fx(ax, c.v), 'vz-key vz-mk', right ? 'end' : 'start');
    hits.push({ id: k, x, y: T + 6, label: 'wins ' + lab + ' of games at', value: fx(ax, c.v) + (isNum(c.lo) ? ' (' + fx(ax, c.lo) + ' to ' + fx(ax, c.hi) + ')' : '') });
    trows.push([k, '', fx(ax, c.v), isNum(c.lo) ? fx(ax, c.lo) : '–', isNum(c.hi) ? fx(ax, c.hi) : '–', '']);
  });
  /* d.mark = {x, p, lo?, hi?}: a reader's own point on the curve (What wins, "move the gap"), a line and a dot */
  const mk = d.mark;
  if (mk && isNum(mk.x) && isNum(mk.p) && mk.x >= lo && mk.x <= hi) {
    const x = sx(mk.x), y = sy(clamp(mk.p, 0, 1));
    if (isNum(mk.lo) && isNum(mk.hi)) s += line(x, sy(clamp(mk.lo, 0, 1)), x, sy(clamp(mk.hi, 0, 1)), 'vz-cursorw');
    s += line(x, T, x, H - B, 'vz-cursor') + circ(x, y, 6, 'vz-cursord');
    const right = x > (L + W - R) / 2;
    /* the label beside the line, clear of the break-even labels along the top: near the floor when the dot is high,
       under those labels when it is low (the curve is then low too) */
    s += txt(x + (right ? -8 : 8), mk.p > 0.5 ? H - B - 10 : T + 48, Math.round(mk.p * 100) + '% at ' + fx(ax, mk.x), 'vz-key vz-mk', right ? 'end' : 'start');
    hits.push({ id: 'mark', x, y, label: 'won at a gap of ' + fx(ax, mk.x), value: Math.round(mk.p * 100) + '%' + (isNum(mk.lo) ? ' (' + Math.round(mk.lo * 100) + '–' + Math.round(mk.hi * 100) + '%)' : '') });
  }
  return { svg: frame('curve', o, W, H, s), table: { head: [ax.label || 'gap', 'games', 'won', '95% low', '95% high', 'mean margin'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ histogram --- */
/* items [lo, hi, n] or [x, n]; o.mark = a value to draw a line at (0) */
function histogram(items, o) {
  o = o || {}; items = (items || []).filter(Boolean);
  const W = o.W || 760, H = o.H || (narrow(W) ? 170 : 200), L = 44, R = 12, T = 14, B = 40;
  const norm = items.map(it => (it.length >= 3 ? { lo: it[0], hi: it[1], n: it[2] } : { lo: it[0] - 0.5, hi: it[0] + 0.5, n: it[1] })).filter(b => isNum(b.lo) && isNum(b.n));
  const ax = o.x || {};
  const [lo, hi] = norm.length ? [Math.min(...norm.map(b => b.lo)), Math.max(...norm.map(b => b.hi))] : [0, 1];
  const top = Math.max(1, ...norm.map(b => b.n));
  const sx = scale(lo, hi, L, W - R), sy = scale(0, top, H - B, T);
  let s = yAxis(sy, 0, top, L, W - R, o.y || { dp: 0 }, 3) + xAxis(sx, lo, hi, L, W - R, T, H - B, ax, narrow(W) ? 4 : 6);
  const hits = [], trows = [];
  norm.forEach((b, i) => {
    const x = sx(b.lo), w = sx(b.hi) - sx(b.lo);
    const cls = o.split != null ? (b.hi <= o.split ? 'vz-bad' : b.lo >= o.split ? 'vz-good' : 'vz-neu') : 'vz-s1f';
    s += rect(x + 0.5, sy(b.n), Math.max(1, w - 1), H - B - sy(b.n), 'vz-hbar ' + cls);
    hits.push({ id: 'h' + i, x: x + w / 2, y: sy(b.n), label: fx(ax, b.lo) + ' to ' + fx(ax, b.hi), value: String(b.n) });
    trows.push([fx(ax, b.lo), fx(ax, b.hi), String(b.n)]);
  });
  if (isNum(o.mark) && o.mark >= lo && o.mark <= hi) s += line(sx(o.mark), T, sx(o.mark), H - B, 'vz-zero');
  return { svg: frame('hist', o, W, H, s), table: { head: ['from', 'to', o.countLabel || 'count'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ scatter --- */
/* pts [{id, x, y, label, cls?, r?}]; o.fit = {a, b} (y = a + b x) or Curve [[x, y, lo, hi]]; o.brush = true */
function scatter(pts, o) {
  o = o || {}; pts = (pts || []).filter(p => p && isNum(p.x) && isNum(p.y));
  const W = o.W || 760, H = o.H || (narrow(W) ? 280 : 340), L = 46, R = 14, T = 18, B = 42;
  const ax = o.x || {}, ay = o.y || {};
  const [xlo, xhi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi] : range(pts.map(p => p.x), ax.keep, 0.08);
  const [ylo, yhi] = isNum(ay.lo) && isNum(ay.hi) ? [ay.lo, ay.hi] : range(pts.map(p => p.y), ay.keep, 0.08);
  const sx = scale(xlo, xhi, L, W - R), sy = scale(ylo, yhi, H - B, T);
  let s = yAxis(sy, ylo, yhi, L, W - R, ay, 4) + xAxis(sx, xlo, xhi, L, W - R, T, H - B, ax, narrow(W) ? 4 : 6);
  if (o.fit && Array.isArray(o.fit) && o.fit.length > 1) {
    const c = o.fit.filter(p => isNum(p[0]) && isNum(p[1]));
    const up = c.filter(p => isNum(p[2]) && isNum(p[3]));
    if (up.length > 1) s += path(poly(up.map(p => [sx(p[0]), sy(clamp(p[3], ylo, yhi))])) + poly(up.slice().reverse().map(p => [sx(p[0]), sy(clamp(p[2], ylo, yhi))])).replace(/^M/, 'L') + 'Z', 'vz-band');
    s += path(poly(c.map(p => [sx(p[0]), sy(clamp(p[1], ylo, yhi))])), 'vz-curve vz-s1l');
  } else if (o.fit && isNum(o.fit.a) && isNum(o.fit.b)) {
    s += line(sx(xlo), sy(clamp(o.fit.a + o.fit.b * xlo, ylo, yhi)), sx(xhi), sy(clamp(o.fit.a + o.fit.b * xhi, ylo, yhi)), 'vz-curve vz-s1l vz-dash');
  }
  const hits = [], trows = [];
  pts.forEach((p, i) => {
    const x = sx(p.x), y = sy(p.y);
    s += circ(x, y, p.r || 4.5, 'vz-pt ' + (p.cls || 'vz-s1f'), ' data-id="' + esc(p.id != null ? p.id : i) + '"');
    if (p.tag) s += txt(x + 7, y + 3.5, p.tag, 'vz-tag');
    hits.push({ id: p.id != null ? p.id : i, x, y, label: p.label || '', value: fx(ax, p.x) + ', ' + fx(ay, p.y), detail: p.detail || '' });
    trows.push([p.label || String(i + 1), fx(ax, p.x), fx(ay, p.y)]);
  });
  const out = { svg: frame('scatter', o, W, H, s), table: { head: ['', ax.label || 'x', ay.label || 'y'], rows: trows }, hits };
  if (o.brush) out.brush = { sx, sy, inv: { x: v => xlo + (xhi - xlo) * (v - L) / ((W - R - L) || 1), y: v => ylo + (yhi - ylo) * (H - B - v) / ((H - B - T) || 1) } };
  return out;
}

/* ------------------------------------------------------------------ line --- */
/* series [{k, label, pts: [[x, y, lo?, hi?]], cls?, dash?}] */
function lineChart(series, o) {
  o = o || {}; series = (series || []).filter(sr => sr && sr.pts && sr.pts.length);
  const W = o.W || 760, H = o.H || (narrow(W) ? 240 : 300), L = 46, R = 14, T = 18, B = 42;
  const ax = o.x || {}, ay = o.y || {};
  const all = series.flatMap(sr => sr.pts);
  const [xlo, xhi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi] : range(all.map(p => p[0]), ax.keep, 0.02);
  const [ylo, yhi] = isNum(ay.lo) && isNum(ay.hi) ? [ay.lo, ay.hi] : range(all.flatMap(p => [p[1], p[2], p[3]]), ay.keep, 0.06);
  const sx = scale(xlo, xhi, L, W - R), sy = scale(ylo, yhi, H - B, T);
  let s = yAxis(sy, ylo, yhi, L, W - R, ay, 4) + xAxis(sx, xlo, xhi, L, W - R, T, H - B, ax, narrow(W) ? 4 : 6);
  if (isNum(o.ref) && o.ref >= ylo && o.ref <= yhi) s += line(L, sy(o.ref), W - R, sy(o.ref), 'vz-ref');
  const hits = [], trows = [];
  series.forEach((sr, si) => {
    const cls = sr.cls || ['vz-s1l', 'vz-s2l', 'vz-s3l'][si % 3];
    const pts = sr.pts.filter(p => isNum(p[0]) && isNum(p[1]));
    const up = pts.filter(p => isNum(p[2]) && isNum(p[3]));
    if (up.length > 1) s += path(poly(up.map(p => [sx(p[0]), sy(clamp(p[3], ylo, yhi))])) + poly(up.slice().reverse().map(p => [sx(p[0]), sy(clamp(p[2], ylo, yhi))])).replace(/^M/, 'L') + 'Z', 'vz-band ' + cls.replace('l', 'b'));
    s += path(poly(pts.map(p => [sx(p[0]), sy(clamp(p[1], ylo, yhi))])), 'vz-curve ' + cls + (sr.dash ? ' vz-dash' : ''));
    pts.forEach((p, i) => {
      hits.push({ id: (sr.k || si) + ':' + i, x: sx(p[0]), y: sy(clamp(p[1], ylo, yhi)), label: (sr.label || '') + ' at ' + fx(ax, p[0]),
        value: fx(ay, p[1]) + (isNum(p[2]) && isNum(p[3]) ? ' (' + fx(ay, p[2]) + ' to ' + fx(ay, p[3]) + ')' : '') });
      trows.push([sr.label || '', fx(ax, p[0]), fx(ay, p[1]), isNum(p[2]) ? fx(ay, p[2]) : '–', isNum(p[3]) ? fx(ay, p[3]) : '–']);
    });
    if (sr.label && pts.length) { const last = pts[pts.length - 1]; s += txt(Math.min(sx(last[0]), W - R) - 2, sy(clamp(last[1], ylo, yhi)) - 6, sr.label, 'vz-key', 'end'); }
  });
  return { svg: frame('line', o, W, H, s), table: { head: ['series', ax.label || 'x', ay.label || 'y', '95% low', '95% high'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ heatmap --- */
/* d = {rows: [labels], cols: [labels], cells: [[{v, lo?, hi?, hatch?, label?} | number | null]], mode: 'div'|'seq', dir?: [per column]} */
function heatmap(d, o) {
  o = o || {}; d = d || {};
  const W = o.W || 760;
  let rowsL = d.rows || [], colsL = d.cols || [], cells = (d.cells || []).map(r => (r || []).map(c => (c == null ? null : typeof c === 'number' ? { v: c } : c)));
  const transpose = o.transpose != null ? o.transpose : (narrow(W) && colsL.length > rowsL.length);
  if (transpose) {
    const t = colsL.map((_, j) => rowsL.map((__, i) => (cells[i] || [])[j] || null));
    [rowsL, colsL, cells] = [colsL, rowsL, t];
  }
  /* 'div': better / worse around 0 (good / bad); 'rel': more / less than a reference with no better side (s1 / s2, never
     good / bad); 'seq': one hue by opacity */
  const mode = d.mode === 'seq' ? 'seq' : d.mode === 'rel' ? 'rel' : 'div';
  const labW = Math.min(narrow(W) ? 110 : 190, W * 0.3), T = colsL.some(c => String(c).length > 6) ? 92 : 56, ch = narrow(W) ? 30 : 28;
  /* the column labels are rotated -35° from each cell's centre and may run 130 px: the last one's horizontal reach
     (cos 35° × its width) is kept inside the frame, the label cut to what is left when the columns cannot give way */
  const COS = Math.cos(35 * Math.PI / 180), colLab = c => fit(c, 130), reach = c => COS * String(colLab(c)).length * 6.6;
  const lastReach = colsL.length ? reach(colsL[colsL.length - 1]) : 0;
  let cw = Math.max(18, (W - labW - 8) / Math.max(1, colsL.length));
  if (colsL.length && labW + (colsL.length - 0.5) * cw + lastReach > W - 4) cw = Math.max(18, (W - 4 - labW - lastReach) / Math.max(1, colsL.length - 0.5));
  const room = j => (W - 4 - (labW + j * cw + cw / 2)) / COS;
  const H = o.H || T + rowsL.length * ch + 10;
  const vals = cells.flat().filter(c => c && isNum(c.v)).map(c => c.v);
  const mx = Math.max(1e-9, ...vals.map(Math.abs)), mn = vals.length ? Math.min(...vals) : 0, mxv = vals.length ? Math.max(...vals) : 1;
  let s = '<defs><pattern id="vzHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="vz-hatchl"/></pattern></defs>';
  colsL.forEach((c, j) => { s += txt(labW + j * cw + cw / 2, T - 8, fit(c, Math.max(30, Math.min(130, room(j)))), 'vz-tick', 'start', ' transform="rotate(-35 ' + r1(labW + j * cw + cw / 2) + ' ' + (T - 8) + ')"'); });
  const hits = [], trows = [];
  rowsL.forEach((r, i) => {
    const y = T + i * ch;
    s += txt(labW - 6, y + ch / 2 + 4, fit(r, labW - 8), 'vz-lab', 'end');
    const trow = [r];
    colsL.forEach((c, j) => {
      const cell = (cells[i] || [])[j], x = labW + j * cw;
      if (!cell || !isNum(cell.v)) { s += rect(x + 1, y + 1, cw - 2, ch - 2, 'vz-cell vz-nil'); trow.push('–'); return; }
      let cls, op;
      if (mode === 'seq') { const step = Math.min(4, Math.floor(5 * (cell.v - mn) / ((mxv - mn) || 1))); cls = 'vz-seq'; op = 0.18 + step * 0.18; }
      else if (mode === 'rel') { cls = cell.v >= 0 ? 'vz-s1f' : 'vz-s2f'; op = 0.12 + 0.78 * Math.abs(cell.v) / mx; }
      else { cls = cell.v >= 0 ? 'vz-good' : 'vz-bad'; op = 0.12 + 0.78 * Math.abs(cell.v) / mx; }
      s += rect(x + 1, y + 1, cw - 2, ch - 2, 'vz-cell ' + cls, ' fill-opacity="' + op.toFixed(2) + '"');
      if (cell.hatch) s += rect(x + 1, y + 1, cw - 2, ch - 2, 'vz-hatch', ' fill="url(#vzHatch)"');
      const extreme = (mode === 'div' || mode === 'rel') && Math.abs(cell.v) >= 0.8 * mx - 1e-9 ? (cell.v > 0 ? '▲' : '▼') : '';
      const lab = cell.label != null ? cell.label : (cw >= 38 ? fmt(cell.v, o.dp) : '');
      if (lab || extreme) s += txt(x + cw / 2, y + ch / 2 + 4, (extreme ? extreme + (lab ? ' ' : '') : '') + lab, 'vz-cellv', 'middle', ' translate="no"');
      hits.push({ id: i + ':' + j, x: x + cw / 2, y: y + ch / 2, label: r + ' · ' + c, value: (extreme ? extreme + ' ' : '') + fmt(cell.v, o.dp) +
        (isNum(cell.lo) && isNum(cell.hi) ? ' (' + fmt(cell.lo, o.dp) + ' to ' + fmt(cell.hi, o.dp) + ')' : ''), detail: cell.detail || '' });
      trow.push((extreme ? extreme + ' ' : '') + fmt(cell.v, o.dp));
    });
    trows.push(trow);
  });
  return { svg: frame('heat', o, W, H, s), table: { head: [''].concat(colsL), rows: trows }, hits, transposed: !!transpose };
}

/* ------------------------------------------------------------------ dumbbell --- */
/* rows [{id, label, pts: [{k, label, v, lo?, hi?, cls?}]}] ; the first point is the one that matters (top quarter) */
function dumbbell(rows, o) {
  o = o || {}; rows = (rows || []).filter(r => r && r.pts && r.pts.some(p => isNum(p.v)));
  const W = o.W || 760, nar = narrow(W), rowH = nar ? 40 : 28, top = 26, labW = nar ? 0 : Math.min(220, W * 0.3);
  const H = o.H || top + rows.length * rowH + 34;
  const ax = o.x || {};
  const [lo, hi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi] : range(rows.flatMap(r => r.pts.flatMap(p => [p.v, p.lo, p.hi])), ax.keep, 0.08);
  const a = labW + 14, b = W - 14, sx = scale(lo, hi, a, b);
  let s = xAxis(sx, lo, hi, a, b, top - 4, H - 30, ax, nar ? 4 : 6);
  const keys = [];
  const hits = [], trows = [];
  rows.forEach((r, i) => {
    const y = top + i * rowH + (nar ? 26 : rowH / 2);
    s += nar ? txt(a, y - 12, fit(r.label, W - 28), 'vz-lab') : txt(labW, y + 4, fit(r.label, labW - 6), 'vz-lab', 'end');
    const ps = r.pts.filter(p => isNum(p.v));
    const xs = ps.map(p => sx(clamp(p.v, lo, hi)));
    s += line(Math.min(...xs), y, Math.max(...xs), y, 'vz-dl');
    const trow = [r.label];
    r.pts.forEach((p, k) => {
      if (keys.indexOf(p.k) < 0) keys.push(p.k);
      if (!isNum(p.v)) { trow.push('–'); return; }
      const cls = p.cls || ['vz-s1f', 'vz-neuf', 'vz-s2f'][keys.indexOf(p.k) % 3];
      if (isNum(p.lo) && isNum(p.hi)) s += line(sx(clamp(p.lo, lo, hi)), y, sx(clamp(p.hi, lo, hi)), y, 'vz-whisk');
      s += circ(sx(clamp(p.v, lo, hi)), y, k ? 4.5 : 6, 'vz-pt ' + cls + (p.hollow ? ' vz-ptho' : ''));
      hits.push({ id: (r.id || i) + ':' + p.k, x: sx(clamp(p.v, lo, hi)), y, label: r.label + ' · ' + (p.label || p.k), value: fx(ax, p.v) +
        (isNum(p.lo) && isNum(p.hi) ? ' (' + fx(ax, p.lo) + ' to ' + fx(ax, p.hi) + ')' : '') });
      trow.push(fx(ax, p.v));
    });
    trows.push(trow);
  });
  /* key */
  let kx = a;
  keys.forEach((k, i) => {
    const p = rows.flatMap(r => r.pts).find(q => q.k === k) || {};
    const lab = p.label || k;
    s += circ(kx + 5, 10, 5, 'vz-pt ' + (p.cls || ['vz-s1f', 'vz-neuf', 'vz-s2f'][i % 3]) + (p.hollow ? ' vz-ptho' : '')) + txt(kx + 14, 14, lab, 'vz-key');
    kx += 24 + lab.length * 6.6;
  });
  const head = ['row'].concat(keys.map(k => { const p = rows.flatMap(r => r.pts).find(q => q.k === k) || {}; return p.label || k; }));
  return { svg: frame('dumbbell', o, W, H, s), table: { head, rows: trows }, hits };
}

/* ------------------------------------------------------------------ waterfall --- */
/* d = {start: {label, v}, parts: [{k, label, v, lo?, hi?}], total?: {label}} ; the total is start + Σ parts */
function waterfall(d, o) {
  o = o || {}; d = d || {};
  const parts = (d.parts || []).filter(p => p && isNum(p.v));
  const start = d.start && isNum(d.start.v) ? d.start : { label: 'expected', v: 0 };
  const total = start.v + parts.reduce((t, p) => t + p.v, 0);
  const steps = [{ k: '_start', label: start.label, from: 0, to: start.v, kind: 'end' }];
  let run = start.v;
  parts.forEach(p => { steps.push({ k: p.k, label: p.label || p.k, from: run, to: run + p.v, v: p.v, lo: p.lo, hi: p.hi, kind: 'part' }); run += p.v; });
  steps.push({ k: '_total', label: (d.total && d.total.label) || 'result', from: 0, to: total, kind: 'end' });
  const W = o.W || 760, nar = narrow(W), L = 44, R = 10, T = 16;
  const cw0 = (W - L - R) / steps.length, rot = nar || steps.some(st => String(st.label).length * 6.6 > cw0 - 4);
  const B = rot ? 78 : 46, H = o.H || (rot ? 300 : 280);
  const ax = o.y || {};
  const [lo, hi] = range(steps.flatMap(s2 => [s2.from, s2.to]), 0, 0.1);
  const sy = scale(lo, hi, H - B, T), cw = (W - L - R) / steps.length;
  let s = yAxis(sy, lo, hi, L, W - R, ax, 4) + line(L, sy(0), W - R, sy(0), 'vz-zero');
  const hits = [], trows = [];
  steps.forEach((st, i) => {
    const x = L + i * cw + cw * 0.15, w = cw * 0.7;
    const y0 = sy(Math.max(st.from, st.to)), y1 = sy(Math.min(st.from, st.to));
    const cls = st.kind === 'end' ? 'vz-s1f' : (st.v >= 0 ? 'vz-good' : 'vz-bad');
    s += rect(x, y0, w, Math.max(1, y1 - y0), 'vz-bar ' + cls);
    if (st.kind === 'part' && isNum(st.lo) && isNum(st.hi)) {
      const base = st.from;
      s += line(x + w / 2, sy(base + st.lo), x + w / 2, sy(base + st.hi), 'vz-whisk');
    }
    if (i < steps.length - 1) s += line(x + w, sy(st.to), x + cw, sy(st.to), 'vz-conn');
    const val = st.kind === 'end' ? fmt(st.to, 1) : (st.v >= 0 ? '▲ +' : '▼ ') + fmt(st.v, 1);
    s += txt(x + w / 2, y0 - 4, val, 'vz-val', 'middle', ' translate="no"');
    const lab = fit(st.label, rot ? 120 : cw + 6);
    s += rot ? txt(x + w / 2, H - B + 12, lab, 'vz-tick', 'end', ' transform="rotate(-40 ' + r1(x + w / 2) + ' ' + (H - B + 12) + ')"')
             : txt(x + w / 2, H - B + 14, lab, 'vz-tick', 'middle');
    hits.push({ id: st.k, x: x + w / 2, y: y0, label: st.label, value: st.kind === 'end' ? fmt(st.to, 1) : signed(st.v, 1) +
      (isNum(st.lo) && isNum(st.hi) ? ' (' + signed(st.lo, 1) + ' to ' + signed(st.hi, 1) + ')' : '') });
    trows.push([st.label, st.kind === 'end' ? fmt(st.to, 1) : signed(st.v, 1), isNum(st.lo) ? signed(st.lo, 1) : '–', isNum(st.hi) ? signed(st.hi, 1) : '–']);
  });
  return { svg: frame('waterfall', o, W, H, s), table: { head: ['part', ax.label || 'points', '95% low', '95% high'], rows: trows }, hits, total };
}

/* ------------------------------------------------------------------ tornado --- */
/* d = {base, rows: [{id, label, lo, hi, loLabel?, hiLabel?}]} ; bars from base to lo and to hi, widest first */
function tornado(d, o) {
  o = o || {}; d = d || {};
  const base = isNum(d.base) ? d.base : 0.5;
  const rows = (d.rows || []).filter(r => r && (isNum(r.lo) || isNum(r.hi)))
    .sort((a, b) => Math.abs((b.hi || base) - (b.lo || base)) - Math.abs((a.hi || base) - (a.lo || base)));
  const W = o.W || 760, nar = narrow(W), rowH = nar ? 40 : 28, top = 18, labW = nar ? 0 : Math.min(200, W * 0.28);
  const H = o.H || top + rows.length * rowH + 34;
  const ax = o.x || { fmt: v => Math.round(v * 100) + '%' };
  const [lo, hi] = isNum(ax.lo) && isNum(ax.hi) ? [ax.lo, ax.hi] : range(rows.flatMap(r => [r.lo, r.hi]), base, 0.1);
  const a = labW + 12, b = W - 12, sx = scale(lo, hi, a, b), xb = sx(base);
  let s = xAxis(sx, lo, hi, a, b, top - 4, H - 30, ax, nar ? 4 : 6) + line(xb, top - 4, xb, H - 30, 'vz-zero');
  const hits = [], trows = [];
  rows.forEach((r, i) => {
    const y = top + i * rowH + (nar ? 22 : 4), bh = nar ? 12 : rowH - 10;
    s += nar ? txt(a, y - 5, fit(r.label, W - 24), 'vz-lab') : txt(labW, y + bh / 2 + 4, fit(r.label, labW - 6), 'vz-lab', 'end');
    [['lo', r.lo, 'vz-bad'], ['hi', r.hi, 'vz-good']].forEach(([k, v, cls]) => {
      if (!isNum(v)) return;
      const xv = sx(clamp(v, lo, hi));
      s += rect(Math.min(xb, xv), y, Math.max(1, Math.abs(xv - xb)), bh, 'vz-bar ' + (v >= base ? 'vz-good' : 'vz-bad'));
      hits.push({ id: (r.id || i) + ':' + k, x: xv, y: y + bh / 2, label: r.label + (r[k + 'Label'] ? ' · ' + r[k + 'Label'] : ''), value: fx(ax, v) });
    });
    trows.push([r.label, r.loLabel || '', isNum(r.lo) ? fx(ax, r.lo) : '–', r.hiLabel || '', isNum(r.hi) ? fx(ax, r.hi) : '–']);
  });
  return { svg: frame('tornado', o, W, H, s), table: { head: ['rate', 'low end', 'chance', 'high end', 'chance'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ meter --- */
/* d = {p (0..1), se?, label, a?: name, b?: name} */
function meter(d, o) {
  o = o || {}; d = d || {};
  const W = o.W || 760, H = o.H || 92, L = 12, R = 12, y = 40, h = 22;
  const p = clamp(isNum(d.p) ? d.p : 0.5, 0, 1), se = isNum(d.se) ? d.se : 0;
  const sx = scale(0, 1, L, W - R);
  let s = rect(L, y, sx(p) - L, h, 'vz-bar vz-s1f') + rect(sx(p), y, W - R - sx(p), h, 'vz-bar vz-s2f');
  if (se > 0) s += line(sx(clamp(p - 1.96 * se, 0, 1)), y + h / 2, sx(clamp(p + 1.96 * se, 0, 1)), y + h / 2, 'vz-whisk vz-onbar');
  s += line(sx(0.5), y - 6, sx(0.5), y + h + 6, 'vz-zero');
  /* the two sides' names and chances: on one line in the big face when both fit with a gap (about 13 px a character
     at 22 px), else the chances big above the bar and the names, shortened to their half, in the small face beside
     them, so the two never run into each other */
  const la = (d.a || 'A') + ' ' + Math.round(p * 100) + '%', lb = Math.round((1 - p) * 100) + '% ' + (d.b || 'B');
  if ((la.length + lb.length) * 13 + 24 <= W - L - R) {
    s += txt(L, y - 10, la, 'vz-big', 'start', ' translate="no"');
    s += txt(W - R, y - 10, lb, 'vz-big', 'end', ' translate="no"');
  } else {
    const half = (W - L - R) / 2 - 8;
    s += txt(L, y - 10, Math.round(p * 100) + '%', 'vz-big', 'start', ' translate="no"') + txt(L + 13 * String(Math.round(p * 100) + '%').length + 6, y - 10, fit(d.a || 'A', half - 60), 'vz-lab', 'start', ' translate="no"');
    s += txt(W - R, y - 10, Math.round((1 - p) * 100) + '%', 'vz-big', 'end', ' translate="no"') + txt(W - R - 13 * String(Math.round((1 - p) * 100) + '%').length - 6, y - 10, fit(d.b || 'B', half - 60), 'vz-lab', 'end', ' translate="no"');
  }
  if (se > 0) s += txt(W / 2, y + h + 18, '± ' + fmt(196 * se, 1) + ' points of chance (95%)', 'vz-key', 'middle');
  const hits = [{ id: 'p', x: sx(p), y: y + h / 2, label: d.label || 'chance of winning', value: Math.round(p * 100) + '%' + (se > 0 ? ' ± ' + fmt(196 * se, 1) : '') }];
  return { svg: frame('meter', o, W, H, s), table: { head: ['side', 'chance of winning'], rows: [[d.a || 'A', fmt(100 * p, 1) + '%'], [d.b || 'B', fmt(100 * (1 - p), 1) + '%']] }, hits };
}

/* ------------------------------------------------------------------ reliability --- */
/* d = {series: [{k, label, bins: [[pMean, yMean, n]], cls?}]} */
function reliability(d, o) {
  o = o || {}; d = d || {};
  const W = o.W || 760, size = Math.min(W, o.H || 360), L = 46, R = 14;
  /* the key: a swatch (solid for the first series, dashed after) and its label, wrapped onto as many lines as needed */
  const series = d.series || [], keyLines = [];
  { let kl = [], kw = 0; series.forEach((sr, si) => { const w = 40 + String(tr(sr.label || '')).length * 6.6; if (kl.length && L + kw + w > W - R) { keyLines.push(kl); kl = []; kw = 0; } kl.push(si); kw += w; }); if (kl.length) keyLines.push(kl); }
  const T = 18 + (series.length > 1 ? keyLines.length * 18 : 0), B = 42, H = o.H || Math.min(380, Math.max(240, W * 0.55)) + T - 18;
  const sx = scale(0, 1, L, W - R), sy = scale(0, 1, H - B, T);
  const pc = { fmt: v => Math.round(v * 100) + '%' };
  let s = yAxis(sy, 0, 1, L, W - R, Object.assign({ label: 'won' }, pc), 4) + xAxis(sx, 0, 1, L, W - R, T, H - B, Object.assign({ label: 'forecast' }, pc), 5);
  s += line(sx(0), sy(0), sx(1), sy(1), 'vz-ref');
  if (series.length > 1) keyLines.forEach((kl, li) => {
    let kx = L;
    kl.forEach(si => {
      const sr = series[si], cls = sr.cls || ['vz-s1', 'vz-s2', 'vz-s3', 'vz-neu'][si % 4], lab = String(tr(sr.label || ''));
      s += line(kx, 12 + li * 18, kx + 22, 12 + li * 18, 'vz-curve ' + cls + 'l' + (si ? ' vz-dash' : '')) + circ(kx + 11, 12 + li * 18, si ? 3 : 4.5, 'vz-pt ' + cls + 'f') + txt(kx + 28, 16 + li * 18, lab, 'vz-key');
      kx += 40 + lab.length * 6.6;
    });
  });
  const hits = [], trows = [];
  series.forEach((sr, si) => {
    const cls = sr.cls || ['vz-s1', 'vz-s2', 'vz-s3', 'vz-neu'][si % 4];
    const bins = (sr.bins || []).filter(b => isNum(b[0]) && isNum(b[1]));
    if (bins.length > 1) s += path(poly(bins.map(b => [sx(b[0]), sy(b[1])])), 'vz-curve ' + cls + 'l' + (si ? ' vz-dash' : ''));
    bins.forEach((b, i) => {
      s += circ(sx(b[0]), sy(b[1]), si ? 3 : 4.5, 'vz-pt ' + cls + 'f');
      hits.push({ id: (sr.k || si) + ':' + i, x: sx(b[0]), y: sy(b[1]), label: (sr.label || '') + ', forecast ' + Math.round(b[0] * 100) + '%', value: 'won ' + Math.round(b[1] * 100) + '% of ' + (b[2] || '?') });
      trows.push([sr.label || '', fmt(100 * b[0], 1) + '%', fmt(100 * b[1], 1) + '%', String(b[2] == null ? '' : b[2])]);
    });
  });
  void size;
  return { svg: frame('reliability', o, W, H, s), table: { head: ['model', 'forecast', 'won', 'games'], rows: trows }, hits };
}

/* ------------------------------------------------------------------ smallMultiples --- */
/* panels [{title, kind, data, o}] laid out in a grid of o.cols (2; 1 on a phone) */
function smallMultiples(panels, o) {
  o = o || {}; panels = (panels || []).filter(p => p && API[p.kind]);
  const W = o.W || 760, cols = o.cols || (narrow(W) ? 1 : 2), gap = 14, pw = Math.floor((W - gap * (cols - 1)) / cols), ph = o.panelH || 200;
  const rowsN = Math.ceil(panels.length / cols), H = rowsN * (ph + 22 + gap);
  let s = '';
  const hits = [], trows = [];
  panels.forEach((p, i) => {
    const cx = (i % cols) * (pw + gap), cy = Math.floor(i / cols) * (ph + 22 + gap);
    const b = API[p.kind](p.data, Object.assign({}, p.o || {}, { W: pw, H: ph, title: p.title, id: (o.id || 'sm') + i }));
    s += txt(cx + 4, cy + 14, p.title || '', 'vz-ptitle') + b.svg.replace(/^<svg[^>]*?>/, '<svg x="' + cx + '" y="' + (cy + 20) + '" width="' + pw + '" height="' + ph + '" viewBox="0 0 ' + pw + ' ' + ph + '" class="vz-sub">');
    b.hits.forEach(h => hits.push(Object.assign({}, h, { id: i + ':' + h.id, x: h.x + cx, y: h.y + cy + 20, label: (p.title ? p.title + ' · ' : '') + h.label })));
    b.table.rows.forEach(r => trows.push([p.title || ''].concat(r)));
  });
  return { svg: frame('multiples', o, W, H, s), table: { head: ['panel'].concat(panels.length ? API[panels[0].kind](panels[0].data, Object.assign({}, panels[0].o || {}, { W: pw })).table.head : []), rows: trows }, hits };
}

/* ------------------------------------------------------------------ the table twin --- */
function tableTwin(built, o) {
  o = o || {};
  const t = (built && built.table) || { head: [], rows: [] };
  return '<table class="vz-tt">' + (o.caption ? '<caption>' + esc(o.caption) + '</caption>' : '') +
    '<thead><tr>' + t.head.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    t.rows.map(r => '<tr>' + r.map((c, i) => (i ? '<td translate="no">' : '<th scope="row">') + esc(c) + (i ? '</td>' : '</th>')).join('') + '</tr>').join('') +
    '</tbody></table>';
}

/* ------------------------------------------------------------------ png (members) --- */
/* the SVG with the reader's colours written in, rasterised: a Promise of a PNG Blob */
function png(svg, w, h) {
  return new Promise((resolve, reject) => {
    try {
      const doc = root.document, th = theme(doc && doc.body);
      const css = '.vz{font-family:Archivo,system-ui,sans-serif}text{fill:' + th.ink + ';font-size:12px}.vz-grid{stroke:' + th.rule + '}' +
        '.vz-s1f,.vz-s1,.vz-dot,.vz-seq{fill:' + th.s1 + '}.vz-s2f{fill:' + th.s2 + '}.vz-s3f{fill:' + th.s3 + '}.vz-good{fill:' + th.good + '}.vz-bad{fill:' + th.bad + '}' +
        '.vz-curve,.vz-whisk,.vz-zero{fill:none;stroke:' + th.ink + '}.vz-s1l{stroke:' + th.s1 + '}.vz-s2l{stroke:' + th.s2 + '}';
      const src = svg.replace(/^<svg([^>]*)>/, '<svg$1><style>' + css + '</style><rect width="100%" height="100%" fill="' + th.ground + '"/>');
      const img = new root.Image();
      img.onload = () => {
        const c = doc.createElement('canvas'); c.width = w * 2; c.height = h * 2;
        const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0, w, h);
        c.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
      };
      img.onerror = () => reject(new Error('png'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    } catch (e) { reject(e); }
  });
}

/* ------------------------------------------------------------------ bind --- */
/* host: an element; make: built or (o) => built (called with {W}); opts: {onHover(hit), onPick(hit), onBrush(ids), label, caption} */
function bind(host, make, opts) {
  opts = opts || {};
  const doc = host.ownerDocument;
  let built = null, pinned = null, focusI = -1, lastW = 0, destroyed = false, brush = null;
  host.classList.add('vz-host');
  host.textContent = '';
  const plot = doc.createElement('div'); plot.className = 'vz-plot';
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  plot.setAttribute('aria-roledescription', 'chart');
  if (opts.label) plot.setAttribute('aria-label', opts.label + '. Arrow keys move between marks; Enter shows the table.');
  const tip = doc.createElement('div'); tip.className = 'vz-tip'; tip.hidden = true; tip.setAttribute('role', 'status'); tip.setAttribute('aria-live', 'polite');
  const ring = doc.createElement('div'); ring.className = 'vz-ring'; ring.hidden = true; ring.setAttribute('aria-hidden', 'true');
  const tbtn = doc.createElement('button'); tbtn.type = 'button'; tbtn.className = 'vz-tbtn'; tbtn.textContent = 'show table'; tbtn.setAttribute('aria-expanded', 'false');
  const twin = doc.createElement('div'); twin.className = 'vz-twin'; twin.hidden = true;
  host.append(plot, tip, ring, tbtn, twin);
  const width = () => Math.max(260, Math.round(host.clientWidth || (host.getBoundingClientRect && host.getBoundingClientRect().width) || 760));
  const svgEl = () => plot.querySelector('svg');
  const toSvg = (cx, cy) => {
    const sv = svgEl(); if (!sv) return null;
    const r = sv.getBoundingClientRect(), vb = sv.viewBox && sv.viewBox.baseVal;
    const k = vb && r.width ? vb.width / r.width : 1;
    return { x: (cx - r.left) * k, y: (cy - r.top) * k, k };
  };
  const place = hit => {
    const sv = svgEl(); if (!sv || !hit) return;
    const r = sv.getBoundingClientRect(), hr = host.getBoundingClientRect(), vb = sv.viewBox.baseVal;
    const k = vb.width ? r.width / vb.width : 1;
    const x = r.left - hr.left + hit.x * k, y = r.top - hr.top + hit.y * k;
    ring.hidden = false; ring.style.left = (x - 9) + 'px'; ring.style.top = (y - 9) + 'px';
    tip.hidden = false;
    tip.textContent = '';
    const b = doc.createElement('b'); b.textContent = hit.label || '';
    const v = doc.createElement('span'); v.className = 'vz-tipv'; v.setAttribute('translate', 'no'); v.textContent = hit.value || '';
    tip.append(b, v);
    if (hit.detail) { const d = doc.createElement('span'); d.className = 'vz-tipd'; d.textContent = hit.detail; tip.appendChild(d); }
    const tw = tip.offsetWidth || 180, hw = host.clientWidth || 760;
    tip.style.left = clamp(x - tw / 2, 0, Math.max(0, hw - tw)) + 'px';
    tip.style.top = Math.max(0, y - (tip.offsetHeight || 40) - 14) + 'px';
  };
  const hide = () => { if (pinned) return; tip.hidden = true; ring.hidden = true; };
  function draw() {
    if (destroyed) return;
    const W = width();
    lastW = W;
    built = typeof make === 'function' ? make({ W }) : make;
    plot.innerHTML = built ? built.svg : '';
    twin.innerHTML = built ? tableTwin(built, { caption: opts.caption || opts.label }) : '';
    tip.hidden = true; ring.hidden = true; pinned = null;
    if (focusI >= 0 && built && built.hits[focusI]) place(built.hits[focusI]);
  }
  const onMove = e => {
    if (!built || pinned) return;
    const p = toSvg(e.clientX, e.clientY); if (!p) return;
    if (brush) { brush.x1 = p.x; brush.y1 = p.y; drawBrush(); return; }
    const h = nearest(built.hits, p.x, p.y, NEAR * p.k);
    if (h) { place(h); if (opts.onHover) opts.onHover(h); } else hide();
  };
  const onDown = e => {
    if (!built) return;
    const p = toSvg(e.clientX, e.clientY); if (!p) return;
    if (built.brush && opts.onBrush && e.pointerType === 'mouse' && e.shiftKey === false && !nearest(built.hits, p.x, p.y, NEAR * p.k)) {
      brush = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      return;
    }
    const h = nearest(built.hits, p.x, p.y, NEAR * p.k);
    if (h) {
      if (pinned === h) { pinned = null; hide(); return; }
      pinned = null; place(h); pinned = h;
      if (opts.onPick) opts.onPick(h);
    } else { pinned = null; hide(); }
  };
  let brushRect = null;
  function drawBrush() {
    const sv = svgEl(); if (!sv || !brush) return;
    if (!brushRect) { brushRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect'); brushRect.setAttribute('class', 'vz-brush'); sv.appendChild(brushRect); }
    brushRect.setAttribute('x', Math.min(brush.x0, brush.x1)); brushRect.setAttribute('y', Math.min(brush.y0, brush.y1));
    brushRect.setAttribute('width', Math.abs(brush.x1 - brush.x0)); brushRect.setAttribute('height', Math.abs(brush.y1 - brush.y0));
  }
  const onUp = () => {
    if (!brush) return;
    const b = brush; brush = null;
    if (brushRect) { brushRect.remove(); brushRect = null; }
    if (Math.abs(b.x1 - b.x0) < 6 && Math.abs(b.y1 - b.y0) < 6) { opts.onBrush(null); return; }
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    opts.onBrush(built.hits.filter(h => h.x >= x0 && h.x <= x1 && h.y >= y0 && h.y <= y1).map(h => h.id));
  };
  const onKey = e => {
    if (!built || !built.hits.length) return;
    const n = built.hits.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { focusI = (focusI + 1) % n; }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { focusI = (focusI - 1 + n) % n; }
    else if (e.key === 'Home') focusI = 0;
    else if (e.key === 'End') focusI = n - 1;
    else if (e.key === 'Enter') { e.preventDefault(); toggleTwin(); return; }
    else if (e.key === ' ' && focusI >= 0) { e.preventDefault(); if (opts.onPick) opts.onPick(built.hits[focusI]); return; }
    else if (e.key === 'Escape') { pinned = null; focusI = -1; hide(); return; }
    else return;
    e.preventDefault();
    pinned = null; place(built.hits[focusI]); pinned = built.hits[focusI];
    if (opts.onHover) opts.onHover(built.hits[focusI]);
  };
  function toggleTwin() {
    twin.hidden = !twin.hidden;
    tbtn.setAttribute('aria-expanded', String(!twin.hidden));
    tbtn.textContent = twin.hidden ? 'show table' : 'hide table';
  }
  tbtn.addEventListener('click', toggleTwin);
  plot.addEventListener('pointermove', onMove);
  plot.addEventListener('pointerdown', onDown);
  plot.addEventListener('pointerleave', () => { if (!brush) hide(); });
  doc.addEventListener('pointerup', onUp);
  plot.addEventListener('keydown', onKey);
  plot.addEventListener('blur', () => { pinned = null; hide(); });
  let ro = null, mo = null;
  if (typeof root.ResizeObserver === 'function') {
    ro = new root.ResizeObserver(() => { const w = width(); if (Math.abs(w - lastW) > 2) draw(); });
    ro.observe(host);
  }
  if (typeof root.MutationObserver === 'function' && doc.documentElement) {
    mo = new root.MutationObserver(() => draw());
    mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  draw();
  return {
    redraw: draw,
    get built() { return built; },
    destroy() { destroyed = true; if (ro) ro.disconnect(); if (mo) mo.disconnect(); doc.removeEventListener('pointerup', onUp); host.textContent = ''; }
  };
}

const API = {
  forest, stackShare, bars, binnedCurve, histogram, scatter, line: lineChart, heatmap, dumbbell, waterfall, tornado, meter, reliability, smallMultiples
};
return Object.assign({ SERIES, GROUP_CLASS, NEAR }, API, { bind, niceTicks, nearest, theme, tableTwin, png, esc, fmt, signed });
}));
