-- ============================================================================
-- 0126 — A SIDE THAT IS NOT KNOWN YET IS NOT A CLUB.
--
-- A cup draw publishes its later rounds before the earlier ones are played, so the
-- SLB schedule listed its Trophy ties against "To be determined", and the schedule
-- sync, which creates any club it does not recognise, created a club by that name
-- with two fixtures of its own (17 September 2026). Standings, the teams layer, the
-- follow buttons and the notification fan-outs all took it for a club.
--
-- Three things, each for that reason:
--   1. public.is_placeholder_team_name(text): the rule. The same patterns, character
--      for character, as scripts/ingest/placeholders.py (which stops the ingest
--      creating one; a fixture against a placeholder waits until the schedule names
--      the side) and isPlaceholderTeam in epinoia/admin/admin.js (the console),
--      all three tested against supabase/tests/fixtures/placeholder_teams.json.
--      Names are compared lower-cased, with dots removed and spaces collapsed:
--        TBD / TBC / TBA (T.B.D., Team TBD, TBC 1, TBD (Winner SF1)),
--        To be determined / confirmed / decided / announced / named / assigned / agreed,
--        Winner (or Loser) of QF1 / SF2 / Semi-final / Game 3 / Match 4 / Round 2,
--        QF1 Winner / Semi-final 1 winner / Game 5 loser,
--        Bye, Unknown, Unknown team, Placeholder, Not yet known, TBD v TBD;
--   2. the placeholder clubs already created are removed, with their fixtures, which
--      the schedule writes again once both sides are named. A placeholder club whose
--      games have been played or scored is left alone with a WARNING: those games
--      need re-pointing to the real clubs by hand, and deleting them would lose them;
--   3. a trigger refuses to create a club with a placeholder's name, or to rename a
--      club to one, whatever writes it: every path is covered, including ones not
--      written yet.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE RULE
-- ----------------------------------------------------------------------------
create or replace function public.is_placeholder_team_name(p text)
returns boolean language sql immutable set search_path = public as $$
  select x.s <> ''
     and (x.s ~ '^(team )?t ?b ?[dca]( ?[0-9]+)?( ?\(.*\))?$'
       or x.s ~ '^to be (determined|confirmed|decided|announced|named|assigned|agreed)( .*)?$'
       or x.s ~ '^(winners?|losers?) (of )?(the )?(qf|sf|semi|quarter|final|game|match|round|tie|r[0-9]|g[0-9]|m[0-9]|#)'
       or x.s ~ '^(qf|sf|semi ?-?final|quarter ?-?final|game|match|round|tie) ?[0-9]* (winners?|losers?)$'
       or x.s ~ '^(bye|unknown( team)?|placeholder|not yet (known|determined|decided))$'
       or x.s ~ '^t ?b ?[dca] vs?\.? t ?b ?[dca]$')
    from (select btrim(regexp_replace(replace(lower(coalesce(p, '')), '.', ''), '\s+', ' ', 'g')) as s) x;
$$;

alter function public.is_placeholder_team_name(text) owner to postgres;

-- ----------------------------------------------------------------------------
-- 2. THE PLACEHOLDER CLUBS ALREADY CREATED
-- ----------------------------------------------------------------------------
do $clean$
declare
  t         record;
  v_blocked int;
  v_games   int;
begin
  for t in
    select tm.id, tm.name, l.slug as league
      from teams tm
      left join leagues l on l.id = tm.league_id
     where public.is_placeholder_team_name(tm.name)
     order by tm.created_at
  loop
    select count(*) into v_blocked
      from games g
     where (g.home_team_id = t.id or g.away_team_id = t.id)
       and (g.status <> 'scheduled' or exists (select 1 from game_events e where e.game_id = g.id));
    if v_blocked > 0 then
      raise warning '0126: "%" (%, league %) is a placeholder but % of its games have been played or scored; it is kept. Point those games at the real clubs, then delete it.',
        t.name, t.id, coalesce(t.league, 'none'), v_blocked;
      continue;
    end if;
    delete from games g where g.home_team_id = t.id or g.away_team_id = t.id;
    get diagnostics v_games = row_count;
    delete from teams tm where tm.id = t.id;
    raise notice '0126: removed the placeholder club "%" (league %) and its % unplayed fixture(s); the schedule writes them again once both sides are named',
      t.name, coalesce(t.league, 'none'), v_games;
  end loop;
end $clean$;

-- ----------------------------------------------------------------------------
-- 3. NO NEW ONES, WHATEVER WRITES THEM
-- ----------------------------------------------------------------------------
create or replace function public.teams_refuse_placeholder()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;
  if public.is_placeholder_team_name(new.name) then
    raise exception '"%" stands for a side that is not known yet, not a club', new.name
      using errcode = '23514',
            hint = 'A fixture against it waits until the schedule names both teams.';
  end if;
  return new;
end $$;

alter function public.teams_refuse_placeholder() owner to postgres;
revoke all on function public.teams_refuse_placeholder() from public, anon, authenticated;

drop trigger if exists teams_refuse_placeholder on public.teams;
create trigger teams_refuse_placeholder
  before insert or update of name on public.teams
  for each row execute function public.teams_refuse_placeholder();

-- ============================================================================
-- SELF-TEST — the rule against the shared vectors (placeholder_teams.json, copied
-- exactly), the trigger both ways, and no placeholder club left but a kept one.
-- Rolled back (P0115 pattern).
-- ============================================================================
do $test$
declare
  who     text := current_user || ' (session ' || session_user || ')';
  v_txt   text;
  v_lg    uuid;
  v_team  uuid;
  v_kept  int;
begin
  select string_agg(format('%L should be a placeholder', x.n), '; ') into v_txt
    from unnest(array[
      'To be determined', 'TO BE DETERMINED', 'to be determined ', 'To Be Confirmed', 'To be decided', 'To be announced',
      'TBD', 'tbd', 'TBC', 'TBA', 'T.B.D.', 'T.B.C', 'T B D', 'TBD (Winner SF1)', 'Team TBD', 'TBC 1', 'TBD2',
      'Winner of QF1', 'Winner QF1', 'Winner SF 2', 'Winners of Semi Final 1', 'Loser of Game 3', 'Winner Match 4',
      'Winner R1', 'QF1 Winner', 'Semi-final 1 winner', 'Quarter Final 2 Winner', 'Game 5 Loser',
      'Bye', 'BYE', 'Unknown', 'Unknown team', 'Placeholder', 'Not yet known', 'TBD v TBD']) x(n)
   where not public.is_placeholder_team_name(x.n);
  if v_txt is not null then raise exception '0126: %', v_txt; end if;

  select string_agg(format('%L is a club', x.n), '; ') into v_txt
    from unnest(array[
      'Reading Rockets', 'London Lions', 'Bristol Flyers', 'Newcastle Eagles', 'Caledonia Gladiators',
      'Leicester Riders', 'Manchester Basketball', 'Cheshire Phoenix', 'Sheffield Sharks', 'Surrey 89ers',
      'Oaklands Wolves', 'Tobermory Tigers', 'Tbilisi Tornadoes', 'Byers Green Bulls', 'Winnersh Warriors',
      'Unity Hoops', 'Team Solent Kestrels', 'Derby Trailblazers', 'Loughborough Riders', 'Abbey Tbacks',
      'Winchester Kings', 'Tbc Tigers Academy', '', '   ']) x(n)
   where public.is_placeholder_team_name(x.n);
  if v_txt is not null then raise exception '0126: %', v_txt; end if;
  if public.is_placeholder_team_name(null) then raise exception '0126: a missing name counted as a placeholder'; end if;

  if not exists (select 1 from pg_trigger tg
                  where tg.tgrelid = 'public.teams'::regclass and tg.tgname = 'teams_refuse_placeholder'
                    and not tg.tgisinternal and tg.tgenabled <> 'D') then
    raise exception '0126: teams has no teams_refuse_placeholder trigger';
  end if;
  if (select p.provolatile from pg_proc p where p.oid = 'public.is_placeholder_team_name(text)'::regprocedure) <> 'i'
     or not has_function_privilege('authenticated', 'public.is_placeholder_team_name(text)', 'execute') then
    raise exception '0126: is_placeholder_team_name must be immutable and callable by a signed-in admin (the trigger runs as them)';
  end if;

  -- what is left: only placeholder clubs with played or scored games, each warned about above
  select count(*) into v_kept
    from teams tm
   where public.is_placeholder_team_name(tm.name)
     and not exists (select 1 from games g
                      where (g.home_team_id = tm.id or g.away_team_id = tm.id)
                        and (g.status <> 'scheduled' or exists (select 1 from game_events e where e.game_id = g.id)));
  if v_kept > 0 then
    raise exception '0126: % placeholder club(s) with nothing played are still there', v_kept;
  end if;

  begin
    insert into leagues (slug, name) values ('zz-t126', '0126') returning id into v_lg;
    begin
      insert into teams (league_id, slug, name, short_name) values (v_lg, 'zz-t126-tbd', 'To be determined', 'TBD');
      raise exception '0126: a club named "To be determined" was created';
    exception when check_violation then null;
    end;
    begin
      insert into teams (league_id, slug, name, short_name) values (v_lg, 'zz-t126-w', 'Winner of SF1', 'W');
      raise exception '0126: a club named "Winner of SF1" was created';
    exception when check_violation then null;
    end;
    insert into teams (league_id, slug, name, short_name) values (v_lg, 'zz-t126-rockets', 'Reading Rockets', 'RR')
      returning id into v_team;
    update teams set short_name = 'ROC' where id = v_team;
    begin
      update teams set name = 'TBC' where id = v_team;
      raise exception '0126: a club was renamed "TBC"';
    exception when check_violation then null;
    end;
    update teams set name = 'Reading Rockets Academy' where id = v_team;
    raise exception using errcode = 'P0126', message = '0126 passed; rolling its test rows back';
  exception
    when sqlstate 'P0126' then null;
    when others then raise exception '% [ran as %]', sqlerrm, who;
  end;

  if exists (select 1 from leagues where slug = 'zz-t126') then
    raise exception '0126: the test rows outlived their rollback';
  end if;
  raise notice '0126 ok: the placeholder rule matches every shared vector and no club; no placeholder club with nothing played is left; the trigger refuses creating or renaming one and lets real clubs through';
end $test$;
