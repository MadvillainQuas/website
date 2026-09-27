-- ============================================================================
-- 0186: PLAYER BIO WAITING FOR ITS PLAYER - what a league's roster says about someone the game feeds have not met yet
--
-- A league publishes its rosters before a ball is thrown; EPINOIA makes a player the first time he is in a box score. So a bio pass
-- over a league whose season has not started (or a new signing who has not played) found the heights and dates and had nobody to
-- give them to. It now keeps them here, and every later pass (bio_sync.py, also the daily --stash-only pass that reads no feed at all)
-- offers them to the players the ingest has made since. Given to one player, the row is deleted: this is a waiting room, not a copy.
--
-- SAME RULES AS players (0184): an adult's full date is kept, a minor's never (a trigger keeps only his year, whoever writes it). The
-- table is the service role's alone: RLS on, no policy, nothing granted to anon or authenticated. The bio job never logs a date.
-- A row nobody claims in eighteen months is dropped by the job (a roster line from two seasons ago is not waiting for anyone).
-- ============================================================================

create table if not exists public.player_bio_pending (
  league_slug text not null,
  ident       text not null,          -- 'k:<feed player key>' or 'n:<name>|<club>', normalised: one row per person per league
  feed_key    text,
  first_name  text,
  last_name   text,
  full_name   text,
  team        text,
  height_cm   int,
  weight_kg   int,
  birth_date  date,                   -- SECRET, adults only (player_bio_pending_guard)
  birth_year  int,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (league_slug, ident)
);
create index if not exists player_bio_pending_seen on public.player_bio_pending (last_seen);
comment on table public.player_bio_pending is
  'Bio from a league roster for a player not on EPINOIA yet (bio_sync.py). Service role only; birth_date is SECRET and adults only.';

alter table public.player_bio_pending enable row level security;    -- no policy: nobody reads it from a browser
revoke all on public.player_bio_pending from public, anon, authenticated;

create or replace function public.player_bio_pending_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- a date that would make him a minor (or is not a person's) is never kept; his year is
  if new.birth_date is not null
     and (new.birth_date > (current_date - interval '18 years')::date or new.birth_date < date '1930-01-01') then
    new.birth_year := coalesce(new.birth_year, extract(year from new.birth_date)::int);
    new.birth_date := null;
  end if;
  if new.birth_date is not null then
    new.birth_year := extract(year from new.birth_date)::int;
  end if;
  return new;
end $$;

drop trigger if exists player_bio_pending_guard on public.player_bio_pending;
create trigger player_bio_pending_guard before insert or update on public.player_bio_pending
  for each row execute function public.player_bio_pending_guard();
