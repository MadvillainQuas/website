-- ============================================================================
-- 0239 - PREDICTIONS: PICK THE WINNER, AND THE LEADERBOARDS.
--
-- Under every fixture card and on every game preview a signed-in fan taps the side they think will win. A pick can
-- be changed or taken back until the game starts (tip-off, or the game going live, whichever is first); after that
-- it is locked and, once the game is final, it is right or wrong. Everybody sees how the picks split, as
-- percentages; nobody sees who picked what.
--
--   game_predictions      one row per fan per game: home or away, and the league the game is in (filed at the pick,
--                         so a league's board is one index away)
--   predict_game()        the only way to write: pick, change or clear (null) a pick; signed in, before the start
--   prediction_tally()    the split for up to 200 games at once (a page of cards), and the caller's own pick
--   prediction_board()    a board: every fan who has picked, overall or for one league, all time or since a date;
--                         ranked by correct picks, then accuracy; ties share a rank. A fan is shown by their
--                         username (0163), or else by a fixed "fan-xxxxx" tag that says nothing about them
--   prediction_leagues()  the leagues with picks, for the board's buttons
--   prediction_mine()     the caller's own line on a board, with their rank and their face
--   prediction_face()     (internal) a fan's photo circle, colour and club crest - only for a fan whose page is public
--   set_fan_circle()      what the fan's photo circle shows (YOUR HUB): their picture, their club's crest or initials
--   moderate_fan()        a platform administrator rejects a fan's picture (or resets their page) and warns them
--
-- A board of picks shows no place, no arena and no account id (the GO boards are opt-in because they show where a
-- fan has been: this shows only how good their guesses are).
-- ============================================================================
set local lock_timeout = '5s';

create table if not exists public.game_predictions (
  game_id    uuid not null references public.games on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  pick       text not null check (pick in ('home', 'away')),
  league_id  uuid references public.leagues on delete set null,
  made_at    timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists game_predictions_user on public.game_predictions (user_id);
create index if not exists game_predictions_league on public.game_predictions (league_id);

alter table public.game_predictions enable row level security;
revoke all on public.game_predictions from public, anon, authenticated;
grant all on public.game_predictions to service_role;

-- ----------------------------------------------------------------------------
-- 1. PICKING
-- ----------------------------------------------------------------------------
/* Is the game still open for picks: scheduled, and not yet at its tip-off. */
create or replace function public.prediction_open(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select g.status = 'scheduled' and (g.tipoff_at is null or g.tipoff_at > now())
                     from games g where g.id = p_game), false);
$$;
revoke all on function public.prediction_open(uuid) from public, anon, authenticated;

/* The split for one game, and the caller's pick. */
create or replace function public.prediction_split(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'home', count(*) filter (where p.pick = 'home'),
    'away', count(*) filter (where p.pick = 'away'),
    'mine', (select m.pick from game_predictions m where m.game_id = p_game and m.user_id = auth.uid()),
    'open', public.prediction_open(p_game))
    from game_predictions p where p.game_id = p_game;
$$;
revoke all on function public.prediction_split(uuid) from public, anon, authenticated;

create or replace function public.predict_game(p_game uuid, p_pick text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if p_game is null or not exists (select 1 from games where id = p_game) or not public.game_visible(p_game) then
    return jsonb_build_object('ok', false, 'reason', 'no_game');
  end if;
  if p_pick is not null and p_pick not in ('home', 'away') then
    return jsonb_build_object('ok', false, 'reason', 'bad_pick');
  end if;
  if not public.prediction_open(p_game) then
    return jsonb_build_object('ok', false, 'reason', 'locked') || public.prediction_split(p_game);
  end if;
  if p_pick is null then
    delete from game_predictions where game_id = p_game and user_id = me;
  else
    insert into game_predictions (game_id, user_id, pick, league_id, made_at)
    values (p_game, me, p_pick, public.game_league_id(p_game), now())
    on conflict (game_id, user_id) do update set pick = excluded.pick, made_at = now();
  end if;
  return jsonb_build_object('ok', true) || public.prediction_split(p_game);
end; $$;
alter function public.predict_game(uuid, text) owner to postgres;
revoke all on function public.predict_game(uuid, text) from public, anon;
grant execute on function public.predict_game(uuid, text) to authenticated;

/* The split for a page of cards (200 at most), only for games the caller may see. A game nobody has picked yet
   still comes back, with zeros, so the page knows whether it is open. */
create or replace function public.prediction_tally(p_games uuid[])
returns table (game_id uuid, home bigint, away bigint, mine text, open boolean)
language sql stable security definer set search_path = public as $$
  with ids as (
    select distinct x as id from unnest(p_games[1:200]) x where x is not null
  )
  select g.id,
         count(p.pick) filter (where p.pick = 'home'),
         count(p.pick) filter (where p.pick = 'away'),
         max(p.pick) filter (where p.user_id = auth.uid()),
         bool_or(g.status = 'scheduled' and (g.tipoff_at is null or g.tipoff_at > now()))
    from ids join games g on g.id = ids.id
    left join game_predictions p on p.game_id = g.id
   where public.game_visible(g.id)
   group by g.id;
$$;
revoke all on function public.prediction_tally(uuid[]) from public;
grant execute on function public.prediction_tally(uuid[]) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. THE PHOTO CIRCLE (YOUR HUB, Your public page)
-- ----------------------------------------------------------------------------
/* What a fan's circle shows on the boards and their page: their picture, their club's crest or their initials, ringed
   in their colour. Null: the picture when there is one, else the crest, else the initials. */
alter table public.fan_profiles add column if not exists circle text;
alter table public.fan_profiles drop constraint if exists fan_profiles_circle_ck;
alter table public.fan_profiles add constraint fan_profiles_circle_ck check (circle is null or circle in ('picture', 'club', 'initials'));

create or replace function public.set_fan_circle(p text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p is not null and p not in ('picture', 'club', 'initials') then return jsonb_build_object('ok', false, 'reason', 'shape'); end if;
  insert into fan_profiles (user_id) values (me) on conflict (user_id) do nothing;
  update fan_profiles set circle = p, updated_at = now() where user_id = me;
  return jsonb_build_object('ok', true, 'circle', p);
end; $$;
alter function public.set_fan_circle(text) owner to postgres;
revoke all on function public.set_fan_circle(text) from public, anon;
grant execute on function public.set_fan_circle(text) to authenticated;

create or replace function public.my_fan_circle()
returns text language sql stable security definer set search_path = public as $$
  select circle from fan_profiles where user_id = auth.uid();
$$;
revoke all on function public.my_fan_circle() from public, anon;
grant execute on function public.my_fan_circle() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. THE BOARDS
-- ----------------------------------------------------------------------------
/* Per fan: correct, decided (final games with a winner), pending (not final yet). Every fan: callers decide who is
   shown. A void game counts for nothing. */
create or replace function public.prediction_numbers(p_league uuid default null, p_since timestamptz default null)
returns table (user_id uuid, correct bigint, decided bigint, pending bigint, first_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id,
         count(*) filter (where g.status = 'final' and g.home_score <> g.away_score
                            and p.pick = case when g.home_score > g.away_score then 'home' else 'away' end),
         count(*) filter (where g.status = 'final' and g.home_score <> g.away_score),
         count(*) filter (where g.status in ('scheduled', 'live', 'finalising')),
         min(p.made_at)
    from game_predictions p join games g on g.id = p.game_id
   where (p_league is null or p.league_id = p_league)
     and (p_since is null or coalesce(g.tipoff_at, p.made_at) >= p_since)
     and g.status <> 'void'
   group by p.user_id;
$$;
revoke all on function public.prediction_numbers(uuid, timestamptz) from public, anon, authenticated;

/* A fan's name on a board: their username, or a tag made from their id that cannot be turned back into it. */
create or replace function public.prediction_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select u.username from usernames u where u.user_id = p_user),
                  'fan-' || substr(md5('epinoia-predictions:' || p_user::text), 1, 5));
$$;
revoke all on function public.prediction_name(uuid) from public, anon, authenticated;

/* A FAN'S FACE ON A BOARD (Louie, 2026-10-07): their photo circle, their colour and the crest of the club they support,
   all from their public page (fan_profiles, 0197) and set in YOUR HUB. Only for a fan whose page is shown - public on
   EPINOIA GO, which needs a username and "18 or over" confirmed (D6: an under-18's profile never appears publicly);
   anybody else is a name or a tag and nothing more. p_self: the fan's own face, for their own line, whatever it is. */
create or replace function public.prediction_face(p_user uuid, p_self boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_self or exists (select 1 from go_settings gs join usernames u on u.user_id = gs.user_id
                                     where gs.user_id = p_user and gs.public and gs.adult_confirmed_at is not null)
    then (select jsonb_build_object(
            'u', (select u.username from usernames u where u.user_id = p_user),
            'shown', exists (select 1 from go_settings gs where gs.user_id = p_user and gs.public and gs.adult_confirmed_at is not null),
            'avatar', fp.avatar_url, 'colour', fp.colour, 'circle', fp.circle,
            'club', case when t.id is not null and (t.league_id is null or public.league_visible(t.league_id)) then
                      jsonb_build_object('name', t.name, 'slug', t.slug, 'logo', t.logo_path, 'colour', t.colour) end)
            from (select p_user as id) x
            left join fan_profiles fp on fp.user_id = x.id
            left join teams t on t.id = fp.club_id)
  end;
$$;
revoke all on function public.prediction_face(uuid, boolean) from public, anon, authenticated;

drop function if exists public.prediction_board(uuid, timestamptz, integer);
create or replace function public.prediction_board(p_league uuid default null, p_since timestamptz default null,
                                                   p_limit integer default 100)
returns table (rank bigint, name text, named boolean, correct bigint, decided bigint, pending bigint,
               pct numeric, me boolean, face jsonb)
language sql stable security definer set search_path = public as $$
  with n as (
    select x.*, case when x.decided > 0 then round(100.0 * x.correct / x.decided, 1) end as pct
      from public.prediction_numbers(p_league, p_since) x
     -- a private league's board is its own members' (0139)
     where p_league is null or public.league_visible(p_league)
  ), r as (
    select rank() over (order by n.correct desc, coalesce(n.pct, 0) desc, n.decided asc) as rk, n.* from n
  )
  select r.rk, public.prediction_name(r.user_id),
         exists (select 1 from usernames u where u.user_id = r.user_id),
         r.correct, r.decided, r.pending, r.pct, coalesce(r.user_id = auth.uid(), false),
         public.prediction_face(r.user_id)
    from r
   order by r.rk, r.first_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.prediction_board(uuid, timestamptz, integer) from public;
grant execute on function public.prediction_board(uuid, timestamptz, integer) to anon, authenticated;

/* The caller's own line on a board (they may be below the board's limit), null when they have not picked. */
create or replace function public.prediction_mine(p_league uuid default null, p_since timestamptz default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with n as (
    select x.*, case when x.decided > 0 then round(100.0 * x.correct / x.decided, 1) end as pct
      from public.prediction_numbers(p_league, p_since) x
     where auth.uid() is not null and (p_league is null or public.league_visible(p_league))
  ), r as (
    select rank() over (order by n.correct desc, coalesce(n.pct, 0) desc, n.decided asc) as rk, n.* from n
  )
  select jsonb_build_object('rank', r.rk, 'name', public.prediction_name(r.user_id),
                            'named', exists (select 1 from usernames u where u.user_id = r.user_id),
                            'correct', r.correct, 'decided', r.decided, 'pending', r.pending, 'pct', r.pct,
                            'face', public.prediction_face(r.user_id, true))
    from r where r.user_id = auth.uid();
$$;
revoke all on function public.prediction_mine(uuid, timestamptz) from public, anon;
grant execute on function public.prediction_mine(uuid, timestamptz) to authenticated;

/* The leagues fans have picked in, for the board's buttons, with how many fans have picked in each. */
create or replace function public.prediction_leagues()
returns table (league_id uuid, league text, league_slug text, country text, fans bigint)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.slug, l.country, count(distinct p.user_id)
    from game_predictions p join leagues l on l.id = p.league_id
   where public.league_visible(l.id)
   group by l.id, l.name, l.slug, l.country
   order by count(distinct p.user_id) desc, l.name;
$$;
revoke all on function public.prediction_leagues() from public;
grant execute on function public.prediction_leagues() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. MODERATION (Louie, 2026-10-07): from a board, a platform administrator hovers a fan's photo circle and rejects
--    it - the picture, or the whole of what their page shows - with a reason, and the fan is warned in their bell.
-- ----------------------------------------------------------------------------
create table if not exists public.fan_moderation (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  by_user    uuid references auth.users on delete set null,
  what       text not null check (what in ('picture', 'profile')),
  reason     text not null default '',
  removed    jsonb,                                   -- what was taken down (the picture's address, the name, the line)
  warned     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists fan_moderation_user on public.fan_moderation (user_id, created_at desc);
alter table public.fan_moderation enable row level security;
revoke all on public.fan_moderation from public, anon, authenticated;
grant all on public.fan_moderation to service_role;

/* p_user: the fan, by username (what a board shows). p_what: 'picture' takes the picture down (and the circle goes
   back to automatic); 'profile' takes down the picture, the name, the line and the links. p_warn: a message in the
   fan's bell saying what was removed and why, and that repeated breaches can end the account. {ok, warnings}. */
create or replace function public.moderate_fan(p_username text, p_what text, p_reason text, p_warn boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid; fp fan_profiles; n int; why text := left(btrim(coalesce(p_reason, '')), 200);
begin
  if not coalesce(public.is_platform_admin(), false) then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_what not in ('picture', 'profile') then return jsonb_build_object('ok', false, 'reason', 'shape'); end if;
  select u.user_id into uid from usernames u where lower(u.username) = lower(btrim(coalesce(p_username, '')));
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'no_fan'); end if;
  select * into fp from fan_profiles where user_id = uid;
  if p_what = 'picture' then
    update fan_profiles set avatar_url = null, circle = case when circle = 'picture' then null else circle end, updated_at = now()
     where user_id = uid;
  else
    update fan_profiles set avatar_url = null, circle = null, name = '', bio = '', links = '{}'::jsonb, updated_at = now()
     where user_id = uid;
  end if;
  insert into fan_moderation (user_id, by_user, what, reason, removed, warned)
  values (uid, auth.uid(), p_what, why,
          jsonb_build_object('avatar_url', fp.avatar_url, 'name', fp.name, 'bio', fp.bio, 'links', fp.links), coalesce(p_warn, true));
  select count(*) into n from fan_moderation where user_id = uid and warned;
  if coalesce(p_warn, true) then
    insert into notifications (user_id, kind, title, body, link, ref)
    values (uid, 'message',
            case when p_what = 'picture' then 'A moderator removed your picture' else 'A moderator reset your public page' end,
            left('It broke the community rules' || case when why <> '' then ': ' || why else '' end ||
                 '. This is warning ' || n || '. Repeated breaches can lead to your account being disabled.', 240),
            '/epinoia/profile/', 'moderation:' || gen_random_uuid());
  end if;
  return jsonb_build_object('ok', true, 'warnings', n);
end; $$;
alter function public.moderate_fan(text, text, text, boolean) owner to postgres;
revoke all on function public.moderate_fan(text, text, text, boolean) from public, anon;
grant execute on function public.moderate_fan(text, text, text, boolean) to authenticated;

/* the warnings a fan has had, for the moderator's card (platform administrators only) */
create or replace function public.fan_moderation_count(p_username text)
returns integer language sql stable security definer set search_path = public as $$
  select case when coalesce(public.is_platform_admin(), false) then
    (select count(*)::int from fan_moderation m join usernames u on u.user_id = m.user_id
      where lower(u.username) = lower(btrim(coalesce(p_username, ''))) and m.warned) end;
$$;
revoke all on function public.fan_moderation_count(text) from public, anon;
grant execute on function public.fan_moderation_count(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.prediction_open(uuid)', 'public.prediction_split(uuid)',
                           'public.prediction_numbers(uuid, timestamptz)', 'public.prediction_name(uuid)',
                           'public.prediction_face(uuid, boolean)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0239: % is reachable from outside', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.moderate_fan(text, text, text, boolean)', 'execute') then
    raise exception '0239: anon may call moderate_fan';
  end if;
  if has_table_privilege('authenticated', 'public.fan_moderation', 'select') then
    raise exception '0239: fan_moderation is open to browsers';
  end if;
  if has_function_privilege('anon', 'public.predict_game(uuid, text)', 'execute') then
    raise exception '0239: anon may call predict_game';
  end if;
  if has_table_privilege('authenticated', 'public.game_predictions', 'select')
     or has_table_privilege('authenticated', 'public.game_predictions', 'insert')
     or has_table_privilege('anon', 'public.game_predictions', 'select') then
    raise exception '0239: game_predictions is open to browsers';
  end if;
  raise notice '0239 ok: predictions and their boards are in place';
end $$;

notify pgrst, 'reload schema';
