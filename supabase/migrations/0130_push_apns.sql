-- ============================================================================
-- 0130 — THE IPHONE APP'S NOTIFICATIONS: AN APPLE DEVICE TOKEN IS A PHONE TOO.
--
-- The Epinoia iPhone app (ios/) shows the live site in a WKWebView, and WKWebView has
-- no Web Push. The app registers with Apple Push Notification service itself and hands
-- the page its device token (window.EpinoiaNative, ios/README.md); push.js saves it as
-- this account's phone, exactly where a browser's subscription goes, so every fan-out
-- (notify_audience, the tick, the test, the check) reaches it without a second table.
--
-- ONE ROW, ONE PHONE, AS BEFORE. The row's endpoint names Apple's address for the phone:
--
--   apns:production:<hex token>    an App Store or TestFlight build
--   apns:sandbox:<hex token>       a development build from Xcode
--
-- The notify function reads the prefix and sends through APNs (_shared/apns.js) instead
-- of Web Push. Such a row has no Web Push keys, so p256dh and auth may now be null, but
-- only on an apns: row: a browser's row still needs both, and a check says so. An apns:
-- row is always client 'ios', and 'ios' is never a browser's.
--
-- A PHONE PASSED FROM ONE ACCOUNT TO ANOTHER. A browser that changes account takes a
-- fresh subscription, and the old row dies on its first 410. An iPhone keeps its token
-- whoever signs in, so the old account's row would go on delivering its notifications to
-- a phone somebody else now uses. push_claim_device(endpoint) lets the account signed in
-- on the phone take the token over: it removes other accounts' rows for exactly that
-- apns: endpoint and nothing else. RLS (push_own, 0106) could not do it, since those rows
-- are not the caller's. Knowing a token is knowing the phone: Apple gives it only to the
-- app on that device, and the site never shows one.
--
-- Nothing else changes. Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;

do $c$
begin
  /* 0128's list of clients, and the iPhone app */
  if exists (select 1 from pg_constraint
              where conrelid = 'public.push_subscriptions'::regclass and conname = 'push_subscriptions_client_check') then
    alter table public.push_subscriptions drop constraint push_subscriptions_client_check;
  end if;
  alter table public.push_subscriptions
    add constraint push_subscriptions_client_check
    check (client is null or client in ('tab', 'pwa', 'twa', 'samsung-app', 'ios'));

  /* an apns: row is well formed and the iPhone app's; any other row is a browser's, with its keys */
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.push_subscriptions'::regclass and conname = 'push_subscriptions_transport_check') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_transport_check
      check (case when endpoint like 'apns:%'
                  then endpoint ~ '^apns:(production|sandbox):[0-9a-f]{64,200}$' and client is not distinct from 'ios'
                  else p256dh is not null and auth is not null and client is distinct from 'ios' end);
  end if;
end $c$;

comment on column public.push_subscriptions.endpoint is
  'Where a push to this phone goes: a browser''s Web Push endpoint, or apns:production:<token> / apns:sandbox:<token> for the Epinoia iPhone app (0130).';
comment on column public.push_subscriptions.client is
  'Which kind of client saved the subscription (push.js): tab = a browser tab, pwa = an installed web app, twa = the Epinoia Android app, samsung-app = Samsung Internet''s installed web app, ios = the Epinoia iPhone app. Null for rows saved before 0128.';

create or replace function public.push_claim_device(p_endpoint text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n  integer;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^apns:(production|sandbox):[0-9a-f]{64,200}$' then
    raise exception 'only the iPhone app''s notification address can be taken over' using errcode = '22023';
  end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id <> me;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.push_claim_device(text) is
  'The iPhone app, signed in as a new account: removes other accounts'' rows for this exact apns: endpoint so their notifications stop reaching the phone. Returns how many rows went (0130).';

revoke all on function public.push_claim_device(text) from public, anon;
grant execute on function public.push_claim_device(text) to authenticated;

-- ============================================================================
-- SELF-TEST, rolled back.
-- ============================================================================
do $test$
declare
  who  text := current_user || ' (session ' || session_user || ')';
  orig text := current_user;
  u1   uuid := gen_random_uuid();
  u2   uuid := gen_random_uuid();
  half text := 'two fresh accounts';
  tok  text := repeat('ab', 32);
  ep   text;
  v_n  int;
begin
  begin
    if exists (select 1 from pg_attribute a where a.attrelid = 'public.push_subscriptions'::regclass
                and a.attname in ('p256dh', 'auth') and a.attnotnull and not a.attisdropped) then
      raise exception '0130: p256dh and auth must accept null for an iPhone row';
    end if;
    if not exists (select 1 from pg_policy pol where pol.polrelid = 'public.push_subscriptions'::regclass and pol.polname = 'push_own') then
      raise exception '0130: push_own (0106) is gone from push_subscriptions';
    end if;
    if has_function_privilege('anon', 'public.push_claim_device(text)', 'execute') then
      raise exception '0130: a signed-out caller may run push_claim_device';
    end if;

    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't130-a@example.invalid', '', now(), now(), now()),
             (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't130-b@example.invalid', '', now(), now(), now());
    exception when insufficient_privilege then
      select p.id into u1 from public.profiles p order by p.created_at limit 1;
      select p.id into u2 from public.profiles p where p.id <> u1 order by p.created_at limit 1;
      if u1 is null or u2 is null then raise exception '0130: no two accounts to test with'; end if;
      half := 'two borrowed profiles';
    end;
    ep := 'apns:production:' || tok;

    -- ---- the first account's iPhone, and its browser, saved as that fan ---------------
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, client)
    values (u1, ep, null, null, 'ios'),
           (u1, 'https://fcm.googleapis.com/fcm/send/t130-tab', 'k', 'a', 'tab');

    begin
      insert into push_subscriptions (user_id, endpoint, client) values (u1, 'apns:production:' || repeat('cd', 32), 'tab');
      execute format('set local role %I', orig);
      raise exception '0130: an apns: row was accepted as a browser tab';
    exception when check_violation then null;
    end;
    begin
      insert into push_subscriptions (user_id, endpoint, client) values (u1, 'apns:production:NOT-HEX', 'ios');
      execute format('set local role %I', orig);
      raise exception '0130: a malformed apns: endpoint was accepted';
    exception when check_violation then null;
    end;
    begin
      insert into push_subscriptions (user_id, endpoint, client) values (u1, 'apns:staging:' || repeat('cd', 32), 'ios');
      execute format('set local role %I', orig);
      raise exception '0130: an apns: endpoint outside production and sandbox was accepted';
    exception when check_violation then null;
    end;
    begin
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, client) values (u1, 'https://fcm.googleapis.com/fcm/send/t130-nokeys', null, null, 'tab');
      execute format('set local role %I', orig);
      raise exception '0130: a browser row without its keys was accepted';
    exception when check_violation then null;
    end;
    begin
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, client) values (u1, 'https://fcm.googleapis.com/fcm/send/t130-ios', 'k', 'a', 'ios');
      execute format('set local role %I', orig);
      raise exception '0130: a browser row was accepted as the iPhone app';
    exception when check_violation then null;
    end;
    begin
      perform public.push_claim_device('https://fcm.googleapis.com/fcm/send/t130-tab');
      execute format('set local role %I', orig);
      raise exception '0130: push_claim_device took over a browser''s endpoint';
    exception when invalid_parameter_value then null;
    end;
    execute format('set local role %I', orig);

    -- ---- the phone changes hands: the second account cannot overwrite it, then claims it -----
    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into push_subscriptions (user_id, endpoint, client) values (u2, ep, 'ios')
        on conflict (endpoint) do update set user_id = excluded.user_id, client = excluded.client;
      execute format('set local role %I', orig);
      raise exception '0130: another account''s iPhone row was overwritten without claiming it';
    exception when insufficient_privilege then null;
    end;
    v_n := public.push_claim_device(ep);
    if v_n <> 1 then
      execute format('set local role %I', orig);
      raise exception '0130: claiming the phone removed % rows, not 1', v_n;
    end if;
    insert into push_subscriptions (user_id, endpoint, client) values (u2, ep, 'ios');
    v_n := public.push_claim_device(ep);               -- its own row stays
    execute format('set local role %I', orig);
    if v_n <> 0 or (select user_id from push_subscriptions where endpoint = ep) is distinct from u2 then
      raise exception '0130: after the claim the phone is not the second account''s alone (%)', v_n;
    end if;
    if not exists (select 1 from push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/t130-tab' and user_id = u1) then
      raise exception '0130: the claim removed the first account''s browser too';
    end if;

    perform set_config('request.jwt.claims', '', true);
    begin
      perform public.push_claim_device(ep);
      raise exception '0130: push_claim_device ran with nobody signed in';
    exception when insufficient_privilege then null;
    end;

    raise exception using errcode = 'P0130', message = '0130 passed; rolling its test rows back';
  exception
    when sqlstate 'P0130' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from push_subscriptions s where s.endpoint like '%t130-%' or s.endpoint = 'apns:production:' || tok) then
    raise exception '0130: the test rows outlived their rollback';
  end if;
  raise notice '0130 ok: an iPhone app row needs no Web Push keys but must be a well-formed apns: address of client ios, a browser row still needs its keys, and only the account signed in on the phone can take its token over. Ran with %', half;
end $test$;
