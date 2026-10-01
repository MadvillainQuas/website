'use strict';
/* ============================================================================
   THE FRONT OFFICE (team page): a projected depth chart, and a general manager's reading of the club.

   PROJECTED, NOT PUBLISHED. No club on this platform files a depth chart, so it is worked out from what
   the club has actually done - the same way the injury report is - and says so:

     WHO PLAYS    each player's projected minutes: his last five games weighted over his season
                  (0.6 / 0.4), nought if he is missing now (injuries.js: a regular with no minutes in
                  the club's latest games), and nobody the club has released
     WHO STARTS   the five with the most starts in the club's last five games, ties to the minutes;
                  a club whose feed has no starters starts its five heaviest-minute players
     WHERE        positionOf: the position his box score says he plays (BPM's estimate, weighted by his
                  minutes), the one the roster lists and his height. The five starters are laid on PG..C
                  in that order - on a line, sorting is the best matching there is - and every other
                  player joins the starter he plays most like, where there is room (three deep)

   THE GM'S VIEW reads the club against its own league, never against a platform-wide idea of good:

     STRENGTHS / WEAKNESSES  the measures where the club ranks in the top or bottom quarter of the
                             competition (offence, defence, the four factors at both ends, the shot mix)
     IDENTITY                what it chooses (pace, the three, the rim, sharing the ball): a style, not a grade
     THE ROSTER              how many it plays, how much rests on its best player, how old and how tall
                             the minutes are, and who the on/off numbers say is under- or over-used
     NEEDS                   the weaknesses turned into the player who would fix them

   Every claim carries its number and its rank, so a reader can check it rather than take it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaDepth = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SLOTS = [['PG', 'point guard'], ['SG', 'shooting guard'], ['SF', 'small forward'], ['PF', 'power forward'], ['C', 'centre']];
const DEEP = 3;                      // a slot holds a starter and two behind him; the rest are reserves
const RECENT_W = 0.6;                // the last five games' weight in projected minutes
const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SE = () => root.EpinoiaSeason;

/* ------------------------------------------------------------ the chart --- */
/* o.roster      [{ id, name, num, position, height }]   the active roster
   o.season      Map id -> season row (EpinoiaSeason.players, with bpm_pos)
   o.recent      Map id -> row over the club's last five games (statsForGames), for mpg
   o.starts      { season: Map id -> starts, recent: Map id -> starts in the last five, games: n }
   o.out         Set of ids missing now (injuries.js), o.released Set of ids let go */
function projectedMinutes(season, recent, out) {
  if (out) return 0;
  const s = num(season && season.mpg), r = num(recent && recent.mpg);
  if (s == null && r == null) return 0;
  if (r == null) return s * (1 - RECENT_W);          // not in the last five: his season, discounted
  if (s == null) return r;
  return RECENT_W * r + (1 - RECENT_W) * s;
}

/* WHERE HE PLAYS, from three witnesses, each as good as its evidence:
     the box score   BPM's estimate (bpm_pos), which is the prior until he has played: weighted by his minutes,
                     up to one and a half times the others (150 minutes is half of that)
     the listing     what the club typed into the roster (EpinoiaSeason's scale), when it typed anything
     his height      1.83 m a point guard to 2.09 m a centre, where the roster has it
   Early in a season, and on a feed that lists no positions (most of them), the height and the listing carry it. */
function positionOf(p, season) {
  const S = SE();
  const listed = S && S.positionValue && p.position ? S.positionValue({ position: p.position }) : null;
  const calc = season && typeof season.bpm_pos === 'number' && isFinite(season.bpm_pos) ? season.bpm_pos : null;
  const h = num(p.height);
  const tall = h ? Math.max(1, Math.min(5, 1 + (h - 183) / 6.5)) : null;
  const min = num(season && season.min) || 0;
  let w = 0, v = 0;
  if (calc != null) { const wc = 1.5 * min / (min + 150); v += wc * calc; w += wc; }
  if (listed != null) { v += listed; w += 1; }
  if (tall != null) { v += 0.8 * tall; w += 0.8; }
  return w > 0 ? v / w : 3;
}

function chart(o) {
  const released = o.released || new Set(), out = o.out || new Set();
  const starts = o.starts || { season: new Map(), recent: new Map(), games: 0 };
  const list = (o.roster || []).filter(p => p && p.id && !released.has(p.id)).map(p => {
    const s = o.season && o.season.get(p.id), r = o.recent && o.recent.get(p.id);
    const isOut = out.has(p.id);
    return {
      id: p.id, name: p.name, num: p.num, pos: positionOf(p, s), listed: p.position || '',
      mpg: num(s && s.mpg), gp: num(s && s.gp) || 0, recentMpg: num(r && r.mpg),
      ppg: num(s && s.ppg), rpg: num(s && s.rpg), apg: num(s && s.apg), bpm: num(s && s.bpm),
      proj: Math.round(projectedMinutes(s, r, isOut) * 10) / 10, out: isOut,
      starts: starts.season.get(p.id) || 0, recentStarts: starts.recent.get(p.id) || 0
    };
  });
  const able = list.filter(p => !p.out);
  /* the five who start: recent starts first, then projected minutes */
  const order = able.slice().sort((a, b) => (b.recentStarts - a.recentStarts) || (b.proj - a.proj) || (b.starts - a.starts) ||
                                            String(a.name).localeCompare(String(b.name)));
  const starters = (starts.games ? order : able.slice().sort((a, b) => b.proj - a.proj)).slice(0, 5);
  const slots = SLOTS.map(([k, label]) => ({ key: k, label, players: [] }));
  /* on a line, sorting both sides is the least-cost matching: point guard to centre */
  starters.slice().sort((a, b) => (a.pos - b.pos) || (b.proj - a.proj)).forEach((p, i) => slots[i].players.push(Object.assign(p, { role: 'starter' })));
  /* THE BENCH JOINS THE STARTER HE PLAYS MOST LIKE. A box-score position is regressed to the middle (season.js:
     a real league's run from about 2.2 to 3.7, not 1 to 5), so a slot is not the number 1..5 but the starter in it:
     a backup centre is the man whose value is nearest the starting centre's, whatever the two numbers are. */
  const anchor = slots.map((s, i) => (s.players[0] ? s.players[0].pos : 1 + i));
  const reserves = [];
  const bench = list.filter(p => !starters.includes(p)).sort((a, b) => (b.proj - a.proj) || String(a.name).localeCompare(String(b.name)));
  bench.forEach(p => {
    if (p.out) { reserves.push(Object.assign(p, { role: 'out' })); return; }
    const byNear = slots.map((s, i) => ({ s, d: Math.abs(p.pos - anchor[i]) + i * 1e-6 })).sort((a, b) => a.d - b.d);
    const room = byNear.find(x => x.s.players.length < DEEP);
    if (room && p.proj >= 1) room.s.players.push(Object.assign(p, { role: 'rotation' }));
    else reserves.push(Object.assign(p, { role: 'reserve' }));
  });
  const rotation = list.filter(p => !p.out && p.proj >= 10).length;
  return { slots, reserves, starters, rotation, games: starts.games || 0,
           out: list.filter(p => p.out), total: list.length };
}

/* THE GAME'S LENGTH, from the league's rules (periods x period length): 40 minutes for FIBA's four tens, 48 for four
   twelves. Overtime is not counted - a depth chart is the regulation game. */
function gameMinutes(rules) {
  const p = num(rules && rules.periods), ms = num(rules && rules.period_ms);
  return p > 0 && ms > 0 ? p * ms / 60000 : 40;
}

/* MINUTES THAT ADD UP. Scale a list of minutes to `total`, none past `cap` (a player cannot play more than the game):
   whoever reaches the cap is held there and the rest is shared again among the others. */
function scaleTo(list, total, cap) {
  const out = list.map(v => Math.max(0, +v || 0));
  const held = new Set();
  for (let k = 0; k < out.length + 1; k++) {
    const free = out.reduce((a, v, i) => a + (held.has(i) ? 0 : v), 0);
    const want = total - held.size * cap;
    if (!(free > 0) || !(want > 0)) break;
    const f = want / free;
    let over = false;
    out.forEach((v, i) => { if (held.has(i)) return; const x = v * f; if (x > cap) { out[i] = cap; held.add(i); over = true; } else out[i] = x; });
    if (!over) break;
  }
  return out;
}

/* ROUNDED SO THE POSITION STILL ADDS UP: each figure to a tenth, the tenths left over handed to the largest remainders
   (no 39.9 or 40.1 under a 40-minute game). */
function roundTo(xs, total) {
  const T = Math.round(total * 10), raw = xs.map(v => v * 10), flo = raw.map(Math.floor);
  let left = T - flo.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - flo[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { flo[i]++; left--; } });
  return flo.map(v => v / 10);
}

/* THE DEPTH CHART THAT ADDS UP (before the club's stints are built). Every able player's projected minutes are scaled
   so the club's add up to five times the game (5 x 40 = 200), none past the game itself; then the players are laid
   end to end from the smallest to the biggest by where they play (positionOf) and the line is cut into five equal
   lengths, point guard to centre. Each position is then exactly one game long, and a player whose minutes cross a cut
   is at both: two guards on 1.4 and 1.6 share the point guard's 40, and the one a little bigger carries his
   remainder to shooting guard. chart() is kept as it was for the league view (one slot each). */
function splitChart(base, L) {
  const len = num(L) > 0 ? +L : 40;
  if (!base || !base.slots) return base;
  const all = [];
  base.slots.forEach(s => s.players.forEach(p => all.push(p)));
  base.reserves.forEach(p => all.push(p));
  const able = all.filter(p => !p.out && p.proj > 0);
  if (!able.length) return base;
  const starters = new Set((base.starters || []).map(p => p.id));
  const line = able.slice().sort((a, b) => (a.pos - b.pos) || ((starters.has(b.id) ? 1 : 0) - (starters.has(a.id) ? 1 : 0)) ||
                                           (b.proj - a.proj) || String(a.name).localeCompare(String(b.name)));
  const mins = scaleTo(line.map(p => p.proj), 5 * len, len);
  const parts = SLOTS.map(() => []);
  let at = 0;
  line.forEach((p, j) => {
    const from = at, to = at + mins[j];
    at = to;
    for (let i = 0; i < 5; i++) {
      const m = Math.min(to, (i + 1) * len) - Math.max(from, i * len);
      if (m > 1e-9) parts[i].push({ p, m, game: mins[j] });
    }
  });
  const placed = new Set();
  const slots = SLOTS.map(([k, label], i) => {
    const here = parts[i].slice().sort((a, b) => (b.m - a.m) || String(a.p.name).localeCompare(String(b.p.name)));
    const shown = roundTo(here.map(x => x.m), here.reduce((a, x) => a + x.m, 0));
    const players = here.map((x, n) => Object.assign({}, x.p, { role: starters.has(x.p.id) ? 'starter' : 'rotation',
      slotMin: shown[n], gameMin: Math.round(x.game * 10) / 10, share: x.m / len })).filter(p => p.slotMin > 0);
    players.forEach(p => placed.add(p.id));
    return { key: k, label, players, total: shown.reduce((a, b) => a + b, 0) };
  });
  const reserves = all.filter(p => !placed.has(p.id)).map(p => Object.assign({}, p, { role: p.out ? 'out' : 'reserve' }))
    .sort((a, b) => ((a.out ? 1 : 0) - (b.out ? 1 : 0)) || (b.proj - a.proj) || String(a.name).localeCompare(String(b.name)));
  return Object.assign({}, base, { slots, reserves, source: 'split', gameMin: len });
}

/* THE DEPTH CHART BY THE FLOOR (addendum A.1). Where the builder has the club's stints, each position is filled from
   the minutes each player actually played there: every five on the floor ranked point guard to centre by the players'
   box-score positions (EpinoiaWinModel.slotMinutes), each stint's seconds added to each man's slot. o.pos is the `pos`
   file ({games, min, players: [{id, pos, min: [m1..m5]}], slots}); everything else is chart()'s. A position lists the
   three who played it most, each with his share of its minutes; a player can stand at two. The projected minutes,
   who starts and who is missing come from chart() as before. No stints (no pos file, or no minutes in it): null, and the
   page draws chart() itself. */
function slotChart(o) {
  const pos = o && o.pos;
  if (!pos || !Array.isArray(pos.players)) return null;
  const at = new Map(pos.players.filter(p => p && p.id != null && Array.isArray(p.min)).map(p => [String(p.id), p]));
  const totals = [0, 1, 2, 3, 4].map(k => pos.players.reduce((a, p) => a + (Array.isArray(p.min) && num(p.min[k]) > 0 ? +p.min[k] : 0), 0));
  if (!(totals.reduce((a, b) => a + b, 0) > 0)) return null;
  const base = chart(o);
  const games = num(pos.games) || 0, len = num(o.gameMin) > 0 ? +o.gameMin : 40;
  const able = [];
  base.slots.forEach(s => s.players.forEach(p => able.push(p)));
  base.reserves.forEach(p => able.push(p));
  const starters = new Set(base.starters.map(p => p.id));
  const placed = new Set();
  const slots = SLOTS.map(([k, label], i) => {
    const here = able.filter(p => !p.out && at.has(String(p.id)) && num(at.get(String(p.id)).min[i]) > 0)
      .map(p => { const m = +at.get(String(p.id)).min[i]; return Object.assign({}, p, { role: starters.has(p.id) ? 'starter' : 'rotation', slotMin: m,
        share: totals[i] > 0 ? m / totals[i] : 0, perGame: games > 0 ? m / games : null }); })
      .sort((a, b) => (b.slotMin - a.slotMin) || String(a.name).localeCompare(String(b.name)));
    /* a game at each position: his share of the minutes played there, of the regulation game - every player who stood
       there, so the column adds up to the game (overtime and a short feed scale away) */
    const shown = roundTo(here.map(p => p.share * len), here.length ? len : 0);
    const players = here.map((p, n) => Object.assign(p, { perGame: shown[n] })).filter(p => p.perGame > 0);
    players.forEach(p => placed.add(p.id));
    return { key: k, label, players, total: shown.reduce((a, b) => a + b, 0) };
  });
  const reserves = able.filter(p => !placed.has(p.id)).map(p => Object.assign({}, p, { role: p.out ? 'out' : 'reserve' }))
    .sort((a, b) => ((a.out ? 1 : 0) - (b.out ? 1 : 0)) || (b.proj - a.proj) || String(a.name).localeCompare(String(b.name)));
  return Object.assign({}, base, { slots, reserves, source: 'stints', games: base.games, posGames: games, posMin: totals, gameMin: len });
}

/* ------------------------------------------------------------ the GM ------- */
/* The measures a GM reads a club by: [key on the team row, label, lower-is-better, kind] */
const MEASURES = [
  ['ortg', 'offensive rating', false, 'grade'], ['drtg', 'defensive rating', true, 'grade'], ['net', 'net rating', false, 'grade'],
  ['ff_efg', 'shooting (eFG%)', false, 'grade'], ['dff_efg', 'opponents\' shooting (eFG% allowed)', true, 'grade'],
  ['ff_tov', 'ball security (TOV%)', true, 'grade'], ['dff_tov', 'forcing turnovers (opponents\' TOV%)', false, 'grade'],
  ['ff_oreb', 'the offensive glass (OREB%)', false, 'grade'], ['dff_oreb', 'the defensive glass (OREB% allowed)', true, 'grade'],
  ['ff_ftr', 'getting to the line (FT rate)', false, 'grade'], ['dff_ftr', 'fouling (opponents\' FT rate)', true, 'grade'],
  ['p3_pct', 'three-point shooting', false, 'grade'], ['ft_pct', 'free-throw shooting', false, 'grade'], ['rim_pct', 'finishing at the rim', false, 'grade'],
  ['pace', 'pace', false, 'style'], ['p3_share', 'the three as a share of shots', false, 'style'], ['rim_share', 'the rim as a share of shots', false, 'style']
];

/* where a club ranks on one measure among the league's clubs: 1 is the best */
function rank(teams, id, key, lowGood) {
  const vals = teams.filter(t => num(t[key]) != null).map(t => ({ id: t.id, v: +t[key] }));
  const me = vals.find(x => x.id === id);
  if (!me || vals.length < 4) return null;
  const better = vals.filter(x => (lowGood ? x.v < me.v : x.v > me.v)).length;
  return { rank: better + 1, of: vals.length, value: me.v };
}
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
/* a rating or a pace as it stands; everything else is a percentage */
const fmt = (k, v) => (v == null ? '—' : (+v).toFixed(1) + (/^(ortg|drtg|net|pace)$/.test(k) ? '' : '%'));

/* the player who would fix a weakness, by the measure it shows up in */
const NEED = {
  drtg: 'a defender who changes games - a rim protector or a stopper on the ball',
  dff_efg: 'length on the perimeter and a big who contests at the rim',
  ff_tov: 'a secure ball-handler: an organiser who does not give it away',
  dff_tov: 'active hands - defenders who pressure the ball and jump passing lanes',
  ff_oreb: 'a big who crashes the offensive glass',
  dff_oreb: 'a rebounder: someone who finishes defensive possessions',
  ff_ftr: 'a driver who draws fouls',
  dff_ftr: 'disciplined defenders who stay down and keep their hands off',
  p3_pct: 'a reliable shooter to space the floor',
  ft_pct: 'a closer who makes his free throws',
  rim_pct: 'a finisher: a big who catches and dunks, or a guard who finishes through contact',
  ff_efg: 'shot-making: a scorer who creates good looks',
  ortg: 'a creator: somebody the offence can run through'
};

function gm(o) {
  const team = o.team || {}, teams = (o.teams || []).filter(t => num(t.gp) > 0), players = o.players || [];
  const mineRow = teams.find(t => t.id === team.id);
  const out = { strengths: [], weaknesses: [], identity: [], roster: [], needs: [], graded: false, of: teams.length,
                gp: mineRow ? num(mineRow.gp) : 0 };
  const ranked = MEASURES.map(([k, label, low, kind]) => Object.assign({ key: k, label, low, kind }, rank(teams, team.id, k, low) || {}))
    .filter(r => r.rank != null);
  out.graded = ranked.length > 0;
  const q = r => r.rank / r.of;                      // 0..1, small is good
  /* THE WIN MODEL (o.model, docs/what-wins-model.md §12): the same measures are picked, then ordered by what each is
     worth in wins (|wins|, the ones the model values first, the rest after in rank order); each entry carries its
     wins and the needs follow that order. Without a model nothing here changes. */
  const W = o.model && o.model.wins ? o.model.wins : null;
  const wOf = k => (W && typeof W[k] === 'number' && isFinite(W[k]) ? W[k] : null);
  const byWins = list => (!W ? list : list.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = wOf(a.r.key), y = wOf(b.r.key);
    if (x != null && y != null) return (Math.abs(y) - Math.abs(x)) || (a.i - b.i);
    return x != null ? -1 : y != null ? 1 : a.i - b.i;
  }).map(x => x.r));
  const entry = (r, e) => (W ? Object.assign(e, { wins: wOf(r.key) }) : e);
  const grades = ranked.filter(r => r.kind === 'grade');
  byWins(grades.filter(r => q(r) <= 0.25).sort((a, b) => q(a) - q(b)).slice(0, 4))
    .forEach(r => out.strengths.push(entry(r, { key: r.key, text: cap(r.label), detail: fmt(r.key, r.value) + ', ' + ordinal(r.rank) + ' of ' + r.of })));
  const weak0 = grades.filter(r => q(r) > 0.75 && r.rank > r.of - Math.max(1, Math.round(r.of / 4))).sort((a, b) => q(b) - q(a));
  byWins(weak0.slice(0, 4)).forEach(r => out.weaknesses.push(entry(r, { key: r.key, text: cap(r.label), detail: fmt(r.key, r.value) + ', ' + ordinal(r.rank) + ' of ' + r.of })));
  const weak = byWins(weak0);
  if (W) out.model = true;
  /* a need per weakness, the most urgent first, never the same player twice */
  const seen = new Set();
  /* three at most: a GM's list of needs is a priority order, not a wish list */
  weak.forEach(r => { const n = NEED[r.key]; if (n && !seen.has(n) && out.needs.length < 3) { seen.add(n); out.needs.push(entry(r, { key: r.key, text: cap(n), why: r.label + ' ' + ordinal(r.rank) + ' of ' + r.of })); } });
  /* identity: the styles, read as choices */
  const style = k => ranked.find(r => r.key === k);
  const pace = style('pace'), three = style('p3_share'), rim = style('rim_share');
  if (pace) out.identity.push({ key: 'pace', text: q(pace) <= 0.33 ? 'Plays fast' : q(pace) >= 0.67 ? 'Slows the game down' : 'Plays at the league\'s pace',
                                detail: fmt('pace', pace.value) + ' possessions, ' + ordinal(pace.rank) + ' fastest of ' + pace.of });
  if (three) out.identity.push({ key: 'p3', text: q(three) <= 0.33 ? 'Lives beyond the arc' : q(three) >= 0.67 ? 'Rarely shoots threes' : 'A balanced shot diet',
                                 detail: fmt('p3_share', three.value) + ' of shots from three, the ' + ordinal(three.rank) + ' most of ' + three.of });
  if (rim && q(rim) <= 0.33) out.identity.push({ key: 'rim', text: 'Attacks the rim', detail: fmt('rim_share', rim.value) + ' of shots at the rim, the ' + ordinal(rim.rank) + ' most of ' + rim.of });

  /* the roster: its shape from the season lines of its own players */
  const mine = players.filter(p => num(p.min) > 0);
  const minutes = mine.reduce((a, p) => a + +p.min, 0);
  if (mine.length && minutes > 0) {
    const byMin = mine.slice().sort((a, b) => b.min - a.min);
    const rotation = mine.filter(p => num(p.mpg) >= 10).length;
    out.roster.push({ key: 'rotation', text: rotation <= 7 ? 'A short rotation' : rotation >= 10 ? 'A deep rotation' : 'A normal rotation',
      detail: rotation + ' players average 10 minutes or more' });
    const top5 = byMin.slice(0, 5).reduce((a, p) => a + +p.min, 0) / minutes;
    out.roster.push({ key: 'starters', text: top5 >= 0.68 ? 'Leans on its starters' : top5 <= 0.56 ? 'Spreads the minutes' : 'Starters and bench in the usual balance',
      detail: Math.round(top5 * 100) + '% of the minutes go to its five most-used players' });
    const pts = mine.reduce((a, p) => a + (num(p.pts) || 0), 0);
    const star = mine.slice().sort((a, b) => (num(b.pts) || 0) - (num(a.pts) || 0))[0];
    if (star && pts > 0) {
      const share = (num(star.pts) || 0) / pts;
      if (share >= 0.22) out.roster.push({ key: 'star', text: 'Runs through ' + (star.name || 'one player'),
        detail: Math.round(share * 100) + '% of the team\'s points' + (num(star.usg) != null ? ', a usage of ' + (+star.usg).toFixed(1) + '%' : '') });
    }
    if (o.ages && o.ages.size) {
      let w = 0, a = 0;
      mine.forEach(p => { const age = o.ages.get(p.id); if (age != null) { a += age * p.min; w += +p.min; } });
      if (w > minutes * 0.5) {
        const avg = a / w;
        out.roster.push({ key: 'age', text: avg < 24 ? 'A young side' : avg >= 29 ? 'A veteran side' : 'In its prime years',
          detail: 'minutes-weighted age ' + avg.toFixed(1) });
      }
    }
    if (o.heights && o.heights.size) {
      let w = 0, h = 0;
      mine.forEach(p => { const x = o.heights.get(p.id); if (x) { h += x * p.min; w += +p.min; } });
      if (w > minutes * 0.5) out.roster.push({ key: 'height', text: 'Its minutes stand ' + (h / w / 100).toFixed(2) + ' m tall on average',
        detail: 'minutes-weighted height, from the heights the roster lists' });
    }
    /* who the on/off numbers argue about: a big plus in few minutes, a big minus in many */
    const withOnOff = mine.filter(p => num(p.diff_net) != null && num(p.min) >= 60);
    const under = withOnOff.filter(p => p.diff_net >= 8 && num(p.mpg) < 20).sort((a, b) => b.diff_net - a.diff_net)[0];
    const over = withOnOff.filter(p => p.diff_net <= -8 && num(p.mpg) >= 24).sort((a, b) => a.diff_net - b.diff_net)[0];
    if (under) out.roster.push({ key: 'under', text: 'More minutes for ' + under.name + '?',
      detail: 'the team is ' + (+under.diff_net).toFixed(1) + ' points per 100 better with him on the floor, in ' + (+under.mpg).toFixed(1) + ' minutes a game' });
    if (over) out.roster.push({ key: 'over', text: 'A question over ' + over.name + '\'s minutes',
      detail: 'the team is ' + Math.abs(+over.diff_net).toFixed(1) + ' points per 100 worse with him on, in ' + (+over.mpg).toFixed(1) + ' minutes a game' });
  }
  return out;
}
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/* ------------------------------------------------------------- the views --- */
function chartHTML(c, o) {
  const opt = o || {};
  if (!c || !c.total) return '<div class="empty">No players on the roster yet.</div>';
  /* by the floor (slotChart): the minutes he played at this position a game and his share of them, the bar his share */
  const bySlot = c.source === 'stints', split = c.source === 'split', L = c.gameMin || 40;
  const startsOf = p => (p.role === 'starter' && p.recentStarts ? ' · ' + p.recentStarts + '/' + Math.min(5, c.games) + ' starts' : '');
  const cell = p => '<div class="dc-p dc-' + p.role + '">' +
    '<span class="dc-n">' + (p.num != null && p.num !== '' ? '<b>#' + esc(p.num) + '</b> ' : '') +
    (opt.link ? '<a href="' + esc(opt.link(p)) + '">' + esc(p.name) + '</a>' : esc(p.name)) + '</span>' +
    (split
      ? '<span class="dc-m">' + p.slotMin.toFixed(1) + ' min' + (Math.abs(p.gameMin - p.slotMin) > 0.05 ? ' of his ' + p.gameMin.toFixed(1) : '') + startsOf(p) + '</span>' +
        '<i class="dc-bar" style="--w:' + Math.min(100, p.slotMin / L * 100).toFixed(0) + '%"></i></div>'
      : bySlot && typeof p.share === 'number'
      ? '<span class="dc-m">' + (p.perGame != null ? p.perGame.toFixed(1) + ' min a game' : Math.round(p.slotMin) + ' min') + ' · ' + Math.round(p.share * 100) + '%' + startsOf(p) + '</span>' +
        '<i class="dc-bar dc-share" style="--w:' + Math.min(100, p.share * 100).toFixed(0) + '%"></i></div>'
      : '<span class="dc-m">' + (p.proj ? p.proj.toFixed(1) + ' min' : '—') + (p.role === 'starter' && p.recentStarts ? ' · ' + p.recentStarts + '/' + Math.min(5, c.games) + ' starts' : '') + '</span>' +
        '<i class="dc-bar" style="--w:' + Math.min(100, p.proj / 40 * 100).toFixed(0) + '%"></i></div>');
  /* each position is a button: the league's view of that position (position.js) opens from it */
  const cols = c.slots.map(s => '<div class="dc-col"><button type="button" class="dc-h" data-slot="' + s.key + '" aria-label="' + esc(s.label) +
    's against the league"><b>' + s.key + '</b><span>' + esc(s.label) + '</span><i class="dc-go" aria-hidden="true">↗</i></button>' +
    (s.players.length ? s.players.map(cell).join('') : '<div class="dc-p dc-empty">—</div>') +
    (typeof s.total === 'number' && s.players.length ? '<div class="dc-sum"><span>' + s.key + '</span><b>' + s.total.toFixed(1) + ' / ' + L + ' min</b></div>' : '') +
    '</div>').join('');
  const res = c.reserves.length ? '<div class="dc-res"><span class="dc-rk">also on the roster</span>' + c.reserves.map(p =>
    '<span class="dc-chip' + (p.out ? ' dc-out' : '') + '">' + (p.num != null && p.num !== '' ? '#' + esc(p.num) + ' ' : '') + esc(p.name) +
    (p.out ? ' · out' : p.proj ? ' · ' + p.proj.toFixed(1) + ' min' : '') + '</span>').join('') + '</div>' : '';
  if (bySlot) return '<div class="dc-hint">press a position for its league view: every club\'s group at it, charted</div>' +
    '<div class="dc">' + cols + '</div>' + res +
    '<div class="dc-note">each position filled from the minutes played at it this season, a ' + L + '-minute game at each' + (c.posGames ? ' (' + c.posGames + (c.posGames === 1 ? ' game' : ' games') + ')' : '') +
    ': every five on the floor ranked point guard to centre by box-score position' +
    (c.out.length ? ' · out: ' + c.out.map(p => esc(p.name)).join(', ') + ' (no minutes in the club\'s latest games)' : '') + '</div>';
  if (split) return '<div class="dc-hint">press a position for its league view: every club\'s group at it, charted</div>' +
    '<div class="dc">' + cols + '</div>' + res +
    '<div class="dc-note">each position adds up to the ' + L + '-minute game: every player\'s projected minutes (the last ' + Math.min(5, c.games || 0) +
    ' games weighted 60 / 40 against the season, scaled to the club\'s ' + 5 * L + '), laid end to end from point guard to centre by where he plays and cut into five; a player whose minutes cross a cut plays at both' +
    (c.out.length ? ' · out: ' + c.out.map(p => esc(p.name)).join(', ') + ' (no minutes in the club\'s latest games)' : '') + '</div>';
  return '<div class="dc-hint">press a position for its league view: every club\'s group at it, charted</div>' +
    '<div class="dc">' + cols + '</div>' + res +
    '<div class="dc-note">projected from the last ' + Math.min(5, c.games || 0) + ' games\' starts and minutes (weighted 60 / 40 against the season)' +
    (c.out.length ? ' · out: ' + c.out.map(p => esc(p.name)).join(', ') + ' (no minutes in the club\'s latest games)' : '') +
    ' · positions from what each player does, corrected by the roster\'s listing</div>';
}

function gmHTML(g) {
  if (!g || !g.graded) return '<div class="empty">The league has too few clubs with finished games to read this one against yet.</div>';
  /* with the win model (o.model), an entry it values says what it is worth */
  const worth = x => (typeof x.wins === 'number' && isFinite(x.wins) ? '<em class="gm-w">worth ' + (x.wins >= 0.05 ? '+' : x.wins <= -0.05 ? '−' : '') +
    Math.abs(x.wins).toFixed(1) + ' wins per 30 games</em>' : '');
  const block = (title, cls, items, key) => items.length ? '<div class="gm-b gm-' + cls + '"><div class="gm-h">' + title + '</div>' +
    items.map(x => '<div class="gm-i"><b>' + esc(x.text) + '</b><span>' + esc(x[key || 'detail']) + '</span>' + worth(x) + '</div>').join('') + '</div>' : '';
  /* A FEW GAMES ARE A FEW GAMES: under five, the reader is told so before anything else */
  const early = g.gp && g.gp < 5 ? '<div class="gm-early">after ' + g.gp + (g.gp === 1 ? ' game' : ' games') +
    ': an early reading, and the ranks will move</div>' : '';
  return early + '<div class="gm">' +
    block('strengths', 'good', g.strengths) + block('weaknesses', 'bad', g.weaknesses) +
    block('identity', 'style', g.identity) + block('the roster', 'roster', g.roster) +
    block('what it needs', 'need', g.needs, 'why') + '</div>' +
    '<div class="gm-note">every rank is among the ' + g.of + ' clubs of this competition, this season · a style is a choice, not a grade' +
    (g.model ? ' · ordered by what each is worth in wins (the win model, F3)' : '') + '</div>';
}

return { chart, slotChart, splitChart, gameMinutes, scaleTo, roundTo, gm, chartHTML, gmHTML, projectedMinutes, positionOf, rank, SLOTS, MEASURES, NEED };
}));
