-- ============================================================================
-- 0192: EVERY "X" / "X SENIOR MEN (I)" PAIR IN ONE LEAGUE IS MERGED, and a club with a fixture ahead
--       can be merged at all.
--
-- NBL Division One, WNBL Division One and the other Basketball England leagues showed most clubs
-- twice: the schedule's plain name ("London Elite") and the game payload's full one ("London Elite
-- Senior Men I"), two rows of one squad (0188 explains why; the ingest no longer makes new ones).
-- 0188 gave the console a merge; this does the merging, and fixes the rule that stopped it:
--
--   * link_team_merge_blockers counted every game that was not final as "not finished" - scheduled
--     fixtures included - so no club with a game still to play could ever be merged, which is every
--     club in a season. Only a game being played or finalised blocks now (its rows are being written);
--     a fixture ahead simply moves to the club that is kept.
--   * the merge itself is split: team_merge_run does the work and is callable only by other database
--     functions (and this migration); platform_team_merge is the administrators' door to it, as before.
--   * each pair whose names differ only by "Senior Men/Women", with or without a trailing "I", in the
--     same league, is merged into the plain-named row. "II" and "III" are other squads (a club's
--     reserves) and are never touched. A pair the blockers refuse is left apart and named in the log.
--   * a club with no plain-named twin keeps its row and its address, and is given the plain name; the
--     full one stays among its aliases, where the ingest's matching finds it.
-- ============================================================================

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
  if exists (select 1 from public.games where status in ('live', 'finalising')
                                          and (home_team_id in (p_keep, p_other) or away_team_id in (p_keep, p_other))) then
    b := b || array['One of them has a game being played or finalised. Try again when it is over.'];
  end if;
  return b;
end $$;

-- 0188's platform_team_merge body, unchanged but for who it records (p_by) and the admin check, which moves
-- to the door below
create or replace function public.team_merge_run(p_keep uuid, p_other uuid, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := p_by;
  k public.teams;
  o public.teams;
  blockers text[];
  n_comps int; n_games1 int; n_games2 int; n_roster int; n_photos int; n_follow int;
  gid uuid; left_n int;
  eo jsonb; ek jsonb; also jsonb; kv record; ext jsonb;
begin
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

create or replace function public.platform_team_merge(p_keep uuid, p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.link_require_admin();
  return public.team_merge_run(p_keep, p_other, auth.uid());
end $$;

revoke all on function public.team_merge_run(uuid, uuid, uuid) from public, anon, authenticated;
alter function public.team_merge_run(uuid, uuid, uuid) owner to postgres;
revoke all on function public.link_team_merge_blockers(uuid, uuid), public.platform_team_merge(uuid, uuid) from public, anon;
grant execute on function public.link_team_merge_blockers(uuid, uuid), public.platform_team_merge(uuid, uuid) to authenticated, service_role;
alter function public.platform_team_merge(uuid, uuid) owner to postgres;

-- the pairs, merged one at a time: a pair that cannot be merged is named and left, never the whole run
do $$
declare p record; n int := 0; kept int := 0;
begin
  for p in
    select k.id as keep_id, k.name as keep_name, o.id as other_id, o.name as other_name
      from public.teams o
      join public.teams k on k.league_id = o.league_id and k.id <> o.id
       and lower(btrim(k.name)) = lower(btrim(regexp_replace(o.name, '\s+senior\s+(men|women)s?(\s+i)?\s*$', '', 'i')))
     where o.name ~* '\s+senior\s+(men|women)s?(\s+i)?\s*$'
     order by o.name
  loop
    begin
      perform public.team_merge_run(p.keep_id, p.other_id, null);
      n := n + 1;
      raise notice '0192: merged "%" into "%"', p.other_name, p.keep_name;
    exception when others then
      kept := kept + 1;
      raise notice '0192: left "%" and "%" apart: %', p.other_name, p.keep_name, sqlerrm;
    end;
  end loop;
  raise notice '0192: % club(s) merged into their plain-named row, % pair(s) left apart', n, kept;
end $$;

-- a club with no plain-named twin: the plain name, the full one kept as an alias
update public.teams t
   set name = btrim(regexp_replace(t.name, '\s+senior\s+(men|women)s?(\s+i)?\s*$', '', 'i')),
       aliases = case when t.name = any (t.aliases) then t.aliases else t.aliases || t.name end
 where t.name ~* '\s+senior\s+(men|women)s?(\s+i)?\s*$'
   and btrim(regexp_replace(t.name, '\s+senior\s+(men|women)s?(\s+i)?\s*$', '', 'i')) <> ''
   and not exists (select 1 from public.teams k
                    where k.league_id = t.league_id and k.id <> t.id
                      and lower(btrim(k.name)) = lower(btrim(regexp_replace(t.name, '\s+senior\s+(men|women)s?(\s+i)?\s*$', '', 'i'))));
