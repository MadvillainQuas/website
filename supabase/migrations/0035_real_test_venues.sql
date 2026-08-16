-- ============================================================================
-- Real venue addresses for the demo clubs, so the map can be tested.
--
-- 0034 invented addresses — "Dock Road, Eastbourne Wharf, EB1 4QT" — which
-- read plausibly and geocode to nothing, so the embedded map showed an empty
-- ocean. Test data that cannot be tested with is not test data.
--
-- These are REAL British sports venues, attached to fictional clubs. That is
-- the right way round for a demo: the addresses have to resolve for the map to
-- prove anything, and nobody is misled because the CLUBS are obviously
-- invented. No real club is being claimed to play anywhere.
--
-- Replace them with the actual venues when real clubs are onboarded; the
-- league admin sets a club's home venue once and every home fixture inherits
-- it.
-- ============================================================================
do $$
declare
  v_league uuid;
  n int;
begin
  select id into v_league from leagues where slug = 'demo-league';
  if v_league is null then
    raise notice 'no demo league — nothing to fill in';
    return;
  end if;

  update teams set
    home_venue = case slug
      when 'east-dock'   then 'Copper Box Arena'
      when 'neon-city'   then 'Emirates Arena'
      when 'harbour-bay' then 'Ponds Forge International Sports Centre'
      when 'soft-club'   then 'University of Worcester Arena'
      else home_venue end,
    home_venue_address = case slug
      when 'east-dock'   then 'Queen Elizabeth Olympic Park, London, E20 3HB'
      when 'neon-city'   then '1000 London Road, Glasgow, G40 3HG'
      when 'harbour-bay' then 'Sheaf Street, Sheffield, S1 2BP'
      when 'soft-club'   then 'Hylton Road, Worcester, WR2 5JN'
      else home_venue_address end
  where league_id = v_league
    and slug in ('east-dock', 'neon-city', 'harbour-bay', 'soft-club');
  get diagnostics n = row_count;

  /* Fixtures carry their own copy so a relocated tie can differ from the
     club's default. Refresh the ones that still match what 0034 wrote, and
     leave anything a human has since changed alone. */
  update games g set
    venue = t.home_venue,
    venue_address = t.home_venue_address
  from teams t
  where t.id = g.home_team_id
    and t.league_id = v_league
    and (g.venue_address is null
         or g.venue_address like '%Eastbourne Wharf%'
         or g.venue_address like '%Lantern Street%'
         or g.venue_address like '%Marine Parade%'
         or g.venue_address like '%Old Pillow Works%'
         or g.venue_address = 'Address not yet recorded');

  raise notice 'real venues set for % clubs, and their home fixtures updated', n;
end $$;
