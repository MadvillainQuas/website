-- ============================================================================
-- 0189 -- A LOSS IS WORTH 0 LEAGUE POINTS, in every league, and every table rebuilt.
--
-- A league's table has always been W x win_points + L x loss_points (recompute_standings, 0002 -> 0144),
-- with the two numbers in leagues.rules and 2 / 1 as the default. Nothing on the site hard-codes either:
-- the pages show the stored standings.league_points, and the box score's DYNAMIC TABLES tab reads its
-- scheme off those rows. So this is a data change plus one recompute:
--
--   1. every existing league's rules get loss_points = 0 (win_points is left as each league has it);
--   2. the column default for a NEW league says 0, so a league made from now on starts that way;
--   3. every competition's table is recomputed, so the stored league_points, and with them the rank
--      order, follow the new value at once (nothing recomputes on a rules change by itself).
--
-- A team's points DEDUCTION (team_sanctions) is untouched: it is subtracted after the games are counted.
-- Note for whoever enters one: docking a WIN converts it to a loss, and the points to take off for that are
-- entered by hand, so with a loss worth 0 the swing of a docked win is the whole win_points, not one less.
--
-- The recompute is run competition by competition and a competition that fails is reported and skipped,
-- rather than undoing every other league's table; re-run `select public.recompute_standings('<id>')` for it.
-- The migration runs as the database owner, which recompute_standings_guard lets through (no uid).
-- ============================================================================

-- 1. every league that exists
update public.leagues
   set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{loss_points}', '0'::jsonb, true)
 where (rules->>'loss_points') is distinct from '0';

-- 2. every league made from now on
alter table public.leagues alter column rules set default jsonb_build_object(
  'period_ms', 600000, 'ot_ms', 300000, 'periods', 4,
  'bonus_at', 5, 'timeouts_h1', 2, 'timeouts_h2', 3, 'timeouts_ot', 1,
  'win_points', 2, 'loss_points', 0,
  'tiebreak', jsonb_build_array('points','h2h','h2h_diff','diff','scored'));

-- 3. every table rebuilt on the new value
do $$
declare
  c record;
  done int := 0;
  failed int := 0;
begin
  for c in select id from public.competitions order by id loop
    begin
      perform public.recompute_standings(c.id);
      done := done + 1;
    exception when others then
      failed := failed + 1;
      raise notice '0189: recompute_standings(%) failed: %', c.id, sqlerrm;
    end;
  end loop;
  raise notice '0189: % competition table(s) recomputed, % failed', done, failed;
end $$;

-- the proof, in the migration's own output: no league is left on another value
do $$
declare n int;
begin
  select count(*) into n from public.leagues where (rules->>'loss_points') is distinct from '0';
  if n > 0 then raise exception '0189: % league(s) still have a loss_points other than 0', n; end if;
end $$;
