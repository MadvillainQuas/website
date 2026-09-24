/* ============================================================================
   THE EPINOIA GO PAGE (step 3.4, epinoia/go/, docs/epinoia-go.md).

   Run under Node: what a game is to a fan standing somewhere (stampable, too far, not open yet, over, its
   pin waiting for a person), the order the games are listed in, distances in words; every reason
   stamp_venue (migration 0165) can refuse with has a sentence here, in English, Japanese and Spanish;
   the location goes to the server in the stamp call and nowhere else; the page before 0165 is pushed.

   The page itself was driven in Chromium with the phone's location faked and the database answered by a
   stand-in with 34 checks: signed out, no username yet, a stamp, refusals, location refused, nowhere
   near a game, Japanese, Spanish, a phone in the dark. The redesign (2026-09-24) was driven the same way:
   the intro in each of its modes (29 checks), a stamp with its note and photograph after it, the stamps
   page with and without 0168 (20), every state harvested for English left in Japanese and Spanish, and
   screenshots light and dark, desktop and phone. The harnesses live outside the repo.

   Also here: the redesign - the intro, the hero, the sections, a note about the occasion (0168), the
   stamps page and its map, and the EPINOIA GO logo wherever the name is written.

     node supabase/tests/go-page.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
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
ok('names are data: never translated', /data\('div', 'm', \(g\.home \|\| '—'\) \+ ' v ' \+ \(g\.away \|\| '—'\)\)/.test(js)
   && /<h1 id="goTitle"><span class="go-logo hero" role="img" aria-label="EPINOIA GO" translate="no" data-i18n="off">/.test(html));
ok('the go pack is loaded, and the account pack (the intro\'s username words are the profile\'s)',
   /<script src="\.\.\/i18n\.js\?v=\d+" data-i18n-packs="go account"><\/script>/.test(html));
ok('no location in the page\'s own storage: only the intro seen, "later" for this visit, and the country picked',
   (js.match(/localStorage|sessionStorage/g) || []).length === 4 && !/indexedDB/.test(js)
   && /const KEYS = \{ intro: 'epinoia_go_intro', later: 'epinoia_go_intro_later', country: 'epinoia_go_country' \};/.test(js)
   && [...js.matchAll(/(?<!function )\bstored?\(([^,)]+)/g)].every(m => /^KEYS\.(intro|later|country)$/.test(m[1].trim())));

console.log('\nthe redesign (Louie, 2026-09-24): the intro');
const css = rd('epinoia', 'go', 'go.css');
ok('the screen goes black on the light theme, white on the dark, and asks in a sans serif',
   /<div class="gi-msg" id="goIntroMsg">Please Enter A Username\.<\/div>/.test(html)
   && /\.go-intro\{[^}]*background:#fbfdfc;/.test(css) && /:root\[data-theme="light"\] \.go-intro\{background:#000;/.test(css)
   && /\.gi-msg\{font-family:var\(--f-ui\)/.test(css));
ok('...then "Have Fun!" takes the prompt\'s place, and the page comes back',
   /msg\.textContent = 'Have Fun!';/.test(js) && /box\.classList\.remove\('on'\);\s*entered\(\);/.test(js)
   && /<div class="gi-below">/.test(html));
ok('...once on a device; and for a fan with no username until they choose one, or say later (for this visit)',
   /if \(noName && stored\(KEYS\.later, true\) !== '1'\) return 'ask';/.test(js) && /if \(stored\(KEYS\.intro\) === '1'\) return null;/.test(js)
   && /return S\.session \? \(noName \? null : 'welcome'\) : 'signin';/.test(js));
ok('...the name checked as it is typed and saved by 0163, which applies every rule again',
   /rpc\('username_check', \{ p: v \}\)/.test(js) && /rpc\('set_username', \{ p: input\.value\.trim\(\) \}\)/.test(js)
   && G.unameLocal('lo') === 'short' && G.unameLocal('9lives') === 'start' && G.unameLocal('bad name') === 'characters' && G.unameLocal('Louie_99') === '');
ok('...every refusal in the profile\'s words, which the account pack translates',
   ['ja', 'es'].every(code => Object.values(G.UNAME_WHY).every(w => rd('epinoia', 'i18n', code, 'account.js').includes("'" + w + "':"))));

console.log('\nthe redesign: the hero');
ok('the night sky under the logo, inverted on the dark theme',
   existsSync(path.join(ROOT, 'epinoia', 'go', 'img', 'stars-2400.jpg')) && existsSync(path.join(ROOT, 'epinoia', 'go', 'img', 'stars-1200.jpg'))
   && /\.go-hero-bg\{[^}]*url\('img\/stars-2400\.jpg'\)/.test(css) && /:root:not\(\[data-theme="light"\]\) \.go-hero-bg\{filter:invert\(1\)\}/.test(css));
ok('...the logo sized from the hero\'s own width, so it fits beside the rail and under the kit\'s zoom',
   /\.go-hero\{[^}]*container-type:inline-size\}/.test(css) && /\.go-logo\.hero\{[^}]*font-size:min\(13cqi,124px\)/.test(css));
ok('...GO lit in neon green, and the one button under the logo',
   /\.go-logo\.hero \.gl-go\{color:var\(--neon\);text-shadow:/.test(css)
   && html.indexOf('id="goTitle"') < html.indexOf('id="goFind"') && html.indexOf('id="goFind"') < html.indexOf('</header>'));

console.log('\nthe redesign: the sections');
ok('arenas to tick off, then the leaderboard, the feed and the fan\'s stamps, in that order',
   ['goStripSec', 'goBoardsSec', 'goFeedSec', 'goMineSec'].map(id => html.indexOf('id="' + id + '"')).every((v, i, a) => v > 0 && (!i || v > a[i - 1])));
ok('the strip: the arenas of the fan\'s country with a club and no stamp of theirs, looping when there are enough',
   /venues\?country=eq\./.test(js) && /teams!teams_home_venue_id_fkey\(name,short_name,colour,logo_path\)/.test(js)
   && /@keyframes go-slide\{to\{transform:translateX\(-50%\)\}\}/.test(css) && /\.go-strip-track\{animation:none\}/.test(css));
const guess = o => G.countryGuess(Object.assign({ available: ['FI', 'GB', 'JP'] }, o));
ok('the country: the one picked before, then the clubs followed, the stamps, the time zone, the language, the first with arenas',
   guess({ stored: 'gb', follows: ['FI'] }) === 'GB' && guess({ follows: ['JP', 'JP', 'FI'], stamps: ['FI'] }) === 'JP'
   && guess({ stamps: ['FI', 'FI', 'GB'], tz: 'Asia/Tokyo' }) === 'FI' && guess({ tz: 'Asia/Tokyo', lang: 'en-GB' }) === 'JP'
   && guess({ tz: 'America/Chicago', lang: 'en-GB' }) === 'GB' && guess({ stored: 'US', tz: 'Europe/Paris' }) === 'FI');
ok('the feed: two rows of the fans\' photographs changing one at a time; with none, the outlines and the call',
   /const FEED_N = 10;/.test(js) && /'Prove your fandom — show your pictures of games'/.test(js)
   && /\.feed\.empty \.feed-card\{opacity:\.32;/.test(css) && /if \(document\.hidden\) return;/.test(js));
ok('...a small button to add yours, and one to the whole wall',
   /<a class="go-small fill" href="stamps\/#goListH">add yours<\/a><a class="go-small" href="photos\/">see the full feed<\/a>/.test(html));

console.log('\na note about the occasion (0168)');
const m168 = rd('supabase', 'migrations', '0168_go_notes_and_games_board.sql');
ok('0168: one line, 280 characters, the fan\'s alone (stamps are read only by their owner)',
   /alter table public\.stamps add column if not exists note text;/.test(m168)
   && /check \(note is null or char_length\(note\) between 1 and 280\)/.test(m168) && /create policy stamps_own_read/.test(sql));
ok('...written only by set_stamp_note, to the caller\'s own stamp; never by anon, never a direct update',
   /update stamps set note = n where id = p_stamp and user_id = me;/.test(m168)
   && /revoke all on function public\.set_stamp_note\(uuid, text\) from public, anon;/.test(m168)
   && /grant execute on function public\.set_stamp_note\(uuid, text\) to authenticated;/.test(m168)
   && /has_table_privilege\('authenticated', 'public\.stamps', 'update'\)/.test(m168));
const reasons168 = [...new Set([...m168.matchAll(/'reason', '([a-z_]+)'/g)].map(m => m[1]))];
ok('...each refusal in words on the page', reasons168.length === 3 && reasons168.every(r => G.NOTE_WHY[r]), reasons168);
ok('the page asks for it after a stamp and on the stamps page; before 0168 the stamps still come, with no note',
   /rpc\('set_stamp_note', \{ p_stamp: x\.id, p_note: text \}\)/.test(js) && /get\('note,' \+ STAMP_COLS\)/.test(js)
   && /if \(rows === 'retry'\) rows = await get\(STAMP_COLS\);/.test(js) && /if \(S\.noteOk\) \{\s*box\.appendChild\(el\('h3', null, 'A note about the occasion'\)\);/.test(js));
const nums168 = (await import('node:fs')).readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^0168_/.test(f));
ok('0168 is the only 0168', nums168.length === 1, nums168);

console.log('\nthe stamps page (go/stamps/)');
const sp = rd('epinoia', 'go', 'stamps', 'index.html');
ok('the numbers and badges, the map, every game with the distance from the one before, and the photographs',
   ['goTally', 'goBadges', 'goBigMap', 'goStampList', 'goPhotos'].map(id => sp.indexOf('id="' + id + '"')).every((v, i, a) => v > 0 && (!i || v > a[i - 1])));
ok('...its own page to the page\'s script (go.js knows it by #goStampsPage), with the map\'s',
   /<div class="ep-frame go" id="goStampsPage">/.test(sp) && /<script src="\.\.\/map\.js\?v=\d+" defer><\/script>\s*<script src="\.\.\/go\.js\?v=\d+" defer><\/script>/.test(sp)
   && /const onStampsPage = \(\) => !!document\.getElementById\('goStampsPage'\)/.test(js));
ok('...signed out, a way in and nothing else', /out\.classList\.remove\('hide'\)/.test(js) && /body\.classList\.add\('hide'\)/.test(js));
ok('..."from" there is the arena before (its own context: the core file\'s "from" is a date\'s start)',
   /leg\.setAttribute\('data-i18n-ctx', 'goleg'\)/.test(js)
   && ['ja', 'es'].every(code => /goleg: \{\s*'from':/.test(rd('epinoia', 'i18n', code, 'go.js'))));
const M = require(path.join(ROOT, 'epinoia', 'go', 'map.js'));
const one = M.fit([{ lat: 60.19, lng: 24.93 }], 800, 500);
ok('the map: one arena, a street-level view of it', one.z === 13 && one.lat === 60.19 && one.lng === 24.93, one);
const fin = [{ lat: 60.1896, lng: 24.9278 }, { lat: 60.4677, lng: 26.9458 }];
const inView = (v, p) => { const x = M.lngX(p.lng, v.z) - M.lngX(v.lng, v.z) + 400, y = M.latY(p.lat, v.z) - M.latY(v.lat, v.z) + 250;
  return x >= 47.5 && x <= 752.5 && y >= 47.5 && y <= 452.5; };
const f = M.fit(fin, 800, 500);
ok('...several: the closest zoom that shows them all, with a margin', fin.every(p => inView(f, p))
   && !fin.every(p => inView(Object.assign({}, f, { z: f.z + 1 }), p)), f);
ok('...Helsinki to Tokyo still on one screen', M.fit([{ lat: 60.19, lng: 24.93 }, { lat: 35.64, lng: 139.79 }], 800, 500).z === 3);
const mj = rd('epinoia', 'go', 'map.js');
ok('...OpenStreetMap\'s tiles as plain images (the CSP allows images from https), credited as their licence asks',
   /'https:\/\/tile\.openstreetmap\.org\/' \+ z/.test(mj) && /attr\.textContent = '© OpenStreetMap contributors';/.test(mj)
   && /https:\/\/www\.openstreetmap\.org\/copyright/.test(mj) && /img-src 'self' data: blob: https:;/.test(sp) && !/<script src="http/.test(sp));

console.log('\nthe logo, wherever the name is written');
const L = require(path.join(ROOT, 'epinoia', 'go', 'logo.js'));
const parts = L.split('Stamp a game on EPINOIA GO and add yours.');
ok('the name is found in a sentence, in either spelling', parts.length === 3 && parts[1] === null && parts[0] === 'Stamp a game on '
   && L.split('EPINOIΛ GO').length === 1 && L.split('Epinoia go') === null);
ok('...on every page that writes it, after the page is translated (the name is kept in every language)',
   ['go/index.html', 'go/stamps/index.html', 'go/photos/index.html', 'privacy/index.html', 'admin/platform/index.html']
     .every(p => /<script src="[./]*(go\/)?logo\.js\?v=\d+" defer><\/script>/.test(rd('epinoia', ...p.split('/'))))
   && /window\.EpinoiaI18n\.whenReady\(go\)/.test(rd('epinoia', 'go', 'logo.js')));
ok('...EPINOIΛ in the logotype and GO in Orbitron, lit: the rail\'s pair, in the kit',
   /\.go-logo \.gl-ep\{ font-family:'EpinoiaMark'/.test(rd('epinoia', 'kit', 'epinoia-kit.css'))
   && /\.go-logo \.gl-go\{ font-family:var\(--f-go,'Orbitron'/.test(rd('epinoia', 'kit', 'epinoia-kit.css')));
ok('...and the translations keep the name as it is, so it is found in Japanese and Spanish too',
   ['ja', 'es'].every(code => { const s = rd('epinoia', 'i18n', code, 'go.js'); return /'‹ back to EPINOIA GO': '[^']*EPINOIA GO[^']*'/.test(s); }));

console.log('\nin the rail (6.3)');
const nav = rd('epinoia', 'nav.js'), navCss = rd('epinoia', 'kit', 'nav.css'), kit = rd('epinoia', 'kit', 'epinoia-kit.css');
ok('EPINOIA GO is the row under "leagues" in the first rail, lit on its own pages',
   nav.indexOf('hlist.appendChild(leaguesRow);') < nav.indexOf('hlist.appendChild(goRow);')
   && nav.indexOf('hlist.appendChild(goRow);') < nav.indexOf('homePanel.append(htitle, hlist);')
   && /goRow\.href = root \+ 'go\/';/.test(nav) && /\/\\\/epinoia\\\/go\\\/\/\.test\(here\)/.test(nav));
ok('...EPINOIΛ in the logotype and GO in its own face, as a name (never translated)',
   /goWord\.append\(el\('span', 'epinoia-mark', 'EPINOIΛ'\), el\('span', 'go-go', 'GO'\)\)/.test(nav)
   && /goWord\.setAttribute\('translate', 'no'\)/.test(nav));
ok('GO is Orbitron 700, served from the site with its licence, declared in the kit and in nav.css (which loads without it)',
   /@font-face\{font-family:'Orbitron';src:url\('fonts\/orbitron\.woff2'\) format\('woff2'\);\s*font-weight:700/.test(kit)
   && /@font-face\{font-family:'Orbitron';src:url\('fonts\/orbitron\.woff2'\) format\('woff2'\);\s*font-weight:700/.test(navCss)
   && /--f-go:'Orbitron'/.test(kit) && /\.go-go\{ font-family:var\(--f-go,'Orbitron'/.test(navCss)
   && existsSync(path.join(ROOT, 'epinoia', 'kit', 'fonts', 'orbitron.woff2'))
   && /SIL Open Font License/.test(rd('epinoia', 'kit', 'fonts', 'OFL-orbitron.txt')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
