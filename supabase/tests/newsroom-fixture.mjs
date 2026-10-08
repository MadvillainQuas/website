/* ============================================================================
   A SYNTHETIC LEAGUE FOR THE NEWSROOM'S TESTS (newsroom.test.mjs, newsdesk-i18n.test.mjs): eight clubs, twelve rounds,
   three players a club (the first a star, Northside's gone cold over the last four), the season file's club and player
   rows with the deep numbers (events splits, zones, on/off, positional BPM), three fixtures, a rivalry between the top
   two. build(gender, o) -> the newsroom's input.

     o.full    every format opens: Valley Kings on a five-game run and Hilltop on a five-game slide (the four factors
               of every game), Westgate's star out of the last three games, Harbour City's star twenty, and the last
               fortnight's games replayed (the shot clock in three windows, Hilltop the late-clock specialists; the fives
               on the floor, Valley Kings' best five well ahead);
     o.shift   the whole league moved on by this many days (the templates a piece picks follow its week and month), its
               fixtures' ids salted with it (the game to watch's reasons follow the game);
     o.variant the branches a single league cannot reach at once, turned in rotation: the trait Riverside are the best
               at and Westgate the worst at (each of the seven in turn, so every identity piece and the next opponent's
               figure that meets it is written), the cold star's last game one point (odd), and the MVP's on/off the
               wrong way round (every third).
   ============================================================================ */
export const DAY = 86400000, NOW = Date.parse('2026-10-08T12:00:00Z');
const uuid = (n, k) => (k + '0000000-0000-4000-8000-' + String(n).padStart(12, '0')).slice(-36).replace(/^.{8}/, (k + '0000000').slice(0, 8));
export const T = Array.from({ length: 8 }, (_, i) => ({ id: uuid(i + 1, 'a'), name: ['Northside', 'Harbour City', 'Valley Kings', 'Riverside', 'Westgate', 'Eastfield', 'Hilltop', 'Lakeshore'][i] }));
const teams = Object.fromEntries(T.map(t => [t.id, { name: t.name, slug: t.name.toLowerCase().replace(/\s+/g, '-') }]));
/* the five on the floor beyond the three named: two more a club, named only in the replays */
export const BENCH = T.map(t => ['Di', 'Ed'].map(f => f + ' ' + t.name.split(' ')[0] + 'son'));
export function build(gender, o) {
  const op = o || {}, full = !!op.full, NOWS = NOW + (op.shift || 0) * DAY, fx = id => (op.shift ? id + '-' + op.shift : id);
  const games = [], lines = [], players = [], names = {};
  /* three players a club: the first the star */
  T.forEach((t, i) => [0, 1, 2].forEach(k => { const id = uuid(i * 10 + k + 1, 'b'); names[id] = { name: ['Ada', 'Bo', 'Cy'][k] + ' ' + t.name.split(' ')[0] + 'son', slug: 'p' + i + k }; }));
  let n = 0;
  const round = [];
  for (let r = 0; r < 12; r++) T.forEach((h, i) => {
    if (i % 2) return;
    const a = T[(i + 1 + r) % 8];
    if (a.id === h.id) return;
    const at = new Date(NOWS - (40 - r * 3) * DAY).toISOString(), hs = 70 + ((i * 7 + r * 5) % 25), as = 68 + ((i * 3 + r * 11) % 25);
    const id = uuid(++n, 'c');
    games.push({ id, home_team_id: h.id, away_team_id: a.id, home_score: hs, away_score: as, tipoff_at: at, competition_id: 'lg' });
    round.push(r);
  });
  /* the run and the slide: each club's last five, won (lost) by nine */
  if (full) [[2, 1], [6, -1]].forEach(([ti, sign]) => {
    const id = T[ti].id;
    games.filter(g => g.home_team_id === id || g.away_team_id === id).slice(-5).forEach(g => {
      const home = g.home_team_id === id;
      if ((home ? 1 : -1) * sign > 0) g.home_score = g.away_score + 9; else g.away_score = g.home_score + 9;
    });
  });
  const absent = uuid(4 * 10 + 1, 'b');
  games.forEach((g, gi) => {
    const r = round[gi];
    [T.find(t => t.id === g.home_team_id), T.find(t => t.id === g.away_team_id)].forEach((t, side) => [0, 1, 2].forEach(k => {
      const pi = T.indexOf(t), pid = uuid(pi * 10 + k + 1, 'b');
      /* Westgate's star has missed the last three */
      if (full && pid === absent && r >= 10) return;
      /* Northside's star goes cold over the last four */
      const cold = pi === 0 && k === 0 && r >= 8, onePoint = cold && op.variant % 2 === 1 && gi === games.length - 1 - games.slice().reverse().findIndex(x => x.home_team_id === t.id || x.away_team_id === t.id);
      lines.push({ game_id: g.id, team_idx: side, pid, min: (30 - k * 5) * 60000, pts: onePoint ? 1 : cold ? 6 : 22 - k * 6, reb: 6, ast: 4, stl: 1, blk: 0, p3m: 2, fgm: cold ? 2 : 8, fga: 15, p3a: 5, ftm: 2, fta: 3, tov: 2 });
    }));
  });
  T.forEach((t, i) => [0, 1, 2].forEach(k => { const id = uuid(i * 10 + k + 1, 'b');
    players.push({ id, _teamId: t.id, gp: 12, min: (30 - k * 5) * 12, mpg: 30 - k * 5, ppg: 22 - k * 6, rpg: 6, apg: 4, bpm: (k === 0 ? 6 - i * 0.6 : 1 - k), vorp: 1.5 - k * 0.5, ts: 58 - k * 2, usg: 26 - k * 4,
      bpm_pos: [1.5, 2.8, 4.4][k], on_poss: 500, on_net: 8 - k * 4 - i * 0.5, off_net: -2, diff_net: 10 - k * 4 - i * 0.5, rim_rate: 30, mid_rate: 25, p3_rate: 45 }); }));
  const teamRows = T.map((t, i) => ({ id: t.id, gp: 12, pace: 68 + i * 1.5, rim_share: 30 + i * 2, p3_share: 45 - i * 2, ff_oreb: 25 + i, dff_oreb: 30 - i * 0.5, ff_tov: 12 + i * 0.5, dff_tov: 13 + (7 - i) * 0.4,
    evd_all_rim_pct: 55 + i * 1.5, evd_all_p3_pct: 33 + (i % 3), ev_transition_freq: 12 + i, ev_transition_ppp: 1.0 + i * 0.03, ev_transition_ch_pg: 12, evd_transition_ppp: 1.0 + (7 - i) * 0.03,
    ev_half_ppp: 0.85 + i * 0.01, ev_half_ch_pg: 60, evd_half_ppp: 0.85 + (7 - i) * 0.012, evd_half_ch_pg: 60, ev_offTo_ppg: 14, ev_offTo_ppp: 1.0 }));
  /* the variant's trait: [key, which way is better, how far past the ends] for newsroom.js FACETS in order */
  if (op.variant != null) {
    const [key, dir, step] = [['ev_transition_ppp', 1, 0.09], ['ev_half_ppp', 1, 0.03], ['evd_half_ppp', -1, 0.036], ['ff_oreb', 1, 3], ['evd_all_rim_pct', -1, 4.5],
      ['dff_tov', 1, 1.2], ['ff_tov', -1, 1.5]][op.variant % 7];
    const vals = teamRows.map(r => r[key]), hi = Math.max(...vals), lo = Math.min(...vals);
    teamRows[3][key] = dir > 0 ? hi + step : lo - step;
    teamRows[4][key] = dir > 0 ? lo - step : hi + step;
  }
  if (op.variant % 3 === 2) Object.assign(players[0], { on_net: -1, off_net: 3.5, diff_net: -4.5 });
  const fixtures = [{ id: fx('fx1'), home_team_id: T[0].id, away_team_id: T[1].id, tipoff_at: new Date(NOWS + 2 * DAY).toISOString() },
                    { id: fx('fx2'), home_team_id: T[2].id, away_team_id: T[3].id, tipoff_at: new Date(NOWS + 3 * DAY).toISOString() },
                    { id: fx('fx3'), home_team_id: T[4].id, away_team_id: T[5].id, tipoff_at: new Date(NOWS + 4 * DAY).toISOString() }];
  const table = { comp: { id: 'lg' }, rows: T.map((t, i) => ({ team_id: t.id, rank: i + 1, gp: 12, w: 10 - i, l: 2 + i })) };
  /* the four factors of every game, the winner's better by the margin */
  const teamLines = full ? games.flatMap(g => [0, 1].map(s => {
    const d = (s ? -1 : 1) * (g.home_score - g.away_score);
    return { game_id: g.id, team_idx: s, adv: { efg: 50 + d * 0.5, tovp: 14 - d * 0.15, orebp: 28 + d * 0.3, ftr: 25, possessions: 72 } };
  })) : [];
  /* the last games replayed (from round nine; the odd clubs play every other round): each side's first chances by the shot clock [0-8 s, points, 8-16, points, past 16, points,
     average possession] and its three fives (names, seconds, points for and against), its stints' totals */
  const recaps = {};
  if (full) games.forEach((g, gi) => {
    if (round[gi] < 8) return;
    const side = s => {
      const ti = T.findIndex(t => t.id === (s ? g.away_team_id : g.home_team_id)), nm = [0, 1, 2].map(k => names[uuid(ti * 10 + k + 1, 'b')].name).concat(BENCH[ti]);
      const late = ti === 6 ? 1.35 : 0.78 + (ti % 4) * 0.02, lead = ti === 2 ? 8 : 2;
      return { clock: [30, 33, 28, 27, 18, Math.round(18 * late), 14.2 + ti * 0.3],
               fives: [{ n: nm, dur: 900, pf: 24 + lead, pa: 24 }, { n: nm.slice(0, 4).concat([BENCH[ti][0]]), dur: 600, pf: 15, pa: 15 }],
               total: [2400, s ? g.away_score : g.home_score, s ? g.home_score : g.away_score] };
    };
    const h = side(0), a = side(1);
    recaps[g.id] = { headline: '', deep: { clock: [h.clock, a.clock], fives: [h.fives, a.fives], total: [h.total, a.total] } };
  });
  return { now: new Date(NOWS), league: { id: uuid(1, 'e'), slug: 'test-league', name: 'Test League', gender }, season: { id: 's', name: '2026-27' }, comp: { id: 'lg' },
    comps: [{ id: 'lg', kind: 'league' }], table, teams, games, fixtures, lines, teamLines, names, players, teamRows, recaps, model: null, tallies: {}, previous: null,
    bio: Object.fromEntries(players.map((p, j) => [p.id, { age: j === 1 ? 19 : full && j === 3 ? 20 : 27 }])), rivals: [[T[0].id, T[1].id]] };
}
