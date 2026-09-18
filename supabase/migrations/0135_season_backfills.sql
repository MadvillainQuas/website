-- ============================================================================
-- 0135 — A SEASON NOBODY EVER READ: the queue behind "fill in an older season".
--
-- (0132 is player_releases. This is the next free number, not a renumbering.)
--
-- Every adapter in scripts/ingest/adapters/ already takes the season it should
-- read out of adapter_config["season"]: acb's ?temporada=, B.LEAGUE's ?year=,
-- EuroLeague's E<year>, the Czech and Slovak sites' own season lists, and for a
-- Genius client the year its tenant page publishes against each competition.
-- Last season is not unreachable — the ordinary pass simply never asks for it,
-- because the source registry carries ONE season, the one being played.
--
-- So a backfill is not a second ingest. It is the SAME pass with a different
-- season name. What was missing is a way for a league's administrator to ASK
-- for one, and a record of the asking that an unattended worker can find. This
-- file is that record: one row per league per season, and the three calls
-- (queue, claim, finish) that move it between them.
--
-- ---------------------------------------------------------------------------
-- THE THREE THINGS A BACKFILL MUST NOT DO, AND WHERE EACH IS STOPPED
--
--   IT MUST NOT OVERWRITE THE SEASON BEING PLAYED. A backfill that was handed
--   the live season name would re-read today's schedule and file it through a
--   path with no live lane, no broadcast heartbeat and no finalise ordering —
--   a worse copy of the pass that already runs every half hour. So the guard
--   trigger below refuses the current season name outright (the same rule as
--   feedplatform.season_name_for: a season opens in August), and refuses any
--   season later than it, which has not happened yet. The season name is also
--   the ONLY thing the worker changes: it pins adapter_config["season"] and
--   leaves the pass alone, so this season's rows are never in its way.
--
--   IT MUST NOT RUN TWICE AT ONCE. Two workers on the same league and season
--   would fight over the same competition, club and roster rows, and the
--   loser's errors would land in the log as if the source were broken. Two
--   things stop it: season_backfills_one_live, a unique index over (league,
--   season) that only counts rows still queued or running — so a second
--   request cannot even be written while one is outstanding — and the claim
--   below, which takes its row with FOR UPDATE SKIP LOCKED, so two workers
--   starting in the same second take two different rows or one takes none.
--
--   IT MUST NOT LEAVE A ROW CLAIMED FOR EVER. A GitHub runner is killed at six
--   hours, a PC is closed, a process is OOM-killed: none of them get to run the
--   finish call. A row stuck on `running` would block its league's season for
--   good, because of the unique index above. So the claim is a LEASE, not a
--   handover: a running row whose worker has not been heard from for 90
--   minutes is put back on the queue by the next claim. The worker keeps the
--   lease alive with heartbeat_season_backfill while it works, which is why
--   the timeout can be short enough to be useful.
-- ---------------------------------------------------------------------------
-- ============================================================================

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- the rule --
-- WHICH SEASON IS BEING PLAYED, in SQL. scripts/ingest/feedplatform.py
-- season_name_for is the definition — August or later and the season is named
-- after this year, otherwise after last — and it is repeated here rather than
-- passed in because the guard has to hold against a browser that is wrong, out
-- of date, or lying. Two copies of a four-line rule is the cheaper mistake.
create or replace function public.current_season_name(p_at timestamptz default now())
returns text language sql stable set search_path = public as $$
  select case when extract(month from (p_at at time zone 'utc')) >= 8
              then to_char(p_at at time zone 'utc', 'YYYY') || '-' ||
                   to_char((p_at at time zone 'utc') + interval '1 year', 'YY')
              else to_char((p_at at time zone 'utc') - interval '1 year', 'YYYY') || '-' ||
                   to_char(p_at at time zone 'utc', 'YY')
         end;
$$;

comment on function public.current_season_name(timestamptz) is
  'The season being played, named the way a person writes one ("2026-27"). Mirrors '
  'scripts/ingest/feedplatform.py season_name_for; a season opens in August.';

-- --------------------------------------------------------------- the queue --
create table if not exists public.season_backfills (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues on delete cascade,
  season        text not null,                          -- the PLATFORM name, '2024-25'
  state         text not null default 'queued'
                  check (state in ('queued', 'running', 'done', 'failed')),
  requested_by  uuid references auth.users on delete set null,
  requested_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  heartbeat_at  timestamptz,                            -- the lease; see the header
  finished_at   timestamptz,
  worker        text,                                   -- 'gha:<run id>' / 'local'
  sources_run   int  not null default 0,                -- how many of the league's feeds were read
  games_seen    int  not null default 0,                -- on the old season's schedule
  games_written int  not null default 0,                -- new or changed, so written through
  error         text
);

create index if not exists season_backfills_queue_idx
  on public.season_backfills (state, requested_at);
create index if not exists season_backfills_league_idx
  on public.season_backfills (league_id, requested_at desc);

-- ONE OUTSTANDING REQUEST PER LEAGUE PER SEASON — and only while it is
-- outstanding. A finished backfill does not block the next one: a league whose
-- adapter was fixed, or whose source published a missing phase, must be able to
-- ask again. This is also what makes the console's button safe to press twice.
create unique index if not exists season_backfills_one_live
  on public.season_backfills (league_id, season) where state in ('queued', 'running');

comment on table public.season_backfills is
  'A request to run the ordinary ingest pass over an OLDER season for one league. '
  'Queued from the admin console (section 03), claimed by scripts/ingest/run_ingest.py '
  '--backfill. A row is a request, not an import: nothing happens until the worker runs.';

-- ------------------------------------------------------------- the guard ----
-- Everything a request must be, enforced where no caller can go round it: the
-- console, a raw PostgREST insert and the service role all pass through here.
create or replace function public.season_backfills_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  live text := public.current_season_name();
begin
  new.season := btrim(coalesce(new.season, ''));
  if new.season !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'a season is written like 2024-25' using errcode = '22023';
  end if;
  -- THE LIVE SEASON IS NOT A BACKFILL. It is already being read every half
  -- hour, with a live lane this path does not have.
  if new.season = live then
    raise exception 'the season being played (%) is filled in by the ordinary pass', live
      using errcode = '22023';
  end if;
  if left(new.season, 4)::int > left(live, 4)::int then
    raise exception '% has not been played yet', new.season using errcode = '22023';
  end if;
  -- A REQUEST ARRIVES QUEUED, whatever the caller sent. Without this an insert
  -- could name itself `done` and the worker would never look at it, or name
  -- itself `running` and hold the league's slot against the unique index above
  -- with no worker and no lease to expire.
  new.state         := 'queued';
  new.requested_by  := coalesce(auth.uid(), new.requested_by);
  new.requested_at  := now();
  new.claimed_at    := null;
  new.heartbeat_at  := null;
  new.finished_at   := null;
  new.worker        := null;
  new.sources_run   := 0;
  new.games_seen    := 0;
  new.games_written := 0;
  new.error         := null;
  return new;
end $$;

drop trigger if exists season_backfills_guard_t on public.season_backfills;
create trigger season_backfills_guard_t before insert on public.season_backfills
  for each row execute function public.season_backfills_guard();

-- ----------------------------------------------------------------- who may --
alter table public.season_backfills enable row level security;

drop policy if exists season_backfills_read   on public.season_backfills;
drop policy if exists season_backfills_ask    on public.season_backfills;
drop policy if exists season_backfills_cancel on public.season_backfills;

-- is_league_admin (0001) returns true for a platform admin as well, so this one
-- predicate is both halves of the rule: a league's administrators see their own
-- league's requests, and the platform sees everybody's.
create policy season_backfills_read on public.season_backfills
  for select using (public.is_league_admin(league_id));

create policy season_backfills_ask on public.season_backfills
  for insert with check (public.is_league_admin(league_id));

-- A request that has not been picked up may be taken back. A running one may
-- not: the row is the worker's lease, and deleting it would let a second worker
-- start the same league and season while the first is still writing.
create policy season_backfills_cancel on public.season_backfills
  for delete using (public.is_league_admin(league_id) and state = 'queued');

-- A NEW TABLE IN public ARRIVES WITH EVERY PRIVILEGE FOR anon (Supabase's
-- default privileges), so the revoke is the part that matters — RLS would have
-- refused the write anyway, but a table nobody may touch beats one everybody
-- may attempt. Updates are the worker's alone, through the calls below.
revoke all on public.season_backfills from anon;
grant select, insert, delete on public.season_backfills to authenticated;
grant all on public.season_backfills to service_role;

-- ------------------------------------------------------------- the asking ---
-- One call, one answer, and the audit row with it — the console never inserts
-- directly, so "who asked for last season to be re-read, and when" has one
-- place to look. The insert policy above still exists for anything that does.
create or replace function public.queue_season_backfill(p_league uuid, p_season text)
returns public.season_backfills language plpgsql security definer set search_path = public as $$
declare r public.season_backfills;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  begin
    insert into season_backfills (league_id, season, requested_by)
    values (p_league, p_season, auth.uid())
    returning * into r;
  exception when unique_violation then
    -- the partial unique index, which only counts queued + running rows
    raise exception '% is already queued or running for this league', btrim(coalesce(p_season, ''))
      using errcode = '23505';
  end;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'queue_season_backfill', 'league', p_league::text,
          jsonb_build_object('season', r.season, 'backfill', r.id));
  return r;
end $$;

alter function public.queue_season_backfill(uuid, text) owner to postgres;
revoke all on function public.queue_season_backfill(uuid, text) from public, anon;
grant execute on function public.queue_season_backfill(uuid, text) to authenticated;

-- ------------------------------------------------------------ the worker ----
-- THE CLAIM IS A LEASE. First it puts back anything whose worker has gone
-- quiet for 90 minutes (see the header: nothing gets to run `finish` when it is
-- killed), then it takes the oldest queued row with FOR UPDATE SKIP LOCKED so
-- two workers starting together cannot take the same one. Returns null when the
-- queue is empty, which is the worker's signal to do nothing at all.
create or replace function public.claim_season_backfill(p_worker text)
returns public.season_backfills language plpgsql security definer set search_path = public as $$
declare r public.season_backfills;
begin
  update season_backfills
     set state = 'queued', worker = null, claimed_at = null, heartbeat_at = null,
         error = coalesce(nullif(error, ''), 'the worker stopped without finishing; re-queued')
   where state = 'running'
     and coalesce(heartbeat_at, claimed_at, requested_at) < now() - interval '90 minutes';

  update season_backfills
     set state = 'running', worker = p_worker, claimed_at = now(), heartbeat_at = now()
   where id = (select id from season_backfills
                where state = 'queued' order by requested_at limit 1 for update skip locked)
  returning * into r;
  return r;
end $$;

alter function public.claim_season_backfill(text) owner to postgres;
revoke all on function public.claim_season_backfill(text) from public, anon, authenticated;
grant execute on function public.claim_season_backfill(text) to service_role;

-- The lease, kept alive. A full season is several hundred games and one source
-- can take hours; without this the 90-minute reclaim above would hand a live
-- backfill to a second worker halfway through.
create or replace function public.heartbeat_season_backfill(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update season_backfills set heartbeat_at = now() where id = p_id and state = 'running';
$$;

alter function public.heartbeat_season_backfill(uuid) owner to postgres;
revoke all on function public.heartbeat_season_backfill(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_season_backfill(uuid) to service_role;

-- Done or failed, with the counts the console shows. An empty p_error means it
-- worked; a row that failed keeps the message, because "it says failed" with no
-- reason is the report nobody can act on.
create or replace function public.finish_season_backfill(
  p_id uuid, p_state text, p_sources int, p_seen int, p_written int, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_state, '') not in ('done', 'failed') then
    raise exception 'a backfill finishes done or failed' using errcode = '22023';
  end if;
  update season_backfills
     set state = p_state, finished_at = now(), heartbeat_at = now(),
         sources_run = coalesce(p_sources, 0), games_seen = coalesce(p_seen, 0),
         games_written = coalesce(p_written, 0), error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
   where id = p_id;
end $$;

alter function public.finish_season_backfill(uuid, text, int, int, int, text) owner to postgres;
revoke all on function public.finish_season_backfill(uuid, text, int, int, int, text) from public, anon, authenticated;
grant execute on function public.finish_season_backfill(uuid, text, int, int, int, text) to service_role;

-- ============================================================================
-- SELF-TEST. There is no scratch database in front of this file, so it checks
-- itself: the shape, who may read and write it, and — the three rules from the
-- header — that the live season is refused, that a second request for the same
-- season is refused while one is outstanding, and that a claim whose worker
-- went quiet comes back to the queue. Everything it makes is rolled back.
-- ============================================================================
do $test$
declare
  lg   uuid;
  them uuid := gen_random_uuid();
  adm  uuid := gen_random_uuid();
  orig text := current_user;
  last text := (left(public.current_season_name(), 4)::int - 1)::text || '-' ||
               right(left(public.current_season_name(), 4), 2);
  r    public.season_backfills;
  n    int;
begin
  if to_regclass('public.season_backfills') is null then
    raise exception '0135: season_backfills was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.season_backfills'::regclass) then
    raise exception '0135: season_backfills must have row-level security on';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'season_backfills') <> 3 then
    raise exception '0135: season_backfills needs its read, ask and cancel policies';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'season_backfills_one_live') then
    raise exception '0135: the one-outstanding-request index is missing';
  end if;
  if has_table_privilege('anon', 'public.season_backfills', 'select') then
    raise exception '0135: a signed-out visitor must not read the backfill queue';
  end if;
  if has_function_privilege('authenticated', 'public.claim_season_backfill(text)', 'execute') then
    raise exception '0135: only the worker may claim a backfill';
  end if;
  if not has_function_privilege('authenticated', 'public.queue_season_backfill(uuid, text)', 'execute') then
    raise exception '0135: a league administrator must be able to queue one';
  end if;
  -- the rule itself, at both ends of the year
  if public.current_season_name('2026-09-18T00:00:00Z'::timestamptz) <> '2026-27'
     or public.current_season_name('2027-03-01T00:00:00Z'::timestamptz) <> '2026-27' then
    raise exception '0135: current_season_name does not match feedplatform.season_name_for';
  end if;

  select id into lg from public.leagues order by created_at limit 1;
  if lg is null then return; end if;          -- an empty database has nothing to act on

  begin
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (adm,  'authenticated', 'authenticated', '0135-adm@example.invalid',  now(), now()),
           (them, 'authenticated', 'authenticated', '0135-them@example.invalid', now(), now());
    insert into public.memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);

    set local role authenticated;

    -- the stranger: no read, no write
    perform set_config('request.jwt.claims',
      json_build_object('sub', them, 'role', 'authenticated')::text, true);
    begin
      perform public.queue_season_backfill(lg, last);
      raise exception '0135: A SIGNED-IN STRANGER QUEUED A BACKFILL FOR SOMEBODY ELSE''S LEAGUE';
    exception when insufficient_privilege then null;
    end;

    -- the league's administrator
    perform set_config('request.jwt.claims',
      json_build_object('sub', adm, 'role', 'authenticated')::text, true);

    -- ...may not ask for the season being played
    begin
      perform public.queue_season_backfill(lg, public.current_season_name());
      raise exception '0135: THE LIVE SEASON WAS ACCEPTED AS A BACKFILL';
    exception when sqlstate '22023' then null;
    end;
    -- ...nor for one nobody has played
    begin
      perform public.queue_season_backfill(lg, (left(public.current_season_name(), 4)::int + 1)::text || '-99');
      raise exception '0135: a season that has not happened was accepted';
    exception when sqlstate '22023' then null;
    end;

    r := public.queue_season_backfill(lg, last);
    if r.state <> 'queued' or r.season <> last then
      raise exception '0135: a queued backfill did not come back queued';
    end if;

    -- ...and not twice while it is outstanding
    begin
      perform public.queue_season_backfill(lg, last);
      raise exception '0135: THE SAME SEASON WAS QUEUED TWICE AT ONCE';
    exception when unique_violation then null;
    end;

    -- the stranger cannot see it, the administrator can
    perform set_config('request.jwt.claims',
      json_build_object('sub', them, 'role', 'authenticated')::text, true);
    select count(*) into n from public.season_backfills where id = r.id;
    if n <> 0 then raise exception '0135: a stranger read another league''s queue'; end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    -- the worker takes it, then dies; the next claim finds it again
    if (public.claim_season_backfill('0135-test')).id <> r.id then
      raise exception '0135: the worker could not claim the queued backfill';
    end if;
    if (select state from season_backfills where id = r.id) <> 'running' then
      raise exception '0135: a claimed backfill is not running';
    end if;
    perform public.claim_season_backfill('0135-second');
    if exists (select 1 from season_backfills where id = r.id and worker = '0135-second') then
      raise exception '0135: TWO WORKERS CLAIMED THE SAME BACKFILL';
    end if;
    update season_backfills set heartbeat_at = now() - interval '4 hours' where id = r.id;
    if (public.claim_season_backfill('0135-third')).id <> r.id then
      raise exception '0135: a backfill abandoned by its worker was never re-queued';
    end if;

    perform public.finish_season_backfill(r.id, 'done', 1, 182, 180, null);
    if (select state from season_backfills where id = r.id) <> 'done' then
      raise exception '0135: finish_season_backfill did not close the row';
    end if;
    -- ...and a finished season may be asked for again, which is the whole point
    -- of the unique index only counting queued and running rows
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform public.queue_season_backfill(lg, last);

    raise exception using errcode = 'P0004', message = '0135 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
