/* ============================================================================
   COMPARE PLAYER ON THE PROFILE -- epinoia/p/compare-ui.js and its button in p/player.js.

     1. model(): each line is ranked in its own field (never the two pooled), the chart's two ids are 'a' and 'b'
        (one person can be both), the per-game possessions the statistics table derives are derived here too, a
        locked column is never ranked or offered, and the chart opens on the table's per-game preset
     2. compare.js fromTable takes the model as the statistics page's tray hands it over: two players, named
        and labelled as the profile names them, each with a percentile per stat
     3. seasonFor(): a league opens on the season named like the one on the profile, else its newest
     4. the page: the modules load before player.js, the chart's stylesheet is on the page, the button sits
        beside find similar players, a new scope forgets the line, the picker's own text names nobody's gender

     node supabase/tests/profile-compare.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const SE = require(path.join(ROOT, 'epinoia', 'season.js'));
const C = require(path.join(ROOT, 'epinoia', 'compare.js'));
const PC = require(path.join(ROOT, 'epinoia', 'p', 'compare-ui.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

/* two leagues: a scorer who leads a weak league with 14, and one who is middling in a strong league with 18 */
const cols = [
  { k: 'gp', l: 'GP', g: ['basic', 'id'] },
  { k: 'ppg', l: 'PPG', g: ['basic'], heat: true, fmt: r => r.ppg.toFixed(1) },
  { k: 'topg', l: 'TOPG', g: ['basic'], heat: true, low: true, fmt: r => r.topg.toFixed(1) },
  { k: 'poss_pg', l: 'POSS', g: ['advanced'], heat: true, fmt: r => r.poss_pg.toFixed(1) },
  { k: 'ev_x', l: 'EV', g: ['events'], heat: true },
  { k: 'rapm', l: 'RAPM', g: ['advanced'], heat: true }
];
const mk = (id, ppg, topg, gp = 10) => ({ id, gp, ppg, topg, poss: 60 * gp, ev_x: ppg / 2, rapm: 1 });
const weak = [mk('w1', 14, 1), mk('w2', 8, 2), mk('w3', 6, 3), mk('w4', 4, 4), mk('w0', 30, 0, 0)];
const strong = [mk('s1', 25, 1), mk('s2', 22, 2), mk('s3', 18, 3), mk('s4', 16, 4), mk('s5', 12, 5)];
const other = Object.assign({}, strong[2], { id: 'L2:s3', playerId: 's3', name: 'Sam Strong', teamFull: 'Strong City', teamName: 'STR', colour: '#123456' });

console.log('-- the model');
const m = PC.model({
  mine: weak[0], mineField: weak, other, otherField: strong, cols, groups: [['basic', 'per game'], ['advanced', 'advanced'], ['events', 'events']],
  locked: k => k === 'ev_x', percentiles: SE.percentiles,
  mineAs: { name: 'Wes Weak', leagueShort: 'WL 25-26' }, otherAs: { leagueShort: 'SL 25-26' },
  league: { name: 'Weak League' }, range: '2025-26', title: 'Wes Weak v Sam Strong', note: 'n'
});
const pa = k => m.ranks.get(k).get('a'), pb = k => m.ranks.get(k).get('b');
ok('the two lines are a and b in the chart', m.picks.map(p => p.id).join() === 'a,b' && m.max === 2);
ok('each is ranked in his own field: the weak league\'s leader is top there, the strong league\'s 18 is in the middle', pa('ppg') === 100 && pb('ppg') === 50, [pa('ppg'), pb('ppg')]);
ok('a player with no games is not in the field (0 games, 30 a game: counted, the leader would be 75th)', pa('ppg') === 100, pa('ppg'));
ok('lower is better where the table says so', pa('topg') > pb('topg'), [pa('topg'), pb('topg')]);
ok('possessions per game are derived as the statistics table derives them', m.picks[0].poss_pg === 60 && pa('poss_pg') != null);
ok('a locked column is neither ranked nor drawn', !m.ranks.has('ev_x') && m.locked('ev_x') === true);
ok('the chart opens on the table\'s per-game preset', m.statKeys.join() === 'gp,ppg,topg');
ok('the profile\'s names ride on the picks, over the season line\'s', m.picks[0].name === 'Wes Weak' && m.picks[0].leagueShort === 'WL 25-26' && m.picks[1].name === 'Sam Strong' && m.picks[1].leagueShort === 'SL 25-26');
ok('the lines themselves are not changed', weak[0].id === 'w1' && weak[0].poss_pg === undefined && other.id === 'L2:s3');
const same = PC.model({ mine: weak[1], mineField: weak, other: Object.assign({ playerId: 'w1' }, weak[0]), otherField: weak, cols, percentiles: SE.percentiles });
ok('one person in one season can be compared with himself: two ids all the same', same.picks.map(p => p.id).join() === 'a,b' && same.ranks.get('ppg').get('b') === 100 && same.ranks.get('ppg').get('a') === 200 / 3);

console.log('-- the chart takes it');
{
  const o = C.fromTable(m);
  ok('two players, named as the profile names them', o.players.length === 2 && o.players[0].name === 'Wes Weak' && o.players[1].league === 'SL 25-26' && o.players[1].team.colour === '#123456');
  ok('every stat has each player\'s percentile', o.pcts.a.ppg === pa('ppg') && o.pcts.b.ppg === pb('ppg'));
  ok('RAPM and a locked column are not offered', !o.allStats.some(s => s.key === 'rapm' || s.key === 'ev_x') && !o.statGroups.some(g => g.key === 'events'));
  ok('the title and the note are the profile\'s', o.title === 'Wes Weak v Sam Strong' && o.note === 'n' && o.range === '2025-26');
  const svg = C.html(Object.assign({}, o, { width: 600 }));
  ok('it draws, with no NaN', /<svg/.test(svg) && !/NaN|Infinity/.test(svg));
}

console.log('-- the season a league opens on');
{
  const L = { seasons: [{ id: 'n', name: '2026-27' }, { id: 'o', name: '2025-26' }, { id: 'x', name: '2024/25' }] };
  ok('the one named like the season shown', PC.seasonFor(L, '2025-26').id === 'o');
  ok('written another way, the same season (2024-25 is 2024/25)', PC.seasonFor(L, '2024-25').id === 'x');
  ok('a league without it: its newest', PC.seasonFor(L, '2019-20').id === 'n' && PC.seasonFor(L, '').id === 'n');
  ok('a league with no seasons: none', PC.seasonFor({ seasons: [] }, '2025-26') === null && PC.seasonFor(null, 'x') === null);
}

console.log('-- the profile page');
{
  const html = rd('epinoia', 'p', 'index.html');
  const at = s => html.indexOf(s);
  ok('the chart\'s stylesheet is on the page', at('kit/compare.css') > -1);
  ok('the leagues, the chart and the picker load before the page script',
    at('../global.js') > -1 && at('../compare.js') > -1 && at('compare-ui.js') > -1 &&
    at('../global.js') < at('player.js?') && at('../compare.js') < at('player.js?') && at('compare-ui.js') < at('player.js?'));
  const js = rd('epinoia', 'p', 'player.js');
  ok('the button sits after find similar players and before expand all',
    js.indexOf('sw.appendChild(sb)') > -1 && js.indexOf('sw.appendChild(sb)') < js.indexOf('sw.appendChild(cb)') && js.indexOf('sw.appendChild(cb)') < js.indexOf('sw.appendChild(all)'));
  ok('only for the line the bars show', /cmpCtx\.mine === mine/.test(js));
  ok('a new scope forgets the line', /SIM_CTL = null; CMP_CTX = null;/.test(js));
  ok('the picker opens as it was after a redraw of the bars, without taking the focus', /show\(cmpOpen, false\)/.test(js) && /if \(ctx\.focus\) lgS\.focus\(\)/.test(rd('epinoia', 'p', 'compare-ui.js')));
  const ui = rd('epinoia', 'p', 'compare-ui.js');
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('Enter on a dropdown compares; Escape closes', /e\.key === 'Enter' && e\.target && e\.target\.tagName === 'SELECT'/.test(code) && /e\.key === 'Escape'/.test(code));
  ok('names are never translated', /setAttribute\('translate', 'no'\)/.test(code));
  ok('the other player comes the scouting page\'s way (named rows, the leagues this reader may see)', /G\.catalogue\(\)/.test(code) && /G\.mergeLeague\(/.test(code));
  ok('a premium column is locked when either league locks it', /featureLocked\('statColumns'/.test(code) && /shut\(ctx\.leagueId\) \|\| shut\(L\.id\)/.test(code));
  ok('the visible text says nothing of anybody\'s gender', !/\b(his|him|her|she|he)\b/i.test(code));
  const names = /basketball-?reference|bbref|kenpom|torvik|cleaning ?the ?glass|nba\.com|realgm|eurobasket|sports-reference/i;
  ok('no other stats site is named', !names.test(ui));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
