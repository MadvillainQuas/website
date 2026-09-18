/* THE WEEKLY REPORT: what it must never get wrong.

   A week is not the mean of its games. Everything else here is phrasing, which can be argued
   about; the aggregation cannot, and neither can the rule that a report never judges a style or
   pretends one game is a month of form.

       node supabase/tests/weekly.test.mjs
*/
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../../epinoia/weekly.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); } };
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.05);

/* two games of very different volume, which is where averaging rates goes wrong */
const big = { pts: 100, fga: 90, fgm: 45, fg3a: 30, fg3m: 15, fta: 10, ftm: 7, oreb: 15, dreb: 30,
  tov: 10, ast: 25, stl: 8, blk: 4, possessions: 95, tsa: 94, ptsAst: 50, rimA: 30, rimM: 20,
  midA: 30, midM: 10, minutes: 200 };
const small = { pts: 40, fga: 10, fgm: 2, fg3a: 4, fg3m: 0, fta: 4, ftm: 3, oreb: 1, dreb: 5,
  tov: 2, ast: 1, stl: 1, blk: 0, possessions: 12, tsa: 12, ptsAst: 2, rimA: 3, rimM: 1,
  midA: 3, midM: 1, minutes: 200 };
const opp = { pts: 95, fga: 88, fgm: 40, fg3a: 28, fg3m: 12, fta: 14, ftm: 10, oreb: 12, dreb: 34,
  tov: 12, ast: 20, stl: 6, blk: 3, possessions: 95, tsa: 94, ptsAst: 44, rimA: 28, rimM: 18,
  midA: 28, midM: 12, minutes: 200 };

console.log('-- a week is its totals, not the mean of its games');
const T = W.teamRates(W.sum([big, small], W.TEAM_COUNTS), W.sum([opp, opp], W.TEAM_COUNTS));
const trueEfg = ((45 + 2) + 0.5 * (15 + 0)) / (90 + 10) * 100;
const meanEfg = (((45 + 7.5) / 90) + ((2 + 0) / 10)) / 2 * 100;
ok('eFG% is the week\'s makes over the week\'s attempts', near(T.efg, trueEfg), [T.efg, trueEfg]);
ok('...which is NOT the mean of the two games', !near(T.efg, meanEfg, 1), [T.efg, meanEfg]);
ok('FT% likewise', near(T.ftp, (7 + 3) / (10 + 4) * 100), T.ftp);
ok('OREB% is against the opponent\'s defensive boards',
   near(T.orebp, (15 + 1) / ((15 + 1) + (34 + 34)) * 100), T.orebp);
ok('AST/TO is a ratio of totals', near(T.astTo, (25 + 1) / (10 + 2)), T.astTo);
ok('points per possession uses the week\'s possessions',
   near(T.ppp, (100 + 40) / (95 + 12)), T.ppp);

console.log('\n-- an empty week says so rather than dividing by nothing');
const Z = W.teamRates(W.sum([], W.TEAM_COUNTS), W.sum([], W.TEAM_COUNTS));
ok('no games, no NaN', Object.values(Z).every(v => typeof v !== 'number' || isFinite(v)));

console.log('\n-- the ledger judges a standard and never a style');
const led = W.ledger('team', W.TEAM_MEASURES, { T, O: T }, T, null);
ok('every measure with a value is listed', led.rows.length > 8, led.rows.length);
ok('with no league scales nothing is graded', led.graded === false);
ok('...so nothing is called good', led.good.length === 0);
ok('...and nothing is called bad', led.bad.length === 0);

/* now with scales: a fake that grades everything, so the style rule can be seen */
globalThis.EpinoiaGamePct = { rate: (scope, key) => ({ p: key === 'p3r' ? 95 : 12, g: key === 'p3r' ? 95 : 12, d: 1, band: 0 }) };
const led2 = W.ledger('team', W.TEAM_MEASURES, { T, O: T }, T, 'x');
ok('a style is never a strength', !led2.good.some(r => r.key === 'p3r'), led2.good.map(r => r.key));
ok('a style is never a weakness', !led2.bad.some(r => r.key === 'p3r'), led2.bad.map(r => r.key));
ok('...but it is still shown', led2.rows.some(r => r.key === 'p3r' && r.pct === 95));
ok('the real weaknesses are found', led2.bad.length > 0);
delete globalThis.EpinoiaGamePct;

console.log('\n-- the prose is written for next week, and says how much it is looking at');
const one = W.prose('Loughborough', led2, [{}], '1-0');
ok('it names the number of games', one.some(p => /one game/.test(p)), one[0]);
ok('one game carries its own warning', one.some(p => /One game is one game/.test(p)));
const four = W.prose('Loughborough', led2, [{}, {}, {}, {}], '3-1');
ok('four games do not', !four.some(p => /One game is one game/.test(p)));
ok('a weakness is phrased as work', four.some(p => /^WORK ON:/.test(p)), four);
ok('no games at all is handled', W.prose('X', { rows: [], graded: false }, [])[0].length > 0);

console.log('\n-- the view renders what the ledger holds');
const html = W.render({ games: [{}, {}], record: '1-1', led: led2, prose: four }, { window: 'the last seven days' });
ok('a row per measure', (html.match(/wk-row/g) || []).length === led2.rows.length);
ok('the style row is grey', /wk-style/.test(html));
ok('work-on is marked', /wk-work/.test(html));
ok('a club name cannot inject markup',
   !/<script/.test(W.render({ games: [], led: null, prose: ['<script>x</script>'] }, {})));

console.log('\n-- phrase() never hands out the same wording twice running (2026-09-18 fix:');
console.log('   the exact same words this module used for game/report.js\'s repeated "nine games');
console.log('   in ten" complaint, so the guard against it is checked the same way)');
/* Same percentile, same seed -> pickVaried's raw index is identical both times, so a
   consecutive repeat is only avoided because it remembers the last pick and steps off it.
   This holds regardless of which band 95 falls in, so it doesn't depend on PCT_BANDS' wording. */
const rep1 = W.phrase(95, 'sameseed');
const rep2 = W.phrase(95, 'sameseed');
ok('two consecutive identical calls do not return the same phrase', rep1 !== rep2, [rep1, rep2]);

console.log('\n-- a week reports the same way on a second render');
const proseA = W.prose('Loughborough', led2, [{}, {}, {}, {}], '3-1');
const proseB = W.prose('Loughborough', led2, [{}, {}, {}, {}], '3-1');
ok('the same week, read twice, comes out identical', JSON.stringify(proseA) === JSON.stringify(proseB));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
