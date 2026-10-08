/* ============================================================================
   EVERY STAMP ON THE FEED, AND THE LATEST ON HOME (EPINOIA GO, migration 0258), on every migration (PGlite):
     * every stamp is on the feed: a fan who went public under their username, everybody else as nobody in
       particular (no username, no account id);
     * a username searched for finds only that fan's named stamps - never the stamps of a fan who did not go public,
       whatever their username;
     * a youth league's stamps never, a private league's only to those who may see it;
     * go_stamps_latest: the newest first, named or not; `mine` true only on the reader's own;
     * neither read names an account id.

     node supabase/tests/go-every-stamp.test.mjs       (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0258_go_every_stamp.sql');
console.log('the migration');
ok('a name is shown only where the fan went public (0177\'s rule)', /gs\.public and gs\.stamps_public and gs\.adult_confirmed_at is not null/.test(mig));
ok('...and a username search never matches a stamp shown without one', /p_username is null or \(n\.shown is not null and lower\(n\.shown\) = lower\(p_username\)\)/.test(mig));
ok('both reads are open to readers', /grant execute on function public\.go_stamps_latest\(integer\) to anon, authenticated;/.test(mig)
   && /grant execute on function public\.go_feed\(uuid, uuid, uuid, text, text, integer, integer\) to anon, authenticated;/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed: the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0258 among them', !failed || failed.length === 0, failed);
  const as = async (uid, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try { return (await db.query(sql, p)).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
  };
  const user = async email => (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;

  const league = async (slug, extra) => (await one(`insert into public.leagues (slug, name${extra ? ', ' + extra[0] : ''}) values ($1, $1${extra ? ', $2' : ''}) returning id`,
    extra ? [slug, extra[1]] : [slug])).id;
  const L = await league('slb'), LY = await league('youth'), LP = await league('priv', ['visibility', 'private']);
  await q(`update public.leagues set go_photos = false where id = $1`, [LY]);
  const comps = new Map();
  const comp = async lg => {
    if (!comps.has(lg)) comps.set(lg, (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
      insert into public.competitions (season_id, name) select id, 'League' from s returning id`, [lg])).id);
    return comps.get(lg);
  };
  const team = async (lg, slug) => (await one(`insert into public.teams (league_id, slug, name) values ($1, $2, $2) returning id`, [lg, slug])).id;
  const V = (await one(`insert into public.venues (name, country, lat, lng) values ('Morningside Arena', 'GB', 52.6369, -1.1398) returning id`)).id;
  const game = async (lg, h, a, mins) => {
    const c = await comp(lg);
    return (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at) values ($1, $2, $3, 'final', now() - $4::interval) returning id`,
      [c, await team(lg, h), await team(lg, a), mins + ' minutes'])).id;
  };
  const G1 = await game(L, 'lei', 'bri', 120), G2 = await game(L, 'lon', 'man', 90), GY = await game(LY, 'u16a', 'u16b', 60), GP = await game(LP, 'pa', 'pb', 30);

  /* three fans: one gone public, one with a username who did not, one with no username at all */
  const PUB = await user('pub@example.invalid'), QUIET = await user('quiet@example.invalid'), NONAME = await user('noname@example.invalid');
  await q(`insert into public.usernames (user_id, username) values ($1, 'pub_fan'), ($2, 'quiet_fan')`, [PUB, QUIET]);
  await q(`insert into public.go_settings (user_id, public, stamps_public, adult_confirmed_at) values ($1, true, true, now()), ($2, false, false, null)`, [PUB, QUIET]);
  const stamp = (u, g, lg, mins) => q(`insert into public.stamps (user_id, venue_id, game_id, league_id, stamped_at) values ($1, $2, $3, $4, now() - $5::interval)`, [u, V, g, lg, mins + ' minutes']);
  await stamp(PUB, G1, L, 50); await stamp(QUIET, G1, L, 40); await stamp(NONAME, G2, L, 30);
  await stamp(QUIET, GY, LY, 20); await stamp(PUB, GP, LP, 10);

  console.log('\nthe feed');
  const feed = (await as(null, `select kind, username, game_id from public.go_feed()`)).filter(r => r.kind === 'stamp');
  ok('every stamp of a public league is on it: three', feed.length === 3, feed);
  ok('...the fan who went public under their username', feed.some(r => r.username === 'pub_fan' && r.game_id === G1));
  ok('...the others with no name: neither the quiet fan\'s username nor anything for the fan with none', feed.filter(r => r.username === null).length === 2 && !feed.some(r => r.username === 'quiet_fan'), feed);
  ok('a youth league\'s stamp: never', !feed.some(r => r.game_id === GY));
  ok('a private league\'s stamp: not to a stranger', !feed.some(r => r.game_id === GP));
  const byQuiet = await as(null, `select * from public.go_feed(null, null, null, 'quiet_fan')`);
  ok('searching the quiet fan\'s username finds nothing of theirs', byQuiet.length === 0, byQuiet);
  const byPub = (await as(null, `select username from public.go_feed(null, null, null, 'PUB_FAN')`)).filter(Boolean);
  ok('...searching the public fan\'s (any case) finds theirs', byPub.length === 1 && byPub[0].username === 'pub_fan', byPub);
  const cols = (await q(`select pg_get_function_result(p.oid) r from pg_proc p where p.proname in ('go_feed', 'go_stamps_latest')`)).map(r => r.r).join(' ');
  ok('neither read has an account id among its columns', !/(^|[ (,])user_id /.test(cols), cols);

  console.log('\nthe latest, for HOME');
  const latest = await as(null, `select username, mine, game_id, venue from public.go_stamps_latest(10)`);
  ok('newest first, named or not, a youth and a stranger\'s private league left out', latest.length === 3 && latest[0].game_id === G2 && latest[0].username === null
     && latest[2].username === 'pub_fan' && latest.every(r => r.venue === 'Morningside Arena'), latest);
  ok('...signed out, none is "mine"', latest.every(r => r.mine === false));
  const forQuiet = await as(QUIET, `select username, mine, game_id from public.go_stamps_latest(10)`);
  ok('the quiet fan sees their own stamp as theirs, still without their name', forQuiet.some(r => r.mine && r.game_id === G1 && r.username === null)
     && forQuiet.filter(r => r.mine).length === 1, forQuiet);
  ok('...and nobody else\'s as theirs', forQuiet.filter(r => !r.mine).every(r => r.game_id !== G1 || r.username === 'pub_fan'));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
