-- ============================================================================
-- 0252 — THE NEWSROOM LEARNS: from the articles it is fed, and from what readers open.
--
-- The league newsdesk (epinoia/narrative.js) writes its own articles beside the storylines (epinoia/newsroom.js,
-- built every hour by tools/build-narratives.mjs into each league's public newsdesk file). Two things teach it, and
-- both live here:
--
--   newsroom_style   ARTICLES FED TO IT, in the platform console's Newsroom tab: a title, where it came from, the
--                    text. The hourly build reads them (service role) and digests each for its phrasing - the verbs a
--                    writer uses for a rout and a narrow win, a hot hand and a cold one, how a paragraph opens and an
--                    argument turns, the shapes of question headlines - never a sentence of anybody's. Platform
--                    administrators only: nobody else reads or writes a row.
--
--   feed_ctr         WHAT READERS ARE SHOWN AND WHAT THEY OPEN, per item and per day: the click-through the newsroom
--                    trains on. An item is 'league:<id>' / 'creator:<id>' / 'outlet:<id>' / 'channel:<id>' (a row of
--                    news_feed) or 'desk:<league>:<article>' (a newsroom piece); variant is the headline shown when a
--                    piece is testing more than one. Counts only: no visitor, no session, no address, nothing that
--                    could be tied to a person. Nobody reads the table but the service role.
--
--   feed_track()     the page's one call, from feedrank.js / newsdesk.js after a visit's feed has been seen (and at
--                    the moment a card is opened): the items shown, the items opened. Anonymous, bounded (60 shown,
--                    10 opened a call, keys of the four shapes above only), and sent only where the site's visit
--                    counting is (config analytics: true, not Do Not Track or GPC, not opted out, not staff, not a robot:
--                    track.js decides).
--
--   feed_ctr_totals() the hourly build's one read (service role only): every item's shown and opened over the last
--                    p_days, each day counting half as much as fourteen days later ("what readers open now"), with the
--                    title and kind the item had, so the click-through model can be fitted on the headlines.
--
--   team_rivals      TWO CLUBS AN ADMINISTRATOR CALLS RIVALS (team_rival_set, team_rivals_of; from a club's page): their
--                    games are bigger news on the newsdesk, and a match report of one is worth 20 points more in the feed
--                    (news_report_significance, redefined below with them).
--
-- Statements are idempotent, so a push stopped half way can be pushed again.
-- ============================================================================

set local lock_timeout = '5s';

-- ------------------------------------------------------------------ the style library ---
create table if not exists public.newsroom_style (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '' check (length(title) <= 300),
  source      text not null default '' check (length(source) <= 300),
  body        text not null check (length(body) between 200 and 60000),
  learned     jsonb not null default '{}'::jsonb,          -- what the console showed it taught, for the list
  created_by  uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists newsroom_style_at on public.newsroom_style (created_at desc);

alter table public.newsroom_style enable row level security;
drop policy if exists newsroom_style_admin on public.newsroom_style;
create policy newsroom_style_admin on public.newsroom_style for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.newsroom_style from public, anon;
grant select, insert, update, delete on public.newsroom_style to authenticated;
grant all on public.newsroom_style to service_role;

-- ------------------------------------------------------------- the click-through counts ---
create table if not exists public.feed_ctr (
  day      date not null,
  item     text not null check (item ~ '^(league|creator|outlet|channel):[0-9a-f-]{36}$|^desk:[0-9a-f-]{36}:[A-Za-z0-9:._-]{3,120}$'),
  variant  smallint not null default 0 check (variant between 0 and 7),
  shown    integer not null default 0,
  opened   integer not null default 0,
  primary key (day, item, variant)
);
create index if not exists feed_ctr_item on public.feed_ctr (item);
alter table public.feed_ctr enable row level security;      -- no policy: only the service role reads or writes it directly
revoke all on public.feed_ctr from public, anon, authenticated;
grant all on public.feed_ctr to service_role;

/* one visit's feed: what it was shown and what it opened. An entry is the item, or 'item~v' for headline variant v. */
create or replace function public.feed_track(p_shown text[], p_opened text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'utc')::date;
  e text; it text; v int;
  re constant text := '^(league|creator|outlet|channel):[0-9a-f-]{36}$|^desk:[0-9a-f-]{36}:[A-Za-z0-9:._-]{3,120}$';
begin
  if coalesce(array_length(p_shown, 1), 0) > 60 or coalesce(array_length(p_opened, 1), 0) > 10 then return; end if;
  foreach e in array (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_shown, '{}')) x) loop
    it := split_part(e, '~', 1);
    v := case when e ~ '~[0-7]$' then right(e, 1)::int else 0 end;
    continue when it !~ re;
    insert into feed_ctr (day, item, variant, shown) values (d, it, v, 1)
      on conflict (day, item, variant) do update set shown = feed_ctr.shown + 1;
  end loop;
  foreach e in array (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_opened, '{}')) x) loop
    it := split_part(e, '~', 1);
    v := case when e ~ '~[0-7]$' then right(e, 1)::int else 0 end;
    continue when it !~ re;
    insert into feed_ctr (day, item, variant, opened) values (d, it, v, 1)
      on conflict (day, item, variant) do update set opened = feed_ctr.opened + 1;
  end loop;
end $$;
revoke all on function public.feed_track(text[], text[]) from public;
grant execute on function public.feed_track(text[], text[]) to anon, authenticated, service_role;

/* the hourly build's read: decayed totals per item and variant, with the item's title and kind where the site holds it */
create or replace function public.feed_ctr_totals(p_days int default 30)
returns table (item text, variant smallint, shown numeric, opened numeric, title text, kind text, league_slug text, published_at timestamptz, report boolean)
language sql stable security definer set search_path = public as $$
  with c as (
    select f.item, f.variant,
           sum(f.shown  * power(0.5, ((now() at time zone 'utc')::date - f.day) / 14.0)) as shown,
           sum(f.opened * power(0.5, ((now() at time zone 'utc')::date - f.day) / 14.0)) as opened
      from feed_ctr f
     where f.day >= (now() at time zone 'utc')::date - greatest(1, least(coalesce(p_days, 30), 120))
     group by f.item, f.variant
  )
  select c.item, c.variant, round(c.shown, 3), round(c.opened, 3),
         coalesce(a.title, p.title, i.title), split_part(c.item, ':', 1),
         coalesce(la.slug, lp.slug, li.slug), coalesce(a.published_at, p.published_at, i.published_at),
         coalesce(a.author_name = 'Epinoia match report', false)
    from c
    left join news_articles a  on c.item like 'league:%'  and a.id = nullif(split_part(c.item, ':', 2), '')::uuid
    left join leagues la       on la.id = a.league_id
    left join creator_posts p  on c.item like 'creator:%' and p.id = nullif(split_part(c.item, ':', 2), '')::uuid
    left join leagues lp       on lp.id = p.league_id
    left join news_items i     on (c.item like 'outlet:%' or c.item like 'channel:%') and i.id = nullif(split_part(c.item, ':', 2), '')::uuid
    left join news_sources s   on s.id = i.source_id
    left join leagues li       on li.id = s.league_id;
$$;
revoke all on function public.feed_ctr_totals(int) from public, anon, authenticated;
grant execute on function public.feed_ctr_totals(int) to service_role;

/* a year is plenty: the model reads thirty days, and the console's "what works" ninety */
create or replace function public.feed_ctr_prune()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from feed_ctr where day < (now() at time zone 'utc')::date - 365 returning 1) select count(*)::int from d;
$$;
revoke all on function public.feed_ctr_prune() from public, anon, authenticated;
grant execute on function public.feed_ctr_prune() to service_role;

-- ------------------------------------------------------------------------ the rivals ---
-- TWO CLUBS AN ADMINISTRATOR CALLS RIVALS (Barça and Real Madrid): set from a club's page ("edit links", linkedit.js) by
-- a platform administrator. A rivalry is news on its own: the newsdesk raises its games' stakes (the slate, the game to
-- watch, the newsroom's pieces) and a match report of one gets its points in the feed (news_report_significance, below).
-- Public to read: a rivalry is nobody's secret. Each pair is kept once, the lesser id first.
create table if not exists public.team_rivals (
  team_a      uuid not null references public.teams on delete cascade,
  team_b      uuid not null references public.teams on delete cascade,
  created_by  uuid default auth.uid() references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  primary key (team_a, team_b),
  constraint team_rivals_order check (team_a < team_b)
);
create index if not exists team_rivals_b on public.team_rivals (team_b);
alter table public.team_rivals enable row level security;
drop policy if exists team_rivals_read on public.team_rivals;
create policy team_rivals_read on public.team_rivals for select using (true);
revoke all on public.team_rivals from public, anon, authenticated;
grant select on public.team_rivals to anon, authenticated;
grant all on public.team_rivals to service_role;

/* mark or unmark two clubs as rivals: platform administrators only */
create or replace function public.team_rival_set(p_a uuid, p_b uuid, p_on boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare a uuid := least(p_a, p_b); b uuid := greatest(p_a, p_b);
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if a is null or b is null or a = b then
    raise exception 'two different clubs' using errcode = '22023';
  end if;
  if coalesce(p_on, true) then
    insert into team_rivals (team_a, team_b) values (a, b) on conflict do nothing;
  else
    delete from team_rivals where team_a = a and team_b = b;
  end if;
  return coalesce(p_on, true);
end $$;
revoke all on function public.team_rival_set(uuid, uuid, boolean) from public, anon;
grant execute on function public.team_rival_set(uuid, uuid, boolean) to authenticated;

/* a club's rivals, for its page and the links panel */
create or replace function public.team_rivals_of(p_team uuid)
returns table (id uuid, name text, slug text, league text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, l.name
    from team_rivals r
    join teams t on t.id = case when r.team_a = p_team then r.team_b else r.team_a end
    left join leagues l on l.id = t.league_id
   where (r.team_a = p_team or r.team_b = p_team) and (l.id is null or public.league_visible(l.id))
   order by t.name;
$$;
revoke all on function public.team_rivals_of(uuid) from public;
grant execute on function public.team_rivals_of(uuid) to anon, authenticated;

/* A MATCH REPORT OF A RIVALRY GAME IS WORTH MORE IN THE FEED: the report's game's significance (0202), and 20 points with
   the reason 'A rivalry' when its two clubs are rivals - a report with nothing else to it now has those */
create or replace function public.news_report_significance(p_article_ids uuid[])
returns table (article_id uuid, game_id uuid, points int, reasons text[])
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := coalesce(p_article_ids, '{}'::uuid[]);
begin
  return query
  with a as (
    select n.id, n.game_id
      from news_articles n
     where n.id = any (v[1:60]) and n.status = 'published' and n.game_id is not null and public.league_visible(n.league_id)
  ),
  s as (select x.game_id, x.points, x.reasons from public.game_significance((select array_agg(distinct y.game_id) from a y)) x),
  rv as (
    select distinct a.game_id
      from a join games g on g.id = a.game_id
      join team_rivals r on r.team_a = least(g.home_team_id, g.away_team_id) and r.team_b = greatest(g.home_team_id, g.away_team_id)
  )
  select a.id, a.game_id,
         (coalesce(s.points, 0) + case when rv.game_id is not null then 20 else 0 end)::int,
         coalesce(s.reasons, '{}'::text[]) || case when rv.game_id is not null then array['A rivalry'] else '{}'::text[] end
    from a
    left join s on s.game_id = a.game_id
    left join rv on rv.game_id = a.game_id
   where s.game_id is not null or rv.game_id is not null;
end $$;
revoke all on function public.news_report_significance(uuid[]) from public, anon;
grant execute on function public.news_report_significance(uuid[]) to anon, authenticated;
