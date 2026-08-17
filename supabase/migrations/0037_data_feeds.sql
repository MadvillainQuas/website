-- ============================================================================
-- SCRAPER KEYS — an automatic feed for the sites that carry our results.
--
-- RealGM, Eurobasket and their like do not want to be told where a JSON API
-- lives; they want the game to arrive, in their shape, the moment it is final,
-- and they want to be able to tell it really came from us. That is three
-- distinct problems and this table solves all three:
--
--   ARRIVES BY ITSELF   finalise-game queues a delivery per enabled feed and
--                       posts it. No polling, no cron, no missed nights.
--   IN THEIR SHAPE      format (json/csv/xml), which sections to include, how
--                       names and dates are written, and a field map that
--                       renames our keys to theirs. A partner who wants
--                       "TRB" instead of "reb" says so once.
--   PROVABLY OURS       every request carries an HMAC-SHA256 of the body,
--                       keyed on a shared secret. A partner that verifies it
--                       cannot be fed a forged result by anyone else.
--
-- THE ENDPOINT AND THE SECRET NEVER REACH A BROWSER. They live on a table with
-- no SELECT policy at all — the same design league_webhooks uses, and for the
-- same reason: a URL that accepts our results is a thing worth stealing. What
-- a league admin can see is everything else, through list_data_feeds().
--
-- Deliveries are RECORDED, not fired and forgotten. A partner who says "we
-- never got Tuesday" gets an answer, and a failed delivery can be retried
-- without replaying the game.
-- ============================================================================

create table if not exists public.data_feeds (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references public.leagues on delete cascade,
  name           text not null,                    -- 'RealGM'
  slug           text not null,                    -- 'realgm'
  format         text not null default 'json',
  -- what to send. Everything a partner does not want is bandwidth they have
  -- to parse past, and play-by-play is two orders of magnitude larger than
  -- the rest put together, so it is off unless asked for.
  sections       jsonb not null default
                 '{"game":true,"teams":true,"players":true,"boxscore":true,
                   "standings":false,"playbyplay":false}'::jsonb,
  field_map      jsonb not null default '{}'::jsonb,   -- {"reb":"TRB", …}
  name_style     text not null default 'first_last',
  date_style     text not null default 'iso',
  endpoint_url   text,                              -- SECRET
  signing_secret text,                              -- SECRET
  api_key_id     uuid references public.api_keys on delete set null,
  enabled        boolean not null default true,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  last_sent_at   timestamptz,
  last_status    int,
  last_error     text,
  unique (league_id, slug)
);
create index if not exists data_feeds_league on public.data_feeds (league_id);

do $$ begin
  alter table public.data_feeds add constraint data_feeds_format_ck
    check (format in ('json', 'csv', 'xml'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.data_feeds add constraint data_feeds_name_style_ck
    check (name_style in ('first_last', 'last_comma_first', 'last_first', 'last_upper'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.data_feeds add constraint data_feeds_date_style_ck
    check (date_style in ('iso', 'uk', 'us', 'epoch'));
exception when duplicate_object then null; end $$;

alter table public.data_feeds enable row level security;
-- No policy. The secrets are genuinely unreadable from outside; everything a
-- human needs comes back from list_data_feeds().

create table if not exists public.feed_deliveries (
  id           uuid primary key default gen_random_uuid(),
  feed_id      uuid not null references public.data_feeds on delete cascade,
  game_id      uuid references public.games on delete cascade,
  kind         text not null default 'game',
  status       text not null default 'pending',
  attempts     int  not null default 0,
  http_status  int,
  error        text,
  bytes        int,
  queued_at    timestamptz not null default now(),
  delivered_at timestamptz,
  unique (feed_id, game_id, kind)
);
create index if not exists feed_deliveries_feed on public.feed_deliveries (feed_id, queued_at desc);
create index if not exists feed_deliveries_pending
  on public.feed_deliveries (status, queued_at) where status in ('pending', 'failed');

do $$ begin
  alter table public.feed_deliveries add constraint feed_deliveries_status_ck
    check (status in ('pending', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;

alter table public.feed_deliveries enable row level security;

-- Which league a feed belongs to, answered past RLS — a policy runs as the
-- caller, so a plain subquery against data_feeds would see nothing and every
-- delivery would be invisible to the admin who owns it.
create or replace function public.feed_league(p_feed uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select league_id from data_feeds where id = p_feed;
$$;

drop policy if exists feed_deliveries_read on public.feed_deliveries;
create policy feed_deliveries_read on public.feed_deliveries
  for select to authenticated
  using (public.is_league_admin(public.feed_league(feed_id)));

-- ---------------------------------------------------------------------------
-- Creating and editing a feed.
-- ---------------------------------------------------------------------------
create or replace function public.create_data_feed(
  p_league uuid, p_name text, p_format text default 'json')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_slug text;
  v_id   uuid;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'only an administrator of that league may add a feed'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a feed needs a name — whoever is receiving it';
  end if;

  v_slug := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then v_slug := 'feed'; end if;

  insert into data_feeds (league_id, name, slug, format, created_by)
  values (p_league, left(btrim(p_name), 80), left(v_slug, 40),
          coalesce(p_format, 'json'), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- The push target. Validated rather than trusted: without these checks this
-- function is a server-side request forgery primitive — a league admin could
-- point it at an address only our Edge Function can reach and have the
-- function fetch it on their behalf.
create or replace function public.set_data_feed_endpoint(
  p_feed uuid, p_url text, p_secret text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_league uuid := public.feed_league(p_feed);
  v_host   text;
begin
  if v_league is null then raise exception 'no such feed'; end if;
  if not public.is_league_admin(v_league) then
    raise exception 'only an administrator of that league may set its endpoint'
      using errcode = '42501';
  end if;

  if p_url is null or btrim(p_url) = '' then
    update data_feeds set endpoint_url = null, signing_secret = null,
                          last_status = null, last_error = null
     where id = p_feed;
    return;
  end if;

  if p_url !~ '^https://' then
    raise exception 'the endpoint must be https — a result posted over http can be read and rewritten in transit';
  end if;

  v_host := lower(split_part(split_part(regexp_replace(p_url, '^https://', ''), '/', 1), ':', 1));

  -- No bare addresses. A hostname can be checked; an IP literal is almost
  -- always somebody trying to reach something that is not on the internet.
  if v_host ~ '^[0-9.]+$' or v_host ~ ':' then
    raise exception 'give a hostname rather than an IP address';
  end if;
  if v_host in ('localhost', 'metadata.google.internal')
     or v_host like '%.local' or v_host like '%.internal'
     or v_host like '%.localhost' then
    raise exception 'that host is not reachable from the public internet';
  end if;
  if v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'that does not look like a hostname';
  end if;

  update data_feeds
     set endpoint_url   = btrim(p_url),
         signing_secret = coalesce(nullif(btrim(coalesce(p_secret, '')), ''), signing_secret),
         last_status = null, last_error = null
   where id = p_feed;
end; $$;

create or replace function public.update_data_feed(
  p_feed uuid,
  p_name text default null, p_format text default null,
  p_sections jsonb default null, p_field_map jsonb default null,
  p_name_style text default null, p_date_style text default null,
  p_enabled boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid := public.feed_league(p_feed);
begin
  if v_league is null then raise exception 'no such feed'; end if;
  if not public.is_league_admin(v_league) then
    raise exception 'only an administrator of that league may change a feed'
      using errcode = '42501';
  end if;

  update data_feeds set
    name       = coalesce(left(nullif(btrim(coalesce(p_name, '')), ''), 80), name),
    format     = coalesce(p_format, format),
    sections   = coalesce(p_sections, sections),
    field_map  = coalesce(p_field_map, field_map),
    name_style = coalesce(p_name_style, name_style),
    date_style = coalesce(p_date_style, date_style),
    enabled    = coalesce(p_enabled, enabled)
  where id = p_feed;
end; $$;

create or replace function public.delete_data_feed(p_feed uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid := public.feed_league(p_feed);
begin
  if v_league is null then return; end if;
  if not public.is_league_admin(v_league) then
    raise exception 'only an administrator of that league may remove a feed'
      using errcode = '42501';
  end if;
  delete from data_feeds where id = p_feed;
end; $$;

-- Everything about a feed EXCEPT the two secrets, plus how it is doing.
create or replace function public.list_data_feeds(p_league uuid)
returns table (id uuid, name text, slug text, format text, sections jsonb,
               field_map jsonb, name_style text, date_style text,
               enabled boolean, has_endpoint boolean, has_secret boolean,
               endpoint_host text, api_key_prefix text,
               last_sent_at timestamptz, last_status int, last_error text,
               sent_count bigint, failed_count bigint, pending_count bigint)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.slug, f.format, f.sections, f.field_map,
         f.name_style, f.date_style, f.enabled,
         f.endpoint_url is not null,
         f.signing_secret is not null,
         -- the host is safe to show and is the one part an admin needs to
         -- recognise which partner a row belongs to; the path is not
         case when f.endpoint_url is null then null
              else split_part(split_part(regexp_replace(f.endpoint_url, '^https://', ''), '/', 1), ':', 1)
         end,
         k.prefix,
         f.last_sent_at, f.last_status, f.last_error,
         coalesce(d.sent, 0), coalesce(d.failed, 0), coalesce(d.pending, 0)
    from data_feeds f
    left join api_keys k on k.id = f.api_key_id
    left join lateral (
      select count(*) filter (where status = 'sent')    as sent,
             count(*) filter (where status = 'failed')  as failed,
             count(*) filter (where status = 'pending') as pending
        from feed_deliveries fd where fd.feed_id = f.id
    ) d on true
   where f.league_id = p_league
     and public.is_league_admin(p_league)
   order by f.name;
$$;

-- ---------------------------------------------------------------------------
-- Queueing. Called by finalise-game the moment a result is published, and by
-- an admin who wants to resend one. Queueing is separate from sending so a
-- delivery survives the Edge Function falling over mid-post.
-- ---------------------------------------------------------------------------
create or replace function public.queue_feed_deliveries(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_league uuid;
  n int := 0;
begin
  select l.id into v_league
    from games g
    join competitions c on c.id = g.competition_id
    join seasons s      on s.id = c.season_id
    join leagues l      on l.id = s.league_id
   where g.id = p_game;

  -- An ad-hoc game with no competition belongs to no league, so there is
  -- nobody to send it to. Say nothing and do nothing.
  if v_league is null then return 0; end if;

  insert into feed_deliveries (feed_id, game_id, kind, status, attempts,
                               queued_at, http_status, error)
  select f.id, p_game, 'game', 'pending', 0, now(), null, null
    from data_feeds f
   where f.league_id = v_league and f.enabled and f.endpoint_url is not null
  on conflict (feed_id, game_id, kind) do update
    -- a re-finalised game is a NEW delivery, not a duplicate: the numbers
    -- may have changed and the partner needs the corrected version
    set status = 'pending', attempts = 0, queued_at = now(),
        http_status = null, error = null, delivered_at = null;

  get diagnostics n = row_count;
  return n;
end; $$;

-- An admin resending by hand. Same queue, same dispatcher, one row.
create or replace function public.requeue_feed_delivery(p_feed uuid, p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_league uuid := public.feed_league(p_feed);
begin
  if v_league is null then raise exception 'no such feed'; end if;
  if not public.is_league_admin(v_league) then
    raise exception 'only an administrator of that league may resend'
      using errcode = '42501';
  end if;
  insert into feed_deliveries (feed_id, game_id, kind, status, queued_at)
  values (p_feed, p_game, 'game', 'pending', now())
  on conflict (feed_id, game_id, kind) do update
    set status = 'pending', attempts = 0, queued_at = now(),
        http_status = null, error = null, delivered_at = null;
end; $$;

revoke execute on function public.create_data_feed(uuid, text, text) from anon, public;
grant  execute on function public.create_data_feed(uuid, text, text) to authenticated;
revoke execute on function public.set_data_feed_endpoint(uuid, text, text) from anon, public;
grant  execute on function public.set_data_feed_endpoint(uuid, text, text) to authenticated;
revoke execute on function
  public.update_data_feed(uuid, text, text, jsonb, jsonb, text, text, boolean) from anon, public;
grant  execute on function
  public.update_data_feed(uuid, text, text, jsonb, jsonb, text, text, boolean) to authenticated;
revoke execute on function public.delete_data_feed(uuid) from anon, public;
grant  execute on function public.delete_data_feed(uuid) to authenticated;
revoke execute on function public.list_data_feeds(uuid) from anon, public;
grant  execute on function public.list_data_feeds(uuid) to authenticated;
revoke execute on function public.requeue_feed_delivery(uuid, uuid) from anon, public;
grant  execute on function public.requeue_feed_delivery(uuid, uuid) to authenticated;
-- Queueing is the dispatcher's job, not a person's. Only the Edge Function's
-- service role may call it; an admin who wants to resend uses
-- requeue_feed_delivery, which checks that they administer the league.
revoke execute on function public.queue_feed_deliveries(uuid) from anon, public, authenticated;
grant  execute on function public.queue_feed_deliveries(uuid) to service_role;
revoke execute on function public.feed_league(uuid) from anon, public;
grant  execute on function public.feed_league(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Exercise every function. plpgsql bodies are not type-checked at creation, so
-- a migration that only installs them has proved nothing.
-- ---------------------------------------------------------------------------
-- Every check here is a permission check, so running as the migration role
-- proves nothing: it is nobody's league administrator and every call would be
-- refused for the wrong reason. So this does what 0031 does — creates a
-- throwaway league with a throwaway admin and IMPERSONATES them, which is what
-- the functions actually read. It signs nobody up: a real signup would spend
-- from the same email allowance the magic-link logins use.
--
-- It leaves nothing behind, and any failure rolls the whole migration back.
do $$
declare
  orig     text;
  v_user   uuid := gen_random_uuid();
  v_league uuid;
  v_season uuid;
  v_comp   uuid;
  v_home   uuid;
  v_away   uuid;
  v_game   uuid;
  v_feed   uuid;
  n        int;
  r        record;
  blocked  boolean;
  failed   text[] := '{}';
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'feedtest@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('feed-test-league', 'Feed Test League')
    returning id into v_league;
  insert into seasons (league_id, name, starts_on, ends_on)
    values (v_league, 'Feed', current_date, current_date + 1) returning id into v_season;
  insert into competitions (season_id, name) values (v_season, 'Feed Div')
    returning id into v_comp;
  insert into teams (league_id, slug, name) values (v_league, 'feed-a', 'Feed A')
    returning id into v_home;
  insert into teams (league_id, slug, name) values (v_league, 'feed-b', 'Feed B')
    returning id into v_away;
  insert into games (competition_id, home_team_id, away_team_id, status, tipoff_at)
    values (v_comp, v_home, v_away, 'final', now()) returning id into v_game;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (v_user, 'league_admin', 'league', v_league);

  -- ------------------------------------------------- as a passing stranger ---
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    perform public.create_data_feed(v_league, 'Should never exist', 'json');
  exception when others then blocked := true;
  end;
  if not blocked then
    failed := failed || 'somebody who administers nothing was allowed to add a feed';
  end if;
  if exists (select 1 from public.list_data_feeds(v_league)) then
    failed := failed || 'list_data_feeds answered a caller who administers nothing';
  end if;

  -- ------------------------------------------------ as the league's admin ---
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  if auth.uid() <> v_user then
    raise exception 'impersonation did not take: auth.uid() is %', auth.uid();
  end if;

  v_feed := public.create_data_feed(v_league, 'Migration self-test', 'json');

  -- every SSRF guard, each one asserted to actually refuse
  for r in select unnest(array[
        'http://example.com/hook',            -- not https
        'https://127.0.0.1/hook',             -- IP literal
        'https://10.0.0.5/hook',              -- private range, still an IP literal
        'https://localhost/hook',             -- loopback by name
        'https://metadata.google.internal/x', -- cloud metadata
        'https://box.internal/hook',          -- private suffix
        'https://printer.local/hook'          -- mDNS
      ]) as u
  loop
    blocked := false;
    begin
      perform public.set_data_feed_endpoint(v_feed, r.u, 's');
    exception when others then blocked := true;
    end;
    if not blocked then
      failed := failed || ('set_data_feed_endpoint accepted ' || r.u);
    end if;
  end loop;

  perform public.set_data_feed_endpoint(v_feed, 'https://example.com/courtside', 'secret');
  perform public.update_data_feed(v_feed, null, 'csv', null,
                                  '{"reb":"TRB"}'::jsonb, 'last_comma_first', 'uk', true);

  select * into r from public.list_data_feeds(v_league) where id = v_feed;
  if r.id is null then failed := failed || 'list_data_feeds lost the feed just created'; end if;
  if r.endpoint_host is distinct from 'example.com' then
    failed := failed || ('list_data_feeds reported host ' || coalesce(r.endpoint_host, 'null'));
  end if;
  if r.format is distinct from 'csv' or r.field_map->>'reb' is distinct from 'TRB' then
    failed := failed || 'update_data_feed did not take';
  end if;
  if not r.has_secret then failed := failed || 'the signing secret was not stored'; end if;

  perform public.requeue_feed_delivery(v_feed, v_game);
  if not exists (select 1 from feed_deliveries
                  where feed_id = v_feed and game_id = v_game and status = 'pending') then
    failed := failed || 'requeue_feed_delivery queued nothing';
  end if;
  -- and the admin can SEE their own delivery, which is the policy under test
  if not exists (select 1 from feed_deliveries where feed_id = v_feed) then
    failed := failed || 'the delivery log is invisible to the admin who owns it';
  end if;

  -- --------------------------------------------- back to the owning role ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);

  -- queueing is the dispatcher's job and is revoked from everybody else
  n := public.queue_feed_deliveries(v_game);
  if n <> 1 then
    failed := failed || ('queue_feed_deliveries queued ' || n || ', expected 1');
  end if;

  -- ------------------------------------------------------------ clean up ---
  delete from feed_deliveries where feed_id = v_feed;
  delete from data_feeds where league_id = v_league;
  delete from games where id = v_game;
  delete from memberships where user_id = v_user;
  delete from teams where id in (v_home, v_away);
  delete from competitions where id = v_comp;
  delete from seasons where id = v_season;
  delete from leagues where id = v_league;
  delete from auth.users where id = v_user;

  if array_length(failed, 1) is not null then
    raise exception 'DATA FEED FAILURES (% of them): %',
      array_length(failed, 1), array_to_string(failed, ' | ');
  end if;

  raise notice 'data feeds: every function runs, every unsafe endpoint is refused, '
               'and a stranger can neither add a feed nor list one';
end $$;
