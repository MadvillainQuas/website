-- ============================================================================
-- 0139 — A PRIVATE LEAGUE: not on the front page, opened by a link.
--
-- Epinoia has had one kind of league: public. Anybody can find it, and 0117/0118
-- added a second dimension on top of that — members-only, where the league is
-- still IN the shop window but what happened on court is behind a subscription.
--
-- This is the third thing, and it is not a degree of either: a league that is not
-- advertised at all. A school's internal season, a summer run, a corporate league,
-- a league Epinoia is paid to run for one organiser. It is not listed anywhere, it
-- is not in a search, it is not in the sitemap; you are in it because somebody sent
-- you the link.
--
-- WHY A SECOND COLUMN AND NOT A THIRD access_mode. access_mode is the PAYWALL, and
-- 0117/0118 are written throughout as `when access_mode = 'open' then true` — the
-- fast path that keeps an ordinary league from ever calling a lookup. Adding
-- 'private' to that enum would make every one of those fast paths treat a private
-- league as a paywalled one, which is wrong twice over: a private league is not
-- for sale, and a member of the platform's paid tier is not thereby in somebody's
-- private league. They are orthogonal, so they are two columns. A private league
-- can be open (the usual case: invited, then everything is free to you) or
-- members-only (invited, and then it still wants the league feature).
--
-- WHAT THIS DOES NOT DO. It is a private league, not a secret one. It hides rows
-- from the API; it does not defend against somebody who was invited, took the
-- data and passed it on, and it does not reach the things 0118's own header lists
-- as outside the database's control — the public storage buckets, the Realtime
-- broadcast topics, and anything a public feed already publishes at source. A
-- private league fed from a public LiveStats schedule is private ON EPINOIA and
-- nowhere else. Say so to whoever is paying for it.
--
-- HOW IT IS ENFORCED. Not by new policies on every table — 0118 already built the
-- funnel, and everything about who may see a league's content already runs through
-- four functions:
--
--     can_view_league(league)   the per-league answer
--     league_visible(league)    \
--     competition_visible(comp)  }  what the restrictive read policies call
--     game_visible(game)        /
--
-- plus one statement-level fast path, any_members_league(), that switches the
-- whole apparatus off while nothing is gated. So this file changes those five
-- functions and adds nothing to the policies that call them. The one genuinely
-- new policy surface is the shop window itself — leagues, seasons, competitions,
-- teams and rosters, which 0118 deliberately left public because a members-only
-- league still wants to be found. A private league does not.
--
-- THE FAST PATH IS KEPT. any_members_league() becomes an alias for
-- any_gated_league(), which is true when EITHER kind of gating exists. Its name
-- has meant "is anything gated right now" since 0118 (its own header says so in
-- those words); now that there are two kinds of gate, the honest name exists and
-- the old one is one line on top of it, so the dozen policies compiled against it
-- pick this up without being rewritten. While no league is private and none is
-- members-only — which is how the platform ships — every one of those policies
-- still answers for a whole statement on a single constant, and nothing below is
-- evaluated per row at all.
--
-- Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. THE COLUMN.
--
-- On leagues beside access_mode, for the same reason 0117 put access_mode there:
-- every page that shows a league already reads its row, and a page has to know
-- before it draws anything. Unlike access_mode it is NOT public — the row is
-- hidden from anyone not invited, so nobody outside can read the column that
-- says so.
-- ----------------------------------------------------------------------------
alter table public.leagues
  add column if not exists visibility text not null default 'public';

do $$ begin
  alter table public.leagues add constraint leagues_visibility_ck
    check (visibility in ('public', 'private'));
exception when duplicate_object then null; end $$;

comment on column public.leagues.visibility is
  'public (default) or private. A private league is not listed, not searchable and not in the '
  'sitemap: its row is readable only by the platform, its own staff and whoever redeemed an '
  'invite. Changed only through platform_set_league_visibility. See 0139.';

-- The fast path's index, like leagues_members_only_idx (0118): however many
-- leagues the feed ingest creates, "is any league private" stays an index probe.
create index if not exists leagues_private_idx
  on public.leagues (id) where visibility = 'private';

/* THE GUARD, exactly as 0117 guards access_mode and for the same reason:
   leagues_write (0001) is FOR ALL using is_league_admin(id), so without this the
   admin of a private league could PATCH visibility back to 'public' straight
   through the REST API and put a league somebody is paying to keep quiet on the
   front page. Whether a league is advertised is the platform's decision, not the
   league's. Refused only when the value actually CHANGES, so a console that
   PATCHes a whole row back unchanged is not broken by it. */
create or replace function public.leagues_visibility_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.visibility is distinct from old.visibility
     and coalesce(current_setting('epinoia.visibility_rpc', true), '') <> 'on' then
    raise exception 'a league is made private through platform_set_league_visibility, not by editing the league row'
      using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists leagues_visibility_guard on public.leagues;
create trigger leagues_visibility_guard
  before update of visibility on public.leagues
  for each row execute function public.leagues_visibility_guard();

-- ----------------------------------------------------------------------------
-- 2. THE INVITE, AND WHO CAME IN THROUGH ONE.
--
-- Two tables because they answer two different questions. An invite is a link
-- that may be handed to several people, revoked, or left to expire; a guest is
-- one account that used one, and stays in until they are removed even if the
-- link they used is later revoked (revoking a link that leaked must not throw
-- out the twelve people who joined with it legitimately — make a new one and
-- revoke the old).
--
-- WHAT A LINK GRANTS is written on the link, not decided when it is redeemed:
--
--   viewer        sees the league. Nothing else. The usual link, the one that
--                 goes in a WhatsApp group.
--   league_admin  runs the league — fixtures, clubs, scoring, everything
--                 is_league_admin opens. This is the one that goes to the person
--                 paying for the league, and it is a real membership row, the
--                 same as a grant from the platform console.
--
-- No 'statistician' variant: a league admin can appoint their own, which is the
-- point of handing them the league.
-- ----------------------------------------------------------------------------
create table if not exists public.league_invites (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues on delete cascade,
  -- Short, unguessable, URL-safe, and kept in the clear unlike an API key
  -- (0021): an admin has to be able to re-copy the link a fortnight later, and
  -- the row is readable only by the people who could mint a new one anyway.
  token       text not null unique check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  role        text not null default 'viewer' check (role in ('viewer', 'league_admin')),
  label       text not null default '',          -- "the parents' group", "Dan"
  created_by  uuid references auth.users,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,                       -- null = no expiry
  max_uses    int check (max_uses is null or max_uses > 0),
  uses        int not null default 0,
  revoked_at  timestamptz
);
create index if not exists league_invites_league on public.league_invites (league_id);

create table if not exists public.league_guests (
  league_id  uuid not null references public.leagues on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  invite_id  uuid references public.league_invites on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists league_guests_user on public.league_guests (user_id);

alter table public.league_invites enable row level security;
alter table public.league_guests  enable row level security;

/* Nobody reads league_invites through the API — a token in a row a policy might
   one day widen is a link handed out by accident, so the list goes through an
   RPC (league_invites_list) and the table itself answers nobody. Writes likewise:
   only the definer functions below. */
drop policy if exists invites_none on public.league_invites;
create policy invites_none on public.league_invites for select using (false);

/* A guest may see their own row — that is how a page knows to stop asking for
   the link — and a league's staff may see who they let in. */
drop policy if exists guests_read on public.league_guests;
create policy guests_read on public.league_guests for select
  using (user_id = auth.uid() or public.is_league_admin(league_id));
drop policy if exists guests_leave on public.league_guests;
create policy guests_leave on public.league_guests for delete
  using (user_id = auth.uid() or public.is_league_admin(league_id));

-- ----------------------------------------------------------------------------
-- 3. THE HELPERS.
--
-- league_invited() is the whole of "may this account see this private league",
-- and it is deliberately generous about staff: the platform, anyone holding a
-- membership scoped to the league, the manager of any club in it, and anyone who
-- redeemed a link. A club manager is in the list because a private league whose
-- visiting club's manager cannot see the fixture they are travelling to is
-- broken, and because game_visible already lets that manager through for
-- members-only leagues — the two must agree or a cup tie behaves differently
-- depending on which gate it hits first.
-- ----------------------------------------------------------------------------
create or replace function public.any_private_league()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from leagues l where l.visibility = 'private');
$$;

/* "Is anything gated right now", under the name that says so. 0118 built its
   whole fast path on one statement-level question of exactly this shape, and now
   that there are two kinds of gate the question has two halves. */
create or replace function public.any_gated_league()
returns boolean language sql stable security definer set search_path = public as $$
  select (public.memberships_enabled()
          and exists (select 1 from leagues l where l.access_mode = 'members'))
      or exists (select 1 from leagues l where l.visibility = 'private');
$$;

/* The 0118 name, kept because a dozen policies are compiled against it and
   re-creating them all to change a word would be a far bigger change than this.
   Its header already defined it as "is anything gated right now"; this keeps that
   meaning true now that privacy is one of the things that gates. */
create or replace function public.any_members_league()
returns boolean language sql stable security definer set search_path = public as $$
  select public.any_gated_league();
$$;

create or replace function public.league_invited(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_league is null
      or public.is_platform_admin()
      or exists (select 1 from league_guests g
                  where g.league_id = p_league and g.user_id = auth.uid())
      or exists (select 1 from memberships m
                  where m.user_id = auth.uid() and m.scope_type = 'league' and m.scope_id = p_league)
      or exists (select 1 from teams t
                  join memberships m on m.scope_type = 'team' and m.scope_id = t.id
                 where t.league_id = p_league and m.user_id = auth.uid());
$$;

/* The same question about somebody else, for the notification fan-outs, which
   run as the service role and cannot use auth.uid(). Mirrors
   can_view_league_for (0117). */
create or replace function public.league_invited_for(p_user uuid, p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_league is null
      or exists (select 1 from memberships m
                  where m.user_id = p_user and m.role = 'platform_admin')
      or exists (select 1 from league_guests g
                  where g.league_id = p_league and g.user_id = p_user)
      or exists (select 1 from memberships m
                  where m.user_id = p_user and m.scope_type = 'league' and m.scope_id = p_league)
      or exists (select 1 from teams t
                  join memberships m on m.scope_type = 'team' and m.scope_id = t.id
                 where t.league_id = p_league and m.user_id = p_user);
$$;

/* "Not a private league I am outside of." The shop-window policies in section 5
   are written on these, and they answer on the leagues row alone for every
   public league, which is all of them until somebody makes one private.

   THERE IS ONE PER TABLE SHAPE, AND THE WALK TO THE LEAGUE IS INSIDE THEM,
   which looks like four copies of one function and is the whole point. A
   policy's own expression runs AS THE QUERYING ROLE, so a sub-select written
   into the policy text — `(select t.league_id from teams t where t.id = ...)` —
   is itself filtered by that table's policies. Once teams is hidden for a
   private league, that sub-select returns NULL rather than the league id, NULL
   means "nothing to check", and the roster rows this was meant to hide all sail
   through. The lookup has to happen somewhere RLS does not apply, which is
   inside a security definer function. */
create or replace function public.league_open_to_me(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null then true
    else coalesce((select case when l.visibility = 'public' then true
                               else public.league_invited(l.id) end
                     from leagues l where l.id = p_league), true)
  end;
$$;

create or replace function public.team_open_to_me(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.league_open_to_me((select t.league_id from teams t where t.id = p_team));
$$;

create or replace function public.season_open_to_me(p_season uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.league_open_to_me((select s.league_id from seasons s where s.id = p_season));
$$;

create or replace function public.comp_open_to_me(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.league_open_to_me((select s.league_id from competitions c
                                     join seasons s on s.id = c.season_id
                                    where c.id = p_competition));
$$;

-- ----------------------------------------------------------------------------
-- 4. THE FOUR GATES 0118 BUILT, NOW ANSWERING FOR BOTH KINDS OF GATE.
--
-- Each keeps its shape exactly: a statement-cheap "is anything gated" test, then
-- a branch that answers on columns of the leagues row before anything is looked
-- up, then the slow answer. The only edits are that the cheap test now asks about
-- privacy too, and that the `access_mode = 'open'` shortcut has gained
-- `visibility = 'public'` — because an open PRIVATE league must not take the
-- shortcut that says "nothing to check here".
--
-- PRIVACY IS ASKED FIRST, and it does not consult memberships_enabled(). The
-- master switch is about whether anybody is being charged; it has nothing to say
-- about whether a league is advertised, and a private league must not become
-- browsable because Stripe is not configured yet.
-- ----------------------------------------------------------------------------
create or replace function public.can_view_league(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null then true
    else coalesce((
      select case
               when l.visibility = 'private' and not public.league_invited(l.id) then false
               when l.access_mode = 'open' then true
               when not public.memberships_enabled() then true
               when auth.role() = 'service_role' then true
               else 'league' = any (public.access_features(l.id))
             end
        from leagues l
       where l.id = p_league), true)
  end;
$$;

create or replace function public.can_view_league_for(p_user uuid, p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null then true
    else coalesce((
      select case
               when l.visibility = 'private' and not public.league_invited_for(p_user, l.id) then false
               when l.access_mode = 'open' then true
               when not public.memberships_enabled() then true
               else 'league' = any (public.access_features_for(p_user, l.id))
             end
        from leagues l
       where l.id = p_league), true)
  end;
$$;

create or replace function public.league_visible(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_league is null
      or not exists (select 1 from public.leagues m
                      where m.access_mode = 'members' or m.visibility = 'private') then true
    else coalesce((
      select case when l.visibility = 'public' and l.access_mode = 'open' then true
                  else public.can_view_league(l.id) end
        from leagues l
       where l.id = p_league), true)
  end;
$$;

create or replace function public.competition_visible(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_competition is null
      or not exists (select 1 from public.leagues m
                      where m.access_mode = 'members' or m.visibility = 'private') then true
    else coalesce((
      select case when l.id is null
                    or (l.visibility = 'public' and l.access_mode = 'open') then true
                  else public.can_view_league(l.id) end
        from competitions c
        left join seasons s on s.id = c.season_id
        left join leagues l on l.id = s.league_id
       where c.id = p_competition), true)
  end;
$$;

create or replace function public.game_visible(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_game is null
      or not exists (select 1 from public.leagues m
                      where m.access_mode = 'members' or m.visibility = 'private') then true
    else coalesce((
      select case
               when l.id is null
                 or (l.visibility = 'public' and l.access_mode = 'open') then true
               when public.can_view_league(l.id) then true
               when public.is_team_manager(g.home_team_id)
                 or public.is_team_manager(g.away_team_id) then true
               when exists (select 1 from game_officials go
                             where go.game_id = g.id and go.user_id = auth.uid()) then true
               else public.is_league_admin(l.id)
             end
        from games g
        left join competitions c on c.id = g.competition_id
        left join seasons s      on s.id = c.season_id
        left join leagues  l     on l.id = s.league_id
       where g.id = p_game), true)
  end;
$$;

-- ----------------------------------------------------------------------------
-- 5. THE SHOP WINDOW, WHICH A PRIVATE LEAGUE DOES NOT HAVE.
--
-- 0118 deliberately left leagues / seasons / competitions / teams / rosters
-- public: a members-only league still wants to be found, and hiding its name
-- would defeat the point of selling access to it. A private league is the exact
-- opposite case, so these are the tables this file has to add to.
--
-- leagues_read is REPLACED (it was `using (true)`); the rest get a RESTRICTIVE
-- policy alongside whatever they already have, which is how 0118 adds a
-- condition without having to know what the permissive policies say. Every one
-- opens with `not (select public.any_private_league())` — an InitPlan, evaluated
-- once per statement — so while no league is private these cost one index probe
-- for a whole query and nothing per row.
--
-- players and media are NOT here. A player is a person, not a league's property,
-- and the same player may be in a private league and three public ones; hiding
-- the person because of one of them would break the public leagues. What they
-- DID in the private league is in the game tables, which section 4 covers.
-- ----------------------------------------------------------------------------
drop policy if exists leagues_read on public.leagues;
create policy leagues_read on public.leagues for select
  using (not (select public.any_private_league())
         or visibility = 'public'
         or public.league_invited(id));

do $$
declare tbl text; pred text;
begin
  for tbl, pred in
    select * from (values
      ('seasons',           'public.league_open_to_me(seasons.league_id)'),
      ('competitions',      'public.season_open_to_me(competitions.season_id)'),
      ('competition_teams', 'public.comp_open_to_me(competition_teams.competition_id)'),
      ('teams',             'public.league_open_to_me(teams.league_id)'),
      ('roster_entries',    'public.team_open_to_me(roster_entries.team_id)')
    ) as v(table_name, predicate)
  loop
    if to_regclass('public.' || tbl) is null then
      raise warning '0139: table public.% does not exist; its private-league policy was skipped', tbl;
      continue;
    end if;
    execute format('drop policy if exists private_league_read on public.%I', tbl);
    execute format('create policy private_league_read on public.%I as restrictive for select '
                   'to anon, authenticated using (not (select public.any_private_league()) or (%s))',
                   tbl, pred);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. THE PLATFORM'S SWITCH.
-- ----------------------------------------------------------------------------
create or replace function public.platform_set_league_visibility(p_league uuid, p_visibility text)
returns text language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'a league is public or private, not %', p_visibility using errcode = '22023';
  end if;
  select name into v_name from leagues where id = p_league;
  if v_name is null then raise exception 'no such league' using errcode = '42704'; end if;

  perform set_config('epinoia.visibility_rpc', 'on', true);
  update leagues set visibility = p_visibility where id = p_league;
  perform set_config('epinoia.visibility_rpc', '', true);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_league_visibility', 'league', p_league::text,
          jsonb_build_object('visibility', p_visibility, 'league', v_name));

  return v_name || ' is now ' ||
         case when p_visibility = 'private'
              then 'private — it is off the front page, and only an invite link opens it'
              else 'public' end;
end; $$;

-- ----------------------------------------------------------------------------
-- 7. MINTING, LISTING, REVOKING AND REDEEMING A LINK.
--
-- Minting is open to the league's own admins as well as the platform, because
-- the whole point of handing somebody a private league is that they then run it,
-- and "ask Epinoia every time you want to add a parent" is not running it. What
-- they cannot do is mint themselves a way out of being private (section 1's
-- guard) or invite anybody to a league that is not theirs.
-- ----------------------------------------------------------------------------
create or replace function public.league_invite_create(
  p_league     uuid,
  p_role       text default 'viewer',
  p_label      text default '',
  p_expires_at timestamptz default null,
  p_max_uses   int default null
) returns table (id uuid, token text, role text, label text,
                 expires_at timestamptz, max_uses int)
language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid;
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  if p_role not in ('viewer', 'league_admin') then
    raise exception 'a link lets somebody in as a viewer or as a league admin, not as %', p_role
      using errcode = '22023';
  end if;
  /* Only the platform hands over the keys. A league admin minting a
     league_admin link is how one organiser quietly becomes two, with no record
     of who decided that; the platform console is where that decision is made. */
  if p_role = 'league_admin' and not public.is_platform_admin() then
    raise exception 'only a platform admin may mint a link that grants league admin'
      using errcode = '42501';
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'a link is good for at least one use' using errcode = '22023';
  end if;

  -- 24 URL-safe characters out of the CSPRNG. Long enough that guessing is not
  -- a strategy, short enough to paste into a message.
  v_token := replace(replace(replace(
               encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');

  insert into league_invites (league_id, token, role, label, created_by, expires_at, max_uses)
  values (p_league, v_token, p_role, coalesce(trim(p_label), ''), auth.uid(), p_expires_at, p_max_uses)
  returning league_invites.id into v_id;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'league_invite_create', 'league', p_league::text,
          jsonb_build_object('invite', v_id, 'role', p_role, 'label', p_label));

  return query select v_id, v_token, p_role, coalesce(trim(p_label), ''), p_expires_at, p_max_uses;
end; $$;

create or replace function public.league_invites_list(p_league uuid)
returns table (id uuid, token text, role text, label text, created_at timestamptz,
               expires_at timestamptz, max_uses int, uses int, revoked_at timestamptz,
               spent boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
    select i.id, i.token, i.role, i.label, i.created_at, i.expires_at,
           i.max_uses, i.uses, i.revoked_at,
           (i.revoked_at is not null
            or (i.expires_at is not null and i.expires_at <= now())
            or (i.max_uses is not null and i.uses >= i.max_uses)) as spent
      from league_invites i
     where i.league_id = p_league
     order by i.created_at desc;
end; $$;

create or replace function public.league_invite_revoke(p_invite uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from league_invites where id = p_invite;
  if not found then return 'already revoked'; end if;
  if not public.is_league_admin(v.league_id) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  update league_invites set revoked_at = now() where id = p_invite and revoked_at is null;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'league_invite_revoke', 'league', v.league_id::text,
          jsonb_build_object('invite', p_invite, 'label', v.label));

  /* Deliberately says what revoking does NOT do, because the obvious reading is
     wrong and the mistake is not recoverable by pressing it again. */
  return 'the link is dead. Everybody who already used it is still in — remove them from the guests list.';
end; $$;

/* WHAT A REDEEM LOOKS LIKE FROM THE PAGE. The visitor arrives at
   /epinoia/join/?i=<token>. If they are signed out the page says which league
   the link is for and sends them to sign in and back; only a signed-in account
   can be let in, because being let in is a row against an account.

   peek is callable by anon on purpose and returns THE LEAGUE'S NAME AND NOTHING
   ELSE. Somebody holding the link is allowed to know what they are being invited
   to before they create an account, and a token nobody holds cannot be guessed
   into an answer. A dead link says so rather than pretending to be valid — being
   sent to sign in, signing in, and only then being told the link expired is a
   worse thirty seconds than being told at the door. */
create or replace function public.league_invite_peek(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v record; v_l record;
begin
  select * into v from league_invites where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select id, name, slug, logo_path, colour_a into v_l from leagues where id = v.league_id;
  if v.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked', 'league', v_l.name);
  end if;
  if v.expires_at is not null and v.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'league', v_l.name);
  end if;
  if v.max_uses is not null and v.uses >= v.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'used_up', 'league', v_l.name);
  end if;
  return jsonb_build_object('ok', true, 'league', v_l.name, 'slug', v_l.slug,
                            'logo_path', v_l.logo_path, 'colour_a', v_l.colour_a,
                            'role', v.role);
end; $$;

create or replace function public.redeem_league_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_l record; v_new boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  /* Locked, because uses is a counter and two phones opening the same
     one-use link at the same moment must not both get in. */
  select * into v from league_invites where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select id, name, slug into v_l from leagues where id = v.league_id;
  if v.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked', 'league', v_l.name);
  end if;
  if v.expires_at is not null and v.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'league', v_l.name);
  end if;

  /* ALREADY IN IS A SUCCESS, and it does not spend a use. Somebody who opens the
     same link twice — a bookmark, a second phone, a group chat they scrolled
     back through — is not a second person, and a one-use link that locked out
     the very person it was for would be the most annoying possible bug. */
  if exists (select 1 from league_guests g
              where g.league_id = v.league_id and g.user_id = auth.uid())
     or (v.role = 'league_admin'
         and exists (select 1 from memberships m
                      where m.user_id = auth.uid() and m.role = 'league_admin'
                        and m.scope_type = 'league' and m.scope_id = v.league_id)) then
    return jsonb_build_object('ok', true, 'already', true,
                              'league', v_l.name, 'slug', v_l.slug, 'role', v.role);
  end if;

  if v.max_uses is not null and v.uses >= v.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'used_up', 'league', v_l.name);
  end if;

  /* A guest row either way, even for a league admin: is_league_admin already
     answers for the membership, but league_guests is the record of HOW somebody
     got in, and the league's staff list should show that this admin arrived
     through a link rather than a console grant. */
  insert into league_guests (league_id, user_id, invite_id)
  values (v.league_id, auth.uid(), v.id)
  on conflict do nothing;

  if v.role = 'league_admin' then
    insert into memberships (user_id, role, scope_type, scope_id)
    values (auth.uid(), 'league_admin', 'league', v.league_id)
    on conflict do nothing;
  end if;

  update league_invites set uses = uses + 1 where id = v.id;
  v_new := true;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'redeem_league_invite', 'league', v.league_id::text,
          jsonb_build_object('invite', v.id, 'role', v.role, 'label', v.label));

  return jsonb_build_object('ok', true, 'already', false, 'league', v_l.name,
                            'slug', v_l.slug, 'role', v.role);
end; $$;

/* Who is in, for the league's own staff page, and the way back out. */
create or replace function public.league_guests_list(p_league uuid)
returns table (user_id uuid, email text, joined_at timestamptz, label text, role text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  return query
    select g.user_id, u.email::text, g.joined_at,
           coalesce(i.label, ''), coalesce(i.role, 'viewer')
      from league_guests g
      join auth.users u on u.id = g.user_id
      left join league_invites i on i.id = g.invite_id
     where g.league_id = p_league
     order by g.joined_at desc;
end; $$;

create or replace function public.league_guest_remove(p_league uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'you do not administer that league' using errcode = '42501';
  end if;
  delete from league_guests where league_id = p_league and user_id = p_user;
  /* The membership too, if the link granted one: leaving it behind would mean
     "removed" left somebody administering the league. A grant made in the
     console is a separate decision and is left alone — this only takes back what
     a link gave, which is why it is matched on the guest row having existed. */
  delete from memberships m
   where m.user_id = p_user and m.role = 'league_admin'
     and m.scope_type = 'league' and m.scope_id = p_league
     and exists (select 1 from league_invites i
                  where i.league_id = p_league and i.role = 'league_admin');

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'league_guest_remove', 'league', p_league::text,
          jsonb_build_object('user', p_user));
  return 'removed';
end; $$;

-- ----------------------------------------------------------------------------
-- 7b. THE CONSOLE'S OWN LIST needs to say which leagues are private, and how
-- many links are out for each — a private league with no live link is a league
-- nobody can reach, which is worth seeing at a glance rather than discovering.
--
-- Dropped and re-created rather than replaced: a function's OUT parameters are
-- part of its signature, and CREATE OR REPLACE cannot change them.
-- ----------------------------------------------------------------------------
drop function if exists public.platform_leagues();
create or replace function public.platform_leagues()
returns table (
  id uuid, slug text, name text, colour_a text, colour_b text,
  public_live boolean, youth_protected boolean, created_at timestamptz,
  store_url text, store_name text,
  n_teams bigint, n_players bigint, n_games bigint, n_admins bigint, n_keys bigint,
  visibility text, n_invites bigint, n_guests bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
  select l.id, l.slug, l.name, l.colour_a, l.colour_b,
         l.public_live, l.youth_protected, l.created_at,
         l.store_url, l.store_name,
         (select count(*) from teams t where t.league_id = l.id),
         (select count(distinct r.player_id) from roster_entries r
            join teams t on t.id = r.team_id where t.league_id = l.id),
         (select count(*) from games g join competitions c on c.id = g.competition_id
            join seasons s on s.id = c.season_id where s.league_id = l.id),
         (select count(*) from memberships m
           where m.role = 'league_admin' and m.scope_type = 'league' and m.scope_id = l.id),
         (select count(*) from api_keys k where k.league_id = l.id and k.revoked_at is null),
         l.visibility,
         -- live links only: a revoked or spent one is not a way in
         (select count(*) from league_invites i
           where i.league_id = l.id and i.revoked_at is null
             and (i.expires_at is null or i.expires_at > now())
             and (i.max_uses is null or i.uses < i.max_uses)),
         (select count(*) from league_guests g where g.league_id = l.id)
    from leagues l
   order by l.name;
end; $$;

revoke all on function public.platform_leagues() from public, anon;
grant execute on function public.platform_leagues() to authenticated;
alter function public.platform_leagues() owner to postgres;

-- ----------------------------------------------------------------------------
-- 8. GRANTS. A policy runs as the querying role, so the helpers a policy calls
-- must be executable by anon (0051). The RPCs a signed-in person calls are
-- authenticated-only, except peek, which is the whole point of a link.
-- ----------------------------------------------------------------------------
revoke all on function public.any_private_league() from public;
revoke all on function public.any_gated_league() from public;
revoke all on function public.league_invited(uuid) from public;
revoke all on function public.league_invited_for(uuid, uuid) from public;
revoke all on function public.league_open_to_me(uuid) from public;
revoke all on function public.team_open_to_me(uuid) from public;
revoke all on function public.season_open_to_me(uuid) from public;
revoke all on function public.comp_open_to_me(uuid) from public;
grant execute on function public.any_private_league() to anon, authenticated, service_role;
grant execute on function public.any_gated_league() to anon, authenticated, service_role;
grant execute on function public.league_invited(uuid) to anon, authenticated, service_role;
grant execute on function public.league_open_to_me(uuid) to anon, authenticated, service_role;
grant execute on function public.team_open_to_me(uuid) to anon, authenticated, service_role;
grant execute on function public.season_open_to_me(uuid) to anon, authenticated, service_role;
grant execute on function public.comp_open_to_me(uuid) to anon, authenticated, service_role;
grant execute on function public.league_invited_for(uuid, uuid) to service_role;

revoke all on function public.platform_set_league_visibility(uuid, text) from public, anon;
revoke all on function public.league_invite_create(uuid, text, text, timestamptz, int) from public, anon;
revoke all on function public.league_invites_list(uuid) from public, anon;
revoke all on function public.league_invite_revoke(uuid) from public, anon;
revoke all on function public.redeem_league_invite(text) from public, anon;
revoke all on function public.league_guests_list(uuid) from public, anon;
revoke all on function public.league_guest_remove(uuid, uuid) from public, anon;
grant execute on function public.platform_set_league_visibility(uuid, text) to authenticated;
grant execute on function public.league_invite_create(uuid, text, text, timestamptz, int) to authenticated;
grant execute on function public.league_invites_list(uuid) to authenticated;
grant execute on function public.league_invite_revoke(uuid) to authenticated;
grant execute on function public.redeem_league_invite(text) to authenticated;
grant execute on function public.league_guests_list(uuid) to authenticated;
grant execute on function public.league_guest_remove(uuid, uuid) to authenticated;

revoke all on function public.league_invite_peek(text) from public;
grant execute on function public.league_invite_peek(text) to anon, authenticated, service_role;

revoke all on function public.leagues_visibility_guard() from public, anon, authenticated;

alter function public.any_private_league() owner to postgres;
alter function public.any_gated_league() owner to postgres;
alter function public.any_members_league() owner to postgres;
alter function public.league_invited(uuid) owner to postgres;
alter function public.league_invited_for(uuid, uuid) owner to postgres;
alter function public.league_open_to_me(uuid) owner to postgres;
alter function public.team_open_to_me(uuid) owner to postgres;
alter function public.season_open_to_me(uuid) owner to postgres;
alter function public.comp_open_to_me(uuid) owner to postgres;
alter function public.can_view_league(uuid) owner to postgres;
alter function public.can_view_league_for(uuid, uuid) owner to postgres;
alter function public.league_visible(uuid) owner to postgres;
alter function public.competition_visible(uuid) owner to postgres;
alter function public.game_visible(uuid) owner to postgres;
alter function public.leagues_visibility_guard() owner to postgres;
alter function public.platform_set_league_visibility(uuid, text) owner to postgres;
alter function public.league_invite_create(uuid, text, text, timestamptz, int) owner to postgres;
alter function public.league_invites_list(uuid) owner to postgres;
alter function public.league_invite_revoke(uuid) owner to postgres;
alter function public.league_invite_peek(text) owner to postgres;
alter function public.redeem_league_invite(text) owner to postgres;
alter function public.league_guests_list(uuid) owner to postgres;
alter function public.league_guest_remove(uuid, uuid) owner to postgres;

-- ============================================================================
-- SELF-TEST. Everything below runs inside this transaction and is rolled back,
-- so it proves the rules against THIS database without leaving anything in it.
-- ============================================================================
do $test$
declare
  orig text := current_user;
  lg_pub uuid; lg_priv uuid;
  sn uuid; cp uuid; tm uuid; pl uuid;
  stranger uuid; guest uuid; tok text; res jsonb;
  n int;
begin
  /* SKIPPED ON A DATABASE THAT IS ALREADY USING THIS. Several assertions below
     read "is anything private right now" as a global — they turn it on, check
     that the apparatus woke up, turn it off and check that it went back to a
     constant. That is only meaningful when nothing else is private, so on a
     re-run against a live platform with a real private league the test stands
     down rather than either lying or failing the migration. Everything above
     this line is idempotent and has already been applied by the time we get
     here. */
  if public.any_private_league() then
    raise notice '0139: a league is already private — self-test skipped (it needs a clean global state)';
    return;
  end if;

  begin
    insert into leagues (slug, name) values ('t0139-open', 'Test 0139 Open')
      returning id into lg_pub;
    insert into leagues (slug, name) values ('t0139-priv', 'Test 0139 Private')
      returning id into lg_priv;
    insert into seasons (league_id, name) values (lg_priv, '2026/27') returning id into sn;
    insert into competitions (season_id, name) values (sn, 'League') returning id into cp;
    insert into teams (slug, name, league_id) values ('t0139-club', 'Test 0139 Club', lg_priv)
      returning id into tm;
    -- a named person on that club, for the roster check further down
    insert into players (slug, first_name, last_name, is_minor)
    values ('t0139-player', 'Test', 'Zero139', false) returning id into pl;
    insert into roster_entries (team_id, player_id, jersey) values (tm, pl, '7');

    -- 1. the guard: the column does not move by hand
    begin
      update leagues set visibility = 'private' where id = lg_priv;
      raise exception '0139: a league went private by a plain UPDATE';
    exception when insufficient_privilege then null;
    end;

    -- 2. ...and does move through the RPC. Run as the migration's own role,
    --    which is a superuser here, so is_platform_admin is bypassed by
    --    setting the config directly rather than faking a platform admin.
    perform set_config('epinoia.visibility_rpc', 'on', true);
    update leagues set visibility = 'private' where id = lg_priv;
    perform set_config('epinoia.visibility_rpc', '', true);
    if not public.any_private_league() then
      raise exception '0139: any_private_league did not notice';
    end if;
    if not public.any_gated_league() then
      raise exception '0139: any_gated_league did not notice a private league';
    end if;
    if not public.any_members_league() then
      raise exception '0139: the 0118 fast path did not wake up for a private league';
    end if;

    -- 3. an open PUBLIC league is untouched by all of this
    if not public.league_visible(lg_pub) then
      raise exception '0139: an ordinary public league stopped being visible';
    end if;
    if not public.can_view_league(lg_pub) then
      raise exception '0139: an ordinary public league stopped being viewable';
    end if;

    -- 4. a stranger cannot see the private league, by any of the four gates
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0139-stranger@example.invalid', '', now(), now(), now())
      returning id into stranger;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0139-guest@example.invalid', '', now(), now(), now())
      returning id into guest;

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', stranger, 'role', 'authenticated')::text, true);

    if public.can_view_league(lg_priv) then
      raise exception '0139: a stranger could view a private league';
    end if;
    if public.league_visible(lg_priv) then
      raise exception '0139: league_visible let a stranger into a private league';
    end if;
    if public.competition_visible(cp) then
      raise exception '0139: competition_visible let a stranger into a private league';
    end if;
    if public.league_open_to_me(lg_priv) then
      raise exception '0139: league_open_to_me let a stranger in';
    end if;

    -- ...and the rows themselves are gone, which is the front-page test
    select count(*) into n from leagues where id = lg_priv;
    if n <> 0 then raise exception '0139: a private league is still listed to a stranger'; end if;
    select count(*) into n from leagues where id = lg_pub;
    if n <> 1 then raise exception '0139: the public league vanished along with it'; end if;
    select count(*) into n from teams where id = tm;
    if n <> 0 then raise exception '0139: a private league''s club is still listed'; end if;
    select count(*) into n from competitions where id = cp;
    if n <> 0 then raise exception '0139: a private league''s competition is still listed'; end if;
    select count(*) into n from seasons where id = sn;
    if n <> 0 then raise exception '0139: a private league''s season is still listed'; end if;

    /* THE ONE THAT CATCHES THE SUB-SELECT MISTAKE. roster_entries does not carry
       a league; its policy has to walk team -> league, and if that walk is
       written into the policy TEXT it runs as this role, reads a teams table
       that is already hiding the club, gets NULL, and lets every row through.
       A roster entry is a named person on a named club, so it is also the most
       revealing of these tables to get wrong. */
    if exists (select 1 from public.roster_entries where team_id = tm) then
      raise exception '0139: a private league''s roster is still readable (the policy''s '
                      'team -> league walk is running as the caller, so it saw no team and '
                      'answered "nothing to check")';
    end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    -- 5. a link, and the guest who uses it
    insert into league_invites (league_id, token, role, label)
    values (lg_priv, 't0139TokenAAAAAAAAAAAAAA', 'viewer', 'the test')
      returning token into tok;

    res := public.league_invite_peek(tok);
    if not (res->>'ok')::boolean then
      raise exception '0139: peek refused a good link (%)', res;
    end if;
    if res->>'league' <> 'Test 0139 Private' then
      raise exception '0139: peek did not name the league (%)', res;
    end if;

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', guest, 'role', 'authenticated')::text, true);

    res := public.redeem_league_invite(tok);
    if not (res->>'ok')::boolean then raise exception '0139: a good link was refused (%)', res; end if;
    if (res->>'already')::boolean then raise exception '0139: a first redeem said "already"'; end if;

    if not public.can_view_league(lg_priv) then
      raise exception '0139: the guest still cannot view the league they were let into';
    end if;
    select count(*) into n from leagues where id = lg_priv;
    if n <> 1 then raise exception '0139: the guest cannot see the league row'; end if;
    select count(*) into n from teams where id = tm;
    if n <> 1 then raise exception '0139: the guest cannot see the league''s clubs'; end if;
    select count(*) into n from roster_entries where team_id = tm;
    if n <> 1 then raise exception '0139: the guest cannot see the squads — hiding is one '
                                   'thing, but a league nobody let in can read is the point'; end if;

    -- 6. redeeming twice is a success and does not spend a use
    res := public.redeem_league_invite(tok);
    if not (res->>'ok')::boolean then raise exception '0139: the second redeem failed'; end if;
    if not (res->>'already')::boolean then raise exception '0139: the second redeem was not recognised'; end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);
    select uses into n from league_invites where token = tok;
    if n <> 1 then raise exception '0139: opening the link twice spent two uses (%)', n; end if;

    -- 7. a spent link
    update league_invites set max_uses = 1 where token = tok;
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    res := public.redeem_league_invite(tok);
    if (res->>'ok')::boolean then raise exception '0139: a used-up link still let somebody in'; end if;
    if res->>'reason' <> 'used_up' then raise exception '0139: wrong reason for a used-up link (%)', res; end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    -- 8. and with the private league gone, everything is back to a constant
    perform set_config('epinoia.visibility_rpc', 'on', true);
    update leagues set visibility = 'public' where id = lg_priv;
    perform set_config('epinoia.visibility_rpc', '', true);
    if public.any_private_league() then
      raise exception '0139: any_private_league still says yes with no private league';
    end if;

    raise exception using errcode = 'P0004', message = '0139 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
