-- ============================================================================
-- BROADCAST PLAYER IMAGES — a different picture for a different job.
--
-- A profile photograph is a head-and-shoulders portrait that sits in a circle
-- on a player page. A broadcast image is a full-body cut-out with the
-- background removed, standing three-quarters the height of a 1080-line frame
-- on a lineup graphic. Neither is a good substitute for the other: a head shot
-- stretched to full height looks like a mistake, and a cut-out in a circle is
-- a pair of boots.
--
-- So they are separate media, distinguished by `kind`. No schema change is
-- needed for that — media.kind has always been free text — and the storage
-- policy already reads the owner out of the path, so a broadcast image is
-- written and read by exactly the machinery that was already there.
--
-- WHAT DOES NEED CHANGING IS WHO MAY APPROVE ONE.
--
-- media_update permits a platform administrator, or a team manager for media
-- owned by their own team. Player-owned media therefore reaches only a
-- platform administrator — which is right for a photograph a club uploads of
-- somebody's child, and wrong for the person setting up a broadcast the
-- evening before a game. A league administrator running a stream cannot be
-- made to wait on the platform owner to approve twenty-four cut-outs.
--
-- The safeguarding rule does NOT move: a minor's image still requires recorded
-- consent, enforced by the trigger in 0017, and this policy cannot reach past
-- it. What changes is only who may press approve on a player in their own
-- league, which is a person who already administers those players' fixtures,
-- squads and discipline.
-- ============================================================================

create or replace function public.player_in_league(p_player uuid, p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.roster_entries re
    join public.teams t on t.id = re.team_id
    where re.player_id = p_player and t.league_id = p_league
  );
$$;
grant execute on function public.player_in_league(uuid, uuid) to authenticated;

/* A league administrator may approve media belonging to a player who is on a
   roster in their league. Written as its own policy rather than folded into
   media_update, because RLS policies on the same command are OR-ed: adding one
   widens without touching what is already there, and it can be dropped again
   on its own if it ever proves to be too much. */
drop policy if exists media_update_league on public.media;
create policy media_update_league on public.media for update
  using (
    owner_type = 'player'
    and exists (
      select 1 from public.leagues l
      where public.is_league_admin(l.id)
        and public.player_in_league(owner_id, l.id)
    )
  )
  with check (true);

-- ----------------------------------------------------------------------------
-- What a broadcast graphic asks for: every approved cut-out for one fixture.
--
-- One question rather than one per player. A lineup graphic needs twenty-four
-- of these and it is drawn on a machine in a sports hall — twenty-four round
-- trips before the picture appears is the difference between a graphic that is
-- ready at 19:25 and one that is ready at 19:31.
-- ----------------------------------------------------------------------------
create or replace function public.broadcast_images(p_game uuid)
returns table (player_id uuid, storage_path text)
language sql stable security definer set search_path = public as $$
  with squad as (
    select re.player_id
    from public.games g
    join public.roster_entries re
      on re.team_id in (g.home_team_id, g.away_team_id)
    where g.id = p_game and re.active
  )
  select distinct on (m.owner_id) m.owner_id, m.storage_path
  from public.media m
  join squad s on s.player_id = m.owner_id
  where m.owner_type = 'player'
    and m.kind = 'broadcast'
    and m.status = 'approved'
  /* the most recent approved cut-out wins, so replacing one is an upload
     rather than a deletion followed by an upload */
  order by m.owner_id, m.created_at desc;
$$;
grant execute on function public.broadcast_images(uuid) to anon, authenticated;

-- ============================================================================
-- SELF-TEST
-- ============================================================================
do $$
declare
  gid uuid;
  n   int;
begin
  select id into gid from public.games limit 1;
  if gid is null then
    raise notice '0079 self-test skipped: no games';
    return;
  end if;

  -- the function answers, and answers with nothing when nothing is approved
  select count(*) into n from public.broadcast_images(gid);
  raise notice '0079 ok: broadcast_images answers (% rows for the sample fixture)', n;

  -- and it must never return a pending or rejected image
  if exists (
    select 1 from public.broadcast_images(gid) b
    join public.media m on m.owner_id = b.player_id and m.storage_path = b.storage_path
    where m.status <> 'approved'
  ) then
    raise exception '0079: an unapproved image reached a broadcast graphic';
  end if;
end $$;
