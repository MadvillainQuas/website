-- ============================================================================
-- 0165 - STAMPS (EPINOIA GO, docs/epinoia-go.md steps 3.1 and 3.2).
--
-- A fan at a game presses "Stamp this venue" and their phone's location is checked here, once:
-- is there a game on at this arena now, and is the phone at the arena? If so the fan gets a stamp.
--
--   stamps            one per fan per game: the arena, the game, its league, the time, and the accuracy
--                     the phone reported. NEVER the location itself (D5): it is used for the check and
--                     dropped. Only the fan reads their own; deleting the account deletes them.
--   stamp_attempts    every try, stamped or refused, and why - for the rate limit and for a person looking
--                     into "it would not stamp me". No location either. Nobody reads it but an administrator.
--   stamp_venue()     the check (3.2). Every refusal names its reason and the number that goes with it.
--   go_games_now()    the games a fan can stamp now or soon, with their arenas' pins and windows: the phone
--                     works out how near each one is itself, so the fan's location leaves the phone only
--                     at the moment they stamp.
--   go_window()       when a game can be stamped (D1): from two hours before tip-off to one hour after the end.
--   merge_venues()    0164's, now moving stamps too.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.stamps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  -- an arena with stamps is only ever removed by merging it into another (merge_venues moves them)
  venue_id    uuid not null references public.venues on delete restrict,
  -- a game removed later (a duplicate cleaned up) leaves the visit: the fan was at the arena
  game_id     uuid references public.games on delete set null,
  league_id   uuid references public.leagues on delete set null,
  stamped_at  timestamptz not null default now(),
  accuracy_m  integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  constraint stamps_one_per_game unique (user_id, game_id)
);
comment on table public.stamps is
  'A fan''s stamp at an arena, at a game (0165, EPINOIA GO). Never the location: only the accuracy reported.';
create index if not exists stamps_user_time on public.stamps (user_id, stamped_at desc);
create index if not exists stamps_venue on public.stamps (venue_id);
create index if not exists stamps_league on public.stamps (league_id, user_id);

create table if not exists public.stamp_attempts (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  tried_at   timestamptz not null default now(),
  game_id    uuid,
  venue_id   uuid,
  ok         boolean not null,
  reason     text not null
);
create index if not exists stamp_attempts_user_at on public.stamp_attempts (user_id, tried_at desc);

alter table public.stamps enable row level security;
alter table public.stamp_attempts enable row level security;
drop policy if exists stamps_own_read on public.stamps;
create policy stamps_own_read on public.stamps for select using (user_id = auth.uid());
-- a fan may take one of their stamps back; nobody writes one but stamp_venue()
drop policy if exists stamps_own_delete on public.stamps;
create policy stamps_own_delete on public.stamps for delete using (user_id = auth.uid());
drop policy if exists stamp_attempts_admin on public.stamp_attempts;
create policy stamp_attempts_admin on public.stamp_attempts for select using (public.is_platform_admin());
grant select, delete on public.stamps to authenticated;
revoke insert, update on public.stamps from anon, authenticated;
revoke all on public.stamps from anon;
grant select on public.stamp_attempts to authenticated;
revoke insert, update, delete on public.stamp_attempts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. DISTANCE AND THE WINDOW
-- ----------------------------------------------------------------------------
/* metres between two points on the Earth (great circle; the mean radius) */
create or replace function public.go_metres(lat1 double precision, lng1 double precision,
                                            lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = public as $$
  select 6371008.8 * 2 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2) +
           cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

/* When a game can be stamped (D1): from two hours before tip-off to one hour after the end. The end is
   when it was finalised if it has been (never before 90 minutes, never counted past five hours: an ingest
   can finalise late), five hours on while it is live, else two and a half hours after tip-off. */
create or replace function public.go_window(p_tipoff timestamptz, p_status text, p_finalised timestamptz,
                                            out opens_at timestamptz, out closes_at timestamptz)
language sql stable set search_path = public as $$
  select p_tipoff - interval '2 hours',
         (case
            when p_status in ('final', 'finalising') and p_finalised is not null
              then least(greatest(p_finalised, p_tipoff + interval '90 minutes'), p_tipoff + interval '5 hours')
            when p_status = 'live' then p_tipoff + interval '5 hours'
            else p_tipoff + interval '150 minutes'
          end) + interval '1 hour';
$$;

-- ----------------------------------------------------------------------------
-- 3. THE CHECK
-- ----------------------------------------------------------------------------
create or replace function public.stamp_venue(p_game uuid, p_lat double precision, p_lng double precision,
                                              p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g record; v record; w record; prev record;
  vid uuid;                               -- the game's arena, once known (for the attempts log)
  d double precision; allow double precision; acc integer;
  n_min int; n_hour int;
  s stamps;
  res jsonb;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;

  -- one fan's tries: six a minute, thirty an hour (a phone re-asking by itself, or a script)
  select count(*) filter (where tried_at > now() - interval '1 minute'), count(*)
    into n_min, n_hour
    from stamp_attempts where user_id = me and tried_at > now() - interval '1 hour';
  if n_min >= 6 or n_hour >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'slow_down',
                              'retry_after', case when n_hour >= 30 then 3600 else 60 end);
  end if;
  -- a fan's old tries are theirs to forget
  delete from stamp_attempts where user_id = me and tried_at < now() - interval '30 days';

  -- Postgres holds NaN equal to itself, so it is asked for by name
  acc := case when p_accuracy is null or p_accuracy = 'NaN'::float8 or p_accuracy = 'Infinity'::float8 then null
              else least(greatest(round(p_accuracy), 0), 100000)::int end;

  if p_lat is null or p_lng is null or p_lat = 'NaN'::float8 or p_lng = 'NaN'::float8
     or abs(p_lat) > 90 or abs(p_lng) > 180 then
    res := jsonb_build_object('ok', false, 'reason', 'bad_location');
  else
    select gm.id, gm.tipoff_at, gm.status::text as status, gm.finalised_at, gm.competition_id,
           public.game_venue_id(gm.id) as venue_id
      into g from games gm where gm.id = p_game;
    vid := g.venue_id;
    if g.id is null or not public.can_read_game(g.id) then
      vid := null;                        -- an unseen game's arena is not the fan's to learn, even in the log
      res := jsonb_build_object('ok', false, 'reason', 'no_such_game');
    elsif g.status = 'void' then
      res := jsonb_build_object('ok', false, 'reason', 'not_on');
    elsif g.tipoff_at is null then
      res := jsonb_build_object('ok', false, 'reason', 'no_time');
    else
      select * into w from public.go_window(g.tipoff_at, g.status, g.finalised_at);
      select * into v from venues where id = g.venue_id;
      if now() < w.opens_at then
        res := jsonb_build_object('ok', false, 'reason', 'too_early', 'opens_at', w.opens_at);
      elsif now() > w.closes_at then
        res := jsonb_build_object('ok', false, 'reason', 'too_late', 'closed_at', w.closes_at);
      elsif v.id is null then
        res := jsonb_build_object('ok', false, 'reason', 'no_arena');
      elsif v.lat is null or v.pin_note is not null then
        -- a pin with a note waits for a person (docs/epinoia-go.md 1.4): no stamp is checked against it
        res := jsonb_build_object('ok', false, 'reason', 'arena_unchecked', 'venue', v.name);
      elsif exists (select 1 from stamps where user_id = me and game_id = g.id) then
        select * into s from stamps where user_id = me and game_id = g.id;
        res := jsonb_build_object('ok', true, 'already', true, 'venue', v.name, 'stamped_at', s.stamped_at);
      else
        d := public.go_metres(p_lat, p_lng, v.lat, v.lng);
        -- the phone's own doubt is allowed for, up to 200 m of it
        allow := v.radius_m + least(coalesce(acc, 0), 200);
        if d > allow then
          if coalesce(acc, 0) > 1000 then
            res := jsonb_build_object('ok', false, 'reason', 'imprecise', 'accuracy_m', acc);
          else
            res := jsonb_build_object('ok', false, 'reason', 'too_far', 'venue', v.name,
                                      'distance_m', (round(d / 10) * 10)::bigint, 'radius_m', v.radius_m);
          end if;
        else
          -- no faster than a plane since the fan's last stamp somewhere else
          select st.stamped_at, pv.name, pv.lat, pv.lng into prev
            from stamps st join venues pv on pv.id = st.venue_id
           where st.user_id = me order by st.stamped_at desc limit 1;
          if prev.stamped_at is not null and prev.lat is not null
             and public.go_metres(prev.lat, prev.lng, v.lat, v.lng) > 50000
             and public.go_metres(prev.lat, prev.lng, v.lat, v.lng) / 1000.0
                 / greatest(extract(epoch from now() - prev.stamped_at) / 3600.0, 0.01) > 900 then
            res := jsonb_build_object('ok', false, 'reason', 'too_fast', 'last_venue', prev.name,
                                      'minutes_ago', floor(extract(epoch from now() - prev.stamped_at) / 60)::int);
          else
            insert into stamps (user_id, venue_id, game_id, league_id, accuracy_m)
            values (me, v.id, g.id,
                    (select s2.league_id from competitions c join seasons s2 on s2.id = c.season_id
                      where c.id = g.competition_id),
                    acc)
            on conflict (user_id, game_id) do nothing
            returning * into s;
            if s.id is null then
              -- two taps racing: the other one stamped
              select * into s from stamps where user_id = me and game_id = g.id;
              res := jsonb_build_object('ok', true, 'already', true, 'venue', v.name, 'stamped_at', s.stamped_at);
            else
              res := jsonb_build_object(
                'ok', true, 'venue', v.name, 'venue_id', v.id, 'stamped_at', s.stamped_at,
                'first_time_here', not exists (select 1 from stamps x where x.user_id = me and x.venue_id = v.id and x.id <> s.id),
                'arenas', (select count(distinct x.venue_id) from stamps x where x.user_id = me),
                'stamps', (select count(*) from stamps x where x.user_id = me));
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  insert into stamp_attempts (user_id, game_id, venue_id, ok, reason)
  values (me, p_game, vid, (res->>'ok')::boolean,
          coalesce(res->>'reason', case when (res->>'already')::boolean then 'already' else 'stamped' end));
  return res;
end; $$;
alter function public.stamp_venue(uuid, double precision, double precision, double precision) owner to postgres;
revoke all on function public.stamp_venue(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.stamp_venue(uuid, double precision, double precision, double precision) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. THE GAMES A FAN CAN STAMP NOW OR SOON
-- ----------------------------------------------------------------------------
/* Every game the caller may see with a window open now or opening in the next day, and its arena's pin.
   No location goes in: the phone measures. `trusted` is false where the pin waits for a person, and
   such a game cannot be stamped yet. */
create or replace function public.go_games_now()
returns table (game_id uuid, tipoff_at timestamptz, status text, opens_at timestamptz, closes_at timestamptz,
               venue_id uuid, venue text, city text, country text, lat double precision, lng double precision,
               radius_m integer, trusted boolean, league_id uuid, league text, league_slug text,
               home text, away text)
language sql stable security definer set search_path = public as $$
  select g.id, g.tipoff_at, g.status::text, w.opens_at, w.closes_at,
         v.id, v.name, v.city, v.country, v.lat, v.lng, v.radius_m,
         (v.lat is not null and v.pin_note is null),
         l.id, l.name, l.slug, ht.name, awt.name
    from games g
    cross join lateral public.go_window(g.tipoff_at, g.status::text, g.finalised_at) w
    left join venues v on v.id = public.game_venue_id(g.id)
    left join competitions c on c.id = g.competition_id
    left join seasons s on s.id = c.season_id
    left join leagues l on l.id = s.league_id
    left join teams ht on ht.id = g.home_team_id
    left join teams awt on awt.id = g.away_team_id
   where g.tipoff_at between now() - interval '7 hours' and now() + interval '26 hours'
     and g.status::text <> 'void'
     and w.closes_at > now() and w.opens_at < now() + interval '24 hours'
     and public.can_read_game(g.id)
   order by g.tipoff_at, g.id
   limit 500;
$$;
revoke all on function public.go_games_now() from public;
grant execute on function public.go_games_now() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. A MERGE MOVES STAMPS TOO (0164's function, with the stamps line)
-- ----------------------------------------------------------------------------
create or replace function public.merge_venues(p_keep uuid, p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k venues;
  o venues;
  n_sp int; n_g int; n_t int; n_st int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different arenas are needed' using errcode = '22023';
  end if;
  perform 1 from venues where id in (p_keep, p_other) order by id for update;
  select * into k from venues where id = p_keep;
  select * into o from venues where id = p_other;
  if k.id is null or o.id is null then
    raise exception 'no such arena' using errcode = 'P0002';
  end if;

  update venue_aliases set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_sp = row_count;
  update games set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_g = row_count;
  update teams set home_venue_id = p_keep where home_venue_id = p_other;
  get diagnostics n_t = row_count;
  update stamps set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_st = row_count;

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
                             'spellings', n_sp, 'games', n_g, 'clubs', n_t, 'stamps', n_st));
  return jsonb_build_object('kept', k.name, 'merged', o.name, 'spellings', n_sp, 'games', n_g,
                            'clubs', n_t, 'stamps', n_st);
end; $$;
alter function public.merge_venues(uuid, uuid) owner to postgres;
revoke all on function public.merge_venues(uuid, uuid) from public, anon;
grant execute on function public.merge_venues(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
declare w record;
begin
  if abs(public.go_metres(60.1699, 24.9384, 59.3293, 18.0686) - 396000) > 3000 then
    raise exception '0165: go_metres is wrong (Helsinki-Stockholm)';
  end if;
  select * into w from public.go_window('2026-01-01 18:00+00', 'scheduled', null);
  if w.opens_at <> '2026-01-01 16:00+00' or w.closes_at <> '2026-01-01 21:30+00' then
    raise exception '0165: go_window is wrong for a scheduled game: % %', w.opens_at, w.closes_at;
  end if;
  select * into w from public.go_window('2026-01-01 18:00+00', 'final', '2026-01-01 20:05+00');
  if w.closes_at <> '2026-01-01 21:05+00' then
    raise exception '0165: go_window is wrong for a final game: %', w.closes_at;
  end if;
  if has_function_privilege('anon', 'public.stamp_venue(uuid, double precision, double precision, double precision)', 'execute') then
    raise exception '0165: anon may call stamp_venue';
  end if;
  if has_table_privilege('authenticated', 'public.stamps', 'insert') then
    raise exception '0165: a fan may insert a stamp directly';
  end if;
  raise notice '0165 ok: stamps, the check, the window and the games a fan can stamp are in place';
end $$;
