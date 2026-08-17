-- ============================================================================
-- 0048 — THE SOCIALS SPOTLIGHT.
--
-- A section under Merchandise carrying a league's Instagram: a link to the
-- page, and up to four posts spotlit on the league's own front page.
--
-- TWO WAYS TO FILL THE FOUR SLOTS, because only one of them can be built
-- without asking the league for something:
--
--   PINNED. Somebody pastes four post links. Works today, works for a
--   personal account, works for a page that has not been converted to a
--   business profile, and needs nothing from Meta.
--
--   AUTOMATIC. The four newest, which requires Instagram's Graph API and
--   therefore a business or creator account, a linked Facebook page, and a
--   long-lived access token. When a league has provided one, an Edge Function
--   refreshes the cache and the page draws that instead.
--
-- The automatic path is the one the brief asked for and the pinned path is
-- the one that always works, so both are here and the pinned four are the
-- fallback whenever the cache is empty or stale — a section that goes blank
-- because a token expired is worse than one showing last month's four.
--
-- THE TOKEN IS A SECRET AND IS NOT PUBLIC. It is on the same row as the
-- handle, which is public, so the row cannot simply be readable: the public
-- read goes through a function that returns everything except the token.
-- ============================================================================

create table if not exists public.league_socials (
  league_id     uuid primary key references public.leagues on delete cascade,
  instagram     text,                       -- handle, no @
  show_profile  boolean not null default true,
  -- up to four, pinned by hand. Stored as the post SHORTCODE, not the URL:
  -- the embed address is built from it, so a link pasted with tracking
  -- parameters cannot end up inside an iframe src.
  pinned        text[] not null default '{}',
  auto          boolean not null default false,
  cached        jsonb  not null default '[]'::jsonb,
  refreshed_at  timestamptz,
  refresh_error text,
  access_token  text,                       -- SECRET
  ig_user_id    text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users on delete set null,
  constraint socials_pinned_ck check (array_length(pinned, 1) is null
                                      or array_length(pinned, 1) <= 4)
);

alter table public.league_socials enable row level security;
-- No public select policy at all: the token lives on this row. Everything the
-- page needs comes out of league_socials_public() below.
drop policy if exists socials_admin_read on public.league_socials;
create policy socials_admin_read on public.league_socials for select
  to authenticated using (public.is_league_admin(league_id));

-- What the front page draws. The automatic four when there are any, the
-- pinned four otherwise — never nothing because a token went stale.
create or replace function public.league_socials_public(p_league uuid)
returns table (
  instagram text, show_profile boolean, source text,
  posts jsonb, refreshed_at timestamptz
) language sql stable security definer set search_path = public as $$
  select s.instagram, s.show_profile,
         case when s.auto and jsonb_array_length(s.cached) > 0 then 'auto'
              else 'pinned' end,
         case when s.auto and jsonb_array_length(s.cached) > 0
              then (select jsonb_agg(e order by ord)
                      from (select e, ord from jsonb_array_elements(s.cached)
                            with ordinality as x(e, ord) limit 4) q)
              else (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb)
                      from unnest(s.pinned[1:4]) c)
         end,
         s.refreshed_at
    from league_socials s
   where s.league_id = p_league
     and coalesce(nullif(trim(s.instagram), ''), '') <> '';
$$;

-- The admin's view, which says whether a token is present without ever
-- returning it. "Is one set" is the only thing the console needs to know.
create or replace function public.league_socials_admin(p_league uuid)
returns table (
  instagram text, show_profile boolean, pinned text[], auto boolean,
  has_token boolean, ig_user_id text, cached jsonb,
  refreshed_at timestamptz, refresh_error text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
  select s.instagram, s.show_profile, s.pinned, s.auto,
         coalesce(nullif(trim(coalesce(s.access_token, '')), ''), '') <> '',
         s.ig_user_id, s.cached, s.refreshed_at, s.refresh_error
    from league_socials s where s.league_id = p_league;
end; $$;

-- p_token: null leaves whatever is stored alone, '' clears it. A console that
-- could only set a token, never remove one, would be a console you have to
-- open psql to undo.
create or replace function public.set_league_socials(
  p_league uuid, p_instagram text default null, p_show_profile boolean default null,
  p_pinned text[] default null, p_auto boolean default null,
  p_token text default null, p_ig_user_id text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_clean text[];
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  /* A shortcode, whatever was pasted. instagram.com/p/CODE/, with or without
     a query string, a trailing slash, a reel path or the bare code itself —
     all of them reduce to the code, and anything that does not is dropped
     rather than being put in an iframe src. */
  if p_pinned is not null then
    /* Three shapes, tried in order, because an OPTIONAL prefix in one pattern
       matches too early: substring() takes the leftmost match, so
       `(?:instagram\.com/p/)?([A-Za-z0-9_-]{5,})` against a full URL happily
       returns "https". And the nulls are dropped BEFORE the limit, or a line
       of junk in the middle costs a real pin its place. */
    select array_agg(c) into v_clean from (
      select c from (
        select coalesce(
                 substring(x from 'instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)'),
                 substring(x from '^\s*(?:p|reel|tv)/([A-Za-z0-9_-]+)'),
                 substring(x from '^\s*([A-Za-z0-9_-]{5,})\s*$')) as c
          from unnest(p_pinned) x
         where coalesce(trim(x), '') <> '') a
       where c is not null
       limit 4) q;
    v_clean := coalesce(v_clean, '{}'::text[]);
  end if;

  insert into league_socials (league_id, instagram, show_profile, pinned, auto,
                              access_token, ig_user_id, updated_at, updated_by)
  values (p_league,
          nullif(regexp_replace(coalesce(p_instagram, ''), '^@|^.*instagram\.com/', ''), ''),
          coalesce(p_show_profile, true), coalesce(v_clean, '{}'::text[]),
          coalesce(p_auto, false), nullif(p_token, ''), nullif(p_ig_user_id, ''),
          now(), auth.uid())
  on conflict (league_id) do update set
    instagram    = coalesce(nullif(regexp_replace(coalesce(p_instagram, ''),
                     '^@|^.*instagram\.com/', ''), ''), league_socials.instagram),
    show_profile = coalesce(p_show_profile, league_socials.show_profile),
    pinned       = coalesce(v_clean, league_socials.pinned),
    auto         = coalesce(p_auto, league_socials.auto),
    access_token = case when p_token is null then league_socials.access_token
                        when p_token = ''    then null
                        else p_token end,
    ig_user_id   = coalesce(nullif(p_ig_user_id, ''), league_socials.ig_user_id),
    updated_at   = now(), updated_by = auth.uid();

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_socials', 'league', p_league::text,
          jsonb_build_object('instagram', p_instagram, 'auto', p_auto,
                             'pinned', coalesce(array_length(v_clean, 1), 0),
                             'token_changed', p_token is not null));
  return 'saved';
end; $$;

-- Written by the Edge Function under the service role, which is why it is not
-- granted to anybody else: the cache is data the platform fetched, not data a
-- browser may assert.
create or replace function public.store_socials_cache(
  p_league uuid, p_posts jsonb, p_error text default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  update league_socials
     set cached = coalesce(p_posts, '[]'::jsonb),
         refreshed_at = now(),
         refresh_error = nullif(p_error, '')
   where league_id = p_league;
  return 'cached';
end; $$;
revoke all on function public.store_socials_cache(uuid,jsonb,text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'league_socials_admin(uuid)',
    'set_league_socials(uuid,text,boolean,text[],boolean,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.league_socials_public(uuid) to anon, authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  adm uuid := gen_random_uuid();
  lg uuid; orig text; failed text[] := '{}';
  n int; t text; v_posts jsonb; v_src text; v_tok boolean; v_ig text;
begin
  select current_user into orig;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'soc-admin@example.invalid', '', now(), now(), now());
  insert into leagues (slug, name) values ('soc-test', 'Socials Test') returning id into lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  -- a handle survives being pasted as a URL or with an @
  t := public.set_league_socials(lg, 'https://instagram.com/testleague', true,
        array['https://www.instagram.com/p/ABC123xyz/?utm_source=ig_web',
              'reel/DEF456uvw',
              'GHI789rst',
              'not a link',
              'JKL012mno'],
        false, null, null);
  select instagram into v_ig from public.league_socials_admin(lg);
  if v_ig <> 'testleague' then
    failed := array_append(failed, 'the handle was not reduced to a handle, got ' || coalesce(v_ig,'null'));
  end if;

  select array_length(pinned, 1) into n from public.league_socials_admin(lg);
  if n <> 4 then
    failed := array_append(failed, ('four pins expected after the limit, got ' || coalesce(n, 0)));
  end if;

  select posts, source into v_posts, v_src from public.league_socials_public(lg);
  if v_src <> 'pinned' then failed := array_append(failed, 'the source should be pinned'); end if;
  if v_posts->0->>'code' <> 'ABC123xyz' then
    failed := array_append(failed, 'a pasted post URL was not reduced to its code, got ' ||
      coalesce(v_posts->0->>'code', 'null'));
  end if;

  -- a token is stored but never returned
  t := public.set_league_socials(lg, null, null, null, true, 'SECRET-TOKEN-VALUE', '17841400000');
  select has_token into v_tok from public.league_socials_admin(lg);
  if not v_tok then failed := array_append(failed, 'the token was not stored'); end if;
  if exists (select 1 from public.league_socials_admin(lg) x
              where x::text like '%SECRET-TOKEN-VALUE%') then
    failed := array_append(failed, 'the admin view leaked the access token');
  end if;
  if exists (select 1 from public.league_socials_public(lg) x
              where x::text like '%SECRET-TOKEN-VALUE%') then
    failed := array_append(failed, 'the public view leaked the access token');
  end if;

  -- auto with an empty cache still shows the pins rather than nothing
  select source into v_src from public.league_socials_public(lg);
  if v_src <> 'pinned' then
    failed := array_append(failed, 'an empty cache did not fall back to the pins');
  end if;

  -- clearing the token
  t := public.set_league_socials(lg, null, null, null, null, '', null);
  select has_token into v_tok from public.league_socials_admin(lg);
  if v_tok then failed := array_append(failed, 'the token could not be cleared'); end if;

  -- the table itself is not readable by anybody without the role
  reset role; set local role anon;
  begin
    select count(*) into n from league_socials;
    if n > 0 then failed := array_append(failed, 'anon read the socials row directly'); end if;
  exception when insufficient_privilege then null; end;
  begin perform public.set_league_socials(lg, 'hijack');
    failed := array_append(failed, 'anon changed the socials');
  exception when others then null; end;

  reset role;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  -- and the cache write, which only the service role ever calls
  t := public.store_socials_cache(lg,
    jsonb_build_array(jsonb_build_object('code', 'AAA111bbb', 'permalink', 'x'),
                      jsonb_build_object('code', 'CCC222ddd', 'permalink', 'y')), null);
  select source into v_src from public.league_socials_public(lg);
  if v_src <> 'auto' then
    failed := array_append(failed, 'a filled cache did not become the source');
  end if;

  delete from league_socials where league_id = lg;
  delete from memberships where user_id = adm;
  delete from leagues where id = lg;
  delete from audit_log where actor = adm;
  delete from auth.users where id = adm;

  if array_length(failed, 1) > 0 then
    raise exception E'SOCIALS SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
