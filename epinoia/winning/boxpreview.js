'use strict';
/* ============================================================================
   /epinoia/winning/ — THE BOX-SCORE PREVIEW BEFORE THE MODEL IS BUILT (docs/what-wins-model.md I1, transition).
   window.EpinoiaWinBox

   Until the builder has published the public teaser (snapshots whatwins/index.json), the What wins page would have
   nothing to draw. This is the page's previous reading, kept for that gap only: page.js loads this file ONLY when the
   teaser cannot be had (none, network, layout), and never once it exists. It makes the same two public reads the old
   page made, and no more:

     every finished game the viewer may see (its score and its league, through its competition and season), and both
     sides' public box-score measures for those games: eighteen numbers out of each box-score row by their JSON paths
     (EpinoiaWinning.SELECT), never the whole blob, 150 games to a request, four requests at a time.

   Never a game's events, feature lines, player rows or lineups. KEPT IN MEMORY AND sessionStorage for six hours,
   keyed by the reader (epinoia_ww:<user|anon>:box:all:current:-), so winfile.js's sweep and clear() remove it with
   every other What wins copy when the account changes; never localStorage (I7).

     read(D, W, {user?, onProgress?})  -> rows [{id, league, margin, win, d, h, a}]  (D = EpinoiaData, W = EpinoiaWinning)
     preview(W, rows, slug?)           -> a teaser-shaped preview {box: true, n, homeWin, ranked, factors, leagues}
                                          (fractions, as the teaser carries them), for one league or every league
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWinBox = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const TTL = 6 * 3600 * 1000;
const CHUNK = 150, AT_ONCE = 4;
const GAMES = 'games?status=eq.final&select=id,home_score,away_score,competitions(seasons(name,leagues(id,name,slug,country)))';
const BOX = 'team_game_stats';
const mem = new Map();

const keyOf = user => 'epinoia_ww:' + (user || 'anon') + ':box:all:current:-';
const store = () => { try { return root.sessionStorage || null; } catch (_) { return null; } };

function cached(k) {
  const m = mem.get(k);
  if (m && Date.now() - m.at < TTL) return m.rows;
  const S = store();
  if (!S) return null;
  try {
    const j = JSON.parse(S.getItem(k) || 'null');
    if (j && Array.isArray(j.rows) && Date.now() - j.at < TTL) { mem.set(k, j); return j.rows; }
  } catch (_) { /* a browser that keeps nothing reads again */ }
  return null;
}
function keep(k, rows) {
  const e = { at: Date.now(), rows };
  mem.set(k, e);
  const S = store();
  if (!S) return;
  try { S.setItem(k, JSON.stringify(e)); } catch (_) { /* full or blocked: memory still has it */ }
}

async function read(D, W, o) {
  o = o || {};
  const k = keyOf(o.user), hit = cached(k);
  if (hit) return hit;
  const games = await D.all(GAMES);
  const list = (games || []).map(g => {
    const lg = g.competitions && g.competitions.seasons && g.competitions.seasons.leagues;
    return { id: g.id, home_score: g.home_score, away_score: g.away_score, league: lg ? { id: lg.id, name: lg.name, slug: lg.slug, country: lg.country } : null };
  });
  const ids = list.map(g => g.id), chunks = [], tgs = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  let done = 0;
  for (let i = 0; i < chunks.length; i += AT_ONCE) {
    const part = await Promise.all(chunks.slice(i, i + AT_ONCE).map(c => D.all(BOX + '?game_id=in.(' + c.join(',') + ')&select=' + W.SELECT)));
    part.forEach(p => tgs.push(...p));
    done += part.length;
    try { if (typeof o.onProgress === 'function') o.onProgress(done / chunks.length); } catch (_) { /* a progress line never breaks a read */ }
  }
  /* the rows the measuring needs, and no more: the league, the margin, the result and the two sides' numbers */
  const rows = W.rows(list, tgs).map(r => {
    const side = s => { const c = Object.assign({}, s); delete c.game_id; delete c.team_idx; return c; };
    return { id: r.id, league: r.league, margin: r.margin, win: r.win, d: r.d, h: side(r.h), a: side(r.a) };
  });
  keep(k, rows);
  return rows;
}

/* analyse() in the teaser's shape (shares, rates and the home share as fractions), so the page draws it exactly as it
   draws the teaser: the short answer through fromTeaser + insights, the measures from ranked, the leagues table */
function preview(W, all, slug) {
  const R = all || [];
  const list = slug ? R.filter(r => r.league && r.league.slug === slug) : R;
  const a = W.analyse(list), fr = v => (v == null || !isFinite(+v) ? null : +v / 100);
  return {
    box: true, scope: 'teaser', league: slug || null, n: a.n, homeWin: fr(a.homeWin),
    /* under 20 games a correlation is noise: no measures, as the old page drew none */
    ranked: (a.n < 20 ? [] : a.ranked).map(m => ({ k: m.k, label: m.label, r: m.r, winRate: fr(m.winRate) })),
    factors: a.factors ? { r2: a.factors.r2, home: a.factors.home, shares: a.factors.weights.map(w => ({ k: w.k, share: fr(w.share), oliver: fr(w.oliver) })) } : null,
    leagues: W.byLeague(R, 20).map(g => ({ id: g.league.id, slug: g.league.slug, name: g.league.name, n: g.n,
      top: g.top ? { k: g.top.k, label: g.top.label, r: g.top.r, winRate: fr(g.top.winRate) } : null, homeWin: fr(g.homeWin) }))
  };
}

function _clear() { mem.clear(); }

return { read, preview, keyOf, TTL, CHUNK, _clear };
}));
