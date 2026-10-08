/* ============================================================================
   EPINOIΛ'S PICKS (0253), on every migration (PGlite):
     * the table is the service role's: no reader sees it, no reader writes it;
     * a fixture's pick is rewritten until its game tips off and FROZEN from then on; a pick first written after tip-off
       is a record; a record never replaces a pick already there;
     * game_forecast: nothing for a league the reader cannot see; signed out, "sign in"; signed in, the probability and
       the model's record in the league; memberships gating the What wins model, "members" for a reader without it;
     * prediction_model: the model's right, decided, pending and hit rate over the board's games (a league, games since a
       date, draws and void games out, a private league never on a public board), and how many fans with five decided
       picks or more it is ahead of.

     node supabase/tests/model-picks.test.mjs       (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0253_model_picks.sql');
console.log('the migration');
ok('the table is closed to readers and open to the service role', /revoke all on public\.model_picks from public, anon, authenticated;/.test(mig) && /grant all on public\.model_picks to service_role;/.test(mig));
ok('the two reads are granted to readers', /grant execute on function public\.game_forecast\(uuid\) to anon, authenticated;/.test(mig)
   && /grant execute on function public\.prediction_model\(uuid, timestamptz\) to anon, authenticated;/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed: the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0253 among them', !failed || failed.length === 0, failed);
  const as = async (uid, sql, p) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try { return (await db.query(sql, p)).rows; } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
  };
  const tryAs = async (...a) => { try { return await as(...a); } catch (e) { return { error: e.message }; } };
  const user = async email => (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;

  const L = (await one(`insert into public.leagues (slug, name) values ('slb', 'SLB') returning id`)).id;
  const LP = (await one(`insert into public.leagues (slug, name, visibility) values ('priv', 'Private', 'private') returning id`)).id;
  const comp = async lg => (await one(`with s as (insert into public.seasons (league_id, name) values ($1, '2026-27') returning id)
    insert into public.competitions (season_id, name) select id, 'League' from s returning id`, [lg])).id;
  const C = await comp(L), CP = await comp(LP);
  const team = async (lg, slug) => (await one(`insert into public.teams (league_id, slug, name) values ($1, $2, $2) returning id`, [lg, slug])).id;
  const A = await team(L, 'lei'), B = await team(L, 'bri'), PA = await team(LP, 'pa'), PB = await team(LP, 'pb');
  const game = async (c, h, a, status, when, hs, as_) => (await one(`insert into public.games (competition_id, home_team_id, away_team_id, status, tipoff_at, home_score, away_score)
      values ($1, $2, $3, $4, now() + $5::interval, $6, $7) returning id`, [c, h, a, status, when, hs, as_])).id;
  /* five played (home wins in four, an away win in one), one drawn, one tomorrow, one in the private league */
  const played = [];
  for (let i = 0; i < 5; i++) played.push(await game(C, A, B, 'final', '-' + (i + 2) + ' days', i === 4 ? 70 : 90, i === 4 ? 80 : 75));
  const GD = await game(C, A, B, 'final', '-8 days', 80, 80);
  const GT = await game(C, B, A, 'scheduled', '1 day', 0, 0);
  const GP = await game(CP, PA, PB, 'scheduled', '1 day', 0, 0);
  const pick = (g, lg, p, kind) => q(`insert into public.model_picks (game_id, league_id, p_home, kind, n_home, n_away, margin, sigma)
      values ($1, $2, $3::real, $4, 4, 4, 3.5, 12) on conflict (game_id) do nothing`, [g, lg, p, kind]);
  /* the model: right on four of the five (home on all five), the draw left out */
  for (const g of played) await pick(g, L, 0.66, 'record');
  await pick(GD, L, 0.55, 'record');
  await pick(GT, L, 0.41, 'fixture');
  await pick(GP, LP, 0.6, 'fixture');

  console.log('\nthe table');
  const U = await user('fan@example.invalid');
  ok('a reader sees nothing of it', !!(await tryAs(U, `select * from public.model_picks`)).error && !!(await tryAs(null, `select * from public.model_picks`)).error);
  ok('...and writes nothing to it', !!(await tryAs(U, `insert into public.model_picks (game_id, p_home, kind) values ($1, 0.9, 'fixture')`, [GT])).error);
  ok('the pick is the probability\'s side, never written', (await one(`select pick from public.model_picks where game_id = $1`, [GT])).pick === 'away'
     && !!(await q(`update public.model_picks set pick = 'home' where game_id = $1`, [GT]).then(() => null, e => e.message)));

  console.log('\nfrozen at tip-off');
  await q(`update public.model_picks set p_home = 0.38 where game_id = $1`, [GT]);
  ok('before tip-off a fixture pick is rewritten', +(await one(`select p_home from public.model_picks where game_id = $1`, [GT])).p_home < 0.39);
  await q(`update public.games set tipoff_at = now() - interval '1 minute' where id = $1`, [GT]);
  await q(`insert into public.model_picks (game_id, league_id, p_home, kind) values ($1, $2, 0.9, 'fixture')
           on conflict (game_id) do update set p_home = excluded.p_home`, [GT, L]);
  const frozen = await one(`select p_home, pick from public.model_picks where game_id = $1`, [GT]);
  ok('after tip-off it is frozen: a run\'s rewrite is dropped', +frozen.p_home < 0.39 && frozen.pick === 'away', frozen);
  const G9 = await game(C, A, B, 'final', '-1 day', 81, 70);
  await q(`insert into public.model_picks (game_id, league_id, p_home, kind) values ($1, $2, 0.7, 'fixture')`, [G9, L]);
  ok('a pick first written after tip-off is a record', (await one(`select kind from public.model_picks where game_id = $1`, [G9])).kind === 'record');
  await q(`delete from public.model_picks where game_id = $1`, [G9]);
  await q(`update public.games set tipoff_at = now() + interval '1 day' where id = $1`, [GT]);

  console.log('\ngame_forecast');
  ok('signed out: sign in', (await as(null, `select public.game_forecast($1) as j`, [GT]))[0].j.locked === 'signin');
  const f = (await as(U, `select public.game_forecast($1) as j`, [GT]))[0].j;
  ok('signed in: the probability, the pick, both clubs\' games, and the model\'s record in the league (4 of 5)',
     f && Math.abs(f.p_home - 0.38) < 0.001 && f.pick === 'away' && f.kind === 'fixture' && f.n[0] === 4 && f.record.right === 4 && f.record.decided === 5, f);
  const GN = await game(C, A, B, 'scheduled', '2 days', 0, 0);
  ok('a game it has no pick for: none', (await as(U, `select public.game_forecast($1) as j`, [GN]))[0].j.none === true);
  ok('a private league\'s game, to a reader who cannot see it: nothing', (await as(U, `select public.game_forecast($1) as j`, [GP]))[0].j === null);
  await q(`insert into public.platform_settings (key, value) values ('memberships_enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value`);
  await q(`insert into public.access_gates (key, gate) values ('model', 'club_report') on conflict (key) do update set gate = excluded.gate`);
  ok('memberships gating the What wins model: members', (await as(U, `select public.game_forecast($1) as j`, [GT]))[0].j.locked === 'members');
  await q(`update public.platform_settings set value = 'false'::jsonb where key = 'memberships_enabled'`);

  console.log('\nprediction_model');
  const fanPicks = async (uid, rightN) => { for (let i = 0; i < 5; i++) await q(`insert into public.game_predictions (game_id, user_id, pick, league_id) values ($1, $2, $3, $4)`,
    [played[i], uid, (i < rightN) === (i !== 4) ? 'home' : 'away', L]); };
  const F1 = await user('one@example.invalid'), F2 = await user('two@example.invalid');
  await fanPicks(F1, 2); await fanPicks(F2, 5);
  const m = (await as(null, `select public.prediction_model($1, null) as j`, [L]))[0].j;
  ok('its record over the league: 4 right of 5 decided (the draw out), one to play, 80%', m && m.correct === 4 && m.decided === 5 && m.pending === 1 && +m.pct === 80, m);
  const m2 = (await as(null, `select public.prediction_model(null, null) as j`))[0].j;
  ok('every league: the private league\'s pick is not on the public board', m2.pending === 1 && m2.decided === 5, m2);
  ok('...ahead of the fans with five decided picks it beats (one of two)', m.fans === 2 && m.ahead === 1, m);
  const m3 = (await as(null, `select public.prediction_model($1, now() - interval '3 days 12 hours') as j`, [L]))[0].j;
  ok('games since a date: only those', m3.decided === 2, m3);
  ok('a private league\'s board, to anybody: nothing', (await as(null, `select public.prediction_model($1, null) as j`, [LP]))[0].j === null);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
