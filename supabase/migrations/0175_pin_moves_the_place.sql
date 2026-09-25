-- ============================================================================
-- 0175 - MOVING AN ARENA'S PIN MOVES ITS PLACE.
--
-- A person corrects an arena's pin in the platform console (Google's first match was another
-- place with a similar name). The pin was saved; the address, town and Google place beside it
-- still described the OLD spot. EPINOIA GO prints the town and builds its "open in Maps" link from
-- name + town, so Saga's arena read "Wembley" - and four more hand-moved arenas were the same
-- (CNA: Akita pin, London address; Dome: Belgian pin, London address; Archers Arena; Inspire
-- Leisure Centre).
--
--   1. venues_by_hand (0164's trigger, replaced)  a person moving a pin more than 150 m clears the
--      address and town that described the old spot, unless the same save wrote new ones. What
--      is stored then never contradicts the pin, even before anything has read the new place.
--   2. google_lookups + google_lookup_take        a daily count of Google lookups made on behalf of
--      the console, taken BEFORE each one (the arena-place Edge Function), so a stuck loop cannot
--      run up a bill. The pinning script keeps its own count on the PC; this is the server's.
--
-- The arena-place Edge Function then reads the new spot from Google and fills the name, address,
-- town, country and place in (deployed and given its key by the owner; see the function's header).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE DISTANCE BETWEEN TWO PINS, in metres (haversine, as the console and stamps measure it)
-- ----------------------------------------------------------------------------
create or replace function public.venue_metres(a_lat double precision, a_lng double precision,
                                               b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = public as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else 6371008.8 * 2 * asin(least(1.0, sqrt(
           power(sin(radians(b_lat - a_lat) / 2), 2) +
           cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))) end;
$$;

-- ----------------------------------------------------------------------------
-- 2. THE TRIGGER (0164's body, with the clearing added)
-- ----------------------------------------------------------------------------
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
  /* A PIN MOVED TO ANOTHER PLACE: what described the old one goes. Only what this save left as it was -
     an address the person typed alongside the new pin is theirs. 150 m is the console's own "still the
     same Google place" distance: a nudge within the building keeps its address. */
  if old.lat is not null and new.lat is not null
     and public.venue_metres(old.lat, old.lng, new.lat, new.lng) > 150 then
    if new.address is not distinct from old.address then new.address := null; end if;
    if new.city is not distinct from old.city then new.city := null; end if;
  end if;
  if (new.lat, new.lng, new.place_id, new.pin_note, new.checked_at, new.radius_m, new.name)
     is distinct from (old.lat, old.lng, old.place_id, old.pin_note, old.checked_at, old.radius_m, old.name) then
    insert into audit_log (actor, action, subject, subject_id, detail)
    values (me, 'venue_edit', 'venue', new.id::text, jsonb_build_object(
      'name', new.name,
      'before', jsonb_build_object('name', old.name, 'lat', old.lat, 'lng', old.lng, 'place_id', old.place_id,
                                   'note', old.pin_note, 'checked', old.checked_at is not null, 'radius_m', old.radius_m,
                                   'address', old.address, 'city', old.city),
      'after',  jsonb_build_object('name', new.name, 'lat', new.lat, 'lng', new.lng, 'place_id', new.place_id,
                                   'note', new.pin_note, 'checked', new.checked_at is not null, 'radius_m', new.radius_m,
                                   'address', new.address, 'city', new.city)));
  end if;
  return new;
end; $$;
alter function public.venues_by_hand() owner to postgres;
revoke all on function public.venues_by_hand() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. THE DAILY COUNT OF GOOGLE LOOKUPS MADE FOR THE CONSOLE
-- ----------------------------------------------------------------------------
create table if not exists public.google_lookups (
  day date primary key,
  n   integer not null default 0
);
alter table public.google_lookups enable row level security;    -- no policy: nobody reads it from a browser
revoke all on public.google_lookups from public, anon, authenticated;

/* One lookup, taken: true when today's count was still under the cap (and is now one higher), false
   when the day's allowance is spent. Atomic, so two clicks at once cannot both take the last one.
   UTC days: the cap is a safety, not Google's own accounting. */
create or replace function public.google_lookup_take(p_cap integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  insert into google_lookups (day, n) values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update set n = google_lookups.n + 1 where google_lookups.n < p_cap
  returning n into k;
  return k is not null;
end; $$;
alter function public.google_lookup_take(integer) owner to postgres;
revoke all on function public.google_lookup_take(integer) from public, anon, authenticated;
grant execute on function public.google_lookup_take(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 4. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if round(public.venue_metres(51.556, -0.2796, 51.556, -0.2796)) <> 0
     or abs(public.venue_metres(33.2766, 130.29267, 51.5560, -0.2796) - 9.0e6) > 1.2e6 then
    raise exception '0175: venue_metres is wrong';
  end if;
  if has_function_privilege('anon', 'public.google_lookup_take(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.google_lookup_take(integer)', 'execute') then
    raise exception '0175: a browser role may spend Google lookups';
  end if;
  if not has_function_privilege('service_role', 'public.google_lookup_take(integer)', 'execute') then
    raise exception '0175: the service role cannot take a lookup';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'venues_by_hand' and tgrelid = 'public.venues'::regclass and tgenabled <> 'D') then
    raise exception '0175: venues_by_hand is not installed';
  end if;
  raise notice '0175 ok: a moved pin drops the old place''s address and town; Google lookups for the console are counted';
end $$;
