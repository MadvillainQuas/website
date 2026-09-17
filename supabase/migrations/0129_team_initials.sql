-- ============================================================================
-- 0129 — A CLUB'S INITIALS, FOR THE SCREENS TOO NARROW FOR ITS NAME.
--
-- On a phone, HOME's fixture cards (and every compact fixture card) have room for about four
-- letters beside a crest, not "Nottingham Hoods". The letters are worked out in the browser for
-- every club in a league at once (epinoia/initials.js), so two clubs in one league never share
-- them: "London Lions" and "London Cavaliers" become LLI and LCA, not LON and LON.
--
-- A club can choose its own. teams.initials holds that choice (null = worked out), set from the
-- club portal or by the league through set_team_initials, which checks who is asking the same
-- way set_team_colour does (may_manage_media: the club's managers, its league's admins, the
-- platform). A chosen code is 2 to 4 capital letters or digits, and unique within the league:
-- the unique index enforces that for chosen codes, and the browser works the rest out around
-- them.
--
-- Nothing else changes: teams_read (0001) already lets anybody read every column, and the
-- browser tolerates this column being absent (it asks again without it). Re-running this file
-- changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

alter table public.teams
  add column if not exists initials text;

do $c$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.teams'::regclass and conname = 'teams_initials_shape') then
    alter table public.teams
      add constraint teams_initials_shape
      check (initials is null or initials ~ '^[A-Z0-9]{2,4}$');
  end if;
end $c$;

create unique index if not exists teams_league_initials_key
  on public.teams (league_id, initials) where initials is not null;

comment on column public.teams.initials is
  'The club''s own choice of 2-4 capital letters or digits for narrow screens (set_team_initials); null = worked out per league in the browser (epinoia/initials.js). Unique within a league.';

create or replace function public.set_team_initials(p_team uuid, p_initials text)
returns text language plpgsql security definer set search_path = public as $$
declare
  t record;
  v text;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;
  if not public.may_manage_media('team', p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  -- "n.o.t", "not " and "NOT" are the same choice; empty hands the letters back to the browser
  v := upper(regexp_replace(coalesce(p_initials, ''), '[^A-Za-z0-9]', '', 'g'));
  if v = '' then
    v := null;
  elsif v !~ '^[A-Z0-9]{2,4}$' then
    raise exception 'initials are 2 to 4 letters or digits, such as NOT or LRB' using errcode = '22023';
  elsif exists (select 1 from teams o
                 where o.league_id is not distinct from t.league_id
                   and o.id <> p_team and o.initials = v) then
    raise exception 'another club in this league already uses %', v using errcode = '23505';
  end if;

  update teams set initials = v where id = p_team;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_team_initials', 'team', p_team::text,
          jsonb_build_object('from', t.initials, 'to', v));
  return coalesce(v, 'auto');
end; $$;

alter function public.set_team_initials(uuid, text) owner to postgres;
revoke all on function public.set_team_initials(uuid, text) from public, anon;
grant execute on function public.set_team_initials(uuid, text) to authenticated;

-- ============================================================================
-- SELF-TEST: the column, its shape and its per-league uniqueness, and who may call the setter.
-- The two clubs it makes are rolled back.
-- ============================================================================
do $test$
declare
  lg uuid;
  a  uuid;
  b  uuid;
begin
  if not exists (select 1 from pg_attribute att
                  where att.attrelid = 'public.teams'::regclass and att.attname = 'initials'
                    and not att.attisdropped and not att.attnotnull and att.atttypid = 'text'::regtype) then
    raise exception '0129: teams needs a nullable text column initials';
  end if;
  if not has_function_privilege('authenticated', 'public.set_team_initials(uuid, text)', 'execute') then
    raise exception '0129: a signed-in user must be able to call set_team_initials';
  end if;
  if has_function_privilege('anon', 'public.set_team_initials(uuid, text)', 'execute') then
    raise exception '0129: set_team_initials must not be callable signed out';
  end if;

  select id into lg from public.leagues order by created_at limit 1;
  if lg is null then return; end if;

  begin
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg, 't0129-a', '0129 Test A', 'TA', '#93f2bf') returning id into a;
    insert into public.teams (league_id, slug, name, short_name, colour)
    values (lg, 't0129-b', '0129 Test B', 'TB', '#93f2bf') returning id into b;

    update public.teams set initials = 'TQA' where id = a;
    begin
      update public.teams set initials = 'TQA' where id = b;
      raise exception '0129: two clubs in one league were given the same initials';
    exception when unique_violation then null;
    end;
    begin
      update public.teams set initials = 'toolong' where id = b;
      raise exception '0129: initials outside 2-4 capitals or digits were accepted';
    exception when check_violation then null;
    end;
    update public.teams set initials = null where id = a;
    update public.teams set initials = null where id = b;   -- any number of clubs may be worked out

    raise exception using errcode = 'P0004', message = '0129 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
end $test$;
