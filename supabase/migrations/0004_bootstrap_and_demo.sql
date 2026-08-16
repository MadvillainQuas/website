-- ============================================================================
-- Phase 2: first-admin bootstrap, plus a demo league so the pages have data.
--
-- A gap the schema left open: granting any role requires being an admin, so
-- the FIRST platform admin can never be created through the app. This adds a
-- self-disabling bootstrap — it works exactly once, while no platform admin
-- exists, and refuses forever after.
-- ============================================================================

create or replace function public.bootstrap_admin(p_email text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
begin
  if exists (select 1 from memberships where role = 'platform_admin') then
    return 'refused: a platform admin already exists — grant further roles from the portal';
  end if;

  select id into uid from auth.users where lower(email) = lower(p_email) limit 1;
  if uid is null then
    return 'no such user: sign in once at /league/app/ with ' || p_email || ', then run this again';
  end if;

  insert into memberships (user_id, role, scope_type, scope_id)
  values (uid, 'platform_admin', 'platform', null)
  on conflict do nothing;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (uid, 'bootstrap_admin', 'membership', uid::text, jsonb_build_object('email', p_email));

  return 'granted platform_admin to ' || p_email;
end; $$;

-- the owner runs this from the SQL editor; anon must never be able to
revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;

-- ============================================================================
-- Demo league — clearly labelled, and removable with the snippet at the end.
-- Its purpose is to prove standings, streaks and the season views against real
-- rows rather than an empty table.
-- ============================================================================
do $$
declare
  lg uuid; sn uuid; cp uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid;
begin
  if exists (select 1 from leagues where slug = 'demo-league') then
    raise notice 'demo league already present — skipping seed';
    return;
  end if;

  insert into leagues (slug, name, colour_a, colour_b, public_live, youth_protected)
  values ('demo-league', 'Courtside Demo League', '#93f2bf', '#8ff5ff', true, true)
  returning id into lg;

  insert into seasons (league_id, name, starts_on, ends_on)
  values (lg, '2026-27', date '2026-09-01', date '2027-05-01') returning id into sn;

  insert into competitions (season_id, name, kind)
  values (sn, 'Division One', 'league') returning id into cp;

  insert into teams (league_id, slug, name, short_name, colour) values
    (lg, 'neon-city',  'Neon City',  'NC', '#93f2bf') returning id into t1;
  insert into teams (league_id, slug, name, short_name, colour) values
    (lg, 'soft-club',  'Soft Club',  'SC', '#8ff5ff') returning id into t2;
  insert into teams (league_id, slug, name, short_name, colour) values
    (lg, 'harbour-bay','Harbour Bay','HB', '#b7a8ff') returning id into t3;
  insert into teams (league_id, slug, name, short_name, colour) values
    (lg, 'east-dock',  'East Dock',  'ED', '#ffd166') returning id into t4;

  insert into competition_teams (competition_id, team_id)
  values (cp,t1),(cp,t2),(cp,t3),(cp,t4);

  -- finished games, oldest first. Resulting streaks (verified after seeding):
  --   Neon City   W W W -> W3      Soft Club   W W L -> L1
  --   Harbour Bay L L W -> W1      East Dock   L L L -> L3
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, home_score, away_score, period) values
    (cp, t1, t4, now() - interval '21 days', 'final', 88, 71, 4),
    (cp, t2, t3, now() - interval '21 days', 'final', 79, 74, 4),
    (cp, t1, t3, now() - interval '14 days', 'final', 81, 77, 4),
    (cp, t4, t2, now() - interval '14 days', 'final', 66, 90, 4),
    (cp, t1, t2, now() - interval '7 days',  'final', 84, 80, 4),
    (cp, t3, t4, now() - interval '7 days',  'final', 95, 62, 4);

  -- one upcoming fixture so the schedule page has something to show
  insert into games (competition_id, home_team_id, away_team_id, tipoff_at, status, venue)
  values (cp, t2, t1, now() + interval '5 days', 'scheduled', 'Demo Arena');

  perform recompute_standings(cp);
  raise notice 'demo league seeded and standings computed';
end $$;

-- ----------------------------------------------------------------------------
-- To remove the demo entirely:
--   delete from leagues where slug = 'demo-league';
-- (seasons, competitions, teams, games and standings all cascade from it)
-- ----------------------------------------------------------------------------
