-- ============================================================================
-- WHERE A LEAGUE'S MERCHANDISE IS ACTUALLY SOLD.
--
-- Courtside builds the pictures — a shirt, a hoodie, a scarf, a print, each
-- constructed from the club's own crest and colours, so a league gets a shop
-- window the day it uploads a logo and not the day somebody finds a designer.
-- It does not take money, hold stock or ship anything, and it should not
-- pretend to: the products link out to whatever print-on-demand storefront the
-- league has actually set up.
--
-- So this is a plain PUBLIC column, unlike the feed endpoints and the Discord
-- webhook next door. A shop URL is meant to be found; hiding it would be
-- security theatre with a cost. What it still needs is VALIDATION, because a
-- league administrator typing a URL into a box that every visitor's browser
-- then follows is a way to point our readers anywhere at all.
--
-- Without a URL the section says the shop is not open yet, rather than showing
-- buttons that go nowhere.
-- ============================================================================
alter table public.leagues
  add column if not exists store_url  text,
  add column if not exists store_name text;

do $$ begin
  alter table public.leagues add constraint leagues_store_url_ck
    check (
      store_url is null
      or (store_url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/|$|\?|#)'
          and store_url !~* '^https://(localhost|[0-9.]+)'
          and length(store_url) <= 300)
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Setting it. A function rather than a bare column write so the failure is a
-- sentence rather than a constraint name, and so "clear it" is expressible.
-- ---------------------------------------------------------------------------
create or replace function public.set_league_store(
  p_league uuid, p_url text, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url  text := nullif(btrim(coalesce(p_url, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not public.is_league_admin(p_league) then
    raise exception 'only an administrator of that league may set its shop'
      using errcode = '42501';
  end if;

  if v_url is not null then
    if v_url !~ '^https://' then
      raise exception 'the shop link must start https:// — readers follow this from every product';
    end if;
    if v_url ~* '^https://(localhost|[0-9.]+)' then
      raise exception 'give the shop''s hostname rather than an address';
    end if;
    if v_url !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/|$|\?|#)' then
      raise exception 'that does not look like a web address';
    end if;
    if length(v_url) > 300 then
      raise exception 'that link is too long';
    end if;
  end if;

  update leagues
     set store_url = v_url,
         store_name = case when v_url is null then null else left(v_name, 60) end
   where id = p_league;
end; $$;

revoke execute on function public.set_league_store(uuid, text, text) from anon, public;
grant  execute on function public.set_league_store(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it, and prove the guards refuse what they are there to refuse.
-- ---------------------------------------------------------------------------
do $$
declare
  orig   text;
  v_user uuid := gen_random_uuid();
  v_lg   uuid;
  bad    text;
  ok     boolean;
  failed text[] := '{}';
begin
  select current_user into orig;
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'shoptest@example.invalid', '', now(), now(), now());
  insert into leagues (slug, name) values ('shop-test-league', 'Shop Test')
    returning id into v_lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (v_user, 'league_admin', 'league', v_lg);

  set local role authenticated;

  -- a stranger may not
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  ok := true;
  begin perform public.set_league_store(v_lg, 'https://shop.example/', 'Shop');
  exception when others then ok := false; end;
  if ok then failed := failed || 'a stranger set the shop link'; end if;

  -- the administrator may
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  foreach bad in array array[
    'http://shop.example/',        -- not https
    'https://localhost/shop',      -- loopback
    'https://10.0.0.9/shop',       -- bare address
    'javascript:alert(1)',         -- not a URL at all
    'https://nodot/shop'           -- not a hostname
  ] loop
    ok := true;
    begin perform public.set_league_store(v_lg, bad, 'Shop');
    exception when others then ok := false; end;
    if ok then failed := failed || ('set_league_store accepted ' || bad); end if;
  end loop;

  perform public.set_league_store(v_lg, 'https://shop.example/courtside', 'The Club Shop');
  if not exists (select 1 from leagues
                  where id = v_lg and store_url = 'https://shop.example/courtside'
                    and store_name = 'The Club Shop') then
    failed := failed || 'a valid shop link was not stored';
  end if;

  perform public.set_league_store(v_lg, null, null);
  if exists (select 1 from leagues where id = v_lg and store_url is not null) then
    failed := failed || 'clearing the shop link did nothing';
  end if;

  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  delete from memberships where user_id = v_user;
  delete from leagues where id = v_lg;
  delete from auth.users where id = v_user;

  if array_length(failed, 1) is not null then
    raise exception 'LEAGUE SHOP FAILURES: %', array_to_string(failed, ' | ');
  end if;
  raise notice 'set_league_store stores, clears, and refuses every unsafe link';
end $$;
