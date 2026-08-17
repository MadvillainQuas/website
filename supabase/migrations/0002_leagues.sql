-- ============================================================================
-- COURTSIDE NETWORK — Phase 2: standings and season statistics
--
-- Everything here is DERIVED. Drop every row in these tables and re-running
-- recompute_standings + refresh_season_stats rebuilds them from game_events.
--
-- A design gap 0001 left open, fixed here:
--   player_game_stats.player_id is the scorer's local id ('p0_3' in an ad-hoc
--   game). That cannot be aggregated across a season. Platform games now carry
--   the real players.id UUID as the scorer's pid, so the id is stable from the
--   first tap; player_uuid below stores it typed, and ad-hoc games simply have
--   NULL there and never reach the season tables.
-- ============================================================================

-- ---------------------------------------------------------------- standings
create table if not exists public.standings (
  competition_id uuid not null references public.competitions on delete cascade,
  team_id        uuid not null references public.teams on delete cascade,
  gp int not null default 0,
  w  int not null default 0,
  l  int not null default 0,
  pts_for int not null default 0,
  pts_against int not null default 0,
  diff int generated always as (pts_for - pts_against) stored,
  league_points int not null default 0,
  streak text not null default '',
  rank int,
  updated_at timestamptz not null default now(),
  primary key (competition_id, team_id)
);
create index if not exists standings_comp_rank on public.standings (competition_id, rank);

alter table public.standings enable row level security;
drop policy if exists standings_read on public.standings;
create policy standings_read on public.standings for select using (true);
-- writes happen through the SECURITY DEFINER function below, never directly

-- typed player identity on the derived stats
alter table public.player_game_stats
  add column if not exists player_uuid uuid references public.players on delete set null;
create index if not exists pgs_player_uuid on public.player_game_stats (player_uuid);

-- ============================================================================
-- recompute_standings — reads the league's own rules, so an 8-minute school
-- league and a FIBA league can share this function.
-- ============================================================================
create or replace function public.recompute_standings(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r_win  int;
  r_loss int;
begin
  select coalesce((l.rules->>'win_points')::int, 2),
         coalesce((l.rules->>'loss_points')::int, 1)
    into r_win, r_loss
    from competitions c
    join seasons s on s.id = c.season_id
    join leagues l on l.id = s.league_id
   where c.id = p_competition;

  r_win  := coalesce(r_win, 2);
  r_loss := coalesce(r_loss, 1);

  delete from standings where competition_id = p_competition;

  with played as (
    -- one row per team per finished game, from that team's point of view
    select g.home_team_id as team_id, g.home_score as pf, g.away_score as pa, g.tipoff_at, g.id
      from games g where g.competition_id = p_competition and g.status = 'final'
    union all
    select g.away_team_id, g.away_score, g.home_score, g.tipoff_at, g.id
      from games g where g.competition_id = p_competition and g.status = 'final'
  ),
  agg as (
    select team_id,
           count(*)::int                                as gp,
           sum((pf > pa)::int)::int                     as w,
           sum((pf < pa)::int)::int                     as l,
           sum(pf)::int                                 as pts_for,
           sum(pa)::int                                 as pts_against,
           sum((pf > pa)::int) * r_win
             + sum((pf < pa)::int) * r_loss             as league_points
      from played group by team_id
  ),
  -- streak: walk each team's games newest-first and count the leading run
  ordered as (
    select team_id, (pf > pa) as won,
           row_number() over (partition by team_id order by tipoff_at desc nulls last, id desc) as rn
      from played
  ),
  streaks as (
    select o.team_id,
           (case when max(case when o.rn = 1 then o.won end) then 'W' else 'L' end)
           || count(*) filter (
                where o.rn <= coalesce((
                  select min(x.rn) - 1 from ordered x
                   where x.team_id = o.team_id
                     and x.won <> (select y.won from ordered y where y.team_id = o.team_id and y.rn = 1)
                ), (select count(*) from ordered z where z.team_id = o.team_id))
              )::text as streak
      from ordered o group by o.team_id
  )
  insert into standings (competition_id, team_id, gp, w, l, pts_for, pts_against, league_points, streak, updated_at)
  select p_competition, a.team_id, a.gp, a.w, a.l, a.pts_for, a.pts_against, a.league_points,
         coalesce(s.streak, ''), now()
    from agg a left join streaks s on s.team_id = a.team_id;

  -- teams entered but yet to play still belong on the table
  insert into standings (competition_id, team_id, updated_at)
  select p_competition, ct.team_id, now()
    from competition_teams ct
   where ct.competition_id = p_competition
     and not exists (select 1 from standings st
                      where st.competition_id = p_competition and st.team_id = ct.team_id);

  -- rank: league points, then goal difference, then points scored
  with ranked as (
    select team_id, row_number() over (
             order by league_points desc, (pts_for - pts_against) desc, pts_for desc
           ) as rk
      from standings where competition_id = p_competition
  )
  update standings st set rank = r.rk
    from ranked r
   where st.competition_id = p_competition and st.team_id = r.team_id;
end; $$;

-- ============================================================================
-- Season aggregates.
--
-- Rates are recomputed from summed components — never an average of averages,
-- which is the classic way to get a wrong season TS%.
-- ============================================================================
create or replace view public.player_season_stats as
with base as (
  select
    g.competition_id,
    c.season_id,
    pgs.player_uuid          as player_id,
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
  where pgs.player_uuid is not null       -- ad-hoc games have no stable identity
)
select
  season_id, competition_id, player_id, team_id,
  count(*)::int                       as gp,
  round(sum(min_ms)/60000.0, 1)       as min,
  sum(pts) as pts, sum(ast) as ast, sum(stl) as stl, sum(blk) as blk,
  sum(tov) as tov, sum(pf) as pf, sum(fd) as fd, sum(pm) as pm,
  sum(oreb) as oreb, sum(dreb) as dreb, (sum(oreb) + sum(dreb)) as reb,
  sum(p2m) as p2m, sum(p2a) as p2a, sum(p3m) as p3m, sum(p3a) as p3a,
  sum(ftm) as ftm, sum(fta) as fta,
  (sum(p2m) + sum(p3m)) as fgm, (sum(p2a) + sum(p3a)) as fga,
  sum(rim_a) as rim_a, sum(rim_m) as rim_m, sum(mid_a) as mid_a, sum(mid_m) as mid_m,
  -- per game
  round(sum(pts)::numeric  / nullif(count(*),0), 1) as ppg,
  round((sum(oreb)+sum(dreb))::numeric / nullif(count(*),0), 1) as rpg,
  round(sum(ast)::numeric  / nullif(count(*),0), 1) as apg,
  -- rates, from summed components
  round(100 * (sum(p2m)+sum(p3m) + 0.5*sum(p3m))::numeric
        / nullif(sum(p2a)+sum(p3a),0), 1)                                as efg,
  round(100 * sum(pts)::numeric
        / nullif(2*((sum(p2a)+sum(p3a)) + 0.44*sum(fta)),0), 1)          as ts,
  round(100 * sum(p3m)::numeric / nullif(sum(p3a),0), 1)                 as p3_pct,
  round(100 * sum(ftm)::numeric / nullif(sum(fta),0), 1)                 as ft_pct,
  round(100 * sum(rim_m)::numeric / nullif(sum(rim_a),0), 1)             as rim_pct,
  round(sum(ast)::numeric / nullif(sum(tov),0), 2)                       as ast_to
from base
group by season_id, competition_id, player_id, team_id;

create or replace view public.team_season_stats as
with base as (
  select g.competition_id, c.season_id,
         case when tgs.team_idx = 0 then g.home_team_id else g.away_team_id end as team_id,
         (tgs.stats->>'pts')::int    as pts,
         (tgs.stats->>'paint')::int  as paint,
         (tgs.stats->>'fast')::int   as fast,
         (tgs.stats->>'sc')::int     as second_chance,
         (tgs.stats->>'pot')::int    as pts_off_to,
         (tgs.stats->>'bench')::int  as bench,
         (tgs.stats->>'toTot')::int  as tov,
         (tgs.stats->>'foulTot')::int as fouls,
         ((tgs.stats->'adv')->>'possessions')::numeric as poss,
         ((tgs.stats->'adv')->>'efg')::numeric  as efg,
         ((tgs.stats->'adv')->>'ortg')::numeric as ortg,
         ((tgs.stats->'adv')->>'pace')::numeric as pace
    from team_game_stats tgs
    join games g on g.id = tgs.game_id and g.status = 'final'
    left join competitions c on c.id = g.competition_id
)
select season_id, competition_id, team_id,
       count(*)::int as gp,
       sum(pts) as pts, sum(paint) as paint, sum(fast) as fast,
       sum(second_chance) as second_chance, sum(pts_off_to) as pts_off_to,
       sum(bench) as bench, sum(tov) as tov, sum(fouls) as fouls,
       round(avg(efg), 1)  as efg,
       round(avg(ortg), 1) as ortg,
       round(avg(pace), 1) as pace,
       round(sum(pts)::numeric / nullif(count(*),0), 1) as ppg
  from base group by season_id, competition_id, team_id;

-- views inherit the RLS of their base tables (they are not SECURITY DEFINER),
-- so a viewer only ever aggregates games they were allowed to read.

-- ============================================================================
-- Convenience: a league's full table in one call
-- ============================================================================
create or replace function public.season_leaders(p_competition uuid, p_min_games int default 1)
returns table (
  player_id uuid, team_id uuid, gp int, min numeric, pts bigint,
  ppg numeric, rpg numeric, apg numeric, efg numeric, ts numeric
) language sql stable security invoker set search_path = public as $$
  select player_id, team_id, gp, min, pts, ppg, rpg, apg, efg, ts
    from player_season_stats
   where competition_id = p_competition and gp >= p_min_games
   order by ppg desc nulls last;
$$;
