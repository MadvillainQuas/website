/* ============================================================================
   THE SUBSTRATE FOR A PLAY-TYPE TRACKER.

   A Synergy-style product is a table with one row per offensive play carrying a
   type, a player and a points value. Everything it reports is arithmetic over
   that table, and the event log already supplies every column but the type.

   So these check the two halves that have to be exactly right before any
   labelling — by a human or by a model — is worth doing:

     1. THE UNIT. Synergy counts CHANCES, not possessions: an offensive rebound
        starts a new play, which is why "putback" is a play type at all. Count
        possessions instead and every second-chance play vanishes into the one
        before it.
     2. THE OUTCOME AND THE POINTS. An and-one is ONE play worth three. A trip
        to the line off a non-shooting sequence ends at the line. Get these
        wrong and every points-per-play figure downstream is wrong.

     node supabase/tests/playtypes.test.mjs
   ============================================================================ */
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const P = (await import('file://' + path.join(ROOT, 'epinoia', 'possessions.js'))).default;
const T = (await import('file://' + path.join(ROOT, 'epinoia', 'playtypes.js'))).default;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

let seq = 0;
const e = (t, team, pid, extra) => Object.assign(
  { seq: ++seq, t, team, pid, period: 1, clock: 600000 - seq * 5000,
    wall: 1700000000000 + seq * 5000 }, extra || {});

/* ---- 1. the unit ---------------------------------------------------------- */
console.log('\nan offensive rebound starts a new play, not a new possession');

const log = [
  e('period_start', null, null),
  e('p2_made', 0, 'a1'),
  e('p3_miss', 1, 'b1'), e('reb', 0, 'a2', { off: false }),
  e('p2_miss', 0, 'a3'), e('reb', 0, 'a4', { off: true }), e('p2_made', 0, 'a4'),
  e('to', 1, 'b2'),
  e('p2_made', 0, 'a1'), e('foul', 1, 'b3', { kind: 'shooting' }), e('ft_made', 0, 'a1'),
  e('foul', 0, 'a5', { kind: 'shooting' }), e('ft_made', 1, 'b4'), e('ft_miss', 1, 'b4'),
  e('reb', 0, 'a2', { off: false }),
  e('game_end', null, null)
];
const r = P.enumerate({ events: log });

const second = r.chances.find(c => c.secondChance);
ok('the putback is its own chance', !!second && second.outcome === 'made_2');
ok('...inside the SAME possession as the miss it came from',
   !!second && r.chances[second.index - 1].possession === second.possession,
   'possessions ' + (second && r.chances[second.index - 1].possession) + ' vs ' +
   (second && second.possession));
ok('...so that possession holds two chances',
   r.possessions.some(p => p.chances.length === 2));
ok('and there are more chances than possessions',
   r.chances.length > r.possessions.length,
   r.chances.length + ' chances, ' + r.possessions.length + ' possessions');

/* ---- 2. outcomes and points ---------------------------------------------- */
console.log('\nan and-one is one play worth three');

const andOne = r.chances.find(c => c.points === 3);
ok('the and-one is a single chance', !!andOne);
ok('...counted as a made two, not a three',
   !!andOne && andOne.outcome === 'made_2', andOne && andOne.outcome);
ok('a trip to the line off no shot ends at the line',
   r.chances.some(c => c.outcome === 'shooting_foul' && c.points === 1));
ok('no scoring chance is left labelled as the clock running out',
   !r.chances.some(c => c.outcome === 'period_end' && c.points > 0));
ok('every chance carries an outcome', r.chances.every(c => !!c.outcome));
ok('possession points are the sum of their chances',
   r.possessions.every(p =>
     p.points === p.chances.reduce((a, i) => a + r.chances[i].points, 0)));

/* The totals have to match the box score, or the tracker disagrees with the
   game it is describing. */
const boxPts = log.filter(x => x.t === 'p2_made').length * 2 +
               log.filter(x => x.t === 'p3_made').length * 3 +
               log.filter(x => x.t === 'ft_made').length;
ok('total points across chances equal the box score',
   r.chances.reduce((a, c) => a + c.points, 0) === boxPts,
   r.chances.reduce((a, c) => a + c.points, 0) + ' vs ' + boxPts);

/* ---- 3. what the log can and cannot label -------------------------------- */
console.log('\nthe log labels what it knows, and never guesses at the rest');

/* THIS ASSERTION USED TO ENCODE A BUG.

   It read "a second chance is suggested as a putback with no doubt", and the
   code obliged — any chance beginning with an offensive rebound came back as a
   putback at confidence 1. That is not what the type means. The rebounder has
   to go back up with it BEFORE passing or settling into another action; an
   offensive rebound kicked back out to the arc is a spot-up, and roughly as
   often as not that is what happens.

   So the log can settle it in exactly one case — the man who rebounded is the
   man who finished — and must decline in the other. Both directions are tested,
   because only testing the first would let the old behaviour back in. */
ok('a second chance finished by the rebounder is suggested as a putback',
   (() => {
     const s = T.suggest(Object.assign({}, second,
       { rebounder: 'p9', finisher: 'p9' }));
     return s && s.type === 'putback' && s.confidence >= 0.9 && s.confidence < 1;
   })());
ok('...but one the rebounder gave up is NOT — the log cannot say what it became',
   T.suggest(Object.assign({}, second, { rebounder: 'p9', finisher: 'p4' })) === null);
ok('...and neither is one where the log never saw who rebounded',
   T.suggest(Object.assign({}, second, { rebounder: null, finisher: 'p4' })) === null);
ok('a chance off a live-ball turnover is suggested as transition',
   (() => {
     const prev = { team: 1, outcome: 'turnover', endWall: 1000 };
     const now = { team: 0, startWall: 5000, secondChance: false };
     const s = T.suggest(now, prev);
     return !!s && s.type === 'transition';
   })());
ok('...but not one that started a slow eleven seconds later',
   (() => {
     const prev = { team: 1, outcome: 'turnover', endWall: 1000 };
     const now = { team: 0, startWall: 12000, secondChance: false };
     return T.suggest(now, prev) === null;
   })());
/* The log records no passes bar assists, no screens and no dribbles, so a
   pick-and-roll and an isolation are identical in it. */
ok('an ordinary half-court chance is NOT guessed at',
   T.suggest({ secondChance: false, startWall: 5000 }, null) === null);

/* ---- 4. the report ------------------------------------------------------- */
console.log('\nthe numbers the tracker is read for');

const tagged = [
  { type: 'pnr_handler', points: 2, outcome: 'made_2', source: 'human' },
  { type: 'pnr_handler', points: 0, outcome: 'miss_3', source: 'human' },
  { type: 'pnr_handler', points: 0, outcome: 'turnover', source: 'human' },
  { type: 'pnr_roll',    points: 2, outcome: 'made_2', source: 'human' },
  { type: 'spot_up',     points: 3, outcome: 'made_3', source: 'model', confidence: 0.9 }
];
const rep = T.report(tagged);
const handler = rep.types.find(t => t.type === 'pnr_handler');
ok('points per play is points over plays',
   handler.plays === 3 && Math.abs(handler.ppp - 2 / 3) < 1e-9, String(handler.ppp));
ok('frequency is the share of all plays',
   Math.abs(handler.frequency - 3 / 5) < 1e-9);
ok('turnover frequency is counted', Math.abs(handler.turnoverFrequency - 1 / 3) < 1e-9);
ok('field-goal percentage ignores the turnover',
   handler.fga === 2 && Math.abs(handler.fgPct - 0.5) < 1e-9);

/* A model's guess and a human's judgement are not the same evidence. */
ok('human and model labels are counted apart',
   rep.types.find(t => t.type === 'spot_up').model === 1 &&
   handler.human === 3 && handler.model === 0);
ok('...and can be filtered to one or the other',
   T.report(tagged, { source: 'human' }).total === 4 &&
   T.report(tagged, { source: 'model' }).total === 1);
/* THE TWO THRESHOLDS, AND WHY THERE ARE TWO.

   This assertion used to read `isThin({plays: 40}) === false`, which encoded
   THIN = 15 as a fact about basketball. It is not one. Points per play has a
   standard deviation near 1.05, so the 95% half-width is about +/-0.33 at 40
   plays and +/-0.10 at 400, against an elite-to-poor gap of 0.15 to 0.25. Forty
   plays cannot say the thing the number is read for, and the old test asserted
   that it could.

   So the properties are checked instead of the numbers: a row must be hidden
   below one bar, and must not be RANKED below a much higher one, with a real
   gap between the two where a row may be shown with its interval and nothing
   more. If the thresholds are ever retuned, this test still means something. */
ok('a thin sample is flagged rather than reported as a strength',
   T.isThin(handler) === true &&
   T.isThin({ plays: T.THIN - 1 }) === true &&
   T.isThin({ plays: T.THIN }) === false);
ok('...and a sample too small to RANK is separated from one too small to show',
   T.RESOLVABLE > T.THIN &&
   T.isResolvable({ plays: T.RESOLVABLE }) === true &&
   T.isResolvable({ plays: T.RESOLVABLE - 1 }) === false &&
   /* the interesting middle: shown, but never ranked */
   T.isThin({ plays: T.THIN + 10 }) === false &&
   T.isResolvable({ plays: T.THIN + 10 }) === false);
ok('...and the bar for ranking is high enough to resolve a real difference',
   /* half-width ~= 1.96 * 1.05 / sqrt(n) must be under the ~0.25 gap between a
      good and a poor play type, or ranking is ranking noise */
   1.96 * 1.05 / Math.sqrt(T.RESOLVABLE) < 0.25);

/* ---- 5. the taxonomy is a contract --------------------------------------- */
console.log('\nthe taxonomy everything else has to agree on');

ok('a pick-and-roll produces two separately tracked plays',
   T.isType('pnr_handler') && T.isType('pnr_roll') &&
   T.BY_KEY.pnr_handler.family === 'pnr' && T.BY_KEY.pnr_roll.family === 'pnr');
ok('an unknown type is refused rather than counted',
   T.isType('pick_and_pop') === false &&
   T.report([{ type: 'pick_and_pop', points: 2 }]).total === 0);
ok('the coverages a defence can play are named',
   ['drop', 'hedge', 'blitz', 'switch', 'ice'].every(k => !!T.COVERAGE_BY_KEY[k]));
ok('...including an honest "could not tell"', !!T.COVERAGE_BY_KEY.unknown);
ok('the taxonomy is versioned, so a label keeps its meaning', T.VERSION === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
