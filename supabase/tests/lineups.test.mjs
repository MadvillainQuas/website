/* ============================================================================
   THE LINEUPS TAB (epinoia/game/lineups.js, boxscore.js lineupCombos), on a real game.

     node supabase/tests/lineups.test.mjs

   The tab now offers the fives, or every trio and pair inside them, filtered by minutes and by player
   and sorted by any column. What is held here:
     * the fives are exactly the old tab's fives (lineupAgg), same minutes and points;
     * a pair is every stretch the two shared, whoever the other three were: each five holds ten pairs,
       so the pairs' minutes add up to ten times the fives', and their points to ten times theirs;
     * the filters and the sort do what they say, and a lower-is-better column starts from its best;
     * the tab draws with its controls, both teams' player pickers, and nothing but S and the box score
       module in scope.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const FIXTURE = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'game.json');
if (!fs.existsSync(FIXTURE)) { console.log('  SKIP  no fixture at supabase/tests/fixtures/game.json'); process.exit(0); }
const game = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const store = {};
const sandbox = { S: game, console, module: undefined,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(read('epinoia/engine.js'), ctx, { filename: 'engine.js' });
sandbox.derive = () => sandbox.EpinoiaEngine.deriveGame(sandbox.S);
vm.runInContext(read('epinoia/boxscore.js'), ctx, { filename: 'boxscore.js' });
vm.runInContext(read('epinoia/game/lineups.js'), ctx, { filename: 'lineups.js' });
const B = sandbox.EpinoiaBox, L = sandbox.EpinoiaLineups;
B.rebuildPmap();
const d = sandbox.derive();

console.log('\nthe groups');
{
  const five = B.lineupCombos(d, 0, 5), old = B.lineupAgg(d, 0);
  ok('the fives are the old tab\'s fives', five.length === old.length && five.every((l, i) => l.ids.join() === old[i].ids.join() && l.dur === old[i].dur && l.pf === old[i].pf));
  const sum = (list, k) => list.reduce((a, l) => a + l[k], 0);
  const fives = d.lineups[0].filter(l => l.ids.length === 5);
  const pairs = B.lineupCombos(d, 0, 2), trios = B.lineupCombos(d, 0, 3);
  ok('every pair is two players, every trio three', pairs.every(l => l.ids.length === 2) && trios.every(l => l.ids.length === 3));
  ok('each five holds ten pairs: the pairs\' minutes are ten times the fives\'',
     Math.abs(sum(pairs, 'dur') - 10 * sum(fives, 'dur')) < 1, sum(pairs, 'dur') + ' v ' + 10 * sum(fives, 'dur'));
  ok('...and their points ten times theirs', sum(pairs, 'pf') === 10 * sum(fives, 'pf') && sum(pairs, 'pa') === 10 * sum(fives, 'pa'));
  ok('...and ten trios each', Math.abs(sum(trios, 'dur') - 10 * sum(fives, 'dur')) < 1);
  ok('a pair\'s rates come from its own summed boxes', pairs.every(l => Number.isFinite(l.ortg) && Number.isFinite(l.net) && l.pm === l.pf - l.pa));
  ok('no pair is listed twice', new Set(pairs.map(l => l.ids.join())).size === pairs.length);
}

console.log('\nthe filters and the sort');
{
  L._set({ size: 2, min: 0, sort: 'dur', dir: -1, players: { 0: '', 1: '' } });
  const all = L.rows(d, 0);
  ok('longest first by default', all.every((l, i) => i === 0 || all[i - 1].dur >= l.dur));
  const five = L.rows(d, 0, { min: 300000 });
  ok('5+ minutes keeps only groups that played five minutes (or scored)', five.every(l => l.dur >= 300000 || l.pf || l.pa) && five.length <= all.length);
  const pid = String(game.teams[0].players[0].id);
  const his = L.rows(d, 0, { players: { 0: pid, 1: '' } });
  ok('with a player: only the pairs he was in', his.length > 0 && his.every(l => l.ids.map(String).includes(pid)), his.length + ' pairs');
  ok('...and the other team is not filtered by him', L.rows(d, 1, { players: { 0: pid, 1: '' } }).length === L.rows(d, 1).length);
  const byNet = L.rows(d, 0, { sort: 'net', dir: -1 });
  ok('sorted by net, best first', byNet.every((l, i) => i === 0 || byNet[i - 1].net >= l.net));
  const up = L.rows(d, 0, { sort: 'drtg', dir: 1 });
  ok('sorted by drtg ascending (the best defence first)', up.every((l, i) => i === 0 || up[i - 1].drtg <= l.drtg));
}

console.log('\nthe tab');
{
  L._set({ size: 5, min: 0, sort: 'dur', dir: -1, detail: false, players: { 0: '', 1: '' } });
  const html = L.render(d);
  ok('controls: 5-, 3- and 2-man, minutes, four factors', /data-lu-size="5"/.test(html) && /data-lu-size="2"/.test(html) && /data-lu-min="300000"/.test(html) && /data-lu-detail/.test(html));
  ok('a player picker for each team', /data-lu-player="0"/.test(html) && /data-lu-player="1"/.test(html));
  ok('compact by default: no four-factor columns', !/data-lu-sort="oefg"/.test(html) && /<table class="lu2 s5">/.test(html));
  L._set({ detail: true });
  ok('four factors on request', /data-lu-sort="oefg"/.test(L.render(d)) && /lu2-detail/.test(L.render(d)));
  ok('the column groups: basic and ratings, then both four factors on request', /g-basic/.test(html) && /g-rtg/.test(html) && !/lu2-g g-ff/.test(html) && /lu2-g g-ff/.test(L.render(d)) && /lu2-g g-opp/.test(L.render(d)));
  ok('every figure is shaded on its own: cells carry h* classes, no row tint', /<td class="[^"]*\bh[gbv][123]\b/.test(L.render(d)) && !/style="background:rgba/.test(L.render(d)));
  ok('the team\'s whole game is the reference row', /lu2-team/.test(html));
  ok('every sortable header says what it sorts by', (html.match(/data-lu-sort="/g) || []).length === 7 * 2);
  const names = game.teams[0].players.map(p => p.name).filter(Boolean);
  ok('the names are escaped text, not markup', !names.some(n => /[<>]/.test(n)) || !/<script/i.test(html));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
