-- 0106  Fans, their favourites, and what the platform tells them.
--
-- Until now an account was a role: a manager, an administrator, a statistician. A fan had
-- nothing to sign in for. This gives them a profile -- favourite clubs and players, a colour,
-- light or dark -- and a stream of notifications the platform writes FOR them:
--
--   result        a favourite club's game finished (the score)
--   player        a favourite player's line from a finished game
--   fixture       a favourite club plays within three days, and again on the day
--   announcement  a league administrator's notice to the league's fans
--   message       a league administrator's message to the clubs' managers
--
-- The rows are written by three fan-outs (notify_game_final from finalise-game,
-- notify_fixtures from the ingest's every pass, post_announcement from the admin console)
-- and read by the bell on every page. Delivery beyond the bell -- email, phone push -- is the
-- notify edge function's job; it marks each row as it goes out, so nothing is sent twice.

-- ---------------------------------------------------------------- the profile
create table if not exists public.fan_prefs (
  user_id            uuid primary key references auth.users on delete cascade,
  theme              text not null default 'dark' check (theme in ('dark', 'light')),
  colour             text not null default '#93f2bf',
  fav_team_ids       uuid[] not null default '{}',
  fav_player_ids     uuid[] not null default '{}',
  notify_inapp       boolean not null default true,
  notify_email       boolean not null default false,
  notify_push        boolean not null default false,
  want_results       boolean not null default true,
  want_players       boolean not null default true,
  want_fixtures      boolean not null default true,
  want_announcements boolean not null default true,
  updated_at         timestamptz not null default now()
);
alter table public.fan_prefs enable row level security;
drop policy if exists fan_prefs_own on public.fan_prefs;
create policy fan_prefs_own on public.fan_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.fan_prefs to authenticated;

-- one call from the profile page: whatever keys arrive are set, the rest stay
create or replace function public.set_fan_prefs(p jsonb)
returns public.fan_prefs language plpgsql security invoker set search_path = public as $$
declare r public.fan_prefs;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update fan_prefs set
    theme              = coalesce(p->>'theme', theme),
    colour             = coalesce(p->>'colour', colour),
    fav_team_ids       = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_team_ids') x), fav_team_ids),
    fav_player_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p->'fav_player_ids') x), fav_player_ids),
    notify_inapp       = coalesce((p->>'notify_inapp')::boolean, notify_inapp),
    notify_email       = coalesce((p->>'notify_email')::boolean, notify_email),
    notify_push        = coalesce((p->>'notify_push')::boolean, notify_push),
    want_results       = coalesce((p->>'want_results')::boolean, want_results),
    want_players       = coalesce((p->>'want_players')::boolean, want_players),
    want_fixtures      = coalesce((p->>'want_fixtures')::boolean, want_fixtures),
    want_announcements = coalesce((p->>'want_announcements')::boolean, want_announcements),
    updated_at = now()
   where user_id = auth.uid()
  returning * into r;
  -- an empty array arrives as [] and must clear, not keep
  if p ? 'fav_team_ids' and jsonb_array_length(p->'fav_team_ids') = 0 then
    update fan_prefs set fav_team_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  if p ? 'fav_player_ids' and jsonb_array_length(p->'fav_player_ids') = 0 then
    update fan_prefs set fav_player_ids = '{}' where user_id = auth.uid() returning * into r;
  end if;
  return r;
end $$;
revoke all on function public.set_fan_prefs(jsonb) from public, anon;
grant execute on function public.set_fan_prefs(jsonb) to authenticated;

-- ---------------------------------------------------------------- the stream
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  kind       text not null check (kind in ('result', 'player', 'fixture', 'announcement', 'message')),
  title      text not null,
  body       text not null default '',
  link       text,
  league_id  uuid references public.leagues on delete cascade,
  game_id    uuid references public.games on delete cascade,
  ref        text not null,                       -- one per (user, kind, ref): the fan-outs are idempotent
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  emailed_at timestamptz,
  pushed_at  timestamptz,
  unique (user_id, kind, ref)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_mark_own on public.notifications;
create policy notifications_mark_own on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, update (read_at) on public.notifications to authenticated;

-- the phone: a Web Push subscription per browser, in the fan's own row
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------- announcements
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues on delete cascade,
  team_id    uuid references public.teams on delete cascade,      -- a message to one club's managers
  title      text not null,
  body       text not null default '',
  audience   text not null check (audience in ('fans', 'club_admins', 'all')),
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index if not exists announcements_league_idx on public.announcements (league_id, created_at desc);
alter table public.announcements enable row level security;
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select using (
  (audience in ('fans', 'all') and team_id is null)
  or (audience in ('club_admins', 'all') and (team_id is null or public.is_team_manager(team_id)))
  or public.is_league_admin(league_id) or public.is_platform_admin()
);
grant select on public.announcements to anon, authenticated;

-- ---------------------------------------------------------------- the fan-outs
-- the league a game belongs to
create or replace function public.game_league(p_game uuid)
returns uuid language sql stable set search_path = public as $$
  select s.league_id from games g join competitions c on c.id = g.competition_id
    join seasons s on s.id = c.season_id where g.id = p_game;
$$;

-- A GAME FINISHED. Everyone who follows either club gets the score; everyone who follows a
-- player in it gets his line. Written by finalise-game (service role); safe to call twice.
create or replace function public.notify_game_final(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare g record; h record; w record; lg uuid; n int := 0; c int; title text; link text; comp text;
begin
  select * into g from games where id = p_game;
  if not found or g.status not in ('final', 'finalising') then return 0; end if;
  select * into h from teams where id = g.home_team_id;
  select * into w from teams where id = g.away_team_id;
  lg := game_league(p_game);
  select name into comp from competitions where id = g.competition_id;
  title := coalesce(h.name, 'Home') || ' ' || coalesce(g.home_score, 0) || '–' || coalesce(g.away_score, 0) || ' ' || coalesce(w.name, 'Away');
  link := 'game/?g=' || g.id || '&mode=supabase';

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'result', title, coalesce(comp, 'Final score'), link, lg, g.id, g.id::text
    from fan_prefs p
   where p.want_results and (g.home_team_id = any(p.fav_team_ids) or g.away_team_id = any(p.fav_team_ids))
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'player',
         trim(pl.first_name || ' ' || pl.last_name) || ': ' ||
           coalesce((s.stats->>'pts')::int, 0) || ' pts, ' ||
           (coalesce((s.stats->>'or')::int, 0) + coalesce((s.stats->>'dr')::int, 0)) || ' reb, ' ||
           coalesce((s.stats->>'ast')::int, 0) || ' ast',
         title, link || '&vp=' || pl.id, lg, g.id, g.id::text || ':' || pl.id
    from fan_prefs p
    join players pl on pl.id = any(p.fav_player_ids) and not pl.is_minor
    join player_game_stats s on s.game_id = g.id and s.player_id = pl.id::text
   where p.want_players
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_game_final(uuid) from public, anon, authenticated;

-- A GAME IS COMING. Three days out, and again on the day. Run by the ingest on every pass.
create or replace function public.notify_fixtures()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  insert into notifications (user_id, kind, title, body, link, league_id, game_id, ref)
  select p.user_id, 'fixture',
         coalesce(h.name, 'Home') || ' v ' || coalesce(w.name, 'Away'),
         to_char(g.tipoff_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || coalesce(' · ' || g.venue, ''),
         'game/?g=' || g.id || '&mode=supabase', game_league(g.id), g.id,
         g.id::text || case when g.tipoff_at < now() + interval '26 hours' then ':today' else ':soon' end
    from games g
    join teams h on h.id = g.home_team_id
    join teams w on w.id = g.away_team_id
    join fan_prefs p on p.want_fixtures and (g.home_team_id = any(p.fav_team_ids) or g.away_team_id = any(p.fav_team_ids))
   where g.status = 'scheduled' and g.tipoff_at > now() and g.tipoff_at < now() + interval '3 days'
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.notify_fixtures() from public, anon, authenticated;

-- A LEAGUE SPEAKS. To its fans (everyone with a favourite in it), to its clubs' managers, or
-- to one club's managers; the admin console calls this.
create or replace function public.post_announcement(p_league uuid, p_title text, p_body text, p_audience text, p_team uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a_id uuid; lname text;
begin
  if not (public.is_league_admin(p_league) or public.is_platform_admin()) then
    raise exception 'not your league' using errcode = '42501';
  end if;
  if p_audience not in ('fans', 'club_admins', 'all') then
    raise exception 'audience is fans, club_admins or all' using errcode = '22023';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'a title is needed' using errcode = '22023'; end if;
  select name into lname from leagues where id = p_league;
  insert into announcements (league_id, team_id, title, body, audience, created_by)
  values (p_league, p_team, trim(p_title), coalesce(p_body, ''), p_audience, auth.uid())
  returning id into a_id;

  if p_audience in ('fans', 'all') and p_team is null then
    insert into notifications (user_id, kind, title, body, link, league_id, ref)
    select distinct p.user_id, 'announcement', trim(p_title), left(coalesce(p_body, ''), 400),
           '?l=' || (select slug from leagues where id = p_league), p_league, a_id::text
      from fan_prefs p
     where p.want_announcements
       and exists (select 1 from teams t where t.league_id = p_league and t.id = any(p.fav_team_ids))
    on conflict do nothing;
  end if;
  if p_audience in ('club_admins', 'all') then
    insert into notifications (user_id, kind, title, body, link, league_id, ref)
    select distinct m.user_id, 'message', 'From ' || coalesce(lname, 'the league') || ': ' || trim(p_title),
           left(coalesce(p_body, ''), 400), 'app/', p_league, a_id::text
      from memberships m
      join teams t on t.id = m.scope_id and t.league_id = p_league
     where m.role = 'team_manager' and m.scope_type = 'team'
       and (p_team is null or t.id = p_team)
    on conflict do nothing;
  end if;
  return a_id;
end $$;
revoke all on function public.post_announcement(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.post_announcement(uuid, text, text, text, uuid) to authenticated;

-- the players a fan may follow: the league's rostered, non-minor players, by name
create or replace function public.fan_player_search(p_league uuid, p_q text)
returns table (id uuid, name text, team_name text, team_id uuid) language sql stable security definer set search_path = public as $$
  select distinct pl.id, trim(pl.first_name || ' ' || pl.last_name), t.name, t.id
    from players pl
    join roster_entries r on r.player_id = pl.id and r.active
    join teams t on t.id = r.team_id and t.league_id = p_league
   where not pl.is_minor
     and (coalesce(p_q, '') = '' or lower(pl.first_name || ' ' || pl.last_name) like '%' || lower(p_q) || '%')
   order by 2
   limit 40;
$$;
grant execute on function public.fan_player_search(uuid, text) to anon, authenticated;
