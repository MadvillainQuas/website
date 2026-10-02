-- ============================================================================
-- 0219 — THE RECORDS BACKFILL TAKES ONE COMPETITION A CALL, AND NEVER WAITS.
--
-- 0215's records_backfill(p_max) built up to p_max competitions (25 suggested)
-- in ONE call, so one transaction. Each competition is built under its
-- advisory lock (records_lock, transaction-scoped), the lock a finalise takes
-- for the same competition, so a call held the first competition's lock until
-- the twenty-fifth was built: a game finalised in that league meanwhile waited
-- for all of them. And the call waited, in turn, for any finalise it met.
--
-- NOW (this file replaces the two functions; it works whether 0215 has been
-- backfilled or not, and needs nothing else changed):
--
--   records_backfill_step()   builds ONE competition (not built yet, or marked
--       stale), atomically, and says what is left:
--         {"built": 1, "competition": "<id>", "games": 272, "ms": 140,
--          "left": 41, "ready": false, "busy": 0}
--       * the competition's lock is TRIED, never waited for: a competition a
--         finalise is working on right now is passed over (counted in "busy")
--         and the next one taken; if every candidate is busy it builds nothing
--         and says so, and the caller simply asks again after its pause;
--       * so a finalise waits at most one competition's build (measured on
--         PGlite with every migration: 0.1 s for 30 games, 0.8 s for 300; the
--         biggest competition on the platform has 272 finished games), and
--         the backfill never queues behind anybody;
--       * lock_timeout 2 s for anything else it touches (a record_comps row a
--         finalise of the same competition is writing), and statement_timeout
--         20 s as a ceiling; PostgREST applies a function's statement_timeout
--         before the call (db-hoisted-tx-settings), so through the API it
--         holds; in the SQL editor it is the editor's own;
--       * finding the next competition and counting what is left read
--         competitions (a few hundred rows) and probe games through
--         games_competition_status (competition_id, status, finalised_at) and
--         record_comps' primary key: about 2 ms each. No new index.
--       When nothing is left it sets records_state.ready (as 0215 did), and
--       the pages switch to the kept records.
--
--   records_backfill(p_max)   kept for the call 0215's header printed: it is
--       now one step too (p_max is not honoured above one; repeat the call).
--
-- HOW TO RUN IT (docs/performance-audit.md, "Backfill"):
--   * paced, from GitHub: Actions -> "Records backfill" -> Run workflow
--     (.github/workflows/records-backfill.yml, scripts/records_backfill.mjs):
--     one step, a pause (1.5 s by default), the next, until "left" is 0, within
--     a time budget, one line logged a step. Also nightly at 03:23 UTC, which
--     costs one call once everything is built, and rebuilds any competition a
--     failure marked stale since;
--   * or by hand in the SQL editor, one competition a run:
--         select public.records_backfill_step();
--
-- THE TRIGGERS (0215) ARE NOT CHANGED. Measured with every migration applied
-- (supabase/tests/records-backfill.test.mjs prints the numbers): a live game's
-- score updated, the work 0215's games trigger adds is its WHEN clause (no
-- call: it only fires when a FINAL game's status, competition or score
-- changes); a box-score write to a game that is not final costs one statement
-- trigger and one look at games for the statement, never a row's worth of
-- work; a write to a final game's lines is applied where it reaches a list.
--
-- Never reads stats->sit. Idempotent: CREATE OR REPLACE, grants re-stated.
-- ============================================================================

create or replace function public.records_backfill_step()
returns jsonb
language plpgsql security definer
set search_path = public
set lock_timeout = '2s'
set statement_timeout = '20s'
as $$
declare
  t0     timestamptz := clock_timestamp();
  c      uuid;
  built  uuid;
  busy   int := 0;
  n      int;
  left_  int;
  rdy    boolean;
begin
  -- the next few competitions with a finished game and no good build, smallest
  -- uuid first (any order would do: each is built whole, on its own)
  for c in
    select co.id
      from public.competitions co
     where exists (select 1 from public.games g where g.competition_id = co.id and g.status = 'final')
       and not exists (select 1 from public.record_comps r where r.competition_id = co.id and not r.stale)
     order by co.id
     limit 8
  loop
    -- records_lock's key, tried: a finalise holding it is never waited for
    if pg_try_advisory_xact_lock(hashtextextended('epinoia.records:' || c::text, 0)) then
      perform public.records_count(c);
      perform public.records_rebuild(c);
      update public.record_comps set stale = false, built_at = now() where competition_id = c;
      built := c;
      exit;
    end if;
    busy := busy + 1;
  end loop;

  select count(*)::int into left_
    from public.competitions co
   where exists (select 1 from public.games g where g.competition_id = co.id and g.status = 'final')
     and not exists (select 1 from public.record_comps r where r.competition_id = co.id and not r.stale);
  if left_ = 0 then
    update public.records_state set ready = true, backfilled_at = coalesce(backfilled_at, now()) where id = 1;
  end if;
  select s.ready into rdy from public.records_state s where s.id = 1;
  if built is not null then
    select r.games into n from public.record_comps r where r.competition_id = built;
  end if;

  return jsonb_build_object(
    'built', case when built is null then 0 else 1 end,
    'competition', built,
    'games', coalesce(n, 0),
    'ms', round(extract(epoch from clock_timestamp() - t0) * 1000)::int,
    'left', left_,
    'ready', coalesce(rdy, false),
    'busy', busy);
exception when lock_not_available then
  -- a row a finalise is writing this moment: nothing built (the transaction's
  -- work is undone by the exception), ask again after the pause
  return jsonb_build_object('built', 0, 'competition', null, 'games', 0,
    'ms', round(extract(epoch from clock_timestamp() - t0) * 1000)::int,
    'left', null, 'ready', false, 'busy', busy + 1);
end
$$;

comment on function public.records_backfill_step() is
  '0219: builds ONE competition''s records (not built yet, or stale), never waiting for a finalise''s lock, and answers {built, competition, games, ms, left, ready, busy}. Repeat until left is 0: scripts/records_backfill.mjs, .github/workflows/records-backfill.yml.';

-- 0215's entry point, kept for the call its header printed: one step, whatever p_max says
create or replace function public.records_backfill(p_max int default 25)
returns jsonb
language sql security definer
set search_path = public
as $$
  select public.records_backfill_step();
$$;

comment on function public.records_backfill(int) is
  '0215, since 0219: one step of the backfill (records_backfill_step); p_max is no longer honoured above one. Repeat until left is 0.';

-- the service role (the workflow) and the SQL editor; never a browser
revoke execute on function public.records_backfill_step() from public, anon, authenticated;
revoke execute on function public.records_backfill(int)   from public, anon, authenticated;
grant execute on function public.records_backfill_step() to service_role;
grant execute on function public.records_backfill(int)   to service_role;
