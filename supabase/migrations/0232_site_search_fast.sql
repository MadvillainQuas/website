-- ============================================================================
-- 0232 - SEARCH THAT ANSWERS IN TIME (2026-10-04).
--
-- The rail's search (site_search, 0179) took two to three seconds for a common name ("james", "mike james", any search of
-- several words) - past the three the database allows a browser's request, so it was cut off with HTTP 500 and the page said
-- "Search is not available just now" (found on the live site: james, mike james, o'brien, a b c d e f). Two causes, both here:
--
--   1. IT FOLDED EVERY NAME ON EVERY CALL. Accents off, lower case, dots and apostrophes dropped, for each of 10,286 players and
--      1,014 clubs, every keystroke: about a second before a row was ranked. The folded name is now KEPT with the row
--      (players.search_hay, teams.search_hay) and a trigger keeps it up to date whenever a name changes.
--   2. ITS "EVERY WORD TYPED MUST BE IN THE NAME" TEST WAS A SUB-QUERY PER NAME PER WORD, each starting a set-returning function:
--      the cost grew with the words typed (a b c d e f: 13 s although no name matched). It is now one regular expression a name,
--      built once a call (site_musts_re): a lookahead for each word, in any order, with its alternatives. A word of one or two
--      letters can only be an initial or the start of a word in site_rank, so it is looked for at a word's start here too.
--
-- The same function, the same answers: supabase/tests/site-search-fast.test.mjs loads 0179, takes its answers to a battery of searches,
-- applies this, and compares them one by one. The columns are the search's own: players has no table-wide SELECT (0171) and nothing
-- here is granted to the browser; the search is security definer.
-- ============================================================================

-- SECRET-COLUMN: search_hay
alter table public.players add column if not exists search_hay text;
alter table public.teams   add column if not exists search_hay text;
comment on column public.players.search_hay is 'The folded first name, last name and other spellings (site_fold), kept by players_search_hay; the search reads it. Not for the browser.';
comment on column public.teams.search_hay   is 'The folded names of the club (site_fold), kept by teams_search_hay; the search reads it. Not for the browser.';

-- the triggers run for whoever edits a name, who may not call site_fold (the helpers are the search's own): so as their owner
create or replace function public.players_search_hay() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.search_hay := public.site_fold(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '') || ' ' || array_to_string(coalesce(new.aliases, '{}'), ' '));
  return new;
end $$;
create or replace function public.teams_search_hay() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.search_hay := public.site_fold(coalesce(new.name, '') || ' ' || coalesce(new.short_name, '') || ' ' || coalesce(new.initials, '') || ' ' || array_to_string(coalesce(new.aliases, '{}'), ' '));
  return new;
end $$;
alter function public.players_search_hay() owner to postgres;
alter function public.teams_search_hay() owner to postgres;
revoke all on function public.players_search_hay() from public, anon, authenticated;
revoke all on function public.teams_search_hay() from public, anon, authenticated;

drop trigger if exists players_search_hay on public.players;
create trigger players_search_hay before insert or update of first_name, last_name, aliases on public.players
  for each row execute function public.players_search_hay();
drop trigger if exists teams_search_hay on public.teams;
create trigger teams_search_hay before insert or update of name, short_name, initials, aliases on public.teams
  for each row execute function public.teams_search_hay();

-- every name as it is now (one pass; a row still empty is folded on the fly by the search)
update public.teams   t  set search_hay = public.site_fold(coalesce(t.name, '') || ' ' || coalesce(t.short_name, '') || ' ' || coalesce(t.initials, '') || ' ' || array_to_string(coalesce(t.aliases, '{}'), ' '));
update public.players pl set search_hay = public.site_fold(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '') || ' ' || array_to_string(coalesce(pl.aliases, '{}'), ' '));

-- the pre-filter's two helpers
create or replace function public.site_musts(toks text[], fuzzy boolean, ctxcap text)
returns text[] language plpgsql immutable parallel safe set search_path = public as $$
declare k text; alts text[]; out text[] := '{}'; g integer;
begin
  foreach k in array toks loop
    if position(' ' || k in coalesce(ctxcap, '')) > 0 then continue; end if;
    alts := array[k] || public.site_nicks(k);
    if fuzzy and char_length(k) >= 4 then
      g := case when char_length(k) >= 6 then 3 else 2 end;
      alts := alts || left(k, g) || right(k, g);
    end if;
    -- one or two letters: an initial, or the start of a word (site_rank matches nothing shorter anywhere in a name); the rows
    -- are tested as ' ' || name, so the leading space says so
    if char_length(k) < 3 then alts := array(select ' ' || a from unnest(alts) a); end if;
    out := out || array_to_string(alts, '|');
  end loop;
  return out;
end $$;
alter function public.site_musts(text[], boolean, text) owner to postgres;

/* text taken literally in a regular expression: each regex character in it, escaped */
create or replace function public.site_rx(t text)
returns text language sql immutable parallel safe set search_path = public as $$
  select regexp_replace(t, '([.^$*+?(){}|\[\]\\])', '\\\1', 'g')
$$;
alter function public.site_rx(text) owner to postgres;
revoke all on function public.site_rx(text) from public, anon, authenticated;
grant execute on function public.site_rx(text) to service_role;

/* the musts as ONE regular expression, '^(?=.*(alt|alt))(?=.*(alt))': a lookahead for each typed word, in any order, each with its
   alternatives, everything typed taken literally */
create or replace function public.site_musts_re(m text[])
returns text language plpgsql immutable parallel safe set search_path = public as $$
declare ms text; a text; alts text[]; out text := '^';
begin
  foreach ms in array coalesce(m, '{}') loop
    alts := '{}';
    foreach a in array string_to_array(ms, '|') loop
      alts := alts || public.site_rx(a);
    end loop;
    out := out || '(?=.*(' || array_to_string(alts, '|') || '))';
  end loop;
  return out;
end $$;
alter function public.site_musts_re(text[]) owner to postgres;
revoke all on function public.site_musts_re(text[]) from public, anon, authenticated;
grant execute on function public.site_musts_re(text[]) to service_role;

-- the search itself: 0179's, reading the kept names and testing them with the regex
create or replace function public.site_search(p_q text, p_limit integer default 6, p_fuzzy boolean default false)
returns table (kind text, id uuid, name text, slug text, sub text, league_slug text, league_name text,
               colour text, logo text, short_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  q    text := public.site_fold(left(coalesce(p_q, ''), 60));
  toks text[];
  alts text[];
  musts text[];
  mre  text;
  are  text;
  ctxcap text;
  n    integer := greatest(1, least(coalesce(p_limit, 6), 12));
  noise constant text[] := array['jr','sr','jnr','snr','ii','iii','iv','junior','senior',
                                 'de','da','do','dos','das','del','della','di','van','von','der','den','la','le','el','al','bin','ibn'];
begin
  if char_length(q) < 2 then return; end if;
  toks := array_remove(string_to_array(q, ' '), '');
  -- a suffix or a particle is dropped when other words were typed
  if exists (select 1 from unnest(toks) k where k <> all (noise)) then
    toks := array(select k from unnest(toks) k where k <> all (noise));
  end if;
  -- what a row must contain to be worth ranking: every typed word no club could account for (or a nickname of it,
  -- or - forgiving mistakes - the two or three letters at its ends), and at least one typed word in any case
  alts := array(select distinct a from (select unnest(toks) union all select unnest(public.site_nicks(k)) from unnest(toks) k) x(a));
  are := coalesce((select '(' || string_agg(public.site_rx(x.a), '|') || ')'
                     from (select distinct case when char_length(k) < 3 then ' ' || a else a end as a
                             from unnest(toks) k cross join lateral unnest(array[k] || public.site_nicks(k)) a) x), '(?!)');

  -- the leagues (sub: the country code, which the page names in the reader's language)
  return query
    select 'league'::text, l.id, l.name::text, l.slug::text, l.country::text, l.slug::text, l.name::text, l.colour_a::text,
           l.logo_path::text, l.initials::text
      from leagues l
      cross join lateral (select min(public.site_rank(q, toks, v, '', p_fuzzy)) as r
                            from unnest(array[l.name, l.initials, l.slug]) v) m
     where m.r is not null and public.league_visible(l.id)
     order by m.r, char_length(l.name), l.name
     limit least(n, 4);

  -- the clubs (sub: none; the league is the line under the name, and its words count: "newcastle women")
  select ' ' || coalesce(string_agg(public.site_fold(l.name), ' '), '') into ctxcap from leagues l;
  musts := public.site_musts(toks, p_fuzzy, ctxcap);
  mre := public.site_musts_re(musts);
  return query
    with c0 as (
      select t.id, t.slug, t.name, t.short_name, t.colour, t.logo_path, t.initials, t.aliases, l.slug as lslug, l.name as lname, l.id as lid,
             coalesce(t.search_hay, public.site_fold(t.name || ' ' || t.short_name || ' ' || coalesce(t.initials, '') || ' ' || array_to_string(coalesce(t.aliases, '{}'), ' '))) as hay
        from teams t join leagues l on l.id = t.league_id)
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

  -- the players (sub: the club he is on now, whose words count: "cole newcastle")
  select ' ' || coalesce(string_agg(public.site_fold(t.name || ' ' || t.short_name || ' ' || l.name), ' '), '') into ctxcap
    from teams t join leagues l on l.id = t.league_id;
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
        left join lateral (
          select t.name as tname, t.short_name as tshort, t.colour, t.logo_path as logo, l.slug as lslug, l.name as lname,
                 public.league_visible(l.id) as ok
            from roster_entries re
            join teams t   on t.id = re.team_id
            join leagues l on l.id = t.league_id
           where re.player_id = c.id
           order by re.active desc, re.created_at desc
           limit 1) cur on true
        cross join lateral (select min(public.site_rank(q, toks, v,
                                  public.site_fold(coalesce(cur.tname, '') || ' ' || coalesce(cur.tshort, '') || ' ' || coalesce(cur.lname, '')), p_fuzzy)) as r
                              from unnest(array[c.first_name || ' ' || c.last_name] || coalesce(c.aliases, '{}')) v) m
       where m.r is not null and cur.ok is not false        -- no club at all is a free agent; a club in a hidden league is not shown
    )
    select 'player'::text, c.id, c.nm::text, c.slug::text, c.tname::text, c.lslug::text, c.lname::text, c.colour::text, c.logo::text, c.tshort::text
      from cand c
     order by c.r, char_length(c.nm), c.nm
     limit n;
end $$;

alter function public.site_search(text, integer, boolean) owner to postgres;
revoke all on function public.site_search(text, integer, boolean) from public;
grant execute on function public.site_search(text, integer, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
