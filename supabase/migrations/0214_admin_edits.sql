-- ============================================================================
-- 0214: EDITING A CLUB, A PLAYER OR AN ARENA FROM ITS OWN PAGE (docs/suggestions.md, "Editing directly").
--
-- A fan SUGGESTS a correction (0199) and a moderator decides it. Whoever already has the right to change a detail
-- now changes it in place, from the page, through one function per subject. Each function asks who is calling,
-- takes only the columns it lists, checks every value the way 0199 checks a suggestion, writes the change and one
-- audit_log row (who, when, before and after), and hands back the row as it now is.
--
--   admin_edit_rights(type, id)         may this caller edit it, as whom, and does a picture go live at once
--   admin_edit_team(team, patch)        name, short_name, initials, colour, colour_2, logo_media
--   admin_edit_player(player, patch)    first_name, last_name, height_cm, weight_kg, wingspan_cm, previous_club,
--                                       position (on the active squad entries the caller manages), photo_media
--   admin_edit_venue(venue, patch)      name, address, city, pin ("lat,lng")
--
-- WHO MAY EDIT WHAT. No right is new; each is the one the tables and the image queue already grant:
--   a club     the platform's administrators, its league's, and the club's own managers (is_team_manager: the same
--              test as teams_write and publish_team_logo). A crest goes live at once for all three, as it does in
--              the club portal.
--   a player   the platform's administrators, and the administrators and managers of a club he is actively on (the
--              test may_manage_media and players_write make). His PHOTOGRAPH goes live at once only for the
--              platform's and the league's administrators (approve_media's own test); a club manager's waits in
--              the league's Photographs queue, as every club upload does. Not this function's business: it only
--              publishes, and refuses a club manager's picture.
--   an arena   the platform's administrators, and the administrators of the league it belongs to (suggestion_owner:
--              the league of the club whose home it is, else of its latest game) - the people who accept a
--              suggestion about it. A club's manager still suggests.
--
-- A PICTURE arrives the way every other one does (upload.js): the browser writes the file through the storage API
-- under the existing policies (a crest straight into media-public, media_public_write; an administrator's
-- photograph likewise, may_approve_media) and records a pending media row (media_insert). The patch names that
-- row; the function checks it is this caller's, of this subject, of the right kind, and publishes it with the
-- existing publish_team_logo / approve_media. No storage policy is added or widened, and no table policy changes.
--
-- Everything is a security definer function with search_path = public; the tables' row-level security is untouched.
-- Not editable here: a player's date or year of birth, whether he is under 18, and his consents (the league's
-- console keeps those), a club's league, slug and feed ids.
-- ============================================================================

/* ------------------------------------------------------------------------------------------------ who --- */
/* 'platform', 'league' or 'club' when the caller may edit the subject; null when not. Internal. */
create or replace function public.admin_edit_role(p_type text, p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare lg uuid; own record;
begin
  if auth.uid() is null or p_id is null then return null; end if;
  if p_type = 'team' then
    select league_id into lg from teams where id = p_id;
    if not found then return null; end if;
    if public.is_platform_admin() then return 'platform'; end if;
    if lg is not null and public.is_league_admin(lg) then return 'league'; end if;
    if public.is_team_manager(p_id) then return 'club'; end if;
  elsif p_type = 'player' then
    if not exists (select 1 from players where id = p_id) then return null; end if;
    if public.is_platform_admin() then return 'platform'; end if;
    if exists (select 1 from roster_entries re join teams t on t.id = re.team_id
                where re.player_id = p_id and re.active and t.league_id is not null and public.is_league_admin(t.league_id)) then
      return 'league';
    end if;
    if exists (select 1 from roster_entries re where re.player_id = p_id and re.active and public.is_team_manager(re.team_id)) then
      return 'club';
    end if;
  elsif p_type = 'venue' then
    if not exists (select 1 from venues where id = p_id) then return null; end if;
    if public.is_platform_admin() then return 'platform'; end if;
    select * into own from public.suggestion_owner('venue', p_id);
    if own.league_id is not null and public.is_league_admin(own.league_id) then return 'league'; end if;
  end if;
  return null;
end $$;

/* what the page needs before it offers Edit: { edit, role, photo: 'direct' | 'review' | null } */
create or replace function public.admin_edit_rights(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.admin_edit_role(p_type, p_id);
begin
  if r is null then return jsonb_build_object('edit', false); end if;
  return jsonb_build_object('edit', true, 'role', r,
    'photo', case when p_type = 'team' then 'direct'
                  when p_type = 'player' then case when r = 'club' then 'review' else 'direct' end end);
end $$;

/* a text the way a person types it: spaces folded, ends trimmed; null stays null */
create or replace function public.admin_edit_text(p_value text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(p_value, '\s+', ' ', 'g'));
$$;

/* THE PICTURE A PATCH NAMES: a pending media row this caller recorded, of this subject and this kind, at a path
   upload.js writes (<type>/<id>/<kind>-<stamp>.<ext>), whose file is in the public bucket. A server where this role
   may not read the storage schema leaves the file to the storage policies, which let only the same people write it. */
create or replace function public.admin_edit_media(p_media uuid, p_type text, p_id uuid, p_kind text)
returns text language plpgsql stable security definer set search_path = public as $$
declare m record;
begin
  select * into m from media where id = p_media;
  if not found or m.owner_type <> p_type or m.owner_id <> p_id or m.kind <> p_kind or m.status <> 'pending'
     or m.uploaded_by is distinct from auth.uid()
     or m.storage_path !~ ('^' || p_type || '/' || p_id::text || '/' || p_kind || '-[a-z0-9]{4,40}\.(webp|png|jpg' ||
                           case when p_kind = 'logo' then '|svg' else '' end || ')$') then
    return null;
  end if;
  begin
    if not exists (select 1 from storage.objects o where o.bucket_id = 'media-public' and o.name = m.storage_path) then
      return null;
    end if;
  exception when insufficient_privilege or undefined_table then
    null;
  end;
  return m.storage_path;
end $$;

/* --------------------------------------------------------------------------------------------- a club --- */
create or replace function public.admin_edit_team(p_team uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r text; t record; k text; changed text[] := '{}';
  v_name text; v_short text; v_ini text; v_c1 text; v_c2 text; v_logo uuid; v_path text; pub jsonb;
  b jsonb := '{}'; a jsonb := '{}'; out jsonb;
begin
  if me is null then raise exception 'sign in to edit' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'patch'); end if;
  select * into t from teams where id = p_team for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  r := public.admin_edit_role('team', p_team);
  if r is null then raise exception 'you cannot edit this club' using errcode = '42501'; end if;

  /* only the columns this edits; anything else refuses the whole patch */
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name', 'short_name', 'initials', 'colour', 'colour_2', 'logo_media') then
      return jsonb_build_object('ok', false, 'reason', 'field', 'field', k);
    end if;
  end loop;

  /* every value checked before anything is written */
  if p_patch ? 'name' then
    v_name := public.admin_edit_text(p_patch->>'name');
    if v_name is null or char_length(v_name) not between 2 and 80 or v_name ~ '[<>]' then
      return jsonb_build_object('ok', false, 'reason', 'value', 'field', 'name');
    end if;
    if v_name is distinct from t.name then changed := changed || 'name'::text; end if;
  end if;
  if p_patch ? 'short_name' then
    v_short := coalesce(public.admin_edit_text(p_patch->>'short_name'), '');
    if char_length(v_short) > 40 or v_short ~ '[<>]' then
      return jsonb_build_object('ok', false, 'reason', 'value', 'field', 'short_name');
    end if;
    if v_short is distinct from t.short_name then changed := changed || 'short_name'::text; end if;
  end if;
  if p_patch ? 'initials' then
    v_ini := nullif(upper(regexp_replace(coalesce(p_patch->>'initials', ''), '[^A-Za-z0-9]', '', 'g')), '');
    if v_ini is not null and v_ini !~ '^[A-Z0-9]{2,4}$' then
      return jsonb_build_object('ok', false, 'reason', 'value', 'field', 'initials');
    end if;
    if v_ini is distinct from t.initials then changed := changed || 'initials'::text; end if;
  end if;
  if p_patch ? 'colour' then
    v_c1 := lower(btrim(coalesce(p_patch->>'colour', '')));
    if v_c1 !~ '^#[0-9a-f]{6}$' then return jsonb_build_object('ok', false, 'reason', 'value', 'field', 'colour'); end if;
    if v_c1 is distinct from lower(t.colour) then changed := changed || 'colour'::text; end if;
  end if;
  if p_patch ? 'colour_2' then
    v_c2 := nullif(lower(btrim(coalesce(p_patch->>'colour_2', ''))), '');
    if v_c2 is not null and v_c2 !~ '^#[0-9a-f]{6}$' then
      return jsonb_build_object('ok', false, 'reason', 'value', 'field', 'colour_2');
    end if;
    if v_c2 is distinct from lower(t.colour_2) then changed := changed || 'colour_2'::text; end if;
  end if;
  if p_patch ? 'logo_media' then
    begin v_logo := (p_patch->>'logo_media')::uuid; exception when others then v_logo := null; end;
    v_path := case when v_logo is null then null else public.admin_edit_media(v_logo, 'team', p_team, 'logo') end;
    if v_path is null then return jsonb_build_object('ok', false, 'reason', 'media', 'field', 'logo_media'); end if;
    changed := changed || 'logo_path'::text;
  end if;
  if cardinality(changed) = 0 then
    return jsonb_build_object('ok', true, 'changed', '[]'::jsonb, 'team', (select to_jsonb(x) from (
      select id, slug, name, short_name, initials, colour, colour_2, colour_source, logo_path from teams where id = p_team) x));
  end if;

  begin
    if 'name' = any (changed) then
      /* the old name stays an alias, so a feed that still spells it the old way finds the club (0096, 0149) */
      update teams set name = v_name,
                       aliases = case when t.name = any (coalesce(aliases, '{}')) then aliases else array_append(coalesce(aliases, '{}'), t.name) end
       where id = p_team;
    end if;
    if 'short_name' = any (changed) then update teams set short_name = v_short where id = p_team; end if;
    if 'initials' = any (changed) then update teams set initials = v_ini where id = p_team; end if;
    if 'colour' = any (changed) then update teams set colour = v_c1, colour_source = 'manual' where id = p_team; end if;
    if 'colour_2' = any (changed) then update teams set colour_2 = v_c2, colour_source = 'manual' where id = p_team; end if;
    if v_path is not null then
      /* the club portal's own door: it removes the old crest's row and names its file for the caller to delete */
      pub := public.publish_team_logo(v_logo);
    end if;
  exception when unique_violation then
    /* a chosen code is unique within the league (0129): nothing above is kept */
    return jsonb_build_object('ok', false, 'reason', 'taken', 'field', 'initials');
  end;

  for k in select unnest(changed) loop
    b := b || jsonb_build_object(k, to_jsonb(t) -> k);
  end loop;
  select to_jsonb(x) into out from (
    select id, slug, name, short_name, initials, colour, colour_2, colour_source, logo_path from teams where id = p_team) x;
  for k in select unnest(changed) loop
    a := a || jsonb_build_object(k, out -> k);
  end loop;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (me, 'admin_edit', 'team', p_team::text, jsonb_build_object('as', r, 'before', b, 'after', a));
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed), 'team', out,
                            'orphans', coalesce(pub -> 'orphans', '[]'::jsonb));
end $$;

/* ------------------------------------------------------------------------------------------- a player --- */
create or replace function public.admin_edit_player(p_player uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r text; p record; k text; f text; v text; changed text[] := '{}'; cur_pos text;
  vals jsonb := '{}'; v_photo uuid; v_path text; old_path text; new_path text;
  b jsonb := '{}'; a jsonb := '{}'; out jsonb;
begin
  if me is null then raise exception 'sign in to edit' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'patch'); end if;
  select * into p from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  r := public.admin_edit_role('player', p_player);
  if r is null then raise exception 'you cannot edit this player' using errcode = '42501'; end if;

  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('first_name', 'last_name', 'height_cm', 'weight_kg', 'wingspan_cm', 'previous_club', 'position', 'photo_media') then
      return jsonb_build_object('ok', false, 'reason', 'field', 'field', k);
    end if;
  end loop;

  /* his position is on his squad entry: the latest active one the caller manages */
  select re.position into cur_pos from roster_entries re
   where re.player_id = p_player and re.active and public.is_team_manager(re.team_id)
   order by re.created_at desc limit 1;

  /* each value in its one form, by 0199's own rules (suggestion_value); a measure, a previous club or a position
     may also be cleared, and a last name left empty (a player known by one name) */
  foreach f in array array['first_name', 'last_name', 'height_cm', 'weight_kg', 'wingspan_cm', 'previous_club', 'position'] loop
    continue when not p_patch ? f;
    v := nullif(public.admin_edit_text(p_patch->>f), '');
    if v is null then
      if f = 'first_name' then return jsonb_build_object('ok', false, 'reason', 'value', 'field', f); end if;
      v := case when f = 'last_name' then '' end;
    else
      v := public.suggestion_value(f, v);
      if v is null then return jsonb_build_object('ok', false, 'reason', 'value', 'field', f); end if;
    end if;
    if f = 'position' then
      if not exists (select 1 from roster_entries re where re.player_id = p_player and re.active and public.is_team_manager(re.team_id)) then
        return jsonb_build_object('ok', false, 'reason', 'no_entry', 'field', f);
      end if;
      if v is distinct from cur_pos then changed := changed || f; vals := vals || jsonb_build_object(f, v); end if;
    elsif v is distinct from (to_jsonb(p) ->> f) then
      changed := changed || f; vals := vals || jsonb_build_object(f, v);
    end if;
  end loop;
  if p_patch ? 'photo_media' then
    if r = 'club' then return jsonb_build_object('ok', false, 'reason', 'photo_review', 'field', 'photo_media'); end if;
    begin v_photo := (p_patch->>'photo_media')::uuid; exception when others then v_photo := null; end;
    v_path := case when v_photo is null then null else public.admin_edit_media(v_photo, 'player', p_player, 'photo') end;
    if v_path is null then return jsonb_build_object('ok', false, 'reason', 'media', 'field', 'photo_media'); end if;
    changed := changed || 'photo'::text;
  end if;
  if cardinality(changed) = 0 then
    return jsonb_build_object('ok', true, 'changed', '[]'::jsonb);
  end if;

  if 'first_name' = any (changed) or 'last_name' = any (changed) then
    /* the old name stays an alias, for a feed that still spells it the old way (0096) */
    update players set aliases = case when btrim(p.first_name || ' ' || p.last_name) = any (coalesce(aliases, '{}')) then aliases
                                      else array_append(coalesce(aliases, '{}'), btrim(p.first_name || ' ' || p.last_name)) end
     where id = p_player;
  end if;
  if 'first_name' = any (changed) then update players set first_name = vals->>'first_name' where id = p_player; end if;
  if 'last_name' = any (changed) then update players set last_name = vals->>'last_name' where id = p_player; end if;
  if 'height_cm' = any (changed) then update players set height_cm = (vals->>'height_cm')::int where id = p_player; end if;
  if 'weight_kg' = any (changed) then update players set weight_kg = (vals->>'weight_kg')::int where id = p_player; end if;
  if 'wingspan_cm' = any (changed) then update players set wingspan_cm = (vals->>'wingspan_cm')::int where id = p_player; end if;
  if 'previous_club' = any (changed) then update players set previous_club = vals->>'previous_club' where id = p_player; end if;
  if 'position' = any (changed) then
    update roster_entries set position = vals->>'position'
     where player_id = p_player and active and public.is_team_manager(team_id);
  end if;
  if v_path is not null then
    select m.storage_path into old_path from media m where m.id = p.photo_media_id;
    /* the league's own door, with its consent check for a player under 18 */
    perform public.approve_media(v_photo);
    new_path := v_path;
  end if;

  for k in select unnest(changed) loop
    b := b || jsonb_build_object(k, case k when 'position' then to_jsonb(cur_pos) when 'photo' then to_jsonb(old_path) else to_jsonb(p) -> k end);
  end loop;
  select to_jsonb(x) into out from (
    select pl.id, pl.slug, pl.first_name, pl.last_name, pl.height_cm, pl.weight_kg, pl.wingspan_cm, pl.previous_club,
           (select re.position from roster_entries re where re.player_id = pl.id and re.active
             order by re.created_at desc limit 1) as position,
           (select m.storage_path from media m where m.id = pl.photo_media_id and m.status = 'approved') as photo_path
      from players pl where pl.id = p_player) x;
  for k in select unnest(changed) loop
    a := a || jsonb_build_object(k, case k when 'position' then vals -> 'position' when 'photo' then to_jsonb(new_path) else out -> k end);
  end loop;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (me, 'admin_edit', 'player', p_player::text, jsonb_build_object('as', r, 'before', b, 'after', a));
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed), 'player', out);
end $$;

/* --------------------------------------------------------------------------------------------- an arena --- */
create or replace function public.admin_edit_venue(p_venue uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); r text; vn record; k text; v text; changed text[] := '{}'; vals jsonb := '{}';
  la numeric; lo numeric; b jsonb := '{}'; a jsonb := '{}'; out jsonb;
begin
  if me is null then raise exception 'sign in to edit' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'patch'); end if;
  select * into vn from venues where id = p_venue for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  r := public.admin_edit_role('venue', p_venue);
  if r is null then raise exception 'you cannot edit this arena' using errcode = '42501'; end if;

  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name', 'address', 'city', 'pin') then return jsonb_build_object('ok', false, 'reason', 'field', 'field', k); end if;
  end loop;
  foreach k in array array['name', 'address', 'city'] loop
    continue when not p_patch ? k;
    v := nullif(public.admin_edit_text(p_patch->>k), '');
    if v is null and k = 'name' then return jsonb_build_object('ok', false, 'reason', 'value', 'field', k); end if;
    if v is not null then
      v := public.suggestion_value('venue_' || k, v);
      if v is null then return jsonb_build_object('ok', false, 'reason', 'value', 'field', k); end if;
    end if;
    if v is distinct from (to_jsonb(vn) ->> k) then changed := changed || k; vals := vals || jsonb_build_object(k, v); end if;
  end loop;
  if p_patch ? 'pin' then
    v := public.suggestion_value('venue_pin', p_patch->>'pin');
    if v is null then return jsonb_build_object('ok', false, 'reason', 'value', 'field', 'pin'); end if;
    la := split_part(v, ',', 1)::numeric; lo := split_part(v, ',', 2)::numeric;
    if vn.lat is null or round(vn.lat::numeric, 6) <> la or round(vn.lng::numeric, 6) <> lo then changed := changed || 'pin'::text; end if;
  end if;
  if cardinality(changed) = 0 then return jsonb_build_object('ok', true, 'changed', '[]'::jsonb); end if;

  if 'name' = any (changed) then
    update venues set name = vals->>'name' where id = p_venue;
    /* a club linked to this arena that shows its own typed copy of the name shows the correction too (as 0199) */
    update teams set home_venue = vals->>'name' where home_venue_id = p_venue and home_venue is not null;
  end if;
  if 'address' = any (changed) then
    update venues set address = vals->>'address' where id = p_venue;
    update teams set home_venue_address = vals->>'address' where home_venue_id = p_venue and home_venue_address is not null;
  end if;
  if 'city' = any (changed) then update venues set city = vals->>'city' where id = p_venue; end if;
  if 'pin' = any (changed) then
    update venues set lat = la, lng = lo, pin_source = 'manual', pinned_at = now(), checked_by = me, checked_at = now()
     where id = p_venue;
  end if;

  select to_jsonb(x) into out from (select id, name, address, city, lat, lng from venues where id = p_venue) x;
  for k in select unnest(changed) loop
    if k = 'pin' then
      b := b || jsonb_build_object('pin', case when vn.lat is null then null else round(vn.lat::numeric, 6) || ',' || round(vn.lng::numeric, 6) end);
      a := a || jsonb_build_object('pin', la || ',' || lo);
    else
      b := b || jsonb_build_object(k, to_jsonb(vn) -> k);
      a := a || jsonb_build_object(k, out -> k);
    end if;
  end loop;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (me, 'admin_edit', 'venue', p_venue::text, jsonb_build_object('as', r, 'before', b, 'after', a));
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed), 'venue', out);
end $$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.admin_edit_role(text, uuid) from public, anon, authenticated;
revoke all on function public.admin_edit_media(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_edit_text(text) from public, anon;
revoke all on function public.admin_edit_rights(text, uuid) from public, anon;
revoke all on function public.admin_edit_team(uuid, jsonb) from public, anon;
revoke all on function public.admin_edit_player(uuid, jsonb) from public, anon;
revoke all on function public.admin_edit_venue(uuid, jsonb) from public, anon;
grant execute on function public.admin_edit_text(text) to authenticated;
grant execute on function public.admin_edit_rights(text, uuid) to authenticated;
grant execute on function public.admin_edit_team(uuid, jsonb) to authenticated;
grant execute on function public.admin_edit_player(uuid, jsonb) to authenticated;
grant execute on function public.admin_edit_venue(uuid, jsonb) to authenticated;

comment on function public.admin_edit_team(uuid, jsonb) is
  '0214: a club''s name, short name, initials, colours and crest, changed from its page by whoever manages it (is_team_manager). Audited.';
comment on function public.admin_edit_player(uuid, jsonb) is
  '0214: a player''s name, measures, previous club, position and photograph, changed from his page by whoever manages a club he is on. Audited.';
comment on function public.admin_edit_venue(uuid, jsonb) is
  '0214: an arena''s name, address, city and pin, changed from a club''s page by its league''s administrators or the platform''s. Audited.';

-- --------------------------------------------------------------------------------------- self-test ---
/* nothing about the live data: only that a signed-out caller can reach none of it */
do $$
begin
  if has_function_privilege('anon', 'public.admin_edit_team(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.admin_edit_player(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.admin_edit_venue(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.admin_edit_rights(text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_edit_role(text, uuid)', 'execute') then
    raise exception 'ASSERT 0214: a signed-out visitor can reach an edit, or a signed-in one the internal role check';
  end if;
  if public.admin_edit_role('team', gen_random_uuid()) is not null then
    raise exception 'ASSERT 0214: nobody signed in, yet a role came back';
  end if;
  raise notice '0214: page edits are for those who manage the subject, and nobody else';
end $$;
