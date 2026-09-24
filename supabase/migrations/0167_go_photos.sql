-- ============================================================================
-- 0167 - GAMES BEEN TO: THE FANS' PHOTOGRAPHS (EPINOIA GO, docs/epinoia-go.md phase 5).
--
-- A fan who stamped a game may post photographs of it (D8), and they go on a public wall - browsed
-- like Spore's Sporepedia - once an administrator has approved each one (D7, pre-moderation, until
-- Louie decides otherwise). The browser re-encodes a photograph before it leaves the phone, which
-- drops its EXIF data, the phone's GPS among it (D9).
--
-- TWO BUCKETS, AS FOR THE CLUBS' MEDIA (0017): go-pending is private - a fan writes only into their
-- own folder, and only they and an administrator can read it; go-public is world-readable and nothing
-- reaches it except by approval, which moves the file. A status column alone would leave an unapproved
-- file reachable by anyone who guessed its path.
--
-- CHILDREN. A photograph at a game can show players under 18. So: a league can be closed to photographs
-- (leagues.go_photos, closed here for the youth leagues), a game with a player flagged under 18 on either
-- club's roster takes none, a fan posting has confirmed they are 18 or over (as for the boards, D6), and
-- every photograph is seen by a person before it is public.
--
--   go_photos           one photograph: the fan, the game, its arena and league, the two files, a caption,
--                       and where it stands (pending, approved, rejected, hidden after reports)
--   go_photo_likes      one like per fan per photograph
--   go_photo_reports    one report per fan per photograph; three hide an approved one until a person looks
--   submit_go_photo()   every rule above, then the row; the files are already in the fan's pending folder
--   approve_go_photo(), reject_go_photo()   the administrator's decision (the console moves or removes files)
--   like_go_photo(), report_go_photo(), delete_go_photo()
--   go_photos_feed(), go_photo(), go_my_photos(), go_photo_queue()
--   merge_venues()      0165's, now moving photographs too
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WHERE PHOTOGRAPHS MAY NOT BE TAKEN
-- ----------------------------------------------------------------------------
alter table public.leagues add column if not exists go_photos boolean not null default true;
comment on column public.leagues.go_photos is
  'EPINOIA GO: fans may post photographs of this league''s games (0167). Off for youth leagues.';
-- the youth leagues, by what they are called (2026-09-24): under-19, under-18, and France's under-21s
update public.leagues set go_photos = false
 where slug in ('aba-u19-league', 'nbl-u18s-men-s', 'lnb-espoirs-elite', 'lnb-espoirs-elite-2') and go_photos;

-- ----------------------------------------------------------------------------
-- 2. THE BUCKETS AND WHO MAY TOUCH THEM
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('go-pending', 'go-pending', false, 3145728, array['image/webp', 'image/jpeg']),
       ('go-public',  'go-public',  true,  3145728, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- a fan writes and reads only their own folder of the private bucket; an administrator reads it all
drop policy if exists go_pending_write on storage.objects;
create policy go_pending_write on storage.objects for insert to authenticated
  with check (bucket_id = 'go-pending' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists go_pending_read on storage.objects;
create policy go_pending_read on storage.objects for select to authenticated
  using (bucket_id = 'go-pending'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_platform_admin()));
drop policy if exists go_pending_delete on storage.objects;
create policy go_pending_delete on storage.objects for delete to authenticated
  using (bucket_id = 'go-pending'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_platform_admin()));
-- approval: an administrator moves the file across (the Storage API's move is an update of the row into
-- the other bucket, 0123), or copies it (a write into the public bucket)
drop policy if exists go_publish_move on storage.objects;
create policy go_publish_move on storage.objects for update to authenticated
  using (bucket_id = 'go-pending' and public.is_platform_admin())
  with check (bucket_id = 'go-public' and public.is_platform_admin());
drop policy if exists go_public_write on storage.objects;
create policy go_public_write on storage.objects for insert to authenticated
  with check (bucket_id = 'go-public' and public.is_platform_admin());
-- (a fan taking a public photograph down: section 3, once the table it asks exists)

-- ----------------------------------------------------------------------------
-- 3. THE TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.go_photos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  game_id     uuid references public.games on delete set null,
  venue_id    uuid references public.venues on delete set null,
  league_id   uuid references public.leagues on delete set null,
  -- while waiting (or rejected): <user id>/<file> in go-pending. Approved: p/<photo id>.<ext> in go-public -
  -- a public address says nothing about whose account posted it
  path        text not null unique,
  thumb_path  text not null unique,
  width       integer check (width is null or width between 1 and 10000),
  height      integer check (height is null or height between 1 and 10000),
  caption     text check (caption is null or char_length(caption) <= 140),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  reason      text check (reason is null or char_length(reason) <= 300),   -- why rejected or hidden, for the fan
  likes       integer not null default 0,
  reports     integer not null default 0,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users on delete set null,
  constraint go_photos_own_folder check (
    case when status in ('pending', 'rejected')
         then split_part(path, '/', 1) = user_id::text and split_part(thumb_path, '/', 1) = user_id::text
         else path like 'p/%' and thumb_path like 'p/%' end)
);
create index if not exists go_photos_status_time on public.go_photos (status, created_at desc);
create index if not exists go_photos_game on public.go_photos (game_id);
create index if not exists go_photos_user on public.go_photos (user_id, created_at desc);
create index if not exists go_photos_league on public.go_photos (league_id, status);
create index if not exists go_photos_venue on public.go_photos (venue_id, status);

create table if not exists public.go_photo_likes (
  photo_id   uuid not null references public.go_photos on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);
create table if not exists public.go_photo_reports (
  photo_id   uuid not null references public.go_photos on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  reason     text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);

alter table public.go_photos enable row level security;
alter table public.go_photo_likes enable row level security;
alter table public.go_photo_reports enable row level security;
drop policy if exists go_photos_read on public.go_photos;
create policy go_photos_read on public.go_photos for select
  using (status = 'approved' or user_id = auth.uid() or public.is_platform_admin());
drop policy if exists go_photo_likes_own on public.go_photo_likes;
create policy go_photo_likes_own on public.go_photo_likes for select using (user_id = auth.uid());
drop policy if exists go_photo_reports_admin on public.go_photo_reports;
create policy go_photo_reports_admin on public.go_photo_reports for select using (public.is_platform_admin());
revoke insert, update, delete on public.go_photos, public.go_photo_likes, public.go_photo_reports from anon, authenticated;
grant select on public.go_photos, public.go_photo_likes, public.go_photo_reports to anon, authenticated;

-- a fan may take their own public photograph down; an administrator any. A public file's name carries no
-- account id (p/<photo id>), so whose it is comes from this table, while the row is there
drop policy if exists go_public_delete on storage.objects;
create policy go_public_delete on storage.objects for delete to authenticated
  using (bucket_id = 'go-public'
         and (public.is_platform_admin()
              or exists (select 1 from public.go_photos ph
                          where (ph.path = name or ph.thumb_path = name) and ph.user_id = auth.uid())));

-- ----------------------------------------------------------------------------
-- 4. POSTING
-- ----------------------------------------------------------------------------
/* a caption the blocklist of 0163 lets through: a whole word for the mild ones, anywhere for the rest,
   disguised with digits or not */
create or replace function public.go_caption_ok(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from username_blocklist b
     where (b.whole and lower(coalesce(p, '')) ~ ('(^|[^a-z])' || b.word || '([^a-z]|$)'))
        or (not b.whole and position(b.word in translate(lower(coalesce(p, '')), '013457@', 'oieasta')) > 0));
$$;
revoke all on function public.go_caption_ok(text) from public, anon, authenticated;

create or replace function public.submit_go_photo(p_game uuid, p_path text, p_thumb text,
                                                  p_width integer default null, p_height integer default null,
                                                  p_caption text default null, p_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  g record;
  cap text := nullif(btrim(regexp_replace(coalesce(p_caption, ''), '\s+', ' ', 'g')), '');
  pid uuid;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if not exists (select 1 from usernames where user_id = me) then
    return jsonb_build_object('ok', false, 'reason', 'username');
  end if;
  -- 18 or over, confirmed once (D6): here, or already for the boards
  if not exists (select 1 from go_settings where user_id = me and adult_confirmed_at is not null) then
    if not coalesce(p_adult, false) then
      return jsonb_build_object('ok', false, 'reason', 'adult');
    end if;
    insert into go_settings (user_id, public, adult_confirmed_at) values (me, false, now())
    on conflict (user_id) do update set adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, now()),
                                        updated_at = now();
  end if;
  -- only a game the fan stamped (D8)
  if not exists (select 1 from stamps where user_id = me and game_id = p_game) then
    return jsonb_build_object('ok', false, 'reason', 'not_stamped');
  end if;
  select gm.id, gm.home_team_id, gm.away_team_id, s.league_id, coalesce(l.go_photos, true) as allowed
    into g
    from games gm left join competitions c on c.id = gm.competition_id
    left join seasons s on s.id = c.season_id left join leagues l on l.id = s.league_id
   where gm.id = p_game;
  if g.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_stamped');
  end if;
  -- no photographs at a youth league's games, or a game with a player under 18 on either roster
  if not g.allowed or exists (
       select 1 from roster_entries re join players pl on pl.id = re.player_id
        where re.team_id in (g.home_team_id, g.away_team_id) and re.active and pl.is_minor) then
    return jsonb_build_object('ok', false, 'reason', 'no_photos_here');
  end if;
  -- the files are the fan's own, and are there
  if p_path is null or p_thumb is null or split_part(p_path, '/', 1) <> me::text or split_part(p_thumb, '/', 1) <> me::text
     or p_path = p_thumb
     or not exists (select 1 from storage.objects o where o.bucket_id = 'go-pending' and o.name = p_path)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'go-pending' and o.name = p_thumb) then
    return jsonb_build_object('ok', false, 'reason', 'no_file');
  end if;
  if cap is not null and (char_length(cap) > 140 or not public.go_caption_ok(cap)) then
    return jsonb_build_object('ok', false, 'reason', 'caption');
  end if;
  -- three a game, ten a day
  if (select count(*) from go_photos where user_id = me and game_id = p_game and status <> 'rejected') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'game_full');
  end if;
  if (select count(*) from go_photos where user_id = me and created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'day_full');
  end if;
  insert into go_photos (user_id, game_id, venue_id, league_id, path, thumb_path, width, height, caption)
  values (me, g.id, public.game_venue_id(g.id), g.league_id, p_path, p_thumb, p_width, p_height, cap)
  returning id into pid;
  return jsonb_build_object('ok', true, 'id', pid, 'status', 'pending');
end; $$;
alter function public.submit_go_photo(uuid, text, text, integer, integer, text, boolean) owner to postgres;
revoke all on function public.submit_go_photo(uuid, text, text, integer, integer, text, boolean) from public, anon;
grant execute on function public.submit_go_photo(uuid, text, text, integer, integer, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. THE DECISION, AND WHAT FANS DO WITH A PHOTOGRAPH
-- ----------------------------------------------------------------------------
/* the names an approved photograph's files take in go-public: its own id, never its fan's */
create or replace function public.go_public_names(p_photo uuid, out path text, out thumb_path text)
language sql stable set search_path = public as $$
  select 'p/' || ph.id || coalesce(substring(ph.path from '\.[A-Za-z0-9]+$'), '.webp'),
         'p/' || ph.id || '-t' || coalesce(substring(ph.thumb_path from '\.[A-Za-z0-9]+$'), '.webp')
    from go_photos ph where ph.id = p_photo;
$$;
revoke all on function public.go_public_names(uuid) from public, anon;
grant execute on function public.go_public_names(uuid) to authenticated;

/* Approval. The console has already moved the files to go_public_names (the Storage API does that, not
   SQL); the row follows them. A photograph taken down after reports is already public: only its state
   changes. */
create or replace function public.approve_go_photo(p_photo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pub record;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  select * into pub from public.go_public_names(p_photo);
  update go_photos set status = 'approved', reason = null, reports = 0, decided_at = now(), decided_by = auth.uid(),
                       path = case when status = 'pending' then pub.path else path end,
                       thumb_path = case when status = 'pending' then pub.thumb_path else thumb_path end
   where id = p_photo and status in ('pending', 'hidden');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_waiting');
  end if;
  delete from go_photo_reports where photo_id = p_photo;       -- a person looked: the count starts again
  insert into audit_log (actor, action, subject, subject_id) values (auth.uid(), 'go_photo_approve', 'go_photo', p_photo::text);
  return jsonb_build_object('ok', true, 'path', pub.path, 'thumb_path', pub.thumb_path);
end; $$;

/* Rejection: the files are named for the console to remove - from go-pending while it waited, from
   go-public if it had been up and was taken down after reports. */
create or replace function public.reject_go_photo(p_photo uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph go_photos; was go_photos;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  -- the files as they are now: private while it waited, its public names once it had been up
  select * into was from go_photos where id = p_photo;
  update go_photos set status = 'rejected', reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
                       decided_at = now(), decided_by = auth.uid(),
                       -- a rejected row lives in its fan's folder (the constraint's rule), under a name that
                       -- says the file is gone
                       path = case when was.status = 'pending' then path
                                   else user_id || '/removed-' || id || coalesce(substring(was.path from '\.[A-Za-z0-9]+$'), '') end,
                       thumb_path = case when was.status = 'pending' then thumb_path
                                         else user_id || '/removed-' || id || '-t' || coalesce(substring(was.thumb_path from '\.[A-Za-z0-9]+$'), '') end
   where id = p_photo and status <> 'rejected'
  returning * into ph;
  if ph.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_waiting');
  end if;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'go_photo_reject', 'go_photo', p_photo::text, jsonb_build_object('reason', ph.reason));
  return jsonb_build_object('ok', true, 'bucket', case when was.status = 'pending' then 'go-pending' else 'go-public' end,
                            'path', was.path, 'thumb_path', was.thumb_path);
end; $$;

/* A fan takes their own photograph down (an administrator any). The page removes the files first - the
   public ones' policy asks this row whose they are - then calls this. */
create or replace function public.delete_go_photo(p_photo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph go_photos;
begin
  delete from go_photos where id = p_photo and (user_id = auth.uid() or public.is_platform_admin())
  returning * into ph;
  if ph.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  return jsonb_build_object('ok', true, 'bucket', case when ph.status in ('approved', 'hidden') then 'go-public' else 'go-pending' end,
                            'path', ph.path, 'thumb_path', ph.thumb_path);
end; $$;

create or replace function public.like_go_photo(p_photo uuid, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if not exists (select 1 from go_photos where id = p_photo and status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not_there');
  end if;
  if coalesce(p_on, true) then
    insert into go_photo_likes (photo_id, user_id) values (p_photo, me) on conflict do nothing;
  else
    delete from go_photo_likes where photo_id = p_photo and user_id = me;
  end if;
  update go_photos set likes = (select count(*) from go_photo_likes where photo_id = p_photo)
   where id = p_photo returning likes into n;
  return jsonb_build_object('ok', true, 'likes', n, 'liked', coalesce(p_on, true));
end; $$;

create or replace function public.report_go_photo(p_photo uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if not exists (select 1 from go_photos where id = p_photo and status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not_there');
  end if;
  insert into go_photo_reports (photo_id, user_id, reason)
  values (p_photo, me, left(nullif(btrim(coalesce(p_reason, '')), ''), 300)) on conflict do nothing;
  select count(*) into n from go_photo_reports where photo_id = p_photo;
  -- three fans saying so take it down until a person has looked
  update go_photos set reports = n,
         status = case when n >= 3 then 'hidden' else status end,
         reason = case when n >= 3 then 'taken down after reports, waiting for a person to look' else reason end
   where id = p_photo;
  return jsonb_build_object('ok', true);
end; $$;

do $$
declare f text;
begin
  foreach f in array array['approve_go_photo(uuid)', 'reject_go_photo(uuid, text)', 'delete_go_photo(uuid)',
                           'like_go_photo(uuid, boolean)', 'report_go_photo(uuid, text)'] loop
    execute format('alter function public.%s owner to postgres', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. READING THEM
-- ----------------------------------------------------------------------------
/* The wall: approved photographs, newest or most liked, of one league, arena, game or fan (by username),
   a page at a time (p_before: the last one's created_at on the newest order, its offset on the liked one).
   A private league's photographs only for those who may see it. */
create or replace function public.go_photos_feed(p_league uuid default null, p_venue uuid default null,
                                                 p_game uuid default null, p_username text default null,
                                                 p_sort text default 'new', p_before timestamptz default null,
                                                 p_offset integer default 0, p_limit integer default 48)
returns table (id uuid, path text, thumb_path text, width integer, height integer, caption text, likes integer,
               liked boolean, created_at timestamptz, username text, game_id uuid, tipoff_at timestamptz,
               home text, away text, venue_id uuid, venue text, city text, league_id uuid, league text,
               league_slug text)
language sql stable security definer set search_path = public as $$
  select ph.id, ph.path, ph.thumb_path, ph.width, ph.height, ph.caption, ph.likes,
         exists (select 1 from go_photo_likes lk where lk.photo_id = ph.id and lk.user_id = auth.uid()),
         ph.created_at, u.username, ph.game_id, g.tipoff_at, ht.name, awt.name,
         ph.venue_id, v.name, v.city, ph.league_id, l.name, l.slug
    from go_photos ph
    join usernames u on u.user_id = ph.user_id
    left join games g on g.id = ph.game_id
    left join teams ht on ht.id = g.home_team_id
    left join teams awt on awt.id = g.away_team_id
    left join venues v on v.id = ph.venue_id
    left join leagues l on l.id = ph.league_id
   where ph.status = 'approved'
     and (ph.league_id is null or public.league_visible(ph.league_id))
     and (p_league is null or ph.league_id = p_league)
     and (p_venue is null or ph.venue_id = p_venue)
     and (p_game is null or ph.game_id = p_game)
     and (p_username is null or lower(u.username) = lower(p_username))
     and (p_sort = 'liked' or p_before is null or ph.created_at < p_before)
   order by case when p_sort = 'liked' then ph.likes end desc nulls last, ph.created_at desc
   offset case when p_sort = 'liked' then greatest(coalesce(p_offset, 0), 0) else 0 end
   limit greatest(1, least(coalesce(p_limit, 48), 96));
$$;
revoke all on function public.go_photos_feed(uuid, uuid, uuid, text, text, timestamptz, integer, integer) from public;
grant execute on function public.go_photos_feed(uuid, uuid, uuid, text, text, timestamptz, integer, integer) to anon, authenticated;

/* one approved photograph, by its id: what a link to it opens */
create or replace function public.go_photo(p_photo uuid)
returns table (id uuid, path text, thumb_path text, width integer, height integer, caption text, likes integer,
               liked boolean, created_at timestamptz, username text, game_id uuid, tipoff_at timestamptz,
               home text, away text, venue_id uuid, venue text, city text, league_id uuid, league text,
               league_slug text)
language sql stable security definer set search_path = public as $$
  select ph.id, ph.path, ph.thumb_path, ph.width, ph.height, ph.caption, ph.likes,
         exists (select 1 from go_photo_likes lk where lk.photo_id = ph.id and lk.user_id = auth.uid()),
         ph.created_at, u.username, ph.game_id, g.tipoff_at, ht.name, awt.name,
         ph.venue_id, v.name, v.city, ph.league_id, l.name, l.slug
    from go_photos ph
    join usernames u on u.user_id = ph.user_id
    left join games g on g.id = ph.game_id
    left join teams ht on ht.id = g.home_team_id
    left join teams awt on awt.id = g.away_team_id
    left join venues v on v.id = ph.venue_id
    left join leagues l on l.id = ph.league_id
   where ph.id = p_photo and ph.status = 'approved'
     and (ph.league_id is null or public.league_visible(ph.league_id));
$$;
revoke all on function public.go_photo(uuid) from public;
grant execute on function public.go_photo(uuid) to anon, authenticated;

/* the fan's own photographs, every state, with the reason a rejected or hidden one gives */
create or replace function public.go_my_photos()
returns table (id uuid, path text, thumb_path text, status text, reason text, caption text, likes integer,
               created_at timestamptz, game_id uuid, venue text, league text)
language sql stable security definer set search_path = public as $$
  select ph.id, ph.path, ph.thumb_path, ph.status, ph.reason, ph.caption, ph.likes, ph.created_at, ph.game_id,
         v.name, l.name
    from go_photos ph left join venues v on v.id = ph.venue_id left join leagues l on l.id = ph.league_id
   where ph.user_id = auth.uid()
   order by ph.created_at desc
   limit 200;
$$;
revoke all on function public.go_my_photos() from public, anon;
grant execute on function public.go_my_photos() to authenticated;

/* the administrators' queue: waiting, and taken down after reports */
create or replace function public.go_photo_queue(p_limit integer default 100)
returns table (id uuid, path text, thumb_path text, public_path text, public_thumb text, status text, reason text,
               caption text, reports integer, created_at timestamptz, username text, venue text, league text,
               home text, away text, tipoff_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select ph.id, ph.path, ph.thumb_path, (public.go_public_names(ph.id)).path, (public.go_public_names(ph.id)).thumb_path,
         ph.status, ph.reason, ph.caption, ph.reports, ph.created_at, u.username,
         v.name, l.name, ht.name, awt.name, g.tipoff_at
    from go_photos ph
    left join usernames u on u.user_id = ph.user_id
    left join venues v on v.id = ph.venue_id
    left join leagues l on l.id = ph.league_id
    left join games g on g.id = ph.game_id
    left join teams ht on ht.id = g.home_team_id
    left join teams awt on awt.id = g.away_team_id
   where ph.status in ('pending', 'hidden')
   order by ph.status = 'hidden' desc, ph.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;
revoke all on function public.go_photo_queue(integer) from public, anon;
grant execute on function public.go_photo_queue(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 6b. FILES LEFT BEHIND
--
-- A row can go without its files: an account erased (auth.users cascades, platform_delete_account), a row
-- deleted from the dashboard. An approved photograph's files would then stay public with no row to say
-- whose they were. So every deleted row leaves its files' names here, and the console's queue offers to
-- remove them. A fan removing their own photograph removes the files first (the page does), so theirs
-- come through as names already gone: the sweep finds nothing and clears them.
-- ----------------------------------------------------------------------------
create table if not exists public.go_photo_trash (
  path     text primary key,
  bucket   text not null check (bucket in ('go-pending', 'go-public')),
  at       timestamptz not null default now()
);
alter table public.go_photo_trash enable row level security;
drop policy if exists go_photo_trash_admin on public.go_photo_trash;
create policy go_photo_trash_admin on public.go_photo_trash for select using (public.is_platform_admin());
revoke insert, update, delete on public.go_photo_trash from anon, authenticated;

create or replace function public.go_photos_to_trash()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- a rejected photograph's files were removed when it was rejected; the others are somewhere
  if old.status in ('approved', 'hidden') then
    insert into go_photo_trash (path, bucket) values (old.path, 'go-public'), (old.thumb_path, 'go-public')
    on conflict (path) do nothing;
  elsif old.status = 'pending' then
    insert into go_photo_trash (path, bucket) values (old.path, 'go-pending'), (old.thumb_path, 'go-pending')
    on conflict (path) do nothing;
  end if;
  return old;
end; $$;
alter function public.go_photos_to_trash() owner to postgres;
revoke all on function public.go_photos_to_trash() from public, anon, authenticated;
drop trigger if exists go_photos_to_trash on public.go_photos;
create trigger go_photos_to_trash after delete on public.go_photos
  for each row execute function public.go_photos_to_trash();

create or replace function public.go_photo_trash_list(p_limit integer default 200)
returns table (path text, bucket text, at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  -- the files of removed photographs, and a fan's uploads that never became one (the page lost its
  -- connection between sending the files and posting them, or the account went in between): a day old,
  -- in the private bucket, and nobody's photograph
  return query
    select x.path, x.bucket, x.at from (
      select t.path, t.bucket, t.at from go_photo_trash t
      union all
      select o.name::text, 'go-pending'::text, o.created_at from storage.objects o
       where o.bucket_id = 'go-pending' and o.created_at < now() - interval '1 day'
         and not exists (select 1 from go_photos p where p.path = o.name or p.thumb_path = o.name)
         and not exists (select 1 from go_photo_trash t where t.path = o.name)
    ) x
    order by x.at
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end; $$;

create or replace function public.go_photo_trash_done(p_paths text[])
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  delete from go_photo_trash where path = any(coalesce(p_paths, '{}'));
  get diagnostics n = row_count;
  return n;
end; $$;
do $$
declare f text;
begin
  foreach f in array array['go_photo_trash_list(integer)', 'go_photo_trash_done(text[])'] loop
    execute format('alter function public.%s owner to postgres', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7. A MERGE MOVES PHOTOGRAPHS TOO (0165's function, with the photographs line)
-- ----------------------------------------------------------------------------
create or replace function public.merge_venues(p_keep uuid, p_other uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k venues;
  o venues;
  n_sp int; n_g int; n_t int; n_st int; n_ph int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_keep is null or p_other is null or p_keep = p_other then
    raise exception 'two different arenas are needed' using errcode = '22023';
  end if;
  perform 1 from venues where id in (p_keep, p_other) order by id for update;
  select * into k from venues where id = p_keep;
  select * into o from venues where id = p_other;
  if k.id is null or o.id is null then
    raise exception 'no such arena' using errcode = 'P0002';
  end if;

  update venue_aliases set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_sp = row_count;
  update games set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_g = row_count;
  update teams set home_venue_id = p_keep where home_venue_id = p_other;
  get diagnostics n_t = row_count;
  update stamps set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_st = row_count;
  update go_photos set venue_id = p_keep where venue_id = p_other;
  get diagnostics n_ph = row_count;

  update venues set country = coalesce(k.country, o.country),
                    city    = coalesce(k.city, o.city),
                    address = coalesce(k.address, o.address)
   where id = p_keep;
  if k.lat is null and o.lat is not null then
    update venues set lat = o.lat, lng = o.lng, place_id = o.place_id, pin_source = o.pin_source,
                      pin_note = o.pin_note, pinned_at = o.pinned_at,
                      checked_by = o.checked_by, checked_at = o.checked_at
     where id = p_keep;
  end if;
  delete from venues where id = p_other;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'venue_merge', 'venue', p_keep::text,
          jsonb_build_object('kept', k.name, 'merged', o.name, 'merged_id', p_other,
                             'spellings', n_sp, 'games', n_g, 'clubs', n_t, 'stamps', n_st, 'photos', n_ph));
  return jsonb_build_object('kept', k.name, 'merged', o.name, 'spellings', n_sp, 'games', n_g,
                            'clubs', n_t, 'stamps', n_st, 'photos', n_ph);
end; $$;
alter function public.merge_venues(uuid, uuid) owner to postgres;
revoke all on function public.merge_venues(uuid, uuid) from public, anon;
grant execute on function public.merge_venues(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.go_photos', 'insert') then
    raise exception '0167: a fan may insert a photograph row directly';
  end if;
  if has_function_privilege('anon', 'public.submit_go_photo(uuid, text, text, integer, integer, text, boolean)', 'execute') then
    raise exception '0167: anon may post a photograph';
  end if;
  if not exists (select 1 from storage.buckets where id = 'go-pending' and not public)
     or not exists (select 1 from storage.buckets where id = 'go-public' and public) then
    raise exception '0167: the buckets are not as they should be';
  end if;
  if exists (select 1 from leagues where slug in ('aba-u19-league', 'nbl-u18s-men-s') and go_photos) then
    raise exception '0167: a youth league still takes photographs';
  end if;
  raise notice '0167 ok: the fans'' photographs, their buckets and their rules are in place';
end $$;
