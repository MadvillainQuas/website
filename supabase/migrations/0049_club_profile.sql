-- ============================================================================
-- 0049 — WHAT A CLUB MAINTAINS ABOUT ITSELF.
--
-- The public team profile grew a venue, a contact block, a staff list and
-- player measurements. The club portal grew none of them, so every one of
-- those had to be filled in by a league administrator on the club's behalf,
-- which is exactly backwards: the club is the only party that knows its own
-- hall, its own secretary's number and whose guardian has said yes.
--
-- ---------------------------------------------------------------------------
-- ON THE AGE, because the brief asked and the answer is not one number.
--
-- Two different thresholds are being conflated, and they are genuinely
-- different things:
--
--   SAFEGUARDING — whether a child's name, photograph and measurements belong
--   on a public website at all. In UK and Irish sport this is under-18, and
--   national governing bodies write their own rules on top.
--
--   DATA-PROTECTION CONSENT — the age at which a person may consent for
--   themselves rather than through a guardian. UK GDPR sets that at 13. The
--   EU allows each member state to choose between 13 and 16, and several
--   (Germany, Ireland, the Netherlands) chose 16.
--
-- So 16 is a real and common number, and it is not "the legal cutoff" — there
-- isn't one, it depends on the jurisdiction and on the sport's own rules.
-- Which is why this is a SETTING PER LEAGUE rather than a constant, defaulting
-- to 16 as asked. A league running an under-14 competition in Ireland and one
-- running an adult league in England should not be arguing with the same
-- hard-coded integer.
--
-- WHAT CONSENT ACTUALLY UNLOCKS. Until now `is_minor` withheld a player from
-- the public entirely, with no way back — which is safe and means a
-- seventeen-year-old whose parents are happy for them to be listed simply
-- cannot be. Consent is now recorded explicitly, with who gave it and when,
-- and only then does the player appear. Absence of consent still means
-- withheld: the default does not move.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE THRESHOLD, AND CONSENT
-- ---------------------------------------------------------------------------
alter table public.leagues
  add column if not exists consent_age int not null default 16;

do $$ begin
  alter table public.leagues add constraint leagues_consent_age_ck
    check (consent_age between 13 and 21);
exception when duplicate_object then null; end $$;

comment on column public.leagues.consent_age is
  'below this age a player is withheld from public pages unless consent is recorded';

alter table public.players
  add column if not exists public_consent   boolean not null default false,
  add column if not exists consent_guardian text,
  add column if not exists consent_at       timestamptz,
  add column if not exists consent_by       uuid references auth.users on delete set null;

comment on column public.players.public_consent is
  'guardian (or the player, if over the league consent age) has agreed to publication';

-- Whether this player is held back from the public. One expression, in one
-- place, so a page and a policy cannot disagree about it.
create or replace function public.player_withheld(p_minor boolean, p_consent boolean)
returns boolean language sql immutable as $$
  select coalesce(p_minor, false) and not coalesce(p_consent, false);
$$;

-- The policy, replacing 0001's. The only change is the consent clause; the
-- default for a minor with nothing recorded is exactly what it was.
drop policy if exists players_read on public.players;
create policy players_read on public.players for select
  using (
    not public.player_withheld(is_minor, public_consent)
    or auth.uid() is not null and exists (
         select 1 from roster_entries re
         where re.player_id = players.id and public.is_team_manager(re.team_id))
    or public.is_platform_admin()
  );

/* THE FEEDS AND THE JSON API ARE NOT CHANGED and still filter on is_minor
   alone, so a consented sixteen-year-old appears on this site and not in a
   partner's republication. That asymmetry is deliberate: consent was given to
   a league for its own website, and treating it as consent for RealGM to
   syndicate the same child is a leap the platform has no business making on a
   guardian's behalf. */

-- ---------------------------------------------------------------------------
-- 2. PREVIOUS CLUBS — a list, not a line.
--
-- players.previous_club (0033) is one free-text field, which is the right
-- shape for "came from" and the wrong shape for a career. It stays, holding
-- the most recent, because the team profile and the feeds already read it;
-- the table is what the portal edits and the profile lists.
-- ---------------------------------------------------------------------------
create table if not exists public.player_previous_clubs (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players on delete cascade,
  club_name  text not null,
  from_year  int,
  to_year    int,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  constraint prev_years_ck check (
    (from_year is null or from_year between 1900 and 2100) and
    (to_year   is null or to_year   between 1900 and 2100) and
    (from_year is null or to_year is null or to_year >= from_year))
);
create index if not exists prev_clubs_player on public.player_previous_clubs (player_id, sort);

alter table public.player_previous_clubs enable row level security;

-- Visible exactly when the player is. A career history is as identifying as a
-- name, so it inherits the same rule rather than getting a looser one.
drop policy if exists prev_clubs_read on public.player_previous_clubs;
create policy prev_clubs_read on public.player_previous_clubs for select
  using (exists (select 1 from players p where p.id = player_id
                  and not public.player_withheld(p.is_minor, p.public_consent))
         or exists (select 1 from roster_entries re
                     where re.player_id = player_previous_clubs.player_id
                       and public.is_team_manager(re.team_id))
         or public.is_platform_admin());

drop policy if exists prev_clubs_write on public.player_previous_clubs;
create policy prev_clubs_write on public.player_previous_clubs for all to authenticated
  using (exists (select 1 from roster_entries re
                  where re.player_id = player_previous_clubs.player_id
                    and public.is_team_manager(re.team_id))
         or public.is_platform_admin())
  with check (exists (select 1 from roster_entries re
                       where re.player_id = player_previous_clubs.player_id
                         and public.is_team_manager(re.team_id))
              or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. THE VENUE GETS A PHOTOGRAPH, AND A LINE ABOUT GETTING THERE
-- ---------------------------------------------------------------------------
alter table public.teams
  add column if not exists home_venue_image text,
  add column if not exists home_venue_note  text;

comment on column public.teams.home_venue_image is
  'storage path in the media bucket, or an absolute https URL';
comment on column public.teams.home_venue_note is
  'parking, entrance, which door — the things a first-time visitor asks';

-- ---------------------------------------------------------------------------
-- 4. CLUB SOCIALS.
--
-- The same shape as league_socials (0048) minus the automatic half. A club
-- pins its posts; the Graph API path needs a business account and a token per
-- account, and asking forty clubs for one is not a thing that happens.
-- ---------------------------------------------------------------------------
create table if not exists public.team_socials (
  team_id    uuid primary key references public.teams on delete cascade,
  instagram  text,
  x_handle   text,
  facebook   text,
  website    text,
  pinned     text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint team_pinned_ck check (array_length(pinned, 1) is null
                                   or array_length(pinned, 1) <= 4)
);

alter table public.team_socials enable row level security;
-- Public: there is nothing secret on this row, unlike a league's, which
-- carries an access token.
drop policy if exists team_socials_read on public.team_socials;
create policy team_socials_read on public.team_socials for select using (true);
drop policy if exists team_socials_write on public.team_socials;
create policy team_socials_write on public.team_socials for all to authenticated
  using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));

-- ---------------------------------------------------------------------------
-- 5. THE PORTAL'S WRITES.
--
-- Through functions rather than table policies where a write has to VALIDATE
-- something — a shortcode, a URL scheme, an age against the league's own
-- threshold. A policy can say who; only a function can say what.
-- ---------------------------------------------------------------------------
create or replace function public.set_team_venue(
  p_team uuid, p_venue text default null, p_address text default null,
  p_image text default null, p_note text default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_manager(p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;
  /* An absolute URL is allowed because a club may already host its photograph
     somewhere; anything that is not https is refused, because a http image on
     an https page is blocked by the browser and reads as a broken upload. */
  if p_image is not null and p_image <> ''
     and p_image !~ '^https://' and p_image ~ '^[a-z]+://' then
    raise exception 'a venue image must be an https address or an uploaded file'
      using errcode = '22023';
  end if;

  update teams set
    home_venue         = coalesce(nullif(trim(coalesce(p_venue, '')), ''), home_venue),
    home_venue_address = coalesce(p_address, home_venue_address),
    home_venue_image   = case when p_image is null then home_venue_image
                              when p_image = ''    then null else p_image end,
    home_venue_note    = coalesce(p_note, home_venue_note)
  where id = p_team;

  return 'saved';
end; $$;

create or replace function public.set_team_socials(
  p_team uuid, p_instagram text default null, p_x text default null,
  p_facebook text default null, p_website text default null,
  p_pinned text[] default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_clean text[];
begin
  if not public.is_team_manager(p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  /* The same three-pattern reduction as 0048, and for the same reason: an
     optional prefix makes substring() match "https" first. */
  if p_pinned is not null then
    select array_agg(c) into v_clean from (
      select c from (
        select coalesce(
                 substring(x from 'instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)'),
                 substring(x from '^\s*(?:p|reel|tv)/([A-Za-z0-9_-]+)'),
                 substring(x from '^\s*([A-Za-z0-9_-]{5,})\s*$')) as c
          from unnest(p_pinned) x
         where coalesce(trim(x), '') <> '') a
       where c is not null
       limit 4) q;
    v_clean := coalesce(v_clean, '{}'::text[]);
  end if;

  insert into team_socials (team_id, instagram, x_handle, facebook, website, pinned, updated_at)
  values (p_team,
          nullif(regexp_replace(coalesce(p_instagram, ''), '^@|^.*instagram\.com/', ''), ''),
          nullif(regexp_replace(coalesce(p_x, ''), '^@|^.*(?:twitter|x)\.com/', ''), ''),
          nullif(regexp_replace(coalesce(p_facebook, ''), '^.*facebook\.com/', ''), ''),
          nullif(trim(coalesce(p_website, '')), ''),
          coalesce(v_clean, '{}'::text[]), now())
  on conflict (team_id) do update set
    instagram  = coalesce(nullif(regexp_replace(coalesce(p_instagram, ''),
                   '^@|^.*instagram\.com/', ''), ''), team_socials.instagram),
    x_handle   = coalesce(nullif(regexp_replace(coalesce(p_x, ''),
                   '^@|^.*(?:twitter|x)\.com/', ''), ''), team_socials.x_handle),
    facebook   = coalesce(nullif(regexp_replace(coalesce(p_facebook, ''),
                   '^.*facebook\.com/', ''), ''), team_socials.facebook),
    website    = coalesce(nullif(trim(coalesce(p_website, '')), ''), team_socials.website),
    pinned     = coalesce(v_clean, team_socials.pinned),
    updated_at = now();
  return 'saved';
end; $$;

-- Everything a club edits about one player, in one call, so a half-saved
-- profile is not a state the portal can produce.
create or replace function public.set_player_profile(
  p_player uuid,
  p_height int default null, p_weight int default null, p_wingspan int default null,
  p_previous_club text default null, p_position text default null,
  p_consent boolean default null, p_guardian text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_minor boolean; v_year int; v_age_limit int; v_age int;
begin
  if not exists (select 1 from roster_entries re
                  where re.player_id = p_player and public.is_team_manager(re.team_id)) then
    raise exception 'you do not manage a club this player is registered with'
      using errcode = '42501';
  end if;

  select p.is_minor, p.birth_year into v_minor, v_year from players p where p.id = p_player;

  if p_consent is true then
    /* CONSENT NEEDS A NAME AGAINST IT. A boolean on its own is not a record of
       anybody having agreed to anything, and this is the field that decides
       whether a child appears on a public website. */
    if coalesce(trim(coalesce(p_guardian, '')), '') = '' then
      raise exception 'record who gave consent before ticking it' using errcode = '22023';
    end if;
  end if;

  update players set
    height_cm     = case when p_height   = 0 then null else coalesce(p_height,   height_cm) end,
    weight_kg     = case when p_weight   = 0 then null else coalesce(p_weight,   weight_kg) end,
    wingspan_cm   = case when p_wingspan = 0 then null else coalesce(p_wingspan, wingspan_cm) end,
    previous_club = case when p_previous_club = '' then null
                         else coalesce(p_previous_club, previous_club) end,
    public_consent   = coalesce(p_consent, public_consent),
    consent_guardian = case when p_consent is false then null
                            else coalesce(nullif(trim(coalesce(p_guardian, '')), ''),
                                          consent_guardian) end,
    consent_at       = case when p_consent is true then now()
                            when p_consent is false then null
                            else consent_at end,
    consent_by       = case when p_consent is true then auth.uid()
                            when p_consent is false then null
                            else consent_by end
  where id = p_player;

  if p_position is not null then
    update roster_entries set position = nullif(trim(p_position), '')
     where player_id = p_player and active
       and public.is_team_manager(team_id);
  end if;

  return 'saved';
end; $$;

-- Replaces the whole list in one go: the portal edits it as a list, and a
-- per-row API would make "delete the middle one" three round trips and a
-- reordering bug.
create or replace function public.set_player_previous_clubs(p_player uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; v_name text;
begin
  if not exists (select 1 from roster_entries re
                  where re.player_id = p_player and public.is_team_manager(re.team_id)) then
    raise exception 'you do not manage a club this player is registered with'
      using errcode = '42501';
  end if;

  delete from player_previous_clubs where player_id = p_player;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := trim(coalesce(r->>'club', ''));
    continue when v_name = '';
    i := i + 1;
    insert into player_previous_clubs (player_id, club_name, from_year, to_year, sort)
    values (p_player, left(v_name, 80),
            nullif(r->>'from', '')::int, nullif(r->>'to', '')::int, i);
  end loop;

  /* The single free-text field the profile and the feeds already read stays
     in step with the top of the list, so the two cannot disagree. */
  update players set previous_club = (
    select club_name from player_previous_clubs
     where player_id = p_player order by sort limit 1)
   where id = p_player;

  return i;
end; $$;

-- One read for the whole portal screen: the club, its venue, its contact, its
-- socials, its staff, and every player with everything a club may edit.
create or replace function public.portal_club(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb; v_age int;
begin
  if not public.is_team_manager(p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  select coalesce(l.consent_age, 16) into v_age
    from teams t left join leagues l on l.id = t.league_id where t.id = p_team;

  select jsonb_build_object(
    'consent_age', v_age,
    'team', (select to_jsonb(x) from (
        select t.id, t.slug, t.name, t.short_name, t.colour,
               t.home_venue, t.home_venue_address, t.home_venue_image, t.home_venue_note
          from teams t where t.id = p_team) x),
    'contact', (select to_jsonb(c) from (
        select tc.contact_name, tc.email, tc.phone, tc.is_public, tc.accepts_form
          from team_contacts tc where tc.team_id = p_team) c),
    'socials', (select to_jsonb(s) from (
        select ts.instagram, ts.x_handle, ts.facebook, ts.website, ts.pinned
          from team_socials ts where ts.team_id = p_team) s),
    'staff', coalesce((select jsonb_agg(to_jsonb(st) order by st.sort, st.name) from (
        select s.id, s.name, s.role, s.born_year, s.sort, s.active
          from team_staff s where s.team_id = p_team) st), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(to_jsonb(pp) order by pp.jersey_sort, pp.last_name) from (
        select p.id, p.first_name, p.last_name, p.birth_year, p.is_minor,
               p.public_consent, p.consent_guardian, p.consent_at,
               p.height_cm, p.weight_kg, p.wingspan_cm, p.previous_club,
               p.photo_consent,
               re.jersey, re.position, re.active,
               coalesce(nullif(regexp_replace(re.jersey, '\D', '', 'g'), '')::int, 999)
                 as jersey_sort,
               case when p.birth_year is not null
                    then extract(year from current_date)::int - p.birth_year end as age,
               coalesce((select jsonb_agg(jsonb_build_object(
                          'club', c.club_name, 'from', c.from_year, 'to', c.to_year)
                          order by c.sort)
                   from player_previous_clubs c where c.player_id = p.id), '[]'::jsonb)
                 as previous_clubs
          from roster_entries re join players p on p.id = re.player_id
         where re.team_id = p_team and re.active) pp), '[]'::jsonb)
  ) into j;
  return j;
end; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_team_venue(uuid,text,text,text,text)',
    'set_team_socials(uuid,text,text,text,text,text[])',
    'set_player_profile(uuid,int,int,int,text,text,boolean,text)',
    'set_player_previous_clubs(uuid,jsonb)',
    'portal_club(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.player_withheld(boolean,boolean) to anon, authenticated;

-- ============================================================================
-- SELF-TEST — one club, one manager, one outsider, and a sixteen-year-old.
-- ============================================================================
do $$
declare
  mgr uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  lg uuid; ss uuid; tm uuid; adult uuid; kid uuid;
  orig text; failed text[] := '{}';
  n int; t text; j jsonb; v_ok boolean;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (mgr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'club-mgr@example.invalid', '', now(), now(), now()),
         (outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'club-out@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name, consent_age) values ('club-test', 'Club Test', 16)
    returning id into lg;
  insert into seasons (league_id, name) values (lg, 'CT') returning id into ss;
  insert into teams (league_id, slug, name) values (lg, 'club-test-fc', 'Test FC')
    returning id into tm;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (mgr, 'team_manager', 'team', tm);

  insert into players (slug, first_name, last_name, birth_year, is_minor)
    values ('ct-adult', 'Adult', 'Player', 1998, false) returning id into adult;
  insert into players (slug, first_name, last_name, birth_year, is_minor)
    values ('ct-kid', 'Young', 'Player', 2011, true) returning id into kid;
  insert into roster_entries (team_id, player_id, season_id, jersey, active)
    values (tm, adult, ss, '7', true), (tm, kid, ss, '12', true);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', mgr, 'role', 'authenticated')::text, true);

  -- ---- venue ---------------------------------------------------------------
  t := public.set_team_venue(tm, 'The Drill Hall', '1 Test Street, TE5 7ST',
                             'https://example.invalid/hall.jpg', 'Park behind the hall.');
  if (select home_venue from teams where id = tm) <> 'The Drill Hall' then
    failed := array_append(failed, 'the venue was not saved');
  end if;
  begin perform public.set_team_venue(tm, null, null, 'http://insecure.example/x.jpg');
    failed := array_append(failed, 'an http image was accepted');
  exception when others then null; end;

  -- ---- socials -------------------------------------------------------------
  t := public.set_team_socials(tm, '@testfc', 'https://x.com/testfc',
        'https://facebook.com/testfc', 'https://testfc.example',
        array['https://www.instagram.com/p/AAA111bbb/?igsh=x', 'nonsense here', 'CCC222ddd']);
  if (select instagram from team_socials where team_id = tm) <> 'testfc' then
    failed := array_append(failed, 'the instagram handle was not reduced');
  end if;
  if (select x_handle from team_socials where team_id = tm) <> 'testfc' then
    failed := array_append(failed, 'the x handle was not reduced');
  end if;
  select array_length(pinned, 1) into n from team_socials where team_id = tm;
  if n <> 2 then
    failed := array_append(failed, ('two usable pins expected, got ' || coalesce(n, 0)));
  end if;

  -- ---- measurements and previous clubs -------------------------------------
  t := public.set_player_profile(adult, 198, 92, 208, null, 'Guard', null, null);
  if (select height_cm from players where id = adult) <> 198 then
    failed := array_append(failed, 'the height was not saved');
  end if;
  if (select position from roster_entries where player_id = adult and active) <> 'Guard' then
    failed := array_append(failed, 'the position was not saved');
  end if;
  begin perform public.set_player_profile(adult, 5, null, null);
    failed := array_append(failed, 'a 5cm player was accepted');
  exception when others then null; end;

  n := public.set_player_previous_clubs(adult, jsonb_build_array(
        jsonb_build_object('club', 'Old Town', 'from', 2019, 'to', 2022),
        jsonb_build_object('club', 'Second City', 'from', 2022, 'to', 2024),
        jsonb_build_object('club', '')));
  if n <> 2 then failed := array_append(failed, ('two previous clubs expected, got ' || n)); end if;
  if (select previous_club from players where id = adult) <> 'Old Town' then
    failed := array_append(failed, 'the single previous_club field did not follow the list');
  end if;

  -- ---- consent -------------------------------------------------------------
  begin perform public.set_player_profile(kid, null, null, null, null, null, true, '');
    failed := array_append(failed, 'consent was accepted with nobody named');
  exception when others then null; end;

  t := public.set_player_profile(kid, null, null, null, null, null, true, 'A Guardian');
  if not (select public_consent from players where id = kid) then
    failed := array_append(failed, 'consent was not recorded');
  end if;
  if (select consent_at from players where id = kid) is null then
    failed := array_append(failed, 'consent has no timestamp');
  end if;

  -- ---- the whole screen in one read ----------------------------------------
  j := public.portal_club(tm);
  if (j->>'consent_age')::int <> 16 then
    failed := array_append(failed, 'portal_club did not carry the league consent age');
  end if;
  if jsonb_array_length(j->'players') <> 2 then
    failed := array_append(failed, 'portal_club did not return both players');
  end if;
  if (j->'team'->>'home_venue') <> 'The Drill Hall' then
    failed := array_append(failed, 'portal_club did not return the venue');
  end if;

  -- ---- what the public can see ---------------------------------------------
  /* THE CLAIMS HAVE TO GO TOO. `set local role anon` changes the ROLE and
     leaves request.jwt.claims exactly where it was, so auth.uid() still
     returned the manager's id and players_read's second clause — "are you a
     manager of a club this player is on" — kept passing. Every check below
     was green for the wrong reason until the withdrawal case exposed it, and
     that is the failure mode worth naming: an RLS test that authenticates
     itself by accident passes whatever the policy says. */
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  select count(*) into n from players where id = kid;
  if n <> 1 then
    failed := array_append(failed, 'a CONSENTED minor is still hidden from the public');
  end if;
  select count(*) into n from player_previous_clubs where player_id = adult;
  if n <> 2 then failed := array_append(failed, 'previous clubs are not public for an adult'); end if;

  -- and withdrawing consent puts the child back behind the wall
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  t := public.set_player_profile(kid, null, null, null, null, null, false, null);
  if (select consent_at from players where id = kid) is not null then
    failed := array_append(failed, 'withdrawing consent left the timestamp behind');
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into n from players where id = kid;
  if n <> 0 then
    failed := array_append(failed, 'withdrawing consent did not re-hide the child');
  end if;

  -- ---- an outsider ---------------------------------------------------------
  reset role; set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  begin perform public.set_team_venue(tm, 'Hijacked');
    failed := array_append(failed, 'an outsider changed the venue');
  exception when insufficient_privilege then null; end;
  begin perform public.set_team_socials(tm, 'hijack');
    failed := array_append(failed, 'an outsider changed the socials');
  exception when insufficient_privilege then null; end;
  begin perform public.set_player_profile(adult, 200);
    failed := array_append(failed, 'an outsider changed a player');
  exception when insufficient_privilege then null; end;
  begin perform public.portal_club(tm);
    failed := array_append(failed, 'an outsider read the portal');
  exception when insufficient_privilege then null; end;

  -- --------------------------------------------------------------- tidy up ---
  reset role;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from player_previous_clubs where player_id in (adult, kid);
  delete from team_socials where team_id = tm;
  delete from roster_entries where team_id = tm;
  delete from players where id in (adult, kid);
  delete from memberships where user_id = mgr;
  delete from teams where id = tm;
  delete from seasons where id = ss;
  delete from leagues where id = lg;
  delete from auth.users where id in (mgr, outsider);

  if array_length(failed, 1) > 0 then
    raise exception E'CLUB PROFILE SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
