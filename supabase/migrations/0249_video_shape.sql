-- ============================================================================
-- 0249 - NO YOUTUBE SHORTS, THE ONES ALREADY READ INCLUDED (2026-10-07)
--
-- The readers take no Short from now on (0246: a feed's /shorts/ link, the channel's Shorts playlist). The ones read
-- before through the Data API came in under an ordinary watch address and are still about. The half-hourly reader
-- (scripts/news/fetch_feeds.py, videos.py shorts_by_shape) now looks at every video once for its SHAPE: a vertical
-- frame of three minutes at most is a Short, and goes (a video put on a game by hand is kept, marked). is_short says
-- it has been looked at: null not yet, false a video, true a Short kept by hand. The site's own ordering (feedrank.js
-- shortsLast) puts anything still tagged #shorts at the very end meanwhile.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.news_items add column if not exists is_short boolean;
comment on column public.news_items.is_short is
  '0249: looked at for its shape by the reader: null not yet, false not a Short, true a Short kept because a person put it on a game.';
create index if not exists news_items_unshaped_idx on public.news_items (published_at desc)
  where video_id is not null and is_short is null;
