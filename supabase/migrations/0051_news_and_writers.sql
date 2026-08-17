-- ============================================================================
-- 0051 — LEAGUE NEWS, THE PEOPLE WHO WRITE IT, AND TWO SMALLER FIXES.
--
-- ---------------------------------------------------------------------------
-- HOW AN ARTICLE IS STORED, because it is the decision everything else in here
-- follows from.
--
-- The obvious answer is HTML: a contenteditable box produces it, a page
-- renders it with innerHTML, done. It is also how a content system becomes an
-- XSS hole — the body is written by a league writer, who is a person a league
-- appointed rather than a person we trust, and it is read by everybody.
-- Sanitising HTML on the way in means being right about every parser quirk
-- for ever; sanitising on the way out means shipping a sanitiser to every
-- reader and hoping it agrees with the browser.
--
-- So an article body is an ARRAY OF BLOCKS, not markup:
--
--   [{"type":"p","spans":[{"t":"Some words"},{"t":"bold bit","b":true}]},
--    {"type":"h2","spans":[…]},
--    {"type":"ul","items":[[…spans…],[…spans…]]},
--    {"type":"image","path":"team/<uuid>/news-….jpg","caption":"…"}]
--
-- The editor writes it by WALKING the contenteditable DOM and emitting only
-- shapes on this list, and the page renders it with createElement and
-- textContent. Nothing is ever parsed as markup, on either side, so there is
-- no injection to defend against rather than a defence to maintain. It also
-- means the CI guard that forbids user text in innerHTML keeps holding.
--
-- The trade is that a writer cannot paste arbitrary formatting and have all of
-- it survive. That is the correct trade for a league's news page.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WRITERS.
--
-- A table rather than a new value in role_kind: `alter type … add value`
-- cannot be used in the same transaction that adds it, and a migration is one
-- transaction, so a self-test could not exercise it. A join table costs one
-- helper function and can be tested the moment it exists.
-- ---------------------------------------------------------------------------
create table if not exists public.league_writers (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (league_id, user_id)
);
create index if not exists league_writers_league on public.league_writers (league_id);

alter table public.league_writers enable row level security;
drop policy if exists league_writers_read on public.league_writers;
create policy league_writers_read on public.league_writers for select to authenticated
  using (user_id = auth.uid() or public.is_league_admin(league_id));

create or replace function public.is_league_writer(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- an administrator can always write; appointing yourself to publish a
  -- fixture postponement should not be a second job
  select public.is_league_admin(p_league) or exists (
    select 1 from league_writers w
     where w.league_id = p_league and w.user_id = auth.uid());
$$;

create or replace function public.grant_league_writer(p_league uuid, p_email text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return 'no account for ' || p_email ||
           ' yet — ask them to sign in once at /epinoia/app/, then grant again';
  end if;

  insert into league_writers (league_id, user_id, created_by)
  values (p_league, uid, auth.uid()) on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_league_writer', 'league', p_league::text,
          jsonb_build_object('email', p_email));
  return 'granted writer to ' || p_email;
end; $$;

create or replace function public.revoke_league_writer(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_league uuid;
begin
  select league_id into v_league from league_writers where id = p_id;
  if v_league is null then return 'already revoked'; end if;
  if not public.is_league_admin(v_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  delete from league_writers where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'revoke_league_writer', 'league', v_league::text, '{}'::jsonb);
  return 'revoked';
end; $$;

create or replace function public.league_writers_list(p_league uuid)
returns table (id uuid, email text, since timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
  select w.id, u.email::text, w.created_at
    from league_writers w join auth.users u on u.id = w.user_id
   where w.league_id = p_league order by u.email;
end; $$;

-- ---------------------------------------------------------------------------
-- 2. ARTICLES
-- ---------------------------------------------------------------------------
create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references public.leagues on delete cascade,
  slug         text not null,
  title        text not null,
  standfirst   text not null default '',       -- the line on the card
  body         jsonb not null default '[]'::jsonb,
  cover_path   text,                           -- media path, or an https URL
  status       text not null default 'draft',
  pinned       boolean not null default false, -- forced to the front of the cards
  published_at timestamptz,
  author_id    uuid references auth.users on delete set null,
  author_name  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (league_id, slug),
  constraint news_status_ck check (status in ('draft','published')),
  constraint news_body_is_array check (jsonb_typeof(body) = 'array')
);
create index if not exists news_league_pub on public.news_articles
  (league_id, status, published_at desc);

alter table public.news_articles enable row level security;

-- Published articles are public. Drafts are for the people who write them.
drop policy if exists news_read on public.news_articles;
create policy news_read on public.news_articles for select
  using (status = 'published' or public.is_league_writer(league_id));

-- Writes go through upsert_article, which validates the blocks. There is
-- deliberately no write policy: a table policy can say who, and only a
-- function can say that this jsonb is a body rather than anything at all.

/* THE ALLOW-LIST, applied on the way in.

   An unknown block type is DROPPED rather than rejected, because a future
   editor sending something this version does not know about should degrade to
   a shorter article rather than an error a writer cannot act on. An unknown
   KEY inside a known block is dropped the same way, which is what stops
   somebody posting {"type":"p","onclick":…} and hoping a renderer one day
   reads it. */
create or replace function public.clean_news_body(p_body jsonb)
returns jsonb language plpgsql immutable as $$
declare
  b jsonb; out_blocks jsonb := '[]'::jsonb;
  t text; spans jsonb; items jsonb;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'array' then return '[]'::jsonb; end if;

  for b in select * from jsonb_array_elements(p_body) loop
    t := b->>'type';
    if t in ('p', 'h2', 'h3', 'quote') then
      spans := public.clean_news_spans(b->'spans');
      if jsonb_array_length(spans) > 0 then
        out_blocks := out_blocks || jsonb_build_array(
          jsonb_build_object('type', t, 'spans', spans));
      end if;

    elsif t in ('ul', 'ol') then
      select coalesce(jsonb_agg(s), '[]'::jsonb) into items
        from (select public.clean_news_spans(e) as s
                from jsonb_array_elements(coalesce(b->'items', '[]'::jsonb)) e) q
       where jsonb_array_length(s) > 0;
      if jsonb_array_length(items) > 0 then
        out_blocks := out_blocks || jsonb_build_array(
          jsonb_build_object('type', t, 'items', items));
      end if;

    elsif t = 'image' then
      if coalesce(b->>'path', '') <> '' then
        out_blocks := out_blocks || jsonb_build_array(jsonb_build_object(
          'type', 'image', 'path', left(b->>'path', 400),
          'caption', left(coalesce(b->>'caption', ''), 200)));
      end if;

    elsif t = 'rule' then
      out_blocks := out_blocks || jsonb_build_array(jsonb_build_object('type', 'rule'));
    end if;
  end loop;

  return out_blocks;
end; $$;

create or replace function public.clean_news_spans(p_spans jsonb)
returns jsonb language plpgsql immutable as $$
declare s jsonb; out_spans jsonb := '[]'::jsonb; txt text; href text; one jsonb;
begin
  if p_spans is null or jsonb_typeof(p_spans) <> 'array' then return '[]'::jsonb; end if;
  for s in select * from jsonb_array_elements(p_spans) loop
    txt := coalesce(s->>'t', '');
    continue when txt = '';
    one := jsonb_build_object('t', left(txt, 4000));
    if (s->>'b')::boolean is true then one := one || jsonb_build_object('b', true); end if;
    if (s->>'i')::boolean is true then one := one || jsonb_build_object('i', true); end if;
    href := coalesce(s->>'href', '');
    /* http(s) and mailto only. A javascript: or data: href in a link is the
       one thing the block format cannot make harmless on its own, because the
       renderer does have to put this string in an attribute. */
    if href <> '' and (href ~* '^https?://' or href ~* '^mailto:') then
      one := one || jsonb_build_object('href', left(href, 500));
    end if;
    out_spans := out_spans || jsonb_build_array(one);
  end loop;
  return out_spans;
end; $$;

create or replace function public.upsert_article(
  p_id uuid, p_league uuid, p_title text, p_standfirst text,
  p_body jsonb, p_cover text default null, p_status text default 'draft',
  p_pinned boolean default false, p_slug text default null
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_id uuid; v_slug text; v_name text; v_body jsonb; n int := 1;
begin
  if not public.is_league_writer(p_league) then
    raise exception 'you are not a writer for that league' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'an article needs a headline' using errcode = '22023';
  end if;
  if p_status not in ('draft', 'published') then
    raise exception 'an article is a draft or published' using errcode = '22023';
  end if;

  v_body := public.clean_news_body(p_body);

  -- the slug comes from the title unless one was supplied, and is made unique
  v_slug := lower(regexp_replace(coalesce(nullif(trim(coalesce(p_slug, '')), ''), p_title),
                                 '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from left(v_slug, 60));
  if v_slug = '' then v_slug := 'article'; end if;
  while exists (select 1 from news_articles a
                 where a.league_id = p_league and a.slug = v_slug
                   and (p_id is null or a.id <> p_id)) loop
    n := n + 1;
    v_slug := trim(both '-' from left(v_slug, 55)) || '-' || n;
  end loop;

  select coalesce(nullif(p.display_name, ''), split_part(u.email::text, '@', 1))
    into v_name
    from auth.users u left join profiles p on p.id = u.id
   where u.id = auth.uid();

  if p_id is null then
    insert into news_articles (league_id, slug, title, standfirst, body, cover_path,
                               status, pinned, published_at, author_id, author_name)
    values (p_league, v_slug, left(trim(p_title), 200),
            left(coalesce(p_standfirst, ''), 400), v_body, nullif(p_cover, ''),
            p_status, coalesce(p_pinned, false),
            case when p_status = 'published' then now() end,
            auth.uid(), coalesce(v_name, ''))
    returning id into v_id;
  else
    update news_articles set
      slug = v_slug,
      title = left(trim(p_title), 200),
      standfirst = left(coalesce(p_standfirst, ''), 400),
      body = v_body,
      cover_path = case when p_cover is null then cover_path
                        when p_cover = ''    then null else p_cover end,
      status = p_status,
      pinned = coalesce(p_pinned, pinned),
      /* PUBLISHED_AT IS SET ONCE. A correction three weeks later must not
         shove the article back to the top of the news page as though it were
         new — that is how a news list stops being a record of what happened
         when. */
      published_at = case when p_status = 'published'
                          then coalesce(published_at, now()) end,
      updated_at = now()
     where id = p_id and league_id = p_league
    returning id into v_id;
    if v_id is null then raise exception 'no such article' using errcode = '22023'; end if;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), case when p_id is null then 'create_article' else 'edit_article' end,
          'article', v_id::text, jsonb_build_object('status', p_status, 'slug', v_slug));
  return v_id;
end; $$;

create or replace function public.delete_article(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_league uuid; v_title text;
begin
  select league_id, title into v_league, v_title from news_articles where id = p_id;
  if v_league is null then return 'already gone'; end if;
  if not public.is_league_writer(v_league) then
    raise exception 'you are not a writer for that league' using errcode = '42501';
  end if;
  delete from news_articles where id = p_id;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'delete_article', 'article', p_id::text,
          jsonb_build_object('title', v_title));
  return 'deleted';
end; $$;

-- What the league page and the news page read. Published only, newest first,
-- with anything pinned in front of it.
create or replace function public.news_public(
  p_league uuid, p_limit int default 20, p_offset int default 0
) returns table (
  id uuid, slug text, title text, standfirst text, cover_path text,
  pinned boolean, published_at timestamptz, author_name text, total bigint
) language sql stable security definer set search_path = public as $$
  select a.id, a.slug, a.title, a.standfirst, a.cover_path,
         a.pinned, a.published_at, a.author_name, count(*) over ()
    from news_articles a
   where a.league_id = p_league and a.status = 'published'
   order by a.pinned desc, a.published_at desc nulls last
   limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.news_article(p_league uuid, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select a.id, a.slug, a.title, a.standfirst, a.body, a.cover_path,
           a.published_at, a.updated_at, a.author_name
      from news_articles a
     where a.league_id = p_league and a.slug = p_slug and a.status = 'published'
     limit 1) x;
$$;

-- The writer's own list, drafts included.
create or replace function public.news_admin(p_league uuid)
returns table (
  id uuid, slug text, title text, standfirst text, body jsonb, cover_path text,
  status text, pinned boolean, published_at timestamptz, author_name text,
  updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_league_writer(p_league) then
    raise exception 'you are not a writer for that league' using errcode = '42501';
  end if;
  return query
  select a.id, a.slug, a.title, a.standfirst, a.body, a.cover_path,
         a.status, a.pinned, a.published_at, a.author_name, a.updated_at
    from news_articles a
   where a.league_id = p_league
   order by a.status, coalesce(a.published_at, a.updated_at) desc;
end; $$;

-- ---------------------------------------------------------------------------
-- 3. A LEAGUE ADMIN MAY APPOINT A CLUB'S MANAGER.
--
-- grant_role required is_team_manager() for a team-scoped grant, which is true
-- for a platform admin and for an existing manager of that club — and NOT for
-- the league administrator, who is the person actually running the
-- competition and the only one with a list of who runs each club. So the role
-- that unlocks the club portal could be granted by everybody except the one
-- person who needed to.
--
-- The rest of the function is 0007's, unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.grant_role(
  p_email      text,
  p_role       text,
  p_scope_type text,
  p_scope_id   uuid default null
) returns text language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
  r public.role_kind := p_role::public.role_kind;
  st public.scope_kind := p_scope_type::public.scope_kind;
  v_league uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  if r = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'only a platform admin may grant platform admin'
        using errcode = '42501';
    end if;
  elsif st = 'league' then
    if p_scope_id is null or not public.is_league_admin(p_scope_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  elsif st = 'team' then
    select league_id into v_league from teams where id = p_scope_id;
    if p_scope_id is null
       or not (public.is_team_manager(p_scope_id)
               or (v_league is not null and public.is_league_admin(v_league))) then
      raise exception 'you neither manage that club nor administer its league'
        using errcode = '42501';
    end if;
  else
    raise exception 'platform scope is reserved for platform_admin'
      using errcode = '42501';
  end if;

  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return 'no account for ' || p_email || ' yet — ask them to sign in once at /epinoia/app/, then grant again';
  end if;

  insert into memberships (user_id, role, scope_type, scope_id)
  values (uid, r, st, p_scope_id)
  on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'grant_role', 'membership', uid::text,
          jsonb_build_object('email', p_email, 'role', p_role,
                             'scope_type', p_scope_type, 'scope_id', p_scope_id));

  return 'granted ' || p_role || ' to ' || p_email;
end; $$;

-- revoke_role has the mirror of the same gap.
create or replace function public.revoke_role(p_membership uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m record; v_league uuid;
begin
  select * into m from memberships where id = p_membership;
  if not found then return 'already revoked'; end if;

  if m.role = 'platform_admin' then
    if not public.is_platform_admin() then
      raise exception 'only a platform admin may revoke platform admin' using errcode = '42501';
    end if;
    if (select count(*) from memberships where role = 'platform_admin') <= 1 then
      raise exception 'this is the only platform admin — grant another one first'
        using errcode = '23514';
    end if;
  elsif m.scope_type = 'league' then
    if not public.is_league_admin(m.scope_id) then
      raise exception 'you do not administer that league' using errcode = '42501';
    end if;
  elsif m.scope_type = 'team' then
    select league_id into v_league from teams where id = m.scope_id;
    if not (public.is_team_manager(m.scope_id)
            or (v_league is not null and public.is_league_admin(v_league))) then
      raise exception 'you neither manage that club nor administer its league'
        using errcode = '42501';
    end if;
  end if;

  delete from memberships where id = p_membership;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'revoke_role', 'membership', m.user_id::text,
          jsonb_build_object('role', m.role::text, 'scope_id', m.scope_id));

  return 'revoked';
end; $$;

-- ---------------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'grant_league_writer(uuid,text)',
    'revoke_league_writer(uuid)', 'league_writers_list(uuid)',
    'upsert_article(uuid,uuid,text,text,jsonb,text,text,boolean,text)',
    'delete_article(uuid)', 'news_admin(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
/* is_league_writer IS NOT REVOKED FROM anon, and must not be: the news_read
   policy calls it, and a policy is evaluated as the querying role. Revoking it
   does not hide anything — the function only ever reports on auth.uid(), which
   is null for anon — it just makes every anonymous read of the table fail with
   "permission denied for function", which is what happened the first time. The
   same is true of is_league_admin and is_team_manager, which 0001 left alone
   for exactly this reason. */
grant execute on function public.is_league_writer(uuid) to anon, authenticated;

grant execute on function public.news_public(uuid,int,int) to anon, authenticated;
grant execute on function public.news_article(uuid,text)   to anon, authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  adm uuid := gen_random_uuid();
  wri uuid := gen_random_uuid();
  out_ uuid := gen_random_uuid();
  lg uuid; tm uuid; a1 uuid; a2 uuid; wid uuid;
  orig text; failed text[] := '{}';
  n int; t text; j jsonb; b jsonb;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (adm,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'news-adm@example.invalid', '', now(), now(), now()),
         (wri,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'news-wri@example.invalid', '', now(), now(), now()),
         (out_, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'news-out@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('news-test', 'News Test') returning id into lg;
  insert into teams (league_id, slug, name) values (lg, 'news-club', 'News Club')
    returning id into tm;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  -- ---- a league admin can now appoint a club manager -----------------------
  t := public.grant_role('news-wri@example.invalid', 'team_manager', 'team', tm);
  if t not like 'granted%' then
    failed := array_append(failed, 'a league admin could not appoint a club manager: ' || t);
  end if;
  if not exists (select 1 from memberships
                  where user_id = wri and role = 'team_manager' and scope_id = tm) then
    failed := array_append(failed, 'the club manager membership was not created');
  end if;

  -- ---- writers -------------------------------------------------------------
  t := public.grant_league_writer(lg, 'news-wri@example.invalid');
  select count(*) into n from public.league_writers_list(lg);
  if n <> 1 then failed := array_append(failed, 'the writer list is empty'); end if;

  -- ---- the block cleaner ---------------------------------------------------
  b := public.clean_news_body(jsonb_build_array(
    jsonb_build_object('type', 'p', 'spans', jsonb_build_array(
      jsonb_build_object('t', 'plain '),
      jsonb_build_object('t', 'bold', 'b', true),
      jsonb_build_object('t', 'link', 'href', 'https://example.org'),
      jsonb_build_object('t', 'evil', 'href', 'javascript:alert(1)'),
      jsonb_build_object('t', ''))),
    jsonb_build_object('type', 'script', 'spans',
      jsonb_build_array(jsonb_build_object('t', 'nope'))),
    jsonb_build_object('type', 'p', 'spans', '[]'::jsonb),
    jsonb_build_object('type', 'ul', 'items', jsonb_build_array(
      jsonb_build_array(jsonb_build_object('t', 'one')),
      jsonb_build_array(jsonb_build_object('t', 'two')))),
    jsonb_build_object('type', 'image', 'path', 'team/x/news-1.jpg', 'caption', 'A caption'),
    jsonb_build_object('type', 'image', 'caption', 'no path so no block')));

  if jsonb_array_length(b) <> 3 then
    failed := array_append(failed,
      'the cleaner kept ' || jsonb_array_length(b) || ' blocks, expected 3');
  end if;
  /* FOUR spans, not three. The javascript: span loses its HREF and keeps its
     WORDS — dropping the attribute is the safety measure, and deleting the
     text with it would silently eat a sentence a writer wrote. Only the empty
     span goes. */
  if jsonb_array_length(b->0->'spans') <> 4 then
    failed := array_append(failed,
      'the cleaner kept ' || jsonb_array_length(b->0->'spans') || ' spans, expected 4');
  end if;
  if (b->0->'spans'->3->>'href') is not null then
    failed := array_append(failed, 'the unsafe href was kept on its span');
  end if;
  if (b->0->'spans'->3->>'t') <> 'evil' then
    failed := array_append(failed, 'the words of an unsafe link were thrown away with it');
  end if;
  if (b->0->'spans'->2->>'href') <> 'https://example.org' then
    failed := array_append(failed, 'a legitimate link lost its href');
  end if;
  if b::text like '%javascript:%' then
    failed := array_append(failed, 'A JAVASCRIPT: HREF SURVIVED THE CLEANER');
  end if;
  if b::text like '%script%' then
    failed := array_append(failed, 'an unknown block type survived the cleaner');
  end if;
  if (b->1->>'type') <> 'ul' or jsonb_array_length(b->1->'items') <> 2 then
    failed := array_append(failed, 'the list block did not survive');
  end if;

  -- ---- writing -------------------------------------------------------------
  a1 := public.upsert_article(null, lg, 'Cup final moved to Sunday',
        'The tie switches to the Lantern Centre.',
        jsonb_build_array(jsonb_build_object('type', 'p', 'spans',
          jsonb_build_array(jsonb_build_object('t', 'The full story.')))),
        null, 'published', false, null);
  if (select slug from news_articles where id = a1) <> 'cup-final-moved-to-sunday' then
    failed := array_append(failed, 'the slug was not derived from the headline');
  end if;
  if (select published_at from news_articles where id = a1) is null then
    failed := array_append(failed, 'a published article has no publication time');
  end if;

  -- a second article with the SAME headline must not collide
  a2 := public.upsert_article(null, lg, 'Cup final moved to Sunday', '', '[]'::jsonb,
        null, 'draft', false, null);
  if (select slug from news_articles where id = a2) = 'cup-final-moved-to-sunday' then
    failed := array_append(failed, 'two articles were given the same slug');
  end if;

  /* Editing must NOT re-date a published article: a correction three weeks
     later cannot shove it back to the top of the news page. Compared by
     equality against the value read before the edit, which is the claim —
     the earlier version compared published_at against updated_at, and both
     are now() inside a single transaction, so it failed on a true case. */
  declare v_before timestamptz; begin
    select published_at into v_before from news_articles where id = a1;
    perform public.upsert_article(a1, lg, 'Cup final moved to Sunday',
            'Corrected.', '[]'::jsonb, null, 'published', false, null);
    if (select published_at from news_articles where id = a1) is distinct from v_before then
      failed := array_append(failed, 'editing re-dated the article');
    end if;
    if (select standfirst from news_articles where id = a1) <> 'Corrected.' then
      failed := array_append(failed, 'the edit did not save');
    end if;
  end;

  -- ---- what the public sees ------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  reset role; set local role anon;

  select count(*) into n from public.news_public(lg, 20, 0);
  if n <> 1 then
    failed := array_append(failed, ('the public should see 1 article, saw ' || n));
  end if;
  j := public.news_article(lg, 'cup-final-moved-to-sunday');
  if j is null then failed := array_append(failed, 'the published article is not readable'); end if;
  if public.news_article(lg, (select slug from news_articles where id = a2)) is not null then
    failed := array_append(failed, 'A DRAFT WAS READABLE BY THE PUBLIC');
  end if;
  begin perform public.upsert_article(null, lg, 'Hijack', '', '[]'::jsonb);
    failed := array_append(failed, 'anon published an article');
  exception when others then null; end;

  -- ---- an outsider ---------------------------------------------------------
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  begin perform public.upsert_article(null, lg, 'Hijack', '', '[]'::jsonb);
    failed := array_append(failed, 'a stranger published an article');
  exception when insufficient_privilege then null; end;
  begin perform public.grant_league_writer(lg, 'news-out@example.invalid');
    failed := array_append(failed, 'a stranger appointed themselves a writer');
  exception when insufficient_privilege then null; end;
  begin perform public.grant_role('news-out@example.invalid', 'team_manager', 'team', tm);
    failed := array_append(failed, 'a stranger appointed a club manager');
  exception when insufficient_privilege then null; end;
  begin perform * from public.news_admin(lg);
    failed := array_append(failed, 'a stranger read the drafts');
  exception when insufficient_privilege then null; end;

  -- ---- the writer can write, and cannot appoint ---------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', wri, 'role', 'authenticated')::text, true);
  t := public.upsert_article(null, lg, 'From the writer', 'Yes.', '[]'::jsonb,
                             null, 'published', false, null)::text;
  select count(*) into n from public.news_admin(lg);
  if n < 3 then failed := array_append(failed, 'the writer cannot see the article list'); end if;
  begin perform public.grant_league_writer(lg, 'news-out@example.invalid');
    failed := array_append(failed, 'a writer appointed another writer');
  exception when insufficient_privilege then null; end;

  -- --------------------------------------------------------------- tidy up ---
  reset role;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from news_articles where league_id = lg;
  delete from league_writers where league_id = lg;
  delete from memberships where user_id in (adm, wri);
  delete from teams where id = tm;
  delete from leagues where id = lg;
  delete from audit_log where actor in (adm, wri, out_);
  delete from auth.users where id in (adm, wri, out_);

  if array_length(failed, 1) > 0 then
    raise exception E'NEWS SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
