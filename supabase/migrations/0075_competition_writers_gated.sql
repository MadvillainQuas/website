-- ============================================================================
-- 0075 — THREE FUNCTIONS THAT REWRITE A COMPETITION, OPEN TO ANY ACCOUNT.
--
-- Found by working through the candidates the console audit listed, checking
-- each against the live database rather than trusting the pattern that raised
-- them. Six of the nine turned out to be properly gated and were flagged only
-- because their check is phrased in a way the regex could not see. Three were
-- real, and they share a file and a fault:
--
--     advance_bracket(uuid)        0018:462  granted to authenticated
--     compute_season_awards(uuid)  0018:463  granted to authenticated
--     seed_bracket(uuid,int,uuid)  0018:464  granted to authenticated
--
-- All three are SECURITY DEFINER, all three WRITE, and none of them asks who
-- is calling. 0018 revoked them from anon and public — which is why an
-- anonymous POST is refused, and why they looked safe from outside — and then
-- granted them to `authenticated`, which is every person who has ever signed
-- in to the platform, including somebody who registered a minute ago to follow
-- one club.
--
-- What that allows, today, with an ordinary account:
--
--     compute_season_awards  deletes every award row for a competition and
--                            recomputes it — for ANY competition, not theirs
--     seed_bracket           writes the bracket for any competition
--     advance_bracket        moves winners on in any competition's bracket
--
-- None of it invents results: each rebuilds from games already played. That is
-- the difference between this and a data-corruption hole, and it is not much
-- of a difference when a stranger can empty and rebuild a league's honours
-- list on demand.
--
-- The same guard as 0074, for the same reason: the grant says which ROLES may
-- call a function and cannot say which ROWS they may touch. Only a check
-- inside can do that. The service role still passes, because finalise-game
-- computes awards at the final whistle with no auth.uid().
-- ============================================================================

do $$
declare fn text; src text; head text; n int := 0;
begin
  foreach fn in array array['advance_bracket', 'compute_season_awards', 'seed_bracket'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn
     limit 1;

    if src is null then
      raise notice '% is not present — skipping', fn;
      continue;
    end if;
    if position('recompute_standings_guard' in src) > 0 then
      raise notice '% is already guarded', fn;
      continue;
    end if;

    /* Prepended to whatever ships today rather than rewritten, so a later
       change to the seeding arithmetic is not silently reverted by this file.
       They all take the competition as their first argument. */
    head := 'begin' || chr(10) ||
      '  if not public.recompute_standings_guard(p_competition) then' || chr(10) ||
      '    raise exception ''you do not administer that competition'' using errcode = ''42501'';' || chr(10) ||
      '  end if;' || chr(10);

    src := regexp_replace(src, '(\$function\$.*?)\mbegin\M', '\1' || head, 'is');
    execute src;
    n := n + 1;
  end loop;
  raise notice 'guarded % competition writers', n;
end $$;

-- ---------------------------------------------------------------- proof -----
-- Each must now refuse a caller with no standing, and must still be reachable
-- by one who has it. The bodies are read back from the catalogue rather than
-- from this file, because what ships is what pg_proc holds.
do $$
declare fn text; src text; fn_oid oid; failed text[] := '{}';
begin
  foreach fn in array array['advance_bracket', 'compute_season_awards', 'seed_bracket'] loop
    select p.oid, pg_get_functiondef(p.oid) into fn_oid, src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn limit 1;
    if src is null then continue; end if;

    if position('recompute_standings_guard' in src) = 0 then
      failed := array_append(failed, fn || ' still asks nobody who is calling');
    end if;
    /* the oid, not a name — a name would need the signature spelled out and
       seed_bracket has three arguments */
    if has_function_privilege('anon', fn_oid, 'execute') then
      failed := array_append(failed, fn || ' is callable by anon');
    end if;
    if not has_function_privilege('authenticated', fn_oid, 'execute') then
      failed := array_append(failed, fn || ' is no longer reachable by an administrator');
    end if;
  end loop;

  if array_length(failed, 1) is not null then
    raise exception 'competition writers are wrong: %', array_to_string(failed, '; ');
  end if;
  raise notice 'competition writers verified: each checks its caller, none open to anon';
end $$;
