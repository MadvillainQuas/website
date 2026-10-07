-- ============================================================================
-- 0241 - A VIDEO ON A GAME KEEPS ITS KIND (2026-10-07)
--
-- Every read of a YouTube channel writes each of its videos again, kind and all: the half-hourly reader's upsert
-- (scripts/news/fetch_feeds.py) and "Load now"'s (news-refresh) both set news_items.video_kind from the title. That
-- undid the matcher (0237, scripts/news/videos.py): a highlights channel's "Valencia vs Joventut", put on its game as
-- that game's highlights, was a plain 'video' again half an hour later and left the Highlights views; a full game on a
-- seeking channel the same.
--
-- So once a video is on a game, its kind is the matcher's (or the hand that linked it, set_news_item_game): an update
-- that keeps the game keeps the kind. A video put on a game, taken off one, or moved to another takes the kind it is
-- given, as before.
-- ============================================================================
set local lock_timeout = '5s';

create or replace function public.news_items_keep_video_kind()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.game_id is not null and new.game_id is not distinct from old.game_id then
    new.video_kind := old.video_kind;
  end if;
  return new;
end $$;

drop trigger if exists news_items_keep_video_kind on public.news_items;
create trigger news_items_keep_video_kind before update of video_kind on public.news_items
  for each row execute function public.news_items_keep_video_kind();

alter function public.news_items_keep_video_kind() owner to postgres;
revoke all on function public.news_items_keep_video_kind() from public, anon, authenticated;
