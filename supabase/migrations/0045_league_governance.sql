-- ============================================================================
-- 0045 — REAL LEAGUE ADMINISTRATION.
--
-- The league console could, until now, generate a fixture list, assign groups
-- and seed a bracket. Everything a league secretary actually spends the season
-- doing was missing: moving one game to a Tuesday, docking a club three points
-- for fielding an ineligible player, suspending somebody for two matches,
-- correcting a misspelt surname.
--
-- Four things go in here, and they share one principle. THE DERIVED TABLES
-- STAY DERIVED. A points deduction is not an edit to a standings row — it is a
-- stored sanction that recompute_standings subtracts every time it runs, so
-- deleting standings and rebuilding it gives the same table back. Anything
-- else drifts the moment somebody presses recompute.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DISCIPLINE — points and wins docked from a club.
--
-- Both, because leagues differ: most dock league points, some void a result
-- and take the win with it, and a few do both in the same ruling. Recorded
-- against a COMPETITION rather than a club, because a deduction in the league
-- does not follow a club into the cup.
-- ---------------------------------------------------------------------------
create table if not exists public.team_sanctions (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions on delete cascade,
  team_id        uuid not null references public.teams on delete cascade,
  points         int  not null default 0,      -- league points to subtract
  wins           int  not null default 0,      -- wins to subtract (losses gained)
  reason         text not null default '',
  effective_on   date not null default current_date,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  constraint sanction_not_empty check (points <> 0 or wins <> 0)
);
create index if not exists sanctions_comp on public.team_sanctions (competition_id, team_id);

alter table public.team_sanctions enable row level security;
-- Public. A deduction that the table applies but nobody can read is a table
-- nobody can check, and every league publishes these.
drop policy if exists sanctions_read on public.team_sanctions;
create policy sanctions_read on public.team_sanctions for select using (true);

-- The table carries the deduction so the public page can show "-3" beside the
-- points rather than a number that silently does not add up from W and L.
alter table public.standings
  add column if not exists deducted_points int not null default 0,
  add column if not exists deducted_wins   int not null default 0;

-- ---------------------------------------------------------------------------
-- 2. SUSPENSIONS.
--
-- Expressed as a COUNT OF GAMES, a DATE WINDOW, or both, because rulings come
-- in all three shapes: "three matches", "until the hearing on the 9th", and
-- "three matches, starting from the 9th".
--
-- A game-count suspension is served against games the club actually plays
-- after it starts, which is the whole point of counting matches rather than
-- days — a postponement must not shorten a ban. `served` is therefore DERIVED
-- from the fixture list rather than decremented by hand, so a game later
-- voided gives the ban its match back.
-- ---------------------------------------------------------------------------
create table if not exists public.player_suspensions (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.players on delete cascade,
  competition_id uuid references public.competitions on delete cascade, -- null = all
  team_id        uuid references public.teams on delete set null,       -- who they serve it at
  games          int,                          -- null = date-bounded only
  starts_on      date not null default current_date,
  ends_on        date,                         -- null = until the games are served
  reason         text not null default '',
  lifted_at      timestamptz,                  -- rescinded on appeal
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  constraint suspension_has_a_length check (games is not null or ends_on is not null)
);
create index if not exists susp_player on public.player_suspensions (player_id);
create index if not exists susp_comp on public.player_suspensions (competition_id);

alter table public.player_suspensions enable row level security;
-- Readable, because a suspension is published and because the scorer has to
-- warn about it before somebody is put on the floor. The REASON is not: a
-- disciplinary finding about a named person, potentially a minor, is not
-- something to publish by default, so the public view below drops it.
drop policy if exists susp_read on public.player_suspensions;
create policy susp_read on public.player_suspensions for select
  using (public.is_platform_admin()
         or (competition_id is not null and public.is_competition_admin(competition_id)));

-- How many games of a suspension have been served: club games finalised inside
-- the window, in the competition it applies to.
create or replace function public.suspension_served(p_susp uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from player_suspensions s
    join games g
      on (g.home_team_id = s.team_id or g.away_team_id = s.team_id)
     and g.status = 'final'
     and (s.competition_id is null or g.competition_id = s.competition_id)
     and g.tipoff_at >= s.starts_on
     and (s.ends_on is null or g.tipoff_at < (s.ends_on + 1))
   where s.id = p_susp;
$$;

-- Is this player banned right now, and why in one line. Public: the scorer
-- calls it before a starting five is confirmed, and the club portal shows it
-- on the roster.
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
     and s.lifted_at is null;
$$;

-- The admin list, with names, for the console.
create or replace function public.suspension_list(p_league uuid)
returns table (
  id uuid, player_id uuid, player_name text, team_id uuid, team_name text,
  competition_id uuid, competition_name text,
  games int, served int, starts_on date, ends_on date, reason text,
  lifted_at timestamptz, active boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
  select s.id, s.player_id, trim(p.first_name || ' ' || p.last_name),
         s.team_id, coalesce(t.name, '—'),
         s.competition_id, coalesce(c.name, 'every competition'),
         s.games, public.suspension_served(s.id), s.starts_on, s.ends_on, s.reason,
         s.lifted_at,
         s.lifted_at is null
           and current_date >= s.starts_on
           and (s.ends_on is null or current_date <= s.ends_on)
           and (s.games is null or public.suspension_served(s.id) < s.games)
    from player_suspensions s
    join players p on p.id = s.player_id
    left join teams t on t.id = s.team_id
    left join competitions c on c.id = s.competition_id
    left join seasons sn on sn.id = c.season_id
   where sn.league_id = p_league
      or (s.competition_id is null and exists (
            select 1 from teams t2 where t2.id = s.team_id and t2.league_id = p_league))
   order by s.created_at desc;
end; $$;

create or replace function public.suspend_player(
  p_player uuid, p_team uuid, p_competition uuid,
  p_games int default null, p_starts date default null, p_ends date default null,
  p_reason text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_league uuid; v_id uuid;
begin
  select coalesce(s.league_id, t.league_id) into v_league
    from teams t
    left join competitions c on c.id = p_competition
    left join seasons s on s.id = c.season_id
   where t.id = p_team;

  if v_league is null or not public.is_league_admin(v_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if p_games is null and p_ends is null then
    raise exception 'a suspension needs a number of games, an end date, or both'
      using errcode = '22023';
  end if;

  insert into player_suspensions
    (player_id, competition_id, team_id, games, starts_on, ends_on, reason, created_by)
  values (p_player, p_competition, p_team, p_games,
          coalesce(p_starts, current_date), p_ends, coalesce(p_reason, ''), auth.uid())
  returning id into v_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'suspend_player', 'player', p_player::text,
          jsonb_build_object('games', p_games, 'ends_on', p_ends, 'reason', p_reason));
  return v_id;
end; $$;

create or replace function public.lift_suspension(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_league uuid; v_player uuid;
begin
  select coalesce(sn.league_id, t.league_id), s.player_id into v_league, v_player
    from player_suspensions s
    left join competitions c on c.id = s.competition_id
    left join seasons sn on sn.id = c.season_id
    left join teams t on t.id = s.team_id
   where s.id = p_id;
  if v_league is null or not public.is_league_admin(v_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  update player_suspensions set lifted_at = now() where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'lift_suspension', 'player', v_player::text,
          jsonb_build_object('suspension', p_id));
  return 'lifted';
end; $$;

-- ---------------------------------------------------------------------------
-- 3. SANCTION MANAGEMENT
-- ---------------------------------------------------------------------------
create or replace function public.add_sanction(
  p_competition uuid, p_team uuid, p_points int default 0, p_wins int default 0,
  p_reason text default '', p_effective date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;
  if coalesce(p_points, 0) = 0 and coalesce(p_wins, 0) = 0 then
    raise exception 'a sanction has to dock something' using errcode = '22023';
  end if;

  insert into team_sanctions (competition_id, team_id, points, wins, reason,
                              effective_on, created_by)
  values (p_competition, p_team, coalesce(p_points, 0), coalesce(p_wins, 0),
          coalesce(p_reason, ''), coalesce(p_effective, current_date), auth.uid())
  returning id into v_id;

  perform public.recompute_standings(p_competition);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'add_sanction', 'team', p_team::text,
          jsonb_build_object('points', p_points, 'wins', p_wins, 'reason', p_reason));
  return v_id;
end; $$;

create or replace function public.remove_sanction(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_team uuid;
begin
  select competition_id, team_id into v_comp, v_team from team_sanctions where id = p_id;
  if v_comp is null then return 'already gone'; end if;
  if not public.is_competition_admin(v_comp) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  delete from team_sanctions where id = p_id;
  perform public.recompute_standings(v_comp);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'remove_sanction', 'team', v_team::text, jsonb_build_object('id', p_id));
  return 'removed';
end; $$;

-- ---------------------------------------------------------------------------
-- 4. recompute_standings, now sanction-aware.
--
-- Replaces the 0019 version. Identical up to the last two steps: the docked
-- totals are subtracted before ranking, and both the deduction and the
-- adjusted figure are stored, so the public table can print "23 (-3)" instead
-- of a number that does not follow from the W-L beside it.
--
-- League points are allowed to go negative. A club docked more than it has
-- earned is unusual and it happens, and clamping at zero would quietly forgive
-- the rest of the penalty.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. ONE FIXTURE AT A TIME.
--
-- The generator writes a season; this writes a game. Between them they cover
-- what a secretary does: bulk at the start, and then a hundred small changes
-- as halls fall through.
--
-- A PLAYED GAME IS NOT EDITABLE HERE. Its date and venue are, because those
-- are administrative facts; its teams are not, because the event log names
-- them and a swap would leave every derived figure pointing at the wrong club.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_fixture(
  p_game uuid,                       -- null to create
  p_competition uuid,
  p_home uuid, p_away uuid,
  p_tipoff timestamptz default null,
  p_venue text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.game_status;
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;
  if p_home = p_away then
    raise exception 'a club cannot play itself' using errcode = '23514';
  end if;
  if not exists (select 1 from competition_teams
                  where competition_id = p_competition and team_id = p_home)
     or not exists (select 1 from competition_teams
                  where competition_id = p_competition and team_id = p_away) then
    raise exception 'both clubs have to be entered in that competition'
      using errcode = '23503';
  end if;

  if p_game is null then
    insert into games (competition_id, home_team_id, away_team_id, tipoff_at, venue)
    values (p_competition, p_home, p_away, p_tipoff, nullif(trim(coalesce(p_venue,'')), ''))
    returning id into v_id;
  else
    select status into v_status from games where id = p_game;
    if v_status is null then raise exception 'no such game' using errcode = '22023'; end if;

    if v_status in ('live', 'final', 'finalising') then
      update games set tipoff_at = coalesce(p_tipoff, tipoff_at),
                       venue = coalesce(nullif(trim(coalesce(p_venue,'')), ''), venue)
       where id = p_game;
    else
      update games set home_team_id = p_home, away_team_id = p_away,
                       tipoff_at = p_tipoff,
                       venue = nullif(trim(coalesce(p_venue,'')), '')
       where id = p_game;
    end if;
    v_id := p_game;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), case when p_game is null then 'create_fixture' else 'edit_fixture' end,
          'game', v_id::text,
          jsonb_build_object('tipoff', p_tipoff, 'venue', p_venue, 'locked', v_status));
  return v_id;
end; $$;

-- Deleting is only ever allowed for a game nobody has scored. A played game is
-- VOIDED instead: the row survives, the events survive, and it stops counting.
create or replace function public.delete_fixture(p_game uuid)
returns text language plpgsql security definer set search_path = public as $$
declare g record; n int;
begin
  select * into g from games where id = p_game;
  if not found then return 'already gone'; end if;
  if not public.can_manage_game(p_game) then
    raise exception 'you do not administer that game' using errcode = '42501';
  end if;

  select count(*) into n from game_events where game_id = p_game;
  if g.status <> 'scheduled' or n > 0 then
    raise exception 'that game has been played — void it instead of deleting it'
      using errcode = '23514';
  end if;

  delete from games where id = p_game;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'delete_fixture', 'game', p_game::text, '{}'::jsonb);
  return 'deleted';
end; $$;

create or replace function public.set_game_status(p_game uuid, p_status text)
returns text language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_new public.game_status := p_status::public.game_status;
begin
  if not public.can_manage_game(p_game) then
    raise exception 'you do not administer that game' using errcode = '42501';
  end if;
  /* Only the two administrative transitions. 'live' and 'finalising' belong to
     the scorer and the finalise function — an admin flipping a game to live
     from here would give it no event log and no state row. */
  if v_new not in ('void', 'scheduled') then
    raise exception 'an administrator may void a game or reopen it as scheduled, nothing else'
      using errcode = '22023';
  end if;

  select competition_id into v_comp from games where id = p_game;
  update games set status = v_new where id = p_game;
  if v_comp is not null then perform public.recompute_standings(v_comp); end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_game_status', 'game', p_game::text,
          jsonb_build_object('status', p_status));
  return 'game is now ' || p_status;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. EDITING CLUBS AND PLAYERS.
--
-- Both already exist in the portal for the people who run one club. These are
-- the league's own versions: an administrator fixing a name across the
-- competition without needing the club to do it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_team(
  p_team uuid, p_name text default null, p_short text default null,
  p_colour text default null, p_slug text default null
) returns text language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;
  if not (public.is_platform_admin()
          or (t.league_id is not null and public.is_league_admin(t.league_id))) then
    raise exception 'you do not administer that club''s league' using errcode = '42501';
  end if;
  if p_slug is not null and p_slug <> t.slug
     and p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'a slug is lower-case letters, digits and single hyphens'
      using errcode = '22023';
  end if;

  update teams set
    name       = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    short_name = coalesce(p_short, short_name),
    colour     = coalesce(p_colour, colour),
    slug       = coalesce(p_slug, slug)
  where id = p_team;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'admin_update_team', 'team', p_team::text,
          jsonb_build_object('was', jsonb_build_object('name', t.name, 'slug', t.slug)));
  return 'saved';
end; $$;

create or replace function public.admin_update_player(
  p_player uuid, p_first text default null, p_last text default null,
  p_birth_year int default null, p_is_minor boolean default null,
  p_photo_consent boolean default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  /* A player belongs to clubs through roster entries rather than directly, so
     the right to edit one is the right to administer ANY league they appear
     in. In practice that is one league; the exists() is what makes a loan or
     a mid-season transfer not lock both administrators out. */
  select public.is_platform_admin() or exists (
    select 1 from roster_entries r join teams t on t.id = r.team_id
     where r.player_id = p_player and t.league_id is not null
       and public.is_league_admin(t.league_id)) into v_ok;
  if not v_ok then
    raise exception 'you do not administer a league this player appears in'
      using errcode = '42501';
  end if;

  update players set
    first_name    = coalesce(nullif(trim(coalesce(p_first, '')), ''), first_name),
    last_name     = coalesce(p_last, last_name),
    birth_year    = coalesce(p_birth_year, birth_year),
    is_minor      = coalesce(p_is_minor, is_minor),
    photo_consent = coalesce(p_photo_consent, photo_consent)
  where id = p_player;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'admin_update_player', 'player', p_player::text,
          jsonb_build_object('is_minor', p_is_minor));
  return 'saved';
end; $$;

-- The league's own roster view: every player in the league with the club they
-- are on, for the editor and the suspension picker.
create or replace function public.league_players(p_league uuid, p_search text default '')
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  is_minor boolean, photo_consent boolean,
  team_id uuid, team_name text, jersey text, suspended boolean
) language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(coalesce(trim(p_search), '')) || '%';
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
  select distinct on (p.id, t.id)
         p.id, p.first_name, p.last_name, p.birth_year, p.is_minor, p.photo_consent,
         t.id, t.name, r.jersey,
         exists (select 1 from public.player_ban(p.id) b where b.active)
    from players p
    join roster_entries r on r.player_id = p.id and r.active
    join teams t on t.id = r.team_id
   where t.league_id = p_league
     and (p_search is null or trim(p_search) = ''
          or lower(p.first_name || ' ' || p.last_name) like q)
   order by p.id, t.id, r.created_at desc;
end; $$;

-- ---------------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'suspension_served(uuid)', 'player_ban(uuid,uuid)', 'suspension_list(uuid)',
    'suspend_player(uuid,uuid,uuid,int,date,date,text)', 'lift_suspension(uuid)',
    'add_sanction(uuid,uuid,int,int,text,date)', 'remove_sanction(uuid)',
    'upsert_fixture(uuid,uuid,uuid,uuid,timestamptz,text)', 'delete_fixture(uuid)',
    'set_game_status(uuid,text)',
    'admin_update_team(uuid,text,text,text,text)',
    'admin_update_player(uuid,text,text,int,boolean,boolean)',
    'league_players(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- player_ban is the exception: the public box score and the club page both
-- show an unavailable player, and neither requires an account.
grant execute on function public.player_ban(uuid,uuid) to anon;
grant execute on function public.suspension_served(uuid) to anon;

-- ============================================================================
-- SELF-TEST — a whole small league, sanctioned and suspended, then removed.
--
-- plpgsql does not type-check a body at creation, so each function is called.
-- The assertions that matter are the arithmetic ones: a deduction has to show
-- up in the table AND survive a recompute, and a suspension has to count the
-- games the club actually played rather than the days that passed.
-- ============================================================================
do $$
declare
  adm uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  lg uuid; ss uuid; cp uuid; ta uuid; tb uuid; pl uuid; g1 uuid; g2 uuid; fx uuid;
  susp uuid; sanc uuid;
  orig text; failed text[] := '{}';
  n int; t text; pts int; dw int; wl text;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'gov-admin@example.invalid', '', now(), now(), now()),
         (outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'gov-outsider@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('gov-test', 'Governance Test') returning id into lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);
  insert into seasons (league_id, name) values (lg, 'GOV') returning id into ss;
  insert into competitions (season_id, name) values (ss, 'Div') returning id into cp;
  insert into teams (league_id, slug, name) values (lg, 'gov-a', 'Alpha') returning id into ta;
  insert into teams (league_id, slug, name) values (lg, 'gov-b', 'Beta')  returning id into tb;
  insert into competition_teams (competition_id, team_id) values (cp, ta), (cp, tb);
  insert into players (slug, first_name, last_name) values ('gov-p', 'Test', 'Player')
    returning id into pl;
  insert into roster_entries (team_id, player_id, season_id, jersey)
    values (ta, pl, ss, '7');

  -- two finished games: Alpha wins both
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status,
                     home_score, away_score)
  values (cp, ta, tb, now() - interval '10 days', 'final', 80, 70) returning id into g1;
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status,
                     home_score, away_score)
  values (cp, tb, ta, now() - interval '3 days', 'final', 60, 75) returning id into g2;

  perform public.recompute_standings(cp);
  select league_points into pts from standings where competition_id = cp and team_id = ta;
  if pts <> 4 then failed := failed || ('two wins should be 4 points, got ' || pts); end if;

  -- ------------------------------------------------------------- as admin ---
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  -- discipline
  sanc := public.add_sanction(cp, ta, 3, 1, 'ineligible player', current_date);
  select league_points, deducted_points, deducted_wins, w || '-' || l
    into pts, n, dw, wl
    from standings where competition_id = cp and team_id = ta;
  if pts <> 1 then failed := failed || ('4 points less 3 should be 1, got ' || pts); end if;
  if n <> 3 then failed := failed || 'the deduction was not stored on the table'; end if;
  if wl <> '1-1' then
    failed := failed || ('docking a win should give 1-1, got ' || wl);
  end if;

  -- and it must SURVIVE a rebuild, which is the whole point of storing the
  -- sanction rather than editing the row
  perform public.recompute_standings(cp);
  select league_points into pts from standings where competition_id = cp and team_id = ta;
  if pts <> 1 then failed := failed || 'the deduction did not survive a recompute'; end if;

  t := public.remove_sanction(sanc);
  select league_points into pts from standings where competition_id = cp and team_id = ta;
  if pts <> 4 then failed := failed || 'removing the sanction did not restore the points'; end if;

  -- suspensions: two games, starting before both fixtures, so both are served
  susp := public.suspend_player(pl, ta, cp, 2, (current_date - 20), null, 'dissent');
  if public.suspension_served(susp) <> 2 then
    failed := failed || ('two games should be served, got ' ||
                          public.suspension_served(susp));
  end if;
  select count(*) into n from public.player_ban(pl, cp) where active;
  if n <> 0 then failed := failed || 'a fully served ban still reads as active'; end if;

  -- a ban that starts today has served none of itself
  perform public.lift_suspension(susp);
  susp := public.suspend_player(pl, ta, cp, 2, current_date, null, 'dissent');
  if public.suspension_served(susp) <> 0 then
    failed := failed || 'a ban starting today counted historic games';
  end if;
  select count(*) into n from public.player_ban(pl, cp) where active;
  if n <> 1 then failed := failed || 'a fresh ban does not read as active'; end if;

  select count(*) into n from public.suspension_list(lg);
  if n < 1 then failed := failed || 'suspension_list is empty'; end if;

  begin perform public.suspend_player(pl, ta, cp, null, current_date, null, 'x');
    failed := failed || 'a suspension with no length was accepted';
  exception when others then null; end;

  -- fixtures
  fx := public.upsert_fixture(null, cp, ta, tb, now() + interval '7 days', 'The Hall');
  if (select venue from games where id = fx) <> 'The Hall' then
    failed := failed || 'the new fixture has no venue';
  end if;
  perform public.upsert_fixture(fx, cp, tb, ta, now() + interval '8 days', 'Elsewhere');
  if (select home_team_id from games where id = fx) <> tb then
    failed := failed || 'an unplayed fixture would not swap its clubs';
  end if;

  begin perform public.upsert_fixture(null, cp, ta, ta, now(), '');
    failed := failed || 'a club was allowed to play itself';
  exception when others then null; end;

  -- a PLAYED game keeps its clubs and accepts a new date
  perform public.upsert_fixture(g1, cp, tb, ta, now() - interval '9 days', 'Moved');
  if (select home_team_id from games where id = g1) <> ta then
    failed := failed || 'a played game let its clubs be swapped';
  end if;
  if (select venue from games where id = g1) <> 'Moved' then
    failed := failed || 'a played game would not be rescheduled';
  end if;

  begin perform public.delete_fixture(g1);
    failed := failed || 'a played game was deleted';
  exception when others then null; end;
  t := public.delete_fixture(fx);
  if exists (select 1 from games where id = fx) then
    failed := failed || 'an unplayed fixture would not delete';
  end if;

  -- voiding takes the result out of the table
  t := public.set_game_status(g2, 'void');
  select league_points into pts from standings where competition_id = cp and team_id = ta;
  if pts <> 2 then failed := failed || ('voiding one win should leave 2 points, got ' || pts); end if;
  perform public.set_game_status(g2, 'scheduled');
  begin perform public.set_game_status(g2, 'live');
    failed := failed || 'an admin was allowed to flip a game to live';
  exception when others then null; end;

  -- clubs and players
  t := public.admin_update_team(ta, 'Alpha United', 'ALU', '#ff0000', null);
  if (select name from teams where id = ta) <> 'Alpha United' then
    failed := failed || 'the club was not renamed';
  end if;
  t := public.admin_update_player(pl, 'Tested', 'Player', 2001, false, true);
  if (select first_name from players where id = pl) <> 'Tested' then
    failed := failed || 'the player was not renamed';
  end if;
  select count(*) into n from public.league_players(lg, 'Tested');
  if n <> 1 then failed := failed || 'league_players did not find the player'; end if;

  -- ---------------------------------------------------------- as an outsider ---
  perform set_config('request.jwt.claims',
    json_build_object('sub', outsider, 'role', 'authenticated')::text, true);

  begin perform public.add_sanction(cp, ta, 3, 0, 'x', current_date);
    failed := failed || 'an outsider docked points';
  exception when insufficient_privilege then null; end;
  begin perform public.suspend_player(pl, ta, cp, 1, current_date, null, 'x');
    failed := failed || 'an outsider suspended a player';
  exception when insufficient_privilege then null; end;
  begin perform public.upsert_fixture(null, cp, ta, tb, now(), '');
    failed := failed || 'an outsider created a fixture';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_update_team(ta, 'Hijacked');
    failed := failed || 'an outsider renamed a club';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_update_player(pl, 'Hijacked');
    failed := failed || 'an outsider renamed a player';
  exception when insufficient_privilege then null; end;
  begin perform * from public.league_players(lg, '');
    failed := failed || 'an outsider read the league roster';
  exception when insufficient_privilege then null; end;

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from player_suspensions where player_id = pl;
  delete from team_sanctions where competition_id = cp;
  delete from roster_entries where player_id = pl;
  delete from players where id = pl;
  delete from games where competition_id = cp;
  delete from standings where competition_id = cp;
  delete from competition_teams where competition_id = cp;
  delete from competitions where id = cp;
  delete from seasons where id = ss;
  delete from teams where id in (ta, tb);
  delete from memberships where user_id = adm;
  delete from leagues where id = lg;
  delete from audit_log where actor in (adm, outsider);
  delete from auth.users where id in (adm, outsider);

  if array_length(failed, 1) > 0 then
    raise exception E'GOVERNANCE SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
