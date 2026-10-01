-- ============================================================================
-- 0209 -- WHAT WINS 2: THE FEATURE LINE AND THE MEMBERS-ONLY MODEL FILES (docs/what-wins-model.md §5, §10, A.1, A.2).
--
-- (The spec calls this file 0207_what_wins.sql; main already had 0207 and 0208, so it is the next free number.)
--
--   game_features        every finished game reduced once to 108 counts a side (epinoia/features.js), written by
--                        finalise-game and scripts/backfill_features.mjs, read by the model builder. The service role
--                        only: RLS on, no policy, nothing granted to anon or authenticated (I2). `st` carries each
--                        side's stints compactly (A.1) so the builder can re-rank positions without the log.
--   game_features_missing(fv, limit)   the final games without two rows of at least that layout (the backfill's list).
--   bucket 'analytics'   PRIVATE, and deliberately no storage.objects policy naming it: a file leaves only through a
--                        120-second signed URL that the analytics-file function issues after asking the database (I3).
--   analytics_files      the index of built files: one row per (scope, league, season, team), its object path and token.
--   analytics_issue_log  one row per file handed out, for the per-user / per-IP limits; pruned after 30 days.
--   analytics_signin_required()   platform_settings 'analytics_signin' = true: a signed-in account is needed even while
--                        memberships are switched off (open question 1; default off, which follows today's rule).
--   analytics_open_leagues()      the leagues whose analytics are open to everyone, as configured (I4, I5).
--   analytics_check(scope, league, season, team)   'ok' | 'signin' | 'members' | 'league' | 'scope'. Run with the
--                        CALLER's token, so it is the database that decides, at request time, every time.
--   analytics_take(subject, signed, scope, league)  the rate limit: 60 an hour and 400 a day signed in, 20 and 100
--                        signed out; refuses with retry_after, else logs the issue.
--   analytics_issue_prune(days)   deletes log rows older than that (30 by default).
--   analytics_refresh    A.2's RECALCULATE: one row per league-season, so one refresh runs per unit per ten minutes for
--                        everybody (a second press joins the first), a per-user limit, and `due` for a refresh that
--                        could not finish in the function so the next scheduled build takes the unit first.
--
-- Every function is security definer with search_path = public, and every revoke and grant is written out.
-- No RAISE anywhere (migration-lint), and no self-test against live rows.
-- ============================================================================

-- --------------------------------------------------------------------------- the feature line
create table if not exists public.game_features (
  game_id uuid not null references public.games on delete cascade,
  team_idx smallint not null check (team_idx in (0, 1)),
  fv smallint not null,
  f real[] not null,
  q integer not null default 0,
  st jsonb,                                      -- A.1: {p: [player ids], s: [[seconds, i1..i5], ...]}
  league_id uuid not null references public.leagues on delete cascade,
  season_id uuid not null references public.seasons on delete cascade,
  competition_id uuid not null references public.competitions on delete cascade,
  finalised_at timestamptz not null,
  built_at timestamptz not null default now(),
  primary key (game_id, team_idx)
);
alter table public.game_features add column if not exists st jsonb;
create index if not exists game_features_unit on public.game_features (league_id, season_id, fv, finalised_at, game_id);
alter table public.game_features enable row level security;
revoke all on public.game_features from public;
revoke all on public.game_features from anon, authenticated;
grant all on public.game_features to service_role;

create or replace function public.game_features_missing(p_fv int, p_limit int default 500)
returns setof uuid language sql stable security definer set search_path = public as $$
  select g.id from public.games g
   where g.status = 'final' and g.competition_id is not null
     and (select count(*) from public.game_features f where f.game_id = g.id and f.fv >= p_fv) < 2
   order by g.finalised_at nulls last, g.id
   limit greatest(1, least(coalesce(p_limit, 500), 5000)) $$;
revoke all on function public.game_features_missing(int, int) from public;
revoke all on function public.game_features_missing(int, int) from anon, authenticated;
grant execute on function public.game_features_missing(int, int) to service_role;

-- --------------------------------------------------------------------------- the private bucket
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('analytics', 'analytics', false, array['application/json'], 104857600)
on conflict (id) do update set public = false, allowed_mime_types = array['application/json'], file_size_limit = 104857600;
-- deliberately no storage.objects policy naming 'analytics': only the service role reads or writes it

-- --------------------------------------------------------------------------- the index of built files
create table if not exists public.analytics_files (
  scope text not null check (scope in ('wins', 'fo', 'club', 'pos', 'store', 'priors', 'teaser')),
  league_key text not null,            -- league uuid or 'all'
  season_key text not null,            -- season uuid or 'current'
  team_key text not null default '',   -- team uuid for 'club' and 'pos'
  league_id uuid references public.leagues on delete cascade,
  season_id uuid references public.seasons on delete cascade,
  team_id uuid references public.teams on delete cascade,
  is_current boolean not null default false,
  path text not null,                  -- the object's path inside the 'analytics' bucket
  token text not null,
  layout int not null,
  fv int not null,
  bytes int,
  n_games int,
  built_at timestamptz not null default now(),
  ci_at timestamptz,                   -- A.2: when the intervals were last bootstrapped (a refresh carries them)
  primary key (scope, league_key, season_key, team_key)
);
alter table public.analytics_files add column if not exists ci_at timestamptz;
create index if not exists analytics_files_current on public.analytics_files (scope, league_key, team_key) where is_current;
alter table public.analytics_files enable row level security;
revoke all on public.analytics_files from public;
revoke all on public.analytics_files from anon, authenticated;
grant all on public.analytics_files to service_role;

-- --------------------------------------------------------------------------- the issue log (rate limits)
create table if not exists public.analytics_issue_log (
  id bigserial primary key,
  subject text not null,               -- 'u:<user id>' or 'ip:<sha-256 prefix>'
  scope text not null,
  league_key text not null default '',
  at timestamptz not null default now()
);
create index if not exists analytics_issue_log_subject on public.analytics_issue_log (subject, at);
alter table public.analytics_issue_log enable row level security;
revoke all on public.analytics_issue_log from public;
revoke all on public.analytics_issue_log from anon, authenticated;
grant all on public.analytics_issue_log to service_role;
revoke all on sequence public.analytics_issue_log_id_seq from public;
revoke all on sequence public.analytics_issue_log_id_seq from anon, authenticated;
grant all on sequence public.analytics_issue_log_id_seq to service_role;

-- --------------------------------------------------------------------------- who may have a file
create or replace function public.analytics_signin_required()  -- platform_settings 'analytics_signin' = true
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.value = 'true'::jsonb from public.platform_settings s where s.key = 'analytics_signin'), false) $$;
revoke all on function public.analytics_signin_required() from public;
grant execute on function public.analytics_signin_required() to anon, authenticated, service_role;

create or replace function public.analytics_open_leagues()       -- analytics open to everyone, as configured
returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from public.leagues l
   where coalesce(l.visibility, 'public') = 'public' and l.access_mode = 'open'
     and public.access_analytics_configured(l.id) = 'free' $$;
revoke all on function public.analytics_open_leagues() from public;
revoke all on function public.analytics_open_leagues() from anon, authenticated;
grant execute on function public.analytics_open_leagues() to service_role;

-- 'pos' (A.1: a team-season's minutes at each slot) is a club's file and is checked exactly as 'club' is
create or replace function public.analytics_check(p_scope text, p_league uuid, p_season uuid, p_team uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.analytics_signin_required() and auth.uid() is null then return 'signin'; end if;
  if p_scope is null or p_scope not in ('wins', 'fo', 'club', 'pos') then return 'scope'; end if;
  if p_league is null then
    if p_scope <> 'wins' or p_season is not null or p_team is not null then return 'scope'; end if;
    if public.memberships_enabled() and not public.can_use_analytics(null) then return 'members'; end if;
    return 'ok';
  end if;
  if not public.can_view_league(p_league) then return 'league'; end if;
  if public.memberships_enabled()
     and not (public.can_use_analytics(p_league) or coalesce(public.is_league_admin(p_league), false)) then
    return 'members'; end if;
  if p_season is not null and not exists (select 1 from public.seasons s where s.id = p_season and s.league_id = p_league)
    then return 'league'; end if;
  if p_scope in ('club', 'pos') then
    if p_team is null then return 'scope'; end if;
    if not exists (select 1 from public.games g join public.competitions c on c.id = g.competition_id
                     join public.seasons s on s.id = c.season_id
                    where s.league_id = p_league and (p_season is null or s.id = p_season)
                      and (g.home_team_id = p_team or g.away_team_id = p_team)) then return 'league'; end if;
  end if;
  return 'ok';
end $$;
-- called with the CALLER's token, so the signed-out and the signed-in may both ask it
revoke all on function public.analytics_check(text, uuid, uuid, uuid) from public;
grant execute on function public.analytics_check(text, uuid, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.analytics_take(p_subject text, p_signed boolean, p_scope text, p_league text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare lim_h int := case when p_signed then 60 else 20 end; lim_d int := case when p_signed then 400 else 100 end;
        used_h int; used_d int; first_h timestamptz; first_d timestamptz;
begin
  select count(*) filter (where at > now() - interval '1 hour'), count(*),
         min(at) filter (where at > now() - interval '1 hour'), min(at)
    into used_h, used_d, first_h, first_d
    from public.analytics_issue_log where subject = p_subject and scope <> 'refresh' and at > now() - interval '1 day';
  if used_h >= lim_h or used_d >= lim_d then
    return jsonb_build_object('ok', false, 'used_hour', used_h, 'limit_hour', lim_h, 'used_day', used_d, 'limit_day', lim_d,
      'retry_after', greatest(1, ceil(extract(epoch from (case when used_h >= lim_h then first_h + interval '1 hour'
                                                          else first_d + interval '1 day' end) - now()))::int));
  end if;
  insert into public.analytics_issue_log (subject, scope, league_key) values (p_subject, p_scope, coalesce(p_league, ''));
  return jsonb_build_object('ok', true, 'used_hour', used_h + 1, 'limit_hour', lim_h, 'used_day', used_d + 1, 'limit_day', lim_d);
end $$;
revoke all on function public.analytics_take(text, boolean, text, text) from public;
revoke all on function public.analytics_take(text, boolean, text, text) from anon, authenticated;
grant execute on function public.analytics_take(text, boolean, text, text) to service_role;

create or replace function public.analytics_issue_prune(p_days int default 30) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare n int; begin
  delete from public.analytics_issue_log where at < now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
  get diagnostics n = row_count; return n; end $$;
revoke all on function public.analytics_issue_prune(int) from public;
revoke all on function public.analytics_issue_prune(int) from anon, authenticated;
grant execute on function public.analytics_issue_prune(int) to service_role;

-- --------------------------------------------------------------------------- A.2: RECALCULATE
create table if not exists public.analytics_refresh (
  league_id uuid not null references public.leagues on delete cascade,
  season_id uuid not null references public.seasons on delete cascade,
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'idle',  -- idle | running | done | queued | failed
  by_subject text,
  due boolean not null default false,   -- a refresh that could not finish: the next scheduled build takes the unit first
  primary key (league_id, season_id)
);
alter table public.analytics_refresh enable row level security;
revoke all on public.analytics_refresh from public;
revoke all on public.analytics_refresh from anon, authenticated;
grant all on public.analytics_refresh to service_role;

-- May this subject start a refresh of this unit now? {ok: true} (and it is logged), or {ok: false, state}:
-- 'rate' (this subject's own limit: 6 an hour, 20 a day), 'running' (somebody's refresh of the unit is under way:
-- join it), 'recent' (one finished under ten minutes ago: its file is the answer). A refresh that died without
-- saying so is taken over once its ten minutes are up.
create or replace function public.analytics_refresh_take(p_subject text, p_league uuid, p_season uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.analytics_refresh%rowtype; used_h int; used_d int; first_h timestamptz; first_d timestamptz;
begin
  select count(*) filter (where at > now() - interval '1 hour'), count(*),
         min(at) filter (where at > now() - interval '1 hour'), min(at)
    into used_h, used_d, first_h, first_d
    from public.analytics_issue_log where subject = p_subject and scope = 'refresh' and at > now() - interval '1 day';
  if used_h >= 6 or used_d >= 20 then
    return jsonb_build_object('ok', false, 'state', 'rate',
      'retry_after', greatest(1, ceil(extract(epoch from (case when used_h >= 6 then first_h + interval '1 hour'
                                                          else first_d + interval '1 day' end) - now()))::int));
  end if;
  insert into public.analytics_refresh (league_id, season_id) values (p_league, p_season) on conflict do nothing;
  select * into r from public.analytics_refresh where league_id = p_league and season_id = p_season for update;
  if r.started_at is not null and r.started_at > now() - interval '10 minutes' then
    if r.finished_at is null then
      return jsonb_build_object('ok', false, 'state', 'running', 'started_at', r.started_at);
    end if;
    return jsonb_build_object('ok', false, 'state', 'recent', 'status', r.status,
      'retry_after', greatest(1, ceil(extract(epoch from (r.started_at + interval '10 minutes' - now())))::int));
  end if;
  update public.analytics_refresh set started_at = now(), finished_at = null, status = 'running', by_subject = p_subject
   where league_id = p_league and season_id = p_season;
  insert into public.analytics_issue_log (subject, scope, league_key) values (p_subject, 'refresh', p_league::text);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.analytics_refresh_take(text, uuid, uuid) from public;
revoke all on function public.analytics_refresh_take(text, uuid, uuid) from anon, authenticated;
grant execute on function public.analytics_refresh_take(text, uuid, uuid) to service_role;

-- How it ended: 'done', 'failed', or 'queued' (left for the next scheduled build, which clears `due`).
create or replace function public.analytics_refresh_done(p_league uuid, p_season uuid, p_status text)
returns void language sql volatile security definer set search_path = public as $$
  update public.analytics_refresh
     set finished_at = now(),
         status = case when p_status in ('done', 'failed', 'queued') then p_status else 'failed' end,
         due = due or p_status = 'queued'
   where league_id = p_league and season_id = p_season $$;
revoke all on function public.analytics_refresh_done(uuid, uuid, text) from public;
revoke all on function public.analytics_refresh_done(uuid, uuid, text) from anon, authenticated;
grant execute on function public.analytics_refresh_done(uuid, uuid, text) to service_role;
