/* ============================================================================
   LiveStats import — a FIBA play-by-play turned into Epinoia events.

   The value of the importer is that an imported game is indistinguishable
   downstream from a scored one, so the test that matters is not "did it emit
   events" but "does the ENGINE derive the right box score from them". Most of
   what follows builds a small game by hand, converts it, replays it through
   league/engine.js, and checks the numbers a scoresheet would show.
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../league/livestats.js');
const E = require('../../league/engine.js');

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

/* ------------------------------------------------------------- a fixture --- */
const ROSTER = { teams: [
  { name: 'home', color: '#93f2bf', players: [
    { id: 'h4', name: 'Alan Ash',      num: '4' },
    { id: 'h5', name: 'Ben Brook',     num: '5' },
    { id: 'h6', name: 'Cal Crane',     num: '6' },
    { id: 'h7', name: 'Dan Dove',      num: '7' },
    { id: 'h8', name: 'Eli East',      num: '8' },
    { id: 'h9', name: 'Fin Frost',     num: '9' }
  ]},
  { name: 'away', color: '#8ff5ff', players: [
    { id: 'a4', name: 'Gus Gale',      num: '4' },
    { id: 'a5', name: 'Hal Hume',      num: '5' },
    { id: 'a6', name: 'Ike Iver',      num: '6' },
    { id: 'a7', name: 'Jon Jode',      num: '7' },
    { id: 'a8', name: 'Kit Kerr',      num: '8' },
    { id: 'a9', name: 'Lev Lund',      num: '9' }
  ]}
]};

const STARTERS = [['h4','h5','h6','h7','h8'], ['a4','a5','a6','a7','a8']];

const ev = (o) => Object.assign({ period: 1, periodType: 'REGULAR', gt: '09:00' }, o);

console.log('\nclock and periods');

eq('MM:SS remaining', L.clockMs('07:23'), 443000);
eq('tenths are kept', L.clockMs('00:04.5'), 4500);
eq('bare seconds', L.clockMs('9'), 9000);
eq('blank is null', L.clockMs(''), null);
eq('regular period passes through', L.periodOf({ period: 3, periodType: 'REGULAR' }, 1), 3);
eq('overtime 1 becomes period 5', L.periodOf({ period: 1, periodType: 'OVERTIME' }, 1), 5);
eq('overtime 2 becomes period 6', L.periodOf({ period: 2, periodType: 'OVERTIME' }, 1), 6);
eq('tno 1 is the home side', L.teamIdx(1), 0);
eq('tno 2 is the away side', L.teamIdx(2), 1);
eq('no tno is no side', L.teamIdx(null), null);

console.log('\nfinding the play-by-play in whatever shape it arrives');

eq('a bare array', L.pickEvents([{ actionType: 'game' }]).length, 1);
eq('under .pbp', L.pickEvents({ pbp: [{ actionType: 'game' }] }).length, 1);
eq('under .pbp.pbp', L.pickEvents({ pbp: { pbp: [{ actionType: 'game' }, { actionType: '2pt' }] } }).length, 2);
eq('under .actions', L.pickEvents({ actions: [{ actionType: 'game' }] }).length, 1);
eq('nothing at all', L.pickEvents({ tm: {} }).length, 0);

console.log('\nresolving players');
{
  const sides = L.index(ROSTER);
  eq('by shirt number', L.resolve(sides[0], { shirtNumber: '7' }).id, 'h7');
  eq('a padded shirt is the same shirt', L.resolve(sides[0], { shirtNumber: '07' }).id, 'h7');
  eq('by full name', L.resolve(sides[1], { player: 'Hal Hume' }).id, 'a5');
  eq('by surname alone', L.resolve(sides[1], { familyName: 'Iver' }).id, 'a6');
  eq('by first + family fields', L.resolve(sides[0], { firstName: 'Cal', familyName: 'Crane' }).id, 'h6');
  eq('an unknown shirt resolves to nobody', L.resolve(sides[0], { shirtNumber: '77' }), null);
  ok('a shirt belongs to its own side only',
     L.resolve(sides[0], { shirtNumber: '4' }).id === 'h4' &&
     L.resolve(sides[1], { shirtNumber: '4' }).id === 'a4');
}

console.log('\nsubstitution pairing');
{
  const r = L.pairSubs([
    { isIn: true, pid: 'h9' }, { isIn: false, pid: 'h4' }
  ]);
  eq('one in, one out pairs', r.pairs.length, 1);
  eq('the right way round', [r.pairs[0].in.pid, r.pairs[0].out.pid], ['h9', 'h4']);

  const t = L.pairSubs([
    { isIn: false, pid: 'h4' }, { isIn: false, pid: 'h5' },
    { isIn: true, pid: 'h9' },  { isIn: true, pid: 'h6' }
  ]);
  eq('a double change pairs into two', t.pairs.length, 2);
  ok('and leaves nothing orphaned', !t.orphanIn.length && !t.orphanOut.length);

  const u = L.pairSubs([{ isIn: true, pid: 'h9' }]);
  eq('a lone half is orphaned, not guessed', u.orphanIn.length, 1);
}

console.log('\nconversion');
{
  const data = { pbp: [
    ev({ actionType: 'period', subType: 'start', gt: '10:00' }),
    ev({ actionType: '2pt', subType: 'layup', tno: 1, shirtNumber: '4', success: 1, gt: '09:41' }),
    ev({ actionType: 'assist', tno: 1, shirtNumber: '5', gt: '09:41' }),
    ev({ actionType: '3pt', subType: 'jumpshot', tno: 2, shirtNumber: '6', success: 0, gt: '09:20' }),
    ev({ actionType: 'rebound', subType: 'defensive', tno: 1, shirtNumber: '8', gt: '09:18' }),
    ev({ actionType: 'turnover', subType: 'badpass', tno: 1, shirtNumber: '5', gt: '09:02' }),
    ev({ actionType: 'steal', tno: 2, shirtNumber: '4', gt: '09:02' }),
    ev({ actionType: 'foul', subType: 'personal', tno: 2, shirtNumber: '7', gt: '08:50' }),
    ev({ actionType: 'foul', subType: 'foulon', tno: 1, shirtNumber: '4', gt: '08:50' }),
    ev({ actionType: 'freethrow', subType: '1of2', tno: 1, shirtNumber: '4', success: 1, gt: '08:50' }),
    ev({ actionType: 'freethrow', subType: '2of2', tno: 1, shirtNumber: '4', success: 0, gt: '08:50' }),
    ev({ actionType: 'rebound', subType: 'offensive', tno: 1, shirtNumber: '6', gt: '08:48' }),
    ev({ actionType: '2pt', subType: 'jumpshot', tno: 1, shirtNumber: '6', success: 0, gt: '08:40' }),
    ev({ actionType: 'block', tno: 2, shirtNumber: '8', gt: '08:40' }),
    ev({ actionType: 'rebound', subType: 'defensive', tno: 2, shirtNumber: '5', gt: '08:39' }),
    ev({ actionType: 'substitution', subType: 'out', tno: 1, shirtNumber: '4', gt: '08:00' }),
    ev({ actionType: 'substitution', subType: 'in',  tno: 1, shirtNumber: '9', gt: '08:00' }),
    ev({ actionType: 'game', gt: '00:00', period: 4 })
  ]};

  const r = L.convert({ data, roster: ROSTER });
  eq('nothing was skipped', r.counts.skipped, 0);
  eq('no warnings', r.warnings, []);
  eq('three field-goal attempts', r.counts.shots, 3);
  eq('two free throws', r.counts.ft, 2);
  eq('three rebounds', r.counts.reb, 3);
  eq('one substitution', r.counts.sub, 1);
  eq('one foul, not two', r.counts.foul, 1);

  const types = r.events.map(e => e.t);
  ok('a period start opens it', types[0] === 'period_start');
  ok('a game end closes it', types[types.length - 1] === 'game_end');
  ok('the layup is tagged as paint',
     r.events.some(e => e.t === 'tag' && e.tag === 'paint'));
  ok('the shot type is carried',
     r.events.some(e => e.t === 'stype' && e.v === 'layup'));

  const sub = r.events.find(e => e.t === 'sub');
  eq('the sub carries both halves', [sub.in, sub.out], ['h9', 'h4']);
  eq('and belongs to the right side', sub.team, 0);

  /* ---- and now the point of all of it: does the engine agree? ---- */
  const d = E.deriveGame({ teams: ROSTER.teams, starters: STARTERS,
                           events: r.events, period: 4, clockMs: 0 });
  const h4 = d.stats['h4'], h6 = d.stats['h6'], a6 = d.stats['a6'];

  eq('#4 scored three (a made two plus one free throw)', h4.pts, 3);
  eq('#4 attempted one two', h4.p2a, 1);
  eq('#4 made it', h4.p2m, 1);
  eq('#4 shot two free throws', h4.fta, 2);
  eq('#4 made one', h4.ftm, 1);
  eq('#4 is credited a rim attempt from the layup tag', h4.rimA, 1);
  eq('#5 has the assist', d.stats['h5'].ast, 1);
  eq('#5 has the turnover', d.stats['h5'].to, 1);
  eq('away #4 has the steal', d.stats['a4'].stl, 1);
  eq('away #8 has the block', d.stats['a8'].blk, 1);
  eq('away #7 has the foul', d.stats['a7'].pf, 1);
  eq('the drawn foul is not a foul on #4', h4.pf, 0);
  eq('#6 has an offensive rebound', h6.or, 1);
  eq('#8 has a defensive rebound', d.stats['h8'].dr, 1);
  eq('away #6 missed a three', a6.p3a, 1);
  eq('and made none', a6.p3m, 0);
}

console.log('\nwhat it refuses to guess');
{
  const data = { pbp: [
    ev({ actionType: '2pt', tno: 1, shirtNumber: '77', success: 1 })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  eq('an unknown shirt is skipped', r.counts.skipped, 1);
  eq('and reported, not swallowed', r.unmatched.length, 1);
  ok('by name and count', r.unmatched[0].who === 'home #77' && r.unmatched[0].n === 1,
     JSON.stringify(r.unmatched[0]));
  ok('with a warning a person can read', /could not be matched/.test(r.warnings[0]),
     r.warnings[0]);
}

{
  const data = { pbp: [
    ev({ actionType: 'substitution', subType: 'in', tno: 1, shirtNumber: '9', gt: '05:00' }),
    ev({ actionType: '2pt', tno: 1, shirtNumber: '4', success: 1, gt: '04:00' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  eq('a half substitution produces no sub event', r.counts.sub, 0);
  ok('and says so', /unpaired substitution/.test(r.warnings.join(' ')),
     r.warnings.join(' | '));
}

{
  /* a triple change at one dead ball */
  const at = (o) => ev(Object.assign({ actionType: 'substitution', tno: 1, gt: '06:30' }, o));
  const data = { pbp: [
    at({ subType: 'out', shirtNumber: '4' }), at({ subType: 'out', shirtNumber: '5' }),
    at({ subType: 'in',  shirtNumber: '9' }), at({ subType: 'in',  shirtNumber: '6' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  eq('two substitutions come out of four halves', r.counts.sub, 2);
  eq('with nothing left over', r.warnings.length, 0);
}

{
  /* two changes at DIFFERENT times must not pair across the gap */
  const data = { pbp: [
    ev({ actionType: 'substitution', subType: 'out', tno: 1, shirtNumber: '4', gt: '06:30' }),
    ev({ actionType: 'substitution', subType: 'in',  tno: 1, shirtNumber: '9', gt: '06:30' }),
    ev({ actionType: 'substitution', subType: 'out', tno: 1, shirtNumber: '5', gt: '03:10' }),
    ev({ actionType: 'substitution', subType: 'in',  tno: 1, shirtNumber: '6', gt: '03:10' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  const subs = r.events.filter(e => e.t === 'sub');
  eq('two separate changes stay separate', subs.length, 2);
  eq('the first is 9 for 4', [subs[0].in, subs[0].out], ['h9', 'h4']);
  eq('the second is 6 for 5', [subs[1].in, subs[1].out], ['h6', 'h5']);
}

{
  /* a change by each team at the same clock must not cross sides */
  const data = { pbp: [
    ev({ actionType: 'substitution', subType: 'out', tno: 1, shirtNumber: '4', gt: '06:30' }),
    ev({ actionType: 'substitution', subType: 'in',  tno: 1, shirtNumber: '9', gt: '06:30' }),
    ev({ actionType: 'substitution', subType: 'out', tno: 2, shirtNumber: '4', gt: '06:30' }),
    ev({ actionType: 'substitution', subType: 'in',  tno: 2, shirtNumber: '9', gt: '06:30' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  const subs = r.events.filter(e => e.t === 'sub');
  eq('each side gets its own substitution', subs.length, 2);
  eq('home swaps home players', [subs[0].team, subs[0].in, subs[0].out], [0, 'h9', 'h4']);
  eq('away swaps away players', [subs[1].team, subs[1].in, subs[1].out], [1, 'a9', 'a4']);
}

{
  const data = { pbp: [
    ev({ actionType: 'rebound', subType: 'deadball', tno: 1, gt: '05:00' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  eq('a dead-ball rebound is not a rebound', r.counts.reb, 0);
}

{
  /* team rebound: no player, and that is legitimate rather than unmatched */
  const data = { pbp: [
    ev({ actionType: 'rebound', subType: 'defensive', tno: 1, pno: 0, gt: '05:00' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  eq('a team rebound is kept', r.counts.reb, 1);
  eq('with no player attached', r.events.find(e => e.t === 'reb').pid, null);
  eq('and is not reported as unmatched', r.unmatched.length, 0);
}

console.log('\novertime');
{
  const data = { pbp: [
    ev({ actionType: 'period', subType: 'start', period: 1, periodType: 'OVERTIME', gt: '05:00' }),
    ev({ actionType: '2pt', tno: 1, shirtNumber: '4', success: 1,
         period: 1, periodType: 'OVERTIME', gt: '04:30' })
  ]};
  const r = L.convert({ data, roster: ROSTER });
  eq('the overtime period is 5, not 1', r.events[0].period, 5);
  eq('and its events sit in period 5', r.events[1].period, 5);
}

console.log('\nstarters');
{
  /* the payload says so */
  const data = { tm: {
    1: { pl: { 1: { shirtNumber: '4', starter: 1 }, 2: { shirtNumber: '5', starter: 1 },
               3: { shirtNumber: '6', starter: 1 }, 4: { shirtNumber: '7', starter: 1 },
               5: { shirtNumber: '8', starter: 1 }, 6: { shirtNumber: '9', starter: 0 } } },
    2: { pl: { 1: { shirtNumber: '4', starter: 1 }, 2: { shirtNumber: '5', starter: 1 },
               3: { shirtNumber: '6', starter: 1 }, 4: { shirtNumber: '7', starter: 1 },
               5: { shirtNumber: '8', starter: 1 } } }
  }};
  const s = L.starters(data, ROSTER, []);
  eq('the flag is believed for the home side', s.starters[0], ['h4','h5','h6','h7','h8']);
  eq('and the away side', s.starters[1], ['a4','a5','a6','a7','a8']);
  eq('with nothing to report', s.notes, []);
}

{
  /* no flag: infer from who appears before being subbed on */
  const evs = [
    { t: 'p2_made', team: 0, pid: 'h5' }, { t: 'reb', team: 0, pid: 'h6' },
    { t: 'ast', team: 0, pid: 'h7' },     { t: 'stl', team: 0, pid: 'h8' },
    { t: 'to', team: 0, pid: 'h4' },
    { t: 'sub', team: 0, in: 'h9', out: 'h4' },
    { t: 'p3_made', team: 0, pid: 'h9' }
  ];
  const s = L.starters({}, ROSTER, evs);
  eq('the five who appeared before coming on are the starters',
     s.starters[0].slice().sort(), ['h4','h5','h6','h7','h8']);
  ok('the substitute is not among them', s.starters[0].indexOf('h9') === -1);
}

{
  /* a starter who does nothing and leaves early cannot be discovered */
  const evs = [
    { t: 'p2_made', team: 0, pid: 'h4' }, { t: 'reb', team: 0, pid: 'h5' },
    { t: 'sub', team: 0, in: 'h9', out: 'h6' }
  ];
  const s = L.starters({}, ROSTER, evs);
  eq('five are still produced', s.starters[0].length, 5);
  ok('and the shortfall is admitted rather than hidden',
     /only 2 of 5 starters/.test(s.notes.join(' ')), s.notes.join(' | '));
}

console.log('\nreading the header');
{
  const d = L.describe({ tm: { 1: { name: 'Home Town', score: 88 },
                               2: { name: 'Away City', score: 81 } },
                         pbp: [{ actionType: 'game' }] });
  eq('team names', [d.home, d.away], ['Home Town', 'Away City']);
  eq('final score', [d.scoreHome, d.scoreAway], [88, 81]);
  eq('event count', d.events, 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
