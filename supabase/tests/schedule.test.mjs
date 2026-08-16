/* ============================================================================
   Round-robin scheduling.

   A fixture list is the one artefact a league secretary checks by hand, so the
   properties that matter are the ones they would check: everybody plays
   everybody exactly once, nobody plays twice on the same day, nobody plays
   themselves, and the home/away split is roughly even.

   Odd team counts are the interesting case, because somebody has to sit out
   every round and it must not always be the same somebody.
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../league/admin/schedule.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got  ' + g + '\n        want ' + w); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

const ids = n => Array.from({ length: n }, (_, i) => 't' + (i + 1));
const flat = rounds => rounds.flat();

console.log('\nthe shape of a round-robin');

for (const n of [2, 4, 6, 8, 10, 12]) {
  const r = S.roundRobin(ids(n));
  const f = flat(r);
  ok(n + ' teams: ' + (n - 1) + ' rounds', r.length === n - 1, r.length + ' rounds');
  ok('  ' + n / 2 + ' games a round', r.every(x => x.length === n / 2),
     r.map(x => x.length).join(','));
  ok('  ' + (n * (n - 1) / 2) + ' games in total', f.length === n * (n - 1) / 2, String(f.length));
  const pairs = S.pairCounts(f);
  ok('  every pair meets exactly once',
     pairs.size === n * (n - 1) / 2 && [...pairs.values()].every(v => v === 1));
  ok('  nobody plays themselves', f.every(g => g.home !== g.away));
  ok('  nobody plays twice in a round',
     r.every(round => {
       const seen = new Set();
       return round.every(g => {
         if (seen.has(g.home) || seen.has(g.away)) return false;
         seen.add(g.home); seen.add(g.away); return true;
       });
     }));
}

console.log('\nodd team counts — somebody sits out');

for (const n of [3, 5, 7, 9, 11]) {
  const r = S.roundRobin(ids(n));
  const f = flat(r);
  ok(n + ' teams: ' + n + ' rounds', r.length === n, r.length + ' rounds');
  ok('  ' + ((n - 1) / 2) + ' games a round', r.every(x => x.length === (n - 1) / 2));
  ok('  ' + (n * (n - 1) / 2) + ' games in total', f.length === n * (n - 1) / 2, String(f.length));
  const pairs = S.pairCounts(f);
  ok('  every pair meets exactly once',
     pairs.size === n * (n - 1) / 2 && [...pairs.values()].every(v => v === 1));

  /* the important fairness property: the bye goes round, it does not land on
     one team repeatedly */
  const played = new Map(ids(n).map(id => [id, 0]));
  r.forEach(round => round.forEach(g => {
    played.set(g.home, played.get(g.home) + 1);
    played.set(g.away, played.get(g.away) + 1);
  }));
  ok('  everyone plays the same number of games',
     [...played.values()].every(v => v === n - 1), [...played.values()].join(','));
}

console.log('\nhome and away');

/* An even team count plays an ODD number of games, so a perfectly even split
   is arithmetically impossible — one game out is the optimum, and that is what
   is required here. Odd counts play an even number of games, where zero is
   possible; the greedy orientation gets within two, which is stated rather
   than claimed away. */
for (const n of [4, 6, 8, 10, 12, 16, 20]) {
  const b = S.balance(flat(S.roundRobin(ids(n))));
  const worst = Math.max(...b.map(r => Math.abs(r.diff)));
  ok(n + ' teams: every team is within one game of even', worst <= 1,
     'worst diff ' + worst);
}
for (const n of [5, 7, 9, 11, 15]) {
  const b = S.balance(flat(S.roundRobin(ids(n))));
  const worst = Math.max(...b.map(r => Math.abs(r.diff)));
  ok(n + ' teams: within two', worst <= 2, 'worst diff ' + worst);
}
{
  /* the specific failure the fixed-tie-break caused: the circle method's
     fixed team collecting home games whenever the diffs were level */
  const b = S.balance(flat(S.roundRobin(ids(10))));
  const first = b.find(r => r.team_id === 't1');
  ok('the fixed team is not favoured', Math.abs(first.diff) <= 1,
     't1 diff ' + first.diff);
}

{
  const b = S.balance(flat(S.doubleRound(ids(6))));
  ok('a double round-robin is exactly even for everybody',
     b.every(r => r.diff === 0), b.map(r => r.diff).join(','));
  const pairs = S.pairCounts(flat(S.doubleRound(ids(6))));
  ok('and every pair meets exactly twice', [...pairs.values()].every(v => v === 2));
}

{
  const f = flat(S.doubleRound(ids(4)));
  /* home and away, not the same fixture twice */
  const oriented = new Set(f.map(g => g.home + '>' + g.away));
  ok('each pair meets once at each end', oriented.size === f.length, oriented.size + '/' + f.length);
}

console.log('\ngroups are scheduled separately');
{
  const entries = [
    { team_id: 'a1', group_name: 'A' }, { team_id: 'a2', group_name: 'A' },
    { team_id: 'a3', group_name: 'A' }, { team_id: 'a4', group_name: 'A' },
    { team_id: 'b1', group_name: 'B' }, { team_id: 'b2', group_name: 'B' },
    { team_id: 'b3', group_name: 'B' }, { team_id: 'b4', group_name: 'B' }
  ];
  const rounds = S.forCompetition(entries);
  const f = flat(rounds);
  eq('two groups of four give 12 games', f.length, 12);
  ok('nobody plays across groups',
     f.every(g => g.home[0] === g.away[0]),
     f.filter(g => g.home[0] !== g.away[0]).map(g => g.home + 'v' + g.away).join(','));
  eq('and the groups run in parallel, not one after the other', rounds.length, 3);
  ok('each round has both groups playing',
     rounds.every(r => r.some(g => g.group === 'A') && r.some(g => g.group === 'B')));
  ok('every fixture is tagged with its group',
     f.every(g => g.group === 'A' || g.group === 'B'));
}

{
  const entries = ids(4).map(id => ({ team_id: id, group_name: null }));
  const f = flat(S.forCompetition(entries));
  eq('an ungrouped competition is one round-robin', f.length, 6);
  ok('and carries no group', f.every(g => g.group === null));
}

{
  /* uneven groups, which is normal when a club drops out */
  const entries = [
    { team_id: 'a1', group_name: 'A' }, { team_id: 'a2', group_name: 'A' },
    { team_id: 'a3', group_name: 'A' },
    { team_id: 'b1', group_name: 'B' }, { team_id: 'b2', group_name: 'B' },
    { team_id: 'b3', group_name: 'B' }, { team_id: 'b4', group_name: 'B' }
  ];
  const rounds = S.forCompetition(entries);
  const f = flat(rounds);
  eq('3 + 4 teams give 3 + 6 games', f.length, 9);
  ok('the longer group decides how many rounds there are', rounds.length === 3,
     rounds.length + ' rounds');
}

console.log('\ndates');
{
  const rounds = S.forCompetition(ids(4).map(id => ({ team_id: id })));
  const f = S.withDates(rounds, { start: '2026-09-01', everyDays: 7, times: ['19:30', '21:30'] });
  eq('every game gets a date', f.length, 6);
  eq('rounds are numbered from one', [...new Set(f.map(x => x.round))], [1, 2, 3]);

  const byRound = {};
  f.forEach(x => { (byRound[x.round] = byRound[x.round] || []).push(x.tipoff_at); });
  ok('games in a round share a day',
     Object.values(byRound).every(list =>
       new Set(list.map(t => t.slice(0, 10))).size === 1),
     JSON.stringify(byRound[1]));
  ok('and are given different kick-off times',
     new Set(byRound[1]).size === byRound[1].length);

  const days = [...new Set(f.map(x => x.tipoff_at.slice(0, 10)))].sort();
  ok('rounds are a week apart', days.length === 3, days.join(' '));
  const gap = (new Date(days[1]) - new Date(days[0])) / 86400000;
  eq('exactly seven days', gap, 7);
}

{
  const rounds = S.forCompetition(ids(4).map(id => ({ team_id: id })));
  const f = S.withDates(rounds, { start: '2026-09-01', everyDays: 3, times: ['18:00'] });
  const days = [...new Set(f.map(x => x.tipoff_at.slice(0, 10)))].sort();
  eq('a three-day gap is honoured',
     (new Date(days[1]) - new Date(days[0])) / 86400000, 3);
}

console.log('\ndegenerate input');
eq('one team plays nobody', S.roundRobin(['a']), []);
eq('no teams give no rounds', S.roundRobin([]), []);
eq('undefined is not a crash', S.roundRobin(undefined), []);
eq('an empty competition is empty', S.forCompetition([]), []);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
