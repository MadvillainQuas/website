-- ============================================================================
-- 0151 — THE GAME-ROW READ POLICIES STOP PAYING A FUNCTION CALL PER ROW.
--
-- Since 0136 the five row-heavy tables — game_events, game_state,
-- player_game_stats, team_game_stats and lineup_stints — have read through
-- `using (public.can_read_game_rows(game_id))`. The rule in that function is
-- right. The way Postgres runs it is the problem: it is `language sql stable
-- security definer set search_path = public` with a `select exists (...)`
-- body, and Postgres never inlines a SQL function that is SECURITY DEFINER,
-- has a SET clause, or whose body holds a sub-select. So it is a separate
-- function call, with its own executor start-up and a four-table join, for
-- EVERY ROW the scan walks, including rows an OFFSET then throws away.
-- 0084 inlined the same rule to avoid exactly this, and 0136 undid it.
--
-- MEASURED, 2026-09-23.
--   Live, signed out, one request at a time, through the REST API: the 31
--   games of Loughborough Riders' competition hold 26,481 events. An exact
--   count of them takes 1.08-1.14 s; the same request without the count
--   takes 0.06 s. A 1000-row page costs 0.10 s at offset 0 and 0.57 s at
--   offset 12000. Both come to about 0.04 ms per row walked.
--   Local copy (PGlite, Postgres 18.3, every migration applied, the same
--   shape: 31 games x 850 events): the count takes 9 ms as the table owner,
--   where no policy applies, and 2,140 ms signed out. Shared-buffer hits go
--   from 690 to 212,401, about eight extra page reads per row, which is the
--   function's join. The scan itself is not the cost.
--
-- WHAT CHANGES. Nothing about who may read what. Each policy becomes
--
--     coalesce((select true from public.game_rows_public p
--                where p.id = <table>.game_id), false)
--     or public.can_read_game_rows(<table>.game_id)
--
-- i.e. a FAST PATH, or the rule itself exactly as it was. The fast path
-- only has to be SOUND: it may never admit a game the rule would refuse.
-- Anything it does not admit falls through to can_read_game_rows, so the
-- policy grants precisely what the function grants, and the function stays
-- the one definition of the rule. A mistake that makes the fast path too
-- narrow costs speed, never access; only a fast path that admits too much
-- could leak, and the self-test below exists to catch that.
--
-- THE FAST PATH admits the games whose rows the rule shows to everybody:
-- finished games, and live games in a league that publishes live, in a
-- PUBLIC league that is open (or has memberships switched off, or that the
-- reader may view), plus finished games in no league at all. That is the
-- public half of can_read_game_rows, with one condition MORE:
-- l.visibility = 'public'. A private league (0139) never takes the fast
-- path; its games go to the rule, row by row, exactly as today.
--
-- HOW IT STAYS CHEAP.
--   * game_rows_open_competitions() decides the league half once per
--     statement: the competitions whose league passes. It is a small set,
--     hashed by the planner.
--   * game_rows_public is a view over games alone, so per row the fast path
--     is one primary-key probe into games plus a hash lookup. The view runs
--     with its OWNER's rights (it is deliberately not security_invoker), so
--     games' own read policy, another function call per row, does not apply
--     inside it. It exposes nothing a reader cannot already see: the ids of
--     games whose rows that reader may read, a subset of what the games
--     table itself shows them. Supabase's security advisor flags every
--     owner-rights view, and it will flag this one.
--   * The fast path is a SCALAR sub-select on purpose. Written as EXISTS or
--     IN, the planner may instead hash the whole view once per statement,
--     which enumerates every public game on the platform for every read,
--     even a one-row read. Measured locally with 40,000 finished games, that
--     is ~110 ms per statement; this form is 0.4 ms for one row. Do not
--     "simplify" it.
--   Locally, signed out, with this file applied: the 31-game count goes from
--   2,140 ms to 84-88 ms, and one game's 850 events from 68 ms to 3 ms, the
--   same with 55 or with 40,000 finished games on the platform. Owner-only
--   (no policy): 8 ms and 0.8 ms.
--
-- THE VIEW IS AUTOMATICALLY UPDATABLE (one table, no aggregate), and it
-- writes with its owner's rights, and Supabase's default privileges hand
-- every browser role ALL on a new relation in public. So this file revokes
-- everything and grants SELECT only, inside the same statement that creates
-- it, and the self-test refuses to finish if a browser role holds anything
-- else on it.
--
-- ONE STATEMENT. A push has not always been one transaction (0140 landed its
-- first fifteen statements; CLI 2.117 ran 0145's failed push as one), so the
-- whole migration is one DO block, all or nothing on any CLI: create the
-- helpers, PROVE the new
-- expression against can_read_game_rows for every game in the database, as
-- every kind of reader, with memberships switched off and on, and only then
-- swap the five policies, built from the same text that was proved. Any
-- failure rolls back everything, helpers included, and leaves 0136 in place.
-- The proof runs before the swap so the five tables are locked only for the
-- swap and a read-back of a few fixture rows, not for the seconds the proof
-- takes.
--
-- The CLI hides NOTICEs, so everything that matters raises.
-- ============================================================================

do $mig$
declare
  who        text := current_user || ' (session ' || session_user || ')';
  orig       text := current_user;
  tables     text[] := array['game_events', 'game_state', 'player_game_stats',
                             'team_game_stats', 'lineup_stints'];
  policies   text[] := array['events_read', 'state_read', 'pgs_read', 'tgs_read', 'ls_read'];
  -- THE ONE TEXT. The proof evaluates it for x.id; the swap attaches it with
  -- <table>.game_id. Change it and both change.
  expr_tpl   text := 'coalesce((select true from public.game_rows_public p '
                     'where p.id = %1$s), false) '
                     'or public.can_read_game_rows(%1$s)';
  i          int;
  n          int;
  pr         text;
  -- fixture: five leagues, one of each kind the rule tells apart, and games in
  -- no league at all
  lg         jsonb := '{}'::jsonb;    -- kind -> league id
  cp         jsonb := '{}'::jsonb;    -- kind -> competition id
  th         jsonb := '{}'::jsonb;    -- kind -> home club id
  ta         jsonb := '{}'::jsonb;    -- kind -> away club id
  kinds      text[] := array['open', 'live', 'members', 'private', 'private_members', 'none'];
  statuses   text[] := array['scheduled', 'live', 'finalising', 'final', 'void'];
  k          text;
  st         text;
  gid        uuid;
  g_cup      uuid;
  fx         jsonb := '{}'::jsonb;    -- "<kind>/<status>" -> game id
  u          jsonb := '{}'::jsonb;    -- visitor label -> account id
  ids        uuid[];
  priv       uuid[];
  fx_ids     uuid[];
  r          record;
  sw         boolean;
  n_diff     int;
  n_unsound  int;
  n_missed   int;
  n_fast     int;
  n_fx_fb    int;
  n_rule     int;
  fx_rule_off int := -1;
  fx_rule_on  int := -1;
  passes     int := 0;
  fallback_seen jsonb := '{}'::jsonb;
  bad        text;
  s_league   uuid;
  s_comp     uuid;
  s_home     uuid;
  s_away     uuid;
begin
  set local lock_timeout = '5s';

  -- ==========================================================================
  -- 1. THE HELPERS. New objects only; nothing that exists is touched yet.
  -- ==========================================================================

  /* The league half of the fast path, once per statement: the competitions
     whose league is PUBLIC and either open, or gated while memberships are
     switched off, or gated and viewable by the caller. With p_live, only the
     leagues that publish live games. The CASE is can_read_game_rows' own,
     letter for letter; `l.id is null` is dropped because the inner joins
     cannot produce a null league. Security definer so it reads competitions,
     seasons and leagues without their policies (a private league's rows are
     hidden from the caller, and it must still be excluded, not skipped). */
  create or replace function public.game_rows_open_competitions(p_live boolean)
  returns setof uuid language sql stable security definer set search_path = public
  rows 100 as $fn$
    select c.id
      from public.competitions c
      join public.seasons s on s.id = c.season_id
      join public.leagues  l on l.id = s.league_id
     where l.visibility = 'public'
       and (not p_live or l.public_live)
       and case when l.access_mode = 'open'
                     or not (select public.memberships_enabled()) then true
                else public.can_view_league(l.id) end
  $fn$;
  comment on function public.game_rows_open_competitions(boolean) is
    'The competitions whose games'' rows are public to the caller: public league, open (or memberships off, or viewable). The league half of the 0151 fast path.';
  alter function public.game_rows_open_competitions(boolean) owner to postgres;
  revoke all on function public.game_rows_open_competitions(boolean) from public;
  grant execute on function public.game_rows_open_competitions(boolean) to anon, authenticated, service_role;

  /* The fast path: the ids of games whose rows the caller may read because
     they are public. Owner's rights (NOT security_invoker): see the header.
     Keyed by games.id and joins nothing, so the scalar sub-select in the
     policies can never see two rows. */
  create or replace view public.game_rows_public as
    select g.id
      from public.games g
     where ( g.status = 'final'
             and ( g.competition_id is null
                   or g.competition_id in (select public.game_rows_open_competitions(false)) ) )
        or ( g.status = 'live'
             and g.competition_id in (select public.game_rows_open_competitions(true)) );
  comment on view public.game_rows_public is
    'Games whose per-game rows (events, state, box scores, stints) are public to the caller. A sound subset of can_read_game_rows(); the fast path of the five read policies (0151). Owner-rights on purpose; SELECT only.';
  alter view public.game_rows_public owner to postgres;
  revoke all on public.game_rows_public from public, anon, authenticated, service_role;
  grant select on public.game_rows_public to anon, authenticated;

  -- ==========================================================================
  -- 2. THE PROOF, before anything live changes.
  --
  -- For EVERY game in the database, plus a fixture of one league of each kind
  -- the rule tells apart (open; publishing live; members-only; private;
  -- private and members-only; no league) with a game in each status, and a cup
  -- tie across two of them; as anon and as ten signed-in readers, one per
  -- branch of the rule (platform admin, two league admins, a club manager, a
  -- game official, a private league's guest, a subscriber, an access grant, a
  -- statistician's membership, and a fan who holds nothing); with memberships
  -- switched off and switched on:
  --
  --   (b) EVERY GAME: the fast path never admits a game the rule refuses. This
  --       is the security claim, and with the policy being "fast path OR
  --       rule" it is the whole of it: a policy of that shape IS the rule on
  --       every game where the fast path is inside the rule.
  --   (c) EVERY GAME, signed out and for the fan: every game the rule allows
  --       outside a private league is on the fast path, so the public site's
  --       reads never fall back to the per-row function.
  --   (a) THE FIXTURE: the exact text the swap attaches answers what
  --       can_read_game_rows answers, game for game.
  --   (d) THE FIXTURE: the fast path never admits a private league, a game
  --       that has not finished, a live game in a league that does not publish
  --       live, or a live game in no league; it follows can_view_league for a
  --       members-only league once memberships are on; and the identity
  --       branches really were reached through the fallback.
  --
  -- Each comparison is ONE statement, so both sides read one snapshot while
  -- the live platform keeps scoring. Everything is undone by a private
  -- SQLSTATE (the P0115 pattern): rows, the switch, roles and forged claims.
  -- Never RESET ROLE: the push connects through a temporary login role, and
  -- RESET ROLE lands on it.
  -- ==========================================================================
  begin
    perform set_config('epinoia.access_rpc', 'on', true);
    perform set_config('epinoia.visibility_rpc', 'on', true);

    foreach k in array kinds loop
      if k <> 'none' then
        insert into public.leagues (slug, name, public_live, access_mode, visibility)
        values ('zz-t0151-' || replace(k, '_', '-'), 'T0151 ' || k,
                k in ('live', 'members', 'private'),
                case when k in ('members', 'private_members') then 'members' else 'open' end,
                case when k in ('private', 'private_members') then 'private' else 'public' end)
        returning id into gid;
        lg := lg || jsonb_build_object(k, gid);
        insert into public.seasons (league_id, name) values (gid, 'T0151') returning id into gid;
        insert into public.competitions (season_id, name) values (gid, 'T0151 League') returning id into gid;
        cp := cp || jsonb_build_object(k, gid);
      end if;
      insert into public.teams (league_id, slug, name)
      values ((lg ->> k)::uuid, 'zz-t0151-' || replace(k, '_', '-') || '-h', 'T0151 ' || k || ' home')
      returning id into gid;
      th := th || jsonb_build_object(k, gid);
      insert into public.teams (league_id, slug, name)
      values ((lg ->> k)::uuid, 'zz-t0151-' || replace(k, '_', '-') || '-a', 'T0151 ' || k || ' away')
      returning id into gid;
      ta := ta || jsonb_build_object(k, gid);

      foreach st in array statuses loop
        insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status)
        values ((cp ->> k)::uuid, (th ->> k)::uuid, (ta ->> k)::uuid, now() - interval '1 day',
                st::public.game_status)
        returning id into gid;
        fx := fx || jsonb_build_object(k || '/' || st, gid);
      end loop;
    end loop;

    -- a cup tie in the private members-only league, at home to the OPEN
    -- league's club: its manager reaches it only through the clubs' branch
    insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status)
    values ((cp ->> 'private_members')::uuid, (th ->> 'open')::uuid, (ta ->> 'private_members')::uuid,
            now() - interval '2 days', 'final')
    returning id into g_cup;

    perform set_config('epinoia.access_rpc', '', true);
    perform set_config('epinoia.visibility_rpc', '', true);

    -- the readers. The proof needs every identity branch, so it cannot fall
    -- back to borrowing accounts: if this role may not create them, the
    -- migration fails and says so rather than proving less than it claims.
    for r in select * from (values ('platform_admin'), ('league_admin'), ('private_admin'),
                                   ('manager'), ('official'), ('guest'), ('subscriber'),
                                   ('grant'), ('statistician'), ('fan')) v(label)
    loop
      gid := gen_random_uuid();
      begin
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                                email_confirmed_at, created_at, updated_at)
        values (gid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                't0151-' || replace(r.label, '_', '-') || '@example.invalid', '', now(), now(), now());
      exception when insufficient_privilege then
        raise exception '0151: % may not create auth.users rows, so the signed-in half of the proof cannot run; nothing was changed', who;
      end;
      u := u || jsonb_build_object(r.label, gid);
    end loop;

    insert into public.memberships (user_id, role, scope_type, scope_id) values
      ((u ->> 'platform_admin')::uuid, 'platform_admin', 'platform', null),
      ((u ->> 'league_admin')::uuid,   'league_admin',   'league',   (lg ->> 'members')::uuid),
      ((u ->> 'private_admin')::uuid,  'league_admin',   'league',   (lg ->> 'private_members')::uuid),
      ((u ->> 'manager')::uuid,        'team_manager',   'team',     (th ->> 'open')::uuid),
      ((u ->> 'statistician')::uuid,   'statistician',   'league',   (lg ->> 'private')::uuid);
    insert into public.game_officials (game_id, user_id, role) values
      ((fx ->> 'open/scheduled')::uuid, (u ->> 'official')::uuid, 'statistician'),
      ((fx ->> 'private/live')::uuid,   (u ->> 'official')::uuid, 'statistician');
    insert into public.league_guests (league_id, user_id)
    values ((lg ->> 'private')::uuid, (u ->> 'guest')::uuid);
    insert into public.access_subscriptions (user_id, plan_id, league_id, features, status,
                                             stripe_subscription_id, stripe_customer_id, current_period_end)
    values ((u ->> 'subscriber')::uuid, null, (lg ->> 'members')::uuid, array['league'], 'active',
            'sub_t0151', 'cus_t0151', now() + interval '20 days');
    insert into public.access_grants (league_id, email, features)
    values ((lg ->> 'private_members')::uuid, 't0151-grant@example.invalid', array['league']);

    -- every game, and which of them sit in a private league, with this file's
    -- rights: a reader cannot list the games it is about to be asked about
    select coalesce(array_agg(g.id), '{}'::uuid[]) into ids from public.games g;
    select coalesce(array_agg(g.id), '{}'::uuid[]) into priv
      from public.games g
      join public.competitions c on c.id = g.competition_id
      join public.seasons s      on s.id = c.season_id
      join public.leagues  l     on l.id = s.league_id
     where l.visibility <> 'public';
    select array_agg(x.v::uuid) || g_cup into fx_ids from jsonb_each_text(fx) x(k, v);

    for r in
      select v.label, v.rl, sw_.sw
        from (values ('anon', 'anon'), ('fan', 'authenticated'),
                     ('platform_admin', 'authenticated'), ('league_admin', 'authenticated'),
                     ('private_admin', 'authenticated'), ('manager', 'authenticated'),
                     ('official', 'authenticated'), ('guest', 'authenticated'),
                     ('subscriber', 'authenticated'), ('grant', 'authenticated'),
                     ('statistician', 'authenticated')) v(label, rl),
             (values (false), (true)) sw_(sw)
       order by sw_.sw, v.label
    loop
      insert into public.platform_settings (key, value) values ('memberships_enabled', to_jsonb(r.sw))
      on conflict (key) do update set value = excluded.value;
      if public.memberships_enabled() is distinct from r.sw then
        raise exception '0151: could not set the memberships switch to % for the proof', r.sw;
      end if;

      if r.label = 'anon' then
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', u ->> r.label, 'role', 'authenticated')::text, true);
      end if;
      execute format('set local role %I', r.rl);

      -- (b) every game: the fast path admits nothing the rule refuses. The rule
      -- is only asked where the fast path said yes (AND stops at a false), so
      -- this is one probe a game, not the rule's identity checks four thousand
      -- times over.
      execute $q$
        select count(*) filter (where t.f),
               count(*) filter (where t.f and not public.can_read_game_rows(x.id))
          from unnest($1) as x(id)
          cross join lateral (
            select coalesce((select true from public.game_rows_public p where p.id = x.id), false) as f) t
      $q$ into n_fast, n_unsound using ids;

      -- (c) every game, signed out and for the fan: whatever the rule lets them
      -- read outside a private league is on the fast path
      n_missed := 0;
      if r.label in ('anon', 'fan') then
        execute $q$
          select count(*)
            from unnest($1) as x(id)
           where not coalesce((select true from public.game_rows_public p where p.id = x.id), false)
             and not (x.id = any($2))
             and public.can_read_game_rows(x.id)
        $q$ into n_missed using ids, priv;
      end if;

      -- (a) the fixture, one game of every kind: the EXACT text the swap will
      -- attach, beside the rule. With (b) this is the whole claim: the policy
      -- is "fast path OR rule", the fast path is inside the rule on every
      -- game, so the policy is the rule on every game.
      execute format($q$
        select count(*) filter (where t.e is distinct from t.r),
               count(*) filter (where t.r and not t.f),
               count(*) filter (where t.r)
          from unnest($1) as x(id)
          cross join lateral (
            select (%s) as e,
                   coalesce((select true from public.game_rows_public p where p.id = x.id), false) as f,
                   public.can_read_game_rows(x.id) as r) t
      $q$, format(expr_tpl, 'x.id'))
        into n_diff, n_fx_fb, n_rule
        using fx_ids;

      -- (d): the fixture, game by game
      select string_agg(x.k, ', ' order by x.k) into bad
        from jsonb_each_text(fx) x(k, v)
        cross join lateral (
          select coalesce((select true from public.game_rows_public p where p.id = x.v::uuid), false) as f) t
       where t.f is distinct from (
               case
                 when split_part(x.k, '/', 1) in ('private', 'private_members') then false
                 when split_part(x.k, '/', 2) not in ('final', 'live') then false
                 when split_part(x.k, '/', 2) = 'live' and split_part(x.k, '/', 1) in ('open', 'none') then false
                 when split_part(x.k, '/', 1) = 'members' then
                   (not r.sw or public.can_view_league((lg ->> 'members')::uuid))
                 else true
               end);
      if coalesce((select true from public.game_rows_public p where p.id = g_cup), false) then
        bad := concat_ws(', ', bad, 'cup tie in the private league');
      end if;

      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);

      if n_diff > 0 then
        raise exception '0151: as %, memberships %, the policy text disagrees with can_read_game_rows on % of % fixture games',
          r.label, case when r.sw then 'on' else 'off' end, n_diff, cardinality(fx_ids);
      end if;
      if n_unsound > 0 then
        raise exception '0151: as %, memberships %, the fast path admits % games that can_read_game_rows refuses',
          r.label, case when r.sw then 'on' else 'off' end, n_unsound;
      end if;
      if r.label in ('anon', 'fan') and n_missed > 0 then
        raise exception '0151: as %, memberships %, % readable games outside private leagues missed the fast path and would be checked row by row',
          r.label, case when r.sw then 'on' else 'off' end, n_missed;
      end if;
      if bad is not null then
        raise exception '0151: as %, memberships %, the fast path is wrong for fixture games: %',
          r.label, case when r.sw then 'on' else 'off' end, bad;
      end if;
      if n_fast = 0 then
        raise exception '0151: as %, memberships %, nothing took the fast path at all',
          r.label, case when r.sw then 'on' else 'off' end;
      end if;

      fallback_seen := fallback_seen || jsonb_build_object(r.label || '/' || r.sw::text, n_fx_fb);
      if r.label = 'anon' then
        if r.sw then fx_rule_on := n_rule; else fx_rule_off := n_rule; end if;
      end if;
      passes := passes + 1;
    end loop;

    /* The proof proved something: the identity branches were reached through
       the fallback (a club manager's scheduled fixture, an official's game, a
       league admin's unfinished game, the platform admin's everything), and
       the switch changed what anon may read (the members-only league). */
    foreach k in array array['platform_admin', 'league_admin', 'private_admin', 'manager', 'official'] loop
      foreach sw in array array[false, true] loop
        if coalesce((fallback_seen ->> (k || '/' || sw::text))::int, 0) = 0 then
          raise exception '0151: the proof never reached the rule''s identity branch for the % (memberships %)',
            k, case when sw then 'on' else 'off' end;
        end if;
      end loop;
    end loop;
    if fx_rule_off <= fx_rule_on then
      raise exception '0151: switching memberships on did not narrow what anon may read on the fixture (% games off, % on)',
        fx_rule_off, fx_rule_on;
    end if;
    if passes <> 22 then
      raise exception '0151: expected 22 proof passes, ran %', passes;
    end if;

    raise exception using errcode = 'P0151', message = '0151 proof passed; rolling its fixture back';
  exception
    when sqlstate 'P0151' then null;
    when others then raise exception '% [0151 proof, ran as %]', sqlerrm, who;
  end;

  -- ==========================================================================
  -- 3. THE SWAP: the text that was proved, attached to each table's game_id.
  --    ALTER POLICY, so there is never a moment with no read policy at all.
  -- ==========================================================================
  for i in 1 .. array_length(tables, 1) loop
    execute format('alter policy %I on public.%I using (%s)',
                   policies[i], tables[i], format(expr_tpl, format('%I.game_id', tables[i])));
  end loop;

  -- ==========================================================================
  -- 4. AFTER THE SWAP: the catalogue, and a read through each table.
  -- ==========================================================================
  -- (pg_policies prints the table's own column bare, and the one inside the
  -- sub-select qualified)
  for i in 1 .. array_length(tables, 1) loop
    select p.qual into pr
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = tables[i] and p.policyname = policies[i]
       and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE';
    if pr is null
       or position('game_rows_public' in pr) = 0
       or position(tables[i] || '.game_id' in pr) = 0
       or position('can_read_game_rows(game_id)' in pr) = 0
       or position('game_rows_public' in pr) > position('can_read_game_rows' in pr) then
      raise exception '0151: %.% is not "fast path, then can_read_game_rows" (it reads: %)',
        tables[i], policies[i], coalesce(pr, 'no such policy');
    end if;
  end loop;

  foreach pr in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('anon', 'public.game_rows_public', pr)
       or has_table_privilege('authenticated', 'public.game_rows_public', pr)
       or has_table_privilege('service_role', 'public.game_rows_public', pr) then
      raise exception '0151: a browser or service role holds % on the owner-rights view game_rows_public, which would write to games past its policies', pr;
    end if;
  end loop;
  if not has_table_privilege('anon', 'public.game_rows_public', 'select')
     or not has_table_privilege('authenticated', 'public.game_rows_public', 'select') then
    raise exception '0151: anon and authenticated must be able to read game_rows_public, or every read of the five tables fails';
  end if;
  if not has_function_privilege('anon', 'public.game_rows_open_competitions(boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.game_rows_open_competitions(boolean)', 'execute') then
    raise exception '0151: anon and authenticated must be able to execute game_rows_open_competitions';
  end if;
  if exists (select 1 from pg_class c, pg_options_to_table(c.reloptions) o
              where c.oid = 'public.game_rows_public'::regclass
                and o.option_name = 'security_invoker' and o.option_value in ('true', 'on', '1', 'yes')) then
    raise exception '0151: game_rows_public became security_invoker; it would read games through games'' own per-row policy';
  end if;
  select count(*) into n
    from pg_class c
    join pg_roles o on o.oid = c.relowner
   where c.oid in ('public.games'::regclass, 'public.competitions'::regclass,
                   'public.seasons'::regclass, 'public.leagues'::regclass)
     and c.relforcerowsecurity and not o.rolbypassrls;
  if n > 0 or (select relowner from pg_class where oid = 'public.game_rows_public'::regclass)
              <> (select relowner from pg_class where oid = 'public.games'::regclass) then
    raise exception '0151: the fast path would not read games, competitions, seasons and leagues past their policies (owner differs, or row security is forced on % of them)', n;
  end if;

  /* One public finished game, a fixture of the same league that has not been
     played, and a live game in a league that does not publish live, each with
     a row in all five tables; read through the tables signed out and by the
     live game's official. Rolled back like the proof. */
  begin
    insert into public.leagues (slug, name) values ('zz-t0151-smoke', 'T0151 Smoke') returning id into s_league;
    insert into public.seasons (league_id, name) values (s_league, 'T0151') returning id into gid;
    insert into public.competitions (season_id, name) values (gid, 'T0151 League') returning id into s_comp;
    insert into public.teams (league_id, slug, name)
    values (s_league, 'zz-t0151-smoke-h', 'T0151 smoke home') returning id into s_home;
    insert into public.teams (league_id, slug, name)
    values (s_league, 'zz-t0151-smoke-a', 'T0151 smoke away') returning id into s_away;
    fx := '{}'::jsonb;
    foreach st in array array['final', 'scheduled', 'live'] loop
      insert into public.games (competition_id, home_team_id, away_team_id, tipoff_at, status)
      values (s_comp, s_home, s_away, now(), 'live')
      returning id into gid;
      fx := fx || jsonb_build_object(st, gid);
      insert into public.game_events (game_id, seq, t, team, period, clock) values (gid, 1, 'p2_made', 0, 1, 500000);
      insert into public.game_state (game_id) values (gid);
      insert into public.player_game_stats (game_id, player_id, team_idx, stats) values (gid, 't0151', 0, '{}'::jsonb);
      insert into public.team_game_stats (game_id, team_idx, stats) values (gid, 0, '{}'::jsonb);
      insert into public.lineup_stints (game_id, team_idx, player_ids, stats) values (gid, 0, array['t0151'], '{}'::jsonb);
    end loop;
    update public.games set status = 'final'     where id = (fx ->> 'final')::uuid;
    update public.games set status = 'scheduled' where id = (fx ->> 'scheduled')::uuid;
    gid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            't0151-smoke@example.invalid', '', now(), now(), now());
    insert into public.game_officials (game_id, user_id, role) values ((fx ->> 'live')::uuid, gid, 'statistician');

    for r in select * from (values ('anon', 'anon', 'final', 1), ('anon', 'anon', 'scheduled', 0),
                                   ('anon', 'anon', 'live', 0),
                                   ('official', 'authenticated', 'final', 1),
                                   ('official', 'authenticated', 'scheduled', 0),
                                   ('official', 'authenticated', 'live', 1)) v(label, rl, st, want)
    loop
      if r.label = 'anon' then
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      else
        perform set_config('request.jwt.claims', json_build_object('sub', gid, 'role', 'authenticated')::text, true);
      end if;
      execute format('set local role %I', r.rl);
      bad := null;
      foreach k in array tables loop
        execute format('select count(*) from public.%I where game_id = $1', k) into n using (fx ->> r.st)::uuid;
        if n <> r.want then bad := concat_ws(', ', bad, k || '=' || n); end if;
      end loop;
      execute format('set local role %I', orig);
      perform set_config('request.jwt.claims', '', true);
      if bad is not null then
        raise exception '0151: after the swap, as %, the % game reads % (each table should give %)',
          r.label, r.st, bad, r.want;
      end if;
    end loop;

    raise exception using errcode = 'P0151', message = '0151 smoke test passed; rolling it back';
  exception
    when sqlstate 'P0151' then null;
    when others then raise exception '% [0151 smoke test after the swap, ran as %]', sqlerrm, who;
  end;

  raise notice '0151 ok: fast path proved sound against can_read_game_rows on % games (plus % fixture games) in 22 passes, and the five read policies swapped [ran as %]',
    cardinality(ids) - cardinality(fx_ids), cardinality(fx_ids), who;
end $mig$;
