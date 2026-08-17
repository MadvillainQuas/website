-- ============================================================================
-- A previous season for the demo league.
--
-- Not decoration: until now every page took `order by starts_on desc limit 1`,
-- so a league with history had no way to show it — not an unlinked page, an
-- unreachable one. The season picker cannot be verified against a league with
-- exactly one season, and a control that has never been exercised with two
-- options is a control that has never been tested.
--
-- It is deliberately EMPTY of games. A second season with no results is the
-- realistic case for a league that has just rolled over, and it exercises the
-- other half of the work — the empty states each tab falls back to when a
-- season has been created but not yet played.
-- ============================================================================
do $$
declare
  v_league uuid;
  v_season uuid;
begin
  select id into v_league from leagues where slug = 'demo-league';
  if v_league is null then
    raise notice 'no demo league — nothing to add';
    return;
  end if;

  insert into seasons (league_id, name, starts_on, ends_on)
  values (v_league, '2025-26', date '2025-09-01', date '2026-05-31')
  on conflict do nothing
  returning id into v_season;

  if v_season is null then
    select id into v_season from seasons
     where league_id = v_league and name = '2025-26';
  end if;

  insert into competitions (season_id, name, kind, format)
  values (v_season, 'Division One', 'league', 'table')
  on conflict (season_id, name) do nothing;

  raise notice 'prior season ready';
end $$;
