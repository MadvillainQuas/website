/* ============================================================================
   THE EPINOIA GO PAGE (step 3.4, epinoia/go/, docs/epinoia-go.md).

   Run under Node: what a game is to a fan standing somewhere (stampable, too far, not open yet, over, its
   pin waiting for a person), the order the games are listed in, distances in words; every reason
   stamp_venue (migration 0165) can refuse with has a sentence here, in English, Japanese and Spanish;
   the location goes to the server in the stamp call and nowhere else; the page before 0165 is pushed.

   The page itself was driven in Chromium with the phone's location faked and the database answered by a
   stand-in with 34 checks: signed out, no username yet, a stamp, refusals, location refused, nowhere
   near a game, Japanese, Spanish, a phone in the dark. The harness lives outside the repo.

     node supabase/tests/go-page.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + JSON.stringify(d) : '')); } };

const G = require(path.join(ROOT, 'epinoia', 'go', 'go.js'));
const now = Date.parse('2026-10-03T16:00:00Z');
const game = (o) => Object.assign({ game_id: 'g', lat: 60.1896, lng: 24.9278, radius_m: 300, trusted: true,
  opens_at: '2026-10-03T15:00:00Z', closes_at: '2026-10-03T19:00:00Z' }, o);
const at = (lat, lng, accuracy) => ({ lat, lng, accuracy });

console.log('\na game, to a fan standing somewhere');
ok('at the arena, in its window: stampable', G.placeOf(game(), at(60.1899, 24.9281, 20), now).state === 'here');
ok('450 m away with a phone unsure to 200 m: still stampable (the server allows the same)',
   G.placeOf(game(), at(60.1936, 24.9278, 200), now).state === 'here');
ok('...but the doubt allowed stops at 200 m, whatever the phone says', G.placeOf(game(), at(60.1960, 24.9278, 5000), now).state === 'far');
ok('too far', G.placeOf(game(), at(60.2346, 24.9278, 20), now).state === 'far');
ok('not open yet', G.placeOf(game({ opens_at: '2026-10-03T17:00:00Z' }), at(60.1899, 24.9281, 20), now).state === 'later');
ok('over', G.placeOf(game({ closes_at: '2026-10-03T15:30:00Z' }), at(60.1899, 24.9281, 20), now).state === 'over');
ok('a pin waiting for a person, whatever else', G.placeOf(game({ trusted: false }), at(60.1899, 24.9281, 20), now).state === 'checking');
const list = G.nearby([
  game({ game_id: 'far', lat: 60.1757, lng: 24.8052 }),
  game({ game_id: 'tokyo', lat: 35.6377, lng: 139.7929 }),
  game({ game_id: 'later', lat: 60.1879, lng: 24.9772, opens_at: '2026-10-03T18:00:00Z' }),
  game({ game_id: 'over', lat: 60.19, lng: 24.93, closes_at: '2026-10-03T15:30:00Z' }),
  game({ game_id: 'here' }),
], at(60.1899, 24.9281, 20), now).map(x => x.g.game_id);
ok('listed: the stampable one first, then by what can be done; nothing over, nothing 50 km away',
   list.join() === 'here,far,later', list);
ok('the nearest game is found however far', G.nearest([game({ game_id: 'a', lat: 35.6, lng: 139.7 }), game({ game_id: 'b' })], at(51.5, -0.12)).g.game_id === 'b');
ok('distances in words: metres to 10, kilometres to one place under 10',
   G.distanceText(437, 'en-GB') === '440 m' && G.distanceText(1234, 'en-GB') === '1.2 km' && G.distanceText(37400, 'en-GB') === '37 km'
   && G.distanceText(1234, 'es-ES') === '1,2 km');

console.log('\nevery refusal in words');
const sql = rd('supabase', 'migrations', '0165_stamps.sql');
const sv = sql.slice(sql.indexOf('create or replace function public.stamp_venue'), sql.indexOf('alter function public.stamp_venue'));
const reasons = [...new Set([...sv.matchAll(/'reason', '([a-z_]+)'/g)].map(m => m[1]))];
const missing = reasons.filter(r => !G.WHY[r]);
ok('each reason stamp_venue gives has a sentence on the page', reasons.length >= 13 && !missing.length, missing);
ok('...and the numbers that go with them', G.factsOf({ reason: 'too_far', distance_m: 1230, radius_m: 300 }).map(f => f[0]).join() === 'Distance,A stamp needs you within'
   && G.factsOf({ reason: 'too_fast', last_venue: 'Arena', minutes_ago: 3 })[0][1] === 'Arena'
   && G.factsOf({ reason: 'too_early', opens_at: '2026-10-03T17:00:00Z' })[0][0] === 'Stamping opens');
ok('an hour\'s wait is said as one', G.whyOf({ reason: 'slow_down', retry_after: 3600 }) !== G.whyOf({ reason: 'slow_down', retry_after: 60 }));
for (const code of ['ja', 'es']) {
  const src = rd('epinoia', 'i18n', code, 'go.js');
  const words = [...Object.values(G.WHY), ...Object.values(G.GEO), 'stamp this venue', 'find the game I’m at', 'Stamping opens', 'Stamping closed',
                 'take back', 'Take this stamp back? It comes off your passport and your numbers.', 'Could not take it back. Try again.',
                 'More in the privacy notice'];
  const miss = words.filter(w => !src.includes("'" + w + "':"));
  ok(code + ': every sentence the page can show is translated', !miss.length, miss);
}

console.log('\nthe location');
const js = rd('epinoia', 'go', 'go.js');
ok('the location goes to the server in the stamp call only', (js.match(/p_lat/g) || []).length === 1
   && /rpc\('stamp_venue', \{ p_game: g\.game_id, p_lat: pos\.lat, p_lng: pos\.lng, p_accuracy: pos\.accuracy \}\)/.test(js));
ok('the games are asked for with nothing about the fan', /rpc\('go_games_now'\)/.test(js));
ok('a position older than 45 seconds is asked for again before stamping', /Date\.now\(\) - pos\.at > FRESH_MS/.test(js) && /const FRESH_MS = 45000/.test(js));
ok('the phone is asked for its best fix', /enableHighAccuracy: true/.test(js));
const html = rd('epinoia', 'go', 'index.html');
ok('the page says what happens to the location', /Your location is used once, when you stamp, to check you are at the arena, and then\s+forgotten/.test(html));
ok('...and points to the privacy notice\'s EPINOIA GO section', /<a class="go-plink" href="\.\.\/privacy\/#goSec">More in the privacy notice<\/a>/.test(html)
   && /<section class="sec" id="goSec"/.test(rd('epinoia', 'privacy', 'index.html')));
// the privacy notice promises it: 0165's stamps_own_delete lets a fan delete their own
ok('a stamp is the fan\'s to take back: by its id, asked to show what went (a refused delete answers 204 as well)',
   /'\/rest\/v1\/stamps\?id=eq\.' \+ encodeURIComponent\(x\.id\)/.test(js) && /method: 'DELETE'/.test(js)
   && /Prefer: 'return=representation'/.test(js) && /gone = r\.ok && \(await r\.json\(\)\)\.length === 1/.test(js)
   && /create policy stamps_own_delete on public\.stamps for delete using \(user_id = auth\.uid\(\)\)/.test(sql));

console.log('\nthe page');
ok('before 0165: EPINOIA GO opens soon, nothing that cannot work', /if \(games === 'missing'\) return closed\(\)/.test(js) && /EPINOIA GO opens soon\./.test(html));
ok('a fan with no username is sent to the profile\'s username section', /a\.href = '\.\.\/me\/#username'/.test(js));
ok('signed out: a sign-in that comes back here', /S\.access\.signinHref\(\)/.test(js));
ok('names are data: never translated', /data\('div', 'm', \(g\.home \|\| '—'\) \+ ' v ' \+ \(g\.away \|\| '—'\)\)/.test(js) && /translate="no">EPINOIA GO</.test(html));
ok('the go pack is loaded', /<script src="\.\.\/i18n\.js\?v=\d+" data-i18n-packs="go"><\/script>/.test(html));
ok('no location in the page\'s own storage', !/localStorage|sessionStorage|indexedDB/.test(js));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
