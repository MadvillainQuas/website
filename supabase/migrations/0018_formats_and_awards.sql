-- ============================================================================
-- COURTSIDE NETWORK — Phase 4: competition formats and season awards
--
-- Until now a competition was one round-robin table. Real seasons are not:
-- they have groups that qualify into a knockout, cups that run alongside the
-- league, and they end with somebody being handed a trophy.
--
-- Everything added here keeps the property the rest of the platform has —
-- IT IS DERIVED. Drop every row in standings, bracket_ties' results and
-- season_awards, re-run the three functions, and you get the same answers back
-- from game_events. Nothing here is a fact somebody typed in that could drift
-- away from what happened on the floor.
-- ============================================================================

-- ---------------------------------------------------------------- groups ---
-- A group is a property of a team's ENTRY into a competition, not of the team
-- and not of the competition: the same club can be in Group A of the league
-- and ungrouped in the cup, in the same season.
alter table public.competition_teams
  add column if not exists group_name text;

alter table public.standings
  add column if not exists group_name text;

-- Rank is per group where groups exist, so the index has to lead with it.
create index if not exists standings_comp_group_rank
  on public.standings (competition_id, group_name, rank);

-- Competition format. 'league' and 'cup' already existed as `kind`; this says
-- how the competition is STRUCTURED rather than what it is called.
alter table public.competitions
  add column if not exists format text not null default 'table',
  add column if not exists qualifiers int not null default 0;

-- 'table'    a single table
-- 'groups'   two or more tables side by side
-- 'knockout' a bracket
-- 'groups_knockout' groups that qualify into a bracket
do $$ begin
  alter table public.competitions
    add constraint competitions_format_ck
    check (format in ('table','groups','knockout','groups_knockout'));
exception when duplicate_object then null; end $$;

-- ============================================================================
-- recompute_standings — now group-aware.
--
-- Replaces the 0002 version. The aggregation is unchanged; what changes is
-- that a team carries its group across from competition_teams, and rank is
-- computed WITHIN a group rather than across the whole competition. A
-- competition with no groups has one group of NULL, which partitions to
-- exactly the old behaviour — so an ungrouped league gets the same table it
-- had before this migration.
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
  insert into standings (competition_id, team_id, gp, w, l, pts_for, pts_against,
                         league_points, streak, group_name, updated_at)
  select p_competition, a.team_id, a.gp, a.w, a.l, a.pts_for, a.pts_against, a.league_points,
         coalesce(s.streak, ''), ct.group_name, now()
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

  -- rank within the group; an ungrouped competition is one group of NULL
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
-- Knockout brackets.
--
-- A tie is a slot in a bracket. Its two sides are EITHER a team, or "whoever
-- wins tie X" — which is what makes a bracket a bracket. Storing the second
-- form as a reference rather than resolving it at creation time means the
-- bracket can be published before the group stage finishes, and it fills
-- itself in as results arrive.
--
-- Winners are DERIVED from the games, never set by hand. A tie can be one game
-- or two legs; two legs are decided on aggregate, which is how European cups
-- run and what the schema has to allow for even if most leagues do not use it.
-- ============================================================================
create table if not exists public.bracket_ties (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions on delete cascade,
  round          int  not null,              -- 1 = first round, ascending to the final
  slot           int  not null,              -- position within the round, from the top
  label          text not null default '',   -- 'Quarter-final', 'Final' …

  -- each side is a team, or the winner of an earlier tie, or neither yet
  home_team_id   uuid references public.teams on delete set null,
  away_team_id   uuid references public.teams on delete set null,
  home_from_tie  uuid references public.bracket_ties on delete set null,
  away_from_tie  uuid references public.bracket_ties on delete set null,
  home_seed      int,
  away_seed      int,

  -- derived
  winner_team_id uuid references public.teams on delete set null,
  home_agg       int,
  away_agg       int,
  updated_at     timestamptz not null default now(),
  unique (competition_id, round, slot)
);
create index if not exists bracket_comp on public.bracket_ties (competition_id, round, slot);

-- a game belongs to at most one tie, and knows which leg it is
alter table public.games
  add column if not exists tie_id uuid references public.bracket_ties on delete set null,
  add column if not exists leg int;
create index if not exists games_tie on public.games (tie_id);

alter table public.bracket_ties enable row level security;
drop policy if exists bracket_read on public.bracket_ties;
create policy bracket_read on public.bracket_ties for select using (true);
-- writes go through the SECURITY DEFINER functions below, never directly

-- ---------------------------------------------------------------------------
-- advance_bracket — resolve every tie from the games that have been played.
--
-- Idempotent and total: it recomputes the whole bracket from scratch rather
-- than reacting to one result, so a corrected score or a reopened game fixes
-- the bracket by being re-run, and there is no incremental state to drift.
--
-- Rounds are processed in order because a later round's teams come from an
-- earlier round's winners.
-- ---------------------------------------------------------------------------
create or replace function public.advance_bracket(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_home uuid; v_away uuid;
  v_hs int; v_as int; v_played int;
begin
  for t in
    select * from bracket_ties
     where competition_id = p_competition
     order by round, slot
  loop
    -- resolve each side: an explicit team, else the winner of the feeding tie
    v_home := t.home_team_id;
    if v_home is null and t.home_from_tie is not null then
      select winner_team_id into v_home from bracket_ties where id = t.home_from_tie;
    end if;
    v_away := t.away_team_id;
    if v_away is null and t.away_from_tie is not null then
      select winner_team_id into v_away from bracket_ties where id = t.away_from_tie;
    end if;

    -- aggregate across the tie's finished games, from THIS tie's point of view
    select coalesce(sum(case when g.home_team_id = v_home then g.home_score
                             when g.away_team_id = v_home then g.away_score else 0 end), 0),
           coalesce(sum(case when g.home_team_id = v_away then g.home_score
                             when g.away_team_id = v_away then g.away_score else 0 end), 0),
           count(*)
      into v_hs, v_as, v_played
      from games g
     where g.tie_id = t.id and g.status = 'final';

    update bracket_ties set
      home_team_id = v_home,
      away_team_id = v_away,
      home_agg = case when v_played > 0 then v_hs end,
      away_agg = case when v_played > 0 then v_as end,
      -- a tie is only decided when it has been played and is not level
      winner_team_id = case
        when v_played = 0 or v_home is null or v_away is null then null
        when v_hs > v_as then v_home
        when v_as > v_hs then v_away
        else null                      -- level on aggregate: undecided, not a coin toss
      end,
      updated_at = now()
     where id = t.id;
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- seed_bracket — build a single-elimination bracket from the current table.
--
-- p_qualifiers must be a power of two: a bracket that is not is a bracket with
-- byes, and a bye is a decision about who deserves one that this function has
-- no business making silently. The caller is told rather than guessed for.
--
-- Standard seeding: 1 plays the lowest qualifier, 2 plays the next, so the top
-- two seeds can only meet in the final. Where groups exist, qualifiers are
-- taken from each group in rank order and interleaved, so group winners are
-- kept apart in the first round.
-- ---------------------------------------------------------------------------
create or replace function public.seed_bracket(
  p_competition uuid, p_qualifiers int, p_from_competition uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_src uuid := coalesce(p_from_competition, p_competition);
  v_n int := p_qualifiers;
  v_rounds int;
  v_seeds uuid[];
  v_prev uuid[];
  v_cur uuid[];
  v_id uuid;
  i int; r int; v_slot int;
  v_label text;
begin
  if v_n < 2 or (v_n & (v_n - 1)) <> 0 then
    raise exception 'qualifiers must be a power of two (2, 4, 8, 16); got %', v_n;
  end if;

  -- the qualifying teams, group winners first, then all the seconds, and so on
  select array_agg(team_id order by rank, group_name nulls first, league_points desc)
    into v_seeds
    from standings
   where competition_id = v_src and rank is not null;

  if v_seeds is null or array_length(v_seeds, 1) < v_n then
    raise exception 'only % teams are ranked in that competition, need %',
      coalesce(array_length(v_seeds, 1), 0), v_n;
  end if;

  delete from bracket_ties where competition_id = p_competition;

  -- numeric rather than float: log2(8) in floating point is not reliably 3
  v_rounds := log(2::numeric, v_n::numeric)::int;

  -- round 1: seed i against seed (n + 1 - i)
  v_slot := 0;
  v_cur := '{}';
  for i in 1 .. (v_n / 2) loop
    v_label := case when v_rounds = 1 then 'Final'
                    when v_rounds = 2 then 'Semi-final'
                    when v_rounds = 3 then 'Quarter-final'
                    else 'Round of ' || v_n end;
    insert into bracket_ties (competition_id, round, slot, label,
                              home_team_id, away_team_id, home_seed, away_seed)
    values (p_competition, 1, v_slot, v_label,
            v_seeds[i], v_seeds[v_n + 1 - i], i, v_n + 1 - i)
    returning id into v_id;
    v_cur := v_cur || v_id;
    v_slot := v_slot + 1;
  end loop;

  -- later rounds: each tie fed by the two below it
  for r in 2 .. v_rounds loop
    v_prev := v_cur;
    v_cur := '{}';
    v_slot := 0;
    v_label := case when r = v_rounds then 'Final'
                    when r = v_rounds - 1 then 'Semi-final'
                    when r = v_rounds - 2 then 'Quarter-final'
                    else 'Round ' || r end;
    i := 1;
    while i < array_length(v_prev, 1) loop
      insert into bracket_ties (competition_id, round, slot, label,
                                home_from_tie, away_from_tie)
      values (p_competition, r, v_slot, v_label, v_prev[i], v_prev[i + 1])
      returning id into v_id;
      v_cur := v_cur || v_id;
      v_slot := v_slot + 1;
      i := i + 2;
    end loop;
  end loop;

  update competitions
     set format = case when format = 'table' then 'knockout' else format end,
         qualifiers = v_n
   where id = p_competition;

  perform advance_bracket(p_competition);
  return v_rounds;
end; $$;

-- ============================================================================
-- Season awards.
--
-- Derived from player_season_stats like everything else, so they cannot
-- disagree with the tables they sit beside. Two rules keep them honest:
--
--   A MINIMUM APPEARANCE GATE. Somebody who played two games and scored 40 in
--   one of them is not the leading scorer, and a table that says so is a table
--   nobody trusts. The gate is a share of the most games any player in the
--   competition played, which adapts to a season in progress.
--
--   NO INVENTED METRICS. The MVP award uses the standard efficiency formula
--   (PTS + REB + AST + STL + BLK − missed shots − turnovers) that FIBA and the
--   NBA both publish. It is a blunt instrument and a well-known one; a bespoke
--   composite would be a private opinion presented as a result.
-- ============================================================================
create table if not exists public.season_awards (
  competition_id uuid not null references public.competitions on delete cascade,
  code           text not null,               -- mvp | scorer | rebounder | …
  player_id      uuid references public.players on delete cascade,
  team_id        uuid references public.teams on delete cascade,
  value          numeric,
  detail         text not null default '',
  updated_at     timestamptz not null default now(),
  primary key (competition_id, code)
);

alter table public.season_awards enable row level security;
drop policy if exists awards_read on public.season_awards;
create policy awards_read on public.season_awards for select using (true);

create or replace function public.compute_season_awards(p_competition uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_max_gp int;
  v_gate   int;
  v_n int := 0;
begin
  select max(gp) into v_max_gp
    from player_season_stats where competition_id = p_competition;
  if v_max_gp is null or v_max_gp = 0 then
    delete from season_awards where competition_id = p_competition;
    return 0;
  end if;
  -- at least half the games, and never fewer than three
  v_gate := greatest(3, ceil(v_max_gp * 0.5)::int);
  -- …unless the season is too young for that to leave anybody
  if not exists (select 1 from player_season_stats
                  where competition_id = p_competition and gp >= v_gate) then
    v_gate := v_max_gp;
  end if;

  delete from season_awards where competition_id = p_competition;

  with elig as (
    select s.*,
           -- the standard efficiency formula, per game
           ( s.pts + s.reb + s.ast + s.stl + s.blk
             - (s.fga - s.fgm) - (s.fta - s.ftm) - s.tov )::numeric / nullif(s.gp,0) as eff_pg
      from player_season_stats s
     where s.competition_id = p_competition and s.gp >= v_gate
  ),
  picks as (
    select 'mvp' as code, player_id, team_id, round(eff_pg, 1) as value,
           'efficiency per game' as detail,
           row_number() over (order by eff_pg desc nulls last) as rn from elig
    union all
    select 'scorer', player_id, team_id, round(pts::numeric / nullif(gp,0), 1),
           'points per game', row_number() over (order by pts::numeric / nullif(gp,0) desc nulls last) from elig
    union all
    select 'rebounder', player_id, team_id, round(reb::numeric / nullif(gp,0), 1),
           'rebounds per game', row_number() over (order by reb::numeric / nullif(gp,0) desc nulls last) from elig
    union all
    select 'playmaker', player_id, team_id, round(ast::numeric / nullif(gp,0), 1),
           'assists per game', row_number() over (order by ast::numeric / nullif(gp,0) desc nulls last) from elig
    union all
    select 'defender', player_id, team_id,
           round((stl + blk)::numeric / nullif(gp,0), 1),
           'steals and blocks per game',
           row_number() over (order by (stl + blk)::numeric / nullif(gp,0) desc nulls last) from elig
    union all
    -- a shooting award needs a volume gate of its own, or it goes to whoever
    -- took four threes all season and made three of them
    select 'marksman', player_id, team_id,
           round(100.0 * p3m / nullif(p3a,0), 1),
           'three-point percentage',
           row_number() over (order by (100.0 * p3m / nullif(p3a,0)) desc nulls last)
      from elig where p3a >= greatest(20, v_gate * 2)
  )
  insert into season_awards (competition_id, code, player_id, team_id, value, detail, updated_at)
  select p_competition, code, player_id, team_id, value,
         detail || ' · minimum ' || v_gate || ' games', now()
    from picks where rn = 1;

  get diagnostics v_n = row_count;

  -- team awards, from the standings the same page shows
  insert into season_awards (competition_id, code, team_id, value, detail, updated_at)
  select p_competition, 'best_offence', team_id,
         round(pts_for::numeric / nullif(gp,0), 1), 'points scored per game', now()
    from standings where competition_id = p_competition and gp > 0
   order by pts_for::numeric / nullif(gp,0) desc limit 1
  on conflict (competition_id, code) do nothing;

  insert into season_awards (competition_id, code, team_id, value, detail, updated_at)
  select p_competition, 'best_defence', team_id,
         round(pts_against::numeric / nullif(gp,0), 1), 'points allowed per game', now()
    from standings where competition_id = p_competition and gp > 0
   order by pts_against::numeric / nullif(gp,0) asc limit 1
  on conflict (competition_id, code) do nothing;

  return v_n + 2;
end; $$;

-- These three are SECURITY DEFINER and they WRITE. Nothing they write can be
-- false — every value is recomputed from finalised games — but a function that
-- writes has no business being callable by an unauthenticated visitor, who
-- could at best make the database do expensive work on demand. Public pages
-- read the tables; the finalise path (service role) and league administrators
-- are the only callers that need these.
revoke execute on function public.advance_bracket(uuid)         from anon, public;
revoke execute on function public.compute_season_awards(uuid)   from anon, public;
revoke execute on function public.seed_bracket(uuid, int, uuid) from anon, public;
grant  execute on function public.advance_bracket(uuid)         to authenticated;
grant  execute on function public.compute_season_awards(uuid)   to authenticated;
grant  execute on function public.seed_bracket(uuid, int, uuid) to authenticated;
