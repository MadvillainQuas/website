-- 0270 A SEARCH OF ONE COLLEGE SYSTEM (Louie, 2026-10-16)
--
-- U SPORTS's and NCAA D2's own rails (epinoia/nav.js, a system's panel) have a search bar that "only searches across
-- U Sports/NCAA D2 teams and players". site_search (0179, 0232) has no league to narrow by, and its answer is cut to a
-- few rows a kind across the whole platform, so filtering it afterwards would lose the system's own matches.
--
-- site_search_in(q, leagues, limit, fuzzy) is site_search's teams and players for the leagues named (by slug) alone,
-- ranked and checked exactly as site_search ranks and checks them (the same helpers, the same privacy rules: a withheld
-- player is never returned, a hidden league's club never). No leagues in the answer - the system is where the reader is.
--   a club     its league is one of those named
--   a player   any roster entry of theirs is at a club of those leagues (a college player who played a summer league
--              since is still found); the line under the name is that club, the most recent such entry
-- The page falls back to site_search's own answer, cut to those leagues, on a database without this (search.js).

create or replace function public.site_search_in(p_q text, p_leagues text[], p_limit integer default 6, p_fuzzy boolean default false)
returns table (kind text, id uuid, name text, slug text, sub text, league_slug text, league_name text,
               colour text, logo text, short_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  q    text := public.site_fold(left(coalesce(p_q, ''), 60));
  lgs  text[] := coalesce(p_leagues, '{}');
  toks text[];
  musts text[];
  mre  text;
  are  text;
  ctxcap text;
  n    integer := greatest(1, least(coalesce(p_limit, 6), 12));
  noise constant text[] := array['jr','sr','jnr','snr','ii','iii','iv','junior','senior',
                                 'de','da','do','dos','das','del','della','di','van','von','der','den','la','le','el','al','bin','ibn'];
begin
  if char_length(q) < 2 or cardinality(lgs) = 0 then return; end if;
  toks := array_remove(string_to_array(q, ' '), '');
  if exists (select 1 from unnest(toks) k where k <> all (noise)) then
    toks := array(select k from unnest(toks) k where k <> all (noise));
  end if;
  are := coalesce((select '(' || string_agg(public.site_rx(x.a), '|') || ')'
                     from (select distinct case when char_length(k) < 3 then ' ' || a else a end as a
                             from unnest(toks) k cross join lateral unnest(array[k] || public.site_nicks(k)) a) x), '(?!)');

  -- the clubs of those leagues
  select ' ' || coalesce(string_agg(public.site_fold(l.name), ' '), '') into ctxcap from leagues l where l.slug = any (lgs);
  musts := public.site_musts(toks, p_fuzzy, ctxcap);
  mre := public.site_musts_re(musts);
  return query
    with c0 as (
      select t.id, t.slug, t.name, t.short_name, t.colour, t.logo_path, t.initials, t.aliases, l.slug as lslug, l.name as lname, l.id as lid,
             coalesce(t.search_hay, public.site_fold(t.name || ' ' || t.short_name || ' ' || coalesce(t.initials, '') || ' ' || array_to_string(coalesce(t.aliases, '{}'), ' '))) as hay
        from teams t join leagues l on l.id = t.league_id
       where l.slug = any (lgs))
    select 'team'::text, c.id, c.name::text, c.slug::text, null::text, c.lslug::text, c.lname::text, c.colour::text,
           c.logo_path::text, c.short_name::text
      from c0 c
      cross join lateral (select min(public.site_rank(q, toks, v, public.site_fold(c.lname), p_fuzzy)) as r
                            from unnest(array[c.name, c.short_name, c.initials] || coalesce(c.aliases, '{}')) v) m
     where (' ' || c.hay) ~ mre
       and (cardinality(musts) > 0 or (' ' || c.hay) ~ are)
       and m.r is not null and public.league_visible(c.lid)
     order by m.r, char_length(c.name), c.name, c.lname
     limit n;

  -- the players with a place at one of those clubs
  select ' ' || coalesce(string_agg(public.site_fold(t.name || ' ' || t.short_name || ' ' || l.name), ' '), '') into ctxcap
    from teams t join leagues l on l.id = t.league_id where l.slug = any (lgs);
  musts := public.site_musts(toks, p_fuzzy, ctxcap);
  mre := public.site_musts_re(musts);
  return query
    with c0 as (
      select pl.id, pl.slug, pl.first_name, pl.last_name, pl.aliases,
             coalesce(pl.search_hay, public.site_fold(pl.first_name || ' ' || pl.last_name || ' ' || array_to_string(coalesce(pl.aliases, '{}'), ' '))) as hay
        from players pl
       where not public.player_withheld(pl.is_minor, pl.public_consent)),
    c1 as (select c.* from c0 c
            where (' ' || c.hay) ~ mre
              and (cardinality(musts) > 0 or (' ' || c.hay) ~ are)),
    cand as (
      select c.id, c.slug, btrim(c.first_name || ' ' || c.last_name) as nm, m.r, cur.tname, cur.tshort, cur.colour, cur.logo, cur.lslug, cur.lname
        from c1 c
        join lateral (
          select t.name as tname, t.short_name as tshort, t.colour, t.logo_path as logo, l.slug as lslug, l.name as lname
            from roster_entries re
            join teams t   on t.id = re.team_id
            join leagues l on l.id = t.league_id
           where re.player_id = c.id and l.slug = any (lgs) and public.league_visible(l.id)
           order by re.active desc, re.created_at desc
           limit 1) cur on true
        cross join lateral (select min(public.site_rank(q, toks, v,
                                  public.site_fold(coalesce(cur.tname, '') || ' ' || coalesce(cur.tshort, '') || ' ' || coalesce(cur.lname, '')), p_fuzzy)) as r
                              from unnest(array[c.first_name || ' ' || c.last_name] || coalesce(c.aliases, '{}')) v) m
       where m.r is not null
    )
    select 'player'::text, c.id, c.nm::text, c.slug::text, c.tname::text, c.lslug::text, c.lname::text, c.colour::text, c.logo::text, c.tshort::text
      from cand c
     order by c.r, char_length(c.nm), c.nm
     limit n;
end $$;
alter function public.site_search_in(text, text[], integer, boolean) owner to postgres;
revoke all on function public.site_search_in(text, text[], integer, boolean) from public;
grant execute on function public.site_search_in(text, text[], integer, boolean) to anon, authenticated, service_role;
