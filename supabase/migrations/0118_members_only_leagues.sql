-- ============================================================================
-- 0118 — A MEMBERS-ONLY LEAGUE, ENFORCED BY THE DATABASE.
--
-- The contract is docs/memberships.md, §2 and §4.4. 0117 wrote the rule
-- (can_view_league: open leagues are for everyone, members-only leagues for
-- whoever holds the `league` feature). This file points every existing path to
-- on-court content at that rule:
--
--   * can_read_game / can_read_game_detail, which guard games, officials, video
--     and two anon RPCs;
--   * the inlined read policies on game_events and game_state (0084) and, new
--     here, on player_game_stats, team_game_stats and lineup_stints, which copy
--     can_read_game_detail for speed and must copy the change too;
--   * player_season_stats / team_season_stats, owner-rights views that no
--     table policy reaches;
--   * RESTRICTIVE select policies on the league-owned tables whose read policy
--     is `true` or otherwise knows nothing about access, and the highlight
--     request that would otherwise render a members-only game into a public
--     bucket;
--   * the anon-callable security definer RPCs that return on-court content;
--   * the two notification fan-outs.
--
-- 0116 (games_write_guard, recompute_standings' guard) applies first and
-- nothing here redefines what it defines; the self-tests below write games only
-- as the migration's own role, which that guard does not judge.
--
-- OPEN LEAGUES BEHAVE EXACTLY AS BEFORE. Every condition added to a game rule
-- is written as `case when <no league> or <open> or <memberships switched off>
-- then true else ... end`, so for an open league (every league as shipped) the
-- answer is decided by a column already joined, before any function that looks
-- a person up is reached. The restrictive policies go one further: while NO
-- league is members-only, one check per statement (any_members_league) answers
-- for every row, and nothing is evaluated per row at all. The first self-test
-- proves, against every real game, that for games outside members-only leagues
-- the new functions answer exactly what the old ones did.
--
-- AND WHILE MEMBERSHIPS ARE SWITCHED OFF, EVERY LEAGUE IS AN OPEN LEAGUE. The
-- master switch (0117's memberships_enabled(), shipped false) is part of every
-- fast path here: any_members_league() is false while it is off, and each
-- inlined CASE treats "switched off" exactly like "open", asked once per
-- statement through a sub-select. So a league that sets itself members-only
-- ahead of the switch changes nothing for anybody until a platform admin
-- switches memberships on — which the self-tests prove both ways.
--
-- THE SHOP WINDOW STAYS OPEN. leagues, seasons, competitions, teams, rosters
-- and players are not touched. Scheduled fixtures stay public while the league
-- keeps access_fixtures_public on.
--
-- WHAT THIS DOES NOT PROTECT (contract §2): public storage buckets, public
-- Realtime broadcast topics, the broadcast function's anon reads, and data a
-- public feed already publishes at source.
--
-- ONE DEVIATION FROM THE CONTRACT, deliberately: game_visible() lets through
-- the same staff can_read_game does — the managers of the two clubs (and so
-- their leagues' admins), the people named in game_officials for that game, and
-- the admins of the game's league. Without it a cup game in a members-only
-- league would show a visiting club's manager its events and box score but not
-- its video or advanced stats, and a per-game statistician would lose the
-- video of the very game they are scoring (and have the scorer's upserts
-- refused, which a restrictive SELECT policy also constrains).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE HELPERS the restrictive policies and RPCs call.
--
-- any_members_league() is the fast path. Written in a policy as
-- `not (select public.any_members_league()) or <the check>`, the sub-select is
-- an InitPlan: evaluated once for the statement, so while no league is
-- members-only every row passes on a constant and the check is never called.
-- The partial index keeps the question an index probe however many open
-- leagues the feed ingest creates. It is "is anything gated right now", so it
-- is also false while memberships are switched off for the platform (0117),
-- which is how the switch reaches every restrictive policy and every helper
-- below without a second sub-select.
--
-- The other three: nothing to look up -> visible; open league -> visible,
-- decided by the leagues row alone; otherwise can_view_league. Each starts with
-- a cheaper fast path of its own -- "is any league members-only at all", read
-- straight off the partial index -- for the RPCs that call them directly. Not
-- any_members_league(): inside a per-row helper that would add a nested definer
-- call and a platform_settings read for every open-league row once the switch
-- is on. The switch still reaches them: through each policy's outer
-- (select any_members_league()), and through can_view_league, which asks it
-- straight after the open-league check. Security definer
-- so they read competitions/seasons/leagues without re-entering those tables'
-- policies, and executable by anon because a policy runs as the querying role
-- (0051). A row that does not exist is "visible": there is nothing there to
-- hide, and a policy that refused it would refuse nothing real.
-- ----------------------------------------------------------------------------
create index if not exists leagues_members_only_idx
  on public.leagues (id) where access_mode = 'members';

create or replace function public.any_members_league()
returns boolean language sql stable security definer set search_path = public as $$
  select public.memberships_enabled()
         and exists (select 1 from leagues l where l.access_mode = 'members');
$$;

create or replace function public.league_visible(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null or not exists (select 1 from public.leagues m where m.access_mode = 'members') then true
    else coalesce((
      select case when l.access_mode = 'open' then true
                  else public.can_view_league(l.id) end
        from leagues l
       where l.id = p_league), true)
  end;
$$;

create or replace function public.competition_visible(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_competition is null or not exists (select 1 from public.leagues m where m.access_mode = 'members') then true
    else coalesce((
      select case when l.id is null or l.access_mode = 'open' then true
                  else public.can_view_league(l.id) end
        from competitions c
        left join seasons s on s.id = c.season_id
        left join leagues l on l.id = s.league_id
       where c.id = p_competition), true)
  end;
$$;

/* A game belongs to a league through competition -> season -> league, the same
   chain can_read_game uses; an ad-hoc game (no competition) belongs to none.
   After the league's own answer, can_read_game's staff branches in its order
   (see the header): each is reached only in a members-only league, and only
   by somebody the league has already said no to. */
create or replace function public.game_visible(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_game is null or not exists (select 1 from public.leagues m where m.access_mode = 'members') then true
    else coalesce((
      select case
               when l.id is null or l.access_mode = 'open' then true
               when public.can_view_league(l.id) then true
               when public.is_team_manager(g.home_team_id)
                 or public.is_team_manager(g.away_team_id) then true
               when exists (select 1 from game_officials go
                             where go.game_id = g.id and go.user_id = auth.uid()) then true
               else public.is_league_admin(l.id)
             end
        from games g
        left join competitions c on c.id = g.competition_id
        left join seasons s      on s.id = c.season_id
        left join leagues  l     on l.id = s.league_id
       where g.id = p_game), true)
  end;
$$;

revoke all on function public.any_members_league() from public;
grant execute on function public.any_members_league() to anon, authenticated, service_role;
revoke all on function public.league_visible(uuid) from public;
grant execute on function public.league_visible(uuid) to anon, authenticated, service_role;
revoke all on function public.competition_visible(uuid) from public;
grant execute on function public.competition_visible(uuid) to anon, authenticated, service_role;
revoke all on function public.game_visible(uuid) from public;
grant execute on function public.game_visible(uuid) to anon, authenticated, service_role;
alter function public.any_members_league() owner to postgres;
alter function public.league_visible(uuid) owner to postgres;
alter function public.competition_visible(uuid) owner to postgres;
alter function public.game_visible(uuid) owner to postgres;

/* The older helpers the policies and views below call as the querying role.
   Each has been executable by PUBLIC since 0001 and nothing here revokes that;
   the three roles that query these tables are named so the grant is stated
   where it is relied on, and the self-test reads it back. */
grant execute on function public.is_platform_admin() to anon, authenticated, service_role;
grant execute on function public.is_league_admin(uuid) to anon, authenticated, service_role;
grant execute on function public.is_team_manager(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. THE GAME RULES (latest: 0005). The PUBLIC branches gain the league
-- condition; the staff branches (the two clubs' managers, the game's
-- officials, the league's admins) are exactly as they were. Memberships
-- switched off counts as open, beside the open check, so the answer never
-- reaches can_view_league while the switch is off.
-- ----------------------------------------------------------------------------

-- the fixture row: a scheduled game in a members-only league stays public
-- while the league keeps its fixtures public
create or replace function public.can_read_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    left join leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( ( ( g.status in ('scheduled','final')                      -- fixtures & results
                or (g.status = 'live' and coalesce(l.public_live,false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       when g.status = 'scheduled' and l.access_fixtures_public then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- the detail: events, clock state, box scores, stints. Never public before
-- the whistle, so there is no fixtures exception here.
create or replace function public.can_read_game_detail(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    left join leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live,false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- Nothing revoked: both have always been callable by PUBLIC, and every policy
-- that calls them runs as anon or authenticated. Stated, not changed.
grant execute on function public.can_read_game(uuid) to anon, authenticated, service_role;
grant execute on function public.can_read_game_detail(uuid) to anon, authenticated, service_role;
alter function public.can_read_game(uuid) owner to postgres;
alter function public.can_read_game_detail(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 3. THE PER-ROW READ POLICIES, INLINED.
--
-- game_events and game_state are 0084's inlined copy of can_read_game_detail,
-- given the same change. The box-score tables and lineup stints were still
-- `using (public.can_read_game_detail(game_id))` (0005): a function call per
-- ROW, which in a members-only league reaches the feature lookup — up to eight
-- index reads — for every one of a season's box-score lines. Inlined the same
-- way, the planner joins games once per game instead, and for an open league
-- the CASE is decided by l.access_mode, already in the join. While memberships
-- are switched off it is decided by `(select public.memberships_enabled())`,
-- an InitPlan read once for the whole statement.
--
-- Five copies of one predicate is the price of the speed; the first self-test
-- proves every one of them against can_read_game_detail, game by game and row
-- by row, rather than trusting that they were typed the same.
-- ----------------------------------------------------------------------------
drop policy if exists events_read on public.game_events;
create policy events_read on public.game_events for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = game_events.game_id
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

drop policy if exists state_read on public.game_state;
create policy state_read on public.game_state for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = game_state.game_id
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

drop policy if exists pgs_read on public.player_game_stats;
create policy pgs_read on public.player_game_stats for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = player_game_stats.game_id
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

drop policy if exists tgs_read on public.team_game_stats;
create policy tgs_read on public.team_game_stats for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = team_game_stats.game_id
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

drop policy if exists ls_read on public.lineup_stints;
create policy ls_read on public.lineup_stints for select
using (
  exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = lineup_stints.game_id
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from public.game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) )
  )
);

-- ----------------------------------------------------------------------------
-- 4. THE SEASON VIEWS (latest: player_season_stats 0006, team_season_stats
-- 0015). They run with their owner's rights, so no table policy reaches them;
-- the condition goes in their own query. CREATE OR REPLACE is enough: the
-- output columns are identical in name, type and order, so existing grants and
-- ownership are kept. Nothing in the schema depends on either view (the
-- functions that read them are not dependencies); the owner is pinned so the
-- view keeps bypassing RLS whoever applies this file.
--
-- ONCE PER QUERY, NOT ONCE PER BOX-SCORE LINE. `vis` answers "may the caller
-- see this league" for every league, and is MATERIALIZED so the planner cannot
-- fold it back into the join and ask it again for each row: a season page reads
-- thousands of lines from a handful of leagues. An open league is answered by
-- its access_mode alone, and every league by the master switch while
-- memberships are off; can_view_league is called only for a members-only one
-- with memberships on.
-- A game with no league (an ad-hoc game) has no vis row and counts, as before.
--
-- The service role still reads everything: can_view_league answers true for it
-- (0117), which is what keeps finalise-game's award computation and the JSON
-- API whole for a members-only league.
-- ----------------------------------------------------------------------------
create or replace view public.player_season_stats as
with vis as materialized (
  select l.id, (l.access_mode = 'open' or not (select public.memberships_enabled())
                or public.can_view_league(l.id)) as ok
    from leagues l
),
base as (
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
  left join seasons s      on s.id = c.season_id
  left join vis            on vis.id = s.league_id
  where pgs.player_uuid is not null
    -- 0118: a members-only league's games count only for those who may see them
    and coalesce(vis.ok, true)
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

create or replace view public.team_season_stats as
with vis as materialized (
  select l.id, (l.access_mode = 'open' or not (select public.memberships_enabled())
                or public.can_view_league(l.id)) as ok
    from leagues l
),
base as (
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
  left join seasons s      on s.id = c.season_id
  left join vis            on vis.id = s.league_id
  -- 0118: a members-only league's games count only for those who may see them
  where coalesce(vis.ok, true)
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

alter view public.player_season_stats owner to postgres;
alter view public.team_season_stats owner to postgres;

-- ----------------------------------------------------------------------------
-- 5. RESTRICTIVE SELECT POLICIES.
--
-- Permissive policies OR together, and several of these tables have FOR ALL
-- staff policies that also grant SELECT, so adding the condition to one read
-- policy would leave the others open. A RESTRICTIVE policy is AND-ed with
-- whatever the permissive ones allow. It also constrains UPDATE/DELETE with
-- RETURNING and upserts; staff pass it, because staff hold `league` (and
-- game_visible passes the game's own staff, see the header). The service role
-- bypasses RLS and never sees these.
--
-- Each predicate is prefixed with the fast path (section 1), so on a platform
-- with no members-only league these tables cost what they cost before 0118:
-- one exists() per statement, not a definer function per row.
--
-- Every table and its path to a league was checked against its CREATE TABLE:
--   competition_id  standings, bracket_ties, season_awards, season_award_overrides,
--                   team_sanctions, player_suspensions (null = every competition),
--                   toty_ballots, feed_team_season
--   ballot_id       toty_candidates, toty_results (through toty_ballots)
--   league_id       news_articles
--   game_id         game_advanced, game_videos, video_jobs, highlight_jobs
--   game_id / competition_code -> feed_competitions.league_id   external_games
-- ----------------------------------------------------------------------------
do $$
declare
  tbl  text;
  pred text;
begin
  for tbl, pred in
    select * from (values
      ('standings',              'public.competition_visible(competition_id)'),
      ('bracket_ties',           'public.competition_visible(competition_id)'),
      ('season_awards',          'public.competition_visible(competition_id)'),
      ('season_award_overrides', 'public.competition_visible(competition_id)'),
      ('team_sanctions',         'public.competition_visible(competition_id)'),
      ('player_suspensions',     'public.competition_visible(competition_id)'),
      ('toty_ballots',           'public.competition_visible(competition_id)'),
      ('feed_team_season',       'public.competition_visible(competition_id)'),
      -- through the ballot, read as the caller: a ballot the caller cannot see
      -- (members-only, or a draft) hides its candidates and results too
      ('toty_candidates',        'exists (select 1 from public.toty_ballots b where b.id = toty_candidates.ballot_id and public.competition_visible(b.competition_id))'),
      ('toty_results',           'exists (select 1 from public.toty_ballots b where b.id = toty_results.ballot_id and public.competition_visible(b.competition_id))'),
      ('news_articles',          'public.league_visible(league_id)'),
      ('game_advanced',          'public.game_visible(game_id)'),
      ('game_videos',            'public.game_visible(game_id)'),
      ('video_jobs',             'public.game_visible(game_id)'),
      ('highlight_jobs',         'public.game_visible(game_id)'),
      ('external_games',         'public.game_visible(game_id) and (competition_code is null or public.league_visible((select fc.league_id from public.feed_competitions fc where fc.code = external_games.competition_code)))')
    ) as v(table_name, predicate)
  loop
    if to_regclass('public.' || tbl) is null then
      -- not expected (every table above exists by 0109), but a missing table
      -- must not stop the rest of the paywall from going on
      raise warning '0118: table public.% does not exist; its members-only policy was skipped', tbl;
      continue;
    end if;
    execute format('drop policy if exists members_only_read on public.%I', tbl);
    execute format('create policy members_only_read on public.%I as restrictive for select '
                   'to anon, authenticated using (not (select public.any_members_league()) or (%s))',
                   tbl, pred);
  end loop;
end $$;

/* ASKING FOR A REEL IS SEEING THE GAME (latest: 0111). The worker renders
   whatever highlight_jobs holds into the PUBLIC highlights bucket, at a path
   named after the job, so an insert policy that never asked whether the
   requester may see the game let a non-member have a members-only game's plays
   published. Everything 0111 checked is kept. */
drop policy if exists highlight_jobs_ask on public.highlight_jobs;
create policy highlight_jobs_ask on public.highlight_jobs for insert
  with check (
    requested_by = auth.uid()
    and jsonb_typeof(clips) = 'array'
    and ((jsonb_array_length(clips) between 1 and 80 and source_path is null)
         or (source_path is not null and edits is not null))
    and public.game_visible(game_id)
  );

-- ----------------------------------------------------------------------------
-- 6. THE ANON-CALLABLE RPCs that bypass RLS as their owner. Each is its latest
-- definition with one visibility condition added, and answers with its own
-- empty shape (no rows, or null) — exactly what it says for a league, a
-- competition or a game that has nothing to show.
-- ----------------------------------------------------------------------------

-- news_public (latest 0105). Its return type differs from the 0051 original,
-- and 0105 used a bare CREATE after its drop, so the shape is re-stated here
-- after a drop too (supabase/tests/migrations.test.mjs tracks shapes through
-- CREATE OR REPLACE). Grants are restored exactly as 0105 left them.
drop function if exists public.news_public(uuid, int, int);
create or replace function public.news_public(
  p_league uuid, p_limit int default 20, p_offset int default 0
) returns table (
  id uuid, slug text, title text, standfirst text, cover_path text,
  pinned boolean, published_at timestamptz, author_name text, total bigint,
  game_id uuid, home_score int, away_score int,
  home_name text, home_short text, home_colour text, home_colour_2 text, home_logo text,
  away_name text, away_short text, away_colour text, away_colour_2 text, away_logo text
) language sql stable security definer set search_path = public as $$
  select a.id, a.slug, a.title, a.standfirst, a.cover_path,
         a.pinned, a.published_at, a.author_name, count(*) over (),
         g.id, g.home_score, g.away_score,
         h.name, h.short_name, h.colour, h.colour_2, h.logo_path,
         w.name, w.short_name, w.colour, w.colour_2, w.logo_path
    from news_articles a
    left join games g on g.id = a.game_id
    left join teams h on h.id = g.home_team_id
    left join teams w on w.id = g.away_team_id
   where a.league_id = p_league and a.status = 'published'
     and public.league_visible(p_league)                                  -- 0118
   order by a.pinned desc, a.published_at desc nulls last
   limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
grant execute on function public.news_public(uuid, int, int) to anon, authenticated;

-- news_article (latest 0051): null, as for a slug that does not exist
create or replace function public.news_article(p_league uuid, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select a.id, a.slug, a.title, a.standfirst, a.body, a.cover_path,
           a.published_at, a.updated_at, a.author_name
      from news_articles a
     where a.league_id = p_league and a.slug = p_slug and a.status = 'published'
       and public.league_visible(p_league)                                -- 0118
     limit 1) x;
$$;

-- season_awards_resolved (latest 0047)
create or replace function public.season_awards_resolved(p_competition uuid)
returns table (
  code text, title text, player_id uuid, team_id uuid,
  value numeric, detail text, chosen boolean
) language sql stable security definer set search_path = public as $$
  select a.code, o.title, coalesce(o.player_id, a.player_id),
         coalesce(o.team_id, a.team_id),
         case when o.code is null then a.value end,
         coalesce(nullif(o.detail, ''), a.detail),
         o.code is not null
    from season_awards a
    left join season_award_overrides o
           on o.competition_id = a.competition_id and o.code = a.code
   where a.competition_id = p_competition
     and public.competition_visible(p_competition)                        -- 0118
  union all
  select o.code, o.title, o.player_id, o.team_id, null, o.detail, true
    from season_award_overrides o
   where o.competition_id = p_competition
     and public.competition_visible(p_competition)                        -- 0118
     and not exists (select 1 from season_awards a
                      where a.competition_id = o.competition_id and a.code = o.code);
$$;

-- toty_public (latest 0104, which changed the shape after a drop: same reason
-- as news_public above for dropping again)
drop function if exists public.toty_public(uuid);
create or replace function public.toty_public(p_competition uuid)
returns table (
  ballot_id uuid, title text, slots int, status text, closes_at timestamptz,
  rank int, player_id uuid, player_name text, player_slug text,
  team_id uuid, team_name text, team_colour text, team_slug text, score numeric,
  team_colour_2 text
) language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.slots, b.status, b.closes_at,
         r.rank, r.player_id, trim(p.first_name || ' ' || p.last_name), p.slug,
         r.team_id, t.name, t.colour, t.slug, r.score,
         t.colour_2
    from toty_ballots b
    left join toty_results r on r.ballot_id = b.id and r.rank <= b.slots
                            and b.status = 'published'
    left join players p on p.id = r.player_id
    left join teams t on t.id = r.team_id
   where b.competition_id = p_competition
     and b.status in ('open','closed','published')
     and (p.id is null or not p.is_minor)
     and public.competition_visible(p_competition)                        -- 0118
   order by b.created_at desc, r.rank;
$$;
grant execute on function public.toty_public(uuid) to anon, authenticated;

-- toty_ballot_public (latest 0047)
create or replace function public.toty_ballot_public(p_competition uuid)
returns table (
  ballot_id uuid, title text, slots int, status text,
  opens_at timestamptz, closes_at timestamptz,
  player_id uuid, player_name text, team_name text, team_colour text
) language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.slots, b.status, b.opens_at, b.closes_at,
         c.player_id, trim(p.first_name || ' ' || p.last_name),
         coalesce(t.name, ''), coalesce(t.colour, '#93f2bf')
    from toty_ballots b
    join toty_candidates c on c.ballot_id = b.id
    join players p on p.id = c.player_id and not p.is_minor
    left join teams t on t.id = c.team_id
   where b.competition_id = p_competition and b.status = 'open'
     and public.competition_visible(p_competition)                        -- 0118
   order by b.created_at desc, 8;
$$;

-- cast_toty_vote (latest 0047): a ballot the caller may not see does not
-- exist for them, so it is refused with the same words as a missing one
create or replace function public.cast_toty_vote(
  p_ballot uuid, p_players uuid[], p_voter text
) returns text language plpgsql security definer set search_path = public as $$
declare b record; v_n int; v_ok int;
begin
  select * into b from toty_ballots where id = p_ballot;
  if b is null then raise exception 'no such ballot' using errcode = '22023'; end if;
  if not public.competition_visible(b.competition_id) then                -- 0118
    raise exception 'no such ballot' using errcode = '22023';
  end if;
  if b.status <> 'open' then
    raise exception 'voting is not open' using errcode = '22023';
  end if;
  if b.opens_at is not null and now() < b.opens_at then
    raise exception 'voting has not opened yet' using errcode = '22023';
  end if;
  if b.closes_at is not null and now() > b.closes_at then
    raise exception 'voting has closed' using errcode = '22023';
  end if;
  if p_voter is null or length(trim(p_voter)) < 8 then
    raise exception 'a vote needs a voter key' using errcode = '22023';
  end if;

  select count(distinct p) into v_n from unnest(coalesce(p_players, '{}'::uuid[])) p;
  if v_n = 0 then raise exception 'pick somebody' using errcode = '22023'; end if;
  if v_n > b.slots then
    raise exception 'this ballot has % slots, you picked %', b.slots, v_n
      using errcode = '22023';
  end if;

  select count(*) into v_ok from toty_candidates c
   where c.ballot_id = p_ballot and c.player_id = any(p_players);
  if v_ok < v_n then
    raise exception 'somebody on that ballot is not a candidate' using errcode = '22023';
  end if;

  delete from toty_votes
   where ballot_id = p_ballot and voter_key = trim(p_voter) and source = 'public';

  insert into toty_votes (ballot_id, player_id, source, voter_key, weight)
  select distinct p_ballot, p, 'public', trim(p_voter), 1
    from unnest(p_players) p;

  return 'thank you — ' || v_n || ' vote' || case when v_n = 1 then '' else 's' end || ' recorded';
end; $$;

-- bracket_summary (latest 0046)
create or replace function public.bracket_summary(p_competition uuid)
returns table (round int, label text, ties bigint, legs int, decider text, resolved bigint)
language sql stable security definer set search_path = public as $$
  select b.round, min(b.label), count(*), min(b.legs), min(b.decider),
         count(b.winner_team_id)
    from bracket_ties b
   where b.competition_id = p_competition
     and public.competition_visible(p_competition)                        -- 0118
   group by b.round order by b.round;
$$;

-- broadcast_images (latest 0079). A members-only league's overlays read with
-- the anon key and go blank until a signed overlay token exists (contract §2).
create or replace function public.broadcast_images(p_game uuid)
returns table (player_id uuid, storage_path text)
language sql stable security definer set search_path = public as $$
  with squad as (
    select re.player_id
    from public.games g
    join public.roster_entries re
      on re.team_id in (g.home_team_id, g.away_team_id)
    where g.id = p_game and re.active
      and public.game_visible(p_game)                                     -- 0118
  )
  select distinct on (m.owner_id) m.owner_id, m.storage_path
  from public.media m
  join squad s on s.player_id = m.owner_id
  where m.owner_type = 'player'
    and m.kind = 'broadcast'
    and m.status = 'approved'
  order by m.owner_id, m.created_at desc;
$$;

-- season_leaders (latest 0002). Security INVOKER over player_season_stats,
-- which now filters itself; the explicit check says so where it is read.
create or replace function public.season_leaders(p_competition uuid, p_min_games int default 1)
returns table (
  player_id uuid, team_id uuid, gp int, min numeric, pts bigint,
  ppg numeric, rpg numeric, apg numeric, efg numeric, ts numeric
) language sql stable security invoker set search_path = public as $$
  select player_id, team_id, gp, min, pts, ppg, rpg, apg, efg, ts
    from player_season_stats
   where competition_id = p_competition and gp >= p_min_games
     and public.competition_visible(p_competition)                        -- 0118
   order by ppg desc nulls last;
$$;

-- officials_for_game (latest 0078)
create or replace function public.officials_for_game(p_game uuid)
returns table (id uuid, name text, roles text[], licence text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.roles, o.licence
  from public.games g
  join public.competitions c on c.id = g.competition_id
  join public.seasons s      on s.id = c.season_id
  join public.league_officials o on o.league_id = s.league_id
  where g.id = p_game and o.active
    and public.game_visible(p_game)                                       -- 0118
  order by o.name;
$$;

/* player_ban (latest 0045, anon since then). player_suspensions sits behind
   section 5's restrictive policy, and this read the table as its owner: a
   player's bans in a members-only competition came out to anyone who asked by
   player id. Each suspension now answers only where its competition is
   visible, the same test the policy applies — one with no competition (every
   competition) stays visible, as it does there. Its callers are unaffected in
   their own league: league_players (0052) is a league admin's, and staff hold
   the league. */
create or replace function public.player_ban(p_player uuid, p_comp uuid default null)
returns table (suspension_id uuid, games int, served int, ends_on date, active boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.games, public.suspension_served(s.id), s.ends_on,
         s.lifted_at is null
         and current_date >= s.starts_on
         and (s.ends_on is null or current_date <= s.ends_on)
         and (s.games is null or public.suspension_served(s.id) < s.games)
    from player_suspensions s
   where s.player_id = p_player
     and (p_comp is null or s.competition_id is null or s.competition_id = p_comp)
     and s.lifted_at is null
     and public.competition_visible(s.competition_id);                    -- 0118
$$;

-- ----------------------------------------------------------------------------
-- 7. THE FAN-OUTS (latest 0107). A follower who could not open the game page
-- is not sent its score or a player's line from it. Fixtures are skipped only
-- when the league keeps its fixtures private: a public fixture is public.
-- can_view_league_for is service-only, which these definer functions are too.
-- ----------------------------------------------------------------------------
create or replace function public.notify_game_final(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare g record; h record; w record; lg uuid; n int := 0; c int; title text; link text; comp text;
        v_members_only boolean;
begin
  select * into g from games where id = p_game;
  if not found or g.status not in ('final', 'finalising') then return 0; end if;
  select * into h from teams where id = g.home_team_id;
  select * into w from teams where id = g.away_team_id;
  lg := game_league(p_game);
  -- 0118: decided once for the game, so an open league — or any league while
  -- memberships are switched off — never looks anybody up
  select l.access_mode = 'members' into v_members_only from leagues l where l.id = lg;
  v_members_only := coalesce(v_members_only, false) and public.memberships_enabled();
  select name into comp from competitions where id = g.competition_id;
  title := coalesce(h.name, 'Home') || ' ' || coalesce(g.home_score, 0) || '–' || coalesce(g.away_score, 0) || ' ' || coalesce(w.name, 'Away');
  link := 'game/?g=' || g.id || '&mode=supabase';

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'result', title, coalesce(comp, 'Final score'), link, lg, g.id, g.id::text
    from fan_prefs p
   where ((p.want_results and (g.home_team_id = any(p.fav_team_ids) or g.away_team_id = any(p.fav_team_ids)))
          or g.id = any(p.fav_game_ids))
     and (not v_members_only or public.can_view_league_for(p.user_id, lg))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'player',
         trim(pl.first_name || ' ' || pl.last_name) || ': ' ||
           coalesce((s.stats->>'pts')::int, 0) || ' pts, ' ||
           (coalesce((s.stats->>'or')::int, 0) + coalesce((s.stats->>'dr')::int, 0)) || ' reb, ' ||
           coalesce((s.stats->>'ast')::int, 0) || ' ast',
         title, link || '&vp=' || pl.id, lg, g.id, g.id::text || ':' || pl.id
    from fan_prefs p
    join players pl on pl.id = any(p.fav_player_ids) and not pl.is_minor
    join player_game_stats s on s.game_id = g.id and s.player_id = pl.id::text
   where p.want_players
     and (not v_members_only or public.can_view_league_for(p.user_id, lg))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;

create or replace function public.notify_fixtures()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'fixture',
         coalesce(h.name, 'Home') || ' v ' || coalesce(w.name, 'Away'),
         to_char(g.tipoff_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || coalesce(' · ' || g.venue, ''),
         'game/?g=' || g.id || '&mode=supabase', game_league(g.id), g.id,
         g.id::text || case when g.tipoff_at < now() + interval '26 hours' then ':today' else ':soon' end
    from games g
    join teams h on h.id = g.home_team_id
    join teams w on w.id = g.away_team_id
    join fan_prefs p on (p.want_fixtures and (g.home_team_id = any(p.fav_team_ids) or g.away_team_id = any(p.fav_team_ids)))
                     or g.id = any(p.fav_game_ids)
    left join leagues l on l.id = game_league(g.id)                             -- 0118
   where g.status = 'scheduled' and g.tipoff_at > now() and g.tipoff_at < now() + interval '3 days'
     and (l.id is null or l.access_mode = 'open' or l.access_fixtures_public    -- 0118
          or not (select public.memberships_enabled())
          or public.can_view_league_for(p.user_id, l.id))
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_fixtures() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. OWNERSHIP. Every function replaced here is pinned to postgres, so a
-- definer keeps reading what it read whichever role applied this file (0115).
-- Grants are unchanged by CREATE OR REPLACE; the two dropped functions had
-- theirs restored above.
-- ----------------------------------------------------------------------------
alter function public.news_public(uuid, int, int) owner to postgres;
alter function public.news_article(uuid, text) owner to postgres;
alter function public.season_awards_resolved(uuid) owner to postgres;
alter function public.toty_public(uuid) owner to postgres;
alter function public.toty_ballot_public(uuid) owner to postgres;
alter function public.cast_toty_vote(uuid, uuid[], text) owner to postgres;
alter function public.bracket_summary(uuid) owner to postgres;
alter function public.broadcast_images(uuid) owner to postgres;
alter function public.season_leaders(uuid, int) owner to postgres;
alter function public.officials_for_game(uuid) owner to postgres;
alter function public.player_ban(uuid, uuid) owner to postgres;
alter function public.notify_game_final(uuid) owner to postgres;
alter function public.notify_fixtures() owner to postgres;

-- ============================================================================
-- SELF-TEST 1 — 0084's equivalence, re-run, and "open leagues are unchanged".
--
-- For every game in the database:
--   * the inlined read predicate (one text, used by all five per-row policies)
--     agrees with can_read_game_detail — as whoever applies this file, as
--     0084 did, and again SIGNED OUT, since the predicate reads games through
--     games' own policy and so depends on who is asking. (Row by row, per
--     table and per kind of visitor, is self-test 2.)
--   * for a game outside any members-only league — and, while memberships are
--     switched off (as shipped), for EVERY game — the new can_read_game and
--     can_read_game_detail answer exactly what the 0005 definitions answered.
--   * the signed-out pass runs twice, with the master switch as it is and
--     flipped, inside its rolled-back block.
-- Plus the catalogue: who can call the helpers, that the restrictive policies
-- are there, restrictive, for the two browser roles and behind the fast path,
-- and that the per-row policies and the highlight request are the new ones.
-- ============================================================================
do $test$
declare
  who        text := current_user || ' (session ' || session_user || ')';
  orig       text := current_user;
  gr         record;
  gid        uuid;
  ids        uuid[];
  inline_ok  boolean;
  fn_ok      boolean;
  new_detail boolean;
  new_read   boolean;
  old_detail boolean;
  old_read   boolean;
  is_open    boolean;
  checked    int := 0;
  disagreed  int := 0;
  anon_off   int := 0;
  changed    int := 0;
  sw         boolean;
  t          text;
  f          text;
begin
  -- every helper a policy or view calls runs as the querying role
  foreach f in array array['memberships_enabled()',
                           'any_members_league()', 'league_visible(uuid)', 'competition_visible(uuid)',
                           'game_visible(uuid)', 'can_view_league(uuid)', 'can_read_game(uuid)',
                           'can_read_game_detail(uuid)', 'is_platform_admin()',
                           'is_league_admin(uuid)', 'is_team_manager(uuid)'] loop
    if not has_function_privilege('anon', 'public.' || f, 'execute')
       or not has_function_privilege('authenticated', 'public.' || f, 'execute')
       or not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0118: % is called from policies or views as the querying role, but anon, authenticated or service_role cannot execute it', f;
    end if;
  end loop;
  foreach f in array array['notify_game_final(uuid)', 'notify_fixtures()'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute')
       or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception '0118: the fan-out % became callable from a browser', f;
    end if;
  end loop;

  foreach t in array array['standings', 'bracket_ties', 'season_awards', 'season_award_overrides',
                           'team_sanctions', 'player_suspensions', 'toty_ballots', 'toty_candidates',
                           'toty_results', 'feed_team_season', 'news_articles', 'game_advanced',
                           'external_games', 'game_videos', 'video_jobs', 'highlight_jobs'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = t and p.policyname = 'members_only_read'
            and p.permissive = 'RESTRICTIVE' and p.cmd = 'SELECT'
            and p.roles @> array['anon', 'authenticated']::name[]
            and p.qual like '%any_members_league%') then
      raise exception '0118: % has no restrictive members-only select policy for anon and authenticated behind the any_members_league fast path', t;
    end if;
  end loop;

  foreach t in array array['game_events', 'game_state', 'player_game_stats',
                           'team_game_stats', 'lineup_stints'] loop
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t and p.cmd = 'SELECT'
                      and p.permissive = 'PERMISSIVE'
                      and p.qual like '%access_mode%'
                      and p.qual like '%memberships_enabled%'
                      and p.qual not like '%can_read_game_detail%') then
      raise exception '0118: % has no inlined, members-aware read policy (it still calls a function per row, lost the league condition, or ignores the memberships master switch)', t;
    end if;
  end loop;

  /* the master switch's fast path, where a policy's does not reach: the game
     rules, the "anything gated?" check, and both season views. Each would still
     answer correctly without it (can_view_league asks the switch too), so no
     row count below can tell — which is why the text is checked. */
  foreach f in array array['can_read_game(uuid)', 'can_read_game_detail(uuid)', 'any_members_league()'] loop
    if (select p.prosrc from pg_proc p where p.oid = ('public.' || f)::regprocedure)
       not like '%memberships_enabled()%' then
      raise exception '0118: % does not ask the memberships master switch, so it looks leagues up while memberships are switched off', f;
    end if;
  end loop;
  foreach t in array array['player_season_stats', 'team_season_stats'] loop
    if pg_get_viewdef(('public.' || t)::regclass) not like '%memberships_enabled()%' then
      raise exception '0118: the % view does not ask the memberships master switch in its league CTE', t;
    end if;
  end loop;

  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'highlight_jobs'
                    and p.policyname = 'highlight_jobs_ask' and p.cmd = 'INSERT'
                    and coalesce(p.with_check, '') like '%game_visible%') then
    raise exception '0118: asking for a highlight reel does not check that the requester may see the game';
  end if;

  if public.any_members_league() is distinct from
     (public.memberships_enabled() and exists (select 1 from public.leagues where access_mode = 'members')) then
    raise exception '0118: any_members_league says %, the leagues table and the memberships switch say otherwise', public.any_members_league();
  end if;

  /* Each comparison is ONE statement, so both sides read the same snapshot: a
     migration runs READ COMMITTED against a live database, and a game going
     live between two statements is not a disagreement. */
  for gr in select id from public.games loop
    select exists (
      select 1
      from public.games gg
      left join public.competitions c on c.id = gg.competition_id
      left join public.seasons s      on s.id = c.season_id
      left join public.leagues  l     on l.id = s.league_id
      where gg.id = gr.id
        and ( ( ( gg.status = 'final'
                  or (gg.status = 'live' and coalesce(l.public_live, false)) )
                and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                         else public.can_view_league(l.id) end )
              or public.is_team_manager(gg.home_team_id)
              or public.is_team_manager(gg.away_team_id)
              or exists (select 1 from public.game_officials go
                         where go.game_id = gg.id and go.user_id = auth.uid())
              or (s.league_id is not null and public.is_league_admin(s.league_id)) )
    ), public.can_read_game_detail(gr.id)
      into inline_ok, fn_ok;

    checked := checked + 1;
    if inline_ok is distinct from fn_ok then
      disagreed := disagreed + 1;
      raise warning '0118: game % — inline says %, function says %', gr.id, inline_ok, fn_ok;
    end if;

    -- the 0005 definitions, verbatim, for games outside a members-only league
    -- (every game, while memberships are switched off), beside the new
    -- functions in the same statement
    select coalesce(l.access_mode, 'open') = 'open' or not public.memberships_enabled(),
           public.can_read_game_detail(g.id),
           public.can_read_game(g.id),
           ( g.status = 'final'
             or (g.status = 'live' and coalesce(l.public_live,false))
             or public.is_team_manager(g.home_team_id)
             or public.is_team_manager(g.away_team_id)
             or exists (select 1 from game_officials go
                        where go.game_id = g.id and go.user_id = auth.uid())
             or (s.league_id is not null and public.is_league_admin(s.league_id)) ),
           ( g.status in ('scheduled','final')
             or (g.status = 'live' and coalesce(l.public_live,false))
             or public.is_team_manager(g.home_team_id)
             or public.is_team_manager(g.away_team_id)
             or exists (select 1 from game_officials go
                        where go.game_id = g.id and go.user_id = auth.uid())
             or (s.league_id is not null and public.is_league_admin(s.league_id)) )
      into is_open, new_detail, new_read, old_detail, old_read
      from public.games g
      left join public.competitions c on c.id = g.competition_id
      left join public.seasons s      on s.id = c.season_id
      left join public.leagues  l     on l.id = s.league_id
     where g.id = gr.id;

    if is_open and (old_detail is distinct from new_detail
                    or old_read is distinct from new_read) then
      changed := changed + 1;
      raise warning '0118: game % is outside any members-only league but its visibility changed', gr.id;
    end if;
  end loop;

  if disagreed > 0 then
    raise exception '0118: the inlined read policy is NOT can_read_game_detail (% of % games disagree)',
      disagreed, checked;
  end if;
  if changed > 0 then
    raise exception '0118: % of % games outside members-only leagues changed visibility; open leagues must behave exactly as before',
      changed, checked;
  end if;

  /* The same, signed out. The ids are read first, with this file's rights:
     anon cannot list the games it is about to be asked about. Twice: with the
     memberships master switch as it stands, and flipped — the setting is
     written with this file's rights before each pass. Rolled back by a
     private code (the P0115 pattern), which also undoes the role switch and
     the setting. */
  select coalesce(array_agg(g.id), '{}'::uuid[]) into ids from public.games g;
  begin
    foreach sw in array array[public.memberships_enabled(), not public.memberships_enabled()] loop
      update public.platform_settings set value = to_jsonb(sw) where key = 'memberships_enabled';
      if public.memberships_enabled() is distinct from sw then
        raise exception '0118: could not set the memberships master switch to % for the signed-out pass', sw;
      end if;
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
      foreach gid in array ids loop
        select exists (
          select 1
          from public.games gg
          left join public.competitions c on c.id = gg.competition_id
          left join public.seasons s      on s.id = c.season_id
          left join public.leagues  l     on l.id = s.league_id
          where gg.id = gid
            and ( ( ( gg.status = 'final'
                      or (gg.status = 'live' and coalesce(l.public_live, false)) )
                    and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                             else public.can_view_league(l.id) end )
                  or public.is_team_manager(gg.home_team_id)
                  or public.is_team_manager(gg.away_team_id)
                  or exists (select 1 from public.game_officials go
                             where go.game_id = gg.id and go.user_id = auth.uid())
                  or (s.league_id is not null and public.is_league_admin(s.league_id)) )
        ), public.can_read_game_detail(gid)
          into inline_ok, fn_ok;
        if inline_ok is distinct from fn_ok then
          anon_off := anon_off + 1;
          raise warning '0118: signed out (memberships %), game % — inline says %, function says %',
            case when sw then 'on' else 'off' end, gid, inline_ok, fn_ok;
        end if;
      end loop;
      execute format('set local role %I', orig);
    end loop;
    if anon_off > 0 then
      raise exception '0118: signed out, the inlined read policy disagrees with can_read_game_detail in % of % checks (each game with memberships on and off)',
        anon_off, 2 * cardinality(ids);
    end if;
    raise exception using errcode = 'P0118', message = '0118 (1/2) signed-out pass done; rolling back';
  exception
    when sqlstate 'P0118' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  raise notice '0118 ok (1/2): the inlined read policy agrees with can_read_game_detail on all % games, as % and signed out (memberships on and off), and no game outside a members-only league changed', checked, who;
end $test$;

-- ============================================================================
-- SELF-TEST 2 — a members-only league and an open one, seen by each kind of
-- visitor.
--
-- Seeds, with the migration's own rights and before any role switch: a
-- members-only league (fixtures public) and an open league, each with a
-- season, a competition, two clubs, a player, a FINAL game with events, clock
-- state, a player and a team box score, a lineup stint, a standings row, a
-- published article, a suspension, and a SCHEDULED game; plus a cup game in
-- the members-only competition against the open league's home club. People:
-- an active subscriber, the members league's admin, the open league's home
-- club's manager, and a signed-in stranger; plus anon.
--
-- Then, impersonating each (SET LOCAL ROLE + forged request.jwt.claims, the
-- 0031/0115/0117 way), it counts what they can read through the tables, the
-- views and the patched RPCs, checks that every per-row read policy returns
-- EXACTLY the rows can_read_game_detail allows that caller — over every real
-- game in the database, not only the seeded ones — and asks for highlight
-- reels. Then the admin makes fixtures private through set_league_access and
-- the scheduled game must disappear for anon. Then the fan-outs.
--
-- THE MASTER SWITCH. Memberships ship switched off (0117), and while they are
-- off nothing here is refused. So the block switches them ON before any
-- expectation of a refusal, and proves the OFF half beside each part: anon and
-- the stranger, with memberships off, read the members league's final game,
-- events, box scores, stints, standings, news, suspensions and season views
-- exactly as a member does (and the row-by-row policy check covers them too);
-- the stranger may ask for a reel of its game; its private fixture shows; and
-- the fan-outs tell a follower who holds nothing. After the rollback the
-- setting must still be off.
--
-- ANON AND THE STRANGER ALWAYS RUN: a forged claim with a random sub needs no
-- account row. The subscriber, admin and manager (and a real account for the
-- fan-out stranger, whose fan_prefs row references auth.users) are created
-- fresh where this role may create auth.users rows, and otherwise borrowed
-- from existing profiles that hold no role, writer seat, official's seat or
-- subscription, inside the same rolled-back block. A notice says which.
--
-- EVERYTHING HAPPENS INSIDE A BLOCK THAT IS ALWAYS ROLLED BACK (the P0115
-- pattern): switching back goes to the captured role, never RESET ROLE, and the
-- block ends by raising a private code its handler swallows, undoing rows,
-- roles and claims together. Any other error fails the migration.
-- ============================================================================
do $test$
declare
  who          text := current_user || ' (session ' || session_user || ')';
  orig         text := current_user;
  u_sub        uuid := gen_random_uuid();
  u_admin      uuid := gen_random_uuid();
  u_mgr        uuid := gen_random_uuid();
  u_out        uuid := gen_random_uuid();   -- a stranger needs no account row to be refused
  out_real     boolean := true;
  have_users   boolean := true;
  half         text := 'fresh test accounts';
  borrowed     uuid[];
  lg_mem       uuid;  lg_open      uuid;
  se_mem       uuid;  se_open      uuid;
  cp_mem       uuid;  cp_open      uuid;
  t_mh         uuid;  t_ma         uuid;
  t_oh         uuid;  t_oa         uuid;
  pl_mem       uuid;  pl_open      uuid;
  g_mem_final  uuid;  g_open_final uuid;
  g_mem_sched  uuid;  g_open_sched uuid;
  g_mem_cup    uuid;
  all_ids      uuid[];
  vis          uuid[];
  tables       text[] := array['game_events', 'game_state', 'player_game_stats',
                               'team_game_stats', 'lineup_stints'];
  tbl          text;
  label        text;
  diff         text;
  counts       jsonb := '{}'::jsonb;
  counts_after jsonb := '{}'::jsonb;
  status_before jsonb;
  status_after jsonb;
  per_visitor  jsonb := '{}'::jsonb;
  stable       uuid[];
  moved        int := 0;
  seen         jsonb;
  allowed      jsonb;
  clip         jsonb := '[{"start_ms":0,"end_ms":4000,"label":"t118","kind":"p2_made"}]'::jsonb;
  r            record;
  j            jsonb;
  expected     jsonb;
  s            int;
  cup          int;
  n            int;
begin
  begin
    -- ======================================================= seeded as the owner
    insert into leagues (slug, name, access_mode)
      values ('zz-t118-members', '0118 Members', 'members') returning id into lg_mem;
    insert into leagues (slug, name) values ('zz-t118-open', '0118 Open') returning id into lg_open;

    insert into seasons (league_id, name) values (lg_mem, '0118')  returning id into se_mem;
    insert into seasons (league_id, name) values (lg_open, '0118') returning id into se_open;
    insert into competitions (season_id, name) values (se_mem, '0118 League')  returning id into cp_mem;
    insert into competitions (season_id, name) values (se_open, '0118 League') returning id into cp_open;

    insert into teams (league_id, slug, name) values (lg_mem, 'zz-t118-m-home', '0118 M Home')  returning id into t_mh;
    insert into teams (league_id, slug, name) values (lg_mem, 'zz-t118-m-away', '0118 M Away')  returning id into t_ma;
    insert into teams (league_id, slug, name) values (lg_open, 'zz-t118-o-home', '0118 O Home') returning id into t_oh;
    insert into teams (league_id, slug, name) values (lg_open, 'zz-t118-o-away', '0118 O Away') returning id into t_oa;

    insert into players (slug, first_name, last_name) values ('zz-t118-m-player', 'T118', 'Member') returning id into pl_mem;
    insert into players (slug, first_name, last_name) values ('zz-t118-o-player', 'T118', 'Open')   returning id into pl_open;

    -- created live so their events can be written, then finished (as this
    -- role, which 0116's games_write_guard does not judge)
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp_mem, t_mh, t_ma, now() - interval '2 days', 'live', 61, 50) returning id into g_mem_final;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp_open, t_oh, t_oa, now() - interval '2 days', 'live', 61, 50) returning id into g_open_final;
    insert into game_events (game_id, seq, t, team, pid, period, clock)
      values (g_mem_final, 1, 'p2_made', 0, pl_mem::text, 1, 500000),
             (g_mem_final, 2, 'p3_made', 0, pl_mem::text, 1, 400000),
             (g_open_final, 1, 'p2_made', 0, pl_open::text, 1, 500000),
             (g_open_final, 2, 'p3_made', 0, pl_open::text, 1, 400000);
    update games set status = 'final' where id in (g_mem_final, g_open_final);

    -- a cup tie in the members-only competition, against the OPEN league's club
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (cp_mem, t_oh, t_ma, now() - interval '3 days', 'final', 70, 60) returning id into g_mem_cup;

    insert into game_state (game_id, score_home, score_away)
      values (g_mem_final, 61, 50), (g_open_final, 61, 50);
    insert into player_game_stats (game_id, player_id, team_idx, stats)
      values (g_mem_final,  pl_mem::text,  0, '{"min":600000,"pts":5,"p2m":1,"p2a":2,"p3m":1,"p3a":1}'::jsonb),
             (g_open_final, pl_open::text, 0, '{"min":600000,"pts":5,"p2m":1,"p2a":2,"p3m":1,"p3a":1}'::jsonb);
    insert into team_game_stats (game_id, team_idx, stats)
      values (g_mem_final, 0, '{"pts":61}'::jsonb), (g_open_final, 0, '{"pts":61}'::jsonb);
    insert into lineup_stints (game_id, team_idx, player_ids, stats)
      values (g_mem_final, 0, array[pl_mem::text], '{"secs":600}'::jsonb),
             (g_open_final, 0, array[pl_open::text], '{"secs":600}'::jsonb);
    insert into standings (competition_id, team_id, gp, w, l, pts_for, pts_against, league_points, rank)
      values (cp_mem, t_mh, 1, 1, 0, 61, 50, 2, 1), (cp_open, t_oh, 1, 1, 0, 61, 50, 2, 1);
    insert into news_articles (league_id, slug, title, status, published_at)
      values (lg_mem,  'zz-t118-news', '0118 members news', 'published', now()),
             (lg_open, 'zz-t118-news', '0118 open news',    'published', now());
    insert into player_suspensions (player_id, competition_id, team_id, games)
      values (pl_mem, cp_mem, t_mh, 2), (pl_open, cp_open, t_oh, 2);

    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_mem, t_mh, t_ma, now() + interval '1 day', 'scheduled') returning id into g_mem_sched;
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (cp_open, t_oh, t_oa, now() + interval '1 day', 'scheduled') returning id into g_open_sched;

    /* Rows the per-row check below can only get right through the policies'
       OWN branches. Each inlined policy reads games through games' policy, and
       that already refuses a members-only final game to a stranger, so it would
       hide a drift in the league condition. It cannot hide these: leftovers of a
       reverted game on a fixture anyone may list (detail is never public before
       the whistle), and the cup tie's stints, which the visiting manager reaches
       only through the clubs' branch. */
    insert into game_state (game_id, score_home, score_away) values (g_open_sched, 0, 0);
    insert into player_game_stats (game_id, player_id, team_idx, stats)
      values (g_open_sched, pl_open::text, 0, '{"min":60000,"pts":2}'::jsonb);
    insert into team_game_stats (game_id, team_idx, stats) values (g_open_sched, 0, '{"pts":2}'::jsonb);
    insert into lineup_stints (game_id, team_idx, player_ids, stats)
      values (g_open_sched, 0, array[pl_open::text], '{"secs":60}'::jsonb),
             (g_mem_cup,    0, array[pl_open::text], '{"secs":600}'::jsonb);

    /* memberships as shipped (off): a members-only league in the table gates
       nothing, and the fast path says so. Then ON, for everything below that
       expects a refusal; each OFF check switches it off and back itself. */
    if public.memberships_enabled() then
      raise exception '0118: memberships are switched on before the self-test switched them on; 0117 ships them off';
    end if;
    if public.any_members_league() then
      raise exception '0118: any_members_league is true with memberships switched off — the fast path ignores the master switch';
    end if;
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
    if not found or not public.memberships_enabled() then
      raise exception '0118: could not switch memberships on for the self-test';
    end if;

    if not public.any_members_league() then
      raise exception '0118: any_members_league is false with a members-only league in the table';
    end if;

    -- ---- the accounts: fresh, or borrowed ----------------------------------
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             x.email, '', now(), now(), now()
        from (values (u_sub,   't118-sub@example.invalid'),
                     (u_admin, 't118-admin@example.invalid'),
                     (u_mgr,   't118-mgr@example.invalid'),
                     (u_out,   't118-out@example.invalid')) as x(id, email);
    exception when insufficient_privilege then
      have_users := false;
      out_real := false;
    end;

    if not have_users then
      /* borrowed for the length of a rolled-back block; see the header */
      select array_agg(x.id) into borrowed
        from (select p.id from public.profiles p
               where not exists (select 1 from public.memberships m where m.user_id = p.id)
                 and not exists (select 1 from public.league_writers w where w.user_id = p.id)
                 and not exists (select 1 from public.game_officials go where go.user_id = p.id)
                 and not exists (select 1 from public.access_subscriptions a where a.user_id = p.id)
               order by p.created_at
               limit 4) x;
      if coalesce(cardinality(borrowed), 0) = 4 then
        u_sub := borrowed[1]; u_admin := borrowed[2]; u_mgr := borrowed[3]; u_out := borrowed[4];
        have_users := true;
        out_real := true;
        half := 'four borrowed profiles';
      else
        half := 'NOT RUN: ' || who || ' may not create auth.users rows and only '
                || coalesce(cardinality(borrowed), 0) || ' of 4 clean profiles exist';
      end if;
    end if;

    if have_users then
      insert into memberships (user_id, role, scope_type, scope_id)
      values (u_admin, 'league_admin', 'league', lg_mem),
             (u_mgr,   'team_manager', 'team',   t_oh);
      insert into access_subscriptions (user_id, plan_id, league_id, features, status,
                                        stripe_subscription_id, stripe_customer_id, current_period_end)
      values (u_sub, null, lg_mem, array['league'], 'active', 'sub_T118sub', 'cus_T118sub',
              now() + interval '20 days');
      -- both fans follow the home club of each league (a borrowed fan's own prefs are set aside)
      insert into fan_prefs (user_id, fav_team_ids, fav_game_ids, fav_player_ids,
                             want_results, want_players, want_fixtures)
      values (u_sub, array[t_mh, t_oh], '{}', '{}', true, true, true),
             (u_out, array[t_mh, t_oh], '{}', '{}', true, true, true)
      on conflict (user_id) do update
        set fav_team_ids = excluded.fav_team_ids, fav_game_ids = '{}', fav_player_ids = '{}',
            want_results = true, want_players = true, want_fixtures = true;
    end if;

    /* every game's status and row count in each per-row table, with this
       file's rights: what each visitor SHOULD get back is this, cut down to the
       games can_read_game_detail allows them. Taken again after the visitors
       have read (below), because on the live push a game can be scored while
       this runs and each statement reads a fresh snapshot. */
    select coalesce(array_agg(g.id), '{}'::uuid[]),
           coalesce(jsonb_object_agg(g.id, g.status), '{}'::jsonb)
      into all_ids, status_before
      from public.games g;
    foreach tbl in array tables loop
      execute format('select coalesce(jsonb_object_agg(x.game_id, x.n), ''{}''::jsonb) '
                     'from (select game_id, count(*) as n from public.%I group by game_id) x', tbl)
        into seen;
      counts := counts || jsonb_build_object(tbl, seen);
    end loop;

    -- ============================================ what each visitor can read
    -- (sw: memberships switched on for this visitor; switched off, anon and
    -- the stranger must read everything a member reads)
    for r in
      select * from (values
        ('anon',                   null::uuid, 'anon',          false, false, false, true),
        ('stranger',               u_out,      'authenticated', false, false, false, true),
        ('subscriber',             u_sub,      'authenticated', true,  true,  true,  true),
        ('admin',                  u_admin,    'authenticated', true,  true,  true,  true),
        ('manager',                u_mgr,      'authenticated', false, true,  true,  true),
        ('anon, memberships off',  null::uuid, 'anon',          true,  true,  false, false),
        ('stranger, memberships off', u_out,   'authenticated', true,  true,  false, false))
        as v(label, uid, rl, sees, sees_cup, needs_account, sw)
    loop
      continue when r.needs_account and not have_users;

      update platform_settings set value = to_jsonb(r.sw) where key = 'memberships_enabled';
      if r.uid is null then
        perform set_config('request.jwt.claims', '', true);
      else
        perform set_config('request.jwt.claims', json_build_object(
          'sub', r.uid, 'role', 'authenticated')::text, true);
      end if;
      execute format('set local role %I', r.rl);

      -- row by row: what every per-row read policy returns this caller, and
      -- which games can_read_game_detail allows them (compared after the loop)
      vis := array(select x from unnest(all_ids) x where public.can_read_game_detail(x));
      j := jsonb_build_object('vis', to_jsonb(vis));
      foreach tbl in array tables loop
        execute format('select coalesce(jsonb_object_agg(x.game_id, x.n), ''{}''::jsonb) '
                       'from (select game_id, count(*) as n from public.%I group by game_id) x', tbl)
          into seen;
        j := j || jsonb_build_object(tbl, seen);
      end loop;
      per_visitor := per_visitor || jsonb_build_object(r.label, j);

      j := jsonb_build_object(
        'm_final_game',   (select count(*) from games where id = g_mem_final),
        'm_sched_game',   (select count(*) from games where id = g_mem_sched),
        'm_events',       (select count(*) from game_events where game_id = g_mem_final),
        'm_state',        (select count(*) from game_state where game_id = g_mem_final),
        'm_pgs',          (select count(*) from player_game_stats where game_id = g_mem_final),
        'm_tgs',          (select count(*) from team_game_stats where game_id = g_mem_final),
        'm_ls',           (select count(*) from lineup_stints where game_id = g_mem_final),
        'm_standings',    (select count(*) from standings where competition_id = cp_mem),
        'm_news',         (select count(*) from news_articles where league_id = lg_mem),
        'm_news_rpc',     (select count(*) from public.news_public(lg_mem, 20, 0)),
        'm_article_rpc',  (select count(*) from (select public.news_article(lg_mem, 'zz-t118-news') as a) x
                            where x.a is not null),
        'm_pss',          (select count(*) from player_season_stats where competition_id = cp_mem),
        'm_tss',          (select count(*) from team_season_stats where competition_id = cp_mem),
        'm_ban',          (select count(*) from public.player_ban(pl_mem)),
        'm_detail_fn',    public.can_read_game_detail(g_mem_final)::int,
        'm_sched_fn',     public.can_read_game(g_mem_sched)::int,
        'm_visible',      (public.league_visible(lg_mem) and public.competition_visible(cp_mem)
                           and public.game_visible(g_mem_final))::int,
        'c_game',         (select count(*) from games where id = g_mem_cup),
        'c_detail_fn',    public.can_read_game_detail(g_mem_cup)::int,
        'c_visible',      public.game_visible(g_mem_cup)::int,
        'o_final_game',   (select count(*) from games where id = g_open_final),
        'o_sched_game',   (select count(*) from games where id = g_open_sched),
        'o_events',       (select count(*) from game_events where game_id = g_open_final),
        'o_state',        (select count(*) from game_state where game_id = g_open_final),
        'o_pgs',          (select count(*) from player_game_stats where game_id = g_open_final),
        'o_tgs',          (select count(*) from team_game_stats where game_id = g_open_final),
        'o_ls',           (select count(*) from lineup_stints where game_id = g_open_final),
        'o_standings',    (select count(*) from standings where competition_id = cp_open),
        'o_news',         (select count(*) from news_articles where league_id = lg_open),
        'o_news_rpc',     (select count(*) from public.news_public(lg_open, 20, 0)),
        'o_pss',          (select count(*) from player_season_stats where competition_id = cp_open),
        'o_tss',          (select count(*) from team_season_stats where competition_id = cp_open),
        'o_ban',          (select count(*) from public.player_ban(pl_open)),
        'o_visible',      (public.league_visible(lg_open) and public.competition_visible(cp_open)
                           and public.game_visible(g_open_final))::int);

      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      s := case when r.sees then 1 else 0 end;
      cup := case when r.sees_cup then 1 else 0 end;
      expected := jsonb_build_object(
        'm_final_game', s, 'm_sched_game', 1, 'm_events', 2 * s, 'm_state', s,
        'm_pgs', s, 'm_tgs', s, 'm_ls', s, 'm_standings', s, 'm_news', s, 'm_news_rpc', s,
        'm_article_rpc', s, 'm_pss', s, 'm_tss', s, 'm_ban', s, 'm_detail_fn', s, 'm_sched_fn', 1,
        'm_visible', s,
        'c_game', cup, 'c_detail_fn', cup, 'c_visible', cup,
        'o_final_game', 1, 'o_sched_game', 1, 'o_events', 2, 'o_state', 1,
        'o_pgs', 1, 'o_tgs', 1, 'o_ls', 1, 'o_standings', 1, 'o_news', 1, 'o_news_rpc', 1,
        'o_pss', 1, 'o_tss', 1, 'o_ban', 1, 'o_visible', 1);

      if j <> expected then
        raise exception '0118: as the %, read % — expected %', r.label, j, expected;
      end if;
    end loop;
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';

    /* EVERY PER-ROW READ POLICY RETURNS EXACTLY WHAT can_read_game_detail
       ALLOWS, for every visitor, over every real game in the database plus the
       seeded ones. Only games nobody touched while the visitors read are
       compared — same status and same row counts before and after — so a game
       being scored during the push is left out rather than failing it. The
       seeded games are invisible to every other session, so they always count. */
    select coalesce(jsonb_object_agg(g.id, g.status), '{}'::jsonb) into status_after from public.games g;
    foreach tbl in array tables loop
      execute format('select coalesce(jsonb_object_agg(x.game_id, x.n), ''{}''::jsonb) '
                     'from (select game_id, count(*) as n from public.%I group by game_id) x', tbl)
        into seen;
      counts_after := counts_after || jsonb_build_object(tbl, seen);
    end loop;
    select coalesce(array_agg(x.id), '{}'::uuid[]) into stable
      from unnest(all_ids) as x(id)
     where (status_before->>x.id::text) is not distinct from (status_after->>x.id::text)
       and not exists (select 1 from unnest(tables) as t(name)
                        where (counts->t.name->x.id::text) is distinct from (counts_after->t.name->x.id::text));
    moved := cardinality(all_ids) - cardinality(stable);
    if not (array[g_mem_final, g_open_final, g_mem_sched, g_open_sched, g_mem_cup] <@ stable) then
      raise exception '0118: a seeded game changed while the visitors read it, which nothing else can do';
    end if;

    for label in select jsonb_object_keys(per_visitor) loop
      foreach tbl in array tables loop
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into seen
          from jsonb_each(per_visitor->label->tbl) e
         where e.key::uuid = any (stable);
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into allowed
          from jsonb_each(counts->tbl) e
         where e.key::uuid = any (stable)
           and (per_visitor->label->'vis') ? e.key;
        if seen <> allowed then
          select string_agg(format('game %s: returned %s rows, allowed %s', d.k,
                                   coalesce(seen->>d.k, '0'), coalesce(allowed->>d.k, '0')), '; ')
            into diff
            from (select u.k from (select jsonb_object_keys(seen) as k
                                   union select jsonb_object_keys(allowed)) u
                   where (seen->u.k) is distinct from (allowed->u.k)
                   limit 10) d;
          raise exception '0118: as the %, the % read policy disagrees with can_read_game_detail — %',
            label, tbl, diff;
        end if;
      end loop;
    end loop;

    -- ============================================ asking for a highlight reel
    -- a stranger: refused by the policy, before the account's foreign key is looked at
    perform set_config('request.jwt.claims', json_build_object(
      'sub', u_out, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into highlight_jobs (game_id, requested_by, clips) values (g_mem_final, u_out, clip);
      raise exception '0118: A STRANGER QUEUED A HIGHLIGHT REEL OF A MEMBERS-ONLY GAME';
    exception when insufficient_privilege then null;
    end;
    if out_real then
      insert into highlight_jobs (game_id, requested_by, clips) values (g_open_final, u_out, clip);
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0118: a signed-in fan could not ask for a reel of an open league''s game';
      end if;
      -- memberships switched off: the members-only game is anybody's to ask for
      execute format('set local role %I', orig);
      update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
      set local role authenticated;
      insert into highlight_jobs (game_id, requested_by, clips) values (g_mem_final, u_out, clip);
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception '0118: with memberships switched off, a signed-in fan could not ask for a reel of a members-only league''s game';
      end if;
      execute format('set local role %I', orig);
      update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
      set local role authenticated;
    end if;
    execute format('set local role %I', orig);

    if have_users then
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_sub, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into highlight_jobs (game_id, requested_by, clips) values (g_mem_final, u_sub, clip);
      execute format('set local role %I', orig);

      -- the visiting club's manager: their own cup tie, yes; the league's other games, no
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_mgr, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into highlight_jobs (game_id, requested_by, clips) values (g_mem_cup, u_mgr, clip);
      begin
        insert into highlight_jobs (game_id, requested_by, clips) values (g_mem_final, u_mgr, clip);
        raise exception '0118: a club manager queued a reel of a members-only game their club did not play';
      exception when insufficient_privilege then null;
      end;
      execute format('set local role %I', orig);
    end if;
    perform set_config('request.jwt.claims', '', true);

    -- ================================== the league makes its fixtures private
    if have_users then
      perform set_config('request.jwt.claims', json_build_object(
        'sub', u_admin, 'role', 'authenticated')::text, true);
      set local role authenticated;
      j := public.set_league_access(lg_mem, 'members', false);
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
      if (j->>'fixtures_public')::boolean then
        raise exception '0118: set_league_access did not make the fixtures private: %', j;
      end if;
    else
      perform set_config('epinoia.access_rpc', 'on', true);
      update leagues set access_fixtures_public = false where id = lg_mem;
      perform set_config('epinoia.access_rpc', 'off', true);
    end if;

    for r in
      select * from (values
        ('anon',                  null::uuid, 'anon',          false, false, true),
        ('stranger',              u_out,      'authenticated', false, false, true),
        ('subscriber',            u_sub,      'authenticated', true,  true,  true),
        ('anon, memberships off', null::uuid, 'anon',          true,  false, false))
        as v(label, uid, rl, sees, needs_account, sw)
    loop
      continue when r.needs_account and not have_users;
      update platform_settings set value = to_jsonb(r.sw) where key = 'memberships_enabled';
      if r.uid is null then
        perform set_config('request.jwt.claims', '', true);
      else
        perform set_config('request.jwt.claims', json_build_object(
          'sub', r.uid, 'role', 'authenticated')::text, true);
      end if;
      execute format('set local role %I', r.rl);
      j := jsonb_build_object(
        'm_sched_game', (select count(*) from games where id = g_mem_sched),
        'm_sched_fn',   public.can_read_game(g_mem_sched)::int,
        'o_sched_game', (select count(*) from games where id = g_open_sched));
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      s := case when r.sees then 1 else 0 end;
      expected := jsonb_build_object('m_sched_game', s, 'm_sched_fn', s, 'o_sched_game', 1);
      if j <> expected then
        raise exception '0118: with fixtures private, as the %, read % — expected %', r.label, j, expected;
      end if;
    end loop;
    update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';

    -- ============================================================ the fan-outs
    if have_users and out_real then
      perform public.notify_game_final(g_mem_final);
      perform public.notify_game_final(g_open_final);
      perform public.notify_fixtures();

      select count(*) into n from notifications
       where user_id = u_sub and kind = 'result' and game_id = g_mem_final;
      if n <> 1 then
        raise exception '0118: the subscriber was not sent their own league''s result (% rows)', n;
      end if;
      select count(*) into n from notifications
       where user_id = u_out and kind = 'result' and game_id = g_mem_final;
      if n <> 0 then
        raise exception '0118: A STRANGER WAS SENT A MEMBERS-ONLY LEAGUE''S SCORE';
      end if;
      select count(*) into n from notifications
       where user_id = u_out and kind = 'result' and game_id = g_open_final;
      if n <> 1 then
        raise exception '0118: a follower of an open league''s club was not sent its result (% rows)', n;
      end if;

      select count(*) into n from notifications
       where user_id = u_sub and kind = 'fixture' and game_id = g_mem_sched;
      if n <> 1 then
        raise exception '0118: the subscriber was not sent their league''s private fixture (% rows)', n;
      end if;
      select count(*) into n from notifications
       where user_id = u_out and kind = 'fixture' and game_id = g_mem_sched;
      if n <> 0 then
        raise exception '0118: a stranger was sent a fixture the league keeps private';
      end if;
      select count(*) into n from notifications
       where user_id = u_out and kind = 'fixture' and game_id = g_open_sched;
      if n <> 1 then
        raise exception '0118: a follower of an open league''s club was not sent its fixture (% rows)', n;
      end if;

      -- memberships switched off: the same follower, holding nothing, is told both
      update platform_settings set value = 'false'::jsonb where key = 'memberships_enabled';
      perform public.notify_game_final(g_mem_final);
      perform public.notify_fixtures();
      select count(*) into n from notifications
       where user_id = u_out and kind = 'result' and game_id = g_mem_final;
      if n <> 1 then
        raise exception '0118: with memberships switched off, a follower was not sent a members-only league''s result (% rows)', n;
      end if;
      select count(*) into n from notifications
       where user_id = u_out and kind = 'fixture' and game_id = g_mem_sched;
      if n <> 1 then
        raise exception '0118: with memberships switched off, a follower was not sent a fixture the league keeps private (% rows)', n;
      end if;
      update platform_settings set value = 'true'::jsonb where key = 'memberships_enabled';
    end if;

    raise exception using errcode = 'P0118', message = '0118 passed; rolling its test rows back';
  exception
    when sqlstate 'P0118' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug like 'zz-t118-%')
     or exists (select 1 from teams where slug like 'zz-t118-%')
     or exists (select 1 from players where slug like 'zz-t118-%') then
    raise exception '0118: the test rows outlived their rollback';
  end if;
  if public.memberships_enabled()
     or (select s.value from platform_settings s where s.key = 'memberships_enabled') is distinct from 'false'::jsonb then
    raise exception '0118: the self-test left memberships switched on (%) — they ship off',
      (select s.value from platform_settings s where s.key = 'memberships_enabled');
  end if;

  raise notice '0118 ok (2/2): a members-only league''s games, events, box scores, stints, standings, news, '
               'suspensions and season views are refused to anon and strangers and shown to members and staff; '
               'a visiting club''s manager sees their cup tie; every per-row read policy returns exactly what '
               'can_read_game_detail allows; a reel needs the game; its fixtures follow access_fixtures_public; '
               'open leagues are untouched; followers who cannot see a game are not told it; and with memberships '
               'switched off none of it is refused to anybody';
  raise notice '0118: anon and the signed-in stranger ran; the subscriber, admin, manager and fan-outs ran with %; '
               'the row-by-row check covered % games (% changed while it ran and were left out)',
               half, cardinality(stable), moved;
end $test$;
