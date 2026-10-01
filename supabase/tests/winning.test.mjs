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
       the whole stats blob (the builder's teaser read);
     * the shot-selection claim only when |r(eFG)| is at least twice the shot-selection group's largest |r|;
     * fromTeaser: the public preview in analyse()'s shape, so insights() words it;
     * the page reads files through EpinoiaWinFile and keeps nothing in localStorage.
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

console.log('\nthe shot-selection claim is made only when the numbers carry it');
{
  /* a league where shooting dwarfs shot selection: the claim; one where the three-point rate goes with winning nearly
     as closely as eFG%: no claim, the measure named for what it is (docs/what-wins-model.md §11) */
  const base = a.measures.map(x => Object.assign({}, x));
  const mk = (efgR, styleR) => {
    const ms = base.map(x => Object.assign({}, x));
    ms.find(x => x.k === 'efg').r = efgR;
    ms.filter(x => x.group === 'style').forEach((x, i) => { x.r = i ? styleR / 3 : styleR; });
    return Object.assign({}, a, { measures: ms, ranked: ms.filter(x => x.r != null).sort((p, q) => q.r - p.r) });
  };
  const yes = W.insights(mk(0.62, 0.2)), no = W.insights(mk(0.62, 0.4)), edge = W.insights(mk(0.6, 0.3));
  ok('|r(eFG)| ≥ 2 × the largest |r| in the shot-selection group: "how well a side shoots matters far more"', yes.some(t => /matters far more than where it shoots from/.test(t)));
  ok('...under twice: no such claim, the strongest shot-selection measure named with its r', !no.some(t => /matters far more/.test(t)) && no.some(t => /^Shot selection counts here too: .* \(r = 0\.40\)\.$/.test(t)), no.join(' | '));
  ok('...exactly twice still carries it', edge.some(t => /matters far more/.test(t)));
  ok('...the largest |r| of the group decides, not the smallest', !W.insights(mk(0.62, -0.35)).some(t => /matters far more/.test(t)));
}

console.log('\nthe public preview (the teaser) in analyse()\'s shape');
{
  const teaser = { w: 1, scope: 'teaser', token: 't', built: '2026-10-01T00:00:00Z', n: 1465, homeWin: 0.568,
    ranked: [{ k: 'efg', label: 'effective field goal %', r: 0.65, winRate: 0.8 }, { k: 'tovp', label: 'turnover %', r: 0.3, winRate: 0.66 },
             { k: 'p3r', label: 'three-point attempt rate', r: 0.04, winRate: 0.52 }, { k: 'second', label: 'second-chance points', r: 0.2, winRate: 0.6 }],
    factors: { r2: 0.944, home: 0.24, shares: [{ k: 'efg', share: 0.48, oliver: 0.4 }, { k: 'tovp', share: 0.28, oliver: 0.25 }, { k: 'orebp', share: 0.19, oliver: 0.2 }, { k: 'ftr', share: 0.05, oliver: 0.15 }] },
    leagues: [] };
  const t = W.fromTeaser(teaser);
  ok('n, home share as a per cent, ranked by r', t.n === 1465 && Math.abs(t.homeWin - 56.8) < 1e-9 && t.ranked.map(m => m.k).join() === 'efg,tovp,sc,p3r');
  ok('win rates as per cents, groups from MEASURES (second-chance points is a points measure)', t.ranked[0].winRate === 80 && t.ranked.find(m => m.k === 'sc').group === 'pts' && t.ranked.find(m => m.k === 'p3r').group === 'style');
  ok('the four factors\' shares as per cents beside Oliver\'s', t.factors && Math.abs(t.factors.weights[0].share - 48) < 1e-9 && t.factors.weights.map(w => w.oliver).join() === '40,25,20,15');
  const words = W.insights(t);
  ok('insights() words the preview like a full analysis', /^Across 1,465 games, effective field goal % is the number most tied to winning: the side that won it won 80% of the time \(r = 0\.65\)\.$/.test(words[0]) &&
     words.some(x => /four factors explain 94% of the margin/.test(x)) && words.some(x => /home side won 57%/.test(x)), words.join(' | '));
  ok('...per cents given as per cents are read the same', W.fromTeaser(Object.assign({}, teaser, { homeWin: 56.8 })).homeWin === 56.8);
  ok('nothing, or a bad file, is an empty analysis and never throws', W.fromTeaser(null).n === 0 && W.insights(W.fromTeaser({ ranked: 'x' }))[0].startsWith('Too few'));
}

console.log('\nthe page');
const page = fs.readFileSync(path.join(ROOT, 'epinoia/winning/page.js'), 'utf8');
ok('the page reads the analysis through EpinoiaWinFile, and words the public preview through fromTeaser', /EpinoiaWinFile/.test(page) && /\.fromTeaser\(/.test(page) && /scope: 'teaser'/.test(page));
ok('...and no longer reads box scores itself: no SELECT, no 150-game chunks, no six-hour localStorage copy',
   !/W\(\)\.SELECT/.test(page) && !/i \+= 150/.test(page) && !/6 \* 3600 \* 1000/.test(page) && !/localStorage\.setItem/.test(page) && /removeItem\(LEGACY\)/.test(page));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
