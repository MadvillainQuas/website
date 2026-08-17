-- ============================================================================
-- Fix: a team manager could not edit their own team.
--
-- 0007 closed a real hole — the old teams_write let any manager set league_id
-- to anything, moving their team into a league they had no rights over. The
-- fix added the league check to the policy's WITH CHECK:
--
--   with check ( is_team_manager(id)
--                and (league_id is null or is_league_admin(league_id)) )
--
-- WITH CHECK is evaluated against the NEW row on EVERY update, not only on one
-- that touches league_id. So once a team belonged to a league, its manager
-- could not change anything about it — not the name, not the short name, not
-- the kit colours — because they are not a league admin. The portal offers all
-- three, so the button simply failed.
--
-- The intent was never "managers may not edit teams in leagues", it was
-- "managers may not MOVE teams between leagues". A policy cannot express that,
-- because WITH CHECK sees only the new row and has no idea what league_id was
-- before. A trigger can see both, so that is where the rule belongs.
--
-- Found by the authenticated RLS tests in the next migration, which is the
-- point of writing them: the anonymous suite could never have caught this,
-- because it needs a legitimately signed-in manager to notice.
-- ============================================================================

-- back to the straightforward rule: a manager may edit the team they manage
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for update
  using      (public.is_team_manager(id))
  with check (public.is_team_manager(id));

-- and moving a team between leagues stays the league's decision
create or replace function public.guard_team_league_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.league_id is distinct from old.league_id then
    /* leaving a league needs the old league's consent, joining one needs the
       new league's — otherwise a manager could walk a team out of a
       competition mid-season, or into one uninvited */
    if old.league_id is not null and not public.is_league_admin(old.league_id) then
      raise exception 'only an administrator of the current league may move this team out'
        using errcode = '42501';
    end if;
    if new.league_id is not null and not public.is_league_admin(new.league_id) then
      raise exception 'only an administrator of that league may move a team into it'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists teams_guard_league on public.teams;
create trigger teams_guard_league before update on public.teams
  for each row execute function public.guard_team_league_move();
