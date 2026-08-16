-- ============================================================================
-- Fix a regression 0018 introduced, and prove the fix.
--
-- 0018 made recompute_standings group-aware by editing a copy of the function
-- taken from 0002 — but 0002's streak calculation was ALREADY BROKEN and had
-- already been fixed, in 0003. Copying the older body silently reverted that
-- fix, reintroducing "function max(boolean) does not exist".
--
-- The failure mode is nasty and worth naming: plpgsql bodies are not fully
-- type-checked at creation, so the broken function installs cleanly and only
-- raises when something calls it. Worse, finalise-game calls it inside a
-- .catch(() => {}), so a league's table would simply stop updating after a
-- game with nothing anywhere saying why.
--
-- This restores 0003's streak formulation, keeps 0018's group awareness, and
-- then CHECKS ITSELF: it recomputes every ungrouped competition and compares
-- against the rows that were there beforehand. Any difference raises, which
-- rolls this whole migration back rather than leaving the tables quietly
-- rewritten.
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
  -- streak, exactly as 0003 formulated it: find the most recent result, find
  -- the first game that differs, and the streak is everything before it
  ordered as (
    select team_id, (pf > pa) as won,
           row_number() over (partition by team_id
                              order by tipoff_at desc nulls last, id desc) as rn
      from played
  ),
  last_res as (
    select team_id, won from ordered where rn = 1
  ),
  first_diff as (
    select o.team_id, min(o.rn) as rn
      from ordered o join last_res l using (team_id)
     where o.won is distinct from l.won
     group by o.team_id
  ),
  totals as (
    select team_id, count(*)::int as n from ordered group by team_id
  ),
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

  -- teams entered but yet to play still belong on the table
  insert into standings (competition_id, team_id, group_name, updated_at)
  select p_competition, ct.team_id, ct.group_name, now()
    from competition_teams ct
   where ct.competition_id = p_competition
     and not exists (select 1 from standings st
                      where st.competition_id = p_competition and st.team_id = ct.team_id);

  -- rank WITHIN the group; a competition with no groups is one group of NULL,
  -- which partitions to exactly the pre-0018 behaviour
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

-- ---------------------------------------------------------------------------
-- and now prove it
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  v_diff int;
  v_checked int := 0;
  v_before text;
  v_after  text;
begin
  create temporary table _standings_before on commit drop as
    select competition_id, team_id, gp, w, l, pts_for, pts_against,
           league_points, streak, rank
      from standings;

  for c in
    select distinct s.competition_id
      from standings s
     where not exists (
       select 1 from competition_teams ct
        where ct.competition_id = s.competition_id
          and ct.group_name is not null)
  loop
    perform recompute_standings(c.competition_id);
    v_checked := v_checked + 1;

    select count(*) into v_diff from (
      (select competition_id, team_id, gp, w, l, pts_for, pts_against,
              league_points, streak, rank
         from _standings_before where competition_id = c.competition_id
       except
       select competition_id, team_id, gp, w, l, pts_for, pts_against,
              league_points, streak, rank
         from standings where competition_id = c.competition_id)
      union all
      (select competition_id, team_id, gp, w, l, pts_for, pts_against,
              league_points, streak, rank
         from standings where competition_id = c.competition_id
       except
       select competition_id, team_id, gp, w, l, pts_for, pts_against,
              league_points, streak, rank
         from _standings_before where competition_id = c.competition_id)
    ) d;

    if v_diff > 0 then
      select string_agg(team_id::text || ' r' || coalesce(rank::text,'-') ||
                        ' ' || coalesce(streak,'') , ', ' order by rank)
        into v_before from _standings_before where competition_id = c.competition_id;
      select string_agg(team_id::text || ' r' || coalesce(rank::text,'-') ||
                        ' ' || coalesce(streak,'') , ', ' order by rank)
        into v_after from standings where competition_id = c.competition_id;
      raise exception
        'recompute_standings changed % row(s) for competition %.  before: [%]  after: [%]',
        v_diff, c.competition_id, v_before, v_after;
    end if;
  end loop;

  raise notice 'standings parity holds across % ungrouped competition(s)', v_checked;
end $$;
