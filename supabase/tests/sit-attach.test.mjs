// data.js attachSit: the members' events lines (0190) are put back on the rows a reader is allowed them for.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' };
const D = require(path.join(here, '..', '..', 'epinoia', 'data.js'));
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };

const pgs = [{ game_id: 'g1', player_id: 'p1', team_idx: 0, stats: { pts: 5 } }, { game_id: 'g1', player_id: 'p2', team_idx: 1, stats: { pts: 2, sit: { v: 1, old: true } } }];
const tgs = [{ game_id: 'g1', team_idx: 0, stats: { pts: 80 } }, { game_id: 'g1', team_idx: 1, stats: { pts: 70 } }];
D.attachSit(pgs, tgs, [
  { game_id: 'g1', kind: 'p', team_idx: 0, player_id: 'p1', sit: { v: 1, all: [5] } },
  { game_id: 'g1', kind: 'p', team_idx: 1, player_id: 'p2', sit: { v: 1, new: true } },
  { game_id: 'g1', kind: 't', team_idx: 0, player_id: '', sit: { v: 1, all: [80] } }
]);
ok('a player row gets his line', pgs[0].stats.sit && pgs[0].stats.sit.all[0] === 5);
ok('a sit already on the row (not moved yet) is never overwritten', pgs[1].stats.sit.old === true && !pgs[1].stats.sit.new);
ok('a team row gets its side\'s line', tgs[0].stats.sit && tgs[0].stats.sit.all[0] === 80);
ok('a side with no line stays without', !tgs[1].stats.sit);
const a = [{ game_id: 'g', player_id: 'p', team_idx: 0, stats: {} }];
D.attachSit(a, [], []); D.attachSit(a, [], null);
ok('no lines (not entitled, or an older database) changes nothing', !a[0].stats.sit);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
