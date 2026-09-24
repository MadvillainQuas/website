/* ============================================================================
   THE GAMES SECTION SHOWS THE RIGHT GAMES (epinoia/gameslist.js, home.js).

   Reported 2026-09-24 on B.LEAGUE Premier: the front page's "this week" listed
   games from 21-23 January, "results" said nothing had been played, and the
   header read "0 this week - 400 upcoming". The list was one read, newest
   first, capped at 400, and the league has 780 fixtures: the 400 newest start
   on 21 January, so the week's games and every result were never fetched.

   These tests run the module's own queries against a stand-in for the
   database (status / tipoff_at / order / limit / exact count -- the parts of a
   PostgREST read the page relies on) over a season shaped like that league:
   780 games from 22 Sep 2026 to 1 May 2027, four played, the rest to come.

     node supabase/tests/gameslist.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, 'epinoia', 'gameslist.js'));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

/* ---- the database, as far as these reads use it ----------------------------------------- */
const at = g => new Date(g.tipoff_at).getTime();
function read_(rows, suffix) {
  const params = suffix.split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; });
  let out = rows.slice();
  let order = null, limit = Infinity;
  for (const [k, v] of params) {
    if (k === 'status') {
      const m = /^(eq|in)\.\(?([^)]*)\)?$/.exec(v);
      const set = new Set(m[2].split(','));
      out = out.filter(g => set.has(g.status));
    } else if (k === 'tipoff_at') {
      const m = /^(gte|lte|gt|lt)\.(.+)$/.exec(v);
      const t = new Date(m[2]).getTime();
      out = out.filter(g => ({ gte: at(g) >= t, lte: at(g) <= t, gt: at(g) > t, lt: at(g) < t })[m[1]]);
    } else if (k === 'order') order = v;
    else if (k === 'limit') limit = +v;
  }
  if (order) { const d = /desc$/.test(order) ? -1 : 1; out.sort((a, b) => d * (at(a) - at(b))); }
  return { rows: out.slice(0, limit), total: out.length };
}
const run = (rows, q) => Object.fromEntries(Object.entries(q).map(([k, s]) => [k, read_(rows, s)]));
const collect = (res) => Object.values(res).flatMap(r => r.rows);
const totalsOf = res => ({ done: res.done && res.done.total, next: res.next && res.next.total });

/* ---- a season shaped like B.LEAGUE Premier ------------------------------------------------ */
const NOW = Date.parse('2026-09-24T12:00:00Z');
let id = 0;
const game = (iso, status, extra) => Object.assign({ id: 'g' + (++id), tipoff_at: iso, status, home_score: 0, away_score: 0 }, extra || {});
function season() {
  const rows = [];
  const played = ['2026-09-22T05:00:00Z', '2026-09-23T05:05:00Z', '2026-09-23T10:05:00Z', '2026-09-24T10:05:00Z'];
  played.forEach(t => rows.push(game(t, 'final', { home_score: 80, away_score: 70 })));
  /* 24 in the coming week, as the real fixture list has */
  const soon = [];
  for (let d = 1; d <= 3; d++) for (let k = 0; k < 8; k++) soon.push(Date.parse('2026-09-2' + (4 + d) + 'T04:05:00Z') + k * 3600000);
  soon.forEach(t => rows.push(game(new Date(t).toISOString(), 'scheduled')));
  /* the rest of the season, 752 games: 352 from October to 20 January, and the 400 newest from
     21 January to 1 May -- which is exactly where the real league's newest 400 begin */
  let t = Date.parse('2026-10-02T05:00:00Z');
  for (let i = 0; i < 352; i++) { rows.push(game(new Date(t).toISOString(), 'scheduled')); t += 7.5 * 3600000; }
  t = Date.parse('2027-01-21T05:00:00Z');
  for (let i = 0; i < 400; i++) { rows.push(game(new Date(t).toISOString(), 'scheduled')); t += 6.06 * 3600000; }
  return rows;
}
const SEASON = season();
ok('the stand-in season has the real league\'s shape', SEASON.length === 780 &&
   SEASON.filter(g => g.status === 'final').length === 4 &&
   new Date(Math.max(...SEASON.map(at))).toISOString().slice(0, 7) === '2027-05', String(SEASON.length));

/* ---- the bug, reproduced against the OLD read --------------------------------------------- */
console.log('\nthe old read (newest first, capped at 400)');
{
  const old = read_(SEASON, '&status=in.(live,final,finalising,scheduled)&order=tipoff_at.desc&limit=400').rows;
  const week = old.filter(g => Math.abs(at(g) - NOW) <= 7 * 86400000);
  ok('reaches back only to 21 January', new Date(Math.min(...old.map(at))).toISOString().slice(0, 10) >= '2027-01-20',
     new Date(Math.min(...old.map(at))).toISOString().slice(0, 10));
  ok('...so it holds none of this week\'s games and none of the four results',
     week.length === 0 && old.filter(g => g.status === 'final').length === 0);
}

/* ---- the new reads ------------------------------------------------------------------------ */
console.log('\nthis week');
{
  const res = run(SEASON, G.queries('week', NOW));
  const v = G.pick(collect(res), 'week', NOW, totalsOf(res));
  ok('the reads are three, each bounded by number', Object.keys(res).sort().join() === 'done,live,next' &&
     Object.values(G.queries('week', NOW)).every(q => /&limit=\d+/.test(q) && /&order=tipoff_at\.(asc|desc)/.test(q)));
  ok('every row shown is within a week of now -- nothing from January',
     v.shown.length > 0 && v.shown.every(g => Math.abs(at(g) - NOW) <= 7 * 86400000),
     v.shown.map(g => g.tipoff_at.slice(0, 10)).join(' '));
  ok('the next game is the first row', v.shown[0].tipoff_at === '2026-09-25T04:05:00.000Z' || at(v.shown[0]) === Math.min(...SEASON.filter(g => g.status === 'scheduled').map(at)),
     v.shown[0].tipoff_at);
  const ats = v.shown.map(at);
  const firstResult = v.shown.findIndex(g => g.status === 'final');
  ok('fixtures soonest first, then the results latest first',
     v.shown.slice(0, firstResult).every((g, i, a) => !i || at(a[i - 1]) <= at(g)) &&
     v.shown.slice(firstResult).every((g, i, a) => !i || at(a[i - 1]) >= at(g)));
  ok('the four results are all there, in the four slots held back for them',
     v.shown.filter(g => g.status === 'final').length === 4 && v.shown.length === 15);
  ok('the header counts the week exactly (4 played, 24 to come), not 400',
     v.note === '4 results · 24 upcoming', v.note);
  ok('the results are counted as played this week, not as fixtures',
     v.recent === 4 && v.soon === 24);
}

console.log('\nresults');
{
  const res = run(SEASON, G.queries('results', NOW));
  const v = G.pick(collect(res), 'results', NOW, totalsOf(res));
  ok('only results, latest first', v.shown.length === 4 && v.shown.every(g => g.status === 'final') &&
     v.shown.every((g, i, a) => !i || at(a[i - 1]) >= at(g)));
  ok('the header says so', v.note === '4 results', v.note);
  ok('it does not read the fixtures at all', !('next' in res));
}

console.log('\nupcoming');
{
  const res = run(SEASON, G.queries('upcoming', NOW));
  const v = G.pick(collect(res), 'upcoming', NOW, totalsOf(res));
  ok('sixty fixtures, soonest first, none of them results',
     v.shown.length === 60 && v.shown.every(g => g.status === 'scheduled') &&
     v.shown.every((g, i, a) => !i || at(a[i - 1]) <= at(g)) && at(v.shown[0]) > NOW);
  ok('the header counts every fixture still to come, not the sixty shown',
     v.note === '776 upcoming', v.note);
  ok('it does not read the results at all', !('done' in res));
}

/* ---- a live game is never lost in a long fixture list ------------------------------------- */
console.log('\nlive, finalising and late games');
{
  const rows = SEASON.concat([game('2026-09-24T10:30:00Z', 'live', { home_score: 41, away_score: 39 })]);
  const res = run(rows, G.queries('week', NOW));
  const v = G.pick(collect(res), 'week', NOW, totalsOf(res));
  ok('a live game is the first row, and the header says so', v.shown[0].status === 'live' && v.note === '1 live now', v.note);

  const fin = game('2026-09-24T08:00:00Z', 'finalising', { home_score: 88, away_score: 84 });
  const v2 = G.pick(collect(run(SEASON.concat([fin]), G.queries('week', NOW))), 'week', NOW, null);
  ok('a game being written up counts as a result, not a fixture',
     v2.shown.some(g => g.id === fin.id) && v2.recent === 5);

  const late = game('2026-09-24T10:00:00Z', 'scheduled');            // tipped two hours ago, not flagged live yet
  const stale = game('2026-09-24T03:00:00Z', 'scheduled');           // nine hours ago: not current any more
  const v3 = G.pick(collect(run(SEASON.concat([late, stale]), G.queries('week', NOW))), 'week', NOW, null);
  ok('a fixture whose tip-off has just passed is still on the page, first',
     v3.shown[0].id === late.id, v3.shown[0].id);
  ok('...but one nine hours stale is not', !v3.shown.some(g => g.id === stale.id));

  /* a quiet week (six fixtures) so the fifteen rows have room: in a full week the mis-dated
     game is still counted in the header ("1 dated ahead") but is the first thing the cap drops */
  const inWeek = g => g.status === 'scheduled' && at(g) <= NOW + 7 * 86400000;
  const keep = new Set(SEASON.filter(inWeek).slice(0, 6).map(g => g.id));
  const quiet = SEASON.filter(g => !inWeek(g) || keep.has(g.id));
  const ahead = game('2027-02-01T12:00:00Z', 'final', { home_score: 1, away_score: 0 });   // a mis-dated result
  const res4 = run(quiet.concat([ahead]), G.queries('week', NOW));
  const v4 = G.pick(collect(res4), 'week', NOW, totalsOf(res4));
  ok('a finished game dated ahead rides at the end and is not counted as played this week',
     v4.shown[v4.shown.length - 1].id === ahead.id && v4.recent === 4 && /1 dated ahead$/.test(v4.note), v4.note);
}

/* ---- a week with nothing in it ------------------------------------------------------------- */
console.log('\nan empty week');
{
  const off = SEASON.filter(g => Math.abs(at(g) - NOW) > 7 * 86400000);
  const res = run(off, G.queries('week', NOW));
  const v = G.pick(collect(res), 'week', NOW, totalsOf(res));
  ok('nothing is shown, rather than a January game standing in for the week', v.shown.length === 0 && v.note === '');
  const e = read_(off, G.after(NOW)).rows;
  ok('what lies beyond it is one read: the next game after the week, so the page can say when',
     e.length === 1 && at(e[0]) > NOW + 7 * 86400000 &&
     at(e[0]) === Math.min(...off.filter(g => g.status === 'scheduled' && at(g) > NOW + 7 * 86400000).map(at)));
}

/* ---- a league too big for any window ------------------------------------------------------- */
console.log('\na busy league');
{
  const rows = [];
  for (let i = 0; i < 1500; i++) rows.push(game(new Date(Date.parse('2026-09-01T00:00:00Z') + i * 5 * 3600000).toISOString(),
    Date.parse('2026-09-01T00:00:00Z') + i * 5 * 3600000 <= NOW ? 'final' : 'scheduled'));
  const res = run(rows, G.queries('week', NOW));
  const v = G.pick(collect(res), 'week', NOW, totalsOf(res));
  const inWeek = rows.filter(g => at(g) >= NOW - 7 * 86400000 && at(g) <= NOW && g.status === 'final').length;
  const ahead = rows.filter(g => at(g) >= NOW - 6 * 3600000 && at(g) <= NOW + 7 * 86400000 && g.status === 'scheduled').length;
  ok('the header counts the whole week even though only fifteen rows are read', v.recent === inWeek && v.soon === ahead && v.shown.length === 15,
     v.recent + '/' + inWeek + ' ' + v.soon + '/' + ahead);
  ok('no read is unbounded', Object.values(G.queries('results', NOW)).concat(Object.values(G.queries('upcoming', NOW)))
     .every(q => /&limit=\d+/.test(q)));
}

/* ---- the page uses it -------------------------------------------------------------------- */
console.log('\nthe page');
{
  const home = read('epinoia', 'home.js');
  ok('home.js reads through the module and no longer takes "the newest 400"',
     /EpinoiaGamesList/.test(home) && !/limit=400\b/.test(home) && !/order=tipoff_at\.desc&limit=400\b/.test(home));
  ok('...the module is loaded before home.js on the league page',
     (() => { const h = read('epinoia', 'index.html'); const a = h.indexOf('gameslist.js'), b = h.indexOf('home.js?'); return a > 0 && b > a; })());
  ok('a finalising game is asked for as a result', /status=in\.\(final,finalising\)/.test(read('epinoia', 'gameslist.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
