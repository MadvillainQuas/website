-- ============================================================================
-- 0240 - A CHANNEL'S OWN NAMES FOR CLUBS, FOR THE VIDEO MATCHER (2026-10-07)
--
-- The matcher (scripts/news/videos.py, 0237) finds the clubs a video's title names from the clubs' own names: the
-- full name, the short name, the native spellings, a distinctive word. A channel has its own habits the names do
-- not cover ("Flyers" for Bristol Flyers, "MAN" for Manchester, a sponsor's name before the club's), and some words
-- in its titles look like a club and are not (a presenter called Leicester, a city two clubs share). So:
--
-- 1. news_video_clubs: a phrase a channel's titles use, and the club it means - or no club at all (team_id null:
--    never read as a club, and no club's name is read inside it). The matcher reads a channel's phrases before
--    its own guesses: a phrase found in a title is that club, the strongest finding there is.
-- 2. news_items.match_clubs / match_note: the clubs the matcher found in a title at its last try and where it
--    stopped ('matched', 'no_clubs', 'one_club', 'no_game', 'not_a_game'), for the console to show beside each title,
--    so whoever looks after the channel sees what to name.
-- 3. A change to a channel's phrases sends its unmatched videos back to the matcher (at its next read, within half an
--    hour); rematch_news_videos sends back the ones it matched as well (never one linked by hand).
-- 4. video_game_json carries each club's second colour: the video tiles print a clash (a red against a red) in it.
--
-- Everything is the channel's administrators' (its league's, or the platform's for a platform channel), as its
-- video mode is (0237 set_news_video_mode). Readers never see the table.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.news_items add column if not exists match_clubs uuid[];
alter table public.news_items add column if not exists match_note  text;

create table if not exists public.news_video_clubs (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references public.news_sources(id) on delete cascade,
  phrase     text not null check (char_length(btrim(phrase)) between 2 and 60),
  team_id    uuid references public.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists news_video_clubs_phrase on public.news_video_clubs (source_id, (lower(phrase)));
alter table public.news_video_clubs enable row level security;
revoke all on public.news_video_clubs from anon, authenticated;

-- ------------------------------------------------------------------------------------------- who may ---
/* whether the signed-in user looks after this channel: its league's administrators, the platform's for a platform
   channel (can_manage_news_sources, as every other change to a source) */
create or replace function public.news_source_managed(p_source uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from news_sources s where s.id = p_source and public.can_manage_news_sources(s.league_id));
$$;

/* the channel's videos that found no game go back to the matcher at its next read */
create or replace function public.news_videos_retry(p_source uuid)
returns int language sql security definer set search_path = public as $$
  with u as (update news_items set matched_at = null
              where source_id = p_source and video_id is not null and game_id is null and not game_locked
                and matched_at is not null
              returning 1)
  select count(*)::int from u;
$$;

-- --------------------------------------------------------------------------------------- the console ---
/* A CHANNEL'S NAMES AND WHAT THE MATCHER MADE OF ITS TITLES: its phrases (each with its club and that club's
   league), and its 25 newest videos - the title, when, its kind, the game it is on, whether that was set by hand,
   the clubs the matcher found in it and where it stopped. */
create or replace function public.news_video_clubs(p_source uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.news_source_managed(p_source) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'phrase', r.phrase, 'team_id', r.team_id, 'team', t.name,
                                          'league', l.name) order by lower(r.phrase))
        from news_video_clubs r left join teams t on t.id = r.team_id left join leagues l on l.id = t.league_id
       where r.source_id = p_source), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by x.published_at desc) from (
        select i.id, i.title, i.published_at, i.video_kind, i.game_locked, i.matched_at, i.match_note,
               (select coalesce(jsonb_agg(t.name order by array_position(i.match_clubs, t.id)), '[]'::jsonb)
                  from teams t where t.id = any (coalesce(i.match_clubs, '{}'))) as clubs,
               case when i.game_id is not null then (
                 select jsonb_build_object('id', g.id, 'home', h.name, 'away', a.name, 'tipoff_at', g.tipoff_at)
                   from games g join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id
                  where g.id = i.game_id) end as game
          from news_items i
         where i.source_id = p_source and i.video_id is not null
         order by i.published_at desc
         limit 25) x), '[]'::jsonb));
end $$;

/* the clubs a phrase can be given to: with nothing typed, the clubs of the channel's leagues; with two letters or
   more, any club whose name or short name has them (the channel's leagues first), each with its league */
create or replace function public.news_video_club_teams(p_source uuid, p_q text default null)
returns table (id uuid, name text, short_name text, league text)
language sql stable security definer set search_path = public as $$
  with s as (select s.league_id, coalesce(s.assigned_leagues, '{}') as assigned from news_sources s
              where s.id = p_source and public.news_source_managed(p_source)),
       w as (select btrim(coalesce(p_q, '')) as q)
  select t.id, t.name, t.short_name, l.name
    from teams t join leagues l on l.id = t.league_id, s, w
   where case when char_length(w.q) >= 2
              then (t.name ilike '%' || replace(replace(replace(w.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                    or t.short_name ilike '%' || replace(replace(replace(w.q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
              else t.league_id = s.league_id or t.league_id = any (s.assigned) end
   order by coalesce(t.league_id = s.league_id or t.league_id = any (s.assigned), false) desc, t.name, l.name
   limit case when char_length(btrim(coalesce(p_q, ''))) >= 2 then 40 else 300 end;
$$;

/* a phrase for a club (p_team), or for no club (p_team null); the same phrase again replaces it */
create or replace function public.set_news_video_club(p_source uuid, p_phrase text, p_team uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; ph text := regexp_replace(btrim(coalesce(p_phrase, '')), '\s+', ' ', 'g');
begin
  if not public.news_source_managed(p_source) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(ph) < 2 or char_length(ph) > 60 then
    raise exception 'a name is 2 to 60 characters' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team) then
    raise exception 'no such club' using errcode = '22023';
  end if;
  insert into news_video_clubs (source_id, phrase, team_id, created_by)
  values (p_source, ph, p_team, auth.uid())
  on conflict (source_id, (lower(phrase))) do update set phrase = excluded.phrase, team_id = excluded.team_id
  returning id into v;
  perform public.news_videos_retry(p_source);
  return v;
end $$;

create or replace function public.delete_news_video_club(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare src uuid;
begin
  select source_id into src from news_video_clubs where id = p_id;
  if not found then return false; end if;
  if not public.news_source_managed(src) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from news_video_clubs where id = p_id;
  perform public.news_videos_retry(src);
  return true;
end $$;

/* every video of the channel from the matcher's ten days goes back to it, matched or not - except one linked (or
   unlinked) by hand. Its highlights leave their games until the next read puts them back. */
create or replace function public.rematch_news_videos(p_source uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.news_source_managed(p_source) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update news_items set game_id = null, matched_at = null, match_note = null, match_clubs = null
   where source_id = p_source and video_id is not null and not game_locked
     and published_at > now() - interval '10 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------------------------- a video's game, again ---
/* 0237's, with each club's second colour */
create or replace function public.video_game_json(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', g.id, 'status', g.status, 'tipoff_at', g.tipoff_at,
           'home_score', g.home_score, 'away_score', g.away_score,
           'home', jsonb_build_object('name', h.name, 'short', h.short_name, 'slug', h.slug, 'logo', h.logo_path,
                                      'colour', h.colour, 'colour_2', h.colour_2),
           'away', jsonb_build_object('name', a.name, 'short', a.short_name, 'slug', a.slug, 'logo', a.logo_path,
                                      'colour', a.colour, 'colour_2', a.colour_2),
           'league', jsonb_build_object('slug', l.slug, 'name', l.name, 'logo', l.logo_path, 'colour', l.colour_a),
           'competition', c.name)
    from games g
    join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id
    left join competitions c on c.id = g.competition_id left join seasons s on s.id = c.season_id
    left join leagues l on l.id = s.league_id
   where g.id = p_game and public.game_visible(g.id);
$$;

-- ------------------------------------------------------------------------------------------- grants ---
alter function public.news_source_managed(uuid) owner to postgres;
alter function public.news_videos_retry(uuid) owner to postgres;
alter function public.news_video_clubs(uuid) owner to postgres;
alter function public.news_video_club_teams(uuid, text) owner to postgres;
alter function public.set_news_video_club(uuid, text, uuid) owner to postgres;
alter function public.delete_news_video_club(uuid) owner to postgres;
alter function public.rematch_news_videos(uuid) owner to postgres;
alter function public.video_game_json(uuid) owner to postgres;

revoke all on function public.news_source_managed(uuid) from public, anon, authenticated;
revoke all on function public.news_videos_retry(uuid) from public, anon, authenticated;
revoke all on function public.news_video_clubs(uuid) from public, anon;
revoke all on function public.news_video_club_teams(uuid, text) from public, anon;
revoke all on function public.set_news_video_club(uuid, text, uuid) from public, anon;
revoke all on function public.delete_news_video_club(uuid) from public, anon;
revoke all on function public.rematch_news_videos(uuid) from public, anon;
revoke all on function public.video_game_json(uuid) from public, anon, authenticated;

grant execute on function public.news_video_clubs(uuid) to authenticated;
grant execute on function public.news_video_club_teams(uuid, text) to authenticated;
grant execute on function public.set_news_video_club(uuid, text, uuid) to authenticated;
grant execute on function public.delete_news_video_club(uuid) to authenticated;
grant execute on function public.rematch_news_videos(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------- self-check ---
do $$
begin
  if has_table_privilege('anon', 'public.news_video_clubs', 'select')
     or has_table_privilege('authenticated', 'public.news_video_clubs', 'select') then
    raise exception '0240: a channel''s club names are open to readers';
  end if;
  if has_function_privilege('anon', 'public.set_news_video_club(uuid, text, uuid)', 'execute') then
    raise exception '0240: the club names are writable by anyone';
  end if;
end $$;
