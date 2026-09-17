'use strict';
/* ============================================================================
   THE COMPARE CHART — two to five players, side by side, over the stats a
   scout picked on the global scouting page.

   One grouped horizontal bar chart in inline SVG: a block per stat, a bar per
   player inside it. The table's compare tray (fulltable.js, opts.selectable)
   hands the picks and the visible preset's stat columns to scouting.js, which
   works out each player's values and percentiles and calls in here.

   PERCENTILE MODE IS THE DEFAULT. Every stat then shares one scale, 0 to 100,
   so a block of eight stats reads at a glance; low-is-better stats arrive
   already flipped by EpinoiaSeason.percentiles, so a longer bar is always the
   better one. VALUE MODE draws the numbers themselves, each stat on its own
   domain [min(0, lowest), max(0, highest)] over the picked players. A signed
   stat — bpm, obpm, dbpm, pm, diff_* — gets a zero line and bars that grow
   either way from it; no other stat does, because a zero line on points per
   game only says that nobody scored fewer than none.

   THE VIEWBOX IS THE HOST'S CSS WIDTH. game/flow.js draws into a fixed 800-wide
   box and lets the browser shrink it, which turns 11px text into 7px text on a
   phone. Here the box is as wide as the element it sits in, so 11px is 11px at
   every width, and render() redraws when that width changes.

   TWO LAYOUTS. Below 560px each stat gets its own label line, then one 16px row
   per player — a phone has no room for a label column. From 560px the label
   moves into a 120px column on the left and the rows sit beside it.

   COLOUR IS NEVER THE ONLY KEY. The series run --lume --aqua --amber --violet
   --ink-2, set through classes in kit/compare.css (not fill attributes) so both
   themes re-point them. --good and --flare are left out on purpose: they already
   mean good and bad in the table's heat map. Each player's number, 1 to 5, is
   printed at the start of every one of their bars and on their legend chip, and
   every bar carries a <title> naming the player, the stat and the figure.

   MISSING IS DRAWN AS MISSING. A null (or a non-finite number, which is treated
   as null) is a short hatched stub and a dash, never a zero-length bar and never
   "NaN" — a player with no 3PA has no 3P%, which is not the same as 0%.

   Entry points:
     html(o)          pure: the SVG markup, testable in node
     legendHtml(o)    pure: the legend chips
     render(host, o)  draws legend, controls and chart into host; redraws on a
                      debounced ResizeObserver; returns { redraw, update, state, destroy }
     open(o)          the same inside a <dialog> — a bottom sheet on a phone

     o = { players: [{ id, name, league }],
           stats:   [{ key, label, fmt(v), signed? }],
           values:  { [playerId]: { [statKey]: number|null } },
           pcts:    { [playerId]: { [statKey]: number|null } },
           mode:    'pct' | 'value',
           width,                       html() only; render() measures the host
           allStats, note, title, onChange }   render()/open() only, all optional
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaCompare = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fin = v => typeof v === 'number' && isFinite(v);
const num = v => (fin(v) ? v : null);
/* coordinates are written with at most one decimal, so the markup stays short and a
   rounding error can never print as a long float */
const px = v => String(Math.round(v * 10) / 10);
const DASH = '—';

const MAX_PLAYERS = 5;
const SERIES = ['lume', 'aqua', 'amber', 'violet', 'ink-2'];
const NARROW = 560;          /* below this, labels go on their own line            */
const LABEL_COL = 120;       /* the wide layout's label column                     */
const ROW = 16;              /* one player's row                                   */
const BAR = 10;              /* the bar inside it                                  */
const LABEL_LINE = 18;       /* the narrow layout's stat label line                */
const BLOCK_GAP = 14;        /* between one stat's block and the next              */
const NUM_GUTTER = 16;       /* the player's number, left of the track             */
const VAL_GUTTER = 52;       /* the figure, right of the track                     */
const STUB = 24;             /* the hatched no-data stub                           */
const FONT = 11;             /* every piece of text; never smaller                 */
const CHAR = 9;              /* a generous character width for Silkscreen at 11px,
                                used only to cut a label before it overruns        */
const MIN_WIDTH = 240;

/* signed stats: those whose zero means "no better or worse than average", or even */
const isSigned = (key, stat) => !!(stat && stat.signed) ||
  /^(bpm|obpm|dbpm|pm)$/.test(String(key)) || /^diff_/.test(String(key));

const ord = n => {
  const r = Math.round(n), t = r % 100;
  if (t >= 11 && t <= 13) return r + 'th';
  return r + ({ 1: 'st', 2: 'nd', 3: 'rd' }[r % 10] || 'th');
};
const fmtValue = (stat, v) => {
  if (!fin(v)) return DASH;
  if (stat && typeof stat.fmt === 'function') {
    try {
      const s = stat.fmt(v);
      if (s != null && !/NaN|Infinity/.test(String(s))) return String(s);
    } catch (e) { /* a formatter that throws falls back to plain figures */ }
  }
  return Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
};
/* a label too long for the wide layout's column is cut, with the full text kept in the title */
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const cell = (table, id, key) => {
  const byPlayer = table && table[id];
  return byPlayer ? num(byPlayer[key]) : null;
};
const players = o => (Array.isArray(o && o.players) ? o.players : []).filter(p => p && p.id != null).slice(0, MAX_PLAYERS);
const stats = o => (Array.isArray(o && o.stats) ? o.stats : []).filter(s => s && s.key != null);
const modeOf = o => (o && o.mode === 'value' ? 'value' : 'pct');

/* every chart on a page needs its own hatch pattern id */
let seq = 0;

function html(o) {
  o = o || {};
  const P = players(o), S = stats(o), mode = modeOf(o);
  const W = Math.max(MIN_WIDTH, Math.round(fin(o.width) ? o.width : 360));
  const narrow = W < NARROW;
  const pid = 'cmp-hatch-' + (++seq);

  const aria = P.length && S.length
    ? 'Comparison of ' + P.map(p => p.name || 'Player').join(', ') + ' across ' +
      S.map(s => s.label || s.key).join(', ') + (mode === 'pct' ? ', as percentiles' : ', as values')
    : 'Comparison chart: no players or stats picked';

  if (!P.length || !S.length) {
    const H = 40;
    return '<svg class="cmp-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(aria) +
      '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<text class="cmp-empty" x="0" y="24" font-size="' + FONT + '">' +
      esc(P.length ? 'Pick a stat to compare' : 'Pick two to five players to compare') + '</text></svg>';
  }

  const trackX = (narrow ? 0 : LABEL_COL) + NUM_GUTTER;
  const trackW = Math.max(40, W - trackX - VAL_GUTTER);
  const valX = W;                                     /* the figure is right-aligned to the edge */
  const parts = [];
  let y = 0;

  S.forEach((stat, si) => {
    const key = stat.key;
    const label = String(stat.label || key);
    const signed = isSigned(key, stat);
    if (si) y += BLOCK_GAP;

    /* the domain, for value mode: zero is always inside it, so every bar starts at zero */
    let lo = 0, hi = 0;
    if (mode === 'value') {
      P.forEach(p => { const v = cell(o.values, p.id, key); if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    }
    const span = hi - lo || 1;
    const xAt = v => trackX + ((v - lo) / span) * trackW;
    const x0 = mode === 'value' ? xAt(0) : trackX;

    parts.push('<g class="cmp-block" data-stat="' + esc(key) + '">');
    let rowsTop;
    if (narrow) {
      /* a label never runs off a phone */
      parts.push('<text class="cmp-label" x="0" y="' + px(y + 13) + '" font-size="' + FONT + '">' +
        '<title>' + esc(label) + '</title>' + esc(clip(label, Math.floor(W / CHAR))) + '</text>');
      rowsTop = y + LABEL_LINE;
    } else {
      rowsTop = y;
      const midY = y + (P.length * ROW) / 2 + 4;
      parts.push('<text class="cmp-label" x="0" y="' + px(midY) + '" font-size="' + FONT + '">' +
        '<title>' + esc(label) + '</title>' + esc(clip(label, Math.floor((LABEL_COL - 8) / CHAR))) + '</text>');
    }
    const rowsH = P.length * ROW;

    /* the track behind all of this stat's rows, then its guide line: the median in
       percentile mode, zero for a signed stat in value mode */
    parts.push('<rect class="cmp-track" x="' + px(trackX) + '" y="' + px(rowsTop) + '" width="' + px(trackW) +
      '" height="' + px(rowsH) + '" rx="2"/>');
    if (mode === 'pct') {
      const mx = trackX + trackW / 2;
      parts.push('<line class="cmp-mid" x1="' + px(mx) + '" x2="' + px(mx) + '" y1="' + px(rowsTop) +
        '" y2="' + px(rowsTop + rowsH) + '"/>');
    } else if (signed) {
      parts.push('<line class="cmp-zero" x1="' + px(x0) + '" x2="' + px(x0) + '" y1="' + px(rowsTop - 2) +
        '" y2="' + px(rowsTop + rowsH + 2) + '"/>');
    }

    P.forEach((p, i) => {
      const ry = rowsTop + i * ROW;
      const by = ry + (ROW - BAR) / 2;
      const ty = ry + 12;
      const s = 'cmp-s' + i;
      const name = p.name || 'Player';
      const v = cell(o.values, p.id, key);
      const pc = cell(o.pcts, p.id, key);
      const shown = mode === 'pct' ? pc : v;
      const n = i + 1;

      const bits = [n + ' · ' + name];
      if (p.league) bits[0] += ' (' + p.league + ')';
      bits.push(label + ' ' + fmtValue(stat, v));
      if (pc != null) bits.push(ord(pc) + ' percentile');
      if (shown == null) bits.push('no data');
      const title = '<title>' + esc(bits.join(' · ')) + '</title>';

      parts.push('<text class="cmp-num ' + s + '" x="' + px(trackX - 4) + '" y="' + px(ty) +
        '" font-size="' + FONT + '" text-anchor="end">' + n + '</text>');

      if (shown == null) {
        parts.push('<rect class="cmp-bar cmp-nodata ' + s + '" data-player="' + esc(p.id) + '" data-stat="' + esc(key) +
          '" x="' + px(x0) + '" y="' + px(by) + '" width="' + px(Math.min(STUB, trackW)) + '" height="' + BAR +
          '" fill="url(#' + pid + ')">' + title + '</rect>');
        parts.push('<text class="cmp-val cmp-val-none" x="' + px(valX) + '" y="' + px(ty) + '" font-size="' + FONT +
          '" text-anchor="end">' + DASH + '</text>');
        return;
      }

      let bx, bw;
      if (mode === 'pct') {
        const cl = Math.max(0, Math.min(100, shown));
        bx = trackX;
        bw = Math.max(2, (cl / 100) * trackW);
      } else {
        const xv = xAt(shown);
        bx = Math.min(x0, xv);
        bw = Math.max(2, Math.abs(xv - x0));
        if (shown < 0 && bw === 2) bx = x0 - 2;
      }
      parts.push('<rect class="cmp-bar ' + s + '" data-player="' + esc(p.id) + '" data-stat="' + esc(key) +
        '" x="' + px(bx) + '" y="' + px(by) + '" width="' + px(bw) + '" height="' + BAR + '" rx="1">' + title + '</rect>');
      const txt = mode === 'pct' ? ord(shown) : fmtValue(stat, shown);
      parts.push('<text class="cmp-val" x="' + px(valX) + '" y="' + px(ty) + '" font-size="' + FONT +
        '" text-anchor="end">' + esc(txt) + '</text>');
    });

    parts.push('</g>');
    y = rowsTop + rowsH;
  });

  const H = Math.ceil(y + 4);
  return '<svg class="cmp-svg' + (narrow ? ' cmp-narrow' : ' cmp-wide') + '" xmlns="http://www.w3.org/2000/svg" role="img"' +
    ' aria-label="' + esc(aria) + '" data-mode="' + mode + '" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs><pattern id="' + pid + '" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">' +
    '<line class="cmp-hatch" x1="0" y1="0" x2="0" y2="4"/></pattern></defs>' +
    parts.join('') + '</svg>';
}

function legendHtml(o) {
  const P = players(o);
  return '<ul class="cmp-legend">' + P.map((p, i) =>
    '<li class="cmp-chip cmp-s' + i + '"><b class="cmp-chip-n" aria-hidden="true">' + (i + 1) + '</b>' +
    '<span class="cmp-chip-name">' + esc(p.name || 'Player') + '</span>' +
    (p.league ? '<span class="cmp-chip-lg">' + esc(p.league) + '</span>' : '') + '</li>').join('') + '</ul>';
}

/* the controls: the mode toggle, and a chip per stat that can be shown — on means drawn */
function modeHtml(st) {
  return '<div class="cmp-mode" role="group" aria-label="Scale">' +
    '<button type="button" class="cmp-mode-btn" data-cmp-mode="pct" aria-pressed="' + (st.mode === 'pct') + '">Percentile</button>' +
    '<button type="button" class="cmp-mode-btn" data-cmp-mode="value" aria-pressed="' + (st.mode === 'value') + '">Value</button>' +
    '</div>';
}
/* the stat chips; `fold` puts them behind a closed "stats · N" button (a phone, below the chart) */
function statsHtml(o, st, fold) {
  const pool = Array.isArray(o.allStats) && o.allStats.length ? o.allStats : o.stats || [];
  if (pool.length < 2) return '';
  const on = new Set(st.keys);
  const id = fold ? 'cmp-stats-' + (++seq) : '';
  const chips = '<div class="cmp-stats" role="group" aria-label="Stats"' + (fold ? ' id="' + id + '"' + (st.statsOpen ? '' : ' hidden') : '') + '>' +
    pool.map(s =>
      '<button type="button" class="cmp-stat' + (on.has(s.key) ? ' on' : '') + '" data-cmp-stat="' + esc(s.key) +
      '" aria-pressed="' + on.has(s.key) + '">' + esc(s.label || s.key) + '</button>').join('') + '</div>';
  if (!fold) return chips;
  return '<div class="cmp-statbox"><button type="button" class="cmp-fold" data-cmp-fold="1" aria-controls="' + id +
    '" aria-expanded="' + !!st.statsOpen + '">Stats · ' + st.keys.length + '</button>' + chips + '</div>';
}
function controlsHtml(o, st) {
  return '<div class="cmp-controls">' + modeHtml(st) + statsHtml(o, st, false) + '</div>';
}

const hosts = typeof WeakMap === 'function' ? new WeakMap() : null;

function render(host, o) {
  if (!host) return null;
  const prev = hosts && hosts.get(host);
  if (prev) prev.destroy();
  o = Object.assign({}, o || {});
  const pool = Array.isArray(o.allStats) && o.allStats.length ? o.allStats : stats(o);
  const st = { mode: modeOf(o), keys: stats(o).map(s => s.key), statsOpen: false };

  const current = () => {
    const byKey = new Map(pool.concat(stats(o)).map(s => [s.key, s]));
    return Object.assign({}, o, { mode: st.mode, stats: st.keys.map(k => byKey.get(k)).filter(Boolean) });
  };

  let chart = null, lastW = -1, layoutNarrow = null;
  const isNarrow = () => { const w = host.clientWidth || 0; return w > 0 && w < NARROW; };
  const drawChart = force => {
    if (!chart) return;
    /* a width that crosses NARROW changes the order of the whole block, not just the svg */
    if (!force && layoutNarrow !== null && isNarrow() !== layoutNarrow) { draw(); return; }
    const w = Math.round(chart.clientWidth || (host.clientWidth || 360));
    if (!force && w === lastW) return;
    lastW = w;
    chart.innerHTML = html(Object.assign(current(), { width: w }));
  };
  /* ON A PHONE THE CHART COMES FIRST. Legend, controls and note above it put the chart's top
     494px down a 740px sheet (18 stat chips wrap to five rows), so a reader saw two of eight
     stats. Below NARROW: legend, the scale toggle, the chart, the note, then the stat chips
     behind a closed "stats · N" button. Wider screens keep chips above the chart. */
  const draw = () => {
    const c = current();
    layoutNarrow = isNarrow();
    const title = o.title ? '<div class="cmp-title">' + esc(o.title) + '</div>' : '';
    const note = o.note ? '<p class="cmp-note">' + esc(o.note) + '</p>' : '';
    host.innerHTML = '<div class="cmp' + (layoutNarrow ? ' cmp-narrow' : '') + '">' + title + legendHtml(c) +
      (layoutNarrow
        ? '<div class="cmp-controls">' + modeHtml(st) + '</div><div class="cmp-chart"></div>' + note + statsHtml(o, st, true)
        : controlsHtml(o, st) + note + '<div class="cmp-chart"></div>') +
      '</div>';
    chart = host.querySelector('.cmp-chart');
    drawChart(true);
  };
  const changed = () => {
    draw();
    if (typeof o.onChange === 'function') o.onChange({ mode: st.mode, stats: st.keys.slice() });
  };

  const onClick = e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const fb = t.closest('[data-cmp-fold]');
    if (fb && host.contains(fb)) { st.statsOpen = !st.statsOpen; draw(); return; }
    const mb = t.closest('[data-cmp-mode]');
    if (mb && host.contains(mb)) {
      const m = mb.getAttribute('data-cmp-mode') === 'value' ? 'value' : 'pct';
      if (m !== st.mode) { st.mode = m; changed(); }
      return;
    }
    const sb = t.closest('[data-cmp-stat]');
    if (sb && host.contains(sb)) {
      const k = sb.getAttribute('data-cmp-stat');
      const at = st.keys.indexOf(k);
      if (at >= 0) {
        if (st.keys.length > 1) st.keys.splice(at, 1);        /* the last stat stays */
        else return;
      } else {
        /* keep the pool's order, so a stat put back returns to its place */
        const order = pool.map(s => s.key);
        st.keys.push(k);
        st.keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      }
      changed();
    }
  };
  host.addEventListener('click', onClick);

  /* redraw on a width change only, and not more than once per burst of resizes */
  let timer = null, ro = null;
  if (typeof root.ResizeObserver === 'function') {
    ro = new root.ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => drawChart(false), 120);
    });
    ro.observe(host);
  }

  draw();
  const api = {
    state: st,
    redraw: () => drawChart(true),
    update(next) {
      o = Object.assign({}, o, next || {});
      if (next && next.stats) st.keys = stats(o).map(s => s.key);
      if (next && next.mode) st.mode = modeOf(o);
      draw();
    },
    destroy() {
      clearTimeout(timer);
      if (ro) ro.disconnect();
      host.removeEventListener('click', onClick);
      if (hosts) hosts.delete(host);
    }
  };
  if (hosts) hosts.set(host, api);
  return api;
}

/* The chart in a native <dialog>: Escape closes it, focus is held inside, the backdrop
   comes free. kit/compare.css makes it a bottom sheet on a phone and a centred panel on
   a wider screen. Closing removes it from the page. */
function open(o) {
  const doc = root.document;
  if (!doc) return null;
  o = o || {};
  const dlg = doc.createElement('dialog');
  dlg.className = 'cmp-sheet';
  dlg.setAttribute('aria-label', o.title || 'Compare players');
  dlg.innerHTML = '<div class="cmp-sheet-head"><span class="cmp-sheet-title">' + esc(o.title || 'Compare') + '</span>' +
    '<button type="button" class="cmp-sheet-close" aria-label="Close">×</button></div>' +
    '<div class="cmp-sheet-body"></div>';
  doc.body.appendChild(dlg);
  const body = dlg.querySelector('.cmp-sheet-body');
  let chart = null;
  const close = () => { if (dlg.open && dlg.close) dlg.close(); else done(); };
  const done = () => {
    if (chart) chart.destroy();
    chart = null;
    if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
    if (typeof o.onClose === 'function') o.onClose();
  };
  dlg.addEventListener('close', done);
  dlg.addEventListener('click', e => {
    if (e.target === dlg) close();                                   /* a tap on the backdrop */
    else if (e.target.closest && e.target.closest('.cmp-sheet-close')) close();
  });
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  /* measured after it is open, so the chart takes the sheet's real width */
  chart = render(body, Object.assign({}, o, { title: null }));
  return { dialog: dlg, chart, close };
}

return { html, legendHtml, render, open, isSigned, ord, SERIES, NARROW, MAX_PLAYERS };
}));
