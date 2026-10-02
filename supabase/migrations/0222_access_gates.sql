-- 0222: WHAT IS BEHIND THE WALL, EDITABLE (2026-10-02). Until now what a membership opened was code
-- (epinoia/access.js CATALOGUE): every analytics section rode on one switch and the words on every teaser,
-- popup and paywall were fixed. Now each lockable section of the site is a row here with the entitlement that
-- opens it -- 'free' (open to everyone), 'analytics', 'club_report' or 'player_report' -- and the title and
-- lines of the teaser it shows when locked; the wording shared by every prompt (the popup, the buttons, the
-- members-only card, the payment window) is the public platform setting 'access_copy'. A platform
-- administrator edits both in the platform console (Plans: What is behind the wall).
--
-- The pages read both through access_wall() (anon), over access.js's own defaults, so an empty table or a
-- database without this migration draws exactly what it drew before. Where the database itself holds a
-- section back it follows the same row: the events splits (game_sit_lines, 0190) follow 'events', the What
-- wins and Front office files (analytics_check, 0211/0213) follow 'model'. Making either 'free' opens its data,
-- not only its drawing. With memberships switched off everything is open, as before.
--
-- A key is never created from the console (as platform_set_setting, 0044): a typo would otherwise make a row
-- that no page reads. The keys are seeded here, one for every lock access.js knows.

create table if not exists public.access_gates (
  key        text primary key check (key ~ '^[a-zA-Z][a-zA-Z0-9_]{1,40}$'),
  gate       text not null check (gate in ('free', 'analytics', 'club_report', 'player_report')),
  title      text check (title is null or char_length(title) between 1 and 120),
  lines      text[] check (lines is null or (cardinality(lines) <= 3 and char_length(array_to_string(lines, '')) <= 480)),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

alter table public.access_gates enable row level security;
drop policy if exists access_gates_read on public.access_gates;
create policy access_gates_read on public.access_gates for select using (true);
revoke all on public.access_gates from public;
grant select on public.access_gates to anon, authenticated;
grant all on public.access_gates to service_role;

insert into public.access_gates (key, gate) values
  ('events', 'analytics'), ('csv', 'analytics'), ('model', 'analytics'),
  ('clubReport', 'club_report'), ('playerReport', 'player_report'),
  ('shotZones', 'analytics'), ('shotClock', 'analytics'), ('rotations', 'analytics'), ('lineups', 'analytics'),
  ('wowy', 'analytics'), ('splits', 'analytics'), ('statColumns', 'analytics'),
  ('gameFlow', 'analytics'), ('gameConnections', 'analytics'), ('gameAdvanced', 'analytics'), ('videoRuns', 'analytics')
on conflict (key) do nothing;

insert into public.platform_settings (key, value, is_public)
values ('access_copy', '{}'::jsonb, true)
on conflict (key) do nothing;

/* the entitlement that opens a section; a key with no row keeps the default it has always had */
create or replace function public.gate_of(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select g.gate from public.access_gates g where g.key = p_key),
                  case p_key when 'clubReport' then 'club_report' when 'playerReport' then 'player_report' else 'analytics' end);
$$;

/* is the section open to the caller in this league: everything with memberships off; a free section to all;
   the analytics as can_use_analytics has always answered (the league's own analytics mode first); a report to
   whoever holds it; the league's administrators always. Never null: an unknown answer is a closed door */
create or replace function public.gate_open(p_key text, p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case
    when not public.memberships_enabled() then true
    when public.gate_of(p_key) = 'free' then true
    when p_league is not null and coalesce(public.is_league_admin(p_league), false) then true
    when public.gate_of(p_key) = 'analytics' then public.can_use_analytics(p_league)
    else public.gate_of(p_key) = any (coalesce(public.access_features(p_league), '{}'::text[]))
  end, false);
$$;

revoke all on function public.gate_of(text) from public;
revoke all on function public.gate_open(text, uuid) from public;
grant execute on function public.gate_of(text) to anon, authenticated, service_role;
grant execute on function public.gate_open(text, uuid) to anon, authenticated, service_role;

/* what the pages read: every row and the shared wording, in one round trip, signed in or not */
create or replace function public.access_wall()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gates', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'gate', g.gate, 'title', g.title, 'lines', to_jsonb(g.lines)) order by g.key)
                         from public.access_gates g), '[]'::jsonb),
    'copy', coalesce((select s.value from public.platform_settings s where s.key = 'access_copy' and s.is_public), '{}'::jsonb));
$$;
revoke all on function public.access_wall() from public;
grant execute on function public.access_wall() to anon, authenticated, service_role;

/* A PLATFORM ADMINISTRATOR moves a section between the free and the paid, and words its teaser. Only seeded
   keys; a blank title or no lines put the page's own words back. Audited, as every platform setting. */
create or replace function public.platform_set_gate(p_key text, p_gate text, p_title text default null, p_lines text[] default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_lines text[];
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.access_gates where key = p_key) then
    raise exception 'no such section: %', p_key using errcode = '22023';
  end if;
  if p_gate is null or p_gate not in ('free', 'analytics', 'club_report', 'player_report') then
    raise exception 'a section opens with free, analytics, club_report or player_report' using errcode = '22023';
  end if;
  select array_agg(btrim(l)) into v_lines from unnest(coalesce(p_lines, '{}'::text[])) l where btrim(l) <> '';
  update public.access_gates
     set gate = p_gate, title = nullif(btrim(coalesce(p_title, '')), ''), lines = v_lines,
         updated_at = now(), updated_by = auth.uid()
   where key = p_key;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'access_gate', 'gate', p_key, jsonb_build_object('gate', p_gate, 'title', p_title, 'lines', to_jsonb(v_lines)));
  return 'saved';
end $$;
revoke all on function public.platform_set_gate(text, text, text, text[]) from public;
grant execute on function public.platform_set_gate(text, text, text, text[]) to authenticated;

/* THE DATABASE'S OWN GATES FOLLOW THE ROWS. The events splits (0190): */
create or replace function public.game_analytics_ok(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.gate_open('events', public.game_league_id(p_game));
$$;
revoke all on function public.game_analytics_ok(uuid) from public;
grant execute on function public.game_analytics_ok(uuid) to anon, authenticated, service_role;

/* ...and What wins and the Front office's files (0213), the model's row, as 0213 otherwise */
create or replace function public.analytics_check(p_scope text, p_league uuid, p_season uuid, p_team uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.analytics_signin_required() and auth.uid() is null then return 'signin'; end if;
  if p_scope is null or p_scope not in ('wins', 'fo', 'club', 'pos', 'mix') then return 'scope'; end if;
  if p_league is null then
    if p_scope <> 'wins' or p_season is not null or p_team is not null then return 'scope'; end if;
    if not public.gate_open('model', null) then return 'members'; end if;
    return 'ok';
  end if;
  if not public.can_view_league(p_league) then return 'league'; end if;
  if not public.gate_open('model', p_league) then return 'members'; end if;
  if p_season is not null and not exists (select 1 from public.seasons s where s.id = p_season and s.league_id = p_league)
    then return 'league'; end if;
  if p_scope = 'mix' and p_team is not null then return 'scope'; end if;
  if p_scope in ('club', 'pos') then
    if p_team is null then return 'scope'; end if;
    if not exists (select 1 from public.games g join public.competitions c on c.id = g.competition_id
                     join public.seasons s on s.id = c.season_id
                    where s.league_id = p_league and (p_season is null or s.id = p_season)
                      and (g.home_team_id = p_team or g.away_team_id = p_team)) then return 'league'; end if;
  end if;
  return 'ok';
end $$;
revoke all on function public.analytics_check(text, uuid, uuid, uuid) from public;
grant execute on function public.analytics_check(text, uuid, uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
