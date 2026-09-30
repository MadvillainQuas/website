-- ============================================================================
-- 0200: THE LANGUAGE OF A NEWS SOURCE, for the ranked feed (epinoia/feedrank.js)
--
-- The News page and HOME's "For you" put down a story in a language the reader does not read (a Spanish story to a reader
-- whose site is in English, who has never opened a Spanish site). To know that, the feed must know each publisher's
-- language. Nothing had it, so:
--
--   news_sources.language, creator_outlets.language   a lower-case ISO 639-1 code ('en', 'es', 'ja'), NULL = not said
--   news_source_languages()                           the public list: [{ kind, slug, league_slug, language }]
--
-- WHY A SMALL FUNCTION AND NOT news_feed / news_feed_mine WITH A NEW COLUMN: those two return a fixed table type; adding a
-- column means dropping and re-creating both (and their grants and dependants) to carry one short string per publisher,
-- which the page can join itself: a row already carries its source_slug (and an outlet's league_slug and outlet_slug).
-- The feed rows are unchanged, so nothing that reads them can break, and the list is small and the same for everyone (the
-- client keeps it for half a day). A league's own articles and match reports have no language here on purpose: they are
-- the site's, written in the site's language, and are never held back for it. A NULL language (a source nobody has
-- described, or a creator outlet in the league's own language) is never held back either.
--
-- Until this is applied the page uses a small map of the sources 0195 seeded (feedrank.js, SOURCE_LANG), so the feature
-- works without it; this migration is what lets an administrator's newly added source say its language.
--
-- Re-runnable.
-- ============================================================================

alter table public.news_sources add column if not exists language text;
alter table public.creator_outlets add column if not exists language text;

alter table public.news_sources drop constraint if exists news_sources_language_ck;
alter table public.news_sources add constraint news_sources_language_ck check (language is null or language ~ '^[a-z]{2,3}$');
alter table public.creator_outlets drop constraint if exists creator_outlets_language_ck;
alter table public.creator_outlets add constraint creator_outlets_language_ck check (language is null or language ~ '^[a-z]{2,3}$');

comment on column public.news_sources.language is
  '0200: the language its stories are written in (ISO 639-1, lower case). NULL: not said, and the ranked feed never holds its stories back for language.';
comment on column public.creator_outlets.language is
  '0200: the language its pieces are written in (ISO 639-1). NULL: the league''s own, and never held back for language.';

-- the sources 0195 seeded, by what each publishes in
update public.news_sources s set language = x.language
  from (values
    ('basketnews', 'en'), ('eurohoops', 'en'), ('sportando', 'en'), ('talkbasket', 'en'), ('basketnews-lt', 'lt'),
    ('eurohoops-gr', 'el'), ('gigantes', 'es'), ('solobasket', 'es'), ('pianetabasket', 'it'), ('bebasket', 'fr'),
    ('basketfaul', 'tr'), ('basket-dergisi', 'tr'), ('basketballking', 'ja'), ('basket-count', 'ja'), ('pick-and-roll', 'en'),
    ('basketball-com-au', 'en'), ('b-league', 'ja'), ('nbl-australia', 'en'), ('slb-men', 'en'), ('slb-women', 'en'),
    ('bcb', 'en'), ('2bbl', 'de'), ('basket-fi', 'fi'), ('nkl', 'lt'), ('pzkosz', 'pl'),
    ('feb-liga-femenina', 'es'), ('feb-liga-femenina-2', 'es'), ('feb-primera', 'es'), ('feb-segunda', 'es'), ('u-sports', 'en')
  ) as x (slug, language)
 where s.slug = x.slug and s.language is null;

/* THE LIST, open to every reader: only what is already public (a source that is on and a league the reader may see; an outlet
   that is active and shown), and only the ones that say a language. */
create or replace function public.news_source_languages()
returns table (kind text, slug text, league_slug text, language text)
language sql stable security definer set search_path = public as $$
  select 'source'::text, s.slug, l.slug, s.language
    from news_sources s left join leagues l on l.id = s.league_id
   where s.enabled and s.language is not null and (s.league_id is null or public.league_visible(s.league_id))
  union all
  select 'outlet'::text, o.slug, l.slug, o.language
    from creator_outlets o join leagues l on l.id = o.league_id
   where o.status = 'active' and o.language is not null and public.creators_shown(o.league_id)
  order by 1, 2;
$$;

revoke all on function public.news_source_languages() from public;
grant execute on function public.news_source_languages() to anon, authenticated;
