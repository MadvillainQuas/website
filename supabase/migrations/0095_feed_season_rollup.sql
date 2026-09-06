-- ============================================================================
-- 0095 — FEED SEASON ROLL-UP (roadmap Phase 4, first slice).
--
-- game_advanced is per game. The league site's team pages, the standings
-- context and the analytics app all want per-team season lines, and they
-- must be ONE source: ratio-of-sums over the same team rows the game view
-- shows, never an average of per-game rates.
--
-- Implemented as a plain table refreshed by a function (not a materialised
-- view) so a single game's re-ingest can refresh just that competition, and
-- so the row is readable through RLS like any other public season table.
-- The worker calls refresh_feed_team_season(competition_id) after writing a
-- game; pg_cron (if enabled on the project) can also run it nightly:
--   select cron.schedule('feed-season-nightly', '15 3 * * *',
--          $$select public.refresh_feed_team_season(null)$$);
-- ============================================================================

create table if not exists public.feed_team_season (
  competition_id uuid not null references public.competitions on delete cascade,
  team_id        uuid not null references public.teams on delete cascade,
  games          int  not null default 0,
  wins           int  not null default 0,
  losses         int  not null default 0,
  pts            numeric not null default 0,
  pts_against    numeric not null default 0,
  poss           numeric not null default 0,
  opp_poss       numeric not null default 0,
  fgm numeric not null default 0, fga numeric not null default 0,
  fg3m numeric not null default 0, fg3a numeric not null default 0,
  ftm numeric not null default 0, fta numeric not null default 0,
  oreb numeric not null default 0, dreb numeric not null default 0,
  ast numeric not null default 0, stl numeric not null default 0, blk numeric not null default 0,
  tov numeric not null default 0, pf numeric not null default 0,
  opp_fgm numeric not null default 0, opp_fga numeric not null default 0,
  opp_fg3m numeric not null default 0, opp_fg3a numeric not null default 0,
  opp_fta numeric not null default 0, opp_oreb numeric not null default 0, opp_dreb numeric not null default 0,
  opp_tov numeric not null default 0,
  fb_pts numeric not null default 0, sc_pts numeric not null default 0, pot_pts numeric not null default 0,
  -- derived (kept as columns so PostgREST callers get them without a view)
  ortg numeric, drtg numeric, net_rtg numeric, pace numeric,
  efg numeric, tov_pct numeric, oreb_pct numeric, ftr numeric,
  opp_efg numeric, frc_tov_pct numeric, opp_oreb_pct numeric, opp_ftr numeric,
  refreshed_at timestamptz not null default now(),
  primary key (competition_id, team_id)
);
alter table public.feed_team_season enable row level security;
drop policy if exists feed_team_season_read on public.feed_team_season;
create policy feed_team_season_read on public.feed_team_season for select using (true);

-- One team-perspective row per game from game_advanced.team (home/away) +
-- the games row for ids. jsonb numeric extraction is tolerant of the
-- adapter's float/int mix.
create or replace function public.refresh_feed_team_season(p_competition uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  with persp as (
    select g.competition_id,
           case side when 'home' then g.home_team_id else g.away_team_id end as team_id,
           (ga.team -> side)                         as me,
           (ga.team -> (case side when 'home' then 'away' else 'home' end)) as opp,
           (ga.transition -> side)                   as tr
    from public.game_advanced ga
    join public.games g on g.id = ga.game_id
    cross join (values ('home'), ('away')) as s(side)
    where ga.status = 'final'
      and g.competition_id is not null
      and (p_competition is null or g.competition_id = p_competition)
  ),
  agg as (
    select competition_id, team_id,
      count(*) as games,
      sum(case when (me->>'points')::numeric > (opp->>'points')::numeric then 1 else 0 end) as wins,
      sum(case when (me->>'points')::numeric < (opp->>'points')::numeric then 1 else 0 end) as losses,
      sum((me->>'points')::numeric) as pts, sum((opp->>'points')::numeric) as pts_against,
      sum(coalesce((me->>'poss')::numeric, 0)) as poss, sum(coalesce((opp->>'poss')::numeric, 0)) as opp_poss,
      sum(coalesce((me->>'fgm')::numeric,0)) fgm, sum(coalesce((me->>'fga')::numeric,0)) fga,
      sum(coalesce((me->>'fg3m')::numeric,0)) fg3m, sum(coalesce((me->>'fg3a')::numeric,0)) fg3a,
      sum(coalesce((me->>'ftm')::numeric,0)) ftm, sum(coalesce((me->>'fta')::numeric,0)) fta,
      sum(coalesce((me->>'oreb')::numeric,0)) oreb, sum(coalesce((me->>'dreb')::numeric,0)) dreb,
      sum(coalesce((me->>'ast')::numeric,0)) ast, sum(coalesce((me->>'stl')::numeric,0)) stl, sum(coalesce((me->>'blk')::numeric,0)) blk,
      sum(coalesce((me->>'tov')::numeric,0)) tov, sum(coalesce((me->>'pf')::numeric,0)) pf,
      sum(coalesce((opp->>'fgm')::numeric,0)) opp_fgm, sum(coalesce((opp->>'fga')::numeric,0)) opp_fga,
      sum(coalesce((opp->>'fg3m')::numeric,0)) opp_fg3m, sum(coalesce((opp->>'fg3a')::numeric,0)) opp_fg3a,
      sum(coalesce((opp->>'fta')::numeric,0)) opp_fta, sum(coalesce((opp->>'oreb')::numeric,0)) opp_oreb,
      sum(coalesce((opp->>'dreb')::numeric,0)) opp_dreb, sum(coalesce((opp->>'tov')::numeric,0)) opp_tov,
      sum(coalesce((tr->>'fb')::numeric,0)) fb_pts, sum(coalesce((tr->>'sc')::numeric,0)) sc_pts, sum(coalesce((tr->>'pot')::numeric,0)) pot_pts
    from persp
    group by competition_id, team_id
  ),
  up as (
    insert into public.feed_team_season as f (
      competition_id, team_id, games, wins, losses, pts, pts_against, poss, opp_poss,
      fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf,
      opp_fgm, opp_fga, opp_fg3m, opp_fg3a, opp_fta, opp_oreb, opp_dreb, opp_tov,
      fb_pts, sc_pts, pot_pts,
      ortg, drtg, net_rtg, pace, efg, tov_pct, oreb_pct, ftr, opp_efg, frc_tov_pct, opp_oreb_pct, opp_ftr, refreshed_at)
    select competition_id, team_id, games, wins, losses, pts, pts_against, poss, opp_poss,
      fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf,
      opp_fgm, opp_fga, opp_fg3m, opp_fg3a, opp_fta, opp_oreb, opp_dreb, opp_tov,
      fb_pts, sc_pts, pot_pts,
      case when poss > 0 then pts / poss * 100 end,
      case when opp_poss > 0 then pts_against / opp_poss * 100 end,
      case when poss > 0 and opp_poss > 0 then pts / poss * 100 - pts_against / opp_poss * 100 end,
      case when games > 0 then (poss + opp_poss) / 2 / games end,
      case when fga > 0 then (fgm + 0.5 * fg3m) / fga * 100 end,
      case when (fga + 0.44 * fta + tov) > 0 then tov / (fga + 0.44 * fta + tov) * 100 end,
      case when (oreb + opp_dreb) > 0 then oreb / (oreb + opp_dreb) * 100 end,
      case when fga > 0 then fta / fga * 100 end,
      case when opp_fga > 0 then (opp_fgm + 0.5 * opp_fg3m) / opp_fga * 100 end,
      case when (opp_fga + 0.44 * opp_fta + opp_tov) > 0 then opp_tov / (opp_fga + 0.44 * opp_fta + opp_tov) * 100 end,
      case when (opp_oreb + dreb) > 0 then opp_oreb / (opp_oreb + dreb) * 100 end,
      case when opp_fga > 0 then opp_fta / opp_fga * 100 end,
      now()
    from agg
    on conflict (competition_id, team_id) do update set
      games = excluded.games, wins = excluded.wins, losses = excluded.losses,
      pts = excluded.pts, pts_against = excluded.pts_against, poss = excluded.poss, opp_poss = excluded.opp_poss,
      fgm = excluded.fgm, fga = excluded.fga, fg3m = excluded.fg3m, fg3a = excluded.fg3a, ftm = excluded.ftm, fta = excluded.fta,
      oreb = excluded.oreb, dreb = excluded.dreb, ast = excluded.ast, stl = excluded.stl, blk = excluded.blk, tov = excluded.tov, pf = excluded.pf,
      opp_fgm = excluded.opp_fgm, opp_fga = excluded.opp_fga, opp_fg3m = excluded.opp_fg3m, opp_fg3a = excluded.opp_fg3a,
      opp_fta = excluded.opp_fta, opp_oreb = excluded.opp_oreb, opp_dreb = excluded.opp_dreb, opp_tov = excluded.opp_tov,
      fb_pts = excluded.fb_pts, sc_pts = excluded.sc_pts, pot_pts = excluded.pot_pts,
      ortg = excluded.ortg, drtg = excluded.drtg, net_rtg = excluded.net_rtg, pace = excluded.pace,
      efg = excluded.efg, tov_pct = excluded.tov_pct, oreb_pct = excluded.oreb_pct, ftr = excluded.ftr,
      opp_efg = excluded.opp_efg, frc_tov_pct = excluded.frc_tov_pct, opp_oreb_pct = excluded.opp_oreb_pct, opp_ftr = excluded.opp_ftr,
      refreshed_at = now()
    returning 1
  )
  select count(*) into n from up;
  return n;
end $$;
revoke all on function public.refresh_feed_team_season(uuid) from public;
-- the worker (service role) calls it; nobody else needs to.
