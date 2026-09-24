-- ============================================================================
-- 0152 — WORK DONE ONCE, NOT ONCE PER VISIT.
--
-- The public pages worked out everything from raw per-game rows in the
-- visitor's browser, so every visit cost more as leagues and games were added:
--
--   * HOME asked for each league's next game on its own query (26 on
--     2026-09-24, two seconds before the first fixture card);
--   * HOME's best players read every box score of the last month across every
--     league (1.44 MB, eight queries) and ran BPM in the browser;
--   * a league's season tables, leaders and the global scouting table read the
--     whole season's box scores (about 4.6 MB a league) for every reader.
--
-- This migration gives those pages something small to read instead:
--
--   1. league_next_games — the first scheduled game of every league, one row
--      per league, read with the READER'S OWN RIGHTS (security_invoker), so it
--      holds exactly the games the per-league queries found.
--   2. snapshots — finished results the `snapshots` Edge Function builds once
--      and every reader shares: 'stars_global' (HOME's podiums) and
--      'season:<competition id>' (a competition's season lines). The function
--      reads as a SIGNED-OUT visitor would (the publishable key, every policy
--      applying), so a snapshot holds nothing an anonymous reader could not
--      already read. Pages use one only after checking it is current, and work
--      it out the old way when it is not.
--   3. snapshots_tick() on pg_cron every five minutes: calls the function when
--      a game has been finalised since the function last finished, and never
--      otherwise, so an idle platform makes no calls at all.
--   4. Two indexes the busiest game reads never had: upcoming games by status
--      and time, and a competition's games by status.
-- ============================================================================

-- 1. EVERY LEAGUE'S NEXT GAME -------------------------------------------------
-- A scheduled game stays "next" until two hours after its tip-off, as it does
-- in epinoia/globalgames.js (STALE_MS): a game that tipped late, or whose scorer
-- has not pressed start, is still tonight's game.
create or replace view public.league_next_games with (security_invoker = true) as
  select distinct on (s.league_id)
         s.league_id, g.id as game_id, g.tipoff_at
    from public.games g
    join public.competitions c on c.id = g.competition_id
    join public.seasons s      on s.id = c.season_id
   where g.status = 'scheduled'
     and g.tipoff_at >= now() - interval '2 hours'
   order by s.league_id, g.tipoff_at, g.id;

comment on view public.league_next_games is
  'The first scheduled game of each league (tip-off from two hours ago on), read with the caller''s own rights. HOME reads it once instead of once per league (0152).';
revoke all on public.league_next_games from public, anon, authenticated;
grant select on public.league_next_games to anon, authenticated, service_role;

-- 2. INDEXES -------------------------------------------------------------------
-- upcoming/live lists: status = … and tipoff_at >= … order by tipoff_at
create index if not exists games_status_tipoff on public.games (status, tipoff_at);
-- a competition's season: competition_id = … and status in (final, finalising)
create index if not exists games_competition_status on public.games (competition_id, status, finalised_at);

-- 3. SNAPSHOTS -----------------------------------------------------------------
create table if not exists public.snapshots (
  key            text primary key,
  competition_id uuid references public.competitions on delete cascade,  -- a season's; null for stars_global
  token          text not null,               -- what it was built from; pages compare it with their own
  data           jsonb not null,
  built_at       timestamptz not null default now()
);
comment on table public.snapshots is
  'Results built once by the snapshots Edge Function from what a signed-out visitor can read, and shared by every reader: stars_global, season:<competition id> (0152).';

-- A SEASON'S SNAPSHOT IS READ UNDER THE SEASON'S OWN RULE. It was built when a
-- signed-out reader could read that competition; if its league later goes
-- members-only or private, the stale row must not outlive the permission. So a
-- reader sees it only while they may read the rows of one of its finished games
-- — can_read_game_rows, the rule the box scores themselves are read under.
-- stars_global names players from many leagues and carries no competition; the
-- page drops any podium entry whose league the reader cannot see, and the
-- function rebuilds it at least hourly.
alter table public.snapshots enable row level security;
drop policy if exists "snapshots are public" on public.snapshots;
drop policy if exists "snapshots follow their competition" on public.snapshots;
create policy "snapshots follow their competition" on public.snapshots for select to anon, authenticated
  using ( competition_id is null
          or exists (select 1 from public.games g
                      where g.competition_id = snapshots.competition_id
                        and g.status = 'final'
                        and public.can_read_game_rows(g.id)) );
revoke all on public.snapshots from public, anon, authenticated;
grant select on public.snapshots to anon, authenticated;
grant all on public.snapshots to service_role;

-- what the tick saw and what the function last finished (the function writes done_*)
create table if not exists public.snapshot_ticks (
  id               smallint primary key default 1 check (id = 1),
  ran_at           timestamptz,
  called_at        timestamptz,
  fingerprint      text,                      -- finals on the platform when the tick last ran
  done_fingerprint text,                      -- ... when the function last finished
  done_at          timestamptz,
  result           jsonb not null default '{}'::jsonb
);
alter table public.snapshot_ticks enable row level security;
revoke all on public.snapshot_ticks from public, anon, authenticated;
grant all on public.snapshot_ticks to service_role;

-- 4. THE TICK ------------------------------------------------------------------
-- The fingerprint moves whenever a game is finalised (count or latest
-- finalised_at). The function is called when it differs from what the function
-- last finished, and not again within four minutes of the last call (a build
-- still running). Written as dynamic SQL behind to_regprocedure, as 0121's tick
-- is, so it installs where pg_net does not exist.
create or replace function public.snapshots_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fp      text;
  v_done    text;
  v_called  timestamptz;
  v_net     boolean;
  v_request bigint;
  v_call    boolean := false;
  v_result  jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('epinoia.snapshots_tick', 0)) then
    return jsonb_build_object('skipped', 'another tick is running');
  end if;

  select count(*)::text || '@' || coalesce(max(finalised_at)::text, '')
    into v_fp
    from games where status = 'final';
  select done_fingerprint, called_at into v_done, v_called from snapshot_ticks where id = 1;

  v_net := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
  -- a game finalised since the function last finished, or an hour since it did
  -- (a league's visibility or a player's consent can change without a final)
  if v_net
     and ( v_fp is distinct from v_done
           or coalesce((select done_at from snapshot_ticks where id = 1), 'epoch') < now() - interval '1 hour' )
     and (v_called is null or v_called < now() - interval '4 minutes') then
    begin
      execute 'select net.http_post(url := $1, body := $2, params := $3, headers := $4, timeout_milliseconds := $5)'
         into v_request
        using 'https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/snapshots'::text,
              jsonb_build_object('source', 'tick'),
              '{}'::jsonb,
              jsonb_build_object('Content-Type', 'application/json',
                                 'apikey', 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO'),
              5000;
      v_call := true;
    exception when others then
      v_result := jsonb_build_object('call_error', sqlerrm);
    end;
  end if;

  v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'ran_at', now(), 'fingerprint', v_fp, 'done', v_done, 'net', v_net, 'called', v_call, 'request_id', v_request);
  insert into snapshot_ticks (id, ran_at, called_at, fingerprint, result)
  values (1, now(), case when v_call then now() end, v_fp, v_result)
  on conflict (id) do update
    set ran_at      = excluded.ran_at,
        called_at   = coalesce(excluded.called_at, snapshot_ticks.called_at),
        fingerprint = excluded.fingerprint,
        result      = excluded.result;
  return v_result;
end $$;
alter function public.snapshots_tick() owner to postgres;
revoke all on function public.snapshots_tick() from public, anon, authenticated;

-- From outside, signed out: is the job scheduled, and when did the function last
-- finish. No personal data, so a deploy can be checked with the publishable key.
create or replace function public.snapshots_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cron boolean := false; v_t snapshot_ticks%rowtype; v_n int;
begin
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job j where j.jobname = $1 and j.active)'
       into v_cron using 'epinoia-snapshots-tick'::text;
  end if;
  select * into v_t from snapshot_ticks where id = 1;
  select count(*) into v_n from snapshots;
  return jsonb_build_object('cron', v_cron, 'ran_at', v_t.ran_at, 'called_at', v_t.called_at,
                            'done_at', v_t.done_at, 'current', v_t.fingerprint is not distinct from v_t.done_fingerprint,
                            'snapshots', v_n);
end $$;
alter function public.snapshots_health() owner to postgres;
grant execute on function public.snapshots_health() to anon, authenticated;

-- the schedule: every five minutes, as postgres (pg_cron and pg_net came with 0121)
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-snapshots-tick'::text;
    execute 'select cron.schedule($1, $2, $3)' into v_job
      using 'epinoia-snapshots-tick'::text, '*/5 * * * *'::text, 'select public.snapshots_tick()'::text;
    raise notice '0152: pg_cron job epinoia-snapshots-tick (job %) runs select public.snapshots_tick() every five minutes', v_job;
  else
    raise warning '0152: pg_cron is not installed here, so nothing calls the snapshots function; pages keep working it out themselves';
  end if;
end $$;
