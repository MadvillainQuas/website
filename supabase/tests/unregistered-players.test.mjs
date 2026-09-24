/* ============================================================================
   A PLAYER WHO IS NOT ON THE REGISTER MUST NOT BREAK THE PAGE.

   CIBACOPA's box scores (Genius Sports) name some players only as "<side>:<shirt>",
   e.g. "0:12": the feed's person could not be matched to a register entry. Those ids
   went into `players?id=in.(...)` and `roster_entries?player_id=in.(...)`, which
   Postgres refuses ("invalid input syntax for type uuid"): a 400, no retry (a 4xx that
   is not 429 is an answer), and the whole read failed. The league's Team Stats, the
   leaders and the global tables all said "Could not load: 400 on players" and lost the
   clubs' names with them ("Team" and a grey "TE" where a name and crest belong).

   This runs the SHIPPED playerMeta against a fake database that answers the way
   PostgREST does: a 400 for any id list with a non-uuid in it. It has to send only the
   register ids, keep the others out of the queries, and still give every id a row.

     node supabase/tests/unregistered-players.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const requests = [];

globalThis.window = globalThis;
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://fake.invalid', supabaseAnonKey: 'anon' };
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  requests.push(u);
  const list = /\.in\.\(([^)]*)\)/.exec(u.replace('=in.(', '.in.(')) || /=in\.\(([^)]*)\)/.exec(u);
  const ids = list ? list[1].split(',') : [];
  const body = (status, j) => ({ ok: status < 300, status, headers: { get: h => (/content-range/i.test(h) ? '0-0/*' : null) },
                                 json: async () => j, text: async () => JSON.stringify(j) });
  if (ids.some(i => !UUID.test(i))) {
    return body(400, { code: '22P02', message: 'invalid input syntax for type uuid: "' + ids.find(i => !UUID.test(i)) + '"' });
  }
  if (/\/players\?/.test(u)) return body(200, ids.map(id => ({ id, first_name: 'First', last_name: id === A ? 'Alpha' : 'Beta', slug: 'p-' + id.slice(0, 2), photo_url: null })));
  if (/\/roster_entries\?/.test(u)) return body(200, ids.map(id => ({ player_id: id, jersey: '9', position: 'G',
    teams: { id: 't1', name: 'Zonkeys de Tijuana', short_name: 'Zonkeys', slug: 'zonkeys', colour: '#123456', logo_path: null } })));
  return body(200, []);
};

const D = require(path.join(ROOT, 'epinoia', 'data.js'));

console.log('\nplayerMeta with unregistered players in the list');
{
  const ids = [A, '0:12', B, '1:7', '0:13'];
  let got, err = null;
  try { got = await D.playerMeta(ids); } catch (e) { err = e; }
  ok('it does not throw a 400', !err, err && err.message);
  ok('no id list sent to the database contains a non-uuid',
     requests.length > 0 && requests.every(u => !/0:12|1:7|0:13/.test(u)), requests.join('\n          '));
  ok('the register ids come back with their names and club', got && got[A] && got[A].name === 'First Alpha' && got[A].teamName === 'Zonkeys');
  ok('...and the second one too', got && got[B] && got[B].name === 'First Beta');
  ok('every unregistered id still gets a row, named for its shirt',
     got && got['0:12'] && got['0:12'].name === 'Player #12' && got['1:7'].name === 'Player #7' && got['0:13'].jersey === '13');
  ok('an unregistered row has no club, so it does not borrow one',
     got && got['0:12'].teamId === null && got['0:12'].teamName === '');
  same(Object.keys(got || {}).length, 5, 'one row per id asked for');
}

console.log('\nplayerMeta with nobody registered');
{
  requests.length = 0;
  const got = await D.playerMeta(['0:5', '1:5']);
  ok('no request is made at all', requests.length === 0, requests.join(', '));
  ok('both still get a row', got['0:5'].name === 'Player #5' && got['1:5'].name === 'Player #5');
  const none = await D.playerMeta([]);
  ok('an empty list is an empty answer', Object.keys(none).length === 0);
}

console.log('\nthe other id lists');
{
  const bc = readFileSync(path.join(ROOT, 'epinoia', 'broadcast', 'broadcast.js'), 'utf8');
  ok('the broadcast card’s measurements and photographs ask only for register ids',
     (bc.match(/REGISTER_ID\.test\(String\(p\.id\)\)/g) || []).length === 2 &&
     !/if \(p\.id\) ids\.push\(p\.id\)/.test(bc));
  const gm = readFileSync(path.join(ROOT, 'epinoia', 'game', 'game.js'), 'utf8');
  ok('the box score page’s Latin-name lookup already did (PLAYER_ID)', /PLAYER_ID\.test\(String\(p\.id \|\| ''\)\)/.test(gm));
}

console.log('\nthe global table');
{
  const gl = readFileSync(path.join(ROOT, 'epinoia', 'global.js'), 'utf8');
  ok('an unregistered player is a shirt number, not somebody to scout: it is left out of the global rows',
     /m\.unregistered\) return;/.test(gl));
}

function same(got, want, n) { ok(n, got === want, 'got ' + got + ', want ' + want); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
