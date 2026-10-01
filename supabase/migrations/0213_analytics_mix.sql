-- ============================================================================
-- 0213: What wins A.3 (docs/what-wins-model.md, addendum A.3) - THE LINEUP MIXES FILE.
--
-- A league-season's lineup builder reads one more members' file, scope 'mix': every five a club used, summed over
-- the season, and an anonymous index of the players' season rates and role tags (no names, no player ids). It is
-- gated exactly as the Front office file ('fo') is: a league's own unit, members only where memberships are on. The
-- index row is written by the builder (tools/build-analytics.mjs) and by RECALCULATE (analytics-file), each on its
-- own, so a deployment that has not run this migration yet only goes without the file.
-- ============================================================================

-- the index accepts the new scope
alter table public.analytics_files drop constraint if exists analytics_files_scope_check;
alter table public.analytics_files add constraint analytics_files_scope_check
  check (scope in ('wins', 'fo', 'club', 'pos', 'mix', 'store', 'priors', 'teaser'));

-- the gate: 'mix' is a league-season's file (a league is required), checked as 'fo' is; everything else as in 0211
create or replace function public.analytics_check(p_scope text, p_league uuid, p_season uuid, p_team uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.analytics_signin_required() and auth.uid() is null then return 'signin'; end if;
  if p_scope is null or p_scope not in ('wins', 'fo', 'club', 'pos', 'mix') then return 'scope'; end if;
  if p_league is null then
    if p_scope <> 'wins' or p_season is not null or p_team is not null then return 'scope'; end if;
    if public.memberships_enabled() and not public.can_use_analytics(null) then return 'members'; end if;
    return 'ok';
  end if;
  if not public.can_view_league(p_league) then return 'league'; end if;
  if public.memberships_enabled()
     and not (public.can_use_analytics(p_league) or coalesce(public.is_league_admin(p_league), false)) then
    return 'members'; end if;
  if p_season is not null and not exists (select 1 from public.seasons s where s.id = p_season and s.league_id = p_league)
    then return 'league'; end if;
  if p_scope = 'mix' and p_team is not null then return 'scope'; end if;
  if p_scope in ('club', 'pos') then
    if p_team is null then return 'scope'; end if;
    if not exists (select 1 from public.games g join public.competitions c on c.id = g.competition_id
                     join public.seasons s on s.id = c.season_id
                    where s.league_id = p_league and (p_season is null or s.id = p_season)
                      and (g.home_team_id = p_team or g.away_team_id = p_team)) then return 'league'; end if;
  end if;
  return 'ok';
end $$;
-- called with the CALLER's token, so the signed-out and the signed-in may both ask it
revoke all on function public.analytics_check(text, uuid, uuid, uuid) from public;
grant execute on function public.analytics_check(text, uuid, uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
