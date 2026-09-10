-- 0105  A match report knows its game, and the card knows both clubs.
--
-- The auto reports finalise-game files were articles like any other: a title, a standfirst,
-- a body -- and a card on the league page with a colour derived from the headline, because
-- that is all a card could know. A report is about two clubs; its card should be the two
-- clubs, crest against crest, each side in its colour. So:
--
--   news_articles.game_id   the game a report is about (null for a written piece). Filled by
--                           finalise-game from now on and backfilled here from the slug the
--                           report has always carried ('report-' + the first 8 hex of the id).
--   news_public()           returns, beside the article, the two clubs' names, colours, crests
--                           and the score, so a card can be drawn without a second request.

alter table public.news_articles
  add column if not exists game_id uuid references public.games(id) on delete set null;
create index if not exists news_articles_game_idx on public.news_articles (game_id);

update public.news_articles a
   set game_id = g.id
  from public.games g
 where a.game_id is null
   and a.slug = 'report-' || left(replace(g.id::text, '-', ''), 8)
   and g.competition_id in (select c.id from public.competitions c
                             join public.seasons s on s.id = c.season_id
                            where s.league_id = a.league_id);

-- the return type changes, so the function is dropped rather than replaced
drop function if exists public.news_public(uuid, int, int);
create function public.news_public(
  p_league uuid, p_limit int default 20, p_offset int default 0
) returns table (
  id uuid, slug text, title text, standfirst text, cover_path text,
  pinned boolean, published_at timestamptz, author_name text, total bigint,
  game_id uuid, home_score int, away_score int,
  home_name text, home_short text, home_colour text, home_colour_2 text, home_logo text,
  away_name text, away_short text, away_colour text, away_colour_2 text, away_logo text
) language sql stable security definer set search_path = public as $$
  select a.id, a.slug, a.title, a.standfirst, a.cover_path,
         a.pinned, a.published_at, a.author_name, count(*) over (),
         g.id, g.home_score, g.away_score,
         h.name, h.short_name, h.colour, h.colour_2, h.logo_path,
         w.name, w.short_name, w.colour, w.colour_2, w.logo_path
    from news_articles a
    left join games g on g.id = a.game_id
    left join teams h on h.id = g.home_team_id
    left join teams w on w.id = g.away_team_id
   where a.league_id = p_league and a.status = 'published'
   order by a.pinned desc, a.published_at desc nulls last
   limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
grant execute on function public.news_public(uuid, int, int) to anon, authenticated;
