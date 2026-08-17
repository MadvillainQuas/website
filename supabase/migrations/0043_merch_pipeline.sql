-- ============================================================================
-- MERCHANDISE, MADE AUTOMATICALLY FROM WHAT IS ALREADY ON FILE.
--
-- The league page already draws shirts and mugs from each club's crest and
-- colours. Those are PICTURES. This turns them into things that exist: a print
-- file at the right physical size, uploaded somewhere a factory can fetch it,
-- and a product created in whichever print-on-demand store the league uses.
--
-- THE SHAPE OF IT, because it is split across three places on purpose:
--
--   1. THE DESIGN ROW lives here. One per club per product, with a status that
--      says how far along it is: pending -> artwork -> published, or failed.
--      Nothing is a job queue in the abstract; a design IS its own queue entry,
--      so there is one thing to look at when a club asks why their shirt is
--      missing.
--
--   2. THE ARTWORK IS BUILT IN THE BROWSER, by the admin console, because
--      rasterising an SVG needs a canvas and the console already has one. It
--      uploads the PNG and calls merch_artwork_ready().
--
--   3. THE STORE IS CALLED FROM AN EDGE FUNCTION, never the browser, because
--      the provider's API key must not ship to a page. Same rule as the feed
--      endpoints and the Discord webhook: the key lives on a table with no
--      SELECT policy and only the service role ever reads it.
--
-- WHAT MAKES IT AUTOMATIC is at the bottom: approving a club's logo, renaming
-- a club or changing its colour marks that club's designs pending again. The
-- console picks up anything pending the next time it is opened. Nobody has to
-- remember that a new logo means new shirts.
-- ============================================================================

-- ------------------------------------------------------------- the store ---
create table if not exists public.merch_providers (
  league_id   uuid primary key references public.leagues on delete cascade,
  provider    text not null default 'manual',
  api_key     text,                       -- SECRET
  store_id    text,                       -- shop id, where the provider has one
  currency    text not null default 'GBP',
  markup_pct  numeric not null default 25,
  -- the provider's own catalogue ids, per product kind, e.g.
  -- {"tee": {"blueprint": 12, "variants": [4011, 4012]}, …}. We cannot know
  -- these; the league pastes them from their own store.
  catalogue   jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  created_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now(),
  last_run_at timestamptz,
  last_error  text
);
alter table public.merch_providers enable row level security;
-- No policy at all: the key is genuinely unreadable from outside.

do $$ begin
  alter table public.merch_providers add constraint merch_provider_ck
    check (provider in ('manual', 'printful', 'printify'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ the designs ---
create table if not exists public.merch_designs (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues on delete cascade,
  team_id       uuid references public.teams on delete cascade,   -- null = league-wide
  kind          text not null,
  status        text not null default 'pending',
  -- what was built
  svg_hash      text,
  artwork_path  text,
  width_px      int, height_px int,
  warnings      jsonb not null default '[]'::jsonb,
  -- what the store made of it
  external_id   text,
  external_url  text,
  price_pennies int,
  currency      text,
  error         text,
  built_at      timestamptz,
  published_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (league_id, team_id, kind)
);
create index if not exists merch_designs_league on public.merch_designs (league_id, status);
create index if not exists merch_designs_pending
  on public.merch_designs (status, updated_at) where status in ('pending', 'artwork');

do $$ begin
  alter table public.merch_designs add constraint merch_status_ck
    check (status in ('pending', 'building', 'artwork', 'published', 'failed', 'off'));
exception when duplicate_object then null; end $$;

alter table public.merch_designs enable row level security;

-- A PUBLISHED design is a shop window and is world-readable: that is the row
-- the embed and the league page read. Everything earlier is work in progress
-- and belongs to the league.
drop policy if exists merch_designs_public on public.merch_designs;
create policy merch_designs_public on public.merch_designs
  for select using (status = 'published');

drop policy if exists merch_designs_admin on public.merch_designs;
create policy merch_designs_admin on public.merch_designs
  for select to authenticated using (public.is_league_admin(league_id));

-- ------------------------------------------------------- the print bucket ---
-- Separate from media-public on purpose. That bucket's invariant is that
-- NOTHING arrives except by moderation — approve_media() is the only door — and
-- a generated print file is not a photograph anybody needs to approve. Mixing
-- them would mean loosening a rule that exists to keep unreviewed pictures of
-- people off the internet.
--
-- Public read, because the factory fetches the URL over the open internet and
-- there is nothing private in a club crest on a transparent background.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('merch-print', 'merch-print', true, 12582912, array['image/png', 'image/svg+xml'])
on conflict (id) do update set public = true,
  file_size_limit = 12582912,
  allowed_mime_types = array['image/png', 'image/svg+xml'];

-- The first path segment is the league id, so a league administrator may write
-- into their own league's folder and nowhere else. The regex guard matters:
-- casting a non-uuid segment would raise rather than deny, and an error in a
-- storage policy is a 500 where a refusal was wanted.
create or replace function public.may_write_merch(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare seg text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if seg !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_league_admin(seg::uuid);
end; $$;

drop policy if exists merch_print_write on storage.objects;
create policy merch_print_write on storage.objects for insert to authenticated
  with check (bucket_id = 'merch-print' and public.may_write_merch(name));
drop policy if exists merch_print_replace on storage.objects;
create policy merch_print_replace on storage.objects for update to authenticated
  using (bucket_id = 'merch-print' and public.may_write_merch(name))
  with check (bucket_id = 'merch-print' and public.may_write_merch(name));
drop policy if exists merch_print_delete on storage.objects;
create policy merch_print_delete on storage.objects for delete to authenticated
  using (bucket_id = 'merch-print' and public.may_write_merch(name));
drop policy if exists merch_print_read on storage.objects;
create policy merch_print_read on storage.objects for select to public
  using (bucket_id = 'merch-print');

-- ============================================================== the calls ===
create or replace function public.set_merch_provider(
  p_league uuid, p_provider text, p_api_key text default null,
  p_store_id text default null, p_currency text default null,
  p_markup numeric default null, p_catalogue jsonb default null,
  p_enabled boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'only an administrator of that league may set its shop'
      using errcode = '42501';
  end if;
  insert into merch_providers (league_id, provider, api_key, store_id, currency,
                               markup_pct, catalogue, enabled, created_by, updated_at)
  values (p_league, coalesce(p_provider, 'manual'),
          nullif(btrim(coalesce(p_api_key, '')), ''),
          nullif(btrim(coalesce(p_store_id, '')), ''),
          coalesce(p_currency, 'GBP'), coalesce(p_markup, 25),
          coalesce(p_catalogue, '{}'::jsonb), coalesce(p_enabled, true),
          auth.uid(), now())
  on conflict (league_id) do update set
    provider   = coalesce(p_provider, merch_providers.provider),
    -- an empty key means "leave it alone", not "delete it": the console can
    -- never show it back, so a blank box is the normal state of the form
    api_key    = coalesce(nullif(btrim(coalesce(p_api_key, '')), ''), merch_providers.api_key),
    store_id   = coalesce(nullif(btrim(coalesce(p_store_id, '')), ''), merch_providers.store_id),
    currency   = coalesce(p_currency, merch_providers.currency),
    markup_pct = coalesce(p_markup, merch_providers.markup_pct),
    catalogue  = coalesce(p_catalogue, merch_providers.catalogue),
    enabled    = coalesce(p_enabled, merch_providers.enabled),
    updated_at = now();
end; $$;

create or replace function public.merch_provider_status(p_league uuid)
returns table (provider text, has_key boolean, store_id text, currency text,
               markup_pct numeric, catalogue jsonb, enabled boolean,
               last_run_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select p.provider, p.api_key is not null, p.store_id, p.currency,
         p.markup_pct, p.catalogue, p.enabled, p.last_run_at, p.last_error
    from merch_providers p
   where p.league_id = p_league and public.is_league_admin(p_league)
  union all
  select 'manual', false, null, 'GBP', 25, '{}'::jsonb, true, null, null
   where public.is_league_admin(p_league)
     and not exists (select 1 from merch_providers q where q.league_id = p_league)
  limit 1;
$$;

-- Make sure every club has a row for every product. Idempotent: run it as
-- often as you like, it only ever fills gaps.
create or replace function public.queue_merch(p_league uuid, p_kinds text[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  kinds text[] := coalesce(p_kinds, array['tee', 'hoodie', 'scarf', 'poster', 'mug']);
  n int := 0;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'only an administrator of that league may build its merchandise'
      using errcode = '42501';
  end if;
  insert into merch_designs (league_id, team_id, kind, status)
  select p_league, t.id, k, 'pending'
    from teams t cross join unnest(kinds) k
   where t.league_id = p_league
  on conflict (league_id, team_id, kind) do nothing;
  get diagnostics n = row_count;
  return n;
end; $$;

-- The console asks for work. Anything already 'building' for more than ten
-- minutes is taken back: a browser tab that was closed mid-run must not leave
-- a design stuck for ever.
create or replace function public.merch_claim(p_league uuid, p_limit int default 8)
returns setof public.merch_designs
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'not your league' using errcode = '42501';
  end if;
  return query
  update merch_designs d set status = 'building', updated_at = now()
   where d.id in (
     select id from merch_designs
      where league_id = p_league
        and (status = 'pending'
             or (status = 'building' and updated_at < now() - interval '10 minutes'))
      order by updated_at
      limit greatest(1, least(coalesce(p_limit, 8), 40))
      for update skip locked)
  returning d.*;
end; $$;

create or replace function public.merch_artwork_ready(
  p_design uuid, p_path text, p_hash text,
  p_width int, p_height int, p_warnings jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid;
begin
  select league_id into v_league from merch_designs where id = p_design;
  if v_league is null or not public.is_league_admin(v_league) then
    raise exception 'not your design' using errcode = '42501';
  end if;
  update merch_designs
     set status = 'artwork', artwork_path = p_path, svg_hash = p_hash,
         width_px = p_width, height_px = p_height,
         warnings = coalesce(p_warnings, '[]'::jsonb),
         error = null, built_at = now(), updated_at = now()
   where id = p_design;
end; $$;

create or replace function public.merch_failed(p_design uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid;
begin
  select league_id into v_league from merch_designs where id = p_design;
  if v_league is null or not public.is_league_admin(v_league) then
    raise exception 'not your design' using errcode = '42501';
  end if;
  update merch_designs set status = 'failed', error = left(coalesce(p_error, ''), 400),
                           updated_at = now()
   where id = p_design;
end; $$;

-- Called by the Edge Function after it has spoken to the store.
create or replace function public.merch_published(
  p_design uuid, p_external_id text, p_external_url text,
  p_price int default null, p_currency text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_error is not null then
    update merch_designs set status = 'failed', error = left(p_error, 400), updated_at = now()
     where id = p_design;
    return;
  end if;
  update merch_designs
     set status = 'published', external_id = p_external_id, external_url = p_external_url,
         price_pennies = p_price, currency = coalesce(p_currency, currency),
         error = null, published_at = now(), updated_at = now()
   where id = p_design;
end; $$;

create or replace function public.merch_admin_list(p_league uuid)
returns setof public.merch_designs
language sql stable security definer set search_path = public as $$
  select * from merch_designs
   where league_id = p_league and public.is_league_admin(p_league)
   order by team_id, kind;
$$;

revoke execute on function public.set_merch_provider(uuid, text, text, text, text, numeric, jsonb, boolean) from anon, public;
grant  execute on function public.set_merch_provider(uuid, text, text, text, text, numeric, jsonb, boolean) to authenticated;
revoke execute on function public.merch_provider_status(uuid) from anon, public;
grant  execute on function public.merch_provider_status(uuid) to authenticated;
revoke execute on function public.queue_merch(uuid, text[]) from anon, public;
grant  execute on function public.queue_merch(uuid, text[]) to authenticated;
revoke execute on function public.merch_claim(uuid, int) from anon, public;
grant  execute on function public.merch_claim(uuid, int) to authenticated;
revoke execute on function public.merch_artwork_ready(uuid, text, text, int, int, jsonb) from anon, public;
grant  execute on function public.merch_artwork_ready(uuid, text, text, int, int, jsonb) to authenticated;
revoke execute on function public.merch_failed(uuid, text) from anon, public;
grant  execute on function public.merch_failed(uuid, text) to authenticated;
revoke execute on function public.merch_admin_list(uuid) from anon, public;
grant  execute on function public.merch_admin_list(uuid) to authenticated;
revoke execute on function public.merch_published(uuid, text, text, int, text, text) from anon, public, authenticated;
grant  execute on function public.merch_published(uuid, text, text, int, text, text) to service_role;
revoke execute on function public.may_write_merch(text) from anon, public;
grant  execute on function public.may_write_merch(text) to authenticated;

-- ========================================================= what makes it ====
-- ========================================================== automatic =======
-- A club's artwork changing is the whole reason a design goes stale. Rather
-- than hoping somebody remembers, the events that change how a product would
-- look put the design back to 'pending', and the console rebuilds it the next
-- time it is open.
create or replace function public.merch_restale_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  if tg_table_name = 'media' then
    -- only an APPROVED club logo changes a product
    if new.owner_type <> 'team' or new.kind <> 'logo' or new.status <> 'approved' then
      return new;
    end if;
    v_team := new.owner_id;
  else
    v_team := new.id;
    -- a rename or a recolour changes the print; anything else does not
    if tg_op = 'UPDATE' and new.name is not distinct from old.name
       and new.short_name is not distinct from old.short_name
       and new.colour is not distinct from old.colour then
      return new;
    end if;
  end if;

  update merch_designs
     set status = 'pending', updated_at = now()
   where team_id = v_team and status in ('artwork', 'published', 'failed');
  return new;
end; $$;

drop trigger if exists merch_restale_on_logo on public.media;
create trigger merch_restale_on_logo after insert or update on public.media
  for each row execute function public.merch_restale_team();

drop trigger if exists merch_restale_on_team on public.teams;
create trigger merch_restale_on_team after insert or update on public.teams
  for each row execute function public.merch_restale_team();

-- ---------------------------------------------------------------------------
-- Exercise the lot, as a real league administrator, and clean up after.
-- ---------------------------------------------------------------------------
do $$
declare
  orig   text;
  v_user uuid := gen_random_uuid();
  v_lg   uuid;
  v_tm   uuid;
  v_d    uuid;
  n      int;
  r      record;
  failed text[] := '{}';
  blocked boolean;
begin
  select current_user into orig;
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'merchtest@example.invalid', '', now(), now(), now());
  insert into leagues (slug, name) values ('merch-test', 'Merch Test') returning id into v_lg;
  insert into teams (league_id, slug, name, short_name, colour)
    values (v_lg, 'merch-club', 'Merch Club', 'MC', '#93f2bf') returning id into v_tm;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (v_user, 'league_admin', 'league', v_lg);

  set local role authenticated;

  -- a stranger gets nothing
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  blocked := false;
  begin perform public.queue_merch(v_lg); exception when others then blocked := true; end;
  if not blocked then failed := failed || 'a stranger queued merchandise'; end if;
  if exists (select 1 from public.merch_provider_status(v_lg)) then
    failed := failed || 'merch_provider_status answered a stranger';
  end if;

  -- the administrator
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  n := public.queue_merch(v_lg);
  if n <> 5 then failed := failed || ('queue_merch made ' || n || ' designs, expected 5'); end if;
  if public.queue_merch(v_lg) <> 0 then
    failed := failed || 'queue_merch is not idempotent';
  end if;

  select id into v_d from merch_designs where league_id = v_lg and kind = 'tee';
  select count(*) into n from public.merch_claim(v_lg, 2);
  if n <> 2 then failed := failed || ('merch_claim returned ' || n || ', expected 2'); end if;
  if (select status from merch_designs where id = v_d) not in ('building', 'pending') then
    failed := failed || 'claiming did not mark a design building';
  end if;

  perform public.merch_artwork_ready(v_d, v_lg || '/x/tee.png', 'abc', 3600, 4800, '[]'::jsonb);
  if (select status from merch_designs where id = v_d) <> 'artwork' then
    failed := failed || 'merch_artwork_ready did not take';
  end if;

  perform public.set_merch_provider(v_lg, 'printful', 'secret-key', 'shop-1', 'GBP', 30,
                                    '{"tee":{"variants":[1]}}'::jsonb, true);
  select * into r from public.merch_provider_status(v_lg);
  if not r.has_key then failed := failed || 'the api key was not stored'; end if;
  if r.provider <> 'printful' then failed := failed || 'the provider was not stored'; end if;
  -- and the key itself must be unreadable, even to the admin who set it
  if exists (select 1 from merch_providers where league_id = v_lg) then
    failed := failed || 'THE PROVIDER TABLE IS READABLE — the api key is exposed';
  end if;
  -- saving again without a key must not wipe it
  perform public.set_merch_provider(v_lg, 'printful', null, null, null, 40, null, true);
  select * into r from public.merch_provider_status(v_lg);
  if not r.has_key then failed := failed || 'saving without a key wiped the stored one'; end if;
  if r.markup_pct <> 40 then failed := failed || 'the markup did not update'; end if;

  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  -- publishing, then the automatic restale
  perform public.merch_published(v_d, 'ext-1', 'https://shop.example/x', 2500, 'GBP', null);
  if (select status from merch_designs where id = v_d) <> 'published' then
    failed := failed || 'merch_published did not take';
  end if;
  update teams set colour = '#ff0000' where id = v_tm;
  if (select status from merch_designs where id = v_d) <> 'pending' then
    failed := failed || 'recolouring a club did not stale its designs';
  end if;

  -- and a published design is world-readable while the rest is not
  perform public.merch_published(v_d, 'ext-1', 'https://shop.example/x', 2500, 'GBP', null);
  set local role anon;
  if not exists (select 1 from merch_designs where id = v_d) then
    failed := failed || 'a published design is invisible to the public';
  end if;
  if exists (select 1 from merch_designs where league_id = v_lg and status <> 'published') then
    failed := failed || 'unpublished designs leak to the public';
  end if;
  execute format('set local role %I', orig);

  delete from merch_designs where league_id = v_lg;
  delete from merch_providers where league_id = v_lg;
  delete from memberships where user_id = v_user;
  delete from teams where id = v_tm;
  delete from leagues where id = v_lg;
  delete from auth.users where id = v_user;

  if array_length(failed, 1) is not null then
    raise exception 'MERCH PIPELINE FAILURES (%): %',
      array_length(failed, 1), array_to_string(failed, ' | ');
  end if;
  raise notice 'merch: queueing is idempotent, the api key is write-only, a recolour '
               'restales the design, and only published rows are public';
end $$;
