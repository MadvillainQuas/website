-- ============================================================================
-- 0187 — START A LEAGUE AGAIN: the queue behind the platform console's "reset a league".
--
-- scripts/ingest/reset_league.py takes a league apart politely (its games, its players, the ingest's
-- bookkeeping) and keeps everything about the league and its clubs (competitions, clubs, crests, colours,
-- venues and their pins), then re-reads it from its feed. This file lets a PLATFORM ADMINISTRATOR ask for
-- that from the console, and lets an unattended worker (.github/workflows/console-jobs.yml, every 10
-- minutes) find the request, run it and report back, so nothing needs a terminal.
--
--   request_league_reset(league)     platform admins: queue one (one outstanding per league)
--   cancel_league_reset(id)          platform admins: withdraw one that has not started
--   league_reset_preview(league)     platform admins: what a reset would touch, counted
--   claim_league_reset(worker)       service role: take the oldest queued (a lease: stale ones are re-queued)
--   progress_league_reset(id, step, detail)   service role: the step it is on, for the console
--   finish_league_reset(id, state, detail, error)             service role: done or failed
--
-- The deleting itself is NOT done in the database: one statement over a league's event log ties the
-- database up for minutes. The worker does it in small paced batches through the REST API.
-- ============================================================================

create table if not exists public.league_resets (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues on delete cascade,
  state         text not null default 'queued',
  step          text,
  detail        jsonb not null default '{}'::jsonb,
  error         text,
  requested_by  uuid references auth.users on delete set null,
  requested_at  timestamptz not null default now(),
  worker        text,
  claimed_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz,
  constraint league_resets_state check (state in ('queued', 'running', 'done', 'failed', 'cancelled'))
);
-- one outstanding reset per league: a second press cannot even be written while one is queued or running
create unique index if not exists league_resets_one_live on public.league_resets (league_id)
  where state in ('queued', 'running');
create index if not exists league_resets_recent on public.league_resets (requested_at desc);

alter table public.league_resets enable row level security;
drop policy if exists league_resets_read on public.league_resets;
create policy league_resets_read on public.league_resets for select to authenticated
  using (public.is_platform_admin());
grant select on public.league_resets to authenticated;

-- ------------------------------------------------------------ the console ----
create or replace function public.request_league_reset(p_league uuid)
returns public.league_resets language plpgsql security definer set search_path = public as $$
declare r public.league_resets;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from leagues where id = p_league) then
    raise exception 'no such league' using errcode = '22023';
  end if;
  begin
    insert into league_resets (league_id, requested_by) values (p_league, auth.uid()) returning * into r;
  exception when unique_violation then
    raise exception 'a reset of this league is already queued or running' using errcode = '23505';
  end;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'request_league_reset', 'league', p_league::text, jsonb_build_object('reset', r.id));
  return r;
end $$;
alter function public.request_league_reset(uuid) owner to postgres;
revoke all on function public.request_league_reset(uuid) from public, anon;
grant execute on function public.request_league_reset(uuid) to authenticated;

create or replace function public.cancel_league_reset(p_id uuid)
returns public.league_resets language plpgsql security definer set search_path = public as $$
declare r public.league_resets;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  update league_resets set state = 'cancelled', finished_at = now()
   where id = p_id and state = 'queued' returning * into r;
  if r.id is null then
    raise exception 'only a reset that has not started can be withdrawn' using errcode = '22023';
  end if;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'cancel_league_reset', 'league', r.league_id::text, jsonb_build_object('reset', r.id));
  return r;
end $$;
alter function public.cancel_league_reset(uuid) owner to postgres;
revoke all on function public.cancel_league_reset(uuid) from public, anon;
grant execute on function public.cancel_league_reset(uuid) to authenticated;

-- What a reset would touch, so the console can say it before anybody presses anything.
create or replace function public.league_reset_preview(p_league uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  comps uuid[]; clubs uuid[];
  n_games int; n_roster int; n_players int; n_shared int; n_venues int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  select array_agg(c.id) into comps from competitions c join seasons s on s.id = c.season_id where s.league_id = p_league;
  select array_agg(id) into clubs from teams where league_id = p_league;
  select count(*) into n_games from games where competition_id = any (coalesce(comps, '{}'));
  select count(*) into n_roster from roster_entries where team_id = any (coalesce(clubs, '{}'));
  select count(distinct r.player_id) into n_players from roster_entries r
   where r.team_id = any (coalesce(clubs, '{}'))
     and not exists (select 1 from roster_entries o where o.player_id = r.player_id and not (o.team_id = any (coalesce(clubs, '{}'))));
  select count(distinct r.player_id) into n_shared from roster_entries r
   where r.team_id = any (coalesce(clubs, '{}'))
     and exists (select 1 from roster_entries o where o.player_id = r.player_id and not (o.team_id = any (coalesce(clubs, '{}'))));
  select count(distinct venue_id) into n_venues from games where competition_id = any (coalesce(comps, '{}')) and venue_id is not null;
  return jsonb_build_object('games', n_games, 'roster_entries', n_roster, 'players', n_players, 'players_kept', n_shared,
                            'clubs', coalesce(array_length(clubs, 1), 0), 'competitions', coalesce(array_length(comps, 1), 0),
                            'venues', n_venues);
end $$;
alter function public.league_reset_preview(uuid) owner to postgres;
revoke all on function public.league_reset_preview(uuid) from public, anon;
grant execute on function public.league_reset_preview(uuid) to authenticated;

-- ------------------------------------------------------------- the worker ----
-- A LEASE, as 0135's backfills: a run whose worker has gone quiet for 90 minutes is re-queued first (the
-- reset is safe to run again from the start: every step deletes what is still there), then the oldest
-- queued row is taken with FOR UPDATE SKIP LOCKED. Null = nothing to do.
create or replace function public.claim_league_reset(p_worker text)
returns public.league_resets language plpgsql security definer set search_path = public as $$
declare r public.league_resets;
begin
  update league_resets
     set state = 'queued', worker = null, claimed_at = null, heartbeat_at = null,
         error = coalesce(nullif(error, ''), 'the worker stopped without finishing; re-queued')
   where state = 'running' and coalesce(heartbeat_at, claimed_at, requested_at) < now() - interval '90 minutes';
  update league_resets
     set state = 'running', worker = p_worker, claimed_at = now(), heartbeat_at = now(), step = 'starting'
   where id = (select id from league_resets where state = 'queued' order by requested_at limit 1 for update skip locked)
  returning * into r;
  return r;
end $$;
alter function public.claim_league_reset(text) owner to postgres;
revoke all on function public.claim_league_reset(text) from public, anon, authenticated;
grant execute on function public.claim_league_reset(text) to service_role;

create or replace function public.progress_league_reset(p_id uuid, p_step text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  update league_resets set step = left(p_step, 200), detail = detail || coalesce(p_detail, '{}'::jsonb), heartbeat_at = now()
   where id = p_id and state = 'running';
$$;
alter function public.progress_league_reset(uuid, text, jsonb) owner to postgres;
revoke all on function public.progress_league_reset(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.progress_league_reset(uuid, text, jsonb) to service_role;

create or replace function public.finish_league_reset(p_id uuid, p_state text, p_detail jsonb default '{}'::jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_state, '') not in ('done', 'failed') then
    raise exception 'a reset finishes done or failed' using errcode = '22023';
  end if;
  update league_resets
     set state = p_state, finished_at = now(), heartbeat_at = now(), step = p_state,
         detail = detail || coalesce(p_detail, '{}'::jsonb),
         error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
   where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  select null, 'finish_league_reset', 'league', league_id::text, jsonb_build_object('reset', id, 'state', p_state)
    from league_resets where id = p_id;
end $$;
alter function public.finish_league_reset(uuid, text, jsonb, text) owner to postgres;
revoke all on function public.finish_league_reset(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_league_reset(uuid, text, jsonb, text) to service_role;

-- ============================================================================
-- THE SAME BAR FOR "FILL IN AN OLDER SEASON" (0135). A backfill had a heartbeat but no progress, so the console
-- could say only "running". It now carries the step it is on and a percentage (detail.pct), written by
-- run_ingest.py's beat() as it goes through the season's games, and the league console draws the same bar as a
-- reset (epinoia/admin/jobbar.js). A progress write keeps the lease alive, as a heartbeat does.
-- ============================================================================
alter table public.season_backfills add column if not exists step text;
alter table public.season_backfills add column if not exists detail jsonb not null default '{}'::jsonb;

create or replace function public.progress_season_backfill(p_id uuid, p_step text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  update season_backfills set step = left(p_step, 200), detail = detail || coalesce(p_detail, '{}'::jsonb), heartbeat_at = now()
   where id = p_id and state = 'running';
$$;
alter function public.progress_season_backfill(uuid, text, jsonb) owner to postgres;
revoke all on function public.progress_season_backfill(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.progress_season_backfill(uuid, text, jsonb) to service_role;

-- A CALENDAR-YEAR LEAGUE'S SEASON IS A YEAR. CIBACOPA, Liga Ouro and NBL1 name their seasons "2026" (the season is
-- played inside one calendar year), and 0135's guard only knew "2024-25", so none of them could ask for an older
-- season at all. A four-digit year is now accepted for them; the year being played (this calendar year) and any
-- later one are refused, as the live split-year season is.
create or replace function public.season_backfills_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  live text := public.current_season_name();
  this_year int := extract(year from (now() at time zone 'utc'))::int;
begin
  new.season := btrim(coalesce(new.season, ''));
  if new.season ~ '^[0-9]{4}$' then
    if new.season::int >= this_year then
      raise exception '% is this year or later: a calendar-year league''s current season is filled in by the ordinary pass', new.season
        using errcode = '22023';
    end if;
  elsif new.season ~ '^[0-9]{4}-[0-9]{2}$' then
    if new.season = live then
      raise exception 'the season being played (%) is filled in by the ordinary pass', live using errcode = '22023';
    end if;
    if left(new.season, 4)::int > left(live, 4)::int then
      raise exception '% has not been played yet', new.season using errcode = '22023';
    end if;
  else
    raise exception 'a season is written like 2024-25 (or 2025 for a calendar-year league)' using errcode = '22023';
  end if;
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
  new.step          := null;
  new.detail        := '{}'::jsonb;
  return new;
end $$;
