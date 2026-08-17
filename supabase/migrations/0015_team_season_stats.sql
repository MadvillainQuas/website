-- ============================================================================
-- 0015 — team_season_stats gains the box score.
--
-- The view carried points, pace, ortg and the situational buckets (paint, fast
-- break, second chance, points off turnovers) but none of the ordinary team
-- box score — no rebounds, assists, steals, blocks or shooting splits. A team
-- statistics table cannot be built from what it had.
--
-- Everything below already exists inside team_game_stats.stats->'adv', written
-- by the same teamAdv() the scorer uses, so this exposes it rather than
-- recomputing it. Opponent points come from the game row, which is what makes
-- a points-differential column possible.
-- ============================================================================
-- CREATE OR REPLACE cannot reorder or rename a view's columns, and this adds
-- pts_for in the middle of the existing list — Postgres refuses with 42P16.
-- Dropping first is safe: nothing reads this view but the pages, which query
-- it by name at runtime.
drop view if exists public.team_season_stats;

create view public.team_season_stats as
with base as (
  select
    g.competition_id, c.season_id, g.id as game_id,
    case when tgs.team_idx = 0 then g.home_team_id else g.away_team_id end as team_id,
    case when tgs.team_idx = 0 then g.home_score  else g.away_score  end as pts_for,
    case when tgs.team_idx = 0 then g.away_score  else g.home_score  end as pts_against,
    (tgs.stats->>'pts')::int     as pts,
    (tgs.stats->>'paint')::int   as paint,
    (tgs.stats->>'fast')::int    as fast,
    (tgs.stats->>'sc')::int      as second_chance,
    (tgs.stats->>'pot')::int     as pts_off_to,
    (tgs.stats->>'bench')::int   as bench,
    (tgs.stats->>'toTot')::int   as tov,
    (tgs.stats->>'foulTot')::int as fouls,
    -- the advanced block: the scorer's own teamAdv() output, stored at finalise
    ((tgs.stats->'adv')->>'possessions')::numeric as poss,
    ((tgs.stats->'adv')->>'efg')::numeric   as efg,
    ((tgs.stats->'adv')->>'ts')::numeric    as ts,
    ((tgs.stats->'adv')->>'ortg')::numeric  as ortg,
    ((tgs.stats->'adv')->>'pace')::numeric  as pace,
    ((tgs.stats->'adv')->>'astTo')::numeric as ast_to,
    ((tgs.stats->'adv')->>'tovp')::numeric  as tov_pct,
    ((tgs.stats->'adv')->>'orebp')::numeric as oreb_pct,
    ((tgs.stats->'adv')->>'ftr')::numeric   as ft_rate,
    ((tgs.stats->'adv')->>'fgm')::int  as fgm,  ((tgs.stats->'adv')->>'fga')::int  as fga,
    ((tgs.stats->'adv')->>'fg3m')::int as p3m,  ((tgs.stats->'adv')->>'fg3a')::int as p3a,
    ((tgs.stats->'adv')->>'ftm')::int  as ftm,  ((tgs.stats->'adv')->>'fta')::int  as fta,
    ((tgs.stats->'adv')->>'oreb')::int as oreb, ((tgs.stats->'adv')->>'dreb')::int as dreb,
    ((tgs.stats->'adv')->>'ast')::int  as ast,  ((tgs.stats->'adv')->>'stl')::int  as stl,
    ((tgs.stats->'adv')->>'blk')::int  as blk
  from team_game_stats tgs
  join games g on g.id = tgs.game_id and g.status = 'final'
  left join competitions c on c.id = g.competition_id
)
select
  season_id, competition_id, team_id,
  count(*)::int as gp,
  sum(pts) as pts, sum(pts_for) as pts_for, sum(pts_against) as pts_against,
  (sum(pts_for) - sum(pts_against)) as diff,
  sum(paint) as paint, sum(fast) as fast, sum(second_chance) as second_chance,
  sum(pts_off_to) as pts_off_to, sum(bench) as bench,
  sum(tov) as tov, sum(fouls) as fouls,
  sum(oreb) as oreb, sum(dreb) as dreb, (sum(oreb) + sum(dreb)) as reb,
  sum(ast) as ast, sum(stl) as stl, sum(blk) as blk,
  sum(fgm) as fgm, sum(fga) as fga, sum(p3m) as p3m, sum(p3a) as p3a,
  sum(ftm) as ftm, sum(fta) as fta,
  -- rates from summed components, never an average of per-game rates
  round(100 * sum(fgm)::numeric / nullif(sum(fga),0), 1)                    as fg_pct,
  round(100 * sum(p3m)::numeric / nullif(sum(p3a),0), 1)                    as p3_pct,
  round(100 * sum(ftm)::numeric / nullif(sum(fta),0), 1)                    as ft_pct,
  round(100 * (sum(fgm) + 0.5*sum(p3m))::numeric / nullif(sum(fga),0), 1)   as efg,
  round(100 * sum(pts)::numeric
        / nullif(2*(sum(fga) + 0.44*sum(fta)),0), 1)                        as ts,
  round(sum(ast)::numeric / nullif(sum(tov),0), 2)                          as ast_to,
  round(sum(pts_for)::numeric  / nullif(count(*),0), 1)                     as ppg,
  round(sum(pts_against)::numeric / nullif(count(*),0), 1)                  as papg,
  round(sum(reb_total)::numeric / nullif(count(*),0), 1)                    as rpg,
  round(sum(ast)::numeric      / nullif(count(*),0), 1)                     as apg,
  round(avg(ortg), 1) as ortg,
  round(avg(pace), 1) as pace,
  round(avg(poss), 1) as poss
from (select *, (oreb + dreb) as reb_total from base) b
group by season_id, competition_id, team_id;
