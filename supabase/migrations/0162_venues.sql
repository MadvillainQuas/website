-- ============================================================================
-- 0162 - ARENAS (EPINOIA GO, docs/epinoia-go.md step 1.2).
--
-- `games.venue` has always been free text, written by the ingest from each feed ("Steveco Areena")
-- or typed by a scorer. EPINOIA GO stamps a fan's visit to an ARENA, so an arena becomes a thing of
-- its own: a row with a name, its other spellings, and (from step 1.4) where it is on the map.
--
--   venues          one arena: name, country, address, the pin (lat/lng, Google place id, how it was
--                   pinned and whether a person checked it) and the radius a stamp must be inside
--   venue_aliases   every spelling that means that arena, FOLDED (venue_key): "Tapiolan Liikuntahalli",
--                   "tapiolan liikuntahalli" and "Tapiolan liikuntahalli " are one key. Merging two
--                   rows that turn out to be one arena (step 1.5) is moving aliases.
--   games.venue_id  the arena a game was played at, linked by a trigger whenever games.venue is written,
--                   so every writer - the ingest, the scorer, the console - links it without knowing
--   teams.home_venue_id   a club's usual home arena, learnt here from its home games
--
-- The text column stays, unchanged: it is what the feed said and what the pages print. The link is
-- the arena behind it. A placeholder ("調整中", "TBD") links to nothing.
--
-- Arenas are public facts - a club's home ground - so anybody may read them. Only a platform
-- administrator (and the service role, which the ingest and the pinning script use) may write.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE KEY: a spelling folded to what makes it the same arena. Lower case, the Latin diacritics of
--    the leagues' languages folded (Baltic, Polish, Czech, Romanian, Turkish, Nordic; no unaccent
--    extension is assumed, as in 0119), punctuation and runs of space made one space. Every other script is kept as it is: a Japanese or Greek name keys on
--    its own letters.
-- ----------------------------------------------------------------------------
create or replace function public.venue_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(
           translate(lower(coalesce(p_name, '')),
                     'àáâãäåāăąçćčĉċďđèéêëēėęěĕğģĝġĥħìíîïīįıĩĵķłľĺļñńňņòóôõöøōőŏŕřŗśšşșŝßťţțùúûüūůűųũŭýÿŷźżžŵ',
                     'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiijkllllnnnnooooooooorrrsssssstttuuuuuuuuuuyyyzzzw'),
           '[[:space:][:punct:]“”„‘’«»‹›・「」『』（）［］【】、。，：；！？—–]+', ' ', 'g')), '');
$$;

/* A spelling that names no arena: an empty cell, a schedule's "to be decided" in the languages the
   feeds use. Linked to nothing, never made into a venue. */
create or replace function public.venue_placeholder(p_name text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(public.venue_key(p_name), '') in
    ('', 'tbd', 'tba', 'tbc', 'to be decided', 'to be announced', 'to be confirmed', 'n a', 'na', 'none',
     'unknown', 'venue tbd', 'por determinar', 'por confirmar', 'a determinar', 'a confirmar',
     'a definir', 'nd', 'offen', 'noch offen', 'da definire', 'da stabilire', 'ei tiedossa', 'avoin',
     '未定', '調整中', '未定 調整中', '会場未定');
$$;

-- ----------------------------------------------------------------------------
-- 2. THE TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  country       text check (country is null or country ~ '^[A-Z]{2}$'),
  address       text,
  city          text,
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  -- how far from the pin a stamp may be made: an arena and its car park, not the next town
  radius_m      integer not null default 300 check (radius_m between 50 and 3000),
  place_id      text,                       -- Google Maps place id: "open in Google Maps" is exact
  pin_source    text check (pin_source is null or pin_source in ('google', 'manual')),
  pin_note      text,                       -- why a pin needs a person (two candidates, a town only...)
  pinned_at     timestamptz,
  checked_by    uuid references auth.users on delete set null,
  checked_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint venues_pin_whole check ((lat is null) = (lng is null))
);
comment on table public.venues is
  'An arena (0162, EPINOIA GO). Linked from games.venue_id; located by lat/lng and place_id from step 1.4.';

create table if not exists public.venue_aliases (
  key        text primary key check (key = public.venue_key(key)),
  venue_id   uuid not null references public.venues on delete cascade,
  spelling   text not null,               -- the first spelling seen with this key, as written
  created_at timestamptz not null default now()
);
create index if not exists venue_aliases_venue on public.venue_aliases (venue_id);

alter table public.games add column if not exists venue_id uuid references public.venues on delete set null;
create index if not exists games_venue_id on public.games (venue_id) where venue_id is not null;
alter table public.teams add column if not exists home_venue_id uuid references public.venues on delete set null;

alter table public.venues enable row level security;
alter table public.venue_aliases enable row level security;
drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues for select using (true);
drop policy if exists venues_admin on public.venues;
create policy venues_admin on public.venues for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists venue_aliases_read on public.venue_aliases;
create policy venue_aliases_read on public.venue_aliases for select using (true);
drop policy if exists venue_aliases_admin on public.venue_aliases;
create policy venue_aliases_admin on public.venue_aliases for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select on public.venues, public.venue_aliases to anon, authenticated;
grant insert, update, delete on public.venues, public.venue_aliases to authenticated;

-- ----------------------------------------------------------------------------
-- 3. LINKING: the arena for a spelling, made the first time it is seen
-- ----------------------------------------------------------------------------
create or replace function public.venue_link(p_name text, p_country text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k text := public.venue_key(p_name);
  v uuid;
begin
  if k is null or public.venue_placeholder(p_name) then return null; end if;
  select venue_id into v from venue_aliases where key = k;
  if v is not null then return v; end if;
  -- two writers meeting the same new spelling at once: the second waits here, then finds the first's
  perform pg_advisory_xact_lock(hashtext('venue_link:' || k));
  select venue_id into v from venue_aliases where key = k;
  if v is not null then return v; end if;
  insert into venues (name, country)
    values (btrim(regexp_replace(p_name, '\s+', ' ', 'g')),
            case when p_country ~ '^[A-Z]{2}$' then p_country end)
    returning id into v;
  insert into venue_aliases (key, venue_id, spelling) values (k, v, btrim(regexp_replace(p_name, '\s+', ' ', 'g')));
  return v;
end; $$;
alter function public.venue_link(text, text) owner to postgres;
revoke all on function public.venue_link(text, text) from public, anon, authenticated;

/* the league's country, for a new arena's row; a league in two countries ('BE+NL') gives none */
create or replace function public.game_country(p_competition uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when l.country ~ '^[A-Z]{2}$' then l.country end
    from competitions c join seasons s on s.id = c.season_id join leagues l on l.id = s.league_id
   where c.id = p_competition;
$$;
revoke all on function public.game_country(uuid) from public, anon, authenticated;

create or replace function public.games_link_venue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.venue is distinct from old.venue then
    new.venue_id := public.venue_link(new.venue, public.game_country(new.competition_id));
  end if;
  return new;
end; $$;
alter function public.games_link_venue() owner to postgres;
drop trigger if exists games_link_venue on public.games;
create trigger games_link_venue before insert or update of venue on public.games
  for each row execute function public.games_link_venue();

-- ----------------------------------------------------------------------------
-- 4. EVERY GAME ALREADY STORED, and each club's usual home arena
-- ----------------------------------------------------------------------------
update public.games g
   set venue_id = public.venue_link(g.venue, public.game_country(g.competition_id))
 where g.venue is not null and g.venue_id is null;

/* A CLUB'S HOME ARENA is where it played most of its home games, if that is at least two of them
   and more than a third: a club that moved mid-season or shares a tournament venue is left for a
   person rather than guessed. Recomputed by calling it again (the ingest can, after a backfill). */
create or replace function public.learn_home_venues()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with c as (
    select home_team_id as team_id, venue_id, count(*) as n,
           sum(count(*)) over (partition by home_team_id) as total,
           row_number() over (partition by home_team_id order by count(*) desc, venue_id) as rk
      from games where venue_id is not null and home_team_id is not null
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
select public.learn_home_venues();

/* THE ARENA A GAME WAS PLAYED AT: its own venue, else its home club's arena. Several feeds never name a
   venue (Liga Endesa, ProA/ProB, LNBP, Kooperativa NBL, 1 Liga Mężczyzn, Kosovo, checked 2026-09-24),
   and those leagues play at fixed home arenas, so the club's arena (teams.home_venue_id, pinned by hand
   or from Google Maps in step 1.4) is where their games were. The one definition EPINOIA GO uses. */
create or replace function public.game_venue_id(p_game uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(g.venue_id, t.home_venue_id)
    from games g left join teams t on t.id = g.home_team_id
   where g.id = p_game;
$$;
grant execute on function public.game_venue_id(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. A READ-ONLY CHECK: the key folds what it should, a placeholder links nothing, the trigger is on
-- ----------------------------------------------------------------------------
do $$
begin
  if public.venue_key('  Tapiolan   Liikuntahalli ') is distinct from 'tapiolan liikuntahalli'
     or public.venue_key('Šiaulių Arena') is distinct from 'siauliu arena'
     or public.venue_key('Palacio de los Deportes (Madrid)') is distinct from 'palacio de los deportes madrid'
     or public.venue_key('KA „Žalgiris“ sporto kompleksas') is distinct from 'ka zalgiris sporto kompleksas'
     or public.venue_key('トヨタアリーナ東京') is distinct from 'トヨタアリーナ東京'
     or public.venue_key('   ') is not null then
    raise exception '0162: venue_key does not fold as expected';
  end if;
  if not (public.venue_placeholder('調整中') and public.venue_placeholder('TBD') and public.venue_placeholder(null)
          and not public.venue_placeholder('Vertu Arena')) then
    raise exception '0162: venue_placeholder is wrong';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'games_link_venue' and tgrelid = 'public.games'::regclass
                 and tgenabled <> 'D') then
    raise exception '0162: games_link_venue is not installed';
  end if;
  if exists (select 1 from games g where g.venue is not null and not public.venue_placeholder(g.venue)
             and g.venue_id is null) then
    raise exception '0162: a game with a venue was left unlinked';
  end if;
  raise notice '0162 ok: % arenas from % spellings, % games linked, % clubs with a home arena',
    (select count(*) from venues), (select count(*) from venue_aliases),
    (select count(*) from games where venue_id is not null), (select count(*) from teams where home_venue_id is not null);
end $$;
