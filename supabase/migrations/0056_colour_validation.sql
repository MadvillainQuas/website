-- ============================================================================
-- 0056 — A COLOUR COLUMN MAY ONLY HOLD A COLOUR.
--
-- teams.colour, leagues.colour_a and leagues.colour_b are plain text with a hex
-- default and nothing enforcing the default's shape. admin_update_team checks
-- the slug it is given against a pattern and writes the colour through
-- untouched; create_league and platform_update_league never looked at theirs.
--
-- Those values are rendered into style attributes on the public game page, so
-- an administrator could store
--
--     #fff" onmouseover="...
--
-- and have the markup served to every visitor of every box score in their
-- league. The page's CSP (script-src 'self', no unsafe-inline) stops an
-- injected handler running, and epinoia/boxscore.js now refuses to emit anything
-- that is not a colour — but both of those are downstream. A text column that
-- accepts a quotation mark where a colour belongs is the actual defect, and it
-- is the one place a fix covers every reader: this page, the API, the embeds,
-- the club sites that consume the feed, and whatever gets written next.
--
-- WHY THE CONSTRAINT IS ADDED "NOT VALID" AND THEN VALIDATED SEPARATELY. A
-- plain ADD CONSTRAINT takes an ACCESS EXCLUSIVE lock while it scans the whole
-- table; NOT VALID takes it only briefly, and VALIDATE CONSTRAINT afterwards
-- scans under a weaker lock that readers do not queue behind. On a table this
-- size the difference is theoretical — on a live one during a game it is not,
-- and the habit is worth keeping either way.
--
-- Legacy rows are repaired first rather than left failing validation. Anything
-- unparseable becomes the platform default, because a club whose colour cannot
-- be rendered has, in practice, no colour set.
-- ============================================================================

-- one definition, used by the constraints and by the write path
create or replace function public.is_css_colour(v text)
returns boolean language sql immutable parallel safe as $$
  /* Three, six or eight hex digits. Deliberately NOT the functional notations
     that the renderer tolerates: a stored value is typed into a colour picker
     by a person and only ever comes back as hex, so accepting rgb() here would
     widen what has to be reasoned about for nothing. The renderer is more
     permissive than the column on purpose — it has to cope with our own
     var(--token) fallbacks, which are never stored. */
  select v is not null and v ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';
$$;

comment on function public.is_css_colour(text) is
  'True for #rgb, #rrggbb or #rrggbbaa. The only shape a colour column may hold.';

-- ---------------------------------------------------------------- repair ---
update public.teams
   set colour = '#93f2bf'
 where not public.is_css_colour(colour);

update public.leagues
   set colour_a = '#93f2bf'
 where not public.is_css_colour(colour_a);

update public.leagues
   set colour_b = '#8ff5ff'
 where not public.is_css_colour(colour_b);

-- ------------------------------------------------------------ constrain ---
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_colour_ck') then
    alter table public.teams
      add constraint teams_colour_ck check (public.is_css_colour(colour)) not valid;
    alter table public.teams validate constraint teams_colour_ck;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leagues_colour_a_ck') then
    alter table public.leagues
      add constraint leagues_colour_a_ck check (public.is_css_colour(colour_a)) not valid;
    alter table public.leagues validate constraint leagues_colour_a_ck;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leagues_colour_b_ck') then
    alter table public.leagues
      add constraint leagues_colour_b_ck check (public.is_css_colour(colour_b)) not valid;
    alter table public.leagues validate constraint leagues_colour_b_ck;
  end if;
end $$;

-- ------------------------------------------------------------- the RPCs ---
-- The constraint alone would refuse the write, but with a message about a check
-- constraint. An administrator who has typed something odd into a colour box
-- deserves to be told that, in the same voice the slug rule already uses.
create or replace function public.admin_update_team(
  p_team uuid, p_name text default null, p_short text default null,
  p_colour text default null, p_slug text default null
) returns text language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;
  if not (public.is_platform_admin()
          or (t.league_id is not null and public.is_league_admin(t.league_id))) then
    raise exception 'you do not administer that club''s league' using errcode = '42501';
  end if;
  if p_slug is not null and p_slug <> t.slug
     and p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'a slug is lower-case letters, digits and single hyphens'
      using errcode = '22023';
  end if;
  if p_colour is not null and not public.is_css_colour(p_colour) then
    raise exception 'a colour is a hex code such as #93f2bf' using errcode = '22023';
  end if;

  update teams set
    name       = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    short_name = coalesce(p_short, short_name),
    colour     = coalesce(p_colour, colour),
    slug       = coalesce(p_slug, slug)
  where id = p_team;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'admin_update_team', 'team', p_team::text,
          jsonb_build_object('name', p_name, 'slug', p_slug));
  return 'saved';
end; $$;

revoke execute on function public.admin_update_team(uuid, text, text, text, text) from anon, public;
grant  execute on function public.admin_update_team(uuid, text, text, text, text) to authenticated;

-- create_league and platform_update_league take colours too. Rather than
-- restate either function — both are long and neither is otherwise changing —
-- the constraint on leagues does the refusing, and this trigger turns it into
-- the same sentence a club edit gets.
create or replace function public.leagues_colour_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_css_colour(new.colour_a) or not public.is_css_colour(new.colour_b) then
    raise exception 'a colour is a hex code such as #93f2bf' using errcode = '22023';
  end if;
  return new;
end; $$;

drop trigger if exists leagues_colour_guard on public.leagues;
create trigger leagues_colour_guard
  before insert or update of colour_a, colour_b on public.leagues
  for each row execute function public.leagues_colour_guard();

-- ------------------------------------------------------------ assertions ---
-- plpgsql bodies are not type-checked at creation and a constraint that was
-- never exercised is a constraint nobody has tested. Both are proved here, in
-- the migration that adds them, and rolled back.
do $$
declare v_team uuid; v_league uuid; blocked boolean;
begin
  if not public.is_css_colour('#93f2bf') then raise exception 'ASSERT hex rejected'; end if;
  if not public.is_css_colour('#FFF')    then raise exception 'ASSERT short hex rejected'; end if;
  if public.is_css_colour('#fff" onmouseover="x') then raise exception 'ASSERT breakout accepted'; end if;
  if public.is_css_colour('red')         then raise exception 'ASSERT keyword accepted'; end if;
  if public.is_css_colour('url(https://e/x)') then raise exception 'ASSERT url accepted'; end if;
  if public.is_css_colour(null)          then raise exception 'ASSERT null accepted'; end if;

  select id into v_league from leagues limit 1;
  if v_league is null then
    raise notice '0056: no leagues to test the constraints against';
    return;
  end if;

  -- the table refuses the breakout even without going through an RPC
  begin
    insert into teams (league_id, slug, name, short_name, colour)
    values (v_league, 'zz-colour-probe', 'Probe', 'ZZ', '#fff" onmouseover="x')
    returning id into v_team;
    blocked := false;
  exception when check_violation then blocked := true;
  end;
  if not blocked then
    delete from teams where id = v_team;
    raise exception 'ASSERT teams_colour_ck did not fire';
  end if;

  begin
    update leagues set colour_a = 'red;background:url(https://e/x)' where id = v_league;
    blocked := false;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'ASSERT leagues colour guard did not fire'; end if;

  raise notice '0056: colour constraints proved on both tables';
end $$;
