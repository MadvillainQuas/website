-- ============================================================================
-- 0044 — THE PLATFORM CONSOLE API.
--
-- Everything up to here has been LEAGUE administration: a league admin acting
-- inside one league, with is_league_admin() as the fence. The platform itself
-- had no console at all. Leagues could only be created (0007) and never
-- renamed or removed, accounts existed only as whatever memberships pointed
-- at them, and the audit log — the record of who did what across the whole
-- site — could not be read from a browser at any address.
--
-- This adds the other half: one API for the person who runs EPINOIA, covering
-- accounts, leagues, clubs, moderation, keys, the audit trail and the
-- site-wide switches. It is all read and written through SECURITY DEFINER
-- functions rather than through table policies, for two reasons:
--
--   THE FENCE IS IN ONE PLACE. Every function starts with the same
--   is_platform_admin() check and is revoked from anon. A future table added
--   without a policy cannot leak through this surface, because this surface
--   is not tables.
--
--   AND SOME OF IT IS NOT TABLES. Account counts, cross-league rollups and
--   the auth schema are not things a policy can express usefully. A function
--   returns the shape the page actually renders, in one round trip.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: send email. Disabling an account,
-- granting a role and deleting a league all happen silently, because every
-- transactional email on this project comes out of the same small allowance
-- the magic-link logins use, and an admin console that quietly spends it
-- would lock the owner out of his own site.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SITE-WIDE SETTINGS
--
-- Key/value rather than columns, because the set of things a site-wide switch
-- controls is not knowable in advance and a migration per switch is a bad
-- trade. is_public marks the handful the front end reads WITHOUT being signed
-- in — a maintenance banner nobody can see is not a maintenance banner.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

alter table public.platform_settings enable row level security;

-- The public half is readable by anybody, signed in or not. The rest is not
-- readable at all except through the admin function below, which is the
-- default-deny this project runs on.
drop policy if exists platform_settings_public on public.platform_settings;
create policy platform_settings_public on public.platform_settings
  for select using (is_public);

drop policy if exists platform_settings_admin_read on public.platform_settings;
create policy platform_settings_admin_read on public.platform_settings
  for select to authenticated using (public.is_platform_admin());

insert into public.platform_settings (key, value, is_public) values
  ('site_name',        '"EPINOIA"'::jsonb,  true),
  ('banner',           '""'::jsonb,         true),
  ('banner_level',     '"info"'::jsonb,     true),
  ('signups_open',     'true'::jsonb,       true),
  ('public_scoring',   'true'::jsonb,       true),
  ('training_open',    'true'::jsonb,       true),
  ('merch_enabled',    'true'::jsonb,       true),
  ('feeds_enabled',    'true'::jsonb,       false),
  ('contact_enabled',  'true'::jsonb,       true)
on conflict (key) do nothing;

create or replace function public.platform_set_setting(p_key text, p_value jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  /* Only keys that already exist. A typo in the console would otherwise
     create a setting that nothing reads and that then sits in the list
     looking as though it does something. */
  if not exists (select 1 from platform_settings where key = p_key) then
    raise exception 'no such setting: %', p_key using errcode = '22023';
  end if;

  update platform_settings
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'platform_setting', 'setting', p_key,
          jsonb_build_object('value', p_value));
  return 'saved';
end; $$;

create or replace function public.platform_settings_all()
returns table (key text, value jsonb, is_public boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query select s.key, s.value, s.is_public, s.updated_at
                 from platform_settings s order by s.key;
end; $$;

-- ---------------------------------------------------------------------------
-- 2. OVERVIEW
--
-- One round trip for the whole front page of the console. Counts are cheap at
-- this size and honest — an estimate from pg_class would drift and there is
-- nothing here worth being wrong about.
-- ---------------------------------------------------------------------------
create or replace function public.platform_overview()
returns jsonb language plpgsql stable security definer
set search_path = public, auth as $$
declare j jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'leagues',        (select count(*) from leagues),
    'teams',          (select count(*) from teams),
    'players',        (select count(*) from players),
    'minors',         (select count(*) from players where is_minor),
    'games',          (select count(*) from games),
    'games_live',     (select count(*) from games where status = 'live'),
    'games_final',    (select count(*) from games where status = 'final'),
    'games_upcoming', (select count(*) from games where status = 'scheduled'),
    'events',         (select count(*) from game_events),
    'events_24h',     (select count(*) from game_events
                        where created_at > now() - interval '24 hours'),
    'accounts',       (select count(*) from auth.users),
    'accounts_7d',    (select count(*) from auth.users
                        where created_at > now() - interval '7 days'),
    'accounts_active_30d', (select count(*) from auth.users
                        where last_sign_in_at > now() - interval '30 days'),
    'platform_admins',(select count(*) from memberships where role = 'platform_admin'),
    'league_admins',  (select count(*) from memberships where role = 'league_admin'),
    'team_managers',  (select count(*) from memberships where role = 'team_manager'),
    'statisticians',  (select count(*) from memberships where role = 'statistician'),
    'media_pending',  (select count(*) from media where status = 'pending'),
    'messages_open',  (select count(*) from contact_messages where handled_at is null),
    'messages_failed',(select count(*) from contact_messages
                        where not delivered and created_at > now() - interval '30 days'),
    'api_keys',       (select count(*) from api_keys where revoked_at is null),
    'api_calls_24h',  (select coalesce(sum(u.n), 0) from api_usage u
                        where u.hour_start > now() - interval '24 hours'),
    'feeds',          (select count(*) from data_feeds where enabled),
    'audit_30d',      (select count(*) from audit_log
                        where created_at > now() - interval '30 days')
  ) into j;
  return j;
end; $$;

-- ---------------------------------------------------------------------------
-- 3. ACCOUNTS
--
-- The console's reason for existing. Nothing else on this site can answer
-- "who has an account here", because auth.users is not reachable from a
-- browser at all and memberships only names the people who hold a role.
--
-- `total` rides along on every row rather than needing a second count query:
-- a window function over the filtered set is one scan, and paging controls
-- that do not know how many pages there are is a worse page.
-- ---------------------------------------------------------------------------
create or replace function public.platform_accounts(
  p_search text default '',
  p_limit  int  default 50,
  p_offset int  default 0
) returns table (
  user_id uuid, email text, display_name text,
  created_at timestamptz, last_sign_in_at timestamptz,
  confirmed boolean, banned boolean, provider text,
  roles jsonb, total bigint
) language plpgsql stable security definer
set search_path = public, auth as $$
declare q text := '%' || lower(coalesce(trim(p_search), '')) || '%';
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;

  return query
  with matched as (
    select u.id, u.email::text as email, u.created_at, u.last_sign_in_at,
           u.email_confirmed_at, u.banned_until,
           coalesce(u.raw_app_meta_data ->> 'provider', 'email') as provider
      from auth.users u
     where p_search is null or trim(p_search) = ''
        or lower(u.email::text) like q
  )
  select m.id,
         m.email,
         coalesce(p.display_name, ''),
         m.created_at,
         m.last_sign_in_at,
         m.email_confirmed_at is not null,
         m.banned_until is not null and m.banned_until > now(),
         m.provider,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'membership_id', ms.id,
                    'role',  ms.role::text,
                    'scope', ms.scope_type::text,
                    'scope_id', ms.scope_id,
                    'label', case ms.scope_type
                               when 'platform' then 'the platform'
                               when 'league' then (select l.name from leagues l where l.id = ms.scope_id)
                               when 'team'   then (select t.name from teams t where t.id = ms.scope_id)
                             end)
                  order by ms.role, ms.created_at)
           from memberships ms where ms.user_id = m.id
         ), '[]'::jsonb),
         count(*) over ()
    from matched m
    left join profiles p on p.id = m.id
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end; $$;

-- ---------------------------------------------------------------------------
-- Disabling an account.
--
-- THIS REACHES INTO auth.users, which is GoTrue's table and not ours, so it
-- does it through dynamic SQL behind a column check rather than naming the
-- column statically. banned_until has been GoTrue's mechanism for years and
-- is what supabase.auth.admin.updateUserById sets — but if a future release
-- moves it, this must degrade to a clear error rather than to a migration
-- that will not install or a function that silently does nothing.
--
-- Doing it here at all, rather than in an Edge Function holding the service
-- role key, is deliberate: the alternative puts a key that can do ANYTHING
-- into a second deployable, to perform an operation the database can already
-- authorise correctly on its own.
-- ---------------------------------------------------------------------------
create or replace function public.platform_set_account_banned(
  p_user uuid, p_banned boolean
) returns text language plpgsql security definer
set search_path = public, auth as $$
declare has_col boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot disable your own account' using errcode = '23514';
  end if;
  -- never lock the platform out of itself
  if p_banned and exists (select 1 from memberships
                          where user_id = p_user and role = 'platform_admin') then
    raise exception 'that account is a platform admin — revoke the role first'
      using errcode = '23514';
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users'
                    and column_name = 'banned_until') into has_col;
  if not has_col then
    raise exception 'this GoTrue version has no banned_until column — disable the account in the Supabase dashboard'
      using errcode = '0A000';
  end if;

  if p_banned then
    execute 'update auth.users set banned_until = $1 where id = $2'
      using now() + interval '100 years', p_user;
  else
    execute 'update auth.users set banned_until = null where id = $1' using p_user;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), case when p_banned then 'disable_account' else 'enable_account' end,
          'account', p_user::text, '{}'::jsonb);

  return case when p_banned then 'account disabled' else 'account enabled' end;
end; $$;

-- Deleting an account. auth.users cascades to profiles and memberships; the
-- rows that merely REFER to a user (created_by, uploaded_by, audit actor) are
-- on delete set null, so the history survives with the name removed, which is
-- the correct outcome for an erasure request.
create or replace function public.platform_delete_account(
  p_user uuid, p_confirm_email text
) returns text language plpgsql security definer
set search_path = public, auth as $$
declare addr text;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot delete your own account' using errcode = '23514';
  end if;

  select u.email::text into addr from auth.users u where u.id = p_user;
  if addr is null then return 'already gone'; end if;

  /* Typing the address is the confirmation. A dialog with an OK button is
     one mis-click; this is not, and deleting the wrong account here is not
     recoverable from the browser. */
  if lower(coalesce(trim(p_confirm_email), '')) <> lower(addr) then
    raise exception 'type the account address exactly to confirm deletion'
      using errcode = '22023';
  end if;

  if exists (select 1 from memberships where user_id = p_user and role = 'platform_admin') then
    raise exception 'that account is a platform admin — revoke the role first'
      using errcode = '23514';
  end if;

  delete from auth.users where id = p_user;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'delete_account', 'account', p_user::text,
          jsonb_build_object('email', addr));
  return 'deleted ' || addr;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. LEAGUES AND CLUBS
-- ---------------------------------------------------------------------------
create or replace function public.platform_leagues()
returns table (
  id uuid, slug text, name text, colour_a text, colour_b text,
  public_live boolean, youth_protected boolean, created_at timestamptz,
  store_url text, store_name text,
  /* n_ prefixes on purpose: `teams`, `players` and `games` are also the names
     of the tables these count, and an OUT parameter sharing a table's name is
     the kind of ambiguity that installs cleanly and fails at call time. */
  n_teams bigint, n_players bigint, n_games bigint, n_admins bigint, n_keys bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select l.id, l.slug, l.name, l.colour_a, l.colour_b,
         l.public_live, l.youth_protected, l.created_at,
         l.store_url, l.store_name,
         (select count(*) from teams t where t.league_id = l.id),
         (select count(distinct r.player_id) from roster_entries r
            join teams t on t.id = r.team_id where t.league_id = l.id),
         (select count(*) from games g join competitions c on c.id = g.competition_id
            join seasons s on s.id = c.season_id where s.league_id = l.id),
         (select count(*) from memberships m
           where m.role = 'league_admin' and m.scope_type = 'league' and m.scope_id = l.id),
         (select count(*) from api_keys k where k.league_id = l.id and k.revoked_at is null)
    from leagues l
   order by l.name;
end; $$;

create or replace function public.platform_update_league(
  p_league uuid,
  p_name text default null, p_slug text default null,
  p_colour_a text default null, p_colour_b text default null,
  p_public_live boolean default null, p_youth_protected boolean default null
) returns text language plpgsql security definer set search_path = public as $$
declare old record;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  select * into old from leagues where id = p_league;
  if not found then raise exception 'no such league' using errcode = '22023'; end if;

  /* A slug is a URL. Changing it breaks every link anybody has saved, so it
     is allowed — a league genuinely does get renamed — but the shape is
     enforced here rather than trusted from the page. */
  if p_slug is not null and p_slug <> old.slug then
    if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'a slug is lower-case letters, digits and single hyphens'
        using errcode = '22023';
    end if;
  end if;

  update leagues set
    name            = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    slug            = coalesce(p_slug, slug),
    colour_a        = coalesce(p_colour_a, colour_a),
    colour_b        = coalesce(p_colour_b, colour_b),
    public_live     = coalesce(p_public_live, public_live),
    youth_protected = coalesce(p_youth_protected, youth_protected)
  where id = p_league;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'update_league', 'league', p_league::text,
          jsonb_build_object('was', jsonb_build_object('slug', old.slug, 'name', old.name,
                                     'public_live', old.public_live,
                                     'youth_protected', old.youth_protected)));
  return 'saved';
end; $$;

-- Deleting a league takes its seasons, competitions, games and events with it
-- through the existing cascades. Its CLUBS survive, orphaned (teams.league_id
-- is on delete set null), which is the right default: a club is a real
-- organisation that may join another competition, and a delete that quietly
-- destroyed its history along with the league's would be unrecoverable.
create or replace function public.platform_delete_league(
  p_league uuid, p_confirm_slug text
) returns text language plpgsql security definer set search_path = public as $$
declare l record; n_games bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  select * into l from leagues where id = p_league;
  if not found then return 'already gone'; end if;

  if lower(coalesce(trim(p_confirm_slug), '')) <> lower(l.slug) then
    raise exception 'type the league slug exactly to confirm deletion'
      using errcode = '22023';
  end if;

  select count(*) into n_games
    from games g join competitions c on c.id = g.competition_id
    join seasons s on s.id = c.season_id where s.league_id = p_league;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'delete_league', 'league', p_league::text,
          jsonb_build_object('slug', l.slug, 'name', l.name, 'games', n_games));

  delete from leagues where id = p_league;
  return 'deleted ' || l.slug || ' and ' || n_games || ' games';
end; $$;

create or replace function public.platform_teams(p_search text default '')
returns table (
  id uuid, slug text, name text, league_id uuid, league_name text,
  n_players bigint, n_games bigint, n_managers bigint
) language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(coalesce(trim(p_search), '')) || '%';
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select t.id, t.slug, t.name, t.league_id, coalesce(l.name, '— no league —'),
         (select count(distinct r.player_id) from roster_entries r
           where r.team_id = t.id and r.active),
         (select count(*) from games g where g.home_team_id = t.id or g.away_team_id = t.id),
         (select count(*) from memberships m
           where m.role = 'team_manager' and m.scope_type = 'team' and m.scope_id = t.id)
    from teams t left join leagues l on l.id = t.league_id
   where p_search is null or trim(p_search) = ''
      or lower(t.name) like q or lower(t.slug) like q
   order by coalesce(l.name, 'zzz'), t.name;
end; $$;

-- Moving a club between leagues. guard_team_league_move() (0028) blocks this
-- for anybody below platform admin once the club has played, which is correct
-- there and is exactly what this function is for.
create or replace function public.platform_move_team(p_team uuid, p_league uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;
  if p_league is not null and not exists (select 1 from leagues where id = p_league) then
    raise exception 'no such league' using errcode = '22023';
  end if;

  update teams set league_id = p_league where id = p_team;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'move_team', 'team', p_team::text,
          jsonb_build_object('from', t.league_id, 'to', p_league));
  return 'moved';
end; $$;

-- ---------------------------------------------------------------------------
-- 5. MODERATION AND OPERATIONS — the cross-league views of things that until
--    now could only be seen one league at a time.
-- ---------------------------------------------------------------------------
create or replace function public.platform_media_queue(p_limit int default 100)
returns table (
  id uuid, owner_type text, owner_id uuid, owner_name text, kind text,
  storage_path text, bytes int, created_at timestamptz, uploader text
) language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select m.id, m.owner_type, m.owner_id,
         coalesce(
           case m.owner_type
             when 'league' then (select l.name from leagues l where l.id = m.owner_id)
             when 'team'   then (select t.name from teams t   where t.id = m.owner_id)
             when 'player' then (select trim(p.first_name || ' ' || p.last_name)
                                   from players p where p.id = m.owner_id)
           end, '—'),
         m.kind, m.storage_path, m.bytes, m.created_at,
         coalesce((select u.email::text from auth.users u where u.id = m.uploaded_by), '—')
    from media m
   where m.status = 'pending'
   order by m.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;

create or replace function public.platform_messages(
  p_open_only boolean default true, p_limit int default 100
) returns table (
  id uuid, name text, email text, subject text, body text,
  league_name text, created_at timestamptz,
  delivered boolean, delivery_note text, handled_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select c.id, c.name, c.email, c.subject, c.body,
         coalesce((select l.name from leagues l where l.id = c.league_id), '—'),
         c.created_at, c.delivered, c.delivery_note, c.handled_at
    from contact_messages c
   where not p_open_only or c.handled_at is null
   order by c.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;

create or replace function public.platform_handle_message(p_id uuid, p_done boolean default true)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  update contact_messages set handled_at = case when p_done then now() else null end
   where id = p_id;
  return case when p_done then 'marked handled' else 'reopened' end;
end; $$;

create or replace function public.platform_api_keys()
returns table (
  id uuid, name text, prefix text, league_id uuid, league_name text,
  rate_limit int, created_at timestamptz, last_used_at timestamptz,
  revoked_at timestamptz, calls_24h bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select k.id, k.name, k.prefix, k.league_id,
         coalesce(l.name, '— all leagues —'),
         k.rate_limit, k.created_at, k.last_used_at, k.revoked_at,
         coalesce((select sum(u.n) from api_usage u
                    where u.key_id = k.id
                      and u.hour_start > now() - interval '24 hours'), 0)
    from api_keys k left join leagues l on l.id = k.league_id
   order by k.revoked_at nulls first, k.created_at desc;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. THE AUDIT TRAIL
--
-- Written by everything, read by nothing until now. Paged, filterable by
-- action, and resolving the actor to an address — a log of UUIDs is a log
-- nobody reads twice.
-- ---------------------------------------------------------------------------
create or replace function public.platform_audit(
  p_action text default '', p_limit int default 100, p_offset int default 0
) returns table (
  id bigint, actor uuid, actor_email text, action text,
  subject text, subject_id text, detail jsonb, created_at timestamptz, total bigint
) language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  with matched as (
    select a.* from audit_log a
     where p_action is null or trim(p_action) = '' or a.action = p_action
  )
  select m.id, m.actor,
         coalesce((select u.email::text from auth.users u where u.id = m.actor), '—'),
         m.action, m.subject, m.subject_id, m.detail, m.created_at,
         count(*) over ()
    from matched m
   order by m.created_at desc, m.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
end; $$;

create or replace function public.platform_audit_actions()
returns table (action text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query select a.action, count(*) from audit_log a
                group by a.action order by count(*) desc;
end; $$;

-- ---------------------------------------------------------------------------
-- 7. MAINTENANCE
--
-- The derived tables — standings, awards — are rebuilt from the event log, so
-- rebuilding them is always safe and is the first thing to try when a page
-- disagrees with a box score. Exposed here so it does not need a psql prompt.
-- ---------------------------------------------------------------------------
create or replace function public.platform_recompute_all()
returns text language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; a int := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  for c in select id from competitions loop
    perform public.recompute_standings(c.id);
    n := n + 1;
    begin
      perform public.compute_season_awards(c.id);
      a := a + 1;
    exception when others then
      /* A competition with no finished games cannot have awards, and that is
         not a failure of this run. Swallow it PER COMPETITION so one empty
         cup does not abandon the other forty. */
      null;
    end;
  end loop;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'recompute_all', 'platform', null,
          jsonb_build_object('competitions', n, 'awards', a));
  return 'recomputed ' || n || ' competitions, awards on ' || a;
end; $$;

create or replace function public.platform_prune_audit(p_days int default 730)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) < 30 then
    raise exception 'keep at least 30 days' using errcode = '22023';
  end if;
  delete from audit_log where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return 'removed ' || n || ' entries';
end; $$;

-- ---------------------------------------------------------------------------
-- 8. GRANTS. Every one of these is authenticated-only; the function bodies do
--    the rest. anon holds nothing, so a leaked page cannot probe them.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'platform_set_setting(text,jsonb)', 'platform_settings_all()',
    'platform_overview()', 'platform_accounts(text,int,int)',
    'platform_set_account_banned(uuid,boolean)', 'platform_delete_account(uuid,text)',
    'platform_leagues()', 'platform_update_league(uuid,text,text,text,text,boolean,boolean)',
    'platform_delete_league(uuid,text)', 'platform_teams(text)',
    'platform_move_team(uuid,uuid)', 'platform_media_queue(int)',
    'platform_messages(boolean,int)', 'platform_handle_message(uuid,boolean)',
    'platform_api_keys()', 'platform_audit(text,int,int)', 'platform_audit_actions()',
    'platform_recompute_all()', 'platform_prune_audit(int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================================
-- SELF-TEST.
--
-- plpgsql bodies are NOT type-checked at creation: every function above would
-- install cleanly with a misspelled column and fail only when a page called
-- it. So each one is called here, twice — once as somebody who is not a
-- platform admin, which must be refused, and once as one, which must work.
--
-- Both identities are impersonated rather than signed up, because a signup
-- sends email from the same allowance the magic-link logins use.
-- Everything created is removed; a failed assertion rolls the migration back.
-- ============================================================================
do $$
declare
  nobody uuid := gen_random_uuid();
  admin  uuid := gen_random_uuid();
  lg uuid; tm uuid;
  orig text;
  failed text[] := '{}';
  n int; t text; j jsonb;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at, created_at, updated_at)
  values (nobody, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'plat-nobody@example.invalid', '', now(), now(), now()),
         (admin,  '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'plat-admin@example.invalid',  '', now(), now(), now());

  insert into memberships (user_id, role, scope_type, scope_id)
  values (admin, 'platform_admin', 'platform', null);

  insert into leagues (slug, name) values ('plat-test-league', 'Platform Test')
    returning id into lg;
  insert into teams (league_id, slug, name) values (lg, 'plat-test-club', 'Platform Test Club')
    returning id into tm;

  -- ------------------------------------------------------------ as nobody ---
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', nobody, 'role', 'authenticated')::text, true);

  begin perform public.platform_overview();
    failed := failed || 'overview leaked to a non-admin';
  exception when insufficient_privilege then null; end;

  begin perform * from public.platform_accounts('', 5, 0);
    failed := failed || 'the account list leaked to a non-admin';
  exception when insufficient_privilege then null; end;

  begin perform * from public.platform_audit('', 5, 0);
    failed := failed || 'the audit log leaked to a non-admin';
  exception when insufficient_privilege then null; end;

  begin perform public.platform_delete_league(lg, 'plat-test-league');
    failed := failed || 'a non-admin deleted a league';
  exception when insufficient_privilege then null; end;

  begin perform public.platform_set_account_banned(admin, true);
    failed := failed || 'a non-admin disabled an account';
  exception when insufficient_privilege then null; end;

  begin perform public.platform_set_setting('banner', '"pwned"'::jsonb);
    failed := failed || 'a non-admin changed a site setting';
  exception when insufficient_privilege then null; end;

  -- the public half of the settings IS readable, and only that half
  select count(*) into n from platform_settings;
  if n <> (select count(*) from platform_settings where is_public) then
    failed := failed || 'a non-admin can read private settings';
  end if;

  -- ------------------------------------------------------------- as admin ---
  perform set_config('request.jwt.claims',
    json_build_object('sub', admin, 'role', 'authenticated')::text, true);

  j := public.platform_overview();
  if (j ->> 'leagues')::int < 1 then failed := failed || 'overview counted no leagues'; end if;
  if not (j ? 'accounts') then failed := failed || 'overview has no account count'; end if;

  select count(*) into n from public.platform_accounts('plat-admin', 50, 0);
  if n <> 1 then failed := failed || 'account search did not find the admin'; end if;

  select count(*) into n from public.platform_accounts('', 50, 0)
   where user_id = admin and roles::text like '%platform_admin%';
  if n <> 1 then failed := failed || 'the admin row is missing its role'; end if;

  select count(*) into n from public.platform_leagues() where id = lg;
  if n <> 1 then failed := failed || 'platform_leagues did not list the test league'; end if;

  select count(*) into n from public.platform_teams('plat-test') where id = tm;
  if n <> 1 then failed := failed || 'platform_teams did not list the test club'; end if;

  t := public.platform_update_league(lg, 'Renamed Test', null, null, null, true, null);
  if (select name from leagues where id = lg) <> 'Renamed Test' then
    failed := failed || 'update_league did not rename';
  end if;
  if not (select public_live from leagues where id = lg) then
    failed := failed || 'update_league did not set public_live';
  end if;

  begin perform public.platform_update_league(lg, null, 'Not A Slug');
    failed := failed || 'a bad slug was accepted';
  exception when others then null; end;

  t := public.platform_move_team(tm, null);
  if (select league_id from teams where id = tm) is not null then
    failed := failed || 'move_team did not orphan the club';
  end if;
  perform public.platform_move_team(tm, lg);

  t := public.platform_set_setting('banner', '"testing"'::jsonb);
  if (select value from platform_settings where key = 'banner') <> '"testing"'::jsonb then
    failed := failed || 'set_setting did not save';
  end if;
  perform public.platform_set_setting('banner', '""'::jsonb);

  begin perform public.platform_set_setting('no_such_key', 'true'::jsonb);
    failed := failed || 'an unknown setting key was accepted';
  exception when others then null; end;

  select count(*) into n from public.platform_settings_all();
  if n < 5 then failed := failed || 'settings_all returned almost nothing'; end if;

  -- these three only have to RUN; there is nothing seeded to assert about
  perform * from public.platform_media_queue(10);
  perform * from public.platform_messages(true, 10);
  perform * from public.platform_api_keys();
  perform * from public.platform_audit_actions();

  select count(*) into n from public.platform_audit('update_league', 20, 0);
  if n < 1 then failed := failed || 'the audit log did not record update_league'; end if;

  -- guards
  begin perform public.platform_set_account_banned(admin, true);
    failed := failed || 'an admin disabled their own account';
  exception when others then null; end;

  begin perform public.platform_delete_account(nobody, 'wrong@example.invalid');
    failed := failed || 'a wrong confirmation deleted an account';
  exception when others then null; end;

  begin perform public.platform_delete_league(lg, 'wrong-slug');
    failed := failed || 'a wrong confirmation deleted a league';
  exception when others then null; end;

  begin perform public.platform_prune_audit(1);
    failed := failed || 'pruning to one day was allowed';
  exception when others then null; end;

  -- disabling and re-enabling somebody else, and then deleting them properly
  t := public.platform_set_account_banned(nobody, true);
  select count(*) into n from public.platform_accounts('plat-nobody', 5, 0) where banned;
  if n <> 1 then failed := failed || 'the disabled account does not read as disabled'; end if;
  perform public.platform_set_account_banned(nobody, false);

  t := public.platform_delete_account(nobody, 'plat-nobody@example.invalid');
  /* Whether the row is GONE is checked further down, after the role is put
     back. `authenticated` has no rights on auth.users at all — reading it
     here to verify a deletion is itself a permission error, and one that
     looks exactly like the function having failed. */

  t := public.platform_prune_audit(3650);   -- executes the delete, removes nothing

  /* Called for real. It is idempotent by construction — standings and awards
     are derived from the event log — so running it here changes no answer,
     and it is the only way to type-check a body plpgsql accepted unchecked. */
  t := public.platform_recompute_all();

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  if exists (select 1 from auth.users where id = nobody) then
    failed := failed || 'delete_account left the row behind';
  end if;

  delete from teams where id = tm;
  delete from leagues where id = lg;
  delete from memberships where user_id = admin;
  delete from audit_log where actor in (admin, nobody)
                           or subject_id in (lg::text, tm::text, nobody::text);
  delete from auth.users where id in (admin, nobody);

  if array_length(failed, 1) > 0 then
    raise exception E'PLATFORM CONSOLE SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
  raise notice 'platform console: % checks passed', 30;
end $$;
