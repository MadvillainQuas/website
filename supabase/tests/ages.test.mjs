/* ============================================================================
   AGE AND BIRTH YEAR ON THE PAGES (epinoia/ages.js), never the date of birth.

     * load(): asks player_ages() in batches, tolerates a server without it (404) and a network failure, and never rejects;
     * bornWords() / summary(): the words beside a name, and a squad's average age, height and weight over the players who HAVE the number;
     * the pages: the player header and the team roster use it, the scripts are on the pages, and NO page or script under epinoia/
       ever names the birth_date column (it is a secret; the browser could not read it anyway, but nothing should even ask).

     node supabase/tests/ages.test.mjs
   ============================================================================ */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

const A = require(path.join(ROOT, 'epinoia', 'ages.js'));
const CFG = { supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' };

console.log('-- load');
{
  const calls = [];
  const f = async (url, o) => { calls.push({ url, body: JSON.parse(o.body), headers: o.headers }); return { ok: true, json: async () => JSON.parse(o.body).p_ids.filter(i => i !== 'nodate').map(i => ({ player_id: i, age: 27 })) }; };
  const m = await A.load(CFG, ['a', 'b', 'a', null, 'nodate'], f);
  ok('one request, ids de-duplicated, and it is the age function', calls.length === 1 && calls[0].url === 'https://x.test/rest/v1/rpc/player_ages' && calls[0].body.p_ids.join() === 'a,b,nodate', calls);
  ok('the answers are {id: age}; a player without one is simply absent', m.a === 27 && m.b === 27 && !('nodate' in m), m);
  ok('the anon key rides on it', calls[0].headers.apikey === 'anon');
  const many = Array.from({ length: 1200 }, (_, i) => 'p' + i);
  const c2 = [];
  await A.load(CFG, many, async (u, o) => { c2.push(JSON.parse(o.body).p_ids.length); return { ok: true, json: async () => [] }; });
  ok('more than 500 ids go in batches of 500', c2.join() === '500,500,200', c2);
  ok('a server without the function (404): no ages, no throw', Object.keys(await A.load(CFG, ['a'], async () => ({ ok: false, status: 404 }))).length === 0);
  ok('a network failure: no ages, no throw', Object.keys(await A.load(CFG, ['a'], async () => { throw new Error('offline'); })).length === 0);
  ok('nothing to ask about, nothing asked', (await A.load(CFG, [], async () => { throw new Error('asked'); })) && true);
  ok('a bad answer row is ignored', (await A.load(CFG, ['a'], async () => ({ ok: true, json: async () => [{ player_id: 'a', age: 'x' }, null, { player_id: 'b', age: 31 }] }))).b === 31);
}

console.log('\n-- the words');
ok('year and age', A.bornWords(1996, 30).join(' · ') === 'born 1996 · age 30');
ok('a year alone stays a year', A.bornWords(1996, undefined).join() === 'born 1996');
ok('an age of 0 is still an age; nothing at all is nothing', A.bornWords(null, 0).join() === 'age 0' && A.bornWords(null, null).length === 0);

console.log('\n-- a squad’s averages');
{
  const players = [{ id: 'a', height_cm: 200, weight_kg: 100 }, { id: 'b', height_cm: 190, weight_kg: null }, { id: 'c', height_cm: null, weight_kg: null }, { id: 'd', height_cm: 0, weight_kg: 90 }];
  const s = A.summary(players, { a: 30, b: 20 });
  ok('each average is over the players who have that number', s.age === 25 && s.ageN === 2 && s.height === 195 && s.heightN === 2 && s.weight === 95 && s.weightN === 2 && s.players === 4, s);
  const e = A.summary([], {});
  ok('an empty squad has no averages', e.age === null && e.height === null && e.weight === null && e.players === 0);
  ok('no ages given: no average age, the rest unaffected', A.summary(players, {}).age === null && A.summary(players, undefined).height === 195);
}

console.log('\n-- the pages');
const player = rd('epinoia', 'p', 'player.js'), team = rd('epinoia', 't', 'team.js');
ok('the player header asks for his age and adds it beside the year', /EpinoiaAges\.load\(CFG, \[pl\.id\]\)/.test(player) && /'age ' \+ m\[pl\.id\]/.test(player) && /'born ' \+ pl\.birth_year/.test(player));
ok('the roster has an AGE column and a squad-average row', /\['#', 'PLAYER', 'POS', 'AGE'\]/.test(team) && /function squadAverages/.test(team) && /squadAverages\(rows\.map/.test(team));
ok('both pages load ages.js', /ages\.js\?v=\d+/.test(rd('epinoia', 'p', 'index.html')) && /ages\.js\?v=\d+/.test(rd('epinoia', 't', 'index.html')));

const walk = d => readdirSync(d).flatMap(n => { const f = path.join(d, n); return statSync(f).isDirectory() ? (n === 'vendor' || n === 'node_modules' ? [] : walk(f)) : [f]; });
const named = walk(path.join(ROOT, 'epinoia')).filter(f => /\.(js|html)$/.test(f)).filter(f => /birth_date/.test(readFileSync(f, 'utf8')));
ok('no page or script under epinoia/ names the secret birth_date column', named.length === 0, named.map(f => path.relative(ROOT, f)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
