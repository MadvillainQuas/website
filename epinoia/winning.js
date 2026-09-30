'use strict';
/* ============================================================================
   WHAT WINS — which numbers go with winning, across every league on the platform.   window.EpinoiaWinning

   Every finished game has both sides' box scores (team_game_stats). For each game this takes the difference
   between the two sides on every measure (home less away) and the result (home won or lost; a draw is left out),
   and then asks four questions of all of them together:

     HOW CLOSELY     the correlation between a measure's difference and winning (point-biserial: Pearson's r
                     with the result as 0 or 1). +1 would mean the side ahead on it always won; 0, no relation
     HOW OFTEN       the side that won the measure won the game (a tie on the measure is left out) - the number a
                     coach says out loud: "win the glass and you win seven games in ten"
     BY HOW MUCH     the winners' and the losers' averages side by side
     THE FOUR FACTORS  the margin regressed on the four factors' differences (least squares, with an intercept for
                     the home side): how much of the margin they explain (R²), and their weights - each factor's
                     coefficient times the spread of its difference, as a share - against Dean Oliver's own
                     40 / 25 / 20 / 15 for shooting, turnovers, rebounding and free throws

   The same for one league, or for all of them. The rates are each game's own (from its box score), never
   averaged across a season, and a measure a game does not carry is left out of that game's sums only.

   Pure maths and SVG here; the page (winning/index.html) reads the rows and draws them.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinning = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* the measures: [key, where it lives in team_game_stats.stats, label, lower is better, group] */
const MEASURES = [
  ['efg', 'adv->efg', 'effective field goal %', false, 'four'],
  ['tovp', 'adv->tovp', 'turnover %', true, 'four'],
  ['orebp', 'adv->orebp', 'offensive rebound %', false, 'four'],
  ['ftr', 'adv->ftr', 'free-throw rate', false, 'four'],
  ['ts', 'adv->ts', 'true shooting %', false, 'shoot'],
  ['p3p', 'adv->p3p', 'three-point %', false, 'shoot'],
  ['rimp', 'adv->rimp', 'finishing at the rim %', false, 'shoot'],
  ['ftp', 'adv->ftp', 'free-throw %', false, 'shoot'],
  ['p3r', 'adv->p3r', 'three-point attempt rate', false, 'style'],
  ['rimr', 'adv->rimr', 'rim attempt rate', false, 'style'],
  ['astp', 'adv->astp', 'assist %', false, 'play'],
  ['stlp', 'adv->stlp', 'steal %', false, 'play'],
  ['blkp', 'adv->blkp', 'block %', false, 'play'],
  ['paint', 'paint', 'points in the paint', false, 'pts'],
  ['fast', 'fast', 'fast-break points', false, 'pts'],
  ['sc', 'sc', 'second-chance points', false, 'pts'],
  ['pot', 'pot', 'points off turnovers', false, 'pts'],
  ['bench', 'bench', 'bench points', false, 'pts']
];
const GROUPS = { four: 'the four factors', shoot: 'shooting', style: 'shot selection', play: 'play', pts: 'where the points came from' };
const OLIVER = { efg: 40, tovp: 25, orebp: 20, ftr: 15 };

/* the columns to ask PostgREST for: each measure out of the stats blob by its path, never the blob */
const SELECT = 'game_id,team_idx,' + MEASURES.map(m => m[0] + ':stats->' + m[1]).join(',');

const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------ the rows --- */
/* games [{ id, home_score, away_score, league }] and team rows [{ game_id, team_idx, <measures> }] ->
   [{ id, league, margin, win (0/1), d: { key: home - away } }]; draws and one-sided games left out */
function rows(games, tgs) {
  const by = new Map();
  (tgs || []).forEach(r => {
    if (!by.has(r.game_id)) by.set(r.game_id, [null, null]);
    by.get(r.game_id)[r.team_idx === 1 ? 1 : 0] = r;
  });
  const out = [];
  (games || []).forEach(g => {
    const pair = by.get(g.id), hs = num(g.home_score), as = num(g.away_score);
    if (!pair || !pair[0] || !pair[1] || hs == null || as == null || hs === as) return;
    const d = {};
    MEASURES.forEach(([k]) => {
      const a = num(pair[0][k]), b = num(pair[1][k]);
      if (a != null && b != null) d[k] = a - b;
    });
    out.push({ id: g.id, league: g.league || null, margin: hs - as, win: hs > as ? 1 : 0, d, h: pair[0], a: pair[1] });
  });
  return out;
}

/* ------------------------------------------------------------ the maths --- */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
const sd = xs => { const n = xs.length; if (n < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / n; return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1)); };

/* least squares with an intercept: y ~ b0 + X b, by the normal equations (Gauss-Jordan, partial pivoting) */
function ols(X, y) {
  const n = X.length, k = X[0] ? X[0].length + 1 : 1;
  if (n <= k) return null;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const row = [1].concat(X[i]);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) A[r][c] += row[r] * row[c];
      A[r][k] += row[r] * y[i];
    }
  }
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let cc = c; cc <= k; cc++) A[r][cc] -= f * A[c][cc];
    }
  }
  const b = A.map((row, i) => row[k] / row[i]);
  const my = y.reduce((a, v) => a + v, 0) / n;
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const fit = b[0] + X[i].reduce((a, x, j) => a + x * b[j + 1], 0);
    ssr += (y[i] - fit) * (y[i] - fit); sst += (y[i] - my) * (y[i] - my);
  }
  return { b, r2: sst > 0 ? 1 - ssr / sst : null, n };
}

function analyse(list) {
  const R = list || [];
  const measures = MEASURES.map(([k, , label, low, group]) => {
    const got = R.filter(r => r.d[k] != null);
    const xs = got.map(r => r.d[k]), ys = got.map(r => r.win);
    let r = pearson(xs, ys);
    if (r != null && low) r = -r;                      // "better" is fewer: winning more of it means doing less of it
    const decided = got.filter(x => x.d[k] !== 0);
    const wonIt = decided.filter(x => ((x.d[k] > 0) !== low) === (x.win === 1)).length;
    const side = (x, winner) => (x.win === 1) === winner ? x.h[k] : x.a[k];
    const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const wv = got.map(x => num(side(x, true))).filter(v => v != null), lv = got.map(x => num(side(x, false))).filter(v => v != null);
    return { k, label, low, group, n: got.length, r, winRate: decided.length ? 100 * wonIt / decided.length : null, decided: decided.length,
             winners: mean(wv), losers: mean(lv) };
  });
  /* THE FOUR FACTORS against the margin */
  const four = ['efg', 'tovp', 'orebp', 'ftr'];
  const full = R.filter(r => four.every(k => r.d[k] != null));
  let factors = null;
  if (full.length > 10) {
    const X = full.map(r => four.map(k => r.d[k])), y = full.map(r => r.margin);
    const fit = ols(X, y);
    if (fit) {
      const spread = four.map((k, i) => Math.abs(fit.b[i + 1]) * sd(X.map(row => row[i])));
      const tot = spread.reduce((a, b) => a + b, 0) || 1;
      factors = { n: fit.n, r2: fit.r2, home: fit.b[0], weights: four.map((k, i) => ({ k, label: MEASURES.find(m => m[0] === k)[2],
        coef: fit.b[i + 1], share: 100 * spread[i] / tot, oliver: OLIVER[k] })) };
    }
  }
  const ranked = measures.filter(m => m.r != null).sort((a, b) => b.r - a.r);
  return { n: R.length, homeWin: R.length ? 100 * R.filter(r => r.win).length / R.length : null, measures, ranked, factors };
}

/* per league: the measure most tied to winning in each, for the table */
function byLeague(list, min) {
  const groups = new Map();
  (list || []).forEach(r => { const k = r.league && r.league.id; if (!k) return; if (!groups.has(k)) groups.set(k, { league: r.league, rows: [] }); groups.get(k).rows.push(r); });
  return [...groups.values()].filter(g => g.rows.length >= (min || 20)).map(g => {
    const a = analyse(g.rows);
    return { league: g.league, n: a.n, top: a.ranked[0] || null, second: a.ranked[1] || null, factors: a.factors, homeWin: a.homeWin };
  }).sort((a, b) => b.n - a.n);
}

/* ----------------------------------------------------------- the words ----- */
const pct0 = v => (v == null ? '—' : Math.round(v) + '%');
function insights(a) {
  if (!a || a.n < 20) return ['Too few finished games to say what wins yet.'];
  const out = [];
  const top = a.ranked[0], second = a.ranked[1];
  if (top) out.push('Across ' + a.n.toLocaleString('en-GB') + ' games, ' + top.label + ' is the number most tied to winning: the side that won it won ' +
    pct0(top.winRate) + ' of the time (r = ' + top.r.toFixed(2) + ').');
  if (second) out.push('Next comes ' + second.label + ' (' + pct0(second.winRate) + ' of games, r = ' + second.r.toFixed(2) + ').');
  const style = a.measures.filter(m => m.group === 'style' && m.r != null);
  if (style.length) {
    const s = style.slice().sort((x, y) => Math.abs(x.r) - Math.abs(y.r))[0];
    out.push('Shot selection on its own decides little: ' + s.label + ' went with the win in ' + pct0(s.winRate) + ' of games. How well a side shoots matters far more than where it shoots from.');
  }
  if (a.factors && a.factors.r2 != null) {
    const w = a.factors.weights.slice().sort((x, y) => y.share - x.share);
    out.push('The four factors explain ' + Math.round(a.factors.r2 * 100) + '% of the margin. Their weights here: ' +
      w.map(x => x.label.replace(/ %| rate/, '') + ' ' + Math.round(x.share) + '%').join(', ') + ' - Dean Oliver\'s were 40 / 25 / 20 / 15.');
  }
  if (a.homeWin != null) out.push('The home side won ' + pct0(a.homeWin) + ' of these games.');
  return out;
}

/* ----------------------------------------------------------- the charts ---- */
/* THE RANKING: a bar per measure, its correlation with winning, the win rate of the side that won it beside it */
function barsSVG(a) {
  const rows = a.ranked;
  if (!rows.length) return '';
  const W = 760, rowH = 30, top = 28, left = 230, right = 120, H = top + rows.length * rowH + 16;
  const max = Math.max(0.2, ...rows.map(m => Math.abs(m.r)));
  const x0 = left + (W - left - right) * (rows.some(m => m.r < 0) ? 0.25 : 0);
  const scale = (W - right - x0) / max;
  const bars = rows.map((m, i) => {
    const y = top + i * rowH, w = Math.abs(m.r) * scale, neg = m.r < 0;
    return '<g class="ww-row ww-' + m.group + '"><title>' + esc(m.label) + ': r ' + m.r.toFixed(3) + ', ' + m.n + ' games</title>' +
      '<text x="' + (left - 12) + '" y="' + (y + 19) + '" text-anchor="end" class="ww-lab">' + esc(m.label) + '</text>' +
      '<rect x="' + (neg ? x0 - w : x0).toFixed(1) + '" y="' + (y + 6) + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + (rowH - 12) + '" rx="3" class="ww-bar' + (neg ? ' ww-neg' : '') + '"/>' +
      '<text x="' + ((neg ? x0 - w : x0 + w) + (neg ? -6 : 6)).toFixed(1) + '" y="' + (y + 19) + '" text-anchor="' + (neg ? 'end' : 'start') + '" class="ww-r">' + (m.r >= 0 ? '+' : '') + m.r.toFixed(2) + '</text>' +
      '<text x="' + (W - 8) + '" y="' + (y + 19) + '" text-anchor="end" class="ww-wr">' + pct0(m.winRate) + '</text></g>';
  }).join('');
  return '<svg class="ww-bars" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="each measure\'s correlation with winning">' +
    '<text x="' + x0 + '" y="14" class="ww-axis">how closely it goes with winning (r)</text>' +
    '<text x="' + (W - 8) + '" y="14" text-anchor="end" class="ww-axis">won it → won the game</text>' +
    '<line x1="' + x0 + '" x2="' + x0 + '" y1="' + (top - 4) + '" y2="' + (H - 10) + '" class="ww-zero"/>' + bars + '</svg>';
}

/* THE FOUR FACTORS' WEIGHTS: measured here against Oliver's, two stacked strips */
function factorsSVG(f) {
  if (!f) return '';
  const W = 760, H = 124, x0 = 150, w = W - x0 - 10;
  const order = ['efg', 'tovp', 'orebp', 'ftr'];
  const strip = (y, get, label) => {
    let x = x0;
    const parts = order.map(k => {
      const v = get(k), ww = w * v / 100, seg = '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + Math.max(0, ww - 2).toFixed(1) + '" height="30" rx="4" class="ww-f ww-f-' + k + '"/>' +
        (ww > 46 ? '<text x="' + (x + 10).toFixed(1) + '" y="' + (y + 20) + '" class="ww-fv">' + Math.round(v) + '%</text>' : '');
      x += ww;
      return seg;
    }).join('');
    return '<text x="' + (x0 - 12) + '" y="' + (y + 20) + '" text-anchor="end" class="ww-lab">' + label + '</text>' + parts;
  };
  const byK = k => f.weights.find(x => x.k === k).share;
  return '<svg class="ww-factors" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="the four factors\' weights, measured and Dean Oliver\'s">' +
    strip(10, byK, 'measured here') + strip(52, k => OLIVER[k], 'Dean Oliver') +
    order.map((k, i) => '<rect x="' + (x0 + i * 150) + '" y="' + (H - 22) + '" width="12" height="12" rx="3" class="ww-f ww-f-' + k + '"/>' +
      '<text x="' + (x0 + i * 150 + 18) + '" y="' + (H - 12) + '" class="ww-key">' + esc(f.weights.find(x => x.k === k).label) + '</text>').join('') + '</svg>';
}

/* WINNERS AND LOSERS: each measure's two averages as a dumbbell */
function dumbbellSVG(a) {
  const rows = a.measures.filter(m => m.winners != null && m.losers != null && m.group !== 'pts');
  if (!rows.length) return '';
  const W = 760, rowH = 30, top = 24, left = 230, H = top + rows.length * rowH + 10;
  const body = rows.map((m, i) => {
    const lo = Math.min(m.winners, m.losers), hi = Math.max(m.winners, m.losers), pad = Math.max(1, (hi - lo) * 0.6);
    const min = lo - pad, max = hi + pad, x = v => left + 20 + (W - left - 90) * (v - min) / (max - min);
    const y = top + i * rowH + 15;
    return '<text x="' + (left - 12) + '" y="' + (y + 4) + '" text-anchor="end" class="ww-lab">' + esc(m.label) + '</text>' +
      '<line x1="' + x(m.losers).toFixed(1) + '" x2="' + x(m.winners).toFixed(1) + '" y1="' + y + '" y2="' + y + '" class="ww-dl"/>' +
      '<circle cx="' + x(m.losers).toFixed(1) + '" cy="' + y + '" r="6" class="ww-lose"><title>losers ' + m.losers.toFixed(1) + '</title></circle>' +
      '<circle cx="' + x(m.winners).toFixed(1) + '" cy="' + y + '" r="7" class="ww-win"><title>winners ' + m.winners.toFixed(1) + '</title></circle>' +
      '<text x="' + (W - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ww-dv">' + m.winners.toFixed(1) + ' v ' + m.losers.toFixed(1) + '</text>';
  }).join('');
  return '<svg class="ww-dumb" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="winners\' and losers\' averages">' +
    '<circle cx="' + (left + 26) + '" cy="10" r="6" class="ww-win"/><text x="' + (left + 38) + '" y="14" class="ww-key">winners</text>' +
    '<circle cx="' + (left + 120) + '" cy="10" r="6" class="ww-lose"/><text x="' + (left + 132) + '" y="14" class="ww-key">losers</text>' + body + '</svg>';
}

/* THE ONE THAT MATTERS MOST, GAME BY GAME: its difference against the margin, a dot per game (a sample of 600 at
   most, drawn the same on every visit), coloured by the result, with the fitted line */
function scatterSVG(list, k, label) {
  const pts = (list || []).filter(r => r.d[k] != null);
  if (pts.length < 10) return '';
  const step = Math.max(1, Math.ceil(pts.length / 600)), sample = pts.filter((_, i) => i % step === 0);
  const W = 760, H = 380, L = 56, B = 40, T = 16, Rr = 16;
  const xs = pts.map(r => r.d[k]), ys = pts.map(r => r.margin);
  const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const xmax = Math.max(Math.abs(q(xs, 0.01)), Math.abs(q(xs, 0.99))) * 1.1 || 1, ymax = Math.max(Math.abs(q(ys, 0.01)), Math.abs(q(ys, 0.99))) * 1.1 || 1;
  const X = v => L + (W - L - Rr) * (Math.max(-xmax, Math.min(xmax, v)) + xmax) / (2 * xmax);
  const Y = v => T + (H - T - B) * (ymax - Math.max(-ymax, Math.min(ymax, v))) / (2 * ymax);
  const fit = ols(xs.map(v => [v]), ys);
  const line = fit ? '<line x1="' + X(-xmax).toFixed(1) + '" y1="' + Y(fit.b[0] - fit.b[1] * xmax).toFixed(1) + '" x2="' + X(xmax).toFixed(1) + '" y2="' + Y(fit.b[0] + fit.b[1] * xmax).toFixed(1) + '" class="ww-fit"/>' : '';
  const dots = sample.map(r => '<circle cx="' + X(r.d[k]).toFixed(1) + '" cy="' + Y(r.margin).toFixed(1) + '" r="3.2" class="' + (r.win ? 'ww-pw' : 'ww-pl') + '"/>').join('');
  return '<svg class="ww-scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + ' difference against the margin, game by game">' +
    '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" class="ww-axisl"/><line x1="' + X(0) + '" x2="' + X(0) + '" y1="' + T + '" y2="' + (H - B) + '" class="ww-axisl"/>' +
    dots + line +
    '<text x="' + (W - Rr) + '" y="' + (H - 12) + '" text-anchor="end" class="ww-axis">' + esc(label) + ' difference (home less away) →</text>' +
    '<text x="' + (L - 8) + '" y="' + (T + 10) + '" text-anchor="end" class="ww-axis">won by</text>' +
    '<text x="' + (L - 8) + '" y="' + (H - B) + '" text-anchor="end" class="ww-axis">lost by</text>' +
    (fit ? '<text x="' + (L + 10) + '" y="' + (T + 14) + '" class="ww-key">every point of ' + esc(label) + ' is worth ' + fit.b[1].toFixed(2) + ' points of margin · R² ' + (fit.r2 * 100).toFixed(0) + '%</text>' : '') +
    '</svg>';
}

return { MEASURES, GROUPS, OLIVER, SELECT, rows, analyse, byLeague, insights, pearson, ols, barsSVG, factorsSVG, dumbbellSVG, scatterSVG };
}));
