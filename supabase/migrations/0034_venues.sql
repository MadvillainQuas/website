-- ============================================================================
-- Where a game is actually played.
--
-- `games.venue` has always been free text — "East Dock Hall" — which is enough
-- to print and not enough to travel to. An away supporter needs the address,
-- and a fixtures page that says only the name is a fixtures page you have to
-- leave in order to use.
--
-- A club's HOME VENUE lives on the club, because it is the same building every
-- other week and typing it into forty fixtures is how forty fixtures end up
-- with three spellings of the same address. A game keeps its own venue fields
-- so a one-off neutral or relocated fixture can override without disturbing
-- the club's default.
--
-- Deliberately NOT a venues table with a foreign key. That would be the right
-- shape for a platform booking courts; here a venue is a label and an address
-- that get printed together, never queried across, and never joined to
-- anything. A table would add a join to every fixture query and buy nothing.
-- ============================================================================
alter table public.teams
  add column if not exists home_venue         text,
  add column if not exists home_venue_address text;

alter table public.games
  add column if not exists venue_address text;

comment on column public.teams.home_venue         is 'default venue name for this club''s home fixtures';
comment on column public.teams.home_venue_address is 'postal address, shown on the fixtures page';
comment on column public.games.venue_address      is 'overrides the home club''s address for this fixture';

-- ---------------------------------------------------------------------------
-- Demo addresses, so the fixtures page has something to show. Invented
-- buildings on real-sounding streets — no attempt at a real postcode, because
-- a fake address that geocodes somewhere real is worse than one that obviously
-- does not.
-- ---------------------------------------------------------------------------
do $$
declare
  v_league uuid;
begin
  select id into v_league from leagues where slug = 'demo-league';
  if v_league is null then
    raise notice 'no demo league — nothing to fill in';
    return;
  end if;

  update teams set
    home_venue = case slug
      when 'east-dock'   then 'East Dock Hall'
      when 'neon-city'   then 'The Lantern Centre'
      when 'harbour-bay' then 'Harbour Bay Arena'
      when 'soft-club'   then 'Pillow Factory Courts'
      else coalesce(home_venue, name || ' Sports Hall') end,
    home_venue_address = case slug
      when 'east-dock'   then 'Dock Road, Eastbourne Wharf, EB1 4QT'
      when 'neon-city'   then '18 Lantern Street, Northgate, NG2 7PL'
      when 'harbour-bay' then 'Marine Parade, Harbour Bay, HB3 1RN'
      when 'soft-club'   then 'Unit 6, Old Pillow Works, Southey, SY9 2BD'
      else coalesce(home_venue_address, 'Address not yet recorded') end
  where league_id = v_league;

  /* Fixtures inherit their home club's venue where they have none of their
     own. Existing rows that already name a venue keep it — an address is
     added, but nobody's typed-in venue name is overwritten. */
  update games g set
    venue = coalesce(g.venue, t.home_venue),
    venue_address = coalesce(g.venue_address, t.home_venue_address)
  from teams t
  where t.id = g.home_team_id and t.league_id = v_league;

  raise notice 'venues and addresses filled in for the demo league';
end $$;
