-- ============================================================================
-- 0197: A FAN'S PUBLIC PROFILE (fan/?u=<username>), and a league's Discord.
--
-- EPINOIA GO gave a fan a username (0163), their stamps (0165), boards (0166) and photographs (0167), and one
-- tap to go public with all of it (0177 set_go_profile: the boards, the stamps on the feed, "and later a public
-- profile"). This is that profile: the fan's name and a line about them, a picture, their colour, their club,
-- the places they are on social media and Discord, what they follow if they choose, and their GO passport -
-- the arenas, the kilometres, the stamps and the photographs.
--
-- WHO IS SHOWN. Only a fan who is public on EPINOIA GO (go_settings.public, which already needs a username and
-- "I am 18 or over" confirmed: D6, under-18 profiles never appear publicly). A fan who is not has no page;
-- asking for one answers nothing, the same as a name that does not exist. The stamps are shown only where the
-- fan shows them on the feed (go_settings.stamps_public), and a followed league only when it is public.
--
-- MADE FROM THEIR SOCIAL ACCOUNTS. A fan who signed in with Google, Discord, X or Twitch has a name, a picture
-- and a handle there already: my_fan_profile() offers them (from auth.identities), and the profile page on
-- /me/ fills the form with them at a press. A picture is an https address - the provider's own, or one the fan
-- hosts - never an upload (uploads go through the approval queue, 0017/0065). A fan who links Discord to their
-- account (the provider's manual linking) has their Discord name on the profile, read from the identity
-- itself by sync_fan_discord(), so it cannot be typed as somebody else's.
--
-- A LEAGUE'S DISCORD SERVERS. A league attaches the Discord servers where its fans talk - its own, a fans'
-- community's, a club's: servers that exist, whoever runs them; nothing here makes one. The league's forum page
-- (forum/?l=<slug>) lists them, with a server's own widget (who is online, the channels) and the way into each,
-- and the rail offers the page for a league with at least one.
--
-- Everything through functions; the table has row-level security on and no policy.
-- ============================================================================

create table if not exists public.fan_profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  name         text not null default '',
  bio          text not null default '',
  avatar_url   text,
  colour       text,
  links        jsonb not null default '{}'::jsonb,
  club_id      uuid references public.teams on delete set null,
  show_follows boolean not null default false,
  discord      jsonb,                                   -- {id, username, global_name, avatar_url}: from the linked identity
  show_discord boolean not null default true,
  updated_at   timestamptz not null default now(),
  constraint fan_profiles_name_ck check (char_length(name) <= 40),
  constraint fan_profiles_bio_ck check (char_length(bio) <= 280),
  constraint fan_profiles_avatar_ck check (avatar_url is null or (avatar_url ~* '^https://[^\s<>"]+$' and char_length(avatar_url) <= 500)),
  constraint fan_profiles_colour_ck check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$'),
  constraint fan_profiles_links_ck check (jsonb_typeof(links) = 'object')
);
alter table public.fan_profiles enable row level security;
revoke all on public.fan_profiles from anon, authenticated;
comment on table public.fan_profiles is
  '0197: a fan''s public profile (fan/?u=). Shown only while the fan is public on EPINOIA GO. Through the fan profile functions only.';

-- ------------------------------------------------------------------------------------------ the fan's ---

/* THE FAN'S OWN PROFILE, for the editor on /me/: what is saved, whether it is shown (public on GO), and what their
   social accounts already say about them - a name, a handle and a picture per provider they signed in with. */
create or replace function public.my_fan_profile()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); r public.fan_profiles; pub boolean; sp boolean;
begin
  if me is null then return null; end if;
  select * into r from public.fan_profiles where user_id = me;
  select gs.public and gs.adult_confirmed_at is not null, gs.stamps_public into pub, sp
    from public.go_settings gs where gs.user_id = me;
  return jsonb_build_object(
    'username', (select u.username from public.usernames u where u.user_id = me),
    'public', coalesce(pub, false), 'stamps_public', coalesce(sp, false),
    'name', coalesce(r.name, ''), 'bio', coalesce(r.bio, ''), 'avatar_url', r.avatar_url, 'colour', r.colour,
    'links', coalesce(r.links, '{}'::jsonb), 'club_id', r.club_id, 'show_follows', coalesce(r.show_follows, false),
    'discord', r.discord, 'show_discord', coalesce(r.show_discord, true),
    'suggest', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', i.provider,
               'name', nullif(btrim(regexp_replace(coalesce(i.identity_data->'custom_claims'->>'global_name', i.identity_data->>'full_name',
                                                           i.identity_data->>'name', ''), '#0$', '')), ''),
               'handle', nullif(btrim(regexp_replace(coalesce(i.identity_data->>'user_name', i.identity_data->>'preferred_username',
                                                             case when i.provider = 'discord' then i.identity_data->>'name' end, ''), '#0$', '')), ''),
               'avatar_url', case when coalesce(i.identity_data->>'avatar_url', i.identity_data->>'picture', '') ~* '^https://[^\s<>"]+$'
                                  then coalesce(i.identity_data->>'avatar_url', i.identity_data->>'picture') end)
             order by i.created_at)
        from auth.identities i where i.user_id = me and i.provider <> 'email'), '[]'::jsonb));
end $$;

/* SAVE IT. Only the keys sent change. Every field checked: the name and the line against the word list the
   usernames and the photographs' captions use (0163, 0167), a picture an https address, the links the allow-listed
   platforms at https addresses (0194 clean_creator_links), the club one the fan may see. {ok, reason}. */
create or replace function public.set_fan_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_name text; v_bio text; v_avatar text; v_colour text; v_club uuid;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'shape'); end if;
  v_name := btrim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g'));
  v_bio := btrim(regexp_replace(coalesce(p->>'bio', ''), '[ \t]+', ' ', 'g'));
  if char_length(v_name) > 40 then return jsonb_build_object('ok', false, 'reason', 'name_long'); end if;
  if char_length(v_bio) > 280 then return jsonb_build_object('ok', false, 'reason', 'bio_long'); end if;
  if (p ? 'name' and not public.go_caption_ok(v_name)) or (p ? 'bio' and not public.go_caption_ok(v_bio)) then
    return jsonb_build_object('ok', false, 'reason', 'words');
  end if;
  v_avatar := nullif(btrim(coalesce(p->>'avatar_url', '')), '');
  if v_avatar is not null and (v_avatar !~* '^https://[^\s<>"]+$' or char_length(v_avatar) > 500) then
    return jsonb_build_object('ok', false, 'reason', 'avatar');
  end if;
  v_colour := nullif(btrim(coalesce(p->>'colour', '')), '');
  if v_colour is not null and v_colour !~ '^#[0-9a-fA-F]{6}$' then return jsonb_build_object('ok', false, 'reason', 'colour'); end if;
  if coalesce(p->>'club_id', '') <> '' then
    if p->>'club_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'reason', 'club');
    end if;
    v_club := (p->>'club_id')::uuid;
    if not exists (select 1 from public.teams t where t.id = v_club and (t.league_id is null or public.league_visible(t.league_id))) then
      return jsonb_build_object('ok', false, 'reason', 'club');
    end if;
  end if;

  insert into public.fan_profiles (user_id) values (me) on conflict (user_id) do nothing;
  update public.fan_profiles f set
    name = case when p ? 'name' then v_name else f.name end,
    bio = case when p ? 'bio' then v_bio else f.bio end,
    avatar_url = case when p ? 'avatar_url' then v_avatar else f.avatar_url end,
    colour = case when p ? 'colour' then v_colour else f.colour end,
    links = case when p ? 'links' then public.clean_creator_links(p->'links') else f.links end,
    club_id = case when p ? 'club_id' then v_club else f.club_id end,
    show_follows = case when p ? 'show_follows' then coalesce((p->>'show_follows')::boolean, false) else f.show_follows end,
    show_discord = case when p ? 'show_discord' then coalesce((p->>'show_discord')::boolean, true) else f.show_discord end,
    updated_at = now()
   where f.user_id = me;
  return jsonb_build_object('ok', true);
end $$;

/* THE FAN'S DISCORD, read from the identity they linked (never typed): its id, name, display name and picture.
   Called by the profile page after linking; no Discord identity clears it. */
create or replace function public.sync_fan_discord()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); d jsonb; v jsonb := null; av text;
begin
  if me is null then return null; end if;
  select i.identity_data into d from auth.identities i
   where i.user_id = me and i.provider = 'discord' order by i.updated_at desc nulls last limit 1;
  if d is not null then
    av := coalesce(d->>'avatar_url', d->>'picture');
    v := jsonb_build_object(
      'id', coalesce(d->>'provider_id', d->>'sub'),
      'username', nullif(btrim(regexp_replace(coalesce(d->>'user_name', d->>'name', d->>'preferred_username', ''), '#0$', '')), ''),
      'global_name', nullif(btrim(coalesce(d->'custom_claims'->>'global_name', d->>'full_name', '')), ''),
      'avatar_url', case when av ~* '^https://[^\s<>"]+$' then av end);
  end if;
  insert into public.fan_profiles (user_id, discord) values (me, v)
  on conflict (user_id) do update set discord = excluded.discord, updated_at = now();
  return v;
end $$;

-- -------------------------------------------------------------------------------------------- the page ---

/* A FAN'S PAGE: null unless the fan is public on EPINOIA GO (username, 18 or over, public). The profile, their
   club, what they follow if they show it (public leagues only), their GO numbers and board rank, whether their
   stamps are shown (go_feed then lists them, and their photographs), and how many photographs are up. */
create or replace function public.fan_profile_public(p_username text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u record; fp public.fan_profiles; gs public.go_settings; out jsonb;
begin
  select un.user_id, un.username, un.created_at into u from public.usernames un
   where lower(un.username) = lower(btrim(coalesce(p_username, ''))) limit 1;
  if u.user_id is null then return null; end if;
  select * into gs from public.go_settings g where g.user_id = u.user_id;
  if gs.user_id is null or not gs.public or gs.adult_confirmed_at is null then return null; end if;
  select * into fp from public.fan_profiles f where f.user_id = u.user_id;

  out := jsonb_build_object(
    'username', u.username, 'since', u.created_at,
    'name', coalesce(fp.name, ''), 'bio', coalesce(fp.bio, ''), 'avatar_url', fp.avatar_url, 'colour', fp.colour,
    'links', coalesce(fp.links, '{}'::jsonb),
    'discord', case when coalesce(fp.show_discord, true) and fp.discord is not null then fp.discord end,
    'club', (select jsonb_build_object('slug', t.slug, 'name', t.name, 'short_name', t.short_name, 'colour', t.colour,
                                       'logo_path', t.logo_path,
                                       'league', (select jsonb_build_object('slug', l.slug, 'name', l.name) from public.leagues l
                                                   where l.id = t.league_id and l.visibility = 'public'))
               from public.teams t
              where t.id = fp.club_id and (t.league_id is null or (public.league_visible(t.league_id)
                    and exists (select 1 from public.leagues l where l.id = t.league_id and l.visibility = 'public')))),
    'stamps_public', coalesce(gs.stamps_public, false),
    'photos', (select count(*) from public.go_photos ph where ph.user_id = u.user_id and ph.status = 'approved'),
    'go', (select jsonb_build_object('arenas', g.arenas, 'stamps', g.stamps, 'km', round(g.km::numeric, 1), 'first_at', g.first_at)
             from public.go_numbers(null) g where g.user_id = u.user_id),
    'rank', (select b.rank from public.go_leaderboard(null, 'arenas', 500) b where lower(b.username) = lower(u.username) limit 1));

  if coalesce(fp.show_follows, false) then
    out := out || jsonb_build_object('follows', (
      select jsonb_build_object(
        'leagues', coalesce((select jsonb_agg(jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo_path', l.logo_path) order by l.name)
                               from public.leagues l
                              where l.id = any (f.fav_league_ids) and l.visibility = 'public' and public.league_visible(l.id)), '[]'::jsonb),
        'clubs', coalesce((select jsonb_agg(x order by x->>'name') from (
                             select jsonb_build_object('slug', t.slug, 'name', t.name, 'short_name', t.short_name, 'colour', t.colour, 'logo_path', t.logo_path) as x
                               from public.teams t join public.leagues l on l.id = t.league_id
                              where t.id = any (f.fav_team_ids) and l.visibility = 'public' and public.league_visible(l.id)
                              limit 24) q), '[]'::jsonb))
        from public.fan_prefs f where f.user_id = u.user_id));
  end if;
  return out;
end $$;

-- --------------------------------------------------------------------------- a league's Discord servers ---
/* ANY SERVER, ATTACHED; NONE MADE. A league lists the Discord servers where its fans talk: its own, a fans'
   community, a club's - servers that exist, whoever runs them. Each is attached by its invitation (the console
   reads the server's id, name and picture from Discord's own public answer for that invitation) and/or the
   server's id, which the live widget needs; the widget shows only once the server's owner has switched it on
   (Server Settings > Widget). Up to 12 a league, in the league's order; the forum page (forum/?l=) shows them,
   and the rail offers the page for a league with at least one. */
create table if not exists public.league_discords (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues on delete cascade,
  server_id  text,
  invite     text,
  name       text not null,
  note       text not null default '',
  icon_url   text,
  team_id    uuid references public.teams on delete set null,
  official   boolean not null default false,
  position   int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_discords_way_in check (server_id is not null or invite is not null),
  constraint league_discords_server check (server_id is null or server_id ~ '^[0-9]{15,22}$'),
  constraint league_discords_invite check (invite is null or invite ~* '^https://(discord\.gg|discord\.com/invite)/[A-Za-z0-9-]{2,40}/?$'),
  constraint league_discords_name check (char_length(name) between 1 and 80),
  constraint league_discords_note check (char_length(note) <= 200),
  constraint league_discords_icon check (icon_url is null or
    icon_url ~ '^https://cdn\.discordapp\.com/icons/[0-9]{15,22}/[A-Za-z0-9_]{1,80}\.(png|webp|gif|jpg)(\?size=[0-9]{2,4})?$')
);
create unique index if not exists league_discords_one_server on public.league_discords (league_id, server_id) where server_id is not null;
create index if not exists league_discords_league on public.league_discords (league_id, position);
alter table public.league_discords enable row level security;
revoke all on public.league_discords from anon, authenticated;
comment on table public.league_discords is '0197: the Discord servers a league attaches for its forum page (forum/?l=).';

/* ATTACH ONE, OR CHANGE ONE (p.id) - the league's administrators. Returns its id. */
create or replace function public.save_league_discord(p_league uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  sid text := nullif(btrim(coalesce(p->>'server_id', '')), '');
  inv text := nullif(btrim(coalesce(p->>'invite', '')), '');
  nm  text := btrim(coalesce(p->>'name', ''));
  nt  text := btrim(coalesce(p->>'note', ''));
  ic  text := nullif(btrim(coalesce(p->>'icon_url', '')), '');
  tm  text := nullif(btrim(coalesce(p->>'team_id', '')), '');
  off boolean := coalesce(p->>'official', '') = 'true';
  lg  uuid;
begin
  if auth.uid() is null or p_league is null or not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'nothing to save' using errcode = '22023'; end if;
  if coalesce(p->>'id', '') <> '' then
    if (p->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'that server is not attached to this league' using errcode = 'P0002';
    end if;
    rid := (p->>'id')::uuid;
    select league_id into lg from public.league_discords where id = rid;
    if lg is distinct from p_league then raise exception 'that server is not attached to this league' using errcode = 'P0002'; end if;
  end if;
  if sid is not null and sid !~ '^[0-9]{15,22}$' then
    raise exception 'a Discord server id is the long number in Server Settings > Widget' using errcode = '22023';
  end if;
  if inv is not null and inv !~* '^https://(discord\.gg|discord\.com/invite)/[A-Za-z0-9-]{2,40}/?$' then
    raise exception 'an invitation is a discord.gg or discord.com/invite address' using errcode = '22023';
  end if;
  if sid is null and inv is null then
    raise exception 'give the server''s invitation, its id, or both' using errcode = '22023';
  end if;
  if nm = '' then raise exception 'give the server a name' using errcode = '22023'; end if;
  if char_length(nm) > 80 then raise exception 'a server''s name is 80 characters at most' using errcode = '22023'; end if;
  if char_length(nt) > 200 then raise exception 'a note is 200 characters at most' using errcode = '22023'; end if;
  if ic is not null and ic !~ '^https://cdn\.discordapp\.com/icons/[0-9]{15,22}/[A-Za-z0-9_]{1,80}\.(png|webp|gif|jpg)(\?size=[0-9]{2,4})?$' then
    raise exception 'a server''s picture is Discord''s own (cdn.discordapp.com/icons)' using errcode = '22023';
  end if;
  if tm is not null and (tm !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         or not exists (select 1 from public.teams t where t.id = tm::uuid and t.league_id = p_league)) then
    raise exception 'that club is not in this league' using errcode = '22023';
  end if;
  begin
    if rid is not null then
      update public.league_discords set server_id = sid, invite = inv, name = nm, note = nt, icon_url = ic, team_id = tm::uuid,
             official = off, updated_at = now()
       where id = rid;
    else
      if (select count(*) from public.league_discords where league_id = p_league) >= 12 then
        raise exception 'a league attaches 12 servers at most' using errcode = '54000';
      end if;
      insert into public.league_discords (league_id, server_id, invite, name, note, icon_url, team_id, official, position, created_by)
      values (p_league, sid, inv, nm, nt, ic, tm::uuid, off,
              coalesce((select max(position) + 1 from public.league_discords where league_id = p_league), 0), auth.uid())
      returning id into rid;
    end if;
  exception when unique_violation then
    raise exception 'that server is attached to this league already' using errcode = '23505';
  end;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'save_league_discord', 'league', p_league::text,
          jsonb_build_object('id', rid, 'server', sid, 'invite', inv, 'name', nm));
  return rid;
end $$;

/* TAKE ONE OFF the league's forum. */
create or replace function public.remove_league_discord(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare lg uuid;
begin
  select league_id into lg from public.league_discords where id = p_id;
  if lg is null or auth.uid() is null or not public.is_league_admin(lg) then
    raise exception 'that server is not attached to a league you administer' using errcode = '42501';
  end if;
  delete from public.league_discords where id = p_id;
  insert into public.audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'remove_league_discord', 'league', lg::text, jsonb_build_object('id', p_id));
  return true;
end $$;

/* ONE PLACE UP (p_by < 0) OR DOWN: the forum page shows them in this order, the first one open. */
create or replace function public.move_league_discord(p_id uuid, p_by int)
returns boolean language plpgsql security definer set search_path = public as $$
declare lg uuid; mine int; theirs uuid;
begin
  select league_id into lg from public.league_discords where id = p_id;
  if lg is null or auth.uid() is null or not public.is_league_admin(lg) then
    raise exception 'that server is not attached to a league you administer' using errcode = '42501';
  end if;
  with o as (select id, (row_number() over (order by position, created_at, id) - 1)::int as rn
               from public.league_discords where league_id = lg)
  update public.league_discords d set position = o.rn from o where d.id = o.id;
  select position into mine from public.league_discords where id = p_id;
  select id into theirs from public.league_discords
   where league_id = lg and position = mine + case when coalesce(p_by, 0) < 0 then -1 else 1 end;
  if theirs is null then return false; end if;
  update public.league_discords set position = mine where id = theirs;
  update public.league_discords set position = mine + case when coalesce(p_by, 0) < 0 then -1 else 1 end where id = p_id;
  return true;
end $$;

/* THE CONSOLE'S LIST (the league's administrators). */
create or replace function public.league_discords_admin(p_league uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or p_league is null or not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'server_id', d.server_id, 'invite', d.invite, 'name', d.name,
                                                       'note', d.note, 'icon_url', d.icon_url, 'team_id', d.team_id,
                                                       'official', d.official) order by d.position, d.created_at, d.id)
                     from public.league_discords d where d.league_id = p_league), '[]'::jsonb);
end $$;

/* THE FORUM PAGE'S READ: the league and its servers in order, for a league the reader may see that has any */
create or replace function public.league_discord_public(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', l.slug, 'name', l.name, 'colour', l.colour_a, 'logo_path', l.logo_path,
           'servers', (select jsonb_agg(jsonb_build_object(
                          'id', d.id, 'server_id', d.server_id, 'invite', d.invite, 'name', d.name, 'note', nullif(d.note, ''),
                          'icon_url', d.icon_url, 'official', d.official,
                          'club', (select jsonb_build_object('slug', t.slug, 'name', t.name, 'short_name', t.short_name,
                                                             'colour', t.colour, 'logo_path', t.logo_path)
                                     from public.teams t where t.id = d.team_id))
                        order by d.position, d.created_at, d.id)
                         from public.league_discords d where d.league_id = l.id))
    from public.leagues l
   where l.slug = p_slug and public.league_visible(l.id)
     and exists (select 1 from public.league_discords d where d.league_id = l.id);
$$;

/* THE RAIL'S QUESTION (nav.js probeQuery): a row for a league with a server attached, none otherwise */
create or replace function public.league_discord_probe(p_slug text)
returns table (yes int) language sql stable security definer set search_path = public as $$
  select 1 from public.leagues l
   where l.slug = p_slug and public.league_visible(l.id)
     and exists (select 1 from public.league_discords d where d.league_id = l.id)
  limit 1;
$$;

-- ------------------------------------------------------------------------------------------- grants ---
revoke all on function public.my_fan_profile() from public, anon;
revoke all on function public.set_fan_profile(jsonb) from public, anon;
revoke all on function public.sync_fan_discord() from public, anon;
revoke all on function public.save_league_discord(uuid, jsonb) from public, anon;
revoke all on function public.remove_league_discord(uuid) from public, anon;
revoke all on function public.move_league_discord(uuid, int) from public, anon;
revoke all on function public.league_discords_admin(uuid) from public, anon;
grant execute on function public.my_fan_profile() to authenticated;
grant execute on function public.set_fan_profile(jsonb) to authenticated;
grant execute on function public.sync_fan_discord() to authenticated;
grant execute on function public.save_league_discord(uuid, jsonb) to authenticated;
grant execute on function public.remove_league_discord(uuid) to authenticated;
grant execute on function public.move_league_discord(uuid, int) to authenticated;
grant execute on function public.league_discords_admin(uuid) to authenticated;
grant execute on function public.fan_profile_public(text) to anon, authenticated;
grant execute on function public.league_discord_public(text) to anon, authenticated;
grant execute on function public.league_discord_probe(text) to anon, authenticated;
