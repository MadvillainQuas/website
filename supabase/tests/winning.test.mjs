/* ============================================================================
   WHAT WINS (epinoia/winning.js), with no browser.

     node supabase/tests/winning.test.mjs

   What is held here:
     * the arithmetic: Pearson's r on known numbers, least squares recovering an exact fit, a singular one refused;
     * the rows: a game is the home side less the away side on every measure the two rows both carry, with its
       margin and result; a draw, and a game with one side's box score missing, are left out;
     * the measuring: a measure that decides every game has r near 1 and the side that won it won them all; a
       fewer-is-better measure (turnovers) counted the right way round; the winners' and losers' averages; the
       four factors fitted to the margin, their shares adding to 100 beside Oliver's 40 / 25 / 20 / 15;
     * per league, only leagues with enough games; the words name what the numbers say;
     * the charts come out whole with names escaped, and the read asks for the measures by their paths, never
       the whole stats blob.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sandbox = { console, module: undefined };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia/winning.js'), 'utf8'), vm.createContext(sandbox), { filename: 'winning.js' });
const W = sandbox.EpinoiaWinning;

console.log('\nthe arithmetic');
ok('r of a perfect line is 1, of its mirror -1, of a constant nothing', Math.abs(W.pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12 &&
   Math.abs(W.pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12 && W.pearson([1, 2, 3], [5, 5, 5]) === null);
ok('r of a known sample: 0.8 (x 1..5, y 2 1 4 3 5)', Math.abs(W.pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) - 0.8) < 1e-12);
const X = [[1, 2], [2, 1], [3, 5], [4, 3], [5, 8], [6, 2]], y = X.map(([a, b]) => 2 + 3 * a - b);
const fit = W.ols(X, y);
ok('least squares recovers y = 2 + 3a - b exactly (R² 1)', fit && [2, 3, -1].every((v, i) => Math.abs(fit.b[i] - v) < 1e-9) && Math.abs(fit.r2 - 1) < 1e-12, fit && fit.b.join());
ok('...and refuses a singular problem, or too few rows', W.ols([[1, 2], [2, 4], [3, 6], [4, 8]], [1, 2, 3, 4]) === null && W.ols([[1]], [1]) === null);

console.log('\nthe rows');
const L1 = { id: 'l1', name: 'League One', slug: 'one' }, L2 = { id: 'l2', name: 'League Two', slug: 'two' };
const side = (efg, tovp, orebp, ftr, extra) => Object.assign({ efg, tovp, orebp, ftr, ts: efg + 4, p3r: 35, paint: 30 }, extra || {});
const games = [], tgs = [];
/* 60 games: the side with the better shooting wins, the margin a mix of all four factors (and a little noise) */
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (let i = 0; i < 60; i++) {
  const d = (rnd() - 0.5) * 20, t = (rnd() - 0.5) * 10, o = (rnd() - 0.5) * 16, f = (rnd() - 0.5) * 20;
  const margin = Math.round(1.5 * d - 1.0 * t + 0.35 * o + 0.1 * f + (rnd() - 0.5) * 2) || 1;
  const id = 'g' + i;
  games.push({ id, home_score: 80 + Math.max(0, margin), away_score: 80 + Math.max(0, -margin), league: i < 30 ? L1 : L2 });
  tgs.push({ game_id: id, team_idx: 0, ...side(50 + d / 2, 15 + t / 2, 30 + o / 2, 25 + f / 2, { p3r: 30 + (i % 7) }) },
           { game_id: id, team_idx: 1, ...side(50 - d / 2, 15 - t / 2, 30 - o / 2, 25 - f / 2, { p3r: 30 + (i % 5) }) });
}
games.push({ id: 'draw', home_score: 70, away_score: 70, league: L1 });
tgs.push({ game_id: 'draw', team_idx: 0, ...side(50, 15, 30, 25) }, { game_id: 'draw', team_idx: 1, ...side(50, 15, 30, 25) });
games.push({ id: 'half', home_score: 70, away_score: 60, league: L1 });
tgs.push({ game_id: 'half', team_idx: 0, ...side(50, 15, 30, 25) });
const R = W.rows(games, tgs);
ok('a draw and a game with one side\'s box score are left out', R.length === 60 && !R.some(r => r.id === 'draw' || r.id === 'half'));
ok('each game: home less away, the margin and the result', Math.abs(R[0].d.efg - (tgs[0].efg - tgs[1].efg)) < 1e-9 && R[0].win === (R[0].margin > 0 ? 1 : 0));
ok('a measure only one side carries is not a difference', R.every(r => r.d.bench === undefined));

console.log('\nthe measuring');
const a = W.analyse(R);
const m = k => a.measures.find(x => x.k === k);
ok('shooting decides these games: r above 0.6, the better shooting side won more than 80%', m('efg').r > 0.6 && m('efg').winRate > 80, m('efg').r.toFixed(2) + ' ' + m('efg').winRate.toFixed(0));
ok('turnovers counted the right way round: fewer goes with winning (r > 0)', m('tovp').low && m('tovp').r > 0, m('tovp').r.toFixed(2));
ok('the winners shot better on average than the losers', m('efg').winners > m('efg').losers && m('tovp').winners < m('tovp').losers);
ok('ranked most tied to winning first', a.ranked[0].r >= a.ranked[a.ranked.length - 1].r && ['efg', 'ts'].includes(a.ranked[0].k), a.ranked[0].k);
ok('the four factors: fitted to the margin, explaining nearly all of it here', a.factors && a.factors.r2 > 0.9, a.factors && a.factors.r2.toFixed(3));
ok('...their shares add to 100, shooting the biggest, beside Oliver\'s weights', Math.abs(a.factors.weights.reduce((s, w) => s + w.share, 0) - 100) < 1e-9 &&
   a.factors.weights.slice().sort((x, y2) => y2.share - x.share)[0].k === 'efg' && a.factors.weights.map(w => w.oliver).join() === '40,25,20,15');
ok('the home side\'s share of wins', a.homeWin != null && a.homeWin > 0 && a.homeWin < 100);
const per = W.byLeague(R, 20);
ok('league by league: both leagues (30 games each), their own strongest measure', per.length === 2 && per.every(g => g.n === 30 && g.top));
ok('...a league under the minimum is left out', W.byLeague(R, 31).length === 0);
const words = W.insights(a);
ok('the words name the strongest measure, the four factors against Oliver, and the home side', /is the number most tied to winning/.test(words[0]) &&
   words.some(t => /four factors explain \d+% of the margin/.test(t) && /40 \/ 25 \/ 20 \/ 15/.test(t)) && words.some(t => /home side won/.test(t)), words.join(' | '));
ok('too few games: says so', /Too few/.test(W.insights(W.analyse(R.slice(0, 5)))[0]));

console.log('\nthe charts and the read');
const bars = W.barsSVG(a);
ok('the ranking: a bar per measure with an r and a won-it rate', (bars.match(/class="ww-bar( ww-neg)?"/g) || []).length === a.ranked.length && /won it → won the game/.test(bars));
ok('the four factors: measured and Oliver\'s strips, four segments each', (W.factorsSVG(a.factors).match(/class="ww-f ww-f-/g) || []).length === 12);
{
  const shown = a.measures.filter(x => x.winners != null && x.losers != null && x.group !== 'pts').length;
  ok('winners and losers: a winners\' and a losers\' dot for each measure the games carry (and the key\'s)', shown === 6 &&
     (W.dumbbellSVG(a).match(/class="ww-win"/g) || []).length === shown + 1 && (W.dumbbellSVG(a).match(/class="ww-lose"/g) || []).length === shown + 1);
}
ok('game by game: a dot per game and the fitted line', (W.scatterSVG(R, 'efg', 'eFG%').match(/class="ww-p[wl]"/g) || []).length === 60 && /class="ww-fit"/.test(W.scatterSVG(R, 'efg', 'eFG%')));
ok('labels are text, never markup', !/<b>x/.test(W.scatterSVG(R, 'efg', '<b>x</b>')));
ok('the read asks for each measure by its path, never the whole blob', /efg:stats->adv->efg/.test(W.SELECT) && /paint:stats->paint/.test(W.SELECT) && !/(^|,)stats(,|$)/.test(W.SELECT));
const page = fs.readFileSync(path.join(ROOT, 'epinoia/winning/page.js'), 'utf8');
ok('the page reads through winning.js\'s SELECT, 150 games a request, and keeps the rows six hours', /W\(\)\.SELECT/.test(page) && /i \+= 150/.test(page) && /6 \* 3600 \* 1000/.test(page));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
