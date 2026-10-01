'use strict';
/* ============================================================================
   STAT POPUP (epinoia/statpop.js, styled by kit/statpop.css)

   Tap a bar or a tile on a profile and this opens: what the statistic is (statinfo.js), where the subject
   sits among the league (value, rank, percentile) and a scatter of the WHOLE league - x is this statistic,
   y is a context axis (minutes a game for players, pace for clubs) - with the league average marked and an
   arrow for which way is better.

     EpinoiaStatPop.open({ key, label, kind: 'player'|'team', subjectId, rows, value, low, signed, dp, pool,
                           y, yLabel, logoOf, meta, trigger })
        rows     the league's rows (each has id; name, teamShort/teamName/colour/teamLogo|logo where known)
        value    fn(row) -> number, or a row key (default: key)
        pool     the rows the subject is ranked among (a position filter), default rows
        meta     async fn(ids) -> { id: { name, teamShort, colour, teamLogo|logo } } for rows that carry no
                 names (default for players: EpinoiaData.playerMeta)
     EpinoiaStatPop.close()
     EpinoiaStatPop.placeLabels(points, opts)   PURE: greedy collision-avoiding label placement (tested)

   Labelled markers are kept few on purpose: the subject and at most six others (the two best, the worst
   and the nearest neighbours). Everybody else is a plain dot; tap or hover any dot for name and value.
   One SVG, one delegated handler, nearest-point lookup: a thousand points cost nothing.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStatPop = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------------ label placement (pure) --- */
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/* points: [{ id, x, y, w, h, r, must? }] in priority order (first = most important). x,y is the marker's
   centre, r its radius, w x h the label's size. Returns [{ id, box:{x,y,w,h}, side }] for those placed.
   A label is never placed over another label, over any labelled marker, or outside opts.width x opts.height.
   opts: { width, height, gap = 3, max = Infinity (labels other than a `must` one) } */
function placeLabels(points, opts) {
  const W = opts.width, H = opts.height, gap = opts.gap == null ? 3 : opts.gap, max = opts.max == null ? Infinity : opts.max;
  const markers = points.map(p => ({ x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r }));
  const placed = [], out = [];
  let others = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p.must && others >= max) continue;
    let done = null;
    for (const d of [gap, gap + 5, gap + 12]) {
      const o = p.r + d;
      const cand = [
        ['r', p.x + o, p.y - p.h / 2], ['l', p.x - o - p.w, p.y - p.h / 2],
        ['t', p.x - p.w / 2, p.y - o - p.h], ['b', p.x - p.w / 2, p.y + o],
        ['tr', p.x + o * 0.7, p.y - o * 0.7 - p.h], ['br', p.x + o * 0.7, p.y + o * 0.7],
        ['tl', p.x - o * 0.7 - p.w, p.y - o * 0.7 - p.h], ['bl', p.x - o * 0.7 - p.w, p.y + o * 0.7]
      ];
      for (const [side, x, y] of cand) {
        const box = { x, y, w: p.w, h: p.h };
        if (x < 0 || y < 0 || x + p.w > W || y + p.h > H) continue;
        if (placed.some(b => overlap(box, b))) continue;
        if (markers.some(m => overlap(box, m))) continue;
        done = { id: p.id, box, side }; break;
      }
      if (done) break;
    }
    if (done) { placed.push(done.box); out.push(done); if (!p.must) others++; }
  }
  return out;
}

/* ------------------------------------------------------------------------- helpers --- */
const NS = 'http://www.w3.org/2000/svg';
const num = v => (v == null || v === '' || !isFinite(Number(v))) ? null : Number(v);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ord = n => { const v = Math.round(n), t = v % 100, s = ['th', 'st', 'nd', 'rd']; return v + (s[(t - 20) % 10] || s[t] || s[0]); };
function fmt(v, dp, signed) {
  if (v == null) return '—';
  return (signed && v > 0 ? '+' : '') + Number(v).toFixed(dp);
}
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(6));
  return { ticks: out, step };
}
function shortName(n) {
  n = String(n || '').trim();
  if (!n) return '';
  const p = n.split(/\s+/);
  let s = p.length > 1 ? p[0].charAt(0) + '. ' + p.slice(1).join(' ') : n;
  return s.length > 15 ? s.slice(0, 14) + '…' : s;
}
const initials = n => {
  const p = String(n || '?').trim().split(/\s+/);
  return ((p.length > 1 ? p[0].charAt(0) + p[p.length - 1].charAt(0) : p[0].slice(0, 2)) || '?').toUpperCase();
};
function logoUrl(row, meta) {
  const path = (meta && (meta.teamLogo || meta.logo)) || row.teamLogo || row.logo || row.logo_path || row.logo_url || null;
  if (!path) return null;
  if (typeof root.epinoiaLogoUrl === 'function') { try { return root.epinoiaLogoUrl(path, 64); } catch (_) { return null; } }
  return /^https:\/\//i.test(path) ? path : null;
}
const safeColour = c => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim())) ? c.trim() : null;

/* ---------------------------------------------------------------------- the popup --- */
let current = null;

function close() {
  if (!current) return;
  const c = current; current = null;
  document.removeEventListener('keydown', c.onKey, true);
  window.removeEventListener('resize', c.onResize);
  document.documentElement.classList.remove('stp-lock');
  c.back.remove();
  if (c.opener && c.opener.focus) { try { c.opener.focus(); } catch (_) { /* gone */ } }
}

function open(o) {
  if (typeof document === 'undefined') return;
  close();
  const SI = root.EpinoiaStatInfo;
  const kind = o.kind === 'team' ? 'team' : 'player';
  const inf = SI && SI.info ? SI.info(o.key, kind) : null;
  const low = o.low != null ? !!o.low : !!(inf && inf.low);
  const dp = o.dp == null ? 1 : o.dp;
  const signed = !!o.signed;
  const getV = typeof o.value === 'function' ? o.value : (r => r[typeof o.value === 'string' ? o.value : o.key]);
  const rows = o.rows || [];
  const yKey = o.y || (kind === 'team' ? 'pace' : 'mpg');
  const yLabel = o.yLabel || (yKey === 'mpg' ? 'minutes / game' : yKey === 'pace' ? 'pace' : yKey === 'gp' ? 'games' : yKey);

  /* the league, as numbers: one entry per row with a value */
  const src = (o.pool && o.pool.length ? o.pool : rows);
  let pts = [];
  src.forEach(r => {
    const x = num(getV(r));
    if (x == null) return;
    let y = num(r[yKey]);
    if (y == null && yKey === 'mpg' && num(r.min) != null && num(r.gp)) y = r.min / r.gp;
    if (y == null) y = num(r.gp);
    pts.push({ row: r, id: r.id, x, y: y == null ? 0 : y });
  });
  let subject = pts.find(p => p.id === o.subjectId) || null;
  if (!subject) {
    const r = rows.find(q => q.id === o.subjectId);
    const x = r ? num(getV(r)) : null;
    if (r && x != null) { subject = { row: r, id: r.id, x, y: num(r[yKey]) || 0 }; pts.push(subject); }
  }
  const N = pts.length;
  const mean = N ? pts.reduce((a, p) => a + p.x, 0) / N : null;
  let rank = null, pct = null;
  if (subject) {
    const better = pts.filter(p => low ? p.x < subject.x : p.x > subject.x).length;
    const worse = pts.filter(p => low ? p.x > subject.x : p.x < subject.x).length;
    rank = better + 1; pct = N > 1 ? 100 * worse / (N - 1) : null;
  }

  /* ---- the shell ---- */
  const back = document.createElement('div');
  back.className = 'stp-back';
  const box = document.createElement('div');
  box.className = 'stp'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  const tid = 'stp-t-' + Date.now();
  box.setAttribute('aria-labelledby', tid);
  const title = (inf && inf.title) || o.label || o.key;
  let h = '<div class="stp-head"><h3 id="' + tid + '" class="stp-title">' + esc(title) + '</h3>' +
    '<button type="button" class="stp-x" aria-label="Close">×</button></div>';
  if (inf) {
    h += '<div class="stp-explain">' +
      '<p class="stp-what">' + esc(inf.what) + '</p>' +
      '<dl class="stp-dl"><dt>formula</dt><dd>' + esc(inf.formula) + '</dd><dt>reading it</dt><dd>' + esc(inf.read) + '</dd></dl></div>';
  }
  h += '<div class="stp-facts">' +
    '<div class="stp-fact stp-main"><b>' + esc(subject ? fmt(subject.x, dp, signed) : '—') + '</b><span>' + esc(o.label || title) + '</span></div>' +
    (rank != null ? '<div class="stp-fact"><b>' + rank + '<i> / ' + N + '</i></b><span>rank' + (low ? ' (lowest first)' : '') + '</span></div>' : '') +
    (pct != null ? '<div class="stp-fact"><b>' + ord(pct) + '</b><span>percentile</span></div>' : '') +
    (mean != null ? '<div class="stp-fact"><b>' + esc(fmt(mean, dp, signed)) + '</b><span>league avg</span></div>' : '') +
    '</div>';
  h += '<div class="stp-chart" tabindex="-1"><div class="stp-tip" hidden></div></div>' +
    '<div class="stp-note">Every dot is one ' + (kind === 'team' ? 'club' : 'player') + ' in the league. Tap a dot for its name and value.</div>';
  box.innerHTML = h;
  back.appendChild(box);
  document.body.appendChild(back);
  document.documentElement.classList.add('stp-lock');

  const st = { back, box, opener: o.trigger || document.activeElement, onKey: null, onResize: null };
  current = st;
  const chartHost = box.querySelector('.stp-chart'), tip = box.querySelector('.stp-tip');

  /* ---- keyboard: Esc closes, Tab stays inside ---- */
  st.onKey = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])')].filter(n => !n.hidden);
    if (!f.length) { ev.preventDefault(); return; }
    const a = f[0], z = f[f.length - 1];
    if (!box.contains(document.activeElement)) { ev.preventDefault(); a.focus(); }
    else if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
  };
  document.addEventListener('keydown', st.onKey, true);
  box.querySelector('.stp-x').addEventListener('click', close);
  back.addEventListener('click', ev => { if (ev.target === back) close(); });
  box.querySelector('.stp-x').focus();

  if (N < 2) { chartHost.insertAdjacentHTML('afterbegin', '<div class="stp-empty">Not enough of the league has this statistic yet.</div>'); return; }

  /* ---- names and crests, fetched only for the few that get a label (and for a tapped dot) ---- */
  const metaCache = new Map();
  const metaOf = p => metaCache.get(p.id) || p.row;
  const nameOf = p => { const m = metaOf(p); return (m && m.name) || p.row.name || (p === subject && o.subjectName) || ''; };
  const needsMeta = p => !p.row.name && !metaCache.has(p.id);
  const fetchMeta = ids => {
    let fn = o.meta;
    if (!fn && kind === 'player' && root.EpinoiaData && root.EpinoiaData.playerMeta) fn = i => root.EpinoiaData.playerMeta(i);
    ids = ids.filter(i => !metaCache.has(i));
    if (!fn || !ids.length) return Promise.resolve(false);
    ids.forEach(i => metaCache.set(i, {}));            // asked: never asked twice
    return Promise.resolve(fn(ids)).then(m => { ids.forEach(i => metaCache.set(i, (m && m[i]) || {})); return true; }).catch(() => false);
  };

  /* ---- the chart ---- */
  let lastLayout = null, tipId = null, lastMarks = [];
  /* THE LABEL'S REAL WIDTH. It was a guess of 6.4px a character, and the text was always drawn from the box's left edge: a
     label placed to the LEFT of its marker (its box ending next to it) therefore started far to the left of where the
     text actually ended, so a name could sit half a centimetre from its own circle and look like it belonged to the
     neighbour. The width is measured in the chart's own font, and text is anchored to the side of the box that touches
     the marker. */
  const probe = document.createElementNS(NS, 'svg');
  probe.setAttribute('class', 'stp-svg stp-probe');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;visibility:hidden;overflow:hidden';
  const probeText = document.createElementNS(NS, 'text');
  probeText.setAttribute('class', 'stp-lab');
  probe.appendChild(probeText);
  box.appendChild(probe);
  const widths = new Map();
  const textW = str => {
    if (widths.has(str)) return widths.get(str);
    probeText.textContent = str;
    let w = 0;
    try { w = probeText.getComputedTextLength(); } catch (_) { w = 0; }
    if (!(w > 0)) w = str.length * 6.4;
    widths.set(str, w);
    return w;
  };
  function draw() {
    if (current !== st) return;
    const W = Math.max(260, Math.floor(chartHost.clientWidth || 320));
    const H = Math.round(Math.min(380, Math.max(240, W * 0.78)));
    const m = { l: 40, r: 14, t: 14, b: 44 };
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    if (y1 === y0) { y0 -= 1; y1 += 1; }
    const px = (x1 - x0) * 0.05, py = (y1 - y0) * 0.06;
    x0 -= px; x1 += px; y0 = Math.max(0, y0 - py); y1 += py;
    const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
    const Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    pts.forEach(p => { p.px = X(p.x); p.py = Y(p.y); });

    let s = '<svg class="stp-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(title) + ' across the league">';
    /* grid and axes */
    const xt = niceTicks(x0, x1, W < 400 ? 4 : 6), yt = niceTicks(y0, y1, 4);
    xt.ticks.forEach(t => {
      const x = X(t).toFixed(1);
      s += '<line class="stp-grid" x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><text class="stp-tick" x="' + x + '" y="' + (H - m.b + 14) + '" text-anchor="middle">' + esc(fmt(t, xt.step < 1 ? Math.min(2, dp + 1) : dp, false)) + '</text>';
    });
    yt.ticks.forEach(t => {
      const y = Y(t).toFixed(1);
      s += '<line class="stp-grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/><text class="stp-tick" x="' + (m.l - 5) + '" y="' + (+y + 3) + '" text-anchor="end">' + esc(fmt(t, yt.step < 1 ? 1 : 0, false)) + '</text>';
    });
    s += '<line class="stp-axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '"/>' +
         '<line class="stp-axis" x1="' + m.l + '" x2="' + m.l + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
    /* the average */
    const ax = X(mean).toFixed(1);
    s += '<line class="stp-avg" x1="' + ax + '" x2="' + ax + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>' +
         '<text class="stp-avgl" x="' + (+ax + 4) + '" y="' + (m.t + 9) + '">avg ' + esc(fmt(mean, dp, signed)) + '</text>';
    /* axis titles and the better arrow */
    const midx = (m.l + W - m.r) / 2, ay = H - 8;
    s += '<text class="stp-axt" x="' + midx + '" y="' + (H - 22) + '" text-anchor="middle">' + esc(o.label || title) + '</text>';
    const arrow = low ? ['← better', W - m.r, 'end'] : ['better →', W - m.r, 'end'];
    s += '<text class="stp-better" x="' + arrow[1] + '" y="' + ay + '" text-anchor="' + arrow[2] + '">' + arrow[0] + '</text>';
    s += '<text class="stp-axt" transform="translate(9 ' + ((m.t + H - m.b) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(yLabel) + '</text>';
    /* every dot: one path of zero-length round-capped segments */
    s += '<path class="stp-dots" d="' + pts.map(p => 'M' + p.px.toFixed(1) + ' ' + p.py.toFixed(1) + 'h0').join('') + '"/>';

    /* labelled markers: the subject, then the neighbours and the extremes, at most six others */
    const labelled = [];
    if (subject) {
      const others = pts.filter(p => p !== subject);
      const byBest = others.slice().sort((a, b) => low ? a.x - b.x : b.x - a.x);
      const ext = [byBest[0], byBest[1], byBest[byBest.length - 1]].filter(Boolean);
      const near = others.filter(p => ext.indexOf(p) === -1)
        .sort((a, b) => Math.hypot(a.px - subject.px, a.py - subject.py) - Math.hypot(b.px - subject.px, b.py - subject.py)).slice(0, 12);
      const order = [subject].concat(near.slice(0, 3), ext, near.slice(3));
      const seen = new Set();
      order.forEach(p => { if (!seen.has(p)) { seen.add(p); labelled.push(p); } });
    }
    const sizeOf = p => p === subject ? 24 : 18;
    const items = labelled.map(p => {
      const nm = shortName(nameOf(p)) || '';
      return { id: p.id, x: p.px, y: p.py, r: sizeOf(p) / 2 + 1, w: Math.ceil(textW(nm) + 4), h: 14, must: p === subject, name: nm, p };
    });
    /* an unnamed row gets its crest and no label until its name arrives; only named ones compete for label space */
    const named = items.filter(i => i.name && (i.must || !needsMeta(i.p)));
    const placed = placeLabels(named, { width: W, height: H, gap: 3, max: 6 });
    const placedIds = new Map(placed.map(q => [q.id, q]));
    /* markers of the ones that did not get a label are dropped, so a crest never floats unexplained */
    const drawn = items.filter(i => i.must || placedIds.has(i.id));
    let defs = '', marks = '', labels = '';
    drawn.forEach((i, k) => {
      const p = i.p, mt = metaOf(p), sz = sizeOf(p), r = sz / 2;
      const col = safeColour(mt && mt.colour) || safeColour(p.row.colour) || null;
      const url = (o.logoOf ? o.logoOf(p.row, mt) : null) || logoUrl(p.row, mt);
      const isS = p === subject;
      marks += '<g class="stp-mk' + (isS ? ' subj' : '') + '" data-i="' + esc(p.id) + '" transform="translate(' + i.x.toFixed(1) + ' ' + i.y.toFixed(1) + ')">' +
        '<circle class="stp-mk-bg" r="' + r + '"' + (col ? ' style="fill:' + col + '"' : '') + '/>' +
        '<text class="stp-mk-in" y="3" text-anchor="middle">' + esc(initials(nameOf(p) || (isS ? o.label : ''))) + '</text>';
      if (url) {
        defs += '<clipPath id="stp-c' + k + '"><circle r="' + (r - 1) + '"/></clipPath>';
        marks += '<circle class="stp-mk-wh" r="' + (r - 1) + '"/><image class="stp-mk-img" href="' + esc(url) + '" x="' + (-r + 1) + '" y="' + (-r + 1) + '" width="' + (2 * r - 2) + '" height="' + (2 * r - 2) +
          '" clip-path="url(#stp-c' + k + ')" preserveAspectRatio="xMidYMid meet"/>';
      }
      marks += '<circle class="stp-mk-ring" r="' + r + '"/></g>';
      const q = placedIds.get(i.id);
      if (q) {
        const left = /l/.test(q.side), mid = q.side === 't' || q.side === 'b';
        const tx = mid ? q.box.x + q.box.w / 2 : left ? q.box.x + q.box.w - 2 : q.box.x + 2;
        labels += '<text class="stp-lab' + (isS ? ' subj' : '') + '" x="' + tx.toFixed(1) + '" y="' + (q.box.y + 11).toFixed(1) +
          '" text-anchor="' + (mid ? 'middle' : left ? 'end' : 'start') + '">' + esc(i.name) + '</text>';
      }
    });
    s += '<defs>' + defs + '</defs>' + marks + labels + '<circle class="stp-hover" r="7" hidden/></svg>';

    const keep = tip;
    chartHost.textContent = '';
    chartHost.insertAdjacentHTML('afterbegin', s);
    chartHost.appendChild(keep);
    lastLayout = { W, H, drawn: placed.length };
    lastMarks = drawn.map(i => ({ p: i.p, x: i.x, y: i.y, r: sizeOf(i.p) / 2 }));
    if (tipId != null) showTip(pts.find(p => p.id === tipId), true);

    /* a crest that will not load falls back to the initials underneath it */
    chartHost.querySelector('svg').addEventListener('error', ev => {
      const t = ev.target;
      if (t && t.tagName && t.tagName.toLowerCase() === 'image') { t.remove(); }
    }, true);

    /* names for the candidates that have none: one lookup for the handful that would be labelled, then redraw */
    const want = items.filter(i => needsMeta(i.p)).map(i => i.id);
    if (want.length) fetchMeta(want).then(ok => { if (ok && current === st) draw(); });
  }

  /* ---- one delegated handler: nearest dot within reach ---- */
  function nearest(ev) {
    const svg = chartHost.querySelector('svg');
    if (!svg) return null;
    const b = svg.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top;
    /* a marker (crest) under the pointer is the one meant, whatever plain dots lie beneath or beside it */
    let mk = null, md = Infinity;
    for (let i = 0; i < lastMarks.length; i++) {
      const m = lastMarks[i], dx = m.x - x, dy = m.y - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= m.r + 3 && d < md) { md = d; mk = m.p; }
    }
    if (mk) return mk;
    let best = null, bd = 18 * 18;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].px - x, dy = pts[i].py - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = pts[i]; }
    }
    return best;
  }
  function showTip(p, keep) {
    const svg = chartHost.querySelector('svg');
    const hov = svg && svg.querySelector('.stp-hover');
    if (!p) { tip.hidden = true; tipId = null; if (hov) hov.setAttribute('hidden', ''); return; }
    tipId = p.id;
    const mt = metaOf(p), nm = nameOf(p);
    const team = (mt && (mt.teamShort || mt.teamName)) || p.row.teamShort || p.row.teamName || '';
    tip.innerHTML = '<b>' + esc(nm || (needsMeta(p) ? '…' : (kind === 'team' ? 'Club' : 'Player'))) + '</b>' +
      (team && kind === 'player' ? '<span>' + esc(team) + '</span>' : '') +
      '<span>' + esc(o.label || title) + ' <b>' + esc(fmt(p.x, dp, signed)) + '</b></span>' +
      '<span>' + esc(yLabel) + ' ' + esc(p.y == null ? '—' : (Math.round(p.y * 10) / 10)) + '</span>';
    tip.hidden = false;
    const left = Math.min(Math.max(4, p.px - tip.offsetWidth / 2), chartHost.clientWidth - tip.offsetWidth - 4);
    const above = p.py - tip.offsetHeight - 12;
    tip.style.left = left + 'px';
    tip.style.top = (above < 0 ? p.py + 14 : above) + 'px';
    if (hov) { hov.setAttribute('cx', p.px.toFixed(1)); hov.setAttribute('cy', p.py.toFixed(1)); hov.removeAttribute('hidden'); }
    if (!keep && needsMeta(p)) fetchMeta([p.id]).then(ok => { if (ok && current === st && tipId === p.id) { showTip(p, true); draw(); } });
  }
  chartHost.addEventListener('click', ev => { const p = nearest(ev); showTip(p && p.id === tipId ? null : p); });
  chartHost.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse') { const p = nearest(ev); if (p) showTip(p, false); } });
  chartHost.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') showTip(null); });

  let raf = 0, lastW = 0;
  st.onResize = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (Math.abs((chartHost.clientWidth || 0) - lastW) > 2) { lastW = chartHost.clientWidth; draw(); } });
  };
  window.addEventListener('resize', st.onResize);
  lastW = chartHost.clientWidth;
  draw();
  return st;
}

/* ---- EXPLAIN MODE: the '?' slides a small explainer card open at the top of every statistic ----
   Not a hover: pressing the '?' opens them all, and pressing it again (or Esc) slides them shut. Each card is part of the
   statistic's own box, so the box grows to make room (the rows below move down) rather than something floating over the
   page; cards built later (a folded section opened afterwards) arrive already open. The card is the short version: what it
   measures and how to read it; tapping the statistic still opens the league chart. Hero tiles are left alone (they are
   labelled already and too small to carry a card). */
let explain = false;
const bound = new Set();               // every statistic box that can be explained, so the '?' can reach them all

function exNode(node, opts) {
  const SI = root.EpinoiaStatInfo;
  const i = SI && opts && SI.info(opts.key, opts.kind);
  if (!i) return null;
  const ex = document.createElement('div');
  ex.className = 'stp-ex';
  ex.innerHTML = '<div class="stp-ex-in"><div class="stp-ex-card"><b>' + esc(i.title) + (i.low ? ' <i>lower is better</i>' : '') +
    '</b><span>' + esc(i.what) + '</span><em>' + esc(i.read) + '</em></div></div>';
  return ex;
}
/* a table row carries its card in its first cell: a box of its own inside a <tr> is not a cell */
const exHost = node => (node.tagName === 'TR' && node.cells && node.cells[0]) || node;
function openEx(node, getOpts, instant) {
  const host = exHost(node);
  if (node.classList.contains('tile') || host.querySelector(':scope > .stp-ex')) return;
  const ex = exNode(node, getOpts());
  if (!ex) return;
  host.insertBefore(ex, host.firstChild);
  node.classList.add('stp-has-ex');
  if (instant) { ex.classList.add('open'); return; }
  void ex.offsetHeight;                                           // the closed state must be painted before it opens
  requestAnimationFrame(() => ex.classList.add('open'));
}
function closeEx(node) {
  const host = exHost(node);
  const ex = host.querySelector(':scope > .stp-ex');
  if (!ex) return;
  ex.classList.remove('open');
  let gone = false;
  const done = () => { if (gone) return; gone = true; ex.remove(); if (!host.querySelector(':scope > .stp-ex')) node.classList.remove('stp-has-ex'); };
  ex.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 450);
}
function setExplain(on) {
  explain = !!on;
  document.body.classList.toggle('stp-explaining', explain);
  document.querySelectorAll('.stp-q').forEach(b => { b.setAttribute('aria-pressed', explain ? 'true' : 'false'); });
  bound.forEach(n => {
    if (!n.isConnected) { bound.delete(n); return; }
    if (explain) openEx(n, n._stpOpts, false); else closeEx(n);
  });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && explain && !document.querySelector('.stp-dialog,[role=dialog]')) setExplain(false); });
}

/* makes any element a button that opens the popup: role, tabindex, Enter/Space, and not when the click
   landed on a link or a button inside it. While explaining, it also carries its explainer card. */
function bind(node, getOpts) {
  node.classList.add('stp-hit');
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.setAttribute('aria-haspopup', 'dialog');
  node._stpOpts = getOpts;
  bound.add(node);
  const go = () => { const opts = getOpts(); if (opts) { opts.trigger = node; open(opts); } };
  node.addEventListener('click', ev => {
    const inner = ev.target.closest && ev.target.closest('a,button,input,select,textarea,summary');
    if (inner && inner !== node) return;
    go();
  });
  node.addEventListener('keydown', ev => {
    if (ev.target !== node) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
  });
  if (explain) openEx(node, getOpts, true);
}

/* THE '?' BUTTON in a section heading: turns explain mode on and off (see above), and a one-line hint under the heading says
   the statistics can be tapped. Idempotent: a heading gets one button and one hint. */
function helpButton(heading, kind) {
  if (!heading || !root.EpinoiaStatInfo) return null;
  const had = heading.querySelector('.stp-q');
  if (had) { heading.appendChild(had); return null; }        // already there: stay the LAST child, after anything added since
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'stp-q'; btn.textContent = '?';
  btn.setAttribute('aria-pressed', explain ? 'true' : 'false');
  btn.setAttribute('aria-label', 'Explain the statistics: opens a short explanation above each one');
  btn.title = 'Explain the statistics';
  btn.addEventListener('click', () => setExplain(!explain));
  heading.appendChild(btn);
  const hint = document.createElement('div');
  hint.className = 'stp-hint';
  hint.textContent = 'Tap a stat for its league chart · ? explains them';
  heading.after(hint);
  return { btn, hint, toggle: setExplain };
}

return { open, close, bind, helpButton, placeLabels, _nice: niceTicks };
}));
