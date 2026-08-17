/* ============================================================================
   MOST VALUABLE PLAYER, BY BPM.

   The award is now decided by the same box plus/minus the leaderboards show,
   computed by the same shared JavaScript, and written back by the finalise
   function. The things worth asserting are the ones that would go wrong
   silently:

     * the APPEARANCE GATE — a player who turned up twice and had one enormous
       night must not be MVP, and the gate has to match the one the SQL awards
       use or the same page carries two different notions of "eligible"
     * the gate RELAXING when a season is too young for anyone to clear it,
       rather than returning nobody
     * a player id that is not a UUID (an imported historic game can carry the
       scorer's local id) being declined rather than breaking a finalise on a
       foreign key
     * the pick being the BPM leader, not the points leader

   Run: node --experimental-strip-types supabase/tests/awards.test.mjs
   ============================================================================ */
import { bpmMvp } from '../functions/_shared/awards.ts';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (c, what) => { if (c) pass++; else { fail++; console.error(`  FAIL ${what}`); } };

/* ------------------------------------------------------------ fake client ---
   Just enough of the Supabase builder for what awards.ts calls. Deliberately
   dumb: if the code under test starts calling something else, this throws
   rather than quietly returning nothing. */
function fakeClient(tables) {
  return {
    from(name) {
      if (!(name in tables)) throw new Error('unexpected table: ' + name);
      let rows = tables[name];
      const b = {
        select: () => b,
        eq: (col, v) => { rows = rows.filter(r => r[col] === v); return b; },
        in: (col, vs) => { rows = rows.filter(r => vs.includes(r[col])); return b; },
        then: (res) => Promise.resolve({ data: rows, error: null }).then(res)
      };
      return b;
    }
  };
}

const U = n => '0000000' + n + '-0000-4000-8000-000000000000';
const HOME = U(1), AWAY = U(2);

/* a player-game line in the engine's own spelling */
const line = (o) => ({
  min: (o.mins || 24) * 60000,
  pts: o.pts || 0, p2m: o.p2m || 0, p2a: o.p2a || 0, p3m: 0, p3a: 0,
  ftm: 0, fta: 0, or: o.or || 1, dr: o.dr || 3, ast: o.ast || 2,
  stl: o.stl || 1, blk: o.blk || 0, to: o.to || 2, pf: o.pf || 2, pm: o.pm || 0
});

/* Build N games between two clubs. `spec` gives each player their per-game
   line and how many of the N games they appeared in. */
function world(n, spec) {
  const games = [], pgs = [], tgs = [];
  for (let g = 0; g < n; g++) {
    const id = 'g' + g;
    games.push({ id, competition_id: 'C', status: 'final',
                 home_team_id: HOME, away_team_id: AWAY,
                 home_score: 80, away_score: 74, tipoff_at: '2026-01-0' + (g + 1) });
    [0, 1].forEach(side => {
      tgs.push({ game_id: id, team_idx: side, stats: {
        pts: side === 0 ? 80 : 74, teamRebO: 8, teamRebD: 24, toTot: 12, foulTot: 18,
        score: side === 0 ? 80 : 74, perQ: [20, 20, 20, side === 0 ? 20 : 14]
      } });
    });
    spec.forEach(p => {
      if (g >= (p.games == null ? n : p.games)) return;
      pgs.push({ game_id: id, player_id: p.id, team_idx: p.side || 0, stats: line(p) });
    });
  }
  return fakeClient({ games, player_game_stats: pgs, team_game_stats: tgs });
}

/* An ordinary five plus a spectacular part-timer. */
const REGULARS = [
  { id: U(3), pts: 18, p2m: 8, p2a: 15, ast: 5, pm: 6 },
  { id: U(4), pts: 12, p2m: 5, p2a: 12, ast: 3, pm: 2 },
  { id: U(5), pts: 9,  p2m: 4, p2a: 10, ast: 2, pm: -1 },
  { id: U(6), pts: 7,  p2m: 3, p2a: 8,  ast: 1, pm: 0 },
  { id: U(7), pts: 5,  p2m: 2, p2a: 6,  ast: 1, pm: -3 },
  { id: U(8), side: 1, pts: 14, p2m: 6, p2a: 14, ast: 4, pm: -4 },
  { id: U(9), side: 1, pts: 11, p2m: 5, p2a: 11, ast: 3, pm: -2 }
];

console.log('the appearance gate');
{
  /* ten games. The cameo plays two of them and is absurd in both. */
  const cameo = { id: U(0), pts: 44, p2m: 20, p2a: 22, ast: 9, stl: 5, pm: 30, games: 2 };
  const pick = await bpmMvp(world(10, [...REGULARS, cameo]), 'C');
  ok(pick, 'an MVP was picked at all');
  ok(pick.player_id !== U(0), 'the two-game cameo is NOT MVP, however good he was');
  ok(/minimum 5 games/.test(pick.detail), 'the gate is half the games played: ' + pick.detail);
  ok(/box plus\/minus/.test(pick.detail), 'and the basis is stated');
}

console.log('the gate relaxes rather than returning nobody');
{
  /* one game played by everybody: half of one is one, floored at three, which
     nobody can clear — so the gate has to come down to what exists */
  const pick = await bpmMvp(world(1, REGULARS), 'C');
  ok(pick, 'a one-game season still names somebody');
  ok(/minimum 1 games/.test(pick.detail), 'the gate fell to 1: ' + pick.detail);
}

console.log('it is BPM, not points');
{
  /* A volume scorer who shoots badly and turns it over, against an efficient
     one who scores less. Efficiency-per-game would reward the volume; BPM
     should not. */
  const chucker  = { id: U(0), pts: 26, p2m: 13, p2a: 34, ast: 1, to: 7, pm: -8, mins: 34 };
  const surgeon  = { id: U(3), pts: 17, p2m: 8,  p2a: 12, ast: 7, to: 1, pm: 11, mins: 30 };
  const rest = REGULARS.filter(p => p.id !== U(3));
  const pick = await bpmMvp(world(8, [...rest, chucker, surgeon]), 'C');
  eq(pick.player_id, U(3), 'the efficient player wins, not the one with the most points');
  ok(typeof pick.value === 'number', 'the value is a number');
  eq(pick.value, Math.round(pick.value * 10) / 10, 'rounded to one decimal, like every BPM shown');
  eq(pick.team_id, HOME, 'the club comes from the games actually played');
  eq(pick.games, 8, 'and the appearance count is real');
}

console.log('nothing to decide');
{
  eq(await bpmMvp(fakeClient({ games: [], player_game_stats: [], team_game_stats: [] }), 'C'),
     null, 'no games returns null, so the efficiency award is left standing');
  const noStats = fakeClient({
    games: [{ id: 'g0', competition_id: 'C', status: 'final',
              home_team_id: HOME, away_team_id: AWAY, tipoff_at: '2026-01-01' }],
    player_game_stats: [], team_game_stats: []
  });
  eq(await bpmMvp(noStats, 'C'), null, 'games with no box scores returns null too');
}

console.log('an imported game with a local player id');
{
  /* The scorer's own ids are not UUIDs. season_awards.player_id is a foreign
     key, so writing one would fail the whole finalise — decline instead. */
  const local = { id: 'p7', pts: 30, p2m: 14, p2a: 20, ast: 8, pm: 20 };
  const pick = await bpmMvp(world(6, [...REGULARS.slice(1), local]), 'C');
  ok(pick == null || pick.player_id !== 'p7',
     'a non-UUID player id is never written as an award');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
