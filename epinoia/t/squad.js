'use strict';
/* ============================================================================
   THE SQUAD MODEL (the Front office, team page; Louie, 2026-10-08).

   What each position and each player is worth to THIS squad, in points of margin a game and in wins, built from the
   players' own season rates and the minutes each one plays at each position - and what a roster move would change.

   WHY A SQUAD AND NOT A LIST OF PLAYERS. Five men share the floor, so most of what they do is shared out between them:
   somebody has to take the rebound, somebody has to use the possession. A player's rate is measured against his share
   of the floor time (season.js: ORB%, DRB%, STL%, BLK%, USG% all count his opportunities as his share of the team's), so
   SUMMED OVER THE FIVE POSITIONS they are the team's own:
       team OREB%  = Σ positions ORB%           (the offensive glass)
       team DREB%  = Σ positions DRB%           (the defensive glass: the opponent's OREB% is 100 − it)
       steals      = Σ positions STL%           (steals per 100 opponent possessions: part of the turnovers it forces)
       blocks      = Σ positions BLK%           (blocks per 100 opponent twos)
       usage       = Σ positions USG%  ≈ 100    (every play is somebody's)
   and the shooting is the shots' own average: team eFG% = Σ shots × eFG% / Σ shots, turnovers per play, free throws per
   shot. So a 3-point gap in a centre's DRB% is a 3-point gap in the team's DREB%, whoever else plays - which is how a
   small difference inside a position (20% against 23%) is read, and why a low-usage point guard beside two scoring wings
   is not "missing" usage: the squad's usage still adds up, and what is judged is how efficiently it is used.

   WHAT A GAP IS WORTH. Each team aggregate is one of the four factors (or reaches one), and the league's own model -
   its fo file's values, or the pooled model of every league where the league has too few games of its own - prices a
   percentage point of each in points of margin a game (b):
       eFG% (shots)          b_efg × Δ                 TOV% (plays)          b_tov × Δ   (b_tov < 0)
       OREB% (Σ ORB%)        b_oreb × Δ                FT attempt rate       b_ftr × Δ
       DREB% (Σ DRB%)        b_oreb × Δ  (the opponent's OREB% is 100 − DREB%: −b × −Δ)
       steals (Σ STL%)       −b_tov × Δ  (a steal is a forced turnover: one per 100 possessions ≈ one point of TOV%)
       blocks (Σ BLK%)       ≈ 0.27 b_efg × Δ (a block takes a two that goes in 45% of the time, twos ≈ 60% of shots:
                             an estimate, said so)
   A position's line against the league's average AT THAT POSITION (every club's same position, put through the same
   sums), and a player's against the league's average player at his positions, are priced the same way. Points a game
   become wins with the margin model's σ: over 30 games 30(Φ(pts/σ) − ½), over the fixtures left Σ Φ((μ+δ)/σ) − Φ(μ/σ).
   SCORING ON TOP: points per play (PPP) against the league's at the position, times the plays he uses - the plain
   "is the high-usage player efficient enough" number. It overlaps the shooting, turnovers and free throws above, so it is
   shown beside them and never added to them.

   ESTIMATES, SAID SO. The players' rates are their season's, at every position they play; the four factors' values are
   the league's (or the pool's); the team aggregates are rebuilt from the players, so they sit near, not on, the team's
   own figures (the check is returned). It is a model of the squad, for comparing positions and moves; the factor ledger
   above it is the club's accounting.

   THE WHAT-IF. A move is played on the club's minutes at each position a game (every position one game long): a player
   removed hands his minutes at each position to the others there in proportion (no one else there: to those at the
   positions beside it); a player added takes his own minutes a game, at the positions he plays them (his club's
   lineups, else his box-score position), and the others there give way in proportion. The squad is summed again and the
   difference priced. API:
     build(o)      o = { players: season rows (every club's), teamOf: Map player -> club, pos: Map club -> {games, players:
                   [{id, min: [PG..C]}]}, club, values: {c_efg: {b, lo, hi}, c_tovp, c_orebp, c_ftr}, sigma, G?, mus?,
                   gameMin?, names?: Map } -> model | null
     simulate(m, moves)  moves = { remove: [ids], add: [{ id, mpg? }], mpg: { id: minutes a game } } -> what changes
   Pure: no DOM, no fetch; the node tests run it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSquad = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const SLOT_NAME = { PG: 'point guard', SG: 'shooting guard', SF: 'small forward', PF: 'power forward', C: 'centre' };
/* the rates summed over the five positions (a team aggregate), and the shot- and play-weighted ones; un40 summed over
   the five is the team's self-created points per 40 minutes of every position, a game's worth */
const SUM = ['oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct', 'ast_pct', 'usg', 'un40'];
const BLK_EFG = 0.27;
/* what each position is judged on first (Louie: "the specific positions' key stats - rebounding for bigs"), the rest after;
   the ball handlers' self-created points beside their AST% */
const KEY = {
  PG: ['ast_pct', 'au', 'un40', 'tov_pct', 'ppp', 'usg', 'p3_pct', 'p3_rate', 'stl_pct'],
  SG: ['ts', 'ppp', 'un40', 'usg', 'au', 'p3_pct', 'p3_rate', 'ast_pct', 'stl_pct'],
  SF: ['ts', 'p3_pct', 'p3_rate', 'dreb_pct', 'stl_pct', 'au', 'rim_rate', 'ppp'],
  PF: ['dreb_pct', 'oreb_pct', 'ts', 'p3_rate', 'blk_pct', 'rim_save', 'au', 'ppp'],
  C: ['dreb_pct', 'oreb_pct', 'blk_pct', 'rim_save', 'ts', 'rim_pct', 'tov_pct', 'au', 'ppp']
};
const STAT_LABEL = { ast_pct: 'AST%', tov_pct: 'TOV%', ppp: 'points per play', usg: 'usage', p3_pct: '3P%', p3_rate: '3PA rate', stl_pct: 'STL%', ts: 'TS%',
  efg: 'eFG%', dreb_pct: 'DRB%', oreb_pct: 'ORB%', blk_pct: 'BLK%', rim_rate: 'rim rate', rim_pct: 'rim FG%', ftr: 'FT attempt rate', ft_pct: 'FT%', vorp: 'VORP',
  un40: 'self-created points per 40', au: 'AST/USG', rim_save: 'rim points saved per 100' };
/* lower is better */
const LOWER = { tov_pct: true };
/* the priced parts: key, what it is called, the factor whose b prices it, how */
const PARTS = [
  { k: 'shoot', label: 'shooting (eFG%)', f: 'c_efg' },
  { k: 'tov', label: 'ball security (TOV%)', f: 'c_tovp' },
  { k: 'oreb', label: 'offensive glass (ORB%)', f: 'c_orebp' },
  { k: 'ftr', label: 'getting to the line (FTA/FGA)', f: 'c_ftr' },
  { k: 'dreb', label: 'defensive glass (DRB%)', f: 'c_orebp' },
  { k: 'stl', label: 'ball pressure (STL%)', f: 'c_tovp' },
  { k: 'blk', label: 'rim protection (BLK%)', f: 'c_efg', est: true }
];

/* ------------------------------------------------------------------ small things --- */
const isNum = v => typeof v === 'number' && isFinite(v);
/* a Map, or an object of keys, as a Map (a Map made in another window or a test's own realm is a Map too) */
const asMap = x => (x && typeof x.get === 'function' && typeof x.forEach === 'function' ? x : new Map(Object.entries(x || {})));
const num = v => (v == null || v === '' ? null : (isFinite(+v) ? +v : null));
function Phi(x) {
  const W = root.EpinoiaWinStats; if (W && W.normCdf) return W.normCdf(x);
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
const wins30 = (pts, sigma) => (isNum(pts) ? 30 * (Phi(pts / sigma) - 0.5) : null);
function winsFrom(delta, mus, sigma, G) {
  if (!isNum(delta)) return null;
  if (mus && mus.length) return mus.reduce((a, f) => a + Phi((f.mu + delta) / sigma) - Phi(f.mu / sigma), 0);
  return (G || 30) * (Phi(delta / sigma) - 0.5);
}
const mean = a => { const x = a.filter(isNum); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
function sd(a) { const x = a.filter(isNum); if (x.length < 2) return null; const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) * (v - m), 0) / (x.length - 1)); }
function quant(a, q) { const x = a.filter(isNum).sort((p, r) => p - r); if (!x.length) return null; const i = (x.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return x[lo] + (x[hi] - x[lo]) * (i - lo); }

/* THE PLAY-BY-PLAY'S SPLITS (half court, assisted and unassisted) count only the games it covers: a player's are read
   where it covers at least half his games and five of them, his minutes in them taken in proportion to his games
   (EV_MIN_SHARE, EV_MIN_GP). A league covered for one game in forty has no such splits, and the squad says so. */
const EV_MIN_SHARE = 0.5, EV_MIN_GP = 5;
function evOf(r) {
  const gp = num(r.gp) || 0, eg = num(r.ev_gp) || 0, min = num(r.min) || 0;
  if (!(gp > 0) || eg < EV_MIN_GP || eg / gp < EV_MIN_SHARE || !(min > 0)) return null;
  const evMin = min * Math.min(1, eg / gp);
  const hf = num(r.ev_half_fga) || 0, ht = num(r.ev_half_fta) || 0, hv = num(r.ev_half_tov) || 0;
  return { gp: eg, min: evMin, hcUsg: num(r.ev_half_usg), unPts: num(r.ev_unast_pts) || 0, astM: num(r.ev_ast_fgm) || 0, unM: num(r.ev_unast_fgm) || 0,
    astRim: num(r.ev_ast_rimM) || 0, unRim: num(r.ev_unast_rimM) || 0,
    hc: { pts: num(r.ev_half_pts) || 0, fga: hf, fta: ht, tov: hv, plays: hf + 0.44 * ht + hv } };
}

/* the rim points per 100 opponent possessions he saves when on (off − on): null without both sides' rim counts */
function rimSave(r) {
  const von = num(r.def_rim_vol_on), voff = num(r.def_rim_vol_off), fon = num(r.def_rim_fg_on), foff = num(r.def_rim_fg_off);
  return [von, voff, fon, foff].every(isNum) ? 2 * (voff * foff - von * fon) / 100 : null;
}

/* a player's season line as the squad uses it: his per-minute volumes and his rates */
function lineOf(r) {
  const min = num(r && r.min);
  if (!r || !(min > 0)) return null;
  const fga = num(r.fga) || 0, fta = num(r.fta) || 0, tov = num(r.tov) || 0, p3a = num(r.p3a) || 0, p3m = num(r.p3m) || 0, ftm = num(r.ftm) || 0;
  const fgm = num(r.fgm) || 0, pts = num(r.pts) || 0, rimA = num(r.rimA) || 0;
  const plays = fga + 0.44 * fta + tov;
  const ev = evOf(r);
  return {
    id: String(r.id), min, gp: num(r.gp) || 0,
    pm: { fga: fga / min, fta: fta / min, tov: tov / min, p3a: p3a / min, p3m: p3m / min, ftm: ftm / min, plays: plays / min, pts: pts / min,
          efgm: (fgm + 0.5 * p3m) / min, rimA: rimA / min,
          reb: (num(r.reb) || 0) / min, ast: (num(r.ast) || 0) / min, stl: (num(r.stl) || 0) / min, blk: (num(r.blk) || 0) / min },
    rate: { oreb_pct: num(r.oreb_pct), dreb_pct: num(r.dreb_pct), stl_pct: num(r.stl_pct), blk_pct: num(r.blk_pct), ast_pct: num(r.ast_pct),
            usg: num(r.usg), tov_pct: num(r.tov_pct), ts: num(r.ts), efg: num(r.efg), p3_pct: num(r.p3_pct), p3_rate: num(r.p3_rate),
            rim_rate: num(r.rim_rate), rim_pct: num(r.rim_pct), ftr: num(r.ftr), ft_pct: num(r.ft_pct), ppp: num(r.ppp),
            /* BALL HANDLING IS SELF-CREATION TOO (Louie, 2026-10-08: "ball handling is also captured by unassisted points"):
               the points he scores off no pass, per 40 minutes, beside his AST% */
            un40: ev ? 40 * ev.unPts / ev.min : null,
            /* AST/USG (2026-10-09): how much he makes for others for the plays he uses (season.js au) */
            au: num(r.au) != null ? num(r.au) : (num(r.ast_pct) != null && num(r.usg) > 0 ? num(r.ast_pct) / num(r.usg) : null),
            /* THE RIM WITH HIM ON THE FLOOR (Louie, 2026-10-09: "protector needs blk% and also rim vol/% on-off data"): the
               opponents' rim points per 100 possessions with him off minus with him on - their rim attempts per 100 times
               their rim FG%, twice - so fewer shots there and fewer made both count; season.js leaves it null under 15
               opponent rim attempts either side */
            rim_save: rimSave(r) },
    vorp: num(r.vorp), bpm: num(r.bpm),
    /* who creates and who is created for (the events splits, where they cover his games): the unassisted share of his
       points, the assisted share of his makes, and of his makes at the rim */
    unast: ev ? num(r.ev_unast_pts_sh) : null, astSh: ev ? num(r.ev_ast_sh) : null, rimAstp: ev ? num(r.ev_rim_astp) : null,
    ev
  };
}

/* a player's minutes at each position as shares, from a pos file's row, else from his box-score position (1-5: 2.3 is
   70% shooting guard and 30% small forward) */
function shareOfRow(min) {
  const t = (min || []).reduce((a, v) => a + (num(v) > 0 ? +v : 0), 0);
  return t > 0 ? [0, 1, 2, 3, 4].map(k => (num(min[k]) > 0 ? +min[k] / t : 0)) : null;
}
function shareOfPos(p) {
  const x = Math.max(1, Math.min(5, isNum(p) ? p : 3)) - 1, lo = Math.floor(x), hi = Math.min(4, lo + 1), f = x - lo;
  const s = [0, 0, 0, 0, 0];
  s[lo] += 1 - f; if (hi !== lo) s[hi] += f; else s[lo] = 1;
  return s;
}

/* ------------------------------------------------------------------ one squad, summed --- */
/* who = [{line, at: [minutes a game at PG..C]}] -> the squad: each position's line, and the team's aggregates */
function sumSquad(who) {
  const slot = [0, 1, 2, 3, 4].map(k => {
    const here = who.filter(w => w.at[k] > 0);
    const tot = here.reduce((a, w) => a + w.at[k], 0);
    const out = { min: tot, players: here.map(w => ({ id: w.line.id, min: w.at[k], share: tot > 0 ? w.at[k] / tot : 0 })) };
    /* the rates: minutes-weighted over the players who have each one */
    const keys = Object.keys(here[0] ? here[0].line.rate : {});
    out.rate = {};
    keys.forEach(st => {
      let s = 0, w = 0;
      here.forEach(x => { const v = x.line.rate[st]; if (isNum(v)) { s += v * x.at[k]; w += x.at[k]; } });
      out.rate[st] = w > 0 ? s / w : null;
    });
    /* the volumes and the shot-weighted rates at this position */
    const v = { fga: 0, fta: 0, tov: 0, plays: 0, pts: 0, efgm: 0, p3a: 0, p3m: 0, ftm: 0, rimA: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
    here.forEach(x => Object.keys(v).forEach(q => { v[q] += x.line.pm[q] * x.at[k]; }));
    out.vol = v;
    out.rate.efg = v.fga > 0 ? 100 * v.efgm / v.fga : out.rate.efg;
    out.rate.ppp = v.plays > 0 ? v.pts / v.plays : out.rate.ppp;
    out.rate.tov_pct = v.plays > 0 ? 100 * v.tov / v.plays : out.rate.tov_pct;
    out.rate.ftr = v.fga > 0 ? 100 * v.fta / v.fga : out.rate.ftr;
    out.rate.p3_rate = v.fga > 0 ? 100 * v.p3a / v.fga : out.rate.p3_rate;
    out.rate.p3_pct = v.p3a >= 0.05 ? 100 * v.p3m / v.p3a : out.rate.p3_pct;
    out.rate.ts = v.fga + v.fta > 0 ? 100 * v.pts / (2 * (v.fga + 0.44 * v.fta)) : out.rate.ts;
    /* AST/USG at a position: its AST% over its usage, not the mean of the men's ratios */
    out.rate.au = isNum(out.rate.ast_pct) && out.rate.usg > 0 ? out.rate.ast_pct / out.rate.usg : out.rate.au;
    /* per 40 at the position (its production): what a full game there produces */
    out.p40 = tot > 0 ? { pts: 40 * v.pts / tot, reb: 40 * v.reb / tot, ast: 40 * v.ast / tot, stl: 40 * v.stl / tot, blk: 40 * v.blk / tot, plays: 40 * v.plays / tot } : null;
    return out;
  });
  /* THE TEAM: the sums over the five, the shots' and plays' own averages */
  const team = { sum: {}, rate: {}, vol: {} };
  SUM.forEach(st => { const xs = slot.map(s => s.rate[st]); team.sum[st] = xs.every(isNum) ? xs.reduce((a, v) => a + v, 0) : null; });
  const V = { fga: 0, fta: 0, tov: 0, plays: 0, pts: 0, efgm: 0, p3a: 0, p3m: 0, ftm: 0 };
  slot.forEach(s => Object.keys(V).forEach(q => { V[q] += s.vol[q]; }));
  team.vol = V;
  team.rate = { efg: V.fga > 0 ? 100 * V.efgm / V.fga : null, tov_pct: V.plays > 0 ? 100 * V.tov / V.plays : null, ftr: V.fga > 0 ? 100 * V.fta / V.fga : null,
    p3_rate: V.fga > 0 ? 100 * V.p3a / V.fga : null, p3_pct: V.p3a > 0 ? 100 * V.p3m / V.p3a : null, ppp: V.plays > 0 ? V.pts / V.plays : null,
    ft_pct: V.fta > 0 ? 100 * V.ftm / V.fta : null,
    /* self-created points a game: each position's per 40 over the minutes it is played */
    unPg: slot.every(s => isNum(s.rate.un40)) ? slot.reduce((a, s) => a + s.rate.un40 * s.min / 40, 0) : null };
  return { slot, team };
}

/* the priced parts of a difference between two squads' aggregates (d = mine − theirs), in points of margin a game */
function priceTeam(d, values) {
  const b = k => (values && values[k] && isNum(values[k].b) ? values[k].b : null);
  const out = {};
  const put = (k, v, f, mult) => { const bb = b(f); out[k] = isNum(v) && isNum(bb) ? mult * bb * v : null; };
  put('shoot', d.efg, 'c_efg', 1);
  put('tov', d.tov_pct, 'c_tovp', 1);
  put('oreb', d.oreb_pct, 'c_orebp', 1);
  put('ftr', d.ftr, 'c_ftr', 1);
  put('dreb', d.dreb_pct, 'c_orebp', 1);
  put('stl', d.stl_pct, 'c_tovp', -1);
  put('blk', d.blk_pct, 'c_efg', BLK_EFG);
  out.total = PARTS.reduce((a, p) => a + (isNum(out[p.k]) ? out[p.k] : 0), 0);
  return out;
}
/* a squad's team aggregates as the parts' inputs */
const aggOf = Q => ({ efg: Q.team.rate.efg, tov_pct: Q.team.rate.tov_pct, ftr: Q.team.rate.ftr, oreb_pct: Q.team.sum.oreb_pct, dreb_pct: Q.team.sum.dreb_pct,
  stl_pct: Q.team.sum.stl_pct, blk_pct: Q.team.sum.blk_pct, ast_pct: Q.team.sum.ast_pct, usg: Q.team.sum.usg, p3_rate: Q.team.rate.p3_rate, p3_pct: Q.team.rate.p3_pct,
  ppp: Q.team.rate.ppp, ft_pct: Q.team.rate.ft_pct, unPg: Q.team.rate.unPg });
const AGG = ['efg', 'tov_pct', 'ftr', 'oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct', 'ast_pct', 'usg', 'p3_rate', 'p3_pct', 'ppp', 'ft_pct', 'unPg'];
const diff = (a, b) => { const o = {}; Object.keys(a).forEach(k => { o[k] = isNum(a[k]) && isNum(b[k]) ? a[k] - b[k] : null; }); return o; };

/* ------------------------------------------------------------------ the model --- */
function build(o) {
  o = o || {};
  const club = String(o.club || '');
  const rows = Array.isArray(o.players) ? o.players : [];
  const teamOf = asMap(o.teamOf);
  const posBy = asMap(o.pos);
  const gameMin = isNum(o.gameMin) && o.gameMin > 0 ? o.gameMin : 40;
  const sigma = isNum(o.sigma) && o.sigma > 0 ? o.sigma : 12;
  const values = o.values || {};
  const names = asMap(o.names);
  const lines = new Map(), rowById = new Map();
  rows.forEach(r => { const l = lineOf(r); if (l) { lines.set(l.id, l); rowById.set(l.id, r); } });
  /* each club's players with their minutes a game at each position: the pos file's minutes where there is one (scaled
     to a game at each position), else each player's season minutes at his box-score position */
  const clubs = new Map();
  rows.forEach(r => { const t = teamOf.get(String(r.id)); if (t != null && lines.has(String(r.id))) { const k = String(t); if (!clubs.has(k)) clubs.set(k, []); clubs.get(k).push(String(r.id)); } });
  const squadOf = tid => {
    const ids = clubs.get(tid) || [], P = posBy.get(tid);
    const fromFile = new Map();
    if (P && Array.isArray(P.players)) P.players.forEach(p => { if (p && p.id != null && Array.isArray(p.min)) fromFile.set(String(p.id), p.min.map(v => Math.max(0, num(v) || 0))); });
    /* minutes at each position, the season's: the file's (its games), else the season line's at his box-score position */
    const raw = new Map();
    const games = P && num(P.games) > 0 ? +P.games : null;
    ids.forEach(id => {
      const l = lines.get(id), f = fromFile.get(id);
      if (f && f.some(v => v > 0)) raw.set(id, f);
      else if (!fromFile.size) raw.set(id, shareOfPos(num((rowById.get(id) || {}).bpm_pos)).map(s => s * l.min));
    });
    fromFile.forEach((m, id) => { if (!raw.has(id) && lines.has(id) && m.some(v => v > 0)) raw.set(id, m); });
    /* NOBODY AT A POSITION (box-score positions put no one there): the players at the position beside it with the more
       minutes cover it, half their time there - every position is played */
    const sumAt = k => [...raw.values()].reduce((a, m) => a + m[k], 0);
    [0, 4, 1, 3, 2].forEach(k => {
      if (sumAt(k) > 0) return;
      const nb = [k - 1, k + 1].filter(j => j >= 0 && j <= 4).sort((a, b) => sumAt(b) - sumAt(a))[0];
      if (nb == null || !(sumAt(nb) > 0)) return;
      raw.forEach((m, id) => { if (m[nb] > 0) { const h = m[nb] / 2; const c = m.slice(); c[nb] -= h; c[k] += h; raw.set(id, c); } });
    });
    /* a game at each position: each position's minutes scaled to gameMin */
    const tot = [0, 1, 2, 3, 4].map(k => [...raw.values()].reduce((a, m) => a + m[k], 0));
    const who = [...raw].filter(([id]) => lines.has(id)).map(([id, m]) => ({ line: lines.get(id), at: m.map((v, k) => (tot[k] > 0 ? gameMin * v / tot[k] : 0)),
      raw: m, share: shareOfRow(m) }));
    return { who, games, source: fromFile.size ? 'lineups' : 'positions' };
  };
  const all = new Map();
  clubs.forEach((_, tid) => { const s = squadOf(tid); if (s.who.length >= 5) all.set(tid, Object.assign(s, { Q: sumSquad(s.who) })); });
  /* the club's own minutes may come from its own lineups (o.clubPos), the freshest */
  if (o.clubPos && Array.isArray(o.clubPos.players)) {
    posBy.set(club, o.clubPos);
    const s = squadOf(club);
    if (s.who.length >= 5) all.set(club, Object.assign(s, { Q: sumSquad(s.who) }));
  }
  const me = all.get(club);
  if (!me || all.size < 4) return null;
  const others = [...all.entries()];

  /* THE LEAGUE AT EACH POSITION: every club's same position, the same sums; and the team aggregates */
  const statsAt = new Set();
  me.Q.slot.forEach(s => Object.keys(s.rate).forEach(k => statsAt.add(k)));
  statsAt.add('vorp');
  const vorpAt = (S, k) => S.who.reduce((a, w) => {
    const sh = w.share ? w.share[k] : (w.at[k] / Math.max(1e-9, w.at.reduce((x, y) => x + y, 0)));
    return a + (isNum(w.line.vorp) ? sh * w.line.vorp : 0);
  }, 0);
  const lg = [0, 1, 2, 3, 4].map(k => {
    const out = {};
    statsAt.forEach(st => {
      const xs = others.map(([, S]) => (st === 'vorp' ? vorpAt(S, k) : S.Q.slot[k].rate[st])).filter(isNum);
      out[st] = { avg: mean(xs), sd: sd(xs), p25: quant(xs, 0.25), p75: quant(xs, 0.75), top: quant(xs, 0.9), lo: xs.length ? Math.min(...xs) : null, hi: xs.length ? Math.max(...xs) : null,
        n: xs.length, vals: xs };
    });
    /* the league position's volumes (its share of a team's shots and plays) and per-40 production */
    out._vol = {}; ['fga', 'fta', 'plays', 'pts', 'tov', 'efgm', 'p3a'].forEach(q => { out._vol[q] = mean(others.map(([, S]) => S.Q.slot[k].vol[q])); });
    out._p40 = {}; ['pts', 'reb', 'ast', 'stl', 'blk', 'plays'].forEach(q => { out._p40[q] = mean(others.map(([, S]) => (S.Q.slot[k].p40 ? S.Q.slot[k].p40[q] : null))); });
    return out;
  });
  const lgTeam = {};
  AGG.forEach(k => {
    const xs = others.map(([, S]) => aggOf(S.Q)[k]).filter(isNum);
    lgTeam[k] = { avg: mean(xs), sd: sd(xs), p25: quant(xs, 0.25), p75: quant(xs, 0.75), lo: xs.length ? Math.min(...xs) : null, hi: xs.length ? Math.max(...xs) : null, n: xs.length, rank: null };
  });
  const mine = aggOf(me.Q);
  Object.keys(lgTeam).forEach(k => {
    const xs = others.map(([, S]) => aggOf(S.Q)[k]).filter(isNum), v = mine[k];
    if (isNum(v)) lgTeam[k].rank = 1 + xs.filter(x => (LOWER[k] ? x < v : x > v)).length;
  });
  const lgAgg = Object.fromEntries(Object.keys(lgTeam).map(k => [k, lgTeam[k].avg]));
  const teamParts = priceTeam(diff(mine, lgAgg), values);

  /* EACH POSITION'S CONTRIBUTION against the league's at that position, priced: the position's slice of each team
     aggregate (a sum's own value; the shots' share of the team's shots times the gap in eFG%, and so on) */
  const slotParts = k => {
    const s = me.Q.slot[k], L = lg[k], T = me.Q.team.vol;
    const dS = st => (isNum(s.rate[st]) && isNum(L[st] && L[st].avg) ? s.rate[st] - L[st].avg : null);
    const shotSh = T.fga > 0 ? s.vol.fga / T.fga : 0, playSh = T.plays > 0 ? s.vol.plays / T.plays : 0;
    const d = { efg: isNum(dS('efg')) ? shotSh * dS('efg') : null, tov_pct: isNum(dS('tov_pct')) ? playSh * dS('tov_pct') : null, ftr: isNum(dS('ftr')) ? shotSh * dS('ftr') : null,
      oreb_pct: dS('oreb_pct'), dreb_pct: dS('dreb_pct'), stl_pct: dS('stl_pct'), blk_pct: dS('blk_pct') };
    return priceTeam(d, values);
  };
  /* the scoring value: the plays the position uses against what the league's same position makes of the same plays */
  const scoring = (ppp, plays, lgPpp) => (isNum(ppp) && isNum(lgPpp) && isNum(plays) ? plays * (ppp - lgPpp) : null);

  const games = me.games || null;
  const slots = SLOTS.map((key, k) => {
    const s = me.Q.slot[k], L = lg[k], parts = slotParts(k);
    const stats = {};
    statsAt.forEach(st => {
      const v = st === 'vorp' ? vorpAt(me, k) : s.rate[st], c = L[st];
      if (!isNum(v) || !c || !isNum(c.avg)) return;
      const z = isNum(c.sd) && c.sd > 0 ? (v - c.avg) / c.sd : null;
      const better = c.vals.filter(x => (LOWER[st] ? x < v : x > v)).length;
      /* the league's clubs include this one (a league's average is every club's): its place is among them all */
      stats[st] = { v, avg: c.avg, sd: c.sd, p25: c.p25, p75: c.p75, lo: c.lo, hi: c.hi, z: isNum(z) ? (LOWER[st] ? -z : z) : null, rank: better + 1, of: c.vals.length,
        lower: !!LOWER[st] };
    });
    const playsPg = s.vol.plays;
    const players = s.players.map(p => {
      const l = lines.get(p.id);
      return { id: p.id, name: names.get(p.id) || '', min: p.min, share: p.share, mpg: l ? l.min / Math.max(1, l.gp) : null,
        ts: l.rate.ts, ppp: l.rate.ppp, usg: l.rate.usg, vorp: l.vorp };
    }).sort((a, b) => b.min - a.min);
    return { key, k, name: SLOT_NAME[key], players, stats, p40: s.p40, lgP40: L._p40, plays: playsPg,
      parts, pts: parts.total, wins30: wins30(parts.total, sigma), scoring: scoring(s.rate.ppp, playsPg, L.ppp ? L.ppp.avg : null),
      key5: KEY[key].filter(st => stats[st]), vorp: stats.vorp || null };
  });

  /* EACH PLAYER against the league's average player at his positions, priced the same way, over the minutes he plays */
  const T = me.Q.team.vol;
  const playersOut = me.who.map(w => {
    const l = w.line, mins = w.at.reduce((a, v) => a + v, 0);
    if (!(mins > 0)) return null;
    const wt = w.at.map(v => v / mins);
    const lgAt = st => { let s = 0, q = 0; wt.forEach((x, k) => { const a = lg[k][st] && lg[k][st].avg; if (x > 0 && isNum(a)) { s += x * a; q += x; } }); return q > 0 ? s / q : null; };
    const d = st => (isNum(l.rate[st]) && isNum(lgAt(st)) ? l.rate[st] - lgAt(st) : null);
    const shotSh = T.fga > 0 ? l.pm.fga * mins / T.fga : 0, playSh = T.plays > 0 ? l.pm.plays * mins / T.plays : 0, floor = mins / gameMin;
    const parts = priceTeam({ efg: isNum(d('efg')) ? shotSh * d('efg') : null, tov_pct: isNum(d('tov_pct')) ? playSh * d('tov_pct') : null,
      ftr: isNum(d('ftr')) ? shotSh * d('ftr') : null, oreb_pct: isNum(d('oreb_pct')) ? floor * d('oreb_pct') : null, dreb_pct: isNum(d('dreb_pct')) ? floor * d('dreb_pct') : null,
      stl_pct: isNum(d('stl_pct')) ? floor * d('stl_pct') : null, blk_pct: isNum(d('blk_pct')) ? floor * d('blk_pct') : null }, values);
    const main = wt.indexOf(Math.max(...wt));
    return { id: l.id, name: names.get(l.id) || '', mpg: mins, at: w.at.slice(), main: SLOTS[main], slotShare: wt,
      usg: l.rate.usg, ts: l.rate.ts, ppp: l.rate.ppp, ast_pct: l.rate.ast_pct, dreb_pct: l.rate.dreb_pct, oreb_pct: l.rate.oreb_pct, un40: l.rate.un40,
      vorp: l.vorp, bpm: l.bpm, parts, pts: parts.total, wins30: wins30(parts.total, sigma),
      scoring: scoring(l.rate.ppp, l.pm.plays * mins, lgAt('ppp')),
      /* against the league's average player at his positions, for the fit lines: TS%, points a play, usage */
      lgTs: lgAt('ts'), lgPpp: lgAt('ppp'), lgUsg: lgAt('usg'), astSh: l.astSh, unast: l.unast, rimAstp: l.rimAstp };
  }).filter(Boolean).sort((a, b) => b.mpg - a.mpg);

  /* THE SQUAD AS A WHOLE: each aggregate against the league's, priced, and the check against the team's own figures */
  const whole = [
    { k: 'shoot', label: 'Shooting', st: 'efg', unit: '%', pts: teamParts.shoot },
    { k: 'tov', label: 'Ball security', st: 'tov_pct', unit: '%', pts: teamParts.tov },
    { k: 'ftr', label: 'Getting to the line', st: 'ftr', unit: '%', pts: teamParts.ftr },
    { k: 'oreb', label: 'Offensive rebounding', st: 'oreb_pct', unit: '%', pts: teamParts.oreb },
    { k: 'dreb', label: 'Defensive rebounding', st: 'dreb_pct', unit: '%', pts: teamParts.dreb },
    { k: 'stl', label: 'Ball pressure', st: 'stl_pct', unit: '', pts: teamParts.stl },
    { k: 'blk', label: 'Rim protection', st: 'blk_pct', unit: '', pts: teamParts.blk, est: true },
    { k: 'ast', label: 'Playmaking', st: 'ast_pct', unit: '', pts: null, sum: true },
    { k: 'un', label: 'Self-created points', st: 'unPg', unit: 'pts', pts: null },
    { k: 'spacing', label: 'Three-point volume', st: 'p3_rate', unit: '%', pts: null },
    { k: 'p3', label: 'Three-point shooting', st: 'p3_pct', unit: '%', pts: null }
  ].map(r => Object.assign(r, { v: mine[r.st], avg: lgTeam[r.st] ? lgTeam[r.st].avg : null, p25: lgTeam[r.st] ? lgTeam[r.st].p25 : null, p75: lgTeam[r.st] ? lgTeam[r.st].p75 : null,
    lo: lgTeam[r.st] ? lgTeam[r.st].lo : null, hi: lgTeam[r.st] ? lgTeam[r.st].hi : null, sd: lgTeam[r.st] ? lgTeam[r.st].sd : null,
    rank: lgTeam[r.st] ? lgTeam[r.st].rank : null, of: lgTeam[r.st] ? lgTeam[r.st].n : null, lower: !!LOWER[r.st], wins30: wins30(r.pts, sigma),
    /* who supplies a summed one: each position's part of it, the club's and the league's average club's */
    by: SUM_OF[r.st] ? SLOTS.map((key, k) => ({ key, v: me.Q.slot[k].rate[SUM_OF[r.st]], avg: lg[k][SUM_OF[r.st]] ? lg[k][SUM_OF[r.st]].avg : null })) : null })).filter(r => isNum(r.v));

  /* USAGE AND EFFICIENCY: who uses the plays, and how well (Louie: "if the higher usage players are efficient enough") */
  const usage = playersOut.filter(p => isNum(p.usg) && p.mpg >= 8).map(p => ({ id: p.id, name: p.name, usg: p.usg, ppp: p.ppp, ts: p.ts, scoring: p.scoring, main: p.main, mpg: p.mpg,
    lgPpp: p.lgPpp, lgTs: p.lgTs, lgUsg: p.lgUsg }))
    .sort((a, b) => b.usg - a.usg);

  /* THE GROUPS (Louie: "whether each player, the groups ball handlers/bigs etc. are actively aiding winning"): the
     positions' priced parts added up - the ball handlers at the point and the two, the wing at the three, the bigs at
     the four and five */
  const groups = GROUPS.map(g => {
    const ss = slots.filter(s => g.slots.includes(s.key)), parts = {};
    PARTS.forEach(p => { const xs = ss.map(s => s.parts[p.k]).filter(isNum); parts[p.k] = xs.length ? xs.reduce((a, v) => a + v, 0) : null; });
    const pts = ss.reduce((a, s) => a + (isNum(s.pts) ? s.pts : 0), 0), sc = ss.map(s => s.scoring).filter(isNum);
    return { k: g.k, label: g.label, slots: g.slots, parts, pts, wins30: wins30(pts, sigma), scoring: sc.length ? sc.reduce((a, v) => a + v, 0) : null };
  });

  /* COVERED OR NOT (Louie: "someone on the floor has to grab rebounds"): a position short of the league's at a shared-out
     statistic (half an SD or more under its own position's average) is covered when the squad's whole still stands at
     the league's (within a quarter of an SD), by the positions above theirs; otherwise the squad is short of it too */
  const cover = COVER.map(st => {
    const T = st === 'un40' ? lgTeam.unPg : lgTeam[st], v = st === 'un40' ? mine.unPg : mine[st];
    if (!T || !isNum(v) || !isNum(T.avg)) return null;
    const tz = isNum(T.sd) && T.sd > 0 ? (v - T.avg) / T.sd : null;
    const short = slots.filter(s => s.stats[st] && isNum(s.stats[st].z) && s.stats[st].z <= -0.5).map(s => ({ key: s.key, z: s.stats[st].z, v: s.stats[st].v, avg: s.stats[st].avg }));
    const help = slots.filter(s => s.stats[st] && isNum(s.stats[st].z) && s.stats[st].z >= 0.5).map(s => ({ key: s.key, z: s.stats[st].z, v: s.stats[st].v, avg: s.stats[st].avg }));
    if (!short.length) return null;
    const pk = { oreb_pct: 'oreb', dreb_pct: 'dreb', stl_pct: 'stl', blk_pct: 'blk' }[st];
    return { st, label: COVER_LABEL[st], short, help, team: { v, avg: T.avg, z: tz }, covered: isNum(tz) && tz >= -0.25, pts: pk ? teamParts[pk] : null };
  }).filter(Boolean);

  /* THE HALF COURT (Louie, 2026-10-08: "a half court usg% breakdown of the top usg% players and their relative TS%, TO% and
     PPP"): from the play-by-play's half-court split, each player's half-court plays (FGA + 0.44 FTA + TOV) per minute
     against the team's per minute of the game - his usage there - his share of all of them, and what he makes of them
     against the league's half court as a whole */
  const teamRow = new Map((Array.isArray(o.teams) ? o.teams : []).map(t => [String(t.id), t]));
  const evTeam = t => !!(t && num(t.gp) > 0 && num(t.ev_gp) >= EV_MIN_GP && t.ev_gp / t.gp >= EV_MIN_SHARE);
  const hcLine = (pts, fga, fta, tov) => { const plays = fga + 0.44 * fta + tov; return plays > 0 ? { plays, ppp: pts / plays, ts: fga + fta > 0 ? 100 * pts / (2 * (fga + 0.44 * fta)) : null, tov_pct: 100 * tov / plays } : null; };
  const hcOfTeam = t => (evTeam(t) ? Object.assign({ gp: +t.ev_gp }, hcLine(num(t.ev_half_pts) || 0, num(t.ev_half_fga) || 0, num(t.ev_half_fta) || 0, num(t.ev_half_tov) || 0)) : null);
  let halfCourt = null;
  {
    const lgT = [...teamRow.values()].filter(evTeam);
    const sum = f => lgT.reduce((a, t) => a + (num(t[f]) || 0), 0);
    const L = lgT.length >= 4 ? hcLine(sum('ev_half_pts'), sum('ev_half_fga'), sum('ev_half_fta'), sum('ev_half_tov')) : null;
    const T = hcOfTeam(teamRow.get(club));
    if (L && T && T.plays > 0) {
      const perMin = T.plays / (gameMin * T.gp);            // the team's half-court plays a minute of the game
      const players = me.who.map(w => {
        const l = w.line, e = l.ev;
        if (!e || !(e.hc.plays > 0) || e.min < HC_MIN || l.min / Math.max(1, l.gp) < 10) return null;
        const x = hcLine(e.hc.pts, e.hc.fga, e.hc.fta, e.hc.tov);
        /* season.js's own half-court usage where it has it (his plays over his team's half-court chances while he was on) */
        return { id: l.id, name: names.get(l.id) || '', mpg: l.min / Math.max(1, l.gp), usg: isNum(e.hcUsg) ? e.hcUsg : 100 * (e.hc.plays / e.min) / perMin, share: 100 * e.hc.plays / T.plays,
          playsPg: e.hc.plays / e.gp, ts: x.ts, tov: x.tov_pct, ppp: x.ppp,
          rts: isNum(x.ts) && isNum(L.ts) ? x.ts - L.ts : null, rtov: x.tov_pct - L.tov_pct, rppp: x.ppp - L.ppp, value: (e.hc.plays / e.gp) * (x.ppp - L.ppp) };
      }).filter(p => p && p.share >= HC_SHARE).sort((a, b) => b.usg - a.usg);
      if (players.length) halfCourt = { team: { ppp: T.ppp, ts: T.ts, tov: T.tov_pct, playsPg: T.plays / T.gp, games: T.gp }, lg: { ppp: L.ppp, ts: L.ts, tov: L.tov_pct, teams: lgT.length },
        players: players.slice(0, HC_TOP), more: Math.max(0, players.length - HC_TOP) };
    }
  }

  /* THE BALL MOVING (the play-by-play's assisted and unassisted makes, its own clubs' lines): the share of the club's
     baskets that came off a pass, of its makes at the rim, and of its points scored off no pass, against the league's */
  let moves = null;
  {
    const lgT = [...teamRow.values()].filter(evTeam), me2 = teamRow.get(club);
    if (lgT.length >= 4 && evTeam(me2)) {
      moves = MOVES.map(m => {
        const xs = lgT.map(t => num(t[m.f])).filter(isNum), v = num(me2[m.f]);
        if (!isNum(v) || xs.length < 4) return null;
        const a = mean(xs), s = sd(xs);
        return { k: m.k, f: m.f, label: m.label, v, avg: a, sd: s, z: isNum(s) && s > 0 ? (v - a) / s : null, p25: quant(xs, 0.25), p75: quant(xs, 0.75), lo: Math.min(...xs), hi: Math.max(...xs),
          rank: 1 + xs.filter(x => x > v).length, of: xs.length };
      }).filter(Boolean);
      if (!moves.length) moves = null;
    }
  }

  /* THE ROLES, every player of the league the same way (Louie, 2026-10-09: "roles in the squad be better attributed"):
     the What wins rules (§7.13 / 7.15) on the season line, each percentile among the league's players with enough
     minutes; his main position from the minutes at each position the squads above give him */
  const mainOf = new Map();
  all.forEach(S => S.who.forEach(w => { const t = w.at.reduce((a, v) => a + v, 0); if (t > 0) mainOf.set(w.line.id, SLOTS[w.at.indexOf(Math.max(...w.at))]); }));
  const roles = rolesOf(rows, lines, mainOf, o.roleCuts || null);

  /* THE SQUAD'S SHAPE, every club's the same way (Louie: "the team's average vs. league avg plus what it means in terms of
     winning"): the rotation (players at 10 minutes a game or more), the top five's share of the minutes, the leading
     scorer's share of the points, how concentrated the plays are (Σ share² × 100), against the league's clubs and its
     better half by net rating */
  const shapeOf = tid => {
    const ids = clubs.get(tid) || [];
    const ls = ids.map(id => lines.get(id)).filter(Boolean);
    const M = ls.reduce((a, l) => a + l.min, 0), P = ls.reduce((a, l) => a + l.pm.pts * l.min, 0), Y = ls.reduce((a, l) => a + l.pm.plays * l.min, 0);
    if (!(M > 0) || ls.length < 5) return null;
    const mins = ls.map(l => l.min).sort((a, b) => b - a), rot = ls.filter(l => l.gp > 0 && l.min / l.gp >= 10);
    const out = { rot_n: rot.length, top5_share: mins.slice(0, 5).reduce((a, v) => a + v, 0) / M,
      star_pts_share: P > 0 ? Math.max(...ls.map(l => l.pm.pts * l.min)) / P : null, usg_hhi: Y > 0 ? 100 * ls.reduce((a, l) => a + Math.pow(l.pm.plays * l.min / Y, 2), 0) : null };
    /* the roles in the rotation, as the builder counts them (players at 10 minutes a game or more) */
    ROLE_SHAPE.forEach(([k, r]) => { out[k] = rot.filter(l => (roles.byPlayer.get(l.id) || []).indexOf(r) >= 0).length; });
    return out;
  };
  let shape = null;
  {
    const per = new Map();
    all.forEach((_, tid) => { const s = shapeOf(tid); if (s) per.set(tid, s); });
    const mineS = per.get(club);
    if (mineS && per.size >= 4) {
      const nets = [...per.keys()].map(tid => ({ tid, net: num((teamRow.get(tid) || {}).net) })).filter(x => isNum(x.net)).sort((a, b) => b.net - a.net);
      const top = new Set(nets.slice(0, Math.ceil(nets.length / 2)).map(x => x.tid));
      shape = SHAPE.map(k => {
        const xs = [...per.values()].map(s => s[k]).filter(isNum), v = mineS[k];
        if (!isNum(v) || xs.length < 4) return null;
        const a = mean(xs), s = sd(xs), tx = [...per].filter(([tid]) => top.has(tid)).map(([, x]) => x[k]).filter(isNum);
        return { k, v, avg: a, sd: s, z: isNum(s) && s > 0 ? (v - a) / s : null, p25: quant(xs, 0.25), p75: quant(xs, 0.75), lo: Math.min(...xs), hi: Math.max(...xs),
          top: tx.length >= 2 ? mean(tx) : null, of: xs.length };
      }).filter(Boolean);
    }
  }

  return {
    club, gameMin, sigma, G: isNum(o.G) ? o.G : 30, mus: o.mus || null, values, source: me.source, games, n: all.size,
    slots, players: playersOut, whole, usage, groups, cover, halfCourt, moves, shape,
    /* the club's players by role (its own players, by minutes), the league's cuts, how many it has against the league */
    roles: { byPlayer: roles.byPlayer, cuts: roles.cuts, club: ROLES.map(r => ({ k: r, ids: (clubs.get(club) || []).filter(id => (roles.byPlayer.get(id) || []).indexOf(r) >= 0)
      .map(id => lines.get(id)).filter(l => l && l.gp > 0 && l.min / l.gp >= 5).sort((a, b) => b.min - a.min).map(l => l.id) })) },
    team: { mine, lg: lgTeam, parts: teamParts, pts: teamParts.total, wins30: wins30(teamParts.total, sigma) },
    _lines: lines, _all: all, _lg: lg, _lgAgg: lgAgg, _names: names
  };
}
/* the summed statistics' position rates, the groups, what can be covered, the play-by-play team lines, the shape */
const SUM_OF = { oreb_pct: 'oreb_pct', dreb_pct: 'dreb_pct', stl_pct: 'stl_pct', blk_pct: 'blk_pct', ast_pct: 'ast_pct', unPg: 'un40' };
const GROUPS = [{ k: 'handlers', label: 'Ball handlers', slots: ['PG', 'SG'] }, { k: 'wings', label: 'Wings', slots: ['SF'] }, { k: 'bigs', label: 'Bigs', slots: ['PF', 'C'] }];
const COVER = ['dreb_pct', 'oreb_pct', 'ast_pct', 'un40', 'stl_pct', 'blk_pct'];
const COVER_LABEL = { dreb_pct: 'defensive rebounding', oreb_pct: 'offensive rebounding', ast_pct: 'playmaking', un40: 'self-created scoring', stl_pct: 'ball pressure', blk_pct: 'rim protection' };
/* the half court's list: the six with the most usage there, each with 150 minutes the play-by-play covers and 4% of the
   team's half-court plays or more (a late signing's handful of games is not a breakdown) */
const HC_TOP = 6, HC_MIN = 150, HC_SHARE = 4;
const MOVES = [{ k: 'ast', f: 'ev_ast_sh', label: 'Baskets off a pass' }, { k: 'rim', f: 'ev_rim_astp', label: 'Rim makes off a pass' },
  { k: 'self', f: 'ev_unast_pts_sh', label: 'Points created alone' }];
/* the roles' shape keys (the builder's names) and the roles themselves */
const ROLE_SHAPE = [['shooters', 'shooter'], ['handlers', 'handler'], ['passers', 'passer'], ['slashers', 'slasher'], ['crashers', 'crasher'], ['glass', 'glass'],
  ['protectors', 'protector'], ['disruptors', 'disruptor']];
const SHAPE = ['rot_n', 'top5_share', 'star_pts_share', 'usg_hhi'].concat(ROLE_SHAPE.map(x => x[0]));
const ROLES = ['handler', 'passer', 'shooter', 'slasher', 'crasher', 'glass', 'protector', 'disruptor', 'big'];
/* the population each percentile is taken over: the league's players with 200 minutes, or a sixth of the most anyone has
   played when the season is young */
const ROLE_MIN = 200;
/* ROLES (What wins §7.13 / 7.15, on the season line):
     handler    AST%, usage and the unassisted share of his points, percentiles weighted 35 / 25 / 40 (the league file's
                weights where it has them), 0.70 or more; without the play-by-play split, AST% and usage alone
     passer     AST/USG in the top quarter and AST% at least the median
     shooter    40 threes (fewer early in a season: 1.6 a game played, at least 8), 3PA rate in the top 40%, 3P% shrunk
                toward the league's by 50 attempts at least the median
     slasher    rim rate and FT attempt rate percentiles averaging 0.75 or more
     crasher    ORB% in the top quarter          glass   DRB% in the top quarter     disruptor   STL% in the top quarter
     protector  BLK% in the top quarter, and the rim better with him on (rim points saved per 100 above nought: fewer
                attempts there, or fewer made); without the rim on/off, a four or a centre
     big        most of his minutes at centre */
function rolesOf(rows, lines, mainOf, cutsIn) {
  const maxMin = rows.reduce((a, r) => Math.max(a, num(r.min) || 0), 0), floor = Math.min(ROLE_MIN, maxMin / 6);
  const pop = rows.filter(r => (num(r.min) || 0) >= floor && lines.has(String(r.id)));
  const col = f => pop.map(r => (typeof f === 'function' ? f(r) : num(r[f]))).filter(isNum).sort((a, b) => a - b);
  const pctOf = sorted => v => { if (!isNum(v) || !sorted.length) return null; let lo = 0, eq = 0; sorted.forEach(x => { if (x < v) lo++; else if (x === v) eq++; }); return (lo + 0.5 * eq) / sorted.length; };
  const lg3 = (() => { const a = pop.reduce((s, r) => s + (num(r.p3a) || 0), 0), m = pop.reduce((s, r) => s + (num(r.p3m) || 0), 0); return a > 0 ? m / a : 0.33; })();
  const shrunk3 = r => { const a = num(r.p3a) || 0; return a > 0 ? 100 * ((num(r.p3m) || 0) + 50 * lg3) / (a + 50) : null; };
  const ups = r => (evOf(r) ? num(r.ev_unast_pts_sh) : null);
  const auOf = r => (num(r.au) != null ? num(r.au) : (num(r.usg) > 0 && num(r.ast_pct) != null ? num(r.ast_pct) / num(r.usg) : null));
  const C = { ast: col('ast_pct'), usg: col('usg'), ups: col(ups), au: col(auOf), p3r: col('p3_rate'), p3s: col(shrunk3), rimr: col('rim_rate'), ftr: col('ftr'),
    orb: col('oreb_pct'), drb: col('dreb_pct'), stl: col('stl_pct'), blk: col('blk_pct') };
  const P = Object.fromEntries(Object.keys(C).map(k => [k, pctOf(C[k])]));
  const w0 = cutsIn && cutsIn.handler && cutsIn.handler.w ? cutsIn.handler.w : { ast_pct: 0.35, usg: 0.25, ups: 0.40 };
  const cuts = { n: pop.length, minutes: floor, passer: { au: quant(C.au, 0.75), ast: quant(C.ast, 0.5) }, shooter: { p3r: quant(C.p3r, 0.6), p3p: quant(C.p3s, 0.5) },
    crasher: { orb: quant(C.orb, 0.75) }, glass: { drb: quant(C.drb, 0.75) }, disruptor: { stl: quant(C.stl, 0.75) }, protector: { blk: quant(C.blk, 0.75) },
    handler: { cut: 0.7, w: w0 } };
  const byPlayer = new Map();
  rows.forEach(r => {
    const id = String(r.id), l = lines.get(id);
    if (!l) return;
    const out = [], main = mainOf.get(id);
    /* handler: the weighted percentiles, the weights of the parts he has */
    const parts = [['ast_pct', P.ast(num(r.ast_pct))], ['usg', P.usg(num(r.usg))], ['ups', P.ups(ups(r))]].filter(x => isNum(x[1]));
    const W = parts.reduce((a, x) => a + (w0[x[0]] || 0), 0);
    if (W > 0 && parts.some(x => x[0] === 'ast_pct') && parts.reduce((a, x) => a + (w0[x[0]] || 0) * x[1], 0) / W >= 0.7) out.push('handler');
    const au = auOf(r);
    if (isNum(au) && isNum(cuts.passer.au) && au >= cuts.passer.au && num(r.ast_pct) >= cuts.passer.ast) out.push('passer');
    const need3 = Math.max(8, Math.min(40, 1.6 * (num(r.gp) || 0)));
    if ((num(r.p3a) || 0) >= need3 && num(r.p3_rate) >= cuts.shooter.p3r && shrunk3(r) >= cuts.shooter.p3p) out.push('shooter');
    const sl = [P.rimr(num(r.rim_rate)), P.ftr(num(r.ftr))];
    if (sl.every(isNum) && (sl[0] + sl[1]) / 2 >= 0.75) out.push('slasher');
    if (num(r.oreb_pct) >= cuts.crasher.orb) out.push('crasher');
    if (num(r.dreb_pct) >= cuts.glass.drb) out.push('glass');
    const rs = rimSave(r);
    if (num(r.blk_pct) >= cuts.protector.blk && (isNum(rs) ? rs > 0 : main === 'PF' || main === 'C')) out.push('protector');
    if (num(r.stl_pct) >= cuts.disruptor.stl) out.push('disruptor');
    if (main === 'C') out.push('big');
    byPlayer.set(id, out);
  });
  return { byPlayer, cuts };
}

/* ------------------------------------------------------------------ the usage sim --- */
/* THE PLAYS ADD UP (Louie, 2026-10-08: "usage% has to add up to 100% - dropping in a 26% usage, high unassisted point
   scorer into a regimented team with already good ball handlers is a different proposition"). Each man's usage is the
   share of his team's plays he ends while on the floor, so over the five on it they make the whole: a move that puts
   more natural usage on the floor than there are plays SQUEEZES it, one that takes usage off STRETCHES it. What gives is
   the DISCRETIONARY usage - each man's above a role player's floor (USG_FLOOR: the spot-ups and putbacks that come to him
   whatever else is out there), weighted to the creators (the unassisted share of his points where the season line has
   it, else how far his usage stands above the floor): two ball-dominant scorers squeeze each other while the role
   players keep their shots, which is the regimented team's case; a squad short of creators makes its players take on
   more. Then the SKILL CURVE: a player handed fewer plays is a little more efficient on the ones he keeps, one forced
   to take more a little less (SKILL points per play for each point of usage). The offence is the plays' own points per
   play, re-weighted by who now ends them, times the team's plays a game.
     usageSim(who, target, gameMin) -> { T (the floor's usage, Σ floor share × usage), ppp, rows: [{ id, f, u, u2, ppp, ppp2 }] }
   target: the usage to fill (the club's own as it stands, so the squad as it is changes nothing) */
const USG_FLOOR = 12;
const SKILL = 0.008;
function creatorOf(line) {
  const un = line && line.unast;
  if (isNum(un)) return Math.max(0, Math.min(1, un / 100));
  const u = line && line.rate.usg;
  return isNum(u) ? Math.max(0, Math.min(1, (u - USG_FLOOR) / 18)) : 0;
}
function usageSim(who, target, gameMin) {
  const rows = who.map(w => {
    const f = w.at.reduce((a, v) => a + v, 0) / gameMin, u = w.line.rate.usg, p = w.line.rate.ppp;
    if (!isNum(u) || !isNum(p) || !(f > 0)) return null;
    return { id: w.line.id, f, u, ppp: p, d: Math.max(0, u - USG_FLOOR) * (1 + creatorOf(w.line)) };
  }).filter(Boolean);
  const T0 = rows.reduce((a, r) => a + r.f * r.u, 0);
  const T = isNum(target) ? target : T0, D = rows.reduce((a, r) => a + r.f * r.d, 0);
  /* λ: how much of each man's discretionary usage gives (or is added) for the floor to hold T */
  const lam = D > 0 ? (T0 - T) / D : 0;
  rows.forEach(r => {
    r.u2 = Math.max(3, r.u - lam * r.d);
    r.ppp2 = r.ppp + SKILL * (r.u - r.u2);
  });
  /* the floor 3% can leave a remainder: put it back on the creators so the plays still add up */
  const got = rows.reduce((a, r) => a + r.f * r.u2, 0), gap = T - got;
  if (Math.abs(gap) > 1e-9 && D > 0) rows.forEach(r => { const add = gap * r.d / D; r.u2 += add; r.ppp2 -= SKILL * add; });
  const W = rows.reduce((a, r) => a + r.f * r.u2, 0);
  return { T, lam, ppp: W > 0 ? rows.reduce((a, r) => a + r.f * r.u2 * r.ppp2, 0) / W : null, rows };
}

/* ------------------------------------------------------------------ the what-if --- */
/* what a player handed minutes can carry: a heavy starter's night (90% of the game), or his own minutes and 40% of the
   game more (half as much again for a regular), whichever is less - never less than he plays already. A backup centre at
   6 minutes can step up to 22 when the starter goes; nobody reaches 54 */
const capOf = (mpg, L) => Math.max(mpg, Math.min(0.9 * L, Math.max(mpg + 0.4 * L, 1.5 * mpg)));
/* moves on the club's minutes a game at each position; the squad summed again; the difference priced */
function simulate(m, moves) {
  if (!m || !m._all) return null;
  const me = m._all.get(m.club);
  if (!me) return null;
  moves = moves || {};
  const L = m.gameMin;
  /* id -> [minutes a game at PG..C] */
  const at = new Map(me.who.map(w => [w.line.id, w.at.slice()]));
  const total = id => (at.get(id) || [0, 0, 0, 0, 0]).reduce((a, v) => a + v, 0);
  /* THE MINUTES A MAN CAN PLAY (Louie, 2026-10-09: "minutes a game need to fit within 40mpg for a player ... needs to be
     smarter"): handed minutes, nobody goes past capOf (a heavy starter's night, or his own minutes and 40% of the
     game more); a man added, or whose minutes are set, no more than he was given; and never past the game */
  const capFor = new Map(me.who.map(w => [w.line.id, capOf(w.at.reduce((a, v) => a + v, 0), L)]));
  const room = id => Math.max(0, (capFor.has(id) ? capFor.get(id) : L) - total(id));
  const ok = j => j >= 0 && j <= 4;
  /* hand `mins` at position k to the others there in proportion to their minutes there, each up to what he can carry,
     what is left to those at the positions beside it, then anyone; everyone at his limit: the game is the last cap */
  const share = (k, left, take, wt, lim) => {
    for (let pass = 0; pass < 8 && left > 1e-9; pass++) {
      const live = take.map((x, i) => [x, wt[i]]).filter(([x]) => lim(x[0]) > 1e-9), W = live.reduce((a, [, w]) => a + w, 0);
      if (!(W > 0)) break;
      let used = 0;
      live.forEach(([[id, a], w]) => { const got = Math.min(left * w / W, lim(id)); a[k] += got; used += got; });
      left -= used;
      if (used < 1e-9) break;
    }
    return left;
  };
  /* STAMINA (Louie, 2026-10-09: "once minutes really slide up to the upper 30s and the player is high usage that's when
     it'll take effect"): the stamina line is the game's (FATIGUE.start of it, 32 of 40); minutes go to fresh legs at the
     position and beside it first, then to tired ones there, then fresh and tired anywhere, the game the last cap */
  const baseMin = new Map(me.who.map(w => [w.line.id, w.at.reduce((a, v) => a + v, 0)]));
  const ownMpg = id => (baseMin.has(id) ? baseMin.get(id) : (l => (l ? l.min / Math.max(1, l.gp) : 0))(m._lines.get(id)));
  const lineAt = () => FATIGUE.start * L;
  const fresh = id => Math.max(0, Math.min(lineAt(id), capFor.has(id) ? capFor.get(id) : L) - total(id));
  const give = (k, mins, except) => {
    let left = mins;
    if (!(left > 0)) return;
    for (const [lim, sets] of [[fresh, [[k], [k - 1, k + 1]]], [room, [[k], [k - 1, k + 1]]], [fresh, [[0, 1, 2, 3, 4]]], [room, [[0, 1, 2, 3, 4]]]]) {
      for (const ks of sets) {
        const take = [...at].filter(([id, a]) => !except.has(id) && ks.some(j => ok(j) && a[j] > 0));
        left = share(k, left, take, take.map(([, a]) => ks.reduce((q, j) => q + (ok(j) ? a[j] : 0), 0)), lim);
        if (left <= 1e-9) return;
      }
    }
    const all = [...at].filter(([id]) => !except.has(id));
    share(k, left, all, all.map(([id]) => Math.max(0, L - total(id))), id => Math.max(0, L - total(id)));
  };
  const removed = new Set((moves.remove || []).map(String));
  removed.forEach(id => {
    const a = at.get(id);
    if (!a) return;
    at.delete(id);
    a.forEach((v, k) => give(k, v, removed));
  });
  /* a new player's minutes at each position: his club's lineups (the pos file's shares), else his box-score position */
  const shareFor = id => {
    let sh = null;
    m._all.forEach(S => { if (sh) return; const w = S.who.find(x => x.line.id === id); if (w) sh = w.share || shareOfRow(w.at); });
    return sh || shareOfPos(3);
  };
  const added = [];
  (moves.add || []).forEach(x => {
    const id = String(x.id), line = m._lines.get(id);
    if (!line || at.has(id)) return;
    const mpg = isNum(x.mpg) && x.mpg > 0 ? Math.min(L, x.mpg) : Math.min(L, line.min / Math.max(1, line.gp));
    const sh = shareFor(id);
    const mineAt = sh.map(s => s * mpg);
    /* the others at each position give way in proportion, so each position stays one game long */
    [0, 1, 2, 3, 4].forEach(k => {
      if (!(mineAt[k] > 0)) return;
      const tot = [...at.values()].reduce((a, v) => a + v[k], 0), keep = Math.max(0, L - mineAt[k]);
      if (tot > 0) at.forEach(v => { v[k] *= keep / tot; });
    });
    at.set(id, mineAt);
    capFor.set(id, mpg);
    added.push({ id, mpg, share: sh });
  });
  /* a player's minutes set: scaled at the positions he plays, the others there giving way or taking up the rest */
  Object.entries(moves.mpg || {}).forEach(([id, want]) => {
    const a = at.get(String(id)), cur = total(String(id));
    if (!a || !isNum(+want) || !(cur > 0)) return;
    const target = Math.max(0, Math.min(L, +want)), f = target / cur;
    capFor.set(String(id), target);
    [0, 1, 2, 3, 4].forEach(k => {
      const before = a[k], after = before * f, delta = before - after;
      a[k] = after;
      if (delta > 0) give(k, delta, new Set([String(id)]));
      else if (delta < 0) {
        const others = [...at].filter(([x]) => x !== String(id)), tot = others.reduce((s, [, v]) => s + v[k], 0);
        if (tot > 0) others.forEach(([, v]) => { v[k] = Math.max(0, v[k] * (tot + delta) / tot); });
      }
    });
  });
  const fit = [...at].filter(([, a]) => a.some(v => v > 1e-9)).map(([id, a]) => ({ line: m._lines.get(id), at: a })).filter(w => w.line);
  if (fit.length < 5) return null;
  /* TIRED LEGS AND WHO HE FACES. His season's rates already carry his own minutes - their load and the opponents those
     minutes met - so only the CHANGE is priced: the fatigue load (fatigueLoad: nothing below the line, then growing with
     the square of the minutes past it, heavier the more of the offence he carries) and the share of his minutes against
     opposing starters (startersShare: a bench man handed starter's minutes faces better players and gives a little back;
     a starter sent to the bench gains a little). Each priced like everything else, and what each costs said apart */
  const tired = [], faces = [];
  const adjust = (w, useFat, useOpp) => {
    const id = w.line.id, mins = w.at.reduce((a, v) => a + v, 0), own = ownMpg(id), u = isNum(w.line.rate.usg) ? w.line.rate.usg : 20;
    const dLoad = useFat ? fatigueLoad(mins, u, L) - fatigueLoad(own, u, L) : 0, dE = useOpp ? startersShare(mins, L) - startersShare(own, L) : 0;
    return Math.abs(dLoad) > 1e-9 || Math.abs(dE) > 1e-9 ? { line: tiredLine(w.line, dLoad, dE), at: w.at, dLoad, dE, mins, own, u } : w;
  };
  const who = fit.map(w => adjust(w, true, true));
  who.forEach(w => {
    if (!w.dLoad && !w.dE) return;
    const name = m._names.get(w.line.id) || '';
    if (w.dLoad > 0.05) tired.push({ id: w.line.id, name, min: w.mins, own: w.own, usg: w.u, line: FATIGUE.start * L, load: w.dLoad, ppp: -FATIGUE.ppp * w.dLoad, rate: -FATIGUE.rate * w.dLoad });
    if (Math.abs(w.dE) >= 0.05) faces.push({ id: w.line.id, name, min: w.mins, own: w.own, dE: w.dE, ppp: -OPPOSITION.ppp * w.dE });
  });
  const before = aggOf(me.Q);
  const U0 = usageSim(me.who, null, L), plays = me.Q.team.vol.plays;
  /* THE OFFENCE BY THE USAGE SIM (the plays add up, the creators squeeze each other, the skill curve), the team's plays a
     game as they stand; THE GLASS AND THE DEFENCE BY THE SUMS (rebounds, steals, blocks are shared out by the floor) */
  const priceOf = squad => {
    const Qx = sumSquad(squad), dx = diff(aggOf(Qx), before), Ux = usageSim(squad, U0.T, L);
    const g = priceTeam({ oreb_pct: dx.oreb_pct, dreb_pct: dx.dreb_pct, stl_pct: dx.stl_pct, blk_pct: dx.blk_pct }, m.values);
    const px = { offence: isNum(U0.ppp) && isNum(Ux.ppp) && isNum(plays) ? (Ux.ppp - U0.ppp) * plays : null, oreb: g.oreb, dreb: g.dreb, stl: g.stl, blk: g.blk };
    px.total = ['offence', 'oreb', 'dreb', 'stl', 'blk'].reduce((a, k) => a + (isNum(px[k]) ? px[k] : 0), 0);
    return { Q: Qx, d: dx, U: Ux, parts: px };
  };
  const P1 = priceOf(who), Q = P1.Q, d = P1.d, U1 = P1.U, parts = P1.parts, after = aggOf(Q);
  const pts = parts.total;
  /* what tired legs cost, and what facing more (or fewer) starters does: each against the move without it */
  const fatigue = tired.length ? pts - priceOf(fit.map(w => adjust(w, false, true))).parts.total : 0;
  const opposition = faces.length ? pts - priceOf(fit.map(w => adjust(w, true, false))).parts.total : 0;
  const was = new Map(U0.rows.map(r => [r.id, r]));
  const usage = U1.rows.map(r => ({ id: r.id, name: m._names.get(r.id) || '', f: r.f, u: r.u, u2: r.u2, ppp: r.ppp, ppp2: r.ppp2,
    before: was.has(r.id) ? { f: was.get(r.id).f, u: was.get(r.id).u2, ppp: was.get(r.id).ppp2 } : null })).sort((a, b) => (b.f * b.u2) - (a.f * a.u2));
  const depth = SLOTS.map((key, k) => ({ key, players: who.filter(w => w.at[k] > 0.05).map(w => ({ id: w.line.id, name: m._names.get(w.line.id) || '', min: w.at[k],
    was: (me.who.find(x => x.line.id === w.line.id) || { at: [0, 0, 0, 0, 0] }).at[k] })).sort((a, b) => b.min - a.min) }));
  return { before, after, d, parts, pts, wins30: wins30(pts, m.sigma), winsLeft: m.mus && m.mus.length ? winsFrom(pts, m.mus, m.sigma, m.G) : null,
    left: m.mus ? m.mus.length : 0, added, removed: [...removed], depth, usage, plays, ppp: { before: U0.ppp, after: U1.ppp }, squeeze: U1.lam,
    tired: tired.sort((a, b) => b.load - a.load), fatigue, faces: faces.sort((a, b) => Math.abs(b.dE) - Math.abs(a.dE)), opposition };
}
/* STAMINA (Louie, 2026-10-09: "going from 6-16 minutes won't do much nor will 20-24, but once minutes really slide up to
   the upper 30s and the player is high usage that's when it'll take effect"): the fatigue load is nothing below the
   line (FATIGUE.start of the game: 32 of 40, 38 of 48), then the square of the minutes past it in tenths of the game,
   times his usage against an even share (20%) - 36 minutes at 20% is a load of 1, 38 at 26% is 2.9. Each unit of load
   costs FATIGUE.ppp points a play and FATIGUE.rate of his glass, steals and blocks */
const FATIGUE = { start: 0.8, ppp: 0.012, rate: 0.02 };
const fatigueLoad = (mins, usg, L) => { const over = Math.max(0, mins - FATIGUE.start * L) / (0.1 * L); return over * over * Math.max(0.5, Math.min(2, (isNum(usg) ? usg : 20) / 20)); };
/* WHO HE FACES ("some sort of vs. starters and vs. bench slight regression"): the share of a man's minutes against the
   other side's starters grows with his minutes (a tenth at the end of the bench, three quarters for a 34-minute starter);
   facing starters instead of a bench costs OPPOSITION.ppp points a play and OPPOSITION.rate of his glass, steals and
   blocks for the whole share - a 15-minute man handed 30 gives back about 0.014 points a play */
const OPPOSITION = { ppp: 0.05, rate: 0.05 };
const startersShare = (mins, L) => 0.1 + 0.65 * Math.min(1, Math.max(0, mins) / (0.85 * L));
const fatigueLineOf = (mpg, L) => FATIGUE.start * L;
function tiredLine(l, dLoad, dE) {
  const k = Math.max(0, (1 - FATIGUE.rate * (dLoad || 0)) * (1 - OPPOSITION.rate * (dE || 0))), r = Object.assign({}, l.rate);
  ['oreb_pct', 'dreb_pct', 'stl_pct', 'blk_pct'].forEach(x => { if (isNum(r[x])) r[x] *= k; });
  if (isNum(r.ppp)) r.ppp -= FATIGUE.ppp * (dLoad || 0) + OPPOSITION.ppp * (dE || 0);
  return Object.assign({}, l, { rate: r });
}

return { build, simulate, sumSquad, priceTeam, usageSim, lineOf, evOf, shareOfPos, shareOfRow, wins30, winsFrom, SLOTS, SLOT_NAME, KEY, STAT_LABEL, PARTS, LOWER, BLK_EFG,
  USG_FLOOR, SKILL, GROUPS, COVER, COVER_LABEL, MOVES, SHAPE, EV_MIN_SHARE, EV_MIN_GP, ROLES, ROLE_SHAPE, rolesOf, rimSave, capOf, FATIGUE, fatigueLineOf, fatigueLoad, OPPOSITION, startersShare };
}));
