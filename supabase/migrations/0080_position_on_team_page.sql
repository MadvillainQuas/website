-- ============================================================================
-- EDITING A POSITION WHERE THE ROSTER IS ACTUALLY READ.
--
-- roster_entries.position has existed since 0001 and the team portal has always
-- been able to set it — inside a per-player card, several clicks from the front
-- page. The place anybody actually looks at a squad is the club's own team
-- profile, where the column is right there and read-only.
--
-- Nothing about permission changes. is_team_manager() has always meant "the
-- club's own manager, OR a league administrator over that club, OR a platform
-- administrator", which is precisely the "and above" this is for, and
-- roster_write already gates the table with it. What was missing is that a
-- browser could not ASK the question: the function was never granted, so the
-- page had no way to decide whether to draw an editable cell or a plain one.
--
-- The alternative — draw the controls for everybody and let the write fail —
-- is worse than it sounds. A club secretary types four positions, presses save
-- on each, and finds out one at a time that none of them took.
-- ============================================================================

grant execute on function public.is_team_manager(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- One question, one answer, for a page that has just fetched a roster.
--
-- A team profile draws twelve rows and needs to know about one team, so asking
-- per row would be twelve round trips for a single boolean that cannot differ
-- between them.
-- ----------------------------------------------------------------------------
create or replace function public.may_manage_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_team_manager(p_team);
$$;
grant execute on function public.may_manage_team(uuid) to authenticated;

-- ============================================================================
-- SELF-TEST — the grant is the whole point, so check it is actually there.
-- ============================================================================
do $$
declare
  ok_direct boolean;
  ok_alias  boolean;
begin
  select has_function_privilege('authenticated', 'public.is_team_manager(uuid)', 'execute')
    into ok_direct;
  select has_function_privilege('authenticated', 'public.may_manage_team(uuid)', 'execute')
    into ok_alias;

  if not ok_direct then
    raise exception '0080: is_team_manager is still not callable by a signed-in user';
  end if;
  if not ok_alias then
    raise exception '0080: may_manage_team is not callable by a signed-in user';
  end if;

  raise notice '0080 ok: a signed-in user can ask whether they may edit a roster';
end $$;
