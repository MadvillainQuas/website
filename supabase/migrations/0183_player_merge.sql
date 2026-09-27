-- ============================================================================
-- 0183: MERGE TWO PROFILES OF ONE PERSON (platform administrators only)
--
-- 0178 LINKS profiles that are the same person and reads them together. A link leaves two rows in every table that ranks
-- players, so a person whose feed changed the spelling of his name half way through a season still appears twice in it. A MERGE
-- makes one profile: everything that pointed at the merged-away profile now points at the one that stays, and the merged-away
-- profile is deleted. It cannot be undone (the deleted row is kept whole in player_merges.detail for recovery by hand).
--
--   platform_player_merge_preview(keep, other)   what would move, and what stops it. Writes nothing.
--   platform_player_merge(keep, other)           does it, in one transaction, and says what it moved.
--
-- WHAT MOVES
--   rows with a foreign key to players   player_game_stats (player_uuid), roster_entries, player_previous_clubs, player_suspensions,
--                                        season_awards, season_award_overrides, membership_eligibility, player_releases, toty_*
--                                        (a row that would collide with one the surviving profile already has is dropped)
--   media (owner_type 'player'), the link group, fan_prefs.fav_player_ids, fanvote_candidates (kind 'player'), highlight_jobs
--   game_events.pid and the ids inside game_events.payload (a substitution names who came on and went off there), and
--   games.roster_snapshot / games.starters: the event log names a player by id, and a play must still belong to him
--   players itself: blanks filled from the merged-away row, aliases gathered (its name becomes an alias of the survivor), and its
--   feed identities kept under external_ids.also so the ingest still finds him by them and does not make the duplicate again
-- WHAT IT REFUSES
--   the two played in the same game (then they are two people); either is in a game that is live, or is not finished
-- WHAT IT LEAVES
--   the historical text that names an id (notifications.ref, site_events.ref, audit_log); the browsers' cached season files, which are
--   read again within six hours, and the published season snapshots, which are dropped here so the next run rebuilds them
-- THE OLD ADDRESS STILL WORKS: player_merges maps the merged-away id and slug to the profile that stays, and the profile page redirects.
--
-- game_events is append-only (forbid_event_mutation, 0001): this changes that trigger to allow ONE thing, a change of pid and payload
-- alone, while a merge has set epinoia.player_merge for the transaction. Everything else about the log is as it was.
-- ============================================================================

create table if not exists public.player_merges (
  old_id     uuid primary key,
  old_slug   text,
  old_name   text,
  into_id    uuid not null references public.players on delete cascade,
  merged_by  uuid,
  merged_at  timestamptz not null default now(),
  detail     jsonb
);
create index if not exists player_merges_slug on public.player_merges (old_slug) where old_slug is not null;
create index if not exists player_merges_into on public.player_merges (into_id);
alter table public.player_merges enable row level security;
drop policy if exists player_merges_read on public.player_merges;
create policy player_merges_read on public.player_merges for select to anon, authenticated using (true);
grant select on public.player_merges to anon, authenticated;

-- the one exception to an append-only event log ---------------------------------------------------------------------------------
create or replace function public.forbid_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('epinoia.player_merge', true), '') = 'on'
     and (to_jsonb(new) - 'pid' - 'payload') = (to_jsonb(old) - 'pid' - 'payload') then
    return new;                                   -- a merge renaming a player: the play itself is not touched
  end if;
  raise exception 'game_events is append-only (attempted %)', tg_op;
end; $$;

-- what a merge would do -----------------------------------------------------------------------------------------------------------
create or replace function public.link_merge_blockers(p_keep uuid, p_other uuid)
returns text[] language plpgsql stable set search_path = public as $$
declare
  b text[] := '{}';
  ks text := p_keep::text;
  os text := p_other::text;
begin
  if exists (select 1 from public.player_game_stats a join public.player_game_stats x on x.game_id = a.game_id
              where a.player_uuid = p_keep and x.player_uuid = p_other) then
    b := b || array['They played in the same game, so they are two different people.'];
  end if;
  if exists (select 1 from public.player_game_stats a join public.games g on g.id = a.game_id
              where a.player_uuid in (p_keep, p_other) and g.status <> 'final') then
    b := b || array['One of them has a game that is not finished (live or being finalised). Try again when it is over.'];
  end if;
  if exists (select 1 from public.games g
              where g.status <> 'final'
                and (g.roster_snapshot::text like '%' || ks || '%' or g.roster_snapshot::text like '%' || os || '%'
                  or g.starters::text like '%' || ks || '%' or g.starters::text like '%' || os || '%')) then
    b := b || array['One of them is named in a game that has not been played yet (its lineup or squad). Try again once that game is finished.'];
  end if;
  return b;
end $$;

create or replace function public.platform_player_merge_preview(p_keep uuid, p_other uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k public.players;
  o public.players;
begin
  perform public.link_require_admin();
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different profiles are needed' using errcode = '22023';
  end if;
  select * into k from public.players where id = p_keep;
  select * into o from public.players where id = p_other;
  if k.id is null or o.id is null then
    raise exception 'a profile was not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'keep',  jsonb_build_object('id', k.id, 'name', btrim(k.first_name || ' ' || coalesce(k.last_name, '')), 'slug', k.slug, 'birth_year', k.birth_year),
    'other', jsonb_build_object('id', o.id, 'name', btrim(o.first_name || ' ' || coalesce(o.last_name, '')), 'slug', o.slug, 'birth_year', o.birth_year),
    'blockers', to_jsonb(public.link_merge_blockers(p_keep, p_other)),
    'birth_years_differ', (k.birth_year is not null and o.birth_year is not null and k.birth_year <> o.birth_year),
    'counts', jsonb_build_object(
      'games',    (select count(*) from public.player_game_stats where player_uuid = p_other),
      'events',   (select count(*) from public.game_events e
                    where e.game_id in (select game_id from public.player_game_stats where player_uuid = p_other
                                        union select id from public.games where roster_snapshot::text like '%' || p_other::text || '%' or starters::text like '%' || p_other::text || '%')
                      and (e.pid = p_other::text or e.payload::text like '%' || p_other::text || '%')),
      'rosters',  (select count(*) from public.roster_entries where player_id = p_other),
      'awards',   (select count(*) from public.season_awards where player_id = p_other),
      'photos',   (select count(*) from public.media where owner_type = 'player' and owner_id = p_other),
      'followers', (select count(*) from public.fan_prefs where p_other = any (fav_player_ids))));
end $$;

-- the merge --------------------------------------------------------------------------------------------------------------------------
create or replace function public.platform_player_merge(p_keep uuid, p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k public.players;
  o public.players;
  ks text := p_keep::text;
  os text := p_other::text;
  blockers text[];
  n_games int; n_events int; n_roster int; n_snap int; n_start int; n_follow int; n_photos int;
  eo jsonb; ek jsonb; also jsonb; kv record; ext jsonb;
  gid uuid; left_n int;
  comps uuid[]; gids uuid[];
begin
  perform public.link_require_admin();
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different profiles are needed' using errcode = '22023';
  end if;
  select * into k from public.players where id = p_keep for update;
  select * into o from public.players where id = p_other for update;
  if k.id is null or o.id is null then
    raise exception 'a profile was not found' using errcode = '22023';
  end if;
  blockers := public.link_merge_blockers(p_keep, p_other);
  if cardinality(blockers) > 0 then
    raise exception 'not merged: %', array_to_string(blockers, ' ') using errcode = '22023';
  end if;

  select array_agg(distinct g.competition_id) into comps
    from public.player_game_stats a join public.games g on g.id = a.game_id
   where a.player_uuid in (p_keep, p_other) and g.competition_id is not null;

  -- 1. rows with a foreign key. A row that would collide with one the surviving profile already has is dropped first.
  update public.player_game_stats set player_uuid = p_keep where player_uuid = p_other;
  get diagnostics n_games = row_count;

  delete from public.roster_entries d using public.roster_entries s
   where d.player_id = p_other and s.player_id = p_keep and s.team_id = d.team_id and s.season_id is not distinct from d.season_id;
  update public.roster_entries set player_id = p_keep where player_id = p_other;
  get diagnostics n_roster = row_count;

  update public.player_previous_clubs set player_id = p_keep where player_id = p_other;
  update public.player_suspensions   set player_id = p_keep where player_id = p_other;
  update public.season_awards        set player_id = p_keep where player_id = p_other;
  update public.season_award_overrides set player_id = p_keep where player_id = p_other;

  delete from public.membership_eligibility d using public.membership_eligibility s
   where d.player_id = p_other and s.player_id = p_keep and s.source_id = d.source_id;
  update public.membership_eligibility set player_id = p_keep where player_id = p_other;

  delete from public.player_releases d using public.player_releases s
   where d.player_id = p_other and s.player_id = p_keep and s.team_id = d.team_id;
  update public.player_releases set player_id = p_keep where player_id = p_other;

  delete from public.toty_candidates d using public.toty_candidates s where d.player_id = p_other and s.player_id = p_keep and s.ballot_id = d.ballot_id;
  update public.toty_candidates set player_id = p_keep where player_id = p_other;
  delete from public.toty_results d using public.toty_results s where d.player_id = p_other and s.player_id = p_keep and s.ballot_id = d.ballot_id;
  update public.toty_results set player_id = p_keep where player_id = p_other;
  delete from public.toty_votes d using public.toty_votes s
   where d.player_id = p_other and s.player_id = p_keep and s.ballot_id = d.ballot_id and s.voter_key = d.voter_key;
  update public.toty_votes set player_id = p_keep where player_id = p_other;

  -- 2. photos, the link group, followers, fan-vote candidates, highlight jobs
  update public.media set owner_id = p_keep where owner_type = 'player' and owner_id = p_other;
  get diagnostics n_photos = row_count;

  delete from public.player_group_members where player_id = p_other and exists (select 1 from public.player_group_members x where x.player_id = p_keep)
    returning group_id into gid;
  if gid is not null then                                    -- his group loses a member: fewer than two is not a link
    select count(*) into left_n from public.player_group_members where group_id = gid;
    if left_n < 2 then delete from public.player_groups where id = gid; end if;
  end if;
  update public.player_group_members set player_id = p_keep where player_id = p_other;   -- he had a group and the survivor had none

  update public.fan_prefs
     set fav_player_ids = (select coalesce(array_agg(distinct case when x = p_other then p_keep else x end), '{}')
                             from unnest(fav_player_ids) x)
   where p_other = any (fav_player_ids);
  get diagnostics n_follow = row_count;

  delete from public.fanvote_candidates d using public.fanvote_candidates s
   where d.kind = 'player' and d.subject_id = p_other and s.kind = 'player' and s.subject_id = p_keep and s.round_id = d.round_id;
  update public.fanvote_candidates set subject_id = p_keep where kind = 'player' and subject_id = p_other;

  update public.highlight_jobs set player_id = ks where player_id = os;

  -- 3. the event log and the games' snapshots name him by id; a play must still be his. The log is append-only but for this.
  -- only in the games he is in (his stats, or a snapshot that names him): the log is half a million rows and the API's statement
  -- timeout is a few seconds, so it is read by (game_id, seq) rather than scanned
  select array_agg(distinct x.g) into gids from (
    select game_id g from public.player_game_stats where player_uuid = p_keep
    union select id from public.games where roster_snapshot::text like '%' || os || '%' or starters::text like '%' || os || '%') x;
  perform set_config('epinoia.player_merge', 'on', true);
  update public.game_events
     set pid = case when pid = os then ks else pid end,
         payload = case when payload::text like '%' || os || '%' then replace(payload::text, os, ks)::jsonb else payload end
   where game_id = any (coalesce(gids, '{}')) and (pid = os or payload::text like '%' || os || '%');
  get diagnostics n_events = row_count;
  perform set_config('epinoia.player_merge', 'off', true);

  update public.games set roster_snapshot = replace(roster_snapshot::text, os, ks)::jsonb
   where roster_snapshot::text like '%' || os || '%';
  get diagnostics n_snap = row_count;
  update public.games set starters = replace(starters::text, os, ks)::jsonb
   where starters::text like '%' || os || '%';
  get diagnostics n_start = row_count;

  -- 4. the profile that stays: blanks filled, aliases gathered, the feed identities of both kept
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

  update public.players set
    birth_year     = coalesce(k.birth_year, o.birth_year),
    photo_media_id = coalesce(k.photo_media_id, o.photo_media_id),
    photo_url      = coalesce(k.photo_url, o.photo_url),
    height_cm      = coalesce(k.height_cm, o.height_cm),
    weight_kg      = coalesce(k.weight_kg, o.weight_kg),
    wingspan_cm    = coalesce(k.wingspan_cm, o.wingspan_cm),
    previous_club  = coalesce(k.previous_club, o.previous_club),
    is_minor       = coalesce(k.is_minor, false) or coalesce(o.is_minor, false),
    external_ids   = ext,
    aliases        = (select coalesce(array_agg(distinct a), '{}')
                        from unnest(coalesce(k.aliases, '{}') || coalesce(o.aliases, '{}') || array[btrim(o.first_name || ' ' || coalesce(o.last_name, ''))]) a
                       where a is not null and btrim(a) <> '' and a <> btrim(k.first_name || ' ' || coalesce(k.last_name, '')))
   where id = p_keep;

  -- 5. the old address, the record, the caches
  insert into public.player_merges (old_id, old_slug, old_name, into_id, merged_by, detail)
  values (p_other, o.slug, btrim(o.first_name || ' ' || coalesce(o.last_name, '')), p_keep, me,
          jsonb_build_object('games', n_games, 'events', n_events, 'rosters', n_roster, 'photos', n_photos, 'followers', n_follow,
                             'snapshots', n_snap, 'starters', n_start, 'row', to_jsonb(o)));
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (me, 'player_merge', 'player', ks, jsonb_build_object('merged', os, 'name', btrim(o.first_name || ' ' || coalesce(o.last_name, '')),
                                                                'games', n_games, 'events', n_events));
  delete from public.players where id = p_other;
  delete from public.snapshots where key = 'stars_global' or (comps is not null and competition_id = any (comps));

  return jsonb_build_object('kept', p_keep, 'merged', p_other, 'name', btrim(k.first_name || ' ' || coalesce(k.last_name, '')),
                            'games', n_games, 'events', n_events, 'rosters', n_roster, 'photos', n_photos, 'followers', n_follow);
end $$;

revoke all on function public.link_merge_blockers(uuid, uuid), public.platform_player_merge_preview(uuid, uuid), public.platform_player_merge(uuid, uuid) from public, anon;
grant execute on function public.link_merge_blockers(uuid, uuid), public.platform_player_merge_preview(uuid, uuid), public.platform_player_merge(uuid, uuid) to authenticated, service_role;
alter function public.platform_player_merge_preview(uuid, uuid) owner to postgres;
alter function public.platform_player_merge(uuid, uuid) owner to postgres;
