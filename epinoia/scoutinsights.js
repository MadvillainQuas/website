'use strict';
/* ============================================================================
   THE SCOUT'S INSIGHTS (Louie, 2026-10-08): a written section on the scouting report of a club or a player - "how to
   prepare, strengths, weaknesses, using basketball language and technical terms" - from the same numbers the report's
   pages draw. On the report's tab, above the pages: never in the PDF (report.js mount, o.insights).

   What the newsroom learnt, in a scout's register:
     SALIENCE      what is said is what stands out: each measure's place among the league's clubs (a player's among his
                   position's players), how far it is from the middle, by how much the measure matters (the four factors
                   and the ratings first, a style after them). The top and bottom quarters are strengths and weaknesses;
                   the middle is not said at all.
     EVIDENCE      every claim sits next to its number and its place ("34.1% OREB, 2nd of 10"), the scout's convention
                   (the basketball-scouting-language lexicon's film-to-data bridges): "plays downhill" only with rim volume
                   and free-throw rate, "connective passer" only with a high assist rate at low usage, "rim deterrence"
                   only with opponents' rim volume. A coverage the event data cannot see (ice, drop) is never asserted:
                   what the numbers show is said, hedged where it only fits a scheme.
     VARIETY       several phrasings of each, chosen by the club or player (seeded), so two reports do not read alike.
     THE EDITOR    every line through the house voice's proof (voice.js) and the whole through the editor (scrutiny.js,
                   register 'scout': the fan's model-speak rules are off - PPP, eFG% and ORtg are a scout's words - and
                   the near-copy, claim-twice, grammar and length rules on).

     EpinoiaScoutInsights.team({ S, mine }, { name })        -> { read, strengths, weaknesses, plan, personnel, n }
     EpinoiaScoutInsights.player({ mine, field }, { name })  -> { read, strengths, weaknesses, plan, defence, n }
     EpinoiaScoutInsights.html(result, { kind, scope })      -> the section's markup
   Pure: the page hands in the rows (t/team.js ctx.season, p/player.js ctx.bars); node runs it in
   supabase/tests/scoutinsights.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaScoutInsights = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const VOICE = () => root.EpinoiaVoice || (typeof require === 'function' ? (() => { try { return require('./voice.js'); } catch (_) { return null; } })() : null);
const EDITOR = () => root.EpinoiaScrutiny || (typeof require === 'function' ? (() => { try { return require('./scrutiny.js'); } catch (_) { return null; } })() : null);
const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ord = n => { const v = Math.round(n), t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
const fx = (v, dp) => (num(v) == null ? '' : (+v).toFixed(dp == null ? 1 : dp));
const sg = (v, dp) => (num(v) == null ? '' : (+v > 0 ? '+' : +v < 0 ? '−' : '') + Math.abs(+v).toFixed(dp == null ? 1 : dp));
/* a seeded choice among phrasings: the same club or player always reads the same way, two of them seldom do */
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (seed, xs) => xs[hash(seed) % xs.length];
const fill = (s, c) => String(s).replace(/\{(\w+)\}/g, (m, k) => (c[k] == null ? '' : String(c[k])));
const proof = (t, clubs) => { const V = VOICE(); return V && V.proof ? V.proof(t, { clubs: clubs || [] }).text : String(t).trim().replace(/([^.!?])$/, '$1.'); };

/* ------------------------------------------------------------- the places --- */
/* a club's place among this season's clubs on one key ('2nd of 10'), and as a percentile on the good end (100 the best) */
function placeOf(rows, k, id, low) {
  const vals = rows.filter(r => !r.__prior && num(r[k]) != null);
  const me = vals.find(r => r.id === id);
  if (!me || vals.length < 6) return null;
  const v = +me[k];
  const r = vals.filter(x => (low ? +x[k] < v : +x[k] > v)).length + 1;
  const n = vals.length;
  return { v, r, n, pct: n > 1 ? Math.round(100 * (n - r) / (n - 1)) : 50 };
}
/* the top and the bottom quarter: two places at least, in a league of eight clubs or fewer */
const quarter = n => Math.max(2, Math.round(n / 4));
const isTop = P => P && P.r <= quarter(P.n), isBottom = P => P && P.r > P.n - quarter(P.n);
const rk = P => ord(P.r) + ' of ' + P.n;

/* ========================================================== THE CLUB'S FACETS ===
   Each: the key and its good end (low: smaller is better; style: no good end, said by how much of it there is), how much
   it matters (w), the words for the evidence, and the scout's lines - what it is when it is a strength (s) or a weakness
   (b), and what it means for the game plan (ps when they are strong at it, pb when they are weak). {v} the value, {rk}
   the place. A style says its top quarter as `s` and its bottom as `b`, neither being good or bad in itself. */
const PCT = v => fx(v) + '%', PPP = v => fx(v, 2), R1 = v => fx(v);
const TEAM = [
  /* ---------- offence ---------- */
  { id: 'o.shoot', end: 'o', k: 'ff_efg', w: 1, ev: v => PCT(v) + ' eFG',
    s: ['Shoot it well: {ev} ({rk}).', 'An efficient shooting team: {ev} ({rk}).'],
    b: ['A below-par shooting team: {ev} ({rk}).', 'Below-par shooters: {ev} ({rk}).'],
    ps: ['Contest everything: no rhythm catch-and-shoot looks, high hands on every jumper.'],
    pb: ['Make them shoot over length: pack the paint and live with contested jumpers.'] },
  { id: 'o.tov', end: 'o', k: 'ff_tov', low: true, w: 1, ev: v => PCT(v) + ' TOV%',
    s: ['Value the ball: a {ev} ({rk}).', 'Hard to turn over: {ev} ({rk}).'],
    b: ['Turnover-prone: {ev} ({rk}).', 'Loose with the ball: {ev} ({rk}).'],
    ps: ['Pressure will not rattle them: stay solid rather than gamble for steals.'],
    pb: ['Pressure the ball: show bodies early, trap the ball screen and jump the passing lanes.'] },
  { id: 'o.glass', end: 'o', k: 'ff_oreb', w: 1, ev: v => PCT(v) + ' OREB',
    s: ['Crash the offensive glass: {ev} ({rk}).', 'Live on second chances: {ev} ({rk}).'],
    b: ['Rarely get a second shot: {ev} ({rk}).', 'A one-shot offence: {ev} ({rk}).'],
    ps: ['Gang-rebound: every man finds a body on the shot, guards included, before anybody leaks out.'],
    pb: ['They do not crash: you can release a guard early and run.'] },
  { id: 'o.line', end: 'o', k: 'ff_ftr', w: 0.9, ev: v => 'FTr ' + R1(v),
    s: ['Get to the line: {ev} ({rk}).', 'Draw fouls: {ev} ({rk}).'],
    b: ['Rarely get to the line: {ev} ({rk}).'],
    ps: ['Defend without fouling: verticality at the rim, no reach-ins, keep the bigs out of foul trouble.'],
    pb: [] },
  { id: 'o.half', end: 'o', k: 'ev_half_ppp', w: 0.9, ev: v => PPP(v) + ' points per half-court chance',
    s: ['Efficient in the half court: {ev} ({rk}).', 'A good set offence: {ev} ({rk}).'],
    b: ['Struggle to score in the half court: {ev} ({rk}).', 'A poor set offence: {ev} ({rk}).'],
    ps: ['Make them earn it late in the clock: take the first option away and force a second-side read.'],
    pb: ['Take away the easy points and make them play five-on-five against a set defence.'] },
  { id: 'o.run', end: 'o', k: 'ev_transition_ppp', w: 0.8, gate: r => num(r.ev_transition_freq) == null || +r.ev_transition_freq >= 8, ev: v => PPP(v) + ' points per transition chance',
    s: ['Punish you in transition: {ev} ({rk}).', 'Dangerous on the break: {ev} ({rk}).'],
    b: ['Do little in transition: {ev} ({rk}).'],
    ps: ['Get back: sprint to the paint first, then find a man; no crashing with the fifth man.'],
    pb: [] },
  { id: 'o.ato', end: 'o', k: 'ev_ato_ppp', w: 0.55, ev: v => PPP(v) + ' points per chance after a timeout',
    s: ['Well drilled out of timeouts: {ev} ({rk}).'],
    b: [],
    ps: ['Talk out of every timeout: expect a set play, and know the switch calls before the inbound.'],
    pb: [] },
  { id: 'o.ft', end: 'o', k: 'ft_pct', w: 0.5, ev: v => PCT(v) + ' FT',
    s: [], b: ['A poor free-throw team: {ev} ({rk}).'],
    ps: [], pb: ['In a close finish, the line is where they leave points: foul the weakest shooters, not the ball handler.'] },
  /* styles: how they score, said by how much of it there is */
  { id: 'o.three', idT: 'spread the floor with {ev} ({rk})', idB: 'rarely shoot the three ({ev}, {rk})', end: 'o', k: 'z_three_att100', style: true, w: 0.75, ev: v => R1(v) + ' threes per 100 possessions',
    s: ['Spread you out and let it fly: {ev} ({rk}).', 'A five-out, three-heavy offence: {ev} ({rk}).'],
    b: ['Rarely shoot the three: {ev} ({rk}).'],
    ps: ['Run them off the line: no middle help off the shooters, close out high and hard.'],
    pb: ['Sag off the perimeter and load the paint: they do not punish it from deep.'] },
  { id: 'o.rim', idT: 'play downhill, {ev} ({rk})', idB: 'rarely get to the rim ({ev}, {rk})', end: 'o', k: 'z_rim_att100', style: true, w: 0.75, ev: v => R1(v) + ' shots at the rim per 100 possessions',
    s: ['Play downhill: {ev} ({rk}).', 'Attack the rim: {ev} ({rk}).'],
    b: ['Rarely get to the rim: {ev} ({rk}).'],
    ps: ['Build a wall: load to the ball, pre-rotate, and show bodies in the paint before the drive gets there.'],
    pb: [] },
  { id: 'o.mid', idT: 'take a lot of mid-range jumpers ({ev}, {rk})', end: 'o', k: 'z_mid_att100', style: true, w: 0.55, ev: v => R1(v) + ' two-point jumpers per 100 possessions',
    s: ['A mid-range team: {ev} ({rk}).'], b: [],
    ps: ['Give them the pull-up two: take away the rim and the three first.'], pb: [] },
  { id: 'o.corner', idT: 'hunt the corner three ({ev}, {rk})', end: 'o', k: 'z_c3_att100', style: true, w: 0.5, ev: v => R1(v) + ' corner threes per 100 possessions',
    s: ['Hunt the corner three: {ev} ({rk}).'], b: [],
    ps: ['Tag the roller from the weak-side slot, not the strong-side corner: no help off the corners.'], pb: [] },
  { id: 'o.share', idT: 'move the ball ({ev}, {rk})', idB: 'create off the dribble (only {ev}, {rk})', end: 'o', k: '__ast_sh', style: true, w: 0.6, ev: v => PCT(v) + ' of baskets assisted',
    s: ['A ball-movement offence: {ev} ({rk}).', 'Share it: {ev} ({rk}).'],
    b: ['An isolation-heavy offence: only {ev} ({rk}).', 'Create off the dribble: {ev} ({rk}).'],
    ps: ['Deny the swing and the second side: make somebody beat you one-on-one.'],
    pb: ['Load to the ball and help early: make the role players beat you.'] },
  { id: 'o.pace', idT: 'play fast ({ev}, {rk})', idB: 'slow the game down ({ev}, {rk})', end: 'o', k: 'pace', style: true, w: 0.5, ev: v => R1(v) + ' possessions per 40 minutes',
    s: ['Play fast: {ev} ({rk}).'], b: ['Slow it down: {ev} ({rk}).'],
    ps: ['Control the tempo: no live-ball turnovers, no long rebounds for them to run off.'],
    pb: ['Push the pace and make them defend in the open floor.'] },
  /* ---------- defence ---------- */
  { id: 'd.shoot', idT: 'hold teams to {ev} ({rk})', end: 'd', k: 'dff_efg', low: true, w: 1, ev: v => PCT(v) + ' eFG allowed',
    s: ['Contest well: {ev} ({rk}).', 'Hard to score on: {ev} ({rk}).'],
    b: ['Give up good looks: {ev} ({rk}).'],
    ps: ['Look for the second action: the first shot will be contested.'],
    pb: ['Move it and you will find a good shot: they give them up.'] },
  { id: 'd.force', idT: 'force turnovers on {ev} ({rk})', end: 'd', k: 'dff_tov', w: 1, ev: v => PCT(v) + ' of opponents’ possessions end in a turnover', evc: v => PCT(v) + ' of possessions',
    s: ['Force turnovers: {ev} ({rk}).', 'A pressure defence: {ev} ({rk}).'],
    b: ['Rarely force turnovers: {ev} ({rk}).'],
    ps: ['Value the ball: two hands on every pass, meet the pass, no lazy cross-court skips into their hands.'],
    pb: ['You can run your offence without pressure: be patient and get to the second side.'] },
  { id: 'd.glass', idT: 'finish possessions on the glass ({ev}, {rk})', end: 'd', k: 'dff_oreb', low: true, w: 1, ev: v => PCT(v) + ' OREB allowed',
    s: ['End possessions on the glass: {ev} ({rk}).'],
    b: ['Struggle to finish possessions: {ev} ({rk}).', 'Give up second chances: {ev} ({rk}).'],
    ps: [],
    pb: ['Send four to the offensive glass: the second chances are there.'] },
  { id: 'd.foul', idT: 'defend without fouling ({ev}, {rk})', end: 'd', k: 'dff_ftr', low: true, w: 0.8, ev: v => 'opponents’ FTr ' + R1(v),
    s: ['Defend without fouling: {ev} ({rk}).'],
    b: ['Foul a lot: {ev} ({rk}).'],
    ps: [],
    pb: ['Attack downhill and put them in the bonus early.'] },
  { id: 'd.half', idT: 'are hard to score on in the half court ({ev}, {rk})', end: 'd', k: 'evd_half_ppp', low: true, w: 0.9, ev: v => PPP(v) + ' points per half-court chance allowed',
    s: ['A strong half-court defence: {ev} ({rk}).'],
    b: ['A soft half-court defence: {ev} ({rk}).'],
    ps: ['Score early, before they are set: push off misses and makes.'], unlessTop: 'd.run',
    pb: [] },
  { id: 'd.run', idT: 'get back in transition ({ev}, {rk})', end: 'd', k: 'evd_transition_ppp', low: true, w: 0.8, ev: v => PPP(v) + ' points per transition chance allowed',
    s: ['Get back in transition: {ev} ({rk}).'],
    b: ['Vulnerable in transition: {ev} ({rk}).'],
    ps: [],
    pb: ['Run after every rebound and steal: they do not get back.'] },
  { id: 'd.rim', idT: 'protect the rim ({ev}, {rk})', end: 'd', k: 'zd_rim_att100', low: true, w: 0.85, ev: v => R1(v) + ' opponents’ shots at the rim per 100 possessions',
    s: ['Protect the rim: {ev} ({rk}). That is rim deterrence, not only blocks.', 'Shrink the floor: {ev} ({rk}).'],
    b: ['The rim is open: {ev} ({rk}).'],
    ps: ['Do not force it into a crowd: space them out and play inside-out.'],
    pb: ['Drive, cut and post: the paint is there.'] },
  { id: 'd.three', idT: 'run teams off the three-point line ({ev}, {rk})', end: 'd', k: 'zd_three_att100', low: true, w: 0.8, ev: v => R1(v) + ' opponents’ threes per 100 possessions',
    s: ['Run teams off the three-point line: {ev} ({rk}).'],
    b: ['Concede threes: {ev} ({rk}).'],
    ps: [],
    pb: ['Spread the floor, swing it, and punish the closeouts.'] },
  { id: 'd.mid', idT: 'concede the mid-range ({ev}, {rk}), which fits a defence that drops its bigs', end: 'd', k: 'zd_mid_att100', style: true, w: 0.45, ev: v => R1(v) + ' opponents’ two-point jumpers per 100 possessions',
    s: ['Concede the mid-range: {ev} ({rk}), which fits a defence that drops its bigs and protects the rim.'], b: [],
    ps: ['The pull-up two and the floater will be there in pick-and-roll.'], pb: [] }
];

/* the assisted share of all baskets (report-teampages.js deriveTeams' own) */
function deriveTeam(r) {
  const a = num(r.ev_ast_fgm), u = num(r.ev_unast_fgm);
  if (r.__ast_sh == null && a != null && u != null && a + u > 0) r.__ast_sh = Math.round(1000 * a / (a + u)) / 10;
  return r;
}

/* how far a place is from the middle, 0 (the middle) to 1 (top or bottom) */
const ext = P => Math.abs(P.pct - 50) / 50;

function teamFacets(S, id) {
  const rows = (S.teams || []).filter(r => !r.__prior).map(r => deriveTeam(Object.assign({}, r)));
  const me = rows.find(r => r.id === id);
  if (!me) return { me: null, rows, list: [] };
  const list = [];
  TEAM.forEach(f => {
    if (f.gate && !f.gate(me)) return;
    const P = placeOf(rows, f.k, id, f.low);
    if (!P) return;
    const kind = isTop(P) ? 'top' : isBottom(P) ? 'bottom' : null;
    list.push(Object.assign({ f, P, kind, sal: f.w * ext(P) }));
  });
  return { me, rows, list };
}

/* ============================================================== the club ===== */
function team(T, o) {
  const op = o || {};
  if (!T || !T.S || !T.mine) return null;
  const id = T.mine.id, name = op.name || T.mine.name || 'They';
  const { me, rows, list } = teamFacets(T.S, id);
  if (!me || rows.length < 6) return null;
  const seed = 'scout' + id;
  const say = (x, f, P, tag) => proof(fill(pick(seed + f.id + tag, x), { ev: f.ev(P.v), rk: rk(P) }), [name]);
  /* strengths and weaknesses: the top and bottom quarters, most salient first, one line a measure. A style is a strength
     or a weakness only as its game plan makes it one: it is said as what they are */
  const good = list.filter(x => x.kind && !x.f.style && (x.kind === 'top' ? x.f.s.length : x.f.b.length))
    .sort((a, b) => b.sal - a.sal);
  const strengths = good.filter(x => x.kind === 'top').slice(0, 5).map(x => ({ id: x.f.id, text: say(x.f.s, x.f, x.P, 's') }));
  const weaknesses = good.filter(x => x.kind === 'bottom').slice(0, 5).map(x => ({ id: x.f.id, text: say(x.f.b, x.f, x.P, 'b') }));
  /* the identity: the styles at their ends, offence then defence */
  const styles = list.filter(x => x.kind && x.f.style && (x.kind === 'top' ? x.f.s.length : x.f.b.length)).sort((a, b) => b.sal - a.sal);
  /* THE READ: who they are in three or four sentences - the ratings, then the identity at each end */
  const V = VOICE();
  const ortg = placeOf(rows, 'ortg', id), drtg = placeOf(rows, 'drtg', id, true), net = num(me.net);
  const read = [];
  if (ortg && drtg && net != null) {
    const band = P => (P.r <= quarter(P.n) ? 'top-quarter' : P.r > P.n - quarter(P.n) ? 'bottom-quarter' : P.r <= P.n / 2 ? 'above-average' : 'below-average');
    read.push(proof(fill(pick(seed + 'r0', [
      '{T} are {net} net per 100 possessions: a {bo} offence ({o}, {ro}) and a {bd} defence ({d}, {rd}).',
      '{T}: a {bo} offence ({o} points per 100 possessions, {ro}) and a {bd} defence ({d} allowed, {rd}), {net} net.'
    ]), { T: name, net: sg(net), bo: band(ortg), o: fx(ortg.v), ro: rk(ortg), bd: band(drtg), d: fx(drtg.v), rd: rk(drtg) }), [name]));
  }
  /* the identity, as clauses of one sentence an end ("On offence they rarely shoot the three (...) and create off the
     dribble (...)"): the styles at their ends, and at the defensive end its best measure with them */
  const clause = x => { const t = x.f[x.kind === 'top' ? 'idT' : 'idB']; return t ? fill(t, { ev: (x.f.evc || x.f.ev)(x.P.v).replace(/ allowed$/, ''), rk: rk(x.P) }) : null; };
  const and = xs => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0]);
  const oIds = styles.filter(x => x.f.end === 'o').map(clause).filter(Boolean).slice(0, 2);
  if (oIds.length) read.push(proof(pick(seed + 'ro', ['On offence they ', 'Offensively they ']) + and(oIds) + '.', [name]));
  const dIds = good.filter(x => x.f.end === 'd' && x.kind === 'top').concat(styles.filter(x => x.f.end === 'd')).map(clause).filter(Boolean).slice(0, 2);
  if (dIds.length) read.push(proof(pick(seed + 'rd', ['On defence they ', 'Defensively they ']) + and(dIds) + '.', [name]));
  /* HOW TO PREPARE: their strengths taken away, their weaknesses attacked - the most salient first, one line each, with the
     measure it rests on */
  const planOf = (x, which) => {
    const xs = x.f[which];
    if (!xs || !xs.length) return null;
    return { id: x.f.id, text: proof(pick(seed + x.f.id + which, xs), [name]), why: x.f.ev(x.P.v) + ', ' + rk(x.P) };
  };
  const plan = [];
  const topIds = new Set(list.filter(x => x.kind === 'top').map(x => x.f.id));
  list.filter(x => x.kind).sort((a, b) => b.sal - a.sal).forEach(x => {
    if (plan.length >= 6) return;
    if (x.kind === 'top' && x.f.unlessTop && topIds.has(x.f.unlessTop)) return;
    const p = planOf(x, x.kind === 'top' ? 'ps' : 'pb');
    if (p && !plan.some(q => q.text === p.text)) plan.push(p);
  });
  /* THE PERSONNEL: the rotation's main players, each in a line of role and how to guard him */
  const personnel = personnelOf(T.S, id, seed);
  const out = { kind: 'team', name, n: rows.length, read: read.filter(Boolean), strengths, weaknesses, plan, personnel };
  return edit(out, [name]);
}

/* ============================================================ the players ====== */
/* a player's place among his position's players in the league (report.js posRanker's pools: guards, wings, bigs), as a
   percentile on the good end; fewer than twelve in the pool ranks him among everybody */
function poolOf(field, id) {
  const SE = root.EpinoiaSeason || (typeof require === 'function' ? (() => { try { return require('./season.js'); } catch (_) { return null; } })() : null);
  const G = { G: 'guard', F: 'wing', C: 'big' }, PL = { guard: 'guards', wing: 'wings', big: 'bigs' };
  let groups = new Map();
  try { if (SE && SE.positionGroups) groups = SE.positionGroups(field || []); } catch (_) { groups = new Map(); }
  const g = G[groups.get(id)] || null;
  const pool = g ? (field || []).filter(r => G[groups.get(r.id)] === g || r.id === id) : [];
  const use = pool.length >= 12 ? pool : (field || []);
  return { group: pool.length >= 12 ? g : null, who: pool.length >= 12 ? PL[g] : 'players', rows: use };
}
function pctOf(rows, k, id, low, minRows) {
  const vals = rows.filter(r => !r.__prior && num(r[k]) != null && (!minRows || minRows(r)));
  const me = vals.find(r => r.id === id) || rows.find(r => r.id === id);
  if (!me || num(me[k]) == null || vals.length < 8) return null;
  const v = +me[k];
  const below = vals.filter(x => (low ? +x[k] > v : +x[k] < v)).length;
  return { v, pct: Math.round(100 * below / Math.max(1, vals.length - 1)), n: vals.length };
}
/* regulars: a player in the pool counts once he has played enough to have a line worth comparing */
const regular = r => (num(r.gp) || 0) >= 3 && (num(r.mpg) || 0) >= 10;
/* a percentile as a word for a pair ("the highest usage and 67th-percentile TS among guards") */
const pctWord = P => (P.pct >= 99 ? 'the highest' : P.pct <= 1 ? 'the lowest' : ord(P.pct) + '-percentile');
const pctText = (P, who) => (P.pct >= 99 ? 'the highest among ' + who : P.pct <= 1 ? 'the lowest among ' + who : ord(P.pct) + ' percentile among ' + who);

/* the role a line describes, in the scout's words, each with the evidence the lexicon pairs it with */
function rolesOf(r, rank, who) {
  const out = [], guard = [];
  const R = (k, low) => rank(k, low);
  const usg = R('usg'), ast = R('ast_pct'), tov = R('tov_pct', true), p3v = R('p3_a100'), p3 = num(r.p3_pct), p3a = num(r.p3a) || 0;
  const rim = R('rim_a100'), ftr = R('ftr'), mid = R('mid_a100'), blk = R('blk_pct'), orb = R('oreb_pct'), stl = R('stl_pct');
  const ft = num(r.ft_pct), fta = num(r.fta) || 0;
  if (usg && ast && usg.pct >= 75 && ast.pct >= 70) {
    out.push({ k: 'initiator', s: 9, text: 'Initiator: ' + fx(r.usg) + '% usage with a ' + fx(r.ast_pct) + '% assist rate (' + pctWord(usg) + ' usage and ' + pctWord(ast) + ' assist rate among ' + who + ').' });
    guard.push('Make him a scorer, not a passer: pressure the catch, show early on the ball screen and stay home on the shooters.');
  } else if (usg && usg.pct >= 80) {
    out.push({ k: 'scorer', s: 8, text: 'Volume scorer: ' + fx(r.usg) + '% usage (' + pctText(usg, who) + ').' });
    guard.push('Load to him on the catch and make the others make plays.');
  } else if (ast && usg && ast.pct >= 80 && usg.pct <= 55) {
    out.push({ k: 'connector', s: 6, text: 'Connective passer: a ' + fx(r.ast_pct) + '% assist rate on ' + fx(r.usg) + '% usage, keeps the advantage moving rather than creating it.' });
  }
  if (p3v && p3 != null && p3a >= 20 && p3v.pct >= 65 && p3 >= 36) {
    out.push({ k: 'shooter', s: 7, text: 'Shooter: ' + fx(p3) + '% from three on ' + fx(r.p3_a100) + ' attempts per 100 possessions.' });
    guard.push('No help off him: top-lock him off screens and close out high; make him put it on the floor.');
  } else if (p3 != null && p3a >= 15 && p3 < 30) {
    out.push({ k: 'nonshooter', s: 5, text: 'Not a threat from deep: ' + fx(p3) + '% from three.' });
    guard.push('Go under every screen and sag off him; help off him into the paint.');
  } else if (who !== 'bigs' && p3v && p3v.pct <= 15 && (num(r.mpg) || 0) >= 15) {
    out.push({ k: 'noshot', s: 4, text: 'Does not shoot the three: ' + fx(r.p3_a100) + ' attempts per 100 possessions.' });
    guard.push('Gap him: play off him and clog the driving lanes.');
  }
  if (rim && rim.pct >= 75 && who === 'bigs') {
    out.push({ k: 'interior', s: 7, text: 'Interior finisher: ' + fx(r.rim_a100) + ' shots at the rim per 100 possessions' + (num(r.rim_pct) != null ? ', made at ' + fx(r.rim_pct) + '%' : '') + '.' });
    guard.push('Keep him off the rim: front the post, hit him before the shot goes up, make him finish over length.');
  } else if (rim && ftr && rim.pct >= 75 && ftr.pct >= 60) {
    out.push({ k: 'downhill', s: 7, text: 'Plays downhill: ' + fx(r.rim_a100) + ' shots at the rim per 100 possessions and a free-throw rate of ' + fx(r.ftr) + ' (rim pressure).' });
    guard.push('Keep him in front and build a wall: bodies early, verticality, no reach-ins.');
  } else if (mid && mid.pct >= 80) {
    out.push({ k: 'midrange', s: 4, text: 'Lives in the mid-range: ' + fx(r.mid_a100) + ' two-point jumpers per 100 possessions.' });
    guard.push('Run him off the rim and the line: the pull-up two is the shot to give him.');
  }
  if (tov && usg && tov.pct <= 20 && usg.pct >= 50) {
    out.push({ k: 'loose', s: 5, text: 'Loose with the ball: a ' + fx(r.tov_pct) + '% turnover rate.' });
    guard.push('Pressure him full court and trap the ball screen.');
  }
  if (blk && blk.pct >= 80 && who === 'bigs') {
    const rimD = num(r.def_rim_fg_pm);
    out.push({ k: 'protector', s: 6, text: 'Rim protector: a ' + fx(r.blk_pct) + '% block rate' + (rimD != null && rimD < -2 ? ', and opponents shoot ' + fx(-rimD) + ' points worse at the rim with him on' : '') + '.' });
    guard.push('Pull him away from the rim: pick-and-pop with his man, make him guard in space.');
  }
  if (orb && orb.pct >= 80) {
    out.push({ k: 'glass', s: 5, text: 'Offensive rebounder: ' + fx(r.oreb_pct) + '% of available offensive rebounds.' });
    guard.push('Hit him first on every shot.');
  }
  if (stl && stl.pct >= 85) {
    out.push({ k: 'hands', s: 4, text: 'Active hands: a ' + fx(r.stl_pct) + '% steal rate.' });
    guard.push('Strong with the ball near him: no lazy passes in his lane.');
  }
  if (ft != null && fta >= 20 && ft < 60) {
    out.push({ k: 'ftpoor', s: 3, text: 'Poor at the line: ' + fx(ft) + '% on ' + Math.round(fta) + ' attempts.' });
    guard.push('In a close finish he is the one to foul.');
  }
  return { roles: out.sort((a, b) => b.s - a.s), guard };
}

function personnelOf(S, teamId, seed) {
  const all = (S.players || []).filter(r => !r.__prior);
  const squad = all.filter(r => (r._teamId || r.team_id) === teamId && regular(r)).sort((a, b) => (num(b.mpg) || 0) - (num(a.mpg) || 0)).slice(0, 6);
  return squad.map(r => {
    const P = poolOf(all.filter(regular), r.id);
    const rank = (k, low) => pctOf(P.rows, k, r.id, low);
    const { roles, guard } = rolesOf(r, rank, P.who);
    const line = [fx(r.mpg) + ' min', fx(r.ppg) + ' pts', num(r.ts) != null ? fx(r.ts) + '% TS' : null, num(r.usg) != null ? fx(r.usg) + '% USG' : null].filter(Boolean).join(' · ');
    return { id: r.id, name: r.name || 'Player', jersey: r.jersey || null, group: P.group, line,
      roles: roles.slice(0, 3).map(x => proof(x.text)), guard: guard.slice(0, 2).map(x => proof(x)) };
  }).filter(p => p.roles.length || p.guard.length);
}

/* ============================================================== the player ===== */
const PLAYER = [
  { id: 'eff', k: 'ts', w: 1, ev: v => fx(v) + '% TS', s: 'Efficient scorer', b: 'Inefficient scorer' },
  { id: 'impact', k: 'bpm', w: 1, ev: v => sg(v) + ' BPM', s: 'Box-score impact', b: 'Little box-score impact' },
  { id: 'usage', k: 'usg', style: true, w: 0.6, ev: v => fx(v) + '% usage', s: 'A high-usage option', b: 'A low-usage role player' },
  { id: 'create', k: 'ast_pct', w: 0.8, ev: v => fx(v) + '% AST', s: 'Creates for others', b: 'Rarely creates for others' },
  { id: 'care', k: 'tov_pct', low: true, w: 0.8, ev: v => fx(v) + '% TOV', s: 'Takes care of the ball', b: 'Turnover-prone' },
  { id: 'three', k: 'p3_pct', w: 0.8, min: r => (num(r.p3a) || 0) >= 20, ev: v => fx(v) + '% from three', s: 'Shoots it from deep', b: 'Does not shoot it well from deep' },
  { id: 'rim', k: 'rim_pct', w: 0.7, min: r => (num(r.rimA) || num(r.ev_all_rimA) || 0) >= 15, ev: v => fx(v) + '% at the rim', s: 'Finishes at the rim', b: 'Struggles to finish at the rim' },
  { id: 'line', k: 'ftr', w: 0.6, ev: v => 'FTr ' + fx(v), s: 'Gets to the line', b: 'Rarely gets to the line' },
  { id: 'ft', k: 'ft_pct', w: 0.5, min: r => (num(r.fta) || 0) >= 15, ev: v => fx(v) + '% FT', s: 'Reliable at the line', b: 'Poor at the line' },
  { id: 'oreb', k: 'oreb_pct', w: 0.6, ev: v => fx(v) + '% OREB', s: 'Crashes the offensive glass', b: null },
  { id: 'dreb', k: 'dreb_pct', w: 0.6, ev: v => fx(v) + '% DREB', s: 'Cleans the defensive glass', b: 'Does not finish defensive possessions' },
  { id: 'stl', k: 'stl_pct', w: 0.6, ev: v => fx(v) + '% STL', s: 'Event creator, with active hands', b: null },
  { id: 'blk', k: 'blk_pct', w: 0.6, ev: v => fx(v) + '% BLK', s: 'Blocks shots', b: null },
  { id: 'dbpm', k: 'dbpm', w: 0.8, ev: v => sg(v) + ' DBPM', s: 'A positive defender by the box score', b: 'A defensive liability by the box score' },
  { id: 'onoff', k: 'diff_net', w: 0.7, ev: v => sg(v) + ' net per 100 on the floor v off it', s: 'His team is better with him on', b: 'His team is worse with him on' }
];

function player(B, o) {
  const op = o || {};
  if (!B || !B.mine || !Array.isArray(B.field)) return null;
  const r = B.mine, id = r.id, name = op.name || r.name || 'He';
  const all = B.field.filter(x => !x.__prior);
  const P = poolOf(all.filter(regular).concat(all.some(x => x.id === id && regular(x)) ? [] : [r]), id);
  if (P.rows.length < 8) return null;
  const seed = 'scoutp' + id;
  const rank = (k, low, min) => pctOf(P.rows, k, id, low, min);
  const list = [];
  PLAYER.forEach(f => {
    if (f.min && !f.min(r)) return;
    const X = rank(f.k, f.low);
    if (!X) return;
    const kind = X.pct >= 75 ? 'top' : X.pct <= 25 ? 'bottom' : null;
    list.push({ f, X, kind, sal: f.w * Math.abs(X.pct - 50) / 50 });
  });
  const said = (x, which) => proof(x.f[which] + ': ' + x.f.ev(x.X.v) + ' (' + pctText(x.X, P.who) + ').');
  const strengths = list.filter(x => x.kind === 'top' && !x.f.style && x.f.s).sort((a, b) => b.sal - a.sal).slice(0, 5).map(x => ({ id: x.f.id, text: said(x, 's') }));
  const weaknesses = list.filter(x => x.kind === 'bottom' && !x.f.style && x.f.b).sort((a, b) => b.sal - a.sal).slice(0, 5).map(x => ({ id: x.f.id, text: said(x, 'b') }));
  const { roles, guard } = rolesOf(r, (k, low) => rank(k, low), P.who);
  /* THE READ: his line, his role, and where he sits among his position */
  const read = [];
  const bits = [num(r.mpg) != null ? fx(r.mpg) + ' minutes' : null, num(r.ppg) != null ? fx(r.ppg) + ' points' : null,
    num(r.rpg) != null ? fx(r.rpg) + ' rebounds' : null, num(r.apg) != null ? fx(r.apg) + ' assists' : null].filter(Boolean);
  if (bits.length) read.push(proof(fill(pick(seed + 'r0', ['{N}: {line} a game{grp}.', '{N} averages {line}{grp}.']),
    { N: name, line: bits.join(', '), grp: P.group ? ', measured here against the league’s ' + P.who : '' })));
  if (roles.length) read.push(proof(roles.slice(0, 2).map(x => x.text.replace(/\.$/, '')).join('. ') + '.'));
  const usg = rank('usg'), ts = rank('ts');
  if (usg && ts) {
    const hiU = usg.pct >= 75, hiT = ts.pct >= 60, loT = ts.pct <= 40;
    const s = hiU && hiT ? 'Carries a heavy load and carries it efficiently: ' : hiU && loT ? 'Takes a lot of shots for the return: ' : !hiU && hiT ? 'Efficient in his role: ' : null;
    if (s) read.push(proof(s + fx(r.usg) + '% usage at ' + fx(r.ts) + '% TS (' + pctWord(usg) + ' usage and ' + pctWord(ts) + ' TS among ' + P.who + ').'));
  }
  /* how to attack him on defence: what his defensive numbers leave open */
  const defence = [];
  const dbpm = rank('dbpm'), stl = rank('stl_pct'), blk = rank('blk_pct');
  /* the on/off only on a sample worth the name (300 possessions on the floor), and never against the box score unexplained:
     when the two disagree they are said together, as the scout would weigh them */
  const dvs = num(r.diff_vs_efg) != null && (num(r.on_poss) == null || +r.on_poss >= 300) ? +r.diff_vs_efg : null;
  const boxGood = dbpm && dbpm.pct >= 80, boxBad = dbpm && dbpm.pct <= 25, onBad = dvs != null && dvs >= 3, onGood = dvs != null && dvs <= -3;
  if (boxGood && onBad) defence.push(proof('The box score likes his defence (' + sg(r.dbpm) + ' DBPM, ' + pctText(dbpm, P.who) + '), but opponents have shot ' + fx(dvs) + ' points better (eFG) with him on the floor: test him early and see which is true.'));
  else if (boxGood) defence.push(proof('Avoid him: ' + sg(r.dbpm) + ' DBPM (' + pctText(dbpm, P.who) + '). Screen him out of the action rather than attack him.'));
  else if (boxBad) defence.push(proof('Target him: ' + sg(r.dbpm) + ' DBPM (' + pctText(dbpm, P.who) + ')' + (onBad ? ', and opponents shoot ' + fx(dvs) + ' points better (eFG) with him on the floor' : '') + '. Put him in the action, in pick-and-roll and isolation.'));
  else if (onBad) defence.push(proof('Opponents shoot ' + fx(dvs) + ' points better (eFG) with him on the floor: go at him.'));
  else if (onGood) defence.push(proof('Opponents shoot ' + fx(-dvs) + ' points worse (eFG) with him on the floor.'));
  if (stl && blk && stl.pct <= 20 && blk.pct <= 20) defence.push(proof('Creates few events on defence: a ' + fx(r.stl_pct) + '% steal rate and a ' + fx(r.blk_pct) + '% block rate.'));
  const plan = guard.slice(0, 4).map(t => ({ text: proof(t) }));
  const out = { kind: 'player', name, n: P.rows.length, who: P.who, read, strengths, weaknesses, plan, defence };
  return edit(out, []);
}

/* ==================================================== the player's own notes ===== */
/* WHAT IS WORKING AND WHAT TO WORK ON (the player report's INSIGHTS, report-playerpages.js; Louie, 2026-10-16: "actionable
   insights using basketball language through reading the whole pdf (i.e. struggling to finish plays in transition, half court
   ast% is low thus could pass more for a guard etc.)"). Written to the player and his coach, not to an opponent: each note is a
   measure from the report with his place among his position, the evidence, and each thing to work on comes with the work, in
   the scout's words (basketball-scouting-language: a term only with the evidence the lexicon pairs it with). His position
   decides what is asked of him: a guard's creation for others and his handle, a wing's shot and closeouts, a big's finishing,
   glass and rim. Read from what every section found (report-playerpages.js R.facts):
     main   { mine, group, who, n, pct(k) }   the season line, and his percentile among his position (the good end high)
     lvr    { all: { L, R } }                 left v right, his eFG% from each side of the floor
     conn   { total, threes, rim, mates }     the assists he gave, paired with their baskets
     week   { games: [{ raw, row, opp, home, res, us, them, shots }] }   the week's games
   -> { name, group, who, n, intro, keep: [{ head, text }], work: [{ head, text, act }], week: [{ head, text }] } */
function develop(F) {
  const M = F && F.main;
  if (!M || !M.mine) return null;
  const r = M.mine, g = M.group || 'guard', who = M.who || 'players';
  const P = k => { const p = M.pct ? M.pct(k) : null; return p == null ? null : +p; };
  const v = k => num(r[k]);
  const gp = num(r.gp) || 0, mpg = num(r.mpg) || 0;
  const at = p => (p >= 99 ? 'the highest among ' + who : p <= 1 ? 'the lowest among ' + who : ord(p) + ' percentile among ' + who);
  const keep = [], work = [];
  const K = (s, head, text) => keep.push({ s, head, text: proof(text) });
  const W = (s, head, text, act) => work.push({ s, head, text: proof(text), act: act ? proof(act) : null });
  const sal = p => Math.abs(p - 50) / 50;
  const enough = gp >= 2 && mpg >= 6;
  /* a rate of rebounds, steals or blocks says nothing over a game or two: those notes wait for 80 minutes, the ball-security
     note for 60, the shooting notes for their own attempts */
  const mins = gp * mpg, fga = v('fga');
  if (!enough) return { name: F.name || r.name, group: g, who, n: M.n || 0, intro: 'Too few minutes yet for notes worth reading: ' + gp + (gp === 1 ? ' game' : ' games') + '.', keep, work, week: [] };

  /* ---- finishing ---- */
  const trP = P('ev_transition_rim_pct'), trA = v('ev_transition_rimA'), trV = v('ev_transition_rim_pct');
  if (trP != null && trV != null && (trA == null || trA >= 6)) {
    if (trP <= 30) W(1.1 * sal(trP), 'Finishing in transition', 'Struggling to finish plays in transition: ' + fx(trV) + '% at the rim on the break (' + at(trP) + ').',
      g === 'big' ? 'Run the rim and finish strong: catch it with two hands, chin it, and go straight up through the contact.'
        : 'Arrive under control: a jump stop or a two-foot finish through the contact beats the one-foot runner into the trailing big. Slow down before the gather.');
    else if (trP >= 75) K(0.8 * sal(trP), 'Finishes on the break', fx(trV) + '% at the rim in transition (' + at(trP) + ').');
  }
  const hrP = P('ev_half_rim_pct'), hrA = v('ev_half_rimA'), hrV = v('ev_half_rim_pct');
  const rimP = P('rim_pct'), rimA = v('rimA'), rimV = v('rim_pct');
  if (hrP != null && hrV != null && (hrA == null || hrA >= 10) && hrP <= 30) W(sal(hrP), 'Finishing in the half court', 'At the rim against a set defence: ' + fx(hrV) + '% (' + at(hrP) + ').',
    g === 'big' ? 'Finish through length: catch, gather on two feet and go up strong; a pump fake on the early contest, and the drop step to the rim side.'
      : 'Add touch over length: the floater and the runner against drop coverage, and use the rim to shield the shot from the contest.');
  else if (rimP != null && rimV != null && (rimA == null || rimA >= 15)) {
    if (rimP <= 25) W(0.9 * sal(rimP), 'Finishing at the rim', fx(rimV) + '% at the rim (' + at(rimP) + ').',
      g === 'big' ? 'Two hands and two feet in traffic, and go up through the contact rather than around it.' : 'Finish with touch and with both hands; use the rim to protect the shot.');
    else if (rimP >= 75) K(0.8 * sal(rimP), 'Finishes at the rim', fx(rimV) + '% at the rim (' + at(rimP) + ').');
  }
  /* ---- creating for others: what a guard is asked first ---- */
  const usgP = P('usg'), usgV = v('usg');
  const hcP = P('hc_ast_pct'), hcV = v('hc_ast_pct'), astP = P('ast_pct'), astV = v('ast_pct'), auP = P('au'), auV = v('au');
  if (g === 'guard') {
    if (hcP != null && hcV != null) {
      if (hcP <= 30 && (usgP == null || usgP >= 30)) W(1.2 * sal(hcP), 'Creating for others', 'Half-court AST% is low for a guard: ' + fx(hcV) + '% (' + at(hcP) + ')' + (usgV != null ? ' on ' + fx(usgV) + '% usage' : '') + '.',
        'Pass more out of the paint touch: the pocket pass to the roller, the skip to the weak-side corner, and the extra pass when the second side opens.');
      else if (hcP >= 75) K(sal(hcP), 'Creates for others', fx(hcV) + '% half-court AST% (' + at(hcP) + '): keeps the advantage moving against a set defence.');
    } else if (astP != null && astV != null) {
      if (astP <= 25) W(1.1 * sal(astP), 'Creating for others', 'An assist rate of ' + fx(astV) + '% is low for a guard (' + at(astP) + ').',
        'Look to make the play for others first: the pocket pass in the ball screen and the kick-out off the drive.');
      else if (astP >= 75) K(sal(astP), 'Creates for others', 'A ' + fx(astV) + '% assist rate (' + at(astP) + ').');
    }
  } else if (auP != null && auV != null) {
    if (auP <= 20 && usgP != null && usgP >= 55) W(0.8 * sal(auP), 'The ball sticks', 'An assist to usage ratio of ' + fx(auV, 2) + ' (' + at(auP) + '): the ball stops with them more than with most ' + who + '.',
      'Attack the closeout and make the next read in half a second: if the help comes, the kick to the open shooter.');
    else if (auP >= 80 && usgP != null && usgP <= 50) K(0.8 * sal(auP), 'Connective passer', 'Assists without needing the ball: an assist to usage ratio of ' + fx(auV, 2) + ' (' + at(auP) + ') on ' + fx(usgV) + '% usage.');
  }
  /* ---- ball security ---- */
  const tovP = P('tov_pct'), tovV = v('tov_pct');
  if (tovP != null && tovV != null && mins >= 60) {
    if (tovP <= 25) {
      const hd = v('handle_pg'), bp = v('badpass_pg');
      W(sal(tovP), 'Ball security', 'Turns it over on ' + fx(tovV) + '% of their possessions (' + at(tovP) + ').',
        hd != null && bp != null && hd > bp ? 'Most are on the dribble: tighten the handle under pressure, keep it low and away from the help, and pick it up only to pass or shoot.'
          : hd != null && bp != null && bp > hd ? 'Most are passes: make the read earlier and deliver on time; no jump passes, two hands on the swing.'
            : 'Value the possession: strong with the ball in traffic, and the simple pass when the first read is not there.');
    } else if (tovP >= 80 && usgP != null && usgP >= 40) K(0.6 * sal(tovP), 'Takes care of the ball', 'A ' + fx(tovV) + '% turnover rate (' + at(tovP) + ') with ' + fx(usgV) + '% usage.');
  }
  /* ---- the shot ---- */
  const p3P = P('p3_pct'), p3V = v('p3_pct'), p3a = v('p3a'), ftV = v('ft_pct'), fta = v('fta');
  if (p3P != null && p3V != null && p3a != null && p3a >= (g === 'big' ? 30 : 20)) {
    if (p3P <= 25) W(sal(p3P), 'The three', fx(p3V) + '% from three on ' + Math.round(p3a) + ' attempts (' + at(p3P) + ').',
      ftV != null && fta != null && fta >= 15 && ftV >= 75 ? 'The touch says it will come (' + fx(ftV) + '% at the line): keep taking the open ones, shot-ready with the feet set before the catch.'
        : 'Clean up the shot diet: the catch-and-shoot three only until the percentage comes, and game-speed reps off the catch.');
    else if (p3P >= 75) K(sal(p3P), 'Shoots it', fx(p3V) + '% from three on ' + Math.round(p3a) + ' attempts (' + at(p3P) + ').');
  }
  const tsP = P('ts'), tsV = v('ts'), midVolP = P('mid_a100'), midV = v('mid_pct'), midA = v('midA');
  if (tsP != null && tsV != null && (fga == null || fga >= 25)) {
    if (tsP <= 25 && usgP != null && usgP >= 60) W(sal(tsP), 'Shot quality', 'Takes a big share of the shots (' + fx(usgV) + '% usage) for the return: ' + fx(tsV) + '% TS (' + at(tsP) + ').',
      midVolP != null && midVolP >= 60 && midV != null && midV < 40 ? 'Trade the long two for the rim or the three: one more dribble downhill, or a step back behind the line.'
        : 'Clean up the shot diet: more shots at the rim and catch-and-shoot threes, fewer contested pull-up twos.');
    else if (tsP >= 75) K(sal(tsP), 'Efficient scorer', fx(tsV) + '% TS (' + at(tsP) + ').');
  }
  if (!work.some(x => x.head === 'Shot quality') && midVolP != null && midVolP >= 75 && midV != null && midV <= 38 && (midA == null || midA >= 20))
    W(0.6, 'The mid-range', 'Lives in the mid-range, and makes ' + fx(midV) + '% there.', 'The long two is the shot the defence wants them to take: one more dribble to the rim, or a step back behind the line.');
  /* ---- the line ---- */
  const ftrP = P('ftr'), ftrV = v('ftr'), rimVolP = P('rim_a100'), rimVol = v('rim_a100');
  if (ftrP != null && ftrV != null && rimVolP != null) {
    if (ftrP <= 25 && rimVolP >= 50 && (rimA == null || rimA >= 15)) W(0.8 * sal(ftrP), 'Getting to the line', 'Gets to the rim (' + fx(rimVol) + ' shots there per 100 possessions) but rarely to the line: a free-throw rate of ' + fx(ftrV) + ' (' + at(ftrP) + ').',
      'Finish through the body, not around it: attack the defender’s chest and use the two-foot gather to draw the contact.');
    else if (ftrP >= 80 && rimVolP >= 60) K(0.8 * sal(ftrP), 'Rim pressure', 'Gets downhill and to the line: ' + fx(rimVol) + ' shots at the rim per 100 possessions and a free-throw rate of ' + fx(ftrV) + ' (' + at(ftrP) + ').');
  }
  const ftP = P('ft_pct');
  if (ftP != null && ftV != null && fta != null && fta >= 15 && ftP <= 25) W(0.7 * sal(ftP), 'Free throws', fx(ftV) + '% at the line on ' + Math.round(fta) + ' attempts (' + at(ftP) + ').',
    'The same routine every time, and volume: free throws at the end of practice, when tired.');
  /* ---- the glass ---- */
  const drP = P('dreb_pct'), drV = v('dreb_pct'), orP = P('oreb_pct'), orV = v('oreb_pct');
  if (drP != null && drV != null && mins >= 80) {
    if (drP <= (g === 'big' ? 30 : g === 'wing' ? 20 : 15)) W((g === 'big' ? 1 : 0.6) * sal(drP), 'Defensive rebounding', fx(drV) + '% of the available defensive rebounds (' + at(drP) + ').',
      g === 'big' ? 'Find a body before the ball: hit, hold, then go and get it with two hands at its highest point.' : 'Help finish the possession: hit your man first, then chase the long rebound.');
    else if (drP >= 80 && g !== 'guard') K(0.6 * sal(drP), 'Cleans the glass', fx(drV) + '% of the available defensive rebounds (' + at(drP) + ').');
  }
  if (orP != null && orV != null && mins >= 80) {
    /* not for a big who spaces the floor (top 30% of bigs for threes): popping, they are not the one under the rim to crash */
    const pops = (P('p3_a100') || 0) >= 70;
    if (g === 'big' && orP <= 25 && !pops) W(0.7 * sal(orP), 'Offensive rebounding', fx(orV) + '% of the available offensive rebounds (' + at(orP) + ').',
      'Second jump: crash from the weak side as the shot goes up, and tip it to yourself when you cannot catch it.');
    else if (orP >= 80) K(0.6 * sal(orP), 'Offensive rebounder', fx(orV) + '% of the available offensive rebounds (' + at(orP) + ').');
  }
  /* ---- defence ---- */
  const stP = P('stl_pct'), stV = v('stl_pct'), bkP = P('blk_pct'), bkV = v('blk_pct'), dbP = P('dbpm'), dbV = v('dbpm');
  if (g !== 'big' && stP != null && stV != null && mins >= 80) {
    if (stP <= 20) W(0.6 * sal(stP), 'Defensive events', 'A ' + fx(stV) + '% steal rate (' + at(stP) + ').',
      'Active hands and early help: sit in the passing lane one pass away, and stunt at the driver from the nail.');
    else if (stP >= 80) K(0.7 * sal(stP), 'Event creator', 'Active hands: a ' + fx(stV) + '% steal rate (' + at(stP) + ').');
  }
  if (g === 'big' && bkP != null && bkV != null && mins >= 80) {
    if (bkP <= 25) W(0.8 * sal(bkP), 'Contests at the rim', 'A ' + fx(bkV) + '% block rate (' + at(bkP) + ').',
      'Contest with verticality, not swipes: early from the weak side as the low man, both arms straight up.');
    else if (bkP >= 80) K(0.8 * sal(bkP), 'Blocks shots', 'A ' + fx(bkV) + '% block rate (' + at(bkP) + ').');
  }
  const pfP = P('pf_pg'), pfV = v('pf_pg');
  if (g === 'big' && pfP != null && pfV != null && pfP <= 20 && mins >= 80) W(0.6 * sal(pfP), 'Fouls', fx(pfV) + ' fouls a game (' + at(pfP) + ').',
    'Move the feet before the contest and stay vertical: the foul is the late arrival.');
  if (dbP != null && dbV != null && dbP <= 20 && mins >= 80) W(0.7 * sal(dbP), 'Defensive impact', sg(dbV) + ' DBPM (' + at(dbP) + ').',
    g === 'guard' ? 'At the point of attack: get over the ball screen and keep the first step in front, without the reach.'
      : g === 'wing' ? 'Closeouts under control, and screen navigation off the ball: no straight-line drives past them.'
        : 'Be playable in drop: early position, talk the coverage, and finish the possession with the rebound.');
  /* ---- left v right (the LEFT V RIGHT page) ---- */
  const LV = F.lvr && F.lvr.all;
  if (LV && LV.L && LV.R && LV.L.fga >= 15 && LV.R.fga >= 15 && LV.L.efg != null && LV.R.efg != null && Math.abs(LV.L.efg - LV.R.efg) >= 0.12) {
    const hi = LV.L.efg > LV.R.efg ? 'left' : 'right', lo = hi === 'left' ? 'right' : 'left';
    W(0.7, 'Side of the floor', fx(100 * Math.max(LV.L.efg, LV.R.efg)) + '% eFG from the ' + hi + ' side of the floor, ' + fx(100 * Math.min(LV.L.efg, LV.R.efg)) + '% from the ' + lo + '.',
      'Defences will push them to their ' + lo + ': put the reps there, shooting and finishing from that side.');
  }
  /* ---- connections (the CONNECTIONS page) ---- */
  const C = F.conn;
  if (C && C.total >= 10 && C.mates && C.mates.length) {
    const top = C.mates[0];
    if (top.n / C.total >= 0.45) W(0.6, 'The passing menu', top.n + ' of their ' + C.total + ' assisted baskets went to ' + top.name + '.',
      'Widen the menu: the skip pass to the weak-side corner and the drop-off to the dunker spot, not only the one look.');
    if (g === 'guard' && C.total >= 12 && C.threes / C.total <= 0.15) W(0.7, 'Drive and kick', 'Only ' + C.threes + ' of their ' + C.total + ' assisted baskets were threes.',
      'Draw two on the paint touch and spray it: the kick-out three is the most valuable pass a guard makes.');
    else if (C.rim / C.total >= 0.5) K(0.5, 'Creates at the rim', C.rim + ' of their ' + C.total + ' assisted baskets were at the rim: their passes find the dunker spot and the roller.');
  }
  /* ---- the week (GAMES PLAYED DURING THE WEEK) ---- */
  const week = [];
  const G = F.week && F.week.games;
  if (G && G.length) {
    const t = { pts: 0, fga: 0, fta: 0, ast: 0, to: 0, p3m: 0, p3a: 0, n: 0, rim: 0, three: 0, shots: 0 };
    let best = null;
    G.forEach(x => {
      const s = x.raw || {};
      const fga = (+s.p2a || 0) + (+s.p3a || 0);
      t.pts += +s.pts || 0; t.fga += fga; t.fta += +s.fta || 0; t.ast += +s.ast || 0; t.to += +s.to || 0; t.p3m += +s.p3m || 0; t.p3a += +s.p3a || 0; t.n++;
      (x.shots || []).forEach(sh => { t.shots++; if (sh.three) t.three++; else if (sh.y != null && sh.y < 0.22 && Math.abs(sh.x - 0.5) < 0.12) t.rim++; });
      if (!best || (+s.pts || 0) > (+best.raw.pts || 0)) best = x;
    });
    const tsW = t.fga + t.fta ? 100 * t.pts / (2 * (t.fga + 0.44 * t.fta)) : null;
    week.push({ head: t.n + (t.n === 1 ? ' game' : ' games'), text: proof(fx(t.pts / t.n) + ' points a game' + (tsW != null ? ' on ' + fx(tsW) + '% TS' : '') + (tsV != null && tsW != null ? ' (their season: ' + fx(tsV) + '%)' : '') +
      ', ' + fx(t.ast / t.n) + ' assists and ' + fx(t.to / t.n) + ' turnovers.') });
    if (best && t.n > 1) {
      const s = best.raw || {};
      week.push({ head: 'Best game', text: proof((+s.pts || 0) + ' points ' + (best.home ? 'against ' : 'at ') + best.opp + ' (' + best.res + ' ' + best.us + '–' + best.them + '), ' +
        ((+s.p2m || 0) + (+s.p3m || 0)) + ' of ' + ((+s.p2a || 0) + (+s.p3a || 0)) + ' from the field.') });
    }
    if (tsW != null && tsV != null && t.fga >= 15 && Math.abs(tsW - tsV) >= 8)
      week.push({ head: tsW > tsV ? 'Above their season' : F.week.picked ? 'Below their season' : 'A cold week', text: proof(tsW > tsV ? 'Shot ' + fx(tsW - tsV) + ' points of TS better than their season: the shot diet held, so keep it.'
        : 'Shot ' + fx(tsV - tsW) + ' points of TS below their season: check the shot diet on the courts above before the shooting itself.') });
  }
  const top = (xs, n) => xs.sort((a, b) => b.s - a.s).slice(0, n).map(x => { const o = Object.assign({}, x); delete o.s; return o; });
  const intro = (F.name || r.name || 'The player') + ', measured against the league’s ' + (M.n || 0) + ' ' + who + ' on every page of this report' +
    (gp < 5 ? '. Early in the season (' + gp + (gp === 1 ? ' game' : ' games') + '): read these as first signs, not verdicts.' : '.');
  return { name: F.name || r.name, group: g, who, n: M.n || 0, intro: proof(intro), keep: top(keep, 4), work: top(work, 5), week };
}

/* ============================================================== the editor ===== */
/* THE WHOLE, READ ONCE (scrutiny.js, register 'scout'): every line as a paragraph of one piece, so a line that says what
   another already says (near-copy, claim-twice) is caught across the sections; the lines come back fixed, in place */
function edit(out, clubs) {
  const E = EDITOR();
  if (!E || !E.scrutinise) return out;
  const push = (slots, arr, get, set) => (arr || []).forEach((x, i) => { slots.push({ text: get(x), put: t => set(i, t) }); });
  /* TWO PIECES: the read (a summary, which names the measures the lists then give) and the lists (strengths, weaknesses,
     the plan, his defence), so the near-copy rule never takes a strength out for being in the summary */
  const read = [], lists = [];
  push(read, out.read, x => x, (i, t) => { out.read[i] = t; });
  push(lists, out.strengths, x => x.text, (i, t) => { out.strengths[i].text = t; });
  push(lists, out.weaknesses, x => x.text, (i, t) => { out.weaknesses[i].text = t; });
  push(lists, out.plan, x => x.text, (i, t) => { out.plan[i].text = t; });
  if (out.defence) push(lists, out.defence, x => x, (i, t) => { out.defence[i] = t; });
  const fixes = [];
  [read, lists].forEach(slots => { const r = editOne(E, slots, out.name, clubs); if (r) fixes.push(...r); });
  ['read', 'defence'].forEach(k => { if (Array.isArray(out[k])) out[k] = out[k].filter(Boolean); });
  ['strengths', 'weaknesses', 'plan'].forEach(k => { if (Array.isArray(out[k])) out[k] = out[k].filter(x => x && x.text); });
  out.qa = { fixes: fixes.length, rules: [...new Set(fixes.map(f => f.rule))] };
  return out;
}
function editOne(E, slots, name, clubs) {
  if (!slots.length) return null;
  /* EACH LINE MARKED WITH ITS SLOT (⟦3⟧): the editor drops a line it finds said twice and splits one too long, and the
     piece it hands back is shorter or longer than the one it was given - read by position, every line after a dropped one
     moved up a slot, and a weakness was printed as a strength. The mark goes back on its own slot; a split's second half
     joins its first */
  const MARK = /^\u27E6(\d+)\u27E7\s*/;
  let q = null;
  try { q = E.scrutinise({ kind: 'scout', head: name, dek: '', body: slots.map((s, i) => '\u27E6' + i + '\u27E7 ' + s.text) }, { log: [], clubs: clubs || [], register: 'scout' }); } catch (_) { q = null; }
  if (!q) return null;
  const back = new Map();
  let cur = null;
  (q.piece.body || []).forEach(t => {
    if (typeof t !== 'string') return;
    const m = MARK.exec(t);
    if (m) { cur = +m[1]; back.set(cur, t.replace(MARK, '').trim()); }
    else if (cur != null) back.set(cur, (back.get(cur) + ' ' + t).trim());
  });
  slots.forEach((s, i) => { const t = back.get(i); s.put(t ? t : null); });
  return q.report.fixes;
}

/* ============================================================== the markup ===== */
function html(r, o) {
  if (!r) return '';
  const op = o || {};
  const li = xs => xs.map(x => '<li>' + esc(typeof x === 'string' ? x : x.text) + (x && x.why ? ' <span class="rp-ins-why">' + esc(x.why) + '</span>' : '') + '</li>').join('');
  const col = (h, xs, cls) => (xs && xs.length ? '<div class="rp-ins-col ' + cls + '"><h4>' + esc(h) + '</h4><ul>' + li(xs) + '</ul></div>' : '');
  const him = r.kind === 'player';
  /* IT FOLDS, AND OPENS CLOSED (Louie, 2026-10-08): the row is the fold's own button (a <details>, so the keyboard and a
     screen reader know it as one), the read under it. AND THE ROW SELLS WHAT IS INSIDE (Louie, 2026-10-08: "a more visible
     dropdown row"): the read's first line as a teaser, what the fold holds counted, and a button saying what a press does.
     A summary holds phrasing content only, so every line of it is a span */
  const many = (k, one, more) => k + ' ' + (k === 1 ? one : more);
  const has = xs => Array.isArray(xs) && xs.length;
  const chips = [];
  if (has(r.strengths)) chips.push(many(r.strengths.length, 'strength', 'strengths'));
  if (has(r.weaknesses)) chips.push(many(r.weaknesses.length, 'weakness', 'weaknesses'));
  if (has(r.plan)) chips.push(him ? many(r.plan.length, 'way to guard him', 'ways to guard him') : r.plan.length + '-point game plan');
  if (!him && has(r.personnel)) chips.push(many(r.personnel.length, 'player scouted', 'players scouted'));
  const tease = has(r.read) ? r.read[0] : '';
  let s = '<summary class="rp-ins-hd">' +
    '<span class="rp-ins-kick">The scout’s read' + (op.scope ? ' · ' + esc(op.scope) : '') + '</span>' +
    '<h3>Insights <span class="rp-ins-on">on <span translate="no">' + esc(r.name) + '</span></span></h3>' +
    /* the teaser repeats the read's first line, which a screen reader reaches in the fold itself */
    (tease ? '<span class="rp-ins-tease" aria-hidden="true">' + esc(tease) + '</span>' : '') +
    (chips.length ? '<span class="rp-ins-chips">' + chips.map(c => '<span>' + esc(c) + '</span>').join('') + '</span>' : '') +
    '<span class="ep-btn pri rp-ins-act"><span class="rp-ins-act-o">Read the insights</span><span class="rp-ins-act-c">Hide</span>' +
    '<i class="rp-ins-tog" aria-hidden="true"></i></span></summary><div class="rp-ins-bd">' +
    '<p class="rp-ins-src">Written from this report’s numbers, ranked among ' + esc(him ? 'the league’s ' + (r.who || 'players') : 'the league’s ' + r.n + ' clubs') + '.</p>';
  if (r.read && r.read.length) s += '<div class="rp-ins-read">' + r.read.map(p => '<p>' + esc(p) + '</p>').join('') + '</div>';
  const cols = col('Strengths', r.strengths, 'good') + col('Weaknesses', r.weaknesses, 'bad');
  if (cols) s += '<div class="rp-ins-cols">' + cols + '</div>';
  if (r.plan && r.plan.length) s += '<div class="rp-ins-plan"><h4>' + (him ? 'How to guard him' : 'How to prepare') + '</h4><ol>' + li(r.plan) + '</ol></div>';
  if (him && r.defence && r.defence.length) s += '<div class="rp-ins-plan"><h4>Attacking him on defence</h4><ul>' + li(r.defence) + '</ul></div>';
  if (!him && r.personnel && r.personnel.length) {
    s += '<div class="rp-ins-pers"><h4>Personnel</h4>' + r.personnel.map(p => '<div class="rp-ins-p"><div class="rp-ins-pn">' +
      (p.jersey ? '<b class="rp-ins-j">' + esc(p.jersey) + '</b>' : '') + '<span translate="no">' + esc(p.name) + '</span><small>' + esc(p.line) + '</small></div>' +
      (p.roles.length ? '<ul class="rp-ins-roles">' + p.roles.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') +
      (p.guard.length ? '<p class="rp-ins-g"><b>Guarding him:</b> ' + esc(p.guard.join(' ')) + '</p>' : '') + '</div>').join('') + '</div>';
  }
  return '<details class="rp-ins" data-i18n-ctx="report">' + s + '</div></details>';
}

return { team, player, develop, html, TEAM, PLAYER, placeOf, pctOf, poolOf, rolesOf };
}));
