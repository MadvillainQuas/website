-- ============================================================================
-- 0073 — REJECTING A PHOTOGRAPH MUST NOT DELETE FROM storage.objects.
--
-- The same fault 0062 fixed for publishing, in the function next to it.
--
-- reject_media has been unchanged since 0017 and still ends with
--
--     delete from storage.objects
--      where bucket_id in ('media-pending','media-public') and name = ...
--
-- which Supabase now refuses outright, from any role, including a SECURITY
-- DEFINER function owned by the superuser:
--
--     Direct deletion from storage tables is not allowed.
--     Use the Storage API instead.  [42501]
--
-- So every rejection failed. It has been failing since Supabase tightened
-- this, and nobody could tell, because the console reported every 42501 as
-- "Refused: platform administrators only" — a platform administrator pressing
-- reject was told they were not a platform administrator. The message was
-- fixed first; this is what it revealed.
--
-- THE SPLIT IS THE SAME ONE 0062 CHOSE. Only the Storage API may remove an
-- object, so the caller does that, and the function does the part only the
-- database can do: check who is asking, record the decision, write the audit
-- row. Neither half can be skipped to reach the other — the bytes are useless
-- without the row, and the row is what every read path actually consults.
--
-- ORDER, DELIBERATELY: the row is marked rejected FIRST and the bytes are
-- cleaned up after. A rejected image lives in media-pending, which is private
-- and served to nobody, so the moderation decision is the urgent half; a
-- storage hiccup must not be able to leave a photograph un-rejected. The
-- reverse order would trade a safe outcome for a tidy one.
-- ============================================================================

create or replace function public.reject_media(p_media uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public, storage as $$
declare m record; league_of uuid;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such media' using errcode = 'P0002'; end if;

  if m.owner_type = 'team' then
    select league_id into league_of from teams where id = m.owner_id;
  elsif m.owner_type = 'league' then
    league_of := m.owner_id;
  elsif m.owner_type = 'player' then
    select t.league_id into league_of
      from roster_entries re join teams t on t.id = re.team_id
     where re.player_id = m.owner_id and re.active limit 1;
  end if;

  if not (public.is_platform_admin()
          or (league_of is not null and public.is_league_admin(league_of))) then
    raise exception 'only the league may reject its images' using errcode = '42501';
  end if;

  -- The bytes are removed by the caller through the Storage API. Nothing here
  -- touches storage.objects; see the note above.
  update media
     set status = 'rejected', approved_by = auth.uid()
   where id = p_media;

  /* A rejected crest must stop being the club's crest. Nothing did this,
     because the row that pointed at it was only ever cleared on delete. */
  if m.owner_type = 'team' then
    update teams set logo_path = null
     where id = m.owner_id and logo_path = m.storage_path;
  elsif m.owner_type = 'player' then
    update players set photo_media_id = null
     where id = m.owner_id and photo_media_id = p_media;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'reject_media', m.owner_type, m.owner_id::text,
          jsonb_build_object('media', p_media, 'reason', p_reason,
                             'path', m.storage_path));
  return 'rejected';
end; $$;

revoke all on function public.reject_media(uuid, text) from public, anon;
grant execute on function public.reject_media(uuid, text) to authenticated;

comment on function public.reject_media(uuid, text) is
  'Records a rejection and unhooks the image from whatever was showing it. It '
  'does NOT remove the object — only the Storage API can do that, and the '
  'caller does it after this returns.';

-- ============================================================================
-- A migration that does not call what it creates has not been tested, and this
-- one exists precisely because a function nobody re-ran kept a statement that
-- had stopped being legal.
-- ============================================================================
do $$
declare
  src text; failed text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_media';

  if src is null then
    raise exception 'reject_media is missing after its own migration';
  end if;

  if src ~* 'delete\s+from\s+storage\.objects' then
    failed := array_append(failed,
      'reject_media still deletes from storage.objects — the statement this migration exists to remove');
  end if;

  -- the neighbouring function must stay clean too, or the pair drifts again
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approve_media';
  if src ~* 'delete\s+from\s+storage\.objects' then
    failed := array_append(failed, 'approve_media deletes from storage.objects');
  end if;

  -- and it must still refuse somebody with no standing
  if not exists (
    select 1 from pg_proc p
     where p.proname = 'reject_media'
       and pg_get_functiondef(p.oid) like '%only the league may reject its images%') then
    failed := array_append(failed, 'reject_media lost its permission check');
  end if;

  if array_length(failed, 1) is not null then
    raise exception 'reject_media is wrong: %', array_to_string(failed, '; ');
  end if;
  raise notice 'reject_media verified: no SQL delete, permission check intact';
end $$;

-- ============================================================================
-- AND THE THIRD ONE, FOUND BY THE TEST THIS MIGRATION ADDED.
--
-- publish_team_logo is defined once, in 0061, and 0062 — the migration whose
-- whole subject was "publishing must not delete from storage.objects" — did
-- not actually redefine any function. So the club portal's crest publisher
-- still carries BOTH faults:
--
--     delete from storage.objects ...            refused outright
--     update storage.objects set bucket_id = ... moves the ROW, not the bytes
--
-- The second is the quieter one: 0064 established that a SQL update of
-- bucket_id leaves the file where it was, so a crest published this way 404s.
--
-- Same split as everywhere else now. The function decides and records; the
-- caller moves and removes through the Storage API. It returns the paths it
-- wants cleaned up so the caller does not have to re-derive them. The key is
-- `orphans`, which is what the club portal has always read.
-- ============================================================================
-- The return type changes from text to jsonb, and `create or replace` cannot
-- do that — it fails with "cannot change return type of existing function".
-- Dropping first is the only way, and it is safe here because the grant is
-- reissued below.
drop function if exists public.publish_team_logo(uuid);

create or replace function public.publish_team_logo(p_media uuid)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare m record; old record; gone text[] := '{}';
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such image' using errcode = 'P0002'; end if;

  if m.owner_type <> 'team' or m.kind <> 'logo' then
    raise exception 'this publishes club crests only — everything else goes '
                    'through the league''s approval queue'
      using errcode = '42501';
  end if;

  if not public.is_team_manager(m.owner_id) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  if m.status = 'approved' then
    return jsonb_build_object('status', 'already published',
                              'path', m.storage_path, 'orphans', gone);
  end if;

  /* the previous crest goes — a club has one crest. The ROW goes here; the
     FILE is named in the return value for the caller to remove. */
  for old in select * from media
              where owner_type = 'team' and owner_id = m.owner_id
                and kind = 'logo' and id <> p_media loop
    gone := array_append(gone, old.storage_path);
    delete from media where id = old.id;
  end loop;

  update media set status = 'approved', approved_by = auth.uid() where id = p_media;
  update teams set logo_path = m.storage_path where id = m.owner_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'publish_team_logo', 'team', m.owner_id::text,
          jsonb_build_object('media', p_media, 'path', m.storage_path,
                             'replaced', array_length(gone, 1)));

  return jsonb_build_object('status', 'published', 'path', m.storage_path,
                            'orphans', gone);
end; $$;

revoke all on function public.publish_team_logo(uuid) from public, anon;
grant execute on function public.publish_team_logo(uuid) to authenticated;

do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publish_team_logo';
  if src ~* '(delete|insert|update)\s+(from\s+|into\s+)?storage\.objects' then
    raise exception 'publish_team_logo still writes to storage.objects';
  end if;
  raise notice 'publish_team_logo verified: it records, the caller moves';
end $$;
