-- ============================================================================
-- 0166 - THE NUMBERS AND THE LEADERBOARDS (EPINOIA GO, docs/epinoia-go.md steps 4.1 and 4.2).
--
-- A fan's numbers: the arenas they have stamped, their stamps, and the distance they have travelled -
-- the journey (D2): from each stamp's arena to the next one's, in the order they were made, summed, so
-- an arena counts once and every trip adds its kilometres. Per league, the same over that league's
-- stamps only.
--
-- The leaderboards are opt-in (D6): a fan appears only once they have chosen to, have a username
-- (0163) and have confirmed they are 18 or over - nothing else about a fan's age is known, and an
-- under-18 must never be shown. A board shows usernames and numbers, never an account id or which
-- arenas: a fan's stamps stay theirs.
--
--   go_settings           a fan's choice: public or not, and when they confirmed their age
--   set_go_public()       the only way to change it; public needs a username and the confirmation
--   go_my_settings()      the fan's own choice, for the page
--   go_numbers()          (internal) arenas, stamps and kilometres per fan, overall or for one league
--   go_leaderboard()      a board: overall or one league, by arenas or by distance
--   go_my_numbers()       the fan's own numbers overall and per league, with their ranks if public
--   go_leagues()          the leagues with stamps, for the board's buttons, and each league's arenas
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A FAN'S CHOICE
-- ----------------------------------------------------------------------------
create table if not exists public.go_settings (
  user_id            uuid primary key references auth.users on delete cascade,
  public             boolean not null default false,
  adult_confirmed_at timestamptz,
  updated_at         timestamptz not null default now(),
  -- public only with the age confirmed, whatever writes the row
  constraint go_settings_public_is_adult check (not public or adult_confirmed_at is not null)
);
alter table public.go_settings enable row level security;
drop policy if exists go_settings_own_read on public.go_settings;
create policy go_settings_own_read on public.go_settings for select using (user_id = auth.uid());
revoke insert, update, delete on public.go_settings from anon, authenticated;
revoke all on public.go_settings from anon;
grant select on public.go_settings to authenticated;

create or replace function public.set_go_public(p_public boolean, p_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cur go_settings;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  select * into cur from go_settings where user_id = me;
  if coalesce(p_public, false) then
    if not exists (select 1 from usernames where user_id = me) then
      return jsonb_build_object('ok', false, 'reason', 'username');
    end if;
    if not coalesce(p_adult, false) and cur.adult_confirmed_at is null then
      return jsonb_build_object('ok', false, 'reason', 'adult');
    end if;
  end if;
  insert into go_settings (user_id, public, adult_confirmed_at, updated_at)
  values (me, coalesce(p_public, false),
          case when coalesce(p_public, false) or coalesce(p_adult, false) then coalesce(cur.adult_confirmed_at, now()) end,
          now())
  on conflict (user_id) do update
     set public = excluded.public,
         adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, excluded.adult_confirmed_at),
         updated_at = now();
  return jsonb_build_object('ok', true, 'public', coalesce(p_public, false));
end; $$;
alter function public.set_go_public(boolean, boolean) owner to postgres;
revoke all on function public.set_go_public(boolean, boolean) from public, anon;
grant execute on function public.set_go_public(boolean, boolean) to authenticated;

create or replace function public.go_my_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'public', coalesce((select public from go_settings where user_id = auth.uid()), false),
    'adult', (select adult_confirmed_at is not null from go_settings where user_id = auth.uid()) is true,
    'username', (select username from usernames where user_id = auth.uid())) end;
$$;
revoke all on function public.go_my_settings() from public, anon;
grant execute on function public.go_my_settings() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. THE NUMBERS (4.1)
-- ----------------------------------------------------------------------------
/* Per fan: arenas, stamps, and the journey in km - from each stamp's arena to the next one's in the order
   made (a pin moved later moves the journey with it: the arenas are where they are). For one league, the
   same over that league's stamps only. Every fan: callers decide who may be shown. */
create or replace function public.go_numbers(p_league uuid default null)
returns table (user_id uuid, arenas bigint, stamps bigint, km double precision, first_at timestamptz)
language sql stable security definer set search_path = public as $$
  with s as (
    select st.user_id, st.venue_id, st.stamped_at, v.lat, v.lng,
           lag(v.lat) over w as plat, lag(v.lng) over w as plng
      from stamps st join venues v on v.id = st.venue_id
     where p_league is null or st.league_id = p_league
    window w as (partition by st.user_id order by st.stamped_at, st.id)
  )
  select s.user_id, count(distinct s.venue_id), count(*),
         coalesce(sum(case when s.plat is not null and s.lat is not null
                           then public.go_metres(s.plat, s.plng, s.lat, s.lng) end), 0) / 1000.0,
         min(s.stamped_at)
    from s group by s.user_id;
$$;
revoke all on function public.go_numbers(uuid) from public, anon, authenticated;

/* A board: the fans who chose to be on it (public, a username, 18 or over confirmed), overall or for one
   league, ranked by arenas (then kilometres) or by kilometres (then arenas); ties share a rank. Names and
   numbers only; `me` marks the caller's own row, so the page can light it without an id. */
create or replace function public.go_leaderboard(p_league uuid default null, p_by text default 'arenas',
                                                 p_limit integer default 100)
returns table (rank bigint, username text, arenas bigint, stamps bigint, km numeric, me boolean)
language sql stable security definer set search_path = public as $$
  with n as (
    select g.user_id, g.arenas, g.stamps, g.km, g.first_at, u.username
      from public.go_numbers(p_league) g
      join go_settings gs on gs.user_id = g.user_id and gs.public and gs.adult_confirmed_at is not null
      join usernames u on u.user_id = g.user_id
     -- a private league's board is its own members' (0139): who goes to its games is not for strangers
     where p_league is null or public.league_visible(p_league)
  ), r as (
    select case when p_by = 'km' then rank() over (order by n.km desc, n.arenas desc)
                else rank() over (order by n.arenas desc, n.km desc) end as rk, n.*
      from n
  )
  select r.rk, r.username, r.arenas, r.stamps, round(r.km::numeric, 1), coalesce(r.user_id = auth.uid(), false)
    from r
   order by r.rk, r.first_at, r.username
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.go_leaderboard(uuid, text, integer) from public;
grant execute on function public.go_leaderboard(uuid, text, integer) to anon, authenticated;

/* The fan's own numbers, overall (league null) and per league they have stamped in, with their rank on
   each board if they are public (null if not). */
create or replace function public.go_my_numbers()
returns table (league_id uuid, league text, league_slug text, arenas bigint, stamps bigint, km numeric,
               rank_arenas bigint, rank_km bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pub boolean;
  l record;
begin
  if me is null then return; end if;
  pub := exists (select 1 from go_settings gs join usernames u on u.user_id = gs.user_id
                  where gs.user_id = me and gs.public and gs.adult_confirmed_at is not null);
  for l in select null::uuid as id, null::text as name, null::text as slug
           union all
           select distinct lg.id, lg.name, lg.slug from stamps st join leagues lg on lg.id = st.league_id
            where st.user_id = me
  loop
    return query
      select l.id, l.name, l.slug, g.arenas, g.stamps, round(g.km::numeric, 1),
             case when pub then (select b.rank from public.go_leaderboard(l.id, 'arenas', 500) b where b.me) end,
             case when pub then (select b.rank from public.go_leaderboard(l.id, 'km', 500) b where b.me) end
        from public.go_numbers(l.id) g where g.user_id = me;
  end loop;
end; $$;
revoke all on function public.go_my_numbers() from public, anon;
grant execute on function public.go_my_numbers() to authenticated;

/* The leagues fans have stamped in, for the boards' buttons: how many fans are on each board, and how many
   arenas the league has played in over the last 13 months (its games' own arenas, else their home clubs'). */
create or replace function public.go_leagues()
returns table (league_id uuid, league text, league_slug text, country text, fans bigint, arenas_total bigint)
language sql stable security definer set search_path = public as $$
  with lg as (
    select st.league_id, count(distinct st.user_id) filter (
             where exists (select 1 from go_settings gs join usernames u on u.user_id = gs.user_id
                            where gs.user_id = st.user_id and gs.public and gs.adult_confirmed_at is not null)) as fans
      from stamps st where st.league_id is not null group by st.league_id
  )
  select l.id, l.name, l.slug, l.country, lg.fans,
         (select count(distinct public.game_venue_id(g.id))
            from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id
           where s.league_id = l.id and g.tipoff_at > now() - interval '13 months')
    from lg join leagues l on l.id = lg.league_id
   where public.league_visible(l.id)
   order by lg.fans desc, l.name;
$$;
revoke all on function public.go_leagues() from public;
grant execute on function public.go_leagues() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.go_numbers(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.go_numbers(uuid)', 'execute') then
    raise exception '0166: go_numbers (every fan''s numbers, with their ids) is reachable from outside';
  end if;
  if has_function_privilege('anon', 'public.set_go_public(boolean, boolean)', 'execute') then
    raise exception '0166: anon may call set_go_public';
  end if;
  if has_table_privilege('authenticated', 'public.go_settings', 'update') then
    raise exception '0166: a fan may write go_settings directly';
  end if;
  raise notice '0166 ok: the numbers and the opt-in boards are in place';
end $$;
