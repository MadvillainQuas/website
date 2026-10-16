-- ============================================================================
-- 0280: A LINKED PLAYER IS ONE PROFILE (Louie, 2026-10-16: "I don't want multiple profiles, I want everything all on one
-- profile (if a player is linked, merge their pages)")
--
-- The profile page now shows a linked player's rows (0178: the same person in the SLB's feed and the EuroCup's) as one page,
-- his home row's, and its follow bell saves that one id (follow.js also). What a follow brings has to reach every row of him:
--
--   link_player_ids(ids)        the ids and every row linked to them, for the database's own use
--   notify_audience             restated from 0155, character for character but fav_player_ids: a followed player's linked
--                               rows ride along, so his line after a EuroCup game reaches a fan who followed his SLB row
--   linked_player_ids(ids)      the same for a page (Your Dashboard's latest lines): { followed id: [his rows] }, for the
--                               ids asked about that are linked to something. Link groups are public already (linked_players).
--
-- Nothing is merged or moved: every row and stat line stays where it was written, and an unlink is still one click.
-- ============================================================================

create or replace function public.link_player_ids(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select unnest(coalesce(p_ids, '{}'::uuid[])) x
    union
    select m2.player_id from public.player_group_members m1
      join public.player_group_members m2 on m2.group_id = m1.group_id
     where m1.player_id = any (coalesce(p_ids, '{}'::uuid[]))
  ) u;
$$;
revoke all on function public.link_player_ids(uuid[]) from public, anon, authenticated;
alter function public.link_player_ids(uuid[]) owner to postgres;

-- 0155's view, the same columns in the same order (so a CREATE OR REPLACE), fav_player_ids widened to his linked rows
create or replace view public.notify_audience as
  select r.user_id, r.device_id, r.sub,
         r.fav_team_ids,
         case when cardinality(r.fav_player_ids) > 0 then public.link_player_ids(r.fav_player_ids) else r.fav_player_ids end as fav_player_ids,
         r.fav_game_ids,
         r.want_results, r.want_players, r.want_fixtures, r.want_announcements,
         r.want_fixture_2d, r.want_fixture_2h, r.want_lineups, r.want_player_games, r.want_halftime,
         r.fav_league_ids, r.time_zone
    from public.notify_audience_rows r;
revoke all on table public.notify_audience from public, anon, authenticated;
alter view public.notify_audience owner to postgres;

-- a page's question: which of these players are linked, and to which rows (at most 200 asked at once)
create or replace function public.linked_player_ids(p_ids uuid[])
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(a.id, a.rows), '{}'::jsonb) from (
    select m1.player_id id, jsonb_agg(m2.player_id order by m2.linked_at, m2.player_id) rows
      from public.player_group_members m1
      join public.player_group_members m2 on m2.group_id = m1.group_id
     where m1.player_id = any ((coalesce(p_ids, '{}'::uuid[]))[1:200])
     group by m1.player_id
  ) a;
$$;
revoke all on function public.linked_player_ids(uuid[]) from public;
grant execute on function public.linked_player_ids(uuid[]) to anon, authenticated, service_role;
