-- ============================================================================
-- 0014 — fixtures still to play.
--
-- 0012 finished every game in the league, which left the scorer's fixture
-- picker correctly reporting that there was nothing to score. A league that
-- only has a past is not much of a demo, and there was no way to exercise the
-- pick-a-fixture -> score -> finalise path end to end.
--
-- Six more, one round of the round-robin, left as 'scheduled'.
-- ============================================================================
do $$
declare
  cp uuid;
  nc uuid; sc uuid; hb uuid; ed uuid;
  base timestamptz := '2026-11-07T19:30:00Z';
begin
  select c.id into cp from competitions c
    join seasons s on s.id = c.season_id
    join leagues l on l.id = s.league_id
   where l.slug = 'demo-league' order by c.name limit 1;
  if cp is null then raise notice 'no demo league — skipping'; return; end if;

  select id into nc from teams where slug = 'neon-city';
  select id into sc from teams where slug = 'soft-club';
  select id into hb from teams where slug = 'harbour-bay';
  select id into ed from teams where slug = 'east-dock';

  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, venue, status)
  values
    (cp, nc, hb, base,                      'Neon City Arena',  'scheduled'),
    (cp, sc, ed, base + interval '2 hours', 'The Soft Club',    'scheduled'),
    (cp, hb, sc, base + interval '3 days',  'Harbour Bay Dome', 'scheduled'),
    (cp, ed, nc, base + interval '3 days 2 hours', 'East Dock Hall', 'scheduled'),
    (cp, nc, sc, base + interval '7 days',  'Neon City Arena',  'scheduled'),
    (cp, hb, ed, base + interval '7 days 2 hours', 'Harbour Bay Dome', 'scheduled');

  raise notice 'six fixtures scheduled';
end $$;
