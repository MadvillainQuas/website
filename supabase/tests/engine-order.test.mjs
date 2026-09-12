/* ============================================================================
   A PLAY ADDED BACK INTO THE FIRST QUARTER MUST NOT REPLAY AFTER THE BUZZER.

   The replay inside deriveGame is written against game time. close(t, cum)
   measures a stint as cum minus where it started; lastIn holds the moment a
   player came on; the possession arrow and the second-chance, points-off-
   turnover and transition windows all compare one event's clock against the one
   before it.

   The scorer's own array satisfies that, because "add a missed play" splices at
   insertPos(cumEl(period, clock)). The log does not travel that way. It travels
   by sequence number, and a retroactively added play takes the HIGHEST id there
   is: game_events is keyed by seq, snapshot() and delta() order by seq, the
   public page sorts by id, the broadcast layer sorts by seq, finalise-game reads
   in seq order. So the play the statistician put back at 7:41 of the first
   quarter replayed, everywhere except the device it was typed on, after the
   final whistle.

   The per-player minutes survive that, because cum is read off the event's own
   period and clock rather than its position. Everything measured BETWEEN events
   does not: close(t, cum) is reached only by a substitution, so a sub replaying
   after the buzzer closes whatever stint was open with a cum from the wrong end
   of the game. On the log below that clamps one stint of 3:20 to zero and hands
   its minutes to the five that came after it, reports both men in the missed
   substitution at a plus-minus of 0 rather than +3 and -3, moves an opponent
   three from the five that were on the floor for it to the five that were not,
   and prints the play-by-play in entry order. The box score the statistician is
   looking at and the one the league publishes stop agreeing, with nothing on
   either to say which is right.

   These build ONE game and derive it twice: once in the order the scorer holds
   it, once in the order the database returns it. The two must agree in every
   number.

     node supabase/tests/engine-order.test.mjs
   ============================================================================ */
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../functions/_shared/engine.js', import.meta.url), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

const team = (name, t) => ({
  name, color: '#93f2bf',
  players: Array.from({ length: 8 }, (_, i) => ({ id: `p${t}_${i}`, name: `${name} ${i}`, num: String(i + 4) }))
});
const base = () => ({
  teams: [team('home', 0), team('away', 1)],
  starters: [[0, 1, 2, 3, 4].map(i => `p0_${i}`), [0, 1, 2, 3, 4].map(i => `p1_${i}`)],
  period: 4, clockMs: 0, tipWinner: 0, arrowInit: 1, events: []
});

/* A whole game, with the two corrections a statistician actually makes: a
   substitution they missed at the time, and a free throw they missed. Both are
   entered in the fourth quarter, so both take the highest ids in the log.

   The substitution is the one that does the damage. close(t, cum) is only
   reached by a sub, so a sub landing after the final buzzer closes the stint
   that was open with the wrong cum entirely, and sets the incoming player's
   lastIn to the end of the game. */
function build() {
  const g = base();
  let seq = 0;
  const at = (period, clock, o) => { g.events.push(Object.assign({ id: ++seq, seq, period, clock }, o)); return seq; };

  at(1, 600000, { t: 'period_start' });
  at(1, 585000, { t: 'p3_made', team: 0, pid: 'p0_0' });
  at(1, 584000, { t: 'ast', team: 0, pid: 'p0_1' });
  at(1, 540000, { t: 'p2_miss', team: 1, pid: 'p1_2' });
  at(1, 539000, { t: 'reb', team: 0, pid: 'p0_3', off: false });
  at(1, 480000, { t: 'sub', team: 0, out: 'p0_4', in: 'p0_5' });
  at(1, 420000, { t: 'p2_made', team: 1, pid: 'p1_1' });
  at(1, 300000, { t: 'foul', team: 0, pid: 'p0_2', kind: 'personal' });
  at(1, 120000, { t: 'to', team: 1, pid: 'p1_3' });
  at(1, 119000, { t: 'stl', team: 0, pid: 'p0_1' });
  at(1, 0, { t: 'period_end' });
  at(2, 600000, { t: 'period_start' });
  at(2, 550000, { t: 'p2_made', team: 0, pid: 'p0_5' });
  at(2, 300000, { t: 'sub', team: 0, out: 'p0_5', in: 'p0_4' });
  at(2, 0, { t: 'period_end' });
  at(3, 600000, { t: 'period_start' });
  at(3, 0, { t: 'period_end' });
  at(4, 600000, { t: 'period_start' });
  at(4, 400000, { t: 'p3_made', team: 1, pid: 'p1_0' });
  at(4, 0, { t: 'period_end' });

  /* Entered during the fourth, belonging to the second and the first. */
  const late = [
    { period: 2, clock: 500000, t: 'sub', team: 0, out: 'p0_0', in: 'p0_6' },
    { period: 1, clock: 461000, t: 'ft_miss', team: 0, pid: 'p0_0' }
  ].map(o => Object.assign({ id: ++seq, seq }, o));

  const asStored = g.events.concat(late);            // the database's order: by seq
  const cum = e => {
    const per = e.period || 1;
    return (per - 1) * 600000 + (600000 - (e.clock != null ? e.clock : 600000));
  };
  const asScored = g.events.slice();                 // the scorer's order: by game time
  late.forEach(ev => {
    let i = asScored.findIndex(e => cum(e) > cum(ev));
    asScored.splice(i < 0 ? asScored.length : i, 0, ev);
  });

  return { g, asScored, asStored };
}

const { g, asScored, asStored } = build();
const scored = E.deriveGame(Object.assign({}, g, { events: asScored }));
const stored = E.deriveGame(Object.assign({}, g, { events: asStored }));

console.log('\nthe same game, in the two orders it actually arrives in');

ok('the corrections really are last in the stored order',
   asStored[asStored.length - 1].t === 'ft_miss' &&
   asStored[asStored.length - 2].t === 'sub');
ok('...and are back in their places in the scored order',
   asScored[asScored.length - 1].t === 'period_end');

ok('the score is the same either way',
   JSON.stringify(scored.score) === JSON.stringify(stored.score),
   JSON.stringify(scored.score) + ' vs ' + JSON.stringify(stored.score));

ok('every player line is the same either way',
   JSON.stringify(scored.stats) === JSON.stringify(stored.stats),
   Object.keys(scored.stats).filter(k =>
     JSON.stringify(scored.stats[k]) !== JSON.stringify(stored.stats[k])).join(', '));

ok('...including plus-minus, which the clamp destroyed',
   Object.keys(scored.stats).every(k => scored.stats[k].pm === stored.stats[k].pm),
   Object.keys(scored.stats).filter(k => scored.stats[k].pm !== stored.stats[k].pm)
     .map(k => k + ' ' + scored.stats[k].pm + ' vs ' + stored.stats[k].pm).join(', '));
ok('...and the on-court totals every on/off number is built from',
   Object.keys(scored.stats).every(k =>
     JSON.stringify(scored.stats[k].oc) === JSON.stringify(stored.stats[k].oc)),
   Object.keys(scored.stats).filter(k =>
     JSON.stringify(scored.stats[k].oc) !== JSON.stringify(stored.stats[k].oc)).join(', '));

ok('the lineups and their durations are the same either way',
   JSON.stringify(scored.lineups) === JSON.stringify(stored.lineups));

ok('the team totals are the same either way',
   JSON.stringify(scored.team) === JSON.stringify(stored.team));

ok('the play-by-play reads in game order, not entry order',
   JSON.stringify(stored.pbp) === JSON.stringify(scored.pbp));

/* And the numbers have to be RIGHT, not merely equal to each other: a sort that
   dropped the corrections would satisfy every assertion above.

   The missed substitution took p0_0 off at 8:20 of the second, which is 11:40
   into a forty-minute game, and put p0_6 on for the remaining 28:20. Replayed
   after the buzzer instead, that substitution credited p0_0 with the whole forty
   minutes and p0_6 with none: both men's entire line -- minutes, and every rate
   built on them -- against a stint neither played. */
ok('the player the missed substitution took off is credited with 11:40',
   stored.stats['p0_0'].min === 700000, String(stored.stats['p0_0'].min));
ok('...and the player who came on for him with the other 28:20',
   stored.stats['p0_6'].min === 1700000, String(stored.stats['p0_6'].min));
ok('and a player who went off and came back has both stints',
   stored.stats['p0_4'].min === 120000 + 1500000, String(stored.stats['p0_4'].min));
ok('the corrected free throw is counted', stored.stats['p0_0'].fta === 1);
/* The two numbers the unsorted log reported as zero. */
ok('the player who came off is +3 and the player who came on is -3',
   stored.stats['p0_0'].pm === 3 && stored.stats['p0_6'].pm === -3,
   stored.stats['p0_0'].pm + ' / ' + stored.stats['p0_6'].pm);
ok('no stint is clamped to nothing, and they still add up to the game',
   stored.lineups[0].every(l => l.dur > 0) &&
   stored.lineups[0].reduce((a, l) => a + l.dur, 0) === 2400000,
   JSON.stringify(stored.lineups[0].map(l => l.dur)));
ok('...and the 3:20 between the two substitutions belongs to the five that played it',
   stored.lineups[0].some(l => l.dur === 200000),
   JSON.stringify(stored.lineups[0].map(l => l.dur)));
ok('...and it is a miss, so it adds nothing to the score', stored.score[0] === 5);

/* An ordinary log -- one that was never corrected -- must come through
   untouched, and the caller's array must not be reordered underneath it. */
{
  const plain = Object.assign({}, g, { events: g.events.slice() });
  const before = JSON.stringify(E.deriveGame(plain));
  const after = JSON.stringify(E.deriveGame(Object.assign({}, g, { events: g.events.slice() })));
  ok('a log that was never corrected derives exactly as before', before === after);
  ok('...and the caller\'s own array is not reordered underneath it',
     plain.events[plain.events.length - 1].t === 'period_end');
}

/* A run of free throws is stamped at one dead ball, so every one of them has the
   same clock. They must stay in the order they were shot -- which is why the
   tiebreak is the incoming position and never the id. */
{
  const fg = base();
  let q = 0;
  const at = (period, clock, o) => fg.events.push(Object.assign({ id: ++q, seq: q, period, clock }, o));
  at(1, 600000, { t: 'period_start' });
  at(1, 500000, { t: 'foul', team: 1, pid: 'p1_0', kind: 'shooting', drawn: 'p0_0' });
  at(1, 500000, { t: 'ft_made', team: 0, pid: 'p0_0' });
  at(1, 500000, { t: 'ft_miss', team: 0, pid: 'p0_0' });
  at(1, 500000, { t: 'reb', team: 1, pid: 'p1_1', off: false });
  const d = E.deriveGame(fg);
  const seqTxt = d.pbp.map(r => r.txt).join(' | ');
  ok('free throws at one dead ball keep the order they were shot',
     d.pbp.findIndex(r => /misses/.test(r.txt) || /miss/.test(r.txt)) >
     d.pbp.findIndex(r => /makes/.test(r.txt) || /made/.test(r.txt)),
     seqTxt);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
