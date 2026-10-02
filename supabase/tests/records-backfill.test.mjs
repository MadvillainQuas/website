/* ============================================================================
   THE RECORDS BACKFILL IS GENTLE ON THE LIVE DATABASE (0219), AND THE RECORDS'
   TRIGGERS COST A LIVE GAME NOTHING BUT A LOOK.

   The files first: records_backfill_step builds one competition a call and only
   TRIES the competition's lock (the key records_lock takes, so a finalise is
   never waited for), with a lock_timeout and a statement_timeout of its own;
   records_backfill(p_max) is one step; neither is callable from a browser. The
   runner (scripts/records_backfill.mjs, with a fake clock and fetch): one step,
   a pause, the next, until "left" is 0; a longer pause when every candidate was
   busy; the time budget; retries; quiet before the migration is pushed. The
   workflow: by hand and nightly, one at a time, with the service key.

   Then on a real Postgres (PGlite; skipped with a note when it is not
   installed), every migration applied, a platform's worth of finished games
   (one competition of 300, one of 120, ten of 20, a private league), records
   wiped as before the backfill:
     * step after step builds every competition, one a call, each call timed;
       the lists are exactly what a rebuild of every competition from nothing
       gives; records_state turns ready; a further call is a no-op of a few ms;
     * a competition a finalise already built is not built again;
     * records_backfill(25) builds one;
     * the planner finds the next competition through indexes;
     * the triggers, measured with and without them: a live game's score
       updated, a live game's box score upserted, a final game's line corrected.

     node supabase/tests/records-backfill.test.mjs
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { allMigrations } from './pg-all-migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const MIGDIR = path.join(here, '..', 'migrations');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '\n          ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 1200))); } };

const files = readdirSync(MIGDIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
const F = files.find(f => /^\d{4}_records_backfill_gentle\.sql$/.test(f));
const M = F ? readFileSync(path.join(MIGDIR, F), 'utf8') : '';
const M215 = readFileSync(path.join(MIGDIR, files.find(f => /^0215_/.test(f))), 'utf8');
const code = s => s.replace(/--[^\n]*/g, '');

/* ------------------------------------------------------------------ the files --- */
console.log('the migration (' + F + ')');
ok('it is there, after 0215', !!F && F > '0215');
const step = (code(M).match(/create or replace function public\.records_backfill_step\(\)[\s\S]*?\n\$\$;/) || [''])[0];
const lockKey = (M215.match(/pg_advisory_xact_lock\((hashtextextended\('epinoia\.records:' \|\| p_comp::text, 0\))\)/) || [])[1];
ok('one competition a call: the loop exits after the first it builds', /built := c;\s*exit;/.test(step));
ok('the competition\'s lock is TRIED, with records_lock\'s own key (0215), never waited for',
   !!lockKey && step.includes('pg_try_advisory_xact_lock(' + lockKey.replace('p_comp', 'c') + ')') && !/pg_advisory_xact_lock\(|records_lock\(/.test(step));
ok('...with a lock_timeout and a statement_timeout of its own, and a lock it cannot get is an answer, not an error',
   /set lock_timeout = '2s'/.test(step) && /set statement_timeout = '20s'/.test(step) && /exception when lock_not_available then/.test(step));
ok('it builds as 0215 did (count, rebuild, not stale) and sets ready when nothing is left',
   /perform public\.records_count\(c\);\s*perform public\.records_rebuild\(c\);\s*update public\.record_comps set stale = false/.test(step) &&
   /if left_ = 0 then\s*update public\.records_state set ready = true/.test(step));
ok('records_backfill(p_max) is one step', /create or replace function public\.records_backfill\(p_max int default 25\)[\s\S]*?select public\.records_backfill_step\(\);/.test(M));
ok('neither is callable from a browser; the service role may call both',
   /revoke execute on function public\.records_backfill_step\(\) from public, anon, authenticated;/.test(M) &&
   /revoke execute on function public\.records_backfill\(int\)\s+from public, anon, authenticated;/.test(M) &&
   /grant execute on function public\.records_backfill_step\(\) to service_role;/.test(M));
ok('it never reads the situations line', !/'sit'|->\s*'sit'/.test(code(M)));

console.log('\nthe runner (scripts/records_backfill.mjs)');
const R = await import(pathToFileURL(path.join(ROOT, 'scripts', 'records_backfill.mjs')).href);
function fake(answers) {
  const calls = [], sleeps = [], logs = []; let t = 0;
  return { calls, sleeps, logs, io: {
    fetch: async (url, init) => { calls.push({ url, init }); const a = answers.shift() || answers.last;
      return { ok: a.status ? a.status < 300 : true, status: a.status || 200, text: async () => typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? a) }; },
    sleep: async ms => { sleeps.push(ms); t += ms; }, now: () => t, log: s => logs.push(s) } };
}
{
  const ans = [{ built: 1, competition: 'c1', games: 30, ms: 40, left: 2, ready: false, busy: 0 },
               { built: 0, competition: null, games: 0, ms: 3, left: 2, ready: false, busy: 2 },
               { built: 1, competition: 'c2', games: 300, ms: 700, left: 1, ready: false, busy: 0 },
               { built: 1, competition: 'c3', games: 20, ms: 30, left: 0, ready: true, busy: 0 }];
  const f = fake(ans);
  const r = await R.run({ url: 'https://x.supabase.co/', key: 'svc', pause: 1.5, maxMinutes: 20 }, f.io);
  ok('it steps until "left" is 0, one call a step', r.stopped === 'done' && r.steps === 4 && r.built === 3 && r.ready && f.calls.length === 4, r);
  ok('...calling rpc/records_backfill_step with the service key, POST',
     f.calls.every(c => c.url === 'https://x.supabase.co/rest/v1/rpc/records_backfill_step' && c.init.method === 'POST' &&
                        c.init.headers.apikey === 'svc' && c.init.headers.Authorization === 'Bearer svc'));
  ok('...pausing between steps (1.5 s), twice as long after a step that found every candidate busy, and not after the last',
     JSON.stringify(f.sleeps) === JSON.stringify([1500, 3000, 1500]), f.sleeps);
  ok('...one log line a step', f.logs.filter(l => /^step \d+/.test(l)).length === 4 && /built 1 \(c2…, 300 games\) in 700 ms  ·  1 left/.test(f.logs.join('\n')), f.logs);
}
{
  const f = fake([]); f.io.fetch = async () => { const a = { built: 1, competition: 'c', games: 30, ms: 40, left: 50, ready: false, busy: 0 };
    return { ok: true, status: 200, text: async () => JSON.stringify(a) }; };
  const r = await R.run({ url: 'u', key: 'k', pause: 2, maxMinutes: 0.5 }, f.io);
  ok('it stops when the time budget is spent (and says to run again)', r.stopped === 'budget' && r.steps === 16 && /run again/.test(f.logs.at(-1)), [r, f.logs.at(-1)]);
}
{
  const f = fake([{ status: 404, body: '{"code":"PGRST202","message":"Could not find the function public.records_backfill_step"}' }]);
  const r = await R.run({ url: 'u', key: 'k', pause: 1, maxMinutes: 1 }, f.io);
  ok('before 0219 is pushed it says so and does nothing else', r.stopped === 'missing' && f.calls.length === 1 && /push the migrations/.test(f.logs[0]));
}
{
  const f = fake([{ status: 500, body: 'boom' }, { status: 503, body: 'busy' }, { built: 1, competition: 'c', games: 1, ms: 1, left: 0, ready: true }]);
  const r = await R.run({ url: 'u', key: 'k', pause: 1, maxMinutes: 1 }, f.io);
  ok('a failed call is retried (after 5 and 15 s)', r.stopped === 'done' && JSON.stringify(f.sleeps) === JSON.stringify([5000, 15000]), [r, f.sleeps]);
  const g = fake([{ status: 500, body: 'a' }, { status: 500, body: 'b' }, { status: 500, body: 'c' }]);
  const r2 = await R.run({ url: 'u', key: 'k', pause: 1, maxMinutes: 1 }, g.io);
  ok('...and a third failure stops the run', r2.stopped === 'failed' && g.calls.length === 3);
}
{
  const f = fake([{ built: 1, competition: 'c', games: 1, ms: 1, left: 9, ready: false }]);
  const r = await R.run({ url: 'u', key: 'k', pause: 1, maxMinutes: 1, once: true }, f.io);
  ok('--once: one step', r.stopped === 'once' && f.calls.length === 1 && R.parseArgs(['--once', '--pause', '3', '--max-minutes', '5']).pause === 3);
}

console.log('\nthe workflow (.github/workflows/records-backfill.yml) and the guard');
{
  const W = readFileSync(path.join(ROOT, '.github', 'workflows', 'records-backfill.yml'), 'utf8');
  ok('by hand (pause, budget) and nightly off-peak', /workflow_dispatch:/.test(W) && /pause_seconds:/.test(W) && /max_minutes:/.test(W) && /schedule:\s*\n\s*- cron: '23 3 \* \* \*'/.test(W));
  ok('...one run at a time, with the service key from the secrets, running the script',
     /concurrency:\s*\n\s*group: records-backfill\s*\n\s*cancel-in-progress: false/.test(W) &&
     /SUPABASE_SERVICE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/.test(W) &&
     /node scripts\/records_backfill\.mjs --pause "\$\{PAUSE:-1\.5\}" --max-minutes "\$\{MAX_MINUTES:-20\}"/.test(W));
  const G = readFileSync(path.join(ROOT, '.github', 'workflows', 'guard.yml'), 'utf8');
  ok('guard.yml runs this test and the advisor-views test, and watches the script and the workflow',
     /node supabase\/tests\/records-backfill\.test\.mjs/.test(G) && /node supabase\/tests\/advisor-views\.test\.mjs/.test(G) &&
     /'scripts\/records_backfill\.mjs'/.test(G) && /'\.github\/workflows\/records-backfill\.yml'/.test(G));
}

/* --------------------------------------------------------------- the database --- */
const T0 = Date.now();
const built = await allMigrations();
if (!built) { console.log('\nSKIP  the database part: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const { db, failed } = built;
console.log(`\nevery migration on PGlite (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
ok('they all apply', failed.length === 0, failed);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

/* a platform's worth of finished games; the records triggers off while it is loaded, and the records wiped after,
   as the live database is before its backfill */
const SIZES = [300, 120, ...Array(10).fill(20)];
const T1 = Date.now();
try {
  await db.exec(`
alter table public.games disable trigger records_game_ins; alter table public.games disable trigger records_game_upd;
alter table public.player_game_stats disable trigger records_lines_insert; alter table public.team_game_stats disable trigger records_lines_insert;
create table public.zz_rb (k text primary key, id uuid not null);
create function public.zz_v(g uuid, s int, i int, k text, r int) returns int language sql immutable as
  $v$ select floor(power((abs(hashtext(g::text || s || '-' || i || k)) % 10007) / 10007.0, 3) * r)::int $v$;
do $f$ declare lid uuid; sid uuid; cid uuid; th uuid; ta uuid; gid uuid; ci int; j int; sizes int[] := array[${SIZES.join(', ')}, 15];
begin
  perform set_config('epinoia.access_rpc', 'on', true);
  perform set_config('epinoia.visibility_rpc', 'on', true);
  for ci in 1 .. array_length(sizes, 1) loop
    insert into leagues (slug, name, visibility) values ('zz-rb-' || ci, 'RB ' || ci, case when ci = array_length(sizes, 1) then 'private' else 'public' end) returning id into lid;
    insert into seasons (league_id, name) values (lid, 'S') returning id into sid;
    insert into competitions (season_id, name) values (sid, 'C') returning id into cid;
    insert into teams (league_id, slug, name) values (lid, 'zz-rb-' || ci || 'h', 'H' || ci) returning id into th;
    insert into teams (league_id, slug, name) values (lid, 'zz-rb-' || ci || 'a', 'A' || ci) returning id into ta;
    insert into zz_rb values ('cp/' || ci, cid), ('th/' || ci, th), ('ta/' || ci, ta);
    for j in 1 .. sizes[ci] loop
      insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cid, th, ta, now() - make_interval(days => j), 'final', 60 + (j * 7) % 40, 60 + (j * 11) % 40) returning id into gid;
      if j = 1 then insert into zz_rb values ('g/' || ci, gid); end if;
      insert into player_game_stats (game_id, player_id, team_idx, stats)
      -- skewed like real lines: most games ordinary, a rare big one, so few lines tie for a best
      select gid, 'p' || s || '-' || i, s, jsonb_build_object('pts', zz_v(gid, s, i, 'pts', 50), 'ast', zz_v(gid, s, i, 'ast', 16), 'or', zz_v(gid, s, i, 'or', 9),
             'dr', zz_v(gid, s, i, 'dr', 15), 'stl', zz_v(gid, s, i, 'stl', 9), 'blk', zz_v(gid, s, i, 'blk', 8), 'p3m', zz_v(gid, s, i, 'p3m', 11), 'min', 600000 + i)
        from generate_series(0, 1) s, generate_series(1, 12) i;
      insert into team_game_stats (game_id, team_idx, stats)
      select gid, s, jsonb_build_object('adv', jsonb_build_object('fg3m', 4 + zz_v(gid, s, 0, '3', 18), 'ast', 8 + zz_v(gid, s, 0, 'a', 25),
             'oreb', 4 + zz_v(gid, s, 0, 'o', 14), 'dreb', 18 + zz_v(gid, s, 0, 'd', 20))) from generate_series(0, 1) s;
    end loop;
  end loop;
end $f$;
alter table public.games enable trigger records_game_ins; alter table public.games enable trigger records_game_upd;
alter table public.player_game_stats enable trigger records_lines_insert; alter table public.team_game_stats enable trigger records_lines_insert;
delete from public.record_lines; delete from public.record_comps; update public.records_state set ready = false, backfilled_at = null;
analyze;`);
} catch (e) { console.log('fixture failed: ' + e.message + ' / ' + (e.where || '')); process.exit(1); }
const RB = Object.fromEntries((await q('select k, id from zz_rb')).map(r => [r.k, r.id]));
const nComps = (await one(`select count(distinct competition_id)::int n from games where status = 'final' and competition_id is not null`)).n;
console.log(`  fixture: ${(await one('select count(*)::int n from games')).n} games, ${(await one('select count(*)::int n from player_game_stats')).n} player lines, ${nComps} competitions with a final (${((Date.now() - T1) / 1000).toFixed(1)} s)`);

console.log('\nthe backfill, a step at a time');
/* a finalise reaches one competition first: it is built by the trigger, and the backfill passes it over */
await db.exec(`insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
               values ('${RB['cp/5']}', '${RB['th/5']}', '${RB['ta/5']}', now(), 'final', 99, 98)`);
ok('a finalise in a competition not built yet builds it (0215\'s trigger)', !!(await one(`select 1 x from record_comps where competition_id = $1 and not stale`, [RB['cp/5']])));

const steps = [];
for (let i = 0; i < nComps + 3; i++) {
  const t = performance.now();
  const r = (await one('select public.records_backfill_step() r')).r;
  steps.push({ ...r, wall: performance.now() - t });
  if (r.left === 0 && !r.built) break;
}
const builds = steps.filter(s => s.built);
const bySize = [...builds].sort((a, b) => b.games - a.games);
for (const s of bySize.slice(0, 3).concat(bySize.slice(-1))) console.log(`        one step: ${String(s.games).padStart(3)} games built in ${s.ms} ms (call ${s.wall.toFixed(0)} ms, PGlite)`);
const noop = steps.at(-1);
console.log(`        the call once everything is built: ${noop.wall.toFixed(1)} ms`);
ok('one competition a step, each built once, the one a finalise built passed over', builds.length === nComps - 1 &&
   new Set(builds.map(s => s.competition)).size === builds.length && !builds.some(s => s.competition === RB['cp/5']), builds.length);
ok('"left" counts down to 0, and the last build says ready', builds.every((s, i) => s.left === nComps - 2 - i) && builds.at(-1).ready, steps.map(s => s.left));
ok('...then a step builds nothing, a few milliseconds', !noop.built && noop.left === 0 && noop.ready && noop.wall < 50, noop);
ok('every step is short: under 2 s on PGlite, the 300-game competition included', builds.every(s => s.ms < 2000), bySize.slice(0, 2));
ok('records_state is ready', (await one('select ready from records_state')).ready === true);

/* the lists are exactly a rebuild's from nothing */
const snap = async () => JSON.stringify(await q(`select competition_id, kind, cat, game_id, subject, pid, side, value from record_lines order by 1, 2, 3, 4, 5`));
const afterBackfill = await snap();
await db.exec(`do $r$ declare c uuid; begin for c in select distinct competition_id from games where status = 'final' and competition_id is not null loop perform public.records_rebuild(c); end loop; end $r$;`);
ok('the lists are exactly what rebuilding every competition from nothing gives', afterBackfill === await snap() && afterBackfill.length > 1000);

await db.exec(`update record_comps set stale = true where competition_id in ('${RB['cp/1']}', '${RB['cp/2']}')`);
const r25 = (await one('select public.records_backfill(25) r')).r;
ok('records_backfill(25), the call 0215 printed, builds one competition', r25.built === 1 && r25.left === 1, r25);
await one('select public.records_backfill_step()');

/* the planner: the next competition is found through indexes, never a scan of every game */
{
  const plan = (await q(`explain select co.id from public.competitions co
     where exists (select 1 from public.games g where g.competition_id = co.id and g.status = 'final')
       and not exists (select 1 from public.record_comps r where r.competition_id = co.id and not r.stale) order by co.id limit 8`)).map(r => r['QUERY PLAN']).join('\n');
  ok('the next competition: games probed by competition through an index, no scan of games', /Index (Only )?Scan using games_competition\w* on games g/.test(plan) && !/Seq Scan on games/.test(plan), plan);
}
/* who may call it */
{
  const g = await one(`select has_function_privilege('anon', 'public.records_backfill_step()', 'execute') a, has_function_privilege('authenticated', 'public.records_backfill_step()', 'execute') u,
                              has_function_privilege('service_role', 'public.records_backfill_step()', 'execute') s, has_function_privilege('authenticated', 'public.records_backfill(int)', 'execute') u2`);
  ok('only the service role (and the owner) may call it', !g.a && !g.u && g.s && !g.u2, g);
}

/* ------------------------------------------------------------------ the triggers --- */
console.log('\nthe records\' triggers on a game night (with and without them, medians, PGlite)');
await db.exec(`do $l$ declare gid uuid; begin
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
  values ('${RB['cp/3']}', '${RB['th/3']}', '${RB['ta/3']}', now(), 'live', 10, 8) returning id into gid;
  insert into zz_rb values ('live', gid);
  insert into player_game_stats (game_id, player_id, team_idx, stats)
  select gid, 'p' || s || '-' || i, s, jsonb_build_object('pts', i, 'min', 1000) from generate_series(0, 1) s, generate_series(1, 12) i;
end $l$;`);
RB.live = (await one(`select id from zz_rb where k = 'live'`)).id;
const finalGame = RB['g/2'];
const TRIG = { games: ['records_game_ins', 'records_game_upd', 'records_game_del'],
               player_game_stats: ['records_lines_insert', 'records_lines_update', 'records_lines_delete'],
               team_game_stats: ['records_lines_insert', 'records_lines_update', 'records_lines_delete'] };
const triggers = async on => { for (const [t, ns] of Object.entries(TRIG)) for (const n of ns) await db.exec(`alter table public.${t} ${on ? 'enable' : 'disable'} trigger ${n}`); };
async function measure(label, sql, n) {
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const on = [], off = [];
  for (let block = 0; block < 4; block++) {
    const isOn = block % 2 === 0;
    await triggers(isOn);
    for (let i = 0; i < n; i++) { const t = performance.now(); await db.query(sql, [i]); (isOn ? on : off).push(performance.now() - t); }
  }
  await triggers(true);
  const r = { on: med(on), off: med(off) };
  console.log(`        ${label.padEnd(58)} ${r.off.toFixed(3)} ms without, ${r.on.toFixed(3)} ms with (+${(r.on - r.off).toFixed(3)} ms)`);
  return r;
}
const score = await measure('a live game\'s score updated', `update public.games set home_score = home_score + 1 + $1::int * 0 where id = '${RB.live}'`, 150);
const box = await measure('a live game\'s 24 player lines upserted (one statement)',
  `insert into public.player_game_stats (game_id, player_id, team_idx, stats)
   select '${RB.live}', 'p' || s || '-' || i, s, jsonb_build_object('pts', i + $1::int, 'min', 1000 + $1::int) from generate_series(0, 1) s, generate_series(1, 12) i
   on conflict (game_id, player_id) do update set stats = excluded.stats`, 150);
const tline = await measure('a live game\'s two team lines upserted',
  `insert into public.team_game_stats (game_id, team_idx, stats) select '${RB.live}', s, jsonb_build_object('adv', jsonb_build_object('ast', $1::int)) from generate_series(0, 1) s
   on conflict (game_id, team_idx) do update set stats = excluded.stats`, 150);
const fix = await measure('a FINAL game\'s line corrected (one row, stays off the lists)',
  `update public.player_game_stats set stats = stats || jsonb_build_object('fd', $1::int) where game_id = '${finalGame}' and player_id = 'p0-1'`, 60);
ok('a live game\'s score: the WHEN clause only, nothing called', score.on - score.off < 0.05 + score.off * 0.15, score);
ok('a live game\'s box score: one look at games a statement', box.on - box.off < 0.6 + box.off * 0.25, box);
ok('...and its team lines the same', tline.on - tline.off < 0.4 + tline.off * 0.25, tline);
ok('a final game\'s correction does the records\' work, and only then (a few ms, not a rebuild)', fix.on - fix.off < 25, fix);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
