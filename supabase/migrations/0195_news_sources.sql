-- 0195: THE NEWS SOURCES TO START WITH (0194): the main basketball news sites of Europe and Asia (and Australia's),
-- and the official news of the leagues on Epinoia that publish a feed.
--
-- Every one was read on 2026-09-30 by the fetcher's own code (scripts/news/fetch_feeds.py: http_get, parse_feed) and
-- found to be a live feed of basketball news - at least five stories, the newest within six weeks - except U SPORTS,
-- whose feed works and is between seasons until November. Each logo is the site's own mark, read to be a picture
-- (#fill: a square with no clear ground, drawn to the edge of the card's disc; see fetch_feeds.fills_square); a
-- source with none is given one by the fetcher from its site (find_logo). The colours are the sites' own.
--
-- A LEAGUE'S OWN NEWS is that league's (league_id), so it is on the league's news page as well as the platform's;
-- a story of it about another league is that league's too (its league tags). A site that covers everything is
-- every reader's (league_id null), and each of its stories lands on the pages of the leagues it is about.
--
-- Left out: FEB's all-competitions feed (its four competition feeds below carry the same stories), and the sites that
-- refused a reader or had no working feed that day (the EuroLeague's among them). A platform administrator adds more,
-- and a league's administrators their own, from the consoles.
--
-- Re-runnable: a source already there (by its slug, or by its league and feed) is left as it is.

insert into public.news_sources (league_id, slug, name, site_url, feed_url, logo_url, colour, logo_checked_at)
select (select l.id from public.leagues l where l.slug = x.league_slug), x.slug, x.name, x.site_url, x.feed_url, x.logo_url, x.colour,
       case when x.logo_url is not null then now() end
  from (values
    -- the news sites
    ('basketnews', 'BasketNews', 'https://basketnews.com', 'https://basketnews.com/news/rss', 'https://basketnews.com/config/basketnews.lt/favicon/apple-touch-icon.png', '#f58220', null),
    ('eurohoops', 'Eurohoops', 'https://www.eurohoops.net/en/', 'https://www.eurohoops.net/en/feed/', 'https://images.eurohoops.net/2018/11/f0c0d164-2ffquqj2_400x400-200x200.png#fill', '#f38020', null),
    ('sportando', 'Sportando', 'https://sportando.basketball/en/', 'https://sportando.basketball/en/feed/', 'https://sportando.basketball/wp-content/themes/sportando9/images/favicon.ico', null, null),
    ('talkbasket', 'TalkBasket', 'https://www.talkbasket.net', 'https://www.talkbasket.net/feed', 'https://www.talkbasket.net/wp-content/uploads/2024/09/tb-square.webp', '#f47802', null),
    ('basketnews-lt', 'BasketNews.lt', 'https://www.basketnews.lt', 'https://www.basketnews.lt/news/rss', 'https://basketnews.com/config/basketnews.lt/favicon/apple-touch-icon.png', '#f58220', null),
    ('eurohoops-gr', 'Eurohoops Greece', 'https://www.eurohoops.net/el/', 'https://www.eurohoops.net/el/feed/', 'https://images.eurohoops.net/2018/11/f0c0d164-2ffquqj2_400x400-200x200.png#fill', '#f38020', null),
    ('gigantes', 'Gigantes del Basket', 'https://www.gigantes.com', 'https://www.gigantes.com/feed/', 'https://www.gigantes.com/wp-content/uploads/sites/4/2025/11/cropped-logo-G-rojo-180x180.jpg#fill', '#fc0224', null),
    ('solobasket', 'Solobasket', 'https://www.solobasket.com', 'https://www.solobasket.com/feed', 'https://www.solobasket.com/apple-touch-icon.png', '#a04100', null),
    ('pianetabasket', 'Pianeta Basket', 'https://www.pianetabasket.com', 'https://www.pianetabasket.com/sitemap/news.xml', 'https://s3-newsifier.ams3.digitaloceanspaces.com/pianetabasket2.newsifier.com/images/2026-06/favicon144-6a1429076f572-6a342d194fef5.jpg#fill', '#c7330e', null),
    ('bebasket', 'BeBasket', 'https://www.bebasket.fr', 'https://www.bebasket.fr/rss/feed.xml', 'https://www.bebasket.fr/resources/favicon-fr/apple-touch-icon.png#fill', '#d81526', null),
    ('basketfaul', 'Basketfaul', 'https://basketfaul.com.tr', 'https://basketfaul.com.tr/feed/', 'https://basketfaul.com.tr/wp-content/uploads/2023/08/cropped-Twitter-Logo-PP-180x180.png#fill', '#cf3f00', null),
    ('basket-dergisi', 'Basket Dergisi', 'https://basketdergisi.com', 'https://basketdergisi.com/feed', 'https://basketdergisi.com/wp-content/uploads/2023/12/favicon.png', '#fd631d', null),
    ('basketballking', 'Basketball King', 'https://basketballking.jp', 'https://basketballking.jp/feed', 'https://basketballking.jp/wp-content/uploads/2021/01/cropped-logo-ogp-202003-180x180.png#fill', '#ff1350', null),
    ('basket-count', 'Basket Count', 'https://basket-count.com', 'https://basket-count.com/feed', 'https://basket-count.com/wp-content/uploads/2020/02/bclogo.jpg', null, null),
    ('pick-and-roll', 'The Pick and Roll', 'https://pickandroll.com.au', 'https://pickandroll.com.au/feed', 'https://substackcdn.com/image/fetch/$s_!6qpi!,w_256,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fbucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com%2Fpublic%2Fimages%2F2d719180-4948-4a7d-947f-0e2cee135103_1280x1280.png', '#124c39', null),
    ('basketball-com-au', 'Basketball.com.au', 'https://www.basketball.com.au', 'https://www.basketball.com.au/news/rss.xml', 'https://cdn.prod.website-files.com/66de41e2655789935056f9a4/678d8ef3aabf9b67d6f2c2f1_bball_favicon_ios_touch.png', '#0fa642', null),
    -- the leagues' own
    ('b-league', 'B.LEAGUE', 'https://www.bleague.jp', 'https://www.bleague.jp/news_rss/', 'https://bleague.bl.kuroco-img.app/v=1782939722/files/user/league_common/img/libs/icon_touch.png#fill', null, 'b-league-premier'),
    ('nbl-australia', 'NBL', 'https://www.nbl.com.au', 'https://www.nbl.com.au/news/rss.xml', 'https://cdn.prod.website-files.com/64a4f0de3648103ab3295afa/64a4f2bde7da97f717e73702_Webclip.svg', '#eb2227', 'nbl'),
    ('slb-men', 'Super League Basketball', 'https://www.superleaguebasketballm.co.uk', 'https://www.superleaguebasketballm.co.uk/feed/', 'https://s3-us-west-2.amazonaws.com/gs-multisite-prod/wp-content/uploads/sites/166/2024/09/13101835/cropped-SLB_Logo_Icon_OnLight-180x180.png', '#f5822a', 'slb-men'),
    ('slb-women', 'Super League Basketball Women', 'https://www.superleaguebasketballw.co.uk', 'https://www.superleaguebasketballw.co.uk/feed/', 'https://s3-us-west-2.amazonaws.com/gs-multisite-prod/wp-content/uploads/sites/167/2024/09/03090345/cropped-SLB_Logo_Icon_OnLight-180x180.png', '#f5822a', 'slb-women'),
    ('bcb', 'British Championship Basketball', 'https://britishchampionship.basketball', 'https://britishchampionship.basketball/blogs/news.atom', 'https://britishchampionship.basketball/cdn/shop/files/Icon_Colour.png?crop=center&height=180&v=1754906450&width=180', '#268cc5', 'bcb'),
    ('2bbl', 'BARMER 2. Basketball Bundesliga', 'https://www.2basketballbundesliga.de', 'https://www.2basketballbundesliga.de/feed/', 'https://www.2basketballbundesliga.de/wp-content/themes/enfold/images/extra/logoliga.png', '#88be26', 'proa'),
    ('basket-fi', 'Basket.fi', 'https://basket.fi', 'https://basket.fi/feed/', 'https://basket.fi/wp-content/uploads/2026/06/favicon-300x300.png#fill', '#004176', 'korisliiga'),
    ('nkl', 'NKL', 'https://nkl.lt', 'https://nkl.lt/feed/', 'https://nkl.lt/wp-content/uploads/2026/07/Logo-300x300.gif', '#22715f', 'nkl'),
    ('pzkosz', 'PZKosz', 'https://pzkosz.pl', 'https://pzkosz.pl/rss', 'https://pzkosz.pl/favicon.ico', '#b60025', '1-liga-mezczyzn'),
    ('feb-liga-femenina', 'Liga Femenina Endesa (FEB)', 'https://www.feb.es/lfendesa/', 'https://www.feb.es/Servicios/RSS.ASPX?c=5', 'https://www.feb.es/apple-touch-icon.png#fill', '#ec7d2b', 'liga-femenina-endesa'),
    ('feb-liga-femenina-2', 'Liga Femenina 2 (FEB)', 'https://www.feb.es/ligafemenina2/', 'https://www.feb.es/Servicios/RSS.ASPX?c=6', 'https://www.feb.es/apple-touch-icon.png#fill', '#ec7d2b', 'liga-femenina-2'),
    ('feb-primera', 'Primera FEB', 'https://www.feb.es/primerafeb/', 'https://www.feb.es/Servicios/RSS.ASPX?c=3', 'https://www.feb.es/apple-touch-icon.png#fill', '#ec7d2b', 'primera-feb'),
    ('feb-segunda', 'Segunda FEB', 'https://www.feb.es/segundafeb/', 'https://www.feb.es/Servicios/RSS.ASPX?c=4', 'https://www.feb.es/apple-touch-icon.png#fill', '#ec7d2b', 'segunda-feb'),
    ('u-sports', 'U SPORTS basketball', 'https://en.usports.ca', 'https://en.usports.ca/sports/mbkb/headlines-featured?feed=rss_2.0', null, null, 'u-sports')
  ) as x (slug, name, site_url, feed_url, logo_url, colour, league_slug)
on conflict do nothing;
