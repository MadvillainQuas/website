-- ============================================================================
-- TWO GAMES IN ONE COMPETITION FINISHING AT THE SAME MOMENT.
--
-- Saturday teatime is not an edge case. It is the normal shape of a league:
-- six fixtures start at three, finish within twenty minutes of one another,
-- six statisticians press "end game", and six finalise-game invocations call
-- recompute_standings for the same competition at once.
--
-- recompute_standings is DELETE-then-INSERT across the whole table for that
-- competition. Run two concurrently and the second one's reads can be planned
-- against a snapshot taken before the first one's game was marked final. Both
-- delete. Both insert. Whichever commits last wins, and its version of the
-- table is missing the other game.
--
-- NOTHING FAILS. No error, no orphan, no constraint violated. The league table
-- is simply wrong by one result, at exactly the moment every club in the
-- league is refreshing it, and it stays wrong until the next game finishes or
-- somebody recomputes by hand. That is the worst class of bug this platform
-- can have: a number displayed with confidence and quietly false.
--
-- THE FIX IS A LOCK PER COMPETITION, NOT A LOCK. Two recomputes of the SAME
-- competition queue, so the second reads a world in which the first has
-- committed. Recomputes of DIFFERENT competitions never meet — which matters,
-- because Saturday's six games are usually spread across several divisions and
-- serialising all of them would trade a correctness bug for a queue.
--
-- WHY NOT A UNIQUE CONSTRAINT OR AN UPSERT. Because the bug is not duplicate
-- rows. It is a stale read: both writers agree about the shape of the table
-- and disagree about the world. Only ordering them fixes that.
--
-- THE BODY BELOW IS 0045's, LIFTED VERBATIM. One line is added and nothing
-- else is touched — not a column, not the streak algorithm, not the sanctions
-- pass. This file was first written by retyping that function from memory, and
-- the retyped version had different column names, a different streak and no
-- sanctions at all. A hand copy of a league table's arithmetic is a hand copy
-- of every club's season, so it is generated rather than typed.
-- ============================================================================

create or replace function public.recompute_standings(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r_win  int;
  r_loss int;
begin
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

-- ============================================================================
-- SELF-TEST — the lock is there, it is before the write, and it is per
-- competition rather than global.
-- ============================================================================
do $test$
declare
  cid       uuid;
  other     uuid;
  got_own   boolean;
  got_other boolean;
  src       text;
begin
  select prosrc into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_standings';

  if src is null or position('pg_advisory_xact_lock' in src) = 0 then
    raise exception '0086: recompute_standings is not serialised';
  end if;
  /* position() returns 0 for "not found", not null — so if the delete were
     ever renamed or reformatted, the comparison below would read as
     "lock is after 0", raise, and blame the lock for the delete having moved.
     A missing landmark is its own failure and is reported as itself. */
  if position('delete from standings' in src) = 0 then
    raise exception '0086: cannot find the delete this lock is meant to protect '
                    '— recompute_standings has been rewritten';
  end if;
  if position('pg_advisory_xact_lock' in src) > position('delete from standings' in src) then
    raise exception '0086: the lock is taken after the write it protects';
  end if;

  /* Two DIFFERENT competitions must not block one another, or Saturday's six
     games queue behind each other for nothing. Proved by taking both keys in
     this one transaction: a shared key would refuse the second. */
  other := gen_random_uuid();
  select id into cid from public.competitions limit 1;
  if cid is null then
    raise notice '0086 ok: serialised (no competitions to exercise it against)';
    return;
  end if;

  got_own   := pg_try_advisory_xact_lock(hashtextextended(cid::text, 0));
  got_other := pg_try_advisory_xact_lock(hashtextextended(other::text, 0));
  if not got_own or not got_other then
    raise exception '0086: two competitions are sharing one lock key';
  end if;

  /* And it still runs. A lock that deadlocks with itself would pass every
     check above and hang here. */
  perform public.recompute_standings(cid);

  raise notice '0086 ok: one recompute per competition at a time, different '
               'competitions still side by side, and the table still rebuilds';
end $test$;
