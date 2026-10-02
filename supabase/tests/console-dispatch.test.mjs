// 0217: THE CONSOLE'S JOBS SAY WHEN THEIR WORKER WAS STARTED, AND WHERE THEY STAND (docs/backfills.md). On a real
// Postgres (PGlite; skipped with a note when it is not installed): the migration loaded whole, on stand-ins for the
// tables 0135 and 0187 made and for is_platform_admin / is_league_admin as 0001 defines them:
//   * dispatched_at on both queues, the self-test passing on a database with leagues in it;
//   * season_backfill_queue: the requests asked for before this one, across every league (the worker takes the oldest
//     first), the seasons being read now, and when its worker was started; nothing ahead of one already running;
//   * only its league's administrators and the platform's may ask; a signed-out reader cannot call it at all.
// And the console-kick function: it reads the queue as its caller (row level security decides what they may start),
// holds the GitHub token as its own secret, starts console-jobs.yml, and notes when on the queued rows only.
//
//   node supabase/tests/console-dispatch.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const M = readFileSync(path.join(here, '..', 'migrations', '0217_console_dispatch.sql'), 'utf8');
const FN = readFileSync(path.join(here, '..', 'functions', 'console-kick', 'index.ts'), 'utf8');

console.log('the console-kick function');
ok('it reads the queue with the caller\'s own token, so row level security decides what they may start',
   /createClient\(URL_, ANON, \{\s*global: \{ headers: \{ Authorization: req\.headers\.get\('Authorization'\) \|\| '' \} \}/.test(FN) &&
   /caller\.from\(table\)\.select\('id,dispatched_at'\)\.eq\('state', 'queued'\)/.test(FN) && /why: 'nothing queued'/.test(FN));
ok('...the GitHub token is its own secret, and without it nothing is tried',
   /Deno\.env\.get\('GITHUB_DISPATCH_TOKEN'\)/.test(FN) && /if \(!TOKEN \|\| !\/\^\[\\w\.-\]\+\\\/\[\\w\.-\]\+\$\/\.test\(REPO\)\) return json\(\{ started: false, why: 'not set up' \}\);/.test(FN));
ok('...it starts console-jobs.yml by workflow_dispatch, and only a 204 counts',
   /api\.github\.com\/repos\/\$\{REPO\}\/actions\/workflows\/\$\{WORKFLOW\}\/dispatches/.test(FN) && /const WORKFLOW = 'console-jobs\.yml';/.test(FN) &&
   /if \(gh\.status !== 204\)/.test(FN));
ok('...not again within three minutes, and the service role notes when on queued rows alone',
   /const AGAIN_MS = 3 \* 60 \* 1000;/.test(FN) && /why: 'already started'/.test(FN) &&
   /admin\.from\(table\)\.update\(\{ dispatched_at: at \}\)\.in\('id', ids\)\.eq\('state', 'queued'\)/.test(FN));

let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database part: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('\nthe migration');

const PLAT = '44444444-4444-4444-4444-444444444444', LADMIN = '33333333-3333-3333-3333-333333333333', FAN = '11111111-1111-1111-1111-111111111111';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text);
  create table public.memberships (user_id uuid, role text, scope_type text, scope_id uuid);
  create function public.is_platform_admin() returns boolean language sql stable as $$
    select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'platform_admin' and m.scope_type = 'platform') $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$
    select public.is_platform_admin() or exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'league_admin'
      and m.scope_type = 'league' and m.scope_id = p) $$;
  /* 0135 + 0187's columns */
  create table public.season_backfills (
    id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues on delete cascade,
    season text not null, state text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed')),
    requested_by uuid, requested_at timestamptz not null default now(), claimed_at timestamptz, heartbeat_at timestamptz,
    finished_at timestamptz, worker text, sources_run int not null default 0, games_seen int not null default 0,
    games_written int not null default 0, error text, step text, detail jsonb not null default '{}'::jsonb);
  create unique index season_backfills_one_live on public.season_backfills (league_id, season) where state in ('queued', 'running');
  /* a guard trigger like 0135's, which the self-test turns off while it writes its own rows */
  create function public.no_old_seasons() returns trigger language plpgsql as $$ begin
    if new.season < '2000' then raise exception 'a season this old is refused'; end if; return new; end $$;
  create trigger season_backfills_guard before insert on public.season_backfills for each row execute function public.no_old_seasons();
  create table public.league_resets (id uuid primary key default gen_random_uuid(), league_id uuid not null, state text not null default 'queued',
    step text, detail jsonb not null default '{}'::jsonb, error text, requested_by uuid, requested_at timestamptz not null default now(),
    worker text, claimed_at timestamptz, heartbeat_at timestamptz, finished_at timestamptz);
  insert into public.leagues (slug, name) select 'l' || g, 'League ' || g from generate_series(1, 5) g;
`);

let applied = null;
try { await db.exec(M); applied = true; } catch (e) { applied = e.message; }
ok('the migration applies, its self-test included, on a database with leagues in it', applied === true, applied);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const cols = await q(`select table_name from information_schema.columns where column_name = 'dispatched_at' and table_schema = 'public' order by 1`);
ok('dispatched_at on both queues', cols.map(c => c.table_name).join() === 'league_resets,season_backfills', cols);
ok('...and the self-test left nothing behind', (await q(`select count(*)::int n from season_backfills`))[0].n === 0);
const g = await q(`select has_function_privilege('anon', 'public.season_backfill_queue(uuid)', 'execute') a,
                          has_function_privilege('authenticated', 'public.season_backfill_queue(uuid)', 'execute') b`);
ok('a signed-out reader cannot ask where a request stands; a signed-in one may (the function checks who)', g[0].a === false && g[0].b === true, g);

/* four leagues' requests, one running; the league admin administers league 4 */
const L = (await q(`select id from leagues order by slug`)).map(r => r.id);
await db.exec(`insert into memberships values ('${LADMIN}', 'league_admin', 'league', '${L[3]}'), ('${PLAT}', 'platform_admin', 'platform', null)`);
await q(`insert into season_backfills (league_id, season, state, requested_at) values
  ($1, '2023-24', 'queued',  now() - interval '3 hours'),
  ($2, '2023-24', 'queued',  now() - interval '2 hours'),
  ($3, '2023-24', 'running', now() - interval '5 hours')`, [L[0], L[1], L[2]]);
const [mine] = await q(`insert into season_backfills (league_id, season, state, requested_at, dispatched_at)
  values ($1, '2023-24', 'queued', now() - interval '1 hour', '2026-10-02T14:02:00Z') returning id`, [L[3]]);
const [later] = await q(`insert into season_backfills (league_id, season, state, requested_at) values ($1, '2022-23', 'queued', now()) returning id`, [L[0]]);
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const ask = async id => { try { return (await q(`select public.season_backfill_queue($1) j`, [id]))[0].j; } catch (e) { return { error: e.message }; } };

await as(LADMIN);
const a = await ask(mine.id);
ok('its league\'s administrator: two requests ahead (asked earlier, by other leagues), one season being read now, when its worker was started',
   a && a.ahead === 2 && a.running === 1 && a.state === 'queued' && /^2026-10-02T14:02:00/.test(a.dispatched_at), a);
await as(PLAT);
const b = await ask(later.id);
ok('the platform\'s administrator, for any league: the newest has three ahead of it', b && b.ahead === 3 && b.running === 1, b);
await db.exec(`update season_backfills set state = 'running' where id = '${mine.id}'`);
await as(LADMIN);
const c = await ask(mine.id);
ok('...a request being read has nothing ahead of it', c && c.ahead === 0 && c.state === 'running' && c.running === 2, c);
await as(FAN);
const d = await ask(mine.id);
ok('anybody else is refused', d && /do not administer/.test(d.error || ''), d);
await as(LADMIN);
ok('a request that does not exist: null', (await ask('00000000-0000-0000-0000-000000000000')) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
