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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
