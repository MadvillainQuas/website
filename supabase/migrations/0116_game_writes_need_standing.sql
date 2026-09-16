-- ============================================================================
-- 0116 — WHO MAY CHANGE A GAME, ASKED AGAIN WHERE IT HAD STOPPED BEING ASKED.
--
-- Found beside a hole in finalise-game, which is fixed in the function in the
-- same change: it authorised reopen and finalise with "can the caller SEE this
-- game", and every scheduled and final game is public (0005), so a fan's
-- account could reopen any final game and have its box score deleted by the
-- service role. Two places in the database had stopped asking the right
-- question too.
--
-- 1. recompute_standings LOST ITS GUARD.
--
--    0074 prepended recompute_standings_guard to the body that shipped then.
--    0086 replaced the whole body with 0045's, lifted verbatim, plus the lock
--    — and 0045's body is older than the guard, so the guard went with it.
--    Since 0086 any signed-in account can delete and rebuild any
--    competition's table. The console audit did not notice because it accepted
--    0074's wrap without asking whether a later migration had replaced what was
--    wrapped; it now asks.
--
--    The body below is 0086's, generated from that file rather than typed,
--    with the guard as its first statement: before the lock, so a refused
--    caller never queues behind a real recompute or holds one up.
--
-- 2. games_update CHECKS WHO, NEVER WHAT.
--
--    0068 left the policy as `using (may_score_game(id) or league admin)
--    with check (true)`, so everyone who may score a game may write ANY column
--    of it through the API: status 'final' with no box score behind it, a
--    score of their choosing, finalised_at, the clubs, another competition —
--    including one in a league they have nothing to do with, because the
--    check clause never looked at the row being written. None of it is
--    audited, and none of it goes through the functions built to do those
--    things properly.
--
--    WHO WRITES THE ROW DIRECTLY (every games update and PATCH in the clients,
--    read on 2026-09-16):
--
--      scorer  claimFixture      status scheduled -> live, roster_snapshot,
--                                starters, period, tip_winner, arrow_init
--      scorer  primeFixture      roster_snapshot, starters
--      scorer  sync maybeScore   home_score, away_score, only where status = live
--      console importer          roster_snapshot, starters, status -> live
--      console, game page        competition_id, tie_id, leg — moving a game
--                                between phases, offered on can_manage_game
--
--    Everything else reaches the row through a SECURITY DEFINER function
--    (revert_game, set_game_status, upsert_fixture, delete_fixture,
--    set_match_details, arm_broadcast, the bracket functions) or through
--    finalise-game and the ingest worker, holding the service role.
--
--    SO THE GUARD IS A TRIGGER THAT JUDGES ONLY THE API ROLES. A definer
--    function runs as its owner and the edge functions as service_role, so
--    current_user is 'authenticated' only for a write that came straight from
--    a client — which is exactly the write no function is checking. For those:
--
--      never             id, created_by, created_at, the two clubs,
--                        finalised_at and finalised_by, reverted_at (except
--                        the clear that going live does, 0068's own trigger)
--      status            unchanged, or scheduled -> live. final and finalising
--                        are finalise-game's; void and scheduled belong to
--                        set_game_status and revert_game
--      the score         only while the game is live and stays live
--      scoring inputs    roster, starters, tip, arrow, period: only while the
--                        game is scheduled or live
--      moving a game     competition, tie, leg, tip-off: can_manage_game, and
--                        the competition it moves INTO must be one the caller
--                        administers
--
--    venue, venue_address, capacity, attendance, officials and broadcast_until
--    are left alone: set_match_details and arm_broadcast already give them to
--    the same people, and none of them is a result.
--
--    WHAT THIS REFUSES THAT USED TO "WORK". Importing over a FINAL game from
--    the console: the importer wrote status 'live' straight onto the row, its
--    event delete matched nothing (a final game takes no event writes), and the
--    insert then collided with the old log — leaving a final game marked live
--    with its old box score still standing. It is now refused before anything
--    is touched. A final game is reopened through finalise-game.
-- ============================================================================


-- ============================================================================
-- 1. recompute_standings, guarded again
-- ============================================================================

-- what this migration found, so the push log records whether the hole was real
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_standings';
  raise notice '0116: recompute_standings as found: %',
    case when src is null then 'missing'
         when position('recompute_standings_guard' in src) > 0 then 'guarded'
         else 'NOT guarded — any signed-in account could rebuild any table' end;
end $$;

create or replace function public.recompute_standings(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r_win  int;
  r_loss int;
begin
  /* THE GUARD 0074 PUT HERE AND 0086 LOST (see 0116). Before the lock, so a
     refused caller never queues behind a real recompute. A null uid is the
     service role — finalise-game at the final whistle — and nothing else can
     reach this function without one, since anon is revoked. */
  if not public.recompute_standings_guard(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  /* ONE RECOMPUTE PER COMPETITION AT A TIME — the only line added to this
     function. Everything below it is 0045's, unchanged.

     Taken before anything is read, so the entire read-modify-write is inside
     it. Taken after the select, it would leave open the exact window it exists
     to close.

     Transaction-scoped, not session-scoped: it is released when the
     transaction ends, including when it fails. Every Supabase client talks
     through a connection pool, so a leaked session lock would be inherited by
     whichever request picked up that connection next and would lock a
     competition out for the rest of its life.

     hashtextextended turns the uuid into the 64-bit key the single-argument
     form wants. Two different competitions colliding on a key is possible and
     harmless: the consequence is that two unrelated recomputes take turns,
     which is what they would do anyway if they shared a competition. */
  perform pg_advisory_xact_lock(hashtextextended(p_competition::text, 0));

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
    select g.home_team_id as team_id, g.home_score as pf, g.away_score as pa,
           g.tipoff_at, g.id
      from games g where g.competition_id = p_competition and g.status = 'final'
    union all
    select g.away_team_id, g.away_score, g.home_score, g.tipoff_at, g.id
      from games g where g.competition_id = p_competition and g.status = 'final'
  ),
  agg as (
    select team_id,
           count(*)::int            as gp,
           sum((pf > pa)::int)::int as w,
           sum((pf < pa)::int)::int as l,
           sum(pf)::int             as pts_for,
           sum(pa)::int             as pts_against,
           sum((pf > pa)::int) * r_win + sum((pf < pa)::int) * r_loss as league_points
      from played group by team_id
  ),
  ordered as (
    select team_id, (pf > pa) as won,
           row_number() over (partition by team_id
                              order by tipoff_at desc nulls last, id desc) as rn
      from played
  ),
  last_res as (select team_id, won from ordered where rn = 1),
  first_diff as (
    select o.team_id, min(o.rn) as rn
      from ordered o join last_res l using (team_id)
     where o.won is distinct from l.won
     group by o.team_id
  ),
  totals as (select team_id, count(*)::int as n from ordered group by team_id),
  streaks as (
    select l.team_id,
           (case when l.won then 'W' else 'L' end)
           || coalesce(f.rn - 1, t.n)::text as streak
      from last_res l
      join totals t using (team_id)
      left join first_diff f using (team_id)
  )
  insert into standings (competition_id, team_id, gp, w, l, pts_for, pts_against,
                         league_points, streak, group_name, updated_at)
  select p_competition, a.team_id, a.gp, a.w, a.l, a.pts_for, a.pts_against,
         a.league_points, coalesce(s.streak, ''), ct.group_name, now()
    from agg a
    left join streaks s on s.team_id = a.team_id
    left join competition_teams ct
           on ct.competition_id = p_competition and ct.team_id = a.team_id;

  insert into standings (competition_id, team_id, group_name, updated_at)
  select p_competition, ct.team_id, ct.group_name, now()
    from competition_teams ct
   where ct.competition_id = p_competition
     and not exists (select 1 from standings st
                      where st.competition_id = p_competition and st.team_id = ct.team_id);

  -- ---- the sanctions -------------------------------------------------------
  with docked as (
    select team_id,
           sum(points)::int as pts,
           sum(wins)::int   as wns
      from team_sanctions
     where competition_id = p_competition
     group by team_id
  )
  update standings st
     set deducted_points = d.pts,
         deducted_wins   = d.wns,
         league_points   = st.league_points - d.pts,
         /* Docking a win converts it to a loss rather than deleting the game:
            games played must still equal W + L or every percentage on every
            page derived from this row goes wrong. */
         w = greatest(0, st.w - d.wns),
         l = st.l + least(st.w, d.wns)
    from docked d
   where st.competition_id = p_competition and st.team_id = d.team_id;

  with ranked as (
    select team_id, row_number() over (
             partition by group_name
             order by league_points desc, (pts_for - pts_against) desc, pts_for desc
           ) as rk
      from standings where competition_id = p_competition
  )
  update standings st set rank = r.rk
    from ranked r
   where st.competition_id = p_competition and st.team_id = r.team_id;
end; $$;

alter function public.recompute_standings(uuid) owner to postgres;
revoke all on function public.recompute_standings(uuid) from public, anon;
grant execute on function public.recompute_standings(uuid) to authenticated, service_role;


-- ============================================================================
-- 2. the games row: what a client may write directly
-- ============================================================================

create or replace function public.games_write_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  /* ONLY A WRITE STRAIGHT FROM A CLIENT IS JUDGED HERE.

     SECURITY INVOKER on purpose, because current_user is the whole test: a
     SECURITY DEFINER function updating games runs as its owner, finalise-game
     and the ingest worker as service_role, a migration as postgres. Only a
     request PostgREST passed through with a user's token is 'authenticated'.
     Made definer, this function would itself run as its owner and could no
     longer tell the two apart. */
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a game''s id, creator and creation time do not change'
      using errcode = '42501';
  end if;

  if new.home_team_id is distinct from old.home_team_id
     or new.away_team_id is distinct from old.away_team_id then
    raise exception 'the clubs in a fixture are changed with upsert_fixture, '
                    'which refuses to change them once the game is played'
      using errcode = '42501';
  end if;

  if new.finalised_at is distinct from old.finalised_at
     or new.finalised_by is distinct from old.finalised_by then
    raise exception 'only finalise-game marks a game finalised'
      using errcode = '42501';
  end if;

  /* games_clear_reverted (0068) nulls reverted_at when a game goes live, and
     fires before this one (triggers run in name order). That is the only
     change to it a client's write may carry: clearing it WITHOUT going live
     would reopen a reverted fixture to a scorer tab left open on it. */
  if new.reverted_at is distinct from old.reverted_at
     and not (new.reverted_at is null and new.status = 'live') then
    raise exception 'a reverted fixture comes back by going live, not by clearing reverted_at'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'scheduled' and new.status = 'live') then
    raise exception 'a game does not go from % to % by writing its row: finalise-game '
                    'finalises and reopens, set_game_status voids and reinstates, '
                    'revert_game puts it back on the listing', old.status, new.status
      using errcode = '42501';
  end if;

  /* sync.js mirrors the running score onto the row for readers who are not on
     the realtime channel, and scopes its own write to status = live. A result
     is never this column: it is the event log, replayed by finalise-game. */
  if (new.home_score is distinct from old.home_score
      or new.away_score is distinct from old.away_score)
     and not (old.status = 'live' and new.status = 'live') then
    raise exception 'the score of a % game is not written directly — a result '
                    'comes from its event log, through finalise-game', old.status
      using errcode = '42501';
  end if;

  if (new.roster_snapshot is distinct from old.roster_snapshot
      or new.starters is distinct from old.starters
      or new.tip_winner is distinct from old.tip_winner
      or new.arrow_init is distinct from old.arrow_init
      or new.period is distinct from old.period)
     and old.status not in ('scheduled', 'live') then
    raise exception 'a % game''s roster, starters and tip-off are fixed — '
                    'it has to be reopened first', old.status
      using errcode = '42501';
  end if;

  /* Moving a game between phases is a real move — it changes two tables — and
     the console and the game page only offer it on can_manage_game. The policy
     let anyone who may SCORE the game do it, and its with check (true) never
     asked where the game was going. */
  if new.competition_id is distinct from old.competition_id
     or new.tie_id is distinct from old.tie_id
     or new.leg is distinct from old.leg
     or new.tipoff_at is distinct from old.tipoff_at then
    if not public.can_manage_game(old.id) then
      raise exception 'only an administrator of this game may move it or change its tip-off'
        using errcode = '42501';
    end if;
    if new.competition_id is distinct from old.competition_id then
      if new.competition_id is null then
        if not public.is_platform_admin() then
          raise exception 'only a platform administrator may take a game out of its competition'
            using errcode = '42501';
        end if;
      elsif not public.is_competition_admin(new.competition_id) then
        raise exception 'you do not administer the competition you are moving this game into'
          using errcode = '42501';
      end if;
    end if;
    if new.tie_id is not null and new.tie_id is distinct from old.tie_id
       and not exists (select 1 from bracket_ties t
                        where t.id = new.tie_id
                          and t.competition_id is not distinct from new.competition_id) then
      raise exception 'that tie belongs to another competition'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

alter function public.games_write_guard() owner to postgres;

comment on function public.games_write_guard() is
  'What a client may write straight onto a games row, whoever the update policy '
  'let through: the scorer''s tip-off and live-score writes and an administrator''s '
  'move between competitions. Status, result, finalisation and the clubs go '
  'through their functions. Judges only the authenticated and anon roles, so '
  'SECURITY DEFINER functions and the service role are unaffected. See 0116.';

drop trigger if exists games_write_guard on public.games;
create trigger games_write_guard before update on public.games
  for each row execute function public.games_write_guard();


-- ============================================================================
-- SELF-TEST 1 — recompute_standings refuses a stranger, keeps its callers.
--
-- The 0115 pattern: every call happens inside a block that always ends by
-- raising a private code its own handler swallows, so the rebuilt tables, the
-- SET LOCAL ROLE and the forged claims all roll back together without needing
-- RESET ROLE (which, under the CLI's temporary login role, lands on a role that
-- may not touch these tables). Any other error fails the migration.
-- ============================================================================
do $test$
declare
  src      text;
  comp     uuid;
  stranger uuid := gen_random_uuid();       -- signed in, and nothing else
  padmin   uuid;
  member   uuid;
  who      text := current_user || ' (session ' || session_user || ')';
begin
  select p.prosrc into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_standings';

  if position('recompute_standings_guard' in src) = 0 then
    raise exception '0116: recompute_standings still has no guard';
  end if;
  /* the landmarks of 0086's body: if either is gone, an older body was copied
     and the guard came back at the price of the lock or the sanctions */
  if position('pg_advisory_xact_lock' in src) = 0 then
    raise exception '0116: the guard is back but 0086''s lock is gone';
  end if;
  if position('team_sanctions' in src) = 0 then
    raise exception '0116: the sanctions pass is gone — this is not 0086''s body';
  end if;
  if position('recompute_standings_guard' in src) > position('pg_advisory_xact_lock' in src) then
    raise exception '0116: the guard runs after the lock, so a refused caller still queues';
  end if;
  if position('pg_advisory_xact_lock' in src) > position('delete from standings' in src) then
    raise exception '0116: the lock is taken after the write it protects';
  end if;
  if has_function_privilege('anon', 'public.recompute_standings(uuid)', 'execute') then
    raise exception '0116: anon can execute recompute_standings';
  end if;
  if not has_function_privilege('authenticated', 'public.recompute_standings(uuid)', 'execute') then
    raise exception '0116: a league administrator can no longer recompute';
  end if;

  /* the competition with the fewest games, and none being finalised, so the
     rebuild inside the block is quick and waits on nobody's lock */
  select c.id into comp from public.competitions c
   order by (select count(*) from public.games g
              where g.competition_id = c.id and g.status in ('live', 'finalising')),
            (select count(*) from public.games g where g.competition_id = c.id)
   limit 1;
  select m.user_id into padmin from public.memberships m where m.role = 'platform_admin' limit 1;
  /* somebody real who holds a role but administers nothing: a statistician,
     a club manager, a writer */
  select m.user_id into member from public.memberships m
   where not exists (select 1 from public.memberships a
                      where a.user_id = m.user_id and a.role in ('platform_admin', 'league_admin'))
   limit 1;

  if comp is null then
    raise notice '0116: no competition to recompute; recompute_standings checked by source only';
    return;
  end if;

  begin
    -- the service role, as finalise-game calls it: no claims, no uid
    perform public.recompute_standings(comp);

    set local role authenticated;

    perform set_config('request.jwt.claims',
      json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    begin
      perform public.recompute_standings(comp);
      raise exception '0116: a signed-in stranger rebuilt a competition''s table';
    exception when insufficient_privilege then null;
    end;

    if member is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', member, 'role', 'authenticated')::text, true);
      begin
        perform public.recompute_standings(comp);
        raise exception '0116: a member who administers nothing rebuilt a competition''s table';
      exception when insufficient_privilege then null;
      end;
    end if;

    if padmin is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', padmin, 'role', 'authenticated')::text, true);
      perform public.recompute_standings(comp);        -- must not raise
    end if;

    raise exception using errcode = 'P0116', message = '0116 recompute passed; rolling back';
  exception
    when sqlstate 'P0116' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  raise notice '0116 ok: recompute_standings refuses a stranger%, keeps the service role%',
    case when member is not null then ' and a non-administrator' else '' end,
    case when padmin is not null then ' and a platform administrator' else '' end;
end $test$;


-- ============================================================================
-- SELF-TEST 2 — the games row, written the way each client writes it.
--
-- Seeded with the migration's own rights BEFORE the role switch: two real
-- clubs, never-committed games, and a real account (one that administers
-- nothing) put on them as the official — the shape of a statistician. Then the
-- scorer's own writes must pass, everything the policy used to let through
-- must be refused, and even a platform administrator may not write a result
-- onto the row, because this is not a question of rank.
-- ============================================================================
do $test$
declare
  padmin    uuid;
  official  uuid;
  stranger  uuid := gen_random_uuid();
  ladmin    uuid;  own_comp uuid;  foreign_comp uuid;
  c1 uuid;  c2 uuid;  home uuid;  away uuid;
  g_live uuid;  g_final uuid;  g_rev uuid;  g_adhoc uuid;  g_move uuid;
  stmt text;  n int;  res text;
  who  text := current_user || ' (session ' || session_user || ')';
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.games'::regclass
                    and tgname = 'games_write_guard' and not tgisinternal
                    and tgenabled <> 'D') then
    raise exception '0116: games_write_guard is not installed and enabled on games';
  end if;

  select m.user_id into padmin from public.memberships m where m.role = 'platform_admin' limit 1;
  select m.user_id into official from public.memberships m
   where not exists (select 1 from public.memberships a
                      where a.user_id = m.user_id and a.role in ('platform_admin', 'league_admin'))
   limit 1;
  select t.id into home from public.teams t order by t.created_at limit 1;
  select t.id into away from public.teams t where t.id <> home order by t.created_at limit 1;
  select c.id into c1 from public.competitions c order by c.id limit 1;
  select c.id into c2 from public.competitions c where c.id <> c1 order by c.id limit 1;

  /* a league administrator who is not a platform administrator, a competition
     of theirs, and one in a league that is not */
  select m.user_id, c.id into ladmin, own_comp
    from public.memberships m
    join public.seasons s on s.league_id = m.scope_id
    join public.competitions c on c.season_id = s.id
   where m.role = 'league_admin' and m.scope_type = 'league'
     and not exists (select 1 from public.memberships p
                      where p.user_id = m.user_id and p.role = 'platform_admin')
   limit 1;
  if ladmin is not null then
    select c.id into foreign_comp
      from public.competitions c join public.seasons s on s.id = c.season_id
     where not exists (select 1 from public.memberships m
                        where m.user_id = ladmin and m.role = 'league_admin'
                          and m.scope_type = 'league' and m.scope_id = s.league_id)
     limit 1;
  end if;

  if padmin is null or official is null or away is null then
    raise notice '0116: no platform admin, no ordinary member or fewer than two clubs; '
                 'games_write_guard installed but not exercised';
    return;
  end if;

  begin
    -- -------------------------------------------------------------- seed ---
    insert into public.games (competition_id, home_team_id, away_team_id, status, home_score, away_score)
    values (c1, home, away, 'live', 10, 8) returning id into g_live;
    insert into public.games (home_team_id, away_team_id, status, home_score, away_score)
    values (home, away, 'final', 70, 64) returning id into g_final;
    insert into public.games (home_team_id, away_team_id, status, reverted_at)
    values (home, away, 'scheduled', now()) returning id into g_rev;
    insert into public.games (home_team_id, away_team_id, status)
    values (home, away, 'scheduled') returning id into g_adhoc;
    insert into public.game_officials (game_id, user_id)
    values (g_live, official), (g_final, official), (g_rev, official);
    if own_comp is not null and foreign_comp is not null then
      insert into public.games (competition_id, home_team_id, away_team_id, status)
      values (own_comp, home, away, 'scheduled') returning id into g_move;
    end if;

    -- ------------------------------------------ the migration is not judged ---
    update public.games set home_score = 11 where id = g_final;

    set local role authenticated;

    -- ================================================= as the official ====
    perform set_config('request.jwt.claims',
      json_build_object('sub', official, 'role', 'authenticated')::text, true);

    -- the test proves nothing unless this really is a scorer and not a manager
    if not public.may_score_game(g_live) or public.can_manage_game(g_live) then
      raise exception '0116: the seeded official is not a plain scorer of the test game — the test is wrong';
    end if;

    -- WHAT THE SCORER WRITES STILL LANDS
    update public.games set status = 'live', roster_snapshot = '{"teams":[]}'::jsonb,
                            starters = '[[],[]]'::jsonb, period = 2, tip_winner = 0, arrow_init = 1
     where id = g_live;                                              -- claimFixture
    get diagnostics n = row_count;
    if n <> 1 then raise exception '0116: the scorer''s tip-off write matched % rows', n; end if;

    update public.games set home_score = 12, away_score = 8
     where id = g_live and status = 'live';                          -- sync.js maybeScore
    get diagnostics n = row_count;
    if n <> 1 then raise exception '0116: the live score mirror matched % rows', n; end if;

    -- EVERYTHING THE POLICY USED TO LET THROUGH IS REFUSED
    foreach stmt in array array[
      format('update public.games set status = %L where id = %L', 'final', g_live),
      format('update public.games set status = %L where id = %L', 'finalising', g_live),
      format('update public.games set status = %L where id = %L', 'void', g_live),
      format('update public.games set status = %L where id = %L', 'scheduled', g_live),
      format('update public.games set finalised_at = now() where id = %L', g_live),
      format('update public.games set finalised_by = %L where id = %L', official, g_live),
      format('update public.games set created_by = %L where id = %L', official, g_live),
      format('update public.games set home_team_id = away_team_id, away_team_id = home_team_id where id = %L', g_live),
      format('update public.games set tipoff_at = now() where id = %L', g_live),
      format('update public.games set leg = 1 where id = %L', g_live),
      /* always a CHANGE: with one competition there is nowhere real to move it,
         and the guard refuses before the foreign key is ever checked */
      format('update public.games set competition_id = %L where id = %L', coalesce(c2, gen_random_uuid()), g_live),
      -- the final game: reopening it, rescoring it, rewriting who played
      format('update public.games set status = %L where id = %L', 'live', g_final),
      format('update public.games set home_score = 99 where id = %L', g_final),
      format('update public.games set roster_snapshot = %L::jsonb where id = %L', '{}', g_final),
      format('update public.games set period = 5 where id = %L', g_final),
      -- un-reverting without re-claiming
      format('update public.games set reverted_at = null where id = %L', g_rev)
    ] loop
      begin
        execute stmt;
        get diagnostics n = row_count;
        raise exception '0116: % — %',
          case when n = 0 then 'matched no rows, so the guard was never reached'
               else 'ALLOWED through the API' end, stmt;
      exception when insufficient_privilege then null;
      end;
    end loop;

    -- ...but re-claiming a reverted fixture still works, and clears the stamp
    update public.games set status = 'live', roster_snapshot = '{"teams":[]}'::jsonb,
                            starters = '[[],[]]'::jsonb
     where id = g_rev;
    get diagnostics n = row_count;
    if n <> 1 then raise exception '0116: re-claiming a reverted fixture matched % rows', n; end if;
    if (select reverted_at from public.games where id = g_rev) is not null then
      raise exception '0116: re-claiming did not clear reverted_at';
    end if;

    if (select status from public.games where id = g_live) <> 'live'
       or (select home_score from public.games where id = g_final) <> 11 then
      raise exception '0116: a refused write left something behind';
    end if;

    -- ================================================= as a stranger ======
    /* finalise-game's own question, answered for a fan: the final game is
       public, so the old check (can the caller see it) passed. The new one
       must not. */
    perform set_config('request.jwt.claims',
      json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    if not exists (select 1 from public.games where id = g_final) then
      raise exception '0116: a final game is not public — the finalise-game hole this guards against cannot be reproduced';
    end if;
    if public.may_score_game(g_final) or public.can_manage_game(g_final) then
      raise exception '0116: a signed-in stranger may score or manage a public final game';
    end if;

    -- ========================================= as a league administrator ====
    if g_move is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', ladmin, 'role', 'authenticated')::text, true);
      begin
        update public.games set competition_id = foreign_comp where id = g_move;
        get diagnostics n = row_count;
        raise exception '0116: a league administrator moved a game into another league''s competition (% rows)', n;
      exception when insufficient_privilege then null;
      end;
    end if;

    -- ========================================= as a platform administrator ====
    perform set_config('request.jwt.claims',
      json_build_object('sub', padmin, 'role', 'authenticated')::text, true);

    begin
      update public.games set status = 'final' where id = g_live;
      raise exception '0116: a platform administrator wrote final straight onto a game';
    exception when insufficient_privilege then null;
    end;

    if c2 is not null then
      update public.games set competition_id = c2, tie_id = null, leg = null where id = g_live;
      get diagnostics n = row_count;
      if n <> 1 or (select competition_id from public.games where id = g_live) <> c2 then
        raise exception '0116: an administrator could not move a game between competitions';
      end if;
    end if;

    -- a SECURITY DEFINER function runs as its owner and is not judged
    res := public.set_game_status(g_adhoc, 'void');
    if (select status from public.games where id = g_adhoc) <> 'void' then
      raise exception '0116: set_game_status could not void a game through the guard (%)', res;
    end if;

    raise exception using errcode = 'P0116', message = '0116 games guard passed; rolling back';
  exception
    when sqlstate 'P0116' then
      null;
    when others then
      raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from public.games where id in (g_live, g_final, g_rev, g_adhoc, g_move)) then
    raise exception '0116: the test games outlived their rollback';
  end if;

  raise notice '0116 ok: the scorer''s writes land, results/status/clubs/moves are refused through the API '
               '(platform admin included), a reverted fixture re-claims, definer functions pass%',
    case when g_move is not null then ', a league admin cannot move a game into another league'
         else ' (no league admin to test a cross-league move)' end;
end $test$;
