-- ============================================================================
-- 0143 — A NEW LEAGUE ARRIVES WITH A SEASON AND A COMPETITION IN IT.
--
-- WHAT "CREATE A SCHEDULE" ACTUALLY DID. The league page offers its admin a
-- button (0139/home.js offerSchedule) that goes to the console's fixtures
-- section. On a brand-new league that section cannot do anything at all:
--
--   * both club dropdowns say "pick a competition" and are disabled;
--   * pressing schedule answers "Pick a competition first.";
--   * "Generate a season" says the same.
--
-- And the two things it wants are in the section ABOVE it, with nothing on the
-- fixtures section saying so. The real first steps are: scroll up to 03, name a
-- season, press add season; name a competition, press add competition; go to 04
-- and add at least two clubs; and only then does 05 do anything. A button that
-- lands somebody on the one screen that cannot work yet is worse than no button.
--
-- A season and a competition are not a decision anybody is making at that
-- moment. Every league has a season, and almost every league has one league
-- competition in it; the exceptions (a cup, a second division, a differently
-- named season) are things an admin CHANGES, not things they want to be asked
-- about before they can begin. So a league created from the console now arrives
-- with both, and the fixtures section works the moment there are two clubs.
--
-- DELETABLE, AND SAID SO IN THE NAME. The competition is called 'League' and
-- the season is this season by the usual convention. Renaming or deleting
-- either is one press in section 03, and deleting a competition takes its
-- (empty) fixture list with it.
--
-- ONLY THE CONSOLE PATH. create_league is what the platform console calls.
-- A league connected to a feed (create_league_from_feed, 0098) takes its
-- seasons FROM the feed, and inventing one there would leave a stray empty
-- season beside the real ones. That function is untouched.
--
-- Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. WHAT THIS SEASON IS CALLED.
--
-- Basketball seasons span the new year, so the label is two years: a season
-- starting in the autumn of 2026 is "2026-27". July is the turn — before it,
-- you are still in the season that began last year. Split out so the backfill
-- and the creator cannot disagree, and so it is one place to change if a league
-- ever wants calendar years instead (they rename it in the console either way).
-- ----------------------------------------------------------------------------
create or replace function public.season_label(p_on date default current_date)
returns text language sql immutable as $$
  select case when extract(month from p_on) >= 7
              then to_char(p_on, 'YYYY') || '-' || to_char(p_on + interval '1 year', 'YY')
              else to_char(p_on - interval '1 year', 'YYYY') || '-' || to_char(p_on, 'YY')
         end;
$$;

-- ----------------------------------------------------------------------------
-- 2. GIVE A LEAGUE ITS FIRST SEASON AND COMPETITION.
--
-- Idempotent and quiet: a league that already has a season is left exactly as
-- it is, so this is safe to call from the creator AND from the backfill, and
-- safe to run again. Returns the competition, or null if there was nothing to
-- do — the creator ignores it, the backfill counts it.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_first_competition(p_league uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_season uuid; v_comp uuid;
begin
  if p_league is null then return null; end if;
  if exists (select 1 from seasons s where s.league_id = p_league) then
    return null;                                  -- already set up; leave it alone
  end if;

  insert into seasons (league_id, name) values (p_league, public.season_label())
  returning id into v_season;
  insert into competitions (season_id, name, kind) values (v_season, 'League', 'league')
  returning id into v_comp;
  return v_comp;
end; $$;

-- ----------------------------------------------------------------------------
-- 3. THE CREATOR. Everything else about it is unchanged, including who may
-- call it and the membership it grants; the season and the competition are
-- added after the league exists and before it is returned, so the console's
-- very next read already has them.
-- ----------------------------------------------------------------------------
create or replace function public.create_league(
  p_name text,
  p_slug text,
  p_colour_a text default '#93f2bf',
  p_colour_b text default '#8ff5ff',
  p_public_live boolean default true,
  p_youth_protected boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  s text := lower(trim(p_slug));
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin may create a league'
      using errcode = '42501';
  end if;
  if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slug must be lower-case words separated by single hyphens'
      using errcode = '22023';
  end if;
  if exists (select 1 from leagues where slug = s) then
    raise exception 'the slug "%" is already taken', s using errcode = '23505';
  end if;

  insert into leagues (slug, name, colour_a, colour_b, public_live, youth_protected)
  values (s, trim(p_name), p_colour_a, p_colour_b, p_public_live, p_youth_protected)
  returning id into new_id;

  -- the creator administers what they created, so they are not locked out if
  -- platform admin is later removed
  insert into memberships (user_id, role, scope_type, scope_id)
  values (auth.uid(), 'league_admin', 'league', new_id)
  on conflict do nothing;

  /* A SEASON AND A COMPETITION TO PUT FIXTURES IN (0143). Without them the
     console's fixtures section is inert and the first thing anybody handed a
     league meets is a screen that refuses. Both are renameable and deletable. */
  perform public.ensure_first_competition(new_id);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'create_league', 'league', new_id::text,
          jsonb_build_object('slug', s, 'name', p_name));

  return new_id;
end; $$;

-- ----------------------------------------------------------------------------
-- 4. THE LEAGUES THAT ARE ALREADY HERE WITH NOTHING IN THEM.
--
-- Scoped to a league with NO season AND no game: a league nobody has set up.
-- A feed league has seasons the moment it ingests, so the only ones this can
-- reach are the ones this file exists for — the console-created leagues sitting
-- on an empty fixtures screen right now, NBL U18s Men's among them.
-- ----------------------------------------------------------------------------
do $$
declare l record; n int := 0;
begin
  for l in
    select lg.id, lg.name from leagues lg
     where not exists (select 1 from seasons s where s.league_id = lg.id)
       and not exists (select 1 from games g
                        join competitions c on c.id = g.competition_id
                        join seasons s2 on s2.id = c.season_id
                       where s2.league_id = lg.id)
  loop
    if public.ensure_first_competition(l.id) is not null then
      n := n + 1;
      raise notice '0143: % now has a % season with a League competition in it', l.name, public.season_label();
    end if;
  end loop;
  raise notice '0143: % league(s) given a first season', n;
end $$;

-- ----------------------------------------------------------------------------
-- 5. GRANTS.
-- ----------------------------------------------------------------------------
revoke all on function public.ensure_first_competition(uuid) from public, anon;
grant execute on function public.ensure_first_competition(uuid) to authenticated;
grant execute on function public.season_label(date) to anon, authenticated, service_role;
alter function public.season_label(date) owner to postgres;
alter function public.ensure_first_competition(uuid) owner to postgres;
alter function public.create_league(text, text, text, text, boolean, boolean) owner to postgres;

-- ============================================================================
-- SELF-TEST. Asserts only about the league it creates itself.
-- ============================================================================
do $test$
declare
  orig text := current_user;
  lg uuid; sn uuid; cp uuid; n int; lbl text;
begin
  begin
    -- the label turns over in July, and reads as two years either side of it
    if public.season_label(date '2026-09-19') <> '2026-27' then
      raise exception '0143: an autumn date is not this season (%)', public.season_label(date '2026-09-19');
    end if;
    if public.season_label(date '2027-03-01') <> '2026-27' then
      raise exception '0143: a spring date belongs to the season that began last year (%)', public.season_label(date '2027-03-01');
    end if;
    if public.season_label(date '2026-07-01') <> '2026-27' then
      raise exception '0143: July is the turn (%)', public.season_label(date '2026-07-01');
    end if;

    insert into leagues (slug, name) values ('t0143-lg', 'Test 0143 League') returning id into lg;
    cp := public.ensure_first_competition(lg);
    if cp is null then raise exception '0143: a new league was given nothing'; end if;

    select count(*) into n from seasons where league_id = lg;
    if n <> 1 then raise exception '0143: % seasons, expected 1', n; end if;
    select s.id, s.name into sn, lbl from seasons s where s.league_id = lg;
    if lbl <> public.season_label() then
      raise exception '0143: the season is called % rather than %', lbl, public.season_label();
    end if;
    select count(*) into n from competitions where season_id = sn and kind = 'league';
    if n <> 1 then raise exception '0143: % league competitions, expected 1', n; end if;

    -- called twice, it does nothing the second time
    if public.ensure_first_competition(lg) is not null then
      raise exception '0143: a second call made a second season';
    end if;
    select count(*) into n from seasons where league_id = lg;
    if n <> 1 then raise exception '0143: a second call left % seasons', n; end if;

    -- and a league that already has a season of its own is not touched
    insert into leagues (slug, name) values ('t0143-fed', 'Test 0143 Fed') returning id into lg;
    insert into seasons (league_id, name) values (lg, '2019-20');
    if public.ensure_first_competition(lg) is not null then
      raise exception '0143: a league with its own season was given another';
    end if;
    select count(*) into n from seasons where league_id = lg;
    if n <> 1 then raise exception '0143: the feed league now has % seasons', n; end if;

    raise exception using errcode = 'P0004', message = '0143 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
end $test$;
