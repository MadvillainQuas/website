'use strict';
/* ============================================================================
   EpinoiaOdds (winodds.js) - EPINOIΛ'S MODEL OF WHO WINS: one model for every game in every league (2026-10-08).

     const S = EpinoiaOdds.create();                       // or EpinoiaOdds.unpack(saved)
     const pre = EpinoiaOdds.predict(S, fixture);          // { ok, p, margin, sigma, n, x }
     const rec = EpinoiaOdds.learn(S, game);               // the prediction it made BEFORE the game, then it learns it
     const recs = EpinoiaOdds.walk(S, games);              // many games in tip-off order (same tip-off: none sees another)
     const saved = EpinoiaOdds.pack(S, { keepAfter });     // the compact state to keep (unpack() reads it back)

     fixture = { h, a, lg, s, t, v }            home and away club ids, league, season, tip-off (ms), venue id
     game    = fixture + { id, hs, as, c: [home counts, away counts], pl: [player lines] }
               counts from countsOfRow() (a game_features row read with lineSelect()) or countsOf() (a whole line);
               a player line [id, side 0|1, min, pts, fgm, fga, fta, ftm, or, dr, ast, stl, blk, to, pf] from lineOf()

   ONE MODEL, MOLDED FROM EVERYTHING THE BOX SCORE KNOWS. Before a game each club carries, for this season so far:
     * What wins' competitive four factors at both ends (garbage time out: features.js c_ counts), shrunk toward its
       league by SHRINK games, and what they make of this matchup (expected differentials, as winmodel.js pregame(): a
       proportion blends the attack and the defence it meets on the logit scale against the league's average);
     * the same four factors ADJUSTED FOR THE SCHEDULE: every club's attack and defence at each factor solved together
       over the league's season so far (each game's factor = the league's + the attack + the defence it met, shrunk by
       ADJK games), so a club is rated on whom it played - re-solved as ratings firm up, every past game re-credited;
     * Elo (margin of victory; carried over seasons, a third of the way back to 1500 each new one) and the margin
       rating, solved with the factors: competitive margin a game, adjusted for whom each club played;
     * POSITIONS: its players placed guard, wing or big by box plus/minus's estimate (bpm.js: rebounds, steals, fouls,
       assists, blocks as shares of the club's), how much each position produces (game score a 36 minutes, against the
       league's at that position), and how far its defence pulls the opposing players at each position from their own
       usual output - so a club whose guards feast meets one that shuts guards down;
     * FORM: how far, lately, it has beaten or missed what this model expected of it (an exponentially weighted
       residual): an injury, a new signing or a coach's change shows here before the season's numbers move;
     * WHO IS PLAYING: its last game's players, each rated by their game score a minute this season, against its whole
       roster rated the same way - an absence or a return;
     * STYLE (style()): half-court points a chance, transition (how often, and points a chance), second chances, and the
       shot diet (rim / mid-range / three shares and make rates) - each attack against the defence it meets against the
       league, as points a game; where the league's feed has situations and zones;
     * rest, back-to-backs, and the home court (none at a neutral site: away from the home club's commonest venue).
       margin = w · x + the league's own home edge,     P(home) = expit(a + b · 1.702 · margin / σ)
   WHAT IT LEARNS, AFTER EVERY GAME, FROM EVERY LEAGUE AT ONCE:
     * w by recursive least squares on the result's margin (a margin says more than a win; forgetting factor FORGET, so
       it keeps up with the game as it is played now): every league's games teach the one model;
     * each league's home edge, from what the model missed on home games there, kept near the shared one;
     * σ, how far its margins miss, as an exponentially weighted spread;
     * a and b, ITS OWN WINS AND LOSSES: a logistic recalibration of its probabilities on whether its picks came off;
     * every club's numbers above, and every player's;
     * once a week, ITS OWN SETTINGS (tune()): the whole database walked again under each candidate, kept only on a gain
       that holds in both halves of the games.
   It says nothing before both clubs have played MIN_GP games this season (ok: false): early numbers are too thin.
   WHAT EACH IS WORTH is measured on the walk over the whole database (tools/build-odds.mjs --dry-run --full --eval);
   C.use switches each family of inputs off, and every constant below was set that way (docs/what-wins-model.md §7.8.1).
   2026-10-08, 1,540 games judged: Brier 0.2007, 67.8% right, log loss 0.5819 tuned (0.2011 / 68.0% / 0.5830 on the
   defaults) - against 0.2026 / 67.3% / 0.5873 for the four factors, Elo, the margin and the home court alone (Elo
   alone 0.2046, the home side always 0.2456). Form is the gain that holds. The style inputs are alive (the shot diet
   alone correlates 0.46 with the result, the whole model 0.55) but carry what the model already knows (0.81 with its
   margin, −0.05 with what it misses): level, like the schedule-adjusted factors, positions and who is playing - so
   they start at nothing and earn their weight.

   EVERYTHING IS INCREMENTAL AND COMPACT: a run reads only the games finished since the last (22 numbers a side, the
   named stats of each player line), feeds them in, and keeps the state as pack() makes it - every id written once and
   referred to by its place, every club, league and player one array, numbers to the precision they carry, the
   weights' covariance by its upper triangle - gzipped by the run. Nothing is ever refitted from scratch. The same file
   runs in node and in the browser, tested on games invented to have a known answer (supabase/tests/winodds.test.mjs).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaOdds = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const V = 5;                               // the packed state's layout
const MODEL = 'epinoia-4';
const MIN_GP = 3;
const X_KEYS = ['home', 'efg', 'tov', 'orb', 'ftr', 'elo', 'net', 'rest', 'b2b', 'aefg', 'atov', 'aorb', 'aftr', 'pos', 'form', 'avail',
                'hc', 'tr', 'sc', 'shot', 'km'];
const P = X_KEYS.length;
/* the counts a side carries, in order: eFG makes (FGM + ½ 3PM), FGA, FTA, turnovers, offensive rebounds, the other
   side's defensive rebounds of this side's misses, points, possessions - all competitive (garbage time out); then the
   chances by how they began (situations.js: all of them, transition, half-court, second chance - chances and points)
   and the shots by zone (rim, mid-range, three - attempts and makes), zero where the league's feed has none */
const COUNTS = ['efgm', 'fga', 'fta', 'tov', 'ro', 'rd', 'pts', 'poss',
                'sit', 'trc', 'trp', 'hcc', 'hcp', 'scc', 'scp', 'rima', 'rimm', 'mida', 'midm', 'f3a', 'f3m'];
const NC = COUNTS.length, K = COUNTS.reduce((o, k, i) => (o[k] = i, o), {});
/* ...read from these features.js keys (competitive possessions = all of them less garbage time's, g_poss) */
const LINE_KEYS = ['c_efgm', 'c_fga', 'c_fta', 'c_tov', 'c_reb_off', 'c_reb_def', 'c_pts', 'poss', 'g_poss',
                   'sit_ch', 'tr_ch', 'tr_pts', 'hc_ch', 'hc_pts', 'sc_ch', 'sc_pts', 'rim_a', 'rim_m', 'mid_a', 'mid_m', 'fg3a', 'fg3m'];
const C = {
  shrink: 5,          // games of the league's average a club's profile starts with
  adjK: 20,           // the schedule-adjusted factors: games of nothing-special each club's starts with
  srsK: 8,            // ...and the margin rating
  netMode: 'srs',     // the margin input: the schedule-adjusted rating (srs), a game (pg), a hundred possessions (p100)
  elo0: 1500, eloK: 20, eloCarry: 2 / 3, eloPerPt: 28, eloHmax: 150,
  posPrior: 60,       // minutes of the league's rate a player's own starts with
  posShrink: 200,     // minutes before a club's position numbers are taken at their word
  formA: 0.05,        // form: the weight of the latest game (about the last twenty)
  formK: 10,          // ...trusted as n / (n + formK) of a club's n games
  forget: 0.9995,     // RLS: about 2,000 games of memory
  sig0: 12.5, sigA: 0.02,
  calEta: 0.015, calL2: 0.002,
  hcaEta: 0.02, hcaL2: 0.01,
  rest: 7, b2b: 1.5,
  posScale: 0.1,      // the position edge (game score a 36 minutes) to the model's units
  availScale: 0.1,    // who is playing (game score a game) to the model's units
  styleK: 120,        // the style's rates: chances (or shots) of the league's each side's own starts with
  ebN: 10,            // What wins' own shrinkage k trusted as n / (n + ebN) of a club's games (else SHRINK)
  ebMin: 0,           // ...and not at all before the clubs have played ebMin games on average
  lwEta: 0.002, lwL2: 0.05,  // each league's own weights (normalised steps), held near the shared ones: slow, or they
                             // fit a small league's noise (0.05 cost 0.003 of Brier on the walk)
  /* pace scaling the four factors (pace) and the spread (paceSig) */
  /* WHAT WINS' OWN THREE REFINEMENTS - built, and off until they earn it (the weekly tuning switches each on once it
     gains in both halves of the games; walk 2026-10-08):
       ebk  the shrinkage by each factor's spread: gains on full seasons (Brier 0.1868 v 0.1882 on the older half),
            loses on the recent games the live picks are made among (0.2153 v 0.2140, paired t 2.5);
       km   travel: 243 of the 517 venues games were played at are placed, under What wins' own bar (70% of games)
            for using it at all; level to slightly worse;
       lgw  each league its own weights: at a quick rate they fit a small league's noise (Brier 0.2040 v 0.2011),
            slowly they are level to slightly worse - What wins too pools a league under 200 games */
  use: { adj: true, pos: true, form: true, avail: true, style: true, km: false, ebk: false, lgw: false, pace: false, paceSig: false },
  /* where the margin weights start (points of margin a unit) and how sure of them (variances): the schedule-adjusted
     factors, positions and who is playing start at nothing and are held close (on the walk they add nothing measurable
     yet), so they earn their weight game by game as the evidence grows */
  w0: [2.5, 1.2, -1.2, 0.35, 0.15, 3, 1, 0.25, -1.5, 0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0],
  p0: [4, 1, 1, 0.25, 0.1, 4, 2, 0.25, 4, 0.05, 0.05, 0.05, 0.02, 0.05, 0.25, 0.05, 0.05, 0.05, 0.05, 0.05, 1]
};
const DAY = 86400000, MIN = 60000;
const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const expit = z => 1 / (1 + Math.exp(-z));
const logit = p => { const q = clamp(p, 1e-4, 1 - 1e-4); return Math.log(q / (1 - q)); };
const FF = ['efg', 'tov', 'orb', 'ftr'];
const PROP = { efg: true, tov: true, orb: true, ftr: false };
const zeros = n => new Array(n).fill(0);

function create() {
  const Pm = zeros(P * P);
  for (let i = 0; i < P; i++) Pm[i * P + i] = C.p0[i];
  return { v: V, model: MODEL, n: 0, lastT: 0, wm: null, w: C.w0.slice(), P: Pm, sig2: C.sig0 * C.sig0, cal: [0, 1],
           hca: {}, lw: {}, vc: {}, lg: {}, teams: {}, pl: {}, metrics: { n: 0, right: 0, brier: 0, ll: 0 }, by: {} };
}

/* ------------------------------------------------------------ the inputs --- */
const countsBy = v => {
  const n = k => { const x = +v(k); return isNum(x) && x >= 0 ? x : 0; };
  const zones = n('rim_a') + n('mid_a') > 0, z = k => (zones ? n(k) : 0);   // a three is a zone only where the zones are
  return [n('c_efgm'), n('c_fga'), n('c_fta'), n('c_tov'), n('c_reb_off'), n('c_reb_def'), n('c_pts'), Math.max(0, n('poss') - n('g_poss')),
          n('sit_ch'), n('tr_ch'), n('tr_pts'), n('hc_ch'), n('hc_pts'), n('sc_ch'), n('sc_pts'),
          z('rim_a'), z('rim_m'), z('mid_a'), z('mid_m'), z('fg3a'), z('fg3m')];
};
/* a side's counts from a whole features.js line (f) and that file's INDEX */
const countsOf = (f, I) => countsBy(k => (f && I && I[k] != null ? f[I[k]] : NaN));
/* the PostgREST select of just those nine numbers of a game_features line (f->i, as q0 ... q8), and the counts of a row
   read with it: nine numbers a side instead of the line's hundred and more */
const lineSelect = I => LINE_KEYS.map((k, i) => 'q' + i + ':f->' + I[k]).join(',');
const countsOfRow = r => countsBy(k => r['q' + LINE_KEYS.indexOf(k)]);
/* a player line from a player_game_stats row's named stats (the engine keeps minutes in ms) */
function lineOf(id, side, s) {
  const n = k => { const v = +((s || {})[k]); return isNum(v) ? v : 0; };
  return [id, side, n('min') / MIN, n('pts'), n('p2m') + n('p3m'), n('p2a') + n('p3a'), n('fta'), n('ftm'), n('or'), n('dr'), n('ast'), n('stl'), n('blk'), n('to'), n('pf')];
}
/* Hollinger's game score of a line */
const gmsc = l => l[3] + 0.4 * l[4] - 0.7 * l[5] - 0.4 * (l[6] - l[7]) + 0.7 * l[8] + 0.3 * l[9] + l[11] + 0.7 * l[10] + 0.7 * l[12] - 0.4 * l[14] - l[13];

/* ------------------------------------------------------------- the clubs --- */
const blankPos = () => ({ at: zeros(3), am: zeros(3), dv: zeros(3), dm: zeros(3), tot: zeros(6) });   // tot: min, trb, ast, stl, blk, pf
/* a club's season: counts both ends, record, positions, form, roster and last line-up, the schedule solve's sums
   (so/sd: each game's factor logits for and against; op: games against each opponent) */
/* (q: each factor's per-game sum and sum of squares, for and against - What wins' shrinkage by the factor's own spread;
   lv: the last venue, for the travel) */
const blankSeason = T => Object.assign(T, { n: 0, o: zeros(NC), d: zeros(NC), t: 0, f: 0, ps: blankPos(), ro: {}, last: [], so: zeros(4), sd: zeros(4), op: {},
                                            q: zeros(16), lv: null });
function teamOf(S, id, lg, s, make) {
  let T = S.teams[id];
  if (!T && make) T = S.teams[id] = blankSeason({ lg, s, e: C.elo0, hv: {} });
  return T || null;
}
/* a new season: everything begins again but Elo, which comes a third of the way back to 1500, and the home court */
function season(T, lg, s) {
  if (T.s === s) return false;
  T.s = s; T.lg = lg; T.e = C.elo0 + C.eloCarry * (T.e - C.elo0);
  blankSeason(T);
  return true;
}
const nOf = (T, s) => (T && T.s === s ? T.n : 0);
function leagueOf(S, lg, s) {
  const k = lg + '|' + s;
  /* k: the sides with situations, and with zones (their averages are over those) */
  return S.lg[k] || (S.lg[k] = { n: 0, c: zeros(NC), k: [0, 0], ga: zeros(3), gm: zeros(3), tm: [] });
}
/* the four factors from counts (features.js FACTORS c_efg, c_tovp, c_orebp, c_ftr) */
function factors(c) {
  const [efgm, fga, fta, tov, ro, rd] = c;
  return {
    efg: fga > 0 ? 100 * efgm / fga : null,
    tov: fga + 0.44 * fta + tov > 0 ? 100 * tov / (fga + 0.44 * fta + tov) : null,
    orb: ro + rd > 0 ? 100 * ro / (ro + rd) : null,
    ftr: fga > 0 ? 100 * fta / fga : null
  };
}
/* the home club's own court: its commonest venue over three home games or more */
function homeVenue(T) {
  let best = null, bn = 0;
  Object.keys(T.hv || {}).sort().forEach(v => { if (T.hv[v] > bn) { best = v; bn = T.hv[v]; } });
  return bn >= 3 ? best : null;
}

/* ------------------------------------------------------- the schedule solve --- */
/* every club of a league's season, attack and defence at each factor, solved together: each game's factor logit =
   the league's + the attack + the defence it met; ADJK games of zero shrink each. Gauss-Seidel, ten sweeps (the
   shrinkage makes it a contraction). Kept until the league's next game is learned (L.ver) */
const solved = typeof WeakMap === 'function' ? new WeakMap() : null;
function schedule(S, L, s, mu) {
  const memo = solved && (solved.get(S) || (solved.set(S, new Map()), solved.get(S)));
  const hit = memo && memo.get(L);
  if (hit && hit.ver === L.ver) return hit.R;
  const ids = L.tm.filter(id => S.teams[id] && S.teams[id].s === s), R = {};
  ids.forEach(id => { R[id] = { o: zeros(4), d: zeros(4), r: 0 }; });
  /* the margin rating: each game's competitive margin = this club's rating less the one it met (a schedule-adjusted
     point margin a game, SRSK games of zero shrinking it) */
  for (let it = 0; it < 10; it++) {
    ids.forEach(id => {
      const T = S.teams[id];
      let sm = T.o[6] - T.d[6];
      Object.keys(T.op).forEach(q => { const r = R[q]; if (r) sm += T.op[q] * r.r; });
      R[id].r = sm / (T.n + C.srsK);
    });
  }
  FF.forEach((k, j) => {
    if (!isNum(mu[k])) return;
    const m = logit(mu[k] / 100);
    for (let it = 0; it < 10; it++) {
      ids.forEach(id => {
        const T = S.teams[id];
        let so = T.so[j] - T.n * m, sd = T.sd[j] - T.n * m;
        Object.keys(T.op).forEach(q => { const c = T.op[q], r = R[q]; if (r) { so -= c * r.d[j]; sd -= c * r.o[j]; } });
        R[id].o[j] = so / (T.n + C.adjK);
        R[id].d[j] = sd / (T.n + C.adjK);
      });
    }
  });
  if (memo) memo.set(L, { ver: L.ver, R });
  return R;
}

/* -------------------------------------------------------------- positions --- */
/* a player's position (1 guard ... 5 centre) by bpm.js estimatePosition's weights, from their shares of the club's
   rebounds, steals, fouls, assists and blocks a minute this season; 3 until they have minutes; 0 guard, 1 wing, 2 big */
function posOf(S, id, T) {
  const p = S.pl[id];
  if (!p || !(p.m > 0) || !T || !(T.ps.tot[0] > 0)) return 1;
  const tm = T.ps.tot[0], share = (k, j) => (T.ps.tot[j] > 0 ? (p[k] / p.m) / (T.ps.tot[j] / tm) / 5 : 0.2);
  const raw = 2.130 + 8.668 * share('trb', 1) - 2.486 * share('stl', 3) + 0.992 * share('pf', 5) - 3.536 * share('ast', 2) + 1.667 * share('blk', 4);
  const pos = clamp((p.m * raw + 50 * 3) / (p.m + 50), 1, 5);
  return pos < 2.5 ? 0 : pos < 3.75 ? 1 : 2;
}
const lgRate = (L, g) => (L && L.gm[g] > 0 ? L.ga[g] / L.gm[g] : 0.33);
function posEdge(S, Th, Ta, L, s) {
  if (!Th || !Ta || Th.s !== s || Ta.s !== s || !L) return 0;
  const tot = L.gm[0] + L.gm[1] + L.gm[2];
  const share = g => (tot > 0 ? L.gm[g] / tot : 1 / 3);
  const att = (T, g) => (T.ps.am[g] > 0 ? (T.ps.at[g] / T.ps.am[g] - lgRate(L, g)) * 36 * T.ps.am[g] / (T.ps.am[g] + C.posShrink) : 0);
  const dev = (T, g) => (T.ps.dm[g] > 0 ? (T.ps.dv[g] / T.ps.dm[g]) * 36 * T.ps.dm[g] / (T.ps.dm[g] + C.posShrink) : 0);
  let e = 0;
  for (let g = 0; g < 3; g++) e += share(g) * ((att(Th, g) + dev(Ta, g)) - (att(Ta, g) + dev(Th, g)));
  return e;
}
/* WHO IS PLAYING: the players of a club's last game, each rated by their game score a minute this season (shrunk to the
   league's), against the club's whole season's roster rated the same way - an absence or a return shows the game after */
function avail(S, T, L, s) {
  if (!T || T.s !== s || !T.last.length) return 0;
  const tot = L ? L.gm[0] + L.gm[1] + L.gm[2] : 0, r0 = tot > 0 ? (L.ga[0] + L.ga[1] + L.ga[2]) / tot : 0.33;
  const r = id => { const p = S.pl[id]; return p && p.s === s ? (p.gs + C.posPrior * r0) / (p.m + C.posPrior) : r0; };
  let a = 0, am = 0, b = 0, bm = 0;
  T.last.forEach(([id, m]) => { a += m * r(id); am += m; });
  Object.keys(T.ro).forEach(id => { const m = T.ro[id]; b += m * r(id); bm += m; });
  return am > 0 && bm > 0 ? 200 * (a / am - b / bm) : 0;
}

/* ------------------------------------------------------------ the style --- */
/* HOW EACH SIDE SCORES, AGAINST HOW THE OTHER DEFENDS, AGAINST THE LEAGUE: points a game each side can expect
     hc    half-court chances (their share of all chances) × points per half-court chance
     tr    transition: how often it gets out (its share) × points per transition chance
     sc    second chances (their share) × points per second chance
     shot  the shot diet: rim / mid-range / three shares of the shots × the make rate at each × its value
   each rate this side's attack and the other's defence (the opponents' same rate against it) blended against the
   league's - a share on the logit scale, a rate a chance added - every one shrunk toward the league's by STYLEK chances
   or shots; × the league's chances (or zoned shots) a game. Each input is the home side's points less the away side's.
   Zero for a league whose feed has no situations or zones, and for a side with none yet */
function style(Th, Ta, L, s) {
  const out = { hc: 0, tr: 0, sc: 0, shot: 0 };
  if (!L || !L.k || !Th || !Ta || Th.s !== s || Ta.s !== s) return out;
  const c = L.c, k = C.styleK;
  const lr = (num, den) => (c[den] > 0 ? c[num] / c[den] : null);
  const rate = (A, num, den, lg, kk) => (A[num] + kk * lg) / (A[den] + kk);
  const share = (o, d, lg) => expit(logit(o) + logit(d) - logit(lg));
  if (L.k[0] > 0 && c[K.sit] > 0) {
    const chances = c[K.sit] / L.k[0];
    const side = (A, B) => {
      const part = (cc, cp) => {
        const lgS = lr(cc, K.sit), lgP = lr(cp, cc);
        if (lgS == null || lgP == null || lgS <= 0) return 0;
        const sh = share(rate(A.o, cc, K.sit, lgS, k), rate(B.d, cc, K.sit, lgS, k), lgS);
        const ppc = rate(A.o, cp, cc, lgP, k / 2) + rate(B.d, cp, cc, lgP, k / 2) - lgP;
        return chances * sh * ppc;
      };
      return { hc: part(K.hcc, K.hcp), tr: part(K.trc, K.trp), sc: part(K.scc, K.scp) };
    };
    const h = side(Th, Ta), a = side(Ta, Th);
    out.hc = h.hc - a.hc; out.tr = h.tr - a.tr; out.sc = h.sc - a.sc;
  }
  const zf = c[K.rima] + c[K.mida] + c[K.f3a];
  if (L.k[1] > 0 && zf > 0) {
    const shots = zf / L.k[1], Z = [[K.rima, K.rimm, 2], [K.mida, K.midm, 2], [K.f3a, K.f3m, 3]];
    const pps = (A, B) => {
      const fa = X => X[K.rima] + X[K.mida] + X[K.f3a];
      const sh = Z.map(([za]) => { const lg = c[za] / zf; return lg > 0 ? share((A.o[za] + k * lg) / (fa(A.o) + k), (B.d[za] + k * lg) / (fa(B.d) + k), lg) : 0; });
      const tot = sh.reduce((x, y) => x + y, 0) || 1;
      return Z.reduce((e, [za, zm, v], i) => {
        const lg = lr(zm, za);
        if (lg == null || lg <= 0) return e;
        return e + (sh[i] / tot) * share(rate(A.o, zm, za, lg, k / 2), rate(B.d, zm, za, lg, k / 2), lg) * v;
      }, 0);
    };
    out.shot = shots * (pps(Th, Ta) - pps(Ta, Th));
  }
  return out;
}

/* --------------------------------------------- What wins' own refinements --- */
/* THE SHRINKAGE BY THE FACTOR'S OWN SPREAD (winmodel.js pregame(): k = σ²_within / τ²_between, clamped [2, 30], 10
   with too few clubs): a factor that really differs between clubs is believed sooner, one that is mostly game-to-game
   noise later. Per league-season and end (for, against), from each club's per-game sums and sums of squares; kept until
   the league's next game is learned */
const ebMemo = typeof WeakMap === 'function' ? new WeakMap() : null;
function ebShrink(S, L, s) {
  const memo = ebMemo && (ebMemo.get(S) || (ebMemo.set(S, new Map()), ebMemo.get(S)));
  const hit = memo && memo.get(L);
  if (hit && hit.ver === L.ver) return hit.K;
  const ts = L.tm.map(id => S.teams[id]).filter(T => T && T.s === s && T.n >= 2 && T.q);
  const K = { o: [10, 10, 10, 10], d: [10, 10, 10, 10] };
  if (ts.length >= 3) {
    ['o', 'd'].forEach(end => {
      const b = end === 'o' ? 0 : 8;
      for (let j = 0; j < 4; j++) {
        let ssw = 0, N = 0, inv = 0;
        const means = ts.map(T => { const m = T.q[b + j] / T.n; ssw += T.q[b + 4 + j] - T.n * m * m; N += T.n; inv += 1 / T.n; return m; });
        const s2w = ssw / Math.max(1, N - ts.length), mm = means.reduce((a, v) => a + v, 0) / means.length;
        const vb = means.reduce((a, v) => a + (v - mm) * (v - mm), 0) / Math.max(1, means.length - 1);
        const t2 = vb - s2w * inv / ts.length;
        K[end][j] = t2 > 0 ? clamp(s2w / t2, 2, 30) : 30;
      }
    });
    /* a spread measured on a few games a club is noise itself: the fixed SHRINK until the clubs have played EBN games
       or so (early in a season the measured k cost 0.0015 of Brier on the walk; on full seasons it gains 0.001) */
    const nb = ts.reduce((a, T) => a + T.n, 0) / ts.length, wq = C.ebMin && nb < C.ebMin ? 0 : nb / (nb + C.ebN);
    ['o', 'd'].forEach(end => { K[end] = K[end].map(k => wq * k + (1 - wq) * C.shrink); });
  } else K.o = K.d = [C.shrink, C.shrink, C.shrink, C.shrink];
  if (memo) memo.set(L, { ver: L.ver, K });
  return K;
}
/* EACH LEAGUE ITS OWN WEIGHTS (What wins fits each league's own, partially pooled): offsets on the shared weights of
   the four factors, Elo and the margin, learned from what the shared weights miss there */
const LGW = [1, 2, 3, 4, 5, 6];
function leagueTerm(S, lg, x) {
  const d = C.use.lgw && S.lw ? S.lw[lg] : null;
  if (!d) return 0;
  let m = 0;
  LGW.forEach((i, j) => { m += d[j] * x[i]; });
  return m;
}
/* the great-circle distance in km (winmodel.js hav) */
const hav = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(q)));
};

/* -------------------------------------------------------- the prediction --- */
function features(S, fx) {
  const Th = teamOf(S, fx.h), Ta = teamOf(S, fx.a);
  const nh = nOf(Th, fx.s), na = nOf(Ta, fx.s);
  const cur = T => (T && T.s === fx.s ? T : null);
  const L = S.lg[fx.lg + '|' + fx.s], mu = L && L.n ? factors(L.c) : { efg: null, tov: null, orb: null, ftr: null };
  /* each factor shrunk by its own k (What wins §7.8: σ²_within / τ²_between in the league's season), or SHRINK games */
  const KB = C.use.ebk && L && L.n ? ebShrink(S, L, fx.s) : null;
  const prof = (T, n, end) => {
    const f = cur(T) ? factors(end === 'o' ? T.o : T.d) : {};
    const out = {};
    FF.forEach((k, j) => { const m = mu[k], v = f[k], kk = KB ? KB[end][j] : C.shrink; out[k] = isNum(m) ? (isNum(v) ? (n * v + kk * m) / (n + kk) : m) : (isNum(v) ? v : null); });
    return out;
  };
  const hO = prof(Th, nh, 'o'), hD = prof(Th, nh, 'd'), aO = prof(Ta, na, 'o'), aD = prof(Ta, na, 'd');
  const blend = (k, off, def) => {
    const m = mu[k];
    if (!isNum(off) || !isNum(def) || !isNum(m)) return null;
    return PROP[k] ? 100 * expit(logit(off / 100) + logit(def / 100) - logit(m / 100)) : off + def - m;
  };
  const ex = FF.map(k => { const a = blend(k, hO[k], aD[k]), b = blend(k, aO[k], hD[k]); return isNum(a) && isNum(b) ? a - b : 0; });
  /* the schedule-adjusted four factors: the solve's attack of each against the other's defence, on the league's logit */
  const R = (C.use.adj || C.netMode === 'srs') && L && L.n ? schedule(S, L, fx.s, mu) : null, Z = { o: zeros(4), d: zeros(4), r: 0 };
  const rh0 = (R && cur(Th) && R[fx.h]) || Z, ra0 = (R && cur(Ta) && R[fx.a]) || Z;
  const adj = FF.map((k, j) => {
    if (!R || !C.use.adj || !isNum(mu[k])) return 0;
    const m = logit(mu[k] / 100);
    return 100 * (expit(m + rh0.o[j] + ra0.d[j]) - expit(m + ra0.o[j] + rh0.d[j]));
  });
  /* the margin: the schedule-adjusted rating (srs), a game (pg), or a hundred possessions (p100) */
  const net = (T, n, r) => {
    if (!cur(T) || !n) return 0;
    if (C.netMode === 'srs') return r.r;
    if (C.netMode === 'pg') return (T.o[6] - T.d[6]) / (n + C.shrink);
    if (!(T.o[7] > 0) || !(T.d[7] > 0)) return 0;
    return n * 100 * (T.o[6] / T.o[7] - T.d[6] / T.d[7]) / (n + C.shrink);
  };
  const elo = T => (T ? (T.s === fx.s ? T.e : C.elo0 + C.eloCarry * (T.e - C.elo0)) : C.elo0);
  const rest = T => (cur(T) && T.t ? clamp((fx.t - T.t) / DAY, 0, C.rest) : C.rest);
  const rh = rest(Th), ra = rest(Ta);
  const hv = Th ? homeVenue(Th) : null;
  const home = fx.v && hv && fx.v !== hv ? 0 : 1;
  /* pace: the two clubs' possessions a game (shrunk) against the league's */
  let pace = 1;
  if (L && L.n > 0 && L.c[7] > 0) {
    const lgP = L.c[7] / L.n, pc = (T, n) => (cur(T) && n > 0 ? (T.o[7] + lgP * C.shrink) / (n + C.shrink) : lgP);
    pace = clamp(((pc(Th, nh) + pc(Ta, na)) / 2) / lgP, 0.7, 1.4);
  }
  const fp = C.use.pace ? pace : 1, sp = C.use.paceSig ? pace : 1;
  const pos = C.use.pos ? posEdge(S, Th, Ta, L, fx.s) * C.posScale : 0;
  const fm = (T, n) => (cur(T) && n > 0 ? T.f * n / (n + C.formK) : 0);
  const form = C.use.form ? fm(Th, nh) - fm(Ta, na) : 0;
  const x = [home, ex[0] * fp, ex[1] * fp, ex[2] * fp, ex[3] * fp, (elo(Th) - elo(Ta)) / 100, (net(Th, nh, rh0) - net(Ta, na, ra0)) / 10, rh - ra,
             (rh < C.b2b ? 1 : 0) - (ra < C.b2b ? 1 : 0), adj[0] * fp, adj[1] * fp, adj[2] * fp, adj[3] * fp, pos, form,
             C.use.avail ? (avail(S, Th, L, fx.s) - avail(S, Ta, L, fx.s)) * C.availScale : 0];
  const st = C.use.style ? style(Th, Ta, L, fx.s) : { hc: 0, tr: 0, sc: 0, shot: 0 };
  x.push(st.hc, st.tr, st.sc, st.shot);
  /* travel (What wins §7.8): km from each club's last venue to this one, where both are placed; a club's first game, 0 */
  const here = fx.vc || (fx.v && S.vc && S.vc[fx.v]) || null;
  const km = T => { if (!here) return null; if (!cur(T) || !T.lv) return 0; const c0 = S.vc[T.lv]; return c0 ? hav(c0, here) : null; };
  const kh = C.use.km ? km(Th) : null, ka = C.use.km ? km(Ta) : null;
  x.push(isNum(kh) && isNum(ka) ? (kh - ka) / 1000 : 0);
  return { x, n: [nh, na], home, pace: sp };
}
function predict(S, fx) {
  const F = features(S, fx);
  let m = F.home * (S.hca[fx.lg] || 0) + leagueTerm(S, fx.lg, F.x);
  for (let i = 0; i < P; i++) m += S.w[i] * F.x[i];
  const sigma = Math.sqrt(S.sig2 * F.pace), z = m / sigma;
  const p = expit(S.cal[0] + S.cal[1] * 1.702 * z);
  return { ok: F.n[0] >= MIN_GP && F.n[1] >= MIN_GP, p, margin: m, sigma, z, n: F.n, x: F.x, home: F.home, pace: F.pace };
}

/* --------------------------------------------------------------- learning --- */
function learn(S, g, opts) {
  const o = opts || {};
  /* the prediction made before the game (walk passes the one it made before any game of the same tip-off was learned) */
  const pre = o.pre || predict(S, g);
  const y = g.hs - g.as;
  if (!isNum(y)) return pre;
  const x = pre.x, home = pre.home;
  /* w: recursive least squares on the margin, the league's home edge held aside */
  const hcaL = S.hca[g.lg] || 0;
  const lwT = leagueTerm(S, g.lg, x);
  let yhat = home * hcaL + lwT;
  for (let i = 0; i < P; i++) yhat += S.w[i] * x[i];
  const e = y - yhat;
  const Px = zeros(P);
  for (let i = 0; i < P; i++) { let s = 0; for (let j = 0; j < P; j++) s += S.P[i * P + j] * x[j]; Px[i] = s; }
  let den = C.forget;
  for (let i = 0; i < P; i++) den += x[i] * Px[i];
  if (den > 1e-9) {
    for (let i = 0; i < P; i++) S.w[i] += (Px[i] / den) * e;
    for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) S.P[i * P + j] = (S.P[i * P + j] - Px[i] * Px[j] / den) / C.forget;
    /* forgetting inflates a direction no game moves: held to its starting doubt */
    for (let i = 0; i < P; i++) if (S.P[i * P + i] > C.p0[i] * 4) { const k = Math.sqrt(C.p0[i] * 4 / S.P[i * P + i]); for (let j = 0; j < P; j++) { S.P[i * P + j] *= k; S.P[j * P + i] *= k; } }
  }
  /* the league's own home edge: what the model still misses on its home games, kept near the shared edge */
  let r = y - home * hcaL - lwT;
  for (let i = 0; i < P; i++) r -= S.w[i] * x[i];
  if (home) S.hca[g.lg] = hcaL + C.hcaEta * (r - C.hcaL2 * hcaL);
  /* the league's own weights on the four factors, Elo and the margin (What wins fits each league its own): what the
     shared weights still miss there, in normalised steps, held near nothing (the shared weights) */
  if (C.use.lgw) {
    const d = S.lw[g.lg] || (S.lw[g.lg] = zeros(LGW.length));
    let nx = 1;
    LGW.forEach(i => { nx += x[i] * x[i]; });
    LGW.forEach((i, j) => { d[j] += C.lwEta * (r * x[i] / nx - C.lwL2 * d[j]); });
  }
  /* σ and its own wins and losses, on the games it would have spoken about */
  if (pre.ok) {
    S.sig2 = (1 - C.sigA) * S.sig2 + C.sigA * e * e / (pre.pace || 1);
    if (y !== 0) {
      const won = y > 0 ? 1 : 0, gr = won - pre.p;
      S.cal[0] += C.calEta * (gr - C.calL2 * S.cal[0]);
      S.cal[1] = clamp(S.cal[1] + C.calEta * (gr * 1.702 * pre.z - C.calL2 * (S.cal[1] - 1)), 0.3, 3);
      if (o.record !== false) {
        const M = S.metrics, B = S.by[g.lg] || (S.by[g.lg] = { n: 0, right: 0, brier: 0 });
        const right = (pre.p >= 0.5) === (won === 1) ? 1 : 0, b = (pre.p - won) * (pre.p - won);
        M.n++; M.right += right; M.brier += b; M.ll += -Math.log(clamp(won ? pre.p : 1 - pre.p, 1e-9, 1));
        B.n++; B.right += right; B.brier += b;
      }
    }
  }
  /* the clubs */
  const Th = teamOf(S, g.h, g.lg, g.s, true), Ta = teamOf(S, g.a, g.lg, g.s, true);
  season(Th, g.lg, g.s); season(Ta, g.lg, g.s);
  const L = leagueOf(S, g.lg, g.s);
  [g.h, g.a].forEach(id => { if (L.tm.indexOf(id) < 0) L.tm.push(id); });
  L.ver = (L.ver || 0) + 1;
  /* form: what the model missed by, from each club's side */
  Th.f = (1 - C.formA) * Th.f + C.formA * (y - pre.margin);
  Ta.f = (1 - C.formA) * Ta.f - C.formA * (y - pre.margin);
  /* Elo (the home term in Elo points from the model's own home edge) */
  const H = clamp(C.eloPerPt * (S.w[0] + (S.hca[g.lg] || 0)), 0, C.eloHmax) * home;
  const eh = Th.e, ea = Ta.e, pe = 1 / (1 + Math.pow(10, -(eh - ea + H) / 400));
  const act = y > 0 ? 1 : y < 0 ? 0 : 0.5;
  const ch = C.eloK * Math.log(Math.abs(y) + 1) * (2.2 / ((Math.abs(eh - ea) * 0.001) + 2.2)) * (act - pe);
  Th.e = eh + ch; Ta.e = ea - ch;
  const c0 = g.c && g.c[0], c1 = g.c && g.c[1];
  if (c0 && c1) {
    /* the schedule solve's sums: each side's factor logits, for and against, and whom it met */
    const fH = factors(c0), fA = factors(c1);
    FF.forEach((k, j) => {
      const yh = isNum(fH[k]) ? logit(fH[k] / 100) : 0, ya = isNum(fA[k]) ? logit(fA[k] / 100) : 0;
      Th.so[j] += yh; Th.sd[j] += ya; Ta.so[j] += ya; Ta.sd[j] += yh;
      const ph = isNum(fH[k]) ? fH[k] : 0, pa = isNum(fA[k]) ? fA[k] : 0;
      Th.q[j] += ph; Th.q[4 + j] += ph * ph; Th.q[8 + j] += pa; Th.q[12 + j] += pa * pa;
      Ta.q[j] += pa; Ta.q[4 + j] += pa * pa; Ta.q[8 + j] += ph; Ta.q[12 + j] += ph * ph;
    });
    Th.op[g.a] = (Th.op[g.a] || 0) + 1; Ta.op[g.h] = (Ta.op[g.h] || 0) + 1;
    for (let k = 0; k < NC; k++) {
      const a0 = c0[k] || 0, a1 = c1[k] || 0;          // a shorter line (no situations, no zones) adds nothing past its end
      Th.o[k] += a0; Th.d[k] += a1;
      Ta.o[k] += a1; Ta.d[k] += a0;
      L.c[k] += a0 + a1;
    }
    L.n += 2;
    [c0, c1].forEach(c => { if (c[K.sit] > 0) L.k[0]++; if (c[K.rima] + c[K.mida] > 0) L.k[1]++; });
  }
  /* positions: each player's game against their own usual, credited to the defence they met and their club's position */
  if (Array.isArray(g.pl) && g.pl.length) {
    const T2 = [Th, Ta];
    const groups = g.pl.map(l => posOf(S, l[0], T2[l[1]]));
    g.pl.forEach((l, i) => {
      if (!(l[2] > 0)) return;
      const att = T2[l[1]], def = T2[1 - l[1]], gp = groups[i];
      const p = S.pl[l[0]], own = p && p.s === g.s ? p : null;
      const rate = ((own ? own.gs : 0) + C.posPrior * lgRate(L, gp)) / ((own ? own.m : 0) + C.posPrior);
      const gs = gmsc(l);
      def.ps.dv[gp] += gs - rate * l[2]; def.ps.dm[gp] += l[2];
      att.ps.at[gp] += gs; att.ps.am[gp] += l[2];
      L.ga[gp] += gs; L.gm[gp] += l[2];
    });
    /* who played: this game's players become each club's last line-up, their minutes added to its season's roster */
    const seen = [false, false];
    g.pl.forEach(l => {
      if (!(l[2] > 0)) return;
      let p = S.pl[l[0]];
      if (!p || p.s !== g.s) p = S.pl[l[0]] = { s: g.s, m: 0, gs: 0, trb: 0, ast: 0, stl: 0, blk: 0, pf: 0 };
      p.m += l[2]; p.gs += gmsc(l); p.trb += l[8] + l[9]; p.ast += l[10]; p.stl += l[11]; p.blk += l[12]; p.pf += l[14];
      const T = T2[l[1]], tt = T.ps.tot;
      tt[0] += l[2]; tt[1] += l[8] + l[9]; tt[2] += l[10]; tt[3] += l[11]; tt[4] += l[12]; tt[5] += l[14];
      if (!seen[l[1]]) { seen[l[1]] = true; T.last = []; }
      T.last.push([l[0], l[2]]);
      T.ro[l[0]] = (T.ro[l[0]] || 0) + l[2];
    });
  }
  Th.n++; Ta.n++;
  Th.t = g.t; Ta.t = g.t;
  if (g.v) { Th.lv = g.v; Ta.lv = g.v; if (g.vc) S.vc[g.v] = g.vc; }
  if (g.v) Th.hv[g.v] = (Th.hv[g.v] || 0) + 1;
  S.n++;
  if (g.t > S.lastT) S.lastT = g.t;
  return pre;
}
/* many games, in tip-off order; the games of one tip-off are all predicted before any is learned */
function walk(S, games, opts) {
  const list = (games || []).slice().sort((a, b) => (a.t - b.t) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j < list.length && list[j].t === list[i].t) j++;
    const batch = list.slice(i, j), pres = batch.map(g => predict(S, g));
    batch.forEach((g, k) => {
      const late = !!(opts && opts.late && opts.late(g));
      out.push({ game: g, pre: learn(S, g, { pre: pres[k], record: !late }), late });
    });
    i = j;
  }
  return out;
}

/* --------------------------------------------------------- the kept state --- */
/* pack(): every id (club, league, season, venue, player) written once in `id` and referred to by its place; a club, a
   league and a player each one array; times in minutes; numbers to the precision they carry (counts to a tenth,
   minutes and game scores to a hundredth, logit sums to 1e-4, weights to 6 figures: a probability moves under 1e-4
   through a pack and an unpack); the covariance by its upper triangle. Clubs that have not played
   since keepAfter are left out, and every league and player of a season none of the kept clubs is in */
const rd = (v, d) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };
const r6 = v => +(+v).toPrecision(6);
const flat = (o, f) => { const out = []; Object.keys(o).forEach(k => out.push(f(k), o[k])); return out; };
function pack(S, o) {
  const keepAfter = o && isNum(o.keepAfter) ? o.keepAfter : 0;
  const ids = [], at = new Map();
  const I = s => { if (s == null) return -1; let i = at.get(s); if (i == null) { i = ids.length; ids.push(s); at.set(s, i); } return i; };
  const live = new Set(), tm = [];
  Object.keys(S.teams).forEach(id => {
    const T = S.teams[id];
    if (keepAfter && T.t && T.t < keepAfter) return;
    live.add(T.s);
    const ps = T.ps;
    tm.push([I(id), I(T.lg), I(T.s), T.n, T.o.map(v => rd(v, 1)), T.d.map(v => rd(v, 1)), rd(T.e, 2), Math.round(T.t / MIN),
             flat(T.hv, I), rd(T.f, 3), [].concat(ps.at, ps.am, ps.dv, ps.dm, ps.tot).map(v => rd(v, 2)),
             flat(T.ro, I).map((v, i) => (i % 2 ? rd(v, 2) : v)), [].concat(...T.last.map(([p, m]) => [I(p), rd(m, 2)])),
             T.so.map(v => rd(v, 4)), T.sd.map(v => rd(v, 4)), flat(T.op, I), (T.q || zeros(16)).map(v => rd(v, 1)), I(T.lv)]);
  });
  const lg = [];
  Object.keys(S.lg).forEach(k => {
    const [l, s] = k.split('|'), L = S.lg[k];
    if (!keepAfter || live.has(s)) lg.push([I(l), I(s), L.n, L.c.map(v => rd(v, 1)), L.ga.map(v => rd(v, 2)), L.gm.map(v => rd(v, 2)), L.tm.map(I), L.k]);
  });
  const pl = [];
  Object.keys(S.pl).forEach(id => { const p = S.pl[id]; if (!keepAfter || live.has(p.s)) pl.push([I(id), I(p.s), rd(p.m, 2), rd(p.gs, 2), p.trb, p.ast, p.stl, p.blk, p.pf]); });
  const tri = [];
  for (let i = 0; i < P; i++) for (let j = i; j < P; j++) tri.push(r6(S.P[i * P + j]));
  const M = S.metrics;
  return { v: V, model: MODEL, n: S.n, lastT: S.lastT, wm: S.wm || null, tuned: S.tuned || {}, tunedAt: S.tunedAt || 0, w: S.w.map(r6), P: tri, sig2: r6(S.sig2), cal: S.cal.map(r6),
           m: [M.n, M.right, r6(M.brier), r6(M.ll)], hca: flat(S.hca, I).map((v, i) => (i % 2 ? r6(v) : v)),
           by: Object.keys(S.by).map(l => [I(l), S.by[l].n, S.by[l].right, r6(S.by[l].brier)]),
           lw: Object.keys(S.lw || {}).map(l => [I(l)].concat(S.lw[l].map(r6))),
           vc: [].concat(...Object.keys(S.vc || {}).map(v => [I(v)].concat(S.vc[v] ? S.vc[v].map(c => rd(c, 4)) : [null, null]))),
           id: ids, lg, tm, pl };
}
/* unpack(): the state pack() kept, or a new one when it is of another layout */
function unpack(j) {
  if (!j || j.v !== V || !Array.isArray(j.w) || j.w.length !== P || !Array.isArray(j.P) || j.P.length !== P * (P + 1) / 2) { apply({}); return create(); }
  /* the settings it was tuned to, back in force: the state means what it says only under them */
  apply(j.tuned || {});
  const id = j.id || [], S = create();
  S.tuned = j.tuned || {}; S.tunedAt = j.tunedAt || 0;
  const pairs = (a, f) => { const o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[id[a[i]]] = f ? f(a[i + 1]) : a[i + 1]; return o; };
  Object.assign(S, { n: j.n, lastT: j.lastT, wm: j.wm || null, w: j.w.slice(), sig2: j.sig2, cal: j.cal.slice(),
    metrics: { n: j.m[0], right: j.m[1], brier: j.m[2], ll: j.m[3] }, hca: pairs(j.hca) });
  let k = 0;
  for (let a = 0; a < P; a++) for (let b = a; b < P; b++) { S.P[a * P + b] = S.P[b * P + a] = j.P[k++]; }
  (j.by || []).forEach(([l, n, right, brier]) => { S.by[id[l]] = { n, right, brier }; });
  (j.lg || []).forEach(([l, s, n, c, ga, gm, tms, k]) => { S.lg[id[l] + '|' + id[s]] = { n, c, ga, gm, tm: tms.map(i => id[i]), k: k || [0, 0] }; });
  (j.tm || []).forEach(r => {
    const ps = r[10], last = [];
    for (let i = 0; i + 1 < r[12].length; i += 2) last.push([id[r[12][i]], r[12][i + 1]]);
    S.teams[id[r[0]]] = { lg: id[r[1]], s: id[r[2]], n: r[3], o: r[4], d: r[5], e: r[6], t: r[7] * MIN, hv: pairs(r[8]), f: r[9],
      ps: { at: ps.slice(0, 3), am: ps.slice(3, 6), dv: ps.slice(6, 9), dm: ps.slice(9, 12), tot: ps.slice(12, 18) },
      ro: pairs(r[11]), last, so: r[13], sd: r[14], op: pairs(r[15]), q: r[16] || zeros(16), lv: r[17] >= 0 ? id[r[17]] : null };
  });
  (j.pl || []).forEach(([i, s, m, gs, trb, ast, stl, blk, pf]) => { S.pl[id[i]] = { s: id[s], m, gs, trb, ast, stl, blk, pf }; });
  (j.lw || []).forEach(r => { S.lw[id[r[0]]] = r.slice(1); });
  const vc = j.vc || [];
  for (let i = 0; i + 2 < vc.length; i += 3) S.vc[id[vc[i]]] = vc[i + 1] == null ? null : [vc[i + 1], vc[i + 2]];
  return S;
}
/* the schedule-adjusted ratings of a league's season: { club: { o: [efg, tov, orb, ftr], d: [...] } } on the logit scale */
function ratings(S, lg, s) {
  const L = S.lg[lg + '|' + s];
  return L && L.n ? schedule(S, L, s, factors(L.c)) : {};
}
/* ------------------------------------------------------- tuning itself --- */
/* THE MODEL TUNES ITS OWN SETTINGS (Louie, 2026-10-08). Its weights learn from every result as it goes; its settings -
   how far early numbers are shrunk, how fast form moves, how freely each family of inputs may weigh, and which families
   it uses at all - are tuned on the whole database: every finished game walked again in tip-off order under each
   candidate setting, each game predicted before it is learned, so every score is out of sample. Coordinate descent: a
   setting at a time, its two neighbours tried, kept only when the log loss falls by MIN_GAIN overall AND by HALF_GAIN
   in each half of the games (older, newer) on its own - a change that only fits one stretch of games is not kept.
   STRICT ON PURPOSE (2026-10-08): tuned on the older half of the database and tried on the newer, looser rules found
   changes worth 0.006 of log loss on the games they were tuned on and nothing on the others; under these rules it
   moves two (the spread's pace, the home edges' learning rate) and the newer half is level (Brier 0.2139 v 0.2140,
   paired t −0.1) - no harm, and as the games pile up a gain that holds is what moves a setting.
   Settings are kept as what differs from the defaults (S.tuned), and unpack() puts them back. */
const DEFAULTS = JSON.parse(JSON.stringify(C));
const GROUPS = { 'p0.adj': [9, 10, 11, 12], 'p0.pa': [13, 15], 'p0.style': [16, 17, 18, 19], 'p0.km': [20] };
const TUNE = ['shrink', 'ebN', 'ebMin', 'adjK', 'srsK', 'formA', 'formK', 'forget', 'sigA', 'calEta', 'eloK', 'eloCarry', 'styleK', 'posShrink', 'hcaEta',
              'lwEta', 'lwL2', 'p0.adj', 'p0.pa', 'p0.style', 'p0.km',
              'use.adj', 'use.pos', 'use.form', 'use.avail', 'use.style', 'use.km', 'use.ebk', 'use.lgw', 'use.pace', 'use.paceSig'];
const MIN_GAIN = 0.001, HALF_GAIN = 0.0003;
/* the defaults with these settings over them */
function apply(over) {
  const d = JSON.parse(JSON.stringify(DEFAULTS));
  Object.keys(d).forEach(k => { C[k] = d[k]; });
  Object.keys(over || {}).forEach(k => {
    const v = over[k];
    if (k.indexOf('use.') === 0) C.use[k.slice(4)] = !!v;
    else if (GROUPS[k]) GROUPS[k].forEach(i => { C.p0[i] = d.p0[i] * v; });
    else if (typeof d[k] === 'number' && isNum(v)) C[k] = v;
  });
}
const valueOf = (over, k) => (k in over ? over[k] : k.indexOf('use.') === 0 ? !!DEFAULTS.use[k.slice(4)] : GROUPS[k] ? 1 : DEFAULTS[k]);
function neighbours(k, v) {
  if (typeof v === 'boolean') return [!v];
  if (k === 'forget') return [1 - (1 - v) * 2, 1 - (1 - v) / 2];
  if (k === 'eloCarry') return [v * 0.8, Math.min(0.95, v * 1.2)];
  return [v / 1.6, v * 1.6].map(x => +x.toPrecision(3));
}
/* the walk's log loss over the games it judged (draws out), and over each half of them */
function judge(games) {
  const recs = walk(create(), games).filter(r => r.pre.ok && r.game.hs !== r.game.as);
  const ll = a => a.reduce((s, r) => s - Math.log(clamp(r.game.hs > r.game.as ? r.pre.p : 1 - r.pre.p, 1e-9, 1)), 0) / Math.max(1, a.length);
  const h = Math.floor(recs.length / 2);
  return { n: recs.length, ll: ll(recs), h1: ll(recs.slice(0, h)), h2: ll(recs.slice(h)) };
}
function tune(games, o) {
  const opt = o || {}, log = opt.log || (() => {});
  const deadline = Date.now() + (isNum(opt.budgetMs) ? opt.budgetMs : 240000);
  let over = Object.assign({}, opt.start || {});
  const score = ov => { apply(ov); try { return judge(games); } finally { apply(over); } };
  const base = score(over);
  if (base.n < (opt.minGames || 300)) { apply(over); return { over, base, best: base, changed: [], tried: 1, enough: false }; }
  let best = base, tried = 1;
  const changed = [];
  for (let pass = 0; pass < (opt.passes || 3); pass++) {
    let moved = false;
    for (const k of TUNE) {
      if (Date.now() > deadline) break;
      for (const v of neighbours(k, valueOf(over, k))) {
        if (Date.now() > deadline) break;
        const cand = Object.assign({}, over, { [k]: v });
        const sc = score(cand); tried++;
        const mg = isNum(opt.minGain) ? opt.minGain : MIN_GAIN, hg = isNum(opt.halfGain) ? opt.halfGain : HALF_GAIN;
        if (sc.ll < best.ll - mg && sc.h1 < best.h1 - hg && sc.h2 < best.h2 - hg) {
          log('tune: ' + k + ' ' + valueOf(over, k) + ' -> ' + v + ' (log loss ' + best.ll.toFixed(4) + ' -> ' + sc.ll.toFixed(4) + ')');
          over = cand; best = sc; moved = true; changed.push([k, v, +sc.ll.toFixed(5)]);
          break;
        }
      }
    }
    if (!moved || Date.now() > deadline) break;
  }
  /* settings back at the defaults are not kept */
  Object.keys(over).forEach(k => { if (JSON.stringify(over[k]) === JSON.stringify(valueOf({}, k))) delete over[k]; });
  apply(over);
  return { over, base, best, changed, tried, enough: true };
}

function summary(S) {
  const M = S.metrics;
  return { model: MODEL, games: S.n, judged: M.n, right: M.n ? M.right / M.n : null, brier: M.n ? M.brier / M.n : null, logloss: M.n ? M.ll / M.n : null,
           sigma: Math.sqrt(S.sig2), cal: S.cal.slice(), w: Object.fromEntries(X_KEYS.map((k, i) => [k, S.w[i]])) };
}

return { V, MODEL, MIN_GP, X_KEYS, COUNTS, LINE_KEYS, C, create, countsOf, countsOfRow, lineSelect, lineOf, gmsc, factors,
         predict, learn, walk, ratings, pack, unpack, summary, apply, tune, judge, TUNE, DEFAULTS,
         shrinkOf: (S, lg, s) => { const L = S.lg[lg + '|' + s]; return L ? ebShrink(S, L, s) : null; } };
}));
