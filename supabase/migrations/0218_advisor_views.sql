-- ============================================================================
-- 0218 — NO OWNER-RIGHTS VIEW IS LEFT WHERE THE API CAN REACH IT.
--
-- Supabase's security advisor (lint 0010, "Security Definer View") flagged four
-- views in public, the schema PostgREST serves: player_season_stats,
-- team_season_stats, team_staff_public and game_rows_public. Each ran with its
-- OWNER's rights, not its reader's, so the tables' own read policies never
-- reached what it read. All four were owner-rights ON PURPOSE, and each one's
-- own query was the thing that decided who sees what. Nobody sees anything
-- different after this file, and no read gets slower. The lint looks only at
-- the schemas PostgREST exposes (live: public, graphql_public; checked
-- 2026-10-02 with the publishable key), and only at views anon or
-- authenticated may select.
--
-- TWO FIXES, chosen view by view.
--
-- 1. team_staff_public: A REAL INVOKER VIEW (security_invoker), over a table
--    the browser roles may now read as narrowly as the view showed it.
--    The view showed every ACTIVE staff row, with id, team, name, role, an age
--    worked out from the year of birth, and the sort order; the raw rows were
--    for the club's managers (team_staff_manage). Now:
--      * a read policy, team_staff_active_read: anon and authenticated see the
--        active rows (the managers' own policy still gives them every row of
--        their club, as before);
--      * SELECT on team_staff, for anon and authenticated, only on the columns
--        the view reads: id, team_id, name, role, born_year, sort, active. Not
--        created_at, and not any column added later (column grants fail
--        closed). The managers' pages read exactly those columns
--        (epinoia/t/team.js); every function that reads more is SECURITY
--        DEFINER. Inserts, updates and deletes keep their grants and their
--        policy.
--    born_year was already public as the age (age = this year - born_year), and
--    an inactive row was never shown, so the table read through PostgREST shows
--    what the view did and nothing more.
--
-- 2. player_season_stats, team_season_stats, game_rows_public: THE OWNER-RIGHTS
--    QUERY MOVES TO A SCHEMA THE API DOES NOT SERVE (private), and the public
--    name becomes a security_invoker view that selects from it.
--    A real invoker view over the base tables would NOT be the same thing:
--      * the season views decide visibility by the LEAGUE (0118, 0147: an open
--        league, or memberships off, or the reader may view it; a private
--        league only for those invited), while player_game_stats' own policy
--        also lets a club's manager, a game's officials and a league's admins
--        read box scores of games the season views leave out. Read as the
--        reader, a manager's season table would change;
--      * player_season_stats masks a withheld minor's name (0171) inside its
--        own query; through players' policy the row would vanish instead;
--      * and the speed: every box-score line would go through pgs_read (a
--        sub-select a line, and can_read_game_rows for a private league), on
--        reads that aggregate a whole season;
--      * game_rows_public is the fast path INSIDE the read policies of six
--        tables (0151, 0215). Read with the reader's rights it would ask games'
--        own per-row policy for every row, which is the cost 0151 removed.
--    So the queries are kept exactly as they are, letter for letter (0171's
--    player_season_stats, 0147's team_season_stats, 0151's game_rows_public),
--    owned by postgres in private, and this file PROVES each is the very query
--    the public view ran (pg_get_viewdef, compared before anything public
--    changes) and refuses to go on if one differs. The read policies point at
--    private.game_rows_public directly, in the same scalar sub-select form
--    0151 measured (do not turn it into EXISTS or IN; see 0151).
--
--    IS THIS HONEST? The public view still reads past RLS, one level down:
--    an invoker view selecting from an owner-rights view runs that view with
--    its owner's rights. What changes is where an owner-rights query may live:
--    not in the schema the API serves, where any future owner-rights view, or
--    one re-created from an old copy, would be served as it is. The private
--    views are reachable only through the public names, which select every
--    column and row of them and nothing else, and the private schema grants
--    USAGE plus SELECT on exactly these three views (no function, no table,
--    nothing writable: game_rows_public is an updatable view, so only SELECT
--    is ever granted on either name). What a reader may see is what each
--    query's own conditions allow, exactly as since 0118, 0147, 0151 and 0171:
--      player_season_stats  final games of leagues the reader may see; a
--                           withheld minor's name only to who may see it;
--      team_season_stats    the same leagues;
--      game_rows_public     ids of games whose rows the reader may already
--                           read (a sound subset of can_read_game_rows).
--    The snapshots function reads public.game_rows_public with the publishable
--    key (supabase/functions/snapshots); the pages read player_season_stats
--    (player, creator hub), team_staff_public (club page), and the API
--    function reads player_season_stats with the service key. None of them
--    changes: same names, same columns, same rows.
--
-- SAME SPEED. The public names are views over views: Postgres flattens them
-- into the query that reads them, so the plan is the plan it was (the PGlite
-- test compares EXPLAIN before and after, and re-runs 0151's plan check:
-- one primary-key probe of games a row, through a scalar sub-select).
--
-- ONE STATEMENT, all or nothing on any CLI (0151's pattern): a push that
-- stops half way leaves 0217's state, never a public name pointing nowhere.
-- Re-running it after it applied is safe: the comparison is skipped for a
-- public view that is already the invoker wrapper.
--
-- supabase/tests/advisor-views.test.mjs: every migration applied on PGlite, a
-- fixture of every kind of league and reader, the four views read before and
-- after (rows and columns, as anon, a fan, a platform admin, two league
-- admins, a club manager, an official, a private league's guest, a
-- subscriber, an access grant, a statistician, the service role; memberships
-- off and on), lint 0010 run against the result, and the plans.
-- The CLI hides NOTICEs, so everything that matters raises.
-- ============================================================================

do $mig$
declare
  v_who      text := current_user || ' (session ' || session_user || ')';
  v_orig     text := current_user;
  v_path     text := current_setting('search_path');
  v_tables   text[] := array['game_events', 'game_state', 'player_game_stats',
                             'team_game_stats', 'lineup_stints', 'record_lines'];
  v_policies text[] := array['events_read', 'state_read', 'pgs_read', 'tgs_read', 'ls_read',
                             'record_lines_read'];
  -- 0151's text, pointed at private. The read policies are this, with
  -- <table>.game_id: the fast path, then the rule itself.
  v_expr     text := 'coalesce((select true from private.game_rows_public p '
                     'where p.id = %1$s), false) '
                     'or public.can_read_game_rows(%1$s)';
  v_view     text;
  v_was      text;
  v_now      text;
  v_q        text;
  v_w        text;
  v_n        int;
  v_i        int;
  v_pr       text;
  v_r        record;
begin
  set local lock_timeout = '5s';
  perform set_config('search_path', 'public, extensions', true);

  -- ==========================================================================
  -- 0. THE SCHEMA. Not exposed by PostgREST (only public and graphql_public
  --    are), never on a role's search_path, owned by postgres.
  -- ==========================================================================
  if to_regnamespace('private') is null
     and not has_database_privilege(current_user, current_database(), 'CREATE') then
    raise exception '0218: % may not create a schema in database %, so nothing was changed', v_who, current_database()
      using errcode = '42501';
  end if;
  create schema if not exists private;
  alter schema private owner to postgres;
  revoke all on schema private from public;
  grant usage on schema private to anon, authenticated, service_role;
  comment on schema private is
    'Not served by the API (PostgREST exposes public and graphql_public). Owner-rights views that public security_invoker views select from: player_season_stats, team_season_stats, game_rows_public (0218).';

  -- ==========================================================================
  -- 1. THE THREE QUERIES, AS THEY ARE, IN private.
  -- ==========================================================================
  -- player_season_stats: 0171's text, letter for letter.
  create or replace view private.player_season_stats as
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
    case when w.hide then null else p.first_name end as first_name,          -- 0171
    case when w.hide then null else p.last_name end as last_name,            -- 0171
    case when w.hide then null else p.slug end as player_slug,               -- 0171
    p.is_minor,
    t.name as team_name, t.short_name as team_short, t.slug as team_slug, t.colour as team_colour,
    re.jersey
  from agg a
  left join players p on p.id = a.player_id
  left join lateral (                                                         -- 0171
    select case when public.player_withheld(p.is_minor, p.public_consent)     -- 0171
                then not public.may_see_withheld_player(a.player_id)          -- 0171
                else false end as hide                                        -- 0171
  ) w on true                                                                 -- 0171
  left join teams   t on t.id = a.team_id
  left join lateral (
    select r.jersey from roster_entries r
     where r.player_id = a.player_id and r.team_id = a.team_id
     order by r.created_at desc limit 1
  ) re on true;

  -- team_season_stats: 0147's text, letter for letter.
  create or replace view private.team_season_stats as
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

  -- game_rows_public: 0151's text, letter for letter. Keyed by games.id and
  -- joins nothing, so the scalar sub-select in the policies never sees two rows.
  create or replace view private.game_rows_public as
    select g.id
      from public.games g
     where ( g.status = 'final'
             and ( g.competition_id is null
                   or g.competition_id in (select public.game_rows_open_competitions(false)) ) )
        or ( g.status = 'live'
             and g.competition_id in (select public.game_rows_open_competitions(true)) );

  comment on view private.player_season_stats is
    'Owner-rights on purpose (0118: the league decides who sees a season; 0171: a withheld minor''s name). Read through public.player_season_stats (security_invoker). Moved here from public by 0218.';
  comment on view private.team_season_stats is
    'Owner-rights on purpose (0118, 0147: the league decides who sees a season). Read through public.team_season_stats (security_invoker). Moved here from public by 0218.';
  comment on view private.game_rows_public is
    'Games whose per-game rows are public to the caller: a sound subset of can_read_game_rows(); the fast path of the read policies (0151, 0215). Owner-rights on purpose; SELECT only. Moved here from public by 0218.';

  -- owned by the owner of the tables, so they read past their policies; SELECT
  -- only (game_rows_public is automatically updatable, and would write as its
  -- owner)
  alter view private.player_season_stats owner to postgres;
  alter view private.team_season_stats owner to postgres;
  alter view private.game_rows_public owner to postgres;
  revoke all on private.player_season_stats from public, anon, authenticated, service_role;
  revoke all on private.team_season_stats from public, anon, authenticated, service_role;
  revoke all on private.game_rows_public from public, anon, authenticated, service_role;
  grant select on private.player_season_stats to anon, authenticated, service_role;
  grant select on private.team_season_stats to anon, authenticated, service_role;
  grant select on private.game_rows_public to anon, authenticated;    -- as 0151: not service_role

  -- ==========================================================================
  -- 2. THE PROOF THAT NOTHING MOVED: each private query is the query the
  --    public view runs now, compared as Postgres itself prints them (every
  --    name schema-qualified). A public view that is already the wrapper (this
  --    file re-run) is not compared.
  -- ==========================================================================
  perform set_config('search_path', 'pg_catalog', true);
  foreach v_view in array array['player_season_stats', 'team_season_stats', 'game_rows_public'] loop
    if exists (select 1 from pg_class c, pg_options_to_table(c.reloptions) o
                where c.oid = format('public.%I', v_view)::regclass
                  and o.option_name = 'security_invoker' and o.option_value in ('true', 'on', '1', 'yes')) then
      continue;
    end if;
    v_was := pg_get_viewdef(format('public.%I', v_view)::regclass);
    v_now := pg_get_viewdef(format('private.%I', v_view)::regclass);
    if v_was is distinct from v_now then
      raise exception '0218: public.% is no longer the query this file copies (0171 / 0147 / 0151); a later migration changed it, and moving it would undo that. Nothing was changed. It reads: %',
        v_view, v_was;
    end if;
  end loop;
  perform set_config('search_path', 'public, extensions', true);

  -- ==========================================================================
  -- 3. THE READ POLICIES: the fast path read from private. ALTER POLICY, so
  --    there is never a moment with no read policy. Then any other policy that
  --    still names public.game_rows_public (one written since, by another
  --    file) is pointed at private the same way, its text otherwise unchanged.
  -- ==========================================================================
  for v_i in 1 .. array_length(v_tables, 1) loop
    if to_regclass(format('public.%I', v_tables[v_i])) is not null
       and exists (select 1 from pg_policies p where p.schemaname = 'public'
                     and p.tablename = v_tables[v_i] and p.policyname = v_policies[v_i]) then
      execute format('alter policy %I on public.%I using (%s)',
                     v_policies[v_i], v_tables[v_i], format(v_expr, format('%I.game_id', v_tables[v_i])));
    end if;
  end loop;

  perform set_config('search_path', 'pg_catalog', true);
  for v_r in
    select pol.polname, n.nspname, c.relname,
           pg_get_expr(pol.polqual, pol.polrelid) as q,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as w
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%public.game_rows_public%'
  loop
    v_q := replace(v_r.q, 'public.game_rows_public', 'private.game_rows_public');
    v_w := replace(v_r.w, 'public.game_rows_public', 'private.game_rows_public');
    if v_q is not null then
      execute format('alter policy %I on %I.%I using (%s)', v_r.polname, v_r.nspname, v_r.relname, v_q);
    end if;
    if v_w is not null then
      execute format('alter policy %I on %I.%I with check (%s)', v_r.polname, v_r.nspname, v_r.relname, v_w);
    end if;
  end loop;
  perform set_config('search_path', 'public, extensions', true);

  -- ==========================================================================
  -- 4. THE PUBLIC NAMES: security_invoker views, same columns in the same
  --    order (so CREATE OR REPLACE keeps grants and every function that reads
  --    them), selecting every row of the private query.
  -- ==========================================================================
  create or replace view public.player_season_stats with (security_invoker = true) as
    select * from private.player_season_stats;
  create or replace view public.team_season_stats with (security_invoker = true) as
    select * from private.team_season_stats;
  create or replace view public.game_rows_public with (security_invoker = true) as
    select p.id from private.game_rows_public p;

  comment on view public.player_season_stats is
    'Season lines a player at a club (final games). security_invoker over private.player_season_stats, which decides who sees what (0118, 0147, 0171, 0218).';
  comment on view public.team_season_stats is
    'Season totals a club (final games). security_invoker over private.team_season_stats, which decides who sees what (0118, 0147, 0218).';
  comment on view public.game_rows_public is
    'Games whose per-game rows are public to the caller (0151). security_invoker over private.game_rows_public, which the read policies use directly (0218). SELECT only.';

  alter view public.player_season_stats owner to postgres;
  alter view public.team_season_stats owner to postgres;
  alter view public.game_rows_public owner to postgres;
  -- what each name was granted before, and nothing else (Supabase's default
  -- privileges hand every API role ALL on a relation in public; game_rows_public
  -- is updatable)
  revoke all on public.game_rows_public from public, anon, authenticated, service_role;
  grant select on public.game_rows_public to anon, authenticated;

  -- ==========================================================================
  -- 5. team_staff_public: the reader's own rights, over the columns and rows
  --    the view always showed.
  -- ==========================================================================
  drop policy if exists team_staff_active_read on public.team_staff;
  create policy team_staff_active_read on public.team_staff
    for select to anon, authenticated
    using (active);
  -- revoking the table-wide SELECT also drops any column SELECT, so the
  -- columns are granted after it
  revoke select on public.team_staff from anon, authenticated;
  grant select (id, team_id, name, role, born_year, sort, active) on public.team_staff to anon, authenticated;

  create or replace view public.team_staff_public with (security_invoker = true) as
    select s.id,
           s.team_id,
           s.name,
           s.role,
           case when s.born_year is not null
                then extract(year from current_date)::int - s.born_year end as age,
           s.sort
      from public.team_staff s
     where s.active;
  alter view public.team_staff_public owner to postgres;
  comment on view public.team_staff_public is
    'A club''s active staff: name, role, an age, the order. security_invoker: read through team_staff''s own policy and column grants (0218).';

  -- ==========================================================================
  -- 6. SELF-TEST. Raises, so a failure rolls the whole file back.
  -- ==========================================================================
  -- (a) lint 0010 as Supabase runs it, over the exposed schemas: no view anon
  --     or authenticated may read runs with its owner's rights
  select count(*), string_agg(n.nspname || '.' || c.relname, ', ') into v_n, v_pr
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v'
     and n.nspname in ('public', 'graphql_public')
     and c.relname in ('player_season_stats', 'team_season_stats', 'team_staff_public', 'game_rows_public')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
     and not (lower(coalesce(c.reloptions::text, '{}'))::text[]
              && array['security_invoker=1', 'security_invoker=true', 'security_invoker=yes', 'security_invoker=on']);
  if v_n > 0 then
    raise exception '0218: still owner-rights in an exposed schema: %', v_pr;
  end if;

  -- (b) 0151's checks, on the view that is now the fast path
  perform set_config('search_path', 'public, extensions', true);
  for v_i in 1 .. array_length(v_tables, 1) loop
    continue when to_regclass(format('public.%I', v_tables[v_i])) is null;
    select p.qual into v_pr
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = v_tables[v_i] and p.policyname = v_policies[v_i]
       and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE';
    if v_pr is null
       or position('private.game_rows_public' in v_pr) = 0
       or position(v_tables[v_i] || '.game_id' in v_pr) = 0
       or position('can_read_game_rows(game_id)' in v_pr) = 0
       or position('private.game_rows_public' in v_pr) > position('can_read_game_rows' in v_pr) then
      raise exception '0218: %.% is not "fast path from private, then can_read_game_rows" (it reads: %)',
        v_tables[v_i], v_policies[v_i], coalesce(v_pr, 'no such policy');
    end if;
  end loop;
  perform set_config('search_path', 'pg_catalog', true);
  select count(*) into v_n from pg_policy pol
   where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%public.game_rows_public%';
  perform set_config('search_path', 'public, extensions', true);
  if v_n > 0 then
    raise exception '0218: % policies still read the fast path through public.game_rows_public', v_n;
  end if;

  foreach v_pr in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    foreach v_view in array array['private.game_rows_public', 'public.game_rows_public',
                                  'private.player_season_stats', 'private.team_season_stats'] loop
      if has_table_privilege('anon', v_view, v_pr)
         or has_table_privilege('authenticated', v_view, v_pr)
         or has_table_privilege('service_role', v_view, v_pr) then
        raise exception '0218: a browser or service role holds % on %, which only ever grants SELECT', v_pr, v_view;
      end if;
    end loop;
  end loop;
  foreach v_view in array array['private.game_rows_public', 'public.game_rows_public',
                                'private.player_season_stats', 'public.player_season_stats',
                                'private.team_season_stats', 'public.team_season_stats',
                                'public.team_staff_public'] loop
    if not has_table_privilege('anon', v_view, 'select')
       or not has_table_privilege('authenticated', v_view, 'select') then
      raise exception '0218: anon and authenticated must be able to read %', v_view;
    end if;
  end loop;
  -- the service role (finalise-game's awards, the API function) reads the season views
  if not has_schema_privilege('service_role', 'private', 'usage')
     or not has_table_privilege('service_role', 'private.player_season_stats', 'select')
     or not has_table_privilege('service_role', 'private.team_season_stats', 'select')
     or not has_table_privilege('service_role', 'public.player_season_stats', 'select')
     or not has_table_privilege('service_role', 'public.team_season_stats', 'select') then
    raise exception '0218: the service role must still read both season views';
  end if;
  if not has_schema_privilege('anon', 'private', 'usage')
     or not has_schema_privilege('authenticated', 'private', 'usage') then
    raise exception '0218: anon and authenticated need USAGE on private, or every read of the box scores fails';
  end if;
  if has_schema_privilege('anon', 'private', 'create') or has_schema_privilege('authenticated', 'private', 'create')
     or has_schema_privilege('service_role', 'private', 'create') then
    raise exception '0218: an API role may create objects in private';
  end if;
  foreach v_view in array array['player_season_stats', 'team_season_stats', 'game_rows_public'] loop
    if exists (select 1 from pg_class c, pg_options_to_table(c.reloptions) o
                where c.oid = format('private.%I', v_view)::regclass
                  and o.option_name = 'security_invoker' and o.option_value in ('true', 'on', '1', 'yes')) then
      raise exception '0218: private.% became security_invoker; it would read through the tables'' per-row policies', v_view;
    end if;
    if (select relowner from pg_class where oid = format('private.%I', v_view)::regclass)
       <> (select relowner from pg_class where oid = 'public.games'::regclass) then
      raise exception '0218: private.% is not owned by the owner of games, so it would not read past their policies', v_view;
    end if;
  end loop;
  select count(*) into v_n
    from pg_class c
    join pg_roles o on o.oid = c.relowner
   where c.oid in ('public.games'::regclass, 'public.competitions'::regclass, 'public.seasons'::regclass,
                   'public.leagues'::regclass, 'public.player_game_stats'::regclass,
                   'public.team_game_stats'::regclass, 'public.players'::regclass)
     and c.relforcerowsecurity and not o.rolbypassrls;
  if v_n > 0 then
    raise exception '0218: row security is forced on % of the tables the private views read', v_n;
  end if;

  -- (c) team_staff: the columns the view reads, and not the others
  foreach v_pr in array array['id', 'team_id', 'name', 'role', 'born_year', 'sort', 'active'] loop
    if not has_column_privilege('anon', 'public.team_staff', v_pr, 'select')
       or not has_column_privilege('authenticated', 'public.team_staff', v_pr, 'select') then
      raise exception '0218: anon and authenticated need SELECT on team_staff.% for team_staff_public', v_pr;
    end if;
  end loop;
  if has_column_privilege('anon', 'public.team_staff', 'created_at', 'select')
     or has_column_privilege('authenticated', 'public.team_staff', 'created_at', 'select') then
    raise exception '0218: team_staff.created_at is readable by a browser role; the view never showed it';
  end if;

  -- (d) every name reads, as each API role (permissions are checked when a
  --     query starts, so `where false` proves them without reading a row).
  --     Never RESET ROLE (0151): the push connects through a temporary role.
  for v_r in select * from (values ('anon'), ('authenticated')) v(rl) loop
    perform set_config('request.jwt.claims', json_build_object('role', v_r.rl)::text, true);
    execute format('set local role %I', v_r.rl);
    perform 1 from public.player_season_stats where false;
    perform 1 from public.team_season_stats where false;
    perform 1 from public.team_staff_public where false;
    perform 1 from public.game_rows_public where false;
    perform 1 from public.team_staff where false;
    perform 1 from public.game_events where false;
    perform 1 from public.player_game_stats where false;
    perform 1 from public.record_lines where false;
    execute format('set local role %I', v_orig);
  end loop;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('search_path', v_path, true);
end $mig$;
