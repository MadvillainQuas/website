-- ============================================================================
-- 0163 - USERNAMES (EPINOIA GO, docs/epinoia-go.md step 2.1).
--
-- EPINOIA GO's leaderboards and photo feed name fans, and a fan is never named by their email. A
-- username is the public name: unique whatever the case ("Louie" and "louie" are one name), 3 to 20
-- letters, digits and underscores, starting with a letter, never one of the platform's own words, never
-- abuse, and changeable once in 30 days (the first choice, and a change of case only, are free).
--
-- ITS OWN TABLE, NOT A COLUMN ON profiles. profiles is writable by its owner, every column of it
-- (0001 profiles_self_write), so a username there could be set to anything by anybody - taken, abusive,
-- "admin". Here the owner may read their own row and nothing else, and the only way in is
-- set_username(), which applies every rule. Nobody reads another fan's row: the leaderboards (step 4)
-- publish usernames through their own functions, so a username is never tied to an account id in public.
--
--   username_check(p)   {ok, reason, username} - live feedback while typing; changes nothing
--   set_username(p)     {ok, reason, username, next_change_at}
--   my_username()       the signed-in fan's own username, or null
-- ============================================================================

create table if not exists public.usernames (
  user_id     uuid primary key references auth.users on delete cascade,
  username    text not null check (username ~ '^[A-Za-z][A-Za-z0-9_]{2,19}$'),
  changed_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create unique index if not exists usernames_unique_ci on public.usernames (lower(username));
comment on table public.usernames is
  'A fan''s public name (0163, EPINOIA GO). Written only by set_username(); read only by its owner and by functions that publish it.';

alter table public.usernames enable row level security;
drop policy if exists usernames_own_read on public.usernames;
create policy usernames_own_read on public.usernames for select using (user_id = auth.uid());
revoke insert, update, delete on public.usernames from anon, authenticated;
grant select on public.usernames to authenticated;

/* WORDS A USERNAME MAY NOT BE, or contain. `whole`: only as a whole part of the name (split at
   underscores and digits), because as a fragment it is also in ordinary names ("Dickson", "Peacock",
   "Scunthorpe"). Otherwise anywhere, after the usual disguises are undone (0 o, 1 i, 3 e, 4 a, 5 s,
   7 t, 8 b, @ a, underscores dropped). A platform administrator adds to it. */
create table if not exists public.username_blocklist (
  word   text primary key check (word ~ '^[a-z]{2,20}$'),
  whole  boolean not null default false,
  note   text
);
alter table public.username_blocklist enable row level security;
drop policy if exists username_blocklist_admin on public.username_blocklist;
create policy username_blocklist_admin on public.username_blocklist for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
insert into public.username_blocklist (word, whole, note) values
  ('fuck', false, 'abuse'), ('nigger', false, 'slur'), ('nigga', false, 'slur'), ('faggot', false, 'slur'),
  ('retard', false, 'slur'), ('rapist', false, 'abuse'), ('hitler', false, 'hate'), ('nazi', false, 'hate'),
  ('cunt', true, 'abuse'), ('shit', true, 'abuse'), ('bitch', true, 'abuse'), ('whore', true, 'abuse'),
  ('slut', true, 'abuse'), ('dick', true, 'abuse'), ('cock', true, 'abuse'), ('pussy', true, 'abuse'),
  ('porn', true, 'abuse'), ('wank', true, 'abuse'), ('twat', true, 'abuse'), ('fag', true, 'slur'),
  ('kike', true, 'slur'), ('spic', true, 'slur'), ('chink', true, 'slur'), ('rape', true, 'abuse'),
  ('sex', true, 'abuse'), ('anal', true, 'abuse'), ('puta', true, 'abuse (es)'), ('mierda', true, 'abuse (es)'),
  ('kurwa', true, 'abuse (pl)'), ('perkele', true, 'abuse (fi)')
on conflict (word) do nothing;

/* THE PLATFORM'S OWN WORDS: a fan named "admin" or "epinoia" reads as somebody official. Whole names,
   and a name that begins with the first four. */
create or replace function public.username_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select lower(p) ~ '^(epinoia|admin|official|support)'
      or lower(p) = any (array['moderator','mod','mods','staff','team','root','system','null','undefined',
        'anonymous','anon','api','www','help','me','you','everyone','nobody','guest','user','users','username',
        'owner','platform','league','leagues','club','clubs','referee','scorer','statistician','prophesy',
        'courtside','go','home','fixtures','scouting','contact','privacy','signin','login','logout','settings']);
$$;

/* ONE NAME'S VERDICT: 'ok', or the reason it cannot be had. p_user is who is asking: their own current
   name is not "taken". */
create or replace function public.username_verdict(p text, p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  n text := btrim(coalesce(p, ''));
  plain text;
  parts text[];
begin
  if char_length(n) < 3 then return 'short'; end if;
  if char_length(n) > 20 then return 'long'; end if;
  if n !~ '^[A-Za-z]' then return 'start'; end if;
  if n !~ '^[A-Za-z][A-Za-z0-9_]*$' then return 'characters'; end if;
  if public.username_reserved(n) then return 'reserved'; end if;
  plain := translate(lower(n), '013457 8@_', 'oieast ba');
  parts := regexp_split_to_array(regexp_replace(lower(n), '[0-9]+', '_', 'g'), '_+');
  if exists (select 1 from username_blocklist b
              where (not b.whole and position(b.word in plain) > 0)
                 or (b.whole and b.word = any (parts))) then
    return 'blocked';
  end if;
  if exists (select 1 from usernames u where lower(u.username) = lower(n) and u.user_id is distinct from p_user) then
    return 'taken';
  end if;
  return 'ok';
end; $$;
alter function public.username_verdict(text, uuid) owner to postgres;
revoke all on function public.username_verdict(text, uuid) from public, anon, authenticated;

create or replace function public.username_check(p text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  v := public.username_verdict(p, auth.uid());
  return jsonb_build_object('ok', v = 'ok', 'reason', v, 'username', btrim(coalesce(p, '')));
end; $$;
alter function public.username_check(text) owner to postgres;
revoke all on function public.username_check(text) from public, anon;
grant execute on function public.username_check(text) to authenticated;

create or replace function public.set_username(p text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n text := btrim(coalesce(p, ''));
  v text;
  cur usernames%rowtype;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- one fan's two tabs, or a double tap: the second waits for the first
  perform pg_advisory_xact_lock(hashtext('set_username:' || me::text));
  select * into cur from usernames where user_id = me;
  v := public.username_verdict(n, me);
  if v <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v, 'username', cur.username);
  end if;
  if cur.user_id is not null and cur.username = n then
    return jsonb_build_object('ok', true, 'reason', 'same', 'username', n,
                              'next_change_at', cur.changed_at + interval '30 days');
  end if;
  -- once in 30 days; a change of case only is not a new name
  if cur.user_id is not null and lower(cur.username) <> lower(n) and cur.changed_at > now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'username', cur.username,
                              'next_change_at', cur.changed_at + interval '30 days');
  end if;
  begin
    insert into usernames (user_id, username) values (me, n)
      on conflict (user_id) do update
        set username = excluded.username,
            changed_at = case when lower(usernames.username) = lower(excluded.username) then usernames.changed_at else now() end;
  exception when unique_violation then
    -- somebody else took it between the check and the write
    return jsonb_build_object('ok', false, 'reason', 'taken', 'username', cur.username);
  end;
  select * into cur from usernames where user_id = me;
  return jsonb_build_object('ok', true, 'reason', 'ok', 'username', cur.username,
                            'next_change_at', cur.changed_at + interval '30 days');
end; $$;
alter function public.set_username(text) owner to postgres;
revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

create or replace function public.my_username()
returns text language sql stable security definer set search_path = public as $$
  select username from usernames where user_id = auth.uid();
$$;
revoke all on function public.my_username() from public, anon;
grant execute on function public.my_username() to authenticated;

-- ----------------------------------------------------------------------------
-- A READ-ONLY CHECK of the verdicts (no fan is needed: p_user is null here)
-- ----------------------------------------------------------------------------
do $$
declare
  cases text[][] := array[
    array['Louie_7', 'ok'], array['ab', 'short'], array['a23456789012345678901', 'long'], array['7up', 'start'],
    array['_louie', 'start'], array['louie.h', 'characters'], array['Admin', 'reserved'], array['EpinoiaFan', 'reserved'],
    array['f4ck', 'ok'], array['fuckyou', 'blocked'], array['FuCk_it', 'blocked'], array['n1gg3r', 'blocked'],
    array['big_dick', 'blocked'], array['Dickson', 'ok'], array['Peacock', 'ok'], array['ScunthorpeFan', 'ok'],
    array['shit99', 'blocked'], array['Fagerlund', 'ok']];
  i int;
  got text;
begin
  for i in 1 .. array_length(cases, 1) loop
    got := public.username_verdict(cases[i][1], null);
    if got <> cases[i][2] then
      raise exception '0163: % should be %, is %', cases[i][1], cases[i][2], got;
    end if;
  end loop;
  if exists (select 1 from pg_policies where tablename = 'usernames' and cmd <> 'SELECT') then
    raise exception '0163: usernames must have no write policy (set_username is the only way in)';
  end if;
  raise notice '0163 ok: % verdicts as expected', array_length(cases, 1);
end $$;
