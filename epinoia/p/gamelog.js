'use strict';
/* ============================================================================
   THE PLAYER PROFILE'S GAME LOG (2026-10-02): his season game by game, a chart of any statistic over the table.

   PRESS A STATISTIC -- a chip above the chart, or a column's heading in the table -- and the chart draws it: a bar a
   game, oldest on the left, his season average dashed across it and his last five games' running average as a line,
   so a reader sees at a glance whether he got better as the season went on. Under each bar, the result (a green or a
   red tick); above the chart, the season average, the last five against it, the first half of the season against the
   second, and his best game. The statistic chosen is remembered on this device.

   A SHOOTING PERCENTAGE IS MAKES OVER ATTEMPTS, over whatever stretch a figure covers -- the season, the last five, the
   running line -- never an average of game percentages, and a game without an attempt has no bar (not a zero). Its best
   game is the best of the games with at least his usual number of attempts, so 1 of 1 is not a season's best.

   POINT AT A BAR (or tap it) for that game in the line above the chart, with a link to its box score; its row in the
   table is lit. In the table, the chosen statistic's column is lit and each of its cells tinted by how the game
   compares with his season (green above, red below; the other way for turnovers and fouls). The competition of each
   game has its own column (COMP: SLB, EuroCup), and where the log spans more than one, the chart's bars say which.

   render({ host, rows, comps, boxHref, colour })
     rows     the log, newest first (p/player.js seasonLog): { game_id, stats, games: { tipoff_at, competition_id }, __opp, __res, __home }
     comps    Map competition id -> its short name (seasonbar.js compLabels)
     boxHref  game id -> the box score's address
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGameLog = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const n0 = v => +v || 0;
const fgm = s => n0(s.p2m) + n0(s.p3m), fga = s => n0(s.p2a) + n0(s.p3a);

/* what the chart can draw. v: the game's figure; m and a: makes and attempts (a percentage); low: fewer is better;
   signed: the figure can be below nothing; col: the table heading that picks it */
const STATS = [
  { k: 'pts', l: 'PTS', t: 'points', col: 'PTS', v: s => n0(s.pts) },
  { k: 'reb', l: 'REB', t: 'rebounds', col: 'REB', v: s => n0(s.or) + n0(s.dr) },
  { k: 'ast', l: 'AST', t: 'assists', col: 'AST', v: s => n0(s.ast) },
  { k: 'stl', l: 'STL', t: 'steals', col: 'STL', v: s => n0(s.stl) },
  { k: 'blk', l: 'BLK', t: 'blocks', col: 'BLK', v: s => n0(s.blk) },
  { k: 'to', l: 'TO', t: 'turnovers', col: 'TO', v: s => n0(s.to), low: true },
  { k: 'pf', l: 'PF', t: 'personal fouls', col: 'PF', v: s => n0(s.pf), low: true },
  { k: 'min', l: 'MIN', t: 'minutes', col: 'MIN', v: s => n0(s.min) / 60000, dp: 1 },
  { k: 'fg', l: 'FG%', t: 'field goal percentage', col: 'FG', m: fgm, a: fga, frac: true },
  { k: 'p3', l: '3P%', t: 'three-point percentage', col: '3PT', m: s => n0(s.p3m), a: s => n0(s.p3a), frac: true },
  { k: 'ft', l: 'FT%', t: 'free throw percentage', col: 'FT', m: s => n0(s.ftm), a: s => n0(s.fta), frac: true },
  /* TS%: points over twice the true shooting attempts, which is makes over attempts in the same arithmetic */
  { k: 'ts', l: 'TS%', t: 'true shooting percentage', m: s => n0(s.pts), a: s => 2 * (fga(s) + 0.44 * n0(s.fta)) },
  { k: 'pm', l: '+/-', t: 'plus-minus', col: '+/-', v: s => (s.pm == null || s.pm === '' ? null : +s.pm), signed: true },
  /* the game's own BPM (bpm.js gameFromBox over both sides' lines; p/player.js logBPM puts it on the row) */
  { k: 'bpm', l: 'BPM', t: 'box plus/minus', col: 'BPM', v: (s, r) => (r && r.__bpm != null ? r.__bpm : null), dp: 1, signed: true }
];
const statOf = k => STATS.find(x => x.k === k) || STATS[0];
const WINDOW = 5;

/* ------------------------------------------------------------------ the arithmetic --- */
/* the log as a line, oldest first: { row, v } or, for a percentage, { row, m, a, v } (v null without an attempt) */
function series(rows, stat) {
  const S = typeof stat === 'string' ? statOf(stat) : stat;
  return (rows || []).slice().reverse().map(r => {
    const s = (r && r.stats) || {};
    if (S.m) { const m = S.m(s), a = S.a(s); return { row: r, m, a, v: a > 0 ? 100 * m / a : null }; }
    const v = S.v(s, r);
    return { row: r, v: v == null || !isFinite(v) ? null : v };
  });
}
/* a stretch of games as one figure: the mean of the games that have one, or makes over attempts */
function over(pts, S) {
  if (S.m) {
    const m = pts.reduce((n, p) => n + (p.m || 0), 0), a = pts.reduce((n, p) => n + (p.a || 0), 0);
    return a > 0 ? 100 * m / a : null;
  }
  const vs = pts.map(p => p.v).filter(v => v != null);
  return vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null;
}
/* each game's running figure over it and the games before it, up to w of them */
function rolling(ser, S, w) {
  return ser.map((p, i) => over(ser.slice(Math.max(0, i - ((w || WINDOW) - 1)), i + 1), S));
}
/* the season, the last five, the two halves, the best game */
function summary(ser, S) {
  const season = over(ser, S);
  const last = ser.length > WINDOW ? over(ser.slice(-WINDOW), S) : null;
  const mid = Math.floor(ser.length / 2);
  const halves = ser.length >= 6 ? [over(ser.slice(0, mid), S), over(ser.slice(mid), S)] : null;
  /* a percentage's best game: at least his usual number of attempts (and two), so 1 of 1 is not a season's best */
  const floor = S.m ? Math.max(2, Math.round(ser.reduce((n, p) => n + (p.a || 0), 0) / Math.max(1, ser.filter(p => p.a > 0).length))) : 0;
  let best = null;
  ser.forEach(p => {
    if (p.v == null || (S.m && p.a < floor)) return;
    if (!best || (S.low ? p.v < best.v : p.v > best.v)) best = p;
  });
  return { season, last, halves, best, n: ser.length };
}
/* a scale with round steps that holds lo..hi: { lo, hi, step } */
function niceScale(lo, hi, ticks) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / (ticks || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

/* ------------------------------------------------------------------ the words --- */
const fmt = (v, S) => v == null ? '—' : S.m ? v.toFixed(1) + '%' : S.dp ? v.toFixed(S.dp) : (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1));
/* an average over games always to a decimal: 9.0 a game, not 9 */
const fmtAvg = (v, S) => v == null ? '—' : S.m ? v.toFixed(1) + '%' : v.toFixed(1);
const signed = d => (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(1);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayOf = r => { const t = r && r.games && r.games.tipoff_at; return t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''; };
/* better or worse: a turnover more is worse */
const tone = (d, S) => (d == null || Math.abs(d) < 1e-9 ? '' : ((d > 0) !== !!S.low ? 'up' : 'dn'));

/* ------------------------------------------------------------------ the chart --- */
/* the chart as an SVG string, `width` pixels wide. o: { width, height, comps (Map id -> index), sel (game index) } */
function chartSVG(ser, S, o) {
  o = o || {};
  const W = Math.max(280, Math.round(o.width || 640)), H = Math.round(o.height || 230);
  const L = 38, R = 12, T = 22, B = 38;
  const pw = W - L - R, ph = H - T - B;
  const n = ser.length;
  const roll = rolling(ser, S, WINDOW);
  const avg = over(ser, S);
  const vals = ser.map(p => p.v).filter(v => v != null).concat(roll.filter(v => v != null), avg == null ? [] : [avg]);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (S.m) { lo = 0; hi = Math.min(100, Math.max(hi, 40)); }
  const sc = niceScale(lo, hi, 4);
  if (S.m) sc.hi = Math.min(sc.hi, 100);
  const y = v => T + ph * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1));
  const slot = pw / Math.max(1, n), bw = Math.max(2, Math.min(36, slot * 0.66));
  const x = i => L + slot * i + slot / 2;
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const out = [];
  out.push('<svg class="glc-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' +
    esc(S.t + ' game by game, oldest first; season ' + fmtAvg(avg, S)) + '">');
  /* the grid and its figures */
  for (let v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
    const yy = f1(y(v));
    out.push('<line class="glc-g' + (Math.abs(v) < 1e-9 ? ' z' : '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>');
    out.push('<text class="glc-yl" x="' + (L - 6) + '" y="' + f1(y(v) + 3.5) + '" text-anchor="end">' + (S.m ? Math.round(v) + '%' : Math.round(v * 10) / 10) + '</text>');
  }
  /* the bars: up from nothing (down for a figure below it), the competition's shade, the one pointed at outlined */
  const zero = y(Math.max(sc.lo, 0));
  ser.forEach((p, i) => {
    if (p.v == null) {
      out.push('<text class="glc-na" x="' + f1(x(i)) + '" y="' + f1(zero - 4) + '" text-anchor="middle">–</text>');
      return;
    }
    const top = Math.min(y(p.v), zero), h = Math.max(1.5, Math.abs(zero - y(p.v)));
    const ci = o.comps ? (o.comps.get((p.row.games || {}).competition_id) || 0) : 0;
    out.push('<rect class="glc-b c' + Math.min(ci, 3) + (p.v < 0 ? ' neg' : '') + (o.sel === i ? ' on' : '') + '" data-i="' + i + '" x="' + f1(x(i) - bw / 2) +
      '" y="' + f1(top) + '" width="' + f1(bw) + '" height="' + f1(h) + '" rx="' + (bw > 8 ? 2 : 1) + '"/>');
  });
  /* the season average, dashed (its figure is over the chart, and the key names the line) */
  if (avg != null) out.push('<line class="glc-avg" x1="' + L + '" x2="' + (W - R) + '" y1="' + f1(y(avg)) + '" y2="' + f1(y(avg)) + '"/>');
  /* the last five's running average, a line through the games that have one */
  const pts = roll.map((v, i) => (v == null ? null : f1(x(i)) + ',' + f1(y(v))));
  let seg = [];
  const lines = [];
  pts.forEach(pt => { if (pt) seg.push(pt); else { if (seg.length) lines.push(seg); seg = []; } });
  if (seg.length) lines.push(seg);
  lines.forEach(sg => {
    if (sg.length > 1) out.push('<polyline class="glc-roll" points="' + sg.join(' ') + '"/>');
    else out.push('<circle class="glc-rolld" cx="' + sg[0].split(',')[0] + '" cy="' + sg[0].split(',')[1] + '" r="2.5"/>');
  });
  /* the result under each bar, and the dates where they fit */
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 58))));
  ser.forEach((p, i) => {
    const res = String(p.row.__res || '');
    const wl = /^W/.test(res) ? 'w' : /^L/.test(res) ? 'l' : '';
    if (wl) out.push('<rect class="glc-wl ' + wl + '" x="' + f1(x(i) - bw / 2) + '" y="' + (H - B + 6) + '" width="' + f1(bw) + '" height="4" rx="1"/>');
    if (i % every === 0 || i === n - 1) {
      if (i !== n - 1 && n - 1 - i < every) return;               // the last date has the room
      out.push('<text class="glc-xl" x="' + f1(x(i)) + '" y="' + (H - B + 24) + '" text-anchor="middle">' + esc(dayOf(p.row)) + '</text>');
    }
  });
  /* the figure over each bar, where there is room */
  if (bw >= 15 && n <= 24) {
    ser.forEach((p, i) => {
      if (p.v == null) return;
      const yy = p.v < 0 ? y(p.v) + 11 : y(p.v) - 5;
      out.push('<text class="glc-vl" x="' + f1(x(i)) + '" y="' + f1(yy) + '" text-anchor="middle">' + (S.m ? Math.round(p.v) : esc(fmt(p.v, S))) + '</text>');
    });
  }
  /* the hit areas: a whole column each, to point at or tap */
  ser.forEach((p, i) => {
    out.push('<rect class="glc-hit" data-i="' + i + '" x="' + f1(L + slot * i) + '" y="' + T + '" width="' + f1(slot) + '" height="' + (ph + B - 8) + '"/>');
  });
  out.push('</svg>');
  return out.join('');
}

/* ------------------------------------------------------------------ the page --- */
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const KEEP = 'epinoia_log_stat';
let picked = null;
try { picked = localStorage.getItem(KEEP); } catch (_) { /* this page only */ }
if (!STATS.some(s => s.k === picked)) picked = 'pts';

const COLS = ['DATE', 'OPP', 'COMP', 'RES', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FG', '3PT', 'FT', '+/-', 'BPM'];

function render(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';
  const rows = o.rows || [];
  if (!rows.length) { host.appendChild(el('div', 'empty', 'No games yet.')); return; }
  const comps = o.comps || new Map();
  /* the competitions in the log, the most games first: the chart shades its bars by them where there is more than one */
  const tally = new Map();
  rows.forEach(r => { const c = (r.games || {}).competition_id; tally.set(c, (tally.get(c) || 0) + 1); });
  const order = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const compIx = new Map(order.map((c, i) => [c, i]));
  const multi = order.length > 1;

  const wrap = el('div', 'glog');
  if (o.colour && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(o.colour)) wrap.style.setProperty('--gl-a', o.colour);
  host.appendChild(wrap);
  /* the statistics to chart */
  const chips = el('div', 'glc-chips');
  chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'statistic to chart');
  chips.setAttribute('data-i18n-ctx', 'col');   // TO is turnovers and PF a foul here, as in a table's heading
  STATS.forEach(S => {
    const b = el('button', 'glc-chip', S.l);
    b.type = 'button'; b.dataset.k = S.k; b.title = S.t;
    b.onclick = () => choose(S.k);
    chips.appendChild(b);
  });
  wrap.appendChild(chips);
  const card = el('div', 'glc-card');
  const head = el('div', 'glc-head');
  const title = el('div', 'glc-t'), facts = el('div', 'glc-facts');
  head.append(title, facts);
  const read = el('div', 'glc-read');
  read.setAttribute('aria-live', 'polite');
  const plot = el('div', 'glc-plot');
  const key = el('div', 'glc-key');
  key.setAttribute('data-i18n-ctx', 'gamelog');   // "won", "a game": the key's own words
  card.append(head, plot, read, key);
  wrap.appendChild(card);

  /* the table */
  const tw = el('div', 'ft-wrap glt-wrap');
  const t = el('table', 'ft glt');
  const thead = el('thead'), hr = el('tr');
  COLS.forEach((h, i) => {
    const S = STATS.find(x => x.col === h);
    const th = el('th', (i < 2 ? 'stick c' + i : '') + (S ? ' pick' : ''), h);
    if (S) {
      th.dataset.k = S.k; th.title = 'chart ' + S.t + ' game by game'; th.tabIndex = 0;
      th.setAttribute('role', 'button');
      th.onclick = () => choose(S.k);
      th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(S.k); } };
    }
    hr.appendChild(th);
  });
  thead.appendChild(hr); t.appendChild(thead);
  const tb = el('tbody');
  const trs = rows.map(r => {
    const s = r.stats || {}, g = r.games || {};
    const tr = el('tr');
    tr.dataset.g = r.game_id;
    tr.appendChild(el('td', 'stick c0', dayOf(r) || '—'));
    const oppTd = el('td', 'stick c1'), cell = el('div', 'ft-name');
    if (r.__opp) {
      const a = el('a', null, (r.__home ? 'v ' : '@ ') + r.__opp.name);
      a.href = '../t/?t=' + encodeURIComponent(r.__opp.slug || '');
      a.setAttribute('translate', 'no');
      a.onclick = e => e.stopPropagation();
      cell.appendChild(a);
    } else cell.appendChild(el('span', null, '—'));
    oppTd.appendChild(cell); tr.appendChild(oppTd);
    const comp = el('td', 'glt-comp', comps.get(g.competition_id) || '');
    comp.setAttribute('translate', 'no');
    tr.appendChild(comp);
    const res = el('td', 'glt-res');
    if (r.__res) {
      const pill = el('span', 'glt-wl ' + (/^W/.test(r.__res) ? 'w' : 'l'), r.__res.slice(0, 1));
      res.append(pill, el('span', 'glt-sc', r.__res.slice(2)));
    }
    tr.appendChild(res);
    const cellFor = (k, text) => { const td = el('td', null, text); td.dataset.k = k; return td; };
    tr.appendChild(cellFor('min', Math.round(n0(s.min) / 60000) + "'"));
    [['pts', s.pts], ['reb', n0(s.or) + n0(s.dr)], ['ast', s.ast], ['stl', s.stl], ['blk', s.blk], ['to', s.to], ['pf', s.pf]]
      .forEach(([k, v]) => tr.appendChild(cellFor(k, v == null ? '' : v)));
    tr.appendChild(cellFor('fg', fgm(s) + '-' + fga(s)));
    tr.appendChild(cellFor('p3', n0(s.p3m) + '-' + n0(s.p3a)));
    tr.appendChild(cellFor('ft', n0(s.ftm) + '-' + n0(s.fta)));
    const pm = cellFor('pm', s.pm == null ? '' : (s.pm > 0 ? '+' : '') + s.pm);
    if (s.pm > 0) pm.classList.add('pos'); else if (s.pm < 0) pm.classList.add('neg');
    tr.appendChild(pm);
    const bp = cellFor('bpm', r.__bpm == null ? '\u2014' : (r.__bpm > 0 ? '+' : '') + r.__bpm.toFixed(1));
    if (r.__bpm > 0) bp.classList.add('pos'); else if (r.__bpm < 0) bp.classList.add('neg');
    tr.appendChild(bp);
    tr.style.cursor = 'pointer';
    tr.onclick = () => { if (o.boxHref) location.href = o.boxHref(r.game_id); };
    tb.appendChild(tr);
    return tr;
  });
  t.appendChild(tb); tw.appendChild(t); wrap.appendChild(tw);

  let ser = [], S = statOf(picked), sel = null;
  const W = () => Math.max(280, Math.round(plot.clientWidth || host.clientWidth || 640));
  const draw = () => {
    const narrow = W() < 520;
    plot.innerHTML = chartSVG(ser, S, { width: W(), height: narrow ? 200 : 236, comps: multi ? compIx : null, sel });
  };
  const say = i => {
    const p = ser[i];
    read.textContent = '';
    trs.forEach(tr => tr.classList.remove('lit'));
    plot.querySelectorAll('.glc-b.on').forEach(b => b.classList.remove('on'));
    if (!p) return;
    sel = i;
    const bar = plot.querySelector('.glc-b[data-i="' + i + '"]');
    if (bar) bar.classList.add('on');
    const tr = trs[rows.length - 1 - i];
    if (tr) tr.classList.add('lit');
    const r = p.row, g = r.games || {};
    const bits = [dayOf(r), r.__opp ? (r.__home ? 'v ' : '@ ') + r.__opp.name : '', comps.get(g.competition_id) || '', r.__res || ''].filter(Boolean);
    read.appendChild(el('span', 'glc-rw', bits.join(' · ')));
    const val = el('b', 'glc-rv', p.v == null ? 'no attempt' : fmt(p.v, S) + (S.frac ? ' (' + p.m + '/' + p.a + ')' : ''));
    if (p.v != null) { const u = el('span', 'glc-ru', S.l); u.setAttribute('data-i18n-ctx', 'col'); val.append(' ', u); }
    read.appendChild(val);
    const avg = over(ser, S);
    if (p.v != null && avg != null) {
      const d = p.v - avg, sp = el('span', 'glc-rd ' + tone(d, S), signed(d) + (S.k === 'bpm' ? ' on his average (' : ' on his season (') + fmtAvg(avg, S) + ')');
      read.appendChild(sp);
    }
    if (o.boxHref) {
      const a = el('a', 'glc-box', 'box score →');
      a.href = o.boxHref(r.game_id);
      read.appendChild(a);
    }
  };
  const tableSel = () => {
    const avg = over(ser, S);
    /* the spread of his games, for the tint's steps */
    const vs = ser.map(p => p.v).filter(v => v != null);
    const sd = vs.length > 1 ? Math.sqrt(vs.reduce((n, v) => n + (v - avg) * (v - avg), 0) / (vs.length - 1)) : 0;
    t.querySelectorAll('th.sel, td.sel').forEach(c => c.classList.remove('sel'));
    t.querySelectorAll('td[data-h]').forEach(c => c.removeAttribute('data-h'));
    const th = t.querySelector('th[data-k="' + S.k + '"]');
    if (th) th.classList.add('sel');
    trs.forEach((tr, j) => {
      const td = tr.querySelector('td[data-k="' + S.k + '"]');
      if (!td) return;
      td.classList.add('sel');
      const p = ser[rows.length - 1 - j];
      if (!p || p.v == null || avg == null || !(sd > 0)) return;
      const z = (p.v - avg) / sd, a = Math.abs(z);
      if (a < 0.5) return;
      const better = (z > 0) !== !!S.low;
      td.dataset.h = (better ? 'up' : 'dn') + (a >= 1.5 ? '2' : '1');
    });
  };
  const paintHead = () => {
    const sm = summary(ser, S);
    title.textContent = '';
    title.append(el('b', null, S.l), el('span', null, ' ' + S.t + ' game by game'));
    facts.textContent = '';
    const fact = (label, value, extra, cls) => {
      const f = el('span', 'glc-f' + (cls ? ' ' + cls : ''));
      f.append(el('i', null, label), el('b', null, value));
      if (extra) f.appendChild(extra);
      facts.appendChild(f);
    };
    /* a game's BPM averaged over his games is not his season's BPM (that is the season's box, summed): said apart */
    fact(S.k === 'bpm' ? 'avg of games' : 'season', fmtAvg(sm.season, S));
    if (sm.last != null && sm.season != null) {
      const d = sm.last - sm.season;
      fact('last ' + WINDOW, fmtAvg(sm.last, S), el('em', 'glc-d ' + tone(d, S), signed(d)));
    }
    if (sm.halves && sm.halves[0] != null && sm.halves[1] != null) {
      const d = sm.halves[1] - sm.halves[0];
      fact('1st half → 2nd', fmtAvg(sm.halves[0], S) + ' → ' + fmtAvg(sm.halves[1], S), el('em', 'glc-d ' + tone(d, S), signed(d)));
    }
    if (sm.best) fact('best', fmt(sm.best.v, S) + (S.frac ? ' (' + sm.best.m + '/' + sm.best.a + ')' : ''), el('em', 'glc-bd', dayOf(sm.best.row)));
    key.textContent = '';
    const k = (cls, label) => { const s = el('span', 'glc-k'); s.append(el('i', cls), document.createTextNode(label)); key.appendChild(s); };
    if (multi) order.forEach((c, i) => k('kb c' + Math.min(i, 3), comps.get(c) || 'other'));
    else k('kb c0', 'a game');
    k('ka', 'season average');
    k('kr', 'last ' + WINDOW + ' games, running');
    k('kw', 'won');
    k('kl', 'lost');
  };
  function choose(k) {
    S = statOf(k); picked = S.k;
    try { localStorage.setItem(KEEP, S.k); } catch (_) { /* this page only */ }
    ser = series(rows, S);
    chips.querySelectorAll('.glc-chip').forEach(b => { const on = b.dataset.k === S.k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    paintHead();
    draw();
    tableSel();
    say(sel != null && sel < ser.length ? sel : ser.length - 1);
  }
  /* point at a game, or tap it */
  const at = e => { const h = e.target && e.target.closest ? e.target.closest('.glc-hit, .glc-b') : null; return h ? +h.dataset.i : null; };
  plot.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; const i = at(e); if (i != null && i !== sel) say(i); });
  plot.addEventListener('click', e => { const i = at(e); if (i != null) say(i); });
  /* the chart is drawn to its width: again when that changes */
  if (typeof ResizeObserver === 'function') {
    let last = 0, tm = null;
    new ResizeObserver(() => { const w = W(); if (Math.abs(w - last) < 8) return; last = w; clearTimeout(tm); tm = setTimeout(() => { draw(); say(sel); }, 80); }).observe(plot);
  }
  sel = null;
  choose(picked);
}

return { render, series, over, rolling, summary, niceScale, chartSVG, STATS, WINDOW };
}));
