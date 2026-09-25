/* ============================================================================
   EPINOIA GO'S NUMBERS, PASSPORT AND LEADERBOARDS (steps 4.1-4.3, migration 0166, epinoia/go/).

   Read from the migration: a board shows only fans who chose it, with a username and 18 or over
   confirmed (D6); names and numbers, never an account id; a private league's board is not a stranger's;
   the journey is each stamp's arena to the next one's in the order made (D2). Run under Node: the page's
   own arithmetic agrees with that; the journey card by card (journeyOf - the redesign drew it on a real
   map, map.js, in place of journey.js's bare grid); the board three ways, by distance, games (0168) and
   venues, ranked alike on the server and the page; the words in ja and es.

   0166 was run on a real Postgres (PGlite) with 31 checks - the opt-in rules, the boards overall, per
   league and by distance, a private league, a fan going private, an account deleted - and the page was
   driven in Chromium with 56 checks (the passport, the opt-in, the boards, Japanese, Spanish). Both
   harnesses live outside the repo.

     node supabase/tests/go-boards.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + JSON.stringify(d) : '')); } };

const sql = rd('supabase', 'migrations', '0166_go_leaderboards.sql');
console.log('\nmigration 0166');
ok('on a board only by choice, with the age confirmed - enforced by the table itself',
   /constraint go_settings_public_is_adult check \(not public or adult_confirmed_at is not null\)/.test(sql));
ok('choosing needs a username, and 18 or over confirmed once', /'reason', 'username'/.test(sql) && /'reason', 'adult'/.test(sql)
   && /coalesce\(go_settings\.adult_confirmed_at, excluded\.adult_confirmed_at\)/.test(sql));
ok('nobody writes the choice directly', /revoke insert, update, delete on public\.go_settings from anon, authenticated/.test(sql)
   && /grant execute on function public\.set_go_public\(boolean, boolean\) to authenticated/.test(sql));
ok('every fan\'s numbers, with their ids, are reachable from nowhere outside',
   /revoke all on function public\.go_numbers\(uuid\) from public, anon, authenticated/.test(sql)
   && !/grant execute on function public\.go_numbers/.test(sql));
const lb = sql.slice(sql.indexOf('create or replace function public.go_leaderboard'), sql.indexOf('revoke all on function public.go_leaderboard'));
ok('a board returns names and numbers, never an account id', /returns table \(rank bigint, username text, arenas bigint, stamps bigint, km numeric, me boolean\)/.test(lb));
ok('...only fans who chose it', /gs\.public and gs\.adult_confirmed_at is not null/.test(lb) && /join usernames u/.test(lb));
ok('...a private league\'s only to those who may see the league', /where p_league is null or public\.league_visible\(p_league\)/.test(lb));
ok('..."me" is false, not null, for a reader signed out', /coalesce\(r\.user_id = auth\.uid\(\), false\)/.test(lb));
ok('the journey (D2): each stamp\'s arena to the next one\'s, in the order made, per fan',
   /lag\(v\.lat\) over w as plat/.test(sql) && /window w as \(partition by st\.user_id order by st\.stamped_at, st\.id\)/.test(sql));
ok('the boards are open to anybody', /grant execute on function public\.go_leaderboard\(uuid, text, integer\) to anon, authenticated/.test(sql)
   && /grant execute on function public\.go_leagues\(\) to anon, authenticated/.test(sql));
ok('a private league is not among the buttons', /where public\.league_visible\(l\.id\)/.test(sql));
const nums = readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{4}_/.test(f)).map(f => f.slice(0, 4));
ok('0166 is the only 0166', nums.filter(n => n === '0166').length === 1);

console.log('\nthe page\'s arithmetic');
const G = require(path.join(ROOT, 'epinoia', 'go', 'go.js'));
const NAMES = { toolo: 'Töölön Kisahalli', tapiola: 'Tapiolan Urheiluhalli', kotka: 'Steveco Areena', tokyo: 'Arena Tokyo' };
const st = (v, lat, lng, league, t) => ({ venue_id: v, league_id: league, stamped_at: t, venues: { name: NAMES[v], lat, lng }, leagues: { name: league } });
const mine = [st('toolo', 60.1896, 24.9278, 'kl', '2026-09-01'), st('tapiola', 60.1757, 24.8052, 'kl', '2026-09-05'),
              st('toolo', 60.1896, 24.9278, 'kl', '2026-09-09'), st('kotka', 60.4677, 26.9458, 'kl', '2026-09-13'),
              st('tokyo', 35.6377, 139.7929, 'bl', '2026-09-20')];
const n = G.numbersOf(mine.slice(0, 4).reverse());
ok('arenas once, every stamp, and the journey in the order made (7 + 7 + 115 km), whatever order they come in',
   n.arenas === 3 && n.stamps === 4 && Math.abs(n.km - 129.3) < 0.5, n);
const per = G.byLeague(mine);
ok('per league, the most arenas first, each its own journey', per.map(l => l.league_id + ':' + l.arenas).join() === 'kl:3,bl:1'
   && Math.abs(per[0].km - 129.3) < 0.5 && per[1].km === 0, per);
ok('kilometres in words: one place under 100', G.kmText(129.26, 'en-GB') === '129 km' && G.kmText(12.34, 'en-GB') === '12.3 km'
   && G.kmText(12.34, 'es-ES') === '12,3 km');

console.log('\nthe journey, card by card (the redesign: journeyOf, and the map in place of journey.js)');
const J = G.journeyOf(mine.slice().reverse());
ok('oldest first, numbered in the order made, whatever order the stamps come in',
   J.map(j => j.n + ':' + j.s.venue_id).join() === '1:toolo,2:tapiola,3:toolo,4:kotka,5:tokyo', J.map(j => j.s.venue_id));
ok('...each with the trip that led there, from the arena before (none for the first)',
   J[0].legKm === null && J[0].from === null && Math.abs(J[1].legKm - 7) < 0.5 && J[1].from === 'Töölön Kisahalli'
   && J[3].from === 'Töölön Kisahalli' && Math.abs(J[3].legKm - 115) < 1.5, J.map(j => [j.legKm, j.from]));
ok('...the same legs the numbers add up', Math.abs(J.slice(0, 4).reduce((a, j) => a + (j.legKm || 0), 0) - n.km) < 0.01);
const gap = G.journeyOf([st('toolo', 60.1896, 24.9278, 'kl', '1'), st('kotka', null, null, 'kl', '2'), st('tapiola', 60.1757, 24.8052, 'kl', '3')]);
ok('an arena with no pin has no leg, and the next runs from the last one pinned',
   gap[1].legKm === null && gap[2].from === 'Töölön Kisahalli' && Math.abs(gap[2].legKm - 7) < 0.5, gap.map(j => [j.legKm, j.from]));
ok('journey.js is gone: the stamps page draws the journey on a map (map.js)',
   !existsSync(path.join(ROOT, 'epinoia', 'go', 'journey.js')) && !/journey\.js/.test(rd('epinoia', 'go', 'index.html')));

console.log('\nthe leaderboard, three ways (0168)');
const rows = [{ username: 'a', arenas: 3, stamps: 9, km: 50 }, { username: 'b', arenas: 5, stamps: 5, km: 900 },
              { username: 'c', arenas: 5, stamps: 9, km: 20 }, { username: 'd', arenas: 5, stamps: 5, km: 900 }];
const order = by => G.rerank(rows, by).map(r => r.username + r.rank).join();
ok('by distance, then arenas; ties share a rank, as rank() does', order('km') === 'b1,d1,a3,c4', order('km'));
ok('by games, then arenas, then distance', order('stamps') === 'c1,a2,b3,d3', order('stamps'));
ok('by venues, then distance', order('arenas') === 'b1,d1,c3,a4', order('arenas'));
const m168 = rd('supabase', 'migrations', '0168_go_notes_and_games_board.sql');
const lb168 = m168.slice(m168.indexOf('create or replace function public.go_leaderboard'), m168.indexOf('alter function public.go_leaderboard'));
ok('0168: the server ranks the same three ways, with 0166\'s signature and rules',
   /when p_by = 'km' then rank\(\) over \(order by n\.km desc, n\.arenas desc\)/.test(lb168)
   && /when p_by = 'stamps' then rank\(\) over \(order by n\.stamps desc, n\.arenas desc, n\.km desc\)/.test(lb168)
   && /else rank\(\) over \(order by n\.arenas desc, n\.km desc\) end/.test(lb168)
   && /returns table \(rank bigint, username text, arenas bigint, stamps bigint, km numeric, me boolean\)/.test(lb168)
   && /gs\.public and gs\.adult_confirmed_at is not null/.test(lb168) && /where p_league is null or public\.league_visible\(p_league\)/.test(lb168));
ok('the page ranks what comes back again, so the board by games is right before 0168 is pushed',
   /rerank\(Array\.isArray\(r\.data\) \? r\.data : \[\], S\.board\.by\)/.test(rd('epinoia', 'go', 'go.js'))
   && /p_by: S\.board\.by, p_limit: S\.board\.by === 'stamps' \? 500 : 100/.test(rd('epinoia', 'go', 'go.js')));
ok('each way explained where it is chosen', G.BY.map(b => b.v).join() === 'km,stamps,arenas' && G.BY.every(b => b.t && b.d.length > 20));
ok('0168 is the only 0168', nums.filter(x => x === '0168').length === 1);

console.log('\nbadges (4.4)');
const kl = [{ league_id: 'kl', league: 'kl', arenas_total: 3 }, { league_id: 'bl', league: 'bl', arenas_total: 1 }];
const none = G.badgesOf([], kl);
ok('before a first stamp: three to earn, none earned, nothing per league',
   none.map(b => b.key).join() === 'first,arenas,km' && none.every(b => !b.got && b.have === 0), none);
const got = G.badgesOf(mine, kl);
const by = k => got.find(b => b.key === k) || {};
ok('a first stamp; every arena of a league once the fan has stamped as many as it played in',
   by('first').got && by('league:kl').got && by('league:kl').have === 3 && by('league:kl').of === 3 && by('league:kl').league === 'kl', got);
ok('...not for a league with a single arena (one arena is not a collection)', !got.some(b => b.key === 'league:bl'), got);
ok('ten arenas and 1,000 km: the way there (4 arenas; Helsinki to Tokyo is 7,800 km, so that one is earned)',
   !by('arenas').got && by('arenas').have === 4 && by('arenas').of === 10 && by('km').got && by('km').have === 1000, [by('arenas'), by('km')]);
const three = G.badgesOf(mine.slice(0, 2), [{ league_id: 'kl', arenas_total: 3 }]);
ok('...and part of the way to a league\'s', three.find(b => b.key === 'league:kl').have === 2 && !three.find(b => b.key === 'league:kl').got, three);
ok('without the leagues\' counts (0166 not pushed) there are no league badges, the rest stand',
   G.badgesOf(mine, null).map(b => b.key).join() === 'first,arenas,km');
const goHtml = rd('epinoia', 'go', 'index.html'), goJs = rd('epinoia', 'go', 'go.js');
ok('on the stamps page, under the counts; drawn again when the leagues\' counts arrive',
   /<div class="go-tally" id="goTally"><\/div>\s*<!--[^>]*-->\s*<div class="go-badges" id="goBadges" role="list" aria-label="Badges"><\/div>/.test(rd('epinoia', 'go', 'stamps', 'index.html'))
   && /S\.leagues = Array\.isArray\(r\.data\) \? r\.data : \[\];\s*drawBadges\(\);/.test(goJs));

console.log('\nthe words');
for (const code of ['ja', 'es']) {
  const src = rd('epinoia', 'i18n', code, 'go.js');
  const words = ['travelled', 'Leaderboard', 'Distance', 'Venues', ...G.BY.map(b => b.d), 'go public',
                 'I am 18 or over', 'go private', 'show my stamps', 'take me off', 'You are on the leaderboards', 'Tick the box to confirm you are 18 or over.',
                 'Nobody is on this board yet. Stamp an arena and put yourself on it.', 'Arenas in this league',
                 'Badges', 'first stamp', 'every arena', 'So far', 'The map', 'Every game', 'Zoom in', 'Zoom out', 'Show every arena',
                 'Your map fills in as you stamp arenas.'];
  const miss = words.filter(w => !src.includes("'" + w + "':"));
  ok(code + ': the passport and the boards are translated', !miss.length, miss);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
