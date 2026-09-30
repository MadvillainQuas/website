-- ============================================================================
-- 0188: MERGE TWO ROWS OF ONE CLUB (platform administrators only), and let the suggestion query
--       that feeds the links console FIND the pair this exists for.
--
-- 0178 LINKS clubs that are the same club and reads them together -- and that is right for the
-- rows it was built to relate: a club's men's side and its women's side, or its domestic entry and
-- its EuroCup one, are genuinely different squads sharing a name, and "London Lions" / "London
-- Lions Women" / "London Lions" (EuroCup) staying three rows, shown together, is correct. It is the
-- wrong answer for two rows that are the SAME squad under two spellings. NBL Division One and
-- British Championship Basketball carry no club code on their own game payload, so
-- feedplatform.Platform.team() falls to matching by name -- and the payload's own team object gives
-- Genius's full name ("London Elite Senior Men I") against the schedule's plain one ("London
-- Elite"); "MEN" reads as a marker (names._CLUB_MARKERS: a women's side is a different club), so
-- the two spellings landed as two rows, one crest between them, half the fixtures under each
-- (reported 2026-09-27: Barnet Bulldogs / Barnet Bulldogs Senior Mens on the club list, London
-- Elite / London Elite Senior Men I on the fixtures). names.py's same_club() was taught this
-- specific pattern the same day (a future fetch now resolves to the one row), and link_team_key()
-- below is taught it too, so the pair a fetch already made is FLAGGED here rather than sitting
-- unlinked until somebody happens to search for it by hand.
--
-- A MERGE makes one row: everything that pointed at the merged-away row now points at the one that
-- stays, and the merged-away row is deleted. It cannot be undone (the deleted row is kept whole in
-- team_merges.detail for recovery by hand) -- mirrors 0183's platform_player_merge exactly, for
-- teams instead of players.
--
--   platform_team_merge_preview(keep, other)   what would move, and what stops it. Writes nothing.
--   platform_team_merge(keep, other)           does it, in one transaction, and says what it moved.
--
-- WHAT MOVES. Every table with a foreign key to teams (found by walking every migration up to this
-- one: games.home_team_id/away_team_id, bracket_ties.home_team_id/away_team_id/winner_team_id,
-- competition_teams, roster_entries, standings, feed_team_season, player_releases, merch_designs,
-- team_contacts, team_socials, team_flags, team_group_members, season_awards,
-- season_award_overrides, toty_candidates, toty_results, team_staff, team_sanctions,
-- player_suspensions, contact_messages, embed_sites, announcements), plus media (owner_type
-- 'team'), fan_prefs.fav_team_ids and fanvote_candidates (both kind 'team' rows and the team_id a
-- 'player' row carries for "his club that week"). A row that would then hold a place the surviving
-- team already has (competition_teams and standings and feed_team_season: one row per competition;
-- team_contacts, team_socials, team_flags: one row per team; player_releases: one row per player;
-- merch_designs: one design per league+kind; fanvote_candidates: one per round; roster_entries: a
-- player on both rows' rosters the same season is one roster line) is dropped rather than
-- duplicated -- the row already on the surviving team's account always wins, the merged-away row's
-- is adopted only where the survivor had none. team_group_members the same, plus 0178's own rule:
-- a group left with one member is not a link and goes.
--
-- WHAT IT REFUSES: the two rows are in different leagues (a merge across leagues is never right --
-- the same reasoning as 0178's sponsor match, which "only ever looks inside one league"); the two
-- played each other (then they are two real clubs, not one); either is named in a game that is live
-- or not yet finalised (a play in progress must still belong to a real team).
--
-- WHAT IT LEAVES: the historical text that names an id (notifications.ref, site_events.ref,
-- audit_log); games.roster_snapshot / starters and game_events, which name PLAYERS by id and never
-- a team (games itself carries the team ids directly, in home_team_id / away_team_id, which move);
-- player_previous_clubs.club_name, free text a player's own history keeps as it was typed.
--
-- THE OLD ADDRESS STILL WORKS: team_merges maps the merged-away id and slug to the row that stays,
-- and the club page (epinoia/t/team.js) redirects, exactly as the player page already does (0183).
-- ============================================================================

create table if not exists public.team_merges (
  old_id     uuid primary key,
  old_slug   text,
  old_name   text,
  into_id    uuid not null references public.teams on delete cascade,
  merged_by  uuid,
  merged_at  timestamptz not null default now(),
  detail     jsonb
);
create index if not exists team_merges_slug on public.team_merges (old_slug) where old_slug is not null;
create index if not exists team_merges_into on public.team_merges (into_id);
alter table public.team_merges enable row level security;
drop policy if exists team_merges_read on public.team_merges;
create policy team_merges_read on public.team_merges for select to anon, authenticated using (true);
grant select on public.team_merges to anon, authenticated;

-- "SENIOR MEN (I)" NAMES NOBODY -- the suggestion key learns the same pattern names.py's
-- club_core() does (see there for the full reasoning and the real names). Only the phrase itself
-- is dropped, and only a bare "I" with it: "Senior Men II" keeps its "ii" and is still a different
-- key from the bare name, because a genuine second team (London Lions' reserves, playing in NBL
-- Division One as "London Lions Senior Men II" while its first team plays in the BBL) must not be
-- suggested as the same row its first team's name is.
create or replace function public.link_team_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(btrim(regexp_replace(regexp_replace(
      regexp_replace(public.link_fold(p_name), '\msenior\s+(mens?|womens?)\M(\s+i\M)?', ' ', 'g'),
      '\m(women|womens|woman|female|ladies|feminin|feminine|femenina|femenino|femminile|damen|frauen|dames|vrouwen|fc|bc|bk|kk|kb|cb|bbc|bsc|sc|club|team|the)\M', ' ', 'g'),
      '\s+', ' ', 'g')), ''),
    public.link_fold(p_name));
$$;

-- ----------------------------------------------------------------------------------------------
-- what a merge would do
-- ----------------------------------------------------------------------------------------------
create or replace function public.link_team_merge_blockers(p_keep uuid, p_other uuid)
returns text[] language plpgsql stable set search_path = public as $$
declare
  b text[] := '{}';
  keep_league uuid;
  other_league uuid;
begin
  select league_id into keep_league from public.teams where id = p_keep;
  select league_id into other_league from public.teams where id = p_other;
  if keep_league is distinct from other_league then
    b := b || array['They are in different leagues, so a merge is never right (link them instead if they are related).'];
  end if;
  if exists (select 1 from public.games
              where (home_team_id = p_keep and away_team_id = p_other) or (home_team_id = p_other and away_team_id = p_keep)) then
    b := b || array['They have played each other, so they are two different clubs.'];
  end if;
  if exists (select 1 from public.games where status <> 'final' and (home_team_id in (p_keep, p_other) or away_team_id in (p_keep, p_other))) then
    b := b || array['One of them has a game that is not finished (live or being finalised). Try again when it is over.'];
  end if;
  return b;
end $$;

create or replace function public.platform_team_merge_preview(p_keep uuid, p_other uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k public.teams;
  o public.teams;
begin
  perform public.link_require_admin();
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different clubs are needed' using errcode = '22023';
  end if;
  select * into k from public.teams where id = p_keep;
  select * into o from public.teams where id = p_other;
  if k.id is null or o.id is null then
    raise exception 'a club was not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'keep',  jsonb_build_object('id', k.id, 'name', k.name, 'slug', k.slug, 'logo_path', k.logo_path),
    'other', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'logo_path', o.logo_path),
    'blockers', to_jsonb(public.link_team_merge_blockers(p_keep, p_other)),
    'counts', jsonb_build_object(
      'competitions', (select count(*) from public.competition_teams where team_id = p_other),
      'games',        (select count(*) from public.games where home_team_id = p_other or away_team_id = p_other),
      'rosters',      (select count(*) from public.roster_entries where team_id = p_other),
      'photos',       (select count(*) from public.media where owner_type = 'team' and owner_id = p_other),
      'followers',    (select count(*) from public.fan_prefs where p_other = any (fav_team_ids))));
end $$;

-- the merge --------------------------------------------------------------------------------------------------------------------------
create or replace function public.platform_team_merge(p_keep uuid, p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k public.teams;
  o public.teams;
  blockers text[];
  n_comps int; n_games1 int; n_games2 int; n_roster int; n_photos int; n_follow int;
  gid uuid; left_n int;
  eo jsonb; ek jsonb; also jsonb; kv record; ext jsonb;
begin
  perform public.link_require_admin();
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different clubs are needed' using errcode = '22023';
  end if;
  select * into k from public.teams where id = p_keep for update;
  select * into o from public.teams where id = p_other for update;
  if k.id is null or o.id is null then
    raise exception 'a club was not found' using errcode = '22023';
  end if;
  blockers := public.link_team_merge_blockers(p_keep, p_other);
  if cardinality(blockers) > 0 then
    raise exception 'not merged: %', array_to_string(blockers, ' ') using errcode = '22023';
  end if;

  -- 1. a place the surviving team already has: dropped, not duplicated
  delete from public.competition_teams d using public.competition_teams s
   where d.team_id = p_other and s.team_id = p_keep and s.competition_id = d.competition_id;
  update public.competition_teams set team_id = p_keep where team_id = p_other;
  get diagnostics n_comps = row_count;

  delete from public.standings d using public.standings s where d.team_id = p_other and s.team_id = p_keep and s.competition_id = d.competition_id;
  update public.standings set team_id = p_keep where team_id = p_other;

  delete from public.feed_team_season d using public.feed_team_season s where d.team_id = p_other and s.team_id = p_keep and s.competition_id = d.competition_id;
  update public.feed_team_season set team_id = p_keep where team_id = p_other;

  delete from public.player_releases d using public.player_releases s where d.team_id = p_other and s.team_id = p_keep and s.player_id = d.player_id;
  update public.player_releases set team_id = p_keep where team_id = p_other;

  delete from public.merch_designs d using public.merch_designs s
   where d.team_id = p_other and s.team_id = p_keep and s.league_id = d.league_id and s.kind = d.kind;
  update public.merch_designs set team_id = p_keep where team_id = p_other;

  -- a player on both rows' rosters the same season is one roster line, matching how 0183 handles the same table from the player side
  delete from public.roster_entries d using public.roster_entries s
   where d.team_id = p_other and s.team_id = p_keep and s.player_id = d.player_id and s.season_id is not distinct from d.season_id;
  update public.roster_entries set team_id = p_keep where team_id = p_other;
  get diagnostics n_roster = row_count;

  -- one row per team: the survivor's own (contact details, socials, a hand-set gender flag) always wins; the merged-away
  -- row is adopted only where the survivor had none
  delete from public.team_contacts where team_id = p_other and exists (select 1 from public.team_contacts where team_id = p_keep);
  update public.team_contacts set team_id = p_keep where team_id = p_other;
  delete from public.team_socials where team_id = p_other and exists (select 1 from public.team_socials where team_id = p_keep);
  update public.team_socials set team_id = p_keep where team_id = p_other;
  delete from public.team_flags where team_id = p_other and exists (select 1 from public.team_flags where team_id = p_keep);
  update public.team_flags set team_id = p_keep where team_id = p_other;

  -- 2. rows with no team_id-based collision at all
  update public.season_awards set team_id = p_keep where team_id = p_other;
  update public.season_award_overrides set team_id = p_keep where team_id = p_other;
  update public.toty_candidates set team_id = p_keep where team_id = p_other;
  update public.toty_results set team_id = p_keep where team_id = p_other;
  update public.team_staff set team_id = p_keep where team_id = p_other;
  update public.team_sanctions set team_id = p_keep where team_id = p_other;
  update public.player_suspensions set team_id = p_keep where team_id = p_other;
  update public.contact_messages set team_id = p_keep where team_id = p_other;
  update public.embed_sites set team_id = p_keep where team_id = p_other;
  update public.announcements set team_id = p_keep where team_id = p_other;
  update public.fanvote_candidates set team_id = p_keep where team_id = p_other;             -- a player's club that week

  -- 3. photos, followers, fan-vote candidates as a subject, the games themselves, the bracket
  update public.media set owner_id = p_keep where owner_type = 'team' and owner_id = p_other;
  get diagnostics n_photos = row_count;

  update public.fan_prefs
     set fav_team_ids = (select coalesce(array_agg(distinct case when x = p_other then p_keep else x end), '{}')
                           from unnest(fav_team_ids) x)
   where p_other = any (fav_team_ids);
  get diagnostics n_follow = row_count;

  delete from public.fanvote_candidates d using public.fanvote_candidates s
   where d.kind = 'team' and d.subject_id = p_other and s.kind = 'team' and s.subject_id = p_keep and s.round_id = d.round_id;
  update public.fanvote_candidates set subject_id = p_keep where kind = 'team' and subject_id = p_other;

  update public.games set home_team_id = p_keep where home_team_id = p_other;
  get diagnostics n_games1 = row_count;
  update public.games set away_team_id = p_keep where away_team_id = p_other;
  get diagnostics n_games2 = row_count;

  update public.bracket_ties set home_team_id = p_keep where home_team_id = p_other;
  update public.bracket_ties set away_team_id = p_keep where away_team_id = p_other;
  update public.bracket_ties set winner_team_id = p_keep where winner_team_id = p_other;

  -- 4. the link group: fewer than two members left is not a link any more (0178's own rule)
  delete from public.team_group_members where team_id = p_other and exists (select 1 from public.team_group_members x where x.team_id = p_keep)
    returning group_id into gid;
  if gid is not null then
    select count(*) into left_n from public.team_group_members where group_id = gid;
    if left_n < 2 then delete from public.team_groups where id = gid; end if;
  end if;
  update public.team_group_members set team_id = p_keep where team_id = p_other;

  -- 5. the club that stays: blanks filled, aliases gathered, the feed identities of both kept -
  -- mirrors 0183's own player_merge exactly: the survivor's own code under external_ids.fiba_livestats,
  -- a clashing key of the merged-away row's kept under external_ids.also, so a feed still sending
  -- the old code (or the slug-fallback team_code() built from the old name, feedplatform.py) is not
  -- left with nowhere to resolve to. colour is never actually blank (teams_colour_ck: it defaults
  -- to the site's own mint) -- what says nobody has chosen one is colour_source = 'default' (0102),
  -- the same test team_colours.py itself uses before it writes one, so only that is treated as
  -- "nothing here yet".
  eo := coalesce(o.external_ids, '{}'::jsonb);
  ek := coalesce(k.external_ids, '{}'::jsonb);
  also := coalesce(ek -> 'also', '[]'::jsonb) || coalesce(eo -> 'also', '[]'::jsonb);
  for kv in select key, value from jsonb_each(eo) where key <> 'also' loop
    if ek ? kv.key and (ek -> kv.key) is distinct from kv.value then also := also || jsonb_build_array(kv.value); end if;
  end loop;
  ext := (eo - 'also') || (ek - 'also');
  if jsonb_array_length(also) > 0 then
    ext := ext || jsonb_build_object('also', (select jsonb_agg(distinct v) from jsonb_array_elements(also) v));
  end if;

  update public.teams set
    logo_path     = coalesce(nullif(k.logo_path, ''), o.logo_path),
    short_name    = coalesce(nullif(k.short_name, ''), o.short_name),
    colour        = case when k.colour_source = 'default' and o.colour_source <> 'default' then o.colour else k.colour end,
    colour_2      = case when k.colour_source = 'default' and o.colour_source <> 'default' then o.colour_2 else k.colour_2 end,
    colour_source = case when k.colour_source = 'default' and o.colour_source <> 'default' then o.colour_source else k.colour_source end,
    external_ids  = ext,
    aliases       = (select coalesce(array_agg(distinct a), '{}')
                       from unnest(coalesce(k.aliases, '{}') || coalesce(o.aliases, '{}') || array[o.name]) a
                      where a is not null and btrim(a) <> '' and a <> k.name)
   where id = p_keep;

  -- 6. the old address, the record
  insert into public.team_merges (old_id, old_slug, old_name, into_id, merged_by, detail)
  values (p_other, o.slug, o.name, p_keep, me,
          jsonb_build_object('competitions', n_comps, 'games', n_games1 + n_games2, 'rosters', n_roster, 'photos', n_photos, 'followers', n_follow, 'row', to_jsonb(o)));
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (me, 'team_merge', 'team', p_keep::text, jsonb_build_object('merged', p_other, 'name', o.name, 'competitions', n_comps, 'games', n_games1 + n_games2, 'rosters', n_roster));
  delete from public.teams where id = p_other;

  return jsonb_build_object('kept', p_keep, 'merged', p_other, 'name', k.name, 'competitions', n_comps,
                            'games', n_games1 + n_games2, 'rosters', n_roster, 'photos', n_photos, 'followers', n_follow);
end $$;

revoke all on function public.link_team_merge_blockers(uuid, uuid), public.platform_team_merge_preview(uuid, uuid), public.platform_team_merge(uuid, uuid) from public, anon;
grant execute on function public.link_team_merge_blockers(uuid, uuid), public.platform_team_merge_preview(uuid, uuid), public.platform_team_merge(uuid, uuid) to authenticated, service_role;
alter function public.platform_team_merge_preview(uuid, uuid) owner to postgres;
alter function public.platform_team_merge(uuid, uuid) owner to postgres;
