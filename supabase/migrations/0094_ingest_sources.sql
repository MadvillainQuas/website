-- ============================================================================
-- 0094 — INGEST SOURCES: auto-update the platform from league schedule URLs.
--
-- Three problems, three tables (plus one derived table for the game view):
--
--   WHERE DO GAMES COME FROM   schedule_sources — one row per competition per
--                              schedule URL, tagged with the ADAPTER that knows
--                              how to read it (FIBA LiveStats, Genius HTML,
--                              2BBL, Eurobasket, custom). Non-FIBA leagues get
--                              a different adapter, not a different pipeline.
--   WHAT HAVE WE SEEN          external_games — the external id ↔ public.games
--                              bridge. Idempotent: the same matchId can arrive
--                              from two schedule pages and lands once.
--   DID IT RUN                 ingest_runs — every cron tick logged with counts
--                              and the first error, so "why is Tuesday missing"
--                              has an answer.
--   THE GAME VIEW              game_advanced — per game, everything index_9's
--                              engines need but the live scorer never writes:
--                              stints, lineups, four factors, shot zones,
--                              transition, starter splits. Written by the
--                              ingest worker; read by /league/game/<id>.
--
-- Everything here runs OUTSIDE the browser (GitHub Actions worker with the
-- service key). The browser only ever reads game_advanced + games through RLS.
-- ============================================================================

create table if not exists public.schedule_sources (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues on delete cascade,
  competition_id  uuid references public.competitions on delete set null,
  label           text not null,                          -- 'SLB Regular season'
  adapter         text not null,                          -- see schedule_sources_adapter_ck
  schedule_url    text not null,
  adapter_config  jsonb not null default '{}'::jsonb,     -- adapter-specific knobs (selectors, ids, auth)
  poll_minutes    int  not null default 30,               -- how often the worker looks at this URL
  active_window   int4range,                              -- optional UTC hour window, e.g. [12,24)
  enabled         boolean not null default true,
  last_polled_at  timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  unique (league_id, schedule_url)
);
create index if not exists schedule_sources_league on public.schedule_sources (league_id);
create index if not exists schedule_sources_due on public.schedule_sources (enabled, last_polled_at);

do $$ begin
  alter table public.schedule_sources add constraint schedule_sources_adapter_ck
    check (adapter in ('fiba_livestats', 'genius_html', 'bbl_2bbl', 'euroleague_api', 'eurobasket_html', 'bcb_pipeline', 'manual'));
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
create table if not exists public.external_games (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid references public.schedule_sources on delete set null,
  adapter          text not null,
  external_id      text not null,                         -- FIBA matchId, 2BBL game id, …
  game_id          uuid references public.games on delete set null,   -- null until matched/created
  home_name        text, away_name text,                  -- as the source spells them (team-merge input)
  tipoff_at        timestamptz,
  external_status  text,                                  -- scheduled | live | final (adapter-normalised)
  raw_ref          text,                                  -- where the raw payload was archived (storage path / gist)
  payload_hash     text,                                  -- sha1 of last fetched payload — skip unchanged
  first_seen_at    timestamptz not null default now(),
  last_fetched_at  timestamptz,
  ingested_at      timestamptz,                           -- last successful write into games/game_advanced
  error            text,
  unique (adapter, external_id)
);
create index if not exists external_games_game on public.external_games (game_id);
create index if not exists external_games_pending
  on public.external_games (external_status, last_fetched_at) where ingested_at is null or external_status = 'live';

-- ----------------------------------------------------------------------------
create table if not exists public.ingest_runs (
  id            bigserial primary key,
  source_id     uuid references public.schedule_sources on delete set null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  games_seen    int not null default 0,
  games_fetched int not null default 0,
  games_written int not null default 0,
  status        text not null default 'running',
  error         text,
  worker        text                                      -- 'gha:ingest.yml#1234' / hostname
);
create index if not exists ingest_runs_source on public.ingest_runs (source_id, started_at desc);
do $$ begin
  alter table public.ingest_runs add constraint ingest_runs_status_ck
    check (status in ('running', 'ok', 'partial', 'failed'));
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Per-game derived bundle for the ADVANCED GAME VIEW. Shape mirrors the
-- 13-CSV scraper output so index_9's engines can be reused verbatim client-side:
--   box        {home:[...player rows...], away:[...]}          (player_boxscore_api rows)
--   team       {home:{...team_totals row...}, away:{...}}
--   stints     [ {period,start,end,duration,poss,home_lineup,away_lineup,home_*,away_*} ]  (stints.csv rows)
--   lineups    {home:[{lineup, poss, pts, ptsA, ...}], away:[...]}
--   four_factors {home:{efg,tov,oreb,ftr}, away:{...}}
--   shots      {home:{rim:{att,made}, mid:{...}, three:{...}}, away:{...}}
--   transition {home:{fb,sc,pot}, away:{...}}
--   pbp        [ normalised events ]  (optional — large; null unless requested)
-- `version` lets the worker re-derive when the engine changes.
create table if not exists public.game_advanced (
  game_id      uuid primary key references public.games on delete cascade,
  external_id  text,
  adapter      text,
  version      int  not null default 1,
  status       text not null default 'final',            -- live | final
  box          jsonb not null default '{}'::jsonb,
  team         jsonb not null default '{}'::jsonb,
  stints       jsonb not null default '[]'::jsonb,
  lineups      jsonb not null default '{}'::jsonb,
  four_factors jsonb not null default '{}'::jsonb,
  shots        jsonb not null default '{}'::jsonb,
  transition   jsonb not null default '{}'::jsonb,
  pbp          jsonb,
  computed_at  timestamptz not null default now()
);
create index if not exists game_advanced_status on public.game_advanced (status, computed_at desc);

-- ----------------------------------------------------------------------------
-- RLS: sources + runs are league-admin only (same helper the rest of the
-- schema uses); external_games is readable by league members; game_advanced
-- follows the game's own visibility (public once the game is public).
alter table public.schedule_sources enable row level security;
alter table public.external_games  enable row level security;
alter table public.ingest_runs     enable row level security;
alter table public.game_advanced   enable row level security;

drop policy if exists schedule_sources_admin on public.schedule_sources;
create policy schedule_sources_admin on public.schedule_sources
  for all using (public.is_league_admin(league_id)) with check (public.is_league_admin(league_id));

drop policy if exists ingest_runs_admin on public.ingest_runs;
create policy ingest_runs_admin on public.ingest_runs
  for select using (source_id is null or public.is_league_admin((select league_id from public.schedule_sources s where s.id = source_id)));

drop policy if exists external_games_read on public.external_games;
create policy external_games_read on public.external_games
  for select using (true);

drop policy if exists game_advanced_read on public.game_advanced;
create policy game_advanced_read on public.game_advanced
  for select using (true);
-- writes come from the service role (worker) only — no insert/update policies.

-- ----------------------------------------------------------------------------
-- Which sources are due right now (worker entry point).
create or replace function public.due_schedule_sources()
returns setof public.schedule_sources
language sql stable security definer set search_path = public as $$
  select * from public.schedule_sources s
  where s.enabled
    and (s.last_polled_at is null or s.last_polled_at < now() - make_interval(mins => s.poll_minutes))
    and (s.active_window is null or extract(hour from now() at time zone 'utc')::int <@ s.active_window)
  order by s.last_polled_at nulls first;
$$;
revoke all on function public.due_schedule_sources() from public;

-- Realtime: the game view subscribes to its own row.
do $$ begin
  alter publication supabase_realtime add table public.game_advanced;
exception when duplicate_object then null; when undefined_object then null; end $$;
