-- 0197: OFFICIAL PARTNERS - a news source or a creator outlet the platform has chosen to stand behind.
--
-- The News page, HOME's feed and the outlet's own pages mark an official partner with a small gold pill, and the
-- feed's ranking (epinoia/feedrank.js) floats a partner's UNREAD story to the top for about a week. Both are
-- decided here, by the platform, and by nobody else: a league can add a source or open an outlet, but only a
-- platform administrator can call one an official partner.
--
--   news_sources.official_partner, creator_outlets.official_partner   the flag (default false)
--   official_partners()                       what every page asks, once: [{kind, slug, league?}] of the ENABLED
--                                             sources and the ACTIVE outlets that are partners. Public: it
--                                             holds no more than what a card already shows.
--   set_official_partner(kind, id, on)        a platform administrator only; audit-logged
--   official_partners_admin()                 the console's list: every source and every outlet, partner or not
--
-- An outlet's slug is only unique inside its league (creator_outlets (league_id, slug)), so an outlet's entry
-- carries its league's slug as well: the card's own key is 'outlet:<league>/<outlet>'; a source's is 'source:<slug>'.
--
-- THE TABLES STAY CLOSED (0194): row-level security on, no policy, no grant. The flag is read through the
-- functions below and nothing else.

alter table public.news_sources add column if not exists official_partner boolean not null default false;
alter table public.creator_outlets add column if not exists official_partner boolean not null default false;
comment on column public.news_sources.official_partner is
  '0197: chosen by a platform administrator (set_official_partner): the card wears the pill and the feed boosts its unread stories.';
comment on column public.creator_outlets.official_partner is
  '0197: chosen by a platform administrator (set_official_partner): the card wears the pill and the feed boosts its unread pieces.';

/* THE LIST EVERY PAGE ASKS FOR: only what is shown at all - a source that is on, an outlet that is active, and (for a
   league's own) a league the reader may see; an outlet also only where creators are shown. */
create or replace function public.official_partners()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'kind', x->>'league', x->>'slug'), '[]'::jsonb)
    from (
      select jsonb_build_object('kind', 'source', 'slug', s.slug) as x
        from news_sources s
       where s.official_partner and s.enabled
         and (s.league_id is null or public.league_visible(s.league_id))
      union all
      select jsonb_build_object('kind', 'outlet', 'slug', o.slug, 'league', l.slug)
        from creator_outlets o join leagues l on l.id = o.league_id
       where o.official_partner and o.status = 'active' and public.creators_shown(o.league_id)
    ) q;
$$;

/* CHOOSE, OR STOP CHOOSING. Returns the flag as it now stands. */
create or replace function public.set_official_partner(p_kind text, p_id uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v boolean := coalesce(p_on, false); n int;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can name an official partner' using errcode = '42501';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('source', 'outlet') then
    raise exception 'an official partner is a news source or a creator outlet' using errcode = '22023';
  end if;
  if p_kind = 'source' then
    update news_sources set official_partner = v where id = p_id;
  else
    update creator_outlets set official_partner = v, updated_at = now() where id = p_id;
  end if;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'there is no such % here', p_kind using errcode = '22023';
  end if;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_official_partner', case p_kind when 'source' then 'news_source' else 'creator_outlet' end,
          p_id::text, jsonb_build_object('on', v));
  return v;
end $$;

/* THE CONSOLE'S LIST: every source and every outlet, in every league, with the flag and whether it is showing at all
   (a source that is off, an outlet that is suspended, cannot be seen by readers, partner or not). */
create or replace function public.official_partners_admin()
returns table (kind text, id uuid, slug text, name text, league_slug text, league_name text, showing boolean, official_partner boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can see the official partners' using errcode = '42501';
  end if;
  return query
    select 'source'::text, s.id, s.slug, s.name, l.slug, l.name, s.enabled, s.official_partner
      from news_sources s left join leagues l on l.id = s.league_id
    union all
    select 'outlet'::text, o.id, o.slug, o.name, l.slug, l.name, o.status = 'active', o.official_partner
      from creator_outlets o join leagues l on l.id = o.league_id
     order by 1, 4;
end $$;

revoke all on function public.official_partners() from public, anon;
revoke all on function public.set_official_partner(text, uuid, boolean) from public, anon;
revoke all on function public.official_partners_admin() from public, anon;
grant execute on function public.official_partners() to anon, authenticated;
grant execute on function public.set_official_partner(text, uuid, boolean) to authenticated;
grant execute on function public.official_partners_admin() to authenticated;
