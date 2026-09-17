-- ============================================================================
-- 0122 — A LEAGUE'S LOGO IS ITS LOGO, AND IT SAYS WHAT COLOUR THE LEAGUE IS.
--
-- The league admin console (Appearance) has had a logo upload since 0053, but
-- the logo never became the league's:
--
--   * approve_media set teams.logo_path for a crest and players.photo_media_id
--     for a photograph, and nothing at all for a league logo. leagues.logo_path
--     stayed null, so the sidebar (nav.js reads the column) never showed one,
--     and only the front page, which queries media itself, ever did.
--   * remove_media cleared the club and player pointers and not the league's.
--   * a league admin approving their OWN upload in Photographs is a step with
--     nobody else in it. A club crest publishes on upload (0061/0064) for the
--     same reason; a league logo now does too, through publish_league_logo.
--     The queue still works for a logo someone else left pending.
--
-- COLOURS FROM THE LOGO, the way clubs get theirs from their crests (0102-0104):
--
--   leagues.colour_source   'default'  the platform's mint, or colours nothing
--                                      has vouched for; pages do not theme
--                           'logo'     read from the logo (the admin's browser
--                                      on upload, or the ingest worker's
--                                      team_colours.py sweep)
--                           'manual'   picked by an admin, never overwritten
--
--   set_league_colours      the admin console writes a logo read or a choice.
--                           A logo read never replaces a manual choice unless
--                           the admin asks for it (p_force).
--   leagues_colour_follows_logo
--                           a NEW logo makes colours read from the old one
--                           stale: back to 'default' until it is read again.
--
-- The league's pages (the front page and the league hub) paint themselves, and
-- the sidebar while it is on them, from colour_a / colour_b when colour_source is
-- 'logo' or 'manual' (teamcolour.js, league()).
-- ============================================================================

alter table public.leagues
  add column if not exists colour_source text not null default 'default';

do $$ begin
  alter table public.leagues add constraint leagues_colour_source_check
    check (colour_source in ('default', 'logo', 'manual'));
exception when duplicate_object then null; end $$;

comment on column public.leagues.colour_source is
  'default | logo (read from the league logo) | manual (picked by an admin, never overwritten)';

-- ------------------------------------------------ colours follow the logo ---
create or replace function public.leagues_colour_follows_logo()
returns trigger language plpgsql as $$
begin
  if new.colour_source = 'logo'
     and coalesce(new.logo_path, '') is distinct from coalesce(old.logo_path, '') then
    new.colour_source := 'default';
  end if;
  return new;
end $$;

drop trigger if exists leagues_colour_follows_logo on public.leagues;
create trigger leagues_colour_follows_logo
  before update of logo_path on public.leagues
  for each row execute function public.leagues_colour_follows_logo();

-- --------------------------------------------------- publish on upload ---
create or replace function public.publish_league_logo(p_media uuid)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare m record; old record; orphans text[] := '{}'; n_old int := 0;
begin
  select * into m from media where id = p_media;
  if not found then raise exception 'no such image' using errcode = 'P0002'; end if;

  if m.owner_type <> 'league' or m.kind <> 'logo' then
    raise exception 'this publishes league logos only — everything else goes '
                    'through the league''s approval queue'
      using errcode = '42501';
  end if;
  if not (public.is_platform_admin() or public.is_league_admin(m.owner_id)) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if m.status = 'approved' then
    update leagues set logo_path = m.storage_path
     where id = m.owner_id and logo_path is distinct from m.storage_path;
    return jsonb_build_object('message', 'already published', 'orphans', '[]'::jsonb);
  end if;

  for old in select * from media
              where owner_type = 'league' and owner_id = m.owner_id
                and kind = 'logo' and id <> p_media loop
    orphans := array_append(orphans, old.storage_path);
    delete from media where id = old.id;
    n_old := n_old + 1;
  end loop;

  /* THE FILE IS NOT TOUCHED HERE. The caller wrote it straight into the public
     bucket (the storage policy of 0065 lets a league admin write a logo path),
     and only reaches this line because that worked. */
  update media set status = 'approved', approved_by = auth.uid() where id = p_media;
  update leagues set logo_path = m.storage_path where id = m.owner_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'publish_league_logo', 'league', m.owner_id::text,
          jsonb_build_object('media', p_media, 'path', m.storage_path, 'replaced', n_old));

  return jsonb_build_object(
    'message', case when n_old > 0 then 'published, replacing the previous logo'
                    else 'published' end,
    'orphans', to_jsonb(orphans));
end; $$;

revoke all on function public.publish_league_logo(uuid) from public, anon;
grant execute on function public.publish_league_logo(uuid) to authenticated;

-- ------------------------------------------------------- approve_media ---
/* 0064's function, with the league branch it never had. Everything else — the
   permission test and the under-18 consent check — exactly as it was. */
create or replace function public.approve_media(p_media uuid)
returns text language plpgsql security definer set search_path = public, storage as $$
declare m record; league_of uuid; pl record;
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
    raise exception 'only the league may approve its images' using errcode = '42501';
  end if;

  if m.owner_type = 'player' then
    select * into pl from players where id = m.owner_id;
    if pl.is_minor and not pl.photo_consent then
      raise exception
        'this player is under 18 and has no recorded guardian consent'
        using errcode = '23514';
    end if;
  end if;

  -- the file has already been moved by the caller, through the Storage API
  update media set status = 'approved', approved_by = auth.uid() where id = p_media;

  if m.owner_type = 'player' then
    update players set photo_media_id = p_media where id = m.owner_id;
  elsif m.owner_type = 'team' then
    update teams set logo_path = m.storage_path where id = m.owner_id;
  elsif m.owner_type = 'league' and m.kind = 'logo' then
    update leagues set logo_path = m.storage_path where id = m.owner_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'approve_media', m.owner_type, m.owner_id::text,
          jsonb_build_object('media', p_media, 'path', m.storage_path));

  return 'approved';
end; $$;

-- -------------------------------------------------------- remove_media ---
/* 0063's function, clearing the league's pointer as well as the club's and the
   player's. A logo taken down takes its colours with it: colours read from it
   go back to 'default'; a manual choice stays. */
create or replace function public.remove_media(
  p_owner_type text, p_owner_id uuid, p_kind text default null
) returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare m record; orphans text[] := '{}'; n int := 0;
begin
  if p_owner_type not in ('team','player','league') then
    raise exception 'unknown owner type' using errcode = '22023';
  end if;
  if not public.may_manage_media(p_owner_type, p_owner_id) then
    raise exception 'you may not change that image' using errcode = '42501';
  end if;

  for m in select * from media
            where owner_type = p_owner_type and owner_id = p_owner_id
              and (p_kind is null or kind = p_kind) loop
    orphans := array_append(orphans, m.storage_path);
    delete from media where id = m.id;
    n := n + 1;
  end loop;

  /* the pointers go with the rows, or a club keeps rendering a crest whose
     record has gone */
  if p_owner_type = 'team' and (p_kind is null or p_kind = 'logo') then
    update teams set logo_path = null where id = p_owner_id;
  elsif p_owner_type = 'player' and (p_kind is null or p_kind = 'photo') then
    update players set photo_media_id = null where id = p_owner_id;
  elsif p_owner_type = 'league' and (p_kind is null or p_kind = 'logo') then
    update leagues set logo_path = null where id = p_owner_id;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'remove_media', p_owner_type, p_owner_id::text,
          jsonb_build_object('kind', p_kind, 'removed', n));

  return jsonb_build_object('removed', n, 'orphans', to_jsonb(orphans));
end; $$;

-- -------------------------------------------------- set_league_colours ---
create or replace function public.set_league_colours(
  p_league uuid, p_colour_a text, p_colour_b text, p_source text, p_force boolean default false
) returns text language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from leagues where id = p_league;
  if not found then raise exception 'no such league' using errcode = '22023'; end if;
  if not (public.is_platform_admin() or public.is_league_admin(p_league)) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if p_source not in ('default', 'logo', 'manual') then
    raise exception 'a colour source is default, logo or manual' using errcode = '22023';
  end if;

  if p_source = 'default' then
    update leagues set colour_a = '#93f2bf', colour_b = '#8ff5ff', colour_source = 'default'
     where id = p_league;
  else
    if not public.is_css_colour(p_colour_a) or not public.is_css_colour(p_colour_b) then
      raise exception 'a colour is a hex code such as #93f2bf' using errcode = '22023';
    end if;
    /* a read of the logo never replaces colours somebody picked, unless they ask */
    if p_source = 'logo' and l.colour_source = 'manual' and not coalesce(p_force, false) then
      return 'kept';
    end if;
    update leagues set colour_a = lower(p_colour_a), colour_b = lower(p_colour_b), colour_source = p_source
     where id = p_league;
  end if;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_colours', 'league', p_league::text,
          jsonb_build_object('from', jsonb_build_array(l.colour_a, l.colour_b, l.colour_source),
                             'to', jsonb_build_array(p_colour_a, p_colour_b, p_source)));
  return 'saved';
end; $$;

revoke all on function public.set_league_colours(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.set_league_colours(uuid, text, text, text, boolean) to authenticated;

-- -------------------------------------------------------------- backfill ---
-- A league logo approved before this migration: make it the league's.
update public.leagues l
   set logo_path = m.storage_path
  from (select distinct on (owner_id) owner_id, storage_path
          from public.media
         where owner_type = 'league' and kind = 'logo' and status = 'approved'
         order by owner_id, created_at desc) m
 where l.id = m.owner_id and l.logo_path is distinct from m.storage_path;

-- ============================================================================
-- SELF-TEST (rolled back)
-- ============================================================================
do $$
declare lg uuid; src text;
begin
  select id into lg from public.leagues order by created_at limit 1;
  if lg is null then return; end if;
  begin
    update public.leagues set logo_path = 'league/' || lg || '/logo-selftest-a.png' where id = lg;
    -- its own statement: the trigger fires on a logo_path update, and would reset this at once
    update public.leagues set colour_source = 'logo' where id = lg;
    update public.leagues set logo_path = 'league/' || lg || '/logo-selftest-b.png' where id = lg;
    select colour_source into src from public.leagues where id = lg;
    if src <> 'default' then
      raise exception 'ASSERT a new logo did not send logo-read colours back to default (got %)', src;
    end if;

    update public.leagues set colour_source = 'manual' where id = lg;
    update public.leagues set logo_path = null where id = lg;
    select colour_source into src from public.leagues where id = lg;
    if src <> 'manual' then
      raise exception 'ASSERT a new logo overwrote a manual colour choice (got %)', src;
    end if;

    begin
      update public.leagues set colour_source = 'crest' where id = lg;
      raise exception 'ASSERT colour_source accepted a value outside default/logo/manual';
    exception when check_violation then null;
    end;

    raise exception using errcode = 'P0122', message = 'self-test passed';
  exception when sqlstate 'P0122' then null;
  end;
end $$;
