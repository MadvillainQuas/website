-- ============================================================================
-- 0065 — ONLY A CREST MAY BE WRITTEN STRAIGHT INTO THE PUBLIC BUCKET.
--
-- 0064 added a write policy on media-public so a file could be moved into it.
-- It permitted anything may_publish_media allowed, and for a PLAYER path that
-- includes the manager of a team the player is on — so a club manager could
-- have written a child's photograph directly into public storage and skipped
-- the approval queue and its consent check entirely.
--
-- Caught by asking rather than assuming. Impersonating a real account and
-- attempting each write in turn:
--
--     crest into media-public          allowed   (intended)
--     thumbnail into media-public      allowed   (intended)
--     player photo into media-public   ALLOWED   (not intended)
--
-- The consent rule in 0017 fires at approve_media, and I proved two migrations
-- ago that it still does — but a storage bucket is a second door into the same
-- room, and that one had just been left open. A safeguarding rule enforced in
-- one of the two places an image can become public is not enforced.
--
-- THE RULE NOW HAS TWO HALVES, and a player photograph satisfies neither by the
-- direct route:
--
--   * a CREST or a LEAGUE LOGO may be written straight in by whoever owns it,
--     because those publish on arrival by design and contain nobody;
--   * anything else may be written in only by somebody who could have APPROVED
--     it — a platform administrator, or an administrator of the league the
--     subject belongs to — which is what the approval move needs and what a
--     club manager is not.
--
-- So a player photograph still has exactly one way to become public: a league
-- administrator approving it, which is the step that checks consent.
-- ============================================================================

/* Whoever could approve this image, judged from its path — the same test
   approve_media makes, in the shape a storage policy can use. Deliberately NOT
   may_manage_media, which includes the club's own manager. */
create or replace function public.may_approve_media(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text; oid uuid; league_of uuid;
begin
  if public.is_platform_admin() then return true; end if;
  select owner_type, owner_id into t, oid from public.media_path_owner(p_path);
  if oid is null then return false; end if;

  if t = 'team' then
    select league_id into league_of from teams where id = oid;
  elsif t = 'league' then
    league_of := oid;
  elsif t = 'player' then
    select tm.league_id into league_of
      from roster_entries re join teams tm on tm.id = re.team_id
     where re.player_id = oid and re.active limit 1;
  end if;

  return league_of is not null and public.is_league_admin(league_of);
end; $$;

grant execute on function public.may_approve_media(text) to authenticated;

/* A crest or a league logo, by its path. The uploader names every file
   "<kind>-<stamp>.<ext>", so the kind is legible from the name — and the owner
   segment is checked too, so a player path cannot be dressed up as a logo. */
create or replace function public.is_owned_logo_path(p_path text)
returns boolean language sql immutable as $$
  select p_path ~ '^(team|league)/[0-9a-fA-F-]{36}/logo-[^/]+$';
$$;

grant execute on function public.is_owned_logo_path(text) to anon, authenticated;

drop policy if exists media_public_write on storage.objects;
create policy media_public_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media-public'
    and (
      /* published on arrival, and contains nobody */
      (public.is_owned_logo_path(name) and public.may_publish_media(name))
      /* or moved in by somebody who could have approved it */
      or public.may_approve_media(name)
    ));

-- ------------------------------------------------------------- assertions ---
do $$
declare r text := '';
begin
  -- the path test itself, which is what keeps the two halves apart
  if not public.is_owned_logo_path(
       'team/4bd8b5d7-9142-4b74-89e7-3bfe5d08d92f/logo-abc.webp') then
    raise exception 'ASSERT a real crest path was not recognised';
  end if;
  if not public.is_owned_logo_path(
       'league/4bd8b5d7-9142-4b74-89e7-3bfe5d08d92f/logo-abc.svg') then
    raise exception 'ASSERT a league logo path was not recognised';
  end if;
  if public.is_owned_logo_path(
       'player/4bd8b5d7-9142-4b74-89e7-3bfe5d08d92f/photo-abc.webp') then
    raise exception 'ASSERT a player photograph counted as a logo';
  end if;
  -- and a player path cannot be dressed up as one
  if public.is_owned_logo_path(
       'player/4bd8b5d7-9142-4b74-89e7-3bfe5d08d92f/logo-abc.webp') then
    raise exception 'ASSERT a player path named logo- counted as a logo';
  end if;
  if public.is_owned_logo_path(
       'team/4bd8b5d7-9142-4b74-89e7-3bfe5d08d92f/nested/logo-abc.webp') then
    raise exception 'ASSERT a nested path counted as a logo';
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage'
                   and tablename='objects' and policyname='media_public_write') then
    raise exception 'ASSERT media_public_write missing';
  end if;

  raise notice '0065: only crests and league logos go straight into media-public';
end $$;
