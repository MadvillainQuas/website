-- ============================================================================
-- ONE platform_update_league, NOT TWO.
--
-- 0044 defined it with seven arguments. 0069 added p_auto_reports and used
-- `create or replace`, which is the natural verb and the wrong one: Postgres
-- overloads on the ARGUMENT LIST, so adding a parameter does not replace
-- anything. It creates a second function and leaves the first exactly where it
-- was, both looking correct in the schema.
--
-- THIS IS NOT THEORETICAL. Probed against the live project:
--
--   7 named arguments  -> HTTP 300, PGRST203
--                         "Could not choose the best candidate function"
--   8 named arguments  -> resolves
--
-- and epinoia/admin/platform/platform.js sends exactly seven. So the "save"
-- button on every league in the platform console has been failing since 0069
-- was applied — silently, because the console reports a falsy result as
-- "nothing happened" rather than as an error.
--
-- Dropping the older signature leaves one candidate. A seven-argument call
-- then resolves to it with p_auto_reports defaulting to null, which already
-- means "leave that setting alone" — so the existing caller starts working
-- again without being changed, and a caller that wants to set it passes eight.
--
-- WHY NOT KEEP BOTH AND FIX THE CALLER. Because the ambiguity is the bug. Two
-- functions with the same name and overlapping defaults will be chosen between
-- by argument count for ever, and the next person to add a caller has no way
-- to know which one they are reaching.
-- ============================================================================

drop function if exists public.platform_update_league(
  uuid, text, text, text, text, boolean, boolean);

-- ============================================================================
-- SELF-TEST — exactly one of them survives, and it is the one with the flag.
-- ============================================================================
do $test$
declare
  n int;
  args text;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'platform_update_league';

  if n = 0 then
    raise exception '0089: platform_update_league has gone entirely';
  end if;
  if n > 1 then
    raise exception '0089: % copies of platform_update_league remain — a named '
                    'call will still be ambiguous', n;
  end if;

  /* THE SURVIVOR MUST BE THE ONE THAT TAKES THE FLAG — checked by PARAMETER
     NAME, not by a rendered type list.

     The first version of this looked for the substring 'boolean, boolean,
     boolean' and refused, because pg_get_function_identity_arguments renders
     names alongside types: "p_public_live boolean, p_youth_protected boolean,
     p_auto_reports boolean". The three booleans are all there and that string
     is not, so the check failed against a function that was exactly right.

     proargnames is the fact rather than a formatting of it, and it cannot be
     broken by Postgres choosing to render a signature differently. */
  if not exists (
    select 1
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'platform_update_league'
      and 'p_auto_reports' = any (p.proargnames)
  ) then
    select pg_get_function_identity_arguments(p.oid) into args
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'platform_update_league';
    raise exception '0089: the surviving copy does not take the auto-reports '
                    'flag (%)', args;
  end if;

  raise notice '0089 ok: one platform_update_league, taking the auto-reports '
               'flag — the console can save a league again';
end $test$;
