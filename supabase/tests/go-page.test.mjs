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
ok('no location in the page\'s own storage: only the intro seen, "later" for this visit, the country picked, and whether the account has a username',
   (js.match(/localStorage|sessionStorage/g) || []).length === 4 && !/indexedDB/.test(js)
   && /const KEYS = \{ intro: 'epinoia_go_intro', later: 'epinoia_go_intro_later', country: 'epinoia_go_country',\s*uname: 'epinoia_go_uname' \};/.test(js)
   && [...js.matchAll(/(?<!function )\bstored?\(([^,)]+)/g)].every(m => /^KEYS\.(intro|later|country|uname)$/.test(m[1].trim()))
   && /store\(KEYS\.uname, JSON\.stringify\(\{ u: S\.session\.userId, has: !!S\.username \}\)\)/.test(js));

console.log('\nthe redesign (Louie, 2026-09-24): the intro');
const css = rd('epinoia', 'go', 'go.css');
ok('the screen goes black on the light theme, white on the dark, and asks in a sans serif',
   /<div class="gi-msg" id="goIntroMsg">Please Enter A Username\.<\/div>/.test(html)
   && /\.go-intro\{[^}]*background:#fbfdfc;/.test(css) && /:root\[data-theme="light"\] \.go-intro\{background:#000;/.test(css)
   && /\.gi-msg\{font-family:var\(--f-ui\)/.test(css));
ok('...then "Have Fun!" takes the prompt\'s place, and the page comes back',
   /msg\.textContent = 'Have Fun!';/.test(js) && /box\.classList\.remove\('on'\);\s*entered\(\);/.test(js)
   && /<div class="gi-below">/.test(html));
ok('...once on a device; and for a fan with no username every visit until they choose one, or say later (for this visit)',
   /if \(noName\) return stored\(KEYS\.later, true\) === '1' \? null : 'ask';/.test(js) && /if \(stored\(KEYS\.intro\) === '1'\) return null;/.test(js)
   && /return S\.session \? 'welcome' : 'signin';/.test(js));
ok('..."Have Fun!" on the first visit only: after that, answering gives the page straight back (Louie, 7.11)',
   /const first = stored\(KEYS\.intro\) !== '1';/.test(js) && /if \(!first\) \{ setTimeout\(\(\) => fadeIntro\(box\), quick \? 0 : 300\); return; \}/.test(js)
   && js.indexOf('if (!first)') < js.indexOf("msg.textContent = 'Have Fun!';"));
const early = rd('epinoia', 'go', 'intro-early.js');
ok('...up before the page paints: intro-early.js, in the head and not deferred, from this browser\'s storage alone',
   /<script src="\.\.\/appmode\.js\?v=\d+"><\/script>\s*<script src="intro-early\.js\?v=\d+"><\/script>/.test(html)
   && html.indexOf('intro-early.js?v=') < html.indexOf('go.css?v=') && !/fetch\(|XMLHttpRequest|navigator\.geolocation/.test(early)
   && /html\.setAttribute\('data-go-intro', mode\)/.test(early) && /'epinoia_go_uname'/.test(early)
   && /html\[data-go-intro\] \.go-intro,html\[data-go-intro\] \.go-intro\[hidden\]\{display:grid;opacity:1\}/.test(css));
ok('...every mode\'s words in the page from the start (no script needed to say them)',
   /<p class="gi-note gi-if-signin">Sign in first:/.test(html) && /id="goIntroSignin" href="\.\.\/signin\/"/.test(html)
   && /id="goIntroLook" type="button">just looking</.test(html) && /id="goIntroLater" type="button">later</.test(html)
   && !/class="gi-form hide"/.test(html));
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
   /venues\?country=eq\./.test(js) && /teams!teams_home_venue_id_fkey\(name,short_name,colour,logo_path,leagues\(slug\)\)/.test(js)
   && /mountStrip\(host, list, photos\);/.test(js));
ok('...it slides on its own but is the fan\'s to take: dragged with the mouse (a drag is not a click), swiped, or moved by an arrow at each end',
   /const loop = n >= 3;/.test(js) && /const SPEED = 40;/.test(js) && /e\.pointerType !== 'mouse'/.test(js)
   && /if \(travelled > 5\) \{ e\.preventDefault\(\); e\.stopPropagation\(\)/.test(js)
   && /prev\.addEventListener\('click', \(\) => step\(-1\)\);/.test(js) && /'Previous arenas'/.test(js) && /'Next arenas'/.test(js)
   && /\.go-strip-view\{overflow-x:auto;/.test(css) && /\.go-strip-btn\{position:absolute;/.test(css) && !/go-slide/.test(css));
ok('...waiting while a pointer is over it, something in it has focus, or the fan has just moved it; still under reduced motion (the arrows jump)',
   /!hover && !focus && t > pausedUntil/.test(js) && /if \(reduced\(\)\) return;/.test(js) && /if \(reduced\(\)\) \{ pos \+= by; apply\(\); \}/.test(js)
   && ['ja', 'es'].every(code => ['Previous arenas', 'Next arenas'].every(w => rd('epinoia', 'i18n', code, 'go.js').includes("'" + w + "':"))));
const guess = o => G.countryGuess(Object.assign({ available: ['FI', 'GB', 'JP'] }, o));
ok('the country: the one picked before, then the clubs followed, the stamps, the time zone, the language, the first with arenas',
   guess({ stored: 'gb', follows: ['FI'] }) === 'GB' && guess({ follows: ['JP', 'JP', 'FI'], stamps: ['FI'] }) === 'JP'
   && guess({ stamps: ['FI', 'FI', 'GB'], tz: 'Asia/Tokyo' }) === 'FI' && guess({ tz: 'Asia/Tokyo', lang: 'en-GB' }) === 'JP'
   && guess({ tz: 'America/Chicago', lang: 'en-GB' }) === 'GB' && guess({ stored: 'US', tz: 'Europe/Paris' }) === 'FI');
ok('the feed: two rows of the fans\' photographs changing one at a time; with none, the outlines and the call',
   /const FEED_N = 10;/.test(js) && /'Prove your fandom — attend games, file them, take snaps!'/.test(js)
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

console.log('\ntoday\'s games, listed from the counts (7.11)');
const t0 = Date.parse('2026-10-03T16:00:00Z');
const lg = (id, lat, lng, op, cl, tip) => game({ game_id: id, lat, lng, opens_at: op, closes_at: cl, tipoff_at: tip });
const day = [lg('far', 60.4677, 26.9458, '2026-10-03T15:00:00Z', '2026-10-03T19:00:00Z', '2026-10-03T17:00:00Z'),
             lg('near', 60.1896, 24.9278, '2026-10-03T15:30:00Z', '2026-10-03T19:30:00Z', '2026-10-03T17:30:00Z'),
             lg('tomorrow', 60.1757, 24.8052, '2026-10-04T15:00:00Z', '2026-10-04T19:00:00Z', '2026-10-04T17:00:00Z')];
ok('open now: only games whose window is open, nearest first once the phone has said where it is',
   G.gamesFor('open', at(60.19, 24.93), t0, day).map(r => r.g.game_id).join() === 'near,far'
   && Math.round(G.gamesFor('open', at(60.19, 24.93), t0, day)[0].d) < 200);
ok('...by tip-off before that, with no distances', G.gamesFor('open', null, t0, day).map(r => r.g.game_id + ':' + r.d).join() === 'far:null,near:null');
ok('today and tomorrow: every game, by tip-off, under its day', G.gamesFor('all', at(60.19, 24.93), t0, day).map(r => r.g.game_id).join() === 'far,near,tomorrow'
   && G.dayLabel('2026-10-03T20:00:00Z', t0) === 'Today' && G.dayLabel('2026-10-04T17:00:00Z', t0) === 'Tomorrow');
ok('the two counts are buttons that open their list on a hover or a press; leagues stays a count',
   /chip\('open', 'Games open to stamp now'/.test(js) && /chip\('all', 'Today and tomorrow'/.test(js) && /chip\(null, 'Leagues'/.test(js)
   && /btn\.addEventListener\('mouseenter'/.test(js) && /openPop\(key, btn, true\);\s*whereAmI\(true\);/.test(js));
ok('a hover never makes the browser ask where the phone is: only a location this site may already have',
   /if \(!pressed\) \{[\s\S]{0,260}if \(state !== 'granted'\) return;/.test(js) && /openPop\(key, btn, false\); whereAmI\(false\);/.test(js));
ok('...how far is worked out on the phone: the location still goes to the server in the stamp call only',
   (js.match(/p_lat/g) || []).length === 1 && /metres\(pos, \{ lat: g\.lat, lng: g\.lng \}\)/.test(js));
ok('...and the privacy notice says the list and the find-a-game page use it, in its three answers, and says what the map is',
   (rd('epinoia', 'privacy', 'index.html').match(/open its list of today&rsquo;s games or its find-a-game page to see how far each one is/g) || []).length === 3
   && /Passport mode never uses it/.test(rd('epinoia', 'privacy', 'index.html')) && /map on the find-a-game page is Google&rsquo;s and loads only when you open a game/.test(rd('epinoia', 'privacy', 'index.html')));
ok('each game links to its page; at the arena, with its window open, it can be stamped from the list',
   /m\.href = '\.\.\/game\/\?g=' \+ encodeURIComponent\(g\.game_id\);/.test(js)
   && /const here = !!pos && placeOf\(g, pos, now\)\.state === 'here';/.test(js) && /if \(here && open && g\.trusted && !stamped\(g\.game_id\)\)/.test(js));
ok('a drop-down where a pointer can hover, a sheet from the foot of the screen on a phone; the list scrolls',
   /matchMedia\('\(hover: hover\) and \(min-width: 700px\)'\)/.test(js) && /\.go-pop\.sheet\{position:fixed;z-index:1200;left:0;right:0;bottom:0;/.test(css)
   && /\.gp-list\{[^}]*overflow-y:auto/.test(css));

console.log('\nGO\'s own layer in the rail, and its own bar on a phone (7.9)');
const navCss2 = rd('epinoia', 'kit', 'nav.css');
ok('a seventh panel on the deck, GO\'s, sized and slid like the others',
   /const goPanel = el\('div', 'panel gopanel'\);/.test(nav) && /view === 'go'      \? goPanel/.test(nav)
   && /goPanel\.setAttribute\('aria-hidden', String\(v !== 'go'\)\)/.test(nav)
   && /data-view="go"\] \.deck\{ transform:translateX\(-85\.7143%\)/.test(navCss2));
ok('"EPINOIA GO ›" opens it and goes nowhere (a modified click is still the link); the sheet stays open',
   /goRow\.append\(el\('span', 'ic', '◎'\), goWord, el\('span', 'lgo', '›'\)\);/.test(nav)
   && /goRow\.dataset\.railMove = '1';/.test(nav) && /e\.preventDefault\(\);\s*setView\('go', true\);/.test(nav));
ok('...its head: the way back to the platform layer, and the logo, the GO page',
   /goback\.addEventListener\('click', \(\) => setView\('home', true\)\);/.test(nav) && /goname\.href = root \+ 'go\/';/.test(nav));
ok('...its three places: home (the GO page), feed (the wall), your stamps, each lit on its own page',
   /platformRow\('◎', 'home', 'go\/', \/\\\/epinoia\\\/go\\\/\$\//.test(nav)
   && /platformRow\('▦', 'feed', 'go\/photos\/', \/\\\/epinoia\\\/go\\\/photos\\\/\//.test(nav)
   && /platformRow\('▣', 'your stamps', 'go\/stamps\/', \/\\\/epinoia\\\/go\\\/stamps\\\/\//.test(nav));
ok('GO\'s pages open the rail on it, and are nobody\'s league (the wall\'s ?l= is its own filter)',
   /nav\.dataset\.view = onGo \? 'go' : 'root';/.test(nav) && /setView\(onGo \? 'go' : country === null \? 'home' : 'root', false\)/.test(nav)
   && /const PLATFORM_PAGE = \/\\\/epinoia\\\/\(home\|games\|scouting\|go\)\\\/\/;/.test(nav));
ok('the phone\'s bar on GO\'s pages: home (GO\'s), feed, stamps, profile',
   /const GO_TABS = \[/.test(nav) && /\(onGo \? GO_TABS : PLATFORM_TABS\)\.forEach/.test(nav)
   && ["href: 'go/',", "href: 'go/photos/',", "href: 'go/stamps/',", "href: 'me/',"].every(h => nav.slice(nav.indexOf('const GO_TABS'), nav.indexOf('function paintPlatformTabs')).includes(h)));
ok('...in Japanese and Spanish: the rail\'s words and the bar\'s, in their own contexts ("feed" alone is a data feed elsewhere)',
   ['ja', 'es'].every(code => { const s = rd('epinoia', 'i18n', code + '.js');
     const nav0 = s.slice(s.indexOf('nav: {'), s.indexOf('}', s.indexOf('nav: {')));
     const tab0 = s.slice(s.indexOf('tab: {'), s.indexOf('}', s.indexOf('tab: {')));
     return /'feed':/.test(nav0) && /'your stamps':/.test(nav0) && /'feed':/.test(tab0) && /'stamps':/.test(tab0); }));
ok('the wall is THE FEED, as the GO page calls it', /<title>The feed · EPINOIA GO · Epinoia<\/title>/.test(rd('epinoia', 'go', 'photos', 'index.html'))
   && /<h2 id="gpTitle" data-i18n-ctx="gofeed">The feed<\/h2>/.test(rd('epinoia', 'go', 'photos', 'index.html'))
   && ['ja', 'es'].every(code => /gofeed: \{\s*'The feed':/.test(rd('epinoia', 'i18n', code, 'go.js'))));

console.log('\nan arena\'s clubs on its card, and the demo league\'s leftovers (7.10, 0170)');
const club = (name, lg, logo) => ({ name, leagues: lg ? { slug: lg } : null, logo_path: logo || null });
const shared = G.clubsAt({ teams: [club('B. Braun Sheffield Sharks', 'slb-men'), club('B. Braun Sheffield Hatters', 'slb-women')] });
ok('two clubs sharing a building: one arena, both on its card', shared.length === 2 && shared.map(c => c.name).join() === 'B. Braun Sheffield Hatters,B. Braun Sheffield Sharks');
ok('...the same club in two competitions once (London Lions, SLB and EuroCup)',
   G.clubsAt({ teams: [club('London Lions', 'slb-men'), club('London Lions', 'eurocup')] }).length === 1);
ok('...a club whose league the reader cannot see is on no card (the demo league\'s, left behind; a private league\'s)',
   G.clubsAt({ teams: [club('East Dock', null), club('London Lions', 'slb-men')] }).map(c => c.name).join() === 'London Lions'
   && G.clubsAt({ teams: [club('Neon City', null)] }).length === 0);
ok('...a sponsor in the name is still one club (Lietkabelis / Lietkabelis Panevezys)',
   G.clubsAt({ teams: [club('Lietkabelis', 'lkl', 'a.png'), club('Lietkabelis Panevežys', 'lkl', 'b.png')] }).length === 1
   && G.clubsAt({ teams: [club('Rytas', 'lkl', 'same.png'), club('Rytas Vilnius', 'lkl', 'same.png')] }).length === 1);
ok('...and the go hero title has no entrance animation', !/go-rise|go-neon|go-breathe/.test(rd('epinoia', 'go', 'go.css')));
ok('...a club with its crest first', G.clubsAt({ teams: [club('Alpha', 'x'), club('Beta', 'x', 'crest.png')] })[0].name === 'Beta');
ok('the strip asks for each club\'s league and keeps only arenas with a club to show',
   /teams!teams_home_venue_id_fkey\(name,short_name,colour,logo_path,leagues\(slug\)\)/.test(js) && /filter\(v => clubsAt\(v\)\.length && !mine\.has\(v\.id\)\)/.test(js));
const m170 = rd('supabase', 'migrations', '0170_go_demo_clubs_gone.sql');
ok('0170: the demo clubs, only when their league is gone; their games only when both sides are demo clubs, and a mixed one stops it all',
   /where league_id is null\s+and slug in \('neon-city', 'soft-club', 'harbour-bay', 'east-dock'\)/.test(m170)
   && /raise exception '0170: a demo club played a real one/.test(m170)
   && /delete from games where home_team_id = any\(demo\) and away_team_id = any\(demo\);/.test(m170)
   && m170.indexOf('delete from games') < m170.indexOf('delete from teams'));
ok('...their players by the demo prefix and only with no club', /p\.slug like 'neon-city-%'/.test(m170)
   && /and not exists \(select 1 from roster_entries r where r\.player_id = p\.id\);/.test(m170));
ok('...and GO offers only a league\'s games', /and l\.id is not null\s+-- 0170/.test(m170)
   && /grant execute on function public\.go_games_now\(\) to anon, authenticated;/.test(m170));
const nums170 = (await import('node:fs')).readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^0170_/.test(f));
ok('0170 is the only 0170', nums170.length === 1, nums170);

/* ---- FIND A GAME (7.13): go/nearby/, the rail row, passport mode ------------------------------------------ */
console.log('\nfind a game: the games nearest the fan in a window they set (7.13)');
const NB = require(path.join(ROOT, 'epinoia', 'go', 'nearby', 'nearby.js'));
const nbHtml = rd('epinoia', 'go', 'nearby', 'index.html'), nbJs = rd('epinoia', 'go', 'nearby', 'nearby.js');
const navSrc = rd('epinoia', 'nav.js');

ok('it measures like the GO page: the same arithmetic, to the metre',
   [[{ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 }], [{ lat: 60.19, lng: 24.93 }, { lat: 60.19, lng: 24.93 }],
    [{ lat: -37.82, lng: 144.98 }, { lat: 35.68, lng: 139.69 }]].every(([a, b]) => NB.metres(a, b) === G.metres(a, b)));
ok('...and says it in the same words (12 km, 340 m)', NB.distanceText(12345, 'en-GB') === G.distanceText(12345, 'en-GB')
   && NB.distanceText(343, 'en-GB') === G.distanceText(343, 'en-GB'));
ok('the windows are 24 hours to 30 days, 7 days first', NB.WINDOWS.map(w => w.key).join() === '24h,3d,7d,14d,30d'
   && NB.DEFAULT_WINDOW === '7d' && NB.windowOf('nonsense').key === '7d' && NB.windowOf('30d').hours === 720);

const arena = (id, lat, lng, extra) => Object.assign({ id, name: 'Arena ' + id, city: 'Town ' + id, country: 'GB', address: '1 Road', lat, lng, place_id: null, pin_note: null }, extra);
const venues = new Map([['v1', arena('v1', 51.55, -0.01)], ['v2', arena('v2', 53.4, -2.99)], ['v3', arena('v3', 35.68, 139.69, { pin_note: 'Google\'s best match is in GB' })]]);
const raw = (id, iso, vid, o) => Object.assign({ id, tipoff_at: iso, status: 'scheduled', venue: 'typed name', venue_address: null, venue_id: vid,
  home_team_id: 'h' + id, away_team_id: 'a' + id, competition_id: 'c1', home: { name: 'Home ' + id, home_venue_id: null }, away: { name: 'Away ' + id },
  competitions: { name: 'Cup', season_id: 's1', seasons: { leagues: { id: 'L', name: 'League', slug: 'lg', timezone: 'Europe/London' } } } }, o);
const T0 = Date.parse('2026-10-03T12:00:00Z');
const at2 = (h) => new Date(T0 + h * 3600000).toISOString();
const games = [raw('1', at2(30), 'v2'), raw('2', at2(5), 'v1'), raw('3', at2(2), 'v3'), raw('4', at2(-1), 'v1'), raw('5', at2(-6), 'v1'),
  raw('6', at2(60), null, { home: { name: 'Home 6', home_venue_id: 'v2' } }), raw('7', at2(8), null)].map(g => NB.shape(g, venues));
ok('a game\'s arena is its own, else its home club\'s usual one, else it has none',
   games[5].venue === 'Arena v2' && games[5].lat === 53.4 && games[6].lat === null && games[0].city === 'Town v2');
ok('...the league\'s time zone rides along', games[0].tz === 'Europe/London' && games[0].leagueSlug === 'lg');
ok('a pin nobody has checked is not trusted', games[2].trusted === false && games[0].trusted === true && games[6].trusted === false);
const near = NB.nearest(games, { lat: 51.5074, lng: -0.1278 }, T0, 24 * 7);
ok('nearest first, inside the window, a game that tipped off an hour ago is still on',
   near.shown.map(r => r.g.id).join() === '4,2,1,6', near.shown.map(r => r.g.id));
ok('...a game 6 hours gone and one with no arena are not offered', !near.shown.some(r => r.g.id === '5' || r.g.id === '7'));
ok('...the unchecked pin is counted, never placed (it would read as Japan to London)', near.unchecked === 1 && !near.shown.some(r => r.g.id === '3'));
ok('a short window is a shorter list', NB.nearest(games, { lat: 51.5074, lng: -0.1278 }, T0, 24).shown.map(r => r.g.id).join() === '4,2');
ok('...and the strip holds the nearest few', NB.nearest(games, { lat: 51.5074, lng: -0.1278 }, T0, 720, 2).shown.length === 2
   && NB.nearest(games, { lat: 51.5074, lng: -0.1278 }, T0, 720, 2).all === 4 && NB.SHOWN === 30);
ok('distances only grow along the strip', near.shown.every((r, i, a) => !i || a[i - 1].d <= r.d));

/* the time is the arena's, whatever machine reads it */
const nbTz = (iso, tz, mach, nowIso) => { process.env.TZ = mach; const w = NB.whenOf(iso, tz, Date.parse(nowIso), 'en-GB'); return w.day + ' ' + w.time + (w.local ? ' local' : '') + (w.tbc ? ' tbc' : ''); };
ok('19:30 in Melbourne reads 19:30 on any machine, with "local" where the clock is not the reader\'s',
   nbTz('2026-09-19T09:30:00Z', 'Australia/Melbourne', 'UTC', '2026-09-18T00:00:00Z') === 'Tomorrow 19:30 local'
   && nbTz('2026-09-19T09:30:00Z', 'Australia/Melbourne', 'Australia/Melbourne', '2026-09-18T00:00:00Z') === 'Tomorrow 19:30'
   && nbTz('2026-09-19T09:30:00Z', 'Australia/Melbourne', 'America/Los_Angeles', '2026-09-18T00:00:00Z').endsWith('19:30 local'));
ok('...the day is the arena\'s day: a Toronto game at 9 pm is that evening, not the next morning in London',
   nbTz('2026-09-21T01:00:00Z', 'America/Toronto', 'Europe/London', '2026-09-20T12:00:00Z') === 'Today 21:00 local');
ok('...no zone shows the reader\'s clock, no "local"', nbTz('2026-09-19T09:30:00Z', null, 'UTC', '2026-09-19T00:00:00Z') === 'Today 09:30'
   && nbTz('2026-09-19T09:30:00Z', 'Not/AZone', 'UTC', '2026-09-19T00:00:00Z') === 'Today 09:30');
ok('...midnight at the arena is a time not fixed yet', /tbc$/.test(nbTz('2026-09-19T14:00:00Z', 'Australia/Melbourne', 'UTC', '2026-09-18T00:00:00Z')));
process.env.TZ = 'UTC';

/* passport mode: places from the arenas we know, only pins somebody has checked */
const pv = [arena('a', 54.69, 25.28, { name: 'Vilnius Arena', city: 'Vilnius', country: 'LT' }), arena('b', 54.7, 25.3, { name: 'Ozas Hall', city: 'Vilnius', country: 'LT' }),
  arena('c', 55.7, 21.1, { name: 'Klaipeda Arena', city: 'Klaipėda', country: 'LT' }), arena('d', 35.68, 139.69, { name: 'Sアリ', city: 'Wembley', country: 'JP', pin_note: 'wrong' }),
  arena('e', -37.8, 144.9, { name: 'John Cain Arena', city: 'Melbourne', country: 'AU' })];
const places = NB.placesOf(pv);
ok('every city once (its arenas\' centre) and every arena; the unchecked pin is nowhere to stand',
   places.filter(p => p.kind === 'city').length === 3 && places.filter(p => p.kind === 'arena').length === 4 && !places.some(p => /Wembley|Sアリ/.test(p.label)));
ok('...a city sits between its arenas', (c => c.n === 2 && Math.abs(c.lat - 54.695) < 1e-9 && Math.abs(c.lng - 25.29) < 1e-9)(places.find(p => p.kind === 'city' && p.city === 'Vilnius')));
const names = { LT: 'Lithuania', AU: 'Australia' };
ok('search: an accent-free spelling finds it, a city before its arena, the country\'s name finds its places',
   NB.findPlaces(places, 'klaipeda', c => names[c])[0].label.startsWith('Klaipėda')
   && NB.findPlaces(places, 'vilnius', c => names[c])[0].kind === 'city'
   && NB.findPlaces(places, 'lithuania', c => names[c]).length === 5
   && NB.findPlaces(places, 'melb', c => names[c])[0].label === 'Melbourne, AU'
   && NB.findPlaces(places, 'zzzz', c => names[c]).length === 0);
ok('...nothing typed offers the cities, most arenas first', (l => l.length === 3 && l.every(p => p.kind === 'city') && l[0].city === 'Vilnius')(NB.findPlaces(places, '', c => names[c])));

const nbFin = (id, h, a, hs, as, t) => ({ id, home_team_id: h, away_team_id: a, home_score: hs, away_score: as, tipoff_at: t });
ok('a club\'s last five, oldest first, W or L',
   NB.formOf([nbFin(1, 'X', 'Y', 80, 70, '2026-09-01'), nbFin(2, 'Y', 'X', 90, 60, '2026-09-08'), nbFin(3, 'X', 'Z', 70, 71, '2026-09-15'), nbFin(4, 'Z', 'Y', 1, 2, '2026-09-16'),
     nbFin(5, 'X', 'Y', 88, 80, '2026-09-22')], 'X').join('') === 'WLLW' && NB.formOf([], 'X').length === 0
   && NB.formOf([nbFin(1, 'X', 'Y', 1, 0, '2026-01-01'), nbFin(2, 'X', 'Y', 1, 0, '2026-01-02'), nbFin(3, 'X', 'Y', 1, 0, '2026-01-03'), nbFin(4, 'X', 'Y', 1, 0, '2026-01-04'),
     nbFin(5, 'X', 'Y', 1, 0, '2026-01-05'), nbFin(6, 'X', 'Y', 0, 1, '2026-01-06')], 'X').join('') === 'WWWWL');

const gm = { lat: 54.6961, lng: 25.2929, venue: 'Avia Solutions Group Arena', city: 'Vilnius', placeId: 'ChIJxyz' };
ok('the map is the arena\'s pin on Google\'s embed, in the site\'s language; directions start from the passport place when there is one',
   NB.mapSrc(gm, 'ja') === 'https://www.google.com/maps?q=54.6961%2C25.2929&z=16&output=embed&hl=ja'
   && NB.directionsHref(gm, null) === 'https://www.google.com/maps/dir/?api=1&destination=54.6961%2C25.2929'
   && NB.directionsHref(gm, { lat: 51.5, lng: -0.12 }).endsWith('&origin=51.5%2C-0.12')
   && /query_place_id=ChIJxyz/.test(NB.mapHref(gm)));

ok('the location goes nowhere: the page sends no request of its own, and no read carries a position',
   !/fetch\(|XMLHttpRequest|sendBeacon|\/rpc\//.test(nbJs) && /EpinoiaData\.all\(/.test(nbJs) && /EpinoiaData\.season\(/.test(nbJs)
   && !/EpinoiaData\.(all|season)\([^)]*(S\.pos|S\.place|curPos)/.test(nbJs));
ok('...passport\'s place is kept for the visit (sessionStorage) and the window as a convenience (localStorage); the phone\'s own position is never kept',
   (nbJs.match(/store[d]?\(KEYS\.place[^\n]*/g) || []).length >= 3 && (nbJs.match(/store[d]?\(KEYS\.place[^\n]*/g) || []).every(l => /true\)/.test(l))
   && /store\(KEYS\.win, w\.key\)/.test(nbJs) && !/store\([^)]*S\.pos/.test(nbJs));
ok('a page that names its own words for the map only frames Google, and only on this page',
   /frame-src https:\/\/www\.google\.com"/.test(nbHtml) && !/frame-src/.test(rd('epinoia', 'go', 'index.html')) && !/frame-src/.test(rd('epinoia', 'go', 'stamps', 'index.html'))
   && /script-src 'self'; connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co; frame-src/.test(nbHtml));
ok('the page reads the games with the reader\'s own rights, so a private league\'s stay private',
   /EpinoiaAccess\.sessionReady/.test(nbJs) && /<script src="\.\.\/\.\.\/access\.js/.test(nbHtml) && /<script src="\.\.\/\.\.\/data\.js/.test(nbHtml));
ok('the strip is a real scroller with arrows that hide at its ends, a card is a button that opens the game',
   /'go-strip-view nb-view'/.test(nbJs) && /prev\.hidden = max < 2 \|\| view\.scrollLeft < 2/.test(nbJs) && /el\('button', 'vcard nb-card'\)/.test(nbJs)
   && /aria-expanded/.test(nbJs));

console.log('\nfind a game in the rail, the bar, and in three languages');
ok('GO\'s layer of the rail has it, after "your stamps", worded "find a game"',
   /platformRow\('⌖', 'find a game', 'go\/nearby\/', \/\\\/epinoia\\\/go\\\/nearby\\\/\//.test(navSrc)
   && navSrc.indexOf("'find a game', 'go/nearby/'") > navSrc.indexOf("'your stamps', 'go/stamps/'"));
ok('...and it is not a row of the root rail under EPINOIA GO itself (Louie: after EPINOIA GO has been clicked)',
   !/find a game|nearby/.test(navSrc.slice(navSrc.indexOf('const goRow'), navSrc.indexOf('hlist.appendChild(goRow)'))));
ok('GO\'s phone bar has it: home, feed, stamps, find, profile',
   (t => ['go/', 'go/photos/', 'go/stamps/', 'go/nearby/', 'me/'].every((h, i, a) => t.includes("href: '" + h + "'") && (!i || t.indexOf("href: '" + h + "'") > t.indexOf("href: '" + a[i - 1] + "'"))))(
     navSrc.slice(navSrc.indexOf('const GO_TABS'), navSrc.indexOf('function paintPlatformTabs'))));
ok('GO\'s pages, this one too, are nobody\'s league (the rail opens on GO)', /\\\/epinoia\\\/\(home\|games\|scouting\|go\)\\\//.test(navSrc) && /const onGo = \/\\\/epinoia\\\/go\\\//.test(navSrc));
ok('...the page loads the go, game and report words (the record and the story are the game page\'s)', /data-i18n-packs="go game report"/.test(nbHtml));
ok('...the rail\'s and the bar\'s words, and every sentence of the page, in Japanese and Spanish',
   ['ja', 'es'].every(code => { const core = rd('epinoia', 'i18n', code + '.js'), go = rd('epinoia', 'i18n', code, 'go.js');
     return /'find a game':/.test(core.slice(core.indexOf('nav: {'), core.indexOf('}', core.indexOf('nav: {')))) && /'find':/.test(core.slice(core.indexOf('tab: {'), core.indexOf('}', core.indexOf('tab: {'))))
       && ['Where are you?', 'Games near you', 'Passport mode', 'you are here', 'time to be confirmed', 'Games in this window', 'Not shown: the arena’s pin is being checked', 'local time', '2 weeks']
         .every(k => go.includes("'" + k + "'")); }));
ok('...no other site is named in what ships (the map link says Google Maps: the page frames it and the fan asked for it)',
   !/kenpom|basketball-reference|fivethirtyeight/i.test(nbHtml + nbJs + rd('epinoia', 'go', 'nearby', 'nearby.css')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
