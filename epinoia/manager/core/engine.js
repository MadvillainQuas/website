'use strict';
/* ============================================================================
   MANAGER - THE GAME ENGINE (core: no site, no DOM, no database; the standalone game takes this file, cards.js and
   winsim.js as they are).

   THE WHAT WINS MODEL, PLAYED BY THE PLAYERS ON THE FLOOR (Louie, 2026-10-09: "the FM style attributes are for visuals
   for players, not the actual underlying mechanisms (need to use the full what wins model)"). A game is the What wins
   simulator (winsim.js: a possession-level chain - turnovers live or dead, foul trips, a shot from a zone, its make, the
   rebound, the and-one, transition, the home court, the score effect, end-game fouling, overtime), and the rates it
   plays with are built here, five men at a time, from the players' own cards (cards.js):

     THE OFFENCE OF A FIVE. Each man ends a share of the plays - his usage, after the five's plays are made to add up to
     100 (the squad model's usage sim: the discretionary usage above a role player's floor gives way, weighted to the
     creators) - and each of his plays goes the way his own line goes: a turnover at his rate, a foul trip at his rate,
     a shot from the rim, the mid-range or three in his own mix, made at his own rates (all against his league, set in
     this league's environment). A man handed more plays than he is used to makes fewer of them (SKILL_L a point of
     usage), more so if he does not make his own shots; a man handed fewer, a little more. Then the five together:
     SPACING (its shooters' threat, summed over the five: without it the paint is packed - fewer rim attempts, and
     worse finishing on the ones there are; a defence packing the paint leans on it), PASSING (its AST% lifts the makes
     that come off a pass), the offensive glass as the five's ORB% summed, the pace as the five's.
     THE DEFENCE OF A FIVE. What an average offence gets against it: the turnovers its STL% summed forces, the rim its
     BLK% summed and its rim on/off protect, the opponents' glass its DRB% summed leaves, the foul trips its fouls give.
     ON/OFF, LIGHTLY: every card carries its man's on/off with a small weight that grows with his possessions (cards.js);
     summed over the five at half weight (five men share the floor's one on/off).
     OUT OF POSITION: a man more than one position from his own (a guard at centre, a centre at the point) costs the
     offence makes and turnovers and the defence what his size or speed would have taken away, growing with the square
     of the distance.
     TIRED LEGS: the squad model's stamina - only the change from his own minutes is priced, nothing until the upper
     30s, then with the square of the minutes past the line, heavier with usage.
     FORM (the fantasy part; Louie: "players' stats are manipulated by their IRL performances"): a man's real games in
     the days before a round move his makes, his usage and his work rate for that round (season.js ranks it; FORM).

   THE TACTICS (Louie: "the efficacy of all have to be dependent on the players (they're style adjusters that
   manipulate how the team plays using the players at hand - so it needs to be fully simmed to what the outcome would be
   if those players with their stats tried that)"). No slider adds points of its own: each moves WHAT THE PLAYERS TRY -
   who takes the plays, from where, how often they run, crash or gamble - and the outcome is their own rates at the new
   volume. More threes go to the men who make threes (and still cost each man a little per extra attempt, less if he
   makes his own); a downhill game goes to the men who get to the rim and draws their fouls; leaking out runs with the
   men who run (a five that never runs gives the extra chances away - Louie: "If you encourage transition with a team
   whose players don't play often in transition I want there to be a penalty"); gambling turns into steals for quick
   hands and into open shots for everybody else; funnelling to the rim works with a rim protector and is a gift without
   one. See TACTICS for each.

   ROTATIONS. A side plays a timeline of fives: the user's up to four lineups, each with its own tactics (lineup 1
   opens and closes every quarter, the others play the middles), a real club's rotation from its own minutes (its most-used men at their
   positions, the starters opening and closing, the bench the middles: autoRotation). Both timelines run on the same
   clock, so starters meet starters and benches meet benches, and every stretch is its own matchup (winsim.matchup: the
   log5 blend, the home court); the game is the stretches' rates put together by the possessions each plays, then one
   winsim game. The box score shares the game's own counts out to the men by what each was doing in each stretch.

     sideOf(five, X)              five: [{card, k}] (k = 0..4, PG..C) -> a winsim profile {off, def} and what each man does
     rotation(lineups, G)         the user's lineups [{ids: [5 ids, PG..C], min, tac}] -> [{t0, t1, ids, tac}]
     autoRotation(players, G)     a real club's [{id, mpg, share}] -> [{t0, t1, ids}]
     play(H, A, X)                one game -> {pts, ot, tally, box, events, lineups}: the play-by-play and its box score
     leagueOf(ref, fo, G, o)      the league the simulator plays in (the fo file's fitted one, else from the season)
     identityOf(team, row, X)     a real club's identity: its own four factors against its players' build, as edits
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.engine = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

let SIMc = null;
/* the simulator: the site's (window.EpinoiaWinSim), node's require, or one handed in (the standalone game: use(sim)) */
const SIM = () => SIMc || (SIMc = root.EpinoiaWinSim || (typeof require === 'function' ? require('../../winsim.js') : null));
const use = sim => { SIMc = sim; };
/* the cards' module (a position's averages, for the instructions' fit to a man): the site's, or node's require */
const CARDS = () => (root.Mgr && root.Mgr.cards) || (typeof require === 'function' ? require('./cards.js') : null);

const isNum = v => typeof v === 'number' && isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cp = p => clamp(p, 1e-4, 1 - 1e-4);
const logit = p => Math.log(cp(p) / (1 - cp(p)));
const expit = x => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const ZONES = ['rim', 'mid', 'three'];
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];

/* ------------------------------------------------------------------ the numbers --- */
const PPP_LOGIT = 0.475;          // points a play for one logit of every make (a league's shot mix): 0.008 ppp = 0.017
const USG_FLOOR = 12;             // squad.js: the usage a role player keeps whatever else is out there
const SKILL_L = 0.008 / PPP_LOGIT;   // squad.js SKILL (points a play a point of usage) on the make logit
/* the cost of an extra attempt from a zone: kappa x ln(new share / his share), times (1 - 0.6 x his unassisted share
   there) - a man who makes his own shots pays less for taking more of them (Louie: "more unassisted = less penalty") */
const KAPPA = { rim: 0.30, mid: 0.20, three: 0.30 };
const FATIGUE = { start: 0.8, ppp: 0.012, rate: 0.02 };           // squad.js
const FAT_LOGIT = FATIGUE.ppp / PPP_LOGIT;
const fatigueLoad = (mins, usg, G) => { const over = Math.max(0, mins - FATIGUE.start * G) / (0.1 * G); return over * over * clamp((isNum(usg) ? usg : 20) / 20, 0.5, 2); };
/* form: a man's real games before the round, as a z-score (capped at 2 either way): his makes, his usage, his work */
const FORM = { make: 0.05, usg: 1.0, rate: 0.04 };
/* out of position: e = how far past one position away from his own (roles.posGap: nothing within a position and a quarter -
   a shooting guard at small forward plays as himself - then a unit a position: a shooting guard at power forward 1, at
   centre 2.3; Louie, 2026-10-15: "not have much of a docking of stats unless it's a position 2 positions up from them or
   more"); costs grow with e squared */
const OOP = { make: 0.06, tov: 0.08, rim: 0.10, three: 0.06 };
const oopGap = (k, pos) => { const d = Math.abs(k + 1 - (isNum(pos) ? pos : k + 1)); return d <= 1.25 ? 0 : (d - 1.25) * 1.33; };
/* the five together */
/* SPACING (Louie, 2026-10-09: "spacing (as an accumulative lineup stat) affects rim efficiency (less shooters = more able
   to easily pack the paint)"): the five's shooting threat - each man's three-point share against the league's times his
   3P% against the league's, squared, averaged over the five (1 = the league's five) - moves everybody's finishing at the
   rim (space, on the make logit a unit) and how many rim attempts there are at all (spaceMix, on the rim share a unit).
   A defence that packs the paint (scheme > 0) leans on it: PACK on the rim make logit for each unit of spacing short of
   the league's five, and the same back when the five can shoot (paint packers pay against real shooters). */
const SYN = { space: 0.16, spaceMix: 0.12, pass: 0.08, pack: 0.14 };
/* how far a tactic at full moves the five's shot mix (share of its shots); downhill and deep are a ball handler's own
   (his share of his shots, through his handler weight - handlerWeights) */
const SHIFT = { downhill: 0.10, deep: 0.12, cut: 0.06, space: 0.08, feed: 0.05 };
const DR = 0.8;                   // summed rates over the five: a little less than the whole sum (diminishing returns)
const BLK_LOGIT = 0.0375;         // one point of the five's BLK% on the rim make logit
/* when the league has no fitted simulator (no fo file): the parameters a calibrated league typically lands near */
const FALLBACK_L = { kappaN: 1, sigmaN: 1.5, hca: 0.04, tau: 0, muOff: 0, dTr: 0.2, lead: 0.10, tripOff: -0.06, ft3: 0.05, fouling: true };

/* THE TEAM INSTRUCTIONS, per lineup, in Football Manager's three phases (Louie, 2026-10-14: "Use football manager engine
   design/philosophy"). lo..hi; a two-sided one runs from `left` (lo) to `right` (hi), 0 is neither.
   THE BALL HANDLERS' SLIDER (Louie: "make it so that it's obvious that get downhill/punish from deep are for the ball
   handlers (and increase the 3PT volume for the ball handlers not elsewhere), and also make it so that it's a single
   sliding scale"): one scale, from attacking the rim to pull-up threes, and only for the five's ball handlers - its one
   or two main creators (handlerWeights) - at their own finishing and their own pull-up shooting. A club's saved Get
   downhill / Punish from deep are read onto it (normTac). */
const TACTICS = [
  { k: 'guards', lo: 0, hi: 1, label: 'Guard play', group: 'In possession', how: 'More of the plays to the point and shooting guards (through their own usage: creators take it on best)' },
  { k: 'wings', lo: 0, hi: 1, label: 'Wing play', group: 'In possession', how: 'More of the plays to the small forward' },
  { k: 'bigs', lo: 0, hi: 1, label: 'Big play', group: 'In possession', how: 'More of the plays to the power forward and centre' },
  { k: 'handlers', lo: -1, hi: 1, left: 'Get downhill', right: 'Punish from deep', group: 'In possession', label: 'Ball handlers',
    how: 'For your ball handlers only (the one or two who run the offence). Downhill: they attack the rim and draw fouls, at their own finishing (loose handles turn it over). Deep: they take more pull-up threes, at their own three-point rate, and every extra one costs more the less they shoot off the dribble' },
  { k: 'motion', lo: -1, hi: 1, left: 'Off-ball cutting', right: 'Space the floor', group: 'In possession', how: 'Cutting: finishers who score off passes get rim looks (it needs passers). Spacing: catch-and-shoot threes, and driving lanes for the creators (it needs shooters)' },
  { k: 'feed', lo: -1, hi: 1, left: 'Hit the screener', right: 'Hit the shooters', group: 'In possession', how: 'Plays to the men who set the screens, the way their roles play it (a roller at the rim, a popping big from three, a short roller from the middle), or to the best shooters' },
  { k: 'leak', lo: 0, hi: 1, label: 'Leak out', group: 'In transition', how: 'Runners leave early: more transition chances, fewer defensive rebounds. A five that does not run gives the extra chances away' },
  { k: 'crash', lo: 0, hi: 1, label: 'Attack the offensive boards', group: 'In transition', how: 'Second chances for the crashers; the opponents run out against you more' },
  { k: 'scheme', lo: -1, hi: 1, left: 'Funnel to rim protection', right: 'No paint touches', group: 'Out of possession', how: 'Funnel: give up rim shots into your protector (a gift without one). No paint touches: pack the paint, give up threes (your perimeter defenders decide how open)' },
  { k: 'gamble', lo: 0, hi: 1, label: 'Gamble for steals', group: 'Out of possession', how: 'More steals for quick hands; open shots and fouls when the gambles miss' }
];
const TK = TACTICS.map(t => t.k);
function normTac(t) {
  const o = { usage: {} };
  TACTICS.forEach(d => { const v = t && isNum(+t[d.k]) ? +t[d.k] : 0; o[d.k] = clamp(v, d.lo, d.hi); });
  /* the two sliders this one replaced: deep to the right, downhill to the left */
  if (t && !isNum(+t.handlers) && (isNum(+t.deep) || isNum(+t.downhill))) o.handlers = clamp((isNum(+t.deep) ? +t.deep : 0) - (isNum(+t.downhill) ? +t.downhill : 0), -1, 1);
  if (t && t.usage && typeof t.usage === 'object') Object.keys(t.usage).forEach(id => { const v = +t.usage[id]; if (isNum(v) && v) o.usage[id] = clamp(v, -1, 1); });
  return o;
}
/* a team's player instructions as a cache key (Map id -> {u, k: Set}) */
const insKey = ins => (ins && ins.size ? [...ins.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, x]) => id + ':' + (x.u || 0) + ':' + [...x.k].sort().join('.')).join('|') : '');
const tacKey = t => TK.map(k => Math.round(100 * (t[k] || 0))).join(',') + '|' + Object.keys(t.usage || {}).sort().map(id => id + ':' + Math.round(100 * t.usage[id])).join(',');

/* ------------------------------------------------------------------ the league --- */
/* the simulator's league: the fo file's fitted one where there is one (its rates and every parameter), else built here
   from the league's own season: its clubs' totals (teams: season.js team rows) for the turnovers, the glass, the free
   throws, the pace and transition; its players' (refOf) for the shot mix and the make rates; its games for the home
   court (the home win share, through HCA_PER: 0.01 of hca is about 0.0255 of home wins at the score effect below); the
   parameters calibrate() fits otherwise from FALLBACK_L. G: minutes in a game. */
const HCA_PER = 2.55;
/* the league's own averages a club's style is read against (identityOf): its clubs' pace and how often they run, and
   how often their opponents run, over the clubs that have played */
function styleOf(teams) {
  const T = Array.isArray(teams) ? teams.filter(t => (+t.gp || 0) > 0) : [];
  const avg = (k, ok) => { const xs = T.filter(t => (!ok || ok(t)) && isFinite(+t[k]) && t[k] != null && t[k] !== '').map(t => +t[k]); return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null; };
  return { pace: avg('pace', t => +t.pace > 30), trFreq: avg('ev_transition_freq', t => (+t.ev_gp || 0) >= 5), dTrFreq: avg('evd_transition_freq', t => (+t.evd_gp || 0) >= 5) };
}
function leagueOf(ref, fo, G, o) {
  const S = SIM(), LG = S.LG;
  const style = styleOf(o && o.teams);
  if (fo && fo.lg && fo.lg.rates) {
    const L = Object.assign({}, fo.lg);
    L.rates = Object.assign({}, LG, fo.lg.rates);
    if (fo.sim && fo.sim.calibrated && fo.sim.platt) L.platt = fo.sim.platt;
    L.style = style;
    return L;
  }
  o = o || {};
  const rates = Object.assign({}, LG), L = Object.assign({ rates, T: (G || 40) * 60, Tot: 300, zones: !!(ref && ref.zones) }, FALLBACK_L);
  if (ref) {
    rates.mixRim = ref.mix.rim; rates.mixMid = ref.mix.mid; rates.mix3 = ref.mix.three;
    rates.pRim = ref.rim; rates.pMid = ref.mid; rates.p3 = ref.p3; rates.p2 = ref.p2; rates.ft = ref.ft;
    rates.tov = clamp(ref.tovPlay, 0.06, 0.3);
    if (isNum(ref.pace) && ref.pace > 30) rates.d = clamp(1200 / ref.pace, 10, 24);
  }
  const T = Array.isArray(o.teams) ? o.teams.filter(t => (+t.gp || 0) > 0) : [];
  const s = k => T.reduce((a, t) => a + (+t[k] || 0), 0);
  if (T.length >= 4 && s('fga') > 0) {
    const plays = s('fga') + 0.44 * s('fta') + s('tov');
    /* the clubs' own turnovers (team turnovers too) and their offensive glass, per chance and per miss */
    rates.tov = clamp(s('tov') / plays, 0.06, 0.3);
    if (s('oreb') + s('dreb') > 0) rates.orb = clamp(s('oreb') / (s('oreb') + s('dreb')), 0.15, 0.5);
    /* the trips that give the league's free throws a field goal attempt (r): 2.02 tt + (1 - tt) mk a1 = r (1 - tt) */
    const r = s('fta') / s('fga'), mk = s('fgm') / s('fga'), a1 = rates.and1 * mk, tt = clamp((r - a1) / (2.02 + r - a1), 0.03, 0.35);
    const sh = LG.sfoul / (LG.sfoul + LG.bonus);
    rates.sfoul = tt * sh; rates.bonus = tt * (1 - sh);
    /* the pace as the chain counts possessions (each ends in a turnover, a defensive board, a make or free throws):
       FGA + 0.44 FTA - OREB + TOV a club a game, over the game's seconds shared by both sides */
    const poss = (s('fga') + 0.44 * s('fta') - s('oreb') + s('tov')) / Math.max(1, s('gp'));
    if (poss > 30) rates.d = clamp(((G || 40) * 60) / (2 * poss), 10, 24);
    /* transition: its chances per defensive board or steal (the games the play-by-play covers), and its points a play
       against the half court's, which sets the transition make bonus */
    const ev = T.filter(t => (+t.ev_gp || 0) > 0);
    if (ev.length >= 4) {
      const cov = t => (+t.ev_gp || 0) / Math.max(1, +t.gp || 0);
      const trCh = ev.reduce((a, t) => a + (+t.ev_transition_ch || 0), 0), gains = ev.reduce((a, t) => a + ((+t.dreb || 0) + (+t.stl || 0)) * cov(t), 0);
      if (gains > 0 && trCh > 0) rates.tr = clamp(trCh / gains, 0.05, 0.6);
      const pp = k => { const pts = ev.reduce((a, t) => a + (+t['ev_' + k + '_pts'] || 0), 0), ch = ev.reduce((a, t) => a + (+t['ev_' + k + '_ch'] || 0), 0); return ch > 0 ? pts / ch : null; };
      const tp = pp('transition'), hp = pp('half');
      if (isNum(tp) && isNum(hp)) L.dTr = clamp(0.8 * (tp - hp) / PPP_LOGIT, 0, 0.6);
    }
  }
  /* the home court from the home win share, toward 0.04 by the number of games */
  const games = Array.isArray(o.games) ? o.games.filter(g => isNum(+g.home_score) && isNum(+g.away_score) && +g.home_score !== +g.away_score) : [];
  if (games.length) {
    const hw = games.filter(g => +g.home_score > +g.away_score).length / games.length, w = games.length / (games.length + 150);
    L.hca = clamp(w * (hw - 0.5) / HCA_PER + (1 - w) * 0.04, 0, 0.09);
  } else L.hca = 0.04;
  L.style = style;
  return L;
}

/* A REAL CLUB PLAYS LIKE ITSELF. The players' lines build most of a club, never all of it - its scheme, its coaching,
   how its men fit are in its results and in no box score. So a real club carries its IDENTITY: the gap between its own
   numbers and what its own players build over its own rotation, shrunk by its games (IDENTITY_K), put on every five it
   plays as edits in natural units (winsim.applyEdits, and two of the Manager's own below). Worked out once, from the club
   as it really is; a man drafted away still takes his own part with him. The user's club has none: it is new, and what
   it is is its players.
   ITS STYLE FIRST (Louie, 2026-10-14: "Can IRL teams also use their real life styles (i.e. shot frequencies, how much they
   play in transition etc.)"): its three-point rate and its rim-to-mid-range split, how often it runs and its pace, at
   both ends (season.js team rows: p3_share, rim_share, mid_share, pace, and the play-by-play's ev_/evd_ splits); then
   its four factors, against the build with its style on - so its shooting is its own whatever its mix. */
const IDENTITY_K = 15;
/* the Manager's own edits (winsim knows the rest): the rim-to-mid-range split (a log-ratio) and the transition rate (a
   factor) */
const OWN_EDITS = { rimmid: true, trx: true };
function ownEdit(r, key, delta) {
  const out = Object.assign({}, r);
  if (key === 'rimmid') {
    const two = r.mixRim + r.mixMid;
    if (two > 0) {
      const a = r.mixRim * Math.exp(delta / 2), b = r.mixMid * Math.exp(-delta / 2);
      out.mixRim = two * a / (a + b); out.mixMid = two * b / (a + b);
    }
  } else if (key === 'trx') out.tr = clamp(r.tr * delta, 0.01, 0.9);
  return out;
}
/* a side's identity on its rates, edit by edit in its order (style, then the four factors) */
function applyIdentity(side, edits, L) {
  let off = side.off, def = side.def;
  (edits || []).forEach(e => {
    if (OWN_EDITS[e.key]) { if (e.end === 'def') def = ownEdit(def, e.key, e.delta); else off = ownEdit(off, e.key, e.delta); return; }
    const P = SIM().applyEdits({ off, def, n: 0 }, [e], L);
    off = P.off; def = P.def;
  });
  return { off, def };
}
function identityOf(team, row, X) {
  if (!row || !(+row.gp > 0)) return null;
  const S = SIM(), G = X.G || 40, zones = !!X.L.zones, mu = X.L.rates;
  const h = prepareSides(Object.assign({}, team, { identity: null }), X, G);
  const segs = team.segs, tot = segs.reduce((a, x) => a + (x.t1 - x.t0), 0);
  const sides = segs.map(x => ({ side: h.sideFor(x), w: (x.t1 - x.t0) / tot }));
  const w = +row.gp / (+row.gp + IDENTITY_K);
  const evGp = +row.ev_gp || 0, evdGp = +row.evd_gp || 0, wEvd = evdGp / (evdGp + IDENTITY_K);
  const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
  const avg = f => sides.reduce((a, x) => a + x.w * f(x.side), 0);
  const edits = [];
  /* ---- its style ---- */
  const mixOf = r => { const t = r.mixRim + r.mixMid + r.mix3; return { rim: r.mixRim / t, mid: r.mixMid / t, three: r.mix3 / t }; };
  const style = (end, p3, rim, mid, tr, wt) => {
    if (!(wt > 0)) return;
    const m = { rim: avg(x => mixOf(x[end]).rim), mid: avg(x => mixOf(x[end]).mid), three: avg(x => mixOf(x[end]).three) };
    if (isNum(p3)) { const d = clamp(wt * (p3 - 100 * m.three), -15, 15); if (Math.abs(d) > 0.2) edits.push({ end, key: 'p3r', delta: d }); }
    if (zones && isNum(rim) && isNum(mid) && rim > 0 && mid > 0 && m.rim > 0 && m.mid > 0) {
      const d = clamp(wt * (Math.log(rim / mid) - Math.log(m.rim / m.mid)), -1.2, 1.2);
      if (Math.abs(d) > 0.02) edits.push({ end, key: 'rimmid', delta: d });
    }
    /* how often it runs, against its league's clubs (the play-by-play's transition frequency), on the build's own
       running against the league's (its transition rate against the league's) */
    const lgTr = X.L.style ? (end === 'off' ? X.L.style.trFreq : X.L.style.dTrFreq) : null;
    if (isNum(tr) && tr > 0 && isNum(lgTr) && lgTr > 0) {
      const natRel = avg(x => x[end].tr) / Math.max(0.01, mu.tr), f = clamp(Math.pow((tr / lgTr) / Math.max(0.2, natRel), wt), 0.5, 2);
      if (Math.abs(f - 1) > 0.02) edits.push({ end, key: 'trx', delta: f });
    }
  };
  style('off', num(row.p3_share), num(row.rim_share), num(row.mid_share), evGp >= 5 ? num(row.ev_transition_freq) : null, w);
  if (evdGp >= 5) style('def', num(row.evd_all_p3_sh), num(row.evd_all_rim_sh), num(row.evd_all_mid_sh), num(row.evd_transition_freq), wEvd);
  /* its pace against its league's clubs': both ends' seconds a possession toward the league's own seconds a possession
     times the league's pace over its pace (a faster club, shorter possessions) */
  const pace = num(row.pace), lgPace = X.L.style ? X.L.style.pace : null;
  if (isNum(pace) && pace > 30 && isNum(lgPace) && lgPace > 30) {
    const target = mu.d * lgPace / pace, nat = avg(x => (x.off.d + x.def.d) / 2);
    const d = clamp(w * (target - nat), -4, 4);
    if (Math.abs(d) > 0.05) { edits.push({ end: 'off', key: 'secs', delta: d }); edits.push({ end: 'def', key: 'secs', delta: d }); }
  }
  /* ---- its four factors, against the build with its style on ---- */
  const nat = { off: { efg: 0, tovp: 0, orebp: 0, ftr: 0 }, def: { efg: 0, tovp: 0, orebp: 0, ftr: 0 } };
  sides.forEach(x => {
    const st = applyIdentity(x.side, edits, X.L);
    ['off', 'def'].forEach(end => { const n = S.natural(st[end], zones); Object.keys(nat[end]).forEach(k => { nat[end][k] += x.w * (isNum(n[k]) ? n[k] : 0); }); });
  });
  const real = { off: { efg: row.ff_efg, tovp: row.ff_tov, orebp: row.ff_oreb, ftr: row.ff_ftr }, def: { efg: row.dff_efg, tovp: row.dff_tov, orebp: row.dff_oreb, ftr: row.dff_ftr } };
  ['off', 'def'].forEach(end => ['efg', 'tovp', 'orebp', 'ftr'].forEach(k => {
    const v = +real[end][k];
    if (!isNum(v)) return;
    const d = clamp(w * (v - nat[end][k]), -12, 12);
    if (Math.abs(d) > 0.05) edits.push({ end, key: k, delta: d });
  }));
  return edits.length ? edits : null;
}

/* ------------------------------------------------------------------ a five --- */
/* five: [{card, k}]; X: {mu (league rates), ref (this league's reference), tac, mins: Map id -> his minutes this game,
   form: Map id -> z, G: minutes in a game, dTr: the league's transition make bonus, ins: Map id -> {u, k: Set} - his
   instructions (core/instruct.js)} */

/* WHAT EACH PLAYER INSTRUCTION ASKS OF HIM (Louie, 2026-10-14; core/instruct.js has the words and the fit). FM's way:
   it moves what he TRIES, and his own numbers decide how that goes. tilt: his share of the plays, on the usage dial's
   scale; un: his share of his own (unassisted) makes at each zone, multiplied - more of the ball, more of his own; ast:
   his passing, multiplied; astQ: more passing the better a passer he is (his AST% against his position's); tov: loose
   handles, for a man who does not create (times 1 - creator). Where each acts on the shot mix, the transition, the glass
   and the defence is in sideOf below. */
const INS = {
  pas: { tilt: -0.6, un: { rim: 0.7, mid: 0.7, three: 0.85 }, ast: 1.25 },
  agg: { tilt: 0.6, un: { rim: 1.25, mid: 1.25, three: 1.25 }, ast: 0.8, tov: 0.06 },
  hm: { tilt: 0.5, un: { rim: 1.15, mid: 1.15, three: 1.15 }, ast: 1.1, tov: 0.05 },
  hl: { tilt: -0.5, un: { rim: 0.85, mid: 0.85, three: 0.85 }, ast: 0.85 },
  spot: { tilt: -1.0, un: { rim: 0.3, mid: 0.3, three: 0.3 }, ast: 0.6 },
  fin: { tilt: -1.2, un: { rim: 0.25, mid: 0.25, three: 0.25 }, ast: 0.5 },
  push: { tilt: 0.15 },
  arc: { un: { three: 1.6 } },
  dh: { un: { rim: 1.3, mid: 1.3 } },
  kick: { tilt: -0.2, astQ: 0.3 },
  dump: { astQ: 0.2 },
  cut: { un: { rim: 0.7 } },
  space: { un: { three: 0.7 } },
  green: { un: { three: 1.15 } },
  roll: { un: { rim: 0.75 } },
  pop: { un: { three: 0.6 } },
  short: { astQ: 0.4 },
  dive: { un: { rim: 0.85 }, ast: 0.8 },
  pm: { tilt: 0.35, un: { rim: 1.25, mid: 1.25 }, astQ: 0.15 },
  pl: { tilt: -0.2, un: { rim: 0.85, mid: 0.85 } },
  nop: { tilt: -0.35, un: { rim: 0.7, mid: 0.7 } }
};
/* how far an instruction moves HIS OWN shot mix (a share of his shots), and from where */
const INS_MIX = {
  arc: [['three', 0.12, [['mid', 0.6], ['rim', 0.4]]]],
  dh: [['rim', 0.08, [['three', 0.7], ['mid', 0.3]]], ['mid', 0.03, [['three', 1]]]],
  green: [['three', 0.12, [['mid', 0.6], ['rim', 0.4]]]],
  cut: [['rim', 0.08, [['three', 0.6], ['mid', 0.4]]]],
  space: [['three', 0.08, [['rim', 0.5], ['mid', 0.5]]]],
  roll: [['rim', 0.08, [['mid', 0.6], ['three', 0.4]]]],
  dive: [['rim', 0.05, [['mid', 0.6], ['three', 0.4]]]],
  short: [['rim', 0.03, [['three', 1]]], ['mid', 0.02, [['three', 1]]]],
  pop: [['three', 0.10, [['rim', 0.5], ['mid', 0.5]]]],
  pm: [['rim', 0.05, [['three', 1]]], ['mid', 0.04, [['three', 1]]]],
  pl: [['three', 0.03, [['mid', 0.7], ['rim', 0.3]]]],
  nop: [['three', 0.05, [['mid', 0.6], ['rim', 0.4]]]],
  kick: [['three', 0.02, [['rim', 0.5], ['mid', 0.5]]]]
};
/* the ball handlers' slider at full: a share of the handler's own shots */
const HANDLER = { down: 0.16, deep: 0.18 };
/* a shot he does not usually make his own way costs more than his usual one: a pull-up three for a catch-and-shoot man,
   a drive or a post-up for a man who scores off passes - on the make logit, for the whole of the extra share, falling
   to nothing for a man who already takes them his way (un: his unassisted share there, at UN_FULL and above) */
const DIFF = { pull: 0.25, drive: 0.20, post: 0.20 };
const UN_FULL = { three: 0.40, rim: 0.50, mid: 0.70 };

/* ------------------------------------------------------------------ the roles --- */
/* PLAYER ROLES (core/roles.js; Louie, 2026-10-14): each man plays a role at his position - a play-type diet, an on-ball
   load, a scoring load, his passing, his screens - and the five's roles meet. Where a five has no roles (a real club),
   none of this is read: its men play their own games, as before. */
const ROLESm = () => (root.Mgr && root.Mgr.roles) || (typeof require === 'function' ? require('./roles.js') : null);
const INSTRUCTm = () => (root.Mgr && root.Mgr.instruct) || (typeof require === 'function' ? require('./instruct.js') : null);
/* THE ROLES' NUMBERS. On the usage dial and the make and turnover logits, as the rest of the engine; the reasoning for
   each, and where it was checked, is in docs/manager-mode.md (Roles). */
const ROLEK = {
  /* A ROLE'S SCORING LOAD (-1..1): a share of the plays to take, his position's usual times 1 + useStep x the load (an
     isolation scorer's 0.9: about 40% more than the position's usual; a 3-and-D man's -0.6: about a quarter fewer) */
  /* (use: how far toward it - a man changes his game only so far: a role player told to carry the scoring does not
     become a 26% usage man) */
  use: 0.6, useStep: 0.45,
  /* ON-BALL TIME (time of possession, not usage: a pass-first point guard has the ball as long as a scoring one and ends
     far fewer plays, a movement shooter ends many and has it for seconds): a position's usual share of a five's on-ball
     time (a man's own: this, by his passing and his usage); a role's share above his own hands him more of the plays
     (initTilt, on the usage dial), more of the assists (initAst, the power of the ratio) */
  TYP_INIT: [0.30, 0.22, 0.17, 0.16, 0.15], initTilt: 0.8, initAst: 0.5,
  /* ONE BALL: a five's roles may ask for this much on-ball time between them (the real clubs' fives: 0.82 to 1.22, the
     middle 0.98); more and each gets his share of what there is, fewer and somebody has to run it anyway */
  ballMax: 1.2, ballMin: 0.72,
  lostMake: 0.55,           // a ball-dominant man's make logit for each unit of on-ball time he wanted and did not get (times how on-ball his plays are)
  stagTov: 0.25, stagMake: 0.08,   // the five's turnover and make logit for each unit of on-ball time asked for past ballMax
  forceTilt: 1.5, forceTov: 0.35, forceGap: 0.5,   // nobody to run it: the man who has to, his usage and his turnovers; the five's creation gap
  pass: 0.4, passTov: 0.12,  // a role's passing (-1..1) against his own, on his assists (times his passing); a poor passer's turnovers for it
  tovOn: 0.35, tovDiet: 0.5,   // on-ball plays beyond his own game's cost turnovers; a diet's own turnover rate (its log) against his own role's
  /* DOWNHILL PRESSURE (Louie: "a certain amount of downhill pressure is needed in order to generate good 3pt looks"): the
     five's drives, rolls, post-ups and cuts, each at its man's finishing - a ball handler's on his time on the ball
     (pOn), everybody's on the plays he ends; around pRef nothing, short of it the catch-and-shoot threes are contested,
     past it they are open (press3 on the make logit a unit, his assisted share of his threes) */
  pRef: 0.93, press3: 0.1, pOn: 0.5,
  /* ...and well short of it (pLow under pRef: a five with no paint touches) every possession suffers - the threes
     contested, the twos too (half), the clock run down into turnovers: a half-court possession with no paint touch and
     no ball reversal scores about 0.7 a play, with one 1.06 */
  pLow: 0.2, pressLow: 0.35, pressTov: 0.3,
  /* SCREENS: a pick-and-roll and an off-screen shooter need somebody setting them (each role's screens at his size) */
  sRef: 1.20, screenMake: 0.12,
  /* THE PICK-AND-ROLL'S PARTNERS: a roller, a popper, a short roller need a handler running it (lRef of the five's on-ball
     time spent in it); without one their touches dry up */
  lRef: 0.19, partnerTilt: 0.6, partnerMake: 0.08,
  postSpace: 0.12, hubMake: 0.025, hRef: 0.33,   // the post needs space, the extra pass a better look
  /* the cut needs a passer: the five's passing decides how many cuts are found (a cutter's touches), not how well they
     finish (team assist rate goes with cut frequency, r .5, and not with cut efficiency, r 0) */
  cutVol: 0.8,
  def3: 0.012,               // a 3-and-D man's contests: the opponents' three make logit
  /* A ROLE NOBODY CHOSE (the position's default: the role his own game is closest to, or the general one) is his own
     game: nothing of him moves (dflt of the role's strength), and only what the five's roles do together counts */
  dflt: 0
  /* pRef, sRef, lRef and hRef are what the default roles of the real clubs' own rotations add up to (four leagues,
     2026-10-15: docs/manager-mode.md, Roles), so a club left alone neither gains nor loses by them */
};
/* a five with roles asks this of the ball and the paint (for the screens: tactics.js, match.js) */

/* THE BALL HANDLERS of a five (the team slider's men): its main creator - the most of the plays, weighed by how much of
   his own he makes, and his passing - in full, and a second where there is a second creator near him */
function handlerWeights(P) {
  const sc = P.map(p => p.s * (0.5 + p.c.creator) + 0.002 * p.c.off.ast);
  const order = sc.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const w = P.map(() => 0);
  if (order.length) w[order[0][1]] = 1;
  if (order.length > 1 && order[1][0] > 0) w[order[1][1]] = order[1][0] >= 0.6 * order[0][0] ? 0.6 : 0.3;
  return w;
}

function sideOf(five, X) {
  const mu = X.mu, ref = X.ref, tac = normTac(X.tac), G = X.G || 40;
  const INSm = X.ins instanceof Map ? X.ins : null;
  const C = CARDS();
  const posAvg = (c, st, d) => { const v = C && C.atPos ? C.atPos(ref, c.pos, st) : null; return isNum(v) && v > 0 ? v : d; };
  let ms = mu.mixRim + mu.mixMid + mu.mix3;
  const mixMu = { rim: mu.mixRim / ms, mid: mu.mixMid / ms, three: mu.mix3 / ms };
  const lg = { tov: logit(mu.tov), rim: logit(mu.pRim), mid: logit(mu.pMid), three: logit(mu.p3), p2: logit(mu.p2), ft: logit(mu.ft) };
  const isGuard = k => k <= 1, isWing = k => k === 2, isBig = k => k >= 3;
  const P = five.map(({ card: c, k, role }) => {
    const e = oopGap(k, c.pos);
    const mins = X.mins && X.mins.has(c.id) ? X.mins.get(c.id) : c.mpg;
    const z = X.form && X.form.has(c.id) ? clamp(+X.form.get(c.id) || 0, -2, 2) : 0;
    const dLoad = fatigueLoad(mins, c.usg, G) - fatigueLoad(c.mpg, c.usg, G);
    const work = clamp((1 - FATIGUE.rate * dLoad) * (1 + FORM.rate * z), 0.6, 1.4);
    const threeApt = clamp(c.mixRel.three * c.p3Rel * c.p3Rel, 0.05, 3), rimApt = clamp(c.mixRel.rim * (1 + 2 * (c.rimRel - 1)), 0.1, 3);
    /* his instructions, and the few things they lean on: his passing, quick hands, shot blocking and glass against his position's */
    const I = INSm ? INSm.get(String(c.id)) : null, has = key => !!(I && I.k && I.k.has(key));
    const passQ = clamp(c.off.ast / posAvg(c, 'ast_pct', 14), 0.2, 3), stlQ = clamp(c.def.stl / posAvg(c, 'stl_pct', 1.6), 0.2, 3);
    const blkQ = clamp(c.def.blk / posAvg(c, 'blk_pct', 1.5), 0.1, 4), orbQ = clamp(c.off.orb / posAvg(c, 'oreb_pct', 6), 0.1, 4);
    return { c, k, e, z, mins, dLoad, work, threeApt, rimApt, u: clamp(c.usg + FORM.usg * z, 5, 45), I, has, passQ, stlQ, blkQ, orbQ, roleKey: role };
  });
  /* ---- THE ROLES: each man's at his position (the one chosen, else the position's default: roles.resolve); a five
     without them (a real club: no role given, undefined) plays its men's own games ---- */
  const RL = ROLESm(), INSD = INSTRUCTm();
  P.forEach(p => {
    p.R = RL && p.roleKey !== undefined ? RL.resolve(p.roleKey, p.k, p.c, ref) : null;
    p.RP = p.R ? RL.profile(p.R) : null;
    /* a role chosen is played in full; a position's default (nobody chose it) at ROLEK.dflt of its strength */
    p.chosen = !!(p.R && p.roleKey && p.R.key === p.roleKey);
    p.st = p.R ? (p.chosen ? 1 : ROLEK.dflt) : 0;
    p.rho = p.R ? p.R.rho * p.st : 0;
    /* HIS OWN GAME, which a role moves him from: the on-ball time his passing and his usage suggest (the position's usual
       for a man average at both), how much he looks to pass, how much he crashes and runs, the turnover rate of the
       plays he usually makes (an on-ball man's more than a finisher's) */
    p.posU = posAvg(p.c, 'usg', 19);
    p.natInit = clamp(ROLEK.TYP_INIT[p.k] * clamp(p.passQ, 0.3, 3) * Math.pow(clamp(p.u / p.posU, 0.4, 2.5), 0.4), 0.01, 0.9);
    p.natPass = clamp(0.8 * (p.passQ - 1), -0.8, 0.8);
    if (!p.R) return;
    /* the role his own game is closest to (the one that suits him best): his numbers already play it, so a role moves
       his shots, his on-ball plays and his place on the floor by what it asks beyond that one (a general role, nothing) */
    p.nat = p.R.gen ? null : RL.bestFor(p.k, p.c, ref);
    p.NP = p.nat ? RL.profile(p.nat) : null;
    /* WHAT THE ROLE ASKS BEYOND HIS OWN: each load against his natural role's (so the role that suits him best, chosen or
       left as the default, is his own game exactly), as far as the role is played (st) */
    const L0 = p.nat || p.R, dl = k => p.st * ((p.R[k] || 0) - (L0[k] || 0));
    p.ld = p.R.gen ? { use: 0, init: 0, pass: 0, crash: 0, run: 0, def: 0 } : { use: dl('use'), init: dl('init'), pass: dl('pass'), crash: dl('crash'), run: dl('run'), def: dl('def') };
    /* an instruction his role rules out (roles.locks), or one that is not his role's kind (a guard's at the four), is not
       his to follow there - but his coverage on a ball screen goes wherever he plays (a big in a wing's role at the four
       still guards his screener): it is about the man he guards, and how much that man screens decides what it does
       (coverage), as his own game's coverage does */
    const lock = RL.locks(p.R), fam = p.R.family, I = p.I;
    p.has = key => { if (!(I && I.k && I.k.has(key)) || lock.has(key)) return false; const d = INSD && INSD.BY ? INSD.BY.get(key) : null; return !d || d.x === 'cover' || d.roles.includes(fam); };
  });
  const roled = P.some(p => p.R);
  const ON = key => P.some(p => p.has(key));
  /* how much a man sets the screens: his role's, else a big's */
  const screenerW = p => (p.R ? p.R.screen : isBig(p.k) ? 1 : 0);
  /* ONE BALL (Louie: "flagging when you've designated too many high usage players and ball handlers [and also make sure
     that takes effect in the engine - that there's only one ball]"): each role's call on the five's on-ball time (init)
     is met in full while they add up to ballMax at most; past it each gets his share of what there is (the rest is
     on-ball time he wanted and did not get: `lost`), and short of ballMin the man who makes the most of his own has to
     run it anyway (`forced`) */
  let I5 = 0, ballK = 1, deficit = 0;
  if (roled) {
    /* his on-ball time: his own, moved by what the role asks beyond his natural role (a general role leaves it his own) */
    P.forEach(p => { p.init = p.R ? clamp(p.natInit + p.ld.init, 0.01, 0.95) : p.natInit; });
    I5 = P.reduce((a, p) => a + p.init, 0);
    ballK = I5 > ROLEK.ballMax ? ROLEK.ballMax / I5 : 1;
    deficit = Math.max(0, ROLEK.ballMin - I5);
    P.forEach(p => { p.onb = p.init * ballK; p.lost = p.init - p.onb; p.forced = 0; });
    if (deficit > 0) {
      const q = P.slice().sort((a, b) => (b.c.creator - 0.1 * clamp(b.c.off.dTov, -1, 1)) - (a.c.creator - 0.1 * clamp(a.c.off.dTov, -1, 1)))[0];
      q.onb += deficit; q.forced = deficit;
    }
  }
  /* THE PICK-AND-ROLL: the five's on-ball time spent running it (each handler's on-ball time, the share of his plays it
     is) - what a roller, a popper and a short roller live on */
  const Lpnr = roled ? P.reduce((a, p) => a + (p.R ? p.onb * (p.R.diet.pnr || 0) : 0), 0) : 0;
  const partner = clamp(Lpnr / ROLEK.lRef, 0.3, 1.3);
  const partnerShare = p => (p.R ? (p.R.diet.roll || 0) + (p.R.diet.pop || 0) + (p.R.diet.short || 0) : 0);
  /* HIS PASSING IN HIS ROLE: as far as the role asks him to look for others more (or less) than he does, at his own
     passing; and his assists move with his time on the ball against his own (true usage: a pass-first point guard runs
     the plays and ends few of them). The five's passing with it, before anybody's instructions (the cutters' touches) */
  P.forEach(p => {
    p.dp = p.R ? p.ld.pass : 0;
    p.passK = p.R ? clamp(1 + ROLEK.pass * p.dp * clamp(p.passQ, 0.3, 2), 0.4, 2.5) * Math.pow((p.onb + 0.08) / (p.natInit + 0.08), ROLEK.initAst) : 1;
  });
  const A50 = clamp(P.reduce((a, p) => a + p.c.off.ast * p.passK * p.work, 0) / Math.max(1, ref.five.ast_pct), 0.3, 2.5);

  /* ---- WHO TAKES THE PLAYS: the tilts, then the five's plays made to add up (squad.js usageSim) ---- */
  P.forEach(p => {
    let t = tac.guards * (isGuard(p.k) ? 1 : 0) + tac.wings * (isWing(p.k) ? 1 : 0) + tac.bigs * (isBig(p.k) ? 1 : 0);
    /* HIT THE SCREENER (Louie: "'hit the big inside' instead mean 'hit the screener' ... could be a pick and pop big"):
       the plays go to the men who set the screens - each role's screens, else the bigs - and end the way his screens
       do (the shot mix, below) */
    if (tac.feed < 0) t += -tac.feed * screenerW(p);
    if (tac.feed > 0) t += tac.feed * clamp(p.threeApt - 0.6, 0, 1.5);
    if (tac.usage[p.c.id]) t += tac.usage[p.c.id];
    /* his own instructions: his touches (two steps either way, Louie: "up to 2 either way (to prioritise/lessen the
       touches of a player)") and what each asks of the ball */
    if (p.I) {
      t += 0.5 * clamp(+p.I.u || 0, -2, 2);
      p.I.k.forEach(key => { const d = INS[key]; if (d && d.tilt && p.has(key)) t += d.tilt; });
    }
    p.d = Math.max(0, p.u - USG_FLOOR) * (1 + p.c.creator) + 2;
    /* HIS ROLE: the scoring it asks beyond his natural role's (his position's usual usage times useStep a unit of the
       load: an isolation scorer's role for a 3-and-D man, about two thirds more; the part of it that is on the ball
       shrinks with the on-ball time he does not get); his on-ball time against his own; the ball forced on him when
       nobody else runs it */
    if (p.R) {
      const lostShare = p.init > 0 ? p.lost / p.init : 0;
      if (p.ld.use) t += ROLEK.use * ROLEK.useStep * p.posU * p.ld.use / (0.6 * p.d + 3) * (1 - p.RP.on * lostShare);
      t += ROLEK.initTilt * (p.onb - p.natInit) + ROLEK.forceTilt * p.forced;
      /* a screener's touches come with the pick-and-roll run with him: fewer without a handler, more with a busy one */
      t += ROLEK.partnerTilt * (partner - 1) * partnerShare(p);
      /* a cutter's come with the passers who find him (beyond what his own game's cuts were) */
      const cutMore = (p.R.diet.cut || 0) - (p.nat ? p.nat.diet.cut || 0 : p.R.diet.cut || 0);
      if (cutMore > 0) t += ROLEK.cutVol * p.st * cutMore * (A50 - 1);
    }
    p.tilt = t;
    /* a tilt hands him 60% of his discretionary usage more at full, and three points besides (a role player near the
       floor still takes on more when told to) */
    p.u1 = Math.max(3, p.u + 0.6 * t * p.d + 3 * t);
  });
  const Dsum = P.reduce((a, p) => a + p.d, 0), U1 = P.reduce((a, p) => a + p.u1, 0), lam = Dsum > 0 ? (U1 - 100) / Dsum : 0;
  P.forEach(p => { p.u2 = clamp(p.u1 - lam * p.d, 3, 55); });
  { const got = P.reduce((a, p) => a + p.u2, 0); P.forEach(p => { p.u2 *= 100 / got; p.s = p.u2 / 100; }); }
  P.forEach(p => {
    const du = p.u2 - p.u;
    /* the skill curve: more plays than he is used to cost him (the more so the less he creates); fewer give a little back */
    p.skill = du > 0 ? -SKILL_L * du * (1 + 0.8 * (1 - p.c.creator)) : -SKILL_L * du * 0.6;
    p.tovSkill = du > 0 ? 0.01 * du * (1 - p.c.creator) : 0;
    /* HIS OWN SHOTS AND HIS PASSING under his instructions: the unassisted share at each zone, the assist rate */
    p.un = { rim: p.c.un.rim, mid: p.c.un.mid, three: p.c.un.three };
    let astM = 1, tovI = 0;
    /* HIS ROLE'S PLAYS: as many of his shots his own as its diet's (as far as the role goes, rho); its passing, and his
       share of the assists with his on-ball time (true usage: a pass-first point guard runs the plays and ends few of
       them); the turnovers of on-ball plays his habits do not cover, and of the diet's own kinds of play */
    if (p.R) {
      const RP = p.RP, NP = p.NP || RP, rho = p.rho;
      ZONES.forEach(zn => { p.un[zn] = clamp(p.un[zn] + rho * (RP.un[zn] - NP.un[zn]), 0.01, 0.97); });
      /* his passing (above); a poor passer asked to make the passes turns some of them over */
      astM *= p.passK;
      tovI += ROLEK.passTov * p.st * Math.max(0, p.dp) * clamp(1.2 - p.passQ, 0, 0.9);
      /* on-ball plays beyond his own game's are turnovers his habits do not cover (the more so with loose handles); the
         kinds of play his role adds turn it over at their own rates */
      tovI += ROLEK.tovOn * rho * (RP.on - NP.on) * (1 + 0.5 * clamp(p.c.off.dTov, -1, 1)) + ROLEK.tovDiet * rho * Math.log(RP.tov / NP.tov);
      if (p.forced) tovI += ROLEK.forceTov * p.forced * (1.2 - clamp(p.c.creator, 0, 1));
    }
    if (p.I) p.I.k.forEach(key => {
      const d = INS[key]; if (!d || !p.has(key)) return;
      if (d.un) ZONES.forEach(zn => { if (d.un[zn]) p.un[zn] = clamp(p.un[zn] * d.un[zn], 0.01, 0.97); });
      if (d.ast) astM *= d.ast;
      if (d.astQ) astM *= 1 + d.astQ * clamp(p.passQ - 0.6, 0, 1.4);
      if (d.tov) tovI += d.tov * 2 * (1 - p.c.creator);
    });
    /* the short roll's decisions in traffic: a big who cannot pass turns it over */
    if (p.has('short')) tovI += 0.08 * clamp(1.2 - p.passQ, 0, 1);
    p.astM = astM; p.tovI = tovI;
  });
  /* the ball handlers, for the team's slider */
  const hw = handlerWeights(P);
  P.forEach((p, i) => { p.hw = hw[i]; p.down = Math.max(0, -tac.handlers) * hw[i]; p.deep = Math.max(0, tac.handlers) * hw[i]; });

  /* ---- THE FIVE TOGETHER (first, the tactics lean on it): its passing, with each man's instructions ---- */
  const A5 = clamp(P.reduce((a, p) => a + p.c.off.ast * p.astM * p.work, 0) / Math.max(1, ref.five.ast_pct), 0.3, 2.5);

  /* ---- WHERE THEY SHOOT FROM: his mix in this league, moved by the tactics and his instructions, and what the move costs ----
     A team tactic moves the FIVE's shot mix by a few points of its shots (SHIFT, at full), and each man's part of the move
     by his aptitude for it - and every man takes part (a coach's instruction is for the five). The ball handlers' slider
     and a player's own instructions move HIS mix only. The new shots come out of the mid-range first (the shot every plan
     gives up first), then the other zone. */
  P.forEach(p => {
    const c = p.c;
    let m0 = { rim: mixMu.rim * c.mixRel.rim, mid: mixMu.mid * c.mixRel.mid, three: mixMu.three * c.mixRel.three };
    ms = m0.rim + m0.mid + m0.three; m0 = { rim: m0.rim / ms, mid: m0.mid / ms, three: m0.three / ms };
    p.m0 = m0; p.m = Object.assign({}, m0);
    p.catchApt = (1 - p.un.three) * p.threeApt; p.cutApt = (1 - p.un.rim) * p.rimApt;
    p.extra = { pull: 0, drive: 0, post: 0 };
  });
  const moveAdd = (m, z, add, from) => {
    const out = Object.assign({}, m);
    let left = add;
    from.forEach(([zz, share]) => { const take = Math.min(out[zz] * 0.9, add * share, left); out[zz] -= take; left -= take; });
    from.forEach(([zz]) => { if (left > 1e-9) { const take = Math.min(out[zz] * 0.9, left); out[zz] -= take; left -= take; } });
    out[z] += add - left;
    return out;
  };
  const shiftZone = (z, total, aptOf, from) => {
    if (!(total > 0)) return;
    const ws = P.map(p => Math.max(0, aptOf(p)) * Math.max(0, 1 - p.m[z])), W = ws.reduce((a, v) => a + v, 0);
    if (!(W > 0)) return;
    P.forEach((p, i) => { p.m = moveAdd(p.m, z, Math.min(0.6, total * P.length * ws[i] / W), from); });
  };
  const aptOf = k => p => 0.4 + 0.6 * clamp(p[k], 0, 2);
  /* HIS ROLE'S SHOTS: his mix moved by what the role's diet asks beyond his own game's (the role that suits him best),
     as far as the role goes (rho); the shots it adds that he does not usually make his own way are the pull-ups, drives
     and post-ups they are, priced below (DIFF) at his own habits - a shooting role for a man who does not shoot pays at
     his own rates */
  P.forEach(p => {
    if (!p.R || !p.nat) return;
    const T = p.RP.mix, N = p.NP.mix, rho = p.rho, m0 = p.m0;
    let m = { rim: Math.max(0.01, m0.rim + rho * (T.rim - N.rim)), mid: Math.max(0.01, m0.mid + rho * (T.mid - N.mid)), three: Math.max(0.005, m0.three + rho * (T.three - N.three)) };
    { const t = m.rim + m.mid + m.three; m = { rim: m.rim / t, mid: m.mid / t, three: m.three / t }; }
    p.extra.pull += Math.max(0, m.three - m0.three) * p.RP.un.three;
    p.extra.drive += Math.max(0, m.rim - m0.rim) * p.RP.un.rim;
    const post = Math.max(0, (p.R.diet.post || 0) - (p.nat.diet.post || 0)) * rho / 0.5;
    if (post > 0) p.extra.post += post * (m.rim + m.mid);
    p.m = m;
  });
  /* his own: the ball handlers' slider, then his instructions */
  P.forEach(p => {
    if (p.deep > 0) { const before = p.m.three; p.m = moveAdd(p.m, 'three', HANDLER.deep * p.deep, [['mid', 0.7], ['rim', 0.3]]); p.extra.pull += p.m.three - before; }
    if (p.down > 0) { const before = p.m.rim; p.m = moveAdd(p.m, 'rim', HANDLER.down * p.down, [['mid', 0.7], ['three', 0.3]]); p.extra.drive += p.m.rim - before; }
    if (!p.I) return;
    p.I.k.forEach(key => p.has(key) && (INS_MIX[key] || []).forEach(([z, add, from]) => {
      const before = p.m[z];
      p.m = moveAdd(p.m, z, add, from);
      if (key === 'arc') p.extra.pull += p.m[z] - before;
      if (key === 'dh') p.extra.drive += p.m[z] - before;
      if (key === 'pm') p.extra.post += p.m[z] - before;
    }));
    /* rip through: threes turned down for the rim or the mid-range, whichever he scores better at */
    if (p.has('rip')) {
      const take = Math.min(p.m.three * 0.9, 0.10), midApt = Math.exp(clamp(p.c.off.dMid || 0, -1, 1)) * clamp(p.c.mixRel.mid, 0.2, 3), toRim = p.rimApt / (p.rimApt + midApt);
      p.m = { rim: p.m.rim + take * toRim, mid: p.m.mid + take * (1 - toRim), three: p.m.three - take };
      p.extra.drive += take * toRim;
    }
    /* spot-ups and cuts only, a finisher only: the mid-range (the shot of his own) goes to catch-and-shoot threes and cuts */
    if (p.has('spot')) { const take = p.m.mid * 0.5, r3 = clamp(p.catchApt / (p.catchApt + p.cutApt + 1e-6), 0.2, 0.8); p.m = { rim: p.m.rim + take * (1 - r3), mid: p.m.mid - take, three: p.m.three + take * r3 }; }
    if (p.has('fin')) { const tm = p.m.mid * 0.7, t3 = p.m.three * 0.6; p.m = { rim: p.m.rim + tm + t3, mid: p.m.mid - tm, three: p.m.three - t3 }; }
    /* a pick-and-pop big who can put it on the floor attacks the close-out */
    if (p.has('pop') && p.rimApt > 1) p.m = moveAdd(p.m, 'rim', 0.02, [['mid', 1]]);
  });
  /* the five's: the team's tactics */
  /* cutting needs somebody to find the cutter: the five's passing scales how many of the cuts become shots */
  if (tac.motion < 0) shiftZone('rim', SHIFT.cut * -tac.motion * clamp(A5, 0.3, 1.5), p => 0.3 + 0.7 * clamp(p.cutApt, 0, 2), [['three', 0.5], ['mid', 0.5]]);
  if (tac.motion > 0) shiftZone('three', SHIFT.space * tac.motion, aptOf('catchApt'), [['mid', 0.8], ['rim', 0.2]]);
  /* hit the screener: each screener's shots go the way his screens end - a roller's to the rim, a popper's to the arc, a
     short roller's into the floater and the mid-range; a five without roles (a real club), its bigs inside, as ever */
  if (tac.feed < 0 && !roled) shiftZone('rim', SHIFT.feed * -tac.feed, p => (isBig(p.k) ? 1 : 0.1), [['three', 0.6], ['mid', 0.4]]);
  if (tac.feed < 0 && roled) P.forEach(p => {
    const w = screenerW(p);
    if (!(w > 0) || !p.R) return;
    const d = p.R.diet, roll = (d.roll || 0) + (d.cut || 0) * 0.5, pop = d.pop || 0, sh = d.short || 0, tot = roll + pop + sh;
    if (!(tot > 0)) return;
    const add = 0.08 * -tac.feed * w;
    if (roll) p.m = moveAdd(p.m, 'rim', add * roll / tot, [['mid', 0.5], ['three', 0.5]]);
    if (pop) p.m = moveAdd(p.m, 'three', add * pop / tot, [['mid', 0.6], ['rim', 0.4]]);
    if (sh) p.m = moveAdd(p.m, 'mid', add * sh / tot, [['three', 1]]);
  });
  if (tac.feed > 0) shiftZone('three', SHIFT.feed * tac.feed, p => clamp(p.threeApt - 0.6, 0, 1.5) + 0.05, [['mid', 0.7], ['rim', 0.3]]);
  /* kick-outs and dump-offs: the passer's looks go to the men he finds - the shooters' catch-and-shoot threes, the bigs'
     shots at the rim - as many as his passing finds (his share of the plays, his passing) */
  const kick = P.reduce((a, p) => a + (p.has('kick') ? p.s * clamp(p.passQ, 0.4, 2) : 0), 0);
  const dump = P.reduce((a, p) => a + (p.has('dump') ? p.s * clamp(p.passQ, 0.4, 2) : 0), 0);
  if (kick > 0) shiftZone('three', 0.05 * kick, p => (p.has('kick') ? 0 : clamp(p.catchApt, 0, 2)), [['mid', 0.6], ['rim', 0.4]]);
  if (dump > 0) shiftZone('rim', 0.05 * dump, p => (p.has('dump') ? 0 : isBig(p.k) ? 0.4 + clamp(p.cutApt, 0, 2) : 0.05), [['mid', 0.6], ['three', 0.4]]);
  P.forEach(p => {
    const c = p.c, m0 = p.m0, m = p.m;
    p.vol = {};
    ZONES.forEach(zn => {
      const r = m0[zn] > 1e-6 ? m[zn] / m0[zn] : 1;
      /* the volume cost reads his HABIT (his own unassisted share), never what the instruction asks of him */
      p.vol[zn] = r > 1 ? -KAPPA[zn] * Math.log(r) * (1 - 0.6 * c.un[zn]) : KAPPA[zn] * 0.5 * Math.log(1 / Math.max(r, 1e-6));
    });
    /* the shots he does not usually make his own way: pull-up threes, drives and post-ups, for the share added */
    const diff = (key, zn, share) => { if (!(share > 0) || !(m[zn] > 0)) return 0; return -DIFF[key] * (1 - clamp(c.un[zn] / UN_FULL[zn], 0, 1)) * Math.min(1, share / m[zn]); };
    p.vol.three += diff('pull', 'three', p.extra.pull);
    p.vol.rim += diff('drive', 'rim', p.extra.drive);
    if (p.extra.post > 0) { const pp = -DIFF.post * (1 - c.creator) * Math.min(1, p.extra.post / Math.max(0.05, m.rim + m.mid)); p.vol.rim += pp; p.vol.mid += pp; }
    /* the rim brings the fouls: his trips move with the square root of his rim share's change */
    p.rFta = c.off.rFta * Math.sqrt(m.rim / Math.max(0.02, m0.rim));
  });

  /* ---- THE FIVE TOGETHER: spacing, passing, the running habit ---- */
  /* a man's threat: his share of threes against the league's, times how well he shoots them - nothing under three
     quarters of the league's 3P% (nobody guards a non-shooter out there), the league's 1, a fifth better 1.8; a cutter and a
     crasher stand in the paint, a spacer and a popping big stand out there */
  /* where his role puts him: out on the arc (a spot-up, an off-screen, a popping role) his threat spaces the floor; in
     the paint (the cut, the roll, the post, the glass) it does not, and he crowds it */
  /* - against where his own game puts him (the role that suits him best: a man's own spacing is in his numbers already,
     so his natural role changes nothing, and a general role leaves him where he is) */
  const placeOf = r => { const q = RL.profile(r); return (0.55 + 0.75 * q.perim) * (1 - 0.3 * q.paint); };
  const rollOf = r => Math.min(1, 2 * ((r.diet.roll || 0) + 0.5 * (r.diet.short || 0)));
  P.forEach(p => { p.nat = p.R && !p.R.gen ? RL.bestFor(p.k, p.c, ref) : null; });
  const roleMul = p => (p.nat ? 1 + p.st * (placeOf(p.R) / placeOf(p.nat) - 1) : 1);
  const threatMul = p => (p.has('cut') ? 0.6 : 1) * (p.has('crash') ? 0.85 : 1) * (p.has('space') || p.has('pop') ? 1.15 : 1) * roleMul(p);
  const threat = p => clamp(p.m.three / Math.max(0.01, mixMu.three), 0, 2.5) * clamp((p.c.p3Rel - 0.75) * 4, 0, 2) * threatMul(p);
  /* a rolling big who finishes is room of its own: the defence has to sink to him (his instruction; or his role's rolls
     beyond his own game's) */
  const vOf = p => 0.6 * clamp(p.c.rimRel - 0.95, 0, 0.5);
  const vertical = P.reduce((a, p) => a + (p.has('roll') ? vOf(p) : 0) + (p.nat ? p.st * vOf(p) * (rollOf(p.R) - rollOf(p.nat)) : 0), 0);
  const spacing = clamp(mean(P.map(threat)) + vertical, 0.1, 2.5);
  /* a packed paint: fewer rim attempts for everybody (they go to the mid-range), more with real spacing */
  P.forEach(p => {
    const f = clamp(1 + SYN.spaceMix * (spacing - 1), 0.7, 1.25), rim = clamp(p.m.rim * f, 0.01, 0.9), d = p.m.rim - rim;
    p.m = { rim, mid: Math.max(0.01, p.m.mid + d), three: p.m.three };
  });
  /* LEAK OUT, AND WHO RUNS: the five's transition habit (each man's share of his plays in transition against the
     league's) sets how many more chances leaking gives and how well they go: men used to running take them at their own
     transition rates; a five that rarely runs turns the extra chances over and misses them (UNFAM) */
  const trRel = clamp(mean(P.map(p => p.c.off.tr.share / Math.max(0.01, ref.trShare))), 0.1, 3);
  const unfam = Math.max(0, 1 - trRel);
  const trMult = 1 + 0.9 * tac.leak * clamp(trRel, 0.3, 1.5);
  const trShare0 = clamp(ref.trShare * trRel, 0.01, 0.5), trShare1 = Math.min(0.6, trShare0 * trMult), dTrShare = trShare1 - trShare0;
  const trEff = P.reduce((a, p) => a + p.s * (p.c.off.tr.ppp - ref.trPpp), 0), hcEff = P.reduce((a, p) => a + p.s * (p.c.off.tr.hcPpp - ref.hcPpp), 0);
  /* winsim splits its transition bonus around a side's own transition share without moving the side's average, so the
     gain of the EXTRA transition chances is put here: the league's transition bonus (dTr) on the share moved, plus this
     five's own transition against its half court, less what an unfamiliar five gives away */
  const leakMake = dTrShare * ((X.dTr || 0) + ((trEff - hcEff) - 0.25 * unfam) / PPP_LOGIT);
  const leakTov = 0.15 * tac.leak * unfam;
  /* PUSH IN TRANSITION and SLOW IT DOWN, a man at a time (Louie: "can't just give a low transition player the transition
     based instructions and it work optimally"): the possessions he has the ball in run more (or less) - his share of the
     plays - and the extra chances go at HIS transition rate against his half court, less what he gives away for being
     unused to running (his own unfamiliarity, and his turnovers for it); slowing it down plays his chances at his half
     court rate */
  /* a role that runs (a slasher's) pushes as the instruction does, a little less - the running he does not already do */
  const pushOf = p => (p.has('push') ? 1 : 0) + (p.R ? 0.6 * Math.max(0, p.ld.run) : 0);
  const pushW = P.reduce((a, p) => a + Math.min(1, pushOf(p)) * p.s, 0), slowW = P.reduce((a, p) => a + (p.has('slow') ? p.s : 0), 0);
  const trPush = clamp(1 + 0.8 * pushW - 0.6 * slowW, 0.4, 1.8);
  P.forEach(p => {
    p.trMake = 0; p.trTov = 0;
    const own = p.c.off.tr, uf = Math.max(0, 1 - own.share / Math.max(0.01, ref.trShare)), pu = Math.min(1, pushOf(p));
    if (pu > 0) {
      const moved = trShare0 * 0.8 * pu;
      p.trMake = moved * ((X.dTr || 0) + ((own.ppp - own.hcPpp) - 0.30 * uf) / PPP_LOGIT);
      p.trTov = 0.30 * uf * pu;
    }
    /* the chances he walks up: from his transition rate (and the league's transition bonus) to his half court rate */
    if (p.has('slow')) { const moved = trShare0 * 0.6; p.trMake += moved * ((own.hcPpp - own.ppp) / PPP_LOGIT - (X.dTr || 0)); }
  });
  /* the on/off of the offence, half weight over the five */
  const onEfg = 0.5 * 0.04 * P.reduce((a, p) => a + p.c.onoff.efg, 0), onTov = 0.5 * 0.04 * P.reduce((a, p) => a + p.c.onoff.tov, 0);
  /* CREATION, A FIVE'S OWN (the What wins model's creation efficacy): a five with nobody to make a shot out of nothing
     ends more possessions late in the clock - turnovers and forced shots; around the league's five, nothing */
  const create5 = P.reduce((a, p) => a + p.s * (p.c.creator * Math.sqrt(p.un.rim / Math.max(0.05, p.c.un.rim + 1e-6))), 0);
  let createGap = clamp(0.22 - create5, 0, 0.22);
  /* nobody to run it: the possessions nobody starts end late and badly */
  if (roled && deficit > 0) createGap = clamp(createGap + ROLEK.forceGap * deficit, 0, 0.32);

  /* ---- THE ROLES TOGETHER: the ball, the paint, the screens, the pick-and-roll, the post, the cut, the extra pass ----
     each a make logit (rk) or a turnover logit on the men whose plays lean on it, centred on what a five usually has */
  let P5 = 0, S5 = 0, hub5 = 0;
  P.forEach(p => { p.rk = { rim: 0, mid: 0, three: 0, tov: 0 }; p.press = 0; });
  if (roled) {
    /* DOWNHILL PRESSURE: the five's drives, rolls, post-ups and cuts, each at its man's finishing (a man who does not
       finish is not feared) - a ball handler's on every possession he runs (his time on the ball: true usage, not only
       the plays he ends), everybody's on the plays he ends */
    P.forEach(p => {
      if (!p.R) return;
      const apt = clamp(0.4 + 0.6 * p.rimApt, 0.3, 1.8);
      p.press = apt * (ROLEK.pOn * p.onb * p.RP.onPress + p.s * p.RP.press);
      P5 += p.press;
    });
    S5 = P.reduce((a, p) => a + screenerW(p) * clamp((p.c.pos - 2.5) / 2, 0.3, 1.2), 0);
    hub5 = P.reduce((a, p) => a + (p.R ? p.R.hub * clamp(p.passQ, 0.3, 2) : 0), 0);
    const stag = Math.max(0, I5 - ROLEK.ballMax), dP = P5 - ROLEK.pRef, press = clamp(dP, -0.25, 0.25), low = Math.max(0, -ROLEK.pLow - dP);
    const scr = clamp(S5 - ROLEK.sRef, -1, 0.6);
    /* the handlers' passing feeds the pick-and-roll's partners */
    const feedQ = Lpnr > 0 ? P.reduce((a, p) => a + (p.R ? p.onb * (p.R.diet.pnr || 0) * clamp(p.passQ, 0.3, 2) : 0), 0) / Lpnr : 1;
    P.forEach(p => {
      if (!p.R) return;
      const d = p.R.diet, r = p.rk;
      /* open threes need the paint attacked: on his catch-and-shoot share of his threes; and a five that never gets
         there plays every possession against a set defence */
      r.three += (ROLEK.press3 * press - ROLEK.pressLow * low) * (1 - p.un.three);
      r.rim -= 0.5 * ROLEK.pressLow * low * (1 - p.un.rim); r.mid -= 0.5 * ROLEK.pressLow * low * (1 - p.un.mid);
      r.tov += ROLEK.pressTov * low;
      /* a ball-dominant man without the ball: the plays he wanted come as worse ones */
      const lp = -ROLEK.lostMake * p.lost * p.RP.on;
      /* a stagnant five: the clock runs down with everybody waiting for the ball */
      ZONES.forEach(zn => { r[zn] += lp - ROLEK.stagMake * stag; });
      r.tov += ROLEK.stagTov * stag;
      /* the screens his pick-and-roll and his off-screen plays need */
      const sp = ROLEK.screenMake * scr, pn = d.pnr || 0, of = d.offs || 0;
      r.rim += sp * pn; r.mid += sp * (pn + of); r.three += sp * (pn + of);
      /* the pick-and-roll's partners: with a handler the roll finishes better (and better still off a passer's feed) */
      if (partnerShare(p) > 0) {
        const q = ROLEK.partnerMake * ((partner - 1) + 0.5 * (feedQ - 1));
        r.rim += q * ((d.roll || 0) + (d.short || 0)); r.three += q * (d.pop || 0); r.mid += q * (d.short || 0);
      }
      /* the post: room to work - the spacing around it */
      if (d.post) { const q = ROLEK.postSpace * clamp(spacing - 1, -0.8, 0.8) * d.post; r.rim += q; r.mid += q; }
      /* the extra pass: a connector makes his teammates' assisted looks better (than a five's usual connectors do) */
      const hubOthers = hub5 - p.R.hub * clamp(p.passQ, 0.3, 2) - 0.8 * ROLEK.hRef;
      ZONES.forEach(zn => { r[zn] += ROLEK.hubMake * hubOthers * (1 - p.un[zn]); });
    });
  }

  /* ---- EACH MAN'S PLAYS ---- */
  P.forEach(p => {
    const c = p.c, o = c.off;
    const common = p.skill - FAT_LOGIT * p.dLoad + FORM.make * p.z - OOP.make * p.e * p.e + onEfg + leakMake + p.trMake - 0.3 * createGap;
    const pass = zn => SYN.pass * (A5 - 1) * (1 - p.un[zn]);
    /* driving into a packed paint: the downhill game finishes better with shooters around it */
    const lane = 0.10 * p.down * clamp(spacing - 1, -0.8, 0.8) + (p.has('dh') ? 0.06 * clamp(spacing - 1, -0.8, 0.8) : 0);
    /* cutting finishes on passes (the five's passing decides it); spacing opens the lane for the men who drive (its
       shooting decides it): both centred on the league's five, so a five without passers or shooters loses by it */
    let motion = 0;
    if (tac.motion < 0) motion = 0.30 * -tac.motion * (A5 - 1) * (1 - p.un.rim);
    if (tac.motion > 0) motion = 0.15 * tac.motion * (spacing - 1) * p.un.rim;
    if (p.has('cut')) motion += 0.20 * (A5 - 1) * (1 - p.un.rim);
    /* a roller's finishes come off the handler's pass: the five's passing again */
    if (p.has('roll')) motion += 0.15 * (A5 - 1);
    const dRim = isNum(o.dRim) ? o.dRim : o.d2, dMid = isNum(o.dMid) ? o.dMid : o.d2;
    /* the roles together (above): nothing for a five without them */
    const rk = p.rk;
    p.p = {
      rim: expit(lg.rim + dRim + common + p.vol.rim + pass('rim') + SYN.space * clamp(spacing - 1, -0.8, 0.8) + motion + lane + rk.rim),
      mid: expit(lg.mid + dMid + common + p.vol.mid + pass('mid') + rk.mid),
      three: expit(lg.three + o.d3 + common + p.vol.three + pass('three') + rk.three)
    };
    p.ft = expit(lg.ft + o.dFt);
    /* driving into traffic: the men who do not get to the rim, and the loose handles, give it away */
    const downTov = (p.down + (p.has('dh') ? 0.6 : 0)) * (0.14 * (1.5 - clamp(p.rimApt, 0, 1.5)) + 0.05 * clamp(o.dTov, -1, 1));
    let tovAdj = p.tovSkill + OOP.tov * p.e * p.e + onTov + leakTov + downTov + p.tovI + p.trTov + 0.4 * createGap + rk.tov;
    if (tac.motion < 0) tovAdj += 0.03 * -tac.motion + 0.10 * -tac.motion * clamp(1.2 - A5, 0, 1);
    p.tov = expit(lg.tov + o.dTov + tovAdj);
    let sf = mu.sfoul * p.rFta, bo = mu.bonus * (0.5 + 0.5 * p.rFta);
    if (sf + bo > 0.45) { const q = 0.45 / (sf + bo); sf *= q; bo *= q; }
    p.sfoul = sf; p.bonus = bo;
    p.and1 = mu.and1 * clamp(p.m.rim / Math.max(0.02, mixMu.rim), 0.4, 2);
  });

  /* ---- THE FIVE'S OFFENCE, per chance ---- */
  const off = {};
  off.tov = P.reduce((a, p) => a + p.s * p.tov, 0);
  const nonTo = P.map(p => p.s * (1 - p.tov)), NT = nonTo.reduce((a, v) => a + v, 0) || 1;
  off.sfoul = P.reduce((a, p, i) => a + nonTo[i] * p.sfoul, 0) / NT;
  off.bonus = P.reduce((a, p, i) => a + nonTo[i] * p.bonus, 0) / NT;
  const shots = P.map((p, i) => nonTo[i] * (1 - p.sfoul - p.bonus)), SH = shots.reduce((a, v) => a + v, 0) || 1;
  const zA = z => P.reduce((a, p, i) => a + shots[i] * p.m[z], 0);
  const zM = z => P.reduce((a, p, i) => a + shots[i] * p.m[z] * p.p[z], 0);
  off.mixRim = zA('rim') / SH; off.mixMid = zA('mid') / SH; off.mix3 = zA('three') / SH;
  off.pRim = zM('rim') / Math.max(1e-9, zA('rim')); off.pMid = zM('mid') / Math.max(1e-9, zA('mid')); off.p3 = zM('three') / Math.max(1e-9, zA('three'));
  off.p2 = (zM('rim') + zM('mid')) / Math.max(1e-9, zA('rim') + zA('mid'));
  off.and1 = P.reduce((a, p, i) => a + shots[i] * p.and1, 0) / SH;
  const trips = P.map((p, i) => nonTo[i] * (p.sfoul + p.bonus)), TR = trips.reduce((a, v) => a + v, 0);
  off.ft = TR > 0 ? P.reduce((a, p, i) => a + trips[i] * p.ft, 0) / TR : mu.ft;
  off.live = mu.live;
  const sumRate = (f, w) => P.reduce((a, p) => a + f(p) * (w ? p.work : 1), 0);
  /* the glass: a crasher attacks it as well as he rebounds (his ORB% against his position's) */
  P.forEach(p => { p.orb = p.c.off.orb * (p.has('crash') ? 1 + 0.45 * clamp(p.orbQ, 0.3, 2.2) : 1) * (p.has('spot') || p.has('pop') ? 0.85 : 1); });
  /* his role's place on the floor: a crashing role attacks the glass as the instruction does (a little less), a role out
     on the arc leaves it (as far as the role moves him) */
  P.forEach(p => {
    if (!p.R) return;
    /* the crashing it asks beyond his natural role's; where it puts him against where his natural role does */
    const N = p.NP || p.RP, place = 0.25 * p.rho * ((clamp(2 * p.RP.paint - 0.4, 0, 1) - clamp(2 * N.paint - 0.4, 0, 1)) - (clamp(2 * p.RP.perim - 1, 0, 1) - clamp(2 * N.perim - 1, 0, 1)));
    p.orb *= clamp(1 + 0.35 * p.ld.crash * clamp(p.orbQ, 0.3, 2.2), 0.5, 2) * (1 + place);
  });
  const orb5 = sumRate(p => p.orb, true);
  off.orb = clamp(mu.orb + DR * (orb5 - ref.five.oreb_pct) / 100 + 0.5 * P.reduce((a, p) => a + p.c.onoff.oreb, 0) / 100
    + 0.05 * tac.crash * (clamp(orb5 / Math.max(1, ref.five.oreb_pct), 0.3, 2) - 0.5), 0.04, 0.65);
  const pace5 = clamp(mean(P.map(p => p.c.off.pace)), 0.8, 1.25);
  const downAll = Math.max(...P.map(p => p.down)), postW = P.reduce((a, p) => a + (p.has('pm') ? p.s : 0), 0);
  off.d = mu.d / Math.sqrt(pace5) * (1 - 0.05 * tac.leak) * (1 - 0.02 * downAll) * (1 + 0.03 * Math.max(0, -tac.feed))
    * (1 - 0.06 * pushW + 0.07 * slowW) * (1 + 0.04 * postW);
  off.tr = clamp(mu.tr * Math.sqrt(trRel) * trMult * trPush, 0.01, 0.9);

  /* ---- THE FIVE'S DEFENCE: what an average offence gets against it ---- */
  const def = {};
  /* each man's part, under his instructions: gambling (steals for quick hands), staying solid (fewer), rim protection
     asked for (blocks for a shot blocker, fouls for anybody), the big's coverage */
  P.forEach(p => {
    let stl = p.c.def.stl, blk = p.c.def.blk, pf = p.c.def.pf40, save = p.c.def.rimSave;
    if (p.has('gam')) { stl *= 1 + 0.6 * clamp(p.stlQ, 0.3, 2); pf *= 1.15; }
    if (p.has('sol')) { stl *= 0.75; pf *= 0.9; }
    if (p.has('rimp') || p.has('rima')) { blk *= 1 + 0.5 * clamp(p.blkQ, 0.2, 2.5); pf *= p.has('rima') ? 1.25 : 1.2; }
    if (p.has('cons')) { blk *= 0.7; save *= 0.8; pf *= 0.75; }
    if (p.has('hedge')) { blk *= 0.7; save *= 0.5; stl *= 1 + 0.25 * clamp(p.stlQ, 0.3, 2); }
    if (p.has('drop')) { blk *= 1 + 0.15 * clamp(p.blkQ, 0.2, 2.5); save = save > 0 ? save * 1.3 : save; }
    p.dstl = stl; p.dblk = blk; p.dpf = pf; p.dsave = save;
  });
  const stl5 = sumRate(p => p.dstl, true), blk5 = sumRate(p => p.dblk, true);
  let drb5 = sumRate(p => p.c.def.drb, true);
  /* the leakers leave the glass: the two (of the guards and the wing) most used to running, their boards partly lost */
  if (tac.leak > 0) {
    const leakers = P.filter(p => p.k <= 2).sort((a, b) => b.c.off.tr.share - a.c.off.tr.share).slice(0, 2);
    drb5 -= 0.15 * tac.leak * leakers.reduce((a, p) => a + p.c.def.drb * p.work, 0);
  }
  /* a pusher leaks a little too */
  drb5 -= 0.08 * P.reduce((a, p) => a + Math.min(1, pushOf(p)) * p.c.def.drb * p.work, 0);
  const pf5 = sumRate(p => p.dpf, false);
  const rimSave5 = P.reduce((a, p) => a + p.dsave, 0), deter5 = P.reduce((a, p) => a + p.c.def.rimDeter, 0);
  const stlRel = stl5 / Math.max(0.5, ref.five.stl_pct);
  /* the hedging big forces turnovers - with the feet for it (his steal rate against his position's: a stand-in for how
     well he moves) - and leaves the rim to the others */
  const hedge = P.filter(p => p.has('hedge')), hedgeTov = hedge.reduce((a, p) => a + 0.010 * clamp(p.stlQ, 0.3, 2), 0);
  def.tov = clamp(mu.tov + DR * (stl5 - ref.five.stl_pct) / 100 + 0.5 * 0.01 * P.reduce((a, p) => a + p.c.onoff.vsTov, 0) + 0.02 * tac.gamble * stlRel + hedgeTov, 0.04, 0.4);
  def.live = clamp(mu.live + 0.8 * ((stl5 - ref.five.stl_pct) / 100 + 0.02 * tac.gamble * stlRel) / def.tov, 0.2, 0.92);
  /* rim protection: the five's blocks, and the rim on/off at half weight (the five's men share one floor) */
  const prot = clamp((blk5 / Math.max(0.5, ref.five.blk_pct) - 1) + 0.5 * rimSave5 / 4, -1, 2);
  const perim = clamp((stlRel - 1) - 0.05 * P.reduce((a, p) => a + p.c.onoff.vsEfg, 0), -1, 2);
  const rimP = mu.pRim, rimDp = -0.5 * rimSave5 / (2 * Math.max(5, ref.rimVol)) / Math.max(0.05, rimP * (1 - rimP));
  let dRim = -BLK_LOGIT * DR * (blk5 - ref.five.blk_pct) + rimDp, dMid = 0, d3 = 0;
  const onVs = 0.5 * 0.04 * P.reduce((a, p) => a + p.c.onoff.vsEfg, 0);
  dRim += onVs; dMid += onVs; d3 += onVs;
  /* size and speed out of position: an undersized big gives up the rim, an oversized guard gives up threes */
  P.forEach(p => {
    if (!(p.e > 0)) return;
    if (p.k >= 3 && p.c.pos < p.k + 1) dRim += OOP.rim * p.e * p.e;
    if (p.k <= 1 && p.c.pos > p.k + 1) d3 += OOP.three * p.e * p.e;
  });
  /* gambling: steals for quick hands, open shots when it misses (the fewer the hands, the more it misses) - the team's
     tactic for the five, and each gambler's own */
  const gambleCost = 0.10 * tac.gamble * clamp(1.4 - stlRel, 0, 1.4) + P.reduce((a, p) => a + (p.has('gam') ? 0.03 * clamp(1.4 - p.stlQ, 0, 1.4) + 0.006 : 0), 0);
  dRim += gambleCost; dMid += gambleCost; d3 += gambleCost;
  /* staying solid: better contests */
  const solid = P.reduce((a, p) => a + (p.has('sol') ? 0.012 : 0), 0);
  dMid -= solid; d3 -= solid;
  /* a 3-and-D role: his energy goes into guarding the ball and closing out - the opponents' threes (the mid-range a
     little), with the feet for it (his steal rate against his position's: how well he moves) */
  P.forEach(p => { if (p.R && p.ld.def) { const q = ROLEK.def3 * p.ld.def * clamp(p.stlQ, 0.5, 1.5); d3 -= q; dMid -= 0.5 * q; } });
  /* asked to go for blocks: a shot blocker turns them away, anybody gives up and-ones */
  P.forEach(p => { if (p.has('rimp') || p.has('rima')) dRim -= 0.02 * clamp(p.blkQ - 0.6, -0.4, 1.5); if (p.has('cons')) dRim += 0.012; });
  /* a hedging big who cannot move gives up the drive and the pop; a dropping big gives up the mid-range */
  let mixRimF = 1, mixMidF = 1;
  hedge.forEach(p => { dRim += 0.03 * clamp(0.9 - p.stlQ, 0, 0.9); dMid += 0.02 * clamp(0.9 - p.stlQ, 0, 0.9); mixRimF *= 1.04; });
  P.forEach(p => { if (p.has('drop')) { mixMidF *= 1.12; mixRimF *= 0.95; dMid += 0.05; } });
  let mixRim = mu.mixRim * Math.exp(-0.5 * deter5 / Math.max(5, ref.rimVol)) * mixRimF, mixMid = mu.mixMid * mixMidF, mix3 = mu.mix3;
  if (tac.scheme < 0) {
    const a = -tac.scheme;
    mixRim *= 1 + 0.25 * a; mix3 *= 1 - 0.2 * a;
    dRim += a * (0.10 - 0.40 * prot); d3 -= 0.08 * a;
  } else if (tac.scheme > 0) {
    const a = tac.scheme;
    mixRim *= 1 - 0.25 * a; mix3 *= 1 + 0.2 * a;
    d3 += a * (0.18 - 0.2 * perim); dRim -= 0.06 * a;
  }
  /* crashing the offensive glass gives the opponents more transition: the league's transition bonus on the share - the
     team's tactic, and each crasher's own */
  /* (a role's crashing beyond his own: the getting back it costs is small now - the link between crashing and the
     opponents' transition has faded - so it counts for less than the instruction) */
  const crashers = P.reduce((a, p) => a + (p.has('crash') ? 1 : 0) + (p.R ? 0.3 * Math.max(0, p.ld.crash) : 0), 0);
  if (tac.crash > 0 || crashers) { const up = (0.5 * tac.crash + 0.15 * crashers) * ref.trShare * (X.dTr || 0); dRim += up; dMid += up; d3 += up; }
  ms = mixRim + mixMid + mix3;
  def.mixRim = mixRim / ms; def.mixMid = mixMid / ms; def.mix3 = mix3 / ms;
  def.pRim = expit(lg.rim + dRim); def.pMid = expit(lg.mid + dMid); def.p3 = expit(lg.three + d3);
  def.p2 = expit(lg.p2 + (dRim * mixMu.rim + dMid * mixMu.mid) / Math.max(0.01, mixMu.rim + mixMu.mid));
  def.orb = clamp(mu.orb - DR * (drb5 - ref.five.dreb_pct) / 100 + 0.5 * P.reduce((a, p) => a + p.c.onoff.vsOreb, 0) / 100
    - 0.02 * Math.max(0, tac.scheme), 0.04, 0.65);
  const foul = Math.pow(clamp(pf5 / Math.max(1, ref.five.pf40), 0.5, 2), 0.7) * (1 + 0.12 * tac.gamble) * (1 + 0.005 * P.reduce((a, p) => a + p.c.onoff.vsFtr, 0));
  def.sfoul = clamp(mu.sfoul * foul, 0.01, 0.25); def.bonus = clamp(mu.bonus * foul, 0.005, 0.2);
  def.and1 = mu.and1 * (1 + 0.06 * P.filter(p => p.has('rimp') || p.has('rima')).length); def.ft = mu.ft;
  def.tr = clamp(mu.tr * (1 + 0.5 * tac.crash + 0.12 * crashers), 0.01, 0.9);
  def.d = mu.d / Math.sqrt(pace5) * (1 - 0.03 * tac.gamble) * (1 + 0.02 * Math.max(0, tac.scheme)) * (1 - 0.03 * tac.crash);

  /* TRUE USAGE: the plays he ends, and the shots he makes for the others - every shot off a pass (made or not) shared
     among the passers by their assists, as a scouting service counts the potential assists */
  const astW = P.map(p => p.c.off.ast * p.astM * p.work), astT = astW.reduce((a, v) => a + v, 0) || 1;
  const passed = P.reduce((a, p) => a + p.s * (1 - p.tov) * (1 - p.sfoul - p.bonus) * ZONES.reduce((b, zn) => b + p.m[zn] * (1 - p.un[zn]), 0), 0);
  P.forEach((p, i) => { p.tusg = p.u2 + 100 * passed * astW[i] / astT; });

  return {
    off, def, n: 0,
    /* what each man does here, for the box score, the play-by-play and the screens */
    men: P.map(p => ({ id: p.c.id, k: p.k, s: p.s, u: p.u, u2: p.u2, tov: p.tov, trip: p.sfoul + p.bonus, sfoul: p.sfoul, bonus: p.bonus, m: p.m, p: p.p, ft: p.ft, and1: p.and1,
      orb: p.orb * p.work, drb: p.c.def.drb * p.work, stl: p.dstl * p.work, blk: p.dblk * p.work, pf: p.dpf, ast: p.c.off.ast * p.astM * p.work,
      un: p.un, e: p.e, dLoad: p.dLoad, z: p.z, hw: p.hw, tr: p.c.off.tr.share * Math.min(1.8, 1 + 0.8 * pushOf(p)) * (p.has('slow') ? 0.6 : 1), ins: p.I ? [...p.I.k] : [],
      /* his role here: its key, his share of the five's time on the ball (and what he wanted of it), the pressure he puts
         on the rim, his true usage */
      role: p.R ? p.R.key : null, onb: roled ? p.onb : null, init: roled ? p.init : null, lost: roled ? p.lost : 0, forced: roled ? p.forced : 0,
      press: p.press, tusg: p.tusg,
      /* what a ball-screen coverage meets in him, and the coverage he plays as a big (interact: coverage) */
      cv: covTraits(p, ref), cov: p.has('hedge') ? 'hedge' : p.has('drop') ? 'drop' : p.has('cont') ? 'cont' : (X.cov && X.cov.get(String(p.c.id))) || 'cont' })),
    five: { spacing, vertical, passing: A5, run: trRel, prot, perim, stl: stl5, blk: blk5, drb: drb5, orb: orb5, create: create5,
      /* the roles together (a five with roles): the ball they ask for, the paint pressure, the screens, the pick-and-roll */
      roled, ball: I5, ballMax: ROLEK.ballMax, ballMin: ROLEK.ballMin, deficit, pressure: P5, pRef: ROLEK.pRef, screens: S5, sRef: ROLEK.sRef, pnr: Lpnr, hub: hub5,
      notes: roled ? roleNotes(P, { I5, deficit, P5, S5, Lpnr, hub5, spacing, A5 }) : [] },
    tac, covMix: X.covMix || null
  };
}

/* WHAT THE TACTICS SCREEN SAYS ABOUT A FIVE'S ROLES (Louie: "flagging when you've designated too many high usage players
   and ball handlers"): each note {lvl: 'bad' | 'warn' | 'good', text, ids} - the text names the men as {who} */
function roleNotes(P, f) {
  const out = [], R = P.filter(p => p.R), ids = list => list.map(p => String(p.c.id));
  const by = (fn, min) => R.filter(p => fn(p) >= min).sort((a, b) => fn(b) - fn(a));
  if (f.I5 > ROLEK.ballMax + 0.05) {
    const who = by(p => p.init, 0.2);
    out.push({ lvl: f.I5 > ROLEK.ballMax + 0.35 ? 'bad' : 'warn', key: 'ball', ids: ids(who),
      text: 'Too many ball handlers: {who} all want the ball. There is only one - each gets less of it than his role asks, and the plays he does get come late in the clock.' });
  }
  if (f.deficit > 0.02) {
    const q = P.find(p => p.forced > 0);
    out.push({ lvl: f.deficit > 0.2 ? 'bad' : 'warn', key: 'noball', ids: q ? [String(q.c.id)] : [],
      text: 'Nobody runs the offence: these roles start very few plays. {who} has to bring it up anyway, and possessions end late and badly.' });
  }
  const scorers = by(p => p.R.use, 0.5);
  if (scorers.length >= 3) out.push({ lvl: 'warn', key: 'scorers', ids: ids(scorers),
    text: 'Scorers everywhere: {who} all look for their own shot. There are only so many shots - each takes fewer than his role asks.' });
  if (f.P5 < ROLEK.pRef - 0.08) out.push({ lvl: f.P5 < ROLEK.pRef - 0.2 ? 'bad' : 'warn', key: 'press', ids: [],
    text: 'Not enough pressure on the rim: few drives, rolls, cuts or post-ups, so the defence stays at home on the shooters and their threes come contested.' });
  else if (f.P5 > ROLEK.pRef + 0.1) out.push({ lvl: 'good', key: 'press', ids: ids(by(p => p.press, 0.12)),
    text: 'Plenty of pressure on the rim from {who}: the defence collapses into the paint, and the shooters get open threes.' });
  const needScreens = R.reduce((a, p) => a + p.s * ((p.R.diet.pnr || 0) + (p.R.diet.offs || 0)), 0);
  if (needScreens > 0.12 && f.S5 < ROLEK.sRef - 0.35) out.push({ lvl: 'warn', key: 'screens', ids: [],
    text: 'Few screens: the pick-and-roll and the shooters coming off screens need somebody setting them - a big, or a role that screens.' });
  const partners = by(p => (p.R.diet.roll || 0) + (p.R.diet.pop || 0) + (p.R.diet.short || 0), 0.3);
  if (partners.length && f.Lpnr < 0.6 * ROLEK.lRef) out.push({ lvl: 'warn', key: 'partner', ids: ids(partners),
    text: '{who} lives on the pick-and-roll, but nobody here runs it: give a guard a pick-and-roll role.' });
  const posts = by(p => p.R.diet.post || 0, 0.25);
  if (posts.length && f.spacing < 0.85) out.push({ lvl: 'warn', key: 'post', ids: ids(posts),
    text: '{who} posts up into a crowded paint: put shooters around him.' });
  const cutters = by(p => p.R.diet.cut || 0, 0.25);
  if (cutters.length && f.A5 < 0.85) out.push({ lvl: 'warn', key: 'cut', ids: ids(cutters),
    text: '{who} cuts, but nobody here finds the cutter: the five needs a passer.' });
  if (f.spacing < 0.7) out.push({ lvl: 'warn', key: 'space', ids: [],
    text: 'A cramped floor: few shooters out on the arc, so the paint is packed for everybody.' });
  const hubs = by(p => p.R.hub * clamp(p.passQ, 0.3, 2), 0.8);
  if (hubs.length) out.push({ lvl: 'good', key: 'hub', ids: ids(hubs),
    text: '{who} keeps the ball moving: the extra pass gets the others better shots.' });
  if (!out.some(n => n.lvl !== 'good') && f.I5 >= ROLEK.ballMin && f.I5 <= ROLEK.ballMax) out.unshift({ lvl: 'good', key: 'balance', ids: [],
    text: 'A balanced five: one ball, somebody to run it, and the roles fit together.' });
  return out;
}

/* ------------------------------------------------------------------ rotations --- */
/* THE USER'S LINEUPS on a game's clock, each stretch with its lineup's five, team instructions and roles (li: which
   lineup). PAINTED (Louie, 2026-10-14: "an interactive rotations chart ... I'd rather lineup granularity"): each lineup
   plays the minutes it was given on the clock (when: [[t0, t1], ...] in the game's minutes; a minute nobody was given
   goes to lineup 1). A plan from before the chart (no `when`): each lineup's minutes shared evenly over the four
   quarters; lineup 1 opens each quarter (60% of its share there) and closes it (40%), the others play the middle in
   their order. */
function rotation(lineups, G) {
  G = G || 40;
  const all = (lineups || []).map((l, li) => ({ l, li })).filter(x => x.l && Array.isArray(x.l.ids) && x.l.ids.length === 5);
  if (!all.length) return [];
  const seg = (x, t0, t1) => ({ t0, t1, ids: x.l.ids.map(String), tac: x.l.tac || null, roles: Array.isArray(x.l.roles) ? x.l.roles.slice(0, 5).map(r => r || null) : null, li: x.li });
  if (all.some(x => Array.isArray(x.l.when) && x.l.when.length)) {
    const cuts = new Set([0, G]);
    all.forEach(x => (x.l.when || []).forEach(w => { if (Array.isArray(w)) w.slice(0, 2).forEach(v => { if (isNum(+v)) cuts.add(+clamp(+v, 0, G).toFixed(6)); }); }));
    const times = [...cuts].sort((a, b) => a - b), segs = [];
    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i], b = times[i + 1], mid = (a + b) / 2;
      if (b - a < 1e-6) continue;
      const x = all.find(y => (y.l.when || []).some(w => Array.isArray(w) && +w[0] <= mid && mid < +w[1])) || all[0];
      segs.push(seg(x, a, b));
    }
    return mergeSame(segs);
  }
  const L = all.filter(x => x.l.min > 0);
  if (!L.length) return [];
  const tot = L.reduce((a, x) => a + x.l.min, 0), q = G / 4, segs = [];
  for (let k = 0; k < 4; k++) {
    let t = k * q;
    const share = L.map(x => q * x.l.min / tot);
    const push = (x, d) => { if (d > 1e-9) { segs.push(seg(x, t, t + d)); t += d; } };
    push(L[0], 0.6 * share[0]);
    for (let j = 1; j < L.length; j++) push(L[j], share[j]);
    push(L[0], 0.4 * share[0]);
    segs[segs.length - 1].t1 = (k + 1) * q;     // the quarter ends where it ends
  }
  return mergeSame(segs);
}
/* the minutes each lineup plays under a plan, painted on the clock to the minute (for the chart: a plan from before it,
   or any plan, as the chart shows it): [[t0, t1], ...] for each lineup */
function paintOf(lineups, G) {
  G = G || 40;
  const segs = rotation(lineups, G), out = (lineups || []).map(() => []);
  /* each minute to the lineup that plays most of it */
  for (let t = 0; t < G; t++) {
    const own = new Map();
    segs.forEach(s => { const o = Math.min(s.t1, t + 1) - Math.max(s.t0, t); if (o > 1e-9) own.set(s.li, (own.get(s.li) || 0) + o); });
    if (!own.size) continue;
    const li = [...own.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0], w = out[li];
    if (!w) continue;
    if (w.length && w[w.length - 1][1] === t) w[w.length - 1][1] = t + 1; else w.push([t, t + 1]);
  }
  return out;
}
/* A REAL CLUB'S ROTATION from its own minutes: its men at their main positions (the minutes at each position where we
   have them, else the box-score position), the most-used first; each position's minutes made to fill the game (a man
   capped at 90% of it); a position with nobody borrows the next one's second man; then each position's men laid on the
   clock, the starter opening and closing each quarter, the others in the middle by their minutes.
   players: [{id, mpg, share: [5]}] -> [{t0, t1, ids}] */
function autoRotation(players, G, o) {
  G = G || 40;
  const max = (o && o.max) || 11;
  const men = (players || []).filter(p => p && p.mpg > 0).sort((a, b) => b.mpg - a.mpg).slice(0, max)
    .map(p => ({ id: String(p.id), mpg: Math.min(0.9 * G, p.mpg), share: Array.isArray(p.share) ? p.share : [0.2, 0.2, 0.2, 0.2, 0.2] }));
  if (men.length < 5) return [];
  const slotOf = p => p.share.indexOf(Math.max(...p.share));
  const depth = [[], [], [], [], []];
  /* EACH MAN TO THE POSITION THAT NEEDS HIM: the most-used first, each to the position (his own, or one he plays a
     share of his minutes at) with the most of its game still to fill, weighed by how much of his time he spends there -
     so a club with five small forwards and one centre plays a forward at the four, and nobody runs forty minutes */
  const need = [G, G, G, G, G];
  /* ITS REAL STARTERS FIRST (Louie, 2026-10-14: "Can IRL teams also use their real ... rotations?"): the five it starts
     (o.starters, from its games' starting fives, the recent ones counting most) each to the open position he plays most,
     the most-used first; they open and close every quarter, and nobody moves them */
  const starters = o && o.starters ? new Set([...o.starters].map(String)) : null;
  if (starters) {
    /* a starter is one of the season's regulars (its eight most-used men): the minutes here are the season's, so a late
       signing or a man who lost his place, starting of late, is not made to open every quarter (a club built that way
       played nothing like its season: CEBL 2026's clubs, whose rosters turn over in the summer, 2026-10-14) */
    const st = men.slice(0, 8).filter(p => starters.has(p.id));
    if (st.length >= 3) {
      const open = new Set([0, 1, 2, 3, 4]);
      st.forEach(p => {
        let best = -1, sc = -Infinity;
        open.forEach(k => { const v = p.share[k] - 0.25 * Math.abs(k - slotOf(p)); if (v > sc) { sc = v; best = k; } });
        if (best >= 0) { p.slot = best; p.starter = true; depth[best].push(p); need[best] -= p.mpg; open.delete(best); }
      });
    }
  }
  men.forEach(p => {
    if (p.starter) return;
    const own = slotOf(p);
    let best = own, score = -Infinity;
    [0, 1, 2, 3, 4].forEach(k => {
      const d = Math.abs(k - own);
      if (d > 1 && p.share[k] < 0.15) return;
      /* the position still to fill, less a little for playing away from his own (less where he plays some of his time) */
      const sc = need[k] - (k === own ? 0 : 6 * (1 - p.share[k]) * d);
      if (sc > score) { score = sc; best = k; }
    });
    p.slot = best; depth[best].push(p); need[best] -= p.mpg;
  });
  /* A THIN POSITION - nobody there, or a starter with nobody behind him to spell him (he would pass 90% of the game) -
     takes a man from a position that can spare one (it keeps two men and most of a game), the one with the most of his
     minutes at the thin position; a man moves once, so nothing swings back and forth */
  const tot = k => depth[k].reduce((a, p) => a + p.mpg, 0);
  const top = k => (depth[k].length ? Math.max(...depth[k].map(p => p.mpg)) : 0);
  const thinAt = k => !depth[k].length || tot(k) < 0.5 * G || (tot(k) - top(k)) / tot(k) < 0.12;
  const moved = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const thin = [0, 1, 2, 3, 4].filter(thinAt).sort((a, b) => tot(a) - tot(b));
    if (!thin.length) break;
    const k = thin[0];
    const cands = men.filter(p => p.slot !== k && !p.starter && !moved.has(p.id) && depth[p.slot].length >= 3 - (tot(p.slot) - p.mpg >= 0.9 * G ? 1 : 0)
      && p.mpg < top(p.slot) && tot(p.slot) - p.mpg >= 0.7 * G)
      .sort((a, b) => (Math.abs(a.slot - k) - Math.abs(b.slot - k)) || (b.share[k] - a.share[k]) || (a.mpg - b.mpg));
    const c = cands[0];
    if (!c) break;
    depth[c.slot] = depth[c.slot].filter(x => x !== c); c.slot = k; depth[k].push(c); moved.add(c.id);
  }
  if (depth.some(d => !d.length)) return [];
  /* each position's minutes fill the game */
  const plan = depth.map(d => {
    const tot = d.reduce((a, p) => a + p.mpg, 0), f = tot > 0 ? G / tot : 0;
    const mins = d.map(p => Math.min(0.9 * G, p.mpg * f));
    /* a cap that leaves the position short: the rest to the others there, then to the starter past the cap */
    let left = G - mins.reduce((a, v) => a + v, 0);
    for (let i = 0; i < mins.length && left > 1e-9; i++) { const add = Math.min(left, 0.9 * G - mins[i]); if (add > 0) { mins[i] += add; left -= add; } }
    if (left > 1e-9) mins[0] += left;
    return d.map((p, i) => ({ id: p.id, min: mins[i], st: !!p.starter })).sort((a, b) => (b.st - a.st) || (b.min - a.min));
  });
  /* the clock, a position at a time: per quarter the starter opens (60% of his quarter) and closes (40%) */
  const q = G / 4, cuts = new Set([0, G]), lanes = plan.map(list => {
    const out = [];
    for (let k = 0; k < 4; k++) {
      let t = k * q;
      const sh = list.map(x => x.min / 4);
      const put = (id, d) => { if (d > 1e-9) { out.push({ t0: t, t1: t + d, id }); t += d; } };
      put(list[0].id, 0.6 * sh[0]);
      for (let j = 1; j < list.length; j++) put(list[j].id, sh[j]);
      put(list[0].id, 0.4 * sh[0]);
      out[out.length - 1].t1 = (k + 1) * q;
    }
    out.forEach(s => { cuts.add(+s.t0.toFixed(6)); cuts.add(+s.t1.toFixed(6)); });
    return out;
  });
  const times = [...cuts].sort((a, b) => a - b), segs = [];
  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i], b = times[i + 1], mid = (a + b) / 2;
    if (b - a < 1e-6) continue;
    segs.push({ t0: a, t1: b, ids: lanes.map(lane => { const s = lane.find(x => x.t0 <= mid && mid < x.t1) || lane[lane.length - 1]; return s.id; }) });
  }
  return mergeSame(segs);
}
function mergeSame(segs) {
  const out = [], rk = s => (s.roles ? s.roles.join(',') : '');
  segs.forEach(s => {
    const last = out[out.length - 1];
    if (last && last.ids.join('|') === s.ids.join('|') && last.tac === s.tac && rk(last) === rk(s) && last.li === s.li && Math.abs(last.t1 - s.t0) < 1e-6) last.t1 = s.t1;
    else {
      const o = { t0: s.t0, t1: s.t1, ids: s.ids.slice(), tac: s.tac };
      if (s.roles) o.roles = s.roles.slice();
      if (s.li != null) o.li = s.li;
      out.push(o);
    }
  });
  return out;
}
/* minutes each man plays on a timeline */
function minutesOf(segs) {
  const m = new Map();
  segs.forEach(s => s.ids.forEach(id => m.set(id, (m.get(id) || 0) + (s.t1 - s.t0))));
  return m;
}
/* two timelines on one clock: the stretches where both fives are the same */
function overlay(A, B) {
  const cuts = new Set();
  A.concat(B).forEach(s => { cuts.add(+s.t0.toFixed(6)); cuts.add(+s.t1.toFixed(6)); });
  const times = [...cuts].sort((a, b) => a - b), out = [];
  const at = (S, t) => S.find(s => s.t0 <= t && t < s.t1) || S[S.length - 1];
  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i], b = times[i + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    out.push({ t0: a, t1: b, a: at(A, mid), b: at(B, mid) });
  }
  return out;
}

/* ------------------------------------------------------------------ one game --- */
/* the matchups' rates put together by the possessions each stretch plays (the mixture of the chains' per-chance rates) */
function mixRates(list) {
  const out = {};
  const W = list.map(x => x.w / Math.max(1e-9, x.r.d + (x.o ? x.o.d : x.r.d)));
  const wsum = (f, w) => { let s = 0, t = 0; list.forEach((x, i) => { const ww = (w ? w(x, i) : 1) * W[i]; s += ww * f(x.r); t += ww; }); return t > 0 ? s / t : 0; };
  out.d = wsum(r => r.d);
  out.tov = wsum(r => r.tov);
  out.live = wsum(r => r.live, x => x.r.tov);
  out.sfoul = wsum(r => r.sfoul, x => 1 - x.r.tov); out.bonus = wsum(r => r.bonus, x => 1 - x.r.tov);
  const shot = x => (1 - x.r.tov) * Math.max(0.05, 1 - x.r.sfoul - x.r.bonus);
  out.mixRim = wsum(r => r.mixRim, shot); out.mixMid = wsum(r => r.mixMid, shot); out.mix3 = wsum(r => r.mix3, shot);
  out.pRim = wsum(r => r.pRim, x => shot(x) * x.r.mixRim); out.pMid = wsum(r => r.pMid, x => shot(x) * x.r.mixMid); out.p3 = wsum(r => r.p3, x => shot(x) * x.r.mix3);
  out.p2 = wsum(r => r.p2, x => shot(x) * (1 - x.r.mix3));
  const makes = r => r.mixRim * r.pRim + r.mixMid * r.pMid + r.mix3 * r.p3;
  out.and1 = wsum(r => r.and1, x => shot(x) * makes(x.r));
  out.ft = wsum(r => r.ft, x => (1 - x.r.tov) * (x.r.sfoul + x.r.bonus));
  out.orb = wsum(r => r.orb, x => shot(x) * (1 - makes(x.r)));
  out.tr = wsum(r => r.tr);
  return out;
}
/* a seeded generator (mulberry32) */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* WHAT A BALL-SCREEN COVERAGE MEETS IN A MAN (Louie, 2026-10-15: "drop coverage hurts rim-bound players with no
   inbetween game who are set to slashing", "how hedging affects ball handlers w/ weaker handles"): how much of his game
   comes off ball screens as the handler (x: his time on the ball) and as the screener (y: rolling, popping, short-rolling,
   handing off), and against the league's handlers - each on a scale where ±1 is about their 10th/90th percentile,
   measured on four leagues' rotations 2025-26 (17,100 stints): his ball security FOR HIS TIME ON THE BALL (turnovers rise
   with it: logit 1.1 a unit of it), his passing, how rim-bound he is, his mid-range making and his pull-up three */
const COV = { tovA: -0.252, tovB: 1.105, tovS: 0.25, pass0: 1.03, passS: 0.25, rimS: 0.5, mid0: -0.02, midS: 0.22, pullS: 0.3 };
function covTraits(p, ref) {
  const c = p.c, onb = isNum(p.onb) ? p.onb : p.natInit, d = p.R ? p.R.diet : null;
  const scr = d ? (d.roll || 0) + (d.pop || 0) + (d.short || 0) : 0;
  const y = d ? scr + 0.5 * (d.dho || 0) : (p.k === 4 ? 0.3 : p.k === 3 ? 0.2 : 0.03);
  const popF = d ? (scr > 0 ? (d.pop || 0) / scr : 0) : clamp(((c.mixRel ? c.mixRel.three : 1) - 0.4) / 1.2, 0, 1);
  const shortF = d && scr > 0 ? (d.short || 0) / scr : 0;
  const zs = (v, sd) => clamp(v / sd, -1.5, 2);
  const un3 = c.un && isNum(c.un.three) ? c.un.three : (ref && ref.un ? ref.un.three : 0.12), un0 = ref && ref.un ? Math.max(0.02, ref.un.three) : 0.12;
  return {
    x: clamp(1.5 * (isNum(onb) ? onb : 0.2), 0, 0.65), y: clamp(y, 0, 0.8), popF: clamp(popF, 0, 1), shortF: clamp(shortF, 0, 1),
    loose: zs((isNum(c.off.dTov) ? c.off.dTov : 0) - (COV.tovA + COV.tovB * (isNum(onb) ? onb : 0.2)), COV.tovS),
    pass: zs(p.passQ - COV.pass0, COV.passS), rim: zs((c.mixRel ? c.mixRel.rim : 1) - 1, COV.rimS),
    mid: zs((isNum(c.off.dMid) ? c.off.dMid : 0) - COV.mid0, COV.midS),
    pull: zs((c.p3Rel || 1) * (0.5 + 0.5 * clamp(un3 / un0, 0, 3)) - 1, COV.pullS), p3: c.p3Rel || 1, passQ: p.passQ,
    /* as the screener's man: how well he plays a drop (his rim protection) and a hedge (his feet) - coverQ */
    rp: coverQ(c, ref).rp, mq: coverQ(c, ref).mq
  };
}
/* A BIG AS THE SCREENER'S MAN: the coverage read from his game, and how well he plays each - a drop as well as he protects
   the rim (his blocks against his position's, the rim points he saves on the floor: season.js rim on/off), a hedge as
   quick as his feet (his steals against his position's) */
function coverQ(c, ref) {
  const C = CARDS(), at = st => (C && C.atPos && ref ? C.atPos(ref, c.pos, st) : null);
  const bq = c.def && isNum(c.def.blk) && at('blk_pct') > 0 ? c.def.blk / at('blk_pct') : 1, sq = c.def && isNum(c.def.stl) && at('stl_pct') > 0 ? c.def.stl / at('stl_pct') : 1;
  const save = c.def && isNum(c.def.rimSave) ? c.def.rimSave : 0;
  const rp = clamp(0.5 + 0.5 * clamp(bq, 0.1, 4) + 0.05 * clamp(save, -4, 8), 0.5, 1.8), mq = clamp(0.5 + 0.5 * clamp(sq, 0.2, 3), 0.5, 1.8);
  const cov = !(c.pos >= 3.5) ? 'cont' : (bq >= 1.2 || save >= 2.5) && sq < 1.15 ? 'drop' : sq >= 1.2 && bq < 1.2 ? 'hedge' : 'cont';
  return { cov, rp, mq };
}
/* THE COVERAGE A REAL CLUB'S BIG PLAYS, read from his game (FM's opponents have their tactics too; Louie, 2026-10-15:
   "opponent has a good drop big with good rim defense"): a rim protector who does not move far from it drops, a big with
   quick feet who does not block much hedges, the others contain. His club's numbers already hold what its coverage does
   on average: only what it does against particular handlers is added (interact: coverage) */
function inferCover(c, ref) { return c ? coverQ(c, ref).cov : 'cont'; }
/* A LEAGUE'S OWN COVERAGE: the drop and the hedge its bigs play, on their minutes and as well as each plays it - what its
   clubs' numbers already hold, so a coverage is measured against it (four leagues 2025-26: about 0.36 and 0.07) */
const COV_MIX = { drop: 0.36, hedge: 0.07 };
function coverMix(rows, cards, ref) {
  let w = 0, dr = 0, hd = 0;
  (rows || []).forEach(r => {
    const c = cards && cards.get(String(r.id)), m = +r.min || 0;
    if (!c || !(c.pos >= 3.5) || !(m > 0)) return;
    const q = coverQ(c, ref);
    w += m; if (q.cov === 'drop') dr += m * q.rp; else if (q.cov === 'hedge') hd += m * q.mq;
  });
  return w > 0 ? { drop: dr / w, hedge: hd / w } : Object.assign({}, COV_MIX);
}
/* THE BALL-SCREEN COVERAGE AGAINST THESE HANDLERS AND SCREENERS (each big's coverage: his own instruction, or the one his
   club plays with him): a handler meets the coverage of the men guarding his screeners, as often as each screens - on the
   plays he runs off them (x) - and every effect is against THE LEAGUE'S OWN COVERAGE (coverMix: its clubs' numbers
   already hold it), so a club facing the usual mix is untouched.
     DROP (the big back at the rim): a handler's finishes at the rim are harder, as hard as the dropping big protects it -
       and less so when the screener pops (the big dragged out of the paint: the stretch big's point); the pull-up and the
       floater are there for him (the deeper the big, the more), and the pull-up three for a man who takes them. Even
       for a handler with the league's pick-and-roll shot mix; a rim-bound one with no in-between game pays (more of his
       shots at the rim, few and poor from mid-range), a pull-up shooter gains. As the screener: a roller finishes into
       the rim protector, a popper is open behind him.
     HEDGE (the big jumping out, as quick as his feet): loose handles and a poor passer turn it over, a sure-handed passer
       hardly; it takes the pull-up away; the roller - and a short roller making the play - gets the 4-on-3, the more so
       for a good passer.
     CONTAIN: the even middle.
   o's men and d's in the order of their places (each guarding his own place's man). */
const COVK = { rim: 0.30, mid: 0.12, pull3: 0.06, hedge: 0.30, pull: 0.06, roll: 0.35, pop: 0.30, roll4: 0.20, short: 0.12 };
function coverage(o, d) {
  const OM = o && o.men, DM = d && d.men;
  if (!OM || !DM) return null;
  /* against the league's own coverage (none known: against none, so only a coverage played counts) */
  const mix = d.covMix || { drop: 0, hedge: 0 }, D0 = mix.drop || 0, H0 = mix.hedge || 0, D0R = 0.9 * D0;
  if (!(D0 > 0 || H0 > 0) && !DM.some(m => m.cov && m.cov !== 'cont')) return null;
  const y = OM.map(m => (m.cv ? m.cv.y : 0));
  const seen = i => {
    let t = 0, hd = 0, dS = 0, dR = 0;
    OM.forEach((m, j) => {
      if (j === i || !(y[j] > 0)) return;
      t += y[j];
      const D = DM[j] || {}, q = D.cv || {};
      if (D.cov === 'hedge') hd += y[j] * (q.mq || 1);
      else if (D.cov === 'drop') { dS += y[j] * (q.rp || 1); dR += y[j] * (q.rp || 1) * (1 - 0.6 * (m.cv ? m.cv.popF : 0)); }
    });
    return t > 0 ? { h: hd / t - H0, dS: dS / t - D0, dR: dR / t - D0R } : { h: 0, dS: 0, dR: 0 };
  };
  let pw = 0, ps = 0;
  OM.forEach(m => { if (m.cv) { pw += m.cv.x; ps += m.cv.x * clamp(m.cv.passQ, 0.5, 1.8); } });
  const passH = pw > 0 ? ps / pw : 1;
  return OM.map((m, i) => {
    const t = m.cv, e = { tov: 0, p: { rim: 0, mid: 0, three: 0 } };
    if (!t) return e;
    const c = seen(i), x = t.x;
    e.p.rim -= COVK.rim * x * c.dR;
    e.p.mid += COVK.mid * x * c.dS;
    e.p.three += COVK.pull3 * x * c.dS * clamp(t.pull, -0.5, 1.5);
    const pu = Math.max(0, t.mid + t.pull);
    e.tov += COVK.hedge * c.h * x * (0.6 * t.loose - 0.45 * t.pass);
    e.p.mid -= COVK.pull * c.h * x * pu; e.p.three -= COVK.pull * c.h * x * pu;
    /* as the screener, against his own man's coverage (and the league's) */
    if (t.y > 0) {
      const Dm = DM[i] || {}, dq = Dm.cv || {}, rollF = Math.max(0, 1 - t.popF - t.shortF);
      const od = (Dm.cov === 'drop' ? dq.rp || 1 : 0) - D0, oh = (Dm.cov === 'hedge' ? dq.mq || 1 : 0) - H0;
      e.p.rim -= COVK.roll * t.y * rollF * od;
      e.p.three += COVK.pop * t.y * t.popF * clamp(t.p3, 0.6, 1.5) * od;
      e.p.rim += COVK.roll4 * t.y * rollF * clamp(passH, 0.6, 1.6) * oh;
      ZONES.forEach(z => { e.p[z] += COVK.short * t.y * t.shortF * clamp(t.passQ, 0.6, 1.6) * oh; });
    }
    return e;
  });
}
/* WHAT ONE FIVE'S DEFENCE DOES TO THE OTHER FIVE IN PARTICULAR: a packed paint (the defence's scheme > 0) costs the rim
   makes of a five that cannot space it and is punished by one that can (SYN.pack a unit of spacing from the league's
   five); the ball-screen coverage against these handlers and screeners (coverage: the five's change here, each man's
   difference from it in out.cov for core/match.js). r is the offence's blended rates (winsim matchup), o the offence's
   side, d the defence's */
function interact(r, o, d) {
  let out = r;
  const pack = d && d.tac ? Math.max(0, d.tac.scheme || 0) : 0;
  if (pack > 0 && o && o.five) {
    out = Object.assign({}, r);
    const sp = clamp(o.five.spacing - 1, -0.8, 0.8);
    out.pRim = expit(logit(r.pRim) + SYN.pack * pack * sp);
    out.p2 = expit(logit(r.p2) + SYN.pack * pack * sp * (r.mixRim / Math.max(0.01, r.mixRim + r.mixMid)));
  }
  const cv = coverage(o, d);
  if (cv) {
    if (out === r) out = Object.assign({}, r);
    const sh = o.men.map(m => (isNum(m.s) ? m.s : 0.2)), S5 = sh.reduce((a, v) => a + v, 0) || 1;
    const dT = o.men.reduce((a, m, i) => a + sh[i] * cv[i].tov, 0) / S5, dz = {};
    ZONES.forEach(z => { let w = 0, v = 0; o.men.forEach((m, i) => { const ww = sh[i] * (m.m && isNum(m.m[z]) ? m.m[z] : 1 / 3); w += ww; v += ww * cv[i].p[z]; }); dz[z] = w > 0 ? v / w : 0; });
    out.tov = expit(logit(out.tov) + dT);
    out.pRim = expit(logit(out.pRim) + dz.rim); out.pMid = expit(logit(out.pMid) + dz.mid); out.p3 = expit(logit(out.p3) + dz.three);
    out.p2 = expit(logit(out.p2) + (dz.rim * out.mixRim + dz.mid * out.mixMid) / Math.max(0.01, out.mixRim + out.mixMid));
    out.cov = new Map(o.men.map((m, i) => [m.id, { tov: cv[i].tov - dT, p: { rim: cv[i].p.rim - dz.rim, mid: cv[i].p.mid - dz.mid, three: cv[i].p.three - dz.three } }]));
  }
  return out;
}
/* a team in a game: {id, segs: [{t0, t1, ids, tac}], cards: Map id -> card, form?: Map}. X: {L, ref, seed, G, mins?} */
function prepareSides(T, X, G) {
  const mins = minutesOf(T.segs), cache = new Map();
  const sideFor = s => {
    /* the roles at the five's positions (the reader's lineups; a real club's stretches have none: undefined, its men's
       own games) - a position with no role chosen plays the position's default */
    const roles = Array.isArray(s.roles) ? s.roles : null;
    const tac = normTac(s.tac || T.tac), key = s.ids.join('|') + '#' + tacKey(tac) + '#' + insKey(T.ins) + '#' + (roles ? roles.map(r => r || '').join(',') : '-');
    if (cache.has(key)) return cache.get(key);
    const five = s.ids.map((id, k) => ({ card: T.cards.get(String(id)), k, role: roles ? (roles[k] || null) : undefined })).filter(x => x.card);
    if (five.length !== 5) throw new Error('a five is missing a player: ' + s.ids.join(','));
    const side = sideOf(five, { mu: X.L.rates, ref: X.ref, tac, mins, form: T.form || X.form, G, zones: X.L.zones, dTr: X.L.dTr || 0, ins: T.ins || null, cov: T.cov || null, covMix: X.covMix || null });
    /* the five's own rates before its club's identity: each man's rates are read against them (core/match.js) */
    side.off0 = side.off; side.def0 = side.def;
    if (T.identity && T.identity.length) {
      const P = applyIdentity(side, T.identity, X.L);
      side.off = P.off; side.def = P.def;
    }
    cache.set(key, side);
    return side;
  };
  return { mins, sideFor };
}
function play(H, A, X) {
  const S = SIM(), G = X.G || Math.round((X.L.T || 2400) / 60), home = X.home != null ? X.home : 1;
  const seed = X.seed != null ? X.seed >>> 0 : hashOf(H.id + '|' + A.id);
  const h = prepareSides(H, X, G), a = prepareSides(A, X, G);
  const stretches = overlay(H.segs, A.segs).map(o => {
    const sh = h.sideFor(o.a), sa = a.sideFor(o.b);
    const M = S.matchup({ off: sh.off, def: sh.def, n: 0 }, { off: sa.off, def: sa.def, n: 0 }, X.L, { home });
    return { w: (o.t1 - o.t0) / G, t0: o.t0, t1: o.t1, rH: interact(M.r[0], sh, sa), rA: interact(M.r[1], sa, sh), sh, sa, segH: o.a, segA: o.b };
  });
  const rH = mixRates(stretches.map(x => ({ w: x.w, r: x.rH, o: x.rA }))), rA = mixRates(stretches.map(x => ({ w: x.w, r: x.rA, o: x.rH })));
  const M = S.matchFrom(rH, rA, X.L, { home });
  const trace = [];
  const res = S.game(M, rng(seed), rng(seed ^ 0x85EBCA6B), { trace: (k, s, a, b, c, d) => trace.push([k, s, a, b, c, d]) });
  const P = pbp(stretches, trace, X, G, rng(seed ^ 0x9E3779B9), rng(seed ^ 0x2545F491));
  return { pts: res.pts, ot: res.ot, poss: res.poss, tally: res.tally, box: P.box, events: P.events,
    lineups: stretches.map(x => ({ t0: x.t0, t1: x.t1, h: x.sh.men.map(m => m.id), a: x.sa.men.map(m => m.id) })), rates: [rH, rA], stretches: stretches.length };
}
/* the chance of winning and the expected margin of one side against another (n games, the same stretches every game) */
function preview(H, A, X, n) {
  const S = SIM(), G = X.G || Math.round((X.L.T || 2400) / 60), home = X.home != null ? X.home : 1;
  const h = prepareSides(H, X, G), a = prepareSides(A, X, G);
  const stretches = overlay(H.segs, A.segs).map(o => {
    const sh = h.sideFor(o.a), sa = a.sideFor(o.b);
    const M = S.matchup({ off: sh.off, def: sh.def, n: 0 }, { off: sa.off, def: sa.def, n: 0 }, X.L, { home });
    return { w: (o.t1 - o.t0) / G, rH: interact(M.r[0], sh, sa), rA: interact(M.r[1], sa, sh) };
  });
  const rH = mixRates(stretches.map(x => ({ w: x.w, r: x.rH, o: x.rA }))), rA = mixRates(stretches.map(x => ({ w: x.w, r: x.rA, o: x.rH })));
  const M = S.matchFrom(rH, rA, X.L, { home });
  const N = n || 400, seed = X.seed != null ? X.seed >>> 0 : 7;
  let w = 0, m = 0, ph = 0, pa = 0;
  for (let i = 0; i < N; i++) {
    const r = S.game(M, rng(seed + i * 7919), rng((seed + i * 7919) ^ 0x85EBCA6B));
    const d = r.pts[0] - r.pts[1];
    if (d > 0) w++;
    m += d; ph += r.pts[0]; pa += r.pts[1];
  }
  const ppp = r => S.markov({ r: [r, r], zones: M.zones, L: M.L }, 0).ppp;
  return { pWin: w / N, margin: m / N, pts: [ph / N, pa / N], n: N, ppp: [ppp(rH), ppp(rA)], rates: [rH, rA] };
}

/* ------------------------------------------------------------------ the play-by-play --- */
/* THE GAME, POSSESSION BY POSSESSION (Louie, 2026-10-09: box scores like EPINOIA's - "the traditional and modern box
   scores + full stats + events + lineups + game flow"). winsim's trace is the game as it was played - each possession,
   each shot from its zone and whether it went in, each turnover, foul trip and board - and every event is given to a
   man of the five on the floor at that moment (the stretch the clock is in; overtime is the closers'):
     a shot to the men by how much of the five's shots each takes from that zone and how well (a make more likely his
     who makes them); an assist on a make by his own assisted share at that zone, to a teammate by AST%; a block on a
     missed two by the defending five's BLK%; a board by ORB% or DRB%; a turnover by his turnover rate, a steal on a live
     one by STL%; a foul trip to who draws them, the foul to a defender by his fouls; a few fouls a game that give no
     free throws, at random possessions. So the box score is the events summed, plus-minus is who was on for each
     point, and a lineup's numbers are its stretch's. Seeded: the same game, the same play-by-play. */
const ZN = ['rim', 'mid', 'three', 'two'];
const pickBy = (R, list, w) => {
  let tot = 0;
  for (const x of list) tot += Math.max(0, w(x) || 0);
  if (!(tot > 0)) return list.length ? list[Math.floor(R() * list.length)] : null;
  let r = R() * tot;
  for (const x of list) { r -= Math.max(0, w(x) || 0); if (r < 0) return x; }
  return list[list.length - 1];
};
const zShare = (m, z) => (z === 3 ? m.m.rim + m.m.mid : m.m[ZN[z]]);
const zMake = (m, z) => (z === 3 ? (m.m.rim * m.p.rim + m.m.mid * m.p.mid) / Math.max(1e-6, m.m.rim + m.m.mid) : m.p[ZN[z]]);
const zAst = (m, z) => { const u = m.un || {}; return 1 - (z === 3 ? ((u.rim || 0.4) + (u.mid || 0.5)) / 2 : (u[ZN[z]] != null ? u[ZN[z]] : 0.4)); };
/* THE CLOCK OF A PLAY-BY-PLAY (Louie, 2026-10-09: the box score's transition points and its shot clock read the clock,
   as EPINOIA's do). The game gives every possession of a side the same length - its pace - and that is all a result
   needs; a play-by-play's possession lasts as long as what happened in it. So each quarter's possessions (each
   overtime's) are laid out again inside it: a break 2-6 s from the ball changing hands to its first shot, a put-back
   2-5 s after the board before it, a set play's last chance late in its possession and the time the breaks saved
   shared among the set plays, each a little longer or shorter by chance - every quarter keeping its length and its
   possessions. Only the clock moves (on draws of its own, RT): who did what is drawn as before.
     -> { at: each trace entry's second, poss: trace index of a possession -> {s start, L length, B0/B1 its quarter, fT} } */
function clockOf(trace, T, Tot, RT) {
  const at = new Float64Array(trace.length), poss = new Map(), blocks = [];
  let ot = 0, p = null, blk = null, bkey = null;
  for (let i = 0; i < trace.length; i++) {
    const [k, , a, b, c, d] = trace[i];
    if (k === 'Q') { ot = a; p = null; at[i] = ot === 0 ? 0 : T + (ot - 1) * Tot; continue; }
    if (k === 'P') {
      const q = ot === 0 ? Math.min(3, Math.max(0, Math.floor(b / (T / 4) + 1e-9))) : 3 + ot;
      if (q !== bkey) { bkey = q; blk = { B0: ot === 0 ? q * T / 4 : T + (ot - 1) * Tot, B1: ot === 0 ? (q + 1) * T / 4 : T + ot * Tot, list: [] }; blocks.push(blk); }
      p = { i, B0: blk.B0, B1: blk.B1, dur: c, fouled: !!d, ch: [], tr: false };
      blk.list.push(p); poss.set(i, p);
      continue;
    }
    /* a chance ends in a shot, a trip to the line (an and-one's goes with its shot) or a turnover */
    if (p && (k === 'S' || k === 'T' || (k === 'F' && a !== 2))) { if (!p.ch.length && k === 'S' && c) p.tr = true; p.ch.push(i); }
  }
  blocks.forEach(B => {
    const len = B.B1 - B.B0, L0 = B.list.reduce((a, x) => a + x.dur, 0);
    let fixed = 0, wsum = 0, nHalf = 0;
    B.list.forEach(x => {
      const n = Math.max(1, x.ch.length);
      if (x.fouled) { x.L = Math.min(x.dur, 3); fixed += x.L; }
      else if (x.tr) { x.g = [2 + 4 * RT()]; for (let j = 1; j < n; j++) x.g.push(2 + 3 * RT()); x.L = x.g.reduce((a, g) => a + g, 0) + 1 + RT(); fixed += x.L; }
      else { x.w = x.dur * (0.6 + 0.8 * RT()); wsum += x.w; nHalf++; }
    });
    const room = len - fixed;
    if (nHalf && room >= 6 * nHalf) B.list.forEach(x => { if (x.w != null) x.L = room * x.w / wsum; });
    else B.list.forEach(x => { x.tr = false; x.L = x.dur * len / L0; });     // (never in a real game) the game's own even clock
    let s = B.B0;
    B.list.forEach(x => { x.s = s; s += x.L; });
    B.list.forEach(x => {
      const n = x.ch.length, end = x.s + x.L, tt = [];
      if (x.fouled) { let t = x.s + Math.min(x.L / 2, 0.8 + RT()); for (let j = 0; j < n; j++) { tt.push(t); t = Math.min(end - 0.2, t + 1.5); } }
      else if (x.tr) { let t = x.s; for (let j = 0; j < n; j++) { t += x.g[j]; tt.push(t); } }
      else if (n) {
        /* backwards from late in the possession: the last chance 0.6-1.4 s before its end, a put-back 2-5 s after a board */
        const last = end - 0.6 - 0.8 * RT(), gaps = [];
        for (let j = 1; j < n; j++) gaps.push(2 + 3 * RT());
        const span = gaps.reduce((a, g) => a + g, 0), avail = Math.max(0, last - (x.s + 1.5)), f = span > avail ? avail / span : 1;
        let t = last - span * f;
        tt.push(t);
        gaps.forEach(g => { t += g * f; tt.push(t); });
      }
      /* its entries: the start, each chance, an and-one with its shot, a board 0.8 s after the miss */
      at[x.i] = x.s;
      let j = -1;
      for (let i = x.i + 1; i < trace.length && trace[i][0] !== 'P' && trace[i][0] !== 'Q'; i++) {
        const k = trace[i][0], a = trace[i][2];
        if (k === 'S' || k === 'T' || (k === 'F' && a !== 2)) at[i] = tt[++j];
        else if (k === 'O' || k === 'D') at[i] = j < 0 ? x.s : Math.min(tt[j] + 0.8, j + 1 < n ? (tt[j] + tt[j + 1]) / 2 : end - 0.15);
        else at[i] = j < 0 ? x.s : tt[j];
      }
      /* a foul off the ball, before the first chance */
      x.fT = x.s + ((n ? tt[0] : end) - x.s) * (0.25 + 0.5 * RT());
    });
  });
  return { at, poss };
}

function pbp(stretches, trace, X, G, R, RT) {
  const L = X.L, T = L.T || G * 60, Tot = L.Tot || 300, limit = G >= 48 ? 6 : 5;
  const at = min => { for (const x of stretches) if (min >= x.t0 && min < x.t1) return x; return stretches[stretches.length - 1]; };
  const box = [new Map(), new Map()];
  const line = (q, id) => {
    if (!box[q].has(id)) box[q].set(id, { id, min: 0, pts: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, rimM: 0, rimA: 0, midM: 0, midA: 0,
      oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 });
    return box[q].get(id);
  };
  /* every man of the rotation has a line; his minutes are the possessions he was on the floor for (so the box's
     minutes are the play-by-play's, substitution for substitution) */
  stretches.forEach(x => [0, 1].forEach(q => (q ? x.sa : x.sh).men.forEach(m => { line(q, m.id); })));
  const C = clockOf(trace, T, Tot, RT || rng(0x5EED1E55));
  const events = [], score = [0, 0];
  let t = 0, lo = 0, hi = 1, cur = stretches[0], lastMade = null, ot = 0, poss = 0;
  const five = q => (q ? cur.sa : cur.sh).men;
  /* to the second, and never out of its quarter */
  const add = (e, tm) => { e.t = Math.max(lo, Math.min(hi - 1, Math.round(tm != null ? tm : t))); events.push(e); };
  const scored = (q, pts) => {
    if (!pts) return;
    score[q] += pts;
    [0, 1].forEach(w => five(w).forEach(m => { line(w, m.id).pm += w === q ? pts : -pts; }));
  };
  const fouler = q => {
    const ok = five(q).filter(m => line(q, m.id).pf < limit);
    const m = pickBy(R, ok.length ? ok : five(q), x => x.pf);
    if (m) line(q, m.id).pf++;
    return m ? m.id : null;
  };
  for (let i = 0; i < trace.length; i++) {
    const [k, side, a, b, c] = trace[i];
    t = C.at[i];
    if (k === 'Q') { ot = a; lo = t; hi = t + 1; cur = at(a === 0 ? 0 : G - 1e-6); add({ k: 'Q', p: a }); continue; }
    if (k === 'P') {
      const p = C.poss.get(i);
      lo = p.B0; hi = p.B1;
      cur = at(ot === 0 ? p.s / 60 : G - 1e-6); poss++;
      [0, 1].forEach(w => five(w).forEach(m => { line(w, m.id).min += p.L / 60; }));
      add({ k: 'P', s: side, st: a, f: p.fouled ? 1 : 0, l: stretches.indexOf(cur) });
      /* a foul that gives no free throws (before the bonus, on the ball, off it): a few a game, by the defence */
      if (!p.fouled && R() < 0.085) { const f = fouler(side ^ 1); add({ k: 'f', s: side ^ 1, p: f }, p.fT); }
      continue;
    }
    const q = side;
    if (k === 'S') {
      const z = a, made = !!b, list = five(q);
      const sh = pickBy(R, list, m => m.s * (1 - m.tov) * (1 - m.trip) * zShare(m, z) * (made ? zMake(m, z) : 1 - zMake(m, z)));
      const L1 = line(q, sh.id), val = z === 2 ? 3 : 2;
      L1.fga++; if (z === 2) L1.p3a++; else if (z === 0) L1.rimA++; else if (z === 1) L1.midA++;
      let ast = null, blk = null;
      if (made) {
        L1.fgm++; L1.pts += val; if (z === 2) L1.p3m++; else if (z === 0) L1.rimM++; else if (z === 1) L1.midM++;
        if (R() < zAst(sh, z)) { const a1 = pickBy(R, list.filter(m => m !== sh), m => m.ast); if (a1) { line(q, a1.id).ast++; ast = a1.id; } }
        lastMade = sh;
      } else if (z !== 2) {
        const blk5 = five(q ^ 1).reduce((x, m) => x + m.blk, 0) / 100;
        if (R() < Math.min(0.45, blk5 / Math.max(0.25, 1 - zMake(sh, z)))) { const bl = pickBy(R, five(q ^ 1), m => m.blk); if (bl) { line(q ^ 1, bl.id).blk++; blk = bl.id; } }
      }
      add({ k: 'S', s: q, z, m: made ? 1 : 0, tr: c ? 1 : 0, p: sh.id, a: ast, b: blk });
      if (made) scored(q, val);
      continue;
    }
    if (k === 'F') {
      const kind = a, n = b, made = c, list = five(q);
      const sh = kind === 2 && lastMade && list.includes(lastMade) ? lastMade
        : kind === 3 ? pickBy(R, list, m => m.ft * (0.4 + m.s)) : pickBy(R, list, m => m.s * m.trip * (kind === 1 ? 0.4 + m.m.rim : 1));
      const f = fouler(q ^ 1), L1 = line(q, sh.id);
      L1.fta += n; L1.ftm += made; L1.pts += made;
      add({ k: 'F', s: q, kind, n, m: made, p: sh.id, f });
      scored(q, made);
      continue;
    }
    if (k === 'T') {
      const tv = pickBy(R, five(q), m => m.s * m.tov);
      line(q, tv.id).tov++;
      let st = null;
      if (a) { const sl = pickBy(R, five(q ^ 1), m => m.stl); if (sl) { line(q ^ 1, sl.id).stl++; st = sl.id; } }
      add({ k: 'T', s: q, live: a ? 1 : 0, p: tv.id, st });
      continue;
    }
    if (k === 'O' || k === 'D') {
      const rb = pickBy(R, five(q), m => (k === 'O' ? m.orb : m.drb));
      const L1 = line(q, rb.id);
      if (k === 'O') L1.oreb++; else L1.dreb++;
      L1.reb++;
      add({ k, s: q, p: rb.id });
      continue;
    }
    if (k === 'X') { add({ k: 'X', s: q }); score[q] += 1; }
  }
  const out = [0, 1].map(q => [...box[q].values()].map(x => Object.assign(x, { min: Math.round(x.min * 10) / 10 })));
  return { box: out, events, poss };
}

return { use, sim: () => SIM(), styleOf, sideOf, handlerWeights, applyIdentity, insKey, INS, INS_MIX, HANDLER, rotation, paintOf, autoRotation, overlay, minutesOf, mixRates, interact, inferCover, coverQ, coverMix, coverage, COV_MIX, play, preview, pbp, leagueOf, identityOf, normTac, tacKey, rng, hashOf, fatigueLoad,
  TACTICS, SLOTS, KAPPA, FATIGUE, FORM, OOP, SYN, SHIFT, DR, USG_FLOOR, SKILL_L, PPP_LOGIT, FALLBACK_L, IDENTITY_K, HCA_PER, ROLEK, roleNotes };
}));
