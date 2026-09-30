-- 0194: CONTENT CREATORS, A LEAGUE'S INDEPENDENT OUTLETS.
--
-- A league's own news is written by the people the league appoints (0051). Around most leagues there is
-- also a podcast, a YouTube channel, a blog, a fan who writes up every weekend: independent voices the
-- league would like to show without speaking for them. This gives each of them an OUTLET inside the
-- league:
--
--   * a page of its own (its name, colours, a line about it, a bio, and buttons to its own platforms:
--     website, YouTube, podcast, X, Instagram, TikTok, Twitch, Substack…);
--   * articles written on the site in the same block format as the league's news (0051: an array of
--     blocks, never markup, cleaned on the way in by clean_news_body), and posts that point to a piece
--     on the creator's own platform (a video, an episode, a link);
--   * on the league's front page, if the league has switched creators on and there is something to
--     show, a section of the most recent pieces, each a way into the outlet's page.
--
-- WHO. The league's administrators switch the feature on (leagues.creators_enabled), open an outlet and
-- name its owner by EMAIL (creator_members, like front_office_grants 0193 and access_grants 0117: it can
-- be given before the person has ever signed in, and takes effect the moment they do). An owner edits the
-- outlet and adds writers; owners and writers publish. The league keeps the last word: it may suspend an
-- outlet or hide a piece, and a hidden piece or a suspended outlet is gone from every public read at once.
--
-- IMAGES ARE LINKS. An outlet's logo and a piece's cover are https URLs (the creator's own hosting, a
-- YouTube thumbnail). A photograph uploaded to the platform goes through the approval queue and its
-- consent check (0017, 0065); an outlet is not the league, and is not given a way around it.
--
-- READS. Everything public goes through the functions below (security definer), each checking the league
-- is one the reader may see (league_visible, 0139), creators are on, the outlet is active, the piece is
-- published and not hidden. The tables have row-level security on and no policy.
--
-- AND THE NEWS FROM AROUND THE GAME. A news site (Eurohoops, a federation's site, a local paper) is a
-- NEWS SOURCE: its RSS / Atom feed, read every half hour by scripts/news/fetch_feeds.py (GitHub Actions,
-- news-feeds.yml) into news_items - the headline, a short plain-text excerpt, the picture it names, the
-- author and the date, never the article itself - each linking to the article on the source's own site.
-- A platform administrator adds the sources every reader sees (league_id null); a league's administrators
-- add their league's own. news_feed() is the News page: those items, the creators' pieces and the
-- leagues' own news, one list, newest first.

alter table public.leagues add column if not exists creators_enabled boolean not null default false;
comment on column public.leagues.creators_enabled is
  '0194: the league shows independent content creators (creator_outlets) on its front page and pages.';

/* what a fan follows besides clubs and leagues (see "following", below) */
alter table public.fan_prefs add column if not exists fav_source_ids uuid[] not null default '{}';
alter table public.fan_prefs add column if not exists fav_outlet_ids uuid[] not null default '{}';
alter table public.fan_prefs add column if not exists want_news boolean not null default true;

create table if not exists public.creator_outlets (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues on delete cascade,
  slug        text not null,
  name        text not null,
  tagline     text not null default '',
  bio         text not null default '',
  logo_url    text,
  colour      text,
  links       jsonb not null default '{}'::jsonb,
  status      text not null default 'active',
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (league_id, slug),
  constraint creator_outlets_status_ck check (status in ('active', 'suspended')),
  constraint creator_outlets_name_ck check (char_length(btrim(name)) between 1 and 80),
  constraint creator_outlets_colour_ck check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$'),
  constraint creator_outlets_logo_ck check (logo_url is null or logo_url ~* '^https://'),
  constraint creator_outlets_links_ck check (jsonb_typeof(links) = 'object')
);
create index if not exists creator_outlets_league on public.creator_outlets (league_id, status);

create table if not exists public.creator_members (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references public.creator_outlets on delete cascade,
  email       text not null,
  role        text not null default 'writer',
  added_by    uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  unique (outlet_id, email),
  constraint creator_members_role_ck check (role in ('owner', 'writer')),
  constraint creator_members_email_ck check (email = lower(btrim(email)) and position('@' in email) > 1)
);
create index if not exists creator_members_email on public.creator_members (email);

create table if not exists public.creator_posts (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references public.creator_outlets on delete cascade,
  league_id     uuid not null references public.leagues on delete cascade,
  slug          text not null,
  kind          text not null default 'article',
  title         text not null,
  standfirst    text not null default '',
  body          jsonb not null default '[]'::jsonb,
  cover_url     text,
  external_url  text,
  status        text not null default 'draft',
  hidden        boolean not null default false,
  published_at  timestamptz,
  author_id     uuid references auth.users on delete set null,
  author_name   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (outlet_id, slug),
  constraint creator_posts_kind_ck check (kind in ('article', 'video', 'podcast', 'social', 'link')),
  constraint creator_posts_status_ck check (status in ('draft', 'published')),
  constraint creator_posts_body_ck check (jsonb_typeof(body) = 'array'),
  constraint creator_posts_cover_ck check (cover_url is null or cover_url ~* '^https://'),
  constraint creator_posts_url_ck check (external_url is null or external_url ~* '^https://')
);
create index if not exists creator_posts_league_pub on public.creator_posts (league_id, status, published_at desc) where not hidden;
create index if not exists creator_posts_outlet on public.creator_posts (outlet_id, published_at desc);

alter table public.creator_outlets enable row level security;
alter table public.creator_members enable row level security;
alter table public.creator_posts enable row level security;
revoke all on public.creator_outlets, public.creator_members, public.creator_posts from anon, authenticated;

comment on table public.creator_outlets is '0194: an independent content creator''s outlet inside a league. Through the creator functions only.';
comment on table public.creator_members is '0194: who owns and writes for an outlet, by email. Through the creator functions only.';
comment on table public.creator_posts is '0194: an outlet''s articles (news blocks) and posts pointing to its own platforms. Through the creator functions only.';

-- ---------------------------------------------------------------------------------------------- helpers ---

/* the caller's email, folded, or null signed out */
create or replace function public.my_email()
returns text language sql stable security definer set search_path = public, auth as $$
  select lower(u.email::text) from auth.users u where u.id = auth.uid();
$$;

/* the caller's part in an outlet: 'owner', 'writer', or null */
create or replace function public.creator_role(p_outlet uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from creator_members m
   where m.outlet_id = p_outlet and m.email = public.my_email()
   order by (m.role = 'owner') desc limit 1;
$$;

/* may edit the outlet itself (its page, its people): an owner, or the league's administrators */
create or replace function public.can_run_outlet(p_outlet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
         public.creator_role(p_outlet) = 'owner'
      or exists (select 1 from creator_outlets o where o.id = p_outlet and public.is_league_admin(o.league_id)));
$$;

/* may publish for it: an owner or a writer, or the league's administrators */
create or replace function public.can_write_outlet(p_outlet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
         public.creator_role(p_outlet) is not null
      or exists (select 1 from creator_outlets o where o.id = p_outlet and public.is_league_admin(o.league_id)));
$$;

/* a slug from a name, unique within the rows `taken` says are taken */
create or replace function public.creator_slug(p_text text, p_fallback text)
returns text language sql immutable as $$
  select coalesce(nullif(trim(both '-' from left(lower(regexp_replace(coalesce(p_text, ''), '[^a-zA-Z0-9]+', '-', 'g')), 60)), ''), p_fallback);
$$;

/* THE LINKS, allow-listed: a known platform, an https address, 300 characters at the most. Anything else is
   dropped rather than refused, so an editor sending a key this version does not know degrades to one
   button fewer. */
create or replace function public.clean_creator_links(p_links jsonb)
returns jsonb language plpgsql immutable as $$
declare k text; v text; out_links jsonb := '{}'::jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'object' then return out_links; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p_links) loop
    continue when k not in ('website', 'youtube', 'podcast', 'spotify', 'apple_podcasts', 'x', 'instagram', 'tiktok',
                            'twitch', 'substack', 'facebook', 'threads', 'bluesky', 'discord', 'patreon');
    v := btrim(coalesce(v, ''));
    continue when v = '' or v !~* '^https://[^\s<>"]+$' or char_length(v) > 300;
    out_links := out_links || jsonb_build_object(k, v);
  end loop;
  return out_links;
end $$;

-- ----------------------------------------------------------------------------------------- the league ---

/* SWITCH CREATORS ON OR OFF for a league. Off, every public read answers nothing; nothing is deleted. */
create or replace function public.set_league_creators(p_league uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_league is null or not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  update leagues set creators_enabled = coalesce(p_on, false) where id = p_league;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_creators', 'league', p_league::text, jsonb_build_object('on', coalesce(p_on, false)));
  return coalesce(p_on, false);
end $$;

/* OPEN AN OUTLET and name its owner by email. */
create or replace function public.create_creator_outlet(p_league uuid, p_name text, p_owner_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e text := lower(btrim(coalesce(p_owner_email, '')));
  nm text := btrim(coalesce(p_name, ''));
  s text; n int := 1; v uuid;
begin
  if auth.uid() is null or p_league is null or not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if nm = '' or char_length(nm) > 80 then
    raise exception 'an outlet needs a name (80 characters at the most)' using errcode = '22023';
  end if;
  if position('@' in e) < 2 or e ~ '\s' then
    raise exception 'that is not an email address' using errcode = '22023';
  end if;
  s := public.creator_slug(nm, 'outlet');
  while exists (select 1 from creator_outlets o where o.league_id = p_league and o.slug = s) loop
    n := n + 1;
    s := left(public.creator_slug(nm, 'outlet'), 55) || '-' || n;
  end loop;
  insert into creator_outlets (league_id, slug, name, created_by) values (p_league, s, nm, auth.uid()) returning id into v;
  insert into creator_members (outlet_id, email, role, added_by) values (v, e, 'owner', auth.uid());
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'create_creator_outlet', 'league', p_league::text, jsonb_build_object('outlet', v, 'name', nm, 'owner', e));
  return v;
end $$;

/* SUSPEND an outlet (gone from every public read, its people cannot publish) or let it back. */
create or replace function public.set_creator_outlet_status(p_outlet uuid, p_status text)
returns text language plpgsql security definer set search_path = public as $$
declare v_league uuid;
begin
  select league_id into v_league from creator_outlets where id = p_outlet;
  if auth.uid() is null or v_league is null or not public.is_league_admin(v_league) then
    raise exception 'you do not administer that outlet''s league' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'an outlet is active or suspended' using errcode = '22023';
  end if;
  update creator_outlets set status = p_status, updated_at = now() where id = p_outlet;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_creator_outlet_status', 'creator_outlet', p_outlet::text, jsonb_build_object('status', p_status));
  return p_status;
end $$;

/* HIDE a piece (the league's moderation) or show it again. The outlet's people still see it, marked hidden. */
create or replace function public.hide_creator_post(p_post uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_league uuid;
begin
  select league_id into v_league from creator_posts where id = p_post;
  if auth.uid() is null or v_league is null or not public.is_league_admin(v_league) then
    raise exception 'you do not administer that piece''s league' using errcode = '42501';
  end if;
  update creator_posts set hidden = coalesce(p_hidden, true) where id = p_post;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'hide_creator_post', 'creator_post', p_post::text, jsonb_build_object('hidden', coalesce(p_hidden, true)));
  return coalesce(p_hidden, true);
end $$;

/* THE CONSOLE'S VIEW: the switch, every outlet with its people and counts, and the latest pieces, hidden too. */
create or replace function public.creators_admin(p_league uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or p_league is null or not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'enabled', (select l.creators_enabled from leagues l where l.id = p_league),
    'outlets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'slug', o.slug, 'name', o.name, 'status', o.status, 'created_at', o.created_at,
        'members', coalesce((select jsonb_agg(jsonb_build_object('email', m.email, 'role', m.role) order by m.role, m.email)
                               from creator_members m where m.outlet_id = o.id), '[]'::jsonb),
        'published', (select count(*) from creator_posts p where p.outlet_id = o.id and p.status = 'published'),
        'hidden', (select count(*) from creator_posts p where p.outlet_id = o.id and p.hidden)) order by o.name)
      from creator_outlets o where o.league_id = p_league), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(x order by x->>'published_at' desc) from (
        select jsonb_build_object('id', p.id, 'title', p.title, 'kind', p.kind, 'hidden', p.hidden, 'published_at', p.published_at,
                                  'outlet', o.name, 'outlet_slug', o.slug, 'slug', p.slug) as x
          from creator_posts p join creator_outlets o on o.id = p.outlet_id
         where p.league_id = p_league and p.status = 'published'
         order by p.published_at desc limit 50) q), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------- the outlet ---

/* THE HUB'S LIST: every outlet the caller belongs to, with its league and whether creators are on there. */
create or replace function public.my_creator_outlets()
returns table (outlet_id uuid, slug text, name text, logo_url text, colour text, status text, role text,
               league_id uuid, league_slug text, league_name text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (o.id) o.id, o.slug, o.name, o.logo_url, o.colour, o.status, m.role,
         l.id, l.slug, l.name, l.creators_enabled
    from creator_members m
    join creator_outlets o on o.id = m.outlet_id
    join leagues l on l.id = o.league_id
   where auth.uid() is not null and m.email = public.my_email()
   order by o.id, (m.role = 'owner') desc;
$$;

/* THE STUDIO: the outlet, its people (to whoever may run it), and every piece, drafts and hidden ones too. */
create or replace function public.creator_studio(p_outlet uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o creator_outlets;
begin
  if not public.can_write_outlet(p_outlet) then
    raise exception 'you do not write for that outlet' using errcode = '42501';
  end if;
  select * into o from creator_outlets where id = p_outlet;
  return jsonb_build_object(
    'outlet', jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'tagline', o.tagline, 'bio', o.bio,
                                 'logo_url', o.logo_url, 'colour', o.colour, 'links', o.links, 'status', o.status,
                                 'league', (select jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'enabled', l.creators_enabled)
                                              from leagues l where l.id = o.league_id)),
    'role', coalesce(public.creator_role(p_outlet), 'admin'),
    'members', case when public.can_run_outlet(p_outlet)
                    then coalesce((select jsonb_agg(jsonb_build_object('email', m.email, 'role', m.role) order by m.role, m.email)
                                     from creator_members m where m.outlet_id = p_outlet), '[]'::jsonb) end,
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'kind', p.kind, 'title', p.title, 'standfirst', p.standfirst, 'body', p.body,
        'cover_url', p.cover_url, 'external_url', p.external_url, 'status', p.status, 'hidden', p.hidden,
        'published_at', p.published_at, 'updated_at', p.updated_at, 'author_name', p.author_name)
        order by coalesce(p.published_at, p.updated_at) desc)
      from creator_posts p where p.outlet_id = p_outlet), '[]'::jsonb));
end $$;

/* THE OUTLET'S PAGE, edited by its owner (or the league). Every field cleaned on the way in. */
create or replace function public.update_creator_outlet(p_outlet uuid, p_name text, p_tagline text, p_bio text,
                                                        p_logo_url text, p_colour text, p_links jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, '')); lg text := nullif(btrim(coalesce(p_logo_url, '')), '');
        cl text := nullif(btrim(coalesce(p_colour, '')), '');
begin
  if not public.can_run_outlet(p_outlet) then
    raise exception 'only the outlet''s owner can change its page' using errcode = '42501';
  end if;
  if nm = '' or char_length(nm) > 80 then
    raise exception 'an outlet needs a name (80 characters at the most)' using errcode = '22023';
  end if;
  if lg is not null and (lg !~* '^https://[^\s<>"]+$' or char_length(lg) > 500) then
    raise exception 'a logo is an https address' using errcode = '22023';
  end if;
  if cl is not null and cl !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a colour is #rrggbb' using errcode = '22023';
  end if;
  update creator_outlets
     set name = nm, tagline = left(btrim(coalesce(p_tagline, '')), 140), bio = left(btrim(coalesce(p_bio, '')), 2000),
         logo_url = lg, colour = cl, links = public.clean_creator_links(p_links), updated_at = now()
   where id = p_outlet;
end $$;

/* ADD A WRITER (or another owner) by email; the outlet's owner or the league. Idempotent: the role is updated. */
create or replace function public.add_creator_member(p_outlet uuid, p_email text, p_role text default 'writer')
returns text language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.can_run_outlet(p_outlet) then
    raise exception 'only the outlet''s owner can change who writes for it' using errcode = '42501';
  end if;
  if position('@' in e) < 2 or e ~ '\s' then
    raise exception 'that is not an email address' using errcode = '22023';
  end if;
  if coalesce(p_role, 'writer') not in ('owner', 'writer') then
    raise exception 'an outlet''s people are owners or writers' using errcode = '22023';
  end if;
  insert into creator_members (outlet_id, email, role, added_by) values (p_outlet, e, coalesce(p_role, 'writer'), auth.uid())
  on conflict (outlet_id, email) do update set role = excluded.role;
  return e;
end $$;

/* TAKE SOMEBODY OFF. The last owner stays: an outlet with nobody to run it is the league's to close. */
create or replace function public.remove_creator_member(p_outlet uuid, p_email text)
returns integer language plpgsql security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, ''))); n integer;
begin
  if not public.can_run_outlet(p_outlet) then
    raise exception 'only the outlet''s owner can change who writes for it' using errcode = '42501';
  end if;
  if (select role from creator_members where outlet_id = p_outlet and email = e) = 'owner'
     and (select count(*) from creator_members where outlet_id = p_outlet and role = 'owner') <= 1 then
    raise exception 'an outlet keeps at least one owner' using errcode = '22023';
  end if;
  delete from creator_members where outlet_id = p_outlet and email = e;
  get diagnostics n = row_count;
  return n;
end $$;

/* A PIECE'S BODY: the league's news format, cleaned exactly as the league's news is (0051 clean_news_body), and a
   picture in it is an https address - an outlet has no uploads (see IMAGES ARE LINKS, above) - or it is dropped. */
create or replace function public.clean_creator_body(p_body jsonb)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(b order by n), '[]'::jsonb)
    from jsonb_array_elements(public.clean_news_body(p_body)) with ordinality as x(b, n)
   where b->>'type' <> 'image' or (b->>'path' ~* '^https://[^\s<>"]+$');
$$;

/* WRITE A PIECE. The body is cleaned exactly as the league's news is (clean_news_body); links and covers are
   https; a published piece keeps the moment it was first published. Only while the league has creators on
   and the outlet is active. */
create or replace function public.upsert_creator_post(
  p_id uuid, p_outlet uuid, p_kind text, p_title text, p_standfirst text, p_body jsonb,
  p_cover_url text default null, p_external_url text default null, p_status text default 'draft', p_slug text default null
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  o creator_outlets; v_id uuid; v_slug text; n int := 1; v_name text;
  cov text := nullif(btrim(coalesce(p_cover_url, '')), ''); ext text := nullif(btrim(coalesce(p_external_url, '')), '');
  was_pub timestamptz;
begin
  if not public.can_write_outlet(p_outlet) then
    raise exception 'you do not write for that outlet' using errcode = '42501';
  end if;
  select * into o from creator_outlets where id = p_outlet;
  if o.status <> 'active' then
    raise exception 'this outlet is suspended by the league' using errcode = '42501';
  end if;
  if not (select l.creators_enabled from leagues l where l.id = o.league_id) then
    raise exception 'the league has not switched creators on' using errcode = '42501';
  end if;
  if coalesce(p_kind, 'article') not in ('article', 'video', 'podcast', 'social', 'link') then
    raise exception 'a piece is an article, a video, a podcast, a social post or a link' using errcode = '22023';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(btrim(p_title)) > 160 then
    raise exception 'a piece needs a headline (160 characters at the most)' using errcode = '22023';
  end if;
  if coalesce(p_status, 'draft') not in ('draft', 'published') then
    raise exception 'a piece is a draft or published' using errcode = '22023';
  end if;
  if cov is not null and (cov !~* '^https://[^\s<>"]+$' or char_length(cov) > 500) then
    raise exception 'a cover is an https address' using errcode = '22023';
  end if;
  if ext is not null and (ext !~* '^https://[^\s<>"]+$' or char_length(ext) > 500) then
    raise exception 'a link is an https address' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'article') <> 'article' and ext is null then
    raise exception 'a video, a podcast, a social post or a link needs its address' using errcode = '22023';
  end if;
  if p_id is not null and not exists (select 1 from creator_posts p where p.id = p_id and p.outlet_id = p_outlet) then
    raise exception 'no such piece in this outlet' using errcode = '42501';
  end if;

  v_slug := public.creator_slug(coalesce(nullif(btrim(coalesce(p_slug, '')), ''), p_title), 'piece');
  while exists (select 1 from creator_posts p where p.outlet_id = p_outlet and p.slug = v_slug and (p_id is null or p.id <> p_id)) loop
    n := n + 1;
    v_slug := left(public.creator_slug(coalesce(nullif(btrim(coalesce(p_slug, '')), ''), p_title), 'piece'), 55) || '-' || n;
  end loop;

  select coalesce(nullif(pr.display_name, ''), split_part(u.email::text, '@', 1)) into v_name
    from auth.users u left join profiles pr on pr.id = u.id where u.id = auth.uid();

  if p_id is null then
    insert into creator_posts (outlet_id, league_id, slug, kind, title, standfirst, body, cover_url, external_url, status,
                               published_at, author_id, author_name)
    values (p_outlet, o.league_id, v_slug, coalesce(p_kind, 'article'), btrim(p_title), left(btrim(coalesce(p_standfirst, '')), 300),
            public.clean_creator_body(p_body), cov, ext, coalesce(p_status, 'draft'),
            case when p_status = 'published' then now() end, auth.uid(), coalesce(v_name, ''))
    returning id into v_id;
    if p_status = 'published' then perform public.notify_creator_piece(v_id); end if;
  else
    select published_at into was_pub from creator_posts where id = p_id;
    update creator_posts
       set slug = v_slug, kind = coalesce(p_kind, 'article'), title = btrim(p_title),
           standfirst = left(btrim(coalesce(p_standfirst, '')), 300), body = public.clean_creator_body(p_body),
           cover_url = cov, external_url = ext, status = coalesce(p_status, 'draft'),
           published_at = case when p_status = 'published' then coalesce(was_pub, now()) else was_pub end,
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if p_status = 'published' and was_pub is null then perform public.notify_creator_piece(v_id); end if;
  end if;
  return v_id;
end $$;

/* DELETE A PIECE: its outlet's people, or the league. */
create or replace function public.delete_creator_post(p_post uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_outlet uuid;
begin
  select outlet_id into v_outlet from creator_posts where id = p_post;
  if v_outlet is null then return 'already gone'; end if;
  if not public.can_write_outlet(v_outlet) then
    raise exception 'you do not write for that outlet' using errcode = '42501';
  end if;
  delete from creator_posts where id = p_post;
  return 'deleted';
end $$;

-- ---------------------------------------------------------------------------------------- the reader ---

/* whether a league's creators may be shown to this reader at all */
create or replace function public.creators_shown(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select l.creators_enabled from leagues l where l.id = p_league), false) and public.league_visible(p_league);
$$;

/* THE RAIL'S QUESTION (nav.js probeQuery): does this league show creators, with something published? One row, or
   none; by slug, which is what the rail has. */
create or replace function public.creators_probe(p_slug text)
returns table (yes int) language sql stable security definer set search_path = public as $$
  select 1 from leagues l
   where l.slug = p_slug and public.creators_shown(l.id)
     and exists (select 1 from creator_posts p join creator_outlets o on o.id = p.outlet_id
                  where p.league_id = l.id and p.status = 'published' and not p.hidden and o.status = 'active')
  limit 1;
$$;

/* THE FRONT PAGE'S SECTION: the league's most recent pieces, every outlet together, newest first. */
create or replace function public.creators_public(p_league uuid, p_limit int default 6, p_offset int default 0)
returns table (id uuid, slug text, kind text, title text, standfirst text, cover_url text, external_url text,
               published_at timestamptz, author_name text, outlet_slug text, outlet_name text, outlet_logo text,
               outlet_colour text, total bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.slug, p.kind, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at, p.author_name,
         o.slug, o.name, o.logo_url, o.colour, count(*) over ()
    from creator_posts p join creator_outlets o on o.id = p.outlet_id
   where p.league_id = p_league and p.status = 'published' and not p.hidden and o.status = 'active'
     and public.creators_shown(p_league)
   order by p.published_at desc nulls last, p.id
   limit greatest(1, least(coalesce(p_limit, 6), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

/* THE LEAGUE'S OUTLETS: every active one with something published, most recently active first. */
create or replace function public.creator_outlets_public(p_league uuid)
returns table (id uuid, slug text, name text, tagline text, logo_url text, colour text, links jsonb, pieces bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.slug, o.name, o.tagline, o.logo_url, o.colour, o.links, count(p.id), max(p.published_at)
    from creator_outlets o
    join creator_posts p on p.outlet_id = o.id and p.status = 'published' and not p.hidden
   where o.league_id = p_league and o.status = 'active' and public.creators_shown(p_league)
   group by o.id
   order by max(p.published_at) desc nulls last, o.name;
$$;

/* AN OUTLET'S PAGE: itself and its pieces (fifty, newest first). Null for one the reader may not see. */
create or replace function public.creator_outlet_public(p_league uuid, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'name', o.name, 'tagline', o.tagline, 'bio', o.bio, 'logo_url', o.logo_url, 'colour', o.colour,
      'links', o.links,
      'posts', coalesce((select jsonb_agg(x order by x->>'published_at' desc) from (
          select jsonb_build_object('slug', p.slug, 'kind', p.kind, 'title', p.title, 'standfirst', p.standfirst,
                                    'cover_url', p.cover_url, 'external_url', p.external_url, 'published_at', p.published_at,
                                    'author_name', p.author_name) as x
            from creator_posts p where p.outlet_id = o.id and p.status = 'published' and not p.hidden
           order by p.published_at desc limit 50) q), '[]'::jsonb))
    from creator_outlets o
   where o.league_id = p_league and o.slug = p_slug and o.status = 'active' and public.creators_shown(p_league);
$$;

/* ONE PIECE, with its body, and the outlet it is from. Null for one the reader may not see. */
create or replace function public.creator_post_public(p_league uuid, p_outlet text, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'slug', p.slug, 'kind', p.kind, 'title', p.title, 'standfirst', p.standfirst, 'body', p.body,
      'cover_url', p.cover_url, 'external_url', p.external_url, 'published_at', p.published_at,
      'updated_at', p.updated_at, 'author_name', p.author_name,
      'outlet', jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'tagline', o.tagline, 'logo_url', o.logo_url,
                                   'colour', o.colour, 'links', o.links),
      'league', jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
    from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = o.league_id
   where o.league_id = p_league and o.slug = p_outlet and p.slug = p_slug
     and p.status = 'published' and not p.hidden and o.status = 'active' and public.creators_shown(p_league);
$$;

-- ---------------------------------------------------------------------------------- the news sources ---
create table if not exists public.news_sources (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid references public.leagues on delete cascade,     -- null: every reader's
  slug            text not null unique,                                 -- its page: news/?s=<slug>
  name            text not null,
  site_url        text not null,                                        -- the source's own home page
  feed_url        text not null,                                        -- RSS, Atom or JSON Feed
  logo_url        text,                                                 -- set by hand, or found on the site (below)
  logo_checked_at timestamptz,                                          -- when the fetcher last looked for one
  colour          text,
  enabled         boolean not null default true,
  etag            text,
  last_modified   text,
  last_fetched_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  item_count      integer not null default 0,
  added_by        uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  constraint news_sources_name_ck check (char_length(btrim(name)) between 1 and 80),
  constraint news_sources_site_ck check (site_url ~* '^https?://'),
  constraint news_sources_feed_ck check (feed_url ~* '^https?://'),
  constraint news_sources_logo_ck check (logo_url is null or logo_url ~* '^https://'),
  constraint news_sources_colour_ck check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$')
);
create unique index if not exists news_sources_feed on public.news_sources
  (coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid), feed_url);

create table if not exists public.news_items (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.news_sources on delete cascade,
  guid          text not null,
  url           text not null,
  title         text not null,
  summary       text not null default '',
  image_url     text,
  author        text,
  tags          text[] not null default '{}',
  published_at  timestamptz not null,
  fetched_at    timestamptz not null default now(),
  unique (source_id, guid),
  constraint news_items_url_ck check (url ~* '^https?://'),
  constraint news_items_image_ck check (image_url is null or image_url ~* '^https://'),
  constraint news_items_title_ck check (char_length(title) between 1 and 300),
  constraint news_items_summary_ck check (char_length(summary) <= 400)
);
create index if not exists news_items_pub on public.news_items (published_at desc);
/* THE LEAGUES A STORY IS ABOUT, worked out by the fetcher from its categories, headline and excerpt against every
   league's name and its clubs' names (scripts/news/fetch_feeds.py LeagueMatcher). A story from a site that covers
   everything (Eurohoops) lands on each league's own news page by it; a league's own source is that league's
   anyway, and a story of its about another league (the B.LEAGUE's feed on a B2 club) is that league's too. */
alter table public.news_items add column if not exists league_ids uuid[] not null default '{}';
create index if not exists news_items_leagues on public.news_items using gin (league_ids);
create index if not exists news_items_source_pub on public.news_items (source_id, published_at desc);

/* A STORY KEEPS ITS PLACE. The fetcher writes every item of every read over what is there (so a corrected headline
   or a better excerpt is taken, and the league tags are matched again), and a story with no date of its own is dated
   by the read: without this it would be dated again by every read, and sit at the top of the page for ever. A
   re-read may move a story back in time (a corrected date) but never forward; and when it was first read stays. */
create or replace function public.news_items_keep_time()
returns trigger language plpgsql as $$
begin
  new.published_at := least(old.published_at, new.published_at);
  new.fetched_at := old.fetched_at;
  return new;
end $$;
drop trigger if exists news_items_keep_time on public.news_items;
create trigger news_items_keep_time before update on public.news_items
  for each row execute function public.news_items_keep_time();

alter table public.news_sources enable row level security;
alter table public.news_items enable row level security;
revoke all on public.news_sources, public.news_items from anon, authenticated;
comment on table public.news_sources is '0194: a news site whose feed the News page carries (league_id null: every reader''s). Read by scripts/news/fetch_feeds.py.';
comment on table public.news_items is '0194: one article of a news source: headline, short excerpt, picture, link to the source''s own page. Written by scripts/news/fetch_feeds.py.';

/* who may add and change a source: the platform's for the whole platform, a league's administrators for theirs */
create or replace function public.can_manage_news_sources(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.is_platform_admin() or (p_league is not null and public.is_league_admin(p_league)));
$$;

create or replace function public.add_news_source(p_league uuid, p_name text, p_site_url text, p_feed_url text,
                                                  p_logo_url text default null, p_colour text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; sl text; k int := 1; nm text := btrim(coalesce(p_name, '')); su text := btrim(coalesce(p_site_url, ''));
        fu text := btrim(coalesce(p_feed_url, '')); lg text := nullif(btrim(coalesce(p_logo_url, '')), '');
        cl text := nullif(btrim(coalesce(p_colour, '')), '');
begin
  if not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot add news sources here' using errcode = '42501';
  end if;
  if nm = '' or char_length(nm) > 80 then raise exception 'a source needs a name' using errcode = '22023'; end if;
  if su !~* '^https?://[^\s<>"]+$' or fu !~* '^https?://[^\s<>"]+$' then
    raise exception 'a source needs its site and its feed as web addresses' using errcode = '22023';
  end if;
  if lg is not null and lg !~* '^https://[^\s<>"]+$' then raise exception 'a logo is an https address' using errcode = '22023'; end if;
  if cl is not null and cl !~ '^#[0-9a-fA-F]{6}$' then raise exception 'a colour is #rrggbb' using errcode = '22023'; end if;
  sl := public.creator_slug(nm, 'source');
  while exists (select 1 from news_sources x where x.slug = sl) loop
    k := k + 1;
    sl := left(public.creator_slug(nm, 'source'), 55) || '-' || k;
  end loop;
  insert into news_sources (league_id, slug, name, site_url, feed_url, logo_url, colour, added_by)
  values (p_league, sl, nm, su, fu, lg, cl, auth.uid()) returning id into v;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'add_news_source', 'news_source', v::text, jsonb_build_object('league', p_league, 'feed', fu));
  return v;
end $$;

create or replace function public.update_news_source(p_id uuid, p_name text, p_site_url text, p_feed_url text,
                                                     p_logo_url text, p_colour text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid; found_ boolean;
        nm text := btrim(coalesce(p_name, '')); su text := btrim(coalesce(p_site_url, ''));
        fu text := btrim(coalesce(p_feed_url, '')); lg text := nullif(btrim(coalesce(p_logo_url, '')), '');
        cl text := nullif(btrim(coalesce(p_colour, '')), '');
begin
  select league_id, true into v_league, found_ from news_sources where id = p_id;
  if not coalesce(found_, false) or not public.can_manage_news_sources(v_league) then
    raise exception 'you cannot change that source' using errcode = '42501';
  end if;
  if nm = '' or char_length(nm) > 80 then raise exception 'a source needs a name' using errcode = '22023'; end if;
  if su !~* '^https?://[^\s<>"]+$' or fu !~* '^https?://[^\s<>"]+$' then
    raise exception 'a source needs its site and its feed as web addresses' using errcode = '22023';
  end if;
  if lg is not null and lg !~* '^https://[^\s<>"]+$' then raise exception 'a logo is an https address' using errcode = '22023'; end if;
  if cl is not null and cl !~ '^#[0-9a-fA-F]{6}$' then raise exception 'a colour is #rrggbb' using errcode = '22023'; end if;
  /* a logo cleared, or a new home site: the fetcher looks for the logo again on its next read */
  update news_sources
     set name = nm, site_url = su, logo_url = lg, colour = cl, enabled = coalesce(p_enabled, enabled),
         logo_checked_at = case when lg is null and (logo_url is not null or site_url <> su) then null else logo_checked_at end,
         feed_url = fu, etag = case when feed_url = fu then etag end, last_modified = case when feed_url = fu then last_modified end
   where id = p_id;
end $$;

create or replace function public.delete_news_source(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_league uuid; found_ boolean;
begin
  select league_id, true into v_league, found_ from news_sources where id = p_id;
  if not coalesce(found_, false) then return 'already gone'; end if;
  if not public.can_manage_news_sources(v_league) then
    raise exception 'you cannot remove that source' using errcode = '42501';
  end if;
  delete from news_sources where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'delete_news_source', 'news_source', p_id::text, jsonb_build_object('league', v_league));
  return 'deleted';
end $$;

/* THE CONSOLE'S LIST: a league's sources (or, for null, the platform's), with how their last read went */
create or replace function public.news_sources_admin(p_league uuid)
returns table (id uuid, slug text, name text, site_url text, feed_url text, logo_url text, colour text, enabled boolean,
               last_fetched_at timestamptz, last_ok_at timestamptz, last_error text, item_count integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_news_sources(p_league) then
    raise exception 'you cannot see the news sources here' using errcode = '42501';
  end if;
  return query
    select s.id, s.slug, s.name, s.site_url, s.feed_url, s.logo_url, s.colour, s.enabled,
           s.last_fetched_at, s.last_ok_at, s.last_error, s.item_count
      from news_sources s
     where s.league_id is not distinct from p_league
     order by s.name;
end $$;

/* THE NEWS PAGE: every source's items, every league's creators and every league's own news, one list,
   newest first, `p_limit` at a time before `p_before`. With a league: that league's own news, its creators
   and its own sources. Only what the reader may see: a league they may not, a switched-off creators
   feature, a suspended outlet, a hidden piece and a disabled source are all left out.
     kind 'league'   the league's own article      news/?l=<league_slug>&a=<slug>
     kind 'creator'  an outlet's piece             creators/?l=<league_slug>&o=<outlet_slug>&p=<slug>
     kind 'outlet'   a news source's article       url, on the source's own site
   and `leagues`, what the card shows as its tags: a story's leagues (news_item_leagues), a creator's piece its league,
   the league's own article none (it is the league's already). */
/* THE LEAGUES A STORY IS ABOUT, as its card's tags: the source's own league first, then the fetcher's matches in the
   order it ranked them; only leagues the reader may see. */
create or replace function public.news_item_leagues(p_ids uuid[], p_own uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path)
                            order by (l.id = p_own) desc, array_position(p_ids, l.id)), '[]'::jsonb)
    from leagues l
   where (l.id = any (coalesce(p_ids, '{}'::uuid[])) or l.id = p_own) and public.league_visible(l.id);
$$;

create or replace function public.news_feed(p_league uuid default null, p_before timestamptz default null, p_limit int default 30,
                                            p_kinds text[] default null)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb)
language sql stable security definer set search_path = public as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n,
                      coalesce(p_before, 'infinity'::timestamptz) as before)
  select * from (
    (select 'league'::text, a.id, a.title, a.standfirst, a.cover_path, null::text, a.published_at,
            l.name, l.logo_path, l.colour_a, null::text, null::text, l.slug, l.name, null::text, a.slug, null::text, a.author_name,
            '[]'::jsonb
       from news_articles a join leagues l on l.id = a.league_id, lim
      where a.status = 'published' and a.published_at < lim.before and (p_kinds is null or 'league' = any (p_kinds))
        and (p_league is null or a.league_id = p_league) and public.league_visible(a.league_id)
      order by a.published_at desc limit (select n from lim))
    union all
    (select 'creator'::text, p.id, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at,
            o.name, o.logo_url, o.colour, null::text, null::text, l.slug, l.name, o.slug, p.slug, p.kind, p.author_name,
            jsonb_build_array(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
       from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = p.league_id, lim
      where p.status = 'published' and not p.hidden and o.status = 'active' and p.published_at < lim.before
        and (p_kinds is null or 'creator' = any (p_kinds))
        and (p_league is null or p.league_id = p_league) and public.creators_shown(p.league_id)
      order by p.published_at desc limit (select n from lim))
    union all
    (select 'outlet'::text, i.id, i.title, i.summary, i.image_url, i.url, i.published_at,
            s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(l.slug, t.slug), coalesce(l.name, t.name),
            null::text, null::text, null::text, i.author, public.news_item_leagues(i.league_ids, s.league_id)
       from news_items i join news_sources s on s.id = i.source_id left join leagues l on l.id = s.league_id
            left join leagues t on t.id = i.league_ids[1], lim
      where s.enabled and i.published_at < lim.before and (p_kinds is null or 'outlet' = any (p_kinds))
        and (s.league_id is null or public.league_visible(s.league_id))
        and (p_league is null or ((s.league_id = p_league or p_league = any (i.league_ids)) and public.league_visible(p_league)))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

/* THE READER'S OWN FEED (HOME's FEED, "Followed"): the same three kinds, from what they follow - the leagues
   (and the leagues of the clubs) they follow, with each one's creators and its own sources; the outlets; the
   publishers. The same columns as news_feed, newest first, paged the same way. Signed out, or following
   nothing: no rows. */
create or replace function public.news_feed_mine(p_before timestamptz default null, p_limit int default 30)
returns table (kind text, id uuid, title text, summary text, image_url text, url text, published_at timestamptz,
               source_name text, source_logo text, source_colour text, source_url text, source_slug text,
               league_slug text, league_name text, outlet_slug text, slug text, piece_kind text, author text,
               leagues jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select f.fav_league_ids || coalesce((select array_agg(distinct t.league_id) from teams t
                                          where t.id = any (f.fav_team_ids) and t.league_id is not null), '{}') as leagues,
           f.fav_outlet_ids as outlets, f.fav_source_ids as sources
      from fan_prefs f where f.user_id = auth.uid()
  ), lim as (select greatest(1, least(coalesce(p_limit, 30), 60)) as n, coalesce(p_before, 'infinity'::timestamptz) as before)
  select * from (
    (select 'league'::text, a.id, a.title, a.standfirst, a.cover_path, null::text, a.published_at,
            l.name, l.logo_path, l.colour_a, null::text, null::text, l.slug, l.name, null::text, a.slug, null::text, a.author_name,
            '[]'::jsonb
       from news_articles a join leagues l on l.id = a.league_id, me, lim
      where a.status = 'published' and a.published_at < lim.before and a.league_id = any (me.leagues)
        and public.league_visible(a.league_id)
      order by a.published_at desc limit (select n from lim))
    union all
    (select 'creator'::text, p.id, p.title, p.standfirst, p.cover_url, p.external_url, p.published_at,
            o.name, o.logo_url, o.colour, null::text, null::text, l.slug, l.name, o.slug, p.slug, p.kind, p.author_name,
            jsonb_build_array(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
       from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = p.league_id, me, lim
      where p.status = 'published' and not p.hidden and o.status = 'active' and p.published_at < lim.before
        and (o.id = any (me.outlets) or p.league_id = any (me.leagues)) and public.creators_shown(p.league_id)
      order by p.published_at desc limit (select n from lim))
    union all
    (select 'outlet'::text, i.id, i.title, i.summary, i.image_url, i.url, i.published_at,
            s.name, s.logo_url, s.colour, s.site_url, s.slug, coalesce(l.slug, t.slug), coalesce(l.name, t.name),
            null::text, null::text, null::text, i.author, public.news_item_leagues(i.league_ids, s.league_id)
       from news_items i join news_sources s on s.id = i.source_id left join leagues l on l.id = s.league_id
            left join leagues t on t.id = i.league_ids[1], me, lim
      where s.enabled and i.published_at < lim.before
        and (s.id = any (me.sources) or s.league_id = any (me.leagues) or i.league_ids && me.leagues)
        and (s.league_id is null or public.league_visible(s.league_id))
      order by i.published_at desc limit (select n from lim))
  ) x
  order by 7 desc, 2
  limit (select n from lim);
$$;

/* A PUBLISHER'S PAGE: the source and its stories on the site, newest first, `p_limit` before `p_before`.
   Null for a source that is off, or a league's the reader may not see. */
create or replace function public.news_source_public(p_slug text, p_before timestamptz default null, p_limit int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'id', s.id, 'slug', s.slug, 'name', s.name, 'site_url', s.site_url, 'logo_url', s.logo_url, 'colour', s.colour,
      'league', (select jsonb_build_object('slug', l.slug, 'name', l.name) from leagues l where l.id = s.league_id),
      'items', coalesce((select jsonb_agg(x order by x->>'published_at' desc) from (
          select jsonb_build_object('id', i.id, 'title', i.title, 'summary', i.summary, 'image_url', i.image_url, 'url', i.url,
                                    'author', i.author, 'tags', to_jsonb(i.tags), 'published_at', i.published_at,
                                    'leagues', public.news_item_leagues(i.league_ids, s.league_id)) as x
            from news_items i
           where i.source_id = s.id and i.published_at < coalesce(p_before, 'infinity'::timestamptz)
           order by i.published_at desc limit greatest(1, least(coalesce(p_limit, 30), 60))) q), '[]'::jsonb))
    from news_sources s
   where s.slug = p_slug and s.enabled and (s.league_id is null or public.league_visible(s.league_id));
$$;

/* ONE STORY, where a notification lands: the story, its publisher, the leagues it is about (each one's news page
   carries it), and the link to read it on the publisher's site */
create or replace function public.news_item_public(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'title', i.title, 'summary', i.summary, 'image_url', i.image_url, 'url', i.url,
                            'author', i.author, 'tags', to_jsonb(i.tags), 'published_at', i.published_at,
                            'source', jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'site_url', s.site_url,
                                                         'logo_url', s.logo_url, 'colour', s.colour),
                            'leagues', public.news_item_leagues(i.league_ids, s.league_id))
    from news_items i join news_sources s on s.id = i.source_id
   where i.id = p_id and s.enabled and (s.league_id is null or public.league_visible(s.league_id));
$$;

/* THE PUBLISHERS, for the News page's row of them: every source on, with a story, most recently active first */
create or replace function public.news_sources_public(p_league uuid default null)
returns table (id uuid, slug text, name text, site_url text, logo_url text, colour text,
               league_slug text, league_name text, items bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.slug, s.name, s.site_url, s.logo_url, s.colour, l.slug, l.name,
         (select count(*) from news_items i where i.source_id = s.id),
         (select max(i.published_at) from news_items i where i.source_id = s.id)
    from news_sources s left join leagues l on l.id = s.league_id
   where s.enabled and exists (select 1 from news_items i where i.source_id = s.id)
     and (s.league_id is null or public.league_visible(s.league_id))
     and (p_league is null or ((s.league_id = p_league
                                or exists (select 1 from news_items i where i.source_id = s.id and p_league = any (i.league_ids)))
                               and public.league_visible(p_league)))
   order by 10 desc nulls last, s.name;
$$;

-- --------------------------------------------------------------------------------------- following ---
/* A FAN FOLLOWS A PUBLISHER OR AN OUTLET the way they follow a club (follow.js, fan_prefs): two more lists, and
   one switch for the notices they bring (want_news), beside the others in the profile. */
/* (the columns themselves are added at the top of this file: the feed functions read them) */

/* set_fan_prefs (latest 0161), taking the two lists and the switch as well */
create or replace function public.set_fan_prefs(p jsonb)
returns public.fan_prefs language plpgsql security invoker set search_path = public as $$
declare r public.fan_prefs;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update fan_prefs set
    theme              = coalesce(p->>'theme', theme),
    colour             = coalesce(p->>'colour', colour),
    fav_team_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_team_ids') x), fav_team_ids),
    fav_player_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_player_ids') x), fav_player_ids),
    fav_game_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_game_ids') x), fav_game_ids),
    fav_league_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_league_ids') x), fav_league_ids),
    fav_source_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_source_ids') x), fav_source_ids),   -- 0194
    fav_outlet_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_outlet_ids') x), fav_outlet_ids),   -- 0194
    notify_inapp       = coalesce((p->>'notify_inapp')::boolean, notify_inapp),
    notify_email       = coalesce((p->>'notify_email')::boolean, notify_email),
    notify_push        = coalesce((p->>'notify_push')::boolean, notify_push),
    want_results       = coalesce((p->>'want_results')::boolean, want_results),
    want_players       = coalesce((p->>'want_players')::boolean, want_players),
    want_fixtures      = coalesce((p->>'want_fixtures')::boolean, want_fixtures),
    want_announcements = coalesce((p->>'want_announcements')::boolean, want_announcements),
    want_fixture_2d    = coalesce((p->>'want_fixture_2d')::boolean, want_fixture_2d),
    want_fixture_2h    = coalesce((p->>'want_fixture_2h')::boolean, want_fixture_2h),
    want_lineups       = coalesce((p->>'want_lineups')::boolean, want_lineups),
    want_player_games  = coalesce((p->>'want_player_games')::boolean, want_player_games),
    want_halftime      = coalesce((p->>'want_halftime')::boolean, want_halftime),
    want_fanvote       = coalesce((p->>'want_fanvote')::boolean, want_fanvote),         -- 0150
    want_favourites    = coalesce((p->>'want_favourites')::boolean, want_favourites),   -- 0161
    want_news          = coalesce((p->>'want_news')::boolean, want_news),               -- 0194
    time_zone          = case when nullif(btrim(coalesce(p->>'time_zone', '')), '') is not null
                               then public.notify_valid_tz(p->>'time_zone') else time_zone end,
    updated_at         = now()
  where user_id = auth.uid()
  returning * into r;

  -- an empty array is a real instruction, and array_agg over nothing is null
  if p ? 'fav_team_ids' and jsonb_array_length(p->'fav_team_ids') = 0 then
    update fan_prefs set fav_team_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_player_ids' and jsonb_array_length(p->'fav_player_ids') = 0 then
    update fan_prefs set fav_player_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_game_ids' and jsonb_array_length(p->'fav_game_ids') = 0 then
    update fan_prefs set fav_game_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_league_ids' and jsonb_array_length(p->'fav_league_ids') = 0 then
    update fan_prefs set fav_league_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_source_ids' and jsonb_array_length(p->'fav_source_ids') = 0 then
    update fan_prefs set fav_source_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_outlet_ids' and jsonb_array_length(p->'fav_outlet_ids') = 0 then
    update fan_prefs set fav_outlet_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  return r;
end $$;

/* the two kinds of notice this brings, beside 0127's */
alter table public.notifications
  drop constraint if exists notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy', 'test',
                    'news', 'creator'));

/* the words of a notice: the headline, then as much of the excerpt as fits a lock screen */
create or replace function public.notif_story(p_title text, p_summary text)
returns text language sql immutable as $$
  select case when coalesce(btrim(p_summary), '') = '' then btrim(coalesce(p_title, ''))
              else left(btrim(coalesce(p_title, '')) || ' — ' || btrim(p_summary), 180)
                   || case when char_length(btrim(coalesce(p_title, '')) || ' — ' || btrim(p_summary)) > 180 then '…' else '' end end;
$$;

/* AN OUTLET'S NEW PIECE, to everybody who follows it and may see its league: once, when it is first published.
   An article opens its page on the site; a social post, a video or a podcast opens its page too, where it is
   embedded with its caption. The person who published it is not told about their own piece. */
create or replace function public.notify_creator_piece(p_post uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; p creator_posts; o creator_outlets; lslug text;
begin
  select * into p from creator_posts where id = p_post;
  if p.id is null or p.status <> 'published' or p.hidden then return 0; end if;
  select * into o from creator_outlets where id = p.outlet_id;
  if o.status <> 'active' or not coalesce((select l.creators_enabled from leagues l where l.id = p.league_id), false) then return 0; end if;
  select slug into lslug from leagues where id = p.league_id;
  insert into notifications (user_id, kind, title, body, link, league_id, ref, data, urgency, expires_at)
  select f.user_id, 'creator', o.name,
         case when p.kind = 'article' then public.notif_story(p.title, p.standfirst)
              else left(coalesce(nullif(btrim(p.standfirst), ''), p.title), 180) end,
         'creators/?l=' || lslug || '&o=' || o.slug || '&p=' || p.slug, p.league_id, p.id::text,
         jsonb_build_object('outlet', o.id, 'post', p.id, 'kind', p.kind, 'image', p.cover_url, 'external_url', p.external_url),
         'normal', now() + interval '2 days'
    from fan_prefs f
   where o.id = any (f.fav_outlet_ids) and f.want_news
     and f.user_id is distinct from p.author_id
     and public.can_view_league_for(f.user_id, p.league_id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

/* A PUBLISHER'S NEW STORIES, to everybody who follows it: after each write of the fetcher, the stories that are
   new in it and from the last twelve hours. One story is its own notice (the headline and its excerpt, opening
   the story's page on the site, which links to the publisher's); several in one read are one notice naming them,
   opening the publisher's page. A source's FIRST read is its back catalogue, and tells nobody anything.
   It never stops the write: whatever goes wrong here is left for the next read. */
create or replace function public.notify_news_items()
returns trigger language plpgsql security definer set search_path = public as $$
declare src record; fresh_n int; first_id uuid; first_title text; first_summary text; titles text;
begin
  begin
    for src in
      select s.id, s.slug, s.name, s.league_id, count(*) as n
        from new_items i join news_sources s on s.id = i.source_id
       where s.enabled and i.published_at > now() - interval '12 hours'
         and exists (select 1 from news_items old_i where old_i.source_id = s.id
                      and not exists (select 1 from new_items x where x.id = old_i.id))
       group by s.id
    loop
      fresh_n := src.n;
      select i.id, i.title, i.summary into first_id, first_title, first_summary
        from new_items i where i.source_id = src.id and i.published_at > now() - interval '12 hours'
       order by i.published_at desc limit 1;
      if fresh_n = 1 then
        insert into notifications (user_id, kind, title, body, link, league_id, ref, data, urgency, expires_at)
        select f.user_id, 'news', src.name, public.notif_story(first_title, first_summary), 'news/?i=' || first_id,
               src.league_id, first_id::text, jsonb_build_object('source', src.id, 'item', first_id), 'normal', now() + interval '1 day'
          from fan_prefs f
         where src.id = any (f.fav_source_ids) and f.want_news
           and (src.league_id is null or public.can_view_league_for(f.user_id, src.league_id))
        on conflict do nothing;
      else
        select string_agg(t, ' · ') into titles from (
          select i.title as t from new_items i where i.source_id = src.id and i.published_at > now() - interval '12 hours'
           order by i.published_at desc limit 3) q;
        insert into notifications (user_id, kind, title, body, link, league_id, ref, data, urgency, expires_at)
        select f.user_id, 'news', src.name || ' · ' || fresh_n || ' new stories', left(titles, 180), 'news/?s=' || src.slug,
               src.league_id, 'batch:' || first_id, jsonb_build_object('source', src.id, 'count', fresh_n), 'normal', now() + interval '1 day'
          from fan_prefs f
         where src.id = any (f.fav_source_ids) and f.want_news
           and (src.league_id is null or public.can_view_league_for(f.user_id, src.league_id))
        on conflict do nothing;
      end if;
    end loop;
  exception when others then
    null;
  end;
  return null;
end $$;

drop trigger if exists news_items_notify on public.news_items;
create trigger news_items_notify after insert on public.news_items
  referencing new table as new_items for each statement execute function public.notify_news_items();

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.my_email() from public, anon;
revoke all on function public.creator_role(uuid) from public, anon;
revoke all on function public.can_run_outlet(uuid) from public, anon;
revoke all on function public.can_write_outlet(uuid) from public, anon;
revoke all on function public.set_league_creators(uuid, boolean) from public, anon;
revoke all on function public.create_creator_outlet(uuid, text, text) from public, anon;
revoke all on function public.set_creator_outlet_status(uuid, text) from public, anon;
revoke all on function public.hide_creator_post(uuid, boolean) from public, anon;
revoke all on function public.creators_admin(uuid) from public, anon;
revoke all on function public.my_creator_outlets() from public, anon;
revoke all on function public.creator_studio(uuid) from public, anon;
revoke all on function public.update_creator_outlet(uuid, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.add_creator_member(uuid, text, text) from public, anon;
revoke all on function public.remove_creator_member(uuid, text) from public, anon;
revoke all on function public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text) from public, anon;
revoke all on function public.delete_creator_post(uuid) from public, anon;
grant execute on function public.my_email() to authenticated;
grant execute on function public.creator_role(uuid) to authenticated;
grant execute on function public.can_run_outlet(uuid) to authenticated;
grant execute on function public.can_write_outlet(uuid) to authenticated;
grant execute on function public.set_league_creators(uuid, boolean) to authenticated;
grant execute on function public.create_creator_outlet(uuid, text, text) to authenticated;
grant execute on function public.set_creator_outlet_status(uuid, text) to authenticated;
grant execute on function public.hide_creator_post(uuid, boolean) to authenticated;
grant execute on function public.creators_admin(uuid) to authenticated;
grant execute on function public.my_creator_outlets() to authenticated;
grant execute on function public.creator_studio(uuid) to authenticated;
grant execute on function public.update_creator_outlet(uuid, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.add_creator_member(uuid, text, text) to authenticated;
grant execute on function public.remove_creator_member(uuid, text) to authenticated;
grant execute on function public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text) to authenticated;
grant execute on function public.delete_creator_post(uuid) to authenticated;
grant execute on function public.creators_shown(uuid) to anon, authenticated;
grant execute on function public.creators_probe(text) to anon, authenticated;
grant execute on function public.creators_public(uuid, int, int) to anon, authenticated;
grant execute on function public.creator_outlets_public(uuid) to anon, authenticated;
grant execute on function public.creator_outlet_public(uuid, text) to anon, authenticated;
grant execute on function public.creator_post_public(uuid, text, text) to anon, authenticated;
revoke all on function public.can_manage_news_sources(uuid) from public, anon;
revoke all on function public.add_news_source(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.update_news_source(uuid, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.delete_news_source(uuid) from public, anon;
revoke all on function public.news_sources_admin(uuid) from public, anon;
grant execute on function public.can_manage_news_sources(uuid) to authenticated;
grant execute on function public.add_news_source(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.update_news_source(uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_news_source(uuid) to authenticated;
grant execute on function public.news_sources_admin(uuid) to authenticated;
grant execute on function public.news_feed(uuid, timestamptz, int, text[]) to anon, authenticated;
grant execute on function public.news_feed_mine(timestamptz, int) to authenticated;
revoke all on function public.news_feed_mine(timestamptz, int) from public, anon;
grant execute on function public.news_source_public(text, timestamptz, int) to anon, authenticated;
grant execute on function public.news_item_public(uuid) to anon, authenticated;
grant execute on function public.news_sources_public(uuid) to anon, authenticated;
revoke all on function public.notify_creator_piece(uuid) from public, anon, authenticated;
revoke all on function public.notify_news_items() from public, anon, authenticated;
revoke all on function public.news_items_keep_time() from public, anon, authenticated;
revoke all on function public.clean_creator_body(jsonb) from public, anon, authenticated;
revoke all on function public.news_item_leagues(uuid[], uuid) from public, anon, authenticated;
