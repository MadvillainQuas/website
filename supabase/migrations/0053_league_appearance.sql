-- ============================================================================
-- 0053 — A LEAGUE DECIDES HOW ITS OWN PAGE LOOKS.
--
-- Three settings, one table, all of them read by pages that are already
-- reading `leagues` — so none of this costs a request that was not being made.
--
--   SECTIONS   which blocks appear on the league's front page, and which tabs
--              appear in the sidebar. A league with no merchandise and no
--              news should not have two headings explaining that it has
--              neither.
--
--   THEME      the page background, the rail, and the ink. Not a free-for-all:
--              six named slots, hex only, so a league can look like itself
--              without being able to produce something illegible.
--
--   COUNTRY    which is not decoration — it is the level above the league in
--              the sidebar. ISO 3166-1 alpha-2, because the flag is derived
--              from the two letters rather than stored, and a stored emoji is
--              a thing that goes out of date and cannot be matched on.
--
-- WHY VALIDATE COLOURS IN THE DATABASE when the page sets them through
-- element.style.setProperty, which cannot break out of a declaration? Because
-- "cannot break out today, through this code path" is not a property worth
-- relying on for a value a league administrator types and every visitor
-- renders. A six-digit hex is trivially checkable and there is no legitimate
-- reason for anything else to be in there.
-- ============================================================================

alter table public.leagues
  add column if not exists country  text,
  add column if not exists sections jsonb not null default '{}'::jsonb,
  add column if not exists nav      jsonb not null default '{}'::jsonb,
  add column if not exists theme    jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.leagues add constraint leagues_country_ck
    check (country is null or country ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

comment on column public.leagues.country is
  'ISO 3166-1 alpha-2; the flag is derived from the letters, never stored';
comment on column public.leagues.sections is
  'which front-page blocks are shown — absent key means shown';
comment on column public.leagues.nav is
  'which sidebar tabs are shown — absent key means shown';

/* ABSENT MEANS SHOWN, everywhere. The alternative — an explicit list of what
   to display — means every league created before a new section exists gets
   that section hidden, and nobody finds out until somebody asks where the news
   went. Defaulting to visible makes a new feature appear for everybody and
   makes hiding it the deliberate act. */

create or replace function public.set_league_appearance(
  p_league uuid,
  p_country text default null,
  p_sections jsonb default null,
  p_nav jsonb default null,
  p_theme jsonb default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  k text; v text;
  ok_sections text[] := array['news','clubs','toty','stars','games','season',
                              'merch','socials','takepart'];
  ok_nav text[] := array['fixtures','statistics','wowy','table','news',
                         'score','portal','admin'];
  ok_theme text[] := array['bg','panel','ink','rail','rail_ink','accent'];
  clean_sections jsonb := '{}'::jsonb;
  clean_nav jsonb := '{}'::jsonb;
  clean_theme jsonb := '{}'::jsonb;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;

  if p_sections is not null then
    for k in select jsonb_object_keys(p_sections) loop
      if k = any(ok_sections) then
        clean_sections := clean_sections ||
          jsonb_build_object(k, coalesce((p_sections->>k)::boolean, true));
      end if;
    end loop;
  end if;

  if p_nav is not null then
    for k in select jsonb_object_keys(p_nav) loop
      if k = any(ok_nav) then
        clean_nav := clean_nav || jsonb_build_object(k, coalesce((p_nav->>k)::boolean, true));
      end if;
    end loop;
  end if;

  if p_theme is not null then
    for k in select jsonb_object_keys(p_theme) loop
      v := trim(coalesce(p_theme->>k, ''));
      if k = any(ok_theme) and v <> '' then
        if v !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'colours are six-digit hex, like #0a1a13 — got "%"', v
            using errcode = '22023';
        end if;
        clean_theme := clean_theme || jsonb_build_object(k, lower(v));
      end if;
    end loop;
  end if;

  update leagues set
    country  = case when p_country is null then country
                    when p_country = ''    then null
                    else upper(trim(p_country)) end,
    sections = case when p_sections is null then sections else clean_sections end,
    nav      = case when p_nav      is null then nav      else clean_nav end,
    theme    = case when p_theme    is null then theme    else clean_theme end
  where id = p_league;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_appearance', 'league', p_league::text,
          jsonb_build_object('country', p_country, 'sections', clean_sections,
                             'nav', clean_nav, 'theme', clean_theme));
  return 'saved';
end; $$;

-- The level above the leagues in the sidebar. Leagues with no country are
-- gathered under a null code rather than dropped — a league that has not said
-- where it is must still be reachable, and the rail labels the group.
create or replace function public.league_countries()
returns table (country text, leagues bigint)
language sql stable security definer set search_path = public as $$
  select l.country, count(*)
    from leagues l
   group by l.country
   order by (l.country is null), l.country;
$$;

grant execute on function public.league_countries() to anon, authenticated;
revoke all on function public.set_league_appearance(uuid,text,jsonb,jsonb,jsonb)
  from public, anon;
grant execute on function public.set_league_appearance(uuid,text,jsonb,jsonb,jsonb)
  to authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  adm uuid := gen_random_uuid();
  out_ uuid := gen_random_uuid();
  lg uuid; orig text; failed text[] := '{}';
  n int; t text; j jsonb;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (adm,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'app-adm@example.invalid', '', now(), now(), now()),
         (out_, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'app-out@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('app-test', 'Appearance Test') returning id into lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  -- a country, some hidden sections, a theme
  t := public.set_league_appearance(lg, 'gb',
        jsonb_build_object('merch', false, 'socials', false, 'nonsense', true),
        jsonb_build_object('wowy', false, 'made_up', false),
        jsonb_build_object('bg', '#0A1A13', 'ink', '#E6FFF1', 'rubbish', '#000000'));

  select country, sections, nav, theme into t, j, j, j from leagues where id = lg;
  if (select country from leagues where id = lg) <> 'GB' then
    failed := array_append(failed, 'the country was not upper-cased');
  end if;
  if (select sections->>'merch' from leagues where id = lg) <> 'false' then
    failed := array_append(failed, 'the section switch did not save');
  end if;
  if (select sections ? 'nonsense' from leagues where id = lg) then
    failed := array_append(failed, 'an unknown section key was kept');
  end if;
  if (select nav ? 'made_up' from leagues where id = lg) then
    failed := array_append(failed, 'an unknown nav key was kept');
  end if;
  if (select theme->>'bg' from leagues where id = lg) <> '#0a1a13' then
    failed := array_append(failed, 'the theme colour was not stored lower-cased');
  end if;
  if (select theme ? 'rubbish' from leagues where id = lg) then
    failed := array_append(failed, 'an unknown theme slot was kept');
  end if;

  -- anything that is not a hex colour is refused, with the value in the message
  begin perform public.set_league_appearance(lg, null, null, null,
          jsonb_build_object('bg', 'red; } body { display:none'));
    failed := array_append(failed, 'A NON-HEX COLOUR WAS ACCEPTED');
  exception when others then null; end;
  begin perform public.set_league_appearance(lg, null, null, null,
          jsonb_build_object('ink', '#fff'));
    failed := array_append(failed, 'a three-digit hex was accepted');
  exception when others then null; end;

  -- a bad country code is refused by the constraint
  begin perform public.set_league_appearance(lg, 'GBR');
    failed := array_append(failed, 'a three-letter country code was accepted');
  exception when others then null; end;

  -- null leaves a setting alone; '' clears the country
  perform public.set_league_appearance(lg, null, null, null, null);
  if (select country from leagues where id = lg) <> 'GB' then
    failed := array_append(failed, 'passing null cleared the country');
  end if;
  perform public.set_league_appearance(lg, '');
  if (select country from leagues where id = lg) is not null then
    failed := array_append(failed, 'an empty country did not clear it');
  end if;

  -- the countries list, which the sidebar reads
  perform public.set_league_appearance(lg, 'GB');
  select count(*) into n from public.league_countries() where country = 'GB';
  if n <> 1 then failed := array_append(failed, 'league_countries did not report GB'); end if;

  -- ---- an outsider ---------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  begin perform public.set_league_appearance(lg, 'FR');
    failed := array_append(failed, 'an outsider restyled a league');
  exception when insufficient_privilege then null; end;

  -- but anybody may READ the list of countries: it is the sidebar
  reset role; set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.league_countries();
  if n < 1 then failed := array_append(failed, 'anon cannot read the country list'); end if;
  select count(*) into n from leagues where id = lg and theme ? 'bg';
  if n <> 1 then failed := array_append(failed, 'anon cannot read a league theme'); end if;

  -- --------------------------------------------------------------- tidy up ---
  reset role;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from memberships where user_id = adm;
  delete from leagues where id = lg;
  delete from audit_log where actor in (adm, out_);
  delete from auth.users where id in (adm, out_);

  if array_length(failed, 1) > 0 then
    raise exception E'APPEARANCE SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
