-- ============================================================================
-- requeue_feed_delivery (0037) checks that the caller administers the FEED's
-- league and never checks that the GAME belongs to it. feed_deliveries.game_id
-- carries no foreign key back to a league, so an admin of any league with a
-- data feed could requeue an arbitrary game id — another league's, including
-- a private (0139) or members-only (0117) one — and the dispatcher would then
-- render and send that game's full payload to their feed endpoint. This is
-- the same hole the `feeds` edge function's preview/test actions had for a
-- caller-supplied gameId, closed alongside it.
--
-- Only re-created; nothing else about the feed system changes.
-- ============================================================================
create or replace function public.requeue_feed_delivery(p_feed uuid, p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_league uuid := public.feed_league(p_feed);
  v_game_league uuid;
begin
  if v_league is null then raise exception 'no such feed'; end if;
  if not public.is_league_admin(v_league) then
    raise exception 'only an administrator of that league may resend'
      using errcode = '42501';
  end if;

  select s.league_id into v_game_league
    from games g
    join competitions c on c.id = g.competition_id
    join seasons s      on s.id = c.season_id
   where g.id = p_game;

  if v_game_league is distinct from v_league then
    raise exception 'that game is not in this feed''s league'
      using errcode = '42501';
  end if;

  insert into feed_deliveries (feed_id, game_id, kind, status, queued_at)
  values (p_feed, p_game, 'game', 'pending', now())
  on conflict (feed_id, game_id, kind) do update
    set status = 'pending', attempts = 0, queued_at = now(),
        http_status = null, error = null, delivered_at = null;
end; $$;

revoke execute on function public.requeue_feed_delivery(uuid, uuid) from anon, public;
grant  execute on function public.requeue_feed_delivery(uuid, uuid) to authenticated;
