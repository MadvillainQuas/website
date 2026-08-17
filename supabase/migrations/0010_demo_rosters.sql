-- ============================================================================
-- 0010 — rosters for the demo league.
--
-- The demo seed in 0004 created leagues, teams and games but no players, so
-- every roster was empty, every player page was blank, and player_uuid could
-- never populate — which is why the season stat views and the leaders board
-- had nothing in them. Twelve players per team, adults only so they are
-- publicly visible (a minor is withheld by RLS, which would make the demo
-- look broken for the wrong reason).
--
-- Idempotent: skips entirely if the demo teams already have a roster.
-- ============================================================================
do $$
declare
  rosters jsonb := jsonb_build_object(
    'neon-city', jsonb_build_array(
      'Marcus Bell','Toby Ashworth','Devon Clarke','Isaac Nwosu','Rory Mackenzie',
      'Elliot Sang','Callum Reid','Jerome Whitfield','Danny Okafor','Kai Brennan',
      'Femi Adeyemi','Louis Trent'),
    'soft-club', jsonb_build_array(
      'Andre Fontaine','Sam Kowalski','Tyrese Boateng','Nathan Vasquez','Owen Hartley',
      'Malik Osei','Jonah Petrov','Reece Sullivan','Dominic Achebe','Finn Gallagher',
      'Xavier Moreau','Aaron Lindqvist'),
    'harbour-bay', jsonb_build_array(
      'Zeke Ramirez','Harvey Cline','Omar Haddad','Bryce Donnelly','Leo Nakamura',
      'Solomon Reyes','Freddie Marsh','Ade Bankole','Casper Lindholm','Miles Prentice',
      'Julien Diallo','Theo Wren'),
    'east-dock', jsonb_build_array(
      'Curtis Amadi','Silas Byrne','Ronan Petrelli','Jamal Ferreira','Beck Sandoval',
      'Iggy Kovacs','Tomas Iwu','Wesley Barham','Noah Kimani','Ellis Vance',
      'Rasheed Marchetti','Gideon Pike')
  );
  positions text[] := array['G','G','F','F','C','G','F','C','G','F','F','C'];
  team_slug text;
  names jsonb;
  tm uuid;
  sn uuid;
  full_name text;
  pid uuid;
  i int;
begin
  select s.id into sn
  from seasons s join leagues l on l.id = s.league_id
  where l.slug = 'demo-league' order by s.starts_on desc limit 1;

  if exists (select 1 from roster_entries re
             join teams t on t.id = re.team_id
             join leagues l on l.id = t.league_id
             where l.slug = 'demo-league') then
    raise notice 'demo rosters already present — skipping';
    return;
  end if;

  for team_slug, names in select * from jsonb_each(rosters) loop
    select id into tm from teams where slug = team_slug;
    if tm is null then
      raise notice 'no team %, skipping', team_slug;
      continue;
    end if;

    for i in 0 .. jsonb_array_length(names) - 1 loop
      full_name := names ->> i;

      insert into players (slug, first_name, last_name, birth_year, is_minor)
      values (
        team_slug || '-' || lower(regexp_replace(full_name, '\s+', '-', 'g')),
        split_part(full_name, ' ', 1),
        split_part(full_name, ' ', 2),
        1996 + (i % 8),        -- all adults; birth YEAR only, never a full date
        false
      )
      returning id into pid;

      insert into roster_entries (team_id, player_id, season_id, jersey, position, active)
      values (tm, pid, sn, (4 + i)::text, positions[i + 1], true);
    end loop;

    raise notice 'rostered % for %', jsonb_array_length(names), team_slug;
  end loop;
end $$;
