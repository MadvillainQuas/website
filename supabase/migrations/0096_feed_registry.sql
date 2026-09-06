-- ============================================================================
-- 0096 — FEED REGISTRY: what index_9's Advanced Games View reads.
--
-- 0094 gave the worker a place to record every external game it has seen
-- (external_games). index_9 wants three more things from that row before it
-- can list a league's games without touching the platform's games table:
-- which competition (a code, not a uuid — the analytics app has no league
-- ids), the score for the card, and where the raw payload lives.
--
-- The payload itself (a FIBA data.json is ~450 KB) goes to STORAGE, not a
-- jsonb column: a season of it is ~65 MB, which is a bucket's job. The bucket
-- is public-read because the upstream data is public and the anon key would
-- be in the page anyway (same reasoning as the livestats function).
-- ============================================================================

alter table public.external_games add column if not exists competition_code text;
alter table public.external_games add column if not exists home_score int;
alter table public.external_games add column if not exists away_score int;
alter table public.external_games add column if not exists game_date date;
create index if not exists external_games_comp on public.external_games (competition_code, game_date desc);

create table if not exists public.feed_competitions (
  code       text primary key,                 -- 'SLB', 'EABL' … the analytics app's league code
  label      text not null,
  adapter    text not null,
  league_id  uuid references public.leagues on delete set null,   -- optional link to the platform league
  games      int  not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.feed_competitions enable row level security;
drop policy if exists feed_competitions_read on public.feed_competitions;
create policy feed_competitions_read on public.feed_competitions for select using (true);
-- writes: service role (worker) only.

-- Storage bucket for raw payloads. Public read, service-role write.
insert into storage.buckets (id, name, public)
values ('feed', 'feed', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists feed_public_read on storage.objects;
create policy feed_public_read on storage.objects
  for select using (bucket_id = 'feed');

-- Realtime: index_9 can subscribe to a competition's rows while a game is live.
do $$ begin
  alter publication supabase_realtime add table public.external_games;
exception when duplicate_object then null; when undefined_object then null; end $$;
alter table public.external_games replica identity full;

-- ----------------------------------------------------------------------------
-- Name matching for fed games. A feed spells a club "B. Braun Sheffield
-- Sharks" and a player "Owen Mccormack"; the platform may know them under
-- other spellings. The worker resolves through these aliases and NEVER
-- guesses — an unmatched name is reported, then fixed once here.
-- external_ids keeps the feed's own identifiers ({"fiba_livestats": "12345"})
-- so a renamed player still matches next season.
alter table public.teams   add column if not exists aliases text[] not null default '{}';
alter table public.teams   add column if not exists external_ids jsonb not null default '{}'::jsonb;
alter table public.players add column if not exists aliases text[] not null default '{}';
alter table public.players add column if not exists external_ids jsonb not null default '{}'::jsonb;
create index if not exists teams_external_ids on public.teams using gin (external_ids);
create index if not exists players_external_ids on public.players using gin (external_ids);
