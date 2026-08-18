-- ============================================================================
-- 0074 — RECOMPUTING A LEAGUE'S TABLE IS NOT A PUBLIC OPERATION.
--
-- Found by auditing every function the consoles call rather than by reading
-- any one of them. recompute_standings is SECURITY DEFINER, has no permission
-- check of any kind, and was never revoked from PUBLIC — which Postgres grants
-- EXECUTE to by default. Verified against the live database with nothing but
-- the anonymous key:
--
--     POST /rest/v1/rpc/recompute_standings  {"p_competition": "..."}  -> 204
--
-- Its first act is `delete from standings where competition_id = ...` before
-- rebuilding from the games. With a real competition id it reproduces the same
-- table, so this is not a way to corrupt a league — but it is an
-- unauthenticated caller deleting rows and doing the heaviest query on the
-- platform, as often as they like, and neither of those should be available to
-- somebody who has not signed in.
--
-- TWO GATES, because either alone is wrong. The grant stops anonymous callers
-- reaching it at all; the check inside stops a signed-in stranger recomputing
-- a league they have nothing to do with, which the grant cannot express.
--
-- THE SERVICE ROLE STILL NEEDS IT. finalise-game rebuilds the table at the
-- final whistle and runs with the service key, where auth.uid() is null. A
-- null uid is therefore allowed through — reachable only by a caller holding
-- the service key, since the revoke below closes every other route to it.
-- ============================================================================

create or replace function public.recompute_standings_guard(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null            -- the service role, at the final whistle
      or exists (
        select 1 from competitions c
          join seasons s on s.id = c.season_id
         where c.id = p_competition
           and s.league_id is not null
           and public.is_league_admin(s.league_id));
$$;

grant execute on function public.recompute_standings_guard(uuid) to authenticated;

do $$
declare src text; head text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_standings';
  if src is null then
    raise notice 'recompute_standings is not present — nothing to guard';
    return;
  end if;

  /* Wrap rather than rewrite: the body is a long derivation and copying it
     into this migration would fork it. The check is prepended to whatever
     ships today, so a later change to the arithmetic is not lost here. */
  head := 'begin' || chr(10) ||
    '  if not public.recompute_standings_guard(p_competition) then' || chr(10) ||
    '    raise exception ''you do not administer that competition'' using errcode = ''42501'';' || chr(10) ||
    '  end if;' || chr(10);

  if position('recompute_standings_guard' in src) = 0 then
    src := regexp_replace(src, 'as \$function\$\s*declare', 'as $function$' || chr(10) || 'declare', 'i');
    src := regexp_replace(src, '(\$function\$.*?)\mbegin\M', '\1' || head, 'is');
    execute src;
  end if;
end $$;

revoke all on function public.recompute_standings(uuid) from public, anon;
grant execute on function public.recompute_standings(uuid) to authenticated;

-- ---------------------------------------------------------------- proof -----
do $$
declare src text; failed text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recompute_standings';

  if position('recompute_standings_guard' in src) = 0 then
    failed := array_append(failed, 'recompute_standings still has no permission check');
  end if;
  if has_function_privilege('anon', 'public.recompute_standings(uuid)', 'execute') then
    failed := array_append(failed, 'anon can still execute recompute_standings');
  end if;
  if not has_function_privilege('authenticated', 'public.recompute_standings(uuid)', 'execute') then
    failed := array_append(failed, 'a signed-in administrator can no longer recompute');
  end if;

  if array_length(failed, 1) is not null then
    raise exception 'recompute_standings is wrong: %', array_to_string(failed, '; ');
  end if;
  raise notice 'recompute_standings verified: anon refused, administrators kept, service role kept';
end $$;
