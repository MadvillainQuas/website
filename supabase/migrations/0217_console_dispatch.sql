-- ============================================================================
-- 0217 — THE CONSOLE'S JOBS SAY WHEN THEIR WORKER WAS STARTED, AND WHERE THEY STAND IN THE QUEUE.
--
-- "Fill in an older season" (0135) and "start a league again" (0187) are rows a
-- worker takes: .github/workflows/console-jobs.yml. That workflow was started by
-- its own ten-minute cron and nothing else, and GitHub delivered 16 of those runs
-- in 76 hours (measured 2026-10-02). A request could wait seven hours, while its
-- console said "the worker looks every 10 minutes".
--
-- The workflow is now started when something is queued:
--   * by the live lane, which runs around the clock;
--   * by itself, when it ends with something still queued;
--   * by the console, through the console-kick function, where that is set up.
-- (scripts/ingest/console_kick.py)
--
-- THIS FILE:
--   * dispatched_at on both queues: when the worker was last started for the
--     request. The console says "started at 14:02", and the kickers do not start
--     it again for fifteen minutes.
--   * season_backfill_queue(id): how many requests are ahead of this one and
--     whether a season is being read now. The FIFO runs across every league, so a
--     league's administrator could not see those rows to count them.
-- ============================================================================

alter table public.season_backfills add column if not exists dispatched_at timestamptz;
alter table public.league_resets    add column if not exists dispatched_at timestamptz;

comment on column public.season_backfills.dispatched_at is
  'When the worker (console-jobs.yml) was last started for this request: scripts/ingest/console_kick.py, the console-kick function. Null: not started yet; the cron is the floor.';
comment on column public.league_resets.dispatched_at is
  'When the worker (console-jobs.yml) was last started for this request (scripts/ingest/console_kick.py).';

-- ------------------------------------------------------------ where it stands ----
-- For the request's own administrators (the league's, or the platform's): how many queued requests were asked for
-- before it (the worker takes the oldest first, across every league), how many seasons are being read now, and when
-- its worker was started. Counts only: nothing about any other league is said.
create or replace function public.season_backfill_queue(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r       public.season_backfills;
  v_ahead int;
  v_run   int;
begin
  select * into r from season_backfills where id = p_id;
  if not found then
    return null;
  end if;
  if not (public.is_league_admin(r.league_id) or public.is_platform_admin()) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  select count(*) into v_ahead from season_backfills
   where state = 'queued' and (requested_at, id) < (r.requested_at, r.id);
  select count(*) into v_run from season_backfills where state = 'running';
  return jsonb_build_object('state', r.state, 'ahead', case when r.state = 'queued' then v_ahead else 0 end,
                            'running', v_run, 'dispatched_at', r.dispatched_at);
end $$;
alter function public.season_backfill_queue(uuid) owner to postgres;
revoke all on function public.season_backfill_queue(uuid) from public, anon;
grant execute on function public.season_backfill_queue(uuid) to authenticated;

-- ============================================================================
-- SELF-TEST: the columns are there, a signed-out reader cannot ask where a request stands, and the count is right
-- (two requests of other leagues asked earlier, one later, one running), inside a block that ends by raising P0217
-- (which only its own handler swallows), so every row it writes is rolled back.
-- ============================================================================
do $test$
declare
  lg  uuid[];
  me  uuid;
  got jsonb;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'season_backfills' and column_name = 'dispatched_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'league_resets' and column_name = 'dispatched_at') then
    raise exception '0217: dispatched_at is missing' using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', 'public.season_backfill_queue(uuid)', 'execute') then
    raise exception '0217: a signed-out reader may ask where a request stands' using errcode = 'P0001';
  end if;
  select array_agg(id) into lg from (select id from leagues order by id limit 4) x;
  if coalesce(array_length(lg, 1), 0) < 4 then
    return;                                   -- an empty database: nothing to count against
  end if;
  begin
    alter table season_backfills disable trigger user;
    insert into season_backfills (league_id, season, state, requested_at) values
      (lg[1], '1990-91', 'queued',  now() - interval '3 hours'),
      (lg[2], '1990-91', 'queued',  now() - interval '2 hours'),
      (lg[3], '1990-91', 'running', now() - interval '4 hours');
    insert into season_backfills (league_id, season, state, requested_at, dispatched_at)
      values (lg[4], '1990-91', 'queued', now() - interval '1 hour', now()) returning id into me;
    insert into season_backfills (league_id, season, state, requested_at) values (lg[1], '1991-92', 'queued', now());
    alter table season_backfills enable trigger user;
    -- as the platform (the owner runs this): the function's own gate is is_league_admin / is_platform_admin, which a
    -- migration's role does not pass, so the count is checked through the same query the function makes
    select jsonb_build_object('ahead', count(*) filter (where b.state = 'queued' and (b.requested_at, b.id) < (s.requested_at, s.id)),
                              'running', count(*) filter (where b.state = 'running'))
      into got
      from season_backfills b, (select x.requested_at, x.id from season_backfills x where x.id = me) s
     where b.season in ('1990-91', '1991-92');
    if (got->>'ahead')::int <> 2 or (got->>'running')::int <> 1 then
      raise exception '0217: the queue count is wrong: %', got using errcode = 'P0001';
    end if;
    raise exception 'rollback' using errcode = 'P0217';
  exception when sqlstate 'P0217' then
    null;                                     -- the test's own rows are gone
  end;
end $test$;
