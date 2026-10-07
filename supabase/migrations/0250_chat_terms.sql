-- ============================================================================
-- 0250 - THE CHAT FOR ANYBODY SIGNED IN, AFTER ONE QUICK POP-UP (2026-10-07)
--
-- An EPINOIA account is the account the chat asks for (GO's profile is the same sign-in), so a reader signed in
-- anywhere on the site may chat. What was missing was asked for on other pages (a username on the profile page, 18 or
-- over beside the box); it is now ONE pop-up in the chat itself (gamechat.js): a name for the chat when the account
-- has none (set_username, 0163), "I am 18 or over", and the chat's terms - then JOIN THE CHAT. The terms are recorded
-- once (go_settings.chat_terms_at) and the chat's gate asks for them, as it asks for the age.
-- ============================================================================
set local lock_timeout = '5s';

alter table public.go_settings add column if not exists chat_terms_at timestamptz;
comment on column public.go_settings.chat_terms_at is '0250: when the fan accepted the live chat''s terms (the chat''s pop-up).';

/* JOIN THE CHAT: 18 or over and the terms, once (the name is set_username's) -> { ok, reason } */
create or replace function public.accept_chat_terms(p_adult boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if not coalesce(p_adult, false) then return jsonb_build_object('ok', false, 'reason', 'adult'); end if;
  insert into go_settings (user_id, public, adult_confirmed_at, chat_terms_at) values (me, false, now(), now())
  on conflict (user_id) do update
    set adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, now()),
        chat_terms_at = coalesce(go_settings.chat_terms_at, now()), updated_at = now();
  return jsonb_build_object('ok', true, 'reason', 'ok');
end $$;

create or replace function public.chat_gate(p_user uuid, p_game uuid, p_body text, p_adult boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  b text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  un text; av text; ctx record;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if exists (select 1 from auth.users u where u.id = p_user and u.banned_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;
  select username into un from usernames where user_id = p_user;
  if un is null then return jsonb_build_object('ok', false, 'reason', 'username'); end if;
  if not exists (select 1 from go_settings where user_id = p_user and adult_confirmed_at is not null) then
    if not coalesce(p_adult, false) then return jsonb_build_object('ok', false, 'reason', 'adult'); end if;
    insert into go_settings (user_id, public, adult_confirmed_at) values (p_user, false, now())
    on conflict (user_id) do update set adult_confirmed_at = coalesce(go_settings.adult_confirmed_at, now()), updated_at = now();
  end if;
  /* 0250: the chat's terms, accepted once (the pop-up's JOIN THE CHAT: accept_chat_terms) */
  if not exists (select 1 from go_settings where user_id = p_user and chat_terms_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'terms');
  end if;
  if not public.chat_open_league(p_game) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if not public.chat_game_on(p_game) then return jsonb_build_object('ok', false, 'reason', 'not_now'); end if;
  if b = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(b) > 280 then return jsonb_build_object('ok', false, 'reason', 'long'); end if;
  if not public.go_caption_ok(b) then return jsonb_build_object('ok', false, 'reason', 'words'); end if;
  if b ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|gg|tv|ly|me|co|uk|es|de|fr|it|jp)\M)' then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;
  -- a slow-down: one message every four seconds, fifteen in two minutes, three hundred a day; three blocked
  -- in ten minutes and the poster waits ten minutes from the last
  if exists (select 1 from game_chat where user_id = p_user and created_at > now() - interval '4 seconds')
     or (select count(*) from game_chat where user_id = p_user and created_at > now() - interval '2 minutes') >= 15 then
    return jsonb_build_object('ok', false, 'reason', 'slow');
  end if;
  if (select count(*) from game_chat where user_id = p_user and status = 'blocked' and created_at > now() - interval '10 minutes') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'muted');
  end if;
  if (select count(*) from game_chat where user_id = p_user and created_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'day_full');
  end if;
  select fp.avatar_url into av from fan_profiles fp join go_settings gs on gs.user_id = fp.user_id
   where fp.user_id = p_user and gs.public and gs.adult_confirmed_at is not null and fp.avatar_url ~ '^https://';
  select l.name as league, h.name as home, a.name as away into ctx
    from games g join teams h on h.id = g.home_team_id join teams a on a.id = g.away_team_id
    join competitions c on c.id = g.competition_id join seasons s on s.id = c.season_id join leagues l on l.id = s.league_id
   where g.id = p_game;
  return jsonb_build_object('ok', true, 'username', un, 'avatar', av, 'body', b,
                            'league', ctx.league, 'home', ctx.home, 'away', ctx.away);
end $$;

create or replace function public.chat_my_status(p_game uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'signed_in', auth.uid() is not null,
           'username', (select username from usernames where user_id = auth.uid()),
           'adult', exists (select 1 from go_settings where user_id = auth.uid() and adult_confirmed_at is not null),
           'terms', exists (select 1 from go_settings where user_id = auth.uid() and chat_terms_at is not null),
           'open', public.chat_open_league(p_game),
           'on', public.chat_game_on(p_game),
           'admin', auth.uid() is not null and (public.is_platform_admin() or public.is_league_admin(public.game_league_id(p_game))));
$$;

alter function public.accept_chat_terms(boolean) owner to postgres;
revoke all on function public.accept_chat_terms(boolean) from public, anon;
grant execute on function public.accept_chat_terms(boolean) to authenticated;
