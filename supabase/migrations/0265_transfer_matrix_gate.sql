-- 0265: THE TRANSFER MATRIX, MEMBERS ONLY IN FACT (2026-10-15). (Numbered after 0264, the last on main when written:
-- renumber at integration if 0265 has been taken meanwhile; nothing in it depends on its number.)
--
-- The Transfer matrix (epinoia/scouting/transfer/) and the league adjustments compare and the player profile take from it
-- read two files built from the scraped player-stats files (tools/build-transfer.mjs), which have never been public and
-- must not become so. They live in the private 'analytics' bucket beside What wins' files and leave it only as What
-- wins' do: the analytics-file function asks analytics_check WITH THE CALLER'S OWN TOKEN, then answers with a two-minute
-- signed URL (supabase/functions/_shared/analyticsfile.ts).
--   'transfer'  every player-season, the store the page computes from (transfer/<token>.bin.gz, gzipped binary)
--   'tscale'    the league scale at the page's defaults (tscale/<token>.json.gz, gzipped JSON)
-- One file each for the whole platform: an index row with league_key 'all', season_key 'current', team_key '', current.
--
-- WHO MAY HAVE THEM: an account, always - a signed-out caller is asked to sign in whatever the gate says, so the scraped
-- data is never handed to an anonymous request, not even while memberships are switched off (when gate_open opens every
-- section) or if the section is made free in the console - and then the section's own gate, 'transferMatrix', seeded
-- here on the analytics entitlement What wins rides on (access.js CATALOGUE.locks.transferMatrix; a platform
-- administrator can move it in the console: Plans, What is behind the wall). No league, season or team: 'scope'.
-- Every other scope is answered exactly as 0222 answered it: the function below is 0222's, the two scopes added.

-- 1. the section's row (0222 seeded every lock access.js knew then)
insert into public.access_gates (key, gate)
values ('transferMatrix', 'analytics')
on conflict (key) do nothing;

-- 2. the private bucket takes the gzipped files (0211 allowed JSON alone); still private, still no storage policy
update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['application/gzip']
 where id = 'analytics' and allowed_mime_types is not null and not ('application/gzip' = any (allowed_mime_types));

-- 3. the index accepts the two scopes (0213's list, and these)
alter table public.analytics_files drop constraint if exists analytics_files_scope_check;
alter table public.analytics_files add constraint analytics_files_scope_check
  check (scope in ('wins', 'fo', 'club', 'pos', 'mix', 'store', 'priors', 'teaser', 'transfer', 'tscale'));

-- 4. the gate: 0222's analytics_check in full, with the transfer matrix's two scopes
create or replace function public.analytics_check(p_scope text, p_league uuid, p_season uuid, p_team uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.analytics_signin_required() and auth.uid() is null then return 'signin'; end if;
  if p_scope is null or p_scope not in ('wins', 'fo', 'club', 'pos', 'mix', 'transfer', 'tscale') then return 'scope'; end if;
  /* the transfer matrix: one file each for the platform, an account always, then its own section's gate */
  if p_scope in ('transfer', 'tscale') then
    if p_league is not null or p_season is not null or p_team is not null then return 'scope'; end if;
    if auth.uid() is null then return 'signin'; end if;
    if not public.gate_open('transferMatrix', null) then return 'members'; end if;
    return 'ok';
  end if;
  if p_league is null then
    if p_scope <> 'wins' or p_season is not null or p_team is not null then return 'scope'; end if;
    if not public.gate_open('model', null) then return 'members'; end if;
    return 'ok';
  end if;
  if not public.can_view_league(p_league) then return 'league'; end if;
  if not public.gate_open('model', p_league) then return 'members'; end if;
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
