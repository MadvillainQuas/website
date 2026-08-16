-- ============================================================================
-- 0008 — grant platform_admin to the owner's account.
--
-- bootstrap_admin() refuses once any platform admin exists, which makes it a
-- one-shot and awkward to re-run. This grants directly instead, and does it
-- defensively: if the account has never signed in there is no auth.users row
-- to point at, so it raises a NOTICE and moves on rather than failing the whole
-- migration. Re-run `supabase db push` after signing in once and it will take.
--
-- Idempotent: memberships has unique (user_id, role, scope_type, scope_id).
-- ============================================================================
do $$
declare
  target text := 'britishbasketballscout@gmail.com';
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(target) limit 1;

  if uid is null then
    raise notice 'NO ACCOUNT for % — sign in once at /league/app/, then re-run this migration', target;
    return;
  end if;

  insert into public.memberships (user_id, role, scope_type, scope_id)
  values (uid, 'platform_admin', 'platform', null)
  on conflict do nothing;

  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (uid, 'grant_platform_admin', 'membership', uid::text,
          jsonb_build_object('email', target, 'via', 'migration 0008'));

  raise notice 'platform_admin granted to %', target;
end $$;
