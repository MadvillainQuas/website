/* ============================================================================
   THE INJURY REPORT / WAIVER WIRE — epinoia/injuries.js, read without a browser.

   Nobody files an injury list, so the report is worked out from the box scores,
   and every judgement it makes has to be held somewhere:

     1. the thresholds: who counts as "was playing", and who is just a squad
        number whose absence is not news
     2. OUT (no row) and DNP (a row, nought minutes) are both absences, and the
        report says which
     3. it judges on the games BEFORE the absence — a month out must not talk a
        regular out of being a regular
     4. it resolves itself: play a minute and you are gone from it
     5. a transfer is not an injury, and neither is a release
     6. a finalising game is not a finished one
     7. the order, the staleness cap, the preview's slice and the wording

     node supabase/tests/injuries.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const I = require(path.join(ROOT, 'epinoia', 'injuries.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

/* ------------------------------------------------------------- the fixture ---
   One club (A) playing N games against B, one a week. Each player is given a
   list of minutes, one per game of A's: a number is minutes played, 0 is a DNP
   (on the sheet, did not play) and null is not on the sheet at all. */
const A = 'team-a', B = 'team-b', C = 'team-c';
const day = n => '2026-01-' + String(n).padStart(2, '0') + 'T19:00:00Z';

function season(minutesByPlayer, o) {
  const opt = o || {};
  const n = Math.max(...Object.values(minutesByPlayer).map(v => v.length));
  const games = [];
  for (let i = 0; i < n; i++) {
    games.push({ id: 'g' + (i + 1), tipoff_at: day(i + 1), status: (opt.status || [])[i] || 'final',
      home_team_id: i % 2 ? B : A, away_team_id: i % 2 ? A : B });
  }
  const pgs = [];
  Object.keys(minutesByPlayer).forEach(p => {
    minutesByPlayer[p].forEach((m, i) => {
      if (m == null) return;                       // not on the sheet
      const g = games[i];
      pgs.push({ game_id: g.id, player_uuid: p, team_idx: g.home_team_id === A ? 0 : 1,
                 stats: { min: m * 60000 } });     // the box stores milliseconds
    });
  });
  (opt.extraPgs || []).forEach(r => pgs.push(r));
  (opt.extraGames || []).forEach(g => games.push(g));
  return { games, pgs };
}
const run = (mins, o) => {
  const s = season(mins, o);
  return I.report({ games: s.games, pgs: s.pgs, released: (o && o.released) || [], opts: (o && o.opts) });
};
const of = (rep, p) => rep.entries.find(e => e.playerId === p) || null;

/* --------------------------------------------------------- 1. who counts --- */
console.log('\n1. who counts as "was playing"');
{
  const rep = run({
    /* 30 minutes a game and then gone: the clearest case there is */
    starter:  [30, 32, 28, 31, null, null],
    /* eighteen a game, sixteen last time out: a rotation player, not a starter */
    rotation: [18, 17, 16, 16, null, null],
    /* twelve a game but in every one of them: a regular by how often, not how long */
    regular:  [12, 11, 13, 10, null, null],
    /* four minutes in three of six: a squad number. His absence is not news. */
    scrub:    [4, null, 5, null, 3, null],
    /* two games at twenty-four minutes: a short spell, but the club was playing him */
    newSigning: [22, 24, null, null, null, null],
    /* one appearance is nothing to establish anything from */
    oneOff:   [26, null, null, null, null, null]
  });
  eq('the starter, the rotation player, the regular and the new signing are reported',
     rep.entries.map(e => e.playerId).sort(), ['newSigning', 'regular', 'rotation', 'starter']);
  eq('two appearances are enough when the minutes say he was being played',
     [I.MIN_GP, of(rep, 'newSigning').gp, of(rep, 'newSigning').reason], [2, 2, 'starter']);
  ok('one is not', !of(rep, 'oneOff'));
  eq('and each is told why', ['starter', 'rotation', 'regular'].map(p => of(rep, p).reason),
     ['starter', 'rotation', 'regular']);
  ok('a squad number is not an injury story', !of(rep, 'scrub'));
  ok('...even though he turned out often enough: four minutes a game is being available, not being played',
     of(rep, 'scrub') === null && I.REGULAR_MPG === 8 &&
     run({ scrub: [9, null, 9, null, 9, null] }).entries.length === 1);
  eq('the number of club games missed', of(rep, 'starter').missed, 2);
  eq('what he was doing before he stopped', [of(rep, 'starter').mpg, of(rep, 'starter').lastMin, of(rep, 'starter').gp],
     [30.3, 31, 4]);
  eq('and when he last played', of(rep, 'starter').lastPlayedAt, day(4));
  eq('and the first game he missed', of(rep, 'starter').sinceGameId, 'g5');
}

/* --------------------------------------------------------- 2. out and dnp --- */
console.log('\n2. out of the squad, and in it without playing');
{
  const rep = run({
    hurt:    [30, 30, 30, 30, null, null],   // not on the sheet
    benched: [30, 30, 30, 30, 0, 0],         // on the sheet, nought minutes
    other:   [20, 20, 20, 20, 20, 20]
  });
  ok('a player on the sheet with nought minutes is reported too', !!of(rep, 'benched'));
  eq('...and is marked as a DNP rather than as out', of(rep, 'benched').dnp, true);
  eq('somebody not on the sheet at all is out, not a DNP', of(rep, 'hurt').dnp, false);
  eq('both have missed the same two games', [of(rep, 'hurt').missed, of(rep, 'benched').missed], [2, 2]);
  ok('the player who kept playing is not in the report', !of(rep, 'other'));
}

/* ----------------------------------------------- 3. judged before the gap --- */
console.log('\n3. the absence must not answer the question about itself');
{
  /* 28 minutes a game for four, then out for eight. Over the season that is
     9.3 minutes a game — under every line — but he is a 28-minute starter. */
  const rep = run({ hurt: [28, 28, 28, 28, null, null, null, null, null, null, null, null] });
  const e = of(rep, 'hurt');
  ok('a long absence does not talk a starter out of being one', !!e && e.reason === 'starter');
  eq('the minutes are his, over the games he played', e.mpg, 28);
  eq('and the season-long average is never used', Math.round((28 * 4 / 12) * 10) / 10, 9.3);
  eq('missing eight of the club\'s games is long-term', [e.missed, e.stale], [8, false]);
  const long = of(run({ hurt: [28, 28, 28, 28].concat(Array(10).fill(null)) }), 'hurt');
  eq('...and ten of them is', [long.missed, long.stale], [10, true]);
  ok('the threshold is named, not buried', I.STALE_GAMES === 10);
}

/* --------------------------------------------------------- 4. it resolves --- */
console.log('\n4. playing again resolves it, with nothing to clear');
{
  const away = run({ hurt: [30, 30, 30, 30, null, null] });
  ok('missing the last two games: reported', !!of(away, 'hurt'));
  const back = run({ hurt: [30, 30, 30, 30, null, 22] });
  ok('back for the most recent one: gone from the report, no flag to clear', !of(back, 'hurt'));
  const oneMinute = run({ hurt: [30, 30, 30, 30, null, 1] });
  ok('one minute is enough — the question was whether he played', !of(oneMinute, 'hurt'));
  const stillOut = run({ hurt: [30, 30, 30, 30, 20, null] });
  eq('a player back for one game and out again is missing one, not two',
     of(stillOut, 'hurt').missed, 1);
  eq('...and is judged on the game he came back for', of(stillOut, 'hurt').lastMin, 20);
}

/* ------------------------------------------------ 5. transfers and releases --- */
console.log('\n5. a transfer is not an injury, and neither is a release');
{
  /* he leaves A after game 4 and turns out for C in game 5's week */
  const moved = run({ gone: [30, 30, 30, 30, null, null] }, {
    extraGames: [{ id: 'gc', tipoff_at: day(5), status: 'final', home_team_id: C, away_team_id: B }],
    extraPgs: [{ game_id: 'gc', player_uuid: 'gone', team_idx: 0, stats: { min: 25 * 60000 } }]
  });
  ok('a player who has turned out for somebody else since is transferred, not missing',
     !of(moved, 'gone'));
  const before = run({ gone: [30, 30, 30, 30, null, null] }, {
    extraGames: [{ id: 'gc', tipoff_at: day(2), status: 'final', home_team_id: C, away_team_id: B }],
    extraPgs: [{ game_id: 'gc', player_uuid: 'gone', team_idx: 0, stats: { min: 25 * 60000 } }]
  });
  ok('...but a game for another club BEFORE he came here proves nothing', !!of(before, 'gone'));

  const mins = { hurt: [30, 30, 30, 30, null, null], other: [25, 25, 25, 25, null, null] };
  eq('both are reported before anybody is released',
     run(mins).entries.map(e => e.playerId).sort(), ['hurt', 'other']);
  eq('a release by this club removes that player and nobody else',
     run(mins, { released: [{ team_id: A, player_id: 'hurt' }] }).entries.map(e => e.playerId), ['other']);
  eq('a release by a DIFFERENT club leaves him alone',
     run(mins, { released: [{ team_id: C, player_id: 'hurt' }] }).entries.map(e => e.playerId).sort(),
     ['hurt', 'other']);
  eq('a release with no club at all takes him off every wire',
     run(mins, { released: [{ player_id: 'hurt' }] }).entries.map(e => e.playerId), ['other']);
  eq('the table\'s own rows and a set of keys are the same thing',
     [...I.releasedSet([{ team_id: A, player_id: 'p' }])], ['team-a|p']);
}

/* ------------------------------------------------------ 6. finished games --- */
console.log('\n6. a game still being entered is not a game');
{
  /* g5 and g6 are 'finalising': half an entered box makes a whole squad look absent */
  const rep = run({ hurt: [30, 30, 30, 30, null, null] },
    { status: [null, null, null, null, 'finalising', 'finalising'] });
  ok('nobody is missing from a game nobody has finished entering', !of(rep, 'hurt'));
  eq('the timeline only holds the finished ones',
     I.timeline([{ id: 'a', status: 'final' }, { id: 'b', status: 'finalising' },
                 { id: 'c', status: 'live' }, { id: 'd' }]).map(g => g.id), ['a', 'd']);
  eq('and it is in the order they were played',
     I.timeline([{ id: 'b', tipoff_at: day(2) }, { id: 'a', tipoff_at: day(1) }]).map(g => g.id),
     ['a', 'b']);
}

/* ------------------------------------- 7. order, the preview and the words --- */
console.log('\n7. the order, the preview\'s slice and the wording');
{
  const rep = run({
    fresh: [30, 30, 30, 30, 30, null],                     // out of the last one
    older: [30, 30, 30, null, null, null],                 // out of the last three
    small: [16, 16, 16, 16, 16, null]                      // out of one, but less of a loss
  });
  eq('the freshest absence first, and the bigger loss above the smaller',
     rep.entries.map(e => e.playerId), ['fresh', 'small', 'older']);
  eq('every one of them is this club\'s', [...rep.byTeam.keys()], [A]);
  eq('and byTeam keeps that order', rep.byTeam.get(A).map(e => e.playerId), ['fresh', 'small', 'older']);
  ok('a club with nobody missing is not in byTeam at all', !rep.byTeam.has(B));

  const pv = I.forPreview(rep, A, 2);
  eq('a preview takes the biggest losses, worst first', pv.map(e => e.playerId), ['fresh', 'older']);
  eq('and no more than it asked for', pv.length, 2);
  eq('an unknown club has nobody missing rather than an error', I.forPreview(rep, 'nobody'), []);

  const stale = run({ old: [30, 30, 30, 30].concat(Array(10).fill(null)) });
  eq('a long-term absence stays on the wire', stale.entries.length, 1);
  eq('...and off the preview, which is about this game', I.forPreview(stale, A), []);

  ok('the wording says what happened and what it costs',
     I.line(of(rep, 'fresh')) === 'out for the last game · 30 minutes last time out', I.line(of(rep, 'fresh')));
  ok('a DNP is not called "out"',
     /^did not play for the last 2 games/.test(I.line(of(run({ b: [30, 30, 30, 30, 0, 0] }), 'b'))));
  ok('a rotation player is measured in minutes a game',
     /17 minutes a game$/.test(I.line(of(run({ r: [18, 17, 16, 17, null] }), 'r'))), I.line(of(run({ r: [18, 17, 16, 17, null] }), 'r')));
  /* A SHARE IS NOT A SENTENCE: "100% of the club's games" is true of a player who has turned
     out twice and says nothing about him. The two numbers behind it do. */
  ok('a regular is measured in how often he turned out, and in what he did when he did',
     /4 of the club’s last 4, 11\.5 minutes a game$/.test(I.line(of(run({ g: [12, 11, 13, 10, null] }), 'g'))),
     I.line(of(run({ g: [12, 11, 13, 10, null] }), 'g')));
  eq('...over the club\'s games since his first, not since the season\'s',
     (e => [e.gp, e.since])(of(run({ late: [null, null, 12, 11, 13, null] }), 'late')), [3, 3]);
  ok('long-term is said so when a caller asks for it',
     / · long-term$/.test(I.line(of(stale, 'old'), { stale: true })));
}

/* --------------------------------------------------------------- 8. edges --- */
console.log('\n8. nothing to report');
{
  const empty = I.report({});
  eq('no games at all: an empty report, not a crash', [empty.entries.length, empty.byTeam.size], [0, 0]);
  eq('games but no box scores', I.report({ games: season({ x: [1] }).games, pgs: [] }).entries.length, 0);
  ok('a row with no player is ignored', I.report({ games: season({ x: [30, 30, 30, null] }).games,
     pgs: [{ game_id: 'g1', team_idx: 0, stats: { min: 1 } }] }).entries.length === 0);
  ok('a row for a game that is not in the timeline is ignored',
     I.report({ games: season({ x: [30, 30, 30, null] }).games,
       pgs: [{ game_id: 'nope', player_uuid: 'x', team_idx: 0, stats: { min: 1 } }] }).entries.length === 0);
  ok('the thresholds can be moved by a league that wants them elsewhere',
     run({ p: [30, 30, null] }).entries.length === 1 &&
     run({ p: [30, 30, null] }, { opts: { MIN_GP: 3 } }).entries.length === 0);
  eq('player_id does for a league whose players have no uuid yet',
     I.report({ games: season({ x: [30, 30, 30, 30, null] }).games,
       pgs: season({ x: [30, 30, 30, 30, null] }).pgs.map(r =>
         ({ game_id: r.game_id, player_id: r.player_uuid, team_idx: r.team_idx, stats: r.stats }))
     }).entries.map(e => e.playerId), ['x']);
}

/* ------------------------------------------------- 9. the game preview's --- */
console.log('\n9. INJURY REPORT on a game preview');
{
  const P = require(path.join(ROOT, 'epinoia', 'game', 'preview.js'));
  const base = { nameA: 'York', nameB: 'Derby', colourA: '#93f2bf', colourB: '#8ff5ff', leagueSlug: 'bcb' };
  const out = n => ({ name: n, line: 'out for the last 2 games · 30 minutes last time out',
                      dnp: false, stale: false, href: '../p/?p=' + n });

  ok('a fixture with nobody missing gets no section at all',
     P.injuriesHTML(base) === '' && P.injuriesHTML(Object.assign({ outA: [], outB: [] }, base)) === '');
  const one = P.injuriesHTML(Object.assign({ outA: [out('Ada Okafor')], outB: [] }, base));
  ok('one side missing somebody still draws it, and says the other side is fine',
     /id="injuries"/.test(one) && /Ada Okafor/.test(one) && /Nobody missing/.test(one));
  ok('each player is a question mark, not a warning', /class="wr-q" aria-hidden="true">\?</.test(one));
  ok('...and a DNP is a dash instead',
     /class="wr-q" aria-hidden="true">–</.test(
       P.injuriesHTML(Object.assign({ outA: [Object.assign(out('Bea'), { dnp: true })], outB: [] }, base))));
  ok('the row carries what is actually known, not a diagnosis',
     /30 minutes last time out/.test(one) && !/injur(ed|y)\b/i.test(one.replace(/Injury report/g, '')));
  ok('both clubs are named, in their own colours',
     /--pc:#93f2bf/.test(one) && /--pc:#8ff5ff/.test(one) && /York/.test(one) && /Derby/.test(one));
  ok('and it leads to the league\'s whole report', /href="\.\.\/injuries\/\?l=bcb"/.test(one));
  ok('a fixture with no league still links the wire',
     /href="\.\.\/injuries\/"/.test(P.injuriesHTML({ outA: [out('A')], outB: [], nameA: 'a', nameB: 'b' })));
  ok('a player\'s name and his line are escaped — both come from the database',
     (() => {
       const s = P.injuriesHTML(Object.assign({ outB: [],
         outA: [{ name: '<script>x</script>', line: 'out & about', dnp: false, href: '../p/?p="x"' }] }, base));
       return !/<script>x/.test(s) && /&lt;script&gt;/.test(s) && /out &amp; about/.test(s) && !/p="x"/.test(s);
     })());
  ok('the section sits with the starting five, before the rest of the preview', (() => {
    const s = P.render(Object.assign({ outA: [out('Ada')], outB: [out('Bo')] }, base));
    return s.indexOf('id="injuries"') > 0 && s.indexOf('id="injuries"') < s.indexOf('How to get there');
  })());
  ok('a preview with nobody missing is the preview it always was',
     !/id="injuries"/.test(P.render(base)));
}

/* --------------------------------------------------- 10. what is wired up --- */
console.log('\n10. the report reaches the pages that draw it');
{
  const rd = p => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

  const page = rd(['epinoia', 'injuries', 'index.html']);
  ok('the wire page loads the report and the data it needs', ['../injuries.js', '../data.js', '../season.js']
    .every(s => new RegExp('src="' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=\\d+"').test(page)));
  ok('...and the one stylesheet the three places share', /kit\/wire\.css\?v=\d+/.test(page));
  ok('it is public: neither script is loaded', !/src="[^"]*(gate|topnav)\.js/.test(page));
  ok('and the rail is on it, so it is a place in the platform rather than a leaf',
     /nav\.js\?v=\d+/.test(page));

  const wire = rd(['epinoia', 'injuries', 'wire.js']);
  ok('one page, both scopes: a league by ?l=, and every league without it',
     /const SLUG = qp\.get\('l'\) \|\| '';/.test(wire) && /if \(SLUG\) \{/.test(wire));
  ok('every club is listed, so a missing one never reads as "not checked"',
     /Object\.keys\(L\.teams\)/.test(wire) && /full squad/.test(wire));
  ok('the clubs with somebody missing come first', /nb - na \|\|/.test(wire));
  ok('a signed-out reader never loads the SDK to find out they cannot release anybody',
     /epinoiaMaybeSignedIn\(\)\)\) return;/.test(wire));
  ok('which clubs a manager runs is one question, not one per club',
     /rpc\('teams_i_manage'/.test(wire) && !/rpc\('is_team_manager'/.test(wire));

  const data = rd(['epinoia', 'data.js']);
  ok('statsForGames hands back the per-game rows the report needs',
     /return \{ players, teams: teamRows, byId, teamOfPlayer, games, pgs, tgs \};/.test(data));
  ok('and the releases are readable, with an older database answering empty',
     /async function releases\(teamIds\)/.test(data) && /catch \(_\) \{ return \[\]; \}/.test(data) &&
     /releases,/.test(data));

  const game = rd(['epinoia', 'game', 'index.html']);
  ok('the game page loads the report and the shared stylesheet',
     /src="\.\.\/injuries\.js\?v=\d+"/.test(game) && /kit\/wire\.css\?v=\d+/.test(game));
  const gjs = rd(['epinoia', 'game', 'game.js']);
  ok('the preview is given both clubs\' absences', /outA: out\.A, outB: out\.B,/.test(gjs));
  ok('...worked out from the season the page had already read, plus the releases',
     /I\.report\(\{ games: season\.games, pgs: season\.pgs, released \}\)/.test(gjs));
  ok('a database without the releases table is an empty section, not a broken preview',
     /catch \(_\) \{ released = \[\]; \}/.test(gjs));

  const nav = rd(['epinoia', 'nav.js']);
  ok('every league\'s rail has the report', /tx: 'injury report', lg: true, key: 'injuries'/.test(nav));
  ok('and HOME\'s rail has the global wire', /platformRow\('✚', 'injury report', 'injuries\/'/.test(nav));

  const mig = rd(['supabase', 'migrations', '0132_player_releases.sql']);
  ok('the release is one row per club and player', /primary key \(team_id, player_id\)/.test(mig));
  ok('...written only by the club or its league', /public\.is_team_manager\(team_id\)/.test(mig));
  ok('...and readable wherever the league is', /public\.can_view_league\(t\.league_id\)/.test(mig));
  ok('un-releasing deletes the row rather than leaving a flag behind',
     /delete from player_releases where team_id = p_team and player_id = p_player;/.test(mig));

  const prof = rd(['epinoia', 'p', 'player.js']);
  ok('the player\'s own page offers the same button, to whoever manages his club',
     /async function offerRelease\(pl, team\)/.test(prof) && /rpc\('set_player_released'/.test(prof));
  ok('...and it is a toggle, so a player who comes back is put back',
     /p_released: want/.test(prof));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
