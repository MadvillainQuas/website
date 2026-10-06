-- ============================================================================
-- 0233 - A PAGE ABOUT A PLAYER SAYS WHICH PLAYER (2026-10-06).
--
-- The visit counts (0173) named the league, the club and the game a page was about, but a player's page named none of them, and
-- the copies made for search engines (/p/<name>.html) named nothing at all. epinoia/track.js now sends the player too (its id: an
-- id of a public page, nothing about the reader), and the club and league a player is in, so a player's page also counts for that
-- club and league. Here: the column, and analytics_track keeping it. A page still sending the old shape is unaffected.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.site_events add column if not exists player text;
do $$ begin
  alter table public.site_events add constraint site_events_player_ck check (player is null or player ~ '^[a-z0-9-]{1,100}$');
exception when duplicate_object then null; end $$;
create index if not exists site_events_player_at on public.site_events (player, at) where player is not null;

create or replace function public.analytics_track(p_session text, p_signed_in boolean, p_device text,
                                                  p_lang text, p_app text, p_ref text, p_events jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_room int;
  n      int := 0;
begin
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{16,40}$' or jsonb_typeof(p_events) is distinct from 'array' then
    return 0;
  end if;
  select 300 - count(*) into v_room
    from site_events where session = p_session and at > now() - interval '10 minutes';
  if v_room <= 0 then
    return 0;
  end if;
  insert into site_events (kind, page, league, team, player, game, tab, session, signed_in, device, lang, app, ref)
  select e ->> 'kind',
         e ->> 'page',
         nullif(lower(e ->> 'league'), ''),
         nullif(lower(e ->> 'team'), ''),
         nullif(lower(e ->> 'player'), ''),
         case when (e ->> 'game') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (e ->> 'game')::uuid end,
         case when e ->> 'kind' = 'tab' then lower(e ->> 'tab') end,
         p_session,
         coalesce(p_signed_in, false),
         case when p_device in ('phone', 'tablet', 'desktop') then p_device end,
         case when p_lang ~ '^[a-z]{2}$' then p_lang end,
         case when p_app in ('web', 'android', 'ios') then p_app else 'web' end,
         case when lower(p_ref) ~ '^[a-z0-9.-]{1,100}$' then lower(p_ref) end
    from jsonb_array_elements(p_events) with ordinality x(e, i)
   where x.i <= least(50, v_room)
     and jsonb_typeof(e) = 'object'
     and e ->> 'kind' in ('view', 'tab')
     and coalesce(e ->> 'page', '') ~ '^[a-z0-9/-]{1,40}$'
     and coalesce(lower(e ->> 'league'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'team'), '') ~ '^([a-z0-9-]{1,100})?$'
     and coalesce(lower(e ->> 'player'), '') ~ '^([a-z0-9-]{1,100})?$'
     and (e ->> 'kind' = 'view' or coalesce(lower(e ->> 'tab'), '') ~ '^[a-z0-9_-]{1,40}$');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.analytics_track(text, boolean, text, text, text, text, jsonb) from public;
grant execute on function public.analytics_track(text, boolean, text, text, text, text, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
