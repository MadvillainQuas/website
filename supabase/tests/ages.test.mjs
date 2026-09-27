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

console.log('\n-- loadBio (the stats tables’ AGE / HT / WT)');
{
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
  const calls = [];
  const f = async (url, o) => { const ids = JSON.parse(o.body).p_ids; calls.push({ url, ids }); return { ok: true, json: async () => ids.filter(i => i !== 'empty').map(i => ({ player_id: i, height_cm: 198, weight_kg: null, age: 27, birth_year: 1999 })) }; };
  const st = mem();
  const got = await A.loadBio(CFG, ['a', 'b', 'empty'], f, st, 1000);
  ok('one call to player_bio; the answers are {id: {h, w, a, y}}', calls.length === 1 && calls[0].url === 'https://x.test/rest/v1/rpc/player_bio' && got.a.h === 198 && got.a.w === null && got.a.a === 27 && got.a.y === 1999 && !('empty' in got), { calls, got });
  const again = await A.loadBio(CFG, ['a', 'b', 'empty', 'c'], f, st, 1000 + 60000);
  ok('within half an hour only the new id is asked about; a player with nothing is remembered as nothing', calls.length === 2 && calls[1].ids.join() === 'c' && again.a.a === 27 && !('empty' in again), calls);
  await A.loadBio(CFG, ['a'], f, st, 1000 + 31 * 60000);
  ok('after half an hour it is asked again', calls.length === 3);
  const many = Array.from({ length: 1100 }, (_, i) => 'p' + i), c2 = [];
  await A.loadBio(CFG, many, async (u, o) => { c2.push(JSON.parse(o.body).p_ids.length); return { ok: true, json: async () => [] }; }, mem(), 5);
  ok('batches of 500', c2.join() === '500,500,100', c2);
  const st2 = mem();
  const none = await A.loadBio(CFG, ['a'], async () => ({ ok: false, status: 404 }), st2, 5);
  ok('the function AND the plain fallback both refused: nothing, no throw, and nothing remembered (so the next visit asks again)',
     Object.keys(none).length === 0 && st2.getItem('epinoia.bio.v2') === null);
  ok('a blocked store does not stop it', Object.keys(await A.loadBio(CFG, ['a'], f, { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } }, 5)).length === 1);
}

console.log('\n-- loadBio falls back to the plain, already-public columns before 0185 is deployed');
{
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
  const plainCalls = [];
  const f = async (url) => {
    if (url.includes('/rpc/player_bio')) return { ok: false, status: 404 };
    plainCalls.push(url);
    const ids = decodeURIComponent(url).match(/id=in\.\(([^)]*)\)/)[1].split(',');
    const rows = { a: { id: 'a', height_cm: 198, weight_kg: 95, birth_year: 1996 }, b: { id: 'b', height_cm: null, weight_kg: null, birth_year: null }, c: { id: 'c', height_cm: 210, weight_kg: null, birth_year: null } };
    return { ok: true, json: async () => ids.map(id => rows[id]).filter(Boolean) };
  };
  const st = mem();
  const got = await A.loadBio(CFG, ['a', 'b', 'c', 'nowhere'], f, st, new Date('2026-06-15').getTime());
  ok('the function is tried first, and refused (PGRST202/404) falls back to a plain read of players', plainCalls.length === 1 && plainCalls[0].includes('/rest/v1/players?id=in.'), plainCalls);
  ok('height and weight come through exactly, and the birth year as a year - never turned into an age', got.a.h === 198 && got.a.w === 95 && got.a.a === null && got.a.y === 1996, got);
  ok('a player with none of the three, and one never returned at all, are simply absent', !('b' in got) && !('nowhere' in got), got);
  ok('one with only a height has that and no age or year', got.c.h === 210 && got.c.a === null && got.c.y === null, got.c);
  const again = await A.loadBio(CFG, ['a', 'd'], f, st, new Date('2026-06-15').getTime() + 60000);
  ok('cached, like the function path: only the new id asks again', plainCalls.length === 2 && plainCalls[1].includes('(d)'), plainCalls);
  ok('...and the cached one still answers', again.a.h === 198);
  const st2 = mem();
  const none = await A.loadBio(CFG, ['x'], async (u) => (u.includes('/rpc/') ? { ok: false, status: 404 } : { ok: false, status: 500 }), st2, 5);
  ok('the plain read itself failing (not just an empty answer) is not cached either', Object.keys(none).length === 0 && st2.getItem('epinoia.bio.v2') === null);
}

console.log('\n-- bioColumns: each column only where the players have something for it');
{
  const C = A.bioColumns;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok('birth years and nothing else: BORN, and no AGE, HT or WT', same(C([{ y: 1996 }, { y: 2001 }, null]), { age: false, born: true, ht: false, wt: false }));
  ok('heights but no weights: HT and no WT', same(C([{ h: 198 }, { h: 0, w: 0 }]), { age: false, born: false, ht: true, wt: false }));
  ok('an exact age anywhere: AGE, and no BORN beside it', same(C([{ a: 27, y: 1999 }, { y: 2001 }]), { age: true, born: false, ht: false, wt: false }));
  ok('nothing at all (or nothing answered yet): no columns', same(C([]), { age: false, born: false, ht: false, wt: false }) && same(C([null, undefined, {}]), { age: false, born: false, ht: false, wt: false }));
  ok('ageFromYear is this year minus the year', A.ageFromYear(1996, new Date('2026-06-15').getTime()) === 30 && A.ageFromYear(null) === null);
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
ok('the player header asks for his age, adds it beside the year, and shows height and weight in the reader\'s units', /EpinoiaAges\.load\(CFG, \[pl\.id\]\)/.test(player) && /vitalsAge = m\[pl\.id\]/.test(player) && /item\('age', String\(vitalsAge\)\)/.test(player) && /U\.height\(pl\.height_cm\)/.test(player) && /U\.weight\(pl\.weight_kg\)/.test(player) && /item\('born', String\(pl\.birth_year\)\)/.test(player));
ok('the roster has an AGE column and a squad-average row', /\['#', 'PLAYER', 'POS'\]\.concat\(plan\.age \? \['AGE'\] : plan\.born \? \['BORN'\] : \[\]\)/.test(team) && /function squadAverages/.test(team) && /squadAverages\(squad, AGES, plan\)/.test(team));
ok('both pages load ages.js', /ages\.js\?v=\d+/.test(rd('epinoia', 'p', 'index.html')) && /ages\.js\?v=\d+/.test(rd('epinoia', 't', 'index.html')));

const FT = rd('epinoia', 'fulltable.js');
ok('the player tables have AGE / BORN, HT and WT right after the name, not in the drawer, and none on a team or career table',
   /k: 'bio_age'/.test(FT) && /k: 'bio_born'/.test(FT) && /idCols\.slice\(0, 2\)\.concat\(\s*BIO_COLS\.filter\(c => bioShown\[c\.show\]\),/.test(FT) && /const BIO = !isTeam && !opts\.nameLabel/.test(FT));
ok('...each shown only where the table has something for it (bioColumns over the rows held)', /bioShown = bioWhich\(list\)/.test(FT) && /A\.bioColumns\(list\.map/.test(FT));
ok('the roster decides its columns the same way, and a manager keeps every measurement box', /bioColumns\(squadP\.map/.test(team) && /MEASURES\.filter\(m => canEdit \|\|/.test(team));
ok('the league, stats and scouting pages load ages.js before fulltable.js', ['l', 'scouting', 'stats'].every(d => {
  const h = rd('epinoia', d, 'index.html'); return h.indexOf('../ages.js') > -1 && h.indexOf('../ages.js') < h.indexOf('../fulltable.js'); }));

const walk = d => readdirSync(d).flatMap(n => { const f = path.join(d, n); return statSync(f).isDirectory() ? (n === 'vendor' || n === 'node_modules' ? [] : walk(f)) : [f]; });
const named = walk(path.join(ROOT, 'epinoia')).filter(f => /\.(js|html)$/.test(f)).filter(f => /birth_date/.test(readFileSync(f, 'utf8')));
ok('no page or script under epinoia/ names the secret birth_date column', named.length === 0, named.map(f => path.relative(ROOT, f)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
