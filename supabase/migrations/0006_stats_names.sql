-- ============================================================================
-- Fix: the season stats page got PGRST200 —
--   "no foreign key relationship between 'player_season_stats' and 'teams'".
--
-- PostgREST can only embed related rows where a FOREIGN KEY exists, and a view
-- has none. Rather than make the client fetch players and teams separately and
-- stitch them together, the names are joined in SQL where they belong: one
-- request, one row per player, and the join is the database's job.
-- ============================================================================
create or replace view public.player_season_stats as
with base as (
  select
    g.competition_id,
    c.season_id,
    pgs.player_uuid as player_id,
    pgs.team_idx,
    case when pgs.team_idx = 0 then g.home_team_id else g.away_team_id end as team_id,
    (pgs.stats->>'min')::numeric   as min_ms,
    (pgs.stats->>'pts')::int       as pts,
    (pgs.stats->>'p2m')::int       as p2m,  (pgs.stats->>'p2a')::int as p2a,
    (pgs.stats->>'p3m')::int       as p3m,  (pgs.stats->>'p3a')::int as p3a,
    (pgs.stats->>'ftm')::int       as ftm,  (pgs.stats->>'fta')::int as fta,
    (pgs.stats->>'or')::int        as oreb, (pgs.stats->>'dr')::int  as dreb,
    (pgs.stats->>'ast')::int       as ast,  (pgs.stats->>'stl')::int as stl,
    (pgs.stats->>'blk')::int       as blk,  (pgs.stats->>'to')::int  as tov,
    (pgs.stats->>'pf')::int        as pf,   (pgs.stats->>'fd')::int  as fd,
    (pgs.stats->>'pm')::int        as pm,
    (pgs.stats->>'rimA')::int      as rim_a, (pgs.stats->>'rimM')::int as rim_m,
    (pgs.stats->>'midA')::int      as mid_a, (pgs.stats->>'midM')::int as mid_m
  from player_game_stats pgs
  join games g on g.id = pgs.game_id and g.status = 'final'
  left join competitions c on c.id = g.competition_id
  where pgs.player_uuid is not null
),
agg as (
  select
    season_id, competition_id, player_id, team_id,
    count(*)::int                 as gp,
    round(sum(min_ms)/60000.0, 1) as min,
    sum(pts) as pts, sum(ast) as ast, sum(stl) as stl, sum(blk) as blk,
    sum(tov) as tov, sum(pf) as pf, sum(fd) as fd, sum(pm) as pm,
    sum(oreb) as oreb, sum(dreb) as dreb, (sum(oreb) + sum(dreb)) as reb,
    sum(p2m) as p2m, sum(p2a) as p2a, sum(p3m) as p3m, sum(p3a) as p3a,
    sum(ftm) as ftm, sum(fta) as fta,
    (sum(p2m) + sum(p3m)) as fgm, (sum(p2a) + sum(p3a)) as fga,
    sum(rim_a) as rim_a, sum(rim_m) as rim_m, sum(mid_a) as mid_a, sum(mid_m) as mid_m,
    round(sum(pts)::numeric / nullif(count(*),0), 1)                     as ppg,
    round((sum(oreb)+sum(dreb))::numeric / nullif(count(*),0), 1)        as rpg,
    round(sum(ast)::numeric / nullif(count(*),0), 1)                     as apg,
    round(100 * (sum(p2m)+sum(p3m) + 0.5*sum(p3m))::numeric
          / nullif(sum(p2a)+sum(p3a),0), 1)                              as efg,
    round(100 * sum(pts)::numeric
          / nullif(2*((sum(p2a)+sum(p3a)) + 0.44*sum(fta)),0), 1)        as ts,
    round(100 * sum(p3m)::numeric / nullif(sum(p3a),0), 1)               as p3_pct,
    round(100 * sum(ftm)::numeric / nullif(sum(fta),0), 1)               as ft_pct,
    round(100 * sum(rim_m)::numeric / nullif(sum(rim_a),0), 1)           as rim_pct,
    round(sum(ast)::numeric / nullif(sum(tov),0), 2)                     as ast_to
  from base
  group by season_id, competition_id, player_id, team_id
)
select
  a.*,
  -- names joined here so the client needs one request and no FK embedding.
  -- RLS on players still applies: a minor's row is withheld, so their name
  -- comes back null rather than leaking through the aggregate.
  p.first_name, p.last_name, p.slug as player_slug, p.is_minor,
  t.name as team_name, t.short_name as team_short, t.slug as team_slug, t.colour as team_colour,
  re.jersey
from agg a
left join players p on p.id = a.player_id
left join teams   t on t.id = a.team_id
left join lateral (
  select r.jersey from roster_entries r
   where r.player_id = a.player_id and r.team_id = a.team_id
   order by r.created_at desc limit 1
) re on true;
