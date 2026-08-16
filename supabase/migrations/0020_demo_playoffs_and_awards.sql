-- ============================================================================
-- Demo data for the new formats: a playoff bracket and the season's awards.
--
-- Both are DERIVED from the six games that have actually been played, not
-- invented — the bracket is seeded from the real table and the awards from the
-- real season statistics. That matters for more than tidiness: it means this
-- migration is also a test of seed_bracket and compute_season_awards against
-- real data, and it fails loudly here rather than the first time a league
-- tries to use them.
-- ============================================================================
do $$
declare
  v_season uuid;
  v_league uuid;
  v_div    uuid;
  v_po     uuid;
  v_rounds int;
  v_awards int;
  v_ties   int;
begin
  select c.id, c.season_id into v_div, v_season
    from competitions c
    join seasons s on s.id = c.season_id
    join leagues l on l.id = s.league_id
   where l.slug = 'demo-league'
   order by c.name
   limit 1;

  if v_div is null then
    raise notice 'no demo league — nothing to seed';
    return;
  end if;

  -- the awards for the league proper
  select compute_season_awards(v_div) into v_awards;
  raise notice 'awards computed for the division: %', v_awards;

  -- a playoff competition alongside it, in the same season
  insert into competitions (season_id, name, kind, format)
  values (v_season, 'Playoffs', 'playoff', 'knockout')
  on conflict (season_id, name) do update set kind = 'playoff', format = 'knockout'
  returning id into v_po;

  if v_po is null then
    select id into v_po from competitions where season_id = v_season and name = 'Playoffs';
  end if;

  -- every team that is in the division is in the playoffs
  insert into competition_teams (competition_id, team_id)
  select v_po, ct.team_id from competition_teams ct where ct.competition_id = v_div
  on conflict do nothing;

  -- seed the bracket FROM THE DIVISION'S TABLE: 1 plays 4, 2 plays 3, so the
  -- top two seeds can only meet in the final
  select seed_bracket(v_po, 4, v_div) into v_rounds;
  select count(*) into v_ties from bracket_ties where competition_id = v_po;
  raise notice 'bracket seeded: % rounds, % ties', v_rounds, v_ties;

  if v_ties <> 3 then
    raise exception 'a four-team bracket must be 3 ties (2 semi-finals and a final), got %', v_ties;
  end if;

  -- the semi-finals as real fixtures, attached to their ties, so the bracket
  -- links to box scores the moment they are played
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, venue,
                     status, tie_id, leg)
  select v_po, t.home_team_id, t.away_team_id,
         (now() + (interval '7 days') + (t.slot * interval '2 hours')),
         'Playoff venue', 'scheduled', t.id, 1
    from bracket_ties t
   where t.competition_id = v_po and t.round = 1
     and t.home_team_id is not null and t.away_team_id is not null
     and not exists (select 1 from games g where g.tie_id = t.id);

  perform advance_bracket(v_po);
  raise notice 'playoffs ready';
end $$;
