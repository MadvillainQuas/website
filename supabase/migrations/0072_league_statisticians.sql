-- ============================================================================
-- A STATISTICIAN BELONGS TO A LEAGUE, NOT TO ONE CLUB.
--
-- The console only ever offered a CLUB when granting the statistician role,
-- which does not describe the job. A league appoints table officials and sends
-- them to whichever fixture needs covering; tying one to a single club means
-- the person scoring Tuesday's game at Harbour Bay cannot score Thursday's at
-- East Dock without a second grant, and a neutral official — which is what a
-- statistician is supposed to be — cannot be expressed at all.
--
-- grant_role already ACCEPTED statistician at league scope: its league branch
-- only asks whether you administer that league. Nothing honoured it. The
-- membership went into the table and may_score_game never looked at it, so the
-- grant appeared to work and the person still could not open a fixture. This
-- makes the row mean what it says.
--
-- THE CLUB SCOPE IS KEPT. A club's own statistician who only ever does that
-- club's home games is a real arrangement, and 0007's team branch already
-- covers it; this adds the league-wide case beside it rather than replacing it.
--
-- WHAT IT DOES NOT GRANT. Scoring, and nothing else: no fixture creation, no
-- roster editing, no publishing, no access to the league console. The whole
-- point of a separate role is that it is narrow.
-- ============================================================================

create or replace function public.is_league_statistician(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.user_id = auth.uid()
       and m.role = 'statistician'
       and m.scope_type = 'league'
       and m.scope_id = p_league);
$$;

grant execute on function public.is_league_statistician(uuid) to authenticated;

comment on function public.is_league_statistician(uuid) is
  'True for somebody appointed as a table official for the whole league, who '
  'may score any of its fixtures. Scoring only — it confers no administrative '
  'right over the league.';

-- ------------------------------------------------------------------ who -----
-- Rebuilt rather than edited so the whole predicate reads in one place: a
-- platform admin, an official assigned to this game, an administrator of the
-- owning league, or one of that league's statisticians.
create or replace function public.may_score_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    where g.id = p_game
      and ( public.is_platform_admin()
            or exists (select 1 from game_officials go
                       where go.game_id = p_game and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id))
            or (s.league_id is not null and public.is_league_statistician(s.league_id)) ));
$$;

-- ---------------------------------------------- the writer role, reachable ---
-- grant_league_writer has existed since 0051 and answers 404 over the API,
-- so the only way to appoint a news writer was from inside a league's own
-- console. The platform page now offers it, which means the function has to be
-- callable by a signed-in administrator. Its own gate is unchanged and still
-- decides who may actually use it: is_league_admin, which a platform admin
-- satisfies for every league.
grant execute on function public.grant_league_writer(uuid, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_proc where proname = 'revoke_league_writer') then
    execute 'grant execute on function public.revoke_league_writer(uuid, uuid) to authenticated';
  end if;
exception when others then
  raise notice 'revoke_league_writer not granted: %', sqlerrm;
end $$;

-- ============================================================================
-- A migration that does not call what it creates has not been tested.
-- ============================================================================
do $$
declare
  lg uuid; gm uuid; failed text[] := '{}';
begin
  select s.league_id, g.id into lg, gm
    from games g
    join competitions c on c.id = g.competition_id
    join seasons s on s.id = c.season_id
   where s.league_id is not null
   limit 1;

  if gm is null then
    raise notice 'no league fixture to test against — skipping';
    return;
  end if;

  -- the predicate must be callable and must answer for a real fixture
  if public.may_score_game(gm) is null then
    failed := array_append(failed, 'may_score_game returned null for a real game');
  end if;
  if public.is_league_statistician(lg) is null then
    failed := array_append(failed, 'is_league_statistician returned null');
  end if;

  -- and the SQL must actually reference the new branch, or this migration is
  -- a comment with a function attached
  if not exists (
    select 1 from pg_proc p
     where p.proname = 'may_score_game'
       and pg_get_functiondef(p.oid) like '%is_league_statistician%') then
    failed := array_append(failed, 'may_score_game does not consult league statisticians');
  end if;

  -- can_score stays strictly narrower: who AND whether the game is open
  if not exists (
    select 1 from pg_proc p
     where p.proname = 'can_score'
       and pg_get_functiondef(p.oid) like '%may_score_game%') then
    failed := array_append(failed, 'can_score no longer builds on may_score_game');
  end if;

  if array_length(failed, 1) is not null then
    raise exception 'league statisticians are wrong: %', array_to_string(failed, '; ');
  end if;
  raise notice 'league statisticians verified: may_score_game consults them, can_score still gates writes';
end $$;
