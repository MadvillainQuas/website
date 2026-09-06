-- ============================================================================
-- 0098 — A LEAGUE FROM A SCHEDULE URL, in one press.
--
-- register_feed_source (0097) connects a feed to a league that already
-- exists. This creates the league itself — name, slug, colours, the current
-- season, one competition, the caller as its administrator — and registers
-- every schedule URL given, so the ingest worker fills in clubs, players,
-- rosters, fixtures and scored games from the next run. Platform admins only,
-- exactly like create_league.
-- ============================================================================

create or replace function public.create_league_from_feed(
  p_name      text,
  p_code      text,                       -- feed code, e.g. 'BCB'
  p_urls      text[],                     -- schedule URLs (league page with ?WHurl=… or the Genius hosted URL)
  p_slug      text default null,
  p_client    text default null,          -- Genius client code when it differs from the feed code (BCB → 'HBBC')
  p_season    text default null,          -- '2026-27'; default = current
  p_adapter   text default 'fiba_livestats',
  p_poll      int  default 30,
  p_colour_a  text default '#93f2bf',
  p_colour_b  text default '#8ff5ff'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  lid   uuid;
  sid   uuid;
  cid   uuid;
  code  text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9_-]', '', 'g'));
  slug  text := lower(coalesce(nullif(trim(p_slug), ''), regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g')));
  sname text := coalesce(nullif(trim(p_season), ''),
                  case when extract(month from now()) >= 8
                       then extract(year from now())::int || '-' || right((extract(year from now())::int + 1)::text, 2)
                       else (extract(year from now())::int - 1) || '-' || right(extract(year from now())::int::text, 2) end);
  u     text;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin may create a league' using errcode = '42501';
  end if;
  if code = '' then raise exception 'a feed code is required' using errcode = '22023'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'at least one schedule URL is required' using errcode = '22023'; end if;
  slug := trim(both '-' from slug);
  if slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'slug must be lower-case words separated by single hyphens' using errcode = '22023'; end if;

  select id into lid from leagues where leagues.slug = create_league_from_feed.slug;
  if lid is null then
    insert into leagues (slug, name, colour_a, colour_b, public_live, youth_protected)
    values (slug, trim(p_name), p_colour_a, p_colour_b, true, false)
    returning id into lid;
    insert into memberships (user_id, role, scope_type, scope_id)
    values (auth.uid(), 'league_admin', 'league', lid) on conflict do nothing;
  end if;

  insert into seasons (league_id, name, starts_on, ends_on)
  values (lid, sname, make_date(left(sname, 4)::int, 9, 1), make_date(left(sname, 4)::int + 1, 6, 30))
  on conflict (league_id, name) do nothing;
  insert into competitions (season_id, name, kind)
  select s.id, trim(p_name), 'league' from seasons s where s.league_id = lid and s.name = sname
  on conflict (season_id, name) do nothing;
  select c.id into cid from competitions c join seasons s on s.id = c.season_id
   where s.league_id = lid and s.name = sname and c.name = trim(p_name);

  foreach u in array p_urls loop
    if u !~ '^https?://' then continue; end if;
    insert into schedule_sources (league_id, competition_id, label, adapter, schedule_url, adapter_config, poll_minutes, enabled, created_by)
    values (lid, cid, trim(p_name), p_adapter, trim(u),
            jsonb_build_object('code', code, 'client_code', coalesce(nullif(upper(p_client), ''), code), 'archive_raw', true, 'auto_create', true),
            greatest(5, coalesce(p_poll, 30)), true, auth.uid())
    on conflict (league_id, schedule_url) do update
      set competition_id = excluded.competition_id, adapter_config = excluded.adapter_config, enabled = true, last_error = null;
  end loop;

  insert into feed_competitions (code, label, adapter, league_id, updated_at)
  values (code, trim(p_name), p_adapter, lid, now())
  on conflict (code) do update set label = excluded.label, adapter = excluded.adapter, league_id = excluded.league_id, updated_at = now();

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'create_league_from_feed', 'league', lid::text, jsonb_build_object('code', code, 'urls', p_urls));
  return lid;
end $$;
grant execute on function public.create_league_from_feed(text, text, text[], text, text, text, text, int, text, text) to authenticated;
