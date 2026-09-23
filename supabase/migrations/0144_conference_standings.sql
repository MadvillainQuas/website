-- ============================================================================
-- 0144 — CONFERENCE STANDINGS: the complete schedule and the conference-only
-- record, side by side, the way a college table prints them.
--
-- WHY. U SPORTS (and, later, NCAA) is not one league table. Forty-eight
-- universities play in four conferences — Canada West, OUA, RSEQ, AUS — and
-- two of those split again into divisions (Canada West Pacific / Prairie, OUA
-- Central / East / West). A club's standing is read inside its own conference, and it is two
-- records, not one:
--
--   OVERALL     every counted game it played, conference or not
--   CONFERENCE  only the games against members of its own conference
--
-- ordered by the conference record, because that is what decides seeding.
--
-- WHAT THIS ADDS, and why each piece lives where it does:
--
--   competitions.format 'conferences'   the table is split by conference and
--        ranked by the conference record. Every other format ranks exactly as
--        before — the self-test below holds every existing table to that.
--   competition_teams.group_name        already there (0018): the conference.
--   competition_teams.division_name     NEW: the division inside it. Like the
--        group, a property of a club's ENTRY, not of the club.
--   games.conference_game               NEW, nullable. null = work it out
--        (both sides entered under the same group_name). true / false = the
--        feed or an administrator knows better — a conference PLAYOFF is two
--        members of the same conference and is not a conference game.
--   standings.conf_gp / conf_w / conf_l / conf_pts_for / conf_pts_against,
--        standings.division_name        NEW, derived like every other column
--        here: drop the rows and recompute_standings rebuilds them.
--
-- recompute_standings and games_write_guard are replaced. Both bodies are
-- 0116's, lifted from that file by a generator rather than typed (the trap
-- 0086 fell into was an older body typed back in, which silently dropped
-- 0074's guard), with only the 0144 blocks added. Self-test 3 at the end proves
-- the landmarks are all still there.
-- ============================================================================

-- ---------------------------------------------------------------- columns ---
alter table public.competition_teams
  add column if not exists division_name text;

alter table public.games
  add column if not exists conference_game boolean;

comment on column public.games.conference_game is
  'Whether this game counts in the conference-only record (0144). null = derive: '
  'both sides entered in the competition under the same group_name. Set false for '
  'a conference playoff or a tournament meeting; true to count a game the groups '
  'would not. Changing it needs can_manage_game (games_write_guard).';

alter table public.standings
  add column if not exists division_name   text,
  add column if not exists conf_gp          int not null default 0,
  add column if not exists conf_w           int not null default 0,
  add column if not exists conf_l           int not null default 0,
  add column if not exists conf_pts_for     int not null default 0,
  add column if not exists conf_pts_against int not null default 0;

create index if not exists standings_comp_group_div_rank
  on public.standings (competition_id, group_name, division_name, rank);

-- ---------------------------------------------------------------- format ----
-- 'conferences'  tables per conference (group_name), divisions inside them,
--                ranked by the conference record, overall record alongside
alter table public.competitions drop constraint if exists competitions_format_ck;
alter table public.competitions
  add constraint competitions_format_ck
  check (format in ('table','groups','knockout','groups_knockout','conferences'));


-- ============================================================================
-- THE NEW BODY IS PROVED BEFORE IT REPLACES ANYTHING.
--
-- db push is not transactional (0140): a self-test that fails AFTER the
-- create-or-replace leaves the unproved function live. So the new body goes in
-- first as a session-temporary function, both tests below run against it, and
-- only then is public.recompute_standings replaced. A failure here leaves the
-- live functions exactly as they were; only the additive columns above remain,
-- and they are harmless on their own.
-- ============================================================================
-- the new body, temporary, proved below
create or replace function pg_temp.recompute_standings_0144(p_competition uuid)
returns void language plpgsql set search_path = public as $$
declare
  r_win  int;
  r_loss int;
  r_format text;   -- 0144: 'conferences' ranks by the conference record
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

  select c.format into r_format from competitions c where c.id = p_competition;

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

  -- ---- the conference record (0144) ---------------------------------------
  /* A CONFERENCE GAME IS A GAME BETWEEN TWO MEMBERS OF THE SAME CONFERENCE,
     unless somebody has said otherwise. games.conference_game is null for
     "work it out" — both sides entered in this competition under the same
     group_name — and true or false where the feed or an administrator knows
     better: a conference playoff is two members of the same conference and is
     not a conference game, and neither is a holiday tournament the two happen
     to meet in. The overall columns above stay the complete schedule; these
     are the conference-only record NCAA tables print beside it.

     Every competition gets them. For one without groups every team is in the
     null group, which is no conference, so they stay nought and nothing that
     reads the old columns sees a difference. */
  with entry as (
    select ct.team_id, ct.group_name
      from competition_teams ct where ct.competition_id = p_competition
  ),
  conf_games as (
    select g.home_team_id, g.away_team_id, g.home_score, g.away_score
      from games g
      left join entry h on h.team_id = g.home_team_id
      left join entry a on a.team_id = g.away_team_id
     where g.competition_id = p_competition and g.status = 'final'
       and coalesce(g.conference_game,
                    h.group_name is not null and h.group_name = a.group_name)
  ),
  conf_played as (
    select home_team_id as team_id, home_score as pf, away_score as pa from conf_games
    union all
    select away_team_id, away_score, home_score from conf_games
  ),
  conf_agg as (
    select team_id,
           count(*)::int            as gp,
           sum((pf > pa)::int)::int as w,
           sum((pf < pa)::int)::int as l,
           sum(pf)::int             as pts_for,
           sum(pa)::int             as pts_against
      from conf_played group by team_id
  )
  update standings st
     set conf_gp = c.gp, conf_w = c.w, conf_l = c.l,
         conf_pts_for = c.pts_for, conf_pts_against = c.pts_against
    from conf_agg c
   where st.competition_id = p_competition and st.team_id = c.team_id;

  /* the division a team plays in within its conference (OUA East / West) —
     a property of its entry, like the group, carried across the same way */
  update standings st
     set division_name = ct.division_name
    from competition_teams ct
   where st.competition_id = p_competition
     and ct.competition_id = p_competition and ct.team_id = st.team_id
     and ct.division_name is not null;

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

  /* RANK WITHIN THE GROUP — and within the division, where a conference has
     them. For every competition that is not 'conferences' the three leading
     keys are null on every row and the division is null, so the order is
     exactly the one this function always used (0144's self-test holds every
     existing table to that). A conference table is ordered the way NCAA
     tables are: conference winning percentage, then conference wins, then the
     overall record, then the old keys. A team yet to play a conference game
     sits on 0 and is ordered by its overall record among the others. */
  with ranked as (
    select team_id, row_number() over (
             partition by group_name, division_name
             order by
               case when r_format = 'conferences'
                    then coalesce(conf_w::numeric / nullif(conf_gp, 0), 0) end desc nulls last,
               case when r_format = 'conferences' then conf_w end desc nulls last,
               case when r_format = 'conferences'
                    then coalesce(w::numeric / nullif(gp, 0), 0) end desc nulls last,
               league_points desc, (pts_for - pts_against) desc, pts_for desc
           ) as rk
      from standings where competition_id = p_competition
  )
  update standings st set rank = r.rk
    from ranked r
   where st.competition_id = p_competition and st.team_id = r.team_id;
end; $$;


-- ============================================================================
-- SELF-TEST 1 — EVERY EXISTING TABLE COMES OUT EXACTLY AS IT DOES TODAY.
--
-- The live function (0116's) and the new one are run over the same rows, one
-- after the other, and compared. Not against whatever is stored: a table left
-- stale by an old failed recompute would otherwise fail this migration for
-- something it did not do. The whole block raises its own code at the end, so
-- every rebuilt table rolls back and the standings are left exactly as found.
--
-- Ranks are compared wherever a team's ordering keys are unique in its group;
-- two teams level on every key can legitimately come out either way round,
-- under either body.
-- ============================================================================
do $test$
declare
  c        record;
  v_n      int := 0;
  v_diff   int;
  v_detail text;
begin
  begin
    create temporary table _t0144_old (like public.standings) on commit drop;

    for c in select id from public.competitions order by id loop
      perform public.recompute_standings(c.id);
      delete from _t0144_old;
      insert into _t0144_old select * from public.standings where competition_id = c.id;

      perform pg_temp.recompute_standings_0144(c.id);
      v_n := v_n + 1;

      select count(*) into v_diff from (
        (select team_id, gp, w, l, pts_for, pts_against, league_points, streak,
                group_name, deducted_points, deducted_wins
           from _t0144_old
         except
         select team_id, gp, w, l, pts_for, pts_against, league_points, streak,
                group_name, deducted_points, deducted_wins
           from public.standings where competition_id = c.id)
        union all
        (select team_id, gp, w, l, pts_for, pts_against, league_points, streak,
                group_name, deducted_points, deducted_wins
           from public.standings where competition_id = c.id
         except
         select team_id, gp, w, l, pts_for, pts_against, league_points, streak,
                group_name, deducted_points, deducted_wins
           from _t0144_old)
      ) d;
      if v_diff > 0 then
        raise exception '0144: the new recompute_standings changes % row(s) of competition %',
          v_diff, c.id;
      end if;

      select string_agg(o.team_id::text || ' ' || o.rank || '->' || n.rank, ', ')
        into v_detail
        from _t0144_old o
        join public.standings n on n.competition_id = c.id and n.team_id = o.team_id
       where o.rank is distinct from n.rank
         and not exists (
           select 1 from _t0144_old x
            where x.team_id <> o.team_id
              and x.group_name is not distinct from o.group_name
              and x.league_points = o.league_points
              and x.pts_for - x.pts_against = o.pts_for - o.pts_against
              and x.pts_for = o.pts_for);
      if v_detail is not null then
        raise exception '0144: the new ranking reorders competition %: %', c.id, v_detail;
      end if;
    end loop;

    raise notice '0144: % competition(s) rebuilt identically by the live and the new body', v_n;
    raise exception 'rollback' using errcode = 'P0144';
  exception when sqlstate 'P0144' then
    null;
  end;
end $test$;


-- ============================================================================
-- SELF-TEST 2 — THE CONFERENCE ARITHMETIC, on a league made for the purpose
-- and rolled back with everything else in the block.
--
--   conference A: a1, a2         conference B: b1, b2 (both in division North)
--
--   g1  a1 80-70 a2   derived conference game
--   g2  a2 75-60 a1   derived conference game
--   g3  a1 90-50 b1   different conferences: overall only
--   g4  b1 70-65 b2   derived conference game
--   g5  a2 88-80 a1   conference_game = false (a playoff): overall only
--   g6  b2 v a1       not played (scheduled): counts nowhere
--
--   a1  overall 2-2 (g1 W, g2 L, g3 W, g5 L)  conference 1-1  140-145
--   a2  overall 2-1                            conference 1-1  145-140
--   b1  overall 1-1                            conference 1-0
--   b2  overall 0-1                            conference 0-1
--
--   A is level on the conference record, so the overall record decides it:
--   a2 (.667) above a1 (.500). In B, b1 above b2. Divisions carry through.
-- ============================================================================
do $test$
declare
  lg uuid; se uuid; co uuid;
  a1 uuid; a2 uuid; b1 uuid; b2 uuid;
  tag text := 'zz-0144-' || substr(md5(random()::text), 1, 8);
  r  record;
  n  int := 0;
begin
  begin
    insert into public.leagues (slug, name) values (tag, '0144 self-test') returning id into lg;
    insert into public.seasons (league_id, name) values (lg, '0144') returning id into se;
    insert into public.competitions (season_id, name, format)
         values (se, '0144 conferences', 'conferences') returning id into co;

    insert into public.teams (league_id, slug, name) values (lg, tag || '-a1', 'a1') returning id into a1;
    insert into public.teams (league_id, slug, name) values (lg, tag || '-a2', 'a2') returning id into a2;
    insert into public.teams (league_id, slug, name) values (lg, tag || '-b1', 'b1') returning id into b1;
    insert into public.teams (league_id, slug, name) values (lg, tag || '-b2', 'b2') returning id into b2;

    insert into public.competition_teams (competition_id, team_id, group_name, division_name) values
      (co, a1, 'A', null), (co, a2, 'A', null), (co, b1, 'B', 'North'), (co, b2, 'B', 'North');

    insert into public.games (competition_id, home_team_id, away_team_id, status, home_score, away_score,
                              tipoff_at, conference_game) values
      (co, a1, a2, 'final', 80, 70, now() - interval '6 days', null),
      (co, a2, a1, 'final', 75, 60, now() - interval '5 days', null),
      (co, a1, b1, 'final', 90, 50, now() - interval '4 days', null),
      (co, b1, b2, 'final', 70, 65, now() - interval '3 days', null),
      (co, a2, a1, 'final', 88, 80, now() - interval '2 days', false),
      (co, b2, a1, 'scheduled', 0, 0, now() + interval '2 days', null);

    perform pg_temp.recompute_standings_0144(co);

    for r in
      select t.name, s.gp, s.w, s.l, s.conf_gp, s.conf_w, s.conf_l,
             s.conf_pts_for, s.conf_pts_against, s.group_name, s.division_name, s.rank
        from public.standings s join public.teams t on t.id = s.team_id
       where s.competition_id = co
    loop
      n := n + 1;
      if (r.name = 'a1' and (r.w, r.l, r.conf_w, r.conf_l, r.conf_pts_for, r.conf_pts_against, r.rank)
                            is distinct from (2, 2, 1, 1, 140, 145, 2))
      or (r.name = 'a2' and (r.w, r.l, r.conf_w, r.conf_l, r.conf_pts_for, r.conf_pts_against, r.rank)
                            is distinct from (2, 1, 1, 1, 145, 140, 1))
      or (r.name = 'b1' and (r.w, r.l, r.conf_w, r.conf_l, r.rank, r.division_name)
                            is distinct from (1, 1, 1, 0, 1, 'North'::text))
      or (r.name = 'b2' and (r.w, r.l, r.conf_w, r.conf_l, r.rank, r.division_name)
                            is distinct from (0, 1, 0, 1, 2, 'North'::text)) then
        raise exception '0144: conference arithmetic wrong for %: overall %-% conf %-% (%-%) group % div % rank %',
          r.name, r.w, r.l, r.conf_w, r.conf_l, r.conf_pts_for, r.conf_pts_against,
          r.group_name, r.division_name, r.rank;
      end if;
    end loop;

    if n <> 4 then
      raise exception '0144: the conference table has % clubs, not its four', n;
    end if;

    raise notice '0144: conference record, overall record, ranking and divisions all hold';
    raise exception 'rollback' using errcode = 'P0144';
  exception when sqlstate 'P0144' then
    null;
  end;
end $test$;

drop function if exists pg_temp.recompute_standings_0144(uuid);

-- ============================================================================
-- 1. recompute_standings — 0116's body, plus the conference record and the
--    conference ranking.
-- ============================================================================
create or replace function public.recompute_standings(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r_win  int;
  r_loss int;
  r_format text;   -- 0144: 'conferences' ranks by the conference record
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

  select c.format into r_format from competitions c where c.id = p_competition;

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

  -- ---- the conference record (0144) ---------------------------------------
  /* A CONFERENCE GAME IS A GAME BETWEEN TWO MEMBERS OF THE SAME CONFERENCE,
     unless somebody has said otherwise. games.conference_game is null for
     "work it out" — both sides entered in this competition under the same
     group_name — and true or false where the feed or an administrator knows
     better: a conference playoff is two members of the same conference and is
     not a conference game, and neither is a holiday tournament the two happen
     to meet in. The overall columns above stay the complete schedule; these
     are the conference-only record NCAA tables print beside it.

     Every competition gets them. For one without groups every team is in the
     null group, which is no conference, so they stay nought and nothing that
     reads the old columns sees a difference. */
  with entry as (
    select ct.team_id, ct.group_name
      from competition_teams ct where ct.competition_id = p_competition
  ),
  conf_games as (
    select g.home_team_id, g.away_team_id, g.home_score, g.away_score
      from games g
      left join entry h on h.team_id = g.home_team_id
      left join entry a on a.team_id = g.away_team_id
     where g.competition_id = p_competition and g.status = 'final'
       and coalesce(g.conference_game,
                    h.group_name is not null and h.group_name = a.group_name)
  ),
  conf_played as (
    select home_team_id as team_id, home_score as pf, away_score as pa from conf_games
    union all
    select away_team_id, away_score, home_score from conf_games
  ),
  conf_agg as (
    select team_id,
           count(*)::int            as gp,
           sum((pf > pa)::int)::int as w,
           sum((pf < pa)::int)::int as l,
           sum(pf)::int             as pts_for,
           sum(pa)::int             as pts_against
      from conf_played group by team_id
  )
  update standings st
     set conf_gp = c.gp, conf_w = c.w, conf_l = c.l,
         conf_pts_for = c.pts_for, conf_pts_against = c.pts_against
    from conf_agg c
   where st.competition_id = p_competition and st.team_id = c.team_id;

  /* the division a team plays in within its conference (OUA East / West) —
     a property of its entry, like the group, carried across the same way */
  update standings st
     set division_name = ct.division_name
    from competition_teams ct
   where st.competition_id = p_competition
     and ct.competition_id = p_competition and ct.team_id = st.team_id
     and ct.division_name is not null;

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

  /* RANK WITHIN THE GROUP — and within the division, where a conference has
     them. For every competition that is not 'conferences' the three leading
     keys are null on every row and the division is null, so the order is
     exactly the one this function always used (0144's self-test holds every
     existing table to that). A conference table is ordered the way NCAA
     tables are: conference winning percentage, then conference wins, then the
     overall record, then the old keys. A team yet to play a conference game
     sits on 0 and is ordered by its overall record among the others. */
  with ranked as (
    select team_id, row_number() over (
             partition by group_name, division_name
             order by
               case when r_format = 'conferences'
                    then coalesce(conf_w::numeric / nullif(conf_gp, 0), 0) end desc nulls last,
               case when r_format = 'conferences' then conf_w end desc nulls last,
               case when r_format = 'conferences'
                    then coalesce(w::numeric / nullif(gp, 0), 0) end desc nulls last,
               league_points desc, (pts_for - pts_against) desc, pts_for desc
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
-- 2. games_write_guard — 0116's body, plus: the conference flag is an
--    administrator's to change. The trigger 0116 created calls this function
--    by name, so replacing the function is enough.
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

  /* 0144: WHETHER A GAME COUNTS IN THE CONFERENCE TABLE is the league's call.
     It moves two teams' conference records, so it asks what moving the game
     between competitions asks: an administrator of the game. The ingest and
     finalise-game write it as the service role and never reach this line. */
  if new.conference_game is distinct from old.conference_game
     and not public.can_manage_game(old.id) then
    raise exception 'only an administrator of this game may say whether it is a conference game'
      using errcode = '42501';
  end if;

  return new;
end $$;

alter function public.games_write_guard() owner to postgres;


-- ============================================================================
-- SELF-TEST 3 — the bodies are 0116's, with 0144 added and nothing lost.
-- ============================================================================
do $test$
declare
  src   text;
  guard text;
begin
  select p.prosrc into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_standings';
  select p.prosrc into guard from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'games_write_guard';

  if position('recompute_standings_guard' in src) = 0 then
    raise exception '0144: recompute_standings lost its guard';
  end if;
  if position('pg_advisory_xact_lock' in src) = 0 then
    raise exception '0144: recompute_standings lost 0086''s lock';
  end if;
  if position('team_sanctions' in src) = 0 then
    raise exception '0144: recompute_standings lost the sanctions pass';
  end if;
  if position('recompute_standings_guard' in src) > position('pg_advisory_xact_lock' in src)
     or position('pg_advisory_xact_lock' in src) > position('delete from standings' in src) then
    raise exception '0144: the guard, the lock and the write are out of order';
  end if;
  if position('conf_agg' in src) = 0 or position('r_format = ''conferences''' in src) = 0 then
    raise exception '0144: the conference record is not in recompute_standings';
  end if;
  /* the conference pass must run BEFORE the sanctions, which dock the overall
     record only, and before the ranking, which reads it */
  if position('conf_agg' in src) > position('team_sanctions' in src)
     or position('conf_agg' in src) > position('with ranked as' in src) then
    raise exception '0144: the conference record is computed after it is used';
  end if;
  if has_function_privilege('anon', 'public.recompute_standings(uuid)', 'execute') then
    raise exception '0144: anon can execute recompute_standings';
  end if;

  if position('only finalise-game marks a game finalised' in guard) = 0
     or position('can_manage_game' in guard) = 0 then
    raise exception '0144: games_write_guard is not 0116''s body';
  end if;
  if position('new.conference_game is distinct from old.conference_game' in guard) = 0 then
    raise exception '0144: a scorer could still flip a game in or out of the conference table';
  end if;
  raise notice '0144: recompute_standings and games_write_guard carry 0116 plus the conference pass';
end $test$;

