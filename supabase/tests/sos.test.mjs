/* ============================================================================
   STRENGTH OF SCHEDULE — the league page's tab is index_9's, number for number.

   epinoia/sos.js is a port of index_9.html's SOS tab. A port that drifts is worse
   than none: the analyzer and the league page would rank the same league
   differently and neither would say so. So index_9's own code is RUN here: the
   computation is lifted out of index_9.html between two fixed lines, fed the same
   league as sos.js, and every number of every team has to agree, under all four
   filters. Then the parts that are EPINOIA's own (reading a season's rows, how
   often clubs meet, the page wiring) and the navigation label.

     node supabase/tests/sos.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);

globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
const SOS = require(path.join(ROOT, 'epinoia', 'sos.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };

/* ---- index_9's computation, lifted ------------------------------------------ */
const index9 = rd('index_9.html');
const tabAt = index9.indexOf("activeTab === 'sos' && teamTotalsData.length > 0 && (() => {");
const START = 'const allGameResults = new Map();';
const END = 'teamRatings.sort((a, b) => b.adjNet - a.adjNet);';
const from = index9.indexOf(START, tabAt);
const to = index9.indexOf(END, from);
ok('index_9 still has its SOS tab, where this test expects it', tabAt > 0 && from > tabAt && to > from,
   'tab ' + tabAt + ', start ' + from + ', end ' + to);
const index9Sos = new Function('teamTotalsData', 'excludedTeams', 'sosFilterType', 'sosDateStart',
  'sosDateEnd', 'sosLastNGames', 'sosGameStart', 'sosGameEnd', 'sosAdjustedFFRef', 'sosEloRef',
  'sosAdjRatingsRef',
  index9.slice(from, to + END.length) +
  '\nreturn { teamRatings, leagueAvg, processedGames, totalGames, minDate, maxDate };');

/* ---- one league, made the same way for both --------------------------------- */
let seed = 20260923;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
function side() {
  const fga = between(55, 75), fg3a = between(16, 32);
  const fg3m = Math.round(fg3a * (0.28 + rnd() * 0.14));
  const fg2m = Math.round((fga - fg3a) * (0.42 + rnd() * 0.16));
  const fta = between(10, 30), ftm = Math.round(fta * (0.62 + rnd() * 0.2));
  const oreb = between(6, 15), dreb = between(22, 33), tov = between(8, 19);
  const s = { fgm: fg2m + fg3m, fga, fg3m, fg3a, ftm, fta, oreb, dreb, tov };
  s.pts = 2 * fg2m + 3 * fg3m + ftm;
  s.poss = Math.round((fga - oreb + tov + 0.44 * fta) * 10) / 10;
  return s;
}
const TEAMS = ['Riders', 'Lions', 'Eagles', 'Rocks', 'Pirates', 'Giants', 'Phoenix', 'Knights'];
const games = [];
let day = 0;
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < TEAMS.length; i++) {
    for (let j = i + 1; j < TEAMS.length; j++) {
      const a = round ? TEAMS[j] : TEAMS[i], b = round ? TEAMS[i] : TEAMS[j];
      const da = side(), db = side();
      if (da.pts === db.pts) { da.ftm += 1; da.fta += 1; da.pts += 1; }
      const d = new Date(Date.UTC(2026, 0, 1 + day++));
      const date = d.toISOString().slice(0, 10);
      games.push({ gameId: 'g' + day, date, ts: Date.parse(date + 'T12:00:00Z'), teams: [a, b], data: { [a]: da, [b]: db } });
    }
  }
}
const rows = [];
games.forEach(g => g.teams.forEach(t => {
  const s = g.data[t];
  rows.push({ game_id: g.gameId, team: t, game_date: g.date, points: String(s.pts), fgm: s.fgm, fga: s.fga,
              fg3m: s.fg3m, fg3a: s.fg3a, ftm: s.ftm, fta: s.fta, oreb: s.oreb, dreb: s.dreb, tov: s.tov, poss: s.poss });
}));
console.log('\nsos.js against index_9, on ' + games.length + ' games between ' + TEAMS.length + ' clubs');

const NUMERIC = r => Object.keys(r).filter(k => typeof r[k] === 'number');
function agree(label, i9opts, mineOpts) {
  const ref = { current: null };
  const A = index9Sos(rows, [], i9opts.type, i9opts.ds || '', i9opts.de || '', i9opts.n || 10,
                      i9opts.gs || 1, i9opts.ge || 20, ref, ref, ref);
  const B = SOS.compute(games, Object.assign({ meetings: 4 }, mineOpts));
  const sameShape = A.teamRatings.length === B.rows.length && A.processedGames.length === B.games &&
    A.totalGames === B.totalGames && A.minDate === B.minDate && A.maxDate === B.maxDate;
  ok(label + ': the same games and the same teams', sameShape,
     A.teamRatings.length + '/' + B.rows.length + ' teams, ' + A.processedGames.length + '/' + B.games + ' games');
  let worst = 0, where = '';
  A.teamRatings.forEach((a, i) => {
    const b = B.rows[i];
    if (!b || b.key !== a.name) { worst = Infinity; where = 'order at ' + i + ': ' + a.name + ' vs ' + (b && b.key); return; }
    NUMERIC(a).forEach(k => {
      const d = Math.abs(a[k] - b[k]);
      if (!(d <= worst)) { worst = d; where = a.name + '.' + k + ' ' + a[k] + ' vs ' + b[k]; }
    });
  });
  ok(label + ': every number of every team agrees', worst <= 1e-9, 'worst ' + worst + ' at ' + where);
  const la = Object.keys(A.leagueAvg).every(k => Math.abs(A.leagueAvg[k] - B.leagueAvg[k]) <= 1e-12);
  ok(label + ': the league averages agree', la);
  /* index_9 works the per-factor points added out in its table; sos.js carries them on the row */
  const P = { efg: 2.0, tovPct: 1.4, orebPct: 0.7, ftRate: 0.4 };
  const paOk = A.teamRatings.every((a, i) => {
    const b = B.rows[i], L = A.leagueAvg;
    return Math.abs(b.offEfgPA - (a.offEfg - L.efg) * P.efg) <= 1e-9 &&
           Math.abs(b.offTovPA - (L.tovPct - a.offTovPct) * P.tovPct) <= 1e-9 &&
           Math.abs(b.offOrebPA - (a.offOrebPct - L.orebPct) * P.orebPct) <= 1e-9 &&
           Math.abs(b.offFtrPA - (a.offFtRate - L.ftRate) * P.ftRate) <= 1e-9;
  });
  ok(label + ': the points added by each factor are index_9’s', paOk);
  return B;
}
const all = agree('all games', { type: 'all' }, { filter: 'all' });
agree('last 20 games', { type: 'lastN', n: 20 }, { filter: 'lastN', lastN: 20 });
agree('games 9 to 40', { type: 'gameRange', gs: 9, ge: 40 }, { filter: 'gameRange', gameStart: 9, gameEnd: 40 });
agree('a date range', { type: 'dateRange', ds: '2026-01-10', de: '2026-02-05' },
      { filter: 'dateRange', dateStart: '2026-01-10', dateEnd: '2026-02-05' });

ok('the schedule measures ignore the filter, as index_9’s do',
   SOS.compute(games, { filter: 'lastN', lastN: 5 }).rows.every(r => {
     const full = all.rows.find(x => x.key === r.key);
     return full && Math.abs(full.sosNetRtg - r.sosNetRtg) < 1e-12;
   }));
{
  const two = SOS.compute(games, { meetings: 2 });
  const r = two.rows[0];
  ok('the projected record follows the meetings per pair', r.seasonLength === 14 &&
     r.projectedWins + r.projectedLosses === 14 && all.rows[0].seasonLength === 28,
     r.seasonLength + ' / ' + all.rows[0].seasonLength);
  ok('four meetings is the fallback when none is given',
     SOS.compute(games, {}).rows[0].seasonLength === 28);
}

/* ---- a season's rows into the engine's games -------------------------------- */
console.log('\nreading a season');
{
  const tl = (pts, extra) => ({ adv: Object.assign({ pts, fgm: 30, fga: 65, fg3m: 8, fg3a: 24, ftm: 14,
    fta: 18, oreb: 9, dreb: 27, tov: 12, possessions: 70 }, extra || {}) });
  const S = {
    games: [
      { id: 'a', home_team_id: 'H', away_team_id: 'V', home_score: 82, away_score: 79, tipoff_at: '2026-03-07T19:30:00Z' },
      { id: 'b', home_team_id: 'V', away_team_id: 'H', home_score: null, away_score: null, tipoff_at: '2026-03-14T19:30:00Z' },
      { id: 'c', home_team_id: 'H', away_team_id: 'X', home_score: 70, away_score: 60, tipoff_at: '2026-03-21T19:30:00Z' }
    ],
    tgs: [
      { game_id: 'a', team_idx: 0, stats: tl(81) }, { game_id: 'a', team_idx: 1, stats: tl(79) },
      { game_id: 'b', team_idx: 0, stats: tl(90, { possessions: 0 }) }, { game_id: 'b', team_idx: 1, stats: tl(88) },
      { game_id: 'c', team_idx: 0, stats: tl(70) }
    ]
  };
  const L = SOS.gameLines(S);
  ok('a game needs both sides’ lines', L.length === 2 && !L.some(g => g.gameId === 'c'));
  ok('the official score is each side’s points', L[0].data.H.pts === 82 && L[0].data.V.pts === 79);
  ok('...and the box score stands in when there is no official score', L[1].data.V.pts === 90);
  ok('possessions are the line’s own', L[0].data.H.poss === 70);
  ok('...or counted the way season.js counts them',
     Math.abs(L[1].data.V.poss - globalThis.EpinoiaSeason.POSS(65, 18, 12, 9)) < 1e-12);
  ok('the home side is listed first', L[0].teams[0] === 'H' && L[1].teams[0] === 'V');
  const d = new Date('2026-03-07T19:30:00Z');
  const want = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  ok('the date is the tip-off’s calendar day where the page is read', L[0].date === want && L[0].ts === d.getTime());
  ok('nothing to read is no games, not an error', SOS.gameLines(null).length === 0 && SOS.gameLines({ games: [] }).length === 0);
}

/* ---- how often clubs meet ----------------------------------------------------- */
console.log('\nhow often each pair of clubs meets');
{
  const fx = [];
  const T = ['a', 'b', 'c', 'd'];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    fx.push(r ? { home_team_id: T[j], away_team_id: T[i] } : { home_team_id: T[i], away_team_id: T[j] });
  }
  ok('a double round-robin meets twice', SOS.meetingsFrom(fx) === 2);
  ok('...and a cup tie on top does not change that',
     SOS.meetingsFrom(fx.concat([{ home_team_id: 'a', away_team_id: 'b' }])) === 2);
  ok('four meetings each is four', SOS.meetingsFrom(fx.concat(fx)) === 4);
  ok('no fixture list is no answer, so the fallback applies', SOS.meetingsFrom([]) === null && SOS.meetingsFrom(null) === null);
  ok('a club drawn against itself is ignored', SOS.meetingsFrom([{ home_team_id: 'a', away_team_id: 'a' }]) === null);
}

/* ---- the percentile the cells are coloured by --------------------------------- */
console.log('\nthe colouring');
{
  const pool = [1, 2, 3, 4];
  ok('the share of the league below the value', SOS.percentile(3, pool, true) === 50 && SOS.percentile(5, pool, true) === 100);
  ok('...turned round when lower is better', SOS.percentile(1, pool, false) === 100);
  ok('the heat scale is the Statistics table’s, not a copy of it',
     /root\.EpinoiaTable && root\.EpinoiaTable\.heatStyle/.test(rd('epinoia', 'sos.js')));
}

/* ---- one conference at a time, and no other site's name ---------------------- */
console.log('\none conference, and nobody else’s name');
{
  const R = SOS.compute(games, { meetings: 4 });
  const two = new Set(['Riders', 'Lions']);
  const shown = SOS.visible(R.rows, k => two.has(k));
  ok('a conference view shows its own clubs and nobody else',
     shown.length === 2 && shown.every(r => two.has(r.key)));
  ok('...with the numbers worked out over every game in scope, not re-worked for the conference',
     shown.every(r => r === R.rows.find(x => x.key === r.key)));
  ok('no filter shows every club', SOS.visible(R.rows, null) === R.rows);
  const src = rd('epinoia', 'sos.js');
  const named = ['KenPom', 'Basketball-Reference', 'Basketball Reference', 'FiveThirtyEight', 'Squared Statistics',
                 'Bill James', 'Synergy', 'Cleaning the Glass', 'Barttorvik', 'BBRef']
    .filter(n => src.toLowerCase().includes(n.toLowerCase()));
  ok('the tab names no other site, on the page or in its code', named.length === 0, named.join(', '));
  ok('...and has no methodology-and-sources section', !/methodology/i.test(src) && !/sos-method/.test(rd('epinoia', 'kit', 'sos.css')));
  ok('the cells are coloured among the clubs shown', /pools\[k\] = shown\.map\(/.test(src) &&
     /coloured by percentile rank among the teams shown/.test(src));
}

/* ---- the page ----------------------------------------------------------------- */
console.log('\nthe Table page and the navigation');
const html = rd('epinoia', 'l', 'index.html');
const league = rd('epinoia', 'l', 'league.js');
const nav = rd('epinoia', 'nav.js');
const navCss = rd('epinoia', 'kit', 'nav.css');
ok('the Table page has a Strength of Schedule tab',
   /<button class="ep-tab" data-p="sos" role="tab">Strength of Schedule<\/button>/.test(html));
ok('...with a pane of its own', /<div class="pane" id="pane-sos"><\/div>/.test(html));
ok('...its script loads before the page’s own', html.indexOf('../sos.js?v=') > 0 &&
   html.indexOf('../sos.js?v=') < html.indexOf('league.js?v='));
ok('...and its styles are on the page', /href="\.\.\/kit\/sos\.css\?v=\d+"/.test(html));
ok('the tab is drawn when it is first opened, not on every visit to the table',
   /if \(name === 'sos' && !sosShown\)/.test(league) && /sosShown \? renderSOS\(\) : null/.test(league));
ok('...from the same season read as the team statistics, under the same scope control',
   /async function renderSOS\(\)[\s\S]*?loadSeason\(\)[\s\S]*?scopePicker\(bar, renderSOS\)/.test(league));
ok('...with the meetings per pair read from the fixture list',
   /meetingsFrom\(/.test(league) && /select=home_team_id,away_team_id/.test(league));
/* the label as the browser gets it: the string literal from nav.js, evaluated */
const labelSrc = nav.match(/\{ href: 'l\/',\s+ic: '[^']+', tx: ('Table[^']*'), two: true, lg: true, key: 'table',/);
const label = labelSrc ? Function('return ' + labelSrc[1])() : null;
ok('the rail and the phone bar call the page Table / Team Stats',
   label != null && label.replace(/\s/g, ' ') === 'Table / Team Stats', String(label));
ok('...with "Team Stats" held together by a no-break space, written as an escape, never an invisible character',
   label != null && label.charCodeAt(12) === 160 && /Team\\xa0Stats/.test(labelSrc[1]));
ok('...a label that may take two lines, in the rail and in the phone bar, rather than being cut off',
   /if \(it\.two\) a\.classList\.add\('two-line'\);/.test(nav) &&
   /if \(spec\.two\) \{ a\.classList\.add\('two-line'\); tabbar\.classList\.add\('fit'\); \}/.test(nav) &&
   /\.ep-nav a\.item\.two-line\{ white-space:normal \}/.test(navCss) &&
   /\.ep-tabbar a\.two-line \.tx\{ white-space:normal;[^}]*width:min-content \}/.test(navCss));
ok('...and the phone bar’s tabs take their labels’ widths while it carries one',
   /tabbar\.classList\.remove\('fit'\);/.test(nav) && /\.ep-tabbar\.fit a\{ flex:1 1 auto \}/.test(navCss));
ok('a tab opened out of sight on a narrow screen is scrolled into it, sideways only',
   /function revealTab\(btn\)/.test(league) && /revealTab\(btn\);/.test(league) && !/scrollIntoView/.test(league));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
