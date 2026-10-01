'use strict';
/* ============================================================================
   /epinoia/winning/ — WHAT WINS (docs/what-wins-model.md §11, addendum A.2).

   ONE FILE DRAWS THE PAGE. The analysis is built on the server from every finished game's feature line and arrives
   as one versioned file through EpinoiaWinFile (winfile.js): the league-season's `wins` file, the pooled one for
   every league, and the Front office `fo` file only when the simulator is opened. This script reads nothing else
   but the public leagues and seasons rows (for the pickers and the league's colours): never a game's events, box
   scores, lineups or feature lines. Nothing is kept in localStorage; the loader caches per user in sessionStorage,
   and the old page's localStorage copy (epinoia_winning_v1) is removed here too.

   NOT ENTITLED (signed out where sign-in is required, or not a member where memberships are on): the public
   box-score preview (the teaser) draws the short answer and the measures; every members' section keeps its title and
   shows the membership placeholder (or a sign-in link). #method is always public.

   THE STATUS LINE AND RECALCULATE (A.2): "Model of N games · built 2 h ago · 12 new games since". RECALCULATE is on
   only when games are pending; it asks the function to fold them in (refresh), with a staged CEEFAX-style bar:
   checking, updating the model, downloading, re-simulating (the Worker's own progress), drawing. Cancel stops the
   client's steps; an update the server had started still finishes and is reused next time.

   STRUCTURE: views[id](ctx) are pure (HTML strings and chart specs, every value escaped) so node tests can draw each
   section from the fixtures; mount() puts them on the page and binds the charts (vizkit.js). In node this file
   exports {views, cards, statusLine, ...} and never touches a document.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinPage = api;
  if (root.document && root.document.getElementById && root.document.getElementById('ww')) api.boot();
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const LEGACY = 'epinoia_winning_v1';
const SECTIONS = ['answer', 'value', 'factors', 'curves', 'tempo', 'positions', 'squad', 'sim', 'losses', 'leagues', 'model', 'method'];
const MEMBER = ['value', 'factors', 'curves', 'tempo', 'positions', 'squad', 'sim', 'losses', 'leagues', 'model'];
const CORE = ['c_efg', 'c_tovp', 'c_orebp', 'c_ftmr'];
const LENS = { explain: 'Explains', forecast: 'Forecasts', model: 'Model', preview: 'Box-score preview' };
const P1_LABEL = { ts: 'True shooting', usg_share: 'Usage share', ast_share: 'Assist share', reb_share: 'Rebound share', stocks40: 'Steals + blocks per 40',
  tov_share: 'Turnover share', p3a_rate: '3PA rate' };
const SQUAD_LABEL = { rot_n: 'Rotation size', top5_share: 'Top five’s minutes', star_pts_share: 'Star’s share of points', usg_hhi: 'Usage concentration',
  pos_entropy: 'Positional balance', shooters: 'Shooters in the rotation', handlers: 'Handlers in the rotation', protectors: 'Rim protectors', bench_share: 'Bench minutes',
  depth_bpm: 'Depth (players 6-9)', talent: 'Talent (BPM)', continuity: 'Continuity', starter_stability: 'Starting five kept', availability: 'Availability',
  height_w: 'Height', age_w: 'Age' };
const GROUP = { G: 'Guards', F: 'Wings', C: 'Bigs' };
const PART_LABEL = { expected: 'expected', quality: 'shot quality', making: 'shot-making', efg: 'shooting', c_efg: 'shooting', tovp: 'turnovers', c_tovp: 'turnovers',
  orebp: 'boards', c_orebp: 'boards', ftmr: 'free throws', c_ftmr: 'free throws', other: 'other', garbage: 'garbage time' };
/* the six simulator dials (§12 what-if ranges), on a side's offence */
const DIALS = [
  { key: 'efg', label: 'eFG%', min: -5, max: 5, step: 0.5, unit: 'pp' },
  { key: 'tovp', label: 'TOV%', min: -4, max: 4, step: 0.5, unit: 'pp' },
  { key: 'orebp', label: 'OREB%', min: -8, max: 8, step: 1, unit: 'pp' },
  { key: 'ftr', label: 'FT rate', min: -10, max: 10, step: 1, unit: 'pp' },
  { key: 'p3r', label: '3PA rate', min: -10, max: 10, step: 1, unit: 'pp' },
  { key: 'secs', label: 'Seconds per possession', min: -3, max: 3, step: 0.5, unit: 's' }
];

/* ------------------------------------------------------------------ helpers --- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
const MINUS = s => s.replace(/^-/, '−');                                          // a true minus sign in words
const f1 = v => (isNum(v) ? MINUS((Math.round(v * 10) / 10).toFixed(1)).replace(/^−0\.0$/, '0.0') : '–');
const f2 = v => (isNum(v) ? MINUS(v.toFixed(2)).replace(/^−0\.00$/, '0.00') : '–');
const sg = (v, d) => (isNum(v) ? (v > 0 ? '+' : '') + MINUS(v.toFixed(d == null ? 1 : d)) : '–');
const pc = v => (isNum(v) ? Math.round(v * 100) + '' : '–');                      // a share as a whole per cent, no sign
const rng = (lo, hi, fmt) => (isNum(lo) && isNum(hi) ? fmt(lo) + '–' + fmt(hi) : '');
const label = (W, k) => (W && W.meta && W.meta[k] && W.meta[k].label) || P1_LABEL[k] || SQUAD_LABEL[k] || k;
const defOf = (W, k) => (W && W.meta && W.meta[k] && W.meta[k].def) || '';
const dirOf = (W, k) => (W && W.meta && W.meta[k] ? W.meta[k].dir : 1);
const chip = (lens, n, extra) => '<span class="ww-chip" data-lens="' + lens + '">' + esc(LENS[lens] || lens) + '</span>' +
  (isNum(n) ? ' <span class="ww-n" translate="no">n = ' + n + '</span>' : '') + (extra ? ' <span class="ww-chipx">' + esc(extra) + '</span>' : '');
const empty = msg => '<div class="pg-empty"><p>' + esc(msg) + '</p></div>';
const seg = (act, items, on, aria) => '<div class="pg-seg" role="group" aria-label="' + esc(aria) + '">' +
  items.map(([v, t]) => '<button type="button" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + (v === on) + '">' + esc(t) + '</button>').join('') + '</div>';
const sel = (act, items, on, aria, names) => '<select class="ep-input" data-act="' + act + '" aria-label="' + esc(aria) + '">' +
  items.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === on ? ' selected' : '') + (names && v ? ' translate="no"' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
const ago = (iso, now) => {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  const m = Math.max(0, Math.round(((now || Date.now()) - t) / 60000));
  if (m < 2) return 'built just now';
  if (m < 60) return 'built ' + m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 48) return 'built ' + h + ' h ago';
  return 'built ' + Math.round(h / 24) + ' days ago';
};
const chartSlot = (spec, list) => { list.push(spec); return '<div class="ww-chart" data-chart="' + (list.length - 1) + '"></div>'; };
const locked = rows => ({ state: 'locked', html: '<div class="ww-lock" data-memlock="' + (rows || 5) + '"></div>', charts: [] });

/* ------------------------------------------------------------------ the status line (A.2) --- */
/* {line, canRecalc, upToDate} from a file answer: "Model of N games · built 2 h ago · 12 new games since" */
function statusLine(ans, W, o) {
  o = o || {};
  if (!W) return { line: '', canRecalc: false, upToDate: false };
  const n = W.n && W.n.games, parts = [];
  if (isNum(n)) parts.push('Model of ' + n + ' games');
  const b = ago((ans && ans.built) || W.built, o.now);
  if (b) parts.push(b);
  const pend = ans && isNum(ans.pending) ? ans.pending : null;
  if (pend > 0) parts.push(pend + (pend === 1 ? ' new game since' : ' new games since'));
  else if (pend === 0) parts.push('up to date');
  return { line: parts.join(' · '), canRecalc: !!(W.league && pend > 0), upToDate: pend === 0 };
}

/* ------------------------------------------------------------------ the cards (§11) --- */
/* ≤ 6, fixed templates, interval-backed only; each with its lens chip */
function cards(W) {
  const out = [];
  if (!W || !W.models || !W.models.core4c) return out;
  const C = W.models.core4c, n = W.n && W.n.games;
  const sh = (C.shares || []).find(s => s.k === 'c_efg');
  if (sh && isNum(sh.phi) && isNum(sh.lo)) out.push({ lens: 'explain', n, text: 'Shooting decides ' + pc(sh.phi) + '% of the margin here (' + pc(sh.lo) + '–' + pc(sh.hi) + ')' });
  const hard = Object.keys(W.curves || {}).map(k => ({ k, h: W.curves[k].hard })).filter(x => x.h && x.h.n >= 50 && isNum(x.h.lo))
    .sort((a, b) => Math.abs(b.h.p - 0.5) - Math.abs(a.h.p - 0.5))[0];
  if (hard) out.push({ lens: 'explain', n: hard.h.n, k: hard.k, text: 'Sides ahead by ' + hard.h.t + ' or more on ' + label(W, hard.k) + ' won ' + pc(hard.h.p) + '% (' + pc(hard.h.lo) + '–' + pc(hard.h.hi) + ') of ' + hard.h.n + ' games' });
  const g = W.tempo && W.tempo.sqrtN;
  if (g && g.gamma && isNum(g.gamma.lo)) {
    out.push(g.gamma.lo > 0 ? { lens: 'forecast', n: g.n, text: 'More possessions help the favourite: γ = ' + f2(g.gamma.v) + ' (' + f2(g.gamma.lo) + '–' + f2(g.gamma.hi) + ')' }
      : { lens: 'forecast', n: g.n, text: 'The pace of a game does not change who wins here, once quality is counted' });
  }
  if (C.home && isNum(C.home.v) && W.homeWin && isNum(W.homeWin.p)) out.push({ lens: 'explain', n, text: 'Home court is worth ' + f1(C.home.v) + ' points (' + f1(C.home.lo) + '–' + f1(C.home.hi) + ') and ' + pc(W.homeWin.p) + '% of games' });
  const best = (C.coef || []).filter(c => c.wins30 && isNum(c.wins30.v) && isNum(c.wins30.lo)).sort((a, b) => Math.abs(b.wins30.v) - Math.abs(a.wins30.v))[0];
  if (best) out.push({ lens: 'explain', n, k: best.k, text: 'One team-SD better at ' + label(W, best.k) + ' is worth ' + f1(Math.abs(best.wins30.v)) + ' wins per 30 games (' +
    f1(Math.min(Math.abs(best.wins30.lo), Math.abs(best.wins30.hi))) + '–' + f1(Math.max(Math.abs(best.wins30.lo), Math.abs(best.wins30.hi))) + ')' });
  const top = (W.path || []).find(p => p.k === 'top_avg');
  if (top && top.indirect && isNum(top.indirect.lo) && (top.indirect.lo > 0 || top.indirect.hi < 0) && top.via && top.via.length) {
    const via = top.via.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    const s = Math.abs(top.indirect.v) / ((Math.abs(top.direct.v) + Math.abs(top.indirect.v)) || 1);
    out.push({ lens: 'explain', n, text: 'Time of possession works mostly through ' + label(W, via.f) + ': ' + Math.round(100 * s) + '% of its effect is indirect' });
  }
  return out.slice(0, 6);
}
const cardHTML = c => '<article class="ww-card"' + (c.k ? ' data-k="' + esc(c.k) + '"' : '') + '><p class="ww-ctext">' + esc(c.text) + '</p><p class="ww-cmeta">' + chip(c.lens, c.n) + '</p></article>';

/* ------------------------------------------------------------------ the views --- */
/* ctx = {W, ans, fo, foState, club, clubState, teaser, entitled, reason, pooledFallback, st: page state} -> {state, html, charts} */
const views = {
  answer(ctx) {
    const W = ctx.W;
    if (W) {
      const cs = cards(W);
      let html = '';
      if (ctx.pooledFallback) html += empty('Fewer than 20 finished games here yet: showing every league pooled');
      html += cs.length ? '<div class="ww-cardgrid">' + cs.map(cardHTML).join('') + '</div>' : empty('The short answer appears once the model has its first full build here');
      return { state: 'ok', html, charts: [] };
    }
    if (ctx.teaser) {
      const T = root.EpinoiaWinning;
      const words = T && T.fromTeaser ? T.insights(T.fromTeaser(ctx.teaser)) : [];
      return { state: 'preview', html: '<div class="ww-cardgrid">' + words.slice(0, 5).map(t => cardHTML({ lens: 'preview', n: ctx.teaser.n, text: t })).join('') + '</div>' + ctx.gateNote, charts: [] };
    }
    return { state: 'empty', html: ctx.message ? empty(ctx.message) : '', charts: [] };
  },

  value(ctx) {
    const W = ctx.W, st = ctx.st;
    if (!W) return locked(6);
    const C = W.models.core4c, charts = [];
    let html = '<div class="pg-row ww-ctl">' + seg('lens', [['explain', 'Explains'], ['forecast', 'Forecasts']], st.lens, 'Lens') +
      (st.lens === 'explain' ? seg('unit', [['pts', 'Points'], ['wins', 'Wins per 30'], ['unit', 'Per unit']], st.unit, 'Units') : '') + '</div>';
    if (st.lens === 'forecast') {
      const P = W.predictive;
      html += '<p class="ww-lead">' + chip('forecast', P && P.nEval) + '</p>';
      if (!P || !P.live) html += empty('Season numbers do not forecast better than Elo here');
      if (P && P.coef && P.coef.length) {
        html += chartSlot({ kind: 'forest', label: 'Forecast coefficients', data: P.coef.map(c => ({ id: c.k, label: label(W, c.k), v: c.b, lo: c.lo, hi: c.hi, muted: !P.live })),
          o: { x: { label: 'points of margin per unit of the expected difference' }, title: 'What the forecast leans on', desc: 'Coefficients of the forecast model, with 95% ranges' } }, charts);
      }
      return { state: 'ok', html, charts };
    }
    const unit = st.unit;
    const val = c => unit === 'wins' ? c.wins30 : unit === 'unit' ? { v: c.b, lo: c.lo, hi: c.hi } : c.pts;
    const sd = c => (c.sdTeam && c.sdTeam.net) || 1;
    const rows = C.coef.map(c => {
      const v = val(c) || {};
      const own = c.own && isNum(c.own.v) ? (unit === 'unit' ? c.own : unit === 'pts' ? { v: c.own.v * sd(c), lo: c.own.lo * sd(c), hi: c.own.hi * sd(c) } : null) : null;
      return { id: c.k, label: label(W, c.k), v: isNum(v.v) ? (unit === 'unit' ? v.v : Math.abs(v.v)) : null,
        lo: isNum(v.lo) ? (unit === 'unit' ? v.lo : Math.min(Math.abs(v.lo), Math.abs(v.hi))) : null, hi: isNum(v.hi) ? (unit === 'unit' ? v.hi : Math.max(Math.abs(v.lo), Math.abs(v.hi))) : null,
        shrunk: c.w > 0, own: own && unit !== 'unit' ? { v: Math.abs(own.v), lo: Math.min(Math.abs(own.lo), Math.abs(own.hi)), hi: Math.max(Math.abs(own.lo), Math.abs(own.hi)) } : own,
        badge: isNum(c.vif) && c.vif > 5 ? 'VIF ' + f1(c.vif) : '', cls: isNum(c.vif) && c.vif > 10 ? 'ww-vifred' : '',
        detail: defOf(W, c.k) + (c.w > 0 ? ' · ' + pc(c.w) + '% from every league' : '') };
    }).filter(r => isNum(r.v));
    const xl = unit === 'wins' ? 'wins per 30 games for one team-SD better' : unit === 'unit' ? 'points of margin per unit (pp)' : 'points of margin per game for one team-SD better';
    html += '<p class="ww-lead">' + chip('explain', C.n) + ' <span class="ww-legend"><i class="ww-k-solid"></i>this league <i class="ww-k-hollow"></i>leaning on every league <i class="ww-k-ghost"></i>its own data alone</span></p>';
    html += chartSlot({ kind: 'forest', pick: 'curves', label: 'What each factor is worth', data: rows,
      o: { x: { label: xl }, title: 'What each factor is worth', desc: 'Each of the four factors: points or wins for one step better, with 95% ranges' } }, charts);
    if (W.sigma && isNum(W.sigma.pred)) html += '<p class="ww-note">' + esc('Points become wins through the spread of results around a pre-game expectation (σ = ' + f1(W.sigma.pred) + ' points), never through the much smaller spread the factors leave over (' + f1(W.sigma.acc) + ')') + '</p>';
    if (C.shares && C.shares.length) {
      const olv = C.oliver || {};
      html += '<h3 class="ww-h3">Shares of what the four factors explain</h3>';
      html += chartSlot({ kind: 'stackShare', label: 'Shares of the margin the four factors explain', data: [
        { label: 'Measured here', parts: C.shares.map(s => ({ k: s.k, label: label(W, s.k), v: s.phi, lo: isNum(s.lo) ? 100 * s.lo : null, hi: isNum(s.hi) ? 100 * s.hi : null })) },
        { label: 'Dean Oliver', parts: CORE.map(k => ({ k, label: label(W, k), v: olv[k] != null ? olv[k] : { c_efg: 0.4, c_tovp: 0.25, c_orebp: 0.2, c_ftmr: 0.15 }[k] })) }],
        o: { title: 'Shares of the margin', desc: 'Exact Shapley shares of R² against Dean Oliver’s 40 / 25 / 20 / 15' } }, charts);
      if (C.legacy) html += '<details class="ww-details"><summary>The old |b| × spread shares</summary><p>' + CORE.map(k => esc(label(W, k)) + ' <span class="ww-num" translate="no">' + pc(C.legacy[k]) + '%</span>').join('<br>') + '</p></details>';
      html += '<p class="ww-note">' + esc('The four factors explain ' + pc(C.r2) + '% of the competitive margin (' + pc(C.r2cv) + '% out of sample); on the full-game margin, ' + pc(W.models.fullR2) + '%') + '</p>';
    }
    /* pick the factors yourself: a re-fit from the file's weekly blocks, in the Worker */
    if (W.blocks && W.blocks.keys && W.blocks.list && W.blocks.list.length) {
      const picks = st.picks || CORE.slice();
      html += '<h3 class="ww-h3">Pick the factors yourself</h3><div class="ww-picks" role="group" aria-label="Factors in the re-fit">' +
        W.blocks.keys.filter(k => k !== 'h').map(k => '<label class="ww-check"><input type="checkbox" data-act="pick" value="' + esc(k) + '"' + (picks.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(label(W, k)) + '</label>').join('') +
        '</div><div class="pg-row"><button type="button" class="ep-btn" data-act="refit">Re-fit</button></div>';
      if (st.refit && st.refit.state === 'running') html += '<p class="ww-note" aria-live="polite">Re-fitting with 200 bootstrap draws…</p>';
      if (st.refit && st.refit.state === 'done' && st.refit.result) {
        const r = st.refit.result;
        html += chartSlot({ kind: 'forest', label: 'Your re-fit', data: r.keys.map((k, i) => ({ id: k, label: k === 'h' ? 'Home court' : label(W, k), v: r.b[i], lo: r.lo[i], hi: r.hi[i] })),
          o: { x: { label: 'points of margin per unit' }, title: 'Your re-fit', desc: 'Ridge re-fit on the chosen factors, block bootstrap 95% ranges' } }, charts);
      }
      if (st.refit && st.refit.state === 'error') html += empty('The re-fit could not run here: ' + st.refit.error);
    } else html += '<p class="ww-note">Re-fitting with factors of your choice needs a league’s own file.</p>';
    return { state: 'ok', html, charts };
  },

  factors(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) {
      if (ctx.teaser && ctx.teaser.ranked && ctx.teaser.ranked.length) {
        const T = ctx.teaser;
        return { state: 'preview', html: '<p class="ww-lead">' + chip('preview', T.n) + '</p>' + chartSlot({ kind: 'bars', label: 'Box-score measures and winning', data: T.ranked.map(m => ({ id: m.k, label: m.label, v: m.r })),
          o: { x: { label: 'correlation with winning (r)' }, title: 'Box-score measures and winning', desc: 'The public preview: each box-score measure’s correlation with winning' } }, charts) + ctx.gateNote, charts };
      }
      return locked(8);
    }
    const scan = (W.scan || []).slice();
    if (!scan.length) return { state: 'empty', html: empty('The measures appear once the league has 20 finished games'), charts };
    let html = '<div class="pg-row ww-ctl">' + seg('fview', [['bars', 'Bars'], ['table', 'Table']], st.fview, 'View') + '</div>';
    html += '<p class="ww-lead">' + chip('explain', W.n.games) + ' <span class="ww-legend">grey: not distinguishable from noise (q ≥ 0.05)</span></p>';
    const key = st.sortKey, dir = st.sortDir;
    const val = s => key === 'k' ? label(W, s.k) : key === 'won' ? s.wonIt : key === 'q' ? s.q : Math.abs(s.r);
    scan.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    if (st.fview === 'bars') {
      html += chartSlot({ kind: 'bars', pick: 'curves', label: 'Every measure against winning', data: scan.map(s => ({ id: s.k, label: label(W, s.k), v: s.r, lo: s.lo, hi: s.hi, dir: 1,
        muted: !(s.q < 0.05), badge: s.score ? 'part of the score' : '', detail: defOf(W, s.k) + ' · won it, won the game ' + pc(s.wonIt) + '% of ' + s.decided })),
        o: { x: { label: 'correlation with winning (r), better side up' }, title: 'Every measure against winning', desc: 'Point-biserial correlation of each measure’s difference with winning, with 95% ranges' } }, charts);
    } else {
      const th = (k, t) => '<th scope="col"><button type="button" data-act="sort" data-v="' + k + '" aria-sort="' + (key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + esc(t) + '</button></th>';
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr>' + th('k', 'Measure') + th('r', 'r with winning') + th('q', 'q') + th('won', 'Won it, won') +
        '<th scope="col">Winners</th><th scope="col">Losers</th><th scope="col">VIF</th></tr></thead><tbody>' +
        scan.map(s => '<tr' + (s.q < 0.05 ? '' : ' class="ww-grey"') + '><th scope="row">' + esc(label(W, s.k)) + (s.score ? ' <span class="ww-badge">part of the score</span>' : '') + '</th>' +
          '<td translate="no">' + f2(s.r) + ' <small>' + rng(s.lo, s.hi, f2) + '</small></td><td translate="no">' + (isNum(s.q) ? s.q < 0.001 ? '<0.001' : s.q.toFixed(3) : '–') + '</td>' +
          '<td translate="no">' + pc(s.wonIt) + '% <small>' + rng(s.wonLo, s.wonHi, pc) + '</small></td><td translate="no">' + f1(s.winMean) + '</td><td translate="no">' + f1(s.loseMean) + '</td>' +
          '<td translate="no" class="' + (s.vif > 10 ? 'ww-red' : s.vif > 5 ? 'ww-amber' : '') + '">' + (isNum(s.vif) ? f1(s.vif) : '–') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    return { state: 'ok', html, charts };
  },

  curves(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const keys = Object.keys(W.curves || {});
    if (!keys.length) return { state: 'empty', html: empty('The curves appear once a factor has 60 games with both sides measured'), charts };
    const k = keys.indexOf(st.k) >= 0 ? st.k : keys[0], c = W.curves[k];
    let html = '<div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Factor</span>' + sel('k', keys.map(x => [x, label(W, x)]), k, 'Factor') + '</label></div>';
    html += '<p class="ww-lead">' + chip('explain', c.bins.reduce((s, b) => s + (b[3] || 0), 0)) + '</p>';
    if (c.hard) html += '<p class="ww-hard">Sides ahead by ' + esc(c.hard.t) + ' or more on ' + esc(label(W, k)) + ' won ' + pc(c.hard.p) + '% (' + pc(c.hard.lo) + '–' + pc(c.hard.hi) + ') of ' + c.hard.n + ' games</p>';
    html += chartSlot({ kind: 'binnedCurve', label: 'Chance of winning across the gap in ' + label(W, k), data: { bins: c.bins, raw: c.raw, adj: c.adj, x50: c.x50, x75: c.x75 },
      o: { x: { label: label(W, k) + ' difference (this side less the other)' }, title: 'Chance of winning by ' + label(W, k) + ' gap', desc: 'Win share in bins with Wilson ranges, the fitted curve with its band, and the break-even points' } }, charts);
    const marks = [];
    if (c.x50 && isNum(c.x50.v)) marks.push('Break-even at ' + f1(c.x50.v) + ' (' + rng(c.x50.lo, c.x50.hi, f1) + ')');
    if (c.x75 && isNum(c.x75.v)) marks.push((marks.length ? 'three' : 'Three') + ' wins in four at ' + f1(c.x75.v) + ' (' + rng(c.x75.lo, c.x75.hi, f1) + ')');
    if (marks.length) html += '<p class="ww-note">' + marks.map(m => '<span>' + esc(m) + '</span>').join('; ') + '</p>';
    if (c.adj) html += '<p class="ww-note">The dashed line holds the other three factors level.</p>';
    if (c.hist && c.hist.length) html += '<h3 class="ww-h3">How often each gap happens</h3>' + chartSlot({ kind: 'histogram', label: 'Games by ' + label(W, k) + ' gap', data: c.hist,
      o: { x: { label: label(W, k) + ' difference' }, countLabel: 'games', mark: 0, title: 'Games by gap', desc: 'How many games had each difference' } }, charts);
    if (c.quart && c.quart.length) html += '<h3 class="ww-h3">By quarter of the gap</h3>' + chartSlot({ kind: 'bars', label: 'Win share by quarter of the gap', data: c.quart.map((q, i) => ({ id: 'q' + i,
      label: f1(q.lo) + ' to ' + f1(q.hi), v: 100 * (q.p - 0.5), lo: 100 * (q.plo - 0.5), hi: 100 * (q.phi - 0.5), detail: q.n + ' games' })),
      o: { x: { label: 'won, points of share above or below half', fmt: v => (v > 0 ? '+' : '') + Math.round(v) }, title: 'Win share by quarter', desc: 'Each quarter of the gap: share of games won, minus 50' } }, charts);
    return { state: 'ok', html, charts };
  },

  tempo(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const T = W.tempo;
    if (!T) return { state: 'empty', html: empty('Pace and possession appear once the games have timed possessions'), charts };
    let html = '<p class="ww-lead">' + chip('explain', (T.teams || []).length) + ' <span class="ww-legend">Pace is the same for both sides of a game, so it never enters a difference model.</span></p>';
    if (T.teams && T.teams.length) {
      html += '<h3 class="ww-h3">Team pace and winning</h3>' + chartSlot({ kind: 'scatter', brush: true, label: 'Team pace against winning', data: T.teams.map(t => ({ id: t.id, x: t.pace3q, y: 100 * t.winPct,
        label: t.name, detail: t.gp + ' games, net ' + sg(t.net) + ' per 100', cls: (st.brushed && st.brushed.indexOf(t.id) < 0) ? 'vz-s1f vz-dim' : 'vz-s1f' })),
        o: { x: { label: 'possessions per 40 (first three quarters)' }, y: { label: 'won %', fmt: v => Math.round(v) + '%' }, brush: true, title: 'Team pace and winning', desc: 'Each team-season’s pace against its share of wins; drag to pick teams' } }, charts);
      html += '<p class="ww-note ww-brushed" aria-live="polite">' + (st.brushed && st.brushed.length ? esc('Picked: ' + T.teams.filter(t => st.brushed.indexOf(t.id) >= 0).map(t => t.name).join(', ')) : 'Drag across the chart to pick teams.') + '</p>';
    }
    if (T.bins && T.bins.length) html += chartSlot({ kind: 'binnedCurve', label: 'Winning by team tempo', data: { bins: T.bins, raw: T.curve, adj: T.curveAdj },
      o: { x: { label: 'team pace, z within the league' }, title: 'Winning by team tempo', desc: 'Win share by fifth of team tempo; the dashed line holds net rating level' } }, charts);
    const g = T.sqrtN;
    if (g) {
      html += '<h3 class="ww-h3">Do more possessions help the favourite?</h3>' + chip('forecast', g.n);
      html += '<p class="ww-hard">' + esc(g.gamma.lo > 0 ? 'More possessions help the favourite: γ = ' + f2(g.gamma.v) + ' (' + f2(g.gamma.lo) + '–' + f2(g.gamma.hi) + ')' :
        'The pace of a game does not change who wins here, once quality is counted') + '</p>';
      html += chartSlot({ kind: 'line', label: 'The favourite’s chance by expected possessions', data: [
        { k: 'obs', label: 'observed', pts: g.terciles.map(t => [t.rho, 100 * t.p, 100 * t.lo, 100 * t.hi]) },
        { k: 'fit', label: 'fitted', dash: true, pts: g.terciles.map(t => [t.rho, 100 * t.fit]) }],
        o: { x: { label: 'expected possessions against the league’s' }, y: { label: 'favourite won %', fmt: v => Math.round(v) + '%' }, title: 'Favourite’s win share by expected possessions', desc: 'Terciles of pre-game expected possessions' } }, charts);
      html += '<p class="ww-note">' + esc('A likelihood-ratio test of no effect gives p = ' + f2(g.lrP) + '; the structural value is 0.5') + '</p><p class="ww-note">Expected possessions come from each side’s pace before the game, never the pace it ended with.</p>';
    }
    if (T.control) html += '<h3 class="ww-h3">Who sets the tempo</h3><p class="ww-note">' + chip('explain', T.control.n, 'descriptive') + '</p><p class="ww-hard">Where the two paces differ, the side whose pace the game took won ' +
      pc(T.control.p) + '% (' + pc(T.control.lo) + '–' + pc(T.control.hi) + ') of ' + T.control.n + ' games; odds ratio ' + f2(T.control.or.v) + ' (' + f2(T.control.or.lo) + '–' + f2(T.control.or.hi) + ')</p>';
    const top = (W.path || []).filter(p => ['top_avg', 'early_share', 'top_share'].indexOf(p.k) >= 0);
    if (top.length) {
      html += '<h3 class="ww-h3">Time of possession: direct and through the four factors</h3>' + chartSlot({ kind: 'forest', label: 'Time of possession, direct and indirect', data: top.flatMap(p => [
        { id: p.k + ':d', label: label(W, p.k) + ' · direct', v: p.direct.v, lo: p.direct.lo, hi: p.direct.hi },
        { id: p.k + ':i', label: label(W, p.k) + ' · via the factors', v: p.indirect.v, lo: p.indirect.lo, hi: p.indirect.hi, shrunk: true },
        { id: p.k + ':t', label: label(W, p.k) + ' · total', v: p.total.v, lo: p.total.lo, hi: p.total.hi }]),
        o: { x: { label: 'points of margin per unit' }, title: 'Time of possession effects', desc: 'Direct effect, the part through the four factors, and the total, with 95% ranges' } }, charts);
      html += '<p class="ww-note">The direct effect is the headline: short possessions are partly transition and offensive rebounds, which the factors already count.</p>';
    }
    if (T.windows) html += '<h3 class="ww-h3">Points per chance by shot clock</h3>' + chartSlot({ kind: 'bars', label: 'Points per first chance by time used', data: [
      { id: 'e', label: 'within 8 s', v: T.windows.e.v, lo: T.windows.e.lo, hi: T.windows.e.hi, cls: 'vz-s1f' },
      { id: 'm', label: '8 to 16 s', v: T.windows.m.v, lo: T.windows.m.lo, hi: T.windows.m.hi, cls: 'vz-s1f' },
      { id: 'l', label: 'over 16 s', v: T.windows.l.v, lo: T.windows.l.lo, hi: T.windows.l.hi, cls: 'vz-s1f' }],
      o: { x: { label: 'points per chance', lo: 0, hi: 1.4 }, title: 'Points per chance by shot clock', desc: 'League points per first chance by time used, with 95% ranges' } }, charts);
    return { state: 'ok', html, charts };
  },

  positions(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const P = W.positions;
    if (!P) return { state: 'empty', html: empty('Positions appear once rosters list positions or heights for most of the minutes'), charts };
    let html = '<p class="ww-lead">' + chip('explain', W.n.games) + ' <span class="ww-legend">' + esc('Positions are estimated: ' + pc(P.coverage.listed) + '% listed, ' + pc(P.coverage.height) + '% by height, ' + pc(P.coverage.bpmOnly) + '% from the box score alone') + '</span></p>';
    const stats = [...new Set(P.p1.map(r => r.stat))];
    if (P.p1.length) {
      html += '<h3 class="ww-h3">What each group’s numbers are worth</h3>' + chartSlot({ kind: 'heatmap', label: 'Points per team-SD by group and statistic', data: { rows: ['G', 'F', 'C'].map(g => GROUP[g]), cols: stats.map(s => P1_LABEL[s] || s), mode: 'div',
        cells: ['G', 'F', 'C'].map(g => stats.map(s => { const r = P.p1.find(x => x.g === g && x.stat === s); return r ? { v: r.b, lo: r.lo, hi: r.hi, label: f1(r.b) + (r.star ? '★' : ''), detail: r.star ? 'range excludes 0 after the false-discovery check' : '' } : null; })) },
        o: { dp: 1, title: 'Points per team-SD by group', desc: 'Positional accounting: points of margin per team-SD better in each group’s statistic; ★ where the range excludes 0' } }, charts);
    }
    if (P.p2.length) {
      const g = ['G', 'F', 'C'].indexOf(st.posG) >= 0 ? st.posG : 'G';
      html += '<h3 class="ww-h3">What winners get from each group</h3><div class="pg-row ww-ctl">' + seg('posG', [['G', 'Guards'], ['F', 'Wings'], ['C', 'Bigs']], g, 'Group') + '</div>';
      /* each statistic on its own scale: per cent above or below the league's median (the values are in the table) */
      const rel = (v, m) => (isNum(v) && isNum(m) && m !== 0 ? 100 * (v / m - 1) : null);
      html += chartSlot({ kind: 'dumbbell', label: 'What winners get from ' + GROUP[g].toLowerCase(), data: P.p2.filter(r => r.g === g).map(r => ({ id: r.stat, label: P1_LABEL[r.stat] || r.stat,
        pts: [{ k: 'top', label: 'top quarter', v: rel(r.top, r.mid), lo: rel(r.topLo, r.mid), hi: rel(r.topHi, r.mid), cls: GROUPCLS[g] }, { k: 'mid', label: 'league', v: 0, cls: 'vz-neuf' },
              { k: 'bottom', label: 'bottom quarter', v: rel(r.bottom, r.mid), cls: 'vz-neuf' }] })),
        o: { x: { label: '% above or below the league’s median', fmt: v => (v > 0 ? '+' : '') + Math.round(v) + '%' }, title: 'What winners get', desc: 'Median of the top quarter by net rating and of the bottom quarter, against the league' } }, charts);
      html += '<p class="ww-note ww-vals">' + P.p2.filter(r => r.g === g).map(r => '<span>' + esc(P1_LABEL[r.stat] || r.stat) + '</span> <span class="ww-num" translate="no">' + f1(r.top) + ' / ' + f1(r.mid) + ' / ' + f1(r.bottom) + '</span>').join('<br>') + '</p>';
    }
    if (P.p2f && P.p2f.length) html += '<h3 class="ww-h3">Does a better group forecast wins?</h3>' + chip('forecast', W.n.games) + chartSlot({ kind: 'forest', label: 'Forecast value of each group’s talent', data: P.p2f.map(r => ({ id: r.g, label: GROUP[r.g], v: r.b, lo: r.lo, hi: r.hi, cls: GROUPCLS[r.g] })),
      o: { x: { label: 'points of margin per point of minutes-weighted BPM' }, title: 'Slot forecast', desc: 'Season-to-date BPM by group as a forecast of the margin' } }, charts);
    return { state: 'ok', html, charts };
  },

  squad(ctx) {
    const W = ctx.W, charts = [];
    if (!W) return locked(6);
    const L = W.lineup, Q = W.squad;
    if (!L && !Q) return { state: 'empty', html: empty('Squad shapes appear once lineups and rosters cover enough games'), charts };
    let html = '';
    if (L && L.grid && L.grid.length) {
      html += '<h3 class="ww-h3">Lineup mixes</h3><p class="ww-lead">' + chip('explain', L.n) + ' <span class="ww-legend">net per 100 possessions against two shooters, one big, one handler and one protector; hatched under 200 possessions</span></p>';
      html += chartSlot({ kind: 'heatmap', label: 'Lineup net rating by shooters and bigs', data: { rows: [0, 1, 2, 3, 4, 5].map(s => s + (s === 1 ? ' shooter' : ' shooters')), cols: ['0 bigs', '1 big', '2+ bigs'], mode: 'div',
        cells: [0, 1, 2, 3, 4, 5].map(s => ['0', '1', '2+'].map(b => { const c = L.grid.find(x => x.s === s && x.b === b); return c ? { v: c.net, lo: c.lo, hi: c.hi, hatch: c.poss < 200, label: sg(c.net), detail: c.poss + ' possessions' } : null; })) },
        o: { dp: 1, transpose: false, title: 'Lineup mixes', desc: 'Net per 100 possessions by shooters on the floor and bigs, against the reference five' } }, charts);
      html += '<p class="ww-note">The opposing five is not controlled for.</p>';
      if (L.terms && L.terms.length) html += chartSlot({ kind: 'forest', label: 'Lineup terms', data: L.terms.map(t => ({ id: t.k, label: t.k, v: t.b, lo: t.lo, hi: t.hi })),
        o: { x: { label: 'net per 100 possessions' }, title: 'Lineup terms', desc: 'Each term of the lineup model' } }, charts);
    }
    if (Q && Q.coef && Q.coef.length) {
      html += '<h3 class="ww-h3">Squad shape</h3><p class="ww-lead">' + chip('explain', Q.n) + (Q.power === 'low' ? ' <span class="ww-chipx">low power: few team-seasons</span>' : '') + '</p>';
      html += chartSlot({ kind: 'forest', label: 'Squad shape and net rating', data: Q.coef.map(c => ({ id: c.k, label: SQUAD_LABEL[c.k] || c.k, v: c.b, lo: c.lo, hi: c.hi, muted: c.evidence === 'none',
        badge: c.evidence === 'strong' ? 'strong evidence' : c.evidence === 'some' ? 'some evidence' : '' })),
        o: { x: { label: 'net per 100 for one SD more' }, title: 'Squad shape', desc: 'Team-season squad features against net rating, with evidence grades' } }, charts);
      if (!Q.coef.some(c => c.evidence === 'strong')) html += '<p class="ww-note">No squad feature has strong evidence here, so none is called a winner’s trait.</p>';
      const bands = Q.bands || {}, bk = Object.keys(bands);
      if (bk.length) html += '<details class="ww-details"><summary>Winners’ bands (middle half of the top quarter)</summary><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Feature</th><th scope="col">P25</th><th scope="col">P50</th><th scope="col">P75</th></tr></thead><tbody>' +
        bk.map(k => '<tr><th scope="row">' + esc(SQUAD_LABEL[k] || k) + '</th><td translate="no">' + f2(bands[k].p25) + '</td><td translate="no">' + f2(bands[k].p50) + '</td><td translate="no">' + f2(bands[k].p75) + '</td></tr>').join('') + '</tbody></table></div></details>';
      const pd = Q.pd || {};
      if (Object.keys(pd).length) html += chartSlot({ kind: 'smallMultiples', label: 'Partial dependence', data: Object.keys(pd).map(k => ({ title: SQUAD_LABEL[k] || k, kind: 'line', data: [{ k, label: '', pts: pd[k] }], o: { y: { label: 'net' }, ref: 0 } })),
        o: { panelH: 170, title: 'Partial dependence', desc: 'Net per 100 across each feature, the others held' } }, charts);
    }
    return { state: 'ok', html, charts };
  },

  sim(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    if (!W.league) return { state: 'empty', html: empty('Pick a league to simulate its games'), charts };
    if (ctx.foState === 'idle' || ctx.foState === 'loading') return { state: 'loading', html: '<div class="pg-row"><button type="button" class="ep-btn pri" data-act="loadsim"' + (ctx.foState === 'loading' ? ' disabled' : '') + '>' +
      (ctx.foState === 'loading' ? 'Loading the simulator…' : 'Open the simulator') + '</button></div>', charts };
    if (ctx.foState !== 'ok' || !ctx.fo) return { state: 'empty', html: empty(ctx.foMessage || 'The simulator needs this league’s Front office file, built with the model'), charts };
    const fo = ctx.fo, teams = fo.teams || [];
    if (teams.length < 2) return { state: 'empty', html: empty('The simulator needs two sides with games'), charts };
    const t1 = teams.some(t => t.id === st.t1) ? st.t1 : teams[0].id, t2 = teams.some(t => t.id === st.t2 && t.id !== t1) ? st.t2 : teams.find(t => t.id !== t1).id;
    const opts = teams.map(t => [t.id, t.name]);
    let html = '<p class="ww-lead">' + chip('model', null, fo.sim && fo.sim.calibrated ? 'calibrated' : 'experimental: compare the changes, not the odds') + '</p>';
    html += '<div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Side A</span>' + sel('t1', opts, t1, 'Side A', true) + '</label>' +
      '<label class="ww-field"><span class="ww-flab">Side B</span>' + sel('t2', opts, t2, 'Side B', true) + '</label></div>';
    html += '<div class="pg-row ww-ctl">' + seg('venue', [['1', 'A at home'], ['0', 'Neutral'], ['-1', 'B at home']], String(st.venue), 'Venue') + '</div>';
    const name = id => (teams.find(t => t.id === id) || {}).name || '';
    html += '<div class="ww-dials">' + ['A', 'B'].map(side => '<fieldset class="ww-dialset"><legend translate="no">' + esc(side === 'A' ? name(t1) : name(t2)) + '</legend>' +
      DIALS.map(d => { const v = (st.dials[side] || {})[d.key] || 0; const id = 'wwd' + side + d.key;
        return '<label class="ww-dial" for="' + id + '"><span class="ww-dlab">' + esc(d.label) + '</span><input type="range" id="' + id + '" data-act="dial" data-side="' + side + '" data-key="' + d.key +
          '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '"><output translate="no">' + sg(v, d.step < 1 ? 1 : 0) + ' ' + d.unit + '</output></label>'; }).join('') + '</fieldset>').join('') + '</div>';
    html += '<div class="pg-row"><button type="button" class="ep-btn" data-act="dialreset">Reset the dials</button></div>';
    const R = st.simResult;
    if (st.simState === 'running') html += '<p class="ww-note" aria-live="polite">Simulating…</p>';
    if (R && R.key === simKey(st, t1, t2)) {
      html += chartSlot({ kind: 'meter', label: 'Chance of winning', data: { p: R.pWin, se: R.se, a: name(t1), b: name(t2) }, o: { title: 'Chance of winning', desc: 'Simulated chance of each side winning, with its error' } }, charts);
      html += '<p class="ww-note">' + esc(R.n + ' games simulated; expected margin ' + sg(R.mean) + ' (' + sg(R.q05, 0) + ' to ' + sg(R.q95, 0) + ' in nine games of ten)') + '</p>';
      if (R.hist && R.hist.length) html += chartSlot({ kind: 'histogram', label: 'Simulated margins', data: R.hist, o: { x: { label: 'margin for ' + name(t1) }, split: 0, countLabel: 'games', title: 'Simulated margins', desc: 'How often each margin came up' } }, charts);
      if (R.tornado && R.tornado.length) html += '<h3 class="ww-h3">What moves the odds</h3>' + chartSlot({ kind: 'tornado', label: 'Each dial at its ends', data: { base: R.pWin, rows: R.tornado },
        o: { title: 'What moves the odds', desc: 'Side A’s chance with each of its dials at either end, the rest as set' } }, charts);
    }
    if (st.simState === 'error') html += empty('The simulation could not run here: ' + (st.simError || 'unknown'));
    return { state: 'ok', html, charts };
  },

  losses(ctx) {
    const W = ctx.W, st = ctx.st, charts = [];
    if (!W) return locked(6);
    const L = W.losses;
    if (!L || !L.parts || !L.parts.length) return { state: 'empty', html: empty('Defeats are split once the model has its first full build here'), charts };
    const ex = L.parts.find(p => p.k === 'expected');
    let html = '<p class="ww-lead">' + chip('explain', L.n) + '</p><h3 class="ww-h3">The average defeat</h3>';
    html += chartSlot({ kind: 'waterfall', label: 'The average defeat, part by part', data: { start: { label: 'expected', v: ex ? ex.pts : 0 }, parts: L.parts.filter(p => p.k !== 'expected').map(p => ({ k: p.k, label: PART_LABEL[p.k] || label(W, p.k), v: p.pts, lo: p.lo, hi: p.hi })),
      total: { label: 'average defeat' } }, o: { y: { label: 'points' }, title: 'The average defeat', desc: 'Expected margin, then each part, adding up to the average losing margin' } }, charts);
    if (isNum(L.luckSd)) html += '<p class="ww-note">' + esc('Shooting luck beyond the parts moves a game by about ' + f1(L.luckSd) + ' points either way') + '</p><p class="ww-note">It is shown beside the parts, never added to them.</p>';
    const teams = (W.tempo && W.tempo.teams) || [];
    if (W.league && teams.length) {
      html += '<h3 class="ww-h3">A club’s defeats</h3><div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">Club</span>' + sel('club', [['', 'Pick a club']].concat(teams.map(t => [t.id, t.name]).sort((a, b) => (a[1] < b[1] ? -1 : 1))), st.club || '', 'Club', true) + '</label></div>';
      const C = ctx.club;
      if (st.club && ctx.clubState === 'loading') html += '<p class="ww-note" aria-live="polite">Loading the club’s file…</p>';
      if (st.club && ctx.clubState === 'refused') html += '<div class="ww-lock" data-memlock="4"></div>';
      if (st.club && ctx.clubState === 'none') html += empty('This club’s file is built with the next model run');
      if (st.club && C && ctx.clubState === 'ok') {
        const lost = (C.games || []).filter(g => g.m < 0);
        const xm = lost.length ? lost.reduce((s, g) => s + g.xm, 0) / lost.length : 0;
        html += '<p class="ww-lead">' + chip('explain', C.losses.n) + ' <span class="ww-legend" translate="no">' + esc(C.team.name) + ': ' + C.record.w + '–' + C.record.l + '</span></p>';
        html += chartSlot({ kind: 'waterfall', label: C.team.name + '’s average defeat', data: { start: { label: 'expected', v: xm }, parts: C.losses.mean.map(p => ({ k: p.k, label: PART_LABEL[p.k] || p.k, v: p.pts, lo: p.lo, hi: p.hi })),
          total: { label: 'average defeat' } }, o: { y: { label: 'points' }, title: 'A club’s average defeat', desc: 'The club’s defeats, part by part' } }, charts);
        const why = C.losses.mean.filter(p => p.k !== 'other' && p.k !== 'garbage' && isNum(p.hi) && p.hi < 0);
        if (why.length) html += '<p class="ww-hard">' + esc('You lose when ' + why.map(p => PART_LABEL[p.k] || p.k).join(' and ') + ' go against you') + '</p>';
        const last = lost.slice(-10).reverse();
        if (last.length) html += '<h3 class="ww-h3">The last ten defeats</h3>' + chartSlot({ kind: 'smallMultiples', label: 'The last ten defeats', data: last.map(g => ({ title: g.d + ' · ' + sg(g.m, 0),
          kind: 'waterfall', data: { start: { label: 'expected', v: g.xm }, parts: ['quality', 'making', 'tovp', 'orebp', 'ftmr', 'other', 'garbage'].map(k => ({ k, label: PART_LABEL[k], v: g.parts[k] })), total: { label: 'margin' } } })),
          o: { panelH: 190, title: 'The last ten defeats', desc: 'Each defeat split into its parts' } }, charts);
      }
    }
    return { state: 'ok', html, charts };
  },

  leagues(ctx) {
    const W = ctx.W, charts = [];
    if (!W) {
      const T = ctx.teaser;
      if (T && T.leagues && T.leagues.length) return { state: 'preview', html: '<p class="ww-lead">' + chip('preview', T.n) + '</p><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">League</th><th scope="col">Games</th><th scope="col">What wins there</th><th scope="col">Won it, won</th><th scope="col">Home wins</th></tr></thead><tbody>' +
        T.leagues.map(l => '<tr><th scope="row"><a href="?l=' + encodeURIComponent(l.slug) + '" data-act="league" data-v="' + esc(l.slug) + '" translate="no">' + esc(l.name) + '</a></th><td translate="no">' + l.n + '</td><td>' + esc(l.top ? l.top.label : '–') + '</td><td translate="no">' +
          (l.top ? pc(l.top.winRate) + '%' : '–') + '</td><td translate="no">' + pc(l.homeWin) + '%</td></tr>').join('') + '</tbody></table></div>' + ctx.gateNote, charts };
      return locked(5);
    }
    if (W.leagues && W.leagues.length) {
      const lg = W.leagues, pool = Object.fromEntries((W.models.core4c.coef || []).map(c => [c.k, c.b]));
      let html = '<p class="ww-lead">' + chip('explain', W.n.games) + ' <span class="ww-legend">each league’s coefficient against the pooled one; hatched where it leans mostly on the pool (over 60%)</span></p>';
      html += chartSlot({ kind: 'heatmap', label: 'Leagues against the pooled answer', data: { rows: lg.map(l => l.name), cols: CORE.map(k => label(W, k)), mode: 'div',
        cells: lg.map(l => CORE.map(k => { const c = l.coef.find(x => x.k === k); if (!c || !c.eb || !isNum(pool[k])) return null; const rel = (c.eb.v - pool[k]) / (Math.abs(pool[k]) || 1) * Math.sign(dirOf(W, k) || 1);
          return { v: rel, hatch: c.w > 0.6, label: f2(c.eb.v), lo: c.eb.lo, hi: c.eb.hi, detail: pc(c.w) + '% from the pool' + (c.own ? ' · own ' + f2(c.own.v) : '') }; })) },
        o: { dp: 2, title: 'Leagues against the pooled answer', desc: 'Each league’s shrunk coefficient; colour is how far it sits from the pooled one, better or worse' } }, charts);
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">League</th><th scope="col">Games</th><th scope="col">Home court</th><th scope="col">Strongest measures</th></tr></thead><tbody>' +
        lg.map(l => '<tr><th scope="row"><a href="?l=' + encodeURIComponent(l.slug) + '" data-act="league" data-v="' + esc(l.slug) + '" translate="no">' + esc(l.name) + '</a></th><td translate="no">' + l.n + '</td><td translate="no">' + sg(l.home.v) + ' <small>' + rng(l.home.lo, l.home.hi, f1) + '</small></td><td>' +
          esc((l.top || []).map(k => label(W, k)).join(', ')) + '</td></tr>').join('') + '</tbody></table></div>';
      return { state: 'ok', html, charts };
    }
    const C = W.models.core4c;
    if (!C.coef.some(c => c.own)) return { state: 'ok', html: '<p class="ww-lead">' + chip('explain', C.n) + '</p>' + empty('Under 200 games this league leans on every league’s answer; its own estimate is shown from 200'), charts };
    let html = '<p class="ww-lead">' + chip('explain', C.n) + ' <span class="ww-legend"><i class="ww-k-hollow"></i>leaning on every league <i class="ww-k-ghost"></i>its own data alone</span></p>';
    html += chartSlot({ kind: 'forest', label: 'This league’s own answer against the shrunk one', data: C.coef.map(c => ({ id: c.k, label: label(W, c.k), v: c.b, lo: c.lo, hi: c.hi, shrunk: true, own: c.own, badge: pc(c.w) + '% pooled' })),
      o: { x: { label: 'points of margin per unit' }, title: 'Own against shrunk', desc: 'The league’s own coefficients beside the ones shrunk toward every league' } }, charts);
    return { state: 'ok', html, charts };
  },

  model(ctx) {
    const W = ctx.W, charts = [];
    if (!W) return locked(5);
    const P = W.predictive;
    let html = '';
    if (P && P.metrics) {
      html += '<p class="ww-lead">' + chip('forecast', P.nEval) + '</p>';
      html += '<p class="ww-hard">' + esc(P.live ? 'The season’s numbers forecast better than home court and Elo here' : 'Season numbers do not forecast better than Elo here') + '</p>';
      const B = P.baselines || {};
      html += chartSlot({ kind: 'reliability', label: 'Forecasts against results', data: { series: [{ k: 'model', label: 'season numbers', bins: P.metrics.bins }].concat(B.elo ? [{ k: 'elo', label: 'Elo', bins: B.elo.bins }] : [], B.home ? [{ k: 'home', label: 'home only', bins: B.home.bins }] : []) },
        o: { title: 'Forecasts against results', desc: 'Forecast chance against the share actually won, by tenth of the forecasts' } }, charts);
      const row = (t, c) => c ? '<tr><th scope="row">' + esc(t) + '</th><td translate="no">' + (isNum(c.brier) ? c.brier.toFixed(3) : '–') + '</td><td translate="no">' + (isNum(c.logloss) ? c.logloss.toFixed(3) : '–') + '</td><td translate="no">' +
        (isNum(c.ece) ? c.ece.toFixed(3) : '–') + '</td><td translate="no">' + (isNum(c.auc) ? c.auc.toFixed(3) : '–') + '</td><td translate="no">' + f2(c.slope) + '</td></tr>' : '';
      html += '<div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Forecast</th><th scope="col">Brier</th><th scope="col">Log loss</th><th scope="col">ECE</th><th scope="col">AUC</th><th scope="col">Slope</th></tr></thead><tbody>' +
        row('Season numbers', P.metrics) + row('Home only', B.home) + row('Elo', B.elo) + row('Net rating', B.net) + row('Pythagorean', B.pyth) + (P.sim ? row('Simulator', P.sim) : '') + '</tbody></table></div>';
      html += '<p class="ww-note">Lower Brier and log loss are better; a slope of 1 means the forecasts are as confident as they should be.</p>';
    }
    if (P && P.sim && P.sim.checks) {
      const ck = P.sim.checks, names = { pace: 'Pace', ortg: 'Offensive rating', efg: 'eFG%', tovp: 'TOV%', orebp: 'OREB%', ftr: 'FT rate', marginSd: 'Margin spread', close5: 'Decided by 5 or fewer', ot: 'Overtime' };
      html += '<h3 class="ww-h3">The simulator against the games</h3><p class="ww-lead">' + chip('model', null, P.sim.calibrated ? 'calibrated' : 'experimental') + '</p><div class="ep-tw"><table class="ww-tbl"><thead><tr><th scope="col">Check</th><th scope="col">Observed</th><th scope="col">Simulated</th></tr></thead><tbody>' +
        Object.keys(ck).map(k => '<tr><th scope="row">' + esc(names[k] || k) + '</th><td translate="no">' + (k === 'close5' || k === 'ot' ? pc(ck[k].obs) + '%' : f1(ck[k].obs)) + '</td><td translate="no">' + (k === 'close5' || k === 'ot' ? pc(ck[k].sim) + '%' : f1(ck[k].sim)) + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (P && P.transfer && P.transfer.length) {
      const nm = id => ((W.leagues || []).find(l => l.id === id) || {}).name || id.slice(0, 8);
      html += '<h3 class="ww-h3">Carrying the answer to another league</h3>' + chartSlot({ kind: 'bars', label: 'Brier score of each league predicted from the others', data: P.transfer.map(t => ({ id: t.id, label: nm(t.id), v: t.brier, dir: -1, cls: 'vz-s1f', detail: t.n + ' games' })),
        o: { x: { label: 'Brier score (lower is better)', lo: 0, hi: 0.3 }, title: 'League-out transfer', desc: 'Each league predicted from a fit on the others' } }, charts);
    }
    const Q = W.quality;
    if (Q) {
      const flags = [['zones', 'Shot locations'], ['timed', 'Timed possessions'], ['sit', 'Situations'], ['stype', 'Turnover types'], ['foulkind', 'Foul kinds'], ['stl', 'Steals logged'], ['listed', 'Listed positions'], ['heights', 'Heights']];
      html += '<h3 class="ww-h3">What the feeds carry</h3><ul class="ww-flags">' + flags.filter(([k]) => isNum(Q[k])).map(([k, t]) => '<li class="' + (Q[k] >= 0.8 ? 'ww-ok' : Q[k] >= 0.5 ? 'ww-part' : 'ww-no') + '"><span class="ww-flagv" translate="no">' +
        pc(Q[k]) + '%</span> ' + esc(t) + '</li>').join('') + '</ul><p class="ww-note">Share of games with each; a measure that needs one is left out of a game without it.</p>';
    }
    return { state: html ? 'ok' : 'empty', html: html || empty('The checks appear after the first full build'), charts };
  }
};
const GROUPCLS = { G: 'vz-s1f', F: 'vz-s2f', C: 'vz-s3f' };
const simKey = (st, t1, t2) => [t1, t2, st.venue, JSON.stringify(st.dials)].join('|');

/* ============================================================================================ THE BROWSER === */
function boot() {
  const doc = root.document, $ = id => doc.getElementById(id);
  const D = () => root.EpinoiaData, WF = () => root.EpinoiaWinFile, V = () => root.EpinoiaVizKit, Sim = () => root.EpinoiaWinSim;
  try { root.localStorage.removeItem(LEGACY); } catch (_) { /* storage blocked: nothing kept there either */ }

  /* the Worker, built from this script's own ?v= so a deploy never mixes versions */
  const myV = (() => { const s = doc.currentScript || [...doc.scripts].find(x => /winning\/page\.js/.test(x.src)); const m = /[?&]v=([^&#]+)/.exec((s && s.src) || ''); return m ? m[1] : ''; })();
  const Work = (() => {
    let w = null, seq = 0;
    const jobs = new Map();
    function worker() {
      if (w === false) return null;
      if (!w) {
        try {
          w = new root.Worker('../winsim.worker.js?v=' + myV);
          w.onmessage = e => { const m = e.data || {}, j = jobs.get(m.id); if (!j) return; if (m.progress != null) { if (j.onProgress) j.onProgress(m.progress); return; }
            jobs.delete(m.id); if (m.ok) j.resolve(m.result); else j.reject(new Error(m.error || 'failed')); };
          w.onerror = () => { const all = [...jobs.values()]; jobs.clear(); w = false; all.forEach(j => j.fallback()); };
        } catch (_) { w = false; return null; }
      }
      return w;
    }
    /* no Worker: the same call on the main thread, n / 5, in idle slices */
    function local(op, args, o) {
      const a = Object.assign({}, args);
      if (a.n) a.n = Math.max(200, Math.round(a.n / 5));
      if (a.B) a.B = Math.max(40, Math.round(a.B / 5));
      const idle = fn => (root.requestIdleCallback ? root.requestIdleCallback(fn, { timeout: 60 }) : root.setTimeout(fn, 0));
      return Sim().drive(Sim().steps(op, a), { slice: 12, onProgress: o.onProgress, cancelled: () => !!(o.signal && o.signal.aborted), defer: idle });
    }
    function run(op, args, o) {
      o = o || {};
      const ww = worker();
      if (!ww) return local(op, args, o);
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const j = { resolve, reject, onProgress: o.onProgress, fallback: () => local(op, args, o).then(resolve, reject) };
        jobs.set(id, j);
        if (o.signal) o.signal.addEventListener('abort', () => { if (jobs.has(id)) { ww.postMessage({ id, op: 'cancel' }); jobs.delete(id); reject(new Error('cancelled')); } }, { once: true });
        ww.postMessage({ id, op, args });
      });
    }
    return { run };
  })();

  /* ---- the page's state, and the address ---- */
  const q = new URLSearchParams(root.location.search);
  const st = { lens: q.get('lens') === 'forecast' ? 'forecast' : 'explain', unit: 'pts', k: q.get('k') || '', t1: q.get('t1') || '', t2: q.get('t2') || '', venue: 1,
    dials: { A: {}, B: {} }, picks: null, fview: 'bars', sortKey: 'r', sortDir: -1, posG: 'G', club: '', brushed: null, refit: null, simState: 'idle', simResult: null };
  const ctx = { W: null, ans: null, fo: null, foState: 'idle', club: null, clubState: 'idle', teaser: null, reason: null, pooledFallback: false, message: '', gateNote: '', st };
  let leagues = [], league = null, seasons = [], seasonId = q.get('s') || '';
  const want = q.get('l') || '';
  const binds = new Map();
  const address = () => {
    const u = new URL(root.location.href), p = u.searchParams;
    const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
    set('l', league ? league.slug : ''); set('s', seasonId); set('lens', st.lens === 'forecast' ? 'forecast' : ''); set('k', st.k); set('t1', st.t1); set('t2', st.t2);
    root.history.replaceState(null, '', u);
  };

  /* ---- drawing a section ---- */
  function mount(id) {
    const host = id === 'answer' ? $('wwCards') : $(id + 'B');
    if (!host || !views[id]) return;
    (binds.get(id) || []).forEach(b => b.destroy());
    binds.set(id, []);
    let out;
    try { out = views[id](ctx); } catch (e) { out = { state: 'empty', html: '<div class="pg-empty"><p>This part could not be drawn.</p></div>', charts: [] }; if (root.console) root.console.warn('[winning]', id, e); }
    host.innerHTML = out.html;
    host.removeAttribute('aria-busy');
    host.querySelectorAll('[data-memlock]').forEach(ph => {
      const rows = +ph.getAttribute('data-memlock') || 5;
      if (ctx.reason === 'signin') { ph.innerHTML = '<div class="pg-empty"><p>Members’ analysis. <a href="' + esc(signinHref()) + '">Sign in</a> to see it.</p></div>'; return; }
      const M = root.EpinoiaMemLock, node = M && M.placeholder ? M.placeholder({ rows, what: 'What wins model', leagueSlug: league ? league.slug : undefined }) : null;
      if (node) ph.replaceWith(node); else ph.innerHTML = '<div class="pg-empty"><p>Members’ analysis.</p></div>';
    });
    const VK = V();
    host.querySelectorAll('[data-chart]').forEach(slot => {
      const spec = out.charts[+slot.getAttribute('data-chart')];
      if (!spec || !VK || !VK[spec.kind]) return;
      const opts = { label: spec.label };
      if (spec.pick === 'curves') opts.onPick = h => { if (ctx.W && ctx.W.curves && ctx.W.curves[h.id]) { st.k = h.id; address(); mount('curves'); const s = $('curves'); if (s) s.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } };
      if (spec.kind === 'scatter' && spec.brush) opts.onBrush = ids => { st.brushed = ids && ids.length ? ids : null; mount(id); };
      binds.get(id).push(VK.bind(slot, o => VK[spec.kind](spec.data, Object.assign({}, spec.o, { W: o.W, id: id + slot.getAttribute('data-chart') })), opts));
    });
  }
  const drawAll = () => SECTIONS.forEach(s => { if (s !== 'method') mount(s); });
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const signinHref = () => { const A = root.EpinoiaAccess; try { return A && A.signinHref ? A.signinHref(root.location.pathname + root.location.search) : '../signin/'; } catch (_) { return '../signin/'; } };

  /* ---- the status line, the banner, #method's date ---- */
  function status() {
    const s = statusLine(ctx.ans, ctx.W), line = $('wwLine'), btn = $('wwRecalc');
    line.textContent = ctx.W ? s.line : (ctx.teaser ? 'Box-score preview of ' + ctx.teaser.n + ' games' : ctx.message || '');
    btn.disabled = !s.canRecalc;
    btn.classList.toggle('hide', !ctx.W || !ctx.W.league);
    btn.textContent = s.upToDate ? 'Up to date' : 'Recalculate';
    const ban = $('wwBanner'), built = Date.parse((ctx.ans && ctx.ans.built) || (ctx.W && ctx.W.built) || '');
    const stale = ctx.W && isFinite(built) && Date.now() - built > 48 * 3600e3 && ctx.ans && ctx.ans.pending > 0;
    ban.classList.toggle('hide', !stale);
    if (stale) ban.textContent = 'This model was built ' + new Date(built).toISOString().slice(0, 16).replace('T', ' ') + ' UTC; newer games have finished since';
    const asof = $('wwAsof'), F = ctx.W || ctx.teaser;
    if (F) asof.textContent = 'Model ' + F.token + ' · built ' + String(F.built || '').slice(0, 16).replace('T', ' ') + ' UTC';
  }

  /* ---- reading a file ---- */
  const MSG = { layout: 'The model is being rebuilt; back within the hour', network: 'The model could not be reached just now', scope: 'This file cannot be asked for',
    league: 'This league’s analysis is not open to you' };
  const rateMsg = s => 'Too many requests: try again in ' + Math.max(1, Math.ceil((s || 60) / 60)) + ' minutes';
  async function load(force) {
    ctx.W = null; ctx.ans = null; ctx.fo = null; ctx.foState = 'idle'; ctx.club = null; ctx.clubState = 'idle'; ctx.teaser = null; ctx.reason = null; ctx.pooledFallback = false; ctx.message = '';
    st.simResult = null; st.refit = null;
    $('wwCards').setAttribute('aria-busy', 'true');
    $('wwLine').textContent = 'Loading the model…';
    const A = root.EpinoiaAccess, M = root.EpinoiaMemLock;
    try { if (A && A.load) await A.load(league ? { leagueId: league.id } : {}); } catch (_) { /* fails open */ }
    /* the first drawing only (the database decides on the request): the catalogue's 'model' lock, or, before
       access.js lists it, the analytics entitlement it rides on; both fail open */
    const lid = league ? league.id : undefined;
    let lockedNow = !!(M && M.locked && M.locked('model', lid));
    try { if (!lockedNow && A && A.CATALOGUE && A.CATALOGUE.locks && !A.CATALOGUE.locks.model && A.analyticsOk) lockedNow = A.analyticsOk(lid) === false; } catch (_) { /* fails open */ }
    let ans = null;
    if (!lockedNow) {
      ans = await WF().get(league ? { scope: 'wins', league: league.id, season: seasonId || undefined } : { scope: 'wins' }, { force: !!force });
      if (!ans.ok && ans.reason === 'none' && league) {
        ctx.pooledFallback = true;
        ans = await WF().get({ scope: 'wins' });
      } else if (ans.ok && league && ans.data && ans.data.n && ans.data.n.games < 20) {
        ctx.pooledFallback = true;
        ans = await WF().get({ scope: 'wins' });
      }
    }
    if (ans && ans.ok) { ctx.ans = ans; ctx.W = ans.data; }
    else {
      ctx.reason = ans ? ans.reason : 'members';
      if (ctx.reason === 'rate') ctx.message = rateMsg(ans.retryAfter);
      else if (ctx.reason === 'none') ctx.message = 'The model has not been built yet: back within the hour';
      else ctx.message = MSG[ctx.reason] || '';
      if (lockedNow || ['members', 'signin', 'jwt', 'league'].indexOf(ctx.reason) >= 0) {
        if (ctx.reason === 'jwt') ctx.reason = 'signin';
        const t = await WF().get({ scope: 'teaser' });
        if (t.ok) ctx.teaser = t.data;
        ctx.gateNote = '<p class="ww-gate">' + (ctx.reason === 'signin' ? 'The full model is for signed-in readers: ' : 'The full model is for members: ') + '<a href="' +
          esc(ctx.reason === 'signin' ? signinHref() : ((A && A.joinHref) ? A.joinHref({ leagueSlug: league ? league.slug : undefined }) : '../join/')) + '">' + (ctx.reason === 'signin' ? 'sign in' : 'become a member') + '</a></p>';
      }
    }
    if (ctx.W && st.k === '' && ctx.W.curves) st.k = Object.keys(ctx.W.curves)[0] || '';
    status();
    drawAll();
    observeSim();
  }

  /* ---- the simulator: the fo file when #sim opens ---- */
  let simObs = null;
  function observeSim() {
    if (simObs) simObs.disconnect();
    if (!ctx.W || !ctx.W.league || ctx.foState !== 'idle') return;
    if (!root.IntersectionObserver) return;
    simObs = new root.IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { simObs.disconnect(); loadFo(); } }, { rootMargin: '200px' });
    simObs.observe($('sim'));
  }
  async function loadFo() {
    if (!ctx.W || !ctx.W.league || ctx.foState === 'loading' || ctx.foState === 'ok') return;
    ctx.foState = 'loading'; mount('sim');
    const a = await WF().get({ scope: 'fo', league: ctx.W.league.id, season: ctx.W.season ? ctx.W.season.id : undefined });
    if (a.ok) { ctx.fo = a.data; ctx.foState = 'ok'; }
    else { ctx.foState = 'error'; ctx.foMessage = a.reason === 'rate' ? rateMsg(a.retryAfter) : a.reason === 'none' ? 'The simulator’s file is built with the next model run' : MSG[a.reason] || 'The simulator could not be loaded'; }
    mount('sim');
    if (ctx.foState === 'ok') simulate();
  }
  let simAbort = null, simT = 0;
  function simulate() {
    const fo = ctx.fo; if (!fo) return;
    const S = Sim(), teams = fo.teams;
    const t1 = teams.some(t => t.id === st.t1) ? st.t1 : teams[0].id, t2 = teams.some(t => t.id === st.t2 && t.id !== t1) ? st.t2 : teams.find(t => t.id !== t1).id;
    const A = teams.find(t => t.id === t1), B = teams.find(t => t.id === t2);
    const L = fo.lg, platt = fo.sim && fo.sim.platt;
    const edits = side => DIALS.map(d => ({ end: 'off', key: d.key, delta: (st.dials[side] || {})[d.key] || 0 })).filter(e => e.delta);
    const pa = S.applyEdits(A.prof, edits('A'), L), pb = S.applyEdits(B.prof, edits('B'), L);
    const M = S.matchup(pa, pb, L, { home: +st.venue, platt });
    if (simAbort) simAbort.abort();
    const ab = simAbort = new root.AbortController();
    st.simState = 'running'; mount('sim');
    const key = simKey(st, t1, t2);
    Work.run('simulate', { M, n: 5000, seed: 1 }, { signal: ab.signal }).then(async r => {
      if (ab.signal.aborted) return;
      const tor = [];
      for (const d of DIALS) {
        const cur = (st.dials.A || {})[d.key] || 0;
        const at = async v => { const e = edits('A').filter(x => x.key !== d.key).concat(v ? [{ end: 'off', key: d.key, delta: v }] : []);
          const m2 = S.matchup(S.applyEdits(A.prof, e, L), pb, L, { home: +st.venue, platt }); return (await Work.run('simulate', { M: m2, n: 1500, seed: 1 }, { signal: ab.signal })).pWin; };
        const lo = await at(d.min), hi = await at(d.max);
        if (ab.signal.aborted) return;
        tor.push({ id: d.key, label: d.label, lo: Math.min(lo, hi), hi: Math.max(lo, hi), loLabel: (lo <= hi ? sg(d.min, 0) : sg(d.max, 0)) + ' ' + d.unit, hiLabel: (lo <= hi ? sg(d.max, 0) : sg(d.min, 0)) + ' ' + d.unit });
        void cur;
      }
      st.simResult = Object.assign({ key, tornado: tor }, r);
      st.simState = 'done'; mount('sim');
    }).catch(e => { if (ab.signal.aborted) return; st.simState = 'error'; st.simError = String(e && e.message || e); mount('sim'); });
  }

  /* ---- the re-fit (Worker) ---- */
  function refit() {
    const W = ctx.W; if (!W || !W.blocks) return;
    const picks = (st.picks || CORE.slice()).filter(k => W.blocks.keys.indexOf(k) >= 0);
    const cols = ['h'].concat(picks);
    const scale = W.blocks.scale.slice(); scale[W.blocks.keys.indexOf('h')] = 0;        // home court unpenalised
    st.refit = { state: 'running' }; mount('value');
    return Work.run('refit', { blocks: W.blocks.list, keys: W.blocks.keys, cols, lambda: W.blocks.lambda, scale, B: 200, seed: 1 })
      .then(r => { st.refit = { state: 'done', result: { keys: cols, b: r.b, lo: r.lo, hi: r.hi } }; mount('value'); })
      .catch(e => { st.refit = { state: 'error', error: String(e && e.message || e) }; mount('value'); });
  }

  /* ---- RECALCULATE (A.2): the staged bar ---- */
  const STAGES = ['check', 'update', 'download', 'sim', 'draw'];
  const blocks = $('wwBlocks');
  for (let i = 0; i < 24; i++) blocks.appendChild(doc.createElement('i'));
  let recalcAbort = null;
  function stage(name, frac, text) {
    const prog = $('wwProg'), i = STAGES.indexOf(name);
    const pct = Math.round(100 * Math.min(1, (Math.max(0, i) + Math.max(0, Math.min(1, frac || 0))) / STAGES.length));
    prog.setAttribute('aria-valuenow', String(pct));
    prog.setAttribute('aria-valuetext', text || '');
    const all = i === STAGES.length - 1 && frac >= 1;
    $('wwStages').querySelectorAll('li').forEach((li, k) => { li.classList.toggle('on', k === i && !all); li.classList.toggle('done', k < i || all); });
    blocks.querySelectorAll('i').forEach((b, k) => b.classList.toggle('on', k < Math.round(24 * pct / 100)));
    if (text != null) $('wwProgL').textContent = text;
  }
  function say(msg) { const m = $('wwMsg'); m.textContent = msg || ''; m.classList.toggle('hide', !msg); }
  async function recalc() {
    const W = ctx.W; if (!W || !W.league) return;
    const ab = recalcAbort = new root.AbortController();
    $('wwProg').classList.remove('hide'); $('wwCancel').classList.remove('hide'); $('wwRecalc').disabled = true; say('');
    stage('check', 0, 'Checking what has changed');
    let a;
    try {
      a = await WF().refresh({ league: W.league.id, season: W.season ? W.season.id : undefined }, { signal: ab.signal, onProgress: p => {
        if (p.stage === 'update') stage('update', 0.3, 'Updating the model on the server');
        if (p.stage === 'download') stage('download', p.total ? p.loaded / p.total : 0.5, 'Downloading the new file' + (p.loaded ? ' (' + Math.round(p.loaded / 1024) + ' KB)' : ''));
      } });
    } catch (_) { a = { ok: false, reason: 'network' }; }
    if (!a.ok) {
      finish();
      if (a.reason === 'aborted') return say('Cancelled: anything the server had started still finishes, and is reused next time');
      if (a.reason === 'rate') return say(rateMsg(a.retryAfter));
      if (a.reason === 'signin' || a.reason === 'jwt') return say('Sign in to recalculate');
      if (a.reason === 'members') return say('Recalculating is for members');
      return say(MSG[a.reason] || 'The model could not be reached just now');
    }
    const before = W.n.games;
    ctx.ans = a; ctx.W = a.data;
    stage('sim', 0, 'Re-simulating');
    if (ctx.W.blocks && ctx.W.blocks.list && ctx.W.blocks.list.length) {
      try {
        const picks = (st.picks || CORE.slice()).filter(k => ctx.W.blocks.keys.indexOf(k) >= 0), cols = ['h'].concat(picks);
        const scale = ctx.W.blocks.scale.slice(); scale[ctx.W.blocks.keys.indexOf('h')] = 0;
        const r = await Work.run('refit', { blocks: ctx.W.blocks.list, keys: ctx.W.blocks.keys, cols, lambda: ctx.W.blocks.lambda, scale, B: 200, seed: 1 },
          { signal: ab.signal, onProgress: p => stage('sim', p, 'Re-simulating: ' + Math.round(100 * p) + '%') });
        st.refit = { state: 'done', result: { keys: cols, b: r.b, lo: r.lo, hi: r.hi } };
      } catch (e) { if (ab.signal.aborted) { finish(); return say('Cancelled: anything the server had started still finishes, and is reused next time'); } }
    }
    stage('draw', 0.5, 'Drawing');
    ctx.fo = null; ctx.foState = 'idle'; st.simResult = null;
    status(); drawAll(); observeSim();
    stage('draw', 1, 'Done');
    finish();
    const added = ctx.W.n.games - before;
    if (a.queued) say(a.refreshReason === 'cap' ? 'Too many new games for a quick update: a full rebuild is scheduled' : 'The update is queued: the next scheduled build picks these games up first');
    else if (a.refreshReason === 'recent') say('Updated a few minutes ago: try again shortly');
    else if (a.joined) say('Joined an update already running' + (added > 0 ? ': ' + added + ' new games added' : ''));
    else if (a.refreshed) say(added > 0 ? 'Recalculated with ' + added + ' new games' : 'Recalculated');
    else say('Up to date');
  }
  function finish() {
    recalcAbort = null;
    $('wwCancel').classList.add('hide');
    root.setTimeout(() => { if (!recalcAbort) $('wwProg').classList.add('hide'); }, reduced() ? 0 : 1200);
    status();
  }
  $('wwRecalc').addEventListener('click', recalc);
  $('wwCancel').addEventListener('click', () => { if (recalcAbort) recalcAbort.abort(); });

  /* ---- one handler for every control the views draw ---- */
  const frame = $('ww');
  frame.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    const sec = b.closest('.sec'), sid = sec ? sec.id : '';
    if (act === 'league') { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); pickLeague(v); root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
    if (act === 'lens') { st.lens = v; address(); }
    else if (act === 'unit') st.unit = v;
    else if (act === 'fview') st.fview = v;
    else if (act === 'sort') { if (st.sortKey === v) st.sortDir = -st.sortDir; else { st.sortKey = v; st.sortDir = v === 'k' ? 1 : -1; } }
    else if (act === 'posG') st.posG = v;
    else if (act === 'venue') { st.venue = +v; mount(sid); queueSim(); return; }
    else if (act === 'refit') { refit(); return; }
    else if (act === 'loadsim') { loadFo(); return; }
    else if (act === 'dialreset') { st.dials = { A: {}, B: {} }; mount(sid); queueSim(); return; }
    else return;
    mount(sid);
    const again = $(sid) && $(sid).querySelector('[data-act="' + act + '"][data-v="' + v + '"]');
    if (again) again.focus();
  });
  frame.addEventListener('change', e => {
    const t = e.target, act = t.getAttribute && t.getAttribute('data-act');
    if (!act) return;
    const sid = t.closest('.sec').id;
    if (act === 'k') { st.k = t.value; address(); mount('curves'); }
    else if (act === 'pick') { st.picks = [...$('value').querySelectorAll('input[data-act="pick"]:checked')].map(x => x.value); }
    else if (act === 't1' || act === 't2') { st[act] = t.value; address(); mount(sid); queueSim(); }
    else if (act === 'club') { st.club = t.value; loadClub(); }
  });
  frame.addEventListener('input', e => {
    const t = e.target;
    if (!t.getAttribute || t.getAttribute('data-act') !== 'dial') return;
    const side = t.getAttribute('data-side'), key = t.getAttribute('data-key'), d = DIALS.find(x => x.key === key);
    st.dials[side] = Object.assign({}, st.dials[side], { [key]: +t.value });
    const out = t.parentNode.querySelector('output'); if (out) out.textContent = sg(+t.value, d.step < 1 ? 1 : 0) + ' ' + d.unit;
    queueSim();
  });
  function queueSim() { root.clearTimeout(simT); simT = root.setTimeout(simulate, 250); }
  async function loadClub() {
    if (!st.club || !ctx.W || !ctx.W.league) { ctx.club = null; ctx.clubState = 'idle'; mount('losses'); return; }
    ctx.clubState = 'loading'; mount('losses');
    const a = await WF().get({ scope: 'club', league: ctx.W.league.id, season: ctx.W.season ? ctx.W.season.id : undefined, team: st.club });
    if (a.ok) { ctx.club = a.data; ctx.clubState = 'ok'; } else { ctx.club = null; ctx.clubState = a.reason === 'none' ? 'none' : ['members', 'signin', 'league', 'jwt'].indexOf(a.reason) >= 0 ? 'refused' : 'none'; }
    mount('losses');
  }

  /* ---- the league and season pickers ---- */
  const pickL = $('wwLeague'), pickS = $('wwSeason');
  async function pickLeague(slug) {
    league = leagues.find(l => l.slug === slug) || null;
    seasonId = '';
    pickL.value = league ? league.slug : '';
    await setLeague();
    address();
    load();
  }
  async function setLeague() {
    const kick = $('wwKick');
    kick.textContent = '';
    if (!league) { kick.textContent = 'Every league'; pickS.disabled = true; pickS.innerHTML = '<option value="">Current</option>'; try { root.EpinoiaTeamColour && root.EpinoiaTeamColour.clearLeague && root.EpinoiaTeamColour.clearLeague(); } catch (_) { /* fine */ } return; }
    const a = doc.createElement('a'); a.href = '../?l=' + encodeURIComponent(league.slug); a.textContent = league.name; a.setAttribute('translate', 'no'); kick.appendChild(a);
    try {
      const row = (await D().get('leagues?slug=eq.' + encodeURIComponent(league.slug) + '&select=*'))[0];
      if (row && root.EpinoiaTeamColour) root.EpinoiaTeamColour.league(row, { keepAccent: !!(row.theme && row.theme.accent) });
    } catch (_) { /* the platform's colours stay */ }
    try { seasons = (await D().get('seasons?league_id=eq.' + league.id + '&select=id,name,starts_on')).sort((x, y) => String(y.starts_on).localeCompare(String(x.starts_on))); } catch (_) { seasons = []; }
    pickS.innerHTML = '';
    const cur = doc.createElement('option'); cur.value = ''; cur.textContent = 'Current'; pickS.appendChild(cur);
    seasons.forEach(s => { const o = doc.createElement('option'); o.value = s.id; o.textContent = s.name; o.setAttribute('translate', 'no'); pickS.appendChild(o); });
    pickS.disabled = !seasons.length;
    pickS.value = seasons.some(s => s.id === seasonId) ? seasonId : '';
  }
  pickL.addEventListener('change', () => pickLeague(pickL.value));
  pickS.addEventListener('change', () => { seasonId = pickS.value; address(); load(); });
  $('wwCards').addEventListener('click', e => {
    const c = e.target.closest && e.target.closest('.ww-card[data-k]');
    if (!c || !ctx.W || !ctx.W.curves || !ctx.W.curves[c.getAttribute('data-k')]) return;
    st.k = c.getAttribute('data-k'); address(); mount('curves');
    $('curves').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  });

  (async function start() {
    if (!WF() || !D() || !V()) { $('wwLine').textContent = 'The page could not be loaded.'; return; }
    try { leagues = await D().get('leagues?select=id,slug,name&order=name'); } catch (_) { leagues = []; }
    leagues.forEach(l => { const o = doc.createElement('option'); o.value = l.slug; o.textContent = l.name; o.setAttribute('translate', 'no'); pickL.appendChild(o); });
    league = leagues.find(l => l.slug === want) || null;
    pickL.value = league ? league.slug : '';
    await setLeague();
    if (seasonId && !seasons.some(s => s.id === seasonId)) seasonId = '';
    load();
  })();
}

return { views, cards, statusLine, boot, SECTIONS, MEMBER, DIALS, LEGACY, _ago: ago };
}));
