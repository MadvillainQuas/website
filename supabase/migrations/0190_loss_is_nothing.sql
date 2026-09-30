-- ============================================================================
-- 0190: A LOSS IS WORTH NOTHING IN THE TABLE (loss_points 0)
--
-- The platform began with FIBA's two-and-one (0001: leagues.rules win_points 2, loss_points 1), so
-- every team table credited a point for every defeat. The tables now give 2 for a win and 0 for a
-- loss. A league whose own competition rules say otherwise can still set loss_points in
-- leagues.rules; every league still on the old default is moved, new leagues start at 0, and every
-- table is worked out again so the points column says so today rather than at the next final.
-- ============================================================================

alter table public.leagues alter column rules set default jsonb_build_object(
  'period_ms', 600000, 'ot_ms', 300000, 'periods', 4,
  'bonus_at', 5, 'timeouts_h1', 2, 'timeouts_h2', 3, 'timeouts_ot', 1,
  'win_points', 2, 'loss_points', 0,
  'tiebreak', jsonb_build_array('points','h2h','h2h_diff','diff','scored'));

update public.leagues
   set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{loss_points}', '0'::jsonb)
 where coalesce(rules->>'loss_points', '1') = '1';

-- recompute_standings lets a caller with no auth.uid() through (it is the service role's path, and this
-- one's): only competitions that have a table to redo
do $$
declare c record;
begin
  for c in select distinct competition_id as id from public.standings loop
    perform public.recompute_standings(c.id);
  end loop;
end $$;
