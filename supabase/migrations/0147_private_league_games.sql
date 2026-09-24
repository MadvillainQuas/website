-- ============================================================================
-- 0147 — A PRIVATE LEAGUE'S GAMES ARE AS PRIVATE AS THE LEAGUE.
--
-- 0139 made a league private by teaching 0118's four gates (can_view_league,
-- league_visible, competition_visible, game_visible) about visibility, and said
-- of everything else: "What they DID in the private league is in the game
-- tables, which section 4 covers." It does not. The game tables were never
-- behind those four gates. They are behind three OLDER rules, and 0118 gave each
-- of them the same shortcut it gave the gates:
--
--     case when l.id is null or l.access_mode = 'open'
--               or not (select public.memberships_enabled()) then true
--          else public.can_view_league(l.id) end
--
-- A private league is access_mode = 'open' (0139 kept privacy in its own column
-- precisely so it could be), and memberships are switched off, so either half of
-- that shortcut answers "true" before can_view_league -- the only part of the
-- rule that knows about privacy -- is ever asked. Seen on a local copy with every
-- migration applied: signed out, for a FINAL game in a private league (open, or
-- members-only with the switch off), the leagues row is hidden and game_visible()
-- is false, as they should be -- and the games row, every game_events,
-- game_state, player_game_stats, team_game_stats and lineup_stints row, and both
-- season views come back anyway. 0139's self-test never looked at a game.
--
-- Nothing is exposed today: no private league has a game yet. The gap opens the
-- moment one does.
--
-- WHAT READS THROUGH WHICH RULE -- the surface this file closes:
--
--     can_read_game          games (games_read), game_officials (officials_read),
--                            game_videos (also behind game_visible since 0118),
--                            and the anon RPCs game_tip_wallclock and
--                            league_channel_for_game
--     can_read_game_detail   no policy has called it since 0136, but it is the
--                            reference rule the 0084/0118 tests compare against,
--                            so it moves with the others
--     can_read_game_rows     game_events, game_state, player_game_stats,
--                            team_game_stats, lineup_stints (0136)
--     the two season views   player_season_stats, team_season_stats: owner-rights
--                            views no table policy reaches; their `vis` CTE
--     the four fan-outs      notify_game_final, notify_halftime, notify_lineups,
--                            notify_fixture_windows: each decides once per game,
--                            on the same shortcut, whether a follower needs
--                            asking about at all
--
-- THE CHANGE IS ONE LINE, AND IT IS THE SAME LINE IN EVERY RULE:
--
--     and coalesce(l.visibility is distinct from 'private'
--                  or public.league_invited(l.id), false)
--
-- It is ADDED in front of the shortcut, never put in its place: privacy first,
-- then 0118 exactly as it was. The coalesce means it can only fail closed. A
-- NULL here would be read as "visible" by 0118's views, which count a league
-- with no `ok` as no league at all. So:
--   * a public league answers on its own row, as before -- `is distinct from` is
--     true and nothing is looked up. A game with no league at all is the same
--     (NULL is distinct from 'private'). Since the rest of every rule is copied
--     verbatim, every such game gets exactly the answer it got before;
--   * a private league answers no to anybody league_invited() does not know:
--     signed out, a signed-in stranger, a follower. The paywall is not consulted;
--   * whoever IS invited then meets the league the way the public meets a public
--     one: everything, in an open private league; in a members-only one, what 0118
--     gives -- the fixtures while the league keeps them public, the rest with the
--     `league` feature, all of it while memberships are switched off.
-- The staff branches (the two clubs' managers, the game's officials, the league's
-- admins) are untouched. So a visiting club's manager still sees their own cup
-- tie, as game_visible lets them.
--
-- THE FAN-OUTS get the same line in their own terms. A follower hears about a
-- private league's game only if league_invited_for(follower, league) -- the
-- service-side twin of league_invited (0139). A phone that follows through a
-- website's notification button (push_devices, 0127) has no account, so nobody
-- can say it was invited, and it is never told about a private league's games.
-- The rest of each fan-out, 0118's paywall gate included, is verbatim.
--
-- AND league_invited ANSWERS YES FOR THE PLATFORM'S OWN SERVER (section 1).
-- Without that, the line above would have broken private leagues from the
-- inside. finalise-game and the ingest worker rebuild a competition's awards as
-- the service role, through compute_season_awards. That reads
-- player_season_stats, and when the view comes back empty it DELETES the
-- competition's awards. The shortcut used to answer before league_invited was
-- asked; now it is asked, and it only knew about accounts, so every final
-- whistle would have emptied a private league's awards. The JSON API reads the
-- same view the same way. 0117 promised this for can_view_league ("the service
-- role still reads everything"), and 0139 had already broken that for a private
-- members-only league once memberships are on, by asking league_invited first.
-- One line in league_invited puts it back everywhere.
--
-- WHAT THIS DOES NOT DO. It leaves alone what 0139 decided to leave public
-- (players), what the database cannot reach (0118's list: storage buckets,
-- Realtime broadcast topics, public feeds at source), and the service-role Edge
-- Functions. Those bypass RLS and must ask about privacy themselves; the JSON
-- API, for one, checks access_mode only. See docs/private-leagues.md.
--
-- EVERY RE-STATED DEFINITION IS ITS PREDECESSOR PLUS LINES TAGGED `-- 0147`.
-- supabase/tests/privateleagues.test.mjs strips the tagged lines and compares
-- what is left with the previous definition, so a copying slip cannot hide in
-- here. It also checks that the LATEST definition of each of these, in whatever
-- migration comes after this one, still asks about privacy.
--
-- Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. league_invited (latest: 0139) KNOWS THE SERVICE ROLE. See the header for
-- why. auth.role() is the role in the verified JWT, and no browser can present
-- 'service_role'. Its other callers are the leagues_read and shop-window
-- policies, and the service role bypasses those anyway, so this one line moves
-- nothing else. It is on league_invited, not on the new lines, so that
-- can_view_league keeps 0117's promise for a private league as well.
--
-- COALESCED, BECAUSE auth.role() IS NULL WITHOUT A JWT. A bare
-- `or auth.role() = 'service_role'` makes league_invited answer NULL rather
-- than false for anybody signed out. 0139's league_open_to_me and
-- can_view_league both read that NULL as "yes": the first through its
-- coalesce(..., true), the second by falling through to the open-league
-- shortcut. So a private league's clubs, rosters and games would open to
-- everybody. This file's self-test caught it in its first draft. Every other
-- term of league_invited is an exists() or an IS NULL test, and none of them
-- can be NULL.
-- ----------------------------------------------------------------------------
create or replace function public.league_invited(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_league is null
      or public.is_platform_admin()
      or coalesce(auth.role(), '') = 'service_role'                     -- 0147
      or exists (select 1 from league_guests g
                  where g.league_id = p_league and g.user_id = auth.uid())
      or exists (select 1 from memberships m
                  where m.user_id = auth.uid() and m.scope_type = 'league' and m.scope_id = p_league)
      or exists (select 1 from teams t
                  join memberships m on m.scope_type = 'team' and m.scope_id = t.id
                 where t.league_id = p_league and m.user_id = auth.uid());
$$;

revoke all on function public.league_invited(uuid) from public;
grant execute on function public.league_invited(uuid) to anon, authenticated, service_role;
alter function public.league_invited(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 2. THE THREE GAME RULES. can_read_game and can_read_game_detail as 0118 left
-- them, can_read_game_rows as 0136 left it, each with the privacy line in front
-- of the shortcut and nothing else moved.
-- ----------------------------------------------------------------------------

-- the fixture row (latest: 0118)
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
              and coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)   -- 0147
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       when g.status = 'scheduled' and l.access_fixtures_public then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- the detail (latest: 0118)
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
              and coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)   -- 0147
              and case when l.id is null or l.access_mode = 'open' or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- the per-game rows, asked once per ROW by five policies (latest: 0136). For a
-- public league the new line is one comparison on a column already joined.
create or replace function public.can_read_game_rows(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.games g
    left join public.competitions c on c.id = g.competition_id
    left join public.seasons s      on s.id = c.season_id
    left join public.leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( ( ( g.status = 'final'
                or (g.status = 'live' and coalesce(l.public_live, false)) )
              and coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)   -- 0147
              and case when l.id is null or l.access_mode = 'open'
                            or not (select public.memberships_enabled()) then true
                       else public.can_view_league(l.id) end )
            -- ONLY WHEN THERE IS SOMEBODY TO BE: see the note at the top. Each of
            -- these is false for auth.uid() = null, so a signed-out read skips them.
            or ( (select auth.uid()) is not null
                 and ( public.is_team_manager(g.home_team_id)
                       or public.is_team_manager(g.away_team_id)
                       or exists (select 1 from public.game_officials go
                                  where go.game_id = g.id and go.user_id = (select auth.uid()))
                       or (s.league_id is not null and public.is_league_admin(s.league_id)) ) ) )
  );
$$;

comment on function public.can_read_game_rows(uuid) is
  'May the caller read the per-game rows (events, state, box score, stints) of this game? 0118''s predicate, with the who-am-I half skipped for a caller with no session at all (0136), and a private league answered for the invited only (0147).';

-- grants as they stood (0118, 0136); owners pinned so a definer keeps reading
-- what it read whichever role applies this file (0115)
grant execute on function public.can_read_game(uuid) to anon, authenticated, service_role;
grant execute on function public.can_read_game_detail(uuid) to anon, authenticated, service_role;
grant execute on function public.can_read_game_rows(uuid) to anon, authenticated;
alter function public.can_read_game(uuid) owner to postgres;
alter function public.can_read_game_detail(uuid) owner to postgres;
alter function public.can_read_game_rows(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- 3. THE SEASON VIEWS (latest: 0118). Owner-rights, so no table policy reaches
-- them and the condition goes in their own query: into `vis`, which is
-- MATERIALIZED, so it is asked once per league per query, not once per box-score
-- line, and league_invited is only reached for a private league. The output
-- columns are unchanged, so CREATE OR REPLACE keeps the grants.
-- ----------------------------------------------------------------------------
create or replace view public.player_season_stats as
with vis as materialized (
  select l.id, (l.access_mode = 'open' or not (select public.memberships_enabled())
                or public.can_view_league(l.id))
               and coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)   -- 0147
               as ok
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
                or public.can_view_league(l.id))
               and coalesce(l.visibility is distinct from 'private' or public.league_invited(l.id), false)   -- 0147
               as ok
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
-- 4. THE FAN-OUTS. Each works out once per game whether the league is private
-- (v_private, or private_league on the fixtures loop's row) and puts one gate
-- beside 0118's paywall gate on every audience it writes to.
-- ----------------------------------------------------------------------------

-- the result, and each followed player's line (latest: 0138)
create or replace function public.notify_game_final(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  h              record;
  w              record;
  lg             uuid;
  n              int := 0;
  c              int;
  comp           text;
  v_members_only boolean;
  v_private      boolean;                                  -- 0147
  v_score        text;
  v_link         text;
  v_data         jsonb;
  v_expires      timestamptz := now() + interval '24 hours';
  v_home_top     text;
  v_away_top     text;
  v_body         text;
begin
  select * into g from games where id = p_game;
  if not found or g.status not in ('final', 'finalising') then return 0; end if;
  select * into h from teams where id = g.home_team_id;
  select * into w from teams where id = g.away_team_id;
  lg := game_league(p_game);
  select l.access_mode = 'members' into v_members_only from leagues l where l.id = lg;
  v_members_only := coalesce(v_members_only, false) and public.memberships_enabled();
  v_private := coalesce((select l.visibility = 'private' from leagues l where l.id = lg), false);   -- 0147
  select name into comp from competitions where id = g.competition_id;
  v_score := coalesce(h.name, 'Home') || ' ' || coalesce(g.home_score, 0) || '–' || coalesce(g.away_score, 0)
             || ' ' || coalesce(w.name, 'Away');
  v_link  := 'game/?g=' || g.id || '&mode=supabase';
  v_data  := jsonb_build_object(
               'game', g.id,
               'home', jsonb_build_object('id', g.home_team_id, 'name', h.name),
               'away', jsonb_build_object('id', g.away_team_id, 'name', w.name),
               'tipoff', g.tipoff_at,
               'score', jsonb_build_array(coalesce(g.home_score, 0), coalesce(g.away_score, 0)));

  v_home_top := public.notif_top_scorers(p_game, 0, 3);
  v_away_top := public.notif_top_scorers(p_game, 1, 3);
  v_body := concat_ws(' · ', comp,
              case when v_home_top is not null then coalesce(h.short_name, h.name) || ': ' || v_home_top end,
              case when v_away_top is not null then coalesce(w.short_name, w.name) || ': ' || v_away_top end);

  -- the club, league and game followers (notify_audience: fan_prefs expanded by fav_league_ids,
  -- unioned with push_devices) -- restored from notify_audience back to plain fan_prefs by 0137
  insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, p.device_id, 'result', 'FT · ' || v_score, coalesce(nullif(v_body, ''), 'Final score'), v_link, lg, g.id, g.id::text,
         v_data, 'high', v_expires
    from notify_audience p
   where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
          or g.id = any (p.fav_game_ids))
     and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, lg)))          -- 0147
     and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, lg)))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- fans of a player who played, wherever they follow him from
  insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
  select p.user_id, p.device_id, 'player',
         btrim(pl.first_name || ' ' || pl.last_name) || ': ' || public.notif_statline(s.stats),
         v_score || ' · FT' || coalesce(' · ' || nullif(public.notif_statline_more(s.stats), ''), ''),
         v_link || '&vp=' || pl.id, lg, g.id, g.id::text || ':' || pl.id,
         v_data || jsonb_build_object(
           'players', jsonb_build_array(jsonb_build_object('id', pl.id, 'name', btrim(pl.first_name || ' ' || pl.last_name))),
           'statline', jsonb_build_object(
             'pts', public.notif_num(s.stats, 'pts'),
             'reb', public.notif_num(s.stats, 'or') + public.notif_num(s.stats, 'dr'),
             'ast', public.notif_num(s.stats, 'ast'),
             'stl', public.notif_num(s.stats, 'stl'),
             'blk', public.notif_num(s.stats, 'blk'),
             'fgm', public.notif_num(s.stats, 'p2m') + public.notif_num(s.stats, 'p3m'),
             'fga', public.notif_num(s.stats, 'p2a') + public.notif_num(s.stats, 'p3a'),
             'min', round(public.notif_num(s.stats, 'min') / 60000))),
         'high', v_expires
    from notify_audience p
    join players pl on pl.id = any (p.fav_player_ids)
                   and not public.player_withheld(pl.is_minor, pl.public_consent)
    join player_game_stats s on s.game_id = g.id and s.player_id = pl.id::text
   where p.want_players
     and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, lg)))          -- 0147
     and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, lg)))   -- 0118
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- the half-time score (latest: 0127)
create or replace function public.notify_halftime(p_game uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  n              int := 0;
  c              int;
  v_n            int;
  v_memberships  boolean := public.memberships_enabled();
  v_members_only boolean;
  v_private      boolean;                                  -- 0147
  v_score        text;
  v_link         text;
  v_ref          text;
  v_expires      timestamptz := now() + interval '20 minutes';
  v_lines        jsonb;
  v_leaders      jsonb;
  v_top          text;
  v_data         jsonb;
begin
  for g in
    select gm.id, gm.home_team_id, gm.away_team_id, gm.tipoff_at,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           coalesce(gs.score_home, 0) as score_home,
           coalesce(gs.score_away, 0) as score_away,
           nullif(btrim(cp.name), '') as comp,
           s.league_id,
           l.access_mode
      from games gm
      join game_state gs   on gs.game_id = gm.id
      join teams h         on h.id = gm.home_team_id
      join teams a         on a.id = gm.away_team_id
      join competitions cp on cp.id = gm.competition_id
      join seasons s       on s.id = cp.season_id
      join leagues l       on l.id = s.league_id
     where (p_game is null or gm.id = p_game)
       and gm.status = 'live'
       and coalesce(l.public_live, false)
       and not gs.running
       and gs.updated_at >= now() - interval '30 minutes'
       and ((gs.period = 2 and (gs.clock_ms <= 0 or gs.clock_ms >= 600000))
            or (gs.period = 3 and gs.clock_ms >= 600000))
       -- the second quarter was played, the third was not
       and exists (select 1 from game_events e
                    where e.game_id = gm.id and e.period = 2 and e.clock < 600000 and e.t <> 'period_start')
       and not exists (select 1 from game_events e
                        where e.game_id = gm.id and e.period >= 3 and coalesce(e.clock, 600000) < 600000
                          and e.t <> 'period_start')
       -- quiet for a minute: free throws at the buzzer are in
       and not exists (select 1 from game_events e
                        where e.game_id = gm.id
                          and e.t in ('ft_made', 'ft_miss', 'p2_made', 'p2_miss', 'p3_made', 'p3_miss',
                                      'reb', 'ast', 'stl', 'blk', 'to', 'foul', 'sub')
                          and e.created_at > now() - interval '1 minute')
     order by gm.tipoff_at, gm.id
  loop
    begin
      v_members_only := coalesce(g.access_mode = 'members', false) and v_memberships;   -- 0118
      v_private := coalesce((select l.visibility = 'private' from leagues l where l.id = g.league_id), false);   -- 0147
      v_score := g.home_name || ' ' || g.score_home || '–' || g.score_away || ' ' || g.away_name;
      v_link  := 'game/?g=' || g.id || '&mode=supabase';
      v_ref   := g.id::text || ':ht';

      -- every named player who has played, most points first
      select coalesce(jsonb_agg(jsonb_build_object(
                        'id', x.id, 'name', x.name, 'surname', x.surname, 'side', x.side, 'stats', x.stats)
                      order by public.notif_num(x.stats, 'pts') desc, x.name, x.id), '[]'::jsonb)
        into v_lines
        from (select pl.id, fh.team_idx as side, fh.stats,
                     btrim(pl.first_name || ' ' || pl.last_name) as name,
                     coalesce(nullif(btrim(pl.last_name), ''), nullif(btrim(pl.first_name), ''),
                              btrim(pl.first_name || ' ' || pl.last_name)) as surname
                from public.notif_first_half(g.id) fh
                join players pl
                  on pl.id = case when fh.player_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                  then fh.player_id::uuid end
               where fh.played
                 and not coalesce(public.player_withheld(pl.is_minor, pl.public_consent), false)
                 and nullif(btrim(pl.first_name || ' ' || pl.last_name), '') is not null) x;

      -- each side's top scorer, home first
      select coalesce(jsonb_agg(jsonb_build_object(
                        'id', t.v -> 'id', 'name', t.v -> 'name', 'side', t.side,
                        'pts', public.notif_num(t.v -> 'stats', 'pts')) order by t.side), '[]'::jsonb),
             case count(*)
               when 0 then null
               when 1 then 'Top scorer: '
               else 'Top scorers: ' end
             || string_agg((t.v ->> 'surname') || ' ' || round(public.notif_num(t.v -> 'stats', 'pts'))::int, ', ' order by t.side)
        into v_leaders, v_top
        from (select distinct on ((l.v ->> 'side')::int) (l.v ->> 'side')::int as side, l.v
                from jsonb_array_elements(v_lines) with ordinality l(v, ord)
               where l.v ->> 'side' in ('0', '1')
                 and public.notif_num(l.v -> 'stats', 'pts') > 0
               order by (l.v ->> 'side')::int, l.ord) t;

      v_data := jsonb_build_object(
                  'game', g.id,
                  'home', jsonb_build_object('id', g.home_team_id, 'name', g.home_name),
                  'away', jsonb_build_object('id', g.away_team_id, 'name', g.away_name),
                  'tipoff', g.tipoff_at,
                  'period', 2,
                  'score', jsonb_build_array(g.score_home, g.score_away),
                  'leaders', v_leaders);
      v_n := 0;

      -- the club and game followers: the score, their players' lines, the top scorers
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, p.device_id, 'halftime', 'HT · ' || v_score,
             coalesce(nullif(concat_ws(chr(10), mine.lines, v_top), ''), g.comp, 'Half-time'),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('audience', 'club', 'players', coalesce(mine.players, '[]'::jsonb)),
             'high', v_expires
        from notify_audience p
        cross join lateral (
          select string_agg((l.v ->> 'name') || ': ' || public.notif_statline(l.v -> 'stats'), chr(10) order by l.ord) as lines,
                 jsonb_agg(jsonb_build_object('id', l.v -> 'id', 'name', l.v -> 'name',
                                              'statline', public.notif_statline_data(l.v -> 'stats')) order by l.ord) as players
            from jsonb_array_elements(v_lines) with ordinality l(v, ord)
           where p.want_players and (l.v ->> 'id')::uuid = any (p.fav_player_ids)) mine
       where ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
              or g.id = any (p.fav_game_ids))
         and p.want_halftime
         and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))          -- 0147
         and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      -- everyone else who follows a player who has played: that player's line first
      with fans as (
        select p.sub, p.user_id, p.device_id, l.v,
               row_number() over (partition by p.sub order by l.ord) as rn
          from notify_audience p
          join lateral jsonb_array_elements(v_lines) with ordinality l(v, ord)
            on (l.v ->> 'id')::uuid = any (p.fav_player_ids)
         where p.want_players and p.want_halftime
           and not ((p.want_results and (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)))
                    or g.id = any (p.fav_game_ids))
           and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))          -- 0147
           and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      )
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select f.user_id, f.device_id, 'halftime',
             (f.v ->> 'name') || ' at half-time: ' || public.notif_statline(f.v -> 'stats'),
             v_score || ' · HT' || coalesce(' · ' || nullif(public.notif_statline_more(f.v -> 'stats'), ''), '')
               || coalesce((select string_agg(chr(10) || (o.v ->> 'name') || ': ' || public.notif_statline(o.v -> 'stats'), '' order by o.rn)
                              from fans o
                             where o.sub = f.sub and o.rn > 1), ''),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('audience', 'player', 'players',
               (select jsonb_agg(jsonb_build_object('id', o.v -> 'id', 'name', o.v -> 'name',
                                                    'statline', public.notif_statline_data(o.v -> 'stats')) order by o.rn)
                  from fans o
                 where o.sub = f.sub)),
             'high', v_expires
        from fans f
       where f.rn = 1
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      n := n + v_n;
    exception when others then
      if p_game is not null then
        raise;
      end if;
      raise warning 'notify_halftime: game % skipped (%: %)', g.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- the starting fives (latest: 0145)
create or replace function public.notify_lineups(p_game uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  g              record;
  n              int := 0;
  c              int;
  v_n            int;
  v_memberships  boolean := public.memberships_enabled();
  v_members_only boolean;
  v_private      boolean;                                  -- 0147
  v_squad        jsonb;
  v_home_line    text;
  v_away_line    text;
  v_starters     jsonb;
  v_data         jsonb;
  v_link         text;
  v_ref          text;
  v_expires      timestamptz;
begin
  for g in
    select gm.id, gm.home_team_id, gm.away_team_id, gm.tipoff_at, gm.starters, gm.roster_snapshot,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           public.notif_team_label(h.name, h.short_name) as home_label,
           public.notif_team_label(a.name, a.short_name) as away_label,
           s.league_id,
           l.access_mode
      from games gm
      join teams h on h.id = gm.home_team_id
      join teams a on a.id = gm.away_team_id
      left join competitions cp on cp.id = gm.competition_id
      left join seasons s       on s.id = cp.season_id
      left join leagues l       on l.id = s.league_id
     where (p_game is null or gm.id = p_game)
       and gm.status in ('scheduled', 'live')
       and gm.tipoff_at >= now() - interval '30 minutes'
       and gm.tipoff_at <= now() + interval '6 hours'
       and public.notif_starters_complete(gm.starters)
     order by gm.tipoff_at, gm.id
  loop
    begin
      if exists (select 1
                   from (values (0), (1)) sd(side)
                   cross join lateral jsonb_array_elements(g.starters -> sd.side) e(v)
                  where jsonb_typeof(e.v) not in ('string', 'number')) then
        raise exception 'games.starters of game % is not two lists of player ids', g.id
          using errcode = '22023';
      end if;

      -- 0118, decided once for the game
      v_members_only := coalesce(g.access_mode = 'members', false) and v_memberships;
      v_private := coalesce((select l.visibility = 'private' from leagues l where l.id = g.league_id), false);   -- 0147
      v_link    := 'game/?g=' || g.id || '&mode=supabase&show=starters';
      v_ref     := g.id::text || ':lineups';
      v_expires := g.tipoff_at + interval '1 hour';

      with st as (
        select sd.side, e.ord::int as ord, lower(e.v #>> '{}') as pid
          from (values (0), (1)) sd(side)
          cross join lateral jsonb_array_elements(g.starters -> sd.side) with ordinality e(v, ord)
      ),
      snap as (
        select sd.side, lower(sp.v ->> 'id') as pid,
               nullif(btrim(sp.v ->> 'name'), '') as name,
               nullif(btrim(sp.v ->> 'num'), '') as num
          from (values (0), (1)) sd(side)
          cross join lateral jsonb_array_elements(
                 case when jsonb_typeof(g.roster_snapshot #> array['teams', sd.side::text, 'players']) = 'array'
                      then g.roster_snapshot #> array['teams', sd.side::text, 'players']
                      else '[]'::jsonb end) sp(v)
         where jsonb_typeof(sp.v) = 'object' and coalesce(sp.v ->> 'id', '') <> ''
      ),
      squad as (
        select st.side, st.ord, st.pid, 'starter'::text as role
          from st
        union all
        select sn.side, 1000, sn.pid, 'bench'
          from snap sn
         where not exists (select 1 from st where st.side = sn.side and st.pid = sn.pid)
        union all
        select distinct sd.side, 1000, re.player_id::text, 'bench'
          from (values (0), (1)) sd(side)
          join roster_entries re
            on re.active and re.team_id = case when sd.side = 0 then g.home_team_id else g.away_team_id end
         where not exists (select 1 from snap sn where sn.side = sd.side)
           and not exists (select 1 from st where st.side = sd.side and st.pid = re.player_id::text)
      ),
      lineup as (
        select q.side, q.ord, q.role, pl.id,
               coalesce(public.player_withheld(pl.is_minor, pl.public_consent), false) as withheld,
               coalesce(sn.num,
                        (select nullif(btrim(re.jersey), '')
                           from roster_entries re
                          where re.player_id = pl.id and re.active
                            and re.team_id = case when q.side = 0 then g.home_team_id else g.away_team_id end
                          order by re.created_at desc
                          limit 1)) as num,
               case when pl.id is not null then nullif(btrim(pl.first_name || ' ' || pl.last_name), '')
                    else initcap(sn.name) end as name,
               case when pl.id is not null then coalesce(nullif(btrim(pl.last_name), ''), nullif(btrim(pl.first_name), ''))
                    else initcap(reverse(split_part(reverse(sn.name), ' ', 1))) end as surname
          from squad q
          left join players pl
            on pl.id = case when q.pid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            then q.pid::uuid end
          left join lateral (select x.name, x.num from snap x
                              where x.side = q.side and x.pid = q.pid
                              limit 1) sn on true
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'side', lu.side, 'ord', lu.ord, 'role', lu.role, 'id', lu.id, 'withheld', lu.withheld,
               'num', lu.num, 'name', lu.name,
               'label', case when lu.withheld or lu.surname is null
                             then '#' || coalesce(lu.num, '?') else lu.surname end)
             order by lu.side, lu.ord, lu.name), '[]'::jsonb)
        into v_squad
        from lineup lu;

      select coalesce(string_agg(x ->> 'label', ', ' order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 0 and x ->> 'role' = 'starter'), ''),
             coalesce(string_agg(x ->> 'label', ', ' order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 1 and x ->> 'role' = 'starter'), ''),
             jsonb_build_array(
               coalesce(jsonb_agg(jsonb_build_object(
                          'id',   case when (x ->> 'withheld')::boolean then null else x -> 'id' end,
                          'name', case when (x ->> 'withheld')::boolean then null else x -> 'name' end,
                          'num',  x -> 'num') order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 0 and x ->> 'role' = 'starter'), '[]'::jsonb),
               coalesce(jsonb_agg(jsonb_build_object(
                          'id',   case when (x ->> 'withheld')::boolean then null else x -> 'id' end,
                          'name', case when (x ->> 'withheld')::boolean then null else x -> 'name' end,
                          'num',  x -> 'num') order by (x ->> 'ord')::int)
                        filter (where (x ->> 'side')::int = 1 and x ->> 'role' = 'starter'), '[]'::jsonb))
        into v_home_line, v_away_line, v_starters
        from jsonb_array_elements(v_squad) x;

      v_data := jsonb_build_object(
                  'game', g.id,
                  'home', jsonb_build_object('id', g.home_team_id, 'name', g.home_name),
                  'away', jsonb_build_object('id', g.away_team_id, 'name', g.away_name),
                  'tipoff', g.tipoff_at,
                  'starters', v_starters);
      v_n := 0;

      -- the club and game followers: both fives, by surname
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select p.user_id, p.device_id, 'lineups',
             'Lineups are in: ' || g.home_label || ' v ' || g.away_label,
             g.home_label || ': ' || v_home_line || chr(10) || g.away_label || ': ' || v_away_line,
             v_link, g.league_id, g.id, v_ref, v_data, 'high', v_expires
        from notify_audience p
       where (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)
              or g.id = any (p.fav_game_ids))
         and p.want_lineups
         and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))          -- 0147
         and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      -- the player-only followers: the first followed player (starters first)
      -- in the title, the others appended to the body
      with sq as (
        select (x ->> 'id')::uuid as player_id, x ->> 'name' as name, x ->> 'role' as role,
               (x ->> 'side')::int as side, (x ->> 'ord')::int as ord
          from jsonb_array_elements(v_squad) x
         where x ->> 'id' is not null and not (x ->> 'withheld')::boolean
      ),
      fans as (
        select p.sub, p.user_id, p.device_id, p.time_zone, sq.player_id, sq.name, sq.role, sq.side,
               row_number() over (partition by p.sub
                                  order by (sq.role = 'starter') desc, sq.side, sq.ord, sq.name) as rn
          from sq
          join notify_audience p on sq.player_id = any (p.fav_player_ids)
         where p.want_lineups and p.want_player_games
           and not (g.home_team_id = any (p.fav_team_ids) or g.away_team_id = any (p.fav_team_ids)
                    or g.id = any (p.fav_game_ids))
           and (not v_private or (p.user_id is not null and public.league_invited_for(p.user_id, g.league_id)))          -- 0147
           and (not v_members_only or (p.user_id is not null and public.can_view_league_for(p.user_id, g.league_id)))   -- 0118
      )
      insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
      select f.user_id, f.device_id, 'lineups',
             f.name || case when f.role = 'starter' then ' starts for ' else ' is on the bench for ' end
               || case when f.side = 0 then g.home_name else g.away_name end,
             g.home_name || ' v ' || g.away_name || ' · tip-off ' || to_char(g.tipoff_at at time zone f.time_zone, 'HH24:MI')
               || coalesce(' · ' || (select string_agg(o.name || case when o.role = 'starter' then ' starts'
                                                                      else ' on the bench' end,
                                                       ', ' order by o.rn)
                                       from fans o
                                      where o.sub = f.sub and o.rn > 1), ''),
             v_link, g.league_id, g.id, v_ref,
             v_data || jsonb_build_object('players',
               (select jsonb_agg(jsonb_build_object('id', o.player_id, 'name', o.name, 'role', o.role) order by o.rn)
                  from fans o
                 where o.sub = f.sub)),
             'high', v_expires
        from fans f
       where f.rn = 1
      on conflict do nothing;
      get diagnostics c = row_count; v_n := v_n + c;

      n := n + v_n;
    exception when others then
      if p_game is not null then
        raise;
      end if;
      raise warning 'notify_lineups: game % skipped (%: %)', g.id, sqlstate, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- the 2-day and 2-hour reminders (latest: 0145)
create or replace function public.notify_fixture_windows()
returns int language plpgsql security definer set search_path = public as $$
declare
  w             record;
  n             int := 0;
  c             int;
  v_memberships boolean := public.memberships_enabled();
  v_data        jsonb;
  v_ref         text;
  v_link        text;
  v_until       text;
  v_urgency     text;
  v_expires     timestamptz;
begin
  for w in
    select g.id, g.home_team_id, g.away_team_id, g.tipoff_at,
           nullif(btrim(g.venue), '') as venue,
           coalesce(nullif(btrim(h.name), ''), 'Home') as home_name,
           coalesce(nullif(btrim(a.name), ''), 'Away') as away_name,
           s.league_id,
           (l.id is null or l.access_mode = 'open' or l.access_fixtures_public   -- 0118
            or not v_memberships) as fixtures_public,
           coalesce(l.visibility = 'private', false) as private_league,                  -- 0147
           case when g.tipoff_at > now() + interval '44 hours' then '2d' else '2h' end as win
      from games g
      join teams h on h.id = g.home_team_id
      join teams a on a.id = g.away_team_id
      left join competitions cp on cp.id = g.competition_id
      left join seasons s       on s.id = cp.season_id
      left join leagues l       on l.id = s.league_id
     where g.status = 'scheduled'
       and (   (g.tipoff_at > now() + interval '44 hours' and g.tipoff_at <= now() + interval '48 hours')
            or (g.tipoff_at > now() and g.tipoff_at <= now() + interval '2 hours'))
     order by g.tipoff_at, g.id
  loop
    v_ref     := w.id::text || ':' || w.win;
    v_link    := 'game/?g=' || w.id || '&mode=supabase';
    v_until   := public.notif_until(w.tipoff_at);
    v_urgency := case when w.win = '2h' then 'high' else 'normal' end;
    v_expires := case when w.win = '2d' then w.tipoff_at - interval '24 hours' else w.tipoff_at end;
    v_data    := jsonb_build_object(
                   'game', w.id,
                   'home', jsonb_build_object('id', w.home_team_id, 'name', w.home_name),
                   'away', jsonb_build_object('id', w.away_team_id, 'name', w.away_name),
                   'tipoff', w.tipoff_at,
                   'window', w.win);

    -- the club and game followers
    insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
    select p.user_id, p.device_id, 'fixture',
           w.home_name || ' v ' || w.away_name,
           case when w.win = '2d' then 'In 2 days · ' || public.notif_when(w.tipoff_at, p.time_zone)
                else v_until || ' · tip-off ' || to_char(w.tipoff_at at time zone p.time_zone, 'HH24:MI') end
             || coalesce(' · ' || w.venue, ''),
           v_link, w.league_id, w.id, v_ref, v_data, v_urgency, v_expires
      from notify_audience p
     where ((p.want_fixtures and (w.home_team_id = any (p.fav_team_ids) or w.away_team_id = any (p.fav_team_ids)))
            or w.id = any (p.fav_game_ids))
       and case when w.win = '2d' then p.want_fixture_2d else p.want_fixture_2h end
       and (not w.private_league or (p.user_id is not null and public.league_invited_for(p.user_id, w.league_id)))   -- 0147
       and (w.fixtures_public or (p.user_id is not null and public.can_view_league_for(p.user_id, w.league_id)))
    on conflict do nothing;
    get diagnostics c = row_count; n := n + c;

    -- the player-only followers: neither club nor the game, grouped per subscriber
    with fans as (
      select p.sub, p.user_id, p.device_id, p.time_zone, pl.id as player_id,
             btrim(pl.first_name || ' ' || pl.last_name) as name,
             pl.last_name, pl.first_name
        from (select distinct re.player_id
                from roster_entries re
               where re.active and re.team_id in (w.home_team_id, w.away_team_id)) sq
        join players pl on pl.id = sq.player_id
                       and not public.player_withheld(pl.is_minor, pl.public_consent)
        join notify_audience p on pl.id = any (p.fav_player_ids)
       where p.want_fixtures and p.want_player_games
         and case when w.win = '2d' then p.want_fixture_2d else p.want_fixture_2h end
         and not (w.home_team_id = any (p.fav_team_ids) or w.away_team_id = any (p.fav_team_ids)
                  or w.id = any (p.fav_game_ids))
         and (not w.private_league or (p.user_id is not null and public.league_invited_for(p.user_id, w.league_id)))   -- 0147
         and (w.fixtures_public or (p.user_id is not null and public.can_view_league_for(p.user_id, w.league_id)))
    )
    insert into notifications (user_id, device_id, kind, title, body, link, league_id, game_id, ref, data, urgency, expires_at)
    select f.user_id, f.device_id, 'fixture',
           public.notif_names(array_agg(f.name order by f.last_name, f.first_name, f.player_id))
             || case when w.win = '2d'
                     then case when count(*) = 1 then ' has a game in 2 days' else ' have a game in 2 days' end
                     else case when count(*) = 1 then ' plays ' else ' play ' end
                          || lower(left(v_until, 1)) || substr(v_until, 2)
                end,
           w.home_name || ' v ' || w.away_name || ' · '
             || case when w.win = '2d' then public.notif_when(w.tipoff_at, f.time_zone)
                     else 'tip-off ' || to_char(w.tipoff_at at time zone f.time_zone, 'HH24:MI') end,
           v_link, w.league_id, w.id, v_ref,
           v_data || jsonb_build_object('players',
             jsonb_agg(jsonb_build_object('id', f.player_id, 'name', f.name)
                       order by f.last_name, f.first_name, f.player_id)),
           v_urgency, v_expires
      from fans f
     group by f.sub, f.user_id, f.device_id, f.time_zone
    on conflict do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- grants as they stood (0127): the tick and the Edge Functions call these as the
-- service role; no browser does
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;
revoke all on function public.notify_halftime(uuid) from public, anon, authenticated;
revoke all on function public.notify_lineups(uuid) from public, anon, authenticated;
revoke all on function public.notify_fixture_windows() from public, anon, authenticated;
grant execute on function public.notify_game_final(uuid) to service_role;
grant execute on function public.notify_halftime(uuid) to service_role;
grant execute on function public.notify_lineups(uuid) to service_role;
grant execute on function public.notify_fixture_windows() to service_role;
alter function public.notify_game_final(uuid) owner to postgres;
alter function public.notify_halftime(uuid) owner to postgres;
alter function public.notify_lineups(uuid) owner to postgres;
alter function public.notify_fixture_windows() owner to postgres;

-- ============================================================================
-- SELF-TEST. One block that always ends by raising a private code (P0147), which
-- only its own handler swallows. Every row, role switch, claim and setting it
-- makes is rolled back together, and any other error fails the migration. It
-- asserts only about rows it seeds itself, so it runs the same on a platform that
-- already has private leagues, members-only leagues, or the memberships switch
-- in either position. The switch is SET for each pass, never assumed, and is
-- checked afterwards to be back where it was. Roles switch back to the captured
-- one, never with RESET ROLE.
--
-- Seeded as the migration's own role: three leagues -- a PUBLIC open one (the
-- control), a PRIVATE open one, and a PRIVATE members-only one that keeps its
-- fixtures public. Each has a season, a competition, two clubs that play and a
-- third that plays nobody, a player, a FINAL game with a row in each of the five
-- per-game tables plus a named official, and a SCHEDULED fixture a day out.
-- Accounts: a signed-in stranger; a guest of each private league
-- (league_guests); an admin of each; the manager of each one's THIRD club, so
-- that nothing but being in the league lets them in (the manager of a club that
-- played would get through the staff branch whatever privacy said); the
-- platform admin; and the official.
--
-- PART 1, the page rules. Each visitor, signed out or impersonated (SET LOCAL
-- ROLE plus forged request.jwt.claims, the 0118 way), reads each league's final
-- game, its five tables, its official, both season views, the fixture, the
-- tip-off RPC and the three rules themselves. Once with memberships off (as
-- shipped), and again with them on. It also reads 0139's shop window (the
-- league, its clubs, competition and roster), because section 1 changes the
-- function that guards it. The service role reads everything, and rebuilding a
-- private league's awards as the service role still finds its games.
-- PART 2, the fan-outs. Strangers -- one following two clubs and a whole
-- league, one following only the three players, and two devices doing the same
-- -- plus the two guests, each of whom follows BOTH private leagues, are sent
-- every notice each league's games produce (result, player line, half-time,
-- lineups, the 2-hour reminder). Off, then on.
-- ============================================================================
do $test$
declare
  who       text  := current_user || ' (session ' || session_user || ')';
  orig      text  := current_user;
  sw_before jsonb := (select s.value from public.platform_settings s where s.key = 'memberships_enabled');
  k         text;
  ids       jsonb := '{}'::jsonb;    -- per league: its rows
  u         jsonb := '{}'::jsonb;    -- per person: their account
  dev       jsonb := '{}'::jsonb;    -- per device: its push_devices row
  x         record;
  r         record;
  v_lg      uuid;
  v_se      uuid;
  v_cp      uuid;
  v_th      uuid;
  v_ta      uuid;
  v_tx      uuid;
  v_pl      uuid;
  v_gf      uuid;
  v_gs      uuid;
  v_ght     uuid;
  v_gsoon   uuid;
  v_uid     uuid;
  v_games   uuid[] := '{}';
  lv        text;
  n_all     int;
  n_fix     int;
  passes    int := 0;
  seen      jsonb;
  expected  jsonb;
  diff      text;
  -- what a follower of each kind should be sent about one league's games
  c4        jsonb := '["fixture", "halftime", "lineups", "result"]'::jsonb;
  p4        jsonb := '["fixture", "halftime", "lineups", "player"]'::jsonb;
  nothing   jsonb := '[]'::jsonb;
  -- 0145's test keys: a well-formed subscription, never a real one
  k_p       text  := 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
  k_a       text  := 'tBHItJI5svbpez7KI4CCXg';
begin
  begin
    perform set_config('request.jwt.claims', '', true);
    execute format('set local role %I', orig);

    -- ============================================================ seeded as the owner
    foreach k in array array['pub', 'po', 'pm'] loop
      insert into public.leagues (slug, name, public_live, visibility, access_mode, access_fixtures_public)
      values ('zz-t147-' || k, 'T147 ' || k, true,
              case when k = 'pub' then 'public' else 'private' end,
              case when k = 'pm' then 'members' else 'open' end, true)
      returning id into v_lg;
      insert into public.seasons (league_id, name) values (v_lg, '0147') returning id into v_se;
      insert into public.competitions (season_id, name) values (v_se, 'T147 League') returning id into v_cp;
      insert into public.teams (league_id, slug, name) values (v_lg, 'zz-t147-' || k || '-hawks', 'T147 ' || k || ' Hawks')
        returning id into v_th;
      insert into public.teams (league_id, slug, name) values (v_lg, 'zz-t147-' || k || '-owls', 'T147 ' || k || ' Owls')
        returning id into v_ta;
      insert into public.teams (league_id, slug, name) values (v_lg, 'zz-t147-' || k || '-wrens', 'T147 ' || k || ' Wrens')
        returning id into v_tx;
      insert into public.players (slug, first_name, last_name) values ('zz-t147-' || k || '-guard', 'T147', k || ' Guard')
        returning id into v_pl;
      insert into public.roster_entries (team_id, player_id, season_id, jersey, active) values (v_th, v_pl, v_se, '7', true);

      -- the final game: created live so its events can be written, then finished
      -- (as this role, which 0116's games_write_guard does not judge)
      insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score)
      values (v_cp, v_th, v_ta, now() - interval '2 days', 'live', 61, 50) returning id into v_gf;
      insert into public.game_events (game_id, seq, t, team, pid, period, clock, created_at)
      values (v_gf, 1, 'period_start', null, null, 1, 600000, now() - interval '2 days'),
             (v_gf, 2, 'p2_made', 0, v_pl::text, 1, 500000, now() - interval '2 days'),
             (v_gf, 3, 'p3_made', 0, v_pl::text, 1, 400000, now() - interval '2 days');
      insert into public.game_state (game_id, score_home, score_away) values (v_gf, 61, 50);
      insert into public.player_game_stats (game_id, player_id, team_idx, stats)
      values (v_gf, v_pl::text, 0, '{"min":600000,"pts":5,"p2m":1,"p2a":2,"p3m":1,"p3a":1}'::jsonb);
      insert into public.team_game_stats (game_id, team_idx, stats) values (v_gf, 0, '{"pts":61}'::jsonb);
      insert into public.lineup_stints (game_id, team_idx, player_ids, stats)
      values (v_gf, 0, array[v_pl::text], '{"secs":600}'::jsonb);
      update public.games set status = 'final' where id = v_gf;

      -- a fixture a day out
      insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (v_cp, v_th, v_ta, now() + interval '1 day', 'scheduled') returning id into v_gs;

      -- part 2's two: half-time just called (0127's recipe), and a game an hour out
      -- with both fives named, which is inside the 2-hour reminder and the lineups window
      insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status, starters)
      values (v_cp, v_th, v_ta, now() - interval '1 hour', 'live',
              jsonb_build_array(jsonb_build_array(v_pl::text, gen_random_uuid()::text, gen_random_uuid()::text,
                                                  gen_random_uuid()::text, gen_random_uuid()::text),
                                jsonb_build_array(gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                                                  gen_random_uuid()::text, gen_random_uuid()::text)))
      returning id into v_ght;
      insert into public.game_events (game_id, seq, t, team, pid, period, clock, payload, created_at)
      values (v_ght, 1, 'p2_made', 0, v_pl::text, 1, 590000, '{}', now() - interval '5 minutes'),
             (v_ght, 2, 'p3_made', 1, gen_random_uuid()::text, 2, 300000, '{}', now() - interval '5 minutes');
      insert into public.game_state (game_id, period, clock_ms, running, score_home, score_away)
      values (v_ght, 2, 0, false, 2, 3);
      insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status, starters)
      values (v_cp, v_th, v_ta, now() + interval '1 hour', 'scheduled',
              jsonb_build_array(jsonb_build_array(v_pl::text, gen_random_uuid()::text, gen_random_uuid()::text,
                                                  gen_random_uuid()::text, gen_random_uuid()::text),
                                jsonb_build_array(gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                                                  gen_random_uuid()::text, gen_random_uuid()::text)))
      returning id into v_gsoon;

      ids := ids || jsonb_build_object(k, jsonb_build_object(
               'league', v_lg, 'comp', v_cp, 'home', v_th, 'third', v_tx, 'player', v_pl,
               'final', v_gf, 'fixture', v_gs, 'ht', v_ght, 'soon', v_gsoon));
      v_games := v_games || array[v_gf, v_gs, v_ght, v_gsoon];
    end loop;

    -- the people
    foreach k in array array['out', 'fan', 'guest_po', 'guest_pm', 'admin_po', 'admin_pm',
                             'mgr_po', 'mgr_pm', 'plat', 'ref'] loop
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              't147-' || replace(k, '_', '-') || '@example.invalid', '', now(), now(), now())
      returning id into v_uid;
      u := u || jsonb_build_object(k, v_uid);
    end loop;

    insert into public.league_guests (league_id, user_id)
    values ((ids->'po'->>'league')::uuid, (u->>'guest_po')::uuid),
           ((ids->'pm'->>'league')::uuid, (u->>'guest_pm')::uuid);
    insert into public.memberships (user_id, role, scope_type, scope_id)
    values ((u->>'admin_po')::uuid, 'league_admin',   'league',   (ids->'po'->>'league')::uuid),
           ((u->>'admin_pm')::uuid, 'league_admin',   'league',   (ids->'pm'->>'league')::uuid),
           ((u->>'mgr_po')::uuid,   'team_manager',   'team',     (ids->'po'->>'third')::uuid),
           ((u->>'mgr_pm')::uuid,   'team_manager',   'team',     (ids->'pm'->>'third')::uuid),
           ((u->>'plat')::uuid,     'platform_admin', 'platform', null);
    insert into public.game_officials (game_id, user_id)
    select (ids->lk->>'final')::uuid, (u->>'ref')::uuid
      from unnest(array['pub', 'po', 'pm']) as t(lk);

    -- ======================================================= PART 1: the page rules
    -- level per league: all = everything; fixture = the fixture row and nothing
    -- else; none = nothing at all, not even that the game exists
    for r in
      select v.label, (u->>v.acct)::uuid as uid, v.rl, v.pub, v.po, v.pm, v.sw
        from (values
          ('anon',                                                  null,       'anon',          'all', 'none', 'none',    false),
          ('signed-in stranger',                                    'out',      'authenticated', 'all', 'none', 'none',    false),
          ('guest of the private open league',                      'guest_po', 'authenticated', 'all', 'all',  'none',    false),
          ('guest of the private members league',                   'guest_pm', 'authenticated', 'all', 'none', 'all',     false),
          ('admin of the private open league',                      'admin_po', 'authenticated', 'all', 'all',  'none',    false),
          ('admin of the private members league',                   'admin_pm', 'authenticated', 'all', 'none', 'all',     false),
          ('manager of a club in the private open league',          'mgr_po',   'authenticated', 'all', 'all',  'none',    false),
          ('manager of a club in the private members league',       'mgr_pm',   'authenticated', 'all', 'none', 'all',     false),
          ('platform admin',                                        'plat',     'authenticated', 'all', 'all',  'all',     false),
          ('anon, memberships on',                                  null,       'anon',          'all', 'none', 'none',    true),
          ('signed-in stranger, memberships on',                    'out',      'authenticated', 'all', 'none', 'none',    true),
          ('guest of the private open league, memberships on',      'guest_po', 'authenticated', 'all', 'all',  'none',    true),
          ('guest of the private members league, memberships on',   'guest_pm', 'authenticated', 'all', 'none', 'fixture', true),
          ('admin of the private members league, memberships on',   'admin_pm', 'authenticated', 'all', 'none', 'all',     true),
          ('manager of a club in the private members league, memberships on',
                                                                    'mgr_pm',   'authenticated', 'all', 'none', 'all',     true),
          ('platform admin, memberships on',                        'plat',     'authenticated', 'all', 'all',  'all',     true),
          -- the platform's own server: finalise-game, the ingest worker, the JSON API
          ('service role',                                          null,       'service_role',  'all', 'all',  'all',     false),
          ('service role, memberships on',                          null,       'service_role',  'all', 'all',  'all',     true))
          as v(label, acct, rl, pub, po, pm, sw)
    loop
      update public.platform_settings set value = to_jsonb(r.sw) where key = 'memberships_enabled';
      if public.memberships_enabled() is distinct from r.sw then
        raise exception '0147: could not set the memberships switch to % for the %', r.sw, r.label;
      end if;
      perform set_config('request.jwt.claims',
        case when r.rl = 'service_role' then json_build_object('role', 'service_role')::text
             when r.uid is null then ''
             else json_build_object('sub', r.uid, 'role', 'authenticated')::text end, true);
      execute format('set local role %I', r.rl);

      seen := '{}'::jsonb;
      foreach k in array array['pub', 'po', 'pm'] loop
        v_lg := (ids->k->>'league')::uuid;
        v_th := (ids->k->>'home')::uuid;
        v_gf := (ids->k->>'final')::uuid;
        v_gs := (ids->k->>'fixture')::uuid;
        v_cp := (ids->k->>'comp')::uuid;
        seen := seen || jsonb_build_object(
          -- 0139's shop window, which answers to league_invited too (section 1)
          k || ': the league row',          (select count(*) from public.leagues where id = v_lg),
          k || ': its clubs',               (select count(*) from public.teams where league_id = v_lg),
          k || ': its competition',         (select count(*) from public.competitions where id = v_cp),
          k || ': its roster',              (select count(*) from public.roster_entries where team_id = v_th),
          k || ': the final game',          (select count(*) from public.games where id = v_gf),
          k || ': the fixture',             (select count(*) from public.games where id = v_gs),
          k || ': game_events',             (select count(*) from public.game_events where game_id = v_gf),
          k || ': game_state',              (select count(*) from public.game_state where game_id = v_gf),
          k || ': player_game_stats',       (select count(*) from public.player_game_stats where game_id = v_gf),
          k || ': team_game_stats',         (select count(*) from public.team_game_stats where game_id = v_gf),
          k || ': lineup_stints',           (select count(*) from public.lineup_stints where game_id = v_gf),
          k || ': game_officials',          (select count(*) from public.game_officials where game_id = v_gf),
          k || ': player_season_stats',     (select count(*) from public.player_season_stats where competition_id = v_cp),
          k || ': team_season_stats',       (select count(*) from public.team_season_stats where competition_id = v_cp),
          k || ': game_tip_wallclock',      (public.game_tip_wallclock(v_gf) is not null)::int,
          k || ': can_read_game',           public.can_read_game(v_gf)::int,
          k || ': can_read_game_detail',    public.can_read_game_detail(v_gf)::int,
          k || ': can_read_game_rows',      public.can_read_game_rows(v_gf)::int,
          k || ': can_read_game (fixture)', public.can_read_game(v_gs)::int);
      end loop;

      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      expected := '{}'::jsonb;
      foreach k in array array['pub', 'po', 'pm'] loop
        lv := case k when 'pub' then r.pub when 'po' then r.po else r.pm end;
        n_all := case when lv = 'all' then 1 else 0 end;
        n_fix := case when lv in ('all', 'fixture') then 1 else 0 end;
        expected := expected || jsonb_build_object(
          -- whoever may see the fixture was let into the league, so sees its shop window
          k || ': the league row',          n_fix,
          k || ': its clubs',               3 * n_fix,
          k || ': its competition',         n_fix,
          k || ': its roster',              n_fix,
          k || ': the final game',          n_all,
          k || ': the fixture',             n_fix,
          k || ': game_events',             3 * n_all,
          k || ': game_state',              n_all,
          k || ': player_game_stats',       n_all,
          k || ': team_game_stats',         n_all,
          k || ': lineup_stints',           n_all,
          k || ': game_officials',          n_all,
          k || ': player_season_stats',     n_all,
          k || ': team_season_stats',       n_all,
          k || ': game_tip_wallclock',      n_all,
          k || ': can_read_game',           n_all,
          k || ': can_read_game_detail',    n_all,
          k || ': can_read_game_rows',      n_all,
          k || ': can_read_game (fixture)', n_fix);
      end loop;

      if seen <> expected then
        select string_agg(format('%s read %s, expected %s', e.key, coalesce(seen->>e.key, '-'), e.value),
                          '; ' order by e.key)
          into diff
          from jsonb_each(expected) e
         where (seen->e.key) is distinct from e.value;
        raise exception '0147: as the %: %', r.label, diff;
      end if;
      passes := passes + 1;
    end loop;

    /* The awards a final whistle rebuilds, the way finalise-game and the ingest
       rebuild them: as the service role, through compute_season_awards, which
       DELETES a competition's awards whenever player_season_stats comes back
       empty for it. With memberships off and on. */
    for x in select * from (values (false), (true)) as s(sw) loop
      update public.platform_settings set value = to_jsonb(x.sw) where key = 'memberships_enabled';
      delete from public.season_awards
       where competition_id in ((ids->'po'->>'comp')::uuid, (ids->'pm'->>'comp')::uuid);
      perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
      set local role service_role;
      foreach k in array array['po', 'pm'] loop
        perform public.compute_season_awards((ids->k->>'comp')::uuid);
      end loop;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
      foreach k in array array['po', 'pm'] loop
        if not exists (select 1 from public.season_awards a
                        where a.competition_id = (ids->k->>'comp')::uuid
                          and a.player_id = (ids->k->>'player')::uuid) then
          raise exception '0147: compute_season_awards run as the service role with memberships % left the % league without awards (the season view hid its games from the platform)',
            case when x.sw then 'on' else 'off' end, k;
        end if;
      end loop;
    end loop;

    -- ========================================================= PART 2: the fan-outs
    insert into public.fan_prefs (user_id, fav_team_ids, fav_player_ids, fav_game_ids, fav_league_ids,
                                  want_results, want_players, want_fixtures, want_announcements,
                                  want_fixture_2d, want_fixture_2h, want_lineups, want_player_games,
                                  want_halftime, notify_inapp, notify_email, notify_push)
    values
      -- a stranger following the public league's club, the private open league's
      -- club, and the whole private members league (0133's league follow)
      ((u->>'out')::uuid,
       array[(ids->'pub'->>'home')::uuid, (ids->'po'->>'home')::uuid], '{}', '{}',
       array[(ids->'pm'->>'league')::uuid],
       true, true, true, true, true, true, true, true, true, true, false, false),
      -- a stranger following only the three players: the likeliest way in, since a
      -- player is never hidden (0139) and may be followed from a public league
      ((u->>'fan')::uuid,
       '{}', array[(ids->'pub'->>'player')::uuid, (ids->'po'->>'player')::uuid, (ids->'pm'->>'player')::uuid],
       '{}', '{}',
       true, true, true, true, true, true, true, true, true, true, false, false),
      -- each guest follows BOTH private leagues' clubs: only their own may reach them
      ((u->>'guest_po')::uuid,
       array[(ids->'po'->>'home')::uuid, (ids->'pm'->>'home')::uuid], '{}', '{}', '{}',
       true, true, true, true, true, true, true, true, true, true, false, false),
      ((u->>'guest_pm')::uuid,
       array[(ids->'po'->>'home')::uuid, (ids->'pm'->>'home')::uuid], '{}', '{}', '{}',
       true, true, true, true, true, true, true, true, true, true, false, false);

    -- two phones, pressed a league website's button: one follows the three clubs,
    -- one the three players. Written straight in, as notify_device_follow would.
    insert into public.push_devices (endpoint, p256dh, auth, origin, fav_team_ids, fav_player_ids,
                                     want_fixture_2d, want_fixture_2h, want_lineups, want_halftime,
                                     want_results, want_players, want_announcements)
    values ('https://fcm.googleapis.com/fcm/send/t147-clubs', k_p, k_a, 'https://prophesyscouting.co.uk',
            array[(ids->'pub'->>'home')::uuid, (ids->'po'->>'home')::uuid, (ids->'pm'->>'home')::uuid], '{}',
            true, true, true, true, true, true, true),
           ('https://fcm.googleapis.com/fcm/send/t147-players', k_p, k_a, 'https://prophesyscouting.co.uk',
            '{}', array[(ids->'pub'->>'player')::uuid, (ids->'po'->>'player')::uuid, (ids->'pm'->>'player')::uuid],
            true, true, true, true, true, true, true);
    select jsonb_object_agg(case when d.endpoint like '%t147-clubs' then 'clubs' else 'players' end, d.id)
      into dev
      from public.push_devices d
     where d.endpoint in ('https://fcm.googleapis.com/fcm/send/t147-clubs',
                          'https://fcm.googleapis.com/fcm/send/t147-players');

    for x in select * from (values (false), (true)) as s(sw) loop
      delete from public.notifications where game_id = any (v_games);
      update public.platform_settings set value = to_jsonb(x.sw) where key = 'memberships_enabled';
      if public.memberships_enabled() is distinct from x.sw then
        raise exception '0147: could not set the memberships switch to % for the fan-outs', x.sw;
      end if;

      foreach k in array array['pub', 'po', 'pm'] loop
        perform public.notify_game_final((ids->k->>'final')::uuid);
        perform public.notify_halftime((ids->k->>'ht')::uuid);
        perform public.notify_lineups((ids->k->>'soon')::uuid);
      end loop;
      perform public.notify_fixture_windows();

      -- what each follower was sent about each league's games, and what they should
      -- have been: the strangers and the phones everything about the public league
      -- and nothing about either private one; each guest everything about their own
      -- league and nothing about the other -- except that with memberships on, the
      -- members-only league's guest (no subscription) gets the fixture reminder, which
      -- the league keeps public to the invited, and nothing that is behind the paywall
      select coalesce(jsonb_object_agg(q.key, q.got), '{}'::jsonb),
             coalesce(jsonb_object_agg(q.key, q.want), '{}'::jsonb)
        into seen, expected
        from (select au.label || ' / ' || lg.lk as key,
                     coalesce((select jsonb_agg(distinct nt.kind order by nt.kind)
                                 from public.notifications nt
                                where nt.game_id in ((ids->lg.lk->>'final')::uuid, (ids->lg.lk->>'ht')::uuid,
                                                     (ids->lg.lk->>'soon')::uuid)
                                  and (nt.user_id = au.uid or nt.device_id = au.did)), '[]'::jsonb) as got,
                     case lg.lk when 'pub' then au.pub when 'po' then au.po
                                else case when x.sw then au.pm_on else au.pm end end as want
                from (values
                  ('stranger following two clubs and a league', (u->>'out')::uuid,      null::uuid,               c4,   nothing, nothing, nothing),
                  ('stranger following the players',            (u->>'fan')::uuid,      null::uuid,               p4,   nothing, nothing, nothing),
                  ('phone following the clubs',                 null::uuid,             (dev->>'clubs')::uuid,    c4,   nothing, nothing, nothing),
                  ('phone following the players',               null::uuid,             (dev->>'players')::uuid,  p4,   nothing, nothing, nothing),
                  ('guest of the private open league',          (u->>'guest_po')::uuid, null::uuid,               nothing, c4,   nothing, nothing),
                  ('guest of the private members league',       (u->>'guest_pm')::uuid, null::uuid,               nothing, nothing, c4,   '["fixture"]'::jsonb))
                  as au(label, uid, did, pub, po, pm, pm_on)
                cross join (values ('pub'), ('po'), ('pm')) as lg(lk)) q;

      if seen <> expected then
        select string_agg(format('%s was sent %s, expected %s', e.key, coalesce(seen->>e.key, '[]'), e.value),
                          '; ' order by e.key)
          into diff
          from jsonb_each(expected) e
         where (seen->e.key) is distinct from e.value;
        raise exception '0147: the fan-outs with memberships %: %', case when x.sw then 'on' else 'off' end, diff;
      end if;
    end loop;

    raise exception using errcode = 'P0147', message = '0147 passed; rolling its test rows back';
  exception
    when sqlstate 'P0147' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  if exists (select 1 from public.leagues where slug like 'zz-t147-%')
     or exists (select 1 from public.teams where slug like 'zz-t147-%')
     or exists (select 1 from public.players where slug like 'zz-t147-%')
     or exists (select 1 from public.push_devices where endpoint like '%/t147-%') then
    raise exception '0147: the test rows outlived their rollback';
  end if;
  if (select s.value from public.platform_settings s where s.key = 'memberships_enabled') is distinct from sw_before then
    raise exception '0147: the self-test left the memberships switch at % (it was %)',
      (select s.value from public.platform_settings s where s.key = 'memberships_enabled'), sw_before;
  end if;

  raise notice '0147 ok: % visitor passes and two fan-out rounds. A private league''s shop window and games, their '
               'five per-game tables, their officials, the season views, the fixture and the tip-off RPC are refused '
               'to anon and to a signed-in stranger and shown to its guests, admins, club managers, the platform admin and the '
               'service role (whose award rebuild still finds them); a public league reads as before for all of '
               'them; no stranger or phone is told about a private league''s games while each guest is told about '
               'their own', passes;
end $test$;
