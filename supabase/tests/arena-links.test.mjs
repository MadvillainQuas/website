// An arena's "open in Maps" link goes to its PIN, not to a search for its name.
//
// Archers Arena, pinned by hand in Cardiff, opened "a random London place called Archers arena" from EPINOIA GO:
// the link searched the name (and a town that had been cleared), and Google picked its favourite arena of that
// name. The three builders below are read out of the real files and run.
//
//   node supabase/tests/arena-links.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

/* one top-level function, cut out of a file by its name and its balanced braces, and made callable */
function fnFrom(file, name) {
  const src = readFileSync(path.join(root, file), 'utf8');
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' is not in ' + file);
  let i = src.indexOf('{', at), depth = 0, end = i;
  for (; end < src.length; end++) { if (src[end] === '{') depth++; else if (src[end] === '}' && --depth === 0) break; }
  const ctx = {};
  vm.runInNewContext(src.slice(at, end + 1) + '\nthis.f = ' + name + ';', ctx);
  return ctx.f;
}

const CASES = [
  ['go/go.js', 'mapsHref', v => v, v => v.place_id],
  ['t/venue.js', 'mapsHref', v => v, v => v.place_id],
  ['go/nearby/nearby.js', 'mapHref', v => ({ venue: v.name, city: v.city, lat: v.lat, lng: v.lng, placeId: v.place_id }), v => v.place_id],
];
const archers = { name: 'Archers Arena', city: null, lat: 51.5094828, lng: -3.159897, place_id: null };
const withPlace = { name: 'Uber Arena', city: 'Berlin', lat: 52.5, lng: 13.44, place_id: 'ChIJ0123456789' };
const unpinned = { name: 'Some Hall', city: 'Luton', lat: null, lng: null, place_id: null };

for (const [file, name, shape] of CASES) {
  const f = fnFrom(file, name);
  console.log('-- ' + file);
  let u = f(shape(archers));
  ok('a hand-pinned arena opens at its coordinates', u.endsWith('query=' + encodeURIComponent('51.5094828,-3.159897')), u);
  ok('...and never carries the name that finds the wrong Archers Arena', !/Archers/.test(decodeURIComponent(u)), u);
  u = f(shape(withPlace));
  ok('an arena with a Google place keeps it, beside its pin', /query_place_id=ChIJ0123456789$/.test(u) && /query=52\.5%2C13\.44/.test(u), u);
  u = f(shape(unpinned));
  ok('an arena with no pin falls back to its name and town', decodeURIComponent(u).endsWith('query=Some Hall, Luton'), u);
}

/* THE GAME PREVIEW'S MAP AND ROUTE (Saga Ballooners' arena, pinned by hand in Japan, showed a map of London: the
   preview asked Google for the name "Sアリ") - the pin when the arena has one, else the address, else the name */
console.log('-- game/preview.js');
{
  const mapQuery = fnFrom('game/preview.js', 'mapQuery'), directionsHref = fnFrom('game/preview.js', 'directionsHref');
  // directionsHref calls mapQuery: run both in one context
  const src = readFileSync(path.join(root, 'game/preview.js'), 'utf8');
  const cut = n => { const at = src.indexOf('function ' + n + '('); let i = src.indexOf('{', at), d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}' && --d === 0) break; } return src.slice(at, e + 1); };
  const ctx = {}; vm.runInNewContext(cut('mapQuery') + '\n' + cut('directionsHref') + '\nthis.q = mapQuery; this.d = directionsHref;', ctx);
  const saga = { lat: 33.2764, lng: 130.3002, place_id: null };
  ok('a pinned arena is asked for at its pin, not by its name', ctx.q('Sアリ', null, saga) === '33.2764,130.3002', ctx.q('Sアリ', null, saga));
  ok('...even where the fixture carries an address', ctx.q('Sアリ', '1 Some Street, Saga', saga) === '33.2764,130.3002');
  ok('an arena with no pin keeps the address, then the name', ctx.q('Hall', '1 Road, Town', null) === '1 Road, Town' && ctx.q('Hall', '', { lat: null, lng: null }) === 'Hall' && ctx.q('', '', null) === '');
  ok('the route goes to the pin, with its Google place when it has one', ctx.d('Sアリ', null, saga) === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('33.2764,130.3002')
    && /&destination_place_id=ChIJabc$/.test(ctx.d('X', null, Object.assign({}, saga, { place_id: 'ChIJabc' }))) && ctx.d('', '', null) === '');
  const gameSrc = readFileSync(path.join(root, 'game/game.js'), 'utf8'), previewSrc = src;
  ok('game.js reads the pin off the arena\'s own row (where it was corrected) and hands it to the preview',
     /venues\?id=eq\.' \+ encodeURIComponent\(m\.venueId\) \+ '&select=id,lat,lng,place_id/.test(gameSrc) && /address: m\.venue_address, pin: pin,/.test(gameSrc));
  ok('...and the preview draws the map and the directions from it', /mapEmbed\(ctx\.venue, ctx\.address, ctx\.pin\)/.test(previewSrc) && /directionsHref\(ctx\.venue, ctx\.address, ctx\.pin\)/.test(previewSrc));
}
console.log('-- t/venue.js (the club\'s page)');
{
  const v = readFileSync(path.join(root, 't/venue.js'), 'utf8');
  ok('a home venue LINKED to an arena is shown at that arena\'s pin even when the club typed its own name for it',
     /const pinned = main && main\.lat != null && \(!team\.home_venue \|\| team\.home_venue_id\)/.test(v));
  ok('...with the arena\'s Google place on the "Open in Maps" and "Directions" links', /mapPane\(team, query, pinned && main\.place_id\)/.test(v)
     && /'&query_place_id='/.test(v) && /'&destination_place_id='/.test(v));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
