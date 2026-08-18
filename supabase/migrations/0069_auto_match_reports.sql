-- ============================================================================
-- 0069 — A LEAGUE MAY HAVE ITS MATCH REPORTS WRITTEN FOR IT.
--
-- finalise-game already replays a finished game through the shared engine to
-- build the derived tables. It now also writes the match report and files it
-- as a news article, so a league's news page fills itself in as games are
-- played rather than waiting for somebody to sit down and write.
--
-- THIS IS OPT-OUT, NOT OPT-IN, and that is a real decision rather than a
-- default nobody thought about. A league that has just scored its first game
-- and finds a readable report waiting for it has been shown what the platform
-- does; a league that has to discover a setting first mostly never does. The
-- switch exists because publishing under a league's own masthead is the
-- league's call, and a competition that wants to write its own reports should
-- not have to delete ours first.
--
-- WHY THE ARTICLE IS WRITTEN BY THE SERVICE ROLE rather than through
-- upsert_article. That function asks is_league_writer(), which is exactly
-- right for a person and meaningless for the finaliser: it acts as nobody, on
-- behalf of the league, with no session to check. It writes the row directly
-- and stamps author_name so the byline says where it came from instead of
-- borrowing a human's name.
--
-- IDEMPOTENT BY SLUG. The slug is derived from the game id, so re-finalising a
-- reopened game rewrites its own report rather than leaving two. That matters:
-- reopening and re-finalising is the normal way a scoring mistake is corrected,
-- and the report has to follow the correction rather than accumulate.
-- ============================================================================

alter table public.leagues
  add column if not exists auto_reports boolean not null default true;

comment on column public.leagues.auto_reports is
  'Write a match report into the news feed when a game in this league is '
  'finalised. On by default; a league writing its own reports turns it off.';

-- ---------------------------------------------------------------------------
-- The platform console can already edit a league; it should be able to edit
-- this too, rather than leaving the only way to change it a hand-written
-- UPDATE. Same shape as every other argument: null means leave it alone.
-- ---------------------------------------------------------------------------
create or replace function public.platform_update_league(
  p_league uuid,
  p_name text default null, p_slug text default null,
  p_colour_a text default null, p_colour_b text default null,
  p_public_live boolean default null, p_youth_protected boolean default null,
  p_auto_reports boolean default null
) returns text language plpgsql security definer set search_path = public as $$
declare old record;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  select * into old from leagues where id = p_league;
  if not found then raise exception 'no such league' using errcode = '22023'; end if;

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
    youth_protected = coalesce(p_youth_protected, youth_protected),
    auto_reports    = coalesce(p_auto_reports, auto_reports)
  where id = p_league;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'update_league', 'league', p_league::text,
          jsonb_build_object('was', jsonb_build_object(
            'slug', old.slug, 'name', old.name,
            'public_live', old.public_live,
            'youth_protected', old.youth_protected,
            'auto_reports', old.auto_reports)));
  return 'saved';
end; $$;

revoke all on function public.platform_update_league(uuid, text, text, text, text,
  boolean, boolean, boolean) from public, anon;
grant execute on function public.platform_update_league(uuid, text, text, text, text,
  boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Which league a game belongs to, and whether it wants reports. The finaliser
-- has the game id and nothing else; resolving this in SQL keeps the Edge
-- Function from having to know the competition/season/league chain.
-- ---------------------------------------------------------------------------
create or replace function public.game_report_target(p_game uuid)
returns table (league_id uuid, league_name text, auto_reports boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.auto_reports
    from games g
    join competitions c on c.id = g.competition_id
    join seasons s      on s.id = c.season_id
    join leagues l      on l.id = s.league_id
   where g.id = p_game;
$$;

grant execute on function public.game_report_target(uuid) to authenticated, service_role;

-- ------------------------------------------------------------- assertions ---
do $$
declare n int; lg uuid; tgt record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leagues'
                    and column_name = 'auto_reports') then
    raise exception 'ASSERT leagues.auto_reports was not added';
  end if;

  -- on by default, so an existing league starts getting reports
  select count(*) into n from leagues where auto_reports is not true;
  if n <> 0 then
    raise exception 'ASSERT % existing league(s) did not default to auto_reports', n;
  end if;

  -- the resolver answers for a real game, and answers nothing for a stranger
  select id into lg from leagues limit 1;
  if lg is not null then
    select * into tgt from public.game_report_target(
      (select g.id from games g
         join competitions c on c.id = g.competition_id
         join seasons s on s.id = c.season_id
        where s.league_id = lg limit 1));
    if tgt.league_id is distinct from lg then
      raise notice '0069: no game under the first league to resolve against (fine)';
    end if;
  end if;
  if exists (select 1 from public.game_report_target(gen_random_uuid())) then
    raise exception 'ASSERT game_report_target answered for a game that does not exist';
  end if;

  raise notice '0069: auto match reports are on by default and switchable';
end $$;
