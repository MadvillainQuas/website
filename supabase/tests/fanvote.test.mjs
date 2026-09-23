/* ============================================================================
   THE WEEKLY FANS' VOTE (migration 0150, docs/fanvote.md).

   Three things, none of them needing a database:

   1. THE PAGE'S RULES, from epinoia/fanvote.js: the once-a-week rule (when the
      panel opens by itself, and when "remind me later" and "don't show this
      again" keep it shut), where a returning voter starts, and the podium's
      moves (drag, swap, tap) as pure functions of the picks.

   2. THE BALLOT, from the Edge Function's own picker (_shared/fanvote.ts). The
      players have to be the Stars podium's weekly answer: run on the BCB week
      captured for stars.test.mjs, its first ten are the ten the league page
      showed, in the same order, and the rest follow on the same rule. The clubs
      are every club that won, best week first.

   3. THE WIRING, read from the files: fifteen players and no more in 0150, the
      section above the Stars, the nav row, the profile switch, the admin panel,
      the function's config.

     node --experimental-strip-types supabase/tests/fanvote.test.mjs
   ============================================================================ */
process.env.TZ = 'Europe/London';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };
const same = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));

const FV = require(path.join(ROOT, 'epinoia', 'fanvote.js'));
const { playerCandidates, teamCandidates, BALLOT_PLAYERS } =
  await import('../functions/_shared/fanvote.ts');
const { WINDOWS, computeWindow, pick } = await import('../functions/_shared/stars.js');

/* ===================================================== 1. THE PAGE'S RULES === */
console.log('\nthe once-a-week rule');
{
  const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));
  const T = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i }));
  const open = (ballot, np = 15, nt = 4) => ({ round_id: 'r1', players: P(np), teams: T(nt), ballot: ballot || null });
  const NOW = Date.parse('2026-09-22T12:00:00Z');
  const auto = (state, store) => FV.shouldAutoOpen(state, Object.assign({ rounds: {} }, store || {}), NOW);

  ok('the first visit in a round opens it', auto({ open: open() }) === true);
  ok('no round, nothing to open', auto({ open: null }) === false && auto(null) === false);
  ok('a league with the vote switched off never opens it', auto({ open: open(), off: true }) === false);
  ok('an empty ballot never opens it', auto({ open: open(null, 0, 0) }) === false);
  ok('seen once this round: not again by itself', auto({ open: open() }, { rounds: { r1: { shown: true, at: NOW } } }) === false);
  ok('closed with the x: not again by itself', auto({ open: open() }, { rounds: { r1: { closed: true, at: NOW } } }) === false);
  ok('a note on LAST week’s round does not stop this one', auto({ open: open() }, { rounds: { r0: { closed: true, at: NOW } } }) === true);
  ok('"remind me later": shut until the time is up', auto({ open: open() }, { rounds: { r1: { later: NOW + 1000, at: NOW } } }) === false);
  ok('"remind me later": open again once it is', auto({ open: open() }, { rounds: { r1: { later: NOW - 1, at: NOW } } }) === true);
  ok('"remind me later" is six hours', FV.LATER_MS === 6 * 3600 * 1000);
  ok('voted: never again that round',
     auto({ open: open({ players: ['p0', 'p1', 'p2'], team: 't0' }) }) === false);
  ok('"don’t show this again" on a signed-out browser', auto({ open: open() }, { never: true }) === false);
  ok('the account’s switch off outranks the browser', auto({ open: open(), prompt: false }) === false);
  ok('the account’s switch ON outranks an old "never" in the browser (the profile can turn it back on)',
     auto({ open: open(), prompt: true }, { never: true }) === true);
  ok('...but not a note that the round was seen', auto({ open: open(), prompt: true }, { never: true, rounds: { r1: { shown: true, at: NOW } } }) === false);
}

console.log('\nvoted, and where a returning voter starts');
{
  const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));
  const T = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i }));
  const o = (ballot, np = 15, nt = 4) => ({ players: P(np), teams: T(nt), ballot });
  ok('no ballot: not voted', FV.fullyVoted(o(null)) === false);
  ok('three players and a club: voted', FV.fullyVoted(o({ players: ['a', 'b', 'c'], team: 't0' })) === true);
  ok('three players and the club skipped: voted', FV.fullyVoted(o({ players: ['a', 'b', 'c'], skipped: true })) === true);
  ok('three players, club not yet: not voted', FV.fullyVoted(o({ players: ['a', 'b', 'c'] })) === false);
  ok('three players and no club won (none to pick): voted', FV.fullyVoted(o({ players: ['a', 'b', 'c'] }, 15, 0)) === true);
  ok('two players on a ballot of two: voted', FV.fullyVoted(o({ players: ['a', 'b'], team: 't0' }, 2)) === true);
  ok('two players on a ballot of fifteen: not voted', FV.fullyVoted(o({ players: ['a', 'b'], team: 't0' })) === false);

  ok('nothing in: the players', FV.firstStage(o(null)) === 'players');
  ok('players in: the club', FV.firstStage(o({ players: ['a', 'b', 'c'] })) === 'team');
  ok('players in, no clubs on the ballot: done', FV.firstStage(o({ players: ['a', 'b', 'c'] }, 15, 0)) === 'done');
  ok('club skipped: done', FV.firstStage(o({ players: ['a', 'b', 'c'], skipped: true })) === 'done');
  ok('no players on the ballot, club open: the club', FV.firstStage(o(null, 0, 3)) === 'team');
}

console.log('\nthe podium’s moves');
{
  same('a card from the strip into 2nd', FV.place([null, null, null], 'a', 1), [null, 'a', null]);
  same('a card from the strip onto a taken place sends that one back to the strip',
       FV.place(['a', null, null], 'b', 0), ['b', null, null]);
  same('a placed card dragged onto another place swaps them',
       FV.place(['a', 'b', null], 'a', 1, 0), ['b', 'a', null]);
  same('a placed card dragged onto an empty place moves',
       FV.place(['a', null, null], 'a', 2, 0), [null, null, 'a']);
  same('the same card dropped where it was stays', FV.place(['a', null, null], 'a', 0, 0), ['a', null, null]);
  ok('place() leaves the picks it was given alone', (() => { const p = ['a', null, null]; FV.place(p, 'b', 1); return p[1] === null; })());

  let t = FV.tap([null, null, null], 'a');
  same('a tap fills 1st', t.picks, ['a', null, null]);
  t = FV.tap(t.picks, 'b'); t = FV.tap(t.picks, 'c');
  same('...then 2nd, then 3rd', t.picks, ['a', 'b', 'c']);
  const full = FV.tap(t.picks, 'd');
  ok('a fourth tap on a full podium says so and changes nothing', full.full === true && JSON.stringify(full.picks) === '["a","b","c"]');
  same('a tap on a placed card takes it off', FV.tap(['a', 'b', 'c'], 'b').picks, ['a', null, 'c']);
  same('...and the next tap fills the gap it left', FV.tap(['a', null, 'c'], 'd').picks, ['a', 'd', 'c']);
  same('one slot (the club): a tap replaces what is there', FV.tap(['t1'], 't2').picks, ['t2']);
}

console.log('\nthe words on the cards');
{
  /* the week is Monday 00:00 to the next Monday 00:00 in the league's zone; the end is exclusive */
  ok('a week inside a month: "14–20 Sep…"',
     /^14–20 Sept?$/.test(FV.weekLabel('2026-09-13T23:00:00Z', '2026-09-20T23:00:00Z')),
     FV.weekLabel('2026-09-13T23:00:00Z', '2026-09-20T23:00:00Z'));
  ok('a week across two months names both',
     /^28 Sept? – 4 Oct$/.test(FV.weekLabel('2026-09-27T23:00:00Z', '2026-10-04T23:00:00Z')),
     FV.weekLabel('2026-09-27T23:00:00Z', '2026-10-04T23:00:00Z'));
  same('one game won', FV.recordText({ wins: 1, losses: 0, diff: 10, results: [{ vs: 'Owls', won: true, for: 80, against: 70 }] }),
       'W 80–70 v Owls');
  same('one game, the loser’s side', FV.recordText({ results: [{ vs: 'Owls', won: false, for: 70, against: 80 }] }),
       'L 70–80 v Owls');
  same('more than one game: the record and the margin', FV.recordText({ wins: 2, losses: 0, diff: 24, results: [{}, {}] }), '2–0 · +24');
  same('a losing margin keeps its sign', FV.recordText({ wins: 1, losses: 1, diff: -3, results: [{}, {}] }), '1–1 · -3');
  same('a player’s line', FV.lineText({ ppg: 21, rpg: 8.5, apg: 4 }), '21p 8.5r 4a');
  same('BPM, signed', [FV.bpmText({ bpm: 7.26 }), FV.bpmText({ bpm: -1.5 }), FV.bpmText({})], ['+7.3 BPM', '-1.5 BPM', '']);
  same('initials', [FV.initials('Ryan Pinnock'), FV.initials('Pele'), FV.initials('')], ['RP', 'PE', '?']);
  same('a club’s monogram', [FV.monogram({ short_name: 'Wolves' }), FV.monogram({ name: 'Oaklands Wolves' }), FV.monogram({ name: 'Owls' })],
       ['WOL', 'OW', 'OW']);
  ok('the voter is the Team of the Year ballot’s', FV.VOTER_KEY === 'epinoia.ballot.voter' &&
     /'epinoia\.ballot\.voter'/.test(read('epinoia', 'toty.js')));
}

/* ========================================================== 2. THE BALLOT === */
console.log('\nthe players: the Stars podium’s week (BCB, as stars.test.mjs captured it)');
{
  const FX = JSON.parse(read('supabase', 'tests', 'fixtures', 'stars-bcb.json'));
  const IN = FX.inputs;
  const W = FX.outputs.windows.find(w => w.key === 'week');
  const ids = new Set(W.games);
  const games = IN.games.filter(g => ids.has(g.id));
  const got = playerCandidates(games, IN.player_game_stats, IN.team_game_stats);

  const week = WINDOWS.find(w => w.key === 'week');
  const agg = computeWindow(IN.player_game_stats, IN.team_game_stats, games);
  const eligible = pick(agg.players, week, 1000);

  ok('asks for more than the fifteen the database keeps (so a withheld player costs nobody)', BALLOT_PLAYERS > 15);
  ok('as many as qualify, up to ' + BALLOT_PLAYERS, got.length === Math.min(BALLOT_PLAYERS, eligible.length),
     got.length + ' of ' + eligible.length);
  same('the first ten are the ten the league page showed, in its order', got.slice(0, 10).map(p => p.id), W.ids);
  ok('...with the same BPM to one place',
     got.slice(0, 10).every((p, i) => Math.abs(p.line.bpm - Number(W.bpm[i])) < 0.051),
     got.slice(0, 10).map(p => p.line.bpm).join(',') + ' vs ' + W.bpm.join(','));
  same('the rest follow on the same rule', got.map(p => p.id), eligible.slice(0, BALLOT_PLAYERS).map(p => p.id));
  ok('best BPM first', got.every((p, i) => !i || got[i - 1].line.bpm >= p.line.bpm));
  ok('everyone played a game and twenty minutes', got.every(p => p.line.gp >= 1 && p.line.min >= 20));
  ok('each carries the club he played for', got.every(p => p.team_id && agg.teamOfPlayer.get(p.id) === p.team_id));
  same('the line is the card’s', Object.keys(got[0].line), ['bpm', 'gp', 'min', 'ppg', 'rpg', 'apg']);

  /* a scorer's local id (a player never matched to the register) is dropped, not sent */
  const top = got[0].id;
  const pgs = IN.player_game_stats.map(r => (r.player_uuid === top || r.player_id === top)
    ? Object.assign({}, r, { player_uuid: null, player_id: 'local-7' }) : r);
  const without = playerCandidates(games, pgs, IN.team_game_stats);
  ok('a player id that is not a UUID is left off', without.every(p => p.id !== 'local-7') && without[0].id === got[1].id);
  same('no games, nobody', playerCandidates([], IN.player_game_stats, IN.team_game_stats), []);
}

console.log('\nthe clubs: every club that won');
{
  const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const [A, B, C, D, E, F, G, H, I, J, K] = Array.from({ length: 11 }, (_, i) => U(i + 1));
  const names = new Map([
    [A, { id: A, name: 'Aston Arrows', short_name: 'Arrows' }], [B, { id: B, name: 'Bristol Bears' }],
    [C, { id: C, name: 'Cardiff Comets', short_name: 'Comets' }], [D, { id: D, name: 'Derby Dukes' }],
    [E, { id: E, name: 'Exeter Eagles' }], [H, { id: H, name: 'Zebras' }], [J, { id: J, name: 'Apes' }], [K, { id: K, name: 'Kent Kites' }]
  ]);
  const g = (day, home, away, hs, as) => ({ id: 'g' + day + home.slice(-2), tipoff_at: '2026-09-' + day + 'T19:00:00Z',
    home_team_id: home, away_team_id: away, home_score: hs, away_score: as });
  const games = [
    g(16, C, A, 90, 60),          // Wednesday: C beats A (listed first, played second)
    g(14, A, B, 80, 70),          // Monday: A beats B
    g(15, D, E, 70, 68),
    g(17, B, E, 75, 60),
    g(18, C, D, 80, 79),          // C's second win
    g(18, F, G, 70, 70),          // a tie: nobody won
    g(19, H, I, 60, 50),
    g(19, J, K, 60, 50),          // H and J: the same week, so the name decides
    g(20, 'local-3', E, 99, 50),  // a club with no register id
    { id: 'gx', tipoff_at: '2026-09-20T12:00:00Z', home_team_id: E, away_team_id: F, home_score: null, away_score: null }
  ];
  const got = teamCandidates(games, names);
  same('winners only, most wins, then the margin, then the name', got.map(t => t.id), [C, J, H, B, D, A]);
  same('a club that won and lost carries both, in the order they were played', got.find(t => t.id === A).line, {
    wins: 1, losses: 1, diff: -20, results: [
      { vs: 'Bristol Bears', won: true, for: 80, against: 70, home: true },
      { vs: 'Comets', won: false, for: 60, against: 90, home: false }] });
  ok('the club’s short name where it has one', got.find(t => t.id === C).line.results[0].vs === 'Arrows');
  ok('a tie is nobody’s win', !got.some(t => t.id === F || t.id === G));
  ok('a club that only lost is not on it', !got.some(t => t.id === E || t.id === I || t.id === K));
  ok('a club id that is not a UUID is left off', !got.some(t => t.id === 'local-3'));
  same('the card reads it', FV.recordText(got.find(t => t.id === J).line), 'W 60–50 v Kent Kites');
  same('no games, no clubs', teamCandidates([], names), []);
}

/* ========================================================== 3. THE WIRING === */
console.log('\nthe wiring');
{
  const sql = read('supabase', 'migrations', '0150_fan_vote.sql');
  ok('0150 keeps fifteen players', (sql.match(/exit when v_n >= 15;/g) || []).length === 1);
  ok('0150 keeps every winning club, up to a guard of 32', /exit when v_t >= 32;/.test(sql));
  ok('0150’s self-test proves the fifteen', /zz-t150-cap/.test(sql));
  ok('the ballot is opened only by the service role',
     /grant execute on function public\.fanvote_open\([^)]*\) to service_role;/.test(sql) &&
     /revoke all on function public\.fanvote_open\([^)]*\) from public, anon, authenticated;/.test(sql) &&
     /grant execute on function public\.fanvote_due\([^)]*\) to service_role;/.test(sql));
  ok('the fans’ profile switch is a stored preference', /add column if not exists want_fanvote boolean not null default true/.test(sql) &&
     /want_fanvote\s*=\s*coalesce\(\(p->>'want_fanvote'\)::boolean, want_fanvote\)/.test(sql));

  /* THE DRAG FOLLOWS THE POINTER. The league page is zoomed (body { zoom: 1.25 / 1.5 }), so a fixed
     ghost on <body> moves 1.5x as far as it is told: it must measure that and divide by it, and be
     as tall as the card it lifts (index.html's .star.small plate rule would otherwise make it square). */
  const fvjs = read('epinoia', 'fanvote.js'), fvcss = read('epinoia', 'kit', 'fanvote.css');
  ok('the drag ghost measures the page zoom and divides its moves by it',
     /drag\.k = /.test(fvjs) && /\(x - drag\.dx\) \/ k/.test(fvjs) && /\(y - drag\.dy\) \/ k/.test(fvjs) &&
     /r\.width \/ drag\.k/.test(fvjs));
  ok('the ghost keeps the strip’s plate shape, above the page’s square-plate rule',
     /\.fv-ghost\.fv-card\.small \.club-plate\{aspect-ratio:4\/3\}/.test(fvcss));
  ok('a player’s whole name is shown: it wraps rather than being cut with an ellipsis',
     /\.fv \.fv-card \.star-name,\.fv-ghost\.fv-card \.star-name\{white-space:normal;overflow:visible;text-overflow:clip/.test(fvcss));
  ok('a player card carries points, rebounds and assists', /function statRow/.test(fvjs) && /foot\.append\(who, statRow\(p\.line\)\)/.test(fvjs) &&
     /\['PTS'.*\['REB'.*\['AST'/.test(fvjs));

  const idx = read('epinoia', 'index.html');
  const fv = idx.indexOf('id="fvSec"'), st = idx.indexOf('id="starsSec"');
  ok('the winners sit directly above the Stars', fv > 0 && st > fv && !/id="[^"]+Sec"/.test(idx.slice(fv + 10, st)));
  ok('the page loads the panel and its styles', /<script src="fanvote\.js\?v=\d+" defer><\/script>/.test(idx) &&
     /<link rel="stylesheet" href="kit\/fanvote\.css\?v=\d+">/.test(idx));

  const home = read('epinoia', 'home.js');
  ok('the Appearance switch covers it', /fanvote:\s*'#fvSec'/.test(home) && /sectionOn\('fanvote'\)/.test(home));
  ok('the front page mounts it, not behind a private league’s wall', /wall\.walled \? null : fanVote\(\)/.test(home));
  ok('the panel unrolls from the rule under the hero', /#hub \.hero/.test(home));

  const nav = read('epinoia', 'nav.js');
  ok('the league menu has every week’s winners', /href: 'votes\/'.*key: 'votes', probe: 'votes'/.test(nav));
  ok('...shown only where a vote has been held', /fanvote_rounds\?select=id,leagues!inner\(slug\)/.test(nav));
  ok('the winners page exists and reads fanvote_winners', existsSync(path.join(ROOT, 'epinoia', 'votes', 'index.html')) &&
     /rpc\/fanvote_winners/.test(read('epinoia', 'votes', 'votes.js')));

  ok('the profile has the switch', /id="wFanvote"/.test(read('epinoia', 'me', 'index.html')) &&
     /want_fanvote: \$\('#wFanvote'\)\.checked/.test(read('epinoia', 'me', 'me.js')));

  const admin = read('epinoia', 'admin', 'index.html');
  ok('the admin page has the tallies', /id="fanvotePanel"/.test(admin) && /fanvote-ui\.js\?v=\d+/.test(admin) &&
     /EpinoiaFanVoteUI\.mount\(\{ host: '#fanvotePanel'/.test(read('epinoia', 'admin', 'admin.js')));
  ok('...which say fifteen', /fifteen best players/.test(read('epinoia', 'admin', 'fanvote-ui.js')));
  ok('Appearance lists it', /\['fanvote',/.test(read('epinoia', 'admin', 'appearance-ui.js')));

  const cfg = read('supabase', 'config.toml');
  ok('the function takes a signed-out page’s call', /\[functions\.fanvote\]\s*\nverify_jwt = false/.test(cfg));
  const fn = read('supabase', 'functions', 'fanvote', 'index.ts');
  ok('the function answers the preflight first', /if \(req\.method === 'OPTIONS'\) return new Response\('ok', \{ headers: cors \}\)/.test(fn) &&
     /'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info'/.test(fn));
  ok('the Edge Function runs the browser’s own stars.js',
     /src: join\(repo, 'epinoia', 'stars\.js'\)/.test(read('supabase', 'tests', 'extract-shared.mjs')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
