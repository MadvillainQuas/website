-- ============================================================================
-- 0237 - HIGHLIGHTS FROM A CHANNEL'S FEED, THE VIDEO FEED, AND THE LIVE CHAT (2026-10-07)
--
-- 1. WHAT A CHANNEL'S VIDEOS ARE FOR. A YouTube channel added as a news source (0194/0198) was read as stories:
--    tagged with leagues, never with a game. news_sources.video_mode says what its videos become when one is
--    matched to a game (scripts/news/fetch_feeds.py, match_videos):
--        'highlights'  the game's highlights: shown on the league's Video tab and the game, played as they are
--        'seeking'     the game's full broadcast: attached as the game's primary video (game_videos), so the
--                      game page seeks it to each play once the clock is read, as an ingest-found stream is
--        'off'         news only, as before this file
--    A video titled as highlights ("Highlights", "Resumen", "ハイライト", "Skrót meczu" ...) is a highlight in
--    either mode: a broadcast channel's highlight reel is not the broadcast.
--
-- 2. news_items carries the video: its YouTube id, what kind it is ('highlights' | 'full' | 'video', from its
--    title and its channel's mode), and the game it was matched to. game_locked marks a link (or an unlink)
--    made by hand: the fetcher never changes it again.
--
-- 3. THE READS: league_videos (a league's Video tab), game_highlights (one game's), video_feed and
--    video_feed_mine (HOME's video feed, in news_feed's columns plus the video's). Every one of them shows a
--    video only where its source, its league and its game may be seen, as news_feed does.
--
-- 4. THE LIVE CHAT. game_chat holds one row per message. Nothing is written by a reader: the edge function
--    `chat` checks the poster (chat_gate: signed in, a username, 18 or over confirmed as for GO's photographs,
--    a league that has its chat on and is not a youth league, a game that is on now, the word list, no links,
--    a slow-down), has the message read by the moderator model, and stores it (chat_store) as 'shown' or
--    'blocked'. A blocked message is kept for the record and shown to nobody. Shown messages are sent on the
--    public broadcast topic chat:<game> (as 0157 sends a game's frames), and read back with game_chat.
--    Three reports take a message down; its author, the league's admins and the platform's can too.
--    No read here ever returns a user id.
-- ============================================================================
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------- columns ---
alter table public.news_sources add column if not exists video_mode text not null default 'highlights';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'news_sources_video_mode_check') then
    alter table public.news_sources add constraint news_sources_video_mode_check
      check (video_mode in ('highlights', 'seeking', 'off'));
  end if;
end $$;

alter table public.news_items add column if not exists video_id    text;
alter table public.news_items add column if not exists video_kind  text;
alter table public.news_items add column if not exists game_id     uuid references public.games(id) on delete set null;
alter table public.news_items add column if not exists game_locked boolean not null default false;
alter table public.news_items add column if not exists matched_at  timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'news_items_video_kind_check') then
    alter table public.news_items add constraint news_items_video_kind_check
      check (video_kind is null or video_kind in ('highlights', 'full', 'video'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_items_video_id_check') then
    alter table public.news_items add constraint news_items_video_id_check
      check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{6,20}$');
  end if;
end $$;
create index if not exists news_items_game_idx  on public.news_items (game_id) where game_id is not null;
create index if not exists news_items_video_idx on public.news_items (published_at desc) where video_id is not null;

alter table public.leagues add column if not exists chat_enabled boolean not null default true;

-- --------------------------------------------------------------------------------------- the chat tables ---
create table if not exists public.game_chat (
  id           bigint generated always as identity primary key,
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  username     text not null,
  avatar_url   text,
  body         text not null check (char_length(body) between 1 and 280),
  status       text not null check (status in ('shown', 'blocked', 'hidden')),
  mod_category text,
  mod_reason   text,
  mod_model    text,
  reports      int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists game_chat_game_idx on public.game_chat (game_id, id) where status = 'shown';
create index if not exists game_chat_user_idx on public.game_chat (user_id, created_at desc);
alter table public.game_chat enable row level security;
revoke all on public.game_chat from anon, authenticated;

create table if not exists public.game_chat_reports (
  chat_id    bigint not null references public.game_chat(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
alter table public.game_chat_reports enable row level security;
revoke all on public.game_chat_reports from anon, authenticated;

-- ------------------------------------------------------------------------------------------- the source ---
/* what a channel's matched videos become; the console's three-way switch */
create or replace function public.set_news_video_mode(p_id uuid, p_mode text)
returns boolean language plpgsql security definer set search_path = public as $$
declare lg uuid;
begin
  if p_mode not in ('highlights', 'seeking', 'off') then
    raise exception 'video mode must be highlights, seeking or off' using errcode = '22023';
  end if;
  select league_id into lg from news_sources where id = p_id;
  if not found then return false; end if;
  if not public.can_manage_news_sources(lg) or (lg is null and not public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update news_sources set video_mode = p_mode where id = p_id;
  return true;
end $$;

/* the modes and how many videos each source has matched to a game, for the sources a console lists */
create or replace function public.news_video_modes(p_ids uuid[])
returns table (id uuid, video_mode text, videos int, matched int)
language sql stable security definer set search_path = public as $$
  select s.id, s.video_mode,
         (select count(*)::int from news_items i where i.source_id = s.id and i.video_id is not null),
         (select count(*)::int from news_items i where i.source_id = s.id and i.game_id is not null)
    from news_sources s
   where s.id = any (coalesce(p_ids, '{}')) and public.can_manage_news_sources(s.league_id);
$$;

/* the league a game is played in */
create or replace function public.game_league_id(p_game uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.league_id from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id
   where g.id = p_game;
$$;

/* a video put on a game (or taken off it, p_game null) by hand; the fetcher leaves it so from then on */
create or replace function public.set_news_item_game(p_item uuid, p_game uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare src uuid;
begin
  select s.league_id into src from news_items i join news_sources s on s.id = i.source_id where i.id = p_item;
  if not found then return false; end if;
  if not (public.can_manage_news_sources(src)
          or (p_game is not null and auth.uid() is not null and public.is_league_admin(public.game_league_id(p_game)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update news_items set game_id = p_game, game_locked = true, matched_at = now(),
                        video_kind = case when p_game is not null and video_kind = 'video' then 'highlights' else video_kind end
   where id = p_item;
  return true;
end $$;

-- ------------------------------------------------------------------------------------------- the reads ---
/* a game as a video tile shows it: the two clubs, the score, when, and its league */
create or replace function public.video_game_json(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', g.id, 'status', g.status, 'tipoff_at', g.tipoff_at,
           'home_score', g.home_score, 'away_score', g.away_score,
           'home', jsonb_build_object('name', h.name, 'short', h.short_name, 'slug', h.slug, 'logo', h.logo_path, 'colour', h.colour),
           'away', jsonb_build_object('name', a.name, 'short', a.short_name, 'slug', a.slug, 'logo', a.logo_path, 'colour', a.colour),
           'league', jsonb_build_object('slug', l.slug, 'name', l.name, 'logo', l.logo_path, 'colour', l.colour_a),
           'competition', c.name)
    from games g
    join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id
    left join competitions c on c.id = g.competition_id left join seasons s on s.id = c.season_id
    left join leagues l on l.id = s.league_id
   where g.id = p_game and public.game_visible(g.id);
$$;

/* whether a video may be shown: its source is on, its source's league may be seen, and so may its game */
create or replace function public.video_item_visible(p_source uuid, p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from news_sources s where s.id = p_source and s.enabled
                   and (s.league_id is null or public.league_visible(s.league_id)))
     and (p_game is null or (public.game_visible(p_game) and public.league_visible(public.game_league_id(p_game))));
$$;

/* A LEAGUE'S VIDEO TAB: its games' highlights first (p_kind 'highlights'), or every video about the league
   (p_kind null): the videos of its games, of its own sources, and those tagged with it. Newest first. */
create or replace function public.league_videos(p_league uuid, p_kind text default null, p_before timestamptz default null,
                                                p_limit int default 24)
returns table (id uuid, title text, url text, video_id text, video_kind text, image_url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_slug text, game jsonb)
language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.url, i.video_id, i.video_kind, i.image_url, i.published_at,
         s.name, s.logo_url, s.colour, s.slug,
         case when i.game_id is not null then public.video_game_json(i.game_id) end
    from news_items i join news_sources s on s.id = i.source_id
   where public.league_visible(p_league)
     and i.video_id is not null and s.video_mode <> 'off'
     and i.published_at < coalesce(p_before, 'infinity'::timestamptz)
     and (p_kind is null or i.video_kind = p_kind)
     and (case when i.game_id is not null then public.game_league_id(i.game_id) = p_league
               else p_kind is distinct from 'highlights'
                    and (s.league_id = p_league or p_league = any (i.league_ids)
                         or (s.league_id is null and p_league = any (s.assigned_leagues))) end)
     and public.video_item_visible(s.id, i.game_id)
   order by i.published_at desc, i.id
   limit greatest(1, least(coalesce(p_limit, 24), 60));
$$;

/* one game's videos (its highlights, and any other video matched to it) */
create or replace function public.game_highlights(p_game uuid)
returns table (id uuid, title text, url text, video_id text, video_kind text, image_url text, published_at timestamptz,
               source_name text, source_logo text, source_slug text)
language sql stable security definer set search_path = public as $$
  select i.id, i.title, i.url, i.video_id, i.video_kind, i.image_url, i.published_at, s.name, s.logo_url, s.slug
    from news_items i join news_sources s on s.id = i.source_id
   where i.game_id = p_game and i.video_id is not null and s.video_mode <> 'off'
     and public.video_item_visible(s.id, p_game)
   order by (i.video_kind = 'highlights') desc, i.published_at desc
   limit 12;
$$;

/* HOME'S VIDEO FEED, in news_feed's columns (so newscard.js and feedrank.js take its rows as they are) and the
   video's own: its id, its kind and its game. p_kind 'highlights' or 'video' ('video' = everything but
   highlights), null = both. A video matched to a game carries that game's league among its tags. */
create or replace function public.video_feed(p_league uuid default null, p_kind text default null,
                                             p_before timestamptz default null, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb, video_id text, video_kind text, game jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before)
  select case when s.kind = 'creator' then 'channel' else 'outlet' end, i.id, i.title, i.summary, i.image_url, i.url,
         i.published_at, s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(gl.slug, l.slug, t.slug),
         coalesce(gl.name, l.name, t.name), null::text, null::text, 'youtube'::text, i.author,
         public.news_item_leagues(case when gl.id is null then i.league_ids else array_prepend(gl.id, i.league_ids) end,
                                  s.league_id),
         i.video_id, i.video_kind,
         case when i.game_id is not null then public.video_game_json(i.game_id) end
    from news_items i join news_sources s on s.id = i.source_id
         left join leagues l on l.id = s.league_id left join leagues t on t.id = i.league_ids[1]
         left join leagues gl on gl.id = public.game_league_id(i.game_id), lim
   where i.video_id is not null and s.video_mode <> 'off' and i.published_at < lim.before
     and (p_kind is null or (p_kind = 'highlights' and i.video_kind = 'highlights')
          or (p_kind = 'video' and i.video_kind is distinct from 'highlights'))
     and public.video_item_visible(s.id, i.game_id)
     and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids) or gl.id = p_league
                                or (s.league_id is null and p_league = any (s.assigned_leagues)))
                               and public.league_visible(p_league)))
   order by i.published_at desc, i.id
   limit (select n from lim);
$$;

/* the same, for the leagues, clubs and sources a signed-in fan follows */
create or replace function public.video_feed_mine(p_kind text default null, p_before timestamptz default null, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb, video_id text, video_kind text, game jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select f.fav_league_ids || coalesce((select array_agg(distinct t.league_id) from teams t
                                          where t.id = any (f.fav_team_ids) and t.league_id is not null), '{}') as leagues,
           f.fav_team_ids as clubs, f.fav_source_ids as sources
      from fan_prefs f where f.user_id = auth.uid()
  )
  select v.* from public.video_feed(null, p_kind, p_before, 60) v, me
   where exists (select 1 from news_items i join news_sources s on s.id = i.source_id
                  where i.id = v.id
                    and (s.id = any (me.sources) or s.league_id = any (me.leagues) or i.league_ids && me.leagues
                         or (s.league_id is null and s.assigned_leagues && me.leagues)
                         or public.game_league_id(i.game_id) = any (me.leagues)
                         or exists (select 1 from games g where g.id = i.game_id
                                     and (g.home_team_id = any (me.clubs) or g.away_team_id = any (me.clubs)))))
   limit greatest(1, least(coalesce(p_limit, 30), 60));
$$;

-- -------------------------------------------------------------------------------------------- the chat ---
/* whether a game's chat may be read: a public, open league with its chat on that is not a youth league */
create or replace function public.chat_open_league(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id
                  join leagues l on l.id = s.league_id
                 where g.id = p_game and l.visibility = 'public' and l.access_mode = 'open'
                   and l.chat_enabled and coalesce(l.go_photos, true));
$$;

/* whether a game is on now, for posting: from half an hour before tip-off to three hours after it ends */
create or replace function public.chat_game_on(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g
                 where g.id = p_game
                   and (g.status in ('live', 'finalising')
                        or (g.status = 'scheduled' and g.tipoff_at between now() - interval '3 hours' and now() + interval '30 minutes')
                        or (g.status = 'final' and coalesce(g.tipoff_at, now()) > now() - interval '5 hours')));
$$;

/* THE GATE, for the edge function only (service role): may this person post this, here, now? Returns
   {ok, reason, username, avatar, league, home, away}; reasons: signed_out, banned, username, adult, closed,
   not_now, empty, long, words, link, slow, muted, day_full. p_adult is the person ticking "I am 18 or over",
   recorded as for GO's photographs (0167). */
create or replace function public.chat_gate(p_user uuid, p_game uuid, p_body text, p_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  b text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  un text; av text; ctx record;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if exists (select 1 from auth.users u where u.id = p_user and u.banned_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;
  select username into un from usernames where user_id = p_user;
  if un is null then return jsonb_build_object('ok', false, 'reason', 'username'); end if;
  if not exists (select 1 from go_settings where user_id = p_user and adult_confirmed_at is not null) then
    if not coalesce(p_adult, false) then return jsonb_build_object('ok', false, 'reason', 'adult'); end if;
    insert into go_settings (user_id, public, adult_confirmed_at) values (p_user, false, now())
    on conflict (user_id) do update set adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, now()), updated_at = now();
  end if;
  if not public.chat_open_league(p_game) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if not public.chat_game_on(p_game) then return jsonb_build_object('ok', false, 'reason', 'not_now'); end if;
  if b = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(b) > 280 then return jsonb_build_object('ok', false, 'reason', 'long'); end if;
  if not public.go_caption_ok(b) then return jsonb_build_object('ok', false, 'reason', 'words'); end if;
  if b ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|gg|tv|ly|me|co|uk|es|de|fr|it|jp)\M)' then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;
  -- a slow-down: one message every four seconds, fifteen in two minutes, three hundred a day; three blocked
  -- in ten minutes and the poster waits ten minutes from the last
  if exists (select 1 from game_chat where user_id = p_user and created_at > now() - interval '4 seconds')
     or (select count(*) from game_chat where user_id = p_user and created_at > now() - interval '2 minutes') >= 15 then
    return jsonb_build_object('ok', false, 'reason', 'slow');
  end if;
  if (select count(*) from game_chat where user_id = p_user and status = 'blocked' and created_at > now() - interval '10 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'muted');
  end if;
  if (select count(*) from game_chat where user_id = p_user and created_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'day_full');
  end if;
  select fp.avatar_url into av from fan_profiles fp join go_settings gs on gs.user_id = fp.user_id
   where fp.user_id = p_user and gs.public and gs.adult_confirmed_at is not null and fp.avatar_url ~ '^https://';
  select l.name as league, h.name as home, a.name as away into ctx
    from games g join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id
    join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id join leagues l on l.id = s.league_id
   where g.id = p_game;
  return jsonb_build_object('ok', true, 'username', un, 'avatar', av, 'body', b,
                            'league', ctx.league, 'home', ctx.home, 'away', ctx.away);
end $$;

/* the message, once the gate and the moderator have read it (service role) */
create or replace function public.chat_store(p_user uuid, p_game uuid, p_body text, p_username text, p_avatar text,
                                             p_status text, p_category text default null, p_reason text default null,
                                             p_model text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if p_status not in ('shown', 'blocked') then raise exception 'status must be shown or blocked'; end if;
  insert into game_chat (game_id, user_id, username, avatar_url, body, status, mod_category, mod_reason, mod_model)
  values (p_game, p_user, p_username, p_avatar, left(p_body, 280), p_status, left(p_category, 40), left(p_reason, 200), left(p_model, 60))
  returning id into v;
  return v;
end $$;

/* what a reader sees: the shown messages after p_after (or the latest p_limit), oldest first */
create or replace function public.game_chat_read(p_game uuid, p_after bigint default null, p_limit int default 80)
returns table (id bigint, username text, avatar_url text, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select * from (
    select c.id, c.username, c.avatar_url, c.body, c.created_at, (auth.uid() is not null and c.user_id = auth.uid())
      from game_chat c
     where c.game_id = p_game and c.status = 'shown' and (p_after is null or c.id > p_after)
       and public.chat_open_league(p_game) and public.game_visible(p_game)
     order by c.id desc
     limit greatest(1, least(coalesce(p_limit, 80), 200))
  ) x order by x.id;
$$;

/* the reader's own standing, so the box can say what is missing before anything is typed */
create or replace function public.chat_my_status(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'signed_in', auth.uid() is not null,
           'username', (select username from usernames where user_id = auth.uid()),
           'adult', exists (select 1 from go_settings where user_id = auth.uid() and adult_confirmed_at is not null),
           'open', public.chat_open_league(p_game),
           'on', public.chat_game_on(p_game),
           'admin', auth.uid() is not null and (public.is_platform_admin() or public.is_league_admin(public.game_league_id(p_game))));
$$;

/* three reports take a message down */
create or replace function public.report_chat(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from game_chat where id = p_id and status = 'shown' and user_id <> auth.uid()) then return false; end if;
  insert into game_chat_reports (chat_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  select count(*) into n from game_chat_reports where chat_id = p_id;
  update game_chat set reports = n, status = case when n >= 3 then 'hidden' else status end where id = p_id;
  return true;
end $$;

/* its author, the league's admins or the platform's take it down at once */
create or replace function public.hide_chat(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from game_chat where id = p_id;
  if not found or auth.uid() is null then return false; end if;
  if not (c.user_id = auth.uid() or public.is_platform_admin() or public.is_league_admin(public.game_league_id(c.game_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update game_chat set status = 'hidden' where id = p_id and status <> 'hidden';
  return true;
end $$;

/* THE LIVE COPY. A shown message is sent on chat:<game> as 'msg', a message taken down as 'hide' - public
   broadcasts (as 0157's frames), so a reader needs no account to follow the room. Never the user id. */
create or replace function public.game_chat_broadcast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'shown' then
    perform realtime.send(jsonb_build_object('id', new.id, 'u', new.username, 'a', new.avatar_url, 'b', new.body,
                                             'at', new.created_at),
                          'msg', 'chat:' || new.game_id, false);
  elsif tg_op = 'UPDATE' and old.status = 'shown' and new.status <> 'shown' then
    perform realtime.send(jsonb_build_object('id', new.id), 'hide', 'chat:' || new.game_id, false);
  end if;
  return null;
end $$;
drop trigger if exists game_chat_broadcast on public.game_chat;
create trigger game_chat_broadcast after insert or update of status on public.game_chat
  for each row execute function public.game_chat_broadcast();

-- ------------------------------------------------------------------------------------------- the grants ---
alter function public.set_news_video_mode(uuid, text) owner to postgres;
alter function public.news_video_modes(uuid[]) owner to postgres;
alter function public.game_league_id(uuid) owner to postgres;
alter function public.set_news_item_game(uuid, uuid) owner to postgres;
alter function public.video_game_json(uuid) owner to postgres;
alter function public.video_item_visible(uuid, uuid) owner to postgres;
alter function public.league_videos(uuid, text, timestamptz, int) owner to postgres;
alter function public.game_highlights(uuid) owner to postgres;
alter function public.video_feed(uuid, text, timestamptz, int) owner to postgres;
alter function public.video_feed_mine(text, timestamptz, int) owner to postgres;
alter function public.chat_open_league(uuid) owner to postgres;
alter function public.chat_game_on(uuid) owner to postgres;
alter function public.chat_gate(uuid, uuid, text, boolean) owner to postgres;
alter function public.chat_store(uuid, uuid, text, text, text, text, text, text, text) owner to postgres;
alter function public.game_chat_read(uuid, bigint, int) owner to postgres;
alter function public.chat_my_status(uuid) owner to postgres;
alter function public.report_chat(bigint) owner to postgres;
alter function public.hide_chat(bigint) owner to postgres;
alter function public.game_chat_broadcast() owner to postgres;

revoke all on function public.set_news_video_mode(uuid, text) from public, anon;
revoke all on function public.news_video_modes(uuid[]) from public, anon;
revoke all on function public.game_league_id(uuid) from public, anon, authenticated;
revoke all on function public.set_news_item_game(uuid, uuid) from public, anon;
revoke all on function public.video_game_json(uuid) from public, anon, authenticated;
revoke all on function public.video_item_visible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.league_videos(uuid, text, timestamptz, int) from public;
revoke all on function public.game_highlights(uuid) from public;
revoke all on function public.video_feed(uuid, text, timestamptz, int) from public;
revoke all on function public.video_feed_mine(text, timestamptz, int) from public, anon;
revoke all on function public.chat_open_league(uuid) from public, anon, authenticated;
revoke all on function public.chat_game_on(uuid) from public, anon, authenticated;
revoke all on function public.chat_gate(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.chat_store(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.game_chat_read(uuid, bigint, int) from public;
revoke all on function public.chat_my_status(uuid) from public;
revoke all on function public.report_chat(bigint) from public, anon;
revoke all on function public.hide_chat(bigint) from public, anon;
revoke all on function public.game_chat_broadcast() from public, anon, authenticated;

grant execute on function public.set_news_video_mode(uuid, text) to authenticated;
grant execute on function public.news_video_modes(uuid[]) to authenticated;
grant execute on function public.set_news_item_game(uuid, uuid) to authenticated;
grant execute on function public.league_videos(uuid, text, timestamptz, int) to anon, authenticated;
grant execute on function public.game_highlights(uuid) to anon, authenticated;
grant execute on function public.video_feed(uuid, text, timestamptz, int) to anon, authenticated;
grant execute on function public.video_feed_mine(text, timestamptz, int) to authenticated;
grant execute on function public.chat_gate(uuid, uuid, text, boolean) to service_role;
grant execute on function public.chat_store(uuid, uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.game_chat_read(uuid, bigint, int) to anon, authenticated;
grant execute on function public.chat_my_status(uuid) to anon, authenticated;
grant execute on function public.report_chat(bigint) to authenticated;
grant execute on function public.hide_chat(bigint) to authenticated;

-- ------------------------------------------------------------------------------------------- self-check ---
do $$
declare r record;
begin
  -- no read a page calls returns a user id
  for r in select p.proname, pg_get_function_result(p.oid) as res from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('league_videos', 'game_highlights', 'video_feed', 'video_feed_mine', 'game_chat_read')
  loop
    if r.res ~* 'user_id' then raise exception '0237: % returns a user id', r.proname; end if;
  end loop;
  if has_function_privilege('anon', 'public.chat_store(uuid, uuid, text, text, text, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.chat_gate(uuid, uuid, text, boolean)', 'execute') then
    raise exception '0237: the chat writes are open to readers';
  end if;
end $$;

notify pgrst, 'reload schema';
