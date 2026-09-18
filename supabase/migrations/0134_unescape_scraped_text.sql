-- ============================================================================
-- 0134 — "M&amp;S BANK ARENA" IS NOT A PLACE.
--
-- Most of the ingest's adapters read HTML, and HTML spells an ampersand "&amp;". The venue came
-- through spelt that way and was stored as if it were words, so every page that drew it drew
-- exactly that: the fixture card, the preview, the calendar feed, the match report. Nothing was
-- rendering it wrongly — the text was wrong before anything looked at it (reported 2026-09-18).
--
-- The ingest stops doing it (scripts/ingest/adapters/base.py unescapes where a page's text
-- becomes a field, so every adapter is covered and the next one is too). This repairs what is
-- already stored.
--
-- ORDER MATTERS: &amp; LAST. "&amp;#39;" is an apostrophe that was escaped twice, and undoing
-- the ampersand first would turn it into "&#39;" and leave it there. The named and numeric forms
-- come off first, then the ampersand, which is the order a browser would do it in.
--
-- Only the columns the ingest writes from a scraped page: a venue and a club's name. Nothing
-- else on the platform is typed by a scraper. Re-running this file changes nothing, because the
-- second run finds no '&' followed by one of these.
-- ============================================================================

set local lock_timeout = '5s';

create or replace function public.unescape_html(p text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v    text := p;
  prev text;
  i    int := 0;
begin
  if v is null or position('&' in v) = 0 then return v; end if;
  -- TWO PASSES, NOT ONE. "Men&amp;#39;s" is an apostrophe that was escaped twice, and one pass
  -- can only take off one layer: the apostrophe rules run before the ampersand does, so by the
  -- time "&amp;" becomes "&" the "&#39;" it just revealed has already been walked past. A second
  -- pass finishes it. Two, not "until it stops changing": text whose real content is the letters
  -- "&amp;" would otherwise be eaten, and while no venue is called that, an unbounded loop over
  -- somebody's data should have a floor under it.
  loop
    i := i + 1;
    prev := v;
    v := replace(v, '&#39;',  '''');
    v := replace(v, '&#039;', '''');
    v := replace(v, '&apos;', '''');
    v := replace(v, '&quot;', '"');
    v := replace(v, '&#34;',  '"');
    v := replace(v, '&lt;',   '<');
    v := replace(v, '&gt;',   '>');
    v := replace(v, '&nbsp;', ' ');
    v := replace(v, '&amp;',  '&');                   -- last within a pass: see above
    exit when v = prev or i >= 2;
  end loop;
  return v;
end $$;

comment on function public.unescape_html(text) is
  'The handful of HTML entities a scraped page can leave in stored text, undone. The ampersand is undone last, so text escaped twice comes out whole.';

grant execute on function public.unescape_html(text) to anon, authenticated;

update public.games
   set venue = public.unescape_html(venue)
 where venue is not null and venue <> public.unescape_html(venue);

update public.teams
   set name = public.unescape_html(name)
 where name is not null and name <> public.unescape_html(name);

update public.teams
   set short_name = public.unescape_html(short_name)
 where short_name is not null and short_name <> public.unescape_html(short_name);

-- ============================================================================
-- SELF-TEST: the function itself, including the order that matters, and that no
-- scraped column is left holding an entity. The rows it makes are rolled back.
-- ============================================================================
do $test$
declare
  n int;
begin
  if public.unescape_html('M&amp;S Bank Arena') <> 'M&S Bank Arena' then
    raise exception '0134: the ampersand was not undone';
  end if;
  if public.unescape_html('Men&#039;s National Cup') <> 'Men''s National Cup' then
    raise exception '0134: a numeric apostrophe was not undone';
  end if;
  if public.unescape_html('Men&#39;s Cup') <> 'Men''s Cup' then
    raise exception '0134: the short numeric apostrophe was not undone';
  end if;
  -- THE ORDER: escaped twice, it must come out whole rather than half way
  if public.unescape_html('Men&amp;#39;s Cup') <> 'Men''s Cup' then
    raise exception '0134: text escaped twice was left half undone (%)',
      public.unescape_html('Men&amp;#39;s Cup');
  end if;
  if public.unescape_html('R&amp;D &lt;b&gt;') <> 'R&D <b>' then
    raise exception '0134: the angle brackets were not undone';
  end if;
  -- and a name with a REAL ampersand in it is left exactly as it is
  if public.unescape_html('M&S Bank Arena') <> 'M&S Bank Arena' then
    raise exception '0134: a real ampersand was disturbed';
  end if;
  if public.unescape_html(null) is not null then
    raise exception '0134: null must stay null';
  end if;
  if public.unescape_html('Emirates Arena') <> 'Emirates Arena' then
    raise exception '0134: text with no entity in it was changed';
  end if;

  select count(*) into n from public.games
   where venue is not null and venue <> public.unescape_html(venue);
  if n <> 0 then raise exception '0134: % venue(s) still hold an entity', n; end if;
  select count(*) into n from public.teams
   where (name is not null and name <> public.unescape_html(name))
      or (short_name is not null and short_name <> public.unescape_html(short_name));
  if n <> 0 then raise exception '0134: % club name(s) still hold an entity', n; end if;

  -- and the repair actually repairs: a row put in wrong comes out right
  begin
    insert into public.games (competition_id, home_team_id, away_team_id, status, venue)
    select c.id, t1.id, t2.id, 'scheduled', 'X&amp;Y Arena'
      from public.competitions c
      cross join lateral (select id from public.teams limit 1) t1
      cross join lateral (select id from public.teams offset 1 limit 1) t2
     limit 1;
    if found then
      update public.games set venue = public.unescape_html(venue) where venue = 'X&amp;Y Arena';
      if exists (select 1 from public.games where venue = 'X&amp;Y Arena') then
        raise exception '0134: the repair left a row behind';
      end if;
      if not exists (select 1 from public.games where venue = 'X&Y Arena') then
        raise exception '0134: the repair did not write the right text';
      end if;
    end if;
    raise exception using errcode = 'P0004', message = '0134 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
end $test$;
