-- ============================================================================
-- A cup for the demo league, so the Cup tab has something in it.
--
-- Same reasoning as the prior season in 0024: a tab that has only ever been
-- seen empty is a tab that has never been tested. This also exercises the
-- distinction the public page now depends on — `kind = 'cup'` puts a
-- competition on its own tab, where `league` and `playoff` share the Table
-- tab as stages of one season.
--
-- The bracket is seeded from the division's real table, so the ties are the
-- clubs that actually exist rather than invented names.
-- ============================================================================
do $$
declare
  v_season uuid;
  v_div    uuid;
  v_cup    uuid;
  v_ties   int;
begin
  select c.id, c.season_id into v_div, v_season
    from competitions c
    join seasons s on s.id = c.season_id
    join leagues l on l.id = s.league_id
   where l.slug = 'demo-league' and c.name = 'Division One'
   order by s.starts_on desc
   limit 1;

  if v_div is null then
    raise notice 'no demo division — nothing to add';
    return;
  end if;

  insert into competitions (season_id, name, kind, format)
  values (v_season, 'Harbour Cup', 'cup', 'knockout')
  on conflict (season_id, name) do update set kind = 'cup', format = 'knockout'
  returning id into v_cup;

  if v_cup is null then
    select id into v_cup from competitions
     where season_id = v_season and name = 'Harbour Cup';
  end if;

  insert into competition_teams (competition_id, team_id)
  select v_cup, ct.team_id from competition_teams ct where ct.competition_id = v_div
  on conflict do nothing;

  perform seed_bracket(v_cup, 4, v_div);
  select count(*) into v_ties from bracket_ties where competition_id = v_cup;
  if v_ties <> 3 then
    raise exception 'expected 3 cup ties, got %', v_ties;
  end if;

  -- first-round fixtures, attached to their ties
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, venue,
                     status, tie_id, leg)
  select v_cup, t.home_team_id, t.away_team_id,
         (now() + interval '14 days' + (t.slot * interval '2 hours')),
         'Neutral venue', 'scheduled', t.id, 1
    from bracket_ties t
   where t.competition_id = v_cup and t.round = 1
     and t.home_team_id is not null and t.away_team_id is not null
     and not exists (select 1 from games g where g.tie_id = t.id);

  perform advance_bracket(v_cup);
  raise notice 'cup ready with % ties', v_ties;
end $$;
