-- ============================================================================
-- 0164 - THE ARENA EDITOR (EPINOIA GO, docs/epinoia-go.md step 1.5).
--
-- The platform console's Arenas tab reads and writes `venues` directly: 0162 already lets a platform
-- administrator write them, so moving a pin, confirming one or flagging one needs nothing new. Two
-- things a browser should not do in pieces are added here:
--
--   merge_venues(keep, other)  one arena under two rows - a feed's short form and another league's
--                              full name ("トヨタA" and "TOYOTA ARENA TOKYO"): every spelling, game and
--                              club of `other` moves to `keep`, then `other` goes. One transaction, one
--                              line in the audit log.
--   venues_by_hand             a trigger: a pin changed by a signed-in person goes in the audit log, and
--                              "checked by" is always the person who checked it, whatever the browser sent.
--                              The pinning script (the service role, no person) is not logged here: its
--                              own output is its record.
-- ============================================================================

create or replace function public.merge_venues(p_keep uuid, p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k venues;
  o venues;
  n_sp int; n_g int; n_t int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different arenas are needed' using errcode = '22023';
  end if;
  -- both rows locked, in one order, so two merges of the same pair cannot cross each other
  perform 1 from venues where id in (p_keep, p_other) order by id for update;
  select * into k from venues where id = p_keep;
  select * into o from venues where id = p_other;
  if k.id is null or o.id is null then
    raise exception 'no such arena' using errcode = 'P0002';
  end if;

  -- everything that points at the row first: deleting it first would empty the links (on delete set null)
  update venue_aliases set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_sp = row_count;
  update games set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_g = row_count;
  update teams set home_venue_id = p_keep where home_venue_id = p_other;
  get diagnostics n_t = row_count;

  -- the kept row takes what only the other one knew: a country, a town, an address, a pin
  update venues set country = coalesce(k.country, o.country),
                    city    = coalesce(k.city, o.city),
                    address = coalesce(k.address, o.address)
   where id = p_keep;
  if k.lat is null and o.lat is not null then
    update venues set lat = o.lat, lng = o.lng, place_id = o.place_id, pin_source = o.pin_source,
                      pin_note = o.pin_note, pinned_at = o.pinned_at,
                      checked_by = o.checked_by, checked_at = o.checked_at
     where id = p_keep;
  end if;
  delete from venues where id = p_other;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'venue_merge', 'venue', p_keep::text,
          jsonb_build_object('kept', k.name, 'merged', o.name, 'merged_id', p_other,
                             'spellings', n_sp, 'games', n_g, 'clubs', n_t));
  return jsonb_build_object('kept', k.name, 'merged', o.name, 'spellings', n_sp, 'games', n_g, 'clubs', n_t);
end; $$;
alter function public.merge_venues(uuid, uuid) owner to postgres;
revoke all on function public.merge_venues(uuid, uuid) from public, anon;
grant execute on function public.merge_venues(uuid, uuid) to authenticated, service_role;

create or replace function public.venues_by_hand()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return new;                                   -- the service role: the pinning script, not a person
  end if;
  if new.checked_at is distinct from old.checked_at then
    new.checked_by := case when new.checked_at is null then null else me end;
  end if;
  if (new.lat, new.lng, new.place_id, new.pin_note, new.checked_at, new.radius_m, new.name)
     is distinct from (old.lat, old.lng, old.place_id, old.pin_note, old.checked_at, old.radius_m, old.name) then
    insert into audit_log (actor, action, subject, subject_id, detail)
    values (me, 'venue_edit', 'venue', new.id::text, jsonb_build_object(
      'name', new.name,
      'before', jsonb_build_object('name', old.name, 'lat', old.lat, 'lng', old.lng, 'place_id', old.place_id,
                                   'note', old.pin_note, 'checked', old.checked_at is not null, 'radius_m', old.radius_m),
      'after',  jsonb_build_object('name', new.name, 'lat', new.lat, 'lng', new.lng, 'place_id', new.place_id,
                                   'note', new.pin_note, 'checked', new.checked_at is not null, 'radius_m', new.radius_m)));
  end if;
  return new;
end; $$;
alter function public.venues_by_hand() owner to postgres;
revoke all on function public.venues_by_hand() from public, anon, authenticated;
drop trigger if exists venues_by_hand on public.venues;
create trigger venues_by_hand before update on public.venues
  for each row execute function public.venues_by_hand();

-- ----------------------------------------------------------------------------
-- A READ-ONLY CHECK: the merge is for signed-in administrators only, the trigger is on
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.merge_venues(uuid, uuid)', 'execute') then
    raise exception '0164: anon may call merge_venues';
  end if;
  if not has_function_privilege('authenticated', 'public.merge_venues(uuid, uuid)', 'execute') then
    raise exception '0164: a signed-in administrator cannot call merge_venues';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'venues_by_hand' and tgrelid = 'public.venues'::regclass
                 and tgenabled <> 'D') then
    raise exception '0164: venues_by_hand is not installed';
  end if;
  raise notice '0164 ok: merge_venues and the venues_by_hand trigger are in place';
end $$;
