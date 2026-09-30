-- ============================================================================
-- 0200: THE CREATOR HUB (creators/hub/). What a creator needs beside the writing itself.
--
--   1. HOW THEIR WORK DOES HERE. creator_events counts, anonymously, a piece SEEN on a page (its card in a feed),
--      OPENED here (its own page) and followed OUT to where it lives (its link). Nothing about the reader is kept:
--      the random token of one browser tab (track.js's, forgotten when the tab closes), the kind of device, the
--      page it happened on, and for an opening the page or the other site it was opened from. creator_track()
--      takes them in - from anyone, checked and capped like analytics_track (0173) - and creator_stats() gives an
--      outlet's figures to its own people and its league. Raw rows go after 400 days, like 0173's.
--   2. THE WRITING DESK, closer to what a newsroom's editor offers:
--        * tags (eight at most) and a title and a description for search engines and link previews;
--        * SCHEDULED publishing: status 'scheduled' with the time it goes out in published_at. Every reader
--          already asks for status = 'published', so a scheduled piece stays out of sight until
--          creator_publish_due() publishes it (every five minutes where pg_cron runs, and whenever a creator saves,
--          opens the studio or their numbers), and its followers are told then;
--        * REVISIONS: the version a save replaced, the last 25 of each piece, to look at and bring back;
--        * articles may carry a PULL QUOTE and an EMBEDDED video, episode or post, and a picture carries a
--          description for screen readers. League news is untouched (clean_news_body, 0051).
--   3. PICTURES OF THEIR OWN: a public bucket, creator-media, each outlet writing into its own folder.
-- ============================================================================

-- --------------------------------------------------------------------------------- the writing desk ---
alter table public.creator_posts
  add column if not exists tags            text[] not null default '{}',
  add column if not exists seo_title       text,
  add column if not exists seo_description text,
  add column if not exists edited_name     text not null default '';
alter table public.creator_posts drop constraint if exists creator_posts_status_ck;
alter table public.creator_posts add constraint creator_posts_status_ck check (status in ('draft', 'scheduled', 'published'));
alter table public.creator_posts drop constraint if exists creator_posts_tags_ck;
alter table public.creator_posts add constraint creator_posts_tags_ck check (cardinality(tags) <= 8);
alter table public.creator_posts drop constraint if exists creator_posts_seo_ck;
alter table public.creator_posts add constraint creator_posts_seo_ck
  check ((seo_title is null or char_length(seo_title) <= 70) and (seo_description is null or char_length(seo_description) <= 160));
create index if not exists creator_posts_due on public.creator_posts (published_at) where status = 'scheduled';

/* A PIECE'S TAGS in their one form: trimmed, each a word or a few (letters and digits first, then . & + # ' - and
   spaces, 30 characters at most), the same tag once whatever its case, nothing from GO's word list, eight at most. */
create or replace function public.creator_tags(p text[])
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(t order by n), '{}'::text[]) from (
    select t, n from (
      select distinct on (lower(t)) t, n from (
        select btrim(regexp_replace(x, '\s+', ' ', 'g')) as t, n
          from unnest(coalesce(p, '{}'::text[])) with ordinality u(x, n)) a
       where t ~ '^[[:alnum:]][[:alnum:] &''’.+#-]{0,29}$' and public.go_caption_ok(t)
       order by lower(t), n) d
     order by n limit 8) q;
$$;

/* HOW MANY WORDS a body holds (a revision's size in the list) */
create or replace function public.creator_words(p_body jsonb)
returns integer language sql immutable as $$
  select coalesce(sum(coalesce(array_length(regexp_split_to_array(btrim(t), '\s+'), 1), 0)) filter (where btrim(coalesce(t, '')) <> ''), 0)::int
    from (select s->>'t' as t
            from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
            cross join lateral jsonb_array_elements(case when jsonb_typeof(b->'spans') = 'array' then b->'spans' else '[]'::jsonb end) s
          union all
          select s->>'t'
            from jsonb_array_elements(case when jsonb_typeof(p_body) = 'array' then p_body else '[]'::jsonb end) b
            cross join lateral jsonb_array_elements(case when jsonb_typeof(b->'items') = 'array' then b->'items' else '[]'::jsonb end) it
            cross join lateral jsonb_array_elements(case when jsonb_typeof(it) = 'array' then it else '[]'::jsonb end) s) q;
$$;

/* A CREATOR'S ARTICLE is the league's news format (clean_news_body) and three things more: a PULL QUOTE (its words
   and who said them), an EMBED (the https address of a video, an episode or a post: the page plays it only when
   it is from a platform it knows, and otherwise shows it as a link), and a picture's DESCRIPTION for screen
   readers. Pictures are https addresses, as before. */
create or replace function public.clean_creator_body(p_body jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare b jsonb; out_b jsonb := '[]'::jsonb; t text; spans jsonb; u text; one jsonb;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'array' then return '[]'::jsonb; end if;
  for b in select * from jsonb_array_elements(p_body) loop
    continue when jsonb_typeof(b) <> 'object';
    t := b->>'type';
    if t = 'pullquote' then
      spans := public.clean_news_spans(b->'spans');
      if jsonb_array_length(spans) > 0 then
        out_b := out_b || jsonb_build_array(jsonb_build_object('type', 'pullquote', 'spans', spans,
                                                               'cite', left(btrim(coalesce(b->>'cite', '')), 120)));
      end if;
    elsif t = 'embed' then
      u := btrim(coalesce(b->>'url', ''));
      if u ~* '^https://[^\s<>"]+$' and char_length(u) <= 500 then
        out_b := out_b || jsonb_build_array(jsonb_build_object('type', 'embed', 'url', u,
                                                               'caption', left(btrim(coalesce(b->>'caption', '')), 200)));
      end if;
    elsif t = 'image' then
      one := public.clean_news_body(jsonb_build_array(b))->0;
      if one is not null and (one->>'path') ~* '^https://[^\s<>"]+$' then
        out_b := out_b || jsonb_build_array(one || jsonb_build_object('alt', left(btrim(coalesce(b->>'alt', '')), 200)));
      end if;
    else
      out_b := out_b || coalesce(public.clean_news_body(jsonb_build_array(b)), '[]'::jsonb);
    end if;
  end loop;
  return out_b;
end $$;

/* ------------------------------------------------------------------------------------- revisions --- */
create table if not exists public.creator_post_revisions (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.creator_posts on delete cascade,
  title       text not null,
  standfirst  text not null default '',
  body        jsonb not null default '[]'::jsonb,
  tags        text[] not null default '{}',
  saved_name  text not null default '',
  saved_at    timestamptz not null,
  kept_at     timestamptz not null default clock_timestamp()      -- the order of two saves in the same second
);
create index if not exists creator_post_revisions_post on public.creator_post_revisions (post_id, saved_at desc, kept_at desc);
alter table public.creator_post_revisions enable row level security;
revoke all on public.creator_post_revisions from anon, authenticated;
comment on table public.creator_post_revisions is '0200: the version of a creator''s piece each save replaced (the last 25).';

/* EVERY SAVE THAT CHANGES THE WORDS keeps the version it replaced: its words, when that version was saved, and who
   saved it. The oldest go past 25. */
create or replace function public.creator_post_revise()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.title, old.standfirst, old.body, old.tags) is distinct from (new.title, new.standfirst, new.body, new.tags) then
    insert into creator_post_revisions (post_id, title, standfirst, body, tags, saved_name, saved_at)
    values (old.id, old.title, old.standfirst, old.body, old.tags, coalesce(nullif(old.edited_name, ''), old.author_name), old.updated_at);
    delete from creator_post_revisions
     where id in (select r.id from creator_post_revisions r where r.post_id = old.id order by r.saved_at desc, r.kept_at desc offset 25);
  end if;
  return new;
end $$;
drop trigger if exists creator_post_revise on public.creator_posts;
create trigger creator_post_revise before update on public.creator_posts
  for each row execute function public.creator_post_revise();

/* A PIECE'S REVISIONS (its outlet's people and the league): newest first, each with its headline and its length */
create or replace function public.creator_post_revisions(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_outlet uuid;
begin
  select outlet_id into v_outlet from creator_posts where id = p_post;
  if v_outlet is null or not public.can_write_outlet(v_outlet) then
    raise exception 'you do not write for that outlet' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'saved_at', r.saved_at, 'saved_name', r.saved_name,
                                                       'title', r.title, 'words', public.creator_words(r.body)) order by r.saved_at desc, r.kept_at desc)
                     from creator_post_revisions r where r.post_id = p_post), '[]'::jsonb);
end $$;

/* ONE REVISION, whole, to look at or to bring back into the editor (bringing it back is a save like any other) */
create or replace function public.creator_post_revision(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r creator_post_revisions; v_outlet uuid;
begin
  select * into r from creator_post_revisions where id = p_id;
  select outlet_id into v_outlet from creator_posts where id = r.post_id;
  if r.id is null or v_outlet is null or not public.can_write_outlet(v_outlet) then
    raise exception 'you do not write for that outlet' using errcode = '42501';
  end if;
  return jsonb_build_object('id', r.id, 'post_id', r.post_id, 'title', r.title, 'standfirst', r.standfirst, 'body', r.body,
                            'tags', to_jsonb(r.tags), 'saved_at', r.saved_at, 'saved_name', r.saved_name);
end $$;

/* ----------------------------------------------------------------------------------- scheduling --- */
/* WHAT IS DUE GOES OUT: every scheduled piece whose time has come, and its followers are told (once:
   notify_creator_piece keeps one notice a piece a follower). */
create or replace function public.creator_publish_due()
returns integer language plpgsql security definer set search_path = public as $$
declare pid uuid; n integer := 0;
begin
  for pid in update creator_posts set status = 'published', updated_at = now()
              where status = 'scheduled' and published_at <= now()
              returning id loop
    perform public.notify_creator_piece(pid);
    n := n + 1;
  end loop;
  return n;
end $$;

do $cron$
begin
  if to_regclass('cron.job') is not null then
    begin
      execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-creator-publish'::text;
      execute 'select cron.schedule($1, $2, $3)'
        using 'epinoia-creator-publish'::text, '*/5 * * * *'::text, 'select public.creator_publish_due()'::text;
      raise notice '0200: pg_cron job epinoia-creator-publish publishes scheduled pieces every five minutes';
    exception when others then
      raise warning '0200: the publishing job was not scheduled (%: %); scheduled pieces go out when a creator saves or opens the hub', sqlstate, sqlerrm;
    end;
  else
    raise notice '0200: pg_cron is not installed here; scheduled pieces go out when a creator saves or opens the hub';
  end if;
end $cron$;

/* WRITE A PIECE (0194's, and more): tags, the search engines' title and description, and a time to publish at.
   p_status 'scheduled' with p_publish_at: out of sight until then (a time already passed publishes it now; a year
   ahead at the most). The new arguments default to leaving what is there, so a caller that does not send them
   changes nothing of them. The old signature goes: PostgREST could not choose between the two. */
drop function if exists public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text);
create or replace function public.upsert_creator_post(
  p_id uuid, p_outlet uuid, p_kind text, p_title text, p_standfirst text, p_body jsonb,
  p_cover_url text default null, p_external_url text default null, p_status text default 'draft', p_slug text default null,
  p_tags text[] default null, p_seo_title text default null, p_seo_description text default null, p_publish_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  o creator_outlets; was creator_posts; v_id uuid; v_slug text; n int := 1; v_name text; v_at timestamptz;
  st text := coalesce(p_status, 'draft');
  cov text := nullif(btrim(coalesce(p_cover_url, '')), ''); ext text := nullif(btrim(coalesce(p_external_url, '')), '');
  seo_t text := nullif(btrim(regexp_replace(coalesce(p_seo_title, ''), '\s+', ' ', 'g')), '');
  seo_d text := nullif(btrim(regexp_replace(coalesce(p_seo_description, ''), '\s+', ' ', 'g')), '');
begin
  perform public.creator_publish_due();
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
  if st not in ('draft', 'published', 'scheduled') then
    raise exception 'a piece is a draft, scheduled or published' using errcode = '22023';
  end if;
  if st = 'scheduled' then
    if p_publish_at is null then
      raise exception 'a scheduled piece needs the date and time it goes out' using errcode = '22023';
    elsif p_publish_at <= now() + interval '1 minute' then
      st := 'published';                                   -- a time already come: now
    elsif p_publish_at > now() + interval '1 year' then
      raise exception 'a piece can be scheduled a year ahead at the most' using errcode = '22023';
    end if;
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
  if seo_t is not null and char_length(seo_t) > 70 then
    raise exception 'a title for search engines is 70 characters at the most' using errcode = '22023';
  end if;
  if seo_d is not null and char_length(seo_d) > 160 then
    raise exception 'a description for search engines is 160 characters at the most' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into was from creator_posts p where p.id = p_id and p.outlet_id = p_outlet;
    if was.id is null then
      raise exception 'no such piece in this outlet' using errcode = '42501';
    end if;
  end if;

  v_slug := public.creator_slug(coalesce(nullif(btrim(coalesce(p_slug, '')), ''), p_title), 'piece');
  while exists (select 1 from creator_posts p where p.outlet_id = p_outlet and p.slug = v_slug and (p_id is null or p.id <> p_id)) loop
    n := n + 1;
    v_slug := left(public.creator_slug(coalesce(nullif(btrim(coalesce(p_slug, '')), ''), p_title), 'piece'), 55) || '-' || n;
  end loop;

  select coalesce(nullif(pr.display_name, ''), split_part(u.email::text, '@', 1)) into v_name
    from auth.users u left join profiles pr on pr.id = u.id where u.id = auth.uid();

  /* when it is out: a published piece keeps the moment it first went out; a scheduled one, its time */
  v_at := case st
            when 'published' then case when was.published_at is not null and was.status <> 'scheduled' then was.published_at else now() end
            when 'scheduled' then p_publish_at
            else case when was.status = 'published' then was.published_at end
          end;

  if p_id is null then
    insert into creator_posts (outlet_id, league_id, slug, kind, title, standfirst, body, cover_url, external_url, status,
                               published_at, author_id, author_name, edited_name, tags, seo_title, seo_description)
    values (p_outlet, o.league_id, v_slug, coalesce(p_kind, 'article'), btrim(p_title), left(btrim(coalesce(p_standfirst, '')), 300),
            public.clean_creator_body(p_body), cov, ext, st, v_at, auth.uid(), coalesce(v_name, ''), coalesce(v_name, ''),
            public.creator_tags(p_tags), seo_t, seo_d)
    returning id into v_id;
  else
    update creator_posts
       set slug = v_slug, kind = coalesce(p_kind, 'article'), title = btrim(p_title),
           standfirst = left(btrim(coalesce(p_standfirst, '')), 300), body = public.clean_creator_body(p_body),
           cover_url = cov, external_url = ext, status = st, published_at = v_at,
           tags = case when p_tags is null then tags else public.creator_tags(p_tags) end,
           seo_title = case when p_seo_title is null then seo_title else seo_t end,
           seo_description = case when p_seo_description is null then seo_description else seo_d end,
           edited_name = coalesce(v_name, ''), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;
  if st = 'published' and coalesce(was.status, '') <> 'published' then perform public.notify_creator_piece(v_id); end if;
  return v_id;
end $$;
revoke all on function public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text, text[], text, text, timestamptz) from public, anon;
grant execute on function public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text, text[], text, text, timestamptz) to authenticated;

/* THE STUDIO (0194's): each piece with its tags, its search title and description, and who saved it last */
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
        'published_at', p.published_at, 'updated_at', p.updated_at, 'author_name', p.author_name,
        'edited_name', p.edited_name, 'tags', to_jsonb(p.tags), 'seo_title', p.seo_title, 'seo_description', p.seo_description)
        order by coalesce(p.published_at, p.updated_at) desc)
      from creator_posts p where p.outlet_id = p_outlet), '[]'::jsonb));
end $$;

/* AN OUTLET'S PAGE (0194's): each piece now with its id (the counts are kept by it) and its tags */
create or replace function public.creator_outlet_public(p_league uuid, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'id', o.id, 'slug', o.slug, 'name', o.name, 'tagline', o.tagline, 'bio', o.bio, 'logo_url', o.logo_url, 'colour', o.colour,
      'links', o.links,
      'posts', coalesce((select jsonb_agg(x order by x->>'published_at' desc) from (
          select jsonb_build_object('id', p.id, 'slug', p.slug, 'kind', p.kind, 'title', p.title, 'standfirst', p.standfirst,
                                    'cover_url', p.cover_url, 'external_url', p.external_url, 'published_at', p.published_at,
                                    'author_name', p.author_name, 'tags', to_jsonb(p.tags)) as x
            from creator_posts p where p.outlet_id = o.id and p.status = 'published' and not p.hidden
           order by p.published_at desc limit 50) q), '[]'::jsonb))
    from creator_outlets o
   where o.league_id = p_league and o.slug = p_slug and o.status = 'active' and public.creators_shown(p_league);
$$;

/* ONE PIECE (0194's): now with its id, its tags, and its title and description for search engines */
create or replace function public.creator_post_public(p_league uuid, p_outlet text, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'kind', p.kind, 'title', p.title, 'standfirst', p.standfirst, 'body', p.body,
      'cover_url', p.cover_url, 'external_url', p.external_url, 'published_at', p.published_at,
      'updated_at', p.updated_at, 'author_name', p.author_name, 'tags', to_jsonb(p.tags),
      'seo_title', p.seo_title, 'seo_description', p.seo_description,
      'outlet', jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'tagline', o.tagline, 'logo_url', o.logo_url,
                                   'colour', o.colour, 'links', o.links),
      'league', jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo', l.logo_path))
    from creator_posts p join creator_outlets o on o.id = p.outlet_id join leagues l on l.id = o.league_id
   where o.league_id = p_league and o.slug = p_outlet and p.slug = p_slug
     and p.status = 'published' and not p.hidden and o.status = 'active' and public.creators_shown(p_league);
$$;

-- --------------------------------------------------------------------------- how the work does ---
create table if not exists public.creator_events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  kind      text not null check (kind in ('seen', 'open', 'out')),
  post_id   uuid not null references public.creator_posts on delete cascade,
  outlet_id uuid not null references public.creator_outlets on delete cascade,
  source    text check (source ~ '^[a-z0-9/-]{1,40}$'),
  ref       text check (ref ~ '^[a-z0-9.-]{1,100}$'),
  session   text not null check (session ~ '^[A-Za-z0-9_-]{16,40}$'),
  device    text check (device in ('phone', 'tablet', 'desktop'))
);
create index if not exists creator_events_outlet_at on public.creator_events (outlet_id, at);
create index if not exists creator_events_once on public.creator_events (session, post_id, kind, at);
alter table public.creator_events enable row level security;
revoke all on table public.creator_events from public, anon, authenticated;
comment on table public.creator_events is '0200: a creator''s piece seen, opened or followed out; anonymous (a tab''s random token), kept 400 days.';

/* IN (track.js piece()). One call carries a batch: { post, kind, source, ref }. Only a piece that is out and shown
   counts; the same tab counts a piece once each way in thirty minutes (a reload is not a second reader); at most 50
   a call and 300 a tab in ten minutes, as 0173 caps a visit. Anything that fails a check is dropped, never an
   error, so an old page cannot break. */
create or replace function public.creator_track(p_session text, p_device text, p_events jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_room int; n int := 0;
begin
  if coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{16,40}$' or jsonb_typeof(p_events) is distinct from 'array' then
    return 0;
  end if;
  select 300 - count(*) into v_room from creator_events where session = p_session and at > now() - interval '10 minutes';
  if v_room <= 0 then return 0; end if;
  insert into creator_events (kind, post_id, outlet_id, source, ref, session, device)
  select distinct on (x.kind, p.id) x.kind, p.id, p.outlet_id, x.source, x.ref, p_session,
         case when p_device in ('phone', 'tablet', 'desktop') then p_device end
    from (select e ->> 'kind' as kind,
                 case when (e ->> 'post') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e ->> 'post')::uuid end as post,
                 case when lower(e ->> 'source') ~ '^[a-z0-9/-]{1,40}$' then lower(e ->> 'source') end as source,
                 case when e ->> 'kind' = 'open' and lower(e ->> 'ref') ~ '^[a-z0-9.-]{1,100}$' then lower(e ->> 'ref') end as ref
            from jsonb_array_elements(p_events) with ordinality a(e, i)
           where a.i <= least(50, v_room) and jsonb_typeof(e) = 'object') x
    join creator_posts p on p.id = x.post and p.status = 'published' and not p.hidden
    join creator_outlets o on o.id = p.outlet_id and o.status = 'active'
   where x.kind in ('seen', 'open', 'out')
     and not exists (select 1 from creator_events c
                      where c.session = p_session and c.post_id = p.id and c.kind = x.kind and c.at > now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n;
end $$;

/* OUT: AN OUTLET'S FIGURES for its own people and its league, for the last p_days days (today and the ones before
   it) and the same stretch before that, to compare: pieces seen, opened and followed out, and how many tabs opened
   one ("readers"); day by day; the pieces that did best; the pages and the other sites readers came from; phones,
   tablets and desktops; followers; and the pieces by state. Opening it publishes anything due. */
create or replace function public.creator_stats(p_outlet uuid, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d int := greatest(1, least(coalesce(p_days, 30), 365)); since timestamptz; before timestamptz;
begin
  if not public.can_write_outlet(p_outlet) then
    raise exception 'you do not write for that outlet' using errcode = '42501';
  end if;
  perform public.creator_publish_due();
  since := date_trunc('day', now()) - make_interval(days => d - 1);
  before := since - make_interval(days => d);
  return jsonb_build_object(
    'days', d, 'since', since,
    'totals', (select jsonb_build_object('seen', count(*) filter (where kind = 'seen'), 'open', count(*) filter (where kind = 'open'),
                                         'out', count(*) filter (where kind = 'out'),
                                         'readers', count(distinct session) filter (where kind = 'open'))
                 from creator_events where outlet_id = p_outlet and at >= since),
    'before', (select jsonb_build_object('seen', count(*) filter (where kind = 'seen'), 'open', count(*) filter (where kind = 'open'),
                                         'out', count(*) filter (where kind = 'out'),
                                         'readers', count(distinct session) filter (where kind = 'open'))
                 from creator_events where outlet_id = p_outlet and at >= before and at < since),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'seen', coalesce(e.seen, 0),
                                                           'open', coalesce(e.open, 0), 'out', coalesce(e.out, 0)) order by g.day), '[]'::jsonb)
                from generate_series(since::date, now()::date, interval '1 day') g(day)
                left join (select at::date as day, count(*) filter (where kind = 'seen') as seen, count(*) filter (where kind = 'open') as open,
                                  count(*) filter (where kind = 'out') as out
                             from creator_events where outlet_id = p_outlet and at >= since group by 1) e on e.day = g.day::date),
    'top', (select coalesce(jsonb_agg(x order by (x->>'open')::int desc, (x->>'seen')::int desc, x->>'title'), '[]'::jsonb) from (
              select jsonb_build_object('id', p.id, 'title', p.title, 'slug', p.slug, 'kind', p.kind, 'published_at', p.published_at,
                                        'seen', count(*) filter (where e.kind = 'seen'), 'open', count(*) filter (where e.kind = 'open'),
                                        'out', count(*) filter (where e.kind = 'out')) as x
                from creator_events e join creator_posts p on p.id = e.post_id
               where e.outlet_id = p_outlet and e.at >= since
               group by p.id
               order by count(*) filter (where e.kind = 'open') desc, count(*) filter (where e.kind = 'seen') desc
               limit 10) q),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', s, 'open', n) order by n desc, s), '[]'::jsonb) from (
                  select coalesce(source, case when ref is not null then 'elsewhere' else 'direct' end) as s, count(*) as n
                    from creator_events where outlet_id = p_outlet and at >= since and kind = 'open'
                   group by 1 order by 2 desc limit 8) q),
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('site', ref, 'open', n) order by n desc, ref), '[]'::jsonb) from (
                select ref, count(*) as n from creator_events
                 where outlet_id = p_outlet and at >= since and kind = 'open' and ref is not null
                 group by 1 order by 2 desc limit 8) q),
    'devices', (select coalesce(jsonb_object_agg(coalesce(device, 'unknown'), n), '{}'::jsonb) from (
                  select device, count(*) as n from creator_events
                   where outlet_id = p_outlet and at >= since and kind in ('seen', 'open') group by 1) q),
    'followers', (select count(*) from fan_prefs f where p_outlet = any (f.fav_outlet_ids)),
    'pieces', (select jsonb_build_object('published', count(*) filter (where status = 'published' and not hidden),
                                         'scheduled', count(*) filter (where status = 'scheduled'),
                                         'drafts', count(*) filter (where status = 'draft'),
                                         'hidden', count(*) filter (where hidden),
                                         'published_in', count(*) filter (where status = 'published' and published_at >= since))
                 from creator_posts where outlet_id = p_outlet));
end $$;

/* raw rows over 400 days old go, like 0173's */
create or replace function public.creator_events_prune()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from creator_events where at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end $$;
do $cron$
begin
  if to_regclass('cron.job') is not null then
    begin
      execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-creator-events-prune'::text;
      execute 'select cron.schedule($1, $2, $3)'
        using 'epinoia-creator-events-prune'::text, '23 4 * * *'::text, 'select public.creator_events_prune()'::text;
    exception when others then
      raise warning '0200: the prune job was not scheduled (%: %); run select public.creator_events_prune() now and then', sqlstate, sqlerrm;
    end;
  end if;
end $cron$;

-- ---------------------------------------------------------------------------------- their pictures ---
/* A PUBLIC BUCKET for a creator's pictures: an outlet's people write into its folder (<outlet id>/<name>), pictures
   of 3 MB at most, resized in the browser first (upload.js). What is published is the league's to hide, as ever. */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-media', 'creator-media', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.may_write_creator_media(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(p_name, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9-]{8,60}\.(webp|jpg|png)$' then
    return false;
  end if;
  return public.can_write_outlet(split_part(p_name, '/', 1)::uuid);
end $$;
drop policy if exists creator_media_write on storage.objects;
create policy creator_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'creator-media' and public.may_write_creator_media(name));

-- ------------------------------------------------------------------------------------------ grants ---
revoke all on function public.creator_tags(text[]) from public, anon, authenticated;
revoke all on function public.creator_words(jsonb) from public, anon, authenticated;
revoke all on function public.creator_post_revise() from public, anon, authenticated;
revoke all on function public.creator_events_prune() from public, anon, authenticated;
revoke all on function public.creator_publish_due() from public, anon;
revoke all on function public.creator_post_revisions(uuid) from public, anon;
revoke all on function public.creator_post_revision(uuid) from public, anon;
revoke all on function public.creator_stats(uuid, int) from public, anon;
revoke all on function public.creator_track(text, text, jsonb) from public;
revoke all on function public.may_write_creator_media(text) from public, anon;
grant execute on function public.creator_publish_due() to authenticated, service_role;
grant execute on function public.creator_post_revisions(uuid) to authenticated;
grant execute on function public.creator_post_revision(uuid) to authenticated;
grant execute on function public.creator_stats(uuid, int) to authenticated;
grant execute on function public.creator_track(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.may_write_creator_media(text) to authenticated;
