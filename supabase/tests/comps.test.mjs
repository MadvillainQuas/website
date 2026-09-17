/* ============================================================================
   epinoia/comps.js — which clubs are in which competition, and when a reader
   should be offered the choice at all.

   The three cases here are the three leagues on the platform on 17 Sep 2026,
   with the counts taken from the live database rather than invented:

     BCB          Championship 14 clubs / 182 games, Trophy 20 clubs / 40 games,
                  and a THIRD competition — a duplicate "British Championship
                  Basketball" with 20 entries and no fixtures at all, left by an
                  earlier feed. Six Trophy sides play nowhere else.
     SLB Men      Championship 10 / 173, Cup 10 entries but only 8 clubs drawn
                  into its 4 games so far.
     SLB Women    Championship 10 / 86, Betty Codona Cup exactly the same 10.

   The rule under test: a competition earns its own clubs list only when it
   brings clubs the main competition does not have. BCB splits. Neither SLB
   does — and the men's Cup is the case that catches a naive implementation,
   because its fixture list is incomplete, not its field.
   ============================================================================ */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = require(path.join(HERE, '..', '..', 'epinoia', 'comps.js'));

let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  — saw ' + JSON.stringify(saw))); }
};
const eq = (what, a, b) => ok(what, JSON.stringify(a) === JSON.stringify(b), a);

/* A field of n clubs named t1..tn, offset so two competitions can overlap. */
const field = (n, from = 1) => Array.from({ length: n }, (_, i) => 't' + (from + i));
const enter = (comp, teams) => teams.map(t => ({ competition_id: comp, team_id: t }));
const play = (comp, teams, n) => Array.from({ length: n }, (_, i) => ({
  competition_id: comp,
  home_team_id: teams[i % teams.length],
  away_team_id: teams[(i + 1) % teams.length]
}));

/* ---------------------------------------------------------------- BCB ----- */
console.log('\n-- BCB: a Trophy drawn wider than the Championship');
{
  const champ = field(14);                 // t1..t14
  const trophy = field(20);                // t1..t20 — six play only here
  const comps = [
    { id: 'c-champ',  name: 'BCB 2026-2027',  kind: 'league' },
    { id: 'c-trophy', name: 'BCB Trophy 2027', kind: 'trophy' },
    { id: 'c-ghost',  name: 'British Championship Basketball', kind: 'league' }
  ];
  const r = C.read({
    comps,
    entries: [...enter('c-champ', champ), ...enter('c-trophy', trophy),
              ...enter('c-ghost', trophy)],
    games: [...play('c-champ', champ, 182), ...play('c-trophy', trophy, 40)]
  });

  ok('the clubs list splits', r.split === true);
  eq('...into the Championship first, then the Trophy',
     r.groups.map(g => g.name), ['BCB 2026-2027', 'BCB Trophy 2027']);
  eq('...the Championship being the main competition', r.main.name, 'BCB 2026-2027');
  eq('...with 14 clubs and 20', r.groups.map(g => g.teams.length), [14, 20]);
  eq('...and the Trophy counted as bringing six of its own', r.groups[1].extra, 6);
  ok('the duplicate competition with no fixtures is not offered',
     !r.groups.some(g => g.name === 'British Championship Basketball') &&
     !r.all.some(c => c.id === 'c-ghost'));
  ok('every club is reachable across the two lists', r.everyTeam().size === 20);
}

/* ------------------------------------------------------------ SLB Men ----- */
console.log('\n-- SLB Men: a cup whose draw is only half made');
{
  const champ = field(10);
  const cupDrawn = champ.slice(0, 8);      // 4 ties played, 8 clubs seen
  const r = C.read({
    comps: [{ id: 'c-champ', name: 'Championship 26-27', kind: 'league' },
            { id: 'c-cup',   name: 'Cup 26-27',          kind: 'cup' }],
    entries: [...enter('c-champ', champ), ...enter('c-cup', champ)],
    games: [...play('c-champ', champ, 173), ...play('c-cup', cupDrawn, 4)]
  });

  ok('the same ten clubs, so no buttons', r.split === false);
  eq('...one list, the Championship\'s', r.groups.map(g => g.name), ['Championship 26-27']);
  eq('...holding all ten', r.groups[0].teams.length, 10);
  ok('the cup is still a competition the page can filter fixtures by',
     r.all.length === 2 && r.teamsOf('c-cup').size === 10);
}

/* ---------------------------------------------------------- SLB Women ----- */
console.log('\n-- SLB Women: a cup with exactly the league\'s field');
{
  const champ = field(10);
  const r = C.read({
    comps: [{ id: 'c-champ', name: 'Championship 2026-27', kind: 'league' },
            { id: 'c-cup',   name: 'Betty Codona Cup 2026-27', kind: 'cup' }],
    entries: [...enter('c-champ', champ), ...enter('c-cup', champ)],
    games: [...play('c-champ', champ, 86), ...play('c-cup', champ, 20)]
  });
  ok('no buttons', r.split === false);
  eq('the main competition is the league, not the cup', r.main.name, 'Championship 2026-27');
}

/* -------------------------------------------------------------- edges ----- */
console.log('\n-- the edges');
{
  const r = C.read({ comps: [], entries: [], games: [] });
  ok('nothing at all: no main, no groups, no split',
     r.main === null && r.groups.length === 0 && r.split === false);
  ok('teamsOf an unknown competition is empty, not a crash', r.teamsOf('nope').size === 0);
}
{
  /* A club with a fixture but no entry row still belongs — the fixture is the
     thing the reader can see. */
  const r = C.read({
    comps: [{ id: 'c1', name: 'One', kind: 'league' }],
    entries: [{ competition_id: 'c1', team_id: 'a' }],
    games: [{ competition_id: 'c1', home_team_id: 'a', away_team_id: 'b' }]
  });
  eq('a fixture enters a club the entry table missed', [...r.teamsOf('c1')].sort(), ['a', 'b']);
}
{
  /* Entries for a competition nobody has fixtured do not make it a field. */
  const r = C.read({
    comps: [{ id: 'c1', name: 'Played', kind: 'league' },
            { id: 'c2', name: 'Entered only', kind: 'cup' }],
    entries: [...enter('c1', field(4)), ...enter('c2', field(9))],
    games: play('c1', field(4), 6)
  });
  ok('entries without fixtures never earn a button', r.split === false);
  eq('...and are not in the list of competitions to filter by', r.all.map(c => c.name), ['Played']);
}
{
  /* Two competitions, neither a `league` kind: the one with more games leads. */
  const a = field(6), b = field(6);
  const r = C.read({
    comps: [{ id: 'c1', name: 'Small cup', kind: 'cup' },
            { id: 'c2', name: 'Big trophy', kind: 'trophy' }],
    entries: [...enter('c1', a), ...enter('c2', b)],
    games: [...play('c1', a, 3), ...play('c2', b, 30)]
  });
  eq('with no league-kind competition, the busiest one leads', r.main.name, 'Big trophy');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
assert.equal(fail, 0);
