-- ============================================================================
-- 0125 — WHAT EACH PHONE'S PUSH SERVICE LAST SAID.
--
-- A phone that stops getting notifications gave nobody a reason: the notify function
-- counted a refusal into a note in its own response and moved on. Now every push
-- records, on the subscription it went to, when it was sent, the push service's HTTP
-- status (201 accepted; 403 a key the phone did not sign up with; 404 or 410 the
-- sign-up has expired, in which case the row is removed as before; 0 this server
-- failing before any push service answered) and the push service's own words.
--
-- The profile page's check (docs/notifications.md §7) reads the fan's own rows —
-- push_own (0106) already lets a fan read them — and the notify function's anonymous
-- self-check counts accepted and refused pushes over the last day, with no personal
-- data. Nothing else changes: the columns are nullable, a phone that has never been
-- pushed to has none of them, and the policy and grants are 0106's.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.push_subscriptions
  add column if not exists last_push_at     timestamptz,
  add column if not exists last_push_status int,
  add column if not exists last_push_error  text;

comment on column public.push_subscriptions.last_push_status is
  'The push service''s HTTP status for the last push sent to this subscription: 2xx accepted, 401/403 refused (key mismatch), 404/410 expired (the row is then removed), 429/5xx try later, 0 the server failed before a push service answered.';

do $test$
declare
  who  text := current_user || ' (session ' || session_user || ')';
  orig text := current_user;
  u    uuid;
  v_n  int;
begin
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.push_subscriptions'::regclass and not a.attisdropped and not a.attnotnull
         and ((a.attname = 'last_push_at' and a.atttypid = 'timestamptz'::regtype)
           or (a.attname = 'last_push_status' and a.atttypid = 'int4'::regtype)
           or (a.attname = 'last_push_error' and a.atttypid = 'text'::regtype))) <> 3 then
    raise exception '0125: push_subscriptions needs last_push_at (timestamptz), last_push_status (int) and last_push_error (text), all nullable';
  end if;
  if not exists (select 1 from pg_policy pol where pol.polrelid = 'public.push_subscriptions'::regclass and pol.polname = 'push_own') then
    raise exception '0125: push_own (0106) is gone from push_subscriptions';
  end if;

  -- a fan reads the status of their own phone and nobody else's (rolled back)
  begin
    select p.id into u from public.profiles p order by p.created_at limit 1;
    if u is not null then
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, last_push_at, last_push_status, last_push_error)
      values (u, 'https://fcm.googleapis.com/fcm/send/t125-own', 'k', 'a', now(), 403, 'the VAPID credentials do not match'),
             (u, 'https://fcm.googleapis.com/fcm/send/t125-own-2', 'k', 'a', null, null, null);

      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_n from push_subscriptions s
       where s.endpoint = 'https://fcm.googleapis.com/fcm/send/t125-own' and s.last_push_status = 403
         and s.last_push_error like '%VAPID%';
      execute format('set local role %I', orig);
      if v_n <> 1 then
        raise exception '0125: a fan cannot read the last push status of their own phone';
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_n from push_subscriptions s where s.endpoint like 'https://fcm.googleapis.com/fcm/send/t125-%';
      execute format('set local role %I', orig);
      if v_n <> 0 then
        raise exception '0125: a stranger can read somebody else''s phone';
      end if;
    end if;
    raise exception using errcode = 'P0125', message = '0125 passed; rolling its test rows back';
  exception
    when sqlstate 'P0125' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from push_subscriptions s where s.endpoint like 'https://fcm.googleapis.com/fcm/send/t125-%') then
    raise exception '0125: the test rows outlived their rollback';
  end if;
  raise notice '0125 ok: every push''s answer is recorded on its subscription, readable by the phone''s owner alone';
end $test$;
