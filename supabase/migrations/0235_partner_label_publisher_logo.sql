-- ============================================================================
-- 0235 - AN OFFICIAL PARTNER'S OWN WORDS, AND A PUBLISHER'S OWN LOGO (2026-10-06)
--
--   news_sources.partner_label, creator_outlets.partner_label   what the gold pill says for this partner ("Official
--                                       media partner", "Official data partner"); null: "Official partner", as before
--   official_partners()                 now carries {label, name} too, so every page's pill reads it
--   official_partners_admin()           now carries partner_label, logo_url and colour, for the console
--   set_partner_branding(kind, id, label, logo_url, colour)
--                                       a platform administrator only: the label (both kinds); for a news source also its
--                                       logo (a file uploaded to media-public/news/<id>/logo-...) and the colour read from it.
--                                       A null logo or colour leaves it as it is; '' clears it.
--   storage: media_public_news_logo     a platform administrator may write news/<source id>/logo-<...> into media-public
-- ============================================================================
set local lock_timeout = '5s';

alter table public.news_sources add column if not exists partner_label text;
alter table public.creator_outlets add column if not exists partner_label text;
do $$ begin
  alter table public.news_sources add constraint news_sources_partner_label_ck check (partner_label is null or char_length(btrim(partner_label)) between 1 and 32);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.creator_outlets add constraint creator_outlets_partner_label_ck check (partner_label is null or char_length(btrim(partner_label)) between 1 and 32);
exception when duplicate_object then null; end $$;

create or replace function public.official_partners()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'kind', x->>'league', x->>'slug'), '[]'::jsonb)
    from (
      select jsonb_strip_nulls(jsonb_build_object('kind', 'source', 'slug', s.slug, 'name', s.name, 'label', s.partner_label)) as x
        from news_sources s
       where s.official_partner and s.enabled
         and (s.league_id is null or public.league_visible(s.league_id))
      union all
      select jsonb_strip_nulls(jsonb_build_object('kind', 'outlet', 'slug', o.slug, 'league', l.slug, 'name', o.name, 'label', o.partner_label))
        from creator_outlets o join leagues l on l.id = o.league_id
       where o.official_partner and o.status = 'active' and public.creators_shown(o.league_id)
    ) q;
$$;

drop function if exists public.official_partners_admin();
create or replace function public.official_partners_admin()
returns table (kind text, id uuid, slug text, name text, league_slug text, league_name text, showing boolean, official_partner boolean,
               partner_label text, logo_url text, colour text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can see the official partners' using errcode = '42501';
  end if;
  return query
    select 'source'::text, s.id, s.slug, s.name, l.slug, l.name, s.enabled, s.official_partner, s.partner_label, s.logo_url, s.colour
      from news_sources s left join leagues l on l.id = s.league_id
    union all
    select 'outlet'::text, o.id, o.slug, o.name, l.slug, l.name, o.status = 'active', o.official_partner, o.partner_label, o.logo_url, o.colour
      from creator_outlets o join leagues l on l.id = o.league_id
     order by 1, 4;
end $$;

create or replace function public.set_partner_branding(p_kind text, p_id uuid, p_label text, p_logo_url text default null, p_colour text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_label text := nullif(btrim(coalesce(p_label, '')), ''); n int;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can change a partner''s label or a publisher''s logo' using errcode = '42501';
  end if;
  if p_kind not in ('source', 'outlet') or p_id is null then
    raise exception 'a news source or a creator outlet' using errcode = '22023';
  end if;
  if p_logo_url is not null and p_logo_url <> '' and p_logo_url !~* '^https://' then
    raise exception 'a logo is an https address' using errcode = '22023';
  end if;
  if p_colour is not null and p_colour <> '' and p_colour !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a colour is #rrggbb' using errcode = '22023';
  end if;
  if p_kind = 'source' then
    update news_sources set partner_label = v_label,
           logo_url = case when p_logo_url is null then logo_url else nullif(p_logo_url, '') end,
           logo_checked_at = case when p_logo_url is null then logo_checked_at else now() end,
           colour = case when p_colour is null then colour else nullif(p_colour, '') end
     where id = p_id;
  else
    update creator_outlets set partner_label = v_label, updated_at = now() where id = p_id;
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no such %', p_kind using errcode = 'P0002'; end if;
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'label', v_label);
end $$;

revoke all on function public.official_partners() from public, anon;
revoke all on function public.official_partners_admin() from public, anon;
revoke all on function public.set_partner_branding(text, uuid, text, text, text) from public, anon;
grant execute on function public.official_partners() to anon, authenticated;
grant execute on function public.official_partners_admin() to authenticated;
grant execute on function public.set_partner_branding(text, uuid, text, text, text) to authenticated;

/* A PUBLISHER'S LOGO, uploaded by a platform administrator straight into the public bucket: news/<source id>/logo-<...> */
drop policy if exists media_public_news_logo on storage.objects;
create policy media_public_news_logo on storage.objects for insert to authenticated
  with check (bucket_id = 'media-public' and name ~ '^news/[0-9a-fA-F-]{36}/logo-[^/]+$' and public.is_platform_admin());

notify pgrst, 'reload schema';
