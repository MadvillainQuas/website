-- ============================================================================
-- 0199: SUGGESTED EDITS. The details only a club, a league or the platform can change - a player's name, height,
-- weight, wingspan, position and previous club, a player's photograph or a club's crest, the coaching staff, an
-- arena's name, address, city and pin - can now be SUGGESTED by any signed-in fan, from the page they are reading.
-- A suggestion goes to the moderators of the league it belongs to (its console's Suggestions) and to the
-- platform's; accepting one makes the change, rejecting it does not, and the fan is told either way.
--
--   suggest_edit(type, id, field, value, note, source)  a detail: checked like the console checks it, the one
--                                                        before it from the same fan for the same detail replaced
--   suggest_photo(type, id, path, …)                     a photograph or a crest the fan uploaded (a file named
--                                                        suggested-… in the subject's own folder of the private
--                                                        bucket): it waits in the existing Photographs queue, and
--                                                        approve_media / reject_media decide it as any other
--   my_suggestions()                                     what the fan has sent, and what became of it
--   suggestions_queue(league)                            a league's open suggestions (null: the platform's, all)
--   decide_suggestion(id, accept, note, value)           accept (optionally corrected) or reject
--
-- A player who is under 18 cannot be the subject of a suggestion: their details are the league's alone.
-- Everything through functions; the table has row-level security on and no policy.
-- ============================================================================

create table if not exists public.suggestions (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('player', 'team', 'staff', 'venue')),
  subject_id    uuid not null,
  field         text not null,
  current_value text,
  value         text not null,
  value_json    jsonb,
  note          text not null default '' check (char_length(note) <= 400),
  source_url    text check (source_url is null or (source_url ~* '^https?://[^\s<>"]+$' and char_length(source_url) <= 500)),
  league_id     uuid references public.leagues on delete set null,
  team_id       uuid references public.teams on delete set null,
  user_id       uuid not null references auth.users on delete cascade,
  status        text not null default 'open' check (status in ('open', 'approved', 'rejected', 'withdrawn', 'superseded')),
  decided_by    uuid references auth.users on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 400),
  created_at    timestamptz not null default now()
);
create index if not exists suggestions_open on public.suggestions (league_id, created_at) where status = 'open';
create index if not exists suggestions_user on public.suggestions (user_id, created_at desc);
create index if not exists suggestions_subject on public.suggestions (subject_type, subject_id, field) where status = 'open';
alter table public.suggestions enable row level security;
revoke all on public.suggestions from anon, authenticated;
comment on table public.suggestions is '0199: a fan''s suggested edit to a detail only a club, a league or the platform may change.';

/* WHAT CAN BE SUGGESTED, and what each is called in the queue */
create or replace function public.suggestion_label(p_field text)
returns text language sql immutable set search_path = public as $$
  select case p_field
    when 'first_name' then 'first name'      when 'last_name' then 'last name'
    when 'height_cm' then 'height (cm)'      when 'weight_kg' then 'weight (kg)'
    when 'wingspan_cm' then 'wingspan (cm)'  when 'position' then 'position'
    when 'previous_club' then 'previous club' when 'photo' then 'photograph'
    when 'staff_add' then 'a new member of staff' when 'staff_name' then 'name'
    when 'staff_role' then 'role'            when 'staff_remove' then 'no longer with the club'
    when 'venue_name' then 'arena name'      when 'venue_address' then 'address'
    when 'venue_city' then 'city'            when 'venue_pin' then 'place on the map'
  end;
$$;

create or replace function public.suggestion_field_ok(p_type text, p_field text)
returns boolean language sql immutable set search_path = public as $$
  select case p_type
    when 'player' then p_field in ('first_name', 'last_name', 'height_cm', 'weight_kg', 'wingspan_cm', 'position', 'previous_club', 'photo')
    when 'team'   then p_field in ('staff_add', 'photo')
    when 'staff'  then p_field in ('staff_name', 'staff_role', 'staff_remove')
    when 'venue'  then p_field in ('venue_name', 'venue_address', 'venue_city', 'venue_pin')
    else false end;
$$;

/* THE LEAGUE A SUBJECT BELONGS TO, whose moderators see the suggestion, and the club when there is one. A player:
   the club of their active entry; staff: their club; an arena: the club whose home it is, else the league of its
   latest game; none of these: the platform's. */
create or replace function public.suggestion_owner(p_type text, p_id uuid, out league_id uuid, out team_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'player' then
    select t.league_id, t.id into league_id, team_id from roster_entries re join teams t on t.id = re.team_id
     where re.player_id = p_id order by re.active desc, re.created_at desc limit 1;
  elsif p_type = 'team' then
    select t.league_id, t.id into league_id, team_id from teams t where t.id = p_id;
  elsif p_type = 'staff' then
    select t.league_id, t.id into league_id, team_id from team_staff s join teams t on t.id = s.team_id where s.id = p_id;
  elsif p_type = 'venue' then
    select t.league_id, t.id into league_id, team_id from teams t where t.home_venue_id = p_id order by t.name limit 1;
    if league_id is null then
      select s.league_id into league_id from games g join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id
       where g.venue_id = p_id order by g.tipoff_at desc nulls last limit 1;
    end if;
  end if;
end $$;

/* WHAT IS THERE NOW, as text: the "from" of the queue's "from → to" */
create or replace function public.suggestion_current(p_type text, p_id uuid, p_field text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_type = 'player' then
    if p_field = 'position' then
      select re.position into v from roster_entries re where re.player_id = p_id order by re.active desc, re.created_at desc limit 1;
    elsif p_field = 'photo' then
      select m.storage_path into v from players p join media m on m.id = p.photo_media_id where p.id = p_id;
    else
      execute format('select (%I)::text from players where id = $1', p_field) into v using p_id;
    end if;
  elsif p_type = 'team' and p_field = 'photo' then
    select logo_path into v from teams where id = p_id;
  elsif p_type = 'staff' then
    select case p_field when 'staff_name' then name when 'staff_role' then role else name || ' (' || role || ')' end
      into v from team_staff where id = p_id;
  elsif p_type = 'venue' then
    select case p_field when 'venue_name' then name when 'venue_address' then address when 'venue_city' then city
                        when 'venue_pin' then case when lat is null then null else round(lat::numeric, 6) || ',' || round(lng::numeric, 6) end end
      into v from venues where id = p_id;
  end if;
  return v;
end $$;

/* A VALUE CHECKED as the console would, and put in its one form (null when it is not one). A position is one of the
   game's; a measure a whole number in a person's range; a name letters; a pin a place on the Earth. */
create or replace function public.suggestion_value(p_field text, p_value text)
returns text language plpgsql immutable set search_path = public as $$
declare v text := btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')); n int; la numeric; lo numeric;
begin
  if p_field in ('height_cm', 'weight_kg', 'wingspan_cm') then
    if v !~ '^[0-9]{2,3}$' then return null; end if;
    n := v::int;
    if (p_field = 'height_cm' and n not between 100 and 260) or (p_field = 'weight_kg' and n not between 30 and 250)
       or (p_field = 'wingspan_cm' and n not between 120 and 280) then return null; end if;
    return n::text;
  elsif p_field = 'position' then
    v := upper(replace(v, ' ', ''));
    return case when v in ('PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'G/F', 'F/C') then v end;
  elsif p_field in ('first_name', 'last_name', 'staff_name') then
    return case when v ~ '^[[:alpha:]][[:alpha:] .''’-]{0,59}$' and char_length(v) >= case p_field when 'staff_name' then 3 else 1 end then v end;
  elsif p_field in ('previous_club', 'staff_role', 'venue_city') then
    return case when char_length(v) between 2 and 80 and v !~ '[<>]' then v end;
  elsif p_field in ('venue_name', 'venue_address') then
    return case when char_length(v) between 3 and 200 and v !~ '[<>]' then v end;
  elsif p_field = 'venue_pin' then
    if v !~ '^-?[0-9]{1,2}(\.[0-9]+)?, ?-?[0-9]{1,3}(\.[0-9]+)?$' then return null; end if;
    la := split_part(replace(v, ' ', ''), ',', 1)::numeric; lo := split_part(replace(v, ' ', ''), ',', 2)::numeric;
    return case when la between -90 and 90 and lo between -180 and 180 and not (la = 0 and lo = 0)
                then round(la, 6) || ',' || round(lo, 6) end;
  elsif p_field = 'staff_remove' then
    return 'remove';
  end if;
  return null;
end $$;

/* ------------------------------------------------------------------------------------------ a fan suggests --- */
create or replace function public.suggest_edit(p_type text, p_id uuid, p_field text, p_value text,
                                               p_note text default '', p_source text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); own record; cur text; v text; vj jsonb; nm text; rl text; sid uuid;
  src text := nullif(btrim(coalesce(p_source, '')), ''); nt text := btrim(coalesce(p_note, ''));
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p_id is null or not public.suggestion_field_ok(p_type, p_field) or p_field = 'photo' then
    return jsonb_build_object('ok', false, 'reason', 'field');
  end if;
  /* the subject is real, and the fan may see it */
  if not coalesce((case p_type when 'player' then exists (select 1 from players where id = p_id)
                              when 'team' then exists (select 1 from teams where id = p_id)
                              when 'staff' then exists (select 1 from team_staff where id = p_id and active)
                              when 'venue' then exists (select 1 from venues where id = p_id) end), false) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into own from public.suggestion_owner(p_type, p_id);
  if own.league_id is not null and not public.league_visible(own.league_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_type = 'player' and exists (select 1 from players where id = p_id and is_minor) then
    return jsonb_build_object('ok', false, 'reason', 'withheld');
  end if;
  if char_length(nt) > 400 then return jsonb_build_object('ok', false, 'reason', 'note'); end if;
  if src is not null and (src !~* '^https?://[^\s<>"]+$' or char_length(src) > 500) then
    return jsonb_build_object('ok', false, 'reason', 'source');
  end if;
  /* the value, in its one form */
  if p_field = 'staff_add' then
    begin vj := p_value::jsonb; exception when others then vj := null; end;
    nm := public.suggestion_value('staff_name', vj->>'name');
    rl := public.suggestion_value('staff_role', vj->>'role');
    if nm is null or rl is null then return jsonb_build_object('ok', false, 'reason', 'value'); end if;
    vj := jsonb_build_object('name', nm, 'role', rl);
    v := nm || ' (' || rl || ')';
  else
    v := public.suggestion_value(p_field, p_value);
    if v is null then return jsonb_build_object('ok', false, 'reason', 'value'); end if;
  end if;
  if not public.go_caption_ok(v) or not public.go_caption_ok(nt) then
    return jsonb_build_object('ok', false, 'reason', 'words');
  end if;
  cur := case when p_field = 'staff_add' then null else public.suggestion_current(p_type, p_id, p_field) end;
  if cur is not null and lower(cur) = lower(v) then return jsonb_build_object('ok', false, 'reason', 'same'); end if;
  /* at most 30 waiting, and 60 a day */
  if (select count(*) from suggestions where user_id = me and status = 'open') >= 30
     or (select count(*) from suggestions where user_id = me and created_at > now() - interval '1 day') >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  /* a fan's newer word on the same detail replaces their older one */
  update suggestions set status = 'superseded'
   where user_id = me and status = 'open' and subject_type = p_type and subject_id = p_id and field = p_field
     and p_field <> 'staff_add';
  insert into suggestions (subject_type, subject_id, field, current_value, value, value_json, note, source_url, league_id, team_id, user_id)
  values (p_type, p_id, p_field, cur, v, vj, nt, src, own.league_id, own.team_id, me)
  returning id into sid;
  return jsonb_build_object('ok', true, 'id', sid);
end $$;

/* ---------------------------------------------------------------------------------- a fan's photograph --- */
/* THE FILE A FAN MAY WRITE: in the private bucket, in a player's or a club's own folder, named suggested-…, for a
   player who is not under 18. The approvers' own read and move rights on that folder (0017, 0123) do the rest. */
create or replace function public.may_suggest_media(p_path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text; oid uuid;
begin
  if auth.uid() is null
     or p_path !~ '^(player|team)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/suggested-[a-z0-9]{8,40}(-thumb)?\.(webp|jpg|png)$' then
    return false;
  end if;
  t := split_part(p_path, '/', 1); oid := split_part(p_path, '/', 2)::uuid;
  if t = 'player' then return exists (select 1 from players where id = oid and not is_minor); end if;
  return exists (select 1 from teams where id = oid);
end $$;

drop policy if exists media_pending_suggest on storage.objects;
create policy media_pending_suggest on storage.objects for insert to authenticated
  with check (bucket_id = 'media-pending' and public.may_suggest_media(name));

create or replace function public.suggest_photo(p_type text, p_id uuid, p_path text, p_width int default null, p_height int default null,
                                                p_bytes int default null, p_note text default '', p_source text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare me uuid := auth.uid(); own record; mid uuid; sid uuid; nt text := btrim(coalesce(p_note, ''));
        src text := nullif(btrim(coalesce(p_source, '')), '');
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p_type not in ('player', 'team') or p_id is null or coalesce(p_path, '') !~ ('^' || p_type || '/' || p_id::text || '/suggested-')
     or not public.may_suggest_media(p_path) or p_path ~ '-thumb\.' then
    return jsonb_build_object('ok', false, 'reason', 'path');
  end if;
  /* the file is there, and it is this fan's. A server where this role may not read the storage schema leaves it
     to the storage policy above, which let a fan write nothing but a suggested-… file in a subject's folder */
  begin
    if not exists (select 1 from storage.objects o where o.bucket_id = 'media-pending' and o.name = p_path
                     and me::text in (to_jsonb(o)->>'owner', to_jsonb(o)->>'owner_id')) then
      return jsonb_build_object('ok', false, 'reason', 'no_file');
    end if;
  exception when insufficient_privilege or undefined_table then
    null;
  end;
  select * into own from public.suggestion_owner(p_type, p_id);
  if own.league_id is not null and not public.league_visible(own.league_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if char_length(nt) > 400 or not public.go_caption_ok(nt) then return jsonb_build_object('ok', false, 'reason', 'note'); end if;
  if src is not null and (src !~* '^https?://[^\s<>"]+$' or char_length(src) > 500) then
    return jsonb_build_object('ok', false, 'reason', 'source');
  end if;
  if (select count(*) from suggestions where user_id = me and status = 'open' and field = 'photo') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into media (owner_type, owner_id, kind, storage_path, width, height, bytes, status, uploaded_by)
  values (p_type, p_id, case p_type when 'team' then 'logo' else 'photo' end, p_path,
          nullif(p_width, 0), nullif(p_height, 0), nullif(p_bytes, 0), 'pending', me)
  returning id into mid;
  insert into suggestions (subject_type, subject_id, field, current_value, value, value_json, note, source_url, league_id, team_id, user_id)
  values (p_type, p_id, 'photo', public.suggestion_current(p_type, p_id, 'photo'), mid::text,
          jsonb_build_object('media', mid, 'path', p_path), nt, src, own.league_id, own.team_id, me)
  returning id into sid;
  return jsonb_build_object('ok', true, 'id', sid, 'media', mid);
end $$;

/* ----------------------------------------------------------------------------------- telling the fan --- */
create or replace function public.suggestion_subject(p_type text, p_id uuid, out name text, out link text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_type = 'player' then
    select btrim(first_name || ' ' || last_name), 'p/?p=' || slug into name, link from players where id = p_id;
  elsif p_type = 'team' then
    select t.name, 't/?t=' || t.slug into name, link from teams t where t.id = p_id;
  elsif p_type = 'staff' then
    select s.name || ', ' || t.name, 't/?t=' || t.slug into name, link from team_staff s join teams t on t.id = s.team_id where s.id = p_id;
  elsif p_type = 'venue' then
    select v.name into name from venues v where v.id = p_id;
    select 't/?t=' || t.slug into link from teams t where t.home_venue_id = p_id order by t.name limit 1;
  end if;
end $$;

create or replace function public.suggestion_tell(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s record; sub record; ok boolean;
begin
  select * into s from suggestions where id = p_id;
  if not found or s.status not in ('approved', 'rejected') then return; end if;
  select * into sub from public.suggestion_subject(s.subject_type, s.subject_id);
  ok := s.status = 'approved';
  insert into notifications (user_id, kind, title, body, link, league_id, ref, data, urgency, expires_at)
  values (s.user_id, 'message',
          case when ok then 'Your suggestion was accepted' else 'Your suggestion was not taken' end,
          left(coalesce(sub.name, 'Your suggestion') || ': ' || public.suggestion_label(s.field) ||
               case when s.field in ('photo', 'staff_remove') then '' else ' → ' || s.value end ||
               case when coalesce(s.decision_note, '') <> '' then '. ' || s.decision_note else '' end, 240),
          sub.link, s.league_id, 'suggestion:' || s.id::text,
          jsonb_build_object('suggestion', s.id, 'status', s.status), 'normal', now() + interval '14 days')
  on conflict do nothing;
end $$;

/* A PHOTOGRAPH IS DECIDED IN PHOTOGRAPHS (approve_media / reject_media): its suggestion follows */
create or replace function public.suggestions_follow_media()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    for sid in update suggestions set status = case new.status when 'approved' then 'approved' else 'rejected' end,
                                    decided_by = auth.uid(), decided_at = now()
                where field = 'photo' and status = 'open' and value = new.id::text
                returning id loop
      perform public.suggestion_tell(sid);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists suggestions_follow_media on public.media;
create trigger suggestions_follow_media after update of status on public.media
  for each row execute function public.suggestions_follow_media();

/* ------------------------------------------------------------------------------------- the fan's own --- */
create or replace function public.my_suggestions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'subject', sub.name, 'link', sub.link, 'field', public.suggestion_label(s.field),
                                               'value', s.value, 'status', s.status, 'note', nullif(s.decision_note, ''),
                                               'created_at', s.created_at, 'decided_at', s.decided_at) order by s.created_at desc), '[]'::jsonb)
    from (select * from suggestions where user_id = auth.uid() and status <> 'superseded' order by created_at desc limit 100) s
    cross join lateral public.suggestion_subject(s.subject_type, s.subject_id) sub;
$$;

create or replace function public.withdraw_suggestion(p_id uuid)
returns boolean language sql security definer set search_path = public as $$
  update suggestions set status = 'withdrawn' where id = p_id and user_id = auth.uid() and status = 'open' and field <> 'photo'
  returning true;
$$;

/* -------------------------------------------------------------------------------------- the moderators --- */
/* A LEAGUE'S OPEN SUGGESTIONS (its administrators; the platform's for any), or with no league every open one (the
   platform's alone). Each with who it is about, the detail, what it is now and what is suggested, the fan's note and
   source, and how many other fans have suggested the same (fans saying the same thing are one row). photos: how many
   suggested photographs wait in Photographs; photo_notes: their notes, sources and fans, by media id. */
create or replace function public.suggestions_queue(p_league uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or (p_league is not null and public.is_league_admin(p_league))) then
    raise exception 'you cannot moderate suggestions here' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by x->>'created_at') from (
      select jsonb_build_object('id', s.id, 'subject_type', s.subject_type, 'subject_id', s.subject_id, 'subject', sub.name, 'link', sub.link,
               'field', s.field, 'label', public.suggestion_label(s.field), 'current', s.current_value, 'value', s.value,
               'note', nullif(s.note, ''), 'source', s.source_url, 'created_at', s.created_at,
               'league', (select jsonb_build_object('slug', l.slug, 'name', l.name) from leagues l where l.id = s.league_id),
               'by', (select u.username from usernames u where u.user_id = s.user_id),
               'agree', (select count(*) from suggestions o where o.status = 'open' and o.id <> s.id and o.subject_type = s.subject_type
                           and o.subject_id = s.subject_id and o.field = s.field and lower(o.value) = lower(s.value))) as x
        from (select distinct on (o.subject_type, o.subject_id, o.field, lower(o.value)) o.*
                from suggestions o
               where o.status = 'open' and o.field <> 'photo' and (p_league is null or o.league_id = p_league)
               order by o.subject_type, o.subject_id, o.field, lower(o.value), o.created_at) s
        cross join lateral public.suggestion_subject(s.subject_type, s.subject_id) sub
       order by s.created_at limit 200) q), '[]'::jsonb),
    'photos', (select count(*) from suggestions s where s.status = 'open' and s.field = 'photo' and (p_league is null or s.league_id = p_league)),
    /* the suggested pictures' notes, for Photographs to show beside each (by its media id) */
    'photo_notes', coalesce((select jsonb_agg(jsonb_build_object('media', s.value, 'note', nullif(s.note, ''), 'source', s.source_url,
                                                                 'by', (select u.username from usernames u where u.user_id = s.user_id)))
                               from suggestions s where s.status = 'open' and s.field = 'photo' and (p_league is null or s.league_id = p_league)),
                            '[]'::jsonb));
end $$;

create or replace function public.decide_suggestion(p_id uuid, p_accept boolean, p_note text default null, p_value text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v text; nt text := nullif(btrim(coalesce(p_note, '')), ''); la numeric; lo numeric; sid uuid;
begin
  select * into s from suggestions where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not (public.is_platform_admin() or (s.league_id is not null and public.is_league_admin(s.league_id))) then
    raise exception 'you cannot moderate this suggestion' using errcode = '42501';
  end if;
  if s.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'decided', 'status', s.status); end if;
  if s.field = 'photo' then return jsonb_build_object('ok', false, 'reason', 'photographs'); end if;
  if nt is not null and char_length(nt) > 400 then return jsonb_build_object('ok', false, 'reason', 'note'); end if;

  if p_accept then
    /* the moderator may correct the value before it goes in; it is checked again either way */
    if s.field = 'staff_add' then
      v := s.value;
    else
      v := public.suggestion_value(s.field, coalesce(nullif(btrim(coalesce(p_value, '')), ''), s.value));
      if v is null then return jsonb_build_object('ok', false, 'reason', 'value'); end if;
    end if;
    if s.subject_type = 'player' then
      if exists (select 1 from players where id = s.subject_id and is_minor) then
        return jsonb_build_object('ok', false, 'reason', 'withheld');
      end if;
      if s.field = 'position' then
        update roster_entries set position = v where player_id = s.subject_id and active
           and (s.team_id is null or team_id = s.team_id);
      elsif s.field in ('height_cm', 'weight_kg', 'wingspan_cm') then
        execute format('update players set %I = $1::int where id = $2', s.field) using v, s.subject_id;
      else
        execute format('update players set %I = $1 where id = $2', s.field) using v, s.subject_id;
      end if;
    elsif s.subject_type = 'team' and s.field = 'staff_add' then
      insert into team_staff (team_id, name, role, sort)
      values (s.subject_id, s.value_json->>'name', s.value_json->>'role', coalesce(public.staff_rank(s.value_json->>'role'), 100));
    elsif s.subject_type = 'staff' then
      if s.field = 'staff_remove' then update team_staff set active = false where id = s.subject_id;
      elsif s.field = 'staff_name' then update team_staff set name = v where id = s.subject_id;
      else update team_staff set role = v, sort = coalesce(public.staff_rank(v), sort) where id = s.subject_id; end if;
    elsif s.subject_type = 'venue' then
      if s.field = 'venue_pin' then
        la := split_part(v, ',', 1)::numeric; lo := split_part(v, ',', 2)::numeric;
        update venues set lat = la, lng = lo, pin_source = 'manual', pinned_at = now(), checked_by = auth.uid(), checked_at = now()
         where id = s.subject_id;
      else
        execute format('update venues set %I = $1 where id = $2', substr(s.field, 7)) using v, s.subject_id;
        /* a club linked to this arena that shows it under a name or an address typed in its own settings shows the
           correction too: it is the same arena, and the fan suggested it from that club's card */
        if s.field = 'venue_name' then
          update teams set home_venue = v where home_venue_id = s.subject_id and home_venue is not null;
        elsif s.field = 'venue_address' then
          update teams set home_venue_address = v where home_venue_id = s.subject_id and home_venue_address is not null;
        end if;
      end if;
    end if;
    /* this one, and every other fan's open one saying the same */
    for sid in update suggestions set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nt,
                                    value = case when id = p_id then v else value end
                where status = 'open' and (id = p_id or (subject_type = s.subject_type and subject_id = s.subject_id and field = s.field
                                                         and lower(value) = lower(s.value)))
                returning id loop
      perform public.suggestion_tell(sid);
    end loop;
  else
    /* the queue shows fans saying the same thing as one row, so they are turned down together */
    for sid in update suggestions set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nt
                where status = 'open' and (id = p_id or (subject_type = s.subject_type and subject_id = s.subject_id and field = s.field
                                                         and lower(value) = lower(s.value)))
                returning id loop
      perform public.suggestion_tell(sid);
    end loop;
  end if;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), case when p_accept then 'accept_suggestion' else 'reject_suggestion' end, s.subject_type, s.subject_id::text,
          jsonb_build_object('suggestion', p_id, 'field', s.field, 'value', coalesce(v, s.value)));
  return jsonb_build_object('ok', true, 'status', case when p_accept then 'approved' else 'rejected' end, 'value', coalesce(v, s.value));
end $$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.suggestion_owner(text, uuid) from public, anon, authenticated;
revoke all on function public.suggestion_current(text, uuid, text) from public, anon, authenticated;
revoke all on function public.suggestion_subject(text, uuid) from public, anon, authenticated;
revoke all on function public.suggestion_tell(uuid) from public, anon, authenticated;
revoke all on function public.suggestions_follow_media() from public, anon, authenticated;
revoke all on function public.suggest_edit(text, uuid, text, text, text, text) from public, anon;
revoke all on function public.suggest_photo(text, uuid, text, int, int, int, text, text) from public, anon;
revoke all on function public.my_suggestions() from public, anon;
revoke all on function public.withdraw_suggestion(uuid) from public, anon;
revoke all on function public.suggestions_queue(uuid) from public, anon;
revoke all on function public.decide_suggestion(uuid, boolean, text, text) from public, anon;
grant execute on function public.suggestion_label(text) to anon, authenticated;
grant execute on function public.suggestion_field_ok(text, text) to anon, authenticated;
grant execute on function public.suggestion_value(text, text) to anon, authenticated;
grant execute on function public.may_suggest_media(text) to authenticated;
grant execute on function public.suggest_edit(text, uuid, text, text, text, text) to authenticated;
grant execute on function public.suggest_photo(text, uuid, text, int, int, int, text, text) to authenticated;
grant execute on function public.my_suggestions() to authenticated;
grant execute on function public.withdraw_suggestion(uuid) to authenticated;
grant execute on function public.suggestions_queue(uuid) to authenticated;
grant execute on function public.decide_suggestion(uuid, boolean, text, text) to authenticated;
