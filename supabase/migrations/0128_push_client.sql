-- ============================================================================
-- 0128 — WHICH KIND OF CLIENT EACH PHONE'S SUBSCRIPTION CAME FROM.
--
-- The Epinoia Android app (a Trusted Web Activity on Chrome) subscribes to push as its
-- own client. A fan who used the Samsung Internet web app before installing it keeps that
-- subscription too, and notify pushes to every subscription on the account, so each
-- notification arrives twice. The endpoint cannot tell the two apart (Chrome and Samsung
-- Internet both use Google's push service) and the user agent cannot tell a Chrome tab
-- from the app, so push.js now says which it is when it saves the row:
--
--   tab           a browser tab
--   pwa           an installed web app (not Samsung Internet's)
--   twa           the Epinoia Android app
--   samsung-app   Samsung Internet's installed web app
--
-- The profile page, inside the app, reads the fan's own rows (push_own, 0106) and offers
-- to turn off the Samsung Internet web app's and the older unlabelled Android rows.
-- Nothing else changes: the column is nullable (every row saved before this has none, and
-- push.js retries without it when PostgREST does not know it yet), and the policy and
-- grants are 0106's. Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.push_subscriptions
  add column if not exists client text;

do $c$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.push_subscriptions'::regclass and conname = 'push_subscriptions_client_check') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_client_check
      check (client is null or client in ('tab', 'pwa', 'twa', 'samsung-app'));
  end if;
end $c$;

comment on column public.push_subscriptions.client is
  'Which kind of client saved the subscription (push.js): tab = a browser tab, pwa = an installed web app, twa = the Epinoia Android app, samsung-app = Samsung Internet''s installed web app. Null for rows saved before 0128.';

do $test$
declare
  who  text := current_user || ' (session ' || session_user || ')';
  orig text := current_user;
  u    uuid;
  v_n  int;
begin
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = 'public.push_subscriptions'::regclass and a.attname = 'client' and not a.attisdropped
                    and not a.attnotnull and a.atttypid = 'text'::regtype) then
    raise exception '0128: push_subscriptions needs a nullable text column client';
  end if;
  if not exists (select 1 from pg_policy pol where pol.polrelid = 'public.push_subscriptions'::regclass and pol.polname = 'push_own') then
    raise exception '0128: push_own (0106) is gone from push_subscriptions';
  end if;

  -- a fan saves each kind, and removes their own rows; an unknown kind is refused (rolled back)
  begin
    select p.id into u from public.profiles p order by p.created_at limit 1;
    if u is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, client)
      values (u, 'https://fcm.googleapis.com/fcm/send/t128-tab', 'k', 'a', 'tab'),
             (u, 'https://fcm.googleapis.com/fcm/send/t128-pwa', 'k', 'a', 'pwa'),
             (u, 'https://fcm.googleapis.com/fcm/send/t128-twa', 'k', 'a', 'twa'),
             (u, 'https://fcm.googleapis.com/fcm/send/t128-samsung', 'k', 'a', 'samsung-app'),
             (u, 'https://fcm.googleapis.com/fcm/send/t128-none', 'k', 'a', null);
      delete from push_subscriptions s where s.endpoint = 'https://fcm.googleapis.com/fcm/send/t128-samsung';
      select count(*) into v_n from push_subscriptions s where s.endpoint like 'https://fcm.googleapis.com/fcm/send/t128-%';
      execute format('set local role %I', orig);
      if v_n <> 4 then
        raise exception '0128: a fan could not save every kind of client, or remove their own row (% rows)', v_n;
      end if;

      begin
        insert into push_subscriptions (user_id, endpoint, p256dh, auth, client)
        values (u, 'https://fcm.googleapis.com/fcm/send/t128-bad', 'k', 'a', 'webview');
        raise exception '0128: a client outside tab, pwa, twa and samsung-app was accepted';
      exception when check_violation then null;
      end;
    end if;
    raise exception using errcode = 'P0128', message = '0128 passed; rolling its test rows back';
  exception
    when sqlstate 'P0128' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from push_subscriptions s where s.endpoint like 'https://fcm.googleapis.com/fcm/send/t128-%') then
    raise exception '0128: the test rows outlived their rollback';
  end if;
  raise notice '0128 ok: each subscription can say which client saved it';
end $test$;
