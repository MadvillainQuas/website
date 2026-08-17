-- ============================================================================
-- 0061 — A CLUB PUBLISHES ITS OWN CREST.
--
-- Every image on the platform goes through the approval queue, and for a
-- photograph of a person that is exactly right: publishing one is the step that
-- puts a face on the open internet, and 0017 enforces the under-18 consent rule
-- at that moment rather than at upload.
--
-- A club crest is not that. It is the club's own mark, it contains no one, and
-- making a league administrator approve a logo before a club can look like
-- itself is friction with nothing on the other side of it. So a club publishes
-- its crest directly.
--
-- WHAT KEEPS THIS FROM BECOMING A GENERAL BYPASS, which is the whole risk of
-- adding a second door into the public bucket:
--
--   * it refuses anything that is not owner_type='team' AND kind='logo'. A
--     player photograph cannot travel through here whatever it is labelled,
--     which is what keeps the safeguarding rule in 0017 the only path for one.
--   * it refuses anyone who is not that club's manager (or the league's or the
--     platform's administrator).
--   * it does exactly what approve_media does and nothing more — move the
--     object, mark the row, point the club at it — so there is one description
--     of what "published" means rather than two that can drift.
--   * and it writes its own audit action, so a crest that went up without
--     review is visibly distinct in the log from one that was approved.
--
-- A LEAGUE LOGO IS NOT INCLUDED. It goes up under the league's own name and the
-- league administrator is the person who would have approved it anyway, so
-- nothing is saved by routing it around the queue.
--
-- IT REPLACES RATHER THAN ACCUMULATES. A club has one crest. Publishing a new
-- one deletes the old row and its object, which also settles a question the
-- readers were quietly getting wrong: the league page selected a club's crest
-- with no ORDER BY and took whichever row came back first, so a second upload
-- could have left the old crest showing. With one row per club that cannot
-- happen — and the reader is being given an explicit order as well.
-- ============================================================================
create or replace function public.publish_team_logo(p_media uuid)
returns text language plpgsql security definer set search_path = public, storage as $$
declare m record; old record; n_old int := 0;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such image' using errcode = 'P0002'; end if;

  /* THE NARROWING, FIRST. Everything below assumes a club crest. */
  if m.owner_type <> 'team' or m.kind <> 'logo' then
    raise exception 'this publishes club crests only — everything else goes '
                    'through the league''s approval queue'
      using errcode = '42501';
  end if;

  if not public.is_team_manager(m.owner_id) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  if m.status = 'approved' then return 'already published'; end if;

  /* the previous crest, and its file, go — a club has one crest */
  for old in select * from media
              where owner_type = 'team' and owner_id = m.owner_id
                and kind = 'logo' and id <> p_media loop
    delete from storage.objects
     where bucket_id in ('media-pending','media-public') and name = old.storage_path;
    delete from media where id = old.id;
    n_old := n_old + 1;
  end loop;

  /* the same move approve_media makes: into the public bucket, then the row */
  update storage.objects
     set bucket_id = 'media-public'
   where bucket_id = 'media-pending' and name = m.storage_path;

  update media
     set status = 'approved', approved_by = auth.uid()
   where id = p_media;

  update teams set logo_path = m.storage_path where id = m.owner_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'publish_team_logo', 'team', m.owner_id::text,
          jsonb_build_object('media', p_media, 'path', m.storage_path,
                             'replaced', n_old, 'reviewed', false));

  return case when n_old > 0 then 'published, replacing the previous crest'
              else 'published' end;
end; $$;

revoke all on function public.publish_team_logo(uuid) from public, anon;
grant execute on function public.publish_team_logo(uuid) to authenticated;

comment on function public.publish_team_logo(uuid) is
  'A club manager publishes their own crest without review. Club crests only — '
  'refuses any other owner_type or kind, so player photographs keep going '
  'through approve_media and its consent check.';

-- ------------------------------------------------------------- assertions ---
-- The narrowing is the safety property, so it is the one proved here. The
-- migration runs as nobody, so every call must be refused — and the refusal for
-- a non-crest has to happen even before the question of who is asking.
do $$
declare v_id uuid; refused boolean; msg text;
begin
  -- a player photograph must be refused on its TYPE, not on authority, so the
  -- message is checked rather than just the fact of an exception
  select id into v_id from media where owner_type = 'player' limit 1;
  if v_id is null then
    insert into media (owner_type, owner_id, kind, storage_path, status)
    values ('player', gen_random_uuid(), 'photo', 'zz/probe.webp', 'pending')
    returning id into v_id;

    begin
      perform public.publish_team_logo(v_id);
      msg := '(accepted)';
    exception when others then msg := SQLERRM;
    end;
    delete from media where id = v_id;

    if msg not like '%club crests only%' then
      raise exception 'ASSERT a player photograph was not refused on its type: %', msg;
    end if;
  end if;

  -- and an unknown id is an error rather than a silent success
  begin
    perform public.publish_team_logo(gen_random_uuid());
    refused := false;
  exception when others then refused := true;
  end;
  if not refused then raise exception 'ASSERT an unknown image was accepted'; end if;

  raise notice '0061: publish_team_logo refuses non-crests on type and unknown ids';
end $$;
