/* ============================================================================
   THE ARENA EDITOR (EPINOIA GO step 1.5, docs/epinoia-go.md): the platform console's Arenas tab
   (epinoia/admin/platform/arenas-ui.js) and migration 0164 (merge_venues, the venues_by_hand trigger).

   Run under Node: reading a Google Maps address for a pin (the place's own point before the map's
   centre, a short link explained, nonsense refused), which place id a moved pin keeps, the states and
   their order, the search; 0164 read from the file (who may merge, what moves, the audit, the trigger's
   "checked by"); the console's wiring; the words in Japanese and Spanish.

   0164 itself was run on a real Postgres (PGlite) with 19 checks, twice over, and the tab was driven in
   Chromium against the real Supabase SDK with 41 checks (English, Japanese, Spanish, a phone, dark).
   Both harnesses live outside the repo.

     node supabase/tests/arena-editor.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + JSON.stringify(d) : '')); } };

const A = require(path.join(ROOT, 'epinoia', 'admin', 'platform', 'arenas-ui.js'));

console.log('\nreading a Google Maps address');
const place = A.parseMapsLink('https://www.google.com/maps/place/Steveco+Areena/@60.4677,26.9400,17z/data=!3m1!4b1!4m6!3m5!1s0x4690:0x5b!8m2!3d60.46782!4d26.94601!16s%2Fg%2F11');
ok('a place page gives the place\'s own point, not the map\'s centre', place && place.how === 'place' && place.lat === 60.46782 && place.lng === 26.94601, place);
const centre = A.parseMapsLink('https://www.google.com/maps/@60.4,26.9,15z');
ok('a map with nothing clicked gives its centre, and says so', centre && centre.how === 'centre' && centre.lat === 60.4, centre);
const q = A.parseMapsLink('https://www.google.com/maps/search/?api=1&query=35.6377%2C139.7929&query_place_id=ChIJabcdefghij');
ok('a search link gives its point and its place id', q && q.how === 'query' && q.lng === 139.7929 && q.placeId === 'ChIJabcdefghij', q);
ok('typed coordinates are read', A.parseMapsLink(' 60.4712, 26.9432 ').how === 'typed' && A.parseMapsLink('-33.8688 151.2093').lng === 151.2093);
ok('a short link is explained, not guessed', A.parseMapsLink('https://maps.app.goo.gl/AbCdEf123').error === 'short');
ok('nothing to read is said to be nothing', A.parseMapsLink('Steveco Areena, Kotka').error === 'none' && A.parseMapsLink('') === null);
ok('coordinates off the globe, or 0,0, are refused', A.parseMapsLink('95.1, 20.2').error === 'none' && A.parseMapsLink('0.0, 0.0').error === 'none'
   && A.parseMapsLink('12.5, 190.5').error === 'none');

console.log('\na moved pin');
const v = { lat: 60.4677, lng: 26.9458, place_id: 'ChIJsteveco' };
ok('metres: one degree of latitude is about 111 km', Math.abs(A.metres({ lat: 60, lng: 25 }, { lat: 61, lng: 25 }) - 111195) < 200);
ok('a nudge (under 150 m) keeps the Google place', A.placeFor(v, { lat: 60.4682, lng: 26.9460 }) === 'ChIJsteveco' && A.KEEP_PLACE_M === 150);
ok('a real move drops it: it named the wrong place', A.placeFor(v, { lat: 60.49, lng: 26.95 }) === null);
ok('...unless the pasted address brings the right one', A.placeFor(v, { lat: 60.49, lng: 26.95, placeId: 'ChIJright' }) === 'ChIJright');
ok('Google Maps opens at the pin and on the exact place; with no pin, a search',
   A.mapsUrl({ lat: 1.5, lng: 2.5, place_id: 'ChIJx' }) === 'https://www.google.com/maps/search/?api=1&query=1.5,2.5&query_place_id=ChIJx'
   && A.mapsUrl({ name: 'Sofadon', city: null, country: 'GR', lat: null }) === 'https://www.google.com/maps/search/?api=1&query=Sofadon%2C%20GR');

console.log('\nthe list');
const rows = [
  { id: 1, name: 'B', lat: 1, lng: 1, pin_note: null, checked_at: null, games: [{ count: 5 }], city: 'Kotka' },
  { id: 2, name: 'A', lat: 1, lng: 1, pin_note: 'a shop', checked_at: null, games: [{ count: 60 }], teams: [{ name: 'Alvark Tokyo' }] },
  { id: 3, name: 'C', lat: null, lng: null, pin_note: 'not found on Google Maps', checked_at: null, games: [{ count: 15 }] },
  { id: 4, name: 'D', lat: 1, lng: 1, pin_note: null, checked_at: '2026-09-24', games: [{ count: 23 }], venue_aliases: [{ spelling: 'Ďalšia hala' }] },
  { id: 5, name: 'E', lat: null, lng: null, pin_note: null, checked_at: null, games: [{ count: 1 }] },
];
ok('a note means a look, whatever the pin; no pin and no note is not pinned; then checked or not',
   rows.map(A.stateOf).join() === 'pinned,look,look,checked,open', rows.map(A.stateOf));
ok('"needs a look" is the noted and the unpinned, the busiest first', A.sorted(rows, 'look', '').map(r => r.id).join() === '2,3,5');
ok('search finds a club, a town, and a spelling without its accents',
   A.sorted(rows, 'all', 'alvark')[0].id === 2 && A.sorted(rows, 'all', 'kotka')[0].id === 1 && A.sorted(rows, 'all', 'dalsia')[0].id === 4);

console.log('\nmigration 0164');
const sql = rd('supabase', 'migrations', '0164_arena_editor.sql');
ok('only a platform administrator merges', /if not public\.is_platform_admin\(\) then\s*raise exception 'platform administrators only' using errcode = '42501'/.test(sql));
ok('...never anonymously, and never one arena into itself',
   /revoke all on function public\.merge_venues\(uuid, uuid\) from public, anon;/.test(sql) && /p_keep = p_other then\s*raise exception 'two different arenas are needed'/.test(sql));
ok('spellings, games and clubs move before the row goes',
   /update venue_aliases set venue_id = p_keep[\s\S]*update games set venue_id = p_keep[\s\S]*update teams set home_venue_id = p_keep[\s\S]*delete from venues where id = p_other/.test(sql));
ok('both rows are locked in one order first', /from venues where id in \(p_keep, p_other\) order by id for update/.test(sql));
ok('a merge is one line in the audit log', /values \(auth\.uid\(\), 'venue_merge', 'venue'/.test(sql));
ok('"checked by" is always the person signed in', /new\.checked_by := case when new\.checked_at is null then null else me end/.test(sql));
ok('the pinning script (no person) is not logged as one', /if me is null then\s*return new;/.test(sql));
ok('0164 checks itself', /raise exception '0164: anon may call merge_venues'/.test(sql) && /raise exception '0164: venues_by_hand is not installed'/.test(sql));

console.log('\nthe console');
const html = rd('epinoia', 'admin', 'platform', 'index.html'), pjs = rd('epinoia', 'admin', 'platform', 'platform.js');
ok('an Arenas tab and its pane', /<button class="ep-tab" data-p="arenas" role="tab">Arenas<\/button>/.test(html) && /<div class="pane" id="pane-arenas"><div id="arenasHost"><\/div><\/div>/.test(html));
ok('arenas-ui.js is loaded, stamped', /<script src="arenas-ui\.js\?v=\d+" defer><\/script>/.test(html));
ok('drawn when the tab opens, with the signed-in id for "checked by"', /arenas: loadArenas/.test(pjs) && /A\.mount\(\{ host: '#arenasHost', sb, say, oops, me: me && me\.id \}\)/.test(pjs));
const ui = rd('epinoia', 'admin', 'platform', 'arenas-ui.js');
ok('names and notes are data: never through the translator', /const data = \(t, c, x\) => \{ const n = el\(t, c, x\); n\.setAttribute\('translate', 'no'\)/.test(ui)
   && /data\('div', 'org-title', v\.name\)/.test(ui) && /data\('span', null, v\.pin_note\)/.test(ui));
ok('Google Maps opens in a new tab and learns nothing about this page', /open\.target = '_blank'; open\.rel = 'noopener noreferrer'/.test(ui));
ok('no key anywhere in the page: the Maps link form needs none', !/key=|AIza/.test(ui));

console.log('\nthe words');
for (const code of ['ja', 'es']) {
  const src = rd('epinoia', 'i18n', code, 'platform.js');
  const words = ['needs a look', 'right as it is', 'Move the pin', 'The place’s own point', 'Distance from the pin now',
                 'Merge another arena into this one', 'A stamp must be within', 'Checked: stamps now trust this pin.', 'Arenas'];
  const miss = words.filter(w => !src.includes("'" + w + "':"));
  ok(code + ': the tab\'s words are there', !miss.length, miss);
  ok(code + ': an arena\'s address and name are not an email\'s or a person\'s (ctx.arenas)', /arenas: \{[\s\S]*'Address':[\s\S]*'Name':/.test(src));
  ok(code + ': the merge question, with both names', /Merge “\(\.\+\)” into “\(\.\+\)”/.test(src));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
