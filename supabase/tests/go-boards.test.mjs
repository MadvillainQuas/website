/* ============================================================================
   EPINOIA GO'S NUMBERS, PASSPORT AND LEADERBOARDS (steps 4.1-4.3, migration 0166, epinoia/go/).

   Read from the migration: a board shows only fans who chose it, with a username and 18 or over
   confirmed (D6); names and numbers, never an account id; a private league's board is not a stranger's;
   the journey is each stamp's arena to the next one's in the order made (D2). Run under Node: the page's
   own arithmetic agrees with that; the journey drawing (D10: our own SVG) - one point per arena, no line
   for a second visit, names never on top of each other or off the edge; the words in ja and es.

   0166 was run on a real Postgres (PGlite) with 31 checks - the opt-in rules, the boards overall, per
   league and by distance, a private league, a fan going private, an account deleted - and the page was
   driven in Chromium with 56 checks (the passport, the opt-in, the boards, Japanese, Spanish). Both
   harnesses live outside the repo.

     node supabase/tests/go-boards.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
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

console.log('\nthe journey, drawn');
const J = require(path.join(ROOT, 'epinoia', 'go', 'journey.js'));
const plan = J.build(mine.map(x => ({ venue_id: x.venue_id, name: x.venues.name, lat: x.venues.lat, lng: x.venues.lng, stamped_at: x.stamped_at })).slice(0, 4));
ok('one point per arena, with its visits', plan.points.length === 3 && plan.points.find(p => p.venue_id === 'toolo').visits === 2);
ok('a line per trip between two arenas', plan.segments.length === 3);
ok('a second visit to the same arena in a row adds no line',
   J.build([{ venue_id: 'a', name: 'A', lat: 60, lng: 24, stamped_at: '1' }, { venue_id: 'a', name: 'A', lat: 60, lng: 24, stamped_at: '2' }]).segments.length === 0);
const inside = plan.points.every(p => p.x >= 0 && p.x <= plan.w && p.y >= 0 && p.y <= plan.h);
ok('every arena inside the drawing', inside, plan.points);
const lab = plan.labels;
const box = l => { const w = J.textWidth(l.text); return { x0: l.anchor === 'end' ? l.x - w : l.x, x1: l.anchor === 'end' ? l.x : l.x + w, y0: l.y - 11, y1: l.y + 3 }; };
const clash = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
ok('names never on top of each other', lab.every((l, i) => lab.every((m, j) => i === j || !clash(box(l), box(m)))), lab);
ok('...nor off the edge (a name near the right edge sits on its point\'s left)',
   lab.every(l => { const b = box(l); return b.x0 >= 0 && b.x1 <= plan.w; }) && lab.some(l => l.anchor === 'end'), lab);
ok('a CJK name is measured as wider', J.textWidth('アリーナ立川立飛') > J.textWidth('Arena Tachikawa'.slice(0, 8)));
ok('a scale bar in round kilometres', [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].includes(plan.scale.km) && plan.scale.px > 0);
ok('one arena still draws as a place', J.build([{ venue_id: 'a', name: 'A', lat: 60, lng: 24, stamped_at: '1' }]).h > 100);
ok('no pinned arena, no drawing', J.build([{ venue_id: 'a', name: 'A', lat: null, lng: null }]) === null);
const js = rd('epinoia', 'go', 'journey.js');
ok('every arena opens in Google Maps, with no key: the Maps URLs form', /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/.test(js) && !/key=|AIza/.test(js));

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
ok('on the passport, under the counts; drawn again when the leagues\' counts arrive',
   /<div class="go-tally" id="goTally"><\/div>\s*<!--[^>]*-->\s*<div class="go-badges" id="goBadges" role="list" aria-label="Badges"><\/div>/.test(goHtml)
   && /S\.leagues = Array\.isArray\(r\.data\) \? r\.data : \[\];\s*drawBadges\(\);/.test(goJs));

console.log('\nthe words');
for (const code of ['ja', 'es']) {
  const src = rd('epinoia', 'i18n', code, 'go.js');
  const words = ['Your passport', 'travelled', 'Leaderboards', 'by arenas', 'by distance', 'Put yourself on the leaderboards',
                 'I am 18 or over', 'put me on', 'take me off', 'You are on the leaderboards', 'Tick the box to confirm you are 18 or over.',
                 'Nobody is on this board yet. Stamp an arena and put yourself on it.', 'Fan', 'Arenas in this league', 'Your journey',
                 'Badges', 'first stamp', 'every arena'];
  const miss = words.filter(w => !src.includes("'" + w + "':"));
  ok(code + ': the passport and the boards are translated', !miss.length, miss);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
