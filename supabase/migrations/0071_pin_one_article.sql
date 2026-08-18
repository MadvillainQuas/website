-- ============================================================================
-- ONE PINNED ARTICLE, AND A SWITCH TO SET IT.
--
-- news_public already orders `pinned desc, published_at desc`, so the pin has
-- always worked. What was missing is everything around it.
--
-- THE PIN WAS NOT EXCLUSIVE. Nothing stopped four articles being pinned, and
-- four pinned articles are just the old order with extra steps: the newest
-- piece ends up fifth and the word "pin" stops meaning anything. A league
-- leads with ONE thing. Pinning a second now releases the first, enforced by a
-- trigger rather than by the UI, so it holds for the editor, the quick switch
-- below, the API and anything written later.
--
-- IT COULD ONLY BE SET WHILE WRITING AN ARTICLE. The only way to pin or
-- release was to open the editor, change a checkbox and save the whole piece —
-- which re-sends the title, body, cover and status to flip one boolean, and
-- silently overwrites anything a co-writer changed in the meantime. This adds
-- a function that does the one thing.
--
-- WHY NOT JUST "NEWEST WINS". Because a league needs to lead with something
-- that is not news sometimes — how to buy tickets, a venue change, a fixture
-- announcement — and a match report published that evening should not bury it.
-- The pin is that decision, made deliberately and visible as "Pinned" rather
-- than mislabelled "Latest", which is what the cards used to say.
-- ============================================================================

-- ---------------------------------------------------------------- exclusive --
create or replace function public.one_pinned_article()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.pinned then
    update news_articles
       set pinned = false
     where league_id = new.league_id
       and id <> new.id
       and pinned;
  end if;
  return new;
end; $$;

drop trigger if exists news_one_pin on public.news_articles;
create trigger news_one_pin after insert or update of pinned on public.news_articles
  for each row when (new.pinned) execute function public.one_pinned_article();

-- Release any pile-up that predates the rule, keeping the most recently
-- published of them — an arbitrary tie-break, but a stable one, and a league
-- can move it in one click now.
update public.news_articles a
   set pinned = false
 where a.pinned
   and a.id <> (select b.id from public.news_articles b
                 where b.league_id = a.league_id and b.pinned
                 order by b.published_at desc nulls last, b.id
                 limit 1);

-- ------------------------------------------------------------- the switch ---
create or replace function public.set_article_pinned(p_id uuid, p_pinned boolean)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare v_league uuid; v_title text;
begin
  select league_id, title into v_league, v_title from news_articles where id = p_id;
  if v_league is null then
    raise exception 'no such article' using errcode = 'P0002';
  end if;
  if not public.is_league_writer(v_league) then
    raise exception 'you are not a writer for that league' using errcode = '42501';
  end if;

  update news_articles set pinned = coalesce(p_pinned, false), updated_at = now()
   where id = p_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), case when p_pinned then 'pin_article' else 'unpin_article' end,
          'article', p_id::text, jsonb_build_object('title', v_title));

  return coalesce(p_pinned, false);
end; $$;

grant execute on function public.set_article_pinned(uuid, boolean) to authenticated;

comment on function public.set_article_pinned(uuid, boolean) is
  'Pin or release one article. Pinning releases whatever this league had '
  'pinned before, so the front page leads with exactly one thing. Everything '
  'else stays in publication order, newest first.';

-- ============================================================================
-- A migration that does not call what it creates has not been tested: plpgsql
-- bodies are not checked until they run, so a typo in a branch nobody takes
-- here ships and fails in front of somebody trying to pin a fixture notice.
-- ============================================================================
do $$
declare
  lg uuid; a1 uuid; a2 uuid; n int; failed text[] := '{}';
begin
  select id into lg from leagues order by created_at limit 1;
  if lg is null then
    raise notice 'no league to test against — skipping';
    return;
  end if;

  insert into news_articles (league_id, slug, title, status, published_at, pinned)
  values (lg, 'zz-pin-test-a', 'pin test a', 'published', now() - interval '2 days', false)
  returning id into a1;
  insert into news_articles (league_id, slug, title, status, published_at, pinned)
  values (lg, 'zz-pin-test-b', 'pin test b', 'published', now() - interval '1 day', false)
  returning id into a2;

  -- pinning is exclusive
  update news_articles set pinned = true where id = a1;
  update news_articles set pinned = true where id = a2;
  select count(*) into n from news_articles where league_id = lg and pinned;
  if n <> 1 then
    failed := array_append(failed, 'expected exactly one pinned article, found ' || n);
  end if;
  if not (select pinned from news_articles where id = a2) then
    failed := array_append(failed, 'the most recently pinned article is not the one held');
  end if;
  if (select pinned from news_articles where id = a1) then
    failed := array_append(failed, 'pinning a second article did not release the first');
  end if;

  -- and the pinned one leads, with everything else newest-first behind it
  if (select id from news_public(lg, 20, 0) limit 1) <> a2 then
    failed := array_append(failed, 'news_public does not lead with the pinned article');
  end if;

  -- releasing it puts the newest back on top
  update news_articles set pinned = false where id = a2;
  if (select published_at from news_public(lg, 1, 0)) <
     (select max(published_at) from news_articles
       where league_id = lg and status = 'published') then
    failed := array_append(failed, 'with nothing pinned, the newest article does not lead');
  end if;

  delete from news_articles where id in (a1, a2);

  if array_length(failed, 1) is not null then
    raise exception 'pin rules are wrong: %', array_to_string(failed, '; ');
  end if;
  raise notice 'pin rules verified: exclusive, leads the list, and releases cleanly';
end $$;
