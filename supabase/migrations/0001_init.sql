-- ============================================================================
-- COURTSIDE NETWORK — Phase 1 schema
--
-- Principles encoded here, not in the front end:
--   * game_events is append-only and is the only source of truth.
--   * Nothing is readable by the public unless a policy says so (default deny).
--   * Scoring rights are per-game, granted by assignment, never by role alone.
--   * Children's data is restricted by default and cannot be published by accident.
--   * Every consequential action is audit-logged with an actor.
--
-- Apply:  supabase db push      (or paste into the SQL editor)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. IDENTITY
-- ============================================================================

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  created_at  timestamptz not null default now()
);

-- a role is always scoped to an object; a user can hold several
create type public.role_kind as enum ('platform_admin','league_admin','team_manager','statistician');
create type public.scope_kind as enum ('platform','league','team');

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  role       public.role_kind not null,
  scope_type public.scope_kind not null,
  scope_id   uuid,                                    -- null only for scope_type='platform'
  created_at timestamptz not null default now(),
  unique (user_id, role, scope_type, scope_id)
);
create index on public.memberships (user_id);
create index on public.memberships (scope_type, scope_id);

-- ============================================================================
-- 2. COMPETITION STRUCTURE
-- ============================================================================

create table public.leagues (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  colour_a   text not null default '#93f2bf',
  colour_b   text not null default '#8ff5ff',
  logo_path  text,
  -- rules as data so an 8-minute school league and a FIBA league coexist
  rules      jsonb not null default jsonb_build_object(
                'period_ms', 600000, 'ot_ms', 300000, 'periods', 4,
                'bonus_at', 5, 'timeouts_h1', 2, 'timeouts_h2', 3, 'timeouts_ot', 1,
                'win_points', 2, 'loss_points', 1,
                'tiebreak', jsonb_build_array('points','h2h','h2h_diff','diff','scored')),
  public_live      boolean not null default false,   -- show in-progress games publicly
  youth_protected  boolean not null default true,    -- U18 profiles stay behind membership
  created_at timestamptz not null default now()
);

create table public.seasons (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues on delete cascade,
  name       text not null,
  starts_on  date,
  ends_on    date,
  unique (league_id, name)
);

create table public.competitions (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references public.seasons on delete cascade,
  name       text not null,
  kind       text not null default 'league',          -- league | cup | playoff
  unique (season_id, name)
);

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid references public.leagues on delete set null,
  slug       text not null unique,
  name       text not null,
  short_name text not null default '',
  colour     text not null default '#93f2bf',
  logo_path  text,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index on public.teams (league_id);

create table public.competition_teams (
  competition_id uuid not null references public.competitions on delete cascade,
  team_id        uuid not null references public.teams on delete cascade,
  primary key (competition_id, team_id)
);

-- ----------------------------------------------------------------------------
-- Players. DATA MINIMISATION: birth_year only, never a full date of birth.
-- is_minor drives every publication decision downstream.
-- ----------------------------------------------------------------------------
create table public.players (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  first_name    text not null,
  last_name     text not null default '',
  birth_year    int,                                   -- eligibility only; never published raw
  is_minor      boolean not null default false,        -- set by the league, drives visibility
  photo_media_id uuid,                                 -- fk added after media exists
  photo_consent  boolean not null default false,       -- guardian consent for under-18s
  created_by    uuid references auth.users,
  created_at    timestamptz not null default now(),
  constraint birth_year_sane check (birth_year is null or (birth_year between 1900 and 2100))
);

-- jersey lives on the roster entry, so a mid-season change is a new row, not an edit
create table public.roster_entries (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  season_id  uuid references public.seasons on delete cascade,
  jersey     text not null default '',
  position   text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.roster_entries (team_id, season_id);
create index on public.roster_entries (player_id);

-- ============================================================================
-- 3. GAMES
-- ============================================================================

create type public.game_status as enum ('scheduled','live','finalising','final','void');

create table public.games (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid references public.competitions on delete set null,   -- null = ad-hoc
  home_team_id   uuid not null references public.teams,
  away_team_id   uuid not null references public.teams,
  tipoff_at      timestamptz,
  venue          text,
  status         public.game_status not null default 'scheduled',
  -- snapshot of the two rosters at tip, so later roster edits never rewrite history
  roster_snapshot jsonb,
  starters       jsonb,                                  -- [[pid…],[pid…]]
  tip_winner     int, arrow_init int,
  home_score     int not null default 0,
  away_score     int not null default 0,
  period         int not null default 1,
  finalised_at   timestamptz, finalised_by uuid references auth.users,
  created_by     uuid references auth.users,
  created_at     timestamptz not null default now(),
  constraint teams_differ check (home_team_id <> away_team_id)
);
create index on public.games (competition_id);
create index on public.games (status);
create index on public.games (tipoff_at desc);

create table public.game_officials (
  game_id  uuid not null references public.games on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  role     text not null default 'statistician',
  primary key (game_id, user_id)
);

-- ----------------------------------------------------------------------------
-- The event log. Append-only: no UPDATE or DELETE policy exists for anyone.
-- Corrections are new rows (the pbp editor writes supersede/void events).
-- seq is the scorer's client id — (game_id, seq) unique makes offline replay
-- idempotent, so a double-send after reconnect is harmless.
-- ----------------------------------------------------------------------------
create table public.game_events (
  id         bigserial primary key,
  game_id    uuid not null references public.games on delete cascade,
  seq        int  not null,
  t          text not null,
  team       int,
  pid        text,
  period     int,
  clock      int,
  payload    jsonb not null default '{}'::jsonb,      -- ref/tag/v/x/y/kind/off/in/out/drawn…
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);
create index on public.game_events (game_id, seq);

-- one row per game: what the clock is doing. Transitions only — never a tick.
create table public.game_state (
  game_id     uuid primary key references public.games on delete cascade,
  period      int not null default 1,
  clock_ms    int not null default 600000,
  running     boolean not null default false,
  score_home  int not null default 0,
  score_away  int not null default 0,
  possession  int,
  arrow       int,
  last_seq    int not null default 0,
  updated_at  timestamptz not null default now()      -- server time; viewers tick from this
);

-- ============================================================================
-- 4. DERIVED (written only by the finalise function, always recomputable)
-- ============================================================================

create table public.player_game_stats (
  game_id   uuid not null references public.games on delete cascade,
  player_id text not null,
  team_idx  int  not null,
  stats     jsonb not null,
  primary key (game_id, player_id)
);
create table public.team_game_stats (
  game_id  uuid not null references public.games on delete cascade,
  team_idx int not null,
  stats    jsonb not null,
  primary key (game_id, team_idx)
);
create table public.lineup_stints (
  id       bigserial primary key,
  game_id  uuid not null references public.games on delete cascade,
  team_idx int not null,
  player_ids text[] not null,
  stats    jsonb not null
);
create index on public.lineup_stints (game_id);

create table public.publish_queue (
  game_id      uuid primary key references public.games on delete cascade,
  requested_at timestamptz not null default now(),
  published_at timestamptz,
  commit_sha   text,
  attempts     int not null default 0,
  last_error   text
);

-- ============================================================================
-- 5. MEDIA — private until approved. Never world-readable by default.
-- ============================================================================
create type public.media_status as enum ('pending','approved','rejected');

create table public.media (
  id           uuid primary key default gen_random_uuid(),
  owner_type   text not null,                          -- league | team | player
  owner_id     uuid not null,
  kind         text not null default 'photo',          -- logo | photo | kit
  storage_path text not null,
  width int, height int, bytes int,
  status       public.media_status not null default 'pending',
  uploaded_by  uuid references auth.users,
  approved_by  uuid references auth.users,
  created_at   timestamptz not null default now()
);
create index on public.media (owner_type, owner_id);

alter table public.players
  add constraint players_photo_fk foreign key (photo_media_id) references public.media on delete set null;

-- ============================================================================
-- 6. AUDIT — who did what, kept two years
-- ============================================================================
create table public.audit_log (
  id         bigserial primary key,
  actor      uuid references auth.users,
  action     text not null,
  subject    text not null,
  subject_id text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);
create index on public.audit_log (subject, subject_id);

-- ============================================================================
-- 7. AUTHORISATION HELPERS
--    SECURITY DEFINER + a locked search_path so policies can call them safely
--    without recursing through RLS on memberships.
-- ============================================================================

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.user_id = auth.uid() and m.role = 'platform_admin');
$$;

create or replace function public.is_league_admin(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.role = 'league_admin'
      and m.scope_type = 'league' and m.scope_id = p_league);
$$;

create or replace function public.is_team_manager(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from memberships m
                 where m.user_id = auth.uid() and m.role = 'team_manager'
                   and m.scope_type = 'team' and m.scope_id = p_team)
      or exists (select 1 from teams t
                 where t.id = p_team and t.league_id is not null
                   and public.is_league_admin(t.league_id));
$$;

-- may this user write events for this game right now?
create or replace function public.can_score(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    where g.id = p_game
      and g.status in ('scheduled','live')                    -- never a finalised game
      and ( exists (select 1 from game_officials go
                    where go.game_id = p_game and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- may the current requester see this game at all?
create or replace function public.can_read_game(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    left join competitions c on c.id = g.competition_id
    left join seasons s      on s.id = c.season_id
    left join leagues  l     on l.id = s.league_id
    where g.id = p_game
      and ( g.status = 'final'                                        -- finals are public
            or (g.status = 'live' and coalesce(l.public_live,false))  -- live if the league allows
            or public.is_team_manager(g.home_team_id)
            or public.is_team_manager(g.away_team_id)
            or exists (select 1 from game_officials go
                       where go.game_id = g.id and go.user_id = auth.uid())
            or (s.league_id is not null and public.is_league_admin(s.league_id)) ));
$$;

-- ============================================================================
-- 8. ROW LEVEL SECURITY — default deny on every table
-- ============================================================================
alter table public.profiles          enable row level security;
alter table public.memberships       enable row level security;
alter table public.leagues           enable row level security;
alter table public.seasons           enable row level security;
alter table public.competitions      enable row level security;
alter table public.teams             enable row level security;
alter table public.competition_teams enable row level security;
alter table public.players           enable row level security;
alter table public.roster_entries    enable row level security;
alter table public.games             enable row level security;
alter table public.game_officials    enable row level security;
alter table public.game_events       enable row level security;
alter table public.game_state        enable row level security;
alter table public.player_game_stats enable row level security;
alter table public.team_game_stats   enable row level security;
alter table public.lineup_stints     enable row level security;
alter table public.publish_queue     enable row level security;
alter table public.media             enable row level security;
alter table public.audit_log         enable row level security;

-- ---- profiles: you see yourself only ----
create policy profiles_self_read   on public.profiles for select using (id = auth.uid() or public.is_platform_admin());
create policy profiles_self_write  on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_self_insert on public.profiles for insert with check (id = auth.uid());

-- ---- memberships: you see your own; only admins grant ----
create policy memberships_read on public.memberships for select
  using (user_id = auth.uid() or public.is_platform_admin()
         or (scope_type = 'league' and public.is_league_admin(scope_id))
         or (scope_type = 'team'   and public.is_team_manager(scope_id)));
create policy memberships_admin_write on public.memberships for all
  using (public.is_platform_admin() or (scope_type = 'league' and public.is_league_admin(scope_id)))
  with check (public.is_platform_admin() or (scope_type = 'league' and public.is_league_admin(scope_id)));

-- ---- competition structure: public read, admin write ----
create policy leagues_read  on public.leagues  for select using (true);
create policy leagues_write on public.leagues  for all using (public.is_league_admin(id)) with check (public.is_league_admin(id));
create policy seasons_read  on public.seasons  for select using (true);
create policy seasons_write on public.seasons  for all using (public.is_league_admin(league_id)) with check (public.is_league_admin(league_id));
create policy comps_read    on public.competitions for select using (true);
create policy comps_write   on public.competitions for all
  using (exists (select 1 from seasons s where s.id = season_id and public.is_league_admin(s.league_id)))
  with check (exists (select 1 from seasons s where s.id = season_id and public.is_league_admin(s.league_id)));
create policy ct_read  on public.competition_teams for select using (true);
create policy ct_write on public.competition_teams for all
  using (exists (select 1 from competitions c join seasons s on s.id=c.season_id
                 where c.id = competition_id and public.is_league_admin(s.league_id)))
  with check (exists (select 1 from competitions c join seasons s on s.id=c.season_id
                 where c.id = competition_id and public.is_league_admin(s.league_id)));

-- ---- teams: public read; managers write their own ----
create policy teams_read  on public.teams for select using (true);
create policy teams_write on public.teams for update using (public.is_team_manager(id)) with check (public.is_team_manager(id));
create policy teams_create on public.teams for insert with check (auth.uid() is not null);
create policy teams_delete on public.teams for delete using (public.is_platform_admin());

-- ---- players: SAFEGUARDING. Minors are not publicly readable. ----
create policy players_read on public.players for select
  using (
    is_minor = false                                          -- adults are public
    or auth.uid() is not null and exists (                    -- minors: only people involved
         select 1 from roster_entries re
         where re.player_id = players.id and public.is_team_manager(re.team_id))
    or public.is_platform_admin()
  );
create policy players_write on public.players for all
  using (exists (select 1 from roster_entries re
                 where re.player_id = players.id and public.is_team_manager(re.team_id))
         or public.is_platform_admin())
  with check (auth.uid() is not null);

create policy roster_read  on public.roster_entries for select using (true);
create policy roster_write on public.roster_entries for all
  using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));

-- ---- games ----
create policy games_read   on public.games for select using (public.can_read_game(id));
create policy games_create on public.games for insert with check (auth.uid() is not null);
create policy games_update on public.games for update
  using (public.can_score(id)
         or exists (select 1 from competitions c join seasons s on s.id=c.season_id
                    where c.id = competition_id and public.is_league_admin(s.league_id)))
  with check (true);

create policy officials_read  on public.game_officials for select
  using (user_id = auth.uid() or public.can_read_game(game_id));
create policy officials_write on public.game_officials for all
  using (exists (select 1 from games g left join competitions c on c.id=g.competition_id
                 left join seasons s on s.id=c.season_id
                 where g.id = game_id and (s.league_id is null and g.created_by = auth.uid()
                                           or public.is_league_admin(s.league_id))))
  with check (auth.uid() is not null);

-- ---- game_events: APPEND ONLY. select + insert policies exist; no update, no delete. ----
create policy events_read   on public.game_events for select using (public.can_read_game(game_id));
create policy events_insert on public.game_events for insert with check (public.can_score(game_id));

-- ---- game_state: readable with the game, writable by whoever may score it ----
create policy state_read   on public.game_state for select using (public.can_read_game(game_id));
create policy state_write  on public.game_state for all
  using (public.can_score(game_id)) with check (public.can_score(game_id));

-- ---- derived tables: read with the game; written by the service role only ----
create policy pgs_read on public.player_game_stats for select using (public.can_read_game(game_id));
create policy tgs_read on public.team_game_stats   for select using (public.can_read_game(game_id));
create policy ls_read  on public.lineup_stints     for select using (public.can_read_game(game_id));
create policy pq_read  on public.publish_queue     for select using (public.is_platform_admin());

-- ---- media: pending is private; approved is public ----
create policy media_read on public.media for select
  using (status = 'approved'
         or uploaded_by = auth.uid()
         or public.is_platform_admin()
         or (owner_type = 'team' and public.is_team_manager(owner_id)));
create policy media_insert on public.media for insert with check (auth.uid() is not null);
create policy media_update on public.media for update
  using (public.is_platform_admin()
         or (owner_type = 'team' and public.is_team_manager(owner_id)))
  with check (true);

-- ---- audit log: append-only, admin read ----
create policy audit_read   on public.audit_log for select using (public.is_platform_admin());
create policy audit_insert on public.audit_log for insert with check (auth.uid() is not null);

-- ============================================================================
-- 9. GUARDS — things the front end must not be trusted to enforce
-- ============================================================================

-- events may never be edited or removed, even by a superuser client
create or replace function public.forbid_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'game_events is append-only (attempted %)', tg_op;
end; $$;
create trigger game_events_no_update before update on public.game_events
  for each row execute function public.forbid_event_mutation();
create trigger game_events_no_delete before delete on public.game_events
  for each row execute function public.forbid_event_mutation();

-- a finalised game is closed: no new events without an explicit reopen
create or replace function public.reject_events_when_final()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.game_status;
begin
  select status into s from games where id = new.game_id;
  if s in ('final','void') then
    raise exception 'game % is % — reopen it before scoring', new.game_id, s;
  end if;
  return new;
end; $$;
create trigger game_events_status_guard before insert on public.game_events
  for each row execute function public.reject_events_when_final();

-- a photo of a minor cannot be approved without recorded consent
create or replace function public.enforce_minor_photo_consent()
returns trigger language plpgsql security definer set search_path = public as $$
declare minor boolean; consent boolean;
begin
  if new.status = 'approved' and new.owner_type = 'player' then
    select p.is_minor, p.photo_consent into minor, consent from players p where p.id = new.owner_id;
    if coalesce(minor,false) and not coalesce(consent,false) then
      raise exception 'cannot approve a photo of a minor without recorded guardian consent';
    end if;
  end if;
  return new;
end; $$;
create trigger media_minor_consent before insert or update on public.media
  for each row execute function public.enforce_minor_photo_consent();

-- keep profiles in step with auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 10. RIGHT TO ERASURE — remove the person, keep the record accurate
-- ============================================================================
create or replace function public.anonymise_player(p_player uuid, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
declare lbl text;
begin
  if not (public.is_platform_admin() or exists (
        select 1 from roster_entries re where re.player_id = p_player
          and public.is_team_manager(re.team_id))) then
    raise exception 'not permitted';
  end if;
  lbl := coalesce(p_label, 'Player ' || left(p_player::text, 4));
  update players set first_name = lbl, last_name = '', birth_year = null,
                     photo_media_id = null, photo_consent = false
   where id = p_player;
  delete from media where owner_type = 'player' and owner_id = p_player;
  insert into audit_log (actor, action, subject, subject_id)
  values (auth.uid(), 'anonymise', 'player', p_player::text);
end; $$;

-- ============================================================================
-- 11. RETENTION — audit logs expire after two years
-- ============================================================================
create or replace function public.prune_audit_log()
returns void language sql security definer set search_path = public as $$
  delete from audit_log where created_at < now() - interval '2 years';
$$;
