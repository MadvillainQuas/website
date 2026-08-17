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
  target text := coalesce(current_setting('courtside.admin_email', true), '');
  uid uuid;
begin
  /* The address was supplied when this ran and is deliberately not written
     here: this file is in a public repository, and a personal address in a
     public repository is a spam list entry with extra steps.

     Both grants have already been applied on the live project. For a FRESH
     database, name the admin explicitly when you push:

         psql "$DATABASE_URL" -c "select public.grant_platform_admin('you@example.com')"

     Hardcoding it was also the wrong shape regardless of privacy — a fresh
     deployment of this schema by anybody else should not silently make a
     stranger's address the platform administrator. */
  if target = '' then
    raise notice 'no courtside.admin_email set — skipping the platform-admin grant';
    return;
  end if;

  select id into uid from auth.users where lower(email) = lower(target) limit 1;

  if uid is null then
    raise notice 'NO ACCOUNT for % — sign in once at /epinoia/app/, then re-run this migration', target;
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
