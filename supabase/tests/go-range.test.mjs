/* ============================================================================
   EPINOIΛ GO: A STAMP FROM UP TO 1,000 M OF THE ARENA (0257), on every migration (PGlite):
     * an arena added from now on stamps from 1,000 m; every arena on the old 300 m default moved to 1,000 m; one set by
       hand to anything else keeps its own;
     * stamp_venue() itself, end to end, signed in as fans at a game whose window is open: 950 m stamps; 1,250 m is too
       far and says the radius is 1,000 m; the phone's doubt still allowed for (1,150 m with ±180 m stamps), never more
       than 200 m of it; an arena set by hand to 2,000 m stamps from 1,800 m;
     * go_games_now gives the page the arena's 1,000 m, and the pages fall back to 1,000 m too.

     node supabase/tests/go-range.test.mjs       (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0257_go_range_1000.sql');
console.log('the migration and the pages');
ok('the default becomes 1,000 m; only the arenas on the old 300 m default move', /alter column radius_m set default 1000;/.test(mig) && /update public\.venues set radius_m = 1000 where radius_m = 300;/.test(mig));
ok('...and it checks itself (the default in force, none left on 300)', /is distinct from '1000'/.test(mig) && /where radius_m = 300\) then/.test(mig));
const go = rd('epinoia', 'go', 'go.js'), vs = rd('epinoia', 'go', 'venuestamp.js'), ar = rd('epinoia', 'admin', 'platform', 'arenas-ui.js');
ok('the GO page and the game\'s STAMP THIS GAME fall back to 1,000 m, never 300', /radius_m \|\| 1000/.test(go) && /radius_m \|\| 1000/.test(vs) && !/radius_m \|\| 300/.test(go + vs + ar));
ok('...and the arena editor says 1,000 m is the default', /1000, the default, covers an arena/.test(ar));
/* the GO page's own reading (it only says which button to show; the server decides) */
{
  const { createRequire } = await import('node:module');
  const G = createRequire(import.meta.url)(path.join(ROOT, 'epinoia', 'go', 'go.js'));
  const now = Date.now(), N = (m) => 52.6369 + m / (6371008.8 * Math.PI / 180);
  const g = o => Object.assign({ game_id: 'g', lat: 52.6369, lng: -1.1398, radius_m: 1000, trusted: true,
    opens_at: new Date(now - 3600e3).toISOString(), closes_at: new Date(now + 3600e3).toISOString() }, o || {});
  const st = (o, m, acc) => G.placeOf(g(o), { lat: N(m), lng: -1.1398, accuracy: acc }, now).state;
  ok('the GO page: 950 m from an arena of 1,000 m shows the stamp button', st({}, 950, 20) === 'here');
  ok('...1,250 m shows how far', st({}, 1250, 10) === 'far');
  ok('...an arena the server sends no radius for is read as 1,000 m', st({ radius_m: null }, 950, 20) === 'here');
}

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed: the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0257 among them', !failed || failed.length === 0, failed);
  const as = async (uid, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await db.exec('set role authenticated');
    try { return (await db.query(sql, p)).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
  };
  const user = async email => (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;

  console.log('\nthe arenas');
  const LAT = 52.6369, LNG = -1.1398;                      // an arena's pin (Leicester)
  const fresh = (await one(`insert into public.venues (name, country, lat, lng) values ('New Arena', 'GB', $1, $2) returning radius_m`, [LAT, LNG])).radius_m;
  ok('an arena added from now on: 1,000 m', fresh === 1000, fresh);
  const old = (await one(`insert into public.venues (name, country, lat, lng, radius_m) values ('Old Default', 'GB', $1, $2, 300) returning id`, [LAT, LNG])).id;
  const own = (await one(`insert into public.venues (name, country, lat, lng, radius_m) values ('Set By Hand', 'GB', $1, $2, 2000) returning id`, [LAT, LNG])).id;
  const small = (await one(`insert into public.venues (name, country, lat, lng, radius_m) values ('Small Hall', 'GB', $1, $2, 150) returning id`, [LAT, LNG])).id;
  await db.exec(mig);                                       // what db push does to the arenas already there
  const r = async id => (await one(`select radius_m from public.venues where id = $1`, [id])).radius_m;
  ok('an arena on the old 300 m default moves to 1,000 m', await r(old) === 1000);
  ok('...one set by hand (2,000 m, 150 m) keeps its own', await r(own) === 2000 && await r(small) === 150, [await r(own), await r(small)]);
  ok('...and the migration may run again (it checks itself and passes)', true);

  console.log('\nstamping, end to end');
  const L = (await one(`insert into public.leagues (slug, name) values ('slb', 'SLB') returning id`)).id;
  const C = (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
    insert into public.competitions (season_id, name) select id, 'League' from s returning id`, [L])).id;
  const team = async slug => (await one(`insert into public.teams (league_id, slug, name) values ($1, $2, $2) returning id`, [L, slug])).id;
  const A = await team('lei'), B = await team('bri');
  const V = (await one(`insert into public.venues (name, country, lat, lng) values ('Morningside Arena', 'GB', $1, $2) returning id`, [LAT, LNG])).id;
  /* a fixture, then its arena (games_link_venue links one from the feed's venue name on insert; set afterwards, as an
     arena fixed by hand is, it stays) */
  const game = async (venue) => {
    const id = (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at)
      values ($1, $2, $3, 'scheduled', now() + interval '30 minutes') returning id`, [C, A, B])).id;
    await q(`update public.games set venue_id = $2 where id = $1`, [id, venue]);
    return id;
  };
  const G = await game(V), GH = await game(own);
  /* a point d metres due north of the pin (go_metres: the mean radius, 6,371,008.8 m) */
  const north = d => LAT + d / (6371008.8 * Math.PI / 180);
  const stamp = async (uid, g, d, acc) => (await as(uid, `select public.stamp_venue($1, $2, $3, $4) as j`, [g, north(d), LNG, acc]))[0].j;
  const s1 = await stamp(await user('a@example.invalid'), G, 950, 20);
  ok('950 m from the pin: stamped', s1 && s1.ok === true && s1.venue === 'Morningside Arena', s1);
  const s2 = await stamp(await user('b@example.invalid'), G, 1250, 10);
  ok('1,250 m: too far, and it says how far and that the radius is 1,000 m', s2 && s2.ok === false && s2.reason === 'too_far' && s2.radius_m === 1000 && Math.abs(s2.distance_m - 1250) <= 10, s2);
  const s3 = await stamp(await user('c@example.invalid'), G, 1150, 180);
  ok('1,150 m on a phone that says ±180 m: its doubt allowed for, stamped', s3 && s3.ok === true, s3);
  const s4 = await stamp(await user('d@example.invalid'), G, 1300, 900);
  ok('...but never more than 200 m of doubt: 1,300 m on ±900 m is too far', s4 && s4.ok === false && s4.reason === 'too_far', s4);
  const s5 = await stamp(await user('e@example.invalid'), GH, 1800, 0);
  ok('an arena set by hand to 2,000 m stamps from 1,800 m', s5 && s5.ok === true, s5);
  const s6 = await stamp((await one(`select id from auth.users where email = 'a@example.invalid'`)).id, G, 400, 5);
  ok('a fan already stamped is told so, not stamped twice', s6 && s6.ok === true && s6.already === true, s6);

  console.log('\nthe page\'s list');
  const U = await user('f@example.invalid');
  const now = await as(U, `select game_id, radius_m, trusted from public.go_games_now() where game_id = $1`, [G]);
  ok('go_games_now gives the page the arena\'s 1,000 m (the phone measures against it)', now.length === 1 && now[0].radius_m === 1000 && now[0].trusted === true, now);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
