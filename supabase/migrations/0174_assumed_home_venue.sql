-- ============================================================================
-- 0174 - A GAME THAT NAMES NO ARENA IS PLAYED AT ITS HOME CLUB'S.
--
-- Several feeds never name a venue (Liga Endesa, ProA/ProB, the FEB leagues, the ABA League, ORLEN Basket
-- Liga, LNBP, Kooperativa NBL, Kosovo...): 4,071 of 9,779 games on 25 Sep 2026. Those leagues play at fixed
-- home arenas, so the game's arena is its home club's - which 0162 already said for EPINOIA GO stamps
-- (game_venue_id), but the pages print games.venue, and that was empty.
--
-- A game whose venue is empty (or a placeholder: "TBD", "調整中") now takes its home club's arena:
--
--   games.venue           the arena's name, so every page that prints the venue prints it, unchanged
--   games.venue_id        the arena itself
--   games.venue_assumed   TRUE = this was filled from the home club, not named by the feed or a person.
--                         A pool of games a page can mark ("home arena"), and what the club's arena
--                         correcting itself rewrites. A real venue arriving later (the feed, the scorer, an
--                         administrator) replaces it and clears the flag.
--
-- ONLY A TRUSTWORTHY ARENA IS ASSUMED: one with no pin note (the pinning script was sure), or one a person
-- has checked. A doubtful match is never pasted onto three hundred games; it waits for a person, as it does
-- for a stamp.
--
-- WHERE IT HAPPENS
--   the games trigger         a game written with no venue takes the arena at once (the ingest, the scorer,
--                             the console: none of them changes)
--   the clubs trigger         a club given (or changed to) a home arena fills its games that name none
--   the venues trigger        an arena checked by a person, cleared of its note or renamed does the same
--   learn_home_venues()       no longer learns a club's arena from games that were only assumed to be there
-- ============================================================================

alter table public.games add column if not exists venue_assumed boolean not null default false;
comment on column public.games.venue_assumed is
  '0174: the venue/venue_id were filled from the home club''s arena because nothing named one. Cleared by a real venue.';

-- ----------------------------------------------------------------------------
-- 1. THE ARENA A CLUB'S HOME GAMES ARE ASSUMED AT: its home arena, if that can be trusted
-- ----------------------------------------------------------------------------
create or replace function public.assumed_home_venue(p_team uuid)
returns table (id uuid, name text) language sql stable security definer set search_path = public as $$
  select v.id, v.name
    from teams t join venues v on v.id = t.home_venue_id
   where t.id = p_team and (v.pin_note is null or v.checked_at is not null);
$$;
alter function public.assumed_home_venue(uuid) owner to postgres;
revoke all on function public.assumed_home_venue(uuid) from public, anon, authenticated;
grant execute on function public.assumed_home_venue(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 2. THE GAMES TRIGGER (replaces 0162's): link a named venue, or assume the home club's
--    Fires on venue and home_team_id, so a fixture whose home club is corrected follows its new home arena.
-- ----------------------------------------------------------------------------
create or replace function public.games_link_venue()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  /* assume_home_venues sets all three columns itself, and re-linking its arena's NAME through the alias
     table could make a second arena of it; it says so with this flag and the trigger stands aside */
  if current_setting('epinoia.assuming', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' or new.venue is distinct from old.venue or new.home_team_id is distinct from old.home_team_id then
    if tg_op = 'UPDATE' and new.venue is not distinct from old.venue and old.venue_assumed
       and not public.venue_placeholder(new.venue) then
      -- the home club changed under an assumed arena: it is the new home club's arena that is assumed
      new.venue := null;
    end if;
    if public.venue_placeholder(new.venue) then
      select * into a from public.assumed_home_venue(new.home_team_id);
      if a.id is not null then
        new.venue := a.name; new.venue_id := a.id; new.venue_assumed := true;
      else
        new.venue_id := null; new.venue_assumed := false;
      end if;
    else
      new.venue_id := public.venue_link(new.venue, public.game_country(new.competition_id));
      new.venue_assumed := false;
    end if;
  end if;
  return new;
end; $$;
alter function public.games_link_venue() owner to postgres;
drop trigger if exists games_link_venue on public.games;
create trigger games_link_venue before insert or update of venue, home_team_id on public.games
  for each row execute function public.games_link_venue();

-- ----------------------------------------------------------------------------
-- 3. FILLING WHAT ALREADY EXISTS: every game of a club (or of every club) that names no arena, or whose
--    assumed arena is no longer the club's. A game a feed or a person named is never touched.
-- ----------------------------------------------------------------------------
create or replace function public.assume_home_venues(p_team uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('epinoia.assuming', '1', true);       -- local to this transaction
  update games g
     set venue = v.name, venue_id = v.id, venue_assumed = true
    from teams t
    join venues v on v.id = t.home_venue_id
   where g.home_team_id = t.id
     and (p_team is null or t.id = p_team)
     and (v.pin_note is null or v.checked_at is not null)
     and (g.venue_assumed or g.venue_id is null)
     and (g.venue_assumed or public.venue_placeholder(g.venue))
     and (g.venue_id is distinct from v.id or g.venue is distinct from v.name or not g.venue_assumed);
  get diagnostics n = row_count;
  perform set_config('epinoia.assuming', '0', true);
  return n;
end; $$;
alter function public.assume_home_venues(uuid) owner to postgres;
revoke all on function public.assume_home_venues(uuid) from public, anon, authenticated;
grant execute on function public.assume_home_venues(uuid) to service_role;

/* a club given, or moved to, a home arena */
create or replace function public.teams_assume_venue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_venue_id is distinct from old.home_venue_id then
    perform public.assume_home_venues(new.id);
    -- an arena taken away (or one that cannot be trusted): its assumed games let go of it
    if new.home_venue_id is null or not exists (select 1 from public.assumed_home_venue(new.id)) then
      perform set_config('epinoia.assuming', '1', true);
      update games set venue = null, venue_id = null, venue_assumed = false
       where home_team_id = new.id and venue_assumed;
      perform set_config('epinoia.assuming', '0', true);
    end if;
  end if;
  return null;
end; $$;
alter function public.teams_assume_venue() owner to postgres;
revoke all on function public.teams_assume_venue() from public, anon, authenticated;
drop trigger if exists teams_assume_venue on public.teams;
create trigger teams_assume_venue after update of home_venue_id on public.teams
  for each row execute function public.teams_assume_venue();

/* an arena a person has checked, cleared of its note, or renamed: its clubs' games follow */
create or replace function public.venues_assume_venue()
returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if (new.pin_note, new.checked_at, new.name) is distinct from (old.pin_note, old.checked_at, old.name) then
    for t in select id from teams where home_venue_id = new.id loop
      perform public.assume_home_venues(t);
    end loop;
  end if;
  return null;
end; $$;
alter function public.venues_assume_venue() owner to postgres;
revoke all on function public.venues_assume_venue() from public, anon, authenticated;
drop trigger if exists venues_assume_venue on public.venues;
create trigger venues_assume_venue after update of pin_note, checked_at, name on public.venues
  for each row execute function public.venues_assume_venue();

-- ----------------------------------------------------------------------------
-- 4. A CLUB'S ARENA IS LEARNT FROM GAMES THAT NAMED ONE, NOT FROM THE ONES ASSUMED (0162's, with the filter)
-- ----------------------------------------------------------------------------
create or replace function public.learn_home_venues()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with c as (
    select home_team_id as team_id, venue_id, count(*) as n,
           sum(count(*)) over (partition by home_team_id) as total,
           row_number() over (partition by home_team_id order by count(*) desc, venue_id) as rk
      from games where venue_id is not null and home_team_id is not null and not venue_assumed
     group by home_team_id, venue_id)
  update teams t set home_venue_id = c.venue_id
    from c
   where c.team_id = t.id and c.rk = 1 and c.n >= 2 and c.n * 3 > c.total
     and t.home_venue_id is distinct from c.venue_id;
  get diagnostics n = row_count;
  return n;
end; $$;
alter function public.learn_home_venues() owner to postgres;
revoke all on function public.learn_home_venues() from public, anon, authenticated;
grant execute on function public.learn_home_venues() to service_role;

-- ----------------------------------------------------------------------------
-- 5. THE GAMES THAT EXIST TODAY
-- ----------------------------------------------------------------------------
select public.assume_home_venues();

-- ----------------------------------------------------------------------------
-- 6. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.assume_home_venues(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.assume_home_venues(uuid)', 'execute') then
    raise exception '0174: a browser role may call assume_home_venues';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'games_link_venue' and tgrelid = 'public.games'::regclass and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgname = 'teams_assume_venue' and tgrelid = 'public.teams'::regclass and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgname = 'venues_assume_venue' and tgrelid = 'public.venues'::regclass and tgenabled <> 'D') then
    raise exception '0174: a trigger is missing';
  end if;
  if exists (select 1 from games where venue_assumed and (venue_id is null or venue is null)) then
    raise exception '0174: an assumed game has no arena';
  end if;
  if exists (select 1 from games g join venues v on v.id = g.venue_id where g.venue_assumed and g.venue is distinct from v.name) then
    raise exception '0174: an assumed game names a different arena from the one it links';
  end if;
  raise notice '0174 ok: % games are at their home club''s arena by assumption, % games still name none',
    (select count(*) from games where venue_assumed),
    (select count(*) from games where venue_id is null and public.venue_placeholder(venue));
end $$;
