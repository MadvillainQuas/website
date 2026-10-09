-- ============================================================================
-- 0259 - MANAGER: THE INDIVIDUAL MODE (Louie, 2026-10-09).
--
-- A fan takes a club into a real league: names it and its manager, draws its badge, drafts a squad within a budget,
-- sets its lineups and tactics, and plays the league's real clubs on the real calendar. EVERY GAME IS PLAYED IN THE
-- FAN'S OWN BROWSER (Louie: "it has to be processed only client-side with only that player's chosen league being
-- simmed to save on having a big load"; epinoia/manager/core/), so the database keeps only what has to outlive a
-- visit: the club, its squad, its lineups, the season's state, and a summary the leaderboards read.
--
--   manager_teams           a fan's club (at most MAX_TEAMS a fan): its names, badge, squad, lineups, the season's
--                           state (fixtures, results, every player's totals, its own games' box scores) and the
--                           summary (wins, losses, points for and against, table position) the boards rank
--   manager_league_values   the platform's player value range for a league (the FM-style league editor), and the
--                           boost a continental competition gives the clubs that play in it
--
--   manager_create(...)        a new club, its names checked (the username blocklist, 0163)
--   manager_save(id, patch)    the fan's own club: squad, lineups, state, summary (sizes checked)
--   manager_delete(id)         the fan's own club, gone
--   manager_leaderboard(league?, limit?)   the boards: every club that has played, the league's or all of them
--   manager_badges(ids)        the uploaded badge images of up to 60 clubs on a board (kept out of the board itself)
--   manager_boosts(league)     each of a league's clubs' continental boost, through the 0178 club links
--   manager_set_values(rows)   the platform administrators' league editor
--
-- WHAT IS PUBLIC: a club's own names and badge (chosen for the game, shown on the boards: the onboarding says so),
-- its league and its record. Never the fan's account, email or username. A fan reads and writes only their own clubs.
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE LEAGUE VALUES (the platform's editor)
-- ----------------------------------------------------------------------------
create table if not exists public.manager_league_values (
  league_id   uuid primary key references public.leagues on delete cascade,
  min_value   numeric not null check (min_value >= 1000),
  max_value   numeric not null check (max_value > min_value and max_value <= 100000000),
  boost       numeric not null default 0 check (boost >= 0 and boost <= 2),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users on delete set null
);
comment on table public.manager_league_values is
  'Manager mode (0259): a league''s typical player value range, and the boost its clubs give when it is a continental competition.';
alter table public.manager_league_values enable row level security;
drop policy if exists manager_league_values_read on public.manager_league_values;
create policy manager_league_values_read on public.manager_league_values for select using (true);
revoke insert, update, delete on public.manager_league_values from anon, authenticated;
grant select on public.manager_league_values to anon, authenticated;
grant all on public.manager_league_values to service_role;

/* rows: [{league_id, min_value, max_value, boost}] (several leagues at once: the editor's multi-select); a row with
   min_value null removes the league's range */
create or replace function public.manager_set_values(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0;
begin
  if not coalesce(public.is_platform_admin(), false) then raise exception 'platform administrators only' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'rows: an array of at most 500' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if r->>'min_value' is null then
      delete from manager_league_values where league_id = (r->>'league_id')::uuid;
    else
      insert into manager_league_values (league_id, min_value, max_value, boost, updated_at, updated_by)
      values ((r->>'league_id')::uuid, (r->>'min_value')::numeric, (r->>'max_value')::numeric, coalesce((r->>'boost')::numeric, 0), now(), auth.uid())
      on conflict (league_id) do update set min_value = excluded.min_value, max_value = excluded.max_value, boost = excluded.boost,
        updated_at = now(), updated_by = auth.uid();
    end if;
    n := n + 1;
  end loop;
  return n;
end; $$;
alter function public.manager_set_values(jsonb) owner to postgres;
revoke all on function public.manager_set_values(jsonb) from public, anon;
grant execute on function public.manager_set_values(jsonb) to authenticated;

/* EACH CLUB'S CONTINENTAL BOOST: a club linked (0178 team groups) to a side in a league that carries a boost (the
   EuroLeague, the EuroCup, the Champions League, the Europe Cup, the ABA League...) takes the largest of them */
create or replace function public.manager_boosts(p_league uuid)
returns table (team_id uuid, boost numeric)
language sql stable security definer set search_path = public as $$
  select t.id as team_id, max(v.boost) as boost
    from teams t
    join team_group_members m on m.team_id = t.id
    join team_group_members o on o.group_id = m.group_id and o.team_id <> t.id
    join teams ot on ot.id = o.team_id
    join manager_league_values v on v.league_id = ot.league_id and v.boost > 0
   where t.league_id = p_league and ot.league_id <> p_league and public.league_visible(p_league)
   group by t.id;
$$;
alter function public.manager_boosts(uuid) owner to postgres;
revoke all on function public.manager_boosts(uuid) from public;
grant execute on function public.manager_boosts(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. THE CLUBS
-- ----------------------------------------------------------------------------
create table if not exists public.manager_teams (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  mode            text not null default 'solo' check (mode in ('solo')),
  league_id       uuid not null references public.leagues on delete cascade,
  competition_id  uuid not null references public.competitions on delete cascade,
  name            text not null check (char_length(btrim(name)) between 2 and 28),
  manager         text not null check (char_length(btrim(manager)) between 2 and 28),
  badge           jsonb not null default '{}'::jsonb,
  status          text not null default 'draft' check (status in ('draft', 'active', 'done')),
  per_week        smallint not null default 2 check (per_week in (1, 2)),
  budget          numeric,
  roster          jsonb not null default '[]'::jsonb,
  lineups         jsonb not null default '[]'::jsonb,
  state           jsonb,
  w               integer not null default 0,
  l               integer not null default 0,
  pf              integer not null default 0,
  pa              integer not null default 0,
  gp              integer not null default 0,
  pos             integer,
  of_n            integer,
  rounds          integer,
  played          integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint manager_teams_sizes check (pg_column_size(badge) <= 24000 and pg_column_size(roster) <= 20000
    and pg_column_size(lineups) <= 20000 and (state is null or pg_column_size(state) <= 600000))
);
create index if not exists manager_teams_user on public.manager_teams (user_id);
create index if not exists manager_teams_board on public.manager_teams (league_id, status) where gp > 0;
comment on table public.manager_teams is
  'Manager mode (0259): a fan''s club. Written only through manager_create / manager_save / manager_delete; read by its owner and, its names, badge and record only, by manager_leaderboard.';
alter table public.manager_teams enable row level security;
drop policy if exists manager_teams_own_read on public.manager_teams;
create policy manager_teams_own_read on public.manager_teams for select using (user_id = auth.uid());
revoke insert, update, delete on public.manager_teams from anon, authenticated;
grant select on public.manager_teams to authenticated;
grant all on public.manager_teams to service_role;

/* A NAME: 2-28 letters (any alphabet), digits, spaces and . ' & -, and none of the username blocklist's words (0163),
   read through the same disguises (0 o, 1 i, 3 e, 4 a, 5 s, 7 t, 8 b, @ a) with the spaces taken out */
create or replace function public.manager_name_verdict(p text)
returns text language plpgsql stable security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')); plain text; parts text[];
begin
  if char_length(n) < 2 then return 'short'; end if;
  if char_length(n) > 28 then return 'long'; end if;
  if n !~ '^[[:alpha:][:digit:] .''&-]+$' then return 'characters'; end if;
  plain := regexp_replace(translate(lower(n), '0134578@', 'oieastba'), '[^[:alpha:]]', '', 'g');
  parts := regexp_split_to_array(translate(lower(n), '0134578@', 'oieastba'), '[^[:alpha:]]+');
  if exists (select 1 from username_blocklist b
              where (not b.whole and position(b.word in plain) > 0) or (b.whole and b.word = any (parts))) then
    return 'blocked';
  end if;
  return 'ok';
end; $$;
alter function public.manager_name_verdict(text) owner to postgres;
revoke all on function public.manager_name_verdict(text) from public, anon, authenticated;

/* a badge kept small: its drawing's fields, and an uploaded image only as a small data URL */
create or replace function public.manager_badge_ok(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(coalesce(p, '{}'::jsonb)) = 'object'
     and pg_column_size(coalesce(p, '{}'::jsonb)) <= 24000
     and (p->>'img' is null or (p->>'img') ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$');
$$;

create or replace function public.manager_create(p_league uuid, p_competition uuid, p_name text, p_manager text,
                                                 p_badge jsonb default '{}'::jsonb, p_per_week integer default 2)
returns uuid language plpgsql security definer set search_path = public as $$
declare v text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if (select count(*) from manager_teams where user_id = auth.uid()) >= 3 then raise exception 'three clubs at most' using errcode = '22023'; end if;
  if not exists (select 1 from competitions c join seasons s on s.id = c.season_id where c.id = p_competition and s.league_id = p_league)
     or not public.league_visible(p_league) then
    raise exception 'no such league' using errcode = '22023';
  end if;
  v := public.manager_name_verdict(p_name); if v <> 'ok' then raise exception 'club name: %', v using errcode = '22023'; end if;
  v := public.manager_name_verdict(p_manager); if v <> 'ok' then raise exception 'manager name: %', v using errcode = '22023'; end if;
  if not public.manager_badge_ok(p_badge) then raise exception 'badge' using errcode = '22023'; end if;
  insert into manager_teams (user_id, league_id, competition_id, name, manager, badge, per_week)
  values (auth.uid(), p_league, p_competition, btrim(p_name), btrim(p_manager), coalesce(p_badge, '{}'::jsonb), case when p_per_week = 1 then 1 else 2 end)
  returning manager_teams.id into v_id;
  return v_id;
end; $$;
alter function public.manager_create(uuid, uuid, text, text, jsonb, integer) owner to postgres;
revoke all on function public.manager_create(uuid, uuid, text, text, jsonb, integer) from public, anon;
grant execute on function public.manager_create(uuid, uuid, text, text, jsonb, integer) to authenticated;

/* THE FAN'S OWN CLUB, PATCHED: only the keys given change. A summary (w, l, pf, pa, gp, pos, of_n, rounds, played) can
   only be one the state could hold: no more games than its rounds, the table position within its clubs */
create or replace function public.manager_save(p_id uuid, p jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t manager_teams; v text; v_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into t from manager_teams where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'not your club' using errcode = '42501'; end if;
  if p ? 'name' then v := public.manager_name_verdict(p->>'name'); if v <> 'ok' then raise exception 'club name: %', v using errcode = '22023'; end if; t.name := btrim(p->>'name'); end if;
  if p ? 'manager' then v := public.manager_name_verdict(p->>'manager'); if v <> 'ok' then raise exception 'manager name: %', v using errcode = '22023'; end if; t.manager := btrim(p->>'manager'); end if;
  if p ? 'badge' then if not public.manager_badge_ok(p->'badge') then raise exception 'badge' using errcode = '22023'; end if; t.badge := p->'badge'; end if;
  if p ? 'status' then
    if (p->>'status') not in ('draft', 'active', 'done') then raise exception 'status' using errcode = '22023'; end if;
    t.status := p->>'status';
  end if;
  if p ? 'budget' then t.budget := (p->>'budget')::numeric; end if;
  if p ? 'roster' then if jsonb_typeof(p->'roster') <> 'array' or jsonb_array_length(p->'roster') > 15 then raise exception 'roster' using errcode = '22023'; end if; t.roster := p->'roster'; end if;
  if p ? 'lineups' then if jsonb_typeof(p->'lineups') <> 'array' or jsonb_array_length(p->'lineups') > 4 then raise exception 'lineups' using errcode = '22023'; end if; t.lineups := p->'lineups'; end if;
  if p ? 'state' then t.state := p->'state'; end if;
  if p ? 'summary' then
    t.w := greatest(0, coalesce((p->'summary'->>'w')::integer, 0)); t.l := greatest(0, coalesce((p->'summary'->>'l')::integer, 0));
    t.pf := greatest(0, coalesce((p->'summary'->>'pf')::integer, 0)); t.pa := greatest(0, coalesce((p->'summary'->>'pa')::integer, 0));
    t.gp := t.w + t.l; t.of_n := (p->'summary'->>'of')::integer; t.pos := (p->'summary'->>'pos')::integer;
    t.rounds := (p->'summary'->>'rounds')::integer; t.played := greatest(0, coalesce((p->'summary'->>'played')::integer, 0));
    if t.rounds is not null and (t.gp > t.rounds or t.played > t.rounds) then raise exception 'summary' using errcode = '22023'; end if;
    if t.pos is not null and (t.of_n is null or t.pos < 1 or t.pos > t.of_n) then raise exception 'summary' using errcode = '22023'; end if;
    if t.gp > 0 and (t.pf > 200 * t.gp or t.pa > 200 * t.gp) then raise exception 'summary' using errcode = '22023'; end if;
  end if;
  update manager_teams set name = t.name, manager = t.manager, badge = t.badge, status = t.status, budget = t.budget, roster = t.roster,
         lineups = t.lineups, state = t.state, w = t.w, l = t.l, pf = t.pf, pa = t.pa, gp = t.gp, pos = t.pos, of_n = t.of_n,
         rounds = t.rounds, played = t.played, updated_at = v_at
   where manager_teams.id = p_id;
  return v_at;
end; $$;
alter function public.manager_save(uuid, jsonb) owner to postgres;
revoke all on function public.manager_save(uuid, jsonb) from public, anon;
grant execute on function public.manager_save(uuid, jsonb) to authenticated;

create or replace function public.manager_delete(p_id uuid)
returns boolean language sql security definer set search_path = public as $$
  with d as (delete from manager_teams where id = p_id and user_id = auth.uid() returning 1) select exists (select 1 from d);
$$;
alter function public.manager_delete(uuid) owner to postgres;
revoke all on function public.manager_delete(uuid) from public, anon;
grant execute on function public.manager_delete(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. THE BOARDS
-- ----------------------------------------------------------------------------
/* every club that has played, ranked by its winning share, then its points difference a game, then its wins; a
   league's own or all of them. `me` marks the reader's own clubs (never anybody else's account) */
create or replace function public.manager_leaderboard(p_league uuid default null, p_limit integer default 100)
returns table (rank bigint, id uuid, name text, manager text, badge jsonb, has_img boolean, league_id uuid, league text,
               league_slug text, w integer, l integer, gp integer, pf integer, pa integer, pct numeric, diff numeric,
               pos integer, of_n integer, played integer, rounds integer, status text, me boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by round(t.w::numeric / t.gp, 4) desc, round((t.pf - t.pa)::numeric / t.gp, 2) desc, t.w desc) as rank,
         t.id, t.name, t.manager, t.badge - 'img' as badge, (t.badge ? 'img') as has_img, t.league_id, lg.name as league, lg.slug as league_slug,
         t.w, t.l, t.gp, t.pf, t.pa, round(t.w::numeric / t.gp, 3) as pct, round((t.pf - t.pa)::numeric / t.gp, 1) as diff,
         t.pos, t.of_n, t.played, t.rounds, t.status, t.user_id = auth.uid() as me
    from manager_teams t
    join leagues lg on lg.id = t.league_id
   where t.gp > 0 and t.status in ('active', 'done') and public.league_visible(t.league_id)
     and (p_league is null or t.league_id = p_league)
   order by 1, t.updated_at
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
alter function public.manager_leaderboard(uuid, integer) owner to postgres;
revoke all on function public.manager_leaderboard(uuid, integer) from public;
grant execute on function public.manager_leaderboard(uuid, integer) to anon, authenticated;

create or replace function public.manager_badges(p_ids uuid[])
returns table (id uuid, img text)
language sql stable security definer set search_path = public as $$
  select t.id, t.badge->>'img'
    from manager_teams t
   where t.id = any (p_ids[1:60]) and t.badge ? 'img' and t.gp > 0 and t.status in ('active', 'done')
     and public.league_visible(t.league_id);
$$;
alter function public.manager_badges(uuid[]) owner to postgres;
revoke all on function public.manager_badges(uuid[]) from public;
grant execute on function public.manager_badges(uuid[]) to anon, authenticated;

/* the leagues with clubs on the boards, and how many */
create or replace function public.manager_board_leagues()
returns table (league_id uuid, league text, league_slug text, clubs bigint)
language sql stable security definer set search_path = public as $$
  select t.league_id, lg.name, lg.slug, count(*)
    from manager_teams t join leagues lg on lg.id = t.league_id
   where t.gp > 0 and t.status in ('active', 'done') and public.league_visible(t.league_id)
   group by t.league_id, lg.name, lg.slug
   order by count(*) desc, lg.name;
$$;
alter function public.manager_board_leagues() owner to postgres;
revoke all on function public.manager_board_leagues() from public;
grant execute on function public.manager_board_leagues() to anon, authenticated;

notify pgrst, 'reload schema';
